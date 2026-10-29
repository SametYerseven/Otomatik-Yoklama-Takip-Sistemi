# CLAUDE.md — Otomatik Yoklama Takip Sistemi

Bu dosya, bu repoda çalışan Claude'a projenin bağlamını verir. Kod yazmadan önce oku.

## Proje özeti

Manisa Celal Bayar Üniversitesi, Yazılım Mühendisliği, YZM 3114 Profesyonel Yazılım Geliştirme
dersi projesi. Ekip: Talha Gürün, Samet Yerseven. Danışman: Doç. Dr. Osman Altay.

Amaç: Öğrenci sınıfa girdiğinde **telefonunu eline almadan** yoklamasının otomatik alınması ve
derste ne kadar kaldığının takip edilmesi. Bileşenler: ESP32 (sınıfta), Flutter mobil uygulama
(öğrenci), web paneli (öğretmen), Firebase Realtime Database, Python ML scriptleri.

## Mimari kararlar (değiştirmeden önce kullanıcıya sor)

1. **ESP32 yayın yapar, telefon dinler.** ESP32 bir **iBeacon** gibi bağlantısız yayın
   (`ADV_TYPE_NONCONN_IND`) yapar. Telefon arka planda bu yayını dinler.
   - Neden: iOS, uygulama arka plandayken telefonun özel veri içeren BLE yayını yapmasına izin
     vermiyor; ama iBeacon bölge izlemeyi (CoreLocation) uygulama kapalıyken bile destekliyor.
   - Neden bağlantısız: Eski sistem (GATT bağlantısı) ESP32'de aynı anda en fazla 3–9 kişiyi
     kaldırıyordu. Yayın modelinde kişi sınırı yok.
2. **MAC adresi KULLANILMAZ.** Telefonlar BLE'de rastgele, değişen adres kullanıyor; uygulamalar
   gerçek MAC'i okuyamıyor. Kimlik, yayın/istek içeriğiyle (HMAC kodları) kanıtlanır.
3. **Kimlik ve fiziksel varlık HMAC ile kanıtlanır** (Aşama 2–3, henüz yapılmadı):
   - ESP32 `minor` alanında 30 sn'de bir değişen sınıf kodu yayınlar.
   - Telefon kendi gizli anahtarıyla öğrenci kodu üretip sunucuya gönderir.
   - Doğrulamayı **Firebase Cloud Functions** yapar (proje Blaze planında olmalı).
4. **Öğrenci kaydı:** Firebase Authentication, e-posta/şifre.
5. **Android'de arka plan taraması native Kotlin + AltBeacon ile yapılır**, Flutter sadece ekran.
   Uygulama kapalıyken Flutter motoru çalışmadığı için arka plan işleri (tarama, bildirim,
   ileride sunucuya gönderim) Kotlin tarafında olmalı. iOS tarafı ileride Swift + CoreLocation
   ile yazılacak; Dart kodu ve kanal isimleri iki platformda aynı kalacak.

## Durum

| Aşama | İçerik | Durum |
|---|---|---|
| 1 | ESP32 sabit iBeacon + Android arka plan algılama testi | **Tamamlandı**, Galaxy S24 Ultra'da test edildi: uygulama kapalıyken "Sınıfa girdin/çıktın" bildirimleri geliyor |
| 2 | Öğrenci kaydı, gizli anahtar | Yapılmadı |
| 3 | Dönen sınıf kodu (ESP32), öğrenci kodu (telefon), Cloud Functions doğrulaması, `Varlik`'a yazma | Yapılmadı |
| — | iOS (Swift + CoreLocation) | Yapılmadı, Mac gerekiyor |
| — | Öğretmen paneline Firebase Auth | Yapılmadı |

Şu an telefon beacon'u duyup sadece kendi ekranında/bildiriminde gösteriyor; Firebase'e hiçbir
şey göndermiyor. ESP32 de Firebase/Wi-Fi kullanmıyor.

## Klasör yapısı

```
esp32/beacon/beacon.ino      Aşama 1 iBeacon yayını (eski adı ibeacon_test.ino). Bulamazsan esp32/ altında ara.
esp32/rfid_test/             RC522 RFID test kodu
esp32/main/ (veya eski_gatt/) ESKİ GATT tabanlı sistem; referans, yeni geliştirmede kullanılmıyor
mobil/                       Flutter projesi (paket adı com.example.yoklama_sistemi)
  lib/main.dart              Ekran: izinler, görülen beacon'lar, giriş/çıkış geçmişi
  android/app/src/main/AndroidManifest.xml
  android/app/src/main/kotlin/com/example/yoklama_sistemi/
    BeaconApp.kt             Application sınıfı; AltBeacon ile arka plan tarama, bildirimler
    MainActivity.kt          Flutter <-> Kotlin köprüsü (MethodChannel/EventChannel)
web/                         Öğretmen paneli (HTML/JS, Firebase JS SDK v8, SheetJS ile Excel)
firebase/veritabani.json     Örnek başlangıç verisi
ml/                          Python: veri_topla, egit (DecisionTree), canli_tahmin, anomali_tespit
docs/                        Proje öneri formu, grafikler
```

## Sabitler (her yerde aynı olmalı)

| Ne | Değer |
|---|---|
| iBeacon UUID | `6f1d3b2a-8c4e-4a7f-9b21-5d3e8a9c0f47` |
| iBeacon major | Sınıf numarası (örn. 203). 0–65535 arası **sayı** olmalı |
| iBeacon minor | Aşama 1'de sabit `1`; Aşama 3'te dönen sınıf kodu olacak |
| ESP32 yayın aralığı | 100 ms (`0xA0`) |
| Firebase proje ID | `otomatik-yoklama-takip-sistemi` |
| RTDB URL | `https://otomatik-yoklama-takip-sistemi-default-rtdb.europe-west1.firebasedatabase.app/` |
| Cloud Functions bölgesi | `europe-west1` (planlanan) |
| Android paket adı | `com.example.yoklama_sistemi` |
| Flutter kanalları | `yoklama/beacon` (MethodChannel), `yoklama/beacon_olaylar` (EventChannel) |

## ESP32 notları (`beacon.ino`)

- Yayın paketi kütüphane yerine **byte byte elle** kuruluyor (`esp_ble_gap_config_adv_data_raw`),
  çünkü bazı ESP32 kütüphane sürümleri UUID'yi ters byte sırasıyla yazıyor. Bu yaklaşımı koru.
- Paket: Flags (3 byte) + iBeacon manufacturer data (27 byte: `1A FF 4C 00 02 15` + UUID 16 +
  major 2 + minor 2 + txPower 1) = 30 byte. Major/minor big-endian.
- Kart: ESP32 Dev Module, USB çipi CP2102 (Windows'ta COM9). Arduino IDE, "esp32 by Espressif".

## Android notları

- AltBeacon `org.altbeacon:android-beacon-library:2.21.2`, `androidx.core:core-ktx:1.13.1`
  (`android/app/build.gradle.kts` sonundaki `dependencies` bloğu).
- iBeacon parser: `m:2-3=0215,i:4-19,i:20-21,i:22-23,p:24-24`
- Foreground service ile tarama (kalıcı "Yoklama aktif" bildirimi). Manifest'te
  `BeaconService` için `android:foregroundServiceType="location"` + `tools:replace` var
  (Android 14+ zorunlu). Tarama periyodu 1100 ms, arada bekleme 0.
- Bölge: sadece UUID (major/minor `null`) → tüm sınıflar tek bölge. Çıkış ~10 sn görülmeyince.
- `BeaconApp.onCreate` izinler zaten verilmişse taramayı kendisi başlatır (telefon yeniden
  başlayınca devam etmesi için).
- Bildirim kanalları: `beacon_servis` (düşük önem), `beacon_olay` (yüksek önem).
- Dart'ta platform kanalından gelen listeler sabit uzunlukta: üzerine ekleme yapılacaksa
  `List<String>.from(...)` ile kopyala (daha önce bu yüzden hata alındı).

## Geliştirme ortamı (Windows)

- Flutter 3.47.6 stable, `C:\flutter` (Git ile kuruldu). Path: `C:\flutter\bin`.
- Android Studio Rabbit 1; Gradle 9.3.1, Android Gradle Plugin 9.1.0 → **compileSdk en fazla 36**.
- `permission_handler` **^12.0.1'e sabitlendi**: 13.x compileSdk 37 istiyor, AGP 9.1 desteklemiyor.
  Yeni paket eklerken aynı tür compileSdk uyumsuzluğuna dikkat et.
- NDK 28.2.13676358 SDK Manager'dan elle kuruldu (otomatik kurulum başarısız olmuştu).
- Test telefonu: Samsung Galaxy S24 Ultra (SM-S928B), USB hata ayıklama açık.
- Emülatör kullanılamaz (Bluetooth yok); beacon testleri gerçek telefonda.
- Repo uzun yol sorununa karşı kısa bir yolda tutulmalı; `git config --global core.longpaths true`.
- Flutter projesini kopyalarken `build/`, `.dart_tool/`, `.gradle/`, `.idea/`, `local.properties`
  hariç tutulmalı (Windows 260 karakter yol sınırı).

## Çalıştırma

```bash
cd mobil
flutter pub get
flutter run            # telefon USB ile bağlı olmalı; terminalde r = hot reload, R = hot restart
```
ESP32: Arduino IDE → `esp32/beacon/beacon.ino` → Board: ESP32 Dev Module → Port: COM9 → Upload →
Serial Monitor 115200. Doğrulama: Android'de nRF Connect uygulamasında "iBeacon" görünmeli
(iPhone'da nRF Connect iBeacon'ları göstermez).

## Mevcut veritabanı düğümleri (web paneli bunları kullanıyor, formatı bozma)

- `Ogretmenler/{kullaniciAdi}`: `{ isim, sifre (düz metin!), dersler[] }`
- `Siniflar`: dizi, örn. `["203","204","205","Amfi 1","Lab 2"]` (beacon için sayı olmalı)
- `Ogrenciler/{ogrNo}`: `"Ad Soyad"` (düz string)
- `Varlik/{sinif}/{ogrNo}`: `{ durum: "SINIFTA" | "AYRILDI" | ..., mac, rssi, manuel? }`
  Panel `durum === "SINIFTA"` olanları "var" sayar; 20 sn'de bir örnekleyip katılım yüzdesi
  hesaplar; nihai VAR = girişte var + çıkışta var + %70 üzeri.
- `Sistem/{sinif}`: `{ durum: "AKTIF" | "CIKIS", ders, rfid_izin, SonOkunanKart }`
- `ML_Tahmin/{sinif}/{ogrNo}`: `{ sinif_ici, zaman }` (canli_tahmin.py yazar)
- `RFID_Kartlar/{uid}`: ogrNo

## Güvenlik — dikkat

- `firebase_kimlik.json` (servis hesabı), `config.h`, `config.js`, `google-services.json`
  **asla commit edilmez** (`.gitignore`'da). Commit öncesi `git status` ile kontrol et.
- Eski bir `firebase_kimlik.json` zip içinde paylaşıldı; yenilenmesi gerekiyor.
- Web paneli Firebase Auth kullanmıyor; şifreler tarayıcıda kontrol ediliyor ve veritabanı
  büyük ölçüde açık. Kurallar sıkılaştırılırken paneli bozmamaya dikkat et.

## Eski koddaki bilinen sorunlar (yeni sistemde kullanılmıyor ama referans)

- `esp32/main/main.ino`: `sonOkunanRssi` hiç güncellenmiyor; `onWrite` numarayı son bağlanan
  cihazla eşleştiriyor (yarış durumu); RFID SPI pinleri (test: 25/26/27) RGB LED pinleriyle çakışıyor.
- `ml/veri_topla.py` (dıştaki kopya) `db.ref` kullanıyor, doğrusu `db.reference`.
- ML scriptlerinde mutlak Windows yolları (`C:\projeler\...`) var.
- ML modeli ESP32'nin ölçtüğü RSSI ile eğitildi; yeni mimaride RSSI'yi telefon ölçüyor, model
  yeniden eğitilmeli. `train_test_split` zaman serisini karıştırıyor (doğruluk iyimser).

## Kod stili

- Değişken/fonksiyon adları ve yorumlar **Türkçe** (mevcut kodla tutarlı). C/Kotlin yorumlarında
  Türkçe karakter yerine ASCII tercih edilmiş; kullanıcıya görünen metinler Türkçe karakterli.
- Kullanıcıyla Türkçe konuş. Kullanıcı yeni başlayan; komutları ve dosya yollarını açıkça ver.
