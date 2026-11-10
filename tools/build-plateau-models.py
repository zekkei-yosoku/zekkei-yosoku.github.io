"""2026-11-10 Trial only. PLATEAUの建物の形を、ユーザーが重ねる対象として追加できる形にする（全国の整備都市）。

  python3 tools/build-plateau-models.py SCAN.jsonl --scan [--jobs 8]      CityGMLを読み、高さ30m以上の建物の形を1行ずつ書く
  python3 tools/build-plateau-models.py SCAN.jsonl --pack OUT_DIR --min 30 2次メッシュ（約10km）ごとの一覧にまとめる

形は屋根の面ごとに「その面を地面から屋根の高さまで伸ばした柱」の集まり（LOD2/3の屋根面。屋根面が無ければLOD1の外形を
計測高さまで伸ばした柱1本）。遠くから見た輪郭は柱の集まりの投影で、アプリの都市モデル（AstroNotesCityModels の solids）と
同じ読み方をする。座標は狙う点（一番高い部分の中心）から東・北へのdm、高さは地面からのdm。CityGMLは保存せず読みながら処理する。
"""
import sys,os,io,json,gzip,math,time,hashlib,importlib.util,concurrent.futures as cf
import xml.etree.ElementTree as ET
spec=importlib.util.spec_from_file_location('heights',os.path.join(os.path.dirname(os.path.abspath(__file__)),'build-plateau-heights.py'))
H=importlib.util.module_from_spec(spec);spec.loader.exec_module(H)
B='{http://www.opengis.net/citygml/building/2.0}';G='{http://www.opengis.net/gml}'
MIN_SCAN_M=30

def roofs(el):
 """Roof rings (LOD2/3 RoofSurface) of a building and its parts, with every z read for the base and top."""
 rings=[];zs=[]
 for s in el.iter(B+'RoofSurface'):
  for p in s.iter(G+'posList'):
   v=p.text.split() if p.text else [];pts=[(float(v[i]),float(v[i+1]),float(v[i+2])) for i in range(0,len(v)-2,3)]
   if len(pts)>=3:rings.append(pts)
 return rings

def name_of(el):
 for ch in el:
  if ch.tag==G+'name' and ch.text and ch.text.strip():return ch.text.strip()
 for ch in el.iter(B+'name'):
  if ch.text and ch.text.strip():return ch.text.strip()
 return None

def building(el,bid):
 units=H.units(el)
 z1=[p[2] for u in units for ring in u['rings'].get(1,[]) for p in ring];z23=[p[2] for u in units for k in (2,3,4) for ring in u['rings'].get(k,[]) for p in ring]
 if not z1 and not z23:return None
 base=min(z1) if z1 else min(z23);mh=max([h for u in units for h in u['mh'] if h>0],default=None)
 height=max(mh or 0,(max(z1+z23)-base))
 if height<MIN_SCAN_M:return None
 rr=roofs(el);lod=2 if rr else 1
 if not rr:
  # LOD1: the outline extruded to the measured height (the highest point), as one column.
  foot=[ring for u in units for ring in u['rings'].get(0,[])+u['rings'].get(1,[]) if len(ring)>=3]
  if not foot:return None
  ring=max(foot,key=lambda r:abs(area(r)))
  rr=[[(p[0],p[1],base+height) for p in ring]]
 top=max(p[2] for r in rr for p in r)
 # Aim point: the centre of the parts within 1.5 m of the top.
 tq=[p for r in rr for p in r if p[2]>=top-1.5];lat=(min(p[0] for p in tq)+max(p[0] for p in tq))/2;lon=(min(p[1] for p in tq)+max(p[1] for p in tq))/2
 kx=111320*math.cos(math.radians(lat));ky=110540
 cols=[]
 for r in rr:
  pts=[(round((p[1]-lon)*kx*10),round((p[0]-lat)*ky*10)) for p in r]
  pts=[q for i,q in enumerate(pts) if q!=pts[i-1]]
  if len(pts)<3:continue
  cols.append([round((max(p[2] for p in r)-base)*10),[c for q in pts for c in q]])
 if not cols:return None
 return {'id':bid,'name':name_of(el),'lat':round(lat,7),'lon':round(lon,7),'groundM':round(base,2),'heightM':round(max(height,top-base),2),'lod':lod,'measured':mh is not None,'cols':cols}

def area(r):
 return sum(r[i-1][1]*r[i][0]-r[i][1]*r[i-1][0] for i in range(len(r)))/2

def scan_mesh(job):
 code,urls=job;out=[];seen=set()
 try:
  for url in dict.fromkeys(urls):
   body,gz=H.fetch(url);stream=gzip.GzipFile(fileobj=io.BytesIO(body)) if gz else io.BytesIO(body)
   for ev,el in ET.iterparse(stream,events=('end',)):
    if el.tag!=B+'Building':
     if el.tag.endswith('}cityObjectMember') or el.tag.endswith('}appearanceMember'):el.clear()
     continue
    bid=el.get(G+'id');b=None if bid in seen else building(el,bid);el.clear()
    if b:seen.add(bid);b['mesh']=code;out.append(b)
  return code,out,None
 except Exception as e:return code,out,str(e)[:200]

def scan(path,jobs):
 codes=H.city_codes();meshes={};cities=[]
 for c in codes:
  try:body,gz=H.fetch(f'{H.API}{c}?types=bldg',tries=2);cat=json.loads(gzip.decompress(body) if gz else body)
  except Exception as e:print('catalog unavailable',c,str(e)[:80],flush=True);continue
  for city in cat.get('cities',[]):
   cities.append({'cityCode':city['cityCode'],'cityName':city['cityName'],'year':city['year']})
   for f in city['files'].get('bldg',[]):meshes.setdefault(f['code'],[]).append(f['url'])
 todo=sorted(meshes.items());t0=time.time();done=0;n=0;failed=[]
 with open(path,'w') as f,cf.ProcessPoolExecutor(max_workers=jobs) as ex:
  f.write(json.dumps({'cities':cities},ensure_ascii=False)+'\n')
  for code,rows,err in ex.map(scan_mesh,todo,chunksize=4):
   done+=1
   if err:failed.append([code,err])
   for r in rows:f.write(json.dumps(r,ensure_ascii=False,separators=(',',':'))+'\n');n+=1
   if done%500==0 or done==len(todo):print(f'{done}/{len(todo)} {time.time()-t0:.0f}s buildings {n} failed {len(failed)}',flush=True)
 print('done buildings',n,'failed',len(failed),flush=True)

def pack(path,out,min_m):
 os.makedirs(out,exist_ok=True);parts={};cities=None
 with open(path) as f:
  for i,line in enumerate(f):
   r=json.loads(line)
   if i==0:cities=r['cities'];continue
   if r['heightM']<min_m:continue
   parts.setdefault(r['mesh'][:6],[]).append([r['id'],r['name'],r['lat'],r['lon'],r['groundM'],r['heightM'],r['lod'],r['cols']])
 index={'format':'AstroNotes PLATEAU building shapes v1','built':time.strftime('%Y-%m-%d'),'minHeightM':min_m,
  'attribution':'3D都市モデル（Project PLATEAU）国土交通省 を加工して作成','license':'PDL1.0 https://www.digital.go.jp/resources/open_data/public_data_license_v1.0',
  'row':'[PLATEAU building id, name or null, aim latitude, aim longitude, ground T.P. m, height m, LOD, columns]; a column is [top dm above ground, flat east/north dm pairs from the aim point]',
  'cities':cities,'parts':{}}
 total=0
 for p,rows in sorted(parts.items()):
  data=gzip.compress(json.dumps({'buildings':rows},ensure_ascii=False,separators=(',',':')).encode(),9,mtime=0)
  with open(os.path.join(out,p+'.json.gz'),'wb') as f:f.write(data)
  index['parts'][p]=[hashlib.sha256(data).hexdigest()[:16],len(rows),len(data)];total+=len(data)
 with open(os.path.join(out,'index.json'),'w') as f:json.dump(index,f,ensure_ascii=False,separators=(',',':'))
 print('buildings',sum(v[1] for v in index['parts'].values()),'parts',len(parts),'bytes',total)

if __name__=='__main__':
 a=sys.argv[1:];path=a[0];jobs=int(a[a.index('--jobs')+1]) if '--jobs' in a else 8
 if '--scan' in a:scan(path,jobs)
 elif '--pack' in a:pack(path,a[a.index('--pack')+1],float(a[a.index('--min')+1]) if '--min' in a else 45)
