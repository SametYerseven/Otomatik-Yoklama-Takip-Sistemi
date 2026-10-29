
import firebase_admin
from firebase_admin import credentials
from firebase_admin import db
import csv
import time
from datetime import datetime

# 1. Firebase Bağlantısı
print("Firebase'e bağlanılıyor...")
cred = credentials.Certificate("firebase_kimlik.json")
firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://otomatik-yoklama-takip-sistemi-default-rtdb.europe-west1.firebasedatabase.app/'
})

STUDENT_NO = "232804009"
CLASSROOM = "203"

print("\n--- MCBÜ MAKİNE ÖĞRENMESİ VERİ TOPLAMA ARACI ---")
label_input = input("Şu an neredesiniz? (1: Sınıf İçi, 0: Koridor/Dışarı): ")
label = "1" if label_input == "1" else "0"
location = "SINIF İÇİ" if label == "1" else "KORİDOR"

print(f"\n[{location}] verileri toplanıyor... Lütfen telefonunuzla sınıf içinde/koridorda yürüyün.")
print("Durdurmak için klavyeden CTRL+C tuşlarına basın.\n")

# 2. CSV Dosyasını Hazırla
csv_file = 'rssi_veri_seti.csv'
with open(csv_file, mode='a', newline='') as file:
    writer = csv.writer(file)
    
    # Dosya boşsa başlıkları ekle
    file.seek(0, 2)
    if file.tell() == 0:
        writer.writerow(["Zaman", "Ogrenci_No", "RSSI", "Sinif_Ici_Mi"])

    last_saved_rssi = None

    # 3. Firebase'i Canlı Dinle
    def rssi_listener(event):
        global last_saved_rssi
        if event.data is not None:
            # Sadece rssi node'u değiştiğinde veya tüm data geldiğinde yakala
            if isinstance(event.data, dict) and 'rssi' in event.data:
                rssi_value = event.data['rssi']
            elif not isinstance(event.data, dict):
                rssi_value = event.data
            else:
                return

            if rssi_value != last_saved_rssi and rssi_value != 0:
                timestamp = datetime.now().strftime('%H:%M:%S')
                writer.writerow([timestamp, STUDENT_NO, rssi_value, label])
                file.flush() # Veriyi anında kaydet
                print(f"[{timestamp}] Kaydedildi: RSSI = {rssi_value} dBm -> Sınıf İçi Mi: {label}")
                last_saved_rssi = rssi_value

    db_path = f'/Presence/{CLASSROOM}/{STUDENT_NO}'
    listener = db.ref(db_path).listen(rssi_listener)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        listener.close()
        print("\nVeri toplama başarıyla durduruldu. 'rssi_veri_seti.csv' dosyasını kontrol edebilirsiniz.")
