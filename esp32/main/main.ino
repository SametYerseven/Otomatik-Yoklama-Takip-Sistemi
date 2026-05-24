#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <BLEAdvertisedDevice.h>
#include <esp_gap_ble_api.h> // YENİ: Sinyal gücünü (RSSI) donanımsal okumak için eklendi
#include <vector>
#include <queue>
#include "config.h"
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// ---- BU KARTIN BULUNDUĞU FİZİKSEL SINIFI BURAYA YAZIYORSUN ----
#define BU_SINIF_NO "203"
// ---------------------------------------------------------------

#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

#define PIN_KIRMIZI 25
#define PIN_YESIL   26
#define PIN_MAVI    27
#define PIN_BUZZER  13

// --- TEKİL VE GÜÇLÜ FIREBASE KUYRUĞU ---
struct FirebaseGorev {
    uint16_t connId;
    String ogrenciNo;
    String durum;
    String macAdresi;
    int rssi; // YENİ: Öğrencinin anlık sinyal gücünü Firebase'e taşımak için eklendi
};
std::queue<FirebaseGorev> firebaseKuyrugu;

// --- BAĞLANTI TAKİP YAPISI ---
struct OgrenciBaglanti {
    uint16_t connId;
    String ogrenciNo;
    String macAdresi; 
    bool tescilEdildi;
};

std::vector<OgrenciBaglanti> aktifBaglantilar;
uint16_t sonGelenConnId = 0;
bool reklamTetikle = false;

FirebaseData   fbdo;
FirebaseAuth   auth;
FirebaseConfig config_firebase;

String bleCihazAdi = String("yoklama_") + String(BU_SINIF_NO);
String aktifDersDurumu = ""; 
BLEServer* pServer = NULL; 

void rgbAyarla(bool k, bool y, bool m) {
    digitalWrite(PIN_KIRMIZI, k);
    digitalWrite(PIN_YESIL,   y);
    digitalWrite(PIN_MAVI,    m);
}

// YENİ: Sinyal gücünü geçici olarak tutacağımız global değişken
int sonOkunanRssi = -99; 

// YENİ: ESP32'nin donanımsal Bluetooth olaylarını (Event) yakalayan fonksiyon
// YENİ: Donanımsal Olay Yakalayıcı (Otomatik RSSI Güncelleyici)
static void my_gap_event_handler(esp_gap_ble_cb_event_t event, esp_ble_gap_cb_param_t *param) {
    if (event == ESP_GAP_BLE_READ_RSSI_COMPLETE_EVT) {
        int anlikRssi = param->read_rssi_cmpl.rssi;
        
        // Bu sinyalin hangi MAC adresinden geldiğini bul
        char macStr[18];
        sprintf(macStr, "%02x:%02x:%02x:%02x:%02x:%02x",
                param->read_rssi_cmpl.remote_addr[0], param->read_rssi_cmpl.remote_addr[1],
                param->read_rssi_cmpl.remote_addr[2], param->read_rssi_cmpl.remote_addr[3],
                param->read_rssi_cmpl.remote_addr[4], param->read_rssi_cmpl.remote_addr[5]);
        
        String okunanMac = String(macStr);

        // Aktif bağlantılardan bu kişiyi bul ve anlık RSSI'ını Firebase kuyruğuna at
        for (auto& bag : aktifBaglantilar) {
            if (bag.macAdresi == okunanMac && bag.tescilEdildi) {
                firebaseKuyrugu.push({bag.connId, bag.ogrenciNo, "SINIFTA", bag.macAdresi, anlikRssi});
                break;
            }
        }
    }
}

// =======================================================
// BLE SUNUCU GERİ ÇAĞIRMALARI
// =======================================================
class MyServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer* pServer, esp_ble_gatts_cb_param_t* param) {
        uint16_t connId = param->connect.conn_id;
        sonGelenConnId = connId; 
        
        char remoteMac[18];
        sprintf(remoteMac, "%02x:%02x:%02x:%02x:%02x:%02x",
                param->connect.remote_bda[0], param->connect.remote_bda[1],
                param->connect.remote_bda[2], param->connect.remote_bda[3],
                param->connect.remote_bda[4], param->connect.remote_bda[5]);
        
        OgrenciBaglanti ob = {connId, "", String(remoteMac), false};
        aktifBaglantilar.push_back(ob);
        
        reklamTetikle = true; 
        Serial.println("[BLE] Cihaz bağlandı. MAC: " + String(remoteMac));

        // YENİ: Cihaz bağlandığı an, ESP32 çipine sinyal gücünü ölçmesi için emir veriyoruz!
        esp_ble_gap_read_rssi(param->connect.remote_bda);
    }

    void onDisconnect(BLEServer* pServer, esp_ble_gatts_cb_param_t* param) {
        uint16_t connId = param->disconnect.conn_id;
        
        for (auto it = aktifBaglantilar.begin(); it != aktifBaglantilar.end(); ++it) {
            if (it->connId == connId) {
                if (it->ogrenciNo != "") {
                    if (aktifDersDurumu != "CIKIS") {
                        // Çıkışta değilken koparsa, RSSI olarak 0 gönderiyoruz (Koptu anlamında)
                        firebaseKuyrugu.push({it->connId, it->ogrenciNo, "AYRILDI", it->macAdresi, 0});
                    }
                }
                aktifBaglantilar.erase(it);
                break;
            }
        }
        reklamTetikle = true;
        Serial.println("[BLE] Cihaz ayrıldı. ConnID: " + String(connId));
    }
};

// =======================================================
// KARAKTERİSTİK YAZMA (Öğrenci Numarası Geldiğinde)
// =======================================================
class MyCharacteristicCallbacks : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* pCharacteristic) {
        String ogrenciNo = pCharacteristic->getValue();
        ogrenciNo.trim();

        if (ogrenciNo.length() == 0) return;

        bool eslesti = false;
        for (auto& bag : aktifBaglantilar) {
            if (bag.connId == sonGelenConnId && !bag.tescilEdildi) {
                bag.ogrenciNo = ogrenciNo;
                bag.tescilEdildi = true;
                
                // YENİ: Öğrenci numarasını Firebase'e yollarken "sonOkunanRssi" değerini de ekliyoruz
                firebaseKuyrugu.push({bag.connId, ogrenciNo, "SINIFTA", bag.macAdresi, sonOkunanRssi});
                eslesti = true;
                break;
            }
        }
        
        if (!eslesti) {
            for (auto& bag : aktifBaglantilar) {
                if (bag.ogrenciNo == "") {
                    bag.ogrenciNo = ogrenciNo;
                    bag.tescilEdildi = true;
                    firebaseKuyrugu.push({bag.connId, ogrenciNo, "SINIFTA", bag.macAdresi, sonOkunanRssi});
                    break;
                }
            }
        }
        Serial.println("[CHECK-IN] Numara Alındı: " + ogrenciNo);
    }
};

// =======================================================
// SETUP 
// =======================================================
void setup() {
    Serial.begin(115200);
    pinMode(PIN_KIRMIZI, OUTPUT);
    pinMode(PIN_YESIL,   OUTPUT);
    pinMode(PIN_MAVI,    OUTPUT);
    pinMode(PIN_BUZZER,  OUTPUT);
    rgbAyarla(LOW, LOW, LOW);

    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print("."); }
    Serial.println("\nWi-Fi Başarılı!");

    config_firebase.api_key      = API_KEY;
    config_firebase.database_url = DATABASE_URL;
    Firebase.signUp(&config_firebase, &auth, "", "");
    Firebase.begin(&config_firebase, &auth);
    Firebase.reconnectWiFi(true);
    Serial.println("Firebase Hazır!");

    // YENİ: GAP (Generic Access Profile) Olay Dinleyicisini sisteme tanıtıyoruz
    BLEDevice::setCustomGapHandler(my_gap_event_handler);

    BLEDevice::init(bleCihazAdi.c_str());
    BLEDevice::setMTU(23);

    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new MyServerCallbacks());

    BLEService* pService = pServer->createService(SERVICE_UUID);
    BLECharacteristic* pChar = pService->createCharacteristic(
        CHARACTERISTIC_UUID,
        BLECharacteristic::PROPERTY_WRITE
    );
    pChar->setCallbacks(new MyCharacteristicCallbacks());
    pService->start();

    BLEAdvertising* pAdv = BLEDevice::getAdvertising();
    pAdv->addServiceUUID(SERVICE_UUID);
    pAdv->setScanResponse(true);
    BLEDevice::startAdvertising();

    Serial.println("Sistem Hazır: " + bleCihazAdi);
}

// =======================================================
// LOOP (ANA DÖNGÜ)
// =======================================================
void loop() {
    static unsigned long sonDurumKontrol = 0;
    if (millis() - sonDurumKontrol > 3000) {
        sonDurumKontrol = millis();
        String sistemPath = "/Sistem/" + String(BU_SINIF_NO) + "/durum";
        
        if (Firebase.RTDB.getString(&fbdo, sistemPath)) {
            String yeniDurum = fbdo.stringData();
            if (yeniDurum == "CIKIS" && aktifDersDurumu != "CIKIS") {
                Serial.println("[SİSTEM] Çıkış emri alındı! Herkes atılıyor.");
                for (auto& bag : aktifBaglantilar) {
                    pServer->disconnect(bag.connId); 
                }
            }
            aktifDersDurumu = yeniDurum;
        }
    }

    if (reklamTetikle && (aktifDersDurumu == "AKTIF" || aktifDersDurumu == "CIKIS")) {
        reklamTetikle = false;
        delay(100);
        BLEDevice::startAdvertising(); 
        if (aktifBaglantilar.size() > 0) rgbAyarla(LOW, HIGH, LOW); 
        else rgbAyarla(LOW, LOW, LOW);
    }

    // YENİ: Her 2 saniyede bir bağlı olan herkesin sinyal gücünü (RSSI) donanımdan iste
    static unsigned long sonRssiIstegi = 0;
    if (millis() - sonRssiIstegi > 2000) {
        sonRssiIstegi = millis();
        for (auto& bag : aktifBaglantilar) {
            if (bag.tescilEdildi) {
                 esp_bd_addr_t bda;
                 sscanf(bag.macAdresi.c_str(), "%hhx:%hhx:%hhx:%hhx:%hhx:%hhx", 
                        &bda[0], &bda[1], &bda[2], &bda[3], &bda[4], &bda[5]);
                 esp_ble_gap_read_rssi(bda);
            }
        }
    }

    // JSON Formatında Firebase Güncellemesi
    if (!firebaseKuyrugu.empty()) {
        FirebaseGorev gorev = firebaseKuyrugu.front();
        firebaseKuyrugu.pop();
        
        String dbPath = "/Varlik/" + String(BU_SINIF_NO) + "/" + gorev.ogrenciNo;
        
        FirebaseJson json;
        json.set("durum", gorev.durum);
        if (gorev.durum == "SINIFTA") {
            json.set("mac", gorev.macAdresi); 
            json.set("rssi", gorev.rssi); 
        }

        if (Firebase.RTDB.setJSON(&fbdo, dbPath, &json)) {
            // Log ekranını çok doldurmamak için sadece durumu değişenleri (veya ilk girişi) sesli uyar
            static String sonLoglananNo = "";
            if (gorev.ogrenciNo != sonLoglananNo) {
                 Serial.println("[Firebase] Girdi/Çıktı Güncellendi: " + gorev.ogrenciNo);
                 sonLoglananNo = gorev.ogrenciNo;
            }
            
            if (gorev.durum == "SINIFTA" && aktifDersDurumu == "CIKIS") {
                delay(250); 
                pServer->disconnect(gorev.connId);
                Serial.println("[ÇIKIŞ YOKLAMASI] Öğrenci onaylandı ve atıldı.");
            } 
        }
    }
    delay(20);
}