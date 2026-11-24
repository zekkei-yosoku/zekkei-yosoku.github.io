"""Refresh the iPhone-accessible preview with guarded moon-map source overlays (no deletion).
The preview shares the production account/API/storage. Review before deployment.

  python3 build-preview.py           本体＋月丼の実験sourceから trial を作り直す
  python3 build-preview.py --check   作り直すと変わるファイルを挙げて失敗する（何も書かない）。
                                     本体の境界と trial の再現性を検証する。
"""
from pathlib import Path
import json,subprocess,sys
check='--check' in sys.argv[1:]
root=Path(__file__).resolve().parent
out=root/'trial'
# Validate experiment inputs and its complete output before overwriting any trial file.
bundle=json.loads(subprocess.check_output(['node','tools/build-moon-map-trial.mjs'],cwd=root,text=True))
expected={}
def emit(target,data):
 expected[target]=data
 if not check:target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
# Only public app runtime assets, never repository metadata or development inputs.
runtime_assets=set()
for pattern in ['astronotes-*.js','overlap-calculation*.js','sorami-*.js','sky-rating*.js','spots.js','*-ui.js','icon-*.png','app-icon-*.png','astronotes-*.png','almanac-*.png','almanac-*.webp','*.css']:
 runtime_assets.update(root.glob(pattern))
for f in sorted(runtime_assets):emit(out/f.name,f.read_bytes())
# 探すの大きなデータは本体の data/ に1つだけ置き、試用版は ../data/ から読む（Pages の容量。上の meta で指す）。
# 2026-11-13 見える場所の地図（data/visibility/）も同じく本体の data/ だけに置く。
shared=lambda p:p.parts[1] in ('building-heights','building-shapes','osm-places','visibility') or p.parts[1].startswith('candidate-')
tracked=set(subprocess.check_output(['git','ls-files','data','vendor'],cwd=root,text=True).splitlines())
# Classification evidence is a build input; runtime reads candidate-surveyed-viewpoints.json.
build_inputs={'data/surveyed-viewpoint-categories.json'}
tracked.difference_update(build_inputs)
for name in ['data','vendor']:
 for f in (root/name).rglob('*'):
  if f.is_file() and str(f.relative_to(root)) in tracked and not shared(f.relative_to(root)):
   emit(out/f.relative_to(root),f.read_bytes())
# The guarded moon-map source overlays only change trial. Its builder re-renders the
# source and stamps asset versions/CSP against the trial assets, never production.
for name,content in bundle.items():emit(out/name,content.encode())
# 重なる日の計算本体（overlap-calculation*）は本体側で tools/build-overlap-products.py が作り、上の複写でそのまま来る。
emit(out/'overlap-calculation.html',(root/'overlap-calculation.html').read_bytes())
# 2026-10-28 写真の評価と規約・プライバシーも本体から作る（試用版の表示だけ変える）
r=(root/'sky-rating.html').read_text().replace('· AstroNotes</title>','· AstroNotes 試用版</title>').replace('<span class="brand">AstroNotes</span>','<span class="brand">AstroNotes <span>試用版</span></span>')
emit(out/'sky-rating.html',r.encode())
for name in ['privacy.html','terms.html']:emit(out/name,(root/name).read_bytes())
m=json.loads((root/'manifest.json').read_text());m.update(name='AstroNotes 試用版',short_name='AstroNotes 試用版',id='./',scope='./',start_url='./')
emit(out/'manifest.json',(json.dumps(m,ensure_ascii=False,indent=2)+'\n').encode())
if check:
 stale=sorted(str(p.relative_to(root)) for p,data in expected.items() if not p.is_file() or p.read_bytes()!=data)
 if stale:sys.exit('trial の生成物が一致しません（python3 build-preview.py で再生成）: '+', '.join(stale))
 print('Preview matches the guarded moon-map build:',len(expected),'files')
else:print('Preview refreshed:',out)
