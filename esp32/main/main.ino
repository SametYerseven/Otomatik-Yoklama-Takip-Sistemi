#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <BLEAdvertisedDevice.h>
#include "config.h"
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"


uint16_t aktifDersKodu = 0;
uint8_t  aktifOturumNo = 0;
int scanTime = 5; 
BLEScan* pBLEScan;

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config_firebase;

#define PIN_KIRMIZI 25
#define PIN_YESIL 26
#define PIN_MAVI 27
#define PIN_BUZZER 13

void rgbAyarla(bool kirmiziDurum, bool yesilDurum, bool maviDurum) {
    digitalWrite(PIN_KIRMIZI, kirmiziDurum);
    digitalWrite(PIN_YESIL, yesilDurum);
    digitalWrite(PIN_MAVI, maviDurum);
}

void sistemHazirAnimasyonu() {
    rgbAyarla(LOW, LOW, HIGH); 
    tone(PIN_BUZZER, 440, 200); 
    delay(250);
    rgbAyarla(LOW, HIGH, LOW);
    tone(PIN_BUZZER, 880, 400); 
    delay(500);
    rgbAyarla(LOW, LOW, LOW);
}

class MyAdvertisedDeviceCallbacks: public BLEAdvertisedDeviceCallbacks {
    void onResult(BLEAdvertisedDevice advertisedDevice) {

        Serial.print(".");
        String deviceMac = advertisedDevice.getAddress().toString().c_str();
        
     
        if (advertisedDevice.haveRSSI()) {
            
            
            int rssi = advertisedDevice.getRSSI();
            Serial.printf("Cihaz: %s | RSSI: %d \n", deviceMac.c_str(), rssi);
            
            if (aktifDersKodu > 0 && aktifOturumNo > 0) {
            
                String dbPath = "/Yoklamalar/" + String(aktifDersKodu) + "/Oturum_" + String(aktifOturumNo) + "/" + deviceMac;
                
                if (Firebase.RTDB.setInt(&fbdo, dbPath + "/rssi", rssi)) {
                    Serial.println("  ✅ Firebase'e başarıyla kaydedildi.");
                } else {

                    Serial.println("  ❌ Firebase Kayıt Hatası: " + fbdo.errorReason());
                }
            } else {
                Serial.println("  ⚠️ Aktif ders numarası alınamadı, Firebase'e yazılamıyor.");
            }
        }
        Serial.println("---------------------------------");
    }
};

void setup() {
    Serial.begin(115200);
    
    pinMode(PIN_KIRMIZI, OUTPUT);
    pinMode(PIN_YESIL, OUTPUT);
    pinMode(PIN_MAVI, OUTPUT);
    pinMode(PIN_BUZZER, OUTPUT);
    rgbAyarla(LOW, LOW, LOW);

    Serial.println("\n--- ESP32 Yoklama Sistemi Başlatılıyor ---");
    
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("Wi-Fi ağına bağlanılıyor");
    while (WiFi.status() != WL_CONNECTED) {
        rgbAyarla(HIGH, LOW, LOW);
        Serial.print(".");
        delay(150);
        rgbAyarla(LOW, LOW, LOW);
        delay(150);
    }
    Serial.println("\n✅ Wi-Fi Bağlantısı Başarılı!");

    config_firebase.api_key = API_KEY;
    config_firebase.database_url = DATABASE_URL;
    Firebase.signUp(&config_firebase, &auth, "", ""); 
    config_firebase.token_status_callback = tokenStatusCallback;
    
    Firebase.begin(&config_firebase, &auth);
    Firebase.reconnectWiFi(true);
    Serial.println("✅ Firebase Bağlantısı Başlatıldı!");

    BLEDevice::init("");
    pBLEScan = BLEDevice::getScan(); 
    pBLEScan->setAdvertisedDeviceCallbacks(new MyAdvertisedDeviceCallbacks());
    pBLEScan->setActiveScan(true); 
    pBLEScan->setInterval(100);
    pBLEScan->setWindow(99); 
    
    sistemHazirAnimasyonu();
    Serial.println("✅ Sistem Tamamen Hazır ve Tarama Yapmaya Başlıyor!\n");
}

void loop() {

    if (Firebase.RTDB.getInt(&fbdo, "/AktifDers/DersKodu")) {
        aktifDersKodu = fbdo.intData();
    }
    if (Firebase.RTDB.getInt(&fbdo, "/AktifDers/OturumNo")) {
        aktifOturumNo = fbdo.intData();
    }

    Serial.println("\n⚡ Durum: Dinleniyor | Ders: " + String(aktifDersKodu) + " | Oturum: #" + String(aktifOturumNo));

    rgbAyarla(LOW, LOW, HIGH);
    BLEScanResults* foundDevices = pBLEScan->start(scanTime, false);
    
    int cihazSayisi = foundDevices->getCount();
    Serial.printf("\nTarama Tamamlandı, Bulunan Cihaz Sayısı: %d\n", cihazSayisi);

    if (aktifDersKodu > 0 && aktifOturumNo > 0) {
        for (int i = 0; i < cihazSayisi; i++) {
            BLEAdvertisedDevice device = foundDevices->getDevice(i);
            
            if (device.haveRSSI()) {
                String deviceMac = device.getAddress().toString().c_str();
                int rssi = device.getRSSI();
                
                String dbPath = "/Yoklamalar/" + String(aktifDersKodu) + "/Oturum_" + String(aktifOturumNo) + "/" + deviceMac;
                
                if (Firebase.RTDB.setInt(&fbdo, dbPath + "/rssi", rssi)) {
                    Serial.printf("✅ Gönderildi: %s | RSSI: %d\n", deviceMac.c_str(), rssi);
                } else {
                    Serial.printf("❌ Hata: %s\n", fbdo.errorReason().c_str());
                }
                
                delay(150); 
            }
        }
    } else {
        Serial.println("⚠️ Aktif ders numarası alınamadı, Firebase'e yazılamıyor.");
    }
    
    pBLEScan->clearResults(); 
    rgbAyarla(LOW, LOW, LOW);
    
    delay(10000);
}