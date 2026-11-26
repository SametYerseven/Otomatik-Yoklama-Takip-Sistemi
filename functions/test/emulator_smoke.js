// Emulator'da uctan uca deneme: gercek checkIn fonksiyonu + veritabani + giris + kurallar.
// Telefonu taklit eder (protokol TEST anahtarlariyla). Canli Firebase'e DOKUNMAZ.
// Calistirma (proje kokunde, Java gerekir):
//   firebase emulators:exec --only auth,database,functions "node functions/test/emulator_smoke.js"

const codes = require("../codes");

const PROJECT = "otomatik-yoklama-takip-sistemi";
const NS = `${PROJECT}-default-rtdb`;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099"}`;
const DB = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST || "127.0.0.1:9000"}`;
const FN = `http://127.0.0.1:5001/${PROJECT}/europe-west1/checkIn`;

const ROOM_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const STUDENT_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => 0x20 + i));
const NO = "232804009";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "TAMAM" : "HATA "}  ${name}${ok ? "" : `  -> ${detail}`}`);
  if (!ok) failed++;
}

async function json(url, options = {}) {
  const res = await fetch(url, options);
  return { status: res.status, body: await res.json().catch(() => null) };
}

// Veritabani emulatorunde kurallari atlayan yonetici erisimi
const dbUrl = (path) => `${DB}/${path}.json?ns=${NS}`;
const asOwner = { Authorization: "Bearer owner", "Content-Type": "application/json" };

async function callCheckIn(idToken, data) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const { body } = await json(FN, { method: "POST", headers, body: JSON.stringify({ data }) });
  return body.result || { error: `${body.error.status}:${body.error.message}` };
}

function phoneRequest(classCode) {
  return {
    room: 203,
    classCode,
    studentCode: codes.studentCode(STUDENT_KEY, 203, classCode).toString("base64"),
    rssi: -67,
  };
}

async function main() {
  // 1) Ogrenci hesabi (Auth emulatoru)
  const signUp = await json(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "deneme@example.com", password: "deneme123", returnSecureToken: true }),
  });
  const { idToken, localId: uid } = signUp.body;
  check("emulatorde ogrenci hesabi acildi", !!idToken, JSON.stringify(signUp.body));

  // 2) Baslangic verisi: Asama 2 kaydi + derslik anahtari + acik ders
  await fetch(dbUrl(""), {
    method: "PUT",
    headers: asOwner,
    body: JSON.stringify({
      StudentAccounts: { [uid]: { studentNo: NO, name: "Deneme", email: "deneme@example.com", createdAt: 1 } },
      StudentNumbers: { [NO]: uid },
      StudentSecrets: { [uid]: { key: STUDENT_KEY.toString("base64"), createdAt: 1 } },
      RoomSecrets: { 203: { key: ROOM_KEY.toString("base64"), createdAt: 1 } },
      System: { 203: { status: "ACTIVE", course: "SE 3114" } },
    }),
  });

  // 3) Telefon gibi: su anki dilimin sinif kodunu "duyup" gonder
  const c = codes.classCode(ROOM_KEY, 203, codes.slotOf(Date.now() / 1000));
  const first = await callCheckIn(idToken, phoneRequest(c));
  check("dogru kod -> ok", first.result === "ok", JSON.stringify(first));

  const again = await callCheckIn(idToken, phoneRequest(c));
  check("ayni dilim tekrar -> duplicate", again.result === "duplicate", JSON.stringify(again));

  const presence = (await json(dbUrl(`Presence/203/${NO}`), { headers: asOwner })).body;
  check("Presence yazildi (IN_CLASS, lastSeen, lastSlot, checkInTime)",
    presence && presence.status === "IN_CLASS" && typeof presence.lastSeen === "number" &&
      typeof presence.lastSlot === "number" && typeof presence.checkInTime === "number",
    JSON.stringify(presence));
  check("lastSeen sunucu saatine yakin", presence && Math.abs(Date.now() - presence.lastSeen) < 60000,
    String(presence && presence.lastSeen));

  const wrong = await callCheckIn(idToken, phoneRequest((c + 1) % 65536));
  check("yanlis kod -> permission-denied: bad-code", wrong.error === "PERMISSION_DENIED:bad-code", JSON.stringify(wrong));

  const noAuth = await callCheckIn(null, phoneRequest(c));
  check("girissiz istek -> unauthenticated", String(noAuth.error).startsWith("UNAUTHENTICATED"), JSON.stringify(noAuth));

  // 4) Kurallar: istemci sinif anahtarlarini ve sayaci okuyamaz
  const asStudent = { Authorization: `Bearer ${idToken}` };
  for (const path of ["RoomSecrets", "CheckInFailures", `StudentSecrets/${uid}`]) {
    const res = await fetch(`${dbUrl(path)}&auth=${idToken}`, { headers: asStudent });
    check(`ogrenci ${path} okuyamaz`, res.status === 401 || res.status === 403, `HTTP ${res.status}`);
  }

  console.log(failed === 0 ? "\nUctan uca deneme: HEPSI TAMAM" : `\nUctan uca deneme: ${failed} HATA`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
