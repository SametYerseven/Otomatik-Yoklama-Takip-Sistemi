// Bu dersligin ayarlari (docs/protocol.md bolum 3 ve 8).
// KULLANIM: Bu dosyayi ayni klasore config.h adiyla kopyala ve degerleri doldur.
// config.h .gitignore'da: gercek sinif anahtari ASLA commit edilmez (repo public).
#pragma once
#include <stdint.h>

// Derslik numarasi = iBeacon major (0-65535 arasi sayi). Classrooms listesindekiyle ayni olmali.
const uint16_t CLASSROOM_MAJOR = 203;

// 32 baytlik sinif anahtari. Her dersligin anahtari ayri olmali.
// Ayni anahtar Firebase'de RoomSecrets/{derslik}/key olarak (base64) da durmali; sunucu sinif
// kodunu onunla hesaplar. Yeni anahtar uretmek icin (proje kokunde):
//   powershell -ExecutionPolicy Bypass -File esp32\beacon\new_room_key.ps1
//
// ASAGIDAKI protokolun TEST anahtaridir (00 01 02 ... 1f). Gelistirme ve Emulator icin
// uygundur; gercek bir derslikte KULLANILMAZ. Kullanilirsa ESP32 acilista uyari yazar.
static const uint8_t ROOM_KEY[32] = {
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
  0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
  0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f
};
