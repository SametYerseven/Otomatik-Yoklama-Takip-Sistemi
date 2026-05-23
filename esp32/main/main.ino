#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <BLEAdvertisedDevice.h>
#include "config.h"
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// ---- BU KARTIN BULUNDUĞU FİZİKSEL SINIFI BURAYA YAZIYORSUN ----
#define BU_SINIF_NO "203" 
// ---------------------------------------------------------------

// --- BLE SERVER UUID AYARLARI ---
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

// --- PİN TANIMLAMALARI ---
#define PIN_KIRMIZI 25
#define PIN_YESIL   26
#define PIN_MAVI    27
#define PIN_BUZZER  13

// --- GLOBAL DEĞİŞKENLER (Silinen veya yeri kayan kısım burasıydı) ---
uint16_t aktifDersKodu  = 0;
uint8_t  aktifOturumNo  = 0;
int      scanTime       = 5;
unsigned long taramaID  = 0;

BLEScan*           pBLEScan        = NULL;
BLEServer*         pServer         = NULL;
BLECharacteristic* pCharacteristic = NULL;

FirebaseData   fbdo;
FirebaseAuth   auth;
FirebaseConfig config_firebase;

bool     deviceConnected     = false;
String   currentConnectedMAC = "";
uint16_t currentConnId       = 0;

// Dinamik BLE Cihaz Adı Oluşturma
String bleCihazAdi = String("yoklama_") + String(BU_SINIF_NO);

// --- RGB LED KONTROL FONKSİYONU ---
void rgbAyarla(bool kirmiziDurum, bool yesilDurum, bool maviDurum) {
    digitalWrite(PIN_KIRMIZI, kirmiziDurum);
    digitalWrite(PIN_YESIL,   yesilDurum);
    digitalWrite(PIN_MAVI,    maviDurum);
}

// --- BLE SUNUCU GERİ ÇAĞIRMALARI (CALLBACKS) ---
class MyServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer* pServer, esp_ble_gatts_cb_param_t* param) {
        deviceConnected = true;
        currentConnId = param->connect.conn_id;

        char remoteMac[18];
        sprintf(remoteMac, "%02x:%02x:%02x:%02x:%02x:%02x",
                param->connect.remote_bda[0], param->connect.remote_bda[1],
                param->connect.remote_bda[2], param->connect.remote_bda[3],
                param->connect.remote_bda[4], param->connect.remote_bda[5]);
        currentConnectedMAC = String(remoteMac);

        Serial.println("\n[BLE] Cihaz Baglandi! MAC: " + currentConnectedMAC);
        rgbAyarla(LOW, HIGH, LOW);
    }

    void onDisconnect(BLEServer* pServer) {
        deviceConnected     = false;
        currentConnectedMAC = "";
        currentConnId       = 0;
        Serial.println("[BLE] Cihaz Baglantisi Kesildi.");
        rgbAyarla(LOW, LOW, LOW);
        BLEDevice::startAdvertising();
    }
};

// --- BLE KARAKTERİSTİK GERİ ÇAĞIRMALARI (ÖĞRENCİ NUMARASI YAZMA) ---
class MyCharacteristicCallbacks : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* pCharacteristic) {
        String value = pCharacteristic->getValue();

        if (value.length() > 0 && currentConnectedMAC != "") {
            String ogrenciNo = value;
            ogrenciNo.trim();
            Serial.println("[CHECK-IN] Gelen Ogrenci No: " + ogrenciNo);

            // Web arayüzünün beklediği dinamik veritabanı yolu
            String dbPath = "/Eslestirmeler/" + String(BU_SINIF_NO) + "/" + currentConnectedMAC;

            if (Firebase.RTDB.setString(&fbdo, dbPath, ogrenciNo)) {
                Serial.println("OK Eslestirme yazildi: " + currentConnectedMAC + " -> " + ogrenciNo);
                tone(PIN_BUZZER, 880, 200);
            } else {
                Serial.println("HATA Firebase: " + fbdo.errorReason());
                tone(PIN_BUZZER, 220, 500);
            }

            delay(100);
            pServer->disconnect(currentConnId);
        }
    }
};

// =======================================================
// SETUP (KURULUM)
// =======================================================
void setup() {
    Serial.begin(115200);
    pinMode(PIN_KIRMIZI, OUTPUT);
    pinMode(PIN_YESIL,   OUTPUT);
    pinMode(PIN_MAVI,    OUTPUT);
    pinMode(PIN_BUZZER,  OUTPUT);
    rgbAyarla(LOW, LOW, LOW);

    // 1. Wi-Fi Bağlantısı
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print("."); }
    Serial.println("\nWi-Fi OK!");

    // 2. Firebase Kurulumu
    config_firebase.api_key      = API_KEY;
    config_firebase.database_url = DATABASE_URL;
    Firebase.signUp(&config_firebase, &auth, "", "");
    Firebase.begin(&config_firebase, &auth);
    Firebase.reconnectWiFi(true);
    Serial.println("Firebase Hazir!");

    // 3. BLE Sunucu Kurulumu (DİNAMİK İSİMLE BAŞLATILIR)
    Serial.println("BLE Baslatiliyor. Cihaz Adi: " + bleCihazAdi);
    BLEDevice::init(bleCihazAdi.c_str()); 
    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new MyServerCallbacks());

    BLEService* pService = pServer->createService(SERVICE_UUID);
    pCharacteristic = pService->createCharacteristic(
                        CHARACTERISTIC_UUID,
                        BLECharacteristic::PROPERTY_WRITE);
    pCharacteristic->setCallbacks(new MyCharacteristicCallbacks());
    pService->start();

    BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06);
    BLEDevice::startAdvertising();

    // 4. BLE Tarayıcı Kurulumu
    pBLEScan = BLEDevice::getScan();
    pBLEScan->setActiveScan(true);
    pBLEScan->setInterval(100);
    pBLEScan->setWindow(99);

    Serial.println("Sistem Hazir: " + bleCihazAdi + " Yayin Yapiyor ve Tarama Bekliyor.");
}

// =======================================================
// LOOP (ANA DÖNGÜ)
// =======================================================
void loop() {
    // Sadece web arayüzünden bu sınıfa (Örn: /Sistem/203/durum) "AKTIF" emri gelirse tarama yap
    String sistemPath = "/Sistem/" + String(BU_SINIF_NO) + "/durum";
    if (Firebase.RTDB.getString(&fbdo, sistemPath)) {
        String durum = fbdo.stringData();
        if (durum != "AKTIF") {
            // Öğretmen web'den dersi başlatmadıysa tarama yapma, enerjiden tasarruf et
            delay(2000);
            return; 
        }
    }

    // Bir öğrenci bağlanma aşamasındaysa taramayı durdur ve bitmesini bekle
    if (deviceConnected) {
        delay(500);
        return;
    }

    // --- BLE TARAMA İŞLEMİ ---
    taramaID++;
    rgbAyarla(LOW, LOW, HIGH); // Tarama yaparken Mavi LED yanar

    // Tarama ID'yi sadece bu sınıf için Web'e bildir (Ghost öğrenci engellemesi)
    Firebase.RTDB.setInt(&fbdo, "/Sistem/" + String(BU_SINIF_NO) + "/TaramaID", taramaID);

    BLEScanResults* foundDevices = pBLEScan->start(scanTime, false);
    int cihazSayisi = foundDevices->getCount();

    for (int i = 0; i < cihazSayisi; i++) {
        BLEAdvertisedDevice device = foundDevices->getDevice(i);
        if (device.haveRSSI()) {
            String deviceMac = device.getAddress().toString().c_str();
            int    rssi      = device.getRSSI();
            
            // Bulunan cihazların RSSI değerlerini sınıfın kendi düğümüne kaydet
            String dbPath    = "/Yoklamalar/" + String(BU_SINIF_NO) + "/" + deviceMac;

            Firebase.RTDB.setInt(&fbdo, dbPath + "/rssi",     rssi);
            Firebase.RTDB.setInt(&fbdo, dbPath + "/taramaID", taramaID);
        }
    }

    pBLEScan->clearResults();

    rgbAyarla(LOW, LOW, LOW); // Tarama bitti LED'i söndür
    delay(5000); // 5 saniye mola
}