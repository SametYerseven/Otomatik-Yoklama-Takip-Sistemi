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
    saved = pickle.load(f)

model      = saved["model"]
kalman_Q   = saved["kalman_Q"]
kalman_R   = saved["kalman_R"]
ma_window  = saved["ma_pencere"]

print(f"  Model yüklendi. MA pencere={ma_window}, Q={kalman_Q}, R={kalman_R}")

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
CLASSROOM = "203"
# OGRENCI_NO sabitini siliyoruz, artık tüm sınıfı dinamik dinleyeceğiz.

# Her öğrenci için ayrı tutulacak veriler
kalman_state = {}
ma_buffer = {}
counters = {} # Örn: counters["232804009"] = {"total": 0, "in_class": 0, "outside": 0}

def update_kalman(student_no, new_measurement):
    """Tek bir ölçüm geldiğinde Kalman filtresi adımını çalıştırır."""
    if student_no not in kalman_state:
        kalman_state[student_no] = {"x": new_measurement, "P": 1.0}

    x = kalman_state[student_no]["x"]
    P = kalman_state[student_no]["P"]

    P = P + kalman_Q
    K = P / (P + kalman_R)
    x = x + K * (new_measurement - x)
    P = (1 - K) * P

    kalman_state[student_no]["x"] = x
    kalman_state[student_no]["P"] = P
    return x

def update_ma(student_no, new_measurement):
    """Moving Average tamponunu günceller ve ortalama döndürür."""
    if student_no not in ma_buffer:
        ma_buffer[student_no] = deque(maxlen=ma_window)
    ma_buffer[student_no].append(new_measurement)
    return np.mean(ma_buffer[student_no])

# --- ANA TAHMİN FONKSİYONU ---
def make_prediction(student_no, rssi):
    if rssi is None or rssi == 0:
        return

    if student_no not in counters:
        counters[student_no] = {"total": 0, "in_class": 0, "outside": 0}

    rssi_ma     = update_ma(student_no, rssi)
    rssi_kalman = update_kalman(student_no, rssi)

    X = np.array([[rssi, rssi_ma, rssi_kalman]])
    prediction      = model.predict(X)[0]
    probabilities = model.predict_proba(X)[0]
    confidence       = max(probabilities) * 100

    # ML Kararını belirle ve sayacı güncelle
    is_in_class = False
    if prediction == 1:
        label = "✓ SINIF İÇİ"
        counters[student_no]["in_class"] += 1
        is_in_class = True
    else:
        label = "✗ DIŞARIDA"
        counters[student_no]["outside"] += 1
        is_in_class = False
    counters[student_no]["total"] += 1

    # YENİ EKLENEN KISIM: Makine öğrenmesi kararını Firebase'e anlık yaz!
    try:
        db.reference(f"/MLPrediction/{CLASSROOM}/{student_no}").update({
            "in_class": is_in_class,
            "time": datetime.now().strftime("%H:%M:%S")
        })
    except Exception:
        pass

    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"{timestamp:<10} {student_no:<12} {rssi:>6} dBm  {rssi_ma:>6.1f}  {rssi_kalman:>6.1f}  {label:<14} %{confidence:.0f}")

    if counters[student_no]["total"] % 10 == 0:
        ratio = (counters[student_no]["in_class"] / counters[student_no]["total"]) * 100
        print(f"  → [{student_no}] Son {counters[student_no]['total']} ölçüm: Sınıfta %{ratio:.0f} | Dışarıda %{100-ratio:.0f}")


# ==========================================================
# 4. FİREBASE DİNLEYİCİSİ
# ==========================================================
print(f"\n[3/3] Dinleme başlatıldı → /Presence/{CLASSROOM} (Tüm Sınıf)")
print("Durdurmak için CTRL+C\n")
print(f"{'Saat':<10} {'Öğrenci No':<12} {'RSSI':>10} {'MA':>8} {'Kalman':>8} {'Tahmin':<14} {'Güven':>6}")
print("-" * 75)

def rssi_listener(event):
    path = event.path
    data = event.data

    # DURUM 1: Veri tamamen silindiyse (Öğrenci koptu VEYA Hoca herkesi sildi)
    if data is None:
        if path != "/":
            # Sadece tek bir öğrencinin bağlantısı koptuysa
            parts = path.strip("/").split("/")
            student_no = parts[0]
            
            if student_no in counters:
                counters[student_no]["last_status"] = False
            
            # GEÇMİŞİ TEMİZLE!
            if student_no in kalman_state: del kalman_state[student_no]
            if student_no in ma_buffer: del ma_buffer[student_no]
            
            try:
                db.reference(f"/MLPrediction/{CLASSROOM}/{student_no}").update({
                    "in_class": False,
                    "time": datetime.now().strftime("%H:%M:%S")
                })
                timestamp = datetime.now().strftime("%H:%M:%S")
                print(f"{timestamp:<10} {student_no:<12} {'-':>6} dBm  {'-':>6}  {'-':>6}  {'BLUETOOTH KOPUK':<14}")
            except Exception:
                pass
        else:
            # YENİ ÇÖZÜM: Hoca çıkış yoklamasında kimseyi tutmadıysa/herkes silindiyse tüm geçmişi temizle!
            kalman_state.clear()
            ma_buffer.clear()
            try:
                prediction_ref = db.reference(f"/MLPrediction/{CLASSROOM}")
                existing = prediction_ref.get()
                if existing:
                    for student in existing.keys():
                        prediction_ref.child(student).update({"in_class": False})
            except Exception:
                pass
        return

    # DURUM 2: Sınıfın tüm verisi güncellendiyse
    if path == "/":
        current_students = set()
        if isinstance(data, dict):
            for student_no, student_record in data.items():
                current_students.add(student_no)
                if isinstance(student_record, dict) and "rssi" in student_record:
                    make_prediction(student_no, student_record["rssi"])
        
        to_remove = [student for student in counters.keys() if student not in current_students]
        for student in to_remove:
            if student in kalman_state: del kalman_state[student]
            if student in ma_buffer: del ma_buffer[student]
            try:
                db.reference(f"/MLPrediction/{CLASSROOM}/{student}").update({"in_class": False})
            except:
                pass
                
    # DURUM 3: Sadece tek bir öğrencinin RSSI verisi güncellendiyse
    else:
        parts = path.strip("/").split("/")
        student_no = parts[0]
        
        rssi = None
        if isinstance(data, dict) and "rssi" in data:
            rssi = data["rssi"]
        elif len(parts) > 1 and parts[1] == "rssi":
            rssi = data 
            
        make_prediction(student_no, rssi)

# Yolu tüm sınıfı kapsayacak şekilde güncelledik
db_path = f"/Presence/{CLASSROOM}"
listener = db.reference(db_path).listen(rssi_listener)

# SİSTEMİN KAPANMASINI ENGELLEYEN VE ÖZET YAZDIRAN KISIM (Eksik olan buydu)
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    listener.close()
    print("\n" + "=" * 55)
    print("  OTURUM ÖZETİ (TÜM ÖĞRENCİLER)")
    print("=" * 55)
    
    if not counters:
        print("  Hiç veri toplanmadı.")
    else:
        for student_no, stats in counters.items():
            if stats["total"] > 0:
                ratio = (stats["in_class"] / stats["total"]) * 100
                decision = "✓ KATILDI" if ratio >= 70 else "✗ DEVAMSIZ"
                print(f"[{student_no}] -> Toplam: {stats['total']:<4} | Sınıf İçi: %{ratio:<3.0f} | Karar: {decision}")
    print("=" * 55)