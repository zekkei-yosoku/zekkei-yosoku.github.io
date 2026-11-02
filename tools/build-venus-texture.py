"""Make the home Venus texture from NASA/JPL-Caltech PIA23791 (Mariner 10, public domain). Requires Pillow and NumPy.
The photo is a gibbous view, so the circle is fitted to the lit edge and the baked-in shading is flattened;
the phase shading is drawn in astronotes-venus-portrait.js. The original stays out of the release.
  python3 tools/build-venus-texture.py <source.jpg>
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

SIZE = 720
root = Path(__file__).resolve().parent.parent
image = Image.open(sys.argv[1]).convert("RGB")
rgb = np.asarray(image, dtype=np.float32)
luma = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
h, w = luma.shape
ys, xs = np.nonzero(luma > 60)
cx0, cy0 = xs.mean(), ys.mean()
# 明るい側の縁で円を合わせる
points = []
for angle in np.radians(np.arange(100, 280, 2)):
    dx, dy = np.cos(angle), -np.sin(angle)
    for r in range(int(max(w, h) * 0.6), 0, -1):
        x, y = int(cx0 + dx * r), int(cy0 + dy * r)
        if 0 <= x < w and 0 <= y < h and luma[y, x] > 60:
            points.append((x, y))
            break
p = np.array(points, dtype=np.float64)
A = np.c_[2 * p[:, 0], 2 * p[:, 1], np.ones(len(p))]
cx, cy, k = np.linalg.lstsq(A, (p ** 2).sum(axis=1), rcond=None)[0]
radius = float(np.sqrt(k + cx * cx + cy * cy))
yy, xx = np.mgrid[0:h, 0:w]
mask = ((xx - cx) ** 2 + (yy - cy) ** 2) <= (radius * 0.995) ** 2
# 元の写真の陰を大きなぼかしで推定して取り除く。雲の濃淡は残る
blur = float(radius * 0.22)
smooth = lambda a: np.asarray(Image.fromarray(a.astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur)), dtype=np.float32)
light = smooth(luma * mask) / np.maximum(smooth(mask * 255.0), 1) * 255
target = float(np.percentile(light[mask], 55))
gain = np.clip(target / np.maximum(light, 1), 0.82, 1.7)
flat = rgb * gain[..., None]
# 明るすぎる所だけなめらかに抑えて雲の濃淡を残す
flat = np.where(flat > 200, 200 + (flat - 200) * 0.55, flat)
# 夜の側は写っていないので、球の反対側の雲で埋める
far = np.ones_like(flat) * flat[mask].mean(axis=0)
ox = np.clip(np.rint(2 * cx - xx).astype(int), 0, w - 1)
oy = np.clip(np.rint(2 * cy - yy).astype(int), 0, h - 1)
far = flat[oy, ox]
seen = np.clip((smooth(luma) - 30) / 150, 0, 1)
seen = seen * seen * (3 - 2 * seen)
flat = flat * seen[..., None] + far * (1 - seen[..., None])
# 元の写真の明るさと色みに戻す
flat = flat * (rgb[mask & (luma > 150)].mean(axis=0) / flat[mask].mean(axis=0))
flat = np.clip(flat, 0, 255)
flat[~mask] = flat[mask].mean(axis=0)
out = Image.fromarray(flat.astype(np.uint8)).crop((round(cx - radius), round(cy - radius), round(cx + radius), round(cy + radius))).resize((SIZE, SIZE), Image.Resampling.LANCZOS)
target = root / "almanac-venus-surface-v1.webp"
out.save(target, "WEBP", quality=90, method=6)
# 写真の輝いている向き（真上から時計回り）。astronotes-venus-portrait.js の PHOTO_LIMB
bright = mask & (luma > 90)
limb = np.arctan2((xx[bright] - cx).mean(), (cy - yy[bright]).mean())
print(target.name, target.stat().st_size, "center", round(cx, 1), round(cy, 1), "radius", round(radius, 1), "of", w, h, "limb", round(float(limb), 3))
