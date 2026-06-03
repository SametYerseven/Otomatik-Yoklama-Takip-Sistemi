import firebase_admin
from firebase_admin import credentials
from firebase_admin import db
import numpy as np
from datetime import datetime
from collections import deque
import time

print("=" * 55)
print("   MCBÜ - SAHTEKARLİK / ANOMALİ TESPİT SİSTEMİ")
print("=" * 55)
print("""
Tespit edilen durumlar:
  [1] Telefon sınıfta bırakılmış (RSSI çok sabit)
  [2] Sinyal aniden çok güçlendi (ESP32'ye yaklaştı)
  [3] Sinyal çok uzun süredir çok zayıf (fiziksel uzaklaşma)
""")

# ==========================================================
# 1. FİREBASE BAĞLANTISI
# ==========================================================
print("[1/2] Firebase'e bağlanılıyor...")
cred = credentials.Certificate(
    r"C:\projeler\Otomatik-Yoklama-Takip-Sistemi\ml\firebase_kimlik.json"
)
firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://otomatik-yoklama-takip-sistemi-default-rtdb.europe-west1.firebasedatabase.app/'
})
print("  Bağlantı başarılı!\n")

# ==========================================================
# 2. ANOMALİ TESPİT PARAMETRELERİ
# ==========================================================

# Kaç ölçüm saklansın (pencere)
PENCERE_BOYUTU = 15

# RSSI standart sapması bu değerin altındaysa telefon bırakılmış demektir
SABITLIK_ESIGI = 2.5   # dBm

# Bu değerden güçlü sinyal "çok yakın" uyarısı verir
COK_GUCLU_ESIK = -45   # dBm

# Bu değerden zayıf sinyal X ölçüm boyunca devam ederse uyarı verir
COK_ZAYIF_ESIK = -85   # dBm
ZAYIF_SURE     = 10    # ölçüm sayısı

SINIF      = "203"
OGRENCI_NO = "232804009"

# ==========================================================
# 3. VERİ YAPILARI
# ==========================================================
ogrenci_verileri = {}   # ogrenci_no → deque(rssi geçmişi)
uyari_gecmisi    = {}   # ogrenci_no → son uyarı zamanı (spam önleme)

def ogrenci_verisi_al(no):
    if no not in ogrenci_verileri:
        ogrenci_verileri[no] = deque(maxlen=PENCERE_BOYUTU)
        uyari_gecmisi[no]    = {}
    return ogrenci_verileri[no]

def uyari_yazdir(tip, ogrenci_no, mesaj, detay=""):
    """Aynı uyarıyı 30 saniye içinde tekrar gösterme."""
    simdi = time.time()
    son   = uyari_gecmisi.get(ogrenci_no, {}).get(tip, 0)
    if simdi - son < 30:
        return

    uyari_gecmisi.setdefault(ogrenci_no, {})[tip] = simdi
    zaman = datetime.now().strftime("%H:%M:%S")

    renkler = {
        "SABITLIK" : "⚠️ ",
        "COK_YAKIN": "🚨",
        "COK_ZAYIF": "📡",
    }
    ikon = renkler.get(tip, "⚠️ ")

    print(f"\n{'─'*55}")
    print(f"  {ikon}  ANOMALİ TESPİT EDİLDİ  [{zaman}]")
    print(f"  Öğrenci : {ogrenci_no}")
    print(f"  Tip     : {mesaj}")
    if detay:
        print(f"  Detay   : {detay}")
    print(f"{'─'*55}\n")

# ==========================================================
# 4. ANOMALİ KONTROL FONKSİYONU
# ==========================================================
def anomali_kontrol(ogrenci_no, rssi):
    gecmis = ogrenci_verisi_al(ogrenci_no)
    gecmis.append(rssi)

    # Yeterli veri birikimine bekle
    if len(gecmis) < 5:
        return

    dizi = np.array(gecmis)

    # --- KONTROL 1: Sabitlik (Telefon bırakılmış mı?) ---
    if len(gecmis) >= PENCERE_BOYUTU:
        std = np.std(dizi)
        if std < SABITLIK_ESIGI:
            uyari_yazdir(
                "SABITLIK", ogrenci_no,
                "Telefon sınıfta BIRAKILIYOR olabilir!",
                f"Son {PENCERE_BOYUTU} ölçümde standart sapma: {std:.2f} dBm "
                f"(eşik: {SABITLIK_ESIGI} dBm)"
            )

    # --- KONTROL 2: Çok güçlü sinyal (ESP32'ye yapıştı mı?) ---
    if rssi > COK_GUCLU_ESIK:
        uyari_yazdir(
            "COK_YAKIN", ogrenci_no,
            "Öğrenci ESP32'ye ANORMAL DERECEDE YAKIN!",
            f"RSSI = {rssi} dBm (eşik: >{COK_GUCLU_ESIK} dBm) — "
            f"Cihazı ESP32'ye yapıştırıyor olabilir."
        )

    # --- KONTROL 3: Uzun süreli zayıf sinyal (Sınıf dışına mı çıktı?) ---
    if len(gecmis) >= ZAYIF_SURE:
        son_olcumler = list(gecmis)[-ZAYIF_SURE:]
        if all(r < COK_ZAYIF_ESIK for r in son_olcumler):
            uyari_yazdir(
                "COK_ZAYIF", ogrenci_no,
                "Öğrenci SINIF DIŞINA ÇIKMIŞ olabilir!",
                f"Son {ZAYIF_SURE} ölçümün tamamı "
                f"{COK_ZAYIF_ESIK} dBm altında. "
                f"Ort: {np.mean(son_olcumler):.1f} dBm"
            )

# ==========================================================
# 5. FİREBASE DİNLEYİCİSİ
# ==========================================================
print(f"[2/2] Dinleme başlatıldı → /Varlik/{SINIF}")
print(f"  Sabitlik eşiği  : std < {SABITLIK_ESIGI} dBm")
print(f"  Çok yakın eşiği : RSSI > {COK_GUCLU_ESIK} dBm")
print(f"  Çok zayıf eşiği : RSSI < {COK_ZAYIF_ESIK} dBm ({ZAYIF_SURE} ölçüm)")
print("\nDurdurmak için CTRL+C\n")
print(f"{'Saat':<10} {'Öğrenci':<15} {'RSSI':>10}   Durum")
print("─" * 55)

def varlik_dinleyici(event):
    if event.data is None:
        return

    path = event.path
    veri = event.data

    # DURUM 1: İlk bağlantıda tüm sınıf verisi gelirse (path == "/")
    if path == "/":
        if isinstance(veri, dict):
            for ogrenci_no, ogrenci_veri in veri.items():
                if isinstance(ogrenci_veri, dict) and "rssi" in ogrenci_veri:
                    rssi = ogrenci_veri["rssi"]
                    if rssi and rssi != 0:
                        zaman = datetime.now().strftime("%H:%M:%S")
                        print(f"{zaman:<10} {ogrenci_no:<15} {rssi:>8} dBm   Normal")
                        anomali_kontrol(ogrenci_no, rssi)
                        
    # DURUM 2: ESP32 anlık olarak tek bir öğrenciyi veya sadece RSSI güncellerse
    else:
        # path örneğin "/232804009" veya "/232804009/rssi" şeklinde gelir
        parcalar = path.strip("/").split("/")
        ogrenci_no = parcalar[0]
        
        rssi = None
        if isinstance(veri, dict) and "rssi" in veri:
            rssi = veri["rssi"]
        elif len(parcalar) > 1 and parcalar[1] == "rssi":
            rssi = veri # Değer direkt integer/float olarak geldiyse
            
        if rssi is not None and rssi != 0:
            zaman = datetime.now().strftime("%H:%M:%S")
            print(f"{zaman:<10} {ogrenci_no:<15} {rssi:>8} dBm   Normal")
            anomali_kontrol(ogrenci_no, rssi)

# Firebase dinleyicisini başlat
db_path  = f"/Varlik/{SINIF}"
dinleyici = db.reference(db_path).listen(varlik_dinleyici)

# Programın kapanmaması ve sürekli veri beklemesi için sonsuz döngü
try:
    import time
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    dinleyici.close()
    print("\n✓ Anomali tespiti durduruldu.")