// checkIn karar mantigi, bellekteki sahte veritabaniyla (Firebase gerekmez).
// Anahtarlar docs/protocol.md bolum 11'deki TEST anahtarlaridir.
// Calistirma (proje kokunde): node --test functions/test/checkin.test.js

const test = require("node:test");
const assert = require("node:assert");
const codes = require("../codes");
const { checkIn, MAX_FAILURES_PER_DAY, dayKey } = require("../checkin");

const ROOM_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const STUDENT_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => 0x20 + i));
const UID = "uid-ali";
const NO = "232804009";
const NOW_MS = 1795528800 * 1000;          // dilim T = 59850960, C = 10803
const T = 59850960;
const TODAY = dayKey(NOW_MS);

/** Yol tabanli sahte veritabani: { "A/B/C": deger } yerine ic ice nesne tutar. */
function fakeDb(initial) {
  const root = JSON.parse(JSON.stringify(initial));
  const parts = (path) => path.split("/");
  const get = (path) => parts(path).reduce((node, key) => (node == null ? null : node[key] ?? null), root);
  const set = (path, value) => {
    const keys = parts(path);
    let node = root;
    for (const key of keys.slice(0, -1)) node = node[key] ??= {};
    node[keys.at(-1)] = value;
  };
  return {
    root,
    get: async (path) => structuredClone(get(path)),
    update: async (path, obj) => { for (const [k, v] of Object.entries(obj)) set(`${path}/${k}`, v); },
    transaction: async (path, fn) => set(path, fn(get(path))),
  };
}

function baseData() {
  return {
    StudentAccounts: { [UID]: { studentNo: NO, name: "Ali", email: "a@b.c" } },
    StudentNumbers: { [NO]: UID },
    StudentSecrets: { [UID]: { key: STUDENT_KEY.toString("base64"), createdAt: 1 } },
    RoomSecrets: { 203: { key: ROOM_KEY.toString("base64"), createdAt: 1 } },
    System: { 203: { status: "ACTIVE", course: "SE 3114" } },
  };
}

/** Telefonun gonderecegi istek (dogru kodlarla). */
function request(classCode = 10803, overrides = {}) {
  return {
    room: 203,
    classCode,
    studentCode: codes.studentCode(STUDENT_KEY, 203, classCode).toString("base64"),
    rssi: -67,
    ...overrides,
  };
}

const call = (db, data, opts = {}) =>
  checkIn({ uid: "uid" in opts ? opts.uid : UID, data, nowMs: opts.nowMs ?? NOW_MS, db });
const rejects = (promise, code, reason) => assert.rejects(promise, (e) => e.code === code && e.reason === reason);

test("dogru istek Presence'a yazilir", async () => {
  const db = fakeDb(baseData());
  assert.deepStrictEqual(await call(db, request()), { result: "ok" });
  assert.deepStrictEqual(db.root.Presence[203][NO], {
    status: "IN_CLASS", rssi: -67, lastSeen: NOW_MS, lastSlot: T, checkInTime: NOW_MS,
  });
});

test("ayni dilim ikinci kez yazilmaz, sonraki dilim yazilir; checkInTime korunur", async () => {
  const db = fakeDb(baseData());
  await call(db, request());
  assert.deepStrictEqual(await call(db, request(), { nowMs: NOW_MS + 5000 }), { result: "duplicate" });

  const later = NOW_MS + 60000;            // 2 dilim sonra, yeni sinif kodu
  const c = codes.classCode(ROOM_KEY, 203, T + 2);
  assert.deepStrictEqual(await call(db, request(c), { nowMs: later }), { result: "ok" });
  const p = db.root.Presence[203][NO];
  assert.strictEqual(p.lastSeen, later);
  assert.strictEqual(p.lastSlot, T + 2);
  assert.strictEqual(p.checkInTime, NOW_MS);
});

test("+-1 dilim saat farki kabul edilir, 2 dilim eski kod reddedilir", async () => {
  const db = fakeDb(baseData());
  assert.deepStrictEqual(await call(db, request(8513)), { result: "ok" });   // T-1
  await rejects(call(db, request(10803), { nowMs: NOW_MS + 60000 }), "permission-denied", "bad-code");
});

test("ders yoksa yazilmaz", async () => {
  const data = baseData();
  delete data.System;
  const db = fakeDb(data);
  assert.deepStrictEqual(await call(db, request()), { result: "no-session" });
  assert.strictEqual(db.root.Presence, undefined);
});

test("cikis yoklamasinda (EXIT) de yazilir", async () => {
  const data = baseData();
  data.System[203].status = "EXIT";
  assert.deepStrictEqual(await call(fakeDb(data), request()), { result: "ok" });
});

test("giris yoksa reddedilir", async () => {
  await rejects(call(fakeDb(baseData()), request(), { uid: undefined }), "unauthenticated", "unauthenticated");
});

test("hatali alanlar reddedilir", async () => {
  const db = fakeDb(baseData());
  for (const bad of [null, {}, request(10803, { room: "203" }), request(10803, { classCode: 70000 }), request(10803, { rssi: -67.5 }),
    request(10803, { studentCode: "abc" })]) {
    await rejects(call(db, bad), "invalid-argument", "invalid-argument");
  }
});

test("ogrenci zinciri tutmazsa reddedilir (baskasinin numarasi / yarim hesap)", async () => {
  const data = baseData();
  data.StudentNumbers[NO] = "baska-uid";
  await rejects(call(fakeDb(data), request()), "permission-denied", "not-student");
  const half = baseData();
  delete half.StudentAccounts[UID].studentNo;
  await rejects(call(fakeDb(half), request()), "permission-denied", "not-student");
});

test("anahtari silinmis (cihazi sifirlanmis) ogrenci no-key alir", async () => {
  const data = baseData();
  delete data.StudentSecrets;
  await rejects(call(fakeDb(data), request()), "failed-precondition", "no-key");
});

test("anahtari olmayan derslik unknown-room, hatali deneme sayilmaz", async () => {
  const db = fakeDb(baseData());
  await rejects(call(db, request(10803, { room: 204 })), "failed-precondition", "unknown-room");
  assert.strictEqual(db.root.CheckInFailures, undefined);
});

test("yanlis sinif kodu ve yanlis ogrenci kodu ayni nedenle reddedilir ve sayilir", async () => {
  const db = fakeDb(baseData());
  await rejects(call(db, request(12345)), "permission-denied", "bad-code");                 // C yanlis
  const wrongS = request(10803, { studentCode: request(8513).studentCode });              // S yanlis
  await rejects(call(db, wrongS), "permission-denied", "bad-code");
  assert.strictEqual(db.root.CheckInFailures[UID][TODAY], 2);
  assert.strictEqual(db.root.Presence, undefined);
});

test("gunluk hatali deneme siniri dolunca dogru kod da reddedilir; ertesi gun acilir", async () => {
  const db = fakeDb(baseData());
  for (let i = 0; i < MAX_FAILURES_PER_DAY; i++) {
    await rejects(call(db, request(i)), "permission-denied", "bad-code");
  }
  await rejects(call(db, request()), "resource-exhausted", "too-many-failures");
  assert.strictEqual(db.root.CheckInFailures[UID][TODAY], MAX_FAILURES_PER_DAY);

  const nextDay = NOW_MS + 24 * 3600 * 1000;
  const c = codes.classCode(ROOM_KEY, 203, codes.slotOf(nextDay / 1000));
  assert.deepStrictEqual(await call(db, request(c), { nowMs: nextDay }), { result: "ok" });
});

test("elle eklenmis kayit uzerine yazilinca manual isareti korunur", async () => {
  const data = baseData();
  data.Presence = { 203: { [NO]: { status: "IN_CLASS", manual: true } } };
  const db = fakeDb(data);
  assert.deepStrictEqual(await call(db, request()), { result: "ok" });
  assert.strictEqual(db.root.Presence[203][NO].manual, true);
  assert.strictEqual(db.root.Presence[203][NO].lastSlot, T);
});
