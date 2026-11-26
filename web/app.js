// ==========================================================================
// OTOMATIK YOKLAMA - OGRETMEN PANELI
// --------------------------------------------------------------------------
// Tum veritabani islemleri "Store" uzerinden yapilir. Adres cubuguna ?demo=1
// eklenirse Store bellekteki ornek verilerle calisir: Firebase'e hic baglanmaz,
// hicbir sey yazmaz (ekran goruntusu ve sunum icin).
// ==========================================================================
const DEMO = new URLSearchParams(location.search).has('demo');
const SAMPLE_MS = DEMO ? 4000 : 20000;   // otomatik yoklama ornekleme araligi
const PASS_PERCENT = 70;                  // nihai VAR icin gereken katilim yuzdesi
// Telefon sinifta kaldikca en az 60 sn'de bir checkIn gonderir; sunucu Presence'a lastSeen yazar.
// Son sinyal bundan eskiyse ogrenci "sinifta degil" sayilir (docs/protocol.md bolum 7).
const LAST_SEEN_LIMIT_MS = 150 * 1000;
const SEMESTER_WEEKS = 14;
const MAX_ABSENCE = 4;                    // 14 haftanin %30'u

// ---------------------------------------------------------------- Yardimcilar
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (name) => String(name || '?').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toLocaleUpperCase('tr-TR')).join('');
const pctColor = (p) => (p < PASS_PERCENT ? 'var(--red)' : p < 80 ? 'var(--warning)' : 'var(--success)');
const two = (n) => String(n).padStart(2, '0');
const fmtTime = (d) => `${two(d.getHours())}:${two(d.getMinutes())}`;
const fmtMinutes = (m) => (m < 60 ? `${m} dk` : `${Math.floor(m / 60)} sa ${m % 60} dk`);
const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

function toast(message, type = 'info') {
    const icons = { success: 'fa-circle-check', danger: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i> <span>${esc(message)}</span>`;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 350); }, 3200);
}

function emptyState(icon, text) {
    return `<div class="empty-state"><i class="fa-solid ${icon}"></i>${esc(text)}</div>`;
}

// ==========================================================================
// ORNEK VERI (sadece demo modunda kullanilir)
// ==========================================================================
const DemoData = {
    teacher: {
        name: 'Doç. Dr. Osman Altay',
        courses: [
            'SE 3114 - Nesnelerin İnterneti',
            'SE 4101 - Siber Güvenlik',
            'SE 3924 - Python Programlama',
            'SE 3252 - Nesne Yönelimli Programlama',
            'SE 4523 - Veri Madenciliği',
        ],
    },
    classrooms: ['203', '204', '205', '206'],
    // Haftalik program: ders kodu -> gun (0=Pazar), saat, derslik
    schedule: {
        'SE 3114': { day: 1, start: '09:00', end: '11:50', room: '203' },
        'SE 3924': { day: 1, start: '13:00', end: '14:50', room: '205' },
        'SE 4523': { day: 3, start: '13:00', end: '15:50', room: '203' },
        'SE 4101': { day: 4, start: '09:00', end: '10:50', room: '206' },
        'SE 3252': { day: 5, start: '10:00', end: '11:50', room: '204' },
    },
    // Kurgusal ogrenciler (gercek kisiler degil)
    students: {
        '232801011': 'Ahmet Yılmaz', '232801018': 'Zeynep Kaya', '232801025': 'Mehmet Demir',
        '232801032': 'Elif Şahin', '232801039': 'Can Öztürk', '232801046': 'Selin Arslan',
        '232801053': 'Burak Çelik', '232801060': 'Deniz Aydın', '232801067': 'Ece Koç',
        '232801074': 'Emre Kurt', '232801081': 'İrem Polat', '232801088': 'Kerem Aksoy',
        '232801095': 'Merve Yıldız', '232801102': 'Oğuz Erdem', '232801109': 'Pınar Güneş',
        '232801116': 'Serkan Taş', '232801123': 'Tuğba Kılıç', '232801130': 'Yusuf Bulut',
    },
    // Canli ders senaryosu: derste gecen ~45 dakikanin ozeti
    // ratio: katilim orani, state: su anki durum, ml: makine ogrenmesi "sinif ici" tahmini,
    // phoneOff: kaydi IN_CLASS ama telefonu 4 dk'dir sinyal gondermiyor (lastSeen kurali -> Ayrildi)
    live: {
        '232801011': { ratio: 1.00, state: 'in' }, '232801018': { ratio: 0.98, state: 'in' },
        '232801025': { ratio: 0.95, state: 'in' }, '232801032': { ratio: 1.00, state: 'in' },
        '232801039': { ratio: 0.62, state: 'in', phoneOff: true }, '232801046': { ratio: 0.97, state: 'in' },
        '232801053': { ratio: 0.38, state: 'left' }, '232801060': { ratio: 0.99, state: 'in' },
        '232801067': { ratio: 0.93, state: 'in', ml: false }, '232801074': { ratio: 0, state: 'absent' },
        '232801081': { ratio: 1.00, state: 'in' }, '232801088': { ratio: 0.88, state: 'in' },
        '232801095': { ratio: 0.96, state: 'in' }, '232801102': { ratio: 0.71, state: 'in' },
        '232801109': { ratio: 1.00, state: 'in' }, '232801116': { ratio: 0, state: 'absent' },
        '232801123': { ratio: 0.94, state: 'in' }, '232801130': { ratio: 0.55, state: 'left' },
    },
    // Ogrenci basina gecmis haftalardaki gelmeme sayisi (tum dersler icin ornek)
    missedWeeks: {
        '232801053': [1, 3, 6], '232801074': [0, 2, 4, 7], '232801116': [2, 5, 6],
        '232801130': [4, 7], '232801039': [5], '232801102': [3],
    },
    weeksHeld: 9,
    courseRates: { 'SE 3114': 91, 'SE 4101': 86, 'SE 3924': 78, 'SE 3252': 83, 'SE 4523': 68 },
};

// ==========================================================================
// STORE: gercek mod (Firebase) ve demo mod (bellek) icin ayni arayuz
// ==========================================================================
// config.js yoksa (yeni klon) gercek giris calismaz; sayfa yine acilir, giriste uyari verilir
const CONFIG_MISSING = !DEMO && typeof firebaseConfig === 'undefined';
// ?emulator=1: canli Firebase yerine bilgisayardaki Firebase Emulator'a baglanir (Asama 3 uctan uca
// deneme; bkz. functions/test/emulator_demo.js). Sadece localhost'ta calisir, yayindaki sitede yok sayilir.
const EMULATOR = !DEMO && new URLSearchParams(location.search).has('emulator')
    && ['localhost', '127.0.0.1'].includes(location.hostname);
const Store = DEMO ? createDemoStore() : CONFIG_MISSING ? null : createFirebaseStore();

function createFirebaseStore() {
    firebase.initializeApp(firebaseConfig);
    const db = firebase.database();
    const auth = firebase.auth();
    if (EMULATOR) {
        db.useEmulator('127.0.0.1', 9000);
        auth.useEmulator('http://127.0.0.1:9099');
        document.title = `[EMULATOR] ${document.title}`;
        document.addEventListener('DOMContentLoaded', () => {
            const tag = document.createElement('div');
            tag.textContent = 'EMULATOR: canlı veritabanı değil';
            tag.style.cssText = 'position:fixed;bottom:36px;right:12px;z-index:9999;background:#d02030;color:#fff;padding:6px 12px;border-radius:8px;font:600 13px sans-serif';
            document.body.appendChild(tag);
        });
    }
    const listeners = [];
    const on = (path, cb) => { const ref = db.ref(path); ref.on('value', (s) => cb(s.exists() ? s.val() : null)); listeners.push(ref); };

    // Bilgisayarin saati ile Firebase sunucu saati arasindaki fark (ms). lastSeen sunucu saatiyle
    // yazildigi icin "kac sn once" hesabi da sunucu saatiyle yapilir; bilgisayarin saati kaymis
    // olsa bile ogrenciler yanlislikla "yok" gorunmez. (.info herkese acik, kural gerekmez.)
    let serverOffset = 0;
    db.ref('.info/serverTimeOffset').on('value', (s) => { serverOffset = s.val() || 0; });

    return {
        serverNow: () => Date.now() + serverOffset,
        async signIn(email, pass) {
            // Sekme kapaninca oturum kapanir (sinif bilgisayari ortak kullanilabilir)
            await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
            const cred = await auth.signInWithEmailAndPassword(email, pass);
            // TeacherAccounts/{uid} = "kullanici_adi" -> Teachers/{kullanici_adi}
            const account = await db.ref(`TeacherAccounts/${cred.user.uid}`).once('value');
            if (!account.exists()) { await auth.signOut(); throw { code: 'not-teacher' }; }
            const teacher = await db.ref(`Teachers/${account.val()}`).once('value');
            if (!teacher.exists()) { await auth.signOut(); throw { code: 'no-profile' }; }
            const t = teacher.val();
            return { name: t.name, courses: t.courses || [] };
        },
        signOut: () => auth.signOut(),
        async classrooms() { const s = await db.ref('Classrooms').once('value'); return s.exists() ? s.val() : []; },
        onStudents: (cb) => on('Students', (v) => cb(v || {})),
        addStudent: (no, name) => db.ref(`Students/${no}`).set(name),
        deleteStudent: (no) => db.ref(`Students/${no}`).remove(),
        // Telefon degistiren ogrenci: sunucudaki anahtar kopyasi ve "anahtar olusturuldu"
        // isareti silinir. Ogrenci yeni telefondan girince uygulama yeni anahtar uretir.
        // Eski telefondaki anahtar sunucuda karsiligi kalmadigi icin artik ise yaramaz.
        // Kurallar ogretmene bu iki yerde SADECE silme izni verir (okuyamaz, yazamaz).
        async resetDevice(no) {
            const owner = await db.ref(`StudentNumbers/${no}`).once('value');
            if (!owner.exists()) return 'no-account';   // mobil uygulamada bu numarayla hesap yok
            const uid = owner.val();
            await db.ref().update({
                [`StudentSecrets/${uid}`]: null,
                [`StudentAccounts/${uid}/keyCreatedAt`]: null,
            });
            return 'reset';
        },
        async startSession(room, course) {
            await db.ref(`Presence/${room}`).remove();
            await db.ref(`System/${room}`).set({ status: 'ACTIVE', course });
        },
        onPresence: (room, cb) => on(`Presence/${room}`, (v) => cb(v || {})),
        onML: (room, cb) => on(`MLPrediction/${room}`, (v) => cb(v || {})),
        addManual: (room, no) => db.ref(`Presence/${room}/${no}`).set({ status: 'IN_CLASS', mac: 'Manuel-Giris', manual: true }),
        async keepOnly(room, kept) {
            await db.ref(`Presence/${room}`).set(kept);
            await db.ref(`System/${room}`).update({ status: 'EXIT' });
        },
        async endSession(room) {
            listeners.splice(0).forEach((r) => r.off());
            await db.ref(`System/${room}`).remove();
            await db.ref(`Presence/${room}`).remove();
        },
        // Gecmis ders kayitlari henuz veritabaninda tutulmuyor (Asama 3)
        history: () => null,
        schedule: () => null,
    };
}

function createDemoStore() {
    let students = { ...DemoData.students };
    let studentCb = () => {};
    let presence = {};
    let presenceCb = () => {};
    let ml = {};
    let mlCb = () => {};
    let heartbeat = null;
    const emitStudents = () => studentCb({ ...students });

    // Demo: sinifta olan telefonlar her 30 sn'de bir checkIn gonderiyormus gibi lastSeen'i
    // tazeler. Demo verisinde "phoneOff" olan ogrencinin telefonu giristen sonra susmus:
    // kaydi hala IN_CLASS ama lastSeen eski, panel onu "Ayrildi" gosterir.
    const sendHeartbeats = () => {
        for (const [no, p] of Object.entries(presence)) {
            if (p.status === 'IN_CLASS' && !p.manual && !DemoData.live[no]?.phoneOff) p.lastSeen = Date.now();
        }
        presenceCb({ ...presence });
    };

    return {
        serverNow: () => Date.now(),
        async signIn() { return DemoData.teacher; },
        async signOut() {},
        async classrooms() { return DemoData.classrooms; },
        onStudents(cb) { studentCb = cb; emitStudents(); },
        async addStudent(no, name) { students[no] = name; emitStudents(); },
        async deleteStudent(no) { delete students[no]; emitStudents(); },
        async resetDevice() { return 'reset'; },   // demo: hicbir sey silinmez
        async startSession() {
            presence = {}; ml = {};
            for (const [no, s] of Object.entries(DemoData.live)) {
                if (!students[no]) continue;
                if (s.state === 'in') {
                    presence[no] = {
                        status: 'IN_CLASS', rssi: -60 - (Number(no) % 17),
                        lastSeen: s.phoneOff ? Date.now() - 4 * 60000 : Date.now() - (Number(no) % 50) * 1000,
                    };
                }
                ml[no] = { in_class: s.ml !== false, time: fmtTime(new Date()) };
            }
            clearInterval(heartbeat);
            heartbeat = setInterval(sendHeartbeats, 30000);
        },
        onPresence(room, cb) { presenceCb = cb; cb({ ...presence }); },
        onML(room, cb) { mlCb = cb; cb({ ...ml }); },
        async addManual(room, no) { presence[no] = { status: 'IN_CLASS', manual: true }; presenceCb({ ...presence }); },
        async keepOnly(room, kept) { presence = { ...kept }; presenceCb({ ...presence }); },
        async endSession() { clearInterval(heartbeat); presence = {}; },
        history(courseCode, no) {
            const missed = DemoData.missedWeeks[no] || [];
            return Array.from({ length: DemoData.weeksHeld }, (_, w) => ({
                week: w + 1,
                present: !missed.includes(w),
                pct: missed.includes(w) ? (w % 2 ? 35 : 0) : 85 + ((w * 7 + Number(no.slice(-2))) % 15),
            }));
        },
        schedule: (courseCode) => DemoData.schedule[courseCode] || null,
        // Demo icin: oturum ~45 dakikadir suruyormus gibi baslangic sayaclari
        prefill() {
            const checks = 135;
            const logs = {};
            for (const [no, s] of Object.entries(DemoData.live)) {
                const count = Math.round(checks * s.ratio);
                const records = Array.from({ length: 30 }, (_, i) => {
                    const present = s.state === 'absent' ? false
                        : s.state === 'left' ? i < Math.round(30 * s.ratio)
                        : (i * 7 + Number(no.slice(-2))) % 100 < s.ratio * 100;
                    return { time: '', status: present ? 'VAR' : 'YOK' };
                });
                logs[no] = { presentCount: count, records };
            }
            return { checks, logs, startedMinutesAgo: 45 };
        },
    };
}

// ==========================================================================
// UYGULAMA DURUMU
// ==========================================================================
const state = {
    teacher: null,
    studentPool: {},
    view: 'dashboard',
    course: '',
    room: '',
    lessonStatus: 'IDLE',       // IDLE | CHECKIN_OPEN | CHECKOUT_OPEN
    presence: {},
    ml: {},
    checkedIn: {},
    checkedOut: {},
    totalChecks: 0,
    logs: {},                   // ogrenciNo -> { presentCount, records: [{time,status}] }
    lessonStart: null,
    timers: [],
    filter: 'all',
};

const courseCode = (course) => course.split(' - ')[0];
const courseName = (course) => course.split(' - ')[1] || course;

// ==========================================================================
// SAAT VE DONEM
// ==========================================================================
function updateClock() { $('realtime-clock').innerText = fmtTime(new Date()); }
setInterval(updateClock, 1000);
updateClock();
(function termLabel() {
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    $('term-label').innerText = m >= 9 ? `${y}-${y + 1} Güz` : m <= 1 ? `${y - 1}-${y} Güz` : `${y - 1}-${y} Bahar`;
})();

// ==========================================================================
// GIRIS / CIKIS
// ==========================================================================
const AUTH_ERRORS = {
    'auth/invalid-email': 'E-posta adresi geçersiz.',
    'auth/user-not-found': 'E-posta veya şifre hatalı!',
    'auth/wrong-password': 'E-posta veya şifre hatalı!',
    'auth/invalid-login-credentials': 'E-posta veya şifre hatalı!',
    'auth/user-disabled': 'Bu hesap devre dışı bırakılmış.',
    'auth/too-many-requests': 'Çok fazla deneme yapıldı. Biraz bekleyip tekrar deneyin.',
    'auth/network-request-failed': 'İnternet bağlantısı yok.',
    'not-teacher': 'Bu hesap öğretmen olarak tanımlı değil.',
    'no-profile': 'Öğretmen profili bulunamadı. Yöneticiye başvurun.',
};

$('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (CONFIG_MISSING) {
        toast('web/config.js bulunamadı. config_example.js dosyasını config.js olarak kopyalayıp Firebase bilgilerini girin.', 'danger');
        return;
    }
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Giriş yapılıyor...';
    try {
        state.teacher = await Store.signIn($('login-email').value.trim(), $('login-password').value);
        await openPanel();
    } catch (err) {
        let message = AUTH_ERRORS[err.code] || 'Giriş yapılamadı. Lütfen tekrar deneyin.';
        // SDK 8.10.1 yeni sunucu hatasini tanimiyor, "auth/internal-error" olarak veriyor
        if (String(err.message || '').includes('INVALID_LOGIN_CREDENTIALS')) message = AUTH_ERRORS['auth/invalid-login-credentials'];
        if (err.code === 'PERMISSION_DENIED' || String(err.message || '').includes('permission_denied')) {
            await Store.signOut();
            message = 'Veritabanı erişimi reddedildi. Hesap öğretmen olarak tanımlı mı?';
        }
        console.error('Giris hatasi:', err);
        toast(message, 'danger');
        btn.disabled = false;
        btn.innerHTML = 'Giriş Yap';
    }
});

$('btn-logout').addEventListener('click', (e) => {
    e.preventDefault();
    if (state.lessonStatus !== 'IDLE' && !confirm('Aktif bir yoklama var. Yine de çıkış yapılsın mı?')) return;
    Promise.resolve(Store.signOut()).finally(() => {
        location.href = location.pathname; // demo parametresi de temizlenir
    });
});

async function openPanel() {
    $('teacher-name-display').innerText = state.teacher.name;
    // Unvanlari ("Doç.", "Dr.") atlayip ad-soyadin bas harfleri
    $('teacher-initials').innerText = initials(state.teacher.name.split(' ').filter((w) => !w.endsWith('.')).join(' '));

    const rooms = await Store.classrooms();
    $('select-room').innerHTML = rooms.map((r) => `<option value="${esc(r)}">Derslik ${esc(r)}</option>`).join('');

    Store.onStudents((pool) => {
        state.studentPool = pool;
        if (!$('modal-students').classList.contains('hidden')) renderStudentModal();
        render();
    });

    $('screen-login').classList.add('hidden');
    $('screen-main').classList.remove('hidden');
    showView('dashboard');
    toast(DEMO ? 'Demo modu: örnek veriler gösteriliyor, veritabanına hiçbir şey yazılmaz.' : `Hoş geldiniz, ${state.teacher.name}`, DEMO ? 'info' : 'success');
}

// Demo modunda giris ekranini atla
if (DEMO) {
    Store.signIn().then((t) => { state.teacher = t; openPanel(); });
}

// ==========================================================================
// GEZINME
// ==========================================================================
const VIEW_TITLES = {
    dashboard: ['Genel Bakış', 'Bugünkü dersler ve dönem devam durumu'],
    courses: ['Derslerim', 'Yoklamasını başlatmak istediğiniz dersi seçin'],
    students: ['Öğrenciler', 'Kayıtlı öğrenciler; detay ve cihaz sıfırlama için öğrenciye tıklayın'],
    attendance: ['Aktif Yoklama', 'Öğrenciler sınıfa girdikçe otomatik olarak listelenir'],
    alerts: ['Uyarılar', 'İncelenmesi önerilen katılım durumları'],
};

function showView(view) {
    state.view = view;
    document.querySelectorAll('.content-view').forEach((v) => v.classList.add('hidden'));
    $(`view-${view}`).classList.remove('hidden');
    document.querySelectorAll('.sidebar-nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
    $('page-title').innerText = VIEW_TITLES[view][0];
    $('page-subtitle').innerText = VIEW_TITLES[view][1];
    render();
}

document.querySelectorAll('.sidebar-nav a').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    if (!a.classList.contains('disabled')) showView(a.dataset.view);
}));

function render() {
    if (!state.teacher) return;
    renderAlertBadge();
    if (state.view === 'dashboard') renderDashboard();
    if (state.view === 'courses') renderCourses();
    if (state.view === 'students') renderStudents();
    if (state.view === 'attendance') renderAttendance();
    if (state.view === 'alerts') renderAlerts();
}

// ==========================================================================
// GENEL BAKIS
// ==========================================================================
function statCard(icon, tone, value, label) {
    return `<div class="stat-card"><div class="stat-icon tone-${tone}"><i class="fa-solid ${icon}"></i></div>
        <div><div class="value">${value}</div><div class="label">${esc(label)}</div></div></div>`;
}

function renderDashboard() {
    const today = new Date().getDay();
    const courses = state.teacher.courses;
    const todays = courses.filter((c) => (Store.schedule(courseCode(c)) || {}).day === today);
    const rates = DEMO ? DemoData.courseRates : null;
    const avg = rates ? Math.round(Object.values(rates).reduce((a, b) => a + b, 0) / Object.values(rates).length) : null;
    const risk = riskStudents();

    $('dashboard-stats').innerHTML = [
        statCard('fa-calendar-day', 'navy', DEMO ? todays.length : courses.length, DEMO ? 'Bugünkü ders' : 'Kayıtlı ders'),
        statCard('fa-users', 'sky', Object.keys(state.studentPool).length, 'Kayıtlı öğrenci'),
        statCard('fa-chart-pie', 'green', avg === null ? '–' : `%${avg}`, 'Ortalama devam'),
        statCard('fa-triangle-exclamation', 'orange', collectAlerts().length, 'Açık uyarı'),
    ].join('');

    $('dashboard-course-chart').innerHTML = rates
        ? courses.map((c) => {
            const p = rates[courseCode(c)] ?? 0;
            return `<div class="bar-row"><span class="name" title="${esc(c)}">${esc(courseName(c))}</span>
                <div class="bar-track"><div class="bar-fill" style="width:${p}%;background:${pctColor(p)}"></div><div class="bar-threshold"></div></div>
                <span class="pct" style="color:${pctColor(p)}">%${p}</span></div>`;
        }).join('')
        : emptyState('fa-chart-column', 'Geçmiş ders kayıtları tutulmaya başladığında ders bazında devam oranları burada görünecek.');

    const list = DEMO ? todays : courses;
    $('dashboard-today').innerHTML = list.length === 0
        ? emptyState('fa-mug-hot', 'Bugün planlanmış dersiniz yok.')
        : list.map((c) => {
            const s = Store.schedule(courseCode(c));
            return `<div class="list-row">
                <div class="time-box">${s ? s.start : '–'}<small>${s ? s.end : ''}</small></div>
                <div class="grow"><div class="title">${esc(courseName(c))}</div><div class="muted small">${esc(courseCode(c))}${s ? ` · Derslik ${esc(s.room)}` : ''}</div></div>
                <button class="btn btn-light" data-start="${esc(c)}"><i class="fa-solid fa-play"></i> Başlat</button>
            </div>`;
        }).join('');
    $('dashboard-today').querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => openRoomModal(b.dataset.start)));

    $('dashboard-risk').innerHTML = risk.length === 0
        ? emptyState('fa-user-check', DEMO ? 'Sınıra yaklaşan öğrenci yok.' : 'Geçmiş ders kayıtları tutulmaya başladığında devamsızlık sınırına yaklaşan öğrenciler burada listelenecek.')
        : `<table class="modern-table"><thead><tr><th>Öğrenci No</th><th>Ad Soyad</th><th>Devamsızlık</th><th>Kalan hak</th><th>Devam</th></tr></thead><tbody>${
            risk.map((r) => `<tr class="clickable" data-student="${esc(r.no)}"><td><strong>${esc(r.no)}</strong></td><td>${esc(r.name)}</td>
                <td>${r.absent} hafta</td>
                <td><span class="badge ${r.remaining === 0 ? 'badge-absent' : 'badge-left'}">${r.remaining === 0 ? 'Hakkı bitti' : `${r.remaining} hafta`}</span></td>
                <td style="color:${pctColor(r.pct)};font-weight:800">%${r.pct}</td></tr>`).join('')
        }</tbody></table>`;
    $('dashboard-risk').querySelectorAll('[data-student]').forEach((r) => r.addEventListener('click', () => openStudentDetail(r.dataset.student)));
}

function riskStudents() {
    if (!DEMO) return [];
    return Object.entries(DemoData.missedWeeks)
        .filter(([no]) => state.studentPool[no])
        .map(([no, weeks]) => ({
            no, name: state.studentPool[no], absent: weeks.length,
            remaining: Math.max(0, MAX_ABSENCE - weeks.length),
            pct: Math.round(((DemoData.weeksHeld - weeks.length) / DemoData.weeksHeld) * 100),
        }))
        .filter((r) => r.remaining <= 2)
        .sort((a, b) => a.remaining - b.remaining);
}

// ==========================================================================
// DERSLERIM
// ==========================================================================
function renderCourses() {
    const q = $('course-search').value.toLocaleLowerCase('tr-TR');
    const list = state.teacher.courses.filter((c) => c.toLocaleLowerCase('tr-TR').includes(q));
    $('course-grid').innerHTML = list.length === 0 ? emptyState('fa-book', 'Kayıt bulunamadı.') : list.map((c) => {
        const s = Store.schedule(courseCode(c));
        const rate = DEMO ? DemoData.courseRates[courseCode(c)] : null;
        return `<div class="course-card" data-course="${esc(c)}">
            <div class="top"><span>${esc(courseCode(c))}</span><h3>${esc(courseName(c))}</h3></div>
            <div class="body">
                <div><i class="fa-solid fa-user-tie"></i> ${esc(state.teacher.name)}</div>
                <div><i class="fa-regular fa-clock"></i> ${s ? `${DAYS[s.day]} ${s.start} - ${s.end}` : 'Program tanımlı değil'}</div>
                <div><i class="fa-solid fa-location-dot"></i> ${s ? `Derslik ${esc(s.room)}` : 'Derslik oturumda seçilir'}</div>
            </div>
            <div class="foot">
                ${rate !== null && rate !== undefined ? `<span class="badge" style="background:#f1f3f8;color:${pctColor(rate)}">Devam %${rate}</span>` : '<span></span>'}
                <span class="badge badge-navy"><i class="fa-solid fa-play"></i> Yoklama başlat</span>
            </div>
        </div>`;
    }).join('');
    $('course-grid').querySelectorAll('[data-course]').forEach((card) => card.addEventListener('click', () => openRoomModal(card.dataset.course)));
}
$('course-search').addEventListener('input', renderCourses);

function openRoomModal(course) {
    if (state.lessonStatus !== 'IDLE') { toast('Önce aktif yoklamayı bitirin.', 'warning'); showView('attendance'); return; }
    state.course = course;
    $('modal-course-title').innerText = course;
    const s = Store.schedule(courseCode(course));
    if (s) $('select-room').value = s.room;
    $('modal-room-select').classList.remove('hidden');
}
$('btn-cancel-room').addEventListener('click', () => $('modal-room-select').classList.add('hidden'));

// ==========================================================================
// YOKLAMA OTURUMU
// ==========================================================================
$('btn-confirm-start').addEventListener('click', async () => {
    state.room = $('select-room').value;
    $('modal-room-select').classList.add('hidden');

    state.lessonStatus = 'CHECKIN_OPEN';
    state.checkedIn = {};
    state.checkedOut = {};
    state.totalChecks = 0;
    state.logs = {};
    state.lessonStart = new Date();
    for (const no in state.studentPool) state.logs[no] = { presentCount: 0, records: [] };

    await Store.startSession(state.room, state.course);

    if (DEMO) {
        const pre = Store.prefill();
        state.totalChecks = pre.checks;
        Object.assign(state.logs, pre.logs);
        state.lessonStart = new Date(Date.now() - pre.startedMinutesAgo * 60000);
        for (const no in pre.logs) if (pre.logs[no].presentCount > 0) state.checkedIn[no] = true;
    }

    $('dyn-course-code').innerText = courseCode(state.course);
    $('dyn-course-name').innerText = courseName(state.course);
    $('dyn-room-name').innerText = `Derslik ${state.room}`;
    setStatusBadge();
    $('btn-take-exit').classList.remove('hidden');
    $('btn-end-class').disabled = true;
    $('nav-attendance').classList.remove('disabled');
    $('nav-live-dot').classList.remove('hidden');

    Store.onML(state.room, (v) => { state.ml = v; render(); });
    Store.onPresence(state.room, (v) => {
        state.presence = v;
        if (state.lessonStatus === 'CHECKOUT_OPEN') {
            for (const no in v) if (isInClass(no)) state.checkedOut[no] = true;
        }
        render();
    });

    state.timers.push(setInterval(takeSample, SAMPLE_MS));
    state.timers.push(setInterval(updateTimer, 1000));
    takeSample();
    updateTimer();
    showView('attendance');
    toast(`Derslik ${state.room} aktif edildi. Sürekli takip başladı.`, 'info');
});

function updateTimer() {
    if (!state.lessonStart) return;
    const s = Math.floor((Date.now() - state.lessonStart) / 1000);
    $('lesson-timer').innerText = `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

// Ogrenci su an sinifta mi? (docs/protocol.md bolum 7)
//   sinifta = status IN_CLASS ve (elle eklendi ya da son sinyal LAST_SEEN_LIMIT_MS'den yeni)
// Telefonun pili biterse, interneti kesilirse ya da ogrenci cikarsa gonderim durur ve ogrenci
// 2,5 dk sonra kendiliginden "sinifta degil" olur. lastSeen'i olmayan kayit sinifta sayilmaz.
function isInClass(no) {
    const p = state.presence[no];
    if (!p || p.status !== 'IN_CLASS') return false;
    if (p.manual) return true;
    return typeof p.lastSeen === 'number' && Store.serverNow() - p.lastSeen <= LAST_SEEN_LIMIT_MS;
}

// Son sinyalden bu yana gecen sure (sn); bilinmiyorsa null
function lastSeenSeconds(no) {
    const p = state.presence[no];
    if (!p || typeof p.lastSeen !== 'number') return null;
    return Math.max(0, Math.round((Store.serverNow() - p.lastSeen) / 1000));
}

// Ogrenci detayinda sinyal kutusunun altindaki "son sinyal 23 sn once" yazisi
function lastSeenText(no) {
    if (state.presence[no]?.manual) return '<span class="muted small">elle eklendi</span>';
    const s = lastSeenSeconds(no);
    if (s === null) return '';
    return `<span class="muted small">son sinyal ${s < 60 ? `${s} sn` : `${Math.floor(s / 60)} dk`} önce</span>`;
}

// Her SAMPLE_MS'de bir: sinifta olan ogrencinin sayacini artir
function takeSample() {
    // Cikis yoklamasinda sayac artmaz ama sinyali kesilen ogrenci ekranda yine de dusmeli
    if (state.lessonStatus !== 'CHECKIN_OPEN') { render(); return; }
    state.totalChecks++;
    const now = new Date().toLocaleTimeString('tr-TR');
    for (const no in state.studentPool) {
        const log = state.logs[no] || (state.logs[no] = { presentCount: 0, records: [] });
        const inClass = isInClass(no);
        if (inClass) { log.presentCount++; state.checkedIn[no] = true; }
        log.records.push({ time: now, status: inClass ? 'VAR' : 'YOK' });
    }
    render();
}

function studentInfo(no) {
    const log = state.logs[no] || { presentCount: 0, records: [] };
    const pct = state.totalChecks === 0 ? 0 : Math.min(100, Math.round((log.presentCount / state.totalChecks) * 100));
    const inClass = isInClass(no);
    const st = inClass ? 'in' : state.checkedIn[no] ? 'left' : 'absent';
    const mlOutside = inClass && state.ml[no] && state.ml[no].in_class === false;
    const minutes = Math.round((log.presentCount * SAMPLE_MS) / 60000 * (DEMO ? 5 : 1));
    let finalStatus = null;
    if (state.lessonStatus === 'CHECKOUT_OPEN') {
        finalStatus = state.checkedIn[no] && state.checkedOut[no] && pct >= PASS_PERCENT ? 'VAR' : 'YOK';
    }
    return { no, name: state.studentPool[no] || 'Kayıt dışı', log, pct, st, mlOutside, minutes, finalStatus, manual: state.presence[no]?.manual };
}

const ST_LABEL = { in: ['Sınıfta', 'badge-in', 'fa-circle-check'], left: ['Ayrıldı', 'badge-left', 'fa-person-walking-arrow-right'], absent: ['Gelmedi', 'badge-absent', 'fa-circle-xmark'] };

function setStatusBadge() {
    const b = $('attendance-status-badge');
    if (state.lessonStatus === 'CHECKOUT_OPEN') {
        b.className = 'status-pill status-exit';
        b.innerHTML = '<i class="fa-solid fa-rotate"></i> Çıkış yoklaması';
    } else {
        b.className = 'status-pill status-open';
        b.innerHTML = '<i class="fa-solid fa-door-open"></i> Giriş açık';
    }
}

function renderAttendance() {
    if (state.lessonStatus === 'IDLE') return;
    const infos = Object.keys(state.studentPool).map(studentInfo);
    const count = (s) => infos.filter((i) => i.st === s).length;
    const present = infos.filter((i) => i.st !== 'absent');
    const avg = present.length ? Math.round(present.reduce((a, i) => a + i.pct, 0) / present.length) : 0;
    const finalVar = infos.filter((i) => i.finalStatus === 'VAR').length;

    $('session-stats').innerHTML = [
        statCard('fa-user-check', 'green', count('in'), 'Sınıfta'),
        statCard('fa-person-walking-arrow-right', 'orange', count('left'), 'Ayrıldı'),
        statCard('fa-user-xmark', 'red', count('absent'), 'Gelmedi'),
        state.lessonStatus === 'CHECKOUT_OPEN'
            ? statCard('fa-flag-checkered', 'navy', `${finalVar}/${infos.length}`, 'Nihai VAR')
            : statCard('fa-chart-simple', 'navy', `%${avg}`, 'Ortalama katılım'),
    ].join('');

    const q = $('student-search').value.toLocaleLowerCase('tr-TR');
    const shown = infos
        .filter((i) => state.filter === 'all' || i.st === state.filter)
        .filter((i) => !q || i.name.toLocaleLowerCase('tr-TR').includes(q) || i.no.includes(q))
        .sort((a, b) => ({ in: 0, left: 1, absent: 2 }[a.st] - { in: 0, left: 1, absent: 2 }[b.st]) || b.pct - a.pct);

    $('student-grid').innerHTML = shown.length === 0
        ? emptyState('fa-users-slash', Object.keys(state.studentPool).length === 0 ? 'Kayıtlı öğrenci yok. "Öğrenciler" butonundan ekleyebilirsiniz.' : 'Bu filtreye uyan öğrenci yok.')
        : shown.map((i) => {
            const [label, cls, icon] = ST_LABEL[i.st];
            return `<div class="student-card st-${i.st}" data-student="${esc(i.no)}">
                <div class="head"><div class="initials">${esc(initials(i.name))}</div>
                    <div><div class="name">${esc(i.name)}</div><div class="muted small">${esc(i.no)}</div></div></div>
                <div class="bar-track"><div class="bar-fill" style="width:${i.pct}%;background:${pctColor(i.pct)}"></div><div class="bar-threshold"></div></div>
                <div class="meta"><span><i class="fa-regular fa-clock"></i> ${fmtMinutes(i.minutes)}</span><strong style="color:${pctColor(i.pct)}">%${i.pct}</strong></div>
                <div class="badges">
                    <span class="badge ${cls}"><i class="fa-solid ${icon}"></i> ${label}</span>
                    ${i.mlOutside ? '<span class="badge badge-ml"><i class="fa-solid fa-robot"></i> Dışarıda olabilir</span>' : ''}
                    ${i.manual ? '<span class="badge badge-navy">Manuel</span>' : ''}
                    ${i.finalStatus ? `<span class="badge ${i.finalStatus === 'VAR' ? 'badge-in' : 'badge-absent'}">Nihai: ${i.finalStatus}</span>` : ''}
                </div>
            </div>`;
        }).join('');
    $('student-grid').querySelectorAll('[data-student]').forEach((c) => c.addEventListener('click', () => openStudentDetail(c.dataset.student)));
}

document.querySelectorAll('#student-filter button').forEach((b) => b.addEventListener('click', () => {
    state.filter = b.dataset.filter;
    document.querySelectorAll('#student-filter button').forEach((x) => x.classList.toggle('active', x === b));
    renderAttendance();
}));
$('student-search').addEventListener('input', renderAttendance);

// Cikis yoklamasi: ML'in "sinif ici" dedigi ve hala sinifta olanlar korunur
$('btn-take-exit').addEventListener('click', async () => {
    if (!confirm('Çıkış yoklaması başlatılacak. Sınıf dışında tespit edilen veya bağlantısı kopan öğrenciler düşürülecek. Emin misiniz?')) return;
    state.lessonStatus = 'CHECKOUT_OPEN';
    state.checkedOut = {};
    const kept = {};
    for (const no in state.checkedIn) {
        const p = state.presence[no];
        const mlOk = state.ml[no] ? state.ml[no].in_class === true : DEMO;
        if (isInClass(no) && mlOk) { state.checkedOut[no] = true; kept[no] = p; }
    }
    await Store.keepOnly(state.room, kept);
    setStatusBadge();
    $('btn-take-exit').classList.add('hidden');
    $('btn-end-class').disabled = false;
    render();
    toast('Çıkış yoklaması başladı. Sınıftakiler onaylandı, dışarıdakiler düşürüldü.', 'info');
});

$('btn-end-class').addEventListener('click', async () => {
    if (!confirm('Ders bitirilecek. Onaylıyor musunuz?')) return;
    state.timers.splice(0).forEach(clearInterval);
    await Store.endSession(state.room);
    state.lessonStatus = 'IDLE';
    state.presence = {};
    state.ml = {};
    $('nav-attendance').classList.add('disabled');
    $('nav-live-dot').classList.add('hidden');
    showView('courses');
    toast('Ders başarıyla sonlandırıldı.', 'success');
});

// ==========================================================================
// OGRENCI DETAYI
// ==========================================================================
function openStudentDetail(no) {
    const name = state.studentPool[no] || 'Kayıt dışı';
    const active = state.lessonStatus !== 'IDLE';
    const info = active ? studentInfo(no) : null;
    const code = state.course ? courseCode(state.course) : courseCode(state.teacher.courses[0] || '');
    const hist = Store.history(code, no);

    let html = `<div class="modal-title-row"><div class="detail-head"><div class="initials">${esc(initials(name))}</div>
        <div><h3 style="font-size:18px">${esc(name)}</h3><div class="muted">${esc(no)}</div></div></div>
        <button class="btn-icon" id="btn-close-detail" title="Kapat"><i class="fa-solid fa-xmark fa-lg"></i></button></div>`;

    if (info) {
        const [label, cls] = ST_LABEL[info.st];
        html += `<div><h3 style="margin-bottom:10px">Bu ders oturumu <span class="badge ${cls}" style="margin-left:6px">${label}</span></h3>
            <div class="detail-stats">
                <div><span class="muted small">Katılım</span><strong style="color:${pctColor(info.pct)}">%${info.pct}</strong></div>
                <div><span class="muted small">Sınıfta geçen süre</span><strong>${fmtMinutes(info.minutes)}</strong></div>
                <div><span class="muted small">Sinyal</span><strong>${state.presence[no]?.rssi ? `${state.presence[no].rssi} dBm` : '–'}</strong>${lastSeenText(no)}</div>
            </div></div>
            <div><div class="muted small" style="margin-bottom:6px">Son ölçümler (yeşil: sınıfta, kırmızı: değil)</div>
            <div class="timeline">${info.log.records.slice(-40).map((r) => `<span title="${esc(r.time)}" style="background:${r.status === 'VAR' ? 'var(--success)' : '#f2b8be'}"></span>`).join('')}</div></div>`;
        if (info.mlOutside) {
            html += `<div class="alert-card" style="background:#f7f2fe;border-radius:12px;padding:12px"><div class="icon tone-red" style="background:#efe6fd;color:#6b3fbf"><i class="fa-solid fa-robot"></i></div>
                <div class="grow"><div class="title">Sınıf dışında olabilir</div><div class="muted">Makine öğrenmesi modeli sinyal örüntüsüne göre öğrencinin sınıfın dışında olabileceğini tahmin ediyor.</div></div></div>`;
        }
    }

    if (hist) {
        const attended = hist.filter((h) => h.present).length;
        const remaining = Math.max(0, MAX_ABSENCE - (hist.length - attended));
        html += `<div><h3 style="margin-bottom:10px">Dönem devam geçmişi · ${esc(code)}</h3>
            <div class="detail-stats" style="margin-bottom:12px">
                <div><span class="muted small">Devam</span><strong style="color:${pctColor((attended / hist.length) * 100)}">${attended}/${hist.length}</strong></div>
                <div><span class="muted small">Devamsızlık</span><strong>${hist.length - attended} hafta</strong></div>
                <div><span class="muted small">Kalan hak</span><strong>${remaining} hafta</strong></div>
            </div>
            <div class="week-grid">${hist.map((h) => `<div class="week-cell" style="background:${h.present ? '#e6f6ef' : '#fdecee'};color:${h.present ? 'var(--success)' : 'var(--red)'}">
                ${h.present ? 'VAR' : 'YOK'}<small>${h.week}. hafta</small></div>`).join('')}</div></div>`;
    } else {
        html += emptyState('fa-clock-rotate-left', 'Geçmiş haftaların yoklama kayıtları tutulmaya başladığında burada görünecek.');
    }

    html += `<div class="device-reset"><div class="grow"><h3 style="margin-bottom:4px">Telefon bağlantısı</h3>
        <div class="muted small">Öğrenci telefon değiştirdiyse ya da uygulamayı silip yeniden kurduysa bağlantıyı sıfırlayın.
        Öğrenci bir sonraki girişinde yeni telefonuna bağlanır; eski telefon yoklama için kullanılamaz.</div></div>
        <button class="btn btn-danger" id="btn-reset-device"><i class="fa-solid fa-mobile-screen"></i> Cihazı sıfırla</button></div>`;

    $('student-detail-body').innerHTML = html;
    $('modal-student-detail').classList.remove('hidden');
    $('btn-close-detail').addEventListener('click', () => $('modal-student-detail').classList.add('hidden'));
    $('btn-reset-device').addEventListener('click', () => resetStudentDevice(no, name));
}

async function resetStudentDevice(no, name) {
    if (!confirm(`${name} (${no}) adlı öğrencinin telefon bağlantısı silinecek.\n\n`
        + 'Öğrenci bir sonraki girişinde yeni telefonuna bağlanacak; eski telefonu yoklama için kullanılamayacak.\n\n'
        + 'Bu isteğin gerçekten öğrenciden geldiğinden emin olun. Devam edilsin mi?')) return;
    const btn = $('btn-reset-device');
    btn.disabled = true;
    try {
        const result = await Store.resetDevice(no);
        if (result === 'no-account') {
            toast(`${no} numarasıyla mobil uygulamada açılmış bir hesap yok.`, 'warning');
        } else {
            toast(`${name} için cihaz sıfırlandı. Öğrenci yeni telefonundan giriş yapabilir.`, 'success');
        }
    } catch (e) {
        toast(e && e.code === 'PERMISSION_DENIED'
            ? 'Veritabanı kuralları bu işleme izin vermedi. Güncel kurallar Firebase\'e yüklendi mi?'
            : 'Firebase bağlantı hatası.', 'danger');
    } finally {
        btn.disabled = false;
    }
}
$('modal-student-detail').addEventListener('click', (e) => { if (e.target.id === 'modal-student-detail') e.target.classList.add('hidden'); });

// ==========================================================================
// UYARILAR
// ==========================================================================
function collectAlerts() {
    const alerts = [];
    if (state.lessonStatus !== 'IDLE') {
        for (const no in state.studentPool) {
            const i = studentInfo(no);
            if (i.mlOutside) alerts.push({ no, type: 'ml', title: 'Sınıf dışında olabilir', text: `${state.room} dersliğinde görünüyor, ancak makine öğrenmesi modeli sinyal örüntüsüne göre sınıfın dışında olabileceğini tahmin ediyor.` });
            if (i.st === 'left' && i.pct < PASS_PERCENT) alerts.push({ no, type: 'left', title: 'Dersten erken ayrıldı', text: `Katılım %${i.pct}; %${PASS_PERCENT} devam şartının altında.` });
        }
    }
    if (DEMO) {
        alerts.push({ no: '232801102', type: 'signal', title: 'Sinyal anomalisi', text: 'Sinyal gücünde ani ve tutarsız değişimler tespit edildi (−58 dBm → −91 dBm). Telefon başka bir kişide olabilir.' });
        for (const r of riskStudents().filter((x) => x.remaining === 0)) {
            alerts.push({ no: r.no, type: 'limit', title: 'Devamsızlık hakkı doldu', text: `${r.absent} hafta devamsızlık; bir sonraki devamsızlıkta dersten kalabilir.` });
        }
    }
    return alerts;
}

const ALERT_STYLE = {
    ml: ['fa-robot', 'background:#efe6fd;color:#6b3fbf', 'Makine öğrenmesi'],
    left: ['fa-person-walking-arrow-right', 'background:#fff4e0;color:var(--warning)', 'Katılım'],
    signal: ['fa-wave-square', 'background:#e3f4fc;color:var(--sky)', 'Anomali tespiti'],
    limit: ['fa-user-clock', 'background:#fdecee;color:var(--red)', 'Devamsızlık'],
};

function renderAlerts() {
    const alerts = collectAlerts();
    $('alerts-list').innerHTML = alerts.length === 0
        ? emptyState('fa-shield-halved', 'Şu an incelenmesi gereken bir durum yok.')
        : alerts.map((a) => {
            const [icon, style, tag] = ALERT_STYLE[a.type];
            return `<div class="alert-card clickable" data-student="${esc(a.no)}"><div class="icon" style="${style}"><i class="fa-solid ${icon}"></i></div>
                <div class="grow"><div class="title">${esc(a.title)} · ${esc(state.studentPool[a.no] || a.no)}</div><div class="muted">${esc(a.text)}</div></div>
                <span class="badge badge-navy">${tag}</span></div>`;
        }).join('');
    $('alerts-list').querySelectorAll('[data-student]').forEach((c) => c.addEventListener('click', () => openStudentDetail(c.dataset.student)));
}

function renderAlertBadge() {
    const n = collectAlerts().length;
    $('nav-alert-count').innerText = n;
    $('nav-alert-count').classList.toggle('hidden', n === 0);
}

// ==========================================================================
// OGRENCI YONETIMI
// ==========================================================================
$('btn-show-students').addEventListener('click', () => { renderStudentModal(); $('modal-students').classList.remove('hidden'); });
$('btn-close-students').addEventListener('click', () => $('modal-students').classList.add('hidden'));

$('btn-add-student').addEventListener('click', async () => {
    const no = $('new-student-no').value.trim();
    const name = $('new-student-name').value.trim();
    if (!no || !name) { toast('Öğrenci no ve adını eksiksiz girin.', 'warning'); return; }
    if (state.studentPool[no]) { toast(`${no} numaralı öğrenci zaten kayıtlı.`, 'warning'); return; }
    try {
        await Store.addStudent(no, name);
        $('new-student-no').value = '';
        $('new-student-name').value = '';
        toast(`${name} eklendi.`, 'success');
    } catch { toast('Firebase bağlantı hatası.', 'danger'); }
});

function renderStudentModal() {
    const active = state.lessonStatus !== 'IDLE';
    const entries = Object.entries(state.studentPool);
    $('modal-student-count').innerText = `${entries.length} öğrenci`;
    $('modal-student-thead').innerHTML = `<tr><th>Öğrenci No</th><th>Ad Soyad</th>${active ? '<th>Yoklama</th>' : ''}<th style="text-align:right">Sil</th></tr>`;
    if (entries.length === 0) {
        $('modal-student-list').innerHTML = `<tr><td colspan="4">${emptyState('fa-users', 'Kayıtlı öğrenci yok.')}</td></tr>`;
        return;
    }
    $('modal-student-list').innerHTML = entries.map(([no, name]) => {
        const added = state.lessonStatus === 'CHECKOUT_OPEN' ? !!state.checkedOut[no] : isInClass(no);
        return `<tr><td><strong>${esc(no)}</strong></td><td>${esc(name)}</td>
            ${active ? `<td><button class="btn btn-light" data-manual="${esc(no)}" ${added ? 'disabled' : ''}><i class="fa-solid ${added ? 'fa-check' : 'fa-user-plus'}"></i> ${added ? 'Sınıfta' : 'Manuel ekle'}</button></td>` : ''}
            <td style="text-align:right"><button class="btn-icon" data-delete="${esc(no)}" title="Öğrenciyi sil"><i class="fa-solid fa-trash-can"></i></button></td></tr>`;
    }).join('');
    $('modal-student-list').querySelectorAll('[data-manual]').forEach((b) => b.addEventListener('click', async () => {
        const no = b.dataset.manual;
        await Store.addManual(state.room, no);
        if (state.lessonStatus === 'CHECKOUT_OPEN') state.checkedOut[no] = true;
        state.checkedIn[no] = true;
        toast(`${state.studentPool[no]} manuel olarak yoklamaya eklendi.`, 'success');
        renderStudentModal();
        render();
    }));
    $('modal-student-list').querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', async () => {
        const no = b.dataset.delete;
        if (!confirm(`"${state.studentPool[no]}" (${no}) kalıcı olarak silinecek. Emin misiniz?`)) return;
        try { await Store.deleteStudent(no); toast('Öğrenci silindi.', 'warning'); } catch { toast('Firebase bağlantı hatası.', 'danger'); }
    }));
}

// ==========================================================================
// OGRENCILER SEKMESI (ders olmasa da acik; detay ve cihaz sifirlama buradan)
// ==========================================================================
function renderStudents() {
    const q = $('students-search').value.trim().toLocaleLowerCase('tr-TR');
    const all = Object.entries(state.studentPool);
    const rows = all
        .filter(([no, name]) => no.includes(q) || String(name).toLocaleLowerCase('tr-TR').includes(q))
        .sort((a, b) => a[0].localeCompare(b[0]));
    $('students-count').innerText = `${all.length} öğrenci`;
    if (rows.length === 0) {
        $('students-list').innerHTML = `<tr><td colspan="3">${emptyState('fa-users', all.length ? 'Aramaya uyan öğrenci yok.' : 'Kayıtlı öğrenci yok.')}</td></tr>`;
        return;
    }
    $('students-list').innerHTML = rows.map(([no, name]) =>
        `<tr class="clickable" data-student="${esc(no)}"><td><strong>${esc(no)}</strong></td><td>${esc(name)}</td>
         <td style="text-align:right"><button class="btn-icon" data-delete="${esc(no)}" title="Öğrenciyi sil"><i class="fa-solid fa-trash-can"></i></button></td></tr>`).join('');
    $('students-list').querySelectorAll('[data-student]').forEach((r) => r.addEventListener('click', () => openStudentDetail(r.dataset.student)));
    $('students-list').querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', async (e) => {
        e.stopPropagation();   // tiklama satira gitmesin (detay penceresi acilmasin)
        const no = b.dataset.delete;
        if (!confirm(`"${state.studentPool[no]}" (${no}) kalıcı olarak silinecek. Emin misiniz?`)) return;
        try { await Store.deleteStudent(no); toast('Öğrenci silindi.', 'warning'); } catch { toast('Firebase bağlantı hatası.', 'danger'); }
    }));
}
$('students-search').addEventListener('input', renderStudents);

$('btn-students-add').addEventListener('click', async () => {
    const no = $('students-new-no').value.trim();
    const name = $('students-new-name').value.trim();
    if (!no || !name) { toast('Öğrenci no ve adını eksiksiz girin.', 'warning'); return; }
    // Mobil uygulamanin kurali da 6-12 rakam istiyor (StudentNumbers)
    if (!/^[0-9]{6,12}$/.test(no)) { toast('Öğrenci numarası 6–12 haneli bir sayı olmalı.', 'warning'); return; }
    if (state.studentPool[no]) { toast(`${no} numaralı öğrenci zaten kayıtlı.`, 'warning'); return; }
    try {
        await Store.addStudent(no, name);
        $('students-new-no').value = '';
        $('students-new-name').value = '';
        toast(`${name} eklendi.`, 'success');
    } catch { toast('Firebase bağlantı hatası.', 'danger'); }
});

// ==========================================================================
// EXCEL RAPORU
// ==========================================================================
$('btn-export').addEventListener('click', () => {
    if (state.lessonStatus === 'CHECKIN_OPEN') { toast('Rapor almak için önce çıkış yoklamasını başlatın.', 'warning'); return; }
    const rows = [['Öğrenci No', 'Ad Soyad', 'Katılım Yüzdesi', 'Sınıfta Geçen Süre (dk)', 'Nihai Durum', 'Derslik', 'Ders']];
    for (const no in state.studentPool) {
        const i = studentInfo(no);
        rows.push([no, i.name, `%${i.pct}`, i.minutes, i.finalStatus || 'YOK', state.room, state.course]);
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 22 }, { wch: 13 }, { wch: 9 }, { wch: 34 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Nihai_Yoklama');
    XLSX.writeFile(wb, `Yoklama_${state.room}_${new Date().toLocaleDateString('tr-TR').replace(/\./g, '-')}.xlsx`);
    toast('Excel raporu indirildi.', 'success');
});
