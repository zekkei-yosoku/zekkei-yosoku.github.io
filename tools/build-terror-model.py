# coding: utf-8
# Rebuild public geometry only; private photographs and shooting location remain in Vault.
from pathlib import Path
import json,re
repo=Path(__file__).resolve().parents[1]
model=json.loads((repo/'tools/タワー・オブ・テラー_写真輪郭.json').read_text())
p=model['provenance']['photoOutlinePixels']
def cross(a,b,c):return(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
poly=[[(x-610)/8.1,59-(y-1018)/8.1] for x,y in p]
area=sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(poly,poly[1:]+poly[:1]))
ids=list(range(len(poly)));ids=ids if area>0 else ids[::-1];tri=[]
while len(ids)>3:
 for j in range(len(ids)):
  ai,bi,ci=ids[j-1],ids[j],ids[(j+1)%len(ids)];a,b,c=poly[ai],poly[bi],poly[ci]
  if cross(a,b,c)<=1e-9:continue
  if any(all(cross(u,v,poly[k])>=-1e-9 for u,v in [(a,b),(b,c),(c,a)]) for k in ids if k not in [ai,bi,ci]):continue
  tri.append([a,b,c]);ids.pop(j);break
 else:raise ValueError('cannot triangulate')
tri.append([poly[k] for k in ids])
assert abs(sum(abs(cross(*t)) for t in tri)-abs(area))<1e-6
solids=[]
for t in tri:
 pts=[]
 for sign in [-1,1]:
  for x,z in t:
   z=max(0,z);depth=.12 if z>55 else(1.5 if z>51 else(7 if z>25 else 5))
   y=sign*depth;f=(10000+y)/10000 # synthetic reference plane, not the shooting distance
   pts.append([round(x*f,6),y,round(z*f,6)])
 solids.append(pts)
model['solids']=solids
(repo/'tools/タワー・オブ・テラー_写真輪郭.json').write_text(json.dumps(model,ensure_ascii=False,indent=2))
s=(repo/'sorami-align.js').read_text()
s,n=re.subn(r'  const TERROR_MODEL = .*?;\n',lambda _: '  const TERROR_MODEL = '+json.dumps(model,ensure_ascii=False,separators=(',',':'))+';\n',s,count=1)
assert n==1
(repo/'sorami-align.js').write_text(s)
print(len(p),len(solids))
