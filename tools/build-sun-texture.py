"""ホームの太陽の画像 almanac-sun-surface-v1.png を作る（2026-10-19）。

ユーザーが示した宇宙イラスト風の太陽の雰囲気（黄〜橙、炎のようなうねり、白く光る部分、まぶしい縁）を、
画像を使わずに計算で描く。月の画像と同じく前もって作って配信し、実行時の計算をなくす。
- 円盤の直径は画像の83%（月の絵 .alm-portrait と同じ大きさに見える）。外側の光は縁から画像の端までに収める。
- 模様は球面上の点で3次元ノイズを引くので、縁ほど自然に詰まる。
- 黒点は日によって違い、作り物になるので描かない。高度・時刻では変えない。
使い方：python3 tools/build-sun-texture.py  （numpy と Pillow が要る）
"""
from pathlib import Path
import numpy as np
from PIL import Image

N = 960                 # 画像の一辺（ホームの表示 約320px×端末倍率3 を上回る）
DISC = 0.415            # 円盤の半径（画像の一辺に対する比。直径83%）
SEED = 20261019

def _hash(ix, iy, iz, s):
    h = (ix.astype(np.uint32) * np.uint32(374761393)) ^ (iy.astype(np.uint32) * np.uint32(668265263)) ^ (iz.astype(np.uint32) * np.uint32(2246822519)) ^ np.uint32(s * 3266489917 & 0xFFFFFFFF)
    h = (h ^ (h >> np.uint32(13))) * np.uint32(1274126177)
    h = h ^ (h >> np.uint32(16))
    return h.astype(np.float64) / 4294967296.0

def vnoise(p, s):
    """3次元の値ノイズ（0〜1）。p は (..., 3)"""
    f = np.floor(p); t = p - f; i = f.astype(np.int64)
    u = t * t * (3 - 2 * t)
    out = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (u[..., 0] if dx else 1 - u[..., 0]) * (u[..., 1] if dy else 1 - u[..., 1]) * (u[..., 2] if dz else 1 - u[..., 2])
                out = out + w * _hash(i[..., 0] + dx, i[..., 1] + dy, i[..., 2] + dz, s)
    return out

def fbm(p, s, octaves, lac=2.03, gain=0.5):
    v = 0.0; a = 0.5; f = 1.0
    for k in range(octaves):
        v = v + a * vnoise(p * f, s + k * 17); f *= lac; a *= gain
    return v

def worley(p, s):
    """3次元のボロノイ（細胞）ノイズ。最も近い点と2番目の点までの距離の差（細胞の境目で0）"""
    f = np.floor(p).astype(np.int64); best1 = np.full(p.shape[:-1], 9.0); best2 = np.full(p.shape[:-1], 9.0)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                cx, cy, cz = f[..., 0] + dx, f[..., 1] + dy, f[..., 2] + dz
                fp = np.stack([cx + _hash(cx, cy, cz, s), cy + _hash(cx, cy, cz, s + 1), cz + _hash(cx, cy, cz, s + 2)], axis=-1)
                d = np.sqrt(((fp - p) ** 2).sum(-1))
                best2 = np.where(d < best1, best1, np.minimum(best2, d)); best1 = np.minimum(best1, d)
    return best2 - best1

# 格子の向きが模様に出ないよう、座標を回しておく
_ROT = np.array([[0.36, 0.48, -0.8], [-0.8, 0.6, 0.0], [0.48, 0.64, 0.6]])

def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

def build():
    c = N / 2; r = N * DISC
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)
    nx = (xx + 0.5 - c) / r; ny = (yy + 0.5 - c) / r; rr = nx * nx + ny * ny
    inside = rr <= 1.0
    mu = np.sqrt(np.clip(1 - rr, 0, 1))
    P = np.stack([nx[inside], ny[inside], mu[inside]], axis=-1) @ _ROT.T   # 球面上の点（回転済み）
    m = mu[inside]
    # 大きなうねり（領域ゆがみ）
    warp = np.stack([fbm(P * 1.6 + 5.2, SEED + 1, 4), fbm(P * 1.6 + 1.7, SEED + 2, 4), fbm(P * 1.6 + 9.1, SEED + 3, 4)], axis=-1)
    flow = fbm(P * 2.4 + 2.4 * (warp - 0.5), SEED + 4, 6)
    # 細い筋（尾根型のノイズ）
    ridge = 1 - np.abs(2 * fbm(P * 5.5 + 1.3 * (warp - 0.5), SEED + 5, 5) - 1)
    ridge = ridge ** 4
    # 粒状斑：明るい粒と暗い隙間
    cell = worley(P * 46, SEED + 6)
    gran = smooth(cell, 0.0, 0.55) * 0.75 + 0.25 * vnoise(P * 90, SEED + 7)   # 粒の内側が明るく、境目が暗い（やわらかく）
    # 明るい斑点（縁の近くほど目立つ白斑）と、白く光る部分
    plage = smooth(fbm(P * 3.2 + 7, SEED + 8, 4), 0.56, 0.74)
    hot = smooth(fbm(P * 2.0 + 3, SEED + 9, 4), 0.6, 0.78)
    # 明るさ（0〜1）
    t = 0.40 + 0.95 * (flow - 0.5) + 0.22 * ridge + 0.10 * (gran - 0.5) + 0.28 * hot + 0.22 * plage * (1 - m) ** 0.6
    # 周縁減光（中心が明るく縁へ向かって暗く）と最外周の明るい帯
    t = t * (0.70 + 0.30 * m) + 0.30 * smooth(1 - m, 0.82, 1.0)
    # 色：暗い橙 → 橙 → 黄金 → 淡い黄 → ほぼ白
    stops = np.array([0.0, 0.32, 0.56, 0.80, 1.0])
    cols = np.array([[196, 78, 8], [236, 128, 18], [252, 184, 40], [255, 228, 116], [255, 250, 222]], dtype=np.float64)
    tc = np.clip(t, 0, 1)
    rgb = np.stack([np.interp(tc, stops, cols[:, k]) for k in range(3)], axis=-1)
    img = np.zeros((N, N, 4), dtype=np.float64)
    # 外側の光（縁から画像の端まで。控えめ）
    d = np.sqrt(rr)
    glow = np.clip(1 - (d - 1) / (0.5 / DISC - 1), 0, 1) ** 2.4 * (d > 1)
    gcol = np.array([255, 170, 50], dtype=np.float64)
    img[..., :3] = gcol
    img[..., 3] = glow * 0.55
    # 円盤（縁はなめらかに）
    edge = np.clip((1 - d) * r, 0, 1)
    disc_rgb = np.zeros((N, N, 3)); disc_rgb[inside] = rgb
    a = edge[..., None]
    img[..., :3] = disc_rgb * a + img[..., :3] * (1 - a)
    img[..., 3] = np.maximum(img[..., 3], edge) * 255   # 不透明度は0〜255で書き出す
    return Image.fromarray(np.clip(np.round(img), 0, 255).astype(np.uint8))

if __name__ == '__main__':
    out = Path(__file__).resolve().parents[1] / 'almanac-sun-surface-v1.png'
    build().save(out, optimize=True)
    print(out.name, out.stat().st_size, 'bytes')
