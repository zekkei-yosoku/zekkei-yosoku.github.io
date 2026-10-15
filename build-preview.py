"""Refresh the iPhone-accessible preview from the current public app (no deletion).
The preview shares the production account/API/storage. Review before deployment.
"""
from pathlib import Path
import shutil,json,re,subprocess
root=Path(__file__).resolve().parent
out=root/'trial';out.mkdir(exist_ok=True)
# Only public app runtime assets, never repository metadata or development inputs.
for pattern in ['sorami-*.js','spots.js','*-ui.js','icon-*.png','app-icon-*.png','astronotes-*.png','*.css']:
 for f in root.glob(pattern):shutil.copy2(f,out/f.name)
tracked=set(subprocess.check_output(['git','ls-files','data','vendor'],cwd=root,text=True).splitlines())
for name in ['data','vendor']:
 for f in (root/name).rglob('*'):
  if f.is_file() and str(f.relative_to(root)) in tracked:
   target=out/f.relative_to(root);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,target)
s=(root/'index.html').read_text().replace('<title>AstroNotes</title>','<title>AstroNotes 試用版</title>').replace('name="apple-mobile-web-app-title" content="AstroNotes"','name="apple-mobile-web-app-title" content="AstroNotes 試用版"')
s=s.replace('  <div class="backbar"', '  <div class="backbar"',1)
idx=s.index('  <div class="masthead">')
s=s[:idx]+'  <p style="font-size:12px;padding:6px 2px;color:var(--secondary)">試用版 · 本番とアカウント・保存データ共通 <a href="../">本番へ</a></p>\n'+s[idx:]
(out/'index.html').write_text(s)
m=json.loads((root/'manifest.json').read_text());m.update(name='AstroNotes 試用版',short_name='AstroNotes 試用版',id='./',scope='./',start_url='./');(out/'manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
print('Preview refreshed:',out)
