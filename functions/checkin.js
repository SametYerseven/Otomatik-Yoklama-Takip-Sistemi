// Asama 3: checkIn fonksiyonunun karar mantigi (docs/protocol.md bolum 6).
// Firebase'e bagli degil: veritabani "db" nesnesiyle verilir ({ get, update, transaction }).
// Boylece bilgisayarda sahte veritabaniyla test edilir (test/checkin.test.js);
// index.js gercek veritabanini baglar.

const codes = require("./codes");

// Bir ogrencinin bir gunde (UTC) yapabilecegi hatali deneme sayisi. Asilinca o gun icin
// istekleri kontrol bile edilmeden reddedilir: sinif kodunu tahmin etmeye calisan biri
// ne sonuc alabilir ne de fonksiyon kotasini tuketebilir.
const MAX_FAILURES_PER_DAY = 10;

/** Istemciye donulecek hata. code: HttpsError kodu, reason: mesaj alanina yazilan neden. */
class CheckInError extends Error {
  constructor(code, reason) {
    super(reason);
    this.code = code;
    this.reason = reason;
  }
}

/** "2026-11-26" (UTC) */
function dayKey(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** 2. kontrol: alan turleri. S, 32 baytin base64'u: 43 karakter + "=". */
function isValidRequest(data) {
  return (
    data !== null &&
    typeof data === "object" &&
    codes.isUint16(data.room) &&
    codes.isUint16(data.classCode) &&
    typeof data.studentCode === "string" &&
    /^[A-Za-z0-9+/]{43}=$/.test(data.studentCode) &&
    Number.isInteger(data.rssi) &&
    data.rssi >= -127 &&
    data.rssi <= 20
  );
}

/**
 * Bir checkIn istegini degerlendirir. Basarili ya da "yazma yok" sonuclari nesne olarak
 * doner ({ result: "ok" | "no-session" | "duplicate" }); reddedilen istekte CheckInError atar.
 *
 * @param {object} p
 * @param {string|undefined} p.uid  Firebase girisinden gelen kullanici (yoksa giris yok)
 * @param {object} p.data           { room, classCode, studentCode, rssi }
 * @param {number} p.nowMs          sunucu zamani (ms)
 * @param {object} p.db             { get(path), update(path, obj), transaction(path, fn) }
 */
async function checkIn({ uid, data, nowMs, db }) {
  // 1. Giris
  if (!uid) throw new CheckInError("unauthenticated", "unauthenticated");

  // 2. Alan turleri
  if (!isValidRequest(data)) throw new CheckInError("invalid-argument", "invalid-argument");
  const room = String(data.room);

  // 3. uid -> StudentAccounts.studentNo -> StudentNumbers ayni hesabi gostermeli
  const studentNo = await db.get(`StudentAccounts/${uid}/studentNo`);
  if (typeof studentNo !== "string" || (await db.get(`StudentNumbers/${studentNo}`)) !== uid) {
    throw new CheckInError("permission-denied", "not-student");
  }

  // 4. Ogrencinin anahtari (ogretmen cihazi sifirladiysa yok; telefon anahtari yeniler)
  const studentKey = await db.get(`StudentSecrets/${uid}/key`);
  if (typeof studentKey !== "string") throw new CheckInError("failed-precondition", "no-key");

  // Dersligin anahtari yoksa derslik sisteme tanitilmamis (ogrencinin hatasi degil, sayilmaz)
  const roomKey = await db.get(`RoomSecrets/${room}/key`);
  if (typeof roomKey !== "string") throw new CheckInError("failed-precondition", "unknown-room");

  // Hatali deneme siniri
  const failurePath = `CheckInFailures/${uid}/${dayKey(nowMs)}`;
  if (((await db.get(failurePath)) || 0) >= MAX_FAILURES_PER_DAY) {
    throw new CheckInError("resource-exhausted", "too-many-failures");
  }

  // 5-6. Sinif kodu (T-1, T, T+1) ve ogrenci kodu. Ikisi de her zaman hesaplanir ve tek bir
  // "bad-code" nedeniyle reddedilir: deneyen kisi sinif kodunu dogru bilip bilmedigini
  // ne hata mesajindan ne de cevap suresinden anlayabilir.
  const slot = codes.matchClassCode(Buffer.from(roomKey, "base64"), data.room, data.classCode, Math.floor(nowMs / 1000));
  const studentOk = codes.verifyStudentCode(Buffer.from(studentKey, "base64"), data.room, data.classCode, data.studentCode);
  if (slot === null || !studentOk) {
    await db.transaction(failurePath, (count) => (count || 0) + 1);
    throw new CheckInError("permission-denied", "bad-code");
  }

  // 7. Derslikte ders suruyor mu? (ACTIVE: giris, EXIT: cikis yoklamasi)
  const status = await db.get(`System/${room}/status`);
  if (status !== "ACTIVE" && status !== "EXIT") return { result: "no-session" };

  // 8. Ayni ya da eski dilim tekrar yazilmaz (replay)
  const presencePath = `Presence/${room}/${studentNo}`;
  const current = (await db.get(presencePath)) || {};
  if (typeof current.lastSlot === "number" && current.lastSlot >= slot) return { result: "duplicate" };

  const update = { status: "IN_CLASS", rssi: data.rssi, lastSeen: nowMs, lastSlot: slot };
  if (typeof current.checkInTime !== "number") update.checkInTime = nowMs;
  await db.update(presencePath, update);
  return { result: "ok" };
}

module.exports = { checkIn, CheckInError, MAX_FAILURES_PER_DAY, dayKey, isValidRequest };
