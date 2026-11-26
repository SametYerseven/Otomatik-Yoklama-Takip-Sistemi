// Asama 3: sinif kodu (C) ve ogrenci kodu (S) hesaplari (docs/protocol.md bolum 3-4).
// ESP32 ve Kotlin ile birebir ayni olmali; test vektorleri: test/codes.test.js.
// Sadece hesap yapar: veritabani ya da Firebase bilgisi yok, bu yuzden kolay test edilir.

const crypto = require("crypto");

const SLOT_SECONDS = 30;

/** Unix zamanindan (saniye) zaman dilimi: T = floor(unix / 30). */
function slotOf(unixSeconds) {
  return Math.floor(unixSeconds / SLOT_SECONDS);
}

/** 0..65535 arasi tamsayi mi? (major, C) */
function isUint16(n) {
  return Number.isInteger(n) && n >= 0 && n <= 0xffff;
}

/** msg_c = "CLS" || major (2 bayt) || T (8 bayt), toplam 13 bayt, big-endian. */
function classMessage(major, slot) {
  if (!isUint16(major)) throw new RangeError("major 0-65535 olmali");
  const msg = Buffer.alloc(13);
  msg.write("CLS", 0, "ascii");
  msg.writeUInt16BE(major, 3);
  msg.writeBigUInt64BE(BigInt(slot), 5);
  return msg;
}

/** C = HMAC-SHA256(sinifAnahtari, msg_c) sonucunun ilk 2 bayti (0..65535). */
function classCode(roomKey, major, slot) {
  const h = crypto.createHmac("sha256", roomKey).update(classMessage(major, slot)).digest();
  return h.readUInt16BE(0);
}

/** msg_s = "STU" || major (2 bayt) || C (2 bayt), toplam 7 bayt, big-endian. */
function studentMessage(major, code) {
  if (!isUint16(major)) throw new RangeError("major 0-65535 olmali");
  if (!isUint16(code)) throw new RangeError("C 0-65535 olmali");
  const msg = Buffer.alloc(7);
  msg.write("STU", 0, "ascii");
  msg.writeUInt16BE(major, 3);
  msg.writeUInt16BE(code, 5);
  return msg;
}

/** S = HMAC-SHA256(ogrenciAnahtari, msg_s), 32 bayt. */
function studentCode(studentKey, major, code) {
  return crypto.createHmac("sha256", studentKey).update(studentMessage(major, code)).digest();
}

/**
 * Telefonun gonderdigi C'yi T-1, T, T+1 icin dener (saat toleransi +-1 dilim).
 * Eslesen dilimi (Tm) dondurur, eslesme yoksa null.
 */
function matchClassCode(roomKey, major, code, nowUnixSeconds) {
  const t = slotOf(nowUnixSeconds);
  for (const slot of [t, t - 1, t + 1]) {
    if (classCode(roomKey, major, slot) === code) return slot;
  }
  return null;
}

/**
 * Telefonun gonderdigi S'yi (base64) dogrular. Karsilastirma sabit zamanli
 * (timingSafeEqual): sure farkindan kac baytin dogru oldugu tahmin edilemesin.
 */
function verifyStudentCode(studentKey, major, code, studentCodeBase64) {
  const expected = studentCode(studentKey, major, code);
  const received = Buffer.from(studentCodeBase64, "base64");
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(received, expected);
}

module.exports = {
  SLOT_SECONDS,
  slotOf,
  isUint16,
  classMessage,
  classCode,
  studentMessage,
  studentCode,
  matchClassCode,
  verifyStudentCode,
};
