// ==========================================================================
// 1. FIREBASE VERİTABANI YAPILANDIRMASI 
// ==========================================================================
const firebaseConfig = {
  apiKey: "AIzaSyBRRM1RWRPZ29u9rLlTjQmbhuozlCMQTBk",
  databaseURL: "https://otomatik-yoklama-takip-sistemi-default-rtdb.europe-west1.firebasedatabase.app/",
  projectId: "277974868224"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ==========================================================================
// 2. DOM ELEMENTLERİNİN YAKALANMASI
// ==========================================================================
const screenLogin = document.getElementById('screen-login');
const screenCourseSelect = document.getElementById('screen-course-select');
const screenDashboard = document.getElementById('screen-dashboard');

const formLogin = document.getElementById('form-login');
const btnStartAttendance = document.getElementById('btn-start-attendance');
const selectCourse = document.getElementById('select-course');
const selectSession = document.getElementById('select-session');

const dynCourseCode = document.getElementById('dyn-course-code');
const dynCourseName = document.getElementById('dyn-course-name');
const dynSessionText = document.getElementById('dyn-session-text');

const tbodyElementi = document.getElementById('attendance-tbody');
const totalStudentsCard = document.getElementById('total-students');
const presentStudentsCard = document.getElementById('present-students');
const absentStudentsCard = document.getElementById('absent-students');
const btnExport = document.getElementById('btn-export');

// ==========================================================================
// 3. ÖĞRENCİ VERİ HAVUZU (MAC EŞLEŞTİRME VE DERS KAYDI KONTROLÜ)
// ==========================================================================
const ogrenciHavuzu = {
  "6c:a1:6e:b1:84:33": { no: "220101001", ad: "Ece Kılınç", kayit: "Var" },
  "7a:b2:5c:d3:94:11": { no: "220101002", ad: "Gülşen Altun", kayit: "Var" },
  "8b:c3:4d:e5:04:22": { no: "220101003", ad: "Ahmet Yılmaz", kayit: "Yok" },
  "9c:d4:5e:f6:14:33": { no: "220101004", ad: "Mehmet Demir", kayit: "Var" }
};

const katilimTakip = {};

// ==========================================================================
// 4. EKRANLAR ARASI GEÇİŞ MANTIĞI (NAVIGATION)
// ==========================================================================
formLogin.addEventListener('submit', (e) => {
  e.preventDefault(); 
  screenLogin.classList.add('hidden');
  screenCourseSelect.classList.remove('hidden');
});

btnStartAttendance.addEventListener('click', () => {
  const dersKodu = selectCourse.value; 
  const dersAdi = selectCourse.options[selectCourse.selectedIndex].text.split(' - ')[1];
  const oturumDugumu = selectSession.value; 
  const oturumMetni = selectSession.options[selectSession.selectedIndex].text;

  dynCourseCode.innerText = `SE ${dersKodu}`;
  dynCourseName.innerText = dersAdi;
  dynSessionText.innerText = oturumMetni;

  screenCourseSelect.classList.add('hidden');
  screenDashboard.classList.remove('hidden');

  // Gerçek Firebase dinlemesini başlat
  renderAttendanceData(dersKodu, oturumDugumu);
  
  // Eğer test etmek istersen simülatörü de tetikler
  window.dispatchEvent(new CustomEvent('fakeSimulationTrigger'));
});

// ==========================================================================
// 5. GERÇEK ZAMANLI VERİ İŞLEME FONKSİYONU
// ==========================================================================
function renderAttendanceData(dersKodu, oturum) {
  const dbYolu = `Yoklamalar/${dersKodu}/${oturum}`;
  
  db.ref(dbYolu).on('value', (snapshot) => {
    processSnapshot(snapshot);
  });
}

function processSnapshot(snapshot) {
  tbodyElementi.innerHTML = '';
  let aktifSınıftaOlanlar = 0;
  const toplamKayitliOgrenci = Object.keys(ogrenciHavuzu).length;
  const aktifMacler = [];

  if (snapshot && snapshot.exists()) {
    snapshot.forEach((childSnapshot) => {
      const macAdresi = childSnapshot.key;
      aktifMacler.push(macAdresi);
      
      if (!katilimTakip[macAdresi]) {
        katilimTakip[macAdresi] = { ilkGiris: new Date(), toplamDakika: 0 };
      } else {
        const gecenSureMs = new Date() - katilimTakip[macAdresi].ilkGiris;
        katilimTakip[macAdresi].toplamDakika = Math.floor(gecenSureMs / 60000) + 1;
      }

      if (ogrenciHavuzu[macAdresi]) {
        aktifSınıftaOlanlar++;
        const ogrenci = ogrenciHavuzu[macAdresi];
        const kayitRozetClass = ogrenci.kayit === "Var" ? "badge-success-light" : "badge-danger-light";
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${ogrenci.no}</td>
          <td>${ogrenci.ad}</td>
          <td><span class="badge ${kayitRozetClass}">Ders Kaydı: ${ogrenci.kayit}</span></td>
          <td><span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Derste</span></td>
          <td>${new Date().toLocaleTimeString('tr-TR')}</td>
          <td><strong>${katilimTakip[macAdresi].toplamDakika} dk</strong></td>
        `;
        tbodyElementi.appendChild(tr);
      }
    });

    Object.keys(ogrenciHavuzu).forEach((mac) => {
      if (!aktifMacler.includes(mac)) {
        const ogrenci = ogrenciHavuzu[mac];
        const kayitRozetClass = ogrenci.kayit === "Var" ? "badge-success-light" : "badge-danger-light";
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${ogrenci.no}</td>
          <td>${ogrenci.ad}</td>
          <td><span class="badge ${kayitRozetClass}">Ders Kaydı: ${ogrenci.kayit}</span></td>
          <td><span class="badge badge-danger"><i class="fa-solid fa-circle-xmark"></i> Dışarıda</span></td>
          <td>-</td>
          <td>0 dk</td>
        `;
        tbodyElementi.appendChild(tr);
      }
    });
  } else {
    Object.keys(ogrenciHavuzu).forEach((mac) => {
      const ogrenci = ogrenciHavuzu[mac];
      const kayitRozetClass = ogrenci.kayit === "Var" ? "badge-success-light" : "badge-danger-light";
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${ogrenci.no}</td>
        <td>${ogrenci.ad}</td>
        <td><span class="badge ${kayitRozetClass}">Ders Kaydı: ${ogrenci.kayit}</span></td>
        <td><span class="badge badge-danger"><i class="fa-solid fa-circle-xmark"></i> Dışarıda</span></td>
        <td>-</td>
        <td>0 dk</td>
      `;
      tbodyElementi.appendChild(tr);
    });
  }

  totalStudentsCard.innerText = toplamKayitliOgrenci;
  presentStudentsCard.innerText = aktifSınıftaOlanlar;
  absentStudentsCard.innerText = Math.max(0, toplamKayitliOgrenci - aktifSınıftaOlanlar);
}

// ==========================================================================
// 6. EXCEL RAPORLAMA ÇIKTI FONKSİYONU
// ==========================================================================
btnExport.addEventListener('click', () => {
  const tablo = document.getElementById('attendance-table');
  const wb = XLSX.utils.table_to_book(tablo, { sheet: "Yoklama Raporu" });
  const tarih = new Date().toLocaleDateString('tr-TR').replace(/\./g, '_');
  XLSX.writeFile(wb, `yoklama_raporu_${tarih}.xlsx`);
});

// ==========================================================================
// 7. DARK MODE (KARANLIK TEMA) KONTROLÜ
// ==========================================================================
const themeToggles = document.querySelectorAll('.theme-toggle');

const currentTheme = localStorage.getItem('theme');
if (currentTheme === 'dark') {
  document.body.classList.add('dark-mode');
  updateThemeIcons('dark');
}

themeToggles.forEach(toggle => {
  toggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    const theme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
    localStorage.setItem('theme', theme);
    updateThemeIcons(theme);
  });
});

function updateThemeIcons(theme) {
  const icons = document.querySelectorAll('.theme-toggle i');
  icons.forEach(icon => {
    icon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  });
}

// ==========================================================================
// 8. SİMÜLASYON TEST ARACI (VERİTABANI YOKKEN ÇALIŞTIRMAK İÇİN)
// ==========================================================================
window.addEventListener('fakeSimulationTrigger', () => {
  setInterval(() => {
    if (!screenDashboard.classList.contains('hidden')) {
      const fakeSnapshot = {
        exists: () => true,
        forEach: (callback) => {
          // Ece Kılınç ve Mehmet Demir'in cihazlarını içeride simüle ediyoruz
          callback({ key: "6c:a1:6e:b1:84:33" });
          callback({ key: "9c:d4:5e:f6:14:33" });
        }
      };
      processSnapshot(fakeSnapshot);
    }
  }, 3000); 
});