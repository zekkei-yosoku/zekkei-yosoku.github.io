import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const original=JSON.parse(readFileSync(new URL('./tools/data/city-refinement-source.json',import.meta.url)));
const candidate=require(resolve(process.env.ASTRONOTES_MODEL_CANDIDATE||'./sorami-city-models.js'));
const A=require('./sorami-align.js'),T=require('./sorami-terrain.js');
globalThis.SoramiCityModels=candidate;

function section(m,z){
 const result=[];
 for(const face of m.triangles)for(let j=0;j<3;j++){
  const a=m.vertices[face[j]],b=m.vertices[face[(j+1)%3]];
  if((a[2]<=z&&b[2]>z)||(b[2]<=z&&a[2]>z)){
   const t=(z-a[2])/(b[2]-a[2]);result.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);
  }
 }
 return result;
}

test('補正モデルは原典・推定範囲を保持し、標高と照準高さを動かさない',()=>{
 for(const id of Object.keys(original)){
  const m=candidate[id],b=original[id];
  if(id==='azabudai-hills'){
   assert.equal(m.geometryRevision,'20261019-curves-v2');
   assert.equal(m.provenance.accuracyVerifiedBySurvey,false);
   assert.ok(m.provenance.refinement.estimated.length>0);
  }else assert.deepEqual(m,b,'渋谷は全オブジェクトを原典へ復元する');
  for(const k of ['heightM','groundM','buildingId','sourceUrl'])assert.equal(m[k],b[k]);
  assert.equal(Math.max(...m.vertices.map(p=>p[2])),Math.max(...b.vertices.map(p=>p[2])));
  assert.equal(m.vertices.length,m.geoVertices.length);
  assert.ok(m.vertices.every(p=>p.length===3&&p.every(Number.isFinite)));
  assert.ok(m.triangles.every(f=>f.length===3&&new Set(f).size===3&&f.every(i=>i>=0&&i<m.vertices.length)));
  assert.ok(m.triangles.length<150000);
 }
});

test('森JPの曲線分割後も全辺が2面を共有し、隙間を作らない',()=>{
 const m=candidate['azabudai-hills'],edges=new Map();
 for(const face of m.triangles)for(let i=0;i<3;i++){
  const a=face[i],b=face[(i+1)%3],key=a<b?`${a}:${b}`:`${b}:${a}`;
  edges.set(key,(edges.get(key)||0)+1);
 }
 assert.ok([...edges.values()].every(n=>n===2));
 const sampling=m.provenance.refinement.surfaceSampling;
 assert.ok(sampling.maxNormalizedStep<=1.000001);
 assert.ok(sampling.maxSampledEdgeErrorM<=.050001);

});

test('森JPの縦輪郭は屋上を固定しながら中間で膨らみ、GIS頂点も追随する',()=>{
 const m=candidate['azabudai-hills'],b=original['azabudai-hills'],angle=-26.565051177*Math.PI/180;
 const width=(model,z)=>{const q=section(model,z).map(p=>p[0]*Math.cos(angle)+p[1]*Math.sin(angle));return Math.max(...q)-Math.min(...q);};
 assert.ok(width(m,95)-width(b,95)>2.5,'中間の曲線が実ジオメトリに入る');
 assert.ok(width(m,95)>width(m,280)+1,'上層に向かって絞る');
 assert.ok(Math.abs(width(m,328)-width(b,328))<.001,'屋上を維持');
 for(let i=0;i<m.vertices.length;i+=19){
  const [x,y]=m.vertices[i],[lat,lon]=m.geoVertices[i];
  const j=0,[bx,by]=b.vertices[j],[blat,blon]=b.geoVertices[j];
  assert.ok(Math.abs((lat-blat)*111320-(y-by))<.002);
  assert.ok(Math.abs((lon-blon)*111320*Math.cos(lat*Math.PI/180)-(x-bx))<.003);
 }
});

test('渋谷の推定楕円補正は不採用とし、頂点・面・GIS・出典を完全に原典へ戻す',()=>{
 assert.deepEqual(candidate['shibuya-sky'],original['shibuya-sky']);
 assert.equal(A.targetById('shibuya-sky').parts[0].m,243.637);
});

test('24方位×近/遠距離の表示・接触が同じポリゴンを使い、日別探索が予算内',()=>{
 for(const id of Object.keys(original)){
  const target=A.targetById(id);
  for(const distance of [.3,5])for(let bearing=0;bearing<360;bearing+=15){
   const observer={...T.destination(target.latitude,target.longitude,bearing,distance),elevation:20};
   const outline=A.towerOutline(observer,target);
   assert.equal(outline.polygons,outline.hitPolygons);
   assert.ok(outline.points.length>0&&outline.points.every(p=>p.every(Number.isFinite)));
  }
  const observer={...T.destination(target.latitude,target.longitude,250,5),elevation:10};
  const start=performance.now();
  assert.ok(Array.isArray(A.dailyView(observer,target,'moon',Date.parse('2026-11-04T00:00:00+09:00'))));
  assert.ok(performance.now()-start<3500);
 }
});
