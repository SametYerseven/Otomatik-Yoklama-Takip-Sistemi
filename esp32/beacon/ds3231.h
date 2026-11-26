// DS3231 saat modulu: Unix zamani (UTC) okuma / yazma. Kutuphane gerekmez (sadece Wire).
// Baglanti: VCC->3V3, GND->GND, SDA->GPIO21 (D21), SCL->GPIO22 (D22).
// esp32/rtc_test/rtc_test.ino ayni hesaplari kullanir; birinde degisiklik olursa digerine de bak.
#pragma once

#include <Arduino.h>
#include <Wire.h>

namespace rtc {

const uint8_t ADDR = 0x68;
const int SDA_PIN = 21;
const int SCL_PIN = 22;

// 1970-01-01'den beri gun sayisi <-> tarih (H. Hinnant'in algoritmasi)
static inline int64_t daysFromCivil(int y, unsigned m, unsigned d) {
  y -= m <= 2;
  const int era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return (int64_t)era * 146097 + (int64_t)doe - 719468;
}

static inline void civilFromDays(int64_t z, int &y, unsigned &m, unsigned &d) {
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

static inline uint8_t bcd2bin(uint8_t v) { return (v >> 4) * 10 + (v & 0x0F); }
static inline uint8_t bin2bcd(uint8_t v) { return ((v / 10) << 4) | (v % 10); }

static inline bool readRegister(uint8_t reg, uint8_t &value) {
  Wire.beginTransmission(ADDR);
  Wire.write(reg);
  if (Wire.endTransmission() != 0) return false;
  if (Wire.requestFrom((uint8_t)ADDR, (uint8_t)1) != 1) return false;
  value = Wire.read();
  return true;
}

static inline bool writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

// I2C'yi baslatir; DS3231 cevap veriyorsa true.
static inline bool begin() {
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.beginTransmission(ADDR);
  return Wire.endTransmission() == 0;
}

// Saati Unix zamani (UTC, saniye) olarak okur.
static inline bool readUnix(uint32_t &unix) {
  Wire.beginTransmission(ADDR);
  Wire.write(0x00);
  if (Wire.endTransmission() != 0) return false;
  if (Wire.requestFrom((uint8_t)ADDR, (uint8_t)7) != 7) return false;
  uint8_t sec = bcd2bin(Wire.read() & 0x7F);
  uint8_t min = bcd2bin(Wire.read() & 0x7F);
  uint8_t hour = bcd2bin(Wire.read() & 0x3F);  // 24 saat modu
  Wire.read();                                  // haftanin gunu (kullanilmiyor)
  uint8_t day = bcd2bin(Wire.read() & 0x3F);
  uint8_t month = bcd2bin(Wire.read() & 0x1F);
  int year = 2000 + bcd2bin(Wire.read());
  unix = (uint32_t)(daysFromCivil(year, month, day) * 86400 + hour * 3600 + min * 60 + sec);
  return true;
}

// Saati Unix zamanina (UTC) ayarlar ve "osilator durdu" isaretini temizler.
static inline bool writeUnix(uint32_t unix) {
  int64_t days = unix / 86400;
  uint32_t rest = unix % 86400;
  int year;
  unsigned month, day;
  civilFromDays(days, year, month, day);
  if (year < 2000 || year > 2099) return false;

  Wire.beginTransmission(ADDR);
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

// OSF: saat hic ayarlanmadiysa ya da pil yokken elektrik kesildiyse true.
static inline bool oscillatorStopped() {
  uint8_t status;
  return !readRegister(0x0F, status) || (status & 0x80);
}

// "2026-11-26 12:33:02" bicimi
static inline void formatTime(uint32_t unix, char *buf, size_t size) {
  int year;
  unsigned month, day;
  civilFromDays(unix / 86400, year, month, day);
  uint32_t rest = unix % 86400;
  snprintf(buf, size, "%04d-%02u-%02u %02lu:%02lu:%02lu", year, month, day,
           (unsigned long)(rest / 3600), (unsigned long)((rest / 60) % 60), (unsigned long)(rest % 60));
}

}  // namespace rtc
