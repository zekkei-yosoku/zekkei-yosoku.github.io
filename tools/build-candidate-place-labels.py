#!/usr/bin/env python3
"""Build two independently licensed, local-only place-label layers. No geocoding API calls."""
import argparse, hashlib, json
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--source-dir',type=Path,required=True)
parser.add_argument('--output-dir',type=Path)
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
out=args.output_dir or root/'data'
out.mkdir(parents=True,exist_ok=True)
boxes=[[139.7235,35.6825,139.739,35.693],[139.798,35.707,139.8145,35.718]]
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def ring_valid(r): return len(r)>=4 and r[0]==r[-1] and all(len(p)==2 and -180<=p[0]<=180 and -90<=p[1]<=90 for p in r)
def bbox(polys):
    pts=[p for poly in polys for r in poly for p in r]
    return [min(p[0] for p in pts),min(p[1] for p in pts),max(p[0] for p in pts),max(p[1] for p in pts)]
def overlaps(a,b): return a[0]<=b[2] and a[2]>=b[0] and a[1]<=b[3] and a[3]>=b[1]
def inside(r,p):
    yes=False
    for a,b in zip(r,r[1:]):
        if (a[1]>p[1])!=(b[1]>p[1]) and p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]:yes=not yes
    return yes
def intersects(a,b,c,d):
    if max(a[0],b[0])<min(c[0],d[0]) or max(c[0],d[0])<min(a[0],b[0]) or max(a[1],b[1])<min(c[1],d[1]) or max(c[1],d[1])<min(a[1],b[1]):return False
    cross=lambda p,q,r:(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])
    x,y,z,w=cross(a,b,c),cross(a,b,d),cross(c,d,a),cross(c,d,b)
    return x*y<=0 and z*w<=0
def simple(r):
    edges=list(zip(r,r[1:]))
    for i,(a,b) in enumerate(edges):
        for j in range(i+2,len(edges)):
            if i==0 and j==len(edges)-1:continue
            if intersects(a,b,*edges[j]):return False
    return True
def feature(id,name,polys,**extra):
    # Consecutive duplicate coordinates are zero-length edges, not changes to the area.
    def clean(r):return [p for i,p in enumerate(r) if i==0 or p!=r[i-1]]
    polys=[[clean(r) for r in poly] for poly in polys]
    if not polys or not all(ring_valid(r) for poly in polys for r in poly):raise ValueError('invalid rings: '+id)
    b=bbox(polys)
    if not any(overlaps(b,q) for q in boxes):return None
    if not all(simple(r) for poly in polys for r in poly):raise ValueError('self-intersecting ring: '+id)
    for poly in polys:
        for hole in poly[1:]:
            if not all(inside(poly[0],p) for p in hole[:-1]):raise ValueError('hole outside outer ring: '+id)
        for i,r in enumerate(poly):
            for other in poly[i+1:]:
                if any(intersects(a,b,c,d) for a,b in zip(r,r[1:]) for c,d in zip(other,other[1:])):raise ValueError('intersecting rings: '+id)
    return dict(id=id,name=name,bbox=b,polygons=polys,**extra)

towns=[];sources=[]
for code in ['13101','13103','13104','13106','13107']:
    path=args.source_dir/(code+'.topojson');d=json.loads(path.read_text());arcs=d['arcs']
    def arc(i):
        a=arcs[i if i>=0 else ~i]
        if d.get('transform'):
            x=y=0;scale=d['transform']['scale'];trans=d['transform']['translate'];result=[]
            for dx,dy in a:x+=dx;y+=dy;result.append([x*scale[0]+trans[0],y*scale[1]+trans[1]])
        else:result=[p[:2] for p in a]
        return result if i>=0 else result[::-1]
    def ring(ids):
        result=[]
        for i in ids:
            a=arc(i)
            if result and result[-1]!=a[0]:raise ValueError('disconnected town arc')
            result+=a if not result else a[1:]
        return result
    for g in d['objects']['town']['geometries']:
        p=g['properties'];a=g['arcs'];polys=[[ring(r) for r in a]] if g['type']=='Polygon' else [[ring(r) for r in poly] for poly in a]
        if not p.get('S_NAME'):continue
        f=feature(str(p['KEY_CODE']),p['PREF_NAME']+p['CITY_NAME']+p['S_NAME'],polys,municipality=p['PREF_NAME']+p['CITY_NAME'],town=p['S_NAME'])
        if f:towns.append(f)
    sources.append(dict(url=f'https://geoshape.ex.nii.ac.jp/ka/topojson/2020/13/r2ka{code}.topojson',sha256=digest(path)))
addresses=dict(version=1,kind='census-town-areas',year=2020,coverageBboxes=boxes,license='CC BY 4.0',licenseUrl='https://creativecommons.org/licenses/by/4.0/',sourceUrl='https://geoshape.ex.nii.ac.jp/ka/resource/',doi='10.20676/00000450',attribution='国勢調査町丁・字等別境界データセット（CODH作成）、令和2年国勢調査町丁・字等別境界データ（e-Stat）を加工',coordinateBasis='CODH geographic coordinates, derived from JGD2000 census source; not survey/address parcel boundaries',sources=sources,features=towns)

path=args.source_dir/'facilities-osm.json';osm=json.loads(path.read_bytes());facilities=[];skipped=[];excluded=0
leisure_types={'park','garden','nature_reserve','playground','sports_centre','stadium','pitch','swimming_pool','marina'}
tourism_types={'attraction','viewpoint','museum','theme_park','zoo','aquarium','hotel','hostel','camp_site','guest_house'}
building_types={'commercial','retail','office','public','civic','train_station','transportation','museum','sports_hall','stadium','school','university','hospital','hotel','church','temple','shrine','cathedral','mosque','synagogue','industrial','warehouse','parking'}
def is_facility(tags):return tags.get('leisure') in leisure_types or tags.get('tourism') in tourism_types or tags.get('amenity') or tags.get('building') in building_types
# A named outer way must not independently fill the holes of its same-named relation.
member_names={}
for el in osm['elements']:
    tags=el.get('tags',{});name=tags.get('name:ja') or tags.get('name')
    if el['type']=='relation' and tags.get('type')=='multipolygon' and name and is_facility(tags):
        for m in el.get('members',[]):
            if m.get('type')=='way':member_names.setdefault(m['ref'],set()).add(name)
def points(geometry): return [[p['lon'],p['lat']] for p in geometry if p and 'lon' in p and 'lat' in p]
def stitch(segments):
    remaining=[s[:] for s in segments];rings=[]
    while remaining:
        r=remaining.pop()
        while r[0]!=r[-1]:
            for i,s in enumerate(remaining):
                if r[-1]==s[0]:r+=s[1:];remaining.pop(i);break
                if r[-1]==s[-1]:r+=s[-2::-1];remaining.pop(i);break
                if r[0]==s[-1]:r=s[:-1]+r;remaining.pop(i);break
                if r[0]==s[0]:r=s[:0:-1]+r;remaining.pop(i);break
            else:raise ValueError('unclosed relation member')
        if not ring_valid(r):raise ValueError('invalid stitched ring')
        rings.append(r)
    return rings
for el in osm['elements']:
    tags=el.get('tags',{});name=tags.get('name:ja') or tags.get('name');id=el['type']+'/'+str(el['id'])
    if not name:continue
    # A named land-use/service district or residential building is not a named facility.
    if not is_facility(tags):excluded+=1;continue
    if el['type']=='way' and name in member_names.get(el['id'],set()):excluded+=1;continue
    try:
        if el['type']=='way':
            r=points(el.get('geometry',[]))
            if not ring_valid(r):continue # An unclosed way is not a facility area.
            polys=[[r]]
        elif el['type']=='relation' and tags.get('type')=='multipolygon':
            members=el.get('members',[])
            if any(m.get('type')!='way' or m.get('role','') not in ['','outer','inner'] or not m.get('geometry') for m in members):raise ValueError('unsupported/incomplete relation members')
            outer=stitch([points(m['geometry']) for m in members if m.get('role','') in ['','outer']]);inner=stitch([points(m['geometry']) for m in members if m.get('role')=='inner']);polys=[[r] for r in outer]
            for hole in inner:
                containers=[p for p in polys if inside(p[0],hole[0])]
                if len(containers)!=1:raise ValueError('ambiguous hole')
                containers[0].append(hole)
        else:continue
        f=feature(id,name,polys,tags={k:tags[k] for k in ['leisure','tourism','amenity','landuse','building'] if k in tags})
        if f:facilities.append(f)
    except ValueError as error:skipped.append(dict(id=id,reason=str(error)))
facility_data=dict(version=1,kind='osm-named-areas',dataDate=osm['osm3s']['timestamp_osm_base'],coverageBboxes=boxes,license='ODbL 1.0',licenseUrl='https://opendatacommons.org/licenses/odbl/1-0/',sourceUrl='https://www.openstreetmap.org/copyright',attribution='OpenStreetMap contributors',coordinateBasis='OSM WGS84 geographic longitude,latitude; mapped areas are not access guarantees',sourceSha256=digest(path),querySha256=digest(args.source_dir/'facilities-query.overpass'),tagPolicy=dict(leisure=sorted(leisure_types),tourism=sorted(tourism_types),building=sorted(building_types),amenity='named polygon areas'),excludedByTagPolicy=excluded,features=facilities,skipped=skipped)
for name,data in [('candidate-label-addresses.json',addresses),('candidate-label-facilities.json',facility_data)]:
    dest=out/name;dest.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n');print(name,len(data['features']),dest.stat().st_size,'bytes')
