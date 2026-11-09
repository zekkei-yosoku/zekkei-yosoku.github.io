"""Refresh the iPhone-accessible preview from the current public app (no deletion).
The preview shares the production account/API/storage. Review before deployment.

  python3 build-preview.py           trial を本体の現行版で作り直す
  python3 build-preview.py --check   作り直すと変わるファイルを挙げて失敗する（何も書かない）。
                                     trial を本体へ揃えたあとの確認に使う（2026-10-15 総点検M06）
"""
from pathlib import Path
import hashlib,json,subprocess,sys,tempfile
check='--check' in sys.argv[1:]
root=Path(__file__).resolve().parent
out=root/'trial'
expected={}
def emit(target,data):
 expected[target]=data
 if not check:target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
# Only public app runtime assets, never repository metadata or development inputs.
runtime_assets=set()
for pattern in ['astronotes-*.js','sorami-*.js','sky-rating*.js','spots.js','*-ui.js','icon-*.png','app-icon-*.png','astronotes-*.png','almanac-*.png','almanac-*.webp','*.css']:
 runtime_assets.update(root.glob(pattern))
for f in sorted(runtime_assets):emit(out/f.name,f.read_bytes())
tracked=set(subprocess.check_output(['git','ls-files','data','vendor'],cwd=root,text=True).splitlines())
for name in ['data','vendor']:
 for f in (root/name).rglob('*'):
  if f.is_file() and str(f.relative_to(root)) in tracked:
   emit(out/f.relative_to(root),f.read_bytes())
s=(root/'index.html').read_text().replace('<title>AstroNotes</title>','<title>AstroNotes 試用版</title>').replace('name="apple-mobile-web-app-title" content="AstroNotes"','name="apple-mobile-web-app-title" content="AstroNotes 試用版"')
idx=s.index('  <div class="masthead">')
s=s[:idx]+'  <p style="position:relative;z-index:1;font-size:12px;padding:6px 2px;color:var(--secondary)">試用版 · 本番とアカウント・保存データ共通 <a href="../">本番へ</a></p>\n'+s[idx:]
# Independent candidate experiment is composed from the canonical Explore source.
# It never writes production products and remains reproducible on every refresh.
bundle=json.loads(subprocess.check_output(['node','tools/build-candidate-trial.mjs','--html'],cwd=root,input=s,text=True))
for name,content in bundle.items():emit(out/name,content.encode())
# 2026-11-09 端末の重なる日一覧は、サーバーと同じ幾何計算本体（大気差なし）を別frameで動かす。
# 本体は生成後のtrialから抽出するため、書き込まない--checkでも一時領域で同じ入力を再現する。
with tempfile.TemporaryDirectory() as staged:
 staged_trial=Path(staged)/'trial'
 for p,data in expected.items():
  q=staged_trial/p.relative_to(out);q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(data)
 subprocess.check_call(['node','tools/build-overlap-calculation.cjs',str(root),staged,str(staged_trial)],cwd=root,stdout=subprocess.DEVNULL)
 engine=(Path(staged)/'calculation.js').read_bytes();engine_sha=json.loads((Path(staged)/'manifest.json').read_text())['sha256']
frame=(root/'tools/overlap-calculation-frame.js').read_bytes()
emit(out/'overlap-calculation.js',engine);emit(out/'overlap-calculation-frame.js',frame)
emit(out/'overlap-calculation.html',(f'<!doctype html>\n<html lang="ja" data-engine="{engine_sha}">\n<meta charset="utf-8">\n'
 '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; connect-src https://cyberjapandata.gsi.go.jp https://cyberjapandata2.gsi.go.jp; img-src blob: data: https://cyberjapandata.gsi.go.jp; base-uri \'none\'; form-action \'none\'">\n'
 f'<title>AstroNotes calculation</title>\n<script src="overlap-calculation.js?v={engine_sha[:16]}"></script>\n'
 f'<script src="overlap-calculation-frame.js?v={hashlib.sha256(frame).hexdigest()[:16]}"></script>\n</html>\n').encode())
# 2026-10-28 写真の評価と規約・プライバシーも本体から作る（試用版の表示だけ変える）
r=(root/'sky-rating.html').read_text().replace('· AstroNotes</title>','· AstroNotes 試用版</title>').replace('<span class="brand">AstroNotes</span>','<span class="brand">AstroNotes <span>試用版</span></span>')
emit(out/'sky-rating.html',r.encode())
for name in ['privacy.html','terms.html']:emit(out/name,(root/name).read_bytes())
m=json.loads((root/'manifest.json').read_text());m.update(name='AstroNotes 試用版',short_name='AstroNotes 試用版',id='./',scope='./',start_url='./')
emit(out/'manifest.json',(json.dumps(m,ensure_ascii=False,indent=2)+'\n').encode())
if check:
 stale=sorted(str(p.relative_to(root)) for p,data in expected.items() if not p.is_file() or p.read_bytes()!=data)
 if stale:sys.exit('trial は本体と違います（python3 build-preview.py で揃える）: '+', '.join(stale))
 print('Preview matches the public app:',len(expected),'files')
else:print('Preview refreshed:',out)
