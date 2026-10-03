/*
 * ASAMA 1 - ESP32 iBeacon Yayin Testi
 * ------------------------------------
 * ESP32'yi sabit bir iBeacon olarak yayin yaptirir.
 * Henuz Wi-Fi, Firebase, donen kod YOK. Amac sadece:
 * "Telefon bu yayini cepteyken algilayabiliyor mu?" sorusunu test etmek.
 *
 * Yayin paketi elle (byte byte) olusturuluyor. Boylece kutuphane
 * surumune bagli byte sirasi (endianness) hatalari yasanmiyor.
 */

#include <BLEDevice.h>
#include <esp_gap_ble_api.h>

// ---------------------------------------------------------------
// AYARLAR
// ---------------------------------------------------------------

// Projeye ozel UUID. Tum sinif ESP32'leri AYNI UUID'yi kullanir;
// siniflar MAJOR degeriyle ayrilir. Telefon uygulamasi bu UUID'yi dinleyecek.
// Metin hali: 6f1d3b2a-8c4e-4a7f-9b21-5d3e8a9c0f47
static const uint8_t BEACON_UUID[16] = {
  0x6f, 0x1d, 0x3b, 0x2a,  0x8c, 0x4e,  0x4a, 0x7f,
  0x9b, 0x21,  0x5d, 0x3e, 0x8a, 0x9c, 0x0f, 0x47
};

const uint16_t SINIF_MAJOR = 203;   // Sinif numarasi
const uint16_t TEST_MINOR  = 1;     // Asama 3'te 30 sn'de bir degisen koda donusecek
const int8_t   TX_GUCU_1M  = -59;   // 1 metredeki beklenen RSSI (mesafe tahmini icin)

// Yayin araligi: 0xA0 = 160 x 0.625 ms = 100 ms
// (iPhone'un hizli algilamasi icin onerilen deger; ESP32 prize takili oldugu icin pil sorunu yok)
const uint16_t YAYIN_ARALIGI = 0xA0;

// ---------------------------------------------------------------

uint8_t yayinPaketi[30];

void iBeaconPaketiOlustur(uint16_t major, uint16_t minor) {
  uint8_t i = 0;

  // 1) Flags: "BLE genel kesfedilebilir, klasik Bluetooth yok"
  yayinPaketi[i++] = 0x02;  // uzunluk
  yayinPaketi[i++] = 0x01;  // tip: Flags
  yayinPaketi[i++] = 0x06;

  // 2) Manufacturer Specific Data (iBeacon formati)
  yayinPaketi[i++] = 0x1A;  // uzunluk: 26 byte
  yayinPaketi[i++] = 0xFF;  // tip: Manufacturer Specific Data
  yayinPaketi[i++] = 0x4C;  // Apple sirket kodu (0x004C), little-endian
  yayinPaketi[i++] = 0x00;
  yayinPaketi[i++] = 0x02;  // iBeacon tipi
  yayinPaketi[i++] = 0x15;  // kalan veri uzunlugu: 21 byte

  memcpy(&yayinPaketi[i], BEACON_UUID, 16);   // 16 byte UUID
  i += 16;

  yayinPaketi[i++] = major >> 8;     // Major (big-endian)
  yayinPaketi[i++] = major & 0xFF;
  yayinPaketi[i++] = minor >> 8;     // Minor (big-endian)
  yayinPaketi[i++] = minor & 0xFF;
  yayinPaketi[i++] = (uint8_t)TX_GUCU_1M;
  // Toplam: 3 + 27 = 30 byte (BLE yayin siniri 31 byte)
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== ESP32 iBeacon Testi ===");

  // Bluetooth yigini baslat (cihaz adi yayinda gorunmez, sadece ic kullanim)
  BLEDevice::init("yoklama_203");

  iBeaconPaketiOlustur(SINIF_MAJOR, TEST_MINOR);
  esp_ble_gap_config_adv_data_raw(yayinPaketi, sizeof(yayinPaketi));
  delay(100);  // paketin yigina islenmesi icin kisa bekleme

  esp_ble_adv_params_t yayinAyarlari = {};
  yayinAyarlari.adv_int_min       = YAYIN_ARALIGI;
  yayinAyarlari.adv_int_max       = YAYIN_ARALIGI;
  yayinAyarlari.adv_type          = ADV_TYPE_NONCONN_IND;  // baglanti kabul ETMEZ, sadece yayin
  yayinAyarlari.own_addr_type     = BLE_ADDR_TYPE_PUBLIC;
  yayinAyarlari.channel_map       = ADV_CHNL_ALL;
  yayinAyarlari.adv_filter_policy = ADV_FILTER_ALLOW_SCAN_ANY_CON_ANY;

  esp_err_t sonuc = esp_ble_gap_start_advertising(&yayinAyarlari);

  if (sonuc == ESP_OK) {
    Serial.println("Yayin basladi.");
    Serial.println("UUID : 6f1d3b2a-8c4e-4a7f-9b21-5d3e8a9c0f47");
    Serial.printf ("Major: %u  (sinif)\n", SINIF_MAJOR);
    Serial.printf ("Minor: %u\n", TEST_MINOR);
  } else {
    Serial.printf("HATA: Yayin baslatilamadi (kod %d)\n", sonuc);
  }
}

void loop() {
  // Yayin arka planda Bluetooth donanimi tarafindan surduruluyor.
  // Asama 3'te burada her 30 saniyede bir minor degeri guncellenecek.
  delay(1000);
}
