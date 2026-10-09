# coding: utf-8
# Rebuild public geometry only; private photographs and shooting location remain in Vault.
from pathlib import Path
import json,re
repo=Path(__file__).resolve().parents[1]
model=json.loads((repo/'tools/タワー・オブ・テラー_写真輪郭.json').read_text())
p=model['provenance']['photoOutlinePixels']
def cross(a,b,c):return(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
poly=[[(x-610)/8.1,max(0,59-(y-1018)/8.1)] for x,y in p]
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
# Separate architectural volumes by horizontal height bands and low-wing/main-tower zones.
# Depth is estimated from GSI aerial imagery, never derived from third-party 3D meshes.
# Low-wing ornaments above the 25.3m eave are thin turrets/rails, not 22m-deep walls.
# Above 38m, the main tower's protruding shoulder belongs to the main roof volume.
# Cutting before extrusion prevents a large ground-to-roof triangle from sloping the entire facade.
def clip(poly,axis,value,greater):
 result=[]
 for a,b in zip(poly,poly[1:]+poly[:1]):
  inside_a=a[axis]>=value-1e-9 if greater else a[axis]<=value+1e-9
  inside_b=b[axis]>=value-1e-9 if greater else b[axis]<=value+1e-9
  if inside_a:result.append(a)
  if inside_a!=inside_b:
   f=(value-a[axis])/(b[axis]-a[axis]);result.append([a[k]+f*(b[k]-a[k]) for k in range(2)])
 clean=[]
 for p in result:
  if not clean or sum((p[k]-clean[-1][k])**2 for k in range(2))>1e-16:clean.append(p)
 if len(clean)>1 and sum((clean[0][k]-clean[-1][k])**2 for k in range(2))<1e-16:clean.pop()
 return clean
solids=[];total_area=0
for section in model['volumeSections']:
 rows=section['depthStations'];centre=section['centreDepthM']
 for t in tri:
  cut=clip(clip(t,0,section['xMin'],True),0,section['xMax'],False)
  cut=clip(clip(cut,1,section['zMin'],True),1,section['zMax'],False)
  if len(cut)<3:continue
  for (z0,d0),(z1,d1) in zip(rows,rows[1:]):
   band=clip(clip(cut,1,z0,True),1,z1,False)
   if len(band)<3:continue
   band_area=abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(band,band[1:]+band[:1])))
   if band_area<1e-9:continue
   total_area+=band_area
   pts=[]
   for sign in [-1,1]:
    for x,z in band:
     depth=d0+(d1-d0)*(z-z0)/(z1-z0);y=centre+sign*depth/2
     # Keep physical height at 59m; distant front-view expansion is below a pixel.
     pts.append([round(x,6),round(y,6),round(z,6)])
   solids.append(pts)
assert abs(total_area-abs(area))<1e-5, 'section cuts must preserve the complete photo profile'
model['solids']=solids
(repo/'tools/タワー・オブ・テラー_写真輪郭.json').write_text(json.dumps(model,ensure_ascii=False,indent=2))
s=(repo/'sorami-align.js').read_text()
s,n=re.subn(r'  const TERROR_MODEL = .*?;\n',lambda _: '  const TERROR_MODEL = '+json.dumps(model,ensure_ascii=False,separators=(',',':'))+';\n',s,count=1)
assert n==1
(repo/'sorami-align.js').write_text(s)
print(len(p),len(solids))
