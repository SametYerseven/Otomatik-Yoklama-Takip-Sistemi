#include <SPI.h>
#include <MFRC522.h>

// --- YENİ DONANIM PİN TANIMLAMALARI ---
#define SS_PIN 5
#define RST_PIN 22
#define SCK_PIN 25
#define MISO_PIN 26
#define MOSI_PIN 27

// Nesne yönelimli RFID nesnesi
MFRC522 mfrc522(SS_PIN, RST_PIN);

void setup() {
    Serial.begin(115200);

    // KRİTİK EKLENTİ: SPI donanımını yeni pinlerimize yönlendirerek başlatıyoruz
    // Parametre Sırası: SCK, MISO, MOSI, SS
    SPI.begin(SCK_PIN, MISO_PIN, MOSI_PIN, SS_PIN);

    // RC522 modülünü başlat
    mfrc522.PCD_Init();
    
    // Modülün anten gücünü maksimum seviyeye ayarlıyoruz
    mfrc522.PCD_SetAntennaGain(mfrc522.RxGain_max);

    Serial.println("\n--- YENİ PİNLERLE RFID Teşhis Sistemi Başlatıldı ---");

    // MISO hattının yeni pin üzerinden çalışıp çalışmadığını denetler
    Serial.print("Modül Firmware Versiyonu: ");
    mfrc522.PCD_DumpVersionToSerial();
    
    Serial.println("--------------------------------------------------");
    Serial.println("Lütfen bir RFID kartını veya anahtarlığı okutun...");
}

void loop() {
    if ( ! mfrc522.PICC_IsNewCardPresent()) {
        return;
    }

    if ( ! mfrc522.PICC_ReadCardSerial()) {
        return;
    }

    Serial.print("✅ Kart Okundu! UID Değeri: ");
    String rfidUid = "";

    for (byte i = 0; i < mfrc522.uid.size; i++) {
        rfidUid += String(mfrc522.uid.uidByte[i] < 0x10 ? " 0" : " ");
        rfidUid += String(mfrc522.uid.uidByte[i], HEX);
    }

    rfidUid.toUpperCase();
    Serial.println(rfidUid);

    delay(2000); 
}