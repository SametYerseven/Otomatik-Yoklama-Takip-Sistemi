"""
YENI RSSI MODELI EGITIMI (CLAUDE.md "ML veri toplama plani", 2026-11-26)
-----------------------------------------------------------------------
Telefonun olctugu RSSI'den ogrencinin sinifin icinde (1) mi disinda (0) mi oldugunu tahmin eden
karar agacini egitir. Eski rssi_dataset.csv (ESP32 olcumu) KULLANILMAZ.

Girdi: data/ klasorundeki CSV'ler (telefondaki veri toplama modundan "Paylas" ile alinan dosyalar).
  Sutunlar: time, platform, phone_model, room, rssi, label, location, carry
  label 1 = sinif ici, 0 = disi. iPhone duyamadiginda rssi = 0 yazar: bu satirlar atilir.

Eski egitimdeki iki hata duzeltildi:
  1. Filtreler (hareketli ortalama, Kalman) butun veri boyunca degil, her kesintisiz olcum
     parcasinda ayri ve sadece gecmis olcumlerle hesaplanir (canli kullanimdaki gibi).
  2. Test verisi rastgele satirlardan degil, modelin hic gormedigi bir GUNDEN (ya da TELEFONDAN)
     secilir. Rastgele bolme, art arda neredeyse ayni olcumleri hem egitime hem teste koyup
     dogrulugu oldugundan yuksek gosteriyordu.

Modelin girdisi henuz secilmedi (tek olcum mu, son 10-20 sn mi): script hepsini dener,
karsilastirir, en iyisiyle son modeli kaydeder.

Kullanim (bu klasorde):
  python train.py                      # data/*.csv, her gun sirayla test edilir
  python train.py --split phone        # her telefon modeli sirayla test edilir
  python train.py --data baska_klasor --plot
Cikti: model_phone.pkl (live_prediction.py yeni modele gecince bunu okuyacak)
"""

import argparse
import glob
import os
import pickle
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.metrics import confusion_matrix
from sklearn.model_selection import GroupKFold, LeaveOneGroupOut
from sklearn.tree import DecisionTreeClassifier, export_text

COLUMNS = ["time", "platform", "phone_model", "room", "rssi", "label", "location", "carry"]
SEGMENT_GAP_S = 10            # bu kadar sn olcum gelmezse yeni parca baslar
KALMAN_Q, KALMAN_R = 0.01, 2.0
# Denenecek model girdileri: (ad, pencere sn, ozellikler)
FEATURE_SETS = [
    ("tek olcum", 0, ["rssi"]),
    ("son 10 sn", 10, ["rssi", "mean", "std", "kalman"]),
    ("son 20 sn", 20, ["rssi", "mean", "std", "kalman"]),
]

sys.stdout.reconfigure(encoding="utf-8")


# ---------------------------------------------------------------------------
# 1. Veri
# ---------------------------------------------------------------------------

def parse_time(col):
    """ISO metin ya da Unix zamani (sn/ms) -> UTC zaman."""
    numeric = pd.to_numeric(col, errors="coerce")
    if numeric.notna().all():
        unit = "ms" if numeric.median() > 1e12 else "s"
        return pd.to_datetime(numeric, unit=unit, utc=True)
    return pd.to_datetime(col, utc=True, format="mixed")


def load(folder):
    files = sorted(glob.glob(os.path.join(folder, "*.csv")))
    if not files:
        sys.exit(f"'{folder}' klasorunde CSV dosyasi yok. Telefonlardan alinan dosyalari buraya koy.")
    frames = []
    for path in files:
        df = pd.read_csv(path)
        missing = sorted(set(COLUMNS) - set(df.columns))
        if missing:
            sys.exit(f"{path}: eksik sutun(lar): {missing}")
        df = df[COLUMNS].copy()
        df["file"] = os.path.basename(path)
        frames.append(df)
    df = pd.concat(frames, ignore_index=True)

    df["time"] = parse_time(df["time"])
    df["rssi"] = pd.to_numeric(df["rssi"], errors="coerce")
    df["label"] = pd.to_numeric(df["label"], errors="coerce")
    total = len(df)
    # iPhone duyamadiginda 0 yazar; -110'dan zayif degerler de gercekci degil
    df = df[(df["rssi"] < 0) & (df["rssi"] > -110) & df["label"].isin([0, 1])].copy()
    df["label"] = df["label"].astype(int)
    df = df.sort_values(["file", "time"]).reset_index(drop=True)
    df["day"] = df["time"].dt.strftime("%Y-%m-%d")

    # Kesintisiz olcum parcalari: ayni dosya + ayni etiket/konum/tasima + 10 sn'den kisa bosluk
    keys = ["file", "label", "location", "carry", "phone_model"]
    changed = (df[keys] != df[keys].shift()).any(axis=1)
    gap = df["time"].diff().dt.total_seconds().fillna(np.inf) > SEGMENT_GAP_S
    df["segment"] = (changed | gap).cumsum()

    print(f"  {len(files)} dosya, {total} satir; gecersiz {total - len(df)} satir atildi, {len(df)} kaldi")
    print(f"  Sinif ici (1): {(df.label == 1).sum()}   Disi (0): {(df.label == 0).sum()}")
    print(f"  Gun: {df.day.nunique()}  Telefon: {df.phone_model.nunique()} "
          f"({', '.join(sorted(df.phone_model.astype(str).unique()))})  Olcum parcasi: {df.segment.nunique()}")
    return df


# ---------------------------------------------------------------------------
# 2. Ozellikler (her parcada ayri, sadece gecmis olcumlerle)
# ---------------------------------------------------------------------------

def kalman(values, q=KALMAN_Q, r=KALMAN_R):
    """Tek boyutlu Kalman filtresi. q kucuk: daha puruzsuz; r buyuk: olcume daha az guven."""
    out = np.empty(len(values))
    x, p = values[0], 1.0
    for i, z in enumerate(values):
        p += q
        k = p / (p + r)
        x += k * (z - x)
        p *= 1 - k
        out[i] = x
    return out


def add_features(df):
    parts = []
    for _, seg in df.groupby("segment", sort=False):
        f = pd.DataFrame(index=seg.index)
        f["kalman"] = kalman(seg["rssi"].to_numpy(dtype=float))
        series = pd.Series(seg["rssi"].to_numpy(dtype=float), index=seg["time"])
        for window in sorted({w for _, w, _ in FEATURE_SETS if w > 0}):
            roll = series.rolling(f"{window}s", min_periods=1)
            f[f"mean_{window}"] = roll.mean().to_numpy()
            f[f"std_{window}"] = roll.std().fillna(0).to_numpy()
        parts.append(f)
    return df.join(pd.concat(parts))


def feature_columns(window, names):
    return [f"{n}_{window}" if n in ("mean", "std") else n for n in names]


# ---------------------------------------------------------------------------
# 3. Degerlendirme: model hic gormedigi gun/telefonda test edilir
# ---------------------------------------------------------------------------

def new_model():
    return DecisionTreeClassifier(max_depth=4, min_samples_leaf=20, class_weight="balanced", random_state=42)


def out_of_group_predictions(df, columns, group_col):
    groups = df[group_col]
    if groups.nunique() >= 2:
        splitter = LeaveOneGroupOut() if groups.nunique() <= 10 else GroupKFold(n_splits=5)
    else:
        # Tek gun/telefon: en azindan ayni olcum parcasi hem egitimde hem testte olmasin
        groups = df["segment"]
        splitter = GroupKFold(n_splits=min(5, groups.nunique()))
    pred = np.empty(len(df), dtype=int)
    X, y = df[columns].to_numpy(), df["label"].to_numpy()
    for train_idx, test_idx in splitter.split(X, y, groups):
        model = new_model().fit(X[train_idx], y[train_idx])
        pred[test_idx] = model.predict(X[test_idx])
    return pred


def rates(y, pred):
    cm = confusion_matrix(y, pred, labels=[0, 1])
    outside, inside = cm[0].sum(), cm[1].sum()
    return {
        "dogruluk": (cm[0, 0] + cm[1, 1]) / max(1, cm.sum()),
        # Disaridakini iceride sanmak: kopya cekmeye kapi acar
        "disari_iceri": cm[0, 1] / max(1, outside),
        # Iceridekini disarida sanmak: ogrenciye haksizlik
        "iceri_disari": cm[1, 0] / max(1, inside),
        "cm": cm,
    }


def pct(x):
    return f"%{x * 100:5.1f}"


def breakdown(df, pred, by):
    print(f"\n  {by} bazinda:")
    for value, idx in df.groupby(by).groups.items():
        r = rates(df.loc[idx, "label"], pred[df.index.get_indexer(idx)])
        print(f"    {str(value):<22} n={len(idx):<6} dogruluk {pct(r['dogruluk'])}")


# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Telefon RSSI modeli egitimi")
    parser.add_argument("--data", default="data", help="CSV klasoru (varsayilan: data)")
    parser.add_argument("--split", choices=["day", "phone"], default="day",
                        help="test icin ayrilacak grup: day (gun) ya da phone (telefon modeli)")
    parser.add_argument("--out", default="model_phone.pkl")
    parser.add_argument("--plot", action="store_true", help="konum bazinda RSSI grafigini kaydet")
    args = parser.parse_args()
    group_col = "day" if args.split == "day" else "phone_model"

    print("=" * 60)
    print("  MCBU - TELEFON RSSI MODEL EGITIMI")
    print("=" * 60)
    print("\n[1/4] Veri yukleniyor...")
    df = add_features(load(args.data))
    if df[group_col].nunique() < 2:
        print(f"\n  UYARI: Tek {'gun' if group_col == 'day' else 'telefon'} var. Test, olcum parcalari "
              "arasinda yapilacak; sonuc iyimser olabilir. Ikinci bir gun/telefon olcumu ekleyin.")

    print(f"\n[2/4] Model girdileri karsilastiriliyor (test grubu: {'gun' if group_col == 'day' else 'telefon'})")
    print(f"  {'Girdi':<12} {'Dogruluk':>9} {'Disari->Iceri':>14} {'Iceri->Disari':>14}")
    results = []
    for name, window, names in FEATURE_SETS:
        columns = feature_columns(window, names)
        pred = out_of_group_predictions(df, columns, group_col)
        r = rates(df["label"], pred)
        results.append((r["dogruluk"], name, window, columns, pred, r))
        print(f"  {name:<12} {pct(r['dogruluk']):>9} {pct(r['disari_iceri']):>14} {pct(r['iceri_disari']):>14}")
    print("  (Disari->Iceri: disaridaki ogrenciyi iceride sanma orani; dusuk olmali)")

    accuracy, name, window, columns, pred, r = max(results, key=lambda t: t[0])
    print(f"\n[3/4] En iyi girdi: {name}")
    cm = r["cm"]
    print(f"  Gercek DISI  -> tahmin DISI {cm[0, 0]:<6} tahmin ICI  {cm[0, 1]}")
    print(f"  Gercek ICI   -> tahmin DISI {cm[1, 0]:<6} tahmin ICI  {cm[1, 1]}")
    breakdown(df, pred, "platform")
    breakdown(df, pred, "phone_model")
    breakdown(df, pred, "location")
    breakdown(df, pred, "carry")

    print("\n[4/4] Son model butun veriyle egitiliyor...")
    model = new_model().fit(df[columns].to_numpy(), df["label"].to_numpy())
    print("\n  Karar kurallari:")
    print("    " + export_text(model, feature_names=columns, decimals=1).replace("\n", "\n    "))
    with open(args.out, "wb") as f:
        pickle.dump({
            "model": model,
            "features": columns,          # live_prediction ayni sirayla hesaplamali
            "window_s": window,           # 0 = tek olcum
            "kalman_q": KALMAN_Q,
            "kalman_r": KALMAN_R,
            "test_split": group_col,
            "test_accuracy": float(accuracy),
            "rows": int(len(df)),
            "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }, f)
    print(f"  Kaydedildi: {args.out}  (test dogrulugu {pct(accuracy)})")

    if args.plot:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        order = df.groupby("location")["rssi"].median().sort_values(ascending=False).index
        fig, ax = plt.subplots(figsize=(12, 5))
        data = [df.loc[df.location == loc, "rssi"] for loc in order]
        box = ax.boxplot(data, patch_artist=True)
        ax.set_xticks(range(1, len(order) + 1), order, rotation=30, ha="right")
        for patch, loc in zip(box["boxes"], order):
            inside = df.loc[df.location == loc, "label"].mean() >= 0.5
            patch.set_facecolor("#9fd8b5" if inside else "#f2b8be")
        ax.set_ylabel("RSSI (dBm)")
        ax.set_title("Konuma gore RSSI (yesil: sinif ici, kirmizi: disi)")
        ax.grid(True, alpha=0.3)
        fig.tight_layout()
        fig.savefig("rssi_by_location.png", dpi=150)
        print("  Grafik kaydedildi: rssi_by_location.png")

    print("\nEgitim tamamlandi.")


if __name__ == "__main__":
    main()
