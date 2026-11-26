// docs/protocol.md bolum 11'deki test vektorleri. Bu anahtarlar sadece testtir.
// Calistirma (proje kokunde): node --test functions/test/codes.test.js

const test = require("node:test");
const assert = require("node:assert");
const codes = require("../codes");

// 00 01 ... 1f ve 20 21 ... 3f
const roomKey = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const studentKey = Buffer.from(Array.from({ length: 32 }, (_, i) => 0x20 + i));
const major = 203;
const unix = 1795528800;

test("zaman dilimi", () => {
  assert.strictEqual(codes.slotOf(unix), 59850960);
  assert.strictEqual(codes.slotOf(unix + 29), 59850960); // ayni dilim
  assert.strictEqual(codes.slotOf(unix + 30), 59850961); // sonraki dilim
});

test("sinif mesaji ve sinif kodu", () => {
  assert.strictEqual(codes.classMessage(major, 59850960).toString("hex"), "434c5300cb00000000039140d0");
  assert.strictEqual(codes.classCode(roomKey, major, 59850960), 10803);
  assert.strictEqual(codes.classCode(roomKey, major, 59850959), 8513);
  assert.strictEqual(codes.classCode(roomKey, major, 59850961), 58728);
});

test("ogrenci mesaji ve ogrenci kodu", () => {
  assert.strictEqual(codes.studentMessage(major, 10803).toString("hex"), "53545500cb2a33");
  assert.strictEqual(
    codes.studentCode(studentKey, major, 10803).toString("base64"),
    "fZiOgYKmw3MlUfv60Q0P2AYUY/xXHgnusZfjyFhgFPU="
  );
});

test("sinif kodu +-1 dilim toleransi", () => {
  assert.strictEqual(codes.matchClassCode(roomKey, major, 10803, unix), 59850960);
  assert.strictEqual(codes.matchClassCode(roomKey, major, 8513, unix), 59850959); // telefon 1 dilim geride
  assert.strictEqual(codes.matchClassCode(roomKey, major, 58728, unix), 59850961); // ESP32 saati 1 dilim ileride
  assert.strictEqual(codes.matchClassCode(roomKey, major, 10803, unix + 60), null); // 2 dilim eski: red
  assert.strictEqual(codes.matchClassCode(roomKey, 204, 10803, unix), null); // baska derslik: red
});

test("ogrenci kodu dogrulama", () => {
  const good = "fZiOgYKmw3MlUfv60Q0P2AYUY/xXHgnusZfjyFhgFPU=";
  assert.strictEqual(codes.verifyStudentCode(studentKey, major, 10803, good), true);
  assert.strictEqual(codes.verifyStudentCode(studentKey, major, 8513, good), false); // farkli C
  assert.strictEqual(codes.verifyStudentCode(roomKey, major, 10803, good), false); // farkli anahtar
  assert.strictEqual(codes.verifyStudentCode(studentKey, major, 10803, "abc"), false); // kisa
});

test("aralik disi degerler reddedilir", () => {
  assert.throws(() => codes.classMessage(65536, 1), RangeError);
  assert.throws(() => codes.studentMessage(203, -1), RangeError);
  assert.throws(() => codes.studentMessage(203, 1.5), RangeError);
});
