
import firebase_admin
from firebase_admin import credentials
from firebase_admin import db
import csv
import time
from datetime import datetime

# 1. Firebase Bağlantısı
print("Firebase'e bağlanılıyor...")
cred = credentials.Certificate(r"C:\projeler\Otomatik-Yoklama-Takip-Sistemi\ml\firebase_kimlik.json")
firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://otomatik-yoklama-takip-sistemi-default-rtdb.europe-west1.firebasedatabase.app/'
})

OGRENCI_NO = "232804009"
SINIF = "203"

print("\n--- MCBÜ MAKİNE ÖĞRENMESİ VERİ TOPLAMA ARACI ---")
etiket_giris = input("Şu an neredesiniz? (1: Sınıf İçi, 0: Koridor/Dışarı): ")
etiket = "1" if etiket_giris == "1" else "0"
konum = "SINIF İÇİ" if etiket == "1" else "KORİDOR"

print(f"\n[{konum}] verileri toplanıyor... Lütfen telefonunuzla sınıf içinde/koridorda yürüyün.")
print("Durdurmak için klavyeden CTRL+C tuşlarına basın.\n")

# 2. CSV Dosyasını Hazırla
csv_dosyasi = 'rssi_veri_seti.csv'
with open(csv_dosyasi, mode='a', newline='') as file:
    writer = csv.writer(file)
    
    # Dosya boşsa başlıkları ekle
    file.seek(0, 2)
    if file.tell() == 0:
        writer.writerow(["Zaman", "Ogrenci_No", "RSSI", "Sinif_Ici_Mi"])

    son_kaydedilen_rssi = None

    # 3. Firebase'i Canlı Dinle
    def rssi_dinleyici(event):
        global son_kaydedilen_rssi
        if event.data is not None:
            # Sadece rssi node'u değiştiğinde veya tüm data geldiğinde yakala
            if isinstance(event.data, dict) and 'rssi' in event.data:
                rssi_degeri = event.data['rssi']
            elif not isinstance(event.data, dict):
                rssi_degeri = event.data
            else:
                return

            if rssi_degeri != son_kaydedilen_rssi and rssi_degeri != 0:
                zaman = datetime.now().strftime('%H:%M:%S')
                writer.writerow([zaman, OGRENCI_NO, rssi_degeri, etiket])
                file.flush() # Veriyi anında kaydet
                print(f"[{zaman}] Kaydedildi: RSSI = {rssi_degeri} dBm -> Sınıf İçi Mi: {etiket}")
                son_kaydedilen_rssi = rssi_degeri

    db_path = f'/Varlik/{SINIF}/{OGRENCI_NO}'
    dinleyici = db.reference(db_path).listen(rssi_dinleyici)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        dinleyici.close()
        print("\nVeri toplama başarıyla durduruldu. 'rssi_veri_seti.csv' dosyasını kontrol edebilirsiniz.")
