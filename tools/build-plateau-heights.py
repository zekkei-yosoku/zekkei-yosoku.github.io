"""2026-11-10 Trial only. PLATEAUを整備した全国の都市（既定。--cities で絞れる）の建物の「上面の高さ」格子を国土交通省 PLATEAU の公式CityGML（2025年度）から作る。

  python3 tools/build-plateau-heights.py trial/data/candidate-heights [--jobs 8] [--cities 13101,13102] [--only 53394654,...]
  python3 tools/build-plateau-heights.py OUT --zip-cities 02321,13421,21201 --catalog-dir SAVED_CATALOGS   目録に無い市の一括zipから
  python3 tools/build-plateau-heights.py --merge trial/data/building-heights OUT                           その結果を全国の格子へ足す

3次メッシュ（緯度30秒×経度45秒）を 185×225 マス（約5m）に分け、マスに少しでも掛かる建物の一番高い上面の
標高（T.P.、切り上げ）を持つ。高さは計測高さ（地表から最高点）を使う。LOD1の高さは点群の中央値で低めに出るため、
LOD1だけの建物は外形全体を「地表+計測高さ」とし、LOD2/3の屋根の形が計測高さを1m以内で説明する建物だけ面ごとの高さを
使う。位置の誤差の分として外形を1m広げてから5mマスへまとめる。対象として扱う建物（スカイツリーなど）は別に持ち、
探す側でその対象を狙うときだけ外す。CityGMLはディスクへ保存せず、受け取りながら読む。
"""
import sys,os,io,json,gzip,math,time,hashlib,urllib.request,concurrent.futures as cf
import xml.etree.ElementTree as ET
import numpy as np
from PIL import Image,ImageDraw

API='https://api.plateauview.mlit.go.jp/datacatalog/citygml/'
UA='AstroNotes-trial-builder/1.0'
ROWS,COLS,SUB,OFFSET=185,225,5,20
# The app's building targets inside the wards (astronotes-align.js TARGETS, astronotes-city-models.js).
TARGETS={'skytree':(35.710063,139.8107),'tokyotower':(35.65859131567304,139.74544420093412),'tocho-building':(35.6895,139.691694),
 'shibuya-sky':(35.65838377760082,139.70226592899252),'azabudai-hills':(35.6608543555483,139.7406558121773),
 'kabukicho-tower':(35.69610448807164,139.70068955167807)}
B='{http://www.opengis.net/citygml/building/2.0}';G='{http://www.opengis.net/gml}'

def fetch(url,tries=5):
 if url.startswith('zip:'):return zip_read(url,tries),False
 for i in range(tries):
  try:
   req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept-Encoding':'gzip'})
   with urllib.request.urlopen(req,timeout=180) as r:
    body=r.read();enc=r.headers.get('Content-Encoding')
   return body,enc=='gzip'
  except Exception as e:
   if i==tries-1:raise
   time.sleep(3*(i+1))

# 2026-11-11 Cities whose CityGML the catalog API does not list (鰺ヶ沢町 02321, 小笠原村 13421, 岐阜市 21201 return 404) are
# published only as one zip per city (岐阜市 4.5 GB with every feature type). The zip's central directory is read from its
# end and each building file is fetched by byte range, so only the bldg files cross the wire.
import struct,zlib
def http_range(url,a,b,tries=5):
 for i in range(tries):
  try:
   req=urllib.request.Request(url,headers={'User-Agent':UA,'Range':f'bytes={a}-{b}' if a>=0 else f'bytes={a}'})
   with urllib.request.urlopen(req,timeout=300) as r:
    if r.status!=206:raise IOError(f'range not served ({r.status})')
    return r.read(),r.headers.get('Content-Range')
  except Exception:
   if i==tries-1:raise
   time.sleep(3*(i+1))

def zip_entries(url):
 tail,cr=http_range(url,-65557,None);size=int(cr.rsplit('/',1)[1]);base=size-len(tail)
 e=tail.rfind(b'PK\x05\x06')
 if e<0:raise IOError('zip end not found')
 n,cd_size,cd_off=struct.unpack('<HII',tail[e+10:e+20])
 if cd_off==0xFFFFFFFF or n==0xFFFF or cd_size==0xFFFFFFFF:
  l=tail.rfind(b'PK\x06\x07',0,e);z64=struct.unpack('<Q',tail[l+8:l+16])[0]
  rec=tail[z64-base:z64-base+56] if z64>=base else http_range(url,z64,z64+55)[0]
  n,cd_size,cd_off=struct.unpack('<QQQ',rec[32:56])
 cd=http_range(url,cd_off,cd_off+cd_size-1)[0];out=[];p=0
 for _ in range(n):
  if cd[p:p+4]!=b'PK\x01\x02':raise IOError('bad central directory')
  method,=struct.unpack('<H',cd[p+10:p+12]);csize,usize=struct.unpack('<II',cd[p+20:p+28]);nl,xl,cl=struct.unpack('<HHH',cd[p+28:p+34]);off,=struct.unpack('<I',cd[p+42:p+46])
  name=cd[p+46:p+46+nl].decode('utf8','replace');extra=cd[p+46+nl:p+46+nl+xl];q=0
  while q+4<=len(extra):
   hid,hl=struct.unpack('<HH',extra[q:q+4]);body=extra[q+4:q+4+hl]
   if hid==1:
    vals=list(struct.unpack('<'+'Q'*(hl//8),body[:hl//8*8]));
    if usize==0xFFFFFFFF:usize=vals.pop(0)
    if csize==0xFFFFFFFF:csize=vals.pop(0)
    if off==0xFFFFFFFF:off=vals.pop(0)
   q+=4+hl
  out.append({'name':name,'method':method,'csize':csize,'usize':usize,'offset':off});p+=46+nl+xl+cl
 return out

def zip_read(spec,tries=5):
 url,entry=spec[4:].split('#',1);e=json.loads(entry)
 head,_=http_range(url,e['offset'],e['offset']+29,tries)
 if head[:4]!=b'PK\x03\x04':raise IOError('bad local header')
 nl,xl=struct.unpack('<HH',head[26:30]);start=e['offset']+30+nl+xl
 data,_=http_range(url,start,start+e['csize']-1,tries) if e['csize'] else (b'',None)
 return zlib.decompress(data,-15) if e['method']==8 else data

def zip_cities(codes):
 """(cities, {mesh: [zip: urls]}) for the given city codes from the published per-city CityGML zips."""
 body,gz=fetch(API.replace('citygml/','plateau-datasets'));d=json.loads(gzip.decompress(body) if gz else body)
 cities=[];meshes={}
 for c in d['citygml']:
  if c['city_code'] not in codes or 'bldg' not in (c.get('feature_types') or []):continue
  n=0
  for e in zip_entries(c['url']):
   leaf=e['name'].rsplit('/',1)[-1]
   if '/udx/bldg/' not in '/'+e['name'] or not leaf.endswith('.gml') or not leaf[:8].isdigit():continue
   meshes.setdefault(leaf[:8],[]).append('zip:'+c['url']+'#'+json.dumps(e,separators=(',',':')));n+=1
  cities.append({'cityCode':c['city_code'],'cityName':c['city'],'year':c['year']});print('zip',c['city_code'],c['city'],c['year'],'bldg files',n,flush=True)
 return cities,meshes

def mesh_origin(code):
 p,u,q,v,r,w=int(code[0:2]),int(code[2:4]),int(code[4]),int(code[5]),int(code[6]),int(code[7])
 return p*14800+q*1850+r*185,(100+u)*18000+v*2250+w*225

def inside(ring,lat,lon):
 on=False
 for i in range(len(ring)):
  (y1,x1),(y2,x2)=ring[i-1],ring[i]
  if (y1>lat)!=(y2>lat) and lon<(x2-x1)*(lat-y1)/(y2-y1)+x1:on=not on
 return on

def units(el):
 """The building itself and each of its parts, each with its own rings by LOD and measured height."""
 out=[]
 def walk(node,unit):
  for ch in node:
   tag=ch.tag
   if tag==B+'BuildingPart':
    sub={'rings':{},'mh':[]};out.append(sub);walk(ch,sub);continue
   if tag==B+'measuredHeight' and ch.text:
    try:unit['mh'].append(float(ch.text))
    except ValueError:pass
   local=tag.rsplit('}',1)[-1]
   if local.startswith('lod') and len(local)>3 and local[3].isdigit():
    lod=int(local[3])
    for p in ch.iter(G+'posList'):
     v=p.text.split() if p.text else []
     pts=[(float(v[i]),float(v[i+1]),float(v[i+2])) for i in range(0,len(v)-2,3)]
     if pts:unit['rings'].setdefault(lod,[]).append(pts)
    continue
   walk(ch,unit)
 top={'rings':{},'mh':[]};out.insert(0,top);walk(el,top)
 return [u for u in out if u['rings']]

def shapes(unit):
 """[(value, ring)] to draw for one unit, plus its footprint rings and a note."""
 r=unit['rings'];z1=[p[2] for ring in r.get(1,[]) for p in ring];z23=[p[2] for k in (2,3,4) for ring in r.get(k,[]) for p in ring]
 if not z1 and not z23:return [],r.get(0,[]),'no-height'
 zmin=min(z1) if z1 else min(z23);top=max(z1+z23)
 mh=max([h for h in unit['mh'] if h>0],default=None);tm=zmin+mh if mh else None
 enc=lambda z:max(1,min(65535,math.ceil(z)+OFFSET))
 foot=r.get(0,[])+r.get(1,[])
 if tm is not None and z23 and tm<=max(z23)+1.0:
  lift=max(0.0,tm-max(z23))
  return [(enc(max(p[2] for p in ring)+lift),ring) for k in (2,3,4) for ring in r.get(k,[])],foot,'faces'
 high=max(tm,top) if tm is not None else top+3.0
 return [(enc(high),ring) for k in (0,1,2,3,4) for ring in r.get(k,[])],foot,'measured' if tm is not None else 'lod-top+3'

def raster(items,gy0,gx0):
 img=Image.new('I',(COLS*SUB,ROWS*SUB),0);d=ImageDraw.Draw(img);north=(gy0+ROWS)/22200;west=gx0/18000
 for v,ring in sorted(items,key=lambda t:t[0]):
  pts=[((lon-west)*18000*SUB,(north-lat)*22200*SUB) for lat,lon,_ in ring]
  if len(pts)>=3:d.polygon(pts,fill=v,outline=v)
  elif len(pts)==2:d.line(pts,fill=v)
  else:d.point(pts,fill=v)
 a=np.array(img,dtype=np.int32)
 # One metre of position uncertainty around every outline.
 m=a.copy();h,w=a.shape
 for dy in (-1,0,1):
  for dx in (-1,0,1):
   if dy or dx:m[max(0,dy):h+min(0,dy),max(0,dx):w+min(0,dx)]=np.maximum(m[max(0,dy):h+min(0,dy),max(0,dx):w+min(0,dx)],a[max(0,-dy):h+min(0,-dy),max(0,-dx):w+min(0,-dx)])
 return m.reshape(ROWS,SUB,COLS,SUB).max(axis=(1,3))[::-1].astype(np.uint16)

def encode(grid):
 flat=grid.astype(np.int32);delta=np.diff(flat,axis=1,prepend=0).astype(np.int16).view(np.uint16).ravel()
 return gzip.compress((delta&255).astype(np.uint8).tobytes()+(delta>>8).astype(np.uint8).tobytes(),9,mtime=0)

def build_mesh(job):
 code,urls=job;gy0,gx0=mesh_origin(code);s,w=gy0/22200,gx0/18000;n,e=(gy0+ROWS)/22200,(gx0+COLS)/18000
 local={k:v for k,v in TARGETS.items() if s<=v[0]<n and w<=v[1]<e}
 items=[];targets={k:[] for k in local};near={k:(1e9,None) for k in local};stats={'buildings':0,'faces':0,'measured':0,'lod-top+3':0,'no-height':0,'sources':len(urls)}
 for url in urls:
  body,gz=fetch(url);stream=gzip.GzipFile(fileobj=io.BytesIO(body)) if gz else io.BytesIO(body);stats['wireBytes']=stats.get('wireBytes',0)+len(body)
  for ev,el in ET.iterparse(stream,events=('end',)):
   if el.tag!=B+'Building':
    if el.tag.endswith('}cityObjectMember') or el.tag.endswith('}appearanceMember'):el.clear()
    continue
   stats['buildings']+=1;bid=el.get('{http://www.opengis.net/gml}id')
   for unit in units(el):
    drawn,foot,kind=shapes(unit);stats[kind]+=1
    hit=None
    for k,(la,lo) in local.items():
     if any(inside([(p[0],p[1]) for p in ring],la,lo) for ring in foot):hit=k;break
     dist=min((math.hypot((p[0]-la)*110540,(p[1]-lo)*90400) for ring in foot for p in ring),default=1e9)
     if dist<near[k][0]:near[k]=(dist,(bid,drawn))
    if hit:targets[hit].append((bid,drawn))
    else:items+=drawn
   el.clear()
 for k in local:
  if not targets[k] and near[k][0]<30:
   bid,drawn=near[k][1];targets[k].append((bid,drawn))
   # The nearest outline was drawn into the base grid as an ordinary building; draw the base again without it.
   items=[t for t in items if not any(t is x for x in drawn)]
 grid=raster(items,gy0,gx0);body=encode(grid)
 tg={}
 for k,parts in targets.items():
  if not parts:continue
  g=raster([t for _,d in parts for t in d],gy0,gx0);idx=np.flatnonzero(g.ravel())
  tg[k]={'buildingIds':sorted({b for b,_ in parts}),'cells':[[int(i),int(g.ravel()[i])] for i in idx],'topM':int(g.max())-OFFSET}
 stats['filled']=round(float((grid>0).mean()),4)
 return code,body,{'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest(),'maxTopM':int(grid.max())-OFFSET if grid.max() else None,**stats},tg

def safe_mesh(job):
 # A mesh that cannot be read is left out of the index (the app then treats it as not covered).
 try:return build_mesh(job)
 except Exception as e:return job[0],None,{'error':str(e)[:200]},{}

def city_codes():
 body,gz=fetch(API.replace('citygml/','plateau-datasets'));d=json.loads(gzip.decompress(body) if gz else body)
 return sorted({c['city_code'] for c in d['latest_citygml'] if 'bldg' in (c.get('feature_types') or [])})

def main():
 out=sys.argv[1];jobs=8;only=None;codes=None;a=sys.argv[2:]
 if '--jobs' in a:jobs=int(a[a.index('--jobs')+1])
 if '--only' in a:only=set(a[a.index('--only')+1].split(','))
 if '--cities' in a:codes=a[a.index('--cities')+1].split(',')
 os.makedirs(out,exist_ok=True)
 # --zip-cities: build only the meshes of those cities' zips, each with every other city's files of the same mesh
 # (from --catalog-dir, the catalogs saved by a full build), for merging into a full build with merge_into().
 zipped=a[a.index('--zip-cities')+1].split(',') if '--zip-cities' in a else None
 catdir=a[a.index('--catalog-dir')+1] if '--catalog-dir' in a else None
 if catdir and codes is None:codes=sorted(f[:-5] for f in os.listdir(catdir) if f.endswith('.json'))
 codes=codes if codes is not None else city_codes();cities=[];meshes={}
 zc,zm=zip_cities(set(zipped)) if zipped else ([],{})
 if zipped:only=set(zm) if only is None else only&set(zm)
 for c in codes:
  if c in (zipped or ()):continue
  try:
   if catdir:raw=open(os.path.join(catdir,c+'.json'),'rb').read();cat=json.loads(gzip.decompress(raw) if raw[:2]==b'\x1f\x8b' else raw)
   else:body,gz=fetch(f'{API}{c}?types=bldg',tries=2);cat=json.loads(gzip.decompress(body) if gz else body)
  except Exception as e:print('catalog unavailable',c,str(e)[:80],flush=True);continue
  for city in cat.get('cities',[]):
   files=[f for f in city['files'].get('bldg',[]) if not only or f['code'] in only]
   if zipped and not files:continue
   cities.append({'cityCode':city['cityCode'],'cityName':city['cityName'],'year':city['year']})
   for f in files:meshes.setdefault(f['code'],[]).append(f['url'])
 cities+=zc
 for k,v in zm.items():meshes.setdefault(k,[]).extend(v)
 todo=sorted((k,v) for k,v in meshes.items() if not only or k in only)
 print('cities',len(cities),'meshes',len(todo),'files',sum(len(v) for _,v in todo),flush=True)
 index={'format':'AstroNotes PLATEAU top heights v2','built':time.strftime('%Y-%m-%d'),
  'attribution':'3D都市モデル（Project PLATEAU）国土交通省 を加工して作成（都市と年度は cities）','license':'PDL1.0 https://www.digital.go.jp/resources/open_data/public_data_license_v1.0',
  'grid':{'rows':ROWS,'cols':COLS,'cellsPerDegreeLat':22200,'cellsPerDegreeLon':18000,'rowOrder':'south-to-north','offsetM':OFFSET,
   'value':'0 = no building; otherwise ceil(top T.P. m)+offset over every building that touches the cell, outlines widened by 1 m',
   'height':'max(LOD1/LOD2 top, LOD1 base + measuredHeight); LOD2/3 roof faces only where they explain measuredHeight within 1 m; no measuredHeight: LOD top + 3 m',
   'encoding':'gzip of uint8 low bytes then high bytes of int16 row-wise differences (row-major)'},
  'layout':'<first 4 digits of the mesh code>/<mesh code>.bin; each part lists its meshes in <part>/index.json as code: [first 16 hex of the file sha256, highest top m]',
  'excludes':'bridges, elevated roads and railways, trees and other non-building structures are not in the grid',
  'cities':sorted(cities,key=lambda c:c['cityCode']),'parts':{},'partValue':'[first 16 hex of the part index sha256, meshes, highest top m]','targets':{}}
 t0=time.time();done=0;parts={};report={};failed=[]
 with cf.ProcessPoolExecutor(max_workers=jobs) as ex:
  for code,body,meta,tg in ex.map(safe_mesh,todo,chunksize=4):
   done+=1
   if body is None:failed.append([code,meta['error']]);continue
   part=code[:4];os.makedirs(os.path.join(out,part),exist_ok=True)
   with open(os.path.join(out,part,code+'.bin'),'wb') as f:f.write(body)
   parts.setdefault(part,{})[code]=[meta['sha256'][:16],meta['maxTopM']]
   r=report.setdefault(part,{'meshes':0,'bytes':0,'buildings':0,'wireBytes':0})
   r['meshes']+=1;r['bytes']+=meta['bytes'];r['buildings']+=meta['buildings'];r['wireBytes']+=meta.get('wireBytes',0)
   for k,v in tg.items():index['targets'].setdefault(k,{})[code]=v
   if done%200==0 or done==len(todo):print(f'{done}/{len(todo)} {time.time()-t0:.0f}s failed {len(failed)}',flush=True)
 for part,ms in sorted(parts.items()):
  data=json.dumps({'meshes':dict(sorted(ms.items()))},separators=(',',':')).encode()
  with open(os.path.join(out,part,'index.json'),'wb') as f:f.write(data)
  index['parts'][part]=[hashlib.sha256(data).hexdigest()[:16],len(ms),max((v[1] or 0) for v in ms.values())]
 with open(os.path.join(out,'index.json'),'w') as f:json.dump(index,f,ensure_ascii=False,separators=(',',':'))
 # Build totals for audit; the app reads only the indexes and the mesh files.
 with open(os.path.join(out,'build-report.json'),'w') as f:json.dump({'parts':report,'failed':failed,'seconds':round(time.time()-t0)},f,ensure_ascii=False,separators=(',',':'))
 print('meshes',sum(len(v) for v in parts.values()),'bytes',sum(r['bytes'] for r in report.values()),'wire',sum(r['wireBytes'] for r in report.values()),'failed',len(failed),'targets',{k:list(v) for k,v in index['targets'].items()})

def merge_into(full,add):
 """Add the meshes of a --zip-cities build (add) to a full build (full): mesh files, part indexes, cities, report."""
 F=json.load(open(os.path.join(full,'index.json')));A=json.load(open(os.path.join(add,'index.json')))
 for part in A['parts']:
  ms=json.load(open(os.path.join(add,part,'index.json')))['meshes'];os.makedirs(os.path.join(full,part),exist_ok=True)
  p=os.path.join(full,part,'index.json');cur=json.load(open(p))['meshes'] if os.path.exists(p) else {}
  for code,v in ms.items():
   with open(os.path.join(add,part,code+'.bin'),'rb') as src,open(os.path.join(full,part,code+'.bin'),'wb') as dst:dst.write(src.read())
   cur[code]=v
  data=json.dumps({'meshes':dict(sorted(cur.items()))},separators=(',',':')).encode()
  with open(p,'wb') as f:f.write(data)
  F['parts'][part]=[hashlib.sha256(data).hexdigest()[:16],len(cur),max((v[1] or 0) for v in cur.values())]
 F['parts']=dict(sorted(F['parts'].items()))
 have={c['cityCode'] for c in F['cities']};F['cities']=sorted(F['cities']+[c for c in A['cities'] if c['cityCode'] not in have],key=lambda c:c['cityCode'])
 for k,v in A['targets'].items():F['targets'].setdefault(k,{}).update(v)
 F['built']=time.strftime('%Y-%m-%d')
 with open(os.path.join(full,'index.json'),'w') as f:json.dump(F,f,ensure_ascii=False,separators=(',',':'))
 R=json.load(open(os.path.join(full,'build-report.json')));AR=json.load(open(os.path.join(add,'build-report.json')))
 R.setdefault('added',[]).append({'cities':[c['cityCode'] for c in A['cities']],'meshes':sum(v['meshes'] for v in AR['parts'].values()),'failed':AR['failed'],'seconds':AR['seconds']})
 with open(os.path.join(full,'build-report.json'),'w') as f:json.dump(R,f,ensure_ascii=False,separators=(',',':'))
 print('merged',sum(len(json.load(open(os.path.join(add,p,'index.json')))['meshes']) for p in A['parts']),'meshes into',full)

if __name__=='__main__':
 if sys.argv[1]=='--merge':merge_into(sys.argv[2],sys.argv[3])
 else:main()
