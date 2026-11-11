#!/usr/bin/env python3
"""Offline hulls of the existing drawing's convex volume vertices. Requires scipy; normal trial builds reuse this checked artifact."""
import hashlib,json,subprocess
from pathlib import Path
import numpy as np
from scipy.spatial import ConvexHull
root=Path(__file__).resolve().parent.parent
raw=subprocess.check_output(['node','-e',"process.stdout.write(JSON.stringify(require('./astronotes-align.js').TOWER_MODELS.skytree))"],cwd=root)
m=json.loads(raw);rows=[]
for f in m['faces']:
 v=np.array([m['vertices'][i] for i in f]);unique=np.unique(v,axis=0,return_index=True)[1];v=v[unique];ids=[f[i] for i in unique]
 hull=ConvexHull(v)
 rows.append([[int(ids[j]) for j in t] for t in hull.simplices])
signature_raw=json.dumps({'vertices':m['vertices'],'faces':m['faces'],'heightM':m['heightM']},separators=(',',':'))
# JSON numeric spellings differ between Python and JS, so calculate the fast runtime version key in JS.
sig=subprocess.check_output(['node','-e',"const m=require('./astronotes-align.js').TOWER_MODELS.skytree,s=JSON.stringify({vertices:m.vertices,faces:m.faces,heightM:m.heightM});let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);process.stdout.write(String(h>>>0))"],cwd=root).decode()
data={'modelId':m['id'],'modelSha256':hashlib.sha256(raw).hexdigest(),'signature':int(sig),'vertexCount':len(m['vertices']),'triangles':rows}
p=root/'src/features/candidates/scene-hulls.js'
p.write_text('/* Convex hull triangulation of existing self-authored Skytree drawing volumes; regenerated offline by tools/build-candidate-scene-hulls.py. */\n(function(g){const d='+json.dumps(data,separators=(',',':'))+";if(typeof module==='object'&&module.exports)module.exports=d;else g.AstroNotesTrialSurfaceHulls=d;})(globalThis);\n")
print(f'{len(rows)} solids / {sum(map(len,rows))} triangles / {p.stat().st_size} bytes')
