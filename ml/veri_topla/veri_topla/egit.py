import pandas as pd
import numpy as np
import pickle
import matplotlib.pyplot as plt
from sklearn.tree import DecisionTreeClassifier, plot_tree
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, confusion_matrix, classification_report

print("=" * 50)
print("   MCBÜ - RSSI MODEL EĞİTİM ARACI")
print("=" * 50)

# ==========================================================
# 1. VERİYİ YÜKLE
# ==========================================================
print("\n[1/5] Veri yükleniyor...")
df = pd.read_csv("rssi_veri_seti.csv")
print(f"  Toplam veri: {len(df)} satır")
print(f"  Sınıf İçi (1): {len(df[df['Sinif_Ici_Mi'] == 1])}")
print(f"  Koridor  (0): {len(df[df['Sinif_Ici_Mi'] == 0])}")

# ==========================================================
# 2. VERİ TEMİZLEME — MOVING AVERAGE
# ==========================================================
print("\n[2/5] Moving Average filtresi uygulanıyor...")

pencere = 5  # Son 5 ölçümün ortalaması
df["RSSI_MA"] = df["RSSI"].rolling(window=pencere, min_periods=1).mean()

print(f"  Pencere boyutu: {pencere}")
print(f"  Ham RSSI      → Ort: {df['RSSI'].mean():.1f} dBm | Std: {df['RSSI'].std():.1f}")
print(f"  Filtreli RSSI → Ort: {df['RSSI_MA'].mean():.1f} dBm | Std: {df['RSSI_MA'].std():.1f}")

# ==========================================================
# 3. VERİ TEMİZLEME — KALMAN FİLTRESİ
# ==========================================================
print("\n[3/5] Kalman Filtresi uygulanıyor...")

def kalman_filtrele(olcumler, Q=0.01, R=2.0):
    """
    Q = Süreç gürültüsü (düşük = daha pürüzsüz)
    R = Ölçüm gürültüsü (yüksek = ölçüme daha az güven)
    """
    n = len(olcumler)
    tahmin = np.zeros(n)
    
    x = olcumler[0]   # Başlangıç tahmini
    P = 1.0           # Başlangıç hatası
    
    for i, z in enumerate(olcumler):
        # Tahmin adımı
        P = P + Q
        # Güncelleme adımı
        K = P / (P + R)          # Kalman kazancı
        x = x + K * (z - x)     # Tahmini güncelle
        P = (1 - K) * P          # Hata kovaryansını güncelle
        tahmin[i] = x
    
    return tahmin

df["RSSI_Kalman"] = kalman_filtrele(df["RSSI"].values)

print(f"  Kalman RSSI → Ort: {df['RSSI_Kalman'].mean():.1f} dBm | Std: {df['RSSI_Kalman'].std():.1f}")

# ==========================================================
# 4. MODEL EĞİTİMİ
# ==========================================================
print("\n[4/5] Decision Tree modeli eğitiliyor...")

# Özellikler: Ham RSSI, Moving Average, Kalman
X = df[["RSSI", "RSSI_MA", "RSSI_Kalman"]].values
y = df["Sinif_Ici_Mi"].values

# %80 eğitim, %20 test
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

model = DecisionTreeClassifier(
    max_depth=5,          # Aşırı öğrenmeyi önler
    min_samples_split=10, # Dal açmak için minimum veri
    min_samples_leaf=5,   # Yaprakta minimum veri
    random_state=42
)
model.fit(X_train, y_train)

# ==========================================================
# 5. SONUÇLAR
# ==========================================================
print("\n[5/5] Sonuçlar hesaplanıyor...")

y_pred = model.predict(X_test)
dogruluk = accuracy_score(y_test, y_pred)
cm = confusion_matrix(y_test, y_pred)

print("\n" + "=" * 50)
print(f"  MODEL DOĞRULUĞU: %{dogruluk * 100:.1f}")
print("=" * 50)
print("\nKarışıklık Matrisi:")
print(f"  Gerçek KORİDOR - Tahmin KORİDOR : {cm[0][0]} ✓")
print(f"  Gerçek KORİDOR - Tahmin SINIF   : {cm[0][1]} ✗")
print(f"  Gerçek SINIF   - Tahmin KORİDOR : {cm[1][0]} ✗")
print(f"  Gerçek SINIF   - Tahmin SINIF   : {cm[1][1]} ✓")

print("\nDetaylı Rapor:")
print(classification_report(y_test, y_pred,
      target_names=["Koridor (0)", "Sınıf İçi (1)"]))

# Özellik önem sıralaması
print("Özellik Önem Sıralaması:")
ozellikler = ["Ham RSSI", "Moving Average", "Kalman"]
for isim, onem in sorted(zip(ozellikler, model.feature_importances_),
                          key=lambda x: x[1], reverse=True):
    bar = "█" * int(onem * 30)
    print(f"  {isim:<18}: {bar} {onem*100:.1f}%")

# ==========================================================
# 6. MODELİ KAYDET
# ==========================================================
with open("model.pkl", "wb") as f:
    pickle.dump({
        "model": model,
        "kalman_Q": 0.01,
        "kalman_R": 2.0,
        "ma_pencere": pencere
    }, f)

print("\n✓ Model 'model.pkl' olarak kaydedildi.")

# ==========================================================
# 7. GRAFİK — İsteğe bağlı
# ==========================================================
cevap = input("\nGrafik gösterilsin mi? (e/h): ").strip().lower()
if cevap == "e":
    fig, axes = plt.subplots(2, 1, figsize=(14, 8))
    fig.suptitle("MCBÜ - RSSI Sinyal Analizi", fontsize=14, fontweight='bold')

    # Grafik 1: Sinyal karşılaştırma
    ax1 = axes[0]
    ax1.plot(df["RSSI"].values[:150], alpha=0.4, color="gray",  label="Ham RSSI")
    ax1.plot(df["RSSI_MA"].values[:150], color="blue",  linewidth=1.5, label="Moving Average")
    ax1.plot(df["RSSI_Kalman"].values[:150], color="red", linewidth=1.5, label="Kalman")
    ax1.set_title("Sinyal Filtreleme Karşılaştırması (İlk 150 Ölçüm)")
    ax1.set_ylabel("RSSI (dBm)")
    ax1.legend()
    ax1.grid(True, alpha=0.3)

    # Grafik 2: Karar ağacı
    ax2 = axes[1]
    plot_tree(model, feature_names=["RSSI", "RSSI_MA", "RSSI_Kalman"],
              class_names=["Koridor", "Sınıf İçi"],
              filled=True, rounded=True, ax=ax2, max_depth=3, fontsize=8)
    ax2.set_title("Decision Tree Yapısı (İlk 3 Derinlik)")

    plt.tight_layout()
    plt.savefig("rssi_analiz.png", dpi=150, bbox_inches='tight')
    plt.show()
    print("✓ Grafik 'rssi_analiz.png' olarak kaydedildi.")

print("\nEğitim tamamlandı!")
