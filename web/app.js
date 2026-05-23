// 1. Firebase yapılandırma ayarlarını nesne olarak tanımlıyoruz (Firebase konsolundan alacağın bilgiler)
const firebaseConfig = {
  apiKey: "AIzaSyBRRM1RWRPZ29u9rLlTjQmbhuozlCMQTBk",
  databaseURL: "https://otomatik-yoklama-takip-sistemi-default-rtdb.europe-west1.firebasedatabase.app/",
  projectId: "277974868224"
};

// 2. Sayfa yüklendiğinde Firebase uygulamasını bu ayarlarla başlatıyoruz
firebase.initializeApp(firebaseConfig);

// 3. Veritabanı (Realtime Database) referansını bir değişkene atıyoruz
const db = firebase.database();

// 4. Verileri içine yazdıracağımız HTML listesi elementini (ul) DOM üzerinden yakalıyoruz
const listeElementi = document.getElementById('yoklamaListesi');

// 5. Firebase'deki /Yoklamalar/3114/Oturum_1 yolunu '.on("value")' metoduyla gerçek zamanlı dinlemeye başlıyoruz
db.ref('Yoklamalar/3114/Oturum_1').on('value', (snapshot) => {
  
  // 6. Veri tabanında her değişiklik olduğunda listeyi temizliyoruz (Eski verilerin üstüne tekrar yazmamak için)
  listeElementi.innerHTML = '';
  
  // 7. Belirtilen yolda herhangi bir veri olup olmadığını kontrol ediyoruz
  if(snapshot.exists()) {
    
    // 8. O oturumda yakalanan her bir cihazı (MAC düğümünü) forEach ile tek tek dönüyoruz
    snapshot.forEach((childSnapshot) => {
      
      // 9. Cihazın MAC adresini (örneğin: 6c:a1:6e:b1:84:33) düğümün anahtarı (key) olarak çekiyoruz
      const macAdresi = childSnapshot.key;
      
      // 10. Düğümün içindeki asıl veriyi (RSSI gibi) nesne olarak çekiyoruz
      const veri = childSnapshot.val();
      
      // 11. Ekrana yazdırmak üzere sanal bir <li> (liste elemanı) oluşturuyoruz
      const li = document.createElement('li');
      
      // 12. Bu liste elemanının içine MAC adresi ve sinyal gücünü metin olarak yerleştiriyoruz
      li.innerText = `Öğrenci Cihazı: ${macAdresi} | Sinyal Gücü (RSSI): ${veri.rssi}`;
      
      // 13. Doldurduğumuz bu <li> elemanını, HTML'deki ana <ul> listemize çocuk eleman olarak ekliyoruz
      listeElementi.appendChild(li);
    });
  } else {
    // 14. Eğer veritabanında henüz yakalanmış bir cihaz yoksa ekrana bilgi mesajı yazdırıyoruz
    listeElementi.innerHTML = '<li>Henüz sınıfta cihaz bulunamadı... Dinleniyor.</li>';
  }
});