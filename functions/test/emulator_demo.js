// Emulator'da canli gosterim: panel + checkIn fonksiyonu + sahte telefonlar.
// Gercek Android telefon ve ESP32 olmadan Asama 3 zincirinin sunucu + panel kismini gosterir.
// Canli Firebase'e DOKUNMAZ. Kullanilan sifre/anahtarlar sadece Emulator icindir.
//
// 1. terminal (proje kokunde):  firebase emulators:start --only auth,database,functions
// 2. terminal (proje kokunde):  node functions/test/emulator_demo.js
// 3. panel:                     python -m http.server 8000 --bind 127.0.0.1 --directory web
//                               -> http://localhost:8000/?emulator=1  (betigin yazdigi hesapla gir)
// Panelde Derslik 203'te yoklamayi baslat: sahte telefonlar 30 sn'de bir checkIn gonderir.
// Ucuncu ogrencinin telefonu 3 dk sonra susar; panel onu 2,5 dk sonra "Ayrildi" gosterir.

const codes = require("../codes");

const PROJECT = "otomatik-yoklama-takip-sistemi";
const NS = `${PROJECT}-default-rtdb`;
const AUTH = "http://127.0.0.1:9099";
const DB = "http://127.0.0.1:9000";
const FN = `http://127.0.0.1:5001/${PROJECT}/europe-west1/checkIn`;

// Protokol TEST anahtari: esp32/beacon/config_example.h ile ayni (ESP32 de bu kodu yayinlar)
const ROOM_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const TEACHER = { email: "ogretmen@emulator.test", password: "emulator-ogretmen", username: "emulator_teacher" };
const COURSE = "SE 3114 - Profesyonel Yazılım Geliştirme";
const STUDENTS = [
  { no: "232800001", name: "Deneme Öğrenci Bir", stopAfterMin: null },
  { no: "232800002", name: "Deneme Öğrenci İki", stopAfterMin: null },
  { no: "232800003", name: "Deneme Öğrenci Üç", stopAfterMin: 3 },   // telefonu 3 dk sonra susar
];
const SEND_EVERY_MS = 30000;

const dbUrl = (path) => `${DB}/${path}.json?ns=${NS}`;
const asOwner = { Authorization: "Bearer owner", "Content-Type": "application/json" };

async function post(url, body, headers = { "Content-Type": "application/json" }) {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return res.json();
}

async function account(email, password) {
  const body = { email, password, returnSecureToken: true };
  const created = await post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator`, body);
  if (created.idToken) return created;
  // Betik ikinci kez calistirildiysa hesap zaten var: giris yap
  return post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`, body);
}

async function patch(data) {
  await fetch(dbUrl(""), { method: "PATCH", headers: asOwner, body: JSON.stringify(data) });
}

async function main() {
  try {
    await fetch(`${AUTH}/`);
  } catch {
    console.error("Emulator calismiyor. Once: firebase emulators:start --only auth,database,functions");
    process.exit(1);
  }

  // Ogretmen
  const teacher = await account(TEACHER.email, TEACHER.password);
  await patch({
    [`TeacherAccounts/${teacher.localId}`]: TEACHER.username,
    [`Teachers/${TEACHER.username}`]: { name: "Emulator Öğretmen", courses: [COURSE] },
    Classrooms: ["203"],
    "RoomSecrets/203": { key: ROOM_KEY.toString("base64"), createdAt: Date.now() },
  });

  // Ogrenciler: Asama 2 kaydi (hesap + numara + anahtar) ve ogretmenin listesi
  const phones = [];
  for (const [i, s] of STUDENTS.entries()) {
    const acc = await account(`ogrenci${i + 1}@emulator.test`, "emulator-ogrenci");
    const key = Buffer.from(Array.from({ length: 32 }, (_, j) => (0x40 + i * 32 + j) % 256));
    await patch({
      [`Students/${s.no}`]: s.name,
      [`StudentAccounts/${acc.localId}`]: { studentNo: s.no, name: s.name, email: `ogrenci${i + 1}@emulator.test`, createdAt: Date.now() },
      [`StudentNumbers/${s.no}`]: acc.localId,
      [`StudentSecrets/${acc.localId}`]: { key: key.toString("base64"), createdAt: Date.now() },
    });
    phones.push({ ...s, idToken: acc.idToken, key });
  }

  console.log("Emulator hazir.");
  console.log(`  Panel: http://localhost:8000/?emulator=1`);
  console.log(`  Ogretmen girisi: ${TEACHER.email} / ${TEACHER.password}`);
  console.log("  Panelde Derslik 203'te yoklamayi baslatin. Durdurmak icin Ctrl+C.\n");

  const started = Date.now();
  async function tick() {
    const c = codes.classCode(ROOM_KEY, 203, codes.slotOf(Date.now() / 1000));
    const minutes = (Date.now() - started) / 60000;
    const line = [];
    for (const p of phones) {
      if (p.stopAfterMin !== null && minutes >= p.stopAfterMin) {
        line.push(`${p.no}: telefon sustu`);
        continue;
      }
      const data = {
        room: 203,
        classCode: c,
        studentCode: codes.studentCode(p.key, 203, c).toString("base64"),
        rssi: -60 - Math.floor(Math.random() * 15),
      };
      const res = await post(FN, { data }, { "Content-Type": "application/json", Authorization: `Bearer ${p.idToken}` });
      line.push(`${p.no}: ${res.result ? res.result.result : `${res.error.status} ${res.error.message}`}`);
    }
    console.log(`${new Date().toLocaleTimeString("tr-TR")}  C=${c}  ${line.join("  |  ")}`);
  }
  await tick();
  setInterval(tick, SEND_EVERY_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
