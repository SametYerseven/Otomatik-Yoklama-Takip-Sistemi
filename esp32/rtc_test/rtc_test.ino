/*
 * DS3231 SAAT MODULU TESTI (Asama 3 hazirligi)
 * ---------------------------------------------
 * Sinif kodu C zamana bagli (docs/protocol.md bolum 3): T = floor(unix_saniye / 30).
 * ESP32 internete baglanmadigi ve elektrik kesilince saati sifirlandigi icin
 * zamani pilli DS3231 modulunden okuyacak. Bu sketch sadece saati test eder:
 *   - DS3231 bulunuyor mu?
 *   - Saat ayarli mi, isliyor mu, elektrik kesilince korunuyor mu?
 *   - Zaman dilimi T dogru hesaplaniyor mu?
 * Kutuphane gerekmez (sadece Wire).
 *
 * BAGLANTI (ESP32 Dev Module)
 *   DS3231 VCC -> 3V3      (5V DEGIL)
 *   DS3231 GND -> GND
 *   DS3231 SDA -> GPIO 21
 *   DS3231 SCL -> GPIO 22
 *
 * Saat UTC olarak tutulur (Turkiye saati = UTC + 3). Protokol de UTC kullanir.
 *
 * SAATI AYARLAMAK
 *   Serial Monitor KAPALIYKEN proje kokunde:
 *     powershell -ExecutionPolicy Bypass -File esp32\rtc_test\set_time.ps1 -Port COM9
 *   (Bilgisayarin saatini gonderir.) Ya da Serial Monitor'e elle: T1795528800
 */

#include <Wire.h>

const uint8_t DS3231_ADDR = 0x68;
const int SDA_PIN = 21;
const int SCL_PIN = 22;
const uint32_t SLOT_SECONDS = 30;

// ---------------------------------------------------------------
// Tarih <-> Unix zamani (1970-01-01'den beri gun; H. Hinnant'in algoritmasi)
// ---------------------------------------------------------------

static int64_t daysFromCivil(int y, unsigned m, unsigned d) {
  y -= m <= 2;
  const int era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return (int64_t)era * 146097 + (int64_t)doe - 719468;
}

static void civilFromDays(int64_t z, int &y, unsigned &m, unsigned &d) {
  z += 719468;
  const int64_t era = (z >= 0 ? z : z - 146096) / 146097;
  const unsigned doe = (unsigned)(z - era * 146097);
  const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const unsigned mp = (5 * doy + 2) / 153;
  d = doy - (153 * mp + 2) / 5 + 1;
  m = mp < 10 ? mp + 3 : mp - 9;
  y = (int)((int64_t)yoe + era * 400 + (m <= 2));
}

static uint8_t bcd2bin(uint8_t v) { return (v >> 4) * 10 + (v & 0x0F); }
static uint8_t bin2bcd(uint8_t v) { return ((v / 10) << 4) | (v % 10); }

// ---------------------------------------------------------------
// DS3231 okuma / yazma
// ---------------------------------------------------------------

bool readRegister(uint8_t reg, uint8_t &value) {
  Wire.beginTransmission(DS3231_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission() != 0) return false;
  if (Wire.requestFrom((uint8_t)DS3231_ADDR, (uint8_t)1) != 1) return false;
  value = Wire.read();
  return true;
}

bool writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(DS3231_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

// Saati Unix zamani (UTC, saniye) olarak okur.
bool readUnix(uint32_t &unix) {
  Wire.beginTransmission(DS3231_ADDR);
  Wire.write(0x00);
  if (Wire.endTransmission() != 0) return false;
  if (Wire.requestFrom((uint8_t)DS3231_ADDR, (uint8_t)7) != 7) return false;
  uint8_t sec = bcd2bin(Wire.read() & 0x7F);
  uint8_t min = bcd2bin(Wire.read() & 0x7F);
  uint8_t hour = bcd2bin(Wire.read() & 0x3F);  // 24 saat modu
  Wire.read();                                  // haftanin gunu (kullanilmiyor)
  uint8_t day = bcd2bin(Wire.read() & 0x3F);
  uint8_t month = bcd2bin(Wire.read() & 0x1F);
  int year = 2000 + bcd2bin(Wire.read());
  int64_t days = daysFromCivil(year, month, day);
  unix = (uint32_t)(days * 86400 + hour * 3600 + min * 60 + sec);
  return true;
}

// Saati Unix zamanina (UTC) ayarlar ve "osilator durdu" isaretini temizler.
bool writeUnix(uint32_t unix) {
  int64_t days = unix / 86400;
  uint32_t rest = unix % 86400;
  int year;
  unsigned month, day;
  civilFromDays(days, year, month, day);
  if (year < 2000 || year > 2099) return false;

  Wire.beginTransmission(DS3231_ADDR);
  Wire.write(0x00);
  Wire.write(bin2bcd(rest % 60));
  Wire.write(bin2bcd((rest / 60) % 60));
  Wire.write(bin2bcd(rest / 3600));            // 24 saat modu (bit 6 = 0)
  Wire.write(bin2bcd((days + 4) % 7 + 1));     // 1970-01-01 persembe
  Wire.write(bin2bcd(day));
  Wire.write(bin2bcd(month));
  Wire.write(bin2bcd(year - 2000));
  if (Wire.endTransmission() != 0) return false;

  uint8_t status;
  if (!readRegister(0x0F, status)) return false;
  return writeRegister(0x0F, status & 0x7F);   // OSF (bit 7) temizle
}

// OSF: saat hic ayarlanmadiysa ya da pil yokken elektrik kesildiyse 1 olur.
bool oscillatorStopped() {
  uint8_t status;
  return readRegister(0x0F, status) && (status & 0x80);
}

void printTime(uint32_t unix) {
  int year;
  unsigned month, day;
  civilFromDays(unix / 86400, year, month, day);
  uint32_t rest = unix % 86400;
  uint32_t slot = unix / SLOT_SECONDS;
  Serial.printf("%04d-%02u-%02u %02lu:%02lu:%02lu UTC | unix %lu | dilim T=%lu (%2lu/30 sn)\n",
                year, month, day,
                (unsigned long)(rest / 3600), (unsigned long)((rest / 60) % 60), (unsigned long)(rest % 60),
                (unsigned long)unix, (unsigned long)slot, (unsigned long)(unix % SLOT_SECONDS));
}

// ---------------------------------------------------------------

void selfTest() {
  // Protokol test vektoru: unix 1795528800 -> T = 59850960 (docs/protocol.md bolum 11)
  bool ok = (1795528800UL / SLOT_SECONDS) == 59850960UL;
  int y;
  unsigned m, d;
  civilFromDays(daysFromCivil(2026, 11, 26), y, m, d);
  ok = ok && y == 2026 && m == 11 && d == 26 && daysFromCivil(1970, 1, 1) == 0;
  Serial.println(ok ? "Hesap testi: TAMAM" : "Hesap testi: HATA (kodu kontrol et)");
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== DS3231 Saat Testi ===");
  selfTest();

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.beginTransmission(DS3231_ADDR);
  if (Wire.endTransmission() != 0) {
    Serial.println("HATA: DS3231 bulunamadi (adres 0x68). Kablolari kontrol et:");
    Serial.println("  VCC->3V3, GND->GND, SDA->GPIO21, SCL->GPIO22");
    return;
  }
  Serial.println("DS3231 bulundu.");
  if (oscillatorStopped()) {
    Serial.println("UYARI: Saat ayarli degil ya da pil yokken durmus. set_time.ps1 ile ayarla.");
  }
}

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
      if (unix > 1700000000UL && writeUnix(unix)) {
        Serial.print("Saat ayarlandi: ");
        printTime(unix);
      } else {
        Serial.println("HATA: Gecersiz zaman ya da DS3231'e yazilamadi. Ornek: T1795528800");
      }
    }
    line = "";
  }
}

void loop() {
  handleSerial();

  static uint32_t lastUnix = 0;
  static uint32_t lastSlot = 0;
  uint32_t unix;
  if (!readUnix(unix)) {
    static unsigned long lastError = 0;
    if (millis() - lastError > 5000) {
      Serial.println("HATA: DS3231 okunamadi.");
      lastError = millis();
    }
    delay(100);
    return;
  }
  if (unix != lastUnix) {
    uint32_t slot = unix / SLOT_SECONDS;
    if (lastUnix != 0 && slot != lastSlot) Serial.println("--- yeni dilim: sinif kodu burada degisecek ---");
    printTime(unix);
    lastUnix = unix;
    lastSlot = slot;
  }
  delay(50);
}
