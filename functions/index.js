// Asama 3 Cloud Functions (docs/protocol.md bolum 6).
// checkIn: telefonun "sinifta duydugum kod + ogrenci kodum" istegini dogrulayip Presence'a yazar.
//
// - Callable (HTTPS) fonksiyon, TETIKLEYICI DEGIL: kendi yazdigi yol onu tekrar cagiramaz
//   (CLAUDE.md maliyet kurali 1).
// - Karar mantigi checkin.js'te (Firebase'siz, birim testli); burasi sadece baglar.
// - Yerelde: firebase emulators:start --only auth,database,functions (Blaze gerekmez).

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
// firebase-admin 14: eski "admin.database()" yazimi yok, moduller ayri yuklenir
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { checkIn, CheckInError } = require("./checkin");

initializeApp();

// europe-west1: veritabaniyla ayni bolge. maxInstances: beklenmedik yukte (or. kotu niyetli
// cagri seli) en fazla 10 kopya calisir, fatura kontrolsuz buyumez.
setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

/** checkin.js'in bekledigi { get, update, transaction } arayuzu, Admin SDK ile. */
function adminDb() {
  const db = getDatabase();
  return {
    get: async (path) => (await db.ref(path).get()).val(),
    update: (path, value) => db.ref(path).update(value),
    transaction: (path, fn) => db.ref(path).transaction(fn),
  };
}

exports.checkIn = onCall(async (request) => {
  try {
    return await checkIn({
      uid: request.auth ? request.auth.uid : undefined,
      data: request.data,
      nowMs: Date.now(),
      db: adminDb(),
    });
  } catch (e) {
    if (e instanceof CheckInError) throw new HttpsError(e.code, e.reason);
    console.error("checkIn: beklenmeyen hata", e);
    throw new HttpsError("internal", "internal");
  }
});
