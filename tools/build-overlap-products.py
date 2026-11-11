"""重なる日の計算本体を作る。サーバーと同じ幾何計算本体（大気差なし）を、端末では別frameとWorkerで動かす。
本体は生成後の index.html と astronotes-*.js から抽出するので、tools/build-index.mjs のあとに回す（bump.sh）。

  python3 tools/build-overlap-products.py           作って書く
  python3 tools/build-overlap-products.py --check   作り直すと変わるファイルを挙げて失敗する（何も書かない）
"""
from pathlib import Path
import hashlib,json,subprocess,sys,tempfile
check='--check' in sys.argv[1:]
root=Path(__file__).resolve().parent.parent
out=root
expected={}
def emit(target,data):expected[target]=data
with tempfile.TemporaryDirectory() as staged:
 subprocess.check_call(['node','tools/build-overlap-calculation.cjs',str(root),staged,str(root)],cwd=root,stdout=subprocess.DEVNULL)
 engine=(Path(staged)/'calculation.js').read_bytes();engine_sha=json.loads((Path(staged)/'manifest.json').read_text())['sha256']
frame=(root/'tools/overlap-calculation-frame.js').read_bytes()
emit(out/'overlap-calculation.js',engine);emit(out/'overlap-calculation-frame.js',frame)
# 2026-11-09 同じ本体を複数のWorkerでも動かす（並列化）。WebKitのWorkerはスタックが小さく、
# 数MBの建物モデルのオブジェクト直書きを読むと溢れる。その直書きだけを同じ中身のJSON.parseに
# 置き換えたWorker用の本体を作る（JSONとして読めることを確かめてから置き換える）。
def worker_engine(source):
 lines=source.decode().split('\n')
 for i,line in enumerate(lines):
  if len(line)<100000 or 'const models=' not in line:continue
  a=line.index('const models=')+len('const models=');b=line.index(';if(typeof module',a)
  literal=line[a:b];json.loads(literal)
  lines[i]=line[:a]+'JSON.parse('+json.dumps(literal)+')'+line[b:]
 return '\n'.join(lines).encode()
worker_body=worker_engine(engine)
emit(out/'overlap-calculation-worker-engine.js',worker_body)
emit(out/'overlap-calculation-worker.js',(f"const OVERLAP_ENGINE='{engine_sha}',OVERLAP_SOURCE='overlap-calculation-worker-engine.js?v={hashlib.sha256(worker_body).hexdigest()[:16]}';\n").encode()+(root/'tools/overlap-calculation-worker.js').read_bytes())
emit(out/'overlap-calculation.html',(f'<!doctype html>\n<html lang="ja" data-engine="{engine_sha}">\n<meta charset="utf-8">\n'
 '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; connect-src https://cyberjapandata.gsi.go.jp https://cyberjapandata2.gsi.go.jp; img-src blob: data: https://cyberjapandata.gsi.go.jp; base-uri \'none\'; form-action \'none\'">\n'
 f'<title>AstroNotes calculation</title>\n<script src="overlap-calculation.js?v={engine_sha[:16]}"></script>\n'
 f'<script src="overlap-calculation-frame.js?v={hashlib.sha256(frame).hexdigest()[:16]}"></script>\n</html>\n').encode())
stale=sorted(p.name for p,data in expected.items() if not p.is_file() or p.read_bytes()!=data)
if check:
 if stale:sys.exit('重なる日の計算本体が古い（./bump.sh で作り直す）: '+', '.join(stale))
 print('Overlap calculation products match:',len(expected),'files')
else:
 for p,data in expected.items():p.write_bytes(data)
 print('Built',len(expected),'overlap calculation products;',len(stale),'changed')
