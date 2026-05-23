// ==========================================================================
// 1. FİREBASE BAĞLANTISI VE GLOBAL DEĞİŞKENLER
// ==========================================================================
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let aktifOgretmen = null;
let aktifDersAd = "";
let seciliSinif = "";
let dersDurumu = "BEKLEMEDE";
let girisYapanlarListesi = {};
let cikisYapanlarListesi = {};
let ogrenciHavuzu = {}; // Artık Firebase'den yükleniyor

// ==========================================================================
// 2. TOAST BİLDİRİM SİSTEMİ (alert() yerine)
// ==========================================================================
function toast(mesaj, tip = 'info') {
    const ikonlar = { success: 'fa-check-circle', danger: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    const t = document.createElement('div');
    t.className = `toast toast-${tip}`;
    t.innerHTML = `<i class="fa-solid ${ikonlar[tip] || ikonlar.info}"></i> ${mesaj}`;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 350);
    }, 3200);
}

// ==========================================================================
// 3. SAAT GÜNCELLEME
// ==========================================================================
function updateClock() {
    const now = new Date();
    document.getElementById('realtime-clock').innerText =
        now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// ==========================================================================
// 4. GİRİŞ İŞLEMİ (LOGIN)
// ==========================================================================
document.getElementById('form-login').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const pass = document.getElementById('login-password').value;
    const btnLogin = e.target.querySelector('button[type="submit"]');

    btnLogin.disabled = true;
    btnLogin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Giriş yapılıyor...';

    db.ref(`Ogretmenler/${username}`).once('value', (snap) => {
        if (snap.exists() && snap.val().sifre === pass) {
            aktifOgretmen = snap.val();
            document.getElementById('teacher-name-display').innerText = aktifOgretmen.isim;

            // Sınıfları ve öğrencileri aynı anda yükle
            Promise.all([
                db.ref('Siniflar').once('value'),
                db.ref('Ogrenciler').once('value')
            ]).then(([sinifSnap, ogrenciSnap]) => {

                // Sınıf seçim listesi
                const selectRoom = document.getElementById('select-room-modal');
                selectRoom.innerHTML = "";
                if (sinifSnap.exists()) {
                    sinifSnap.val().forEach(sinif => {
                        selectRoom.innerHTML += `<option value="${sinif}">[${sinif}] Numaralı Derslik</option>`;
                    });
                }

                // Öğrenci havuzu: Firebase'den yükle, yoksa varsayılanları kaydet
                if (ogrenciSnap.exists()) {
                    ogrenciHavuzu = ogrenciSnap.val();
                } else {
                    ogrenciHavuzu = {
                        "232804009": "Samet Yerseven",
                        "220101004": "Talha Gürün",
                        "987654321": "Ayşe Kaya"
                    };
                    db.ref('Ogrenciler').set(ogrenciHavuzu);
                }

                dersKartlariniOlustur();
                document.getElementById('screen-login').classList.add('hidden');
                document.getElementById('screen-main').classList.remove('hidden');
                toast(`Hoş geldiniz, ${aktifOgretmen.isim}`, 'success');
            });

        } else {
            toast("Kullanıcı adı veya şifre hatalı!", 'danger');
            btnLogin.disabled = false;
            btnLogin.innerHTML = 'Giriş Yap';
        }
    });
});

// ==========================================================================
// 5. DERS KARTLARI + ARAMA ÇUBUĞU
// ==========================================================================
function dersKartlariniOlustur(filtre = "") {
    const container = document.getElementById('course-grid-container');
    container.innerHTML = "";

    const filtrelenmis = aktifOgretmen.dersler.filter(ders =>
        ders.toLowerCase().includes(filtre.toLowerCase())
    );

    if (filtrelenmis.length === 0) {
        container.innerHTML = `<div style="color: var(--text-muted); padding: 20px; grid-column: 1/-1;">
            <i class="fa-solid fa-magnifying-glass" style="margin-right:8px;"></i>Aramanızla eşleşen ders bulunamadı.
        </div>`;
        return;
    }

    filtrelenmis.forEach((ders) => {
        const parts = ders.split(" - ");
        const kod = parts[0] || "DERS";
        const ad = parts[1] || ders;

        const card = document.createElement('div');
        card.className = "course-card";
        card.innerHTML = `
            <div class="card-header">
                <span class="card-code">${kod}</span>
                <h3>${ad} (N.Ö)</h3>
            </div>
            <div class="card-body">
                <p><i class="fa-solid fa-user"></i> ${aktifOgretmen.isim}</p>
                <p><i class="fa-solid fa-calendar-day"></i> Oturum Başlatmaya Hazır</p>
            </div>
        `;
        card.addEventListener('click', () => {
            aktifDersAd = ders;
            document.getElementById('modal-course-title').innerText = ders;
            document.getElementById('modal-room-select').classList.remove('hidden');
        });
        container.appendChild(card);
    });
}

// Arama çubuğu - gerçek zamanlı filtreleme
document.querySelector('.search-bar-container input').addEventListener('input', (e) => {
    dersKartlariniOlustur(e.target.value);
});

document.getElementById('btn-cancel-modal').addEventListener('click', () => {
    document.getElementById('modal-room-select').classList.add('hidden');
});

// ==========================================================================
// 6. ÖĞRENCİ YÖNETİM MODALI — FİREBASE BAĞLANTILI
// ==========================================================================
document.getElementById('btn-show-students').addEventListener('click', () => {
    guncelleOgrenciListesiModal();
    document.getElementById('modal-students').classList.remove('hidden');
});

document.getElementById('btn-close-students').addEventListener('click', () => {
    document.getElementById('modal-students').classList.add('hidden');
});

document.getElementById('btn-add-student').addEventListener('click', () => {
    const no = document.getElementById('new-student-no').value.trim();
    const ad = document.getElementById('new-student-name').value.trim();

    if (!no || !ad) {
        toast("Öğrenci no ve adını eksiksiz girin.", 'warning');
        return;
    }
    if (ogrenciHavuzu[no]) {
        toast(`${no} numaralı öğrenci zaten kayıtlı.`, 'warning');
        return;
    }

    ogrenciHavuzu[no] = ad;
    db.ref(`Ogrenciler/${no}`).set(ad)
        .then(() => {
            document.getElementById('new-student-no').value = "";
            document.getElementById('new-student-name').value = "";
            guncelleOgrenciListesiModal();
            tablolariCiz();
            toast(`${ad} başarıyla eklendi.`, 'success');
        })
        .catch(() => {
            delete ogrenciHavuzu[no]; // geri al
            toast("Firebase bağlantı hatası, öğrenci eklenemedi.", 'danger');
        });
});

// Global: HTML içi onclick'ten çağrılabilmesi için window'a atanıyor
window.ogrenciSil = function(no) {
    const ad = ogrenciHavuzu[no];
    if (!confirm(`"${ad}" (${no}) kalıcı olarak silinecek. Emin misiniz?`)) return;

    delete ogrenciHavuzu[no];
    db.ref(`Ogrenciler/${no}`).remove()
        .then(() => {
            guncelleOgrenciListesiModal();
            tablolariCiz();
            toast(`${ad} silindi.`, 'warning');
        })
        .catch(() => {
            ogrenciHavuzu[no] = ad; // geri al
            toast("Firebase bağlantı hatası, öğrenci silinemedi.", 'danger');
        });
};

// Manuel yoklama: BLE bağlanamayan öğrenciyi elle aktif listeye ekler
window.ogrenciManuelEkle = function(no) {
    if (dersDurumu === "BEKLEMEDE") {
        toast("Aktif bir ders oturumu yok.", 'warning');
        return;
    }
    const ad = ogrenciHavuzu[no];
    const fakeKey = `MANUEL_${no}`;
    const hedefListe = dersDurumu === "CIKIS_ACIK" ? cikisYapanlarListesi : girisYapanlarListesi;

    if (Object.values(hedefListe).includes(no)) {
        toast(`${ad} zaten ${dersDurumu === "CIKIS_ACIK" ? "çıkış" : "giriş"} listesinde.`, 'warning');
        return;
    }

    db.ref(`Eslestirmeler/${seciliSinif}/${fakeKey}`).set(no)
        .then(() => {
            toast(`${ad} manuel olarak ${dersDurumu === "CIKIS_ACIK" ? "çıkışa" : "girişe"} eklendi.`, 'success');
            guncelleOgrenciListesiModal();
        })
        .catch(() => toast("Firebase bağlantı hatası, eklenemedi.", 'danger'));
};

function guncelleOgrenciListesiModal() {
    const list = document.getElementById('modal-student-list');
    const sayac = document.getElementById('modal-student-count');
    const count = Object.keys(ogrenciHavuzu).length;

    if (sayac) sayac.innerText = `${count} öğrenci`;

    // Aktif oturumda hangi öğrenciler zaten listede?
    const aktifListe = dersDurumu === "CIKIS_ACIK" ? cikisYapanlarListesi :
                       dersDurumu === "GIRIS_ACIK"  ? girisYapanlarListesi : {};
    const oturumAktif = dersDurumu !== "BEKLEMEDE";

    list.innerHTML = "";
    if (count === 0) {
        list.innerHTML = `<tr><td colspan="${oturumAktif ? 4 : 3}" class="empty-state">Kayıtlı öğrenci yok.</td></tr>`;
        return;
    }

    // Thead güncelle: aktif oturumda "Manuel Ekle" sütunu göster
    const thead = document.getElementById('modal-student-thead');
    if (thead) {
        thead.innerHTML = oturumAktif
            ? `<tr><th>Öğrenci No</th><th>Ad Soyad</th><th style="text-align:center">Yoklama</th><th style="text-align:right;padding-right:15px">Sil</th></tr>`
            : `<tr><th>Öğrenci No</th><th>Ad Soyad</th><th style="text-align:right;padding-right:15px">Sil</th></tr>`;
    }

    for (let no in ogrenciHavuzu) {
        const zatenVar = Object.values(aktifListe).includes(no);
        const manuelBtn = oturumAktif
            ? `<td style="text-align:center">
                <button onclick="ogrenciManuelEkle('${no}')"
                    class="btn-icon-manuel ${zatenVar ? 'eklendi' : ''}"
                    ${zatenVar ? 'disabled' : ''}
                    title="${zatenVar ? 'Zaten eklendi' : 'Derse manuel ekle'}">
                    <i class="fa-solid ${zatenVar ? 'fa-check' : 'fa-user-plus'}"></i>
                    ${zatenVar ? 'Eklendi' : 'Ekle'}
                </button>
               </td>`
            : '';

        list.innerHTML += `
            <tr>
                <td><strong>${no}</strong></td>
                <td>${ogrenciHavuzu[no]}</td>
                ${manuelBtn}
                <td style="text-align:right; padding-right: 15px;">
                    <button onclick="ogrenciSil('${no}')" class="btn-icon-danger" title="Öğrenciyi Sil">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            </tr>`;
    }
}

// ==========================================================================
// 7. YOKLAMAYI BAŞLATMA
// ==========================================================================
document.getElementById('btn-confirm-start').addEventListener('click', () => {
    seciliSinif = document.getElementById('select-room-modal').value;

    document.getElementById('nav-dersler').classList.remove('active');
    document.getElementById('nav-yoklama').classList.add('active');
    document.getElementById('nav-yoklama').classList.remove('disabled');

    document.getElementById('page-title').innerText = "Aktif Yoklama Oturumu";
    document.getElementById('page-subtitle').innerText = "Çift aşamalı donanım destekli yoklama paneli.";

    document.getElementById('dyn-course-code').innerText = aktifDersAd.split(" - ")[0];
    document.getElementById('dyn-course-name').innerText = aktifDersAd.split(" - ")[1] || aktifDersAd;
    document.getElementById('dyn-room-name').innerText = `Sınıf ${seciliSinif}`;

    document.getElementById('modal-room-select').classList.add('hidden');
    document.getElementById('view-courses').classList.add('hidden');
    document.getElementById('view-attendance').classList.remove('hidden');

    document.getElementById('btn-take-exit-attendance').style.display = 'inline-flex';
    document.getElementById('btn-end-class').disabled = true;
    const badge = document.getElementById('attendance-status-badge');
    badge.className = "status-indicator in-progress";
    badge.style = "";
    badge.innerHTML = `<i class="fa-solid fa-door-open"></i> GİRİŞ AÇIK`;

    dersDurumu = "GIRIS_ACIK";
    girisYapanlarListesi = {};
    cikisYapanlarListesi = {};

    // Önceki oturumun verilerini temizle (ghost öğrenci sorunu)
    db.ref(`Eslestirmeler/${seciliSinif}`).remove().then(() => {
        db.ref(`Sistem/${seciliSinif}`).set({ durum: "AKTIF", ders: aktifDersAd });
        verileriDinle();
        toast(`Sınıf ${seciliSinif} aktif edildi. ESP32 bekleniyor...`, 'info');
    });
});

// ==========================================================================
// 8. ESP32 VERİLERİNİ DİNLEME VE 3 KOLONLU TABLO ÇİZİMİ
// ==========================================================================
let refEslestirme = null;

function verileriDinle() {
    if (refEslestirme) refEslestirme.off();
    refEslestirme = db.ref(`Eslestirmeler/${seciliSinif}`);
    refEslestirme.on('value', (snap) => {
        const gelenVeri = snap.exists() ? snap.val() : {};
        if (dersDurumu === "GIRIS_ACIK") {
            girisYapanlarListesi = gelenVeri;
        } else if (dersDurumu === "CIKIS_ACIK") {
            cikisYapanlarListesi = gelenVeri;
        }
        tablolariCiz();
    });
}

function tablolariCiz() {
    const tbodyGiris = document.getElementById('tbody-giris');
    const tbodyCikis = document.getElementById('tbody-cikis');
    const tbodyGenel = document.getElementById('tbody-genel');

    let girisSayisi = 0, cikisSayisi = 0, genelVarSayisi = 0, genelYokSayisi = 0;

    // 1. KOLON — Giriş Tablosu
    tbodyGiris.innerHTML = "";
    for (let mac in girisYapanlarListesi) {
        const no = girisYapanlarListesi[mac];
        const isim = ogrenciHavuzu[no] || "<em style='color:var(--text-muted)'>Kayıt Dışı</em>";
        girisSayisi++;
        tbodyGiris.innerHTML += `<tr><td><strong>${no}</strong></td><td>${isim}</td></tr>`;
    }
    if (girisSayisi === 0)
        tbodyGiris.innerHTML = `<tr><td colspan="2" class="empty-state">Bağlantı bekleniyor...</td></tr>`;
    document.getElementById('giris-count').innerText = girisSayisi;

    // 2. KOLON — Çıkış Tablosu
    tbodyCikis.innerHTML = "";
    if (dersDurumu === "GIRIS_ACIK") {
        tbodyCikis.innerHTML = `<tr><td colspan="2" class="empty-state">Çıkış başlamadı.</td></tr>`;
    } else {
        for (let mac in cikisYapanlarListesi) {
            const no = cikisYapanlarListesi[mac];
            const isim = ogrenciHavuzu[no] || "<em style='color:var(--text-muted)'>Kayıt Dışı</em>";
            cikisSayisi++;
            tbodyCikis.innerHTML += `<tr><td><strong>${no}</strong></td><td>${isim}</td></tr>`;
        }
        if (cikisSayisi === 0)
            tbodyCikis.innerHTML = `<tr><td colspan="2" class="empty-state">Yeniden bağlantı bekleniyor...</td></tr>`;
    }
    document.getElementById('cikis-count').innerText = cikisSayisi;

    // 3. KOLON — Tüm Sınıf Genel Özeti
    tbodyGenel.innerHTML = "";
    for (let ogrNo in ogrenciHavuzu) {
        const isim = ogrenciHavuzu[ogrNo];
        let durum = "YOK";

        if (dersDurumu === "GIRIS_ACIK") {
            if (Object.values(girisYapanlarListesi).includes(ogrNo)) durum = "VAR";
        } else if (dersDurumu === "CIKIS_ACIK") {
            const giristeVar = Object.values(girisYapanlarListesi).includes(ogrNo);
            const cikistaVar = Object.values(cikisYapanlarListesi).includes(ogrNo);
            if (giristeVar && cikistaVar) durum = "VAR";
        }

        if (durum === "VAR") {
            genelVarSayisi++;
            tbodyGenel.innerHTML += `<tr><td><strong>${ogrNo}</strong></td><td>${isim}</td><td><span class="badge bg-success">VAR</span></td></tr>`;
        } else {
            genelYokSayisi++;
            tbodyGenel.innerHTML += `<tr><td><strong>${ogrNo}</strong></td><td>${isim}</td><td><span class="badge bg-danger">YOK</span></td></tr>`;
        }
    }
    document.getElementById('genel-var-count').innerText = genelVarSayisi;
    document.getElementById('genel-yok-count').innerText = genelYokSayisi;
}

// ==========================================================================
// 9. ÇIKIŞ YOKLAMASI VE DERSİ BİTİRME
// ==========================================================================
document.getElementById('btn-take-exit-attendance').addEventListener('click', () => {
    if (confirm("Giriş yoklaması kapanacak. Öğrencilerin yeniden bağlanması gerekecek. Emin misiniz?")) {
        dersDurumu = "CIKIS_ACIK";

        document.getElementById('btn-take-exit-attendance').style.display = 'none';
        document.getElementById('btn-end-class').disabled = false;

        const badge = document.getElementById('attendance-status-badge');
        badge.className = "status-indicator";
        badge.style.border = "1px solid var(--warning)";
        badge.style.color = "var(--warning)";
        badge.innerHTML = `<i class="fa-solid fa-rotate"></i> ÇIKIŞ YOKLAMASI AKTİF`;

        db.ref(`Eslestirmeler/${seciliSinif}`).remove();
        tablolariCiz();
        toast("Çıkış yoklaması başlatıldı. Öğrenciler yeniden bağlanabilir.", 'info');
    }
});

document.getElementById('btn-end-class').addEventListener('click', () => {
    if (confirm("Ders bitirilecek. ESP32 uyku moduna geçecek. Onaylıyor musunuz?")) {
        db.ref(`Sistem/${seciliSinif}`).remove();
        db.ref(`Eslestirmeler/${seciliSinif}`).remove();

        document.getElementById('view-attendance').classList.add('hidden');
        document.getElementById('view-courses').classList.remove('hidden');

        document.getElementById('nav-yoklama').classList.remove('active');
        document.getElementById('nav-yoklama').classList.add('disabled');
        document.getElementById('nav-dersler').classList.add('active');

        document.getElementById('page-title').innerText = "Derslerim";
        document.getElementById('page-subtitle').innerText = "Kayıtlı olduğunuz derslerin güncel listesi.";

        if (refEslestirme) refEslestirme.off();
        dersDurumu = "BEKLEMEDE";
        toast("Ders başarıyla sonlandırıldı.", 'success');
    }
});

// ==========================================================================
// 10. EXCEL RAPORU
// ==========================================================================
document.getElementById('btn-export').addEventListener('click', () => {
    if (dersDurumu === "GIRIS_ACIK") {
        toast("Rapor almak için önce Çıkış Yoklamasını başlatmalısınız.", 'warning');
        return;
    }

    const satirlar = [['Öğrenci No', 'Ad Soyad', 'Nihai Yoklama Durumu', 'Sınıf', 'Ders']];

    for (let ogrNo in ogrenciHavuzu) {
        const isim = ogrenciHavuzu[ogrNo];
        const giristeVar = Object.values(girisYapanlarListesi).includes(ogrNo);
        const cikistaVar = Object.values(cikisYapanlarListesi).includes(ogrNo);
        const durum = (giristeVar && cikistaVar) ? "VAR" : "YOK";
        satirlar.push([ogrNo, isim, durum, seciliSinif, aktifDersAd]);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(satirlar);
    ws['!cols'] = [{ wch: 15 }, { wch: 25 }, { wch: 20 }, { wch: 10 }, { wch: 35 }];
    XLSX.utils.book_append_sheet(wb, ws, "Nihai_Yoklama");
    XLSX.writeFile(wb, `Yoklama_${seciliSinif}_${new Date().toLocaleDateString('tr-TR').replace(/\./g, '-')}.xlsx`);
    toast("Excel raporu indirildi.", 'success');
});
