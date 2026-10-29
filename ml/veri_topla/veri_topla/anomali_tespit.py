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
WINDOW_SIZE = 15

# RSSI standart sapması bu değerin altındaysa telefon bırakılmış demektir
STABILITY_THRESHOLD = 2.5   # dBm

# Bu değerden güçlü sinyal "çok yakın" uyarısı verir
TOO_STRONG_THRESHOLD = -45   # dBm

# Bu değerden zayıf sinyal X ölçüm boyunca devam ederse uyarı verir
TOO_WEAK_THRESHOLD = -85  # dBm
WEAK_DURATION      = 10   # ölçüm sayısı

CLASSROOM  = "203"
STUDENT_NO = "232804009"

# ==========================================================
# 3. VERİ YAPILARI
# ==========================================================
student_data  = {}   # student_no → deque(rssi geçmişi)
alert_history = {}   # student_no → son uyarı zamanı (spam önleme)

def get_student_data(student_no):
    if student_no not in student_data:
        student_data[student_no] = deque(maxlen=WINDOW_SIZE)
        alert_history[student_no]    = {}
    return student_data[student_no]

def print_alert(alert_type, student_no, message, detail=""):
    """Aynı uyarıyı 30 saniye içinde tekrar gösterme."""
    now = time.time()
    last   = alert_history.get(student_no, {}).get(alert_type, 0)
    if now - last < 30:
        return

    alert_history.setdefault(student_no, {})[alert_type] = now
    timestamp = datetime.now().strftime("%H:%M:%S")

    icons = {
        "STABILITY" : "⚠️ ",
        "TOO_CLOSE": "🚨",
        "TOO_WEAK": "📡",
    }
    icon = icons.get(alert_type, "⚠️ ")

    print(f"\n{'─'*55}")
    print(f"  {icon}  ANOMALİ TESPİT EDİLDİ  [{timestamp}]")
    print(f"  Öğrenci : {student_no}")
    print(f"  Tip     : {message}")
    if detail:
        print(f"  Detay   : {detail}")
    print(f"{'─'*55}\n")

# ==========================================================
# 4. ANOMALİ KONTROL FONKSİYONU
# ==========================================================
def check_anomaly(student_no, rssi):
    history = get_student_data(student_no)
    history.append(rssi)

    # Yeterli veri birikimine bekle
    if len(history) < 5:
        return

    values = np.array(history)

    # --- KONTROL 1: Sabitlik (Telefon bırakılmış mı?) ---
    if len(history) >= WINDOW_SIZE:
        std = np.std(values)
        if std < STABILITY_THRESHOLD:
            print_alert(
                "STABILITY", student_no,
                "Telefon sınıfta BIRAKILIYOR olabilir!",
                f"Son {WINDOW_SIZE} ölçümde standart sapma: {std:.2f} dBm "
                f"(eşik: {STABILITY_THRESHOLD} dBm)"
            )

    # --- KONTROL 2: Çok güçlü sinyal (ESP32'ye yapıştı mı?) ---
    if rssi > TOO_STRONG_THRESHOLD:
        print_alert(
            "TOO_CLOSE", student_no,
            "Öğrenci ESP32'ye ANORMAL DERECEDE YAKIN!",
            f"RSSI = {rssi} dBm (eşik: >{TOO_STRONG_THRESHOLD} dBm) — "
            f"Cihazı ESP32'ye yapıştırıyor olabilir."
        )

    # --- KONTROL 3: Uzun süreli zayıf sinyal (Sınıf dışına mı çıktı?) ---
    if len(history) >= WEAK_DURATION:
        last_measurements = list(history)[-WEAK_DURATION:]
        if all(r < TOO_WEAK_THRESHOLD for r in last_measurements):
            print_alert(
                "TOO_WEAK", student_no,
                "Öğrenci SINIF DIŞINA ÇIKMIŞ olabilir!",
                f"Son {WEAK_DURATION} ölçümün tamamı "
                f"{TOO_WEAK_THRESHOLD} dBm altında. "
                f"Ort: {np.mean(last_measurements):.1f} dBm"
            )

# ==========================================================
# 5. FİREBASE DİNLEYİCİSİ
# ==========================================================
print(f"[2/2] Dinleme başlatıldı → /Presence/{CLASSROOM}")
print(f"  Sabitlik eşiği  : std < {STABILITY_THRESHOLD} dBm")
print(f"  Çok yakın eşiği : RSSI > {TOO_STRONG_THRESHOLD} dBm")
print(f"  Çok zayıf eşiği : RSSI < {TOO_WEAK_THRESHOLD} dBm ({WEAK_DURATION} ölçüm)")
print("\nDurdurmak için CTRL+C\n")
print(f"{'Saat':<10} {'Öğrenci':<15} {'RSSI':>10}   Durum")
print("─" * 55)

def presence_listener(event):
    if event.data is None:
        return

    path = event.path
    data = event.data

    # DURUM 1: İlk bağlantıda tüm sınıf verisi gelirse (path == "/")
    if path == "/":
        if isinstance(data, dict):
            for student_no, student_record in data.items():
                if isinstance(student_record, dict) and "rssi" in student_record:
                    rssi = student_record["rssi"]
                    if rssi and rssi != 0:
                        timestamp = datetime.now().strftime("%H:%M:%S")
                        print(f"{timestamp:<10} {student_no:<15} {rssi:>8} dBm   Normal")
                        check_anomaly(student_no, rssi)
                        
    # DURUM 2: ESP32 anlık olarak tek bir öğrenciyi veya sadece RSSI güncellerse
    else:
        # path örneğin "/232804009" veya "/232804009/rssi" şeklinde gelir
        parts = path.strip("/").split("/")
        student_no = parts[0]
        
        rssi = None
        if isinstance(data, dict) and "rssi" in data:
            rssi = data["rssi"]
        elif len(parts) > 1 and parts[1] == "rssi":
            rssi = data # Değer direkt integer/float olarak geldiyse
            
        if rssi is not None and rssi != 0:
            timestamp = datetime.now().strftime("%H:%M:%S")
            print(f"{timestamp:<10} {student_no:<15} {rssi:>8} dBm   Normal")
            check_anomaly(student_no, rssi)

# Firebase dinleyicisini başlat
db_path = f"/Presence/{CLASSROOM}"
listener = db.reference(db_path).listen(presence_listener)

# Programın kapanmaması ve sürekli veri beklemesi için sonsuz döngü
try:
    import time
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    listener.close()
    print("\n✓ Anomali tespiti durduruldu.")