"""Explicit OSM/PLATEAU correspondences. Standard library only; no network IO.

The source excerpt is a reviewed model component, not a present-day physical
upper bound. A changed source or target overlay retires its correspondence.
"""
import hashlib,json,math,re
from fractions import Fraction
from pathlib import Path
import xml.etree.ElementTree as ET

G='{http://www.opengis.net/gml}'
B='{http://www.opengis.net/citygml/building/2.0}'
DEFAULT=Path(__file__).resolve().parent.parent/'data/candidate-structure-models.json'

def stable_sha(value):
 return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()).hexdigest()

def surface_data(xml):
 el=ET.fromstring(xml);kind=el.tag.removeprefix(B)
 if kind not in ('RoofSurface','WallSurface'):raise ValueError('structure surface type')
 polygons=[]
 for polygon in el.iter(G+'Polygon'):
  def rings(tag):
   out=[]
   for part in polygon.findall(G+tag):
    lists=list(part.iter(G+'posList'))
    if len(lists)!=1:raise ValueError('structure ring coordinates')
    values=[float(v) for v in (lists[0].text or '').split()]
    if len(values)<12 or len(values)%3 or not all(math.isfinite(v) for v in values):raise ValueError('structure ring values')
    points=[values[i:i+3] for i in range(0,len(values),3)]
    if points[0]!=points[-1] or any(abs(p[0])>90 or abs(p[1])>180 for p in points):raise ValueError('structure ring domain')
    out.append(points)
   return out
  outer=rings('exterior')
  if len(outer)!=1:raise ValueError('structure exterior')
  polygons.append({'outer':outer[0],'holes':rings('interior')})
 if not polygons or not el.get(G+'id'):raise ValueError('structure surface missing')
 return {'id':el.get(G+'id'),'kind':kind,'polygons':polygons}

def covers_lines(lines,polygons):
 """Exact rational planar topology, including collinear boundaries and holes.

 Split each segment at every polygon-edge crossing. Endpoints and each open
 interval must belong to the roof union; a few samples alone are insufficient.
 """
 xy=lambda p:(Fraction(str(p[1])),Fraction(str(p[0])))
 sub=lambda a,b:(a[0]-b[0],a[1]-b[1])
 cross=lambda a,b:a[0]*b[1]-a[1]*b[0]
 roofs=[([xy(p) for p in r['outer']],[[xy(p) for p in h] for h in r['holes']]) for r in polygons]
 def inside(p,ring):
  on=False
  for a,b in zip(ring,ring[1:]+ring[:1]):
   if cross(sub(b,a),sub(p,a))==0 and all(min(a[i],b[i])<=p[i]<=max(a[i],b[i]) for i in (0,1)):return True
   if (a[1]>p[1])!=(b[1]>p[1]) and p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]:on=not on
  return on
 def covered(p):return any(inside(p,outer) and not any(inside(p,h) for h in holes) for outer,holes in roofs)
 for line in lines:
  for pa,pb in zip(line,line[1:]):
   a,b=xy(pa),xy(pb);v=sub(b,a);cuts={Fraction(0),Fraction(1)}
   if not covered(a) or not covered(b):return False
   if a==b:continue
   for outer,holes in roofs:
    for ring in [outer]+holes:
     for c,d in zip(ring,ring[1:]+ring[:1]):
      w=sub(d,c);den=cross(v,w)
      if den:
       t=cross(sub(c,a),w)/den;u=cross(sub(c,a),v)/den
       if 0<=t<=1 and 0<=u<=1:cuts.add(t)
      elif cross(sub(c,a),v)==0:
       axis=0 if v[0] else 1
       for p in (c,d):
        t=(p[axis]-a[axis])/v[axis]
        if 0<=t<=1:cuts.add(t)
   ordered=sorted(cuts)
   for lo,hi in zip(ordered,ordered[1:]):
    t=(lo+hi)/2
    if not covered((a[0]+t*v[0],a[1]+t*v[1])):return False
 return True

def load_specs(path=DEFAULT):
 data=json.loads(Path(path).read_text())
 if data.get('format')!='AstroNotes explicit structure models v1':raise ValueError('structure format')
 return data['structures']

def compile_models(index,specs,rebuilt_sources=None):
 out={};seen=set()
 for spec in specs:
  sid=spec['id'];source=spec['source'];binding=spec['overlay'];geometry=spec['geometry']
  if sid in seen:raise ValueError('duplicate structure id')
  seen.add(sid)
  if not source['url'].startswith('https://') or not re.fullmatch('[0-9a-f]{64}',source['sha256']):raise ValueError('structure source')
  surfaces=[surface_data(x) for x in spec['surfacesXml']]
  if len(source['surfaces'])<3 or len(set(source['surfaces']))!=len(source['surfaces']):raise ValueError('structure surface identities')
  if [s['id'] for s in surfaces]!=source['surfaces'] or stable_sha(surfaces)!=spec['surfacesSha256']:raise ValueError('structure excerpt changed')
  if geometry['kind'] not in ('road','railway') or geometry.get('rings') or geometry.get('points'):raise ValueError('structure geometry type')
  if not math.isfinite(geometry['halfWidthM']) or geometry['halfWidthM']<0:raise ValueError('structure width')
  lines=geometry['lines']
  if not lines or any(len(line)<2 or any(len(p)!=2 or not all(isinstance(v,(float,int)) and math.isfinite(v) for v in p) or abs(p[0])>90 or abs(p[1])>180 for p in line) for line in lines):raise ValueError('structure line')
  polygons=[{'outer':[p[:2] for p in poly['outer']],'holes':[[p[:2] for p in h] for h in poly['holes']]} for s in surfaces if s['kind']=='RoofSurface' for poly in s['polygons']]
  if not polygons or not covers_lines(lines,polygons):raise ValueError('structure line outside source roof')
  current=index.get('targets',{}).get(binding['targetKey'],{}).get(binding['mesh'])
  if not current or source['buildingId'] not in current.get('buildingIds',[]) or stable_sha(current)!=binding['sha256']:continue
  if rebuilt_sources is not None and binding['mesh'] in rebuilt_sources and source['sha256'] not in rebuilt_sources[binding['mesh']]:continue
  heights=[p[2] for s in surfaces for poly in s['polygons'] for ring in [poly['outer']]+poly['holes'] for p in ring]
  out[sid]={'geometry':geometry,'topM':math.ceil(max(heights)),
   'coverage':{'polygons':polygons,'basis':'explicit source roof and side-wall component; complete centreline inside roof union'},
   'source':dict(source,topRangeM=[min(heights),max(heights)],scope='represented model, not present-day physical visibility guarantee'),
   'verification':{'allPolylineIntervalsCovered':True,'targetKey':binding['targetKey'],'mesh':binding['mesh'],'targetOverlaySha256':binding['sha256'],'sourceSurfacesSha256':spec['surfacesSha256']}}
 return out

def compile_merged_models(index,specs,refreshed,added_models):
 models=compile_models(index,specs)
 for spec in specs:
  if spec['overlay']['mesh'] in refreshed and spec['id'] not in added_models:models.pop(spec['id'],None)
 return models

def verify_source(spec,path):
 """Verify the saved source independently of its small, committed excerpt."""
 raw=Path(path).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=spec['source']['sha256']:raise ValueError('structure original source changed')
 wanted=spec['source']['buildingId'];building=None
 for _,el in ET.iterparse(path,events=('end',)):
  if el.tag==B+'Building':
   if el.get(G+'id')==wanted:building=el;break
   el.clear()
  elif el.tag.endswith('}cityObjectMember') or el.tag.endswith('}appearanceMember'):el.clear()
 if building is None:raise ValueError('structure source building missing')
 found={el.get(G+'id'):el for el in building.iter() if el.tag in (B+'RoofSurface',B+'WallSurface')}
 surfaces=[surface_data(ET.tostring(found[sid],encoding='unicode')) for sid in spec['source']['surfaces']]
 if stable_sha(surfaces)!=spec['surfacesSha256']:raise ValueError('structure excerpt differs from original')
 return spec['source']['sha256']
