// ==========================================================================
// 1. FİREBASE BAĞLANTISI VE GLOBAL DEĞİŞKENLER
// ==========================================================================
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let livePresenceData = {}; 
let liveMLData = {}; // YENİ EKLENDİ
let openAccordions = new Set(); // Açık olan accordion ID'lerini tutar
let activeTeacher = null;
let activeCourseName = "";
let selectedClassroom = "";
let lessonStatus = "IDLE";
let checkedInList = {};  
let checkedOutList = {};  
let studentPool = {}; 


let attendanceTimer = null;
let totalAttendanceChecks = 0;
let studentLogs = {}; 

let lessonStartTime = null;
let lessonTimerInterval = null;

// ==========================================================================
// 2. TOAST BİLDİRİM SİSTEMİ
// ==========================================================================
function toast(message, type = 'info') {
    const icons = { success: 'fa-check-circle', danger: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i> ${message}`;
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

    db.ref(`Teachers/${username}`).once('value', (snap) => {
        if (snap.exists() && snap.val().password === pass) {
            activeTeacher = snap.val();
            document.getElementById('teacher-name-display').innerText = activeTeacher.name;

            db.ref('Classrooms').once('value').then((classroomSnap) => {
                const selectRoom = document.getElementById('select-room-modal');
                selectRoom.innerHTML = "";
                if (classroomSnap.exists()) {
                    classroomSnap.val().forEach(classroom => {
                        selectRoom.innerHTML += `<option value="${classroom}">[${classroom}] Numaralı Derslik</option>`;
                    });
                }

                db.ref('Students').on('value', (studentSnap) => {
                    if (studentSnap.exists()) {
                        studentPool = studentSnap.val();
                    } else {
                        studentPool = {};
                    }
                    
                    if(!document.getElementById('modal-students').classList.contains('hidden')) {
                        updateStudentListModal();
                    }
                    if (lessonStatus !== "IDLE") {
                        renderTables();
                    }
                });

                renderCourseCards();
                document.getElementById('screen-login').classList.add('hidden');
                document.getElementById('screen-main').classList.remove('hidden');
                toast(`Hoş geldiniz, ${activeTeacher.name}`, 'success');
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
function renderCourseCards(searchText = "") {
    const container = document.getElementById('course-grid-container');
    container.innerHTML = "";
    const filtered = activeTeacher.courses.filter(course => course.toLowerCase().includes(searchText.toLowerCase()));

    if (filtered.length === 0) {
        container.innerHTML = `<div style="color: var(--text-muted); padding: 20px; grid-column: 1/-1;">Kayıt bulunamadı.</div>`;
        return;
    }

    filtered.forEach((course) => {
        const parts = course.split(" - ");
        const card = document.createElement('div');
        card.className = "course-card";
        card.innerHTML = `
            <div class="card-header">
                <span class="card-code">${parts[0]}</span>
                <h3>${parts[1] || course} (N.Ö)</h3>
            </div>
            <div class="card-body">
                <p><i class="fa-solid fa-user"></i> ${activeTeacher.name}</p>
                <p><i class="fa-solid fa-calendar-day"></i> Oturum Başlatmaya Hazır</p>
            </div>
        `;
        card.addEventListener('click', () => {
            activeCourseName = course;
            document.getElementById('modal-course-title').innerText = course;
            document.getElementById('modal-room-select').classList.remove('hidden');
        });
        container.appendChild(card);
    });
}
document.querySelector('.search-bar-container input').addEventListener('input', (e) => renderCourseCards(e.target.value));
document.getElementById('btn-cancel-modal').addEventListener('click', () => document.getElementById('modal-room-select').classList.add('hidden'));

// Modal Öğrenci Yönetimi
document.getElementById('btn-show-students').addEventListener('click', () => { 
    updateStudentListModal(); 
    document.getElementById('modal-students').classList.remove('hidden'); 
});
document.getElementById('btn-close-students').addEventListener('click', () => { document.getElementById('modal-students').classList.add('hidden'); });

window.toggleAccordion = function(id) {
    const row = document.getElementById(id);
    if(row) {
        row.classList.toggle('hidden');
        // Eğer class'ta hidden yoksa (yani açıldıysa) Set'e ekle, kapandıysa Set'ten çıkar
        if (!row.classList.contains('hidden')) {
            openAccordions.add(id);
        } else {
            openAccordions.delete(id);
        }
    }
};

// ==========================================================================
// 6. ÖĞRENCİ EKLEME, SİLME VE MANUEL YOKLAMA
// ==========================================================================
document.getElementById('btn-add-student').addEventListener('click', () => {
    const studentNo = document.getElementById('new-student-no').value.trim();
    const name = document.getElementById('new-student-name').value.trim();

    if (!studentNo || !name) { toast("Öğrenci no ve adını eksiksiz girin.", 'warning'); return; }
    if (studentPool[studentNo]) { toast(`${studentNo} numaralı öğrenci zaten kayıtlı.`, 'warning'); return; }

    db.ref(`Students/${studentNo}`).set(name).then(() => {
        document.getElementById('new-student-no').value = "";
        document.getElementById('new-student-name').value = "";
        toast(`${name} başarıyla eklendi.`, 'success');
    }).catch(() => toast("Firebase bağlantı hatası.", 'danger'));
});

window.deleteStudent = function(studentNo) {
    const name = studentPool[studentNo];
    if (!confirm(`"${name}" (${studentNo}) kalıcı olarak silinecek. Emin misiniz?`)) return;

    db.ref(`Students/${studentNo}`).remove().then(() => {
        toast(`${name} silindi.`, 'warning');
    }).catch(() => toast("Firebase bağlantı hatası.", 'danger'));
};

// ÇÖZÜM 2: MANUEL YOKLAMAYA EKLEME FONKSİYONU GERİ GETİRİLDİ
window.addStudentManually = function(studentNo) {
    if (lessonStatus === "IDLE") {
        toast("Aktif bir ders oturumu yok.", 'warning');
        return;
    }

    const dbPath = `Presence/${selectedClassroom}/${studentNo}`;
    db.ref(dbPath).set({
        status: "IN_CLASS",
        mac: "Manuel-Giris",
        manual: true
    }).then(() => {
        toast(`${studentPool[studentNo]} manuel olarak yoklamaya eklendi.`, 'success');
    }).catch(() => toast("Firebase bağlantı hatası.", 'danger'));
};

function updateStudentListModal() {
    const list = document.getElementById('modal-student-list');
    const counter = document.getElementById('modal-student-count');
    const count = Object.keys(studentPool).length;

    if (counter) counter.innerText = `${count} öğrenci`;

    const sessionActive = lessonStatus !== "IDLE";
    list.innerHTML = "";
    if (count === 0) {
        list.innerHTML = `<tr><td colspan="${sessionActive ? 4 : 3}" class="empty-state">Kayıtlı öğrenci yok.</td></tr>`;
        return;
    }

    const thead = document.getElementById('modal-student-thead');
    if (thead) {
        thead.innerHTML = sessionActive
            ? `<tr><th>Öğrenci No</th><th>Ad Soyad</th><th style="text-align:center">Yoklama</th><th style="text-align:right;padding-right:15px">İşlem</th></tr>`
            : `<tr><th>Öğrenci No</th><th>Ad Soyad</th><th style="text-align:right;padding-right:15px">İşlem</th></tr>`;
    }

    for (let studentNo in studentPool) {
        const name = studentPool[studentNo];
        // Öğrencinin o an listede olup olmadığını kontrol et
        const alreadyAdded = (lessonStatus === "CHECKOUT_OPEN") ? !!checkedOutList[studentNo] : !!checkedInList[studentNo];

        const manualBtn = sessionActive
            ? `<td style="text-align:center">
                <button onclick="addStudentManually('${studentNo}')"
                    class="btn-icon-manual ${alreadyAdded ? 'added' : ''}"
                    ${alreadyAdded ? 'disabled' : ''}
                    title="${alreadyAdded ? 'Zaten eklendi' : 'Derse manuel ekle'}">
                    <i class="fa-solid ${alreadyAdded ? 'fa-check' : 'fa-user-plus'}"></i>
                    ${alreadyAdded ? 'Eklendi' : 'Ekle'}
                </button>
               </td>`
            : '';

        list.innerHTML += `
            <tr>
                <td><strong>${studentNo}</strong></td>
                <td>${name}</td>
                ${manualBtn}
                <td style="text-align:right; padding-right: 15px;">
                    <button onclick="deleteStudent('${studentNo}')" class="btn-icon-danger" title="Öğrenciyi Sil">
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
    selectedClassroom = document.getElementById('select-room-modal').value;

    document.getElementById('nav-courses').classList.remove('active');
    document.getElementById('nav-attendance').classList.add('active');
    document.getElementById('nav-attendance').classList.remove('disabled');

    document.getElementById('dyn-course-code').innerText = activeCourseName.split(" - ")[0];
    document.getElementById('dyn-course-name').innerText = activeCourseName.split(" - ")[1] || activeCourseName;
    
    document.getElementById('dyn-room-name').innerHTML = `Sınıf ${selectedClassroom} &nbsp;|&nbsp; <i class="fa-solid fa-stopwatch" style="color:var(--primary);"></i> Toplam Süre: <span id="lesson-timer-display" style="font-weight:bold;">00:00</span>`;

    document.getElementById('modal-room-select').classList.add('hidden');
    document.getElementById('view-courses').classList.add('hidden');
    document.getElementById('view-attendance').classList.remove('hidden');

    document.getElementById('btn-take-exit-attendance').style.display = 'inline-flex';
    document.getElementById('btn-end-class').disabled = true;

    const badge = document.getElementById('attendance-status-badge');
    badge.className = "status-indicator in-progress";
    badge.style = "";
    badge.innerHTML = `<i class="fa-solid fa-door-open"></i> GİRİŞ AÇIK`;

    lessonStatus = "CHECKIN_OPEN";
    checkedInList = {};
    checkedOutList = {};
    
    totalAttendanceChecks = 0;
    studentLogs = {};
    for (let studentNo in studentPool) {
        studentLogs[studentNo] = { presentCount: 0, records: [] };
    }

    lessonStartTime = new Date();
    lessonTimerInterval = setInterval(() => {
        const elapsed = Math.floor((new Date() - lessonStartTime) / 1000);
        const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const seconds = String(elapsed % 60).padStart(2, '0');
        const timerEl = document.getElementById('lesson-timer-display');
        if (timerEl) timerEl.innerText = `${minutes}:${seconds}`;
    }, 1000);

    db.ref(`Presence/${selectedClassroom}`).remove().then(() => {
        db.ref(`System/${selectedClassroom}`).set({ status: "ACTIVE", course: activeCourseName });
        listenToData();
        
        attendanceTimer = setInterval(takeAutomaticAttendance, 20000);
        takeAutomaticAttendance(); 
        
        toast(`Sınıf ${selectedClassroom} aktif edildi. Sürekli takip başlatıldı.`, 'info');
    });
});



// ==========================================================================
// 8. FİREBASE DİNLEME VE PERİYODİK LOGLAMA
// ==========================================================================
let presenceRef = null;

function listenToData() {
    if (presenceRef) presenceRef.off();
    
    db.ref(`MLPrediction/${selectedClassroom}`).on('value', (snap) => {
        liveMLData = snap.exists() ? snap.val() : {};
    });

    presenceRef = db.ref(`Presence/${selectedClassroom}`);
    presenceRef.on('value', (snap) => {
        livePresenceData = snap.exists() ? snap.val() : {};
        
        if (lessonStatus === "CHECKOUT_OPEN") {
            for (let studentNo in livePresenceData) {
                if (livePresenceData[studentNo].status === "IN_CLASS") {
                    checkedOutList[studentNo] = studentNo;
                }
            }
        }
        renderTables(); 
    });

    // RFID listener artık burada — selectedClassroom artık dolu
    db.ref(`System/${selectedClassroom}/lastReadCard`).on('value', (snap) => {
        if (snap.exists() && rfidActive && lessonStatus !== "IDLE") {
            const uid = snap.val();
            
            db.ref(`RFIDCards/${uid}`).once('value', (cardSnap) => {
                if (cardSnap.exists()) {
                    const registeredStudentNo = String(cardSnap.val());
                    addStudentManually(registeredStudentNo);
                    
                    if (lessonStatus === "CHECKOUT_OPEN") {
                        checkedOutList[registeredStudentNo] = registeredStudentNo;
                        renderTables();
                    }
                    
                    toast(`💳 ${registeredStudentNo} numaralı öğrenci RFID ile onaylandı!`, "success");
                } else {
                    toast(`⚠️ Okunan Kart (${uid}) sistemde kayıtlı değil!`, "danger");
                }
                
                db.ref(`System/${selectedClassroom}/lastReadCard`).remove();
            });
        }
    });
}

function takeAutomaticAttendance() {
    if (lessonStatus !== "CHECKIN_OPEN") return;
    
    totalAttendanceChecks++;
    const now = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    for (let studentNo in studentPool) {
        const studentPresence = livePresenceData[studentNo];
        
        if (studentPresence && studentPresence.status === "IN_CLASS") {
            if (!studentLogs[studentNo]) {
                studentLogs[studentNo] = { presentCount: 0, records: [] };
            }
            studentLogs[studentNo].presentCount++;
            studentLogs[studentNo].records.push({ time: now, status: 'VAR', mac: studentPresence.mac || "Bilinmiyor" });
            checkedInList[studentNo] = studentNo; 
        } else {
            if (!studentLogs[studentNo]) studentLogs[studentNo] = { presentCount: 0, records: [] };
            studentLogs[studentNo].records.push({ time: now, status: 'YOK', mac: '-' });
        }
    }
    renderTables();
}

function renderTables() {
    const tbodyCheckIn = document.getElementById('tbody-checkin');
    const tbodyCheckOut = document.getElementById('tbody-checkout');
    const tbodySummary = document.getElementById('tbody-summary');

    let checkInCount = 0, checkOutCount = 0, totalPresent = 0, totalAbsent = 0;

    tbodyCheckIn.innerHTML = "";
    for (let studentNo in checkedInList) {
        const name = studentPool[studentNo] || "Kayıt Dışı";
        checkInCount++;
        
        const logData = studentLogs[studentNo];
        const percentage = totalAttendanceChecks === 0 ? 0 : Math.round((logData.presentCount / totalAttendanceChecks) * 100);
        const currentMac = (livePresenceData[studentNo] && livePresenceData[studentNo].mac) ? livePresenceData[studentNo].mac : "-";
        
        const isConnected = (lessonStatus === "CHECKOUT_OPEN") ? true : (livePresenceData[studentNo] && livePresenceData[studentNo].status === "IN_CLASS");

        const accordionID = `acc-${studentNo}`;
        const isHidden = openAccordions.has(accordionID) ? '' : 'hidden';

        tbodyCheckIn.innerHTML += `
            <tr style="cursor: pointer; background: ${isConnected ? 'transparent' : 'rgba(239, 68, 68, 0.1)'}" onclick="toggleAccordion('${accordionID}')">
                <td><strong>${studentNo}</strong></td>
                <td>
                    ${name} 
                    <span style="float:right; font-size:0.8rem; background: ${percentage >= 70 ? 'var(--success)' : 'var(--danger)'}; color: white; padding:2px 6px; border-radius:4px;">
                        %${percentage}
                    </span>
                </td>
            </tr>
            <tr id="${accordionID}" class="${isHidden}" style="background: rgba(0,0,0,0.25);">
                <td colspan="2" style="padding: 15px;">
                    <div style="font-size:0.8rem; margin-bottom:10px; color:var(--text-muted); display:flex; justify-content:space-between;">
                        <span><i class="fa-solid fa-microchip"></i> Son MAC: ${currentMac}</span>
                        <span><i class="fa-solid fa-clock"></i> Kontrol: ${totalAttendanceChecks}</span>
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
                                ${logData.records.map(l => `
                                    <tr>
                                        <td style="padding:6px; border-bottom:1px solid #374151;">${l.time}</td>
                                        <td style="padding:6px; border-bottom:1px solid #374151; color: ${l.status === 'VAR' ? 'var(--success)' : 'var(--danger)'}; font-weight:bold;">${l.status}</td>
                                        <td style="padding:6px; border-bottom:1px solid #374151;">${l.mac}</td>
                                    </tr>
                                `).reverse().join('')}
                            </tbody>
                        </table>
                    </div>
                </td>
            </tr>`;
    }
    if (checkInCount === 0) tbodyCheckIn.innerHTML = `<tr><td colspan="2" class="empty-state">Bağlantı bekleniyor...</td></tr>`;
    document.getElementById('checkin-count').innerText = checkInCount;

    // TERTEMİZ ÇIKIŞ YOKLAMASI TABLOSU (Kırmızı yazılar tamamen kalktı)
    tbodyCheckOut.innerHTML = "";
    if (lessonStatus === "CHECKIN_OPEN") {
        tbodyCheckOut.innerHTML = `<tr><td colspan="2" class="empty-state">Çıkış başlamadı.</td></tr>`;
    } else {
        for (let studentNo in checkedOutList) {
            const name = studentPool[studentNo] || "Kayıt Dışı";
            checkOutCount++;
            tbodyCheckOut.innerHTML += `<tr><td><strong>${studentNo}</strong></td><td>${name}</td><td><span class="badge bg-success"><i class="fa-solid fa-check"></i> Onaylandı</span></td></tr>`;
        }
        if (checkOutCount === 0) tbodyCheckOut.innerHTML = `<tr><td colspan="3" class="empty-state" style="color:var(--warning);"><i class="fa-solid fa-circle-notch fa-spin"></i> Öğrencilerin yeniden bağlanması bekleniyor...</td></tr>`;
    }
    document.getElementById('checkout-count').innerText = checkOutCount;

    tbodySummary.innerHTML = "";
    for (let studentNo in studentPool) {
        const name = studentPool[studentNo];
        let status = "YOK";

        const logData = studentLogs[studentNo] || { presentCount: 0 };
        const percentage = totalAttendanceChecks === 0 ? 0 : Math.round((logData.presentCount / totalAttendanceChecks) * 100);

        if (lessonStatus === "CHECKIN_OPEN") {
            if (livePresenceData[studentNo] && livePresenceData[studentNo].status === "IN_CLASS") status = "VAR";
        } else if (lessonStatus === "CHECKOUT_OPEN") {
            const inCheckIn = !!checkedInList[studentNo];
            const inCheckOut = !!checkedOutList[studentNo];

            if (inCheckIn && inCheckOut && percentage >= 70) {
                status = "VAR";
            }
        }

        if (status === "VAR") {
            totalPresent++;
            tbodySummary.innerHTML += `<tr><td><strong>${studentNo}</strong></td><td>${name}</td><td><span class="badge bg-success">VAR (%${percentage})</span></td></tr>`;
        } else {
            totalAbsent++;
            tbodySummary.innerHTML += `<tr><td><strong>${studentNo}</strong></td><td>${name}</td><td><span class="badge bg-danger">YOK (%${percentage})</span></td></tr>`;
        }
    }
    document.getElementById('summary-present-count').innerText = totalPresent;
    document.getElementById('summary-absent-count').innerText = totalAbsent;
}

// ==========================================================================
// 9. ÇIKIŞ YOKLAMASI VE DERSİ BİTİRME (KUSURSUZ SENARYO)
// ==========================================================================
document.getElementById('btn-take-exit-attendance').addEventListener('click', () => {
    if (confirm("Çıkış yoklaması başlatılacak. Dışarıda tespit edilen veya bağlantısı kopan öğrenciler düşürülecek. Emin misiniz?")) {
        lessonStatus = "CHECKOUT_OPEN";
        
        clearInterval(attendanceTimer); 

        document.getElementById('btn-take-exit-attendance').style.display = 'none';
        document.getElementById('btn-end-class').disabled = false;

        const badge = document.getElementById('attendance-status-badge');
        badge.className = "status-indicator";
        badge.style.border = "1px solid var(--warning)";
        badge.style.color = "var(--warning)";
        badge.innerHTML = `<i class="fa-solid fa-rotate"></i> ÇIKIŞ YOKLAMASI BAŞLADI`;

        checkedOutList = {};
        let keptStudents = {};

        // BUTONA BASILDIĞI AN ML'E BAKIYORUZ:
        // Eğer ML öğrencinin gerçekten içeride olduğunu doğruluyorsa silme, koru.
        for (let studentNo in checkedInList) {
            if (livePresenceData[studentNo] && livePresenceData[studentNo].status === "IN_CLASS") {
                if (liveMLData[studentNo] && liveMLData[studentNo].in_class === true) {
                    checkedOutList[studentNo] = studentNo;
                    keptStudents[studentNo] = livePresenceData[studentNo]; // Onaylıyı tut
                }
            }
        }

        // Firebase'i güncelle: ML'in "Dışarıda" dediği herkes (veya bağlantısı kopanlar) tamamen silinir.
        db.ref(`Presence/${selectedClassroom}`).set(keptStudents).then(() => {
            db.ref(`System/${selectedClassroom}`).update({ status: "EXIT" });
            renderTables();
            toast("Çıkış yoklaması başladı. Sınıftakiler onaylandı, dışarıdakiler/kopanlar düşürüldü.", 'info');
        });
    }
});

document.getElementById('btn-end-class').addEventListener('click', () => {
    if (confirm("Ders bitirilecek. ESP32 bekleme moduna geçecek. Onaylıyor musunuz?")) {
        clearInterval(lessonTimerInterval); 
        
        db.ref(`System/${selectedClassroom}`).remove();
        db.ref(`Presence/${selectedClassroom}`).remove();  

        document.getElementById('view-attendance').classList.add('hidden');
        document.getElementById('view-courses').classList.remove('hidden');

        document.getElementById('nav-attendance').classList.remove('active');
        document.getElementById('nav-attendance').classList.add('disabled');
        document.getElementById('nav-courses').classList.add('active');

        document.getElementById('page-title').innerText = "Derslerim";
        document.getElementById('page-subtitle').innerText = "Kayıtlı olduğunuz derslerin güncel listesi.";

        if (presenceRef) presenceRef.off();
        lessonStatus = "IDLE";
        toast("Ders başarıyla sonlandırıldı.", 'success');
    }
});

// ==========================================================================
// 10. EXCEL RAPORU
// ==========================================================================
document.getElementById('btn-export').addEventListener('click', () => {
    if (lessonStatus === "CHECKIN_OPEN") {
        toast("Rapor almak için önce Çıkış Yoklamasını başlatmalısınız.", 'warning');
        return;
    }

    const rows = [['Öğrenci No', 'Ad Soyad', 'Katılım Yüzdesi', 'Nihai Durum', 'Sınıf', 'Ders']];

    for (let studentNo in studentPool) {
        const name = studentPool[studentNo];
        const logData = studentLogs[studentNo] || { presentCount: 0 };
        const percentage = totalAttendanceChecks === 0 ? 0 : Math.round((logData.presentCount / totalAttendanceChecks) * 100);

        const inCheckIn = !!checkedInList[studentNo];
        const inCheckOut = !!checkedOutList[studentNo];
        const status = (inCheckIn && inCheckOut && percentage >= 70) ? "VAR" : "YOK";
        
        rows.push([studentNo, name, `%${percentage}`, status, selectedClassroom, activeCourseName]);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 15 }, { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 35 }];
    XLSX.utils.book_append_sheet(wb, ws, "Nihai_Yoklama");
    XLSX.writeFile(wb, `Yoklama_${selectedClassroom}_${new Date().toLocaleDateString('tr-TR').replace(/\./g, '-')}.xlsx`);
    toast("Excel raporu indirildi.", 'success');
});

// ==========================================================================
// 11. RFID KONTROL VE YOKLAMA İŞLEME SİSTEMİ (ÖNCEDEN KAYITLI KARTLAR)
// ==========================================================================
let rfidActive = false;

document.getElementById('btn-toggle-rfid').addEventListener('click', () => {
    if (lessonStatus === "IDLE") {
        toast("RFID okuyucuyu açmak için önce bir ders başlatmalısınız!", "warning");
        return;
    }
    
    rfidActive = !rfidActive;
    const btn = document.getElementById('btn-toggle-rfid');

    // ESP32'ye Firebase üzerinden "Okuyucuyu Aç/Kapat" emri gönderiyoruz
    db.ref(`System/${selectedClassroom}/rfid_permission`).set(rfidActive).then(() => {
        if(rfidActive) {
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

