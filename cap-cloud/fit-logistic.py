"""笠雲の発生確率をロジスティック回帰で推定する。numpy のみ。

**日単位で分割する。** 同じ日の枠は独立でない。枠単位で分割すると、
2021-11-14 の6枠のような連続事例が学習と検証の両方に入り、
実力より高い数字が出る（2026-09-15 に AUC 0.921 と誤認した原因）。
"""
import json
from pathlib import Path
import numpy as np

# **時刻は朝・午後の区分で入れる（2026-09-16）。**
# 直線で入れると AUC 0.851 だが「早いほど高い」が一方的に効き、どの日もピークが
# 範囲の端の5時になった（実機で発覚）。2次でも山は5時のまま。
# 区分にすると全年 0.842（差は振れ幅の中）、2021年を除くと 0.710 → 0.745 と明確に良く、
# 朝の中では時刻で差を付けないので端に張り付かない。
# 昼（10〜13時）が基準。暗い時間は学習に入っていない（ラベル付けで除外）ので、
# 日の出前・日の入り後はアプリ側で 0 にする。
FEATURES = ["rhSummit", "rhMax", "dz", "wind", "n2", "dd", "ddPeak", "depth", "ringMed",
            "morning", "afternoon"]


def derived(r, k):
    if k == "morning": return 1.0 if 5 <= r["hour"] <= 9 else 0.0
    if k == "afternoon": return 1.0 if 14 <= r["hour"] <= 19 else 0.0
    return r.get(k)


def load(feat_dir, label_file):
    lab = {(r["day"], r["hour"]): r["label"]
           for r in json.loads(Path(label_file).read_text(encoding="utf-8"))["rows"]}
    X, y, days, meta = [], [], [], []
    for f in sorted(Path(feat_dir).glob("*.json")):
        try: rows = json.loads(f.read_text())
        except Exception: continue
        for r in rows:
            l = lab.get((r["day"], r["hour"]))
            if l not in ("CAP", "NO_CAP"): continue
            v = [derived(r, k) for k in FEATURES]
            if any(x is None for x in v): continue
            X.append(v); y.append(1 if l == "CAP" else 0)
            days.append(r["day"]); meta.append((r["day"], r["hour"], r["score"]))
    return np.array(X, float), np.array(y, float), np.array(days), meta


def fit(X, y, *, l2=1.0, iters=4000, lr=0.1):
    """勾配降下。**クラス重みを入れる。** 陽性が全体の2%なので、
    重み無しだと「常に陰性」と答える解に落ちる。"""
    n, d = X.shape
    w = np.zeros(d + 1)
    Xb = np.hstack([np.ones((n, 1)), X])
    pw = (y == 0).sum() / max((y == 1).sum(), 1)
    sw = np.where(y == 1, pw, 1.0)
    for _ in range(iters):
        p = 1 / (1 + np.exp(-np.clip(Xb @ w, -30, 30)))
        g = Xb.T @ (sw * (p - y)) / n
        g[1:] += l2 * w[1:] / n
        w -= lr * g
    return w


def predict(w, X):
    return 1 / (1 + np.exp(-np.clip(np.hstack([np.ones((len(X), 1)), X]) @ w, -30, 30)))


def auc(y, p):
    pos, neg = p[y == 1], p[y == 0]
    if not len(pos) or not len(neg): return float("nan")
    return float(sum((a > b) + 0.5 * (a == b) for a in pos for b in neg) / (len(pos) * len(neg)))


def cv_by_day(X, y, days, *, folds=5, seed=0):
    """**日でグループ分けした交差検証。** 枠単位で切らない。"""
    uniq = np.array(sorted(set(days)))
    rng = np.random.default_rng(seed); rng.shuffle(uniq)
    out = np.zeros(len(y))
    for i in range(folds):
        test_days = set(uniq[i::folds])
        te = np.array([d in test_days for d in days])
        if te.all() or not te.any(): continue
        mu, sd = X[~te].mean(0), X[~te].std(0) + 1e-9
        w = fit((X[~te] - mu) / sd, y[~te])
        out[te] = predict(w, (X[te] - mu) / sd)
    return out
