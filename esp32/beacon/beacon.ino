/*
 * ASAMA 3 - ESP32 iBeacon, donen sinif kodu
 * ------------------------------------------
 * ESP32 bir iBeacon gibi baglantisiz yayin yapar (docs/protocol.md bolum 3):
 *   major = derslik numarasi (config.h)
 *   minor = sinif kodu C, her 30 sn'lik dilimde yeniden hesaplanir:
 *     T     = floor(unix_saniye / 30)                      (UTC, DS3231'den)
 *     msg_c = "CLS" || major (2 bayt) || T (8 bayt)         (13 bayt, big-endian)
 *     C     = HMAC-SHA256(sinif_anahtari, msg_c) ilk 2 bayti (0..65535)
 * Sunucu (functions/codes.js) ve test vektorleri ayni hesabi yapar.
 * ESP32 internete baglanmaz; zamani pilli DS3231 saat modulunden okur.
 *
 * GEREKENLER
 *   - DS3231: VCC->3V3, GND->GND, SDA->D21, SCL->D22 (ds3231.h)
 *   - config.h: config_example.h'tan kopyala (derslik numarasi + sinif anahtari)
 *   - Saat ayarli olmali. Ayarlamak icin Serial Monitor KAPALIYKEN proje kokunde:
 *       powershell -ExecutionPolicy Bypass -File esp32\rtc_test\set_time.ps1 -Port COM4
 *
 * Saat ayarli degilse ya da DS3231 okunamazsa YAYIN YAPILMAZ: yanlis kod yayinlamak
 * telefonlarin bosuna sunucu cagirmasina yol acar. Serial Monitor'de hata yazar.
 *
 * Yayin paketi elle (byte byte) olusturuluyor. Boylece kutuphane
 * surumune bagli byte sirasi (endianness) hatalari yasanmiyor.
 */

#include <BLEDevice.h>
#include <esp_gap_ble_api.h>
#include "mbedtls/md.h"
#include "config.h"
#include "ds3231.h"

// ---------------------------------------------------------------
// AYARLAR (derslige ozel olanlar config.h'ta)
// ---------------------------------------------------------------

// Projeye ozel UUID. Tum sinif ESP32'leri AYNI UUID'yi kullanir;
// siniflar MAJOR degeriyle ayrilir. Telefon uygulamasi bu UUID'yi dinler.
// Metin hali: 6f1d3b2a-8c4e-4a7f-9b21-5d3e8a9c0f47
static const uint8_t BEACON_UUID[16] = {
  0x6f, 0x1d, 0x3b, 0x2a,  0x8c, 0x4e,  0x4a, 0x7f,
  0x9b, 0x21,  0x5d, 0x3e, 0x8a, 0x9c, 0x0f, 0x47
};

const int8_t   TX_POWER_1M  = -59;   // 1 metredeki beklenen RSSI (mesafe tahmini icin)

// Yayin araligi: 0xA0 = 160 x 0.625 ms = 100 ms
// (iPhone'un hizli algilamasi icin onerilen deger; ESP32 prize takili oldugu icin pil sorunu yok)
const uint16_t ADVERTISING_INTERVAL = 0xA0;

const uint32_t SLOT_SECONDS   = 30;
const uint32_t MIN_VALID_UNIX = 1767225600UL;   // 2026-01-01: bundan eskiyse saat ayarli degil

// Protokol test anahtari (00 01 ... 1f, docs/protocol.md bolum 11). Sadece acilistaki
// oz-test icin; config.h'taki anahtar bununla ayniysa uyari yazilir.
static const uint8_t TEST_KEY[32] = {
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
  0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
  0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f
};

// ---------------------------------------------------------------

uint8_t advertisingPacket[30];
bool advertising = false;
uint32_t currentSlot = 0;

void buildIBeaconPacket(uint16_t major, uint16_t minor) {
  uint8_t i = 0;

  // 1) Flags: "BLE genel kesfedilebilir, klasik Bluetooth yok"
  advertisingPacket[i++] = 0x02;  // uzunluk
  advertisingPacket[i++] = 0x01;  // tip: Flags
  advertisingPacket[i++] = 0x06;

  // 2) Manufacturer Specific Data (iBeacon formati)
  advertisingPacket[i++] = 0x1A;  // uzunluk: sonraki 26 byte (tip + 25 byte veri)
  advertisingPacket[i++] = 0xFF;  // tip: Manufacturer Specific Data
  advertisingPacket[i++] = 0x4C;  // Apple sirket kodu (0x004C), little-endian
  advertisingPacket[i++] = 0x00;
  advertisingPacket[i++] = 0x02;  // iBeacon tipi
  advertisingPacket[i++] = 0x15;  // kalan veri uzunlugu: 21 byte

  memcpy(&advertisingPacket[i], BEACON_UUID, 16);   // 16 byte UUID
  i += 16;

  advertisingPacket[i++] = major >> 8;     // Major (big-endian)
  advertisingPacket[i++] = major & 0xFF;
  advertisingPacket[i++] = minor >> 8;     // Minor (big-endian)
  advertisingPacket[i++] = minor & 0xFF;
  advertisingPacket[i++] = (uint8_t)TX_POWER_1M;
  // Toplam: 3 + 27 = 30 byte (BLE yayin siniri 31 byte)
}

// ---------------------------------------------------------------
// Sinif kodu C (docs/protocol.md bolum 3)
// ---------------------------------------------------------------

// Hesaplanamazsa false (mbedtls hatasi; normalde olmaz).
bool classCode(const uint8_t key[32], uint16_t major, uint64_t slot, uint16_t &code) {
  uint8_t msg[13];
  msg[0] = 'C';
  msg[1] = 'L';
  msg[2] = 'S';
  msg[3] = major >> 8;
  msg[4] = major & 0xFF;
  for (int i = 0; i < 8; i++) {
    msg[5 + i] = (uint8_t)(slot >> (56 - 8 * i));   // T, 8 bayt big-endian
  }
  uint8_t h[32];
  const mbedtls_md_info_t *sha256 = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (sha256 == nullptr || mbedtls_md_hmac(sha256, key, 32, msg, sizeof(msg), h) != 0) {
    return false;
  }
  code = ((uint16_t)h[0] << 8) | h[1];
  return true;
}

// Acilista protokol test vektorleriyle kontrol: ESP32 sunucuyla ayni kodu uretiyor mu?
bool selfTest() {
  const uint64_t T = 1795528800ULL / SLOT_SECONDS;   // 59850960
  uint16_t c0, cPrev, cNext;
  bool ok = T == 59850960ULL &&
            classCode(TEST_KEY, 203, T, c0) && c0 == 10803 &&
            classCode(TEST_KEY, 203, T - 1, cPrev) && cPrev == 8513 &&
            classCode(TEST_KEY, 203, T + 1, cNext) && cNext == 58728;
  Serial.println(ok ? "Sinif kodu testi (protokol test vektorleri): TAMAM"
                    : "Sinif kodu testi: HATA - ESP32 sunucuyla ayni kodu uretmiyor, yayin yapilmayacak");
  return ok;
}

// ---------------------------------------------------------------
// Yayin
// ---------------------------------------------------------------

void startAdvertising() {
  esp_ble_adv_params_t advertisingParams = {};
  advertisingParams.adv_int_min       = ADVERTISING_INTERVAL;
  advertisingParams.adv_int_max       = ADVERTISING_INTERVAL;
  advertisingParams.adv_type          = ADV_TYPE_NONCONN_IND;  // baglanti kabul ETMEZ, sadece yayin
  advertisingParams.own_addr_type     = BLE_ADDR_TYPE_PUBLIC;
  advertisingParams.channel_map       = ADV_CHNL_ALL;
  advertisingParams.adv_filter_policy = ADV_FILTER_ALLOW_SCAN_ANY_CON_ANY;

  esp_err_t result = esp_ble_gap_start_advertising(&advertisingParams);
  if (result == ESP_OK) {
    advertising = true;
    Serial.println("Yayin basladi.");
  } else {
    Serial.printf("HATA: Yayin baslatilamadi (kod %d)\n", result);
  }
}

void stopAdvertising() {
  esp_ble_gap_stop_advertising();
  advertising = false;
  Serial.println("Yayin durduruldu.");
}

// Yeni dilimin kodunu yayin paketine koyar. Yayin acikken de guncellenebilir
// (BLE standardi yayin surerken veri degistirmeye izin veriyor).
bool publishSlot(uint32_t unix) {
  uint32_t slot = unix / SLOT_SECONDS;
  uint16_t code;
  if (!classCode(ROOM_KEY, CLASSROOM_MAJOR, slot, code)) {
    Serial.println("HATA: Sinif kodu hesaplanamadi.");
    return false;
  }
  buildIBeaconPacket(CLASSROOM_MAJOR, code);
  esp_ble_gap_config_adv_data_raw(advertisingPacket, sizeof(advertisingPacket));
  if (!advertising) {
    delay(100);  // ilk paketin yigina islenmesi icin kisa bekleme
    startAdvertising();
  }
  currentSlot = slot;

  char timeText[24];
  rtc::formatTime(unix, timeText, sizeof(timeText));
  Serial.printf("%s UTC | derslik %u | dilim T=%lu | sinif kodu C=%u\n",
                timeText, CLASSROOM_MAJOR, (unsigned long)slot, code);
  return true;
}

// ---------------------------------------------------------------
// Serial'den saat ayari: "T1795528800" (set_time.ps1 bunu gonderir)
// ---------------------------------------------------------------

void handleSerial() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c != '\n') {
      if (line.length() < 32) line += c;
      continue;
    }
    line.trim();
    if (line.length() > 1 && (line[0] == 'T' || line[0] == 't')) {
      uint32_t unix = strtoul(line.c_str() + 1, nullptr, 10);
      if (unix >= MIN_VALID_UNIX && rtc::writeUnix(unix)) {
        char timeText[24];
        rtc::formatTime(unix, timeText, sizeof(timeText));
        Serial.printf("Saat ayarlandi: %s UTC\n", timeText);
        currentSlot = 0;   // kodu hemen yeniden hesapla
      } else {
        Serial.println("HATA: Gecersiz zaman ya da DS3231'e yazilamadi. Ornek: T1795528800");
      }
    }
    line = "";
  }
}

// ---------------------------------------------------------------

bool codeOk = false;

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== ESP32 iBeacon - donen sinif kodu ===");
  Serial.println("UUID : 6f1d3b2a-8c4e-4a7f-9b21-5d3e8a9c0f47");
  Serial.printf ("Major: %u  (derslik)\n", CLASSROOM_MAJOR);

  codeOk = selfTest();
  if (memcmp(ROOM_KEY, TEST_KEY, sizeof(TEST_KEY)) == 0) {
    Serial.println("UYARI: config.h'ta TEST anahtari var. Gelistirme icin uygun, gercek derslikte kullanma.");
  }

  if (rtc::begin()) {
    Serial.println("DS3231 bulundu.");
  } else {
    Serial.println("HATA: DS3231 bulunamadi. Kablolar: VCC->3V3, GND->GND, SDA->D21, SCL->D22");
  }

  // Bluetooth yigini baslat (cihaz adi yayinda gorunmez, sadece ic kullanim)
  BLEDevice::init("yoklama_beacon");
}

void loop() {
  handleSerial();

  if (!codeOk) {        // kod hesabi yanlissa hic yayin yapma
    delay(1000);
    return;
  }

  uint32_t unix = 0;
  bool timeOk = rtc::readUnix(unix) && !rtc::oscillatorStopped() && unix >= MIN_VALID_UNIX;
  if (!timeOk) {
    if (advertising) stopAdvertising();
    static unsigned long lastWarning = 0;
    if (lastWarning == 0 || millis() - lastWarning > 5000) {
      Serial.println("HATA: Saat okunamadi ya da ayarli degil; yayin yapilmiyor. set_time.ps1 ile ayarla.");
      lastWarning = millis();
    }
    delay(200);
    return;
  }

  uint32_t slot = unix / SLOT_SECONDS;
  if (!advertising || slot != currentSlot) {
    publishSlot(unix);
  }
  delay(200);
}
