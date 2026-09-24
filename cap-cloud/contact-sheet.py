"""1日15枠を1枚に並べる。人が一目で1日を見られるようにする。

検出器で候補を絞る案は、陽性が2日5枠しか無い段階では特徴量を選べず行き詰まった
（2026-09-15）。**人は速い。** 山頂まわりだけを切り出して並べれば、1日を数秒で見られる。
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

CROP = (170, 195, 500, 345)          # 山頂まわり。笠雲が乗る範囲を含む
COLS, SCALE = 3, 1.6
BAND, SKY_L, SKY_R = slice(190, 300), slice(60, 200), slice(460, 600)


def blueness(a):
    """青空か曇り空か。遠景の富士山も青いので、**空の領域だけ**で測る。"""
    s = np.concatenate([a[BAND, SKY_L].reshape(-1, 3), a[BAND, SKY_R].reshape(-1, 3)])
    return float((s[:, 2] - s[:, 0]).mean())


def sheet(day_dir, out):
    ps = sorted(Path(day_dir).glob("fuji-city-*.jpg"))
    if not ps: return None
    w, h = int((CROP[2]-CROP[0])*SCALE), int((CROP[3]-CROP[1])*SCALE)
    rows = -(-len(ps)//COLS)
    sh = Image.new("RGB", (COLS*w, rows*(h+18)), (18, 18, 20))
    d = ImageDraw.Draw(sh)
    for i, p in enumerate(ps):
        im = Image.open(p).convert("RGB")
        b = blueness(np.asarray(im, dtype=float))
        x, y = (i % COLS)*w, (i//COLS)*(h+18)
        sh.paste(im.crop(CROP).resize((w, h), Image.LANCZOS), (x, y+18))
        # 曇っている枠は見なくてよい。色で分ける
        d.rectangle([x, y, x+w, y+17], fill=(30, 70, 40) if b >= 15 else (60, 30, 30))
        d.text((x+6, y+4), "%s時  青%+.0f%s" % (p.name[21:23], b, "" if b >= 15 else "  曇"),
               fill=(220, 220, 220))
    sh.save(out)
    return out


if __name__ == "__main__":
    print(sheet(sys.argv[1], sys.argv[2]))
