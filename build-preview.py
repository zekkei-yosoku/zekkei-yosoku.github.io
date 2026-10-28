"""Refresh the iPhone-accessible preview from the current public app (no deletion).
The preview shares the production account/API/storage. Review before deployment.

  python3 build-preview.py           trial を本体の現行版で作り直す
  python3 build-preview.py --check   作り直すと変わるファイルを挙げて失敗する（何も書かない）。
                                     trial を本体へ揃えたあとの確認に使う（2026-10-15 総点検M06）
"""
from pathlib import Path
import json,subprocess,sys
check='--check' in sys.argv[1:]
root=Path(__file__).resolve().parent
out=root/'trial'
expected={}
def emit(target,data):
 expected[target]=data
 if not check:target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
# Only public app runtime assets, never repository metadata or development inputs.
for pattern in ['astronotes-*.js','sorami-*.js','sky-rating*.js','spots.js','*-ui.js','icon-*.png','app-icon-*.png','astronotes-*.png','almanac-*.png','almanac-*.webp','*.css']:
 for f in root.glob(pattern):emit(out/f.name,f.read_bytes())
tracked=set(subprocess.check_output(['git','ls-files','data','vendor'],cwd=root,text=True).splitlines())
for name in ['data','vendor']:
 for f in (root/name).rglob('*'):
  if f.is_file() and str(f.relative_to(root)) in tracked:
   emit(out/f.relative_to(root),f.read_bytes())
s=(root/'index.html').read_text().replace('<title>AstroNotes</title>','<title>AstroNotes 試用版</title>').replace('name="apple-mobile-web-app-title" content="AstroNotes"','name="apple-mobile-web-app-title" content="AstroNotes 試用版"')
s=s.replace('  <div class="backbar"', '  <div class="backbar"',1)
idx=s.index('  <div class="masthead">')
s=s[:idx]+'  <p style="font-size:12px;padding:6px 2px;color:var(--secondary)">試用版 · 本番とアカウント・保存データ共通 <a href="../">本番へ</a></p>\n'+s[idx:]
emit(out/'index.html',s.encode())
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
