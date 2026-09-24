"""富士市ライブカメラを全期間ぶん取得し、日ごとのコンタクトシートを作る。

**途中から再開できる。** 取得済みの日は飛ばすので、止まっても損失は無い。
14時間かかるため、単発でもスリープで中断され得る（このMacは sleep 1分設定）。
呼び出し側で `caffeinate -i` を被せること。

上空データの下限が 2021-04 なので、気象モデルの学習に使えるのはそれ以降。
画像分類器だけなら 1999-01-28 まで遡れる（[[20260915_笠雲の内部導入と検証計画]]）。
"""
import argparse, datetime as dt, importlib.util, shutil, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
def _load(name, fn):
    spec = importlib.util.spec_from_file_location(name, HERE / fn)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
cam = _load("cam", "camera-images.py")
cs = _load("cs", "contact-sheet.py")

ROOT = Path("/Users/okadayudai/Developer/Sorami/web/data/cap-cloud-sheets")
IMG, SH = ROOT / "画像", ROOT / "シート"
LOG = ROOT / "取得ログ.tsv"


def run(start, end, limit=None):
    SH.mkdir(parents=True, exist_ok=True)
    d0, d1 = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    days = [(d0 + dt.timedelta(days=i)).isoformat() for i in range((d1 - d0).days + 1)]
    todo = [d for d in days if not (SH / f"{d}.png").exists()]
    if limit: todo = todo[:limit]
    print(f"対象 {len(days)}日 / 取得済み {len(days)-len([d for d in days if not (SH/f'{d}.png').exists()])}日 "
          f"/ 今回 {len(todo)}日 ≒ {len(todo)*32/3600:.1f}時間", flush=True)
    ok = ng = 0
    with LOG.open("a", encoding="utf-8") as log:
        for i, d in enumerate(todo, 1):
            out = IMG / d
            if out.exists(): shutil.rmtree(out)
            try:
                inv = cam.inventory(d, str(out), max_images=15)
                cs.sheet(str(out), str(SH / f"{d}.png"))
                ok += 1
                log.write(f"{d}\tok\t{inv['downloaded_images']}\t{inv['missing_slots']}\n")
            except Exception as e:                      # 1日の失敗で全体を止めない
                ng += 1
                log.write(f"{d}\tng\t0\t0\t{e}\n")
            log.flush()
            if i % 20 == 0:
                print(f"  {i}/{len(todo)}  成功{ok} 失敗{ng}  最後={d}", flush=True)
    print(f"完了 成功{ok} 失敗{ng}", flush=True)


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("--start", default="2021-04-01")
    a.add_argument("--end", default=dt.date.today().isoformat())
    a.add_argument("--limit", type=int)
    v = a.parse_args()
    run(v.start, v.end, v.limit)
