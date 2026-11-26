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
3. **Kimlik ve fiziksel varlık HMAC ile kanıtlanır** (öğrenci anahtarı Aşama 2'de hazır; kod
   üretme ve doğrulama Aşama 3, yazılıyor):
   - ESP32 `minor` alanında 30 sn'de bir değişen sınıf kodu yayınlar.
   - Telefon kendi gizli anahtarıyla öğrenci kodu üretip sunucuya gönderir.
   - Doğrulamayı **Firebase Cloud Functions** yapar (proje Blaze planında olmalı).
   - Ayrıntılı kurallar, bayt düzeni ve test vektörleri: **`docs/protocol.md`** (2026-11-24'te
     yazıldı, 2026-11-26'da kabul edildi, kodlanıyor). ESP32, Kotlin ve fonksiyon kodu bu belgeye
     birebir uymalı; birinde değişiklik olursa belge, test vektörleri ve üç taraftaki birim
     testleri de güncellenmeli.
4. **Öğrenci kaydı:** Firebase Authentication, e-posta/şifre.
5. **Android'de arka plan taraması native Kotlin + AltBeacon ile yapılır**, Flutter sadece ekran.
   Uygulama kapalıyken Flutter motoru çalışmadığı için arka plan işleri (tarama, bildirim,
   ileride sunucuya gönderim) Kotlin tarafında olmalı. iOS tarafı ileride Swift + CoreLocation
   ile yazılacak; Dart kodu ve kanal isimleri iki platformda aynı kalacak.

## Durum

| Aşama | İçerik | Durum |
|---|---|---|
| 1 | ESP32 sabit iBeacon + Android arka plan algılama testi | **Tamamlandı**, Galaxy S24 Ultra'da test edildi: uygulama kapalıyken "Sınıfa girdin/çıktın" bildirimleri geliyor |
| 2 | Öğrenci kaydı, gizli anahtar | **Tamamlandı** (2026-11-18), Galaxy S24 Ultra'da test edildi: kayıt, giriş, çıkış, tekrar giriş, aynı numarayla ikinci kayıt engelleniyor ve uyarı gösteriliyor. `firebase/database.rules.json` Firebase'de yayında |
| 3 | Dönen sınıf kodu (ESP32), öğrenci kodu (telefon), Cloud Functions doğrulaması, `Presence`'a yazma | **Kodlanıyor** (protokol `docs/protocol.md`, 2026-11-26'da kabul edildi). Adım adım yapılıyor: ✅ Kotlin öğrenci kodu (`AttendanceCode.kt`) ✅ Kotlin `checkIn` istemcisi (`CheckInClient.kt`, henüz taramaya bağlı değil) ✅ sunucu kod hesabı (`functions/codes.js`) — hepsi test vektörleriyle birim testli. Sıradaki: `functions/index.js` (`checkIn`, 8 kontrol + `Presence` yazımı, Emulator'da) → `BeaconApp`'e bağlama (60 sn, en güçlü beacon, `no-key` → anahtar yenileme) → ESP32 dönen C (DS3231 bekleniyor) → panel `lastSeen` → Blaze + deploy |
| — | iOS (Swift + CoreLocation) | Yapılmadı, Mac gerekiyor |
| — | Öğretmen paneline Firebase Auth | **Tamamlandı** (2026-11-18): e-posta/şifre girişi, `TeacherAccounts` eşlemesi, sıkı kurallar Firebase'de yayında. Şimdilik iki test hesabı, ikisi de `osman_altay`'a bağlı: Samet'in hesabı ve Talha'nın 2026-11-24'te açtığı test öğretmen hesabı. Gerçek öğretmen hesapları açılınca ikisi de silinmeli (Authentication → Users ve `TeacherAccounts/{uid}`) |
| — | Öğretmen paneline "Cihazı sıfırla" | **Tamamlandı** (2026-11-24): panelde her zaman açık "Öğrenciler" sekmesi → öğrenci detayı → buton; kurallar Firebase'de yayında. Aynı telefonda sıfırlanırsa uygulama bir sonraki açılışta anahtarı yeniler. Galaxy S24 Ultra'da test edildi: normal açılış, aynı telefonda sıfırlama, uygulamayı silip kurma (sıfırlamasız engelleniyor, sıfırlamayla açılıyor), panel sekmesi |

Şu an telefon beacon'u duyup sadece kendi ekranında/bildiriminde gösteriyor; yoklama için
Firebase'e bir şey göndermiyor (sadece kayıt/giriş verisi yazıyor). ESP32 de Firebase/Wi-Fi
kullanmıyor.

Aşama 3 için bekleyen kararlar: proje Blaze planına geçmeli (ödeme bilgisi; proje ekip
arkadaşının hesabında). ESP32'nin saati nereden alacağı seçilmeli: Wi-Fi + NTP ya da DS3231 RTC
modülü. Röle saldırısı (sınıftaki birinin kodu 30 sn içinde dışarıya iletmesi) bilinen sınır.

**Cloud Functions maliyet kuralları (Blaze, kullandıkça öde; Aşama 3'te uyulmalı):**
Ücretsiz aylık kota (2 milyon fonksiyon çağrısı, RTDB 1 GB depolama / 10 GB indirme) bu
proje için fazlasıyla yeterli; para ancak kota aşılırsa, sadece aşan kısım için çıkar.
Gerçekçi riskler ve önlemleri:
1. **Kendini tetikleyen döngü.** Bir fonksiyonun veritabanına yazması aynı fonksiyonu
   (or. `onValueWritten` tetikleyicisi) tekrar tetiklerse saatler içinde milyonlarca çağrı
   olur. Tetikleyici fonksiyonlar kendi dinledikleri yola yazmamalı; yazmaları gerekiyorsa
   "değer zaten aynıysa çık" kontrolü olmalı. Tercihen telefon → HTTPS/callable fonksiyon →
   `Presence` yazımı (tetikleyicisiz) kullanılmalı. Google Cloud'da bütçe uyarısı kurulu
   olmalı (uyarı harcamayı durdurmaz, sadece e-posta atar).
2. **Fonksiyon yükleme kalıntıları.** Her `firebase deploy` Artifact Registry'de bir
   container paketi bırakır (0,5 GB ücretsiz). İlk deploy'da Firebase CLI "eski paketleri
   otomatik sil" (cleanup policy) sorar: **evet** denmeli.

## Bekleyen işler

- Türkçe düğümler (`Ogretmenler, Siniflar, Ogrenciler, Varlik, Sistem, ML_Tahmin, RFID_Kartlar`)
  2026-11-24'te kurallardan çıkarıldı (kuralı olmayan düğüm kapalıdır). Canlı veritabanından
  Console'dan silinecek (önce JSON yedeği alınmalı).
- `MLKomut` / `MLSonuclar`: onları yazan ML kodu kayıp; ML için veri yeniden toplanacak.
  2026-11-24'te kurallarda kapatıldı (veri silinmedi); ML'e dönülünce yeni koda göre kural yazılmalı.

## Klasör yapısı

```
esp32/beacon/beacon.ino      Aşama 1 iBeacon yayını
esp32/rfid_test/             RC522 RFID test kodu
esp32/legacy_gatt/           ESKİ GATT tabanlı sistem (legacy_gatt.ino + config_example.h);
                             referans, yeni geliştirmede kullanılmıyor
mobile/                      Flutter projesi (paket adı com.example.attendance_system);
                             sadece android/ ve ios/ platformları var
  lib/main.dart              Firebase'i ve demo ayarlarını başlatır, açık/karanlık tema, AuthGate
  lib/theme.dart             Renkler (CBÜ logosundan: lacivert #284090, mavi #0090D0, kırmızı #D02030)
  lib/auth_gate.dart         Giriş yok → AuthScreen; giriş var → DeviceSetup (anahtar) → HomeShell
  lib/auth_screen.dart       Logolu giriş / kayıt / şifre sıfırlama formu
  lib/student_service.dart   Firebase Auth + RTDB + anahtar kanalı; kayıt ve cihaz eşleştirme mantığı
  lib/beacon_controller.dart Kotlin beacon kanalını dinleyen tek nokta (ChangeNotifier): izinler,
                             görülen beacon'lar, giriş/çıkış geçmişi, sınıfta mı
  lib/demo_data.dart         Demo modu ayarları (shared_preferences) + örnek ders programı/yoklamalar
  lib/screens/               home_shell (alt menü), home (durum + sonraki ders), stats, profile,
                             developer (RSSI listesi + demo anahtarları)
  lib/widgets/common.dart    Halka grafik, ilerleme çubuğu, etiket (grafik paketi yok)
  assets/images/             cbu_logo.png, cbu_emblem.png (uygulama simgeleri de amblemden üretildi)
  android/app/src/main/AndroidManifest.xml
  android/app/src/main/kotlin/com/example/attendance_system/
    BeaconApp.kt             Application sınıfı; AltBeacon ile arka plan tarama, bildirimler
    MainActivity.kt          Flutter <-> Kotlin köprüsü (MethodChannel/EventChannel)
    StudentKeyStore.kt       Gizli HMAC anahtarı: üretme, Android Keystore'a aktarma, sign()
    AttendanceCode.kt        Aşama 3 öğrenci kodu S (msg_s bayt düzeni + sign())
    CheckInClient.kt         Aşama 3 `checkIn` callable çağrısı ve yanıt yorumlama (Result)
  android/app/src/test/kotlin/.../  JUnit birim testleri (bilgisayarda çalışır, Keystore yok)
functions/                   Aşama 3 Cloud Functions (Node.js)
  codes.js                   T, C, S hesabı ve doğrulaması (Firebase'siz, saf hesap)
  test/codes.test.js         protocol.md test vektörleri (node:test, ek paket yok)
web/                         Öğretmen paneli (HTML/JS, Firebase JS SDK v8, SheetJS ile Excel).
                             Açık tema + CBÜ laciverti. Görünümler: Genel Bakış, Derslerim,
                             Öğrenciler (liste, ekle/sil), Aktif Yoklama (öğrenci kartları), Uyarılar;
                             öğrenci detay penceresi (Cihazı sıfırla).
                             app.js'te tüm DB işlemleri `Store` üzerinden; `?demo=1` ile bellekteki
                             örnek verilerle açılır, Firebase'e bağlanmaz/yazmaz, config.js gerekmez.
                             RFID kaldırıldı (kapsam dışı).
firebase/database.json       Örnek başlangıç verisi
firebase/database.rules.json RTDB kuralları (Console → Realtime Database → Kurallar'a elle yapıştırılır)
ml/ml_pipeline/              Visual Studio çözümü (ml_pipeline.slnx)
  ml_pipeline/               collect_data, train (DecisionTree), live_prediction,
                             anomaly_detection, start_system.bat, model.pkl, rssi_dataset.csv,
                             firebase_credentials.json (git'te yok; scriptler anahtarı kendi
                             klasöründe arar)
docs/                        Proje öneri formu, grafikler; protocol.md (Aşama 3 protokolü).
                             Rapor dosyaları (report_*.docx, figures/, xlsx) commit edilmiyor
```

Arduino IDE her `.ino` dosyasının kendi adını taşıyan klasörde olmasını ister; yeni bir sketch
eklerken `esp32/<ad>/<ad>.ino` düzenini koru.

## Sabitler (her yerde aynı olmalı)

| Ne | Değer |
|---|---|
| iBeacon UUID | `6f1d3b2a-8c4e-4a7f-9b21-5d3e8a9c0f47` |
| iBeacon major | Sınıf numarası (örn. 203). 0–65535 arası **sayı** olmalı |
| iBeacon minor | Aşama 1'de sabit `1`; Aşama 3'te dönen sınıf kodu C olacak |
| Aşama 3 zaman dilimi (taslak) | 30 sn, `T = floor(unix/30)`; sunucu toleransı ±1 dilim |
| Aşama 3 gönderim aralığı (taslak) | Telefon en az 60 sn'de bir `checkIn` çağırır; panel 150 sn'den eski `lastSeen`'i "sınıfta değil" sayar |
| Aşama 3 anahtarları (taslak) | Sınıf anahtarı dersliğe ayrı, `RoomSecrets/{room}` + ESP32 `config.h`; öğrenci anahtarı `StudentSecrets/{uid}` |
| ESP32 yayın aralığı | 100 ms (`0xA0`) |
| Firebase proje ID | `otomatik-yoklama-takip-sistemi` |
| RTDB URL | `https://otomatik-yoklama-takip-sistemi-default-rtdb.europe-west1.firebasedatabase.app/` |
| Cloud Functions bölgesi | `europe-west1` (planlanan); fonksiyon: callable `checkIn` (taslak) |
| Android paket adı | `com.example.attendance_system` (Dart paket adı `attendance_system`) |
| Flutter kanalları | `attendance/beacon` (MethodChannel), `attendance/beacon_events` (EventChannel), `attendance/student_key` (MethodChannel: status, createKey, deleteKey) |

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
- Bildirim kanalları: `beacon_service` (düşük önem), `beacon_event` (yüksek önem).
- Dart'ta platform kanalından gelen listeler sabit uzunlukta: üzerine ekleme yapılacaksa
  `List<String>.from(...)` ile kopyala (daha önce bu yüzden hata alındı).

## Flutter notları (giriş akışı)

- `StudentService.authChanges` bir kez oluşturulan bir alan (`late final`), getter değil.
  `FirebaseAuth.authStateChanges()` her çağrıda yeni akış döndürür; `StreamBuilder` yeni akış
  görünce baştan başlar, bir an "Yükleniyor" ekranı çizer ve açık olan kayıt formunu kapatır.
- `AuthGate`'te `StreamBuilder` dışta, `registering`'i dinleyen `ValueListenableBuilder` içte
  olmalı. Kayıt sürerken de `AuthScreen` gösterilir, çünkü Firebase kullanıcıyı profil yazılmadan
  "giriş yaptı" sayar; form kapanırsa kayıt hatası (or. numara kullanımda) kaybolur.
  Bu iki hata önce sadece telefonda görüldü (derleme/analiz yakalamadı).

## Arayüz notları

- Ders programı, istatistikler ve geçmiş yoklamalar için veritabanında henüz düğüm yok; ekranlar
  **demo modunda** örnek veriyle dolar (mobil: Profil → Geliştirici → "Demo verilerini göster";
  web: `?demo=1`). Ekranda "DEMO" etiketi yok (kullanıcı kararı); rapordaki şekil açıklamalarında
  örnek veri olduğu belirtilmeli. Demo verisindeki öğrenci adları kurgusal.
- Mobilde giriş/çıkış ve sınıf bilgisi beacon'dan gerçek; ders adı/program demo.
- Yeni grafik/görsel paketi eklenmedi (compileSdk riski); grafikler CustomPainter / CSS ile.
- `.gitignore`'daki genel `*.png` kuralı `ml/**/*.png` yapıldı; eskiden uygulama simgeleri
  hiç commit edilmediği için yeni klonda Android derlemesi "ic_launcher not found" veriyordu.
- iOS'ta katılım süresi: bölge izleme sınıfa girişte uygulamayı uyandırır, ders süresince arka
  plan konum oturumu (düşük hassasiyet) açılarak ranging sürdürülür, çıkışta kapatılır; oturum
  kesilirse giriş-çıkış zamanından yedek hesap (karar 2026-11-22, Mac ile denenmedi).

## Geliştirme ortamı (Windows)

Mobil uygulamayı Talha derliyor; aşağıdaki Flutter/Android ayrıntıları onun bilgisayarı için.
Samet'in bilgisayarında (`C:\projeler\Otomatik-Yoklama-Takip-Sistemi`) Flutter kurulu değil;
orada web paneli, ESP32 ve ML scriptleri üzerinde çalışılıyor (Python 3.10, firebase_admin kurulu).

- Flutter 3.47.6 stable, `C:\flutter` (Git ile kuruldu). Path: `C:\flutter\bin`.
- Android Studio Rabbit 1; Gradle 9.3.1, Android Gradle Plugin 9.1.0 → **compileSdk en fazla 36**.
- `permission_handler` **^12.0.1'e sabitlendi**: 13.x compileSdk 37 istiyor, AGP 9.1 desteklemiyor.
  Yeni paket eklerken aynı tür compileSdk uyumsuzluğuna dikkat et.
- Firebase: `firebase_core ^5.2.0`, `firebase_auth ^7.1.0`; Gradle eklentisi
  `com.google.gms.google-services 4.4.4`. `google-services.json` → `mobile/android/app/` (git'te yok).
  Firebase'de kayıtlı uygulamalar: Android `com.example.attendance_system`, web `YoklamaWeb`.
- `android/gradle.properties`'te `kotlin.incremental=false`: proje D:, pub önbelleği C:
  sürücüsünde olduğu için Kotlin "Could not close incremental caches" hatası veriyordu.
- NDK 28.2.13676358 SDK Manager'dan elle kuruldu (otomatik kurulum başarısız olmuştu).
- Test telefonu: Samsung Galaxy S24 Ultra (SM-S928B), USB hata ayıklama açık.
- Emülatör kullanılamaz (Bluetooth yok); beacon testleri gerçek telefonda.
- Node.js 22.16 ve Firebase CLI 15.32 kurulu (Aşama 3 fonksiyonları ve Emulator için).
- Kotlin `firebase-functions` Firebase BoM **35.2.0** ile ekli; BoM sürümü FlutterFire'ın
  kullandığıyla aynı olmalı (firebase_core yükseltilirse buna da bak). JUnit testlerinde
  Android sınıfları (or. `FirebaseFunctionsException.Code`) çalışmaz; test edilecek mantık
  Android'e bağlı olmayan fonksiyonlara ayrılmalı.
- Repo uzun yol sorununa karşı kısa bir yolda tutulmalı; `git config --global core.longpaths true`.
- Flutter projesini kopyalarken `build/`, `.dart_tool/`, `.gradle/`, `.idea/`, `local.properties`
  hariç tutulmalı (Windows 260 karakter yol sınırı).

## Çalıştırma

```bash
cd mobile
flutter pub get
flutter run            # telefon USB ile bağlı olmalı; terminalde r = hot reload, R = hot restart
```
Web paneli: `web/config.js` gerekli. Proje kökünde
`python -m http.server 8000 --bind 127.0.0.1 --directory web` → http://localhost:8000
(`.claude/launch.json`'da `web-panel` olarak da tanımlı). Dosyayı çift tıklayıp `file://` ile açma.

Birim testleri:
```bash
cd mobile/android && ./gradlew.bat :app:testDebugUnitTest   # Kotlin (rapor: mobile/build/app/reports/tests/)
node --test functions/test/codes.test.js                     # proje kökünde, sunucu kod hesabı
```
`node --test` klasör adıyla değil dosya adıyla verilmeli (Node 22 klasörü dosya sanıyor).

ESP32: Arduino IDE → `esp32/beacon/beacon.ino` → Board: ESP32 Dev Module → Port: COM9 → Upload →
Serial Monitor 115200. Doğrulama: Android'de nRF Connect uygulamasında "iBeacon" görünmeli
(iPhone'da nRF Connect iBeacon'ları göstermez).

## Mevcut veritabanı düğümleri (web paneli bunları kullanıyor, formatı bozma)

**Taşıma (2026-11-18):** Canlı veritabanındaki Türkçe düğümler (`Ogretmenler, Siniflar,
Ogrenciler, Varlik, Sistem, ML_Tahmin, RFID_Kartlar`) alan adları ve durum değerleri de çevrilerek
aşağıdaki İngilizce düğümlere kopyalandı (`isim→name, sifre→password, dersler→courses,
durum→status, SINIFTA→IN_CLASS, AKTIF→ACTIVE, ders→course, rfid_izin→rfid_permission,
sinif_ici→in_class, zaman→time`). Türkçe düğümler henüz SİLİNMEDİ; yedek
`firebase/backups/` altında (git'te yok). `MLKomut` ve `MLSonuclar`'ı repodaki hiçbir kod
kullanmıyor (ekip arkadaşının yerel kodu olabilir); taşınmadı. Türkçe düğümler 2026-11-24'te
kurallardan çıkarıldı.

- `TeacherAccounts/{uid}`: `"username"` — öğretmenin Firebase Auth hesabını `Teachers/{username}`
  profiline bağlar. Sadece Console'dan elle eklenir (kurallarda yazma kapalı). Kurallar
  "öğretmen mi?" kontrolünü bu düğümle yapar.
- `Teachers/{username}`: `{ name, courses[] }`. Panel giriş için artık Firebase Auth
  (e-posta/şifre) kullanıyor; eski `password` alanı 2026-11-18'de canlıdan silindi.
- `Classrooms`: dizi, örn. `["203","204","205","Amfi 1","Lab 2"]` (beacon için sayı olmalı)
- `Students/{studentNo}`: `"Ad Soyad"` (düz string)
- `Presence/{classroom}/{studentNo}`: `{ status: "IN_CLASS" | "ABSENT" | ..., mac, rssi, manual?, checkInTime, leaveTime }`
  Panel `status === "IN_CLASS"` olanları "var" sayar; 20 sn'de bir örnekleyip katılım yüzdesi
  hesaplar; nihai VAR = girişte var + çıkışta var + %70 üzeri.
- `System/{classroom}`: `{ status: "ACTIVE" | "EXIT", course, rfid_permission, lastReadCard }`
- `MLPrediction/{classroom}/{studentNo}`: `{ in_class, time }` (live_prediction.py yazar)
- `RFIDCards/{uid}`: studentNo

Aşama 2 ile eklenen (mobil uygulama yazar; `{uid}` = Firebase Auth uid):

- `StudentAccounts/{uid}`: `{ studentNo, name, email, createdAt, keyCreatedAt? }` — sadece sahibi okur/yazar.
- `StudentNumbers/{studentNo}`: uid — bir numara tek hesaba; kayıtta transaction ile alınır.
- `StudentSecrets/{uid}`: `{ key (base64, 32 byte), createdAt }` — **kimse okuyamaz** (sadece Admin
  SDK / Cloud Functions), bir kez yazılır. Yazmak için profilde numara olmalı ve
  `StudentNumbers/{o numara}` bu uid'i göstermeli (yarım kalmış hesaplar anahtar yazamaz).
  Telefon değiştiren öğrenci için öğretmen panelinde öğrenci detayı → **"Cihazı sıfırla"**:
  `StudentNumbers/{no}` → uid bulunur, bu düğüm ve `StudentAccounts/{uid}/keyCreatedAt` silinir;
  öğrenci yeni telefondan girince uygulama yeni anahtar üretir, eski telefonun anahtarı geçersiz
  kalır. Aynı telefonda sıfırlanırsa `prepareDevice` (uygulama açılışı) telefonda anahtar olduğu
  hâlde `keyCreatedAt` yoksa eski anahtarı silip yenisini üretir. Bu kontrol arka plandaki Kotlin
  taramasında yok: Aşama 3'te sunucu "anahtar yok" derse Kotlin de aynı yenilemeyi yapmalı. Kurallar öğretmene bu iki yerde **sadece silme** izni verir (okuma/yazma yok). Bir
  öğrenciyi silerken üst düğümü değil, altındaki uid'i sil.
- Cloud Functions (Aşama 3) öğrenciyi uid → `StudentAccounts.studentNo` → `StudentNumbers`
  zinciriyle doğrulamalı; `StudentSecrets`'ın varlığı tek başına yeterli değil.
- Cihaz eşleştirme: bir telefon tek öğrenciye bağlı (Kotlin `bound_uid`), bir hesap tek telefona
  bağlı (`keyCreatedAt`). Çıkış yapmak anahtarı silmez.

## Güvenlik — dikkat

- `firebase_credentials.json` (servis hesabı, eski adı `firebase_kimlik.json`), `config.h`,
  `config.js`, `google-services.json` **asla commit edilmez** (`.gitignore`'da). Commit öncesi
  `git status` ile kontrol et.
- Yerel ayar dosyaları örneklerinden kopyalanır: `web/config_example.js` → `web/config.js`,
  `esp32/legacy_gatt/config_example.h` → `config.h`. Servis hesabı anahtarı Firebase Console →
  Proje ayarları → Hizmet hesapları'ndan indirilip `ml/ml_pipeline/ml_pipeline/firebase_credentials.json`
  olarak konur. Anahtar listesi/silme: Google Cloud Console → IAM → Hizmet hesapları →
  `firebase-adminsdk-fbsvc@...` → Anahtarlar.
- **Repo 2026-11-18'de sıfırlandı:** Eski public repo (geçmişinde servis hesabı anahtarı ve
  `esp32/config.h` ile Wi-Fi şifresi vardı) silindi; aynı adla yeni repo açıldı ve proje tek
  commit (`bbf2ab4`) olarak gönderildi. Repo CV'de linkli olduğu için yine **public**: her
  commit herkese açık, gizli bilgi girmemeli. Eski yerel kopyalar eski geçmişi taşıyor: onlardan
  push/force-push yapılmaz, yeni repo baştan klonlanır, gizli dosyalar elle kopyalanır.
  Aynı gün yeni servis hesabı anahtarı oluşturuldu (sızan anahtar Google Cloud'da silinmiş),
  ev Wi-Fi'nin adı ve şifresi değiştirildi.
- Web paneli Firebase Auth ile giriş yapıyor (2026-11-18). Kurallarda panel düğümlerini sadece
  `TeacherAccounts`'ta kaydı olan kullanıcılar okuyabilir; `Teachers`, `Classrooms`,
  `MLPrediction`, `RFIDCards` istemciden yazılamaz (Console / Admin SDK). Eski Türkçe düğümlerin
  kuralı yok, yani tamamen kapalı. `MLKomut` / `MLSonuclar` da 2026-11-24'ten beri kapalı (onları yazan kod kayıp).
  Eski `legacy_gatt` ESP32 kodu anonim girişle (`Firebase.signUp(..., "", "")`, her açılışta yeni
  hesap) `Presence`/`System`'e yazıyordu; yeni kurallarla yazamaz. Anonymous giriş 2026-11-18'de
  Firebase'de kapatıldı, birikmiş 990 anonim hesap silindi. Tekrar açılmamalı. Aşama 3'te yazma Cloud Functions (Admin SDK) ile olacak.

## Eski koddaki bilinen sorunlar (yeni sistemde kullanılmıyor ama referans)

- `esp32/legacy_gatt/legacy_gatt.ino`: `lastReadRssi` hiç güncellenmiyor; `onWrite` numarayı son
  bağlanan cihazla eşleştiriyor (yarış durumu); RFID SPI pinleri (test: 25/26/27) RGB LED
  pinleriyle çakışıyor. `config.h`'ı aynı klasörde arar.
- ML modeli ESP32'nin ölçtüğü RSSI ile eğitildi; yeni mimaride RSSI'yi telefon ölçüyor, model
  yeniden eğitilmeli. `train_test_split` zaman serisini karıştırıyor (doğruluk iyimser).

## Kod stili

- **Dosya/klasör adları, değişken/fonksiyon/sınıf adları, veritabanı düğüm ve alan adları,
  paket ve kanal adları İngilizce.** (Ekip kararı.)
- Kod yorumları Türkçe; C/Kotlin yorumlarında Türkçe karakter yerine ASCII tercih edilmiş.
- Kullanıcıya görünen metinler (ekran, bildirim, panel) Türkçe ve Türkçe karakterli.
- Kullanıcıyla Türkçe konuş. Kullanıcı yeni başlayan; komutları ve dosya yollarını açıkça ver.
