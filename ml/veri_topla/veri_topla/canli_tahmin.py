import firebase_admin
from firebase_admin import credentials
from firebase_admin import db
import pickle
import numpy as np
from datetime import datetime
from collections import deque
import time

print("=" * 70)
print("   MCBÜ - CANLI RSSI TAHMİN SİSTEMİ (TÜM SINIF)")
print("=" * 70)

# ==========================================================
# 1. MODELİ YÜKLE
# ==========================================================
print("\n[1/3] Model yükleniyor...")
with open("model.pkl", "rb") as f:
    kayit = pickle.load(f)

model      = kayit["model"]
kalman_Q   = kayit["kalman_Q"]
kalman_R   = kayit["kalman_R"]
ma_pencere = kayit["ma_pencere"]

print(f"  Model yüklendi. MA pencere={ma_pencere}, Q={kalman_Q}, R={kalman_R}")

# ==========================================================
# 2. FİREBASE BAĞLANTISI
# ==========================================================
print("\n[2/3] Firebase'e bağlanılıyor...")
cred = credentials.Certificate(
    r"C:\projeler\Otomatik-Yoklama-Takip-Sistemi\ml\firebase_kimlik.json"
)
firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://otomatik-yoklama-takip-sistemi-default-rtdb.europe-west1.firebasedatabase.app/'
})
print("  Firebase bağlantısı başarılı!")

# ==========================================================
# 3. CANLI TAHMİN ALTYAPISI
# ==========================================================
SINIF = "203"
# OGRENCI_NO sabitini siliyoruz, artık tüm sınıfı dinamik dinleyeceğiz.

# Her öğrenci için ayrı tutulacak veriler
kalman_durum = {}
ma_tampon = {}
sayac = {} # Örn: sayac["232804009"] = {"toplam": 0, "sinifta": 0, "disarida": 0}

def kalman_guncelle(ogrenci_no, yeni_olcum):
    """Tek bir ölçüm geldiğinde Kalman filtresi adımını çalıştırır."""
    if ogrenci_no not in kalman_durum:
        kalman_durum[ogrenci_no] = {"x": yeni_olcum, "P": 1.0}

    x = kalman_durum[ogrenci_no]["x"]
    P = kalman_durum[ogrenci_no]["P"]

    P = P + kalman_Q
    K = P / (P + kalman_R)
    x = x + K * (yeni_olcum - x)
    P = (1 - K) * P

    kalman_durum[ogrenci_no]["x"] = x
    kalman_durum[ogrenci_no]["P"] = P
    return x

def ma_guncelle(ogrenci_no, yeni_olcum):
    """Moving Average tamponunu günceller ve ortalama döndürür."""
    if ogrenci_no not in ma_tampon:
        ma_tampon[ogrenci_no] = deque(maxlen=ma_pencere)
    ma_tampon[ogrenci_no].append(yeni_olcum)
    return np.mean(ma_tampon[ogrenci_no])

# --- ANA TAHMİN FONKSİYONU ---
def tahmin_yap(ogrenci_no, rssi):
    if rssi is None or rssi == 0:
        return

    if ogrenci_no not in sayac:
        sayac[ogrenci_no] = {"toplam": 0, "sinifta": 0, "disarida": 0}

    rssi_ma     = ma_guncelle(ogrenci_no, rssi)
    rssi_kalman = kalman_guncelle(ogrenci_no, rssi)

    X = np.array([[rssi, rssi_ma, rssi_kalman]])
    tahmin      = model.predict(X)[0]
    olasiliklar = model.predict_proba(X)[0]
    guven       = max(olasiliklar) * 100

    # ML Kararını belirle ve sayacı güncelle
    sinif_ici_mi = False
    if tahmin == 1:
        etiket = "✓ SINIF İÇİ"
        sayac[ogrenci_no]["sinifta"] += 1
        sinif_ici_mi = True
    else:
        etiket = "✗ DIŞARIDA"
        sayac[ogrenci_no]["disarida"] += 1
        sinif_ici_mi = False
    sayac[ogrenci_no]["toplam"] += 1

    # YENİ EKLENEN KISIM: Makine öğrenmesi kararını Firebase'e anlık yaz!
    try:
        db.reference(f"/ML_Tahmin/{SINIF}/{ogrenci_no}").update({
            "sinif_ici": sinif_ici_mi,
            "zaman": datetime.now().strftime("%H:%M:%S")
        })
    except Exception:
        pass

    zaman = datetime.now().strftime("%H:%M:%S")
    print(f"{zaman:<10} {ogrenci_no:<12} {rssi:>6} dBm  {rssi_ma:>6.1f}  {rssi_kalman:>6.1f}  {etiket:<14} %{guven:.0f}")

    if sayac[ogrenci_no]["toplam"] % 10 == 0:
        oran = (sayac[ogrenci_no]["sinifta"] / sayac[ogrenci_no]["toplam"]) * 100
        print(f"  → [{ogrenci_no}] Son {sayac[ogrenci_no]['toplam']} ölçüm: Sınıfta %{oran:.0f} | Dışarıda %{100-oran:.0f}")


# ==========================================================
# 4. FİREBASE DİNLEYİCİSİ
# ==========================================================
print(f"\n[3/3] Dinleme başlatıldı → /Varlik/{SINIF} (Tüm Sınıf)")
print("Durdurmak için CTRL+C\n")
print(f"{'Saat':<10} {'Öğrenci No':<12} {'RSSI':>10} {'MA':>8} {'Kalman':>8} {'Tahmin':<14} {'Güven':>6}")
print("-" * 75)

def rssi_dinleyici(event):
    path = event.path
    veri = event.data

    # DURUM 1: Veri tamamen silindiyse (Öğrenci koptu VEYA Hoca herkesi sildi)
    if veri is None:
        if path != "/":
            # Sadece tek bir öğrencinin bağlantısı koptuysa
            parcalar = path.strip("/").split("/")
            ogrenci_no = parcalar[0]
            
            if ogrenci_no in sayac:
                sayac[ogrenci_no]["son_durum"] = False
            
            # GEÇMİŞİ TEMİZLE!
            if ogrenci_no in kalman_durum: del kalman_durum[ogrenci_no]
            if ogrenci_no in ma_tampon: del ma_tampon[ogrenci_no]
            
            try:
                db.reference(f"/ML_Tahmin/{SINIF}/{ogrenci_no}").update({
                    "sinif_ici": False,
                    "zaman": datetime.now().strftime("%H:%M:%S")
                })
                zaman = datetime.now().strftime("%H:%M:%S")
                print(f"{zaman:<10} {ogrenci_no:<12} {'-':>6} dBm  {'-':>6}  {'-':>6}  {'BLUETOOTH KOPUK':<14}")
            except Exception:
                pass
        else:
            # YENİ ÇÖZÜM: Hoca çıkış yoklamasında kimseyi tutmadıysa/herkes silindiyse tüm geçmişi temizle!
            kalman_durum.clear()
            ma_tampon.clear()
            try:
                tahmin_ref = db.reference(f"/ML_Tahmin/{SINIF}")
                mevcut = tahmin_ref.get()
                if mevcut:
                    for ogr in mevcut.keys():
                        tahmin_ref.child(ogr).update({"sinif_ici": False})
            except Exception:
                pass
        return

    # DURUM 2: Sınıfın tüm verisi güncellendiyse
    if path == "/":
        mevcut_ogrenciler = set()
        if isinstance(veri, dict):
            for ogrenci_no, ogrenci_veri in veri.items():
                mevcut_ogrenciler.add(ogrenci_no)
                if isinstance(ogrenci_veri, dict) and "rssi" in ogrenci_veri:
                    tahmin_yap(ogrenci_no, ogrenci_veri["rssi"])
        
        silinecekler = [ogr for ogr in sayac.keys() if ogr not in mevcut_ogrenciler]
        for ogr in silinecekler:
            if ogr in kalman_durum: del kalman_durum[ogr]
            if ogr in ma_tampon: del ma_tampon[ogr]
            try:
                db.reference(f"/ML_Tahmin/{SINIF}/{ogr}").update({"sinif_ici": False})
            except:
                pass
                
    # DURUM 3: Sadece tek bir öğrencinin RSSI verisi güncellendiyse
    else:
        parcalar = path.strip("/").split("/")
        ogrenci_no = parcalar[0]
        
        rssi = None
        if isinstance(veri, dict) and "rssi" in veri:
            rssi = veri["rssi"]
        elif len(parcalar) > 1 and parcalar[1] == "rssi":
            rssi = veri 
            
        tahmin_yap(ogrenci_no, rssi)

# Yolu tüm sınıfı kapsayacak şekilde güncelledik
db_path  = f"/Varlik/{SINIF}"
dinleyici = db.reference(db_path).listen(rssi_dinleyici)

# SİSTEMİN KAPANMASINI ENGELLEYEN VE ÖZET YAZDIRAN KISIM (Eksik olan buydu)
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    dinleyici.close()
    print("\n" + "=" * 55)
    print("  OTURUM ÖZETİ (TÜM ÖĞRENCİLER)")
    print("=" * 55)
    
    if not sayac:
        print("  Hiç veri toplanmadı.")
    else:
        for ogr_no, s in sayac.items():
            if s["toplam"] > 0:
                oran = (s["sinifta"] / s["toplam"]) * 100
                karar = "✓ KATILDI" if oran >= 70 else "✗ DEVAMSIZ"
                print(f"[{ogr_no}] -> Toplam: {s['toplam']:<4} | Sınıf İçi: %{oran:<3.0f} | Karar: {karar}")
    print("=" * 55)