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

    # Öğrenci sayacı yoksa oluştur
    if ogrenci_no not in sayac:
        sayac[ogrenci_no] = {"toplam": 0, "sinifta": 0, "disarida": 0}

    # Filtreleri uygula
    rssi_ma     = ma_guncelle(ogrenci_no, rssi)
    rssi_kalman = kalman_guncelle(ogrenci_no, rssi)

    # Model tahmini
    X = np.array([[rssi, rssi_ma, rssi_kalman]])
    tahmin      = model.predict(X)[0]
    olasiliklar = model.predict_proba(X)[0]
    guven       = max(olasiliklar) * 100

    # Etiket ve Sayaç Güncelleme
    if tahmin == 1:
        etiket = "✓ SINIF İÇİ"
        sayac[ogrenci_no]["sinifta"] += 1
    else:
        etiket = "✗ DIŞARIDA"
        sayac[ogrenci_no]["disarida"] += 1
    sayac[ogrenci_no]["toplam"] += 1

    # Ekrana yaz
    zaman = datetime.now().strftime("%H:%M:%S")
    print(f"{zaman:<10} {ogrenci_no:<12} {rssi:>6} dBm  {rssi_ma:>6.1f}  {rssi_kalman:>6.1f}  {etiket:<14} %{guven:.0f}")

    # Her öğrenci için kendi 10 ölçümünde bir özet ver
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

    # YENİ KONTROL: Öğrenci Bluetooth'u kapatırsa ESP32 onu siler, veri "None" gelir.
    if veri is None:
        if path != "/": # Eğer silinen şey tüm sınıf değil de tek bir öğrenciyse
            parcalar = path.strip("/").split("/")
            ogrenci_no = parcalar[0]
            
            if ogrenci_no in sayac:
                sayac[ogrenci_no]["son_durum"] = False
            
            try:
                # Sinyal koptuğu an ML kararını "Sınıf Dışı" yap
                db.reference(f"/ML_Tahmin/{SINIF}/{ogrenci_no}").update({
                    "sinif_ici": False,
                    "zaman": datetime.now().strftime("%H:%M:%S")
                })
                zaman = datetime.now().strftime("%H:%M:%S")
                print(f"{zaman:<10} {ogrenci_no:<12} {'-':>6} dBm  {'-':>6}  {'-':>6}  {'BLUETOOTH KAPALI':<14}")
            except Exception:
                pass
        return

    # DURUM 1: Sınıfın tüm verisi geldiyse
    if path == "/":
        if isinstance(veri, dict):
            for ogrenci_no, ogrenci_veri in veri.items():
                if isinstance(ogrenci_veri, dict) and "rssi" in ogrenci_veri:
                    tahmin_yap(ogrenci_no, ogrenci_veri["rssi"])
                    
    # DURUM 2: Tek bir öğrencinin verisi güncellendiyse
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

try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    dinleyici.close()
    print("\n" + "=" * 55)
    print("  OTURUM ÖZETİ (TÜM ÖĞRENCİLER)")
    print("=" * 55)
    
    # Kapanışta kayıtlı tüm öğrencilerin raporunu yazdır
    if not sayac:
        print("  Hiç veri toplanmadı.")
    else:
        for ogr_no, s in sayac.items():
            if s["toplam"] > 0:
                oran = (s["sinifta"] / s["toplam"]) * 100
                karar = "✓ KATILDI" if oran >= 70 else "✗ DEVAMSIZ"
                print(f"[{ogr_no}] -> Toplam: {s['toplam']:<4} | Sınıf İçi: %{oran:<3.0f} | Karar: {karar}")
    print("=" * 55)