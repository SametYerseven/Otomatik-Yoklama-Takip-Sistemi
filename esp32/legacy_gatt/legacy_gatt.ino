#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <BLEAdvertisedDevice.h>
#include <esp_gap_ble_api.h>
#include <vector>
#include <queue>
#include "config.h"
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// YENİ EKLENEN: RFID Kütüphaneleri
#include <SPI.h>
#include <MFRC522.h>

// ---- BU KARTIN BULUNDUĞU FİZİKSEL SINIFI BURAYA YAZIYORSUN ----
#define THIS_CLASSROOM_NO "203"
// ---------------------------------------------------------------

#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

#define PIN_RED     25
#define PIN_GREEN   26
#define PIN_BLUE    27
#define PIN_BUZZER  13

// YENİ EKLENEN: RFID Pinleri ve Tanımlamaları
#define SS_PIN  5
#define RST_PIN 22
MFRC522 rfid(SS_PIN, RST_PIN);
bool rfidPermission = false; // Firebase'den gelecek izin durumu

// --- TEKİL VE GÜÇLÜ FIREBASE KUYRUĞU ---
struct FirebaseTask {
    uint16_t connId;
    String studentNo;
    String status;
    String macAddress;
    int rssi;
};
std::queue<FirebaseTask> firebaseQueue;

// --- BAĞLANTI TAKİP YAPISI ---
struct StudentConnection {
    uint16_t connId;
    String studentNo;
    String macAddress; 
    bool isRegistered;
};

std::vector<StudentConnection> activeConnections;
uint16_t lastConnId = 0;
bool triggerAdvertising = false;

FirebaseData   fbdo;
FirebaseAuth   auth;
FirebaseConfig config_firebase;

String bleDeviceName = String("yoklama_") + String(THIS_CLASSROOM_NO);
String activeLessonStatus = ""; 
BLEServer* pServer = NULL; 

void setRgb(bool r, bool g, bool b) {
    digitalWrite(PIN_RED,   r);
    digitalWrite(PIN_GREEN, g);
    digitalWrite(PIN_BLUE,  b);
}

int lastReadRssi = -99; 

static void my_gap_event_handler(esp_gap_ble_cb_event_t event, esp_ble_gap_cb_param_t *param) {
    if (event == ESP_GAP_BLE_READ_RSSI_COMPLETE_EVT) {
        int currentRssi = param->read_rssi_cmpl.rssi;
        
        char macStr[18];
        sprintf(macStr, "%02x:%02x:%02x:%02x:%02x:%02x",
                param->read_rssi_cmpl.remote_addr[0], param->read_rssi_cmpl.remote_addr[1],
                param->read_rssi_cmpl.remote_addr[2], param->read_rssi_cmpl.remote_addr[3],
                param->read_rssi_cmpl.remote_addr[4], param->read_rssi_cmpl.remote_addr[5]);
        
        String readMac = String(macStr);

        for (auto& conn : activeConnections) {
            if (conn.macAddress == readMac && conn.isRegistered) {
                firebaseQueue.push({conn.connId, conn.studentNo, "IN_CLASS", conn.macAddress, currentRssi});
                break;
            }
        }
    }
}

class MyServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer* pServer, esp_ble_gatts_cb_param_t* param) {
        uint16_t connId = param->connect.conn_id;
        lastConnId = connId; 
        
        char remoteMac[18];
        sprintf(remoteMac, "%02x:%02x:%02x:%02x:%02x:%02x",
                param->connect.remote_bda[0], param->connect.remote_bda[1],
                param->connect.remote_bda[2], param->connect.remote_bda[3],
                param->connect.remote_bda[4], param->connect.remote_bda[5]);
        
        StudentConnection newConn = {connId, "", String(remoteMac), false};
        activeConnections.push_back(newConn);
        
        triggerAdvertising = true; 
        Serial.println("[BLE] Cihaz bağlandı. MAC: " + String(remoteMac));

        esp_ble_gap_read_rssi(param->connect.remote_bda);
    }

    void onDisconnect(BLEServer* pServer, esp_ble_gatts_cb_param_t* param) {
        uint16_t connId = param->disconnect.conn_id;
        
        for (auto it = activeConnections.begin(); it != activeConnections.end(); ++it) {
            if (it->connId == connId) {
                if (it->studentNo != "") {
                    if (activeLessonStatus != "EXIT") {
                        firebaseQueue.push({it->connId, it->studentNo, "LEFT", it->macAddress, 0});
                    }
                }
                activeConnections.erase(it);
                break;
            }
        }
        triggerAdvertising = true;
        Serial.println("[BLE] Cihaz ayrıldı. ConnID: " + String(connId));
    }
};

class MyCharacteristicCallbacks : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* pCharacteristic) {
        String studentNo = pCharacteristic->getValue();
        studentNo.trim();

        if (studentNo.length() == 0) return;

        bool matched = false;
        for (auto& conn : activeConnections) {
            if (conn.connId == lastConnId && !conn.isRegistered) {
                conn.studentNo = studentNo;
                conn.isRegistered = true;
                
                firebaseQueue.push({conn.connId, studentNo, "IN_CLASS", conn.macAddress, lastReadRssi});
                matched = true;
                break;
            }
        }
        
        if (!matched) {
            for (auto& conn : activeConnections) {
                if (conn.studentNo == "") {
                    conn.studentNo = studentNo;
                    conn.isRegistered = true;
                    firebaseQueue.push({conn.connId, studentNo, "IN_CLASS", conn.macAddress, lastReadRssi});
                    break;
                }
            }
        }
        Serial.println("[CHECK-IN] Numara Alındı: " + studentNo);
    }
};

void setup() {
    Serial.begin(115200);
    pinMode(PIN_RED,     OUTPUT);
    pinMode(PIN_GREEN,   OUTPUT);
    pinMode(PIN_BLUE,    OUTPUT);
    pinMode(PIN_BUZZER,  OUTPUT);
    setRgb(LOW, LOW, LOW);

    // 1. Wi-Fi'ye Bağlanırken: MAVİ LED yanar, 1 Kısa Bip
    setRgb(LOW, LOW, HIGH); 
    tone(PIN_BUZZER, 1000); delay(150); noTone(PIN_BUZZER);
    
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print("."); }
    Serial.println("\nWi-Fi Başarılı!");

    // 2. Firebase'e Bağlanırken: KIRMIZI LED yanar, 1 Kısa Bip
    setRgb(HIGH, LOW, LOW); 
    tone(PIN_BUZZER, 1000); delay(150); noTone(PIN_BUZZER);
    
    config_firebase.api_key      = API_KEY;
    config_firebase.database_url = DATABASE_URL;
    Firebase.signUp(&config_firebase, &auth, "", "");
    Firebase.begin(&config_firebase, &auth);
    Firebase.reconnectWiFi(true);
    Serial.println("Firebase Hazır!");

    // YENİ EKLENEN: SPI ve RFID modülünü başlat
    SPI.begin();
    rfid.PCD_Init();

    BLEDevice::setCustomGapHandler(my_gap_event_handler);
    BLEDevice::init(bleDeviceName.c_str());
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

    // 3. Her Şey Başarılı: YEŞİL LED yanar, 2.5 Saniyelik Uzun Bip
    setRgb(LOW, HIGH, LOW); 
    tone(PIN_BUZZER, 1000); delay(2500); noTone(PIN_BUZZER);

    Serial.println("Sistem Hazır: " + bleDeviceName);
}

void loop() {
    static unsigned long lastStatusCheck = 0;
    
    // Her 3 saniyede bir Firebase'den Sistem durumunu ve RFID İznini kontrol et
    if (millis() - lastStatusCheck > 3000) {
        lastStatusCheck = millis();
        String statusPath = "/System/" + String(THIS_CLASSROOM_NO) + "/status";
        String rfidPermissionPath = "/System/" + String(THIS_CLASSROOM_NO) + "/rfid_permission";
        
        if (Firebase.RTDB.getString(&fbdo, statusPath)) {
            String newStatus = fbdo.stringData();
            if (newStatus == "EXIT" && activeLessonStatus != "EXIT") {
                Serial.println("[SİSTEM] Çıkış emri alındı! Herkes atılıyor.");
                for (auto& conn : activeConnections) {
                    pServer->disconnect(conn.connId); 
                }
            }
            activeLessonStatus = newStatus;
        }

        // YENİ EKLENEN: Web arayüzünden RFID izni gelmiş mi bakıyoruz
        if (Firebase.RTDB.getBool(&fbdo, rfidPermissionPath)) {
            rfidPermission = fbdo.boolData();
        } else {
            rfidPermission = false;
        }
    }

    // YENİ EKLENEN: Eğer hoca izin verdiyse kart okumayı aktifleştir
    if (rfidPermission) {
        if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
            String uidString = "";
            for (byte i = 0; i < rfid.uid.size; i++) {
                uidString += String(rfid.uid.uidByte[i] < 0x10 ? "0" : "");
                uidString += String(rfid.uid.uidByte[i], HEX);
            }
            uidString.toUpperCase();

            // Kart okundu! İki kısa başarılı bip sesi ver.
            tone(PIN_BUZZER, 1500); delay(100); noTone(PIN_BUZZER); delay(100);
            tone(PIN_BUZZER, 1500); delay(100); noTone(PIN_BUZZER);
            
            // Okunan kartın ID'sini hocanın ekranına düşmesi için Firebase'e yolla
            String lastCardPath = "/System/" + String(THIS_CLASSROOM_NO) + "/lastReadCard";
            Firebase.RTDB.setString(&fbdo, lastCardPath, uidString);
            
            Serial.println("[RFID] Kart Okundu: " + uidString);
            
            rfid.PICC_HaltA(); // Aynı kartı peş peşe defalarca okumasını engeller
        }
    }

    if (triggerAdvertising && (activeLessonStatus == "ACTIVE" || activeLessonStatus == "EXIT")) {
        triggerAdvertising = false;
        delay(100);
        BLEDevice::startAdvertising(); 
        setRgb(LOW, HIGH, LOW); 
    }

    static unsigned long lastRssiRequest = 0;
    if (millis() - lastRssiRequest > 2000) {
        lastRssiRequest = millis();
        for (auto& conn : activeConnections) {
            if (conn.isRegistered) {
                 esp_bd_addr_t bda;
                 sscanf(conn.macAddress.c_str(), "%hhx:%hhx:%hhx:%hhx:%hhx:%hhx", 
                         &bda[0], &bda[1], &bda[2], &bda[3], &bda[4], &bda[5]);
                 esp_ble_gap_read_rssi(bda);
            }
        }
    }

    if (!firebaseQueue.empty()) {
        FirebaseTask task = firebaseQueue.front();
        firebaseQueue.pop();
        
        String dbPath = "/Presence/" + String(THIS_CLASSROOM_NO) + "/" + task.studentNo;
        
        FirebaseJson json;
        json.set("status", task.status);
        if (task.status == "IN_CLASS") {
            json.set("mac", task.macAddress); 
            json.set("rssi", task.rssi); 
        }

        if (Firebase.RTDB.setJSON(&fbdo, dbPath, &json)) {
            static String lastLoggedNo = "";
            if (task.studentNo != lastLoggedNo) {
                 Serial.println("[Firebase] Girdi/Çıktı Güncellendi: " + task.studentNo);
                 lastLoggedNo = task.studentNo;
            }
            
            if (task.status == "IN_CLASS" && activeLessonStatus == "EXIT") {
                delay(250); 
                pServer->disconnect(task.connId);
                Serial.println("[ÇIKIŞ YOKLAMASI] Öğrenci onaylandı ve atıldı.");
            } 
        }
    }
    delay(20);
}