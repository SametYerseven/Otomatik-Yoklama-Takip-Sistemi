// ==========================================================================
// 1. FİREBASE BAĞLANTISI VE GLOBAL DEĞİŞKENLER
// ==========================================================================
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let anlikVarlikVerisi = {}; 
let anlikMLVerisi = {}; // YENİ EKLENDİ
let acikAccordionlar = new Set(); // Açık olan accordion ID'lerini tutar
let aktifOgretmen = null;
let aktifDersAd = "";
let seciliSinif = "";
let dersDurumu = "BEKLEMEDE";
let girisYapanlarListesi = {};  
let cikisYapanlarListesi = {};  
let ogrenciHavuzu = {}; 


let yoklamaZamanlayici = null;
let toplamYoklamaSayisi = 0;
let ogrenciLoglari = {}; 

let dersBaslangicZamani = null;
let dersSayaciInterval = null;

// ==========================================================================
// 2. TOAST BİLDİRİM SİSTEMİ
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
// 4. GİRİŞ İŞLEMİ (LOGIN) & CANLI ÖĞRENCİ DİNLEYİCİSİ
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

            db.ref('Siniflar').once('value').then((sinifSnap) => {
                const selectRoom = document.getElementById('select-room-modal');
                selectRoom.innerHTML = "";
                if (sinifSnap.exists()) {
                    sinifSnap.val().forEach(sinif => {
                        selectRoom.innerHTML += `<option value="${sinif}">[${sinif}] Numaralı Derslik</option>`;
                    });
                }

                db.ref('Ogrenciler').on('value', (ogrenciSnap) => {
                    if (ogrenciSnap.exists()) {
                        ogrenciHavuzu = ogrenciSnap.val();
                    } else {
                        ogrenciHavuzu = {};
                    }
                    
                    if(!document.getElementById('modal-students').classList.contains('hidden')) {
                        guncelleOgrenciListesiModal();
                    }
                    if (dersDurumu !== "BEKLEMEDE") {
                        tablolariCiz();
                    }
                });

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
// 5. DERS KARTLARI
// ==========================================================================
function dersKartlariniOlustur(filtre = "") {
    const container = document.getElementById('course-grid-container');
    container.innerHTML = "";
    const filtrelenmis = aktifOgretmen.dersler.filter(ders => ders.toLowerCase().includes(filtre.toLowerCase()));

    if (filtrelenmis.length === 0) {
        container.innerHTML = `<div style="color: var(--text-muted); padding: 20px; grid-column: 1/-1;">Kayıt bulunamadı.</div>`;
        return;
    }

    filtrelenmis.forEach((ders) => {
        const parts = ders.split(" - ");
        const card = document.createElement('div');
        card.className = "course-card";
        card.innerHTML = `
            <div class="card-header">
                <span class="card-code">${parts[0]}</span>
                <h3>${parts[1] || ders} (N.Ö)</h3>
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
document.querySelector('.search-bar-container input').addEventListener('input', (e) => dersKartlariniOlustur(e.target.value));
document.getElementById('btn-cancel-modal').addEventListener('click', () => document.getElementById('modal-room-select').classList.add('hidden'));

// Modal Öğrenci Yönetimi
document.getElementById('btn-show-students').addEventListener('click', () => { 
    guncelleOgrenciListesiModal(); 
    document.getElementById('modal-students').classList.remove('hidden'); 
});
document.getElementById('btn-close-students').addEventListener('click', () => { document.getElementById('modal-students').classList.add('hidden'); });

window.toggleAccordion = function(id) {
    const row = document.getElementById(id);
    if(row) {
        row.classList.toggle('hidden');
        // Eğer class'ta hidden yoksa (yani açıldıysa) Set'e ekle, kapandıysa Set'ten çıkar
        if (!row.classList.contains('hidden')) {
            acikAccordionlar.add(id);
        } else {
            acikAccordionlar.delete(id);
        }
    }
};

// ==========================================================================
// 6. ÖĞRENCİ EKLEME, SİLME VE MANUEL YOKLAMA
// ==========================================================================
document.getElementById('btn-add-student').addEventListener('click', () => {
    const no = document.getElementById('new-student-no').value.trim();
    const ad = document.getElementById('new-student-name').value.trim();

    if (!no || !ad) { toast("Öğrenci no ve adını eksiksiz girin.", 'warning'); return; }
    if (ogrenciHavuzu[no]) { toast(`${no} numaralı öğrenci zaten kayıtlı.`, 'warning'); return; }

    db.ref(`Ogrenciler/${no}`).set(ad).then(() => {
        document.getElementById('new-student-no').value = "";
        document.getElementById('new-student-name').value = "";
        toast(`${ad} başarıyla eklendi.`, 'success');
    }).catch(() => toast("Firebase bağlantı hatası.", 'danger'));
});

window.ogrenciSil = function(no) {
    const ad = ogrenciHavuzu[no];
    if (!confirm(`"${ad}" (${no}) kalıcı olarak silinecek. Emin misiniz?`)) return;

    db.ref(`Ogrenciler/${no}`).remove().then(() => {
        toast(`${ad} silindi.`, 'warning');
    }).catch(() => toast("Firebase bağlantı hatası.", 'danger'));
};

// ÇÖZÜM 2: MANUEL YOKLAMAYA EKLEME FONKSİYONU GERİ GETİRİLDİ
window.ogrenciManuelEkle = function(no) {
    if (dersDurumu === "BEKLEMEDE") {
        toast("Aktif bir ders oturumu yok.", 'warning');
        return;
    }

    const dbPath = `Varlik/${seciliSinif}/${no}`;
    db.ref(dbPath).set({
        durum: "SINIFTA",
        mac: "Manuel-Giris",
        manuel: true
    }).then(() => {
        toast(`${ogrenciHavuzu[no]} manuel olarak yoklamaya eklendi.`, 'success');
    }).catch(() => toast("Firebase bağlantı hatası.", 'danger'));
};

function guncelleOgrenciListesiModal() {
    const list = document.getElementById('modal-student-list');
    const sayac = document.getElementById('modal-student-count');
    const count = Object.keys(ogrenciHavuzu).length;

    if (sayac) sayac.innerText = `${count} öğrenci`;

    const oturumAktif = dersDurumu !== "BEKLEMEDE";
    list.innerHTML = "";
    if (count === 0) {
        list.innerHTML = `<tr><td colspan="${oturumAktif ? 4 : 3}" class="empty-state">Kayıtlı öğrenci yok.</td></tr>`;
        return;
    }

    const thead = document.getElementById('modal-student-thead');
    if (thead) {
        thead.innerHTML = oturumAktif
            ? `<tr><th>Öğrenci No</th><th>Ad Soyad</th><th style="text-align:center">Yoklama</th><th style="text-align:right;padding-right:15px">İşlem</th></tr>`
            : `<tr><th>Öğrenci No</th><th>Ad Soyad</th><th style="text-align:right;padding-right:15px">İşlem</th></tr>`;
    }

    for (let no in ogrenciHavuzu) {
        const isim = ogrenciHavuzu[no];
        // Öğrencinin o an listede olup olmadığını kontrol et
        const zatenVar = (dersDurumu === "CIKIS_ACIK") ? !!cikisYapanlarListesi[no] : !!girisYapanlarListesi[no];

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
                <td>${isim}</td>
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
// 7. YOKLAMAYI BAŞLATMA VE SAYAC
// ==========================================================================
document.getElementById('btn-confirm-start').addEventListener('click', () => {
    seciliSinif = document.getElementById('select-room-modal').value;

    document.getElementById('nav-dersler').classList.remove('active');
    document.getElementById('nav-yoklama').classList.add('active');
    document.getElementById('nav-yoklama').classList.remove('disabled');

    document.getElementById('dyn-course-code').innerText = aktifDersAd.split(" - ")[0];
    document.getElementById('dyn-course-name').innerText = aktifDersAd.split(" - ")[1] || aktifDersAd;
    
    document.getElementById('dyn-room-name').innerHTML = `Sınıf ${seciliSinif} &nbsp;|&nbsp; <i class="fa-solid fa-stopwatch" style="color:var(--primary);"></i> Toplam Süre: <span id="lesson-timer-display" style="font-weight:bold;">00:00</span>`;

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
    
    toplamYoklamaSayisi = 0;
    ogrenciLoglari = {};
    for (let no in ogrenciHavuzu) {
        ogrenciLoglari[no] = { varSayisi: 0, kayitlar: [] };
    }

    dersBaslangicZamani = new Date();
    dersSayaciInterval = setInterval(() => {
        const fark = Math.floor((new Date() - dersBaslangicZamani) / 1000);
        const dk = String(Math.floor(fark / 60)).padStart(2, '0');
        const sn = String(fark % 60).padStart(2, '0');
        const timerEl = document.getElementById('lesson-timer-display');
        if (timerEl) timerEl.innerText = `${dk}:${sn}`;
    }, 1000);

    db.ref(`Varlik/${seciliSinif}`).remove().then(() => {
        db.ref(`Sistem/${seciliSinif}`).set({ durum: "AKTIF", ders: aktifDersAd });
        verileriDinle();
        
        yoklamaZamanlayici = setInterval(otomatikYoklamaAl, 20000);
        otomatikYoklamaAl(); 
        
        toast(`Sınıf ${seciliSinif} aktif edildi. Sürekli takip başlatıldı.`, 'info');
    });
});



// ==========================================================================
// 8. FİREBASE DİNLEME VE PERİYODİK LOGLAMA
// ==========================================================================
let refVarlik = null;

function verileriDinle() {
    if (refVarlik) refVarlik.off();
    
    db.ref(`ML_Tahmin/${seciliSinif}`).on('value', (snap) => {
        anlikMLVerisi = snap.exists() ? snap.val() : {};
    });

    refVarlik = db.ref(`Varlik/${seciliSinif}`);
    refVarlik.on('value', (snap) => {
        anlikVarlikVerisi = snap.exists() ? snap.val() : {};
        
        if (dersDurumu === "CIKIS_ACIK") {
            for (let ogrNo in anlikVarlikVerisi) {
                if (anlikVarlikVerisi[ogrNo].durum === "SINIFTA") {
                    cikisYapanlarListesi[ogrNo] = ogrNo;
                }
            }
        }
        tablolariCiz(); 
    });

    // RFID listener artık burada — seciliSinif artık dolu
    db.ref(`Sistem/${seciliSinif}/SonOkunanKart`).on('value', (snap) => {
        if (snap.exists() && rfidAktif && dersDurumu !== "BEKLEMEDE") {
            const uid = snap.val();
            
            db.ref(`RFID_Kartlar/${uid}`).once('value', (kartSnap) => {
                if (kartSnap.exists()) {
                    const kayitliOgrNo = String(kartSnap.val());
                    ogrenciManuelEkle(kayitliOgrNo);
                    
                    if (dersDurumu === "CIKIS_ACIK") {
                        cikisYapanlarListesi[kayitliOgrNo] = kayitliOgrNo;
                        tablolariCiz();
                    }
                    
                    toast(`💳 ${kayitliOgrNo} numaralı öğrenci RFID ile onaylandı!`, "success");
                } else {
                    toast(`⚠️ Okunan Kart (${uid}) sistemde kayıtlı değil!`, "danger");
                }
                
                db.ref(`Sistem/${seciliSinif}/SonOkunanKart`).remove();
            });
        }
    });
}

function otomatikYoklamaAl() {
    if (dersDurumu !== "GIRIS_ACIK") return;
    
    toplamYoklamaSayisi++;
    const simdi = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    for (let ogrNo in ogrenciHavuzu) {
        const ogrenciDurumu = anlikVarlikVerisi[ogrNo];
        
        if (ogrenciDurumu && ogrenciDurumu.durum === "SINIFTA") {
            if (!ogrenciLoglari[ogrNo]) {
                ogrenciLoglari[ogrNo] = { varSayisi: 0, kayitlar: [] };
            }
            ogrenciLoglari[ogrNo].varSayisi++;
            ogrenciLoglari[ogrNo].kayitlar.push({ zaman: simdi, durum: 'VAR', mac: ogrenciDurumu.mac || "Bilinmiyor" });
            girisYapanlarListesi[ogrNo] = ogrNo; 
        } else {
            if (!ogrenciLoglari[ogrNo]) ogrenciLoglari[ogrNo] = { varSayisi: 0, kayitlar: [] };
            ogrenciLoglari[ogrNo].kayitlar.push({ zaman: simdi, durum: 'YOK', mac: '-' });
        }
    }
    tablolariCiz();
}

function tablolariCiz() {
    const tbodyGiris = document.getElementById('tbody-giris');
    const tbodyCikis = document.getElementById('tbody-cikis');
    const tbodyGenel = document.getElementById('tbody-genel');

    let girisSayisi = 0, cikisSayisi = 0, genelVarSayisi = 0, genelYokSayisi = 0;

    tbodyGiris.innerHTML = "";
    for (let ogrNo in girisYapanlarListesi) {
        const isim = ogrenciHavuzu[ogrNo] || "Kayıt Dışı";
        girisSayisi++;
        
        const logData = ogrenciLoglari[ogrNo];
        const yuzde = toplamYoklamaSayisi === 0 ? 0 : Math.round((logData.varSayisi / toplamYoklamaSayisi) * 100);
        const anlikMac = (anlikVarlikVerisi[ogrNo] && anlikVarlikVerisi[ogrNo].mac) ? anlikVarlikVerisi[ogrNo].mac : "-";
        
        const bagliGosterim = (dersDurumu === "CIKIS_ACIK") ? true : (anlikVarlikVerisi[ogrNo] && anlikVarlikVerisi[ogrNo].durum === "SINIFTA");

        const accordionID = `acc-${ogrNo}`;
        const isHidden = acikAccordionlar.has(accordionID) ? '' : 'hidden';

        tbodyGiris.innerHTML += `
            <tr style="cursor: pointer; background: ${bagliGosterim ? 'transparent' : 'rgba(239, 68, 68, 0.1)'}" onclick="toggleAccordion('${accordionID}')">
                <td><strong>${ogrNo}</strong></td>
                <td>
                    ${isim} 
                    <span style="float:right; font-size:0.8rem; background: ${yuzde >= 70 ? 'var(--success)' : 'var(--danger)'}; color: white; padding:2px 6px; border-radius:4px;">
                        %${yuzde}
                    </span>
                </td>
            </tr>
            <tr id="${accordionID}" class="${isHidden}" style="background: rgba(0,0,0,0.25);">
                <td colspan="2" style="padding: 15px;">
                    <div style="font-size:0.8rem; margin-bottom:10px; color:var(--text-muted); display:flex; justify-content:space-between;">
                        <span><i class="fa-solid fa-microchip"></i> Son MAC: ${anlikMac}</span>
                        <span><i class="fa-solid fa-clock"></i> Kontrol: ${toplamYoklamaSayisi}</span>
                    </div>
                    <div style="max-height: 150px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 4px;">
                        <table style="width:100%; font-size:0.75rem; text-align:center; border-collapse: collapse;">
                            <thead style="background:var(--bg-card); position:sticky; top:0;">
                                <tr>
                                    <th style="padding:6px; border-bottom:1px solid #374151;">Saat</th>
                                    <th style="padding:6px; border-bottom:1px solid #374151;">Durum</th>
                                    <th style="padding:6px; border-bottom:1px solid #374151;">MAC</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${logData.kayitlar.map(l => `
                                    <tr>
                                        <td style="padding:6px; border-bottom:1px solid #374151;">${l.zaman}</td>
                                        <td style="padding:6px; border-bottom:1px solid #374151; color: ${l.durum === 'VAR' ? 'var(--success)' : 'var(--danger)'}; font-weight:bold;">${l.durum}</td>
                                        <td style="padding:6px; border-bottom:1px solid #374151;">${l.mac}</td>
                                    </tr>
                                `).reverse().join('')}
                            </tbody>
                        </table>
                    </div>
                </td>
            </tr>`;
    }
    if (girisSayisi === 0) tbodyGiris.innerHTML = `<tr><td colspan="2" class="empty-state">Bağlantı bekleniyor...</td></tr>`;
    document.getElementById('giris-count').innerText = girisSayisi;

    // TERTEMİZ ÇIKIŞ YOKLAMASI TABLOSU (Kırmızı yazılar tamamen kalktı)
    tbodyCikis.innerHTML = "";
    if (dersDurumu === "GIRIS_ACIK") {
        tbodyCikis.innerHTML = `<tr><td colspan="2" class="empty-state">Çıkış başlamadı.</td></tr>`;
    } else {
        for (let ogrNo in cikisYapanlarListesi) {
            const isim = ogrenciHavuzu[ogrNo] || "Kayıt Dışı";
            cikisSayisi++;
            tbodyCikis.innerHTML += `<tr><td><strong>${ogrNo}</strong></td><td>${isim}</td><td><span class="badge bg-success"><i class="fa-solid fa-check"></i> Onaylandı</span></td></tr>`;
        }
        if (cikisSayisi === 0) tbodyCikis.innerHTML = `<tr><td colspan="3" class="empty-state" style="color:var(--warning);"><i class="fa-solid fa-circle-notch fa-spin"></i> Öğrencilerin yeniden bağlanması bekleniyor...</td></tr>`;
    }
    document.getElementById('cikis-count').innerText = cikisSayisi;

    tbodyGenel.innerHTML = "";
    for (let ogrNo in ogrenciHavuzu) {
        const isim = ogrenciHavuzu[ogrNo];
        let durum = "YOK";

        const logData = ogrenciLoglari[ogrNo] || { varSayisi: 0 };
        const yuzde = toplamYoklamaSayisi === 0 ? 0 : Math.round((logData.varSayisi / toplamYoklamaSayisi) * 100);

        if (dersDurumu === "GIRIS_ACIK") {
            if (anlikVarlikVerisi[ogrNo] && anlikVarlikVerisi[ogrNo].durum === "SINIFTA") durum = "VAR";
        } else if (dersDurumu === "CIKIS_ACIK") {
            const giristeVar = !!girisYapanlarListesi[ogrNo];
            const cikistaVar = !!cikisYapanlarListesi[ogrNo];

            if (giristeVar && cikistaVar && yuzde >= 70) {
                durum = "VAR";
            }
        }

        if (durum === "VAR") {
            genelVarSayisi++;
            tbodyGenel.innerHTML += `<tr><td><strong>${ogrNo}</strong></td><td>${isim}</td><td><span class="badge bg-success">VAR (%${yuzde})</span></td></tr>`;
        } else {
            genelYokSayisi++;
            tbodyGenel.innerHTML += `<tr><td><strong>${ogrNo}</strong></td><td>${isim}</td><td><span class="badge bg-danger">YOK (%${yuzde})</span></td></tr>`;
        }
    }
    document.getElementById('genel-var-count').innerText = genelVarSayisi;
    document.getElementById('genel-yok-count').innerText = genelYokSayisi;
}

// ==========================================================================
// 9. ÇIKIŞ YOKLAMASI VE DERSİ BİTİRME (KUSURSUZ SENARYO)
// ==========================================================================
document.getElementById('btn-take-exit-attendance').addEventListener('click', () => {
    if (confirm("Çıkış yoklaması başlatılacak. Dışarıda tespit edilen veya bağlantısı kopan öğrenciler düşürülecek. Emin misiniz?")) {
        dersDurumu = "CIKIS_ACIK";
        
        clearInterval(yoklamaZamanlayici); 

        document.getElementById('btn-take-exit-attendance').style.display = 'none';
        document.getElementById('btn-end-class').disabled = false;

        const badge = document.getElementById('attendance-status-badge');
        badge.className = "status-indicator";
        badge.style.border = "1px solid var(--warning)";
        badge.style.color = "var(--warning)";
        badge.innerHTML = `<i class="fa-solid fa-rotate"></i> ÇIKIŞ YOKLAMASI BAŞLADI`;

        cikisYapanlarListesi = {};
        let korunanOgrenciler = {};

        // BUTONA BASILDIĞI AN ML'E BAKIYORUZ:
        // Eğer ML öğrencinin gerçekten içeride olduğunu doğruluyorsa silme, koru.
        for (let ogrNo in girisYapanlarListesi) {
            if (anlikVarlikVerisi[ogrNo] && anlikVarlikVerisi[ogrNo].durum === "SINIFTA") {
                if (anlikMLVerisi[ogrNo] && anlikMLVerisi[ogrNo].sinif_ici === true) {
                    cikisYapanlarListesi[ogrNo] = ogrNo;
                    korunanOgrenciler[ogrNo] = anlikVarlikVerisi[ogrNo]; // Onaylıyı tut
                }
            }
        }

        // Firebase'i güncelle: ML'in "Dışarıda" dediği herkes (veya bağlantısı kopanlar) tamamen silinir.
        db.ref(`Varlik/${seciliSinif}`).set(korunanOgrenciler).then(() => {
            db.ref(`Sistem/${seciliSinif}`).update({ durum: "CIKIS" });
            tablolariCiz();
            toast("Çıkış yoklaması başladı. Sınıftakiler onaylandı, dışarıdakiler/kopanlar düşürüldü.", 'info');
        });
    }
});

document.getElementById('btn-end-class').addEventListener('click', () => {
    if (confirm("Ders bitirilecek. ESP32 bekleme moduna geçecek. Onaylıyor musunuz?")) {
        clearInterval(dersSayaciInterval); 
        
        db.ref(`Sistem/${seciliSinif}`).remove();
        db.ref(`Varlik/${seciliSinif}`).remove();  

        document.getElementById('view-attendance').classList.add('hidden');
        document.getElementById('view-courses').classList.remove('hidden');

        document.getElementById('nav-yoklama').classList.remove('active');
        document.getElementById('nav-yoklama').classList.add('disabled');
        document.getElementById('nav-dersler').classList.add('active');

        document.getElementById('page-title').innerText = "Derslerim";
        document.getElementById('page-subtitle').innerText = "Kayıtlı olduğunuz derslerin güncel listesi.";

        if (refVarlik) refVarlik.off();
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

    const satirlar = [['Öğrenci No', 'Ad Soyad', 'Katılım Yüzdesi', 'Nihai Durum', 'Sınıf', 'Ders']];

    for (let ogrNo in ogrenciHavuzu) {
        const isim = ogrenciHavuzu[ogrNo];
        const logData = ogrenciLoglari[ogrNo] || { varSayisi: 0 };
        const yuzde = toplamYoklamaSayisi === 0 ? 0 : Math.round((logData.varSayisi / toplamYoklamaSayisi) * 100);

        const giristeVar = !!girisYapanlarListesi[ogrNo];
        const cikistaVar = !!cikisYapanlarListesi[ogrNo];
        const durum = (giristeVar && cikistaVar && yuzde >= 70) ? "VAR" : "YOK";
        
        satirlar.push([ogrNo, isim, `%${yuzde}`, durum, seciliSinif, aktifDersAd]);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(satirlar);
    ws['!cols'] = [{ wch: 15 }, { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 35 }];
    XLSX.utils.book_append_sheet(wb, ws, "Nihai_Yoklama");
    XLSX.writeFile(wb, `Yoklama_${seciliSinif}_${new Date().toLocaleDateString('tr-TR').replace(/\./g, '-')}.xlsx`);
    toast("Excel raporu indirildi.", 'success');
});

// ==========================================================================
// 11. RFID KONTROL VE YOKLAMA İŞLEME SİSTEMİ (ÖNCEDEN KAYITLI KARTLAR)
// ==========================================================================
let rfidAktif = false;

document.getElementById('btn-toggle-rfid').addEventListener('click', () => {
    if (dersDurumu === "BEKLEMEDE") {
        toast("RFID okuyucuyu açmak için önce bir ders başlatmalısınız!", "warning");
        return;
    }
    
    rfidAktif = !rfidAktif;
    const btn = document.getElementById('btn-toggle-rfid');

    // ESP32'ye Firebase üzerinden "Okuyucuyu Aç/Kapat" emri gönderiyoruz
    db.ref(`Sistem/${seciliSinif}/rfid_izin`).set(rfidAktif).then(() => {
        if(rfidAktif) {
            btn.innerHTML = `<i class="fa-solid fa-wifi"></i> Kart Okutma: AÇIK`;
            btn.style.backgroundColor = "var(--success)";
            toast("RFID Aktif: Öğrenciler giriş veya çıkış için kart okutabilir.", "success");
        } else {
            btn.innerHTML = `<i class="fa-solid fa-id-card"></i> Kart Okutma: KAPALI`;
            btn.style.backgroundColor = "var(--warning)";
            toast("RFID Okuyucu kapatıldı.", "info");
        }
    });
});

