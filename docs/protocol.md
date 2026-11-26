# Aşama 3 Yoklama Protokolü

Durum: **Kabul edildi, kodlanıyor (2026-11-26).** Taslak 2026-11-24'te yazıldı.
Bu belge ESP32, telefon (Kotlin) ve Cloud Function'ın **aynı** uygulaması gereken kuralları
tanımlar. Birinde değişiklik yapılırsa üçü birlikte güncellenmeli ve sondaki test vektörleri
yeniden hesaplanmalıdır.

## 1. Amaç ve fikir

Bir yoklama ölçümü iki şeyi kanıtlar:

| Kanıt | Nasıl | Neden sahte üretilemez |
|---|---|---|
| **Öğrenci sınıfta** | ESP32'nin o an yayınladığı **sınıf kodu (C)** | C her 30 sn değişir ve yalnızca sınıfta duyulur; üretmek için sınıf anahtarı gerekir |
| **Bu öğrenci** | Telefonun ürettiği **öğrenci kodu (S)** | S, öğrencinin telefonundaki Keystore anahtarıyla üretilir; anahtar telefondan çıkamaz |

```
ESP32 (sınıfta)                 Telefon (Kotlin, arka planda)             Cloud Function `checkIn`
Her 30 sn yeni C'yi        -->  major=derslik, minor=C duyar
minor alanında yayınlar         S = HMAC(öğrenci_anahtarı, ...)
                                checkIn({room, classCode, studentCode, rssi}) -->  kontroller --> Presence
```

ESP32 internete bağlanmaz. Sunucu C'yi aynı formül ve aynı anahtarla kendisi hesaplayıp karşılaştırır.

## 2. Sabitler

| Ad | Değer |
|---|---|
| Zaman dilimi uzunluğu | 30 sn |
| Saat toleransı | ±1 dilim (sunucu T-1, T, T+1 dener) |
| Telefonun gönderim aralığı | En az 60 sn (bir dilim atlanır) |
| "Sınıfta değil" eşiği (panel) | Son `lastSeen` 150 sn'den eskiyse |
| Sınıf anahtarı | 32 bayt rastgele, **her dersliğe ayrı** |
| Öğrenci anahtarı | 32 bayt (Aşama 2'de hazır, `StudentKeyStore`) |
| HMAC | HMAC-SHA256 |
| Fonksiyon | Callable `checkIn`, bölge `europe-west1` |

Tüm sayılar **big-endian** (en anlamlı bayt önce) kodlanır. iBeacon `major`/`minor` da zaten big-endian.

## 3. Sınıf kodu C (ESP32 üretir, `minor` alanında yayınlar)

```
T     = floor(unix_saniye / 30)                         // UTC, tamsayı
msg_c = "CLS" (ASCII, 3 bayt) || major (uint16) || T (uint64)     // toplam 13 bayt
h     = HMAC-SHA256(sınıf_anahtarı, msg_c)              // 32 bayt
C     = h[0] * 256 + h[1]                               // 0..65535
```

- `major` = derslik numarası (örn. 203). Formülde olduğu için iki derslik aynı anahtarı kullansa
  bile kodları farklı çıkar.
- ESP32 her dilim başında C'yi yeniden hesaplar ve yayın paketini günceller
  (`esp_ble_gap_config_adv_data_raw`, `beacon.ino`'daki elle kurulan paket korunur).
- Saat kaynağı: DS3231 RTC (sipariş edildi).
- Telefon tarafında bölge yalnızca UUID ile tanımlı (major/minor `null`) olduğu için minor'ın
  değişmesi "sınıftan çıktın" olayı üretmez.

## 4. Öğrenci kodu S (telefon üretir)

```
msg_s = "STU" (ASCII, 3 bayt) || major (uint16) || C (uint16)     // toplam 7 bayt
S     = HMAC-SHA256(öğrenci_anahtarı, msg_s)            // 32 bayt, base64 ile gönderilir (44 karakter)
```

- `StudentKeyStore.sign(msg_s)` ile üretilir; anahtar Keystore'dan çıkmaz.
- Telefonun saatine gerek yok: zaman bilgisi zaten C'nin içinde.
- S'yi ele geçiren başka biri kullanamaz; istek o öğrencinin Firebase girişiyle gelmek zorunda.

## 5. Telefon: ne zaman gönderir?

Kotlin (`BeaconApp`), uygulama kapalıyken de çalışır:

1. Her ranging sonucunda proje UUID'li beacon görüldüyse ve son gönderimden bu yana **≥ 60 sn**
   geçtiyse gönderim yapılır.
2. Birden fazla beacon varsa **RSSI'si en güçlü** olan seçilir.
3. `room = major`, `classCode = minor`, `studentCode = base64(S)`, `rssi` gönderilir.
4. İnternet yoksa ya da istek başarısızsa **kuyruğa alınmaz**: C kısa sürede geçersiz olur,
   bir sonraki dakikada yeni ölçüm gönderilir.
5. Sunucu `no-key` hatası dönerse (öğretmen cihazı sıfırlamış) Kotlin anahtarı yenilemelidir
   (Flutter'daki `prepareDevice` ile aynı mantık). Ayrıntısı uygulama sırasında belirlenecek.

## 6. Sunucu: `checkIn` callable fonksiyonu

**İstek**

```json
{ "room": 203, "classCode": 10803, "studentCode": "<44 karakter base64>", "rssi": -67 }
```

**Kontroller (sırayla; biri başarısızsa yazma yapılmaz)**

| # | Kontrol | Başarısızsa |
|---|---|---|
| 1 | Firebase girişi var mı → `uid` | `unauthenticated` |
| 2 | Alan türleri: `room` 0–65535 tamsayı, `classCode` 0–65535, `studentCode` 44 karakter, `rssi` tamsayı | `invalid-argument` |
| 3 | `StudentAccounts/{uid}.studentNo` var ve `StudentNumbers/{no} == uid` | `permission-denied` (`not-student`) |
| 4 | `StudentSecrets/{uid}` var | `failed-precondition` (`no-key`) |
| 5 | `RoomSecrets/{room}` ile T-1, T, T+1 için C hesaplanır; biri eşleşir → o dilim `Tm` | `permission-denied` (`class-code`) |
| 6 | S, `StudentSecrets/{uid}.key` ile hesaplanır ve sabit zamanlı karşılaştırılır | `permission-denied` (`student-code`) |
| 7 | `System/{room}.status` `ACTIVE` veya `EXIT` (ders sürüyor) | `{ result: "no-session" }`, yazma yok |
| 8 | `Presence/{room}/{studentNo}.lastSlot >= Tm` ise (aynı/eski dilim) | `{ result: "duplicate" }`, yazma yok |

Hata durumunda sunucu `HttpsError(kod, neden)` döner; parantez içindeki neden
(`not-student`, `no-key`, `class-code`, `student-code`) hatanın **mesaj** alanına yazılır.
Telefon `no-key`'i bu mesajdan tanır.

**Yazma** (yalnızca 1–8 geçerse):

```
Presence/{room}/{studentNo} güncellenir:
  status      = "IN_CLASS"
  rssi        = istekteki rssi
  lastSeen    = sunucu zamanı (ms)
  lastSlot    = Tm
  checkInTime = sunucu zamanı (ms)     // sadece kayıt ilk kez oluşuyorsa
```

Yanıt: `{ result: "ok" }`.

- `room`, veritabanında string anahtar olarak kullanılır: `String(room)` → `"203"`.
  Bu yüzden beacon kullanılan derslikler `Classrooms` listesinde sayı olarak yazılmalı.
- Fonksiyon **tetikleyici (trigger) değil**, HTTPS callable. Kendi yazdığı yol onu tekrar
  çağıramaz (CLAUDE.md maliyet kuralı 1).
- Eski sistemin `mac` alanı artık yazılmaz; panel bu alanı göstermiyor.

## 7. Panel: "sınıfta" hesabı

Panel şu an `status === "IN_CLASS"` olanları "var" sayıyor. Yeni kural:

```
sınıfta = status === "IN_CLASS" && (manual === true || şimdi - lastSeen <= 150 sn)
```

- Telefonun pili biterse, internet kesilirse ya da öğrenci çıkarsa gönderim durur; 2,5 dakika
  sonra panel öğrenciyi "sınıfta değil" sayar. Ayrı bir "çıktım" isteği ya da zamanlanmış
  fonksiyon yoktur.
- Öğretmenin elle eklediği kayıtlar (`manual: true`) süre dolmasından etkilenmez.

## 8. Anahtarların saklanması

| Anahtar | Nerede | Kim okuyabilir |
|---|---|---|
| Sınıf anahtarı | ESP32: `esp32/beacon/config.h` (git'te yok) | ESP32 |
| Sınıf anahtarı | `RoomSecrets/{room}`: `{ key: base64 (44 karakter), createdAt }` | Sadece Cloud Function (kural: okuma/yazma `false`) |
| Öğrenci anahtarı | Telefon Keystore | Sadece telefon (imzalama) |
| Öğrenci anahtarı | `StudentSecrets/{uid}` | Sadece Cloud Function |

Sınıf anahtarı bir kez üretilir, Console'dan `RoomSecrets`'a ve `config.h`'a elle konur.
Bir ESP32 kaybolur ya da çalınırsa o dersliğin anahtarı yenilenmelidir.

## 9. Maliyet tahmini

50 öğrenci × günde 6 saat ders × 22 gün × saatte 60 istek ≈ **400.000 çağrı/ay**.
Ücretsiz kota 2 milyon çağrı/ay. Her çağrı RTDB'den birkaç küçük okuma ve tek bir küçük yazma yapar.

## 10. Güvenlik özeti ve bilinen sınırlar

- **Tahmin:** Sınıf dışındaki biri C'yi rastgele denerse tek denemede şansı ~3/65536 (±1 dilim).
  Dilim başına tek istek kabul edildiği ve %70 katılım için ders boyunca art arda onlarca
  doğru tahmin gerektiği için pratikte işe yaramaz.
- **Tekrar gönderim (replay):** Aynı ya da eski dilim reddedilir (`lastSlot`); başkasının S'si
  kendi girişinle kullanılamaz.
- **Röle saldırısı (bilinen sınır):** Sınıftaki biri C'yi 30 sn içinde dışarıdaki arkadaşına
  iletirse arkadaşı yoklamaya yazılabilir.
- **Telefonunu arkadaşına veren öğrenci (bilinen sınır):** Teknik olarak ayırt edilemez;
  ileride ML'in RSSI örüntüsü yardımcı olabilir.
- **ESP32 anahtarının çalınması:** Yalnızca o derslik etkilenir (her dersliğe ayrı anahtar).

## 11. Test vektörleri

Üç uygulama da (ESP32 C/C++, Kotlin, Node.js) bu değerleri üretmelidir.
**Bu anahtarlar sadece testtir, gerçek bir derslikte ya da hesapta kullanılmamalıdır.**

| Girdi | Değer |
|---|---|
| Sınıf anahtarı | `00 01 02 … 1f` (base64: `AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=`) |
| Öğrenci anahtarı | `20 21 22 … 3f` (base64: `ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=`) |
| major | 203 |
| unix_saniye | 1795528800 |

| Çıktı | Değer |
|---|---|
| T | 59850960 |
| msg_c (hex) | `434c5300cb00000000039140d0` |
| HMAC (hex) | `2a3380983bb47121a99640ad6636ceb80abd003b979e323104932f189c65e785` |
| **C** | **10803** (`0x2a33`) |
| C, T-1 için | 8513 |
| C, T+1 için | 58728 |
| msg_s (hex) | `53545500cb2a33` |
| S (hex) | `7d988e8182a6c3732551fbfad10d0fd8061463fc571e09eeb197e3c8586014f5` |
| **S (base64)** | **`fZiOgYKmw3MlUfv60Q0P2AYUY/xXHgnusZfjyFhgFPU=`** |

## 12. Uygulama sırası

1. **Telefon (Kotlin):** C'yi okuyup S üretmek; `checkIn` çağrısı. ESP32 şu an `minor = 1`
   yayınladığı için S üretimi bu değerle denenebilir.
2. **Cloud Function:** Firebase Emulator Suite ile yerelde (Blaze gerekmez). Node.js ve
   Firebase CLI kurulumu gerekir.
3. **ESP32:** DS3231 gelince dönen C.
4. **Panel:** §7'deki `lastSeen` kuralı.
5. **Yayına alma:** Blaze planı, `firebase deploy` (Artifact Registry "eski paketleri sil": evet),
   bütçe uyarısı, `RoomSecrets` kuralı.
