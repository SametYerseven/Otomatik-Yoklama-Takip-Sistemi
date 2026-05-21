#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLEAdvertising.h>
#include "config.h"


#define BEACON_UUID  "87b99b2c-9069-4a45-b2a5-ec0f6b5c8d4a"
#define TX_POWER     -59


uint16_t aktifDersKodu  = 3114;
uint8_t  aktifOturumNo  = 1;


BLEAdvertising* pAdvertising;

void iBeaconYayinGuncelle(uint16_t major, uint16_t minor) {
    
    pAdvertising->stop();

    BLEUUID uuid(BEACON_UUID);
    uint8_t* uuidBytes = uuid.getNative()->uuid.uuid128;

    uint8_t beaconData[26] = {
        0x4C, 0x00,  
        0x02, 0x15,   

        uuidBytes[15], uuidBytes[14], uuidBytes[13], uuidBytes[12],
        uuidBytes[11], uuidBytes[10], uuidBytes[9],  uuidBytes[8],
        uuidBytes[7],  uuidBytes[6],  uuidBytes[5],  uuidBytes[4],
        uuidBytes[3],  uuidBytes[2],  uuidBytes[1],  uuidBytes[0],

        (uint8_t)(major >> 8), (uint8_t)(major & 0xFF),

        (uint8_t)(minor >> 8), (uint8_t)(minor & 0xFF),

        (uint8_t)TX_POWER
    };

    BLEAdvertisementData oAdvertisementData;
    oAdvertisementData.setFlags(0x04);
    
    oAdvertisementData.setManufacturerData(String((char*)beaconData, 26));

    pAdvertising->setAdvertisementData(oAdvertisementData);
    pAdvertising->start();

    Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    Serial.println("Beacon Güncellendi");
    Serial.print("   Ders Kodu : "); Serial.println(major);
    Serial.print("   Oturum No : "); Serial.println(minor);
    Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

void setup() {
    Serial.begin(115200);
    Serial.println("\n ESP32 Sınıf Yoklama Sistemi Başlatılıyor...");
    Serial.println("   Bu ESP32 bu sınıfa aittir.");
    Serial.println("   Dersler Firebase'den otomatik alınacak.\n");

    BLEDevice::init("ESP32-Sinif-301"); 
    pAdvertising = BLEDevice::getAdvertising();

    iBeaconYayinGuncelle(aktifDersKodu, aktifOturumNo);
    
    Serial.println("✅ Sistem Hazır!\n");
}

void loop() {

    
    delay(10000);
    Serial.println("💓 Sistem çalışıyor | Ders: " + 
                   String(aktifDersKodu) + 
                   " | Oturum: #" + String(aktifOturumNo));
}