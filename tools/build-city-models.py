# coding: utf-8
import xml.etree.ElementTree as E,json,math
from pathlib import Path
ns={'b':'http://www.opengis.net/citygml/building/2.0','g':'http://www.opengis.net/gml'}
settings=[('shibuya-sky','渋谷スカイ','7b006717-e9e6-4a94-8843-1f4ce13b2509','13113-shibuya-ku',243.637),('azabudai-hills','麻布台ヒルズ 森JPタワー',None,'13103-minato-ku',None),('kabukicho-tower','東急歌舞伎町タワー','159ebc0b-e5cd-4de8-a027-e924ee337964','13104-shinjuku-ku',None),('cocoon-tower','モード学園コクーンタワー','4e9cedb2-e1b8-48f6-9c04-b862aca365f1','13104-shinjuku-ku',None)]
models={};targets=[]
def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
for id,name,bid,ward,partZ in settings:
 path=Path('work/'+id+'-bldg_'+bid+'.xml') if bid else Path('work/'+id+'-building.xml');b=E.parse(path).getroot()
 polys=[p for tag in ['lod2MultiSurface','lod2Geometry'] for s in b.findall('.//b:'+tag,ns) for p in s.findall('.//g:Polygon',ns)]
 assert not any(p.find('g:interior',ns) is not None for p in polys),'holes require explicit triangulation'
 rings=[]
 for p in polys:
  t=p.find('g:exterior/g:LinearRing/g:posList',ns).text.split();r=[tuple(map(float,t[i:i+3])) for i in range(0,len(t),3)];r=r[:-1] if r[0]==r[-1] else r;r=list(dict.fromkeys(r));rings.append(r)
 ground=min(float(z) for s in b.findall('.//b:GroundSurface',ns) for p in s.findall('.//g:posList',ns) for z in p.text.split()[2::3]);q=[v for r in rings for v in r];top=max(v[2] for v in q)
 partZ=partZ or top
 # Centre the aim point on the actual upper tower, not its asymmetric lower podium.
 tq=[v for v in q if v[2]>=partZ-1.5];lat=(min(v[0] for v in tq)+max(v[0] for v in tq))/2;lon=(min(v[1] for v in tq)+max(v[1] for v in tq))/2
 vv=[];geo=[];lookup={};faces=[]
 for r in rings:
  face=[]
  for v in r:
   if v not in lookup:
    lookup[v]=len(vv);a,c,z=v;vv.append([(c-lon)*111320*math.cos(math.radians(lat)),(a-lat)*111320,z-ground]);geo.append([a,c])
   face.append(lookup[v])
  faces.append(face)
 tris=[]
 for face in faces:
  if len(face)<3:continue
  norm=[sum((vv[i][(k+1)%3]-vv[j][(k+1)%3])*(vv[i][(k+2)%3]+vv[j][(k+2)%3]) for i,j in zip(face,face[1:]+face[:1])) for k in range(3)]
  axis=max(range(3),key=lambda k:abs(norm[k]));dims=[k for k in range(3) if k!=axis];p={i:[vv[i][k] for k in dims] for i in face};area=sum(p[i][0]*p[j][1]-p[j][0]*p[i][1] for i,j in zip(face,face[1:]+face[:1]))/2
  if abs(area)<1e-8:continue
  ids=face[:] if area>0 else face[::-1];part=[]
  while len(ids)>3:
   for n,bv in enumerate(ids):
    a,c=ids[n-1],ids[(n+1)%len(ids)]
    if cross(p[a],p[bv],p[c])<=1e-8:continue
    if any(all(cross(p[x],p[y],p[qv])>1e-8 for x,y in [(a,bv),(bv,c),(c,a)]) for qv in ids if qv not in (a,bv,c)):continue
    part.append([a,bv,c]);ids.pop(n);break
   else:
    n=next((n for n,bv in enumerate(ids) if abs(cross(p[ids[n-1]],p[bv],p[ids[(n+1)%len(ids)]]))<1e-8),None)
    if n is None:raise ValueError((id,'untriangulable polygon'))
    ids.pop(n)
  if len(ids)==3:part.append(ids)
  covered=sum(abs(cross(p[a],p[bv],p[c]))/2 for a,bv,c in part);assert abs(covered-abs(area))<max(.001,abs(area)*1e-6),(id,covered,area)
  tris+=part
 model={'id':id+'-plateau-lod2-2025','buildingId':E.parse(path).getroot().attrib['{'+ns['g']+'}id'],'heightM':round(partZ-ground,6),'groundM':ground,'sourceLabel':'PLATEAU '+{'13113-shibuya-ku':'渋谷区','13103-minato-ku':'港区','13104-shinjuku-ku':'新宿区'}[ward]+'2025（加工）・形状は目安','sourceUrl':'https://www.geospatial.jp/ckan/dataset/plateau-'+ward+'-2025','vertices':[[round(x,5) for x in v] for v in vv],'geoVertices':geo,'triangles':tris,'provenance':{'year':2025,'lod':2,'rescaled':False,'includesInstallations':True,'sourceGroundM':ground,'sourceTopM':top,'license':'PLATEAU Site Policy / PDL1.0 (CC BY 4.0 compatible)'}}
 models[id]=model
 parts=[{'id':'tip','name':'屋上（SKY STAGE）' if id=='shibuya-sky' else '頂部','m':partZ,'latitude':lat,'longitude':lon}]
 targets.append({'id':id,'name':name,'latitude':lat,'longitude':lon,'groundM':ground,'note':'PLATEAU LOD2の標高と輪郭。屋上付属物を含み、現地との高さ・細部の差はあります。','parts':parts})
 print(id,len(vv),len(tris),ground,partZ,lat,lon)
Path('work/four-city-models.js').write_text('/* 出典: Project PLATEAU 港区・新宿区・渋谷区2025。建物抽出・座標変換・三角形化して作成。利用条件: https://www.mlit.go.jp/plateau/site-policy/ */\n(function(g){const models='+json.dumps(models,ensure_ascii=False,separators=(',',':'))+';if(typeof module!=="undefined"&&module.exports)module.exports=models;g.SoramiCityModels=models;})(typeof globalThis!=="undefined"?globalThis:this);\n')
Path('work/four-targets.json').write_text(json.dumps(targets,ensure_ascii=False,separators=(',',':')))
