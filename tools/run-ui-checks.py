"""Run the repository's Node checks with bounded concurrency."""
from pathlib import Path
import argparse,concurrent.futures,json,subprocess,tempfile
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=None);a=p.parse_args();root=Path(__file__).resolve().parents[1];out=a.output or Path(tempfile.mkdtemp(prefix='astronotes-checks-'));out.mkdir(parents=True,exist_ok=True)
checks=sorted(root.glob('test-*.mjs'))+[root/'check-contrast.mjs']
def run(f):
 cmd=['node']+(['--test'] if 'node:test' in f.read_text() else [])+[f.name]
 r=subprocess.run(cmd,cwd=root,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True);(out/(f.stem+'.log')).write_text(r.stdout);return {'test':f.name,'rc':r.returncode}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(run,checks))
(out/'results.json').write_text(json.dumps(results,indent=2));failed=[x['test'] for x in results if x['rc']];print(json.dumps({'programs':len(results),'failed':failed,'output':str(out)}));raise SystemExit(bool(failed))
