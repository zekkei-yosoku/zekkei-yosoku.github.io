import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), A=require('./sorami-align.js'), T=require('./sorami-terrain.js');
const target=A.targetById('tower-terror'),model=A.TERROR_MODEL;
test('タワー・オブ・テラーを位置・標高・59mの目標として選択できる',()=>{
 assert.equal(target.name,'タワー・オブ・テラー');assert.equal(target.groundM,4.8);assert.equal(target.parts[0].m,63.8);
 assert.equal(model.heightM,59);assert.equal(model.provenance.depthMeasured,false);
 assert.ok(model.solids.length>100);
});
test('屋根の谷を凸包で埋めず、船を判定へ含めない',()=>{
 const obs={...T.destination(target.latitude,target.longitude,model.referenceBearing,12),elevation:20};
 const o=A.towerOutline(obs,target);assert.equal(o.modelId,'tower-terror-photo-volume-v2');
 const centre=o.azimuth, top=o.topAngle, R=Math.PI/180;
 // The roof valley between left roof and centre gable is outside; lower facade is inside.
 const ppm=8.1,fx=12e3*ppm;
 const distance=q=>Math.min(...o.polygons.map(p=>A.polygonDistance(q,p)));
 const point=(x,y)=>[centre+Math.atan((x-610)/fx)/R,top-Math.atan((y-1018)/fx)/R];
 assert.ok(distance(point(570,1050))>0);
 assert.ok(distance(point(610,1145))<=0);
 assert.ok(distance(point(960,1290))>0);
 assert.ok(distance(point(610,1488))<=0);
});
test('全方位と近遠距離、高さ変更で有限の輪郭・判定を共有する',()=>{
 for(let bearing=0;bearing<360;bearing+=15)for(const km of [.3,12,30])for(const h of [null,70]){
  const obs={...T.destination(target.latitude,target.longitude,bearing,km),elevation:2};
  const o=A.towerOutline(obs,target,{heightM:h});assert.ok(o.polygons.length>100);
  assert.ok(o.points.every(p=>p.every(Number.isFinite)));assert.deepEqual(o.hitPolygons,o.polygons);
  assert.ok(o.topAngle>o.baseAngle);
 }
});

test('主塔・低層部を分け、横からの本体が薄い板にならない',()=>{
 const widthAt=z=>{const points=model.solids.flat().filter(p=>Math.abs(p[2]-z)<1e-6&&p[0]>-16.5);return Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1]));};
 assert.equal(widthAt(38),32);assert.equal(widthAt(49),32);
 assert.ok(model.solids.flat().every(p=>p[2]>=0&&p[2]<=59));
 const side={...T.destination(target.latitude,target.longitude,model.referenceBearing+90,12),elevation:20};
 const o=A.towerOutline(side,target),range=Math.max(...o.points.map(p=>p[0]))-Math.min(...o.points.map(p=>p[0]));
 assert.ok(range>.15,'32m main block must produce a visible side silhouette at 12km');
});

test('低層の小塔を薄く保ち、生成原本・埋込体積・凸断面を照合',()=>{
 const json=JSON.parse(fs.readFileSync(new URL('./tools/タワー・オブ・テラー_写真輪郭.json',import.meta.url),'utf8'));
 assert.deepEqual(model,json);
 let area=0;const cross=(a,b,c)=>(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
 for(const s of model.solids){
  assert.equal(s.length%2,0);const half=s.length/2,front=s.slice(0,half);
  for(let i=0;i<half;i++){assert.equal(s[i][0],s[i+half][0]);assert.equal(s[i][2],s[i+half][2]);assert.ok(s[i+half][1]>s[i][1]);}
  const signs=front.map((p,i)=>cross(p,front[(i+1)%half],front[(i+2)%half])).filter(x=>Math.abs(x)>1e-5);
  assert.ok(signs.every(x=>x>0)||signs.every(x=>x<0),'each x-z section must be convex');
  area+=Math.abs(front.reduce((a,p,i)=>a+p[0]*front[(i+1)%half][2]-front[(i+1)%half][0]*p[2],0))/2;
  if(front.every(p=>p[0]<=-16.5&&p[2]>=25.5&&p[2]<=38)||front.every(p=>p[0]<=-15.3&&p[2]>=25.5&&p[2]<=36.5))for(let i=0;i<half;i++)assert.ok(Math.abs(s[i+half][1]-s[i][1]-3.5)<1e-6);
 }
 const poly=model.provenance.photoOutlinePixels.map(([x,y])=>[(x-610)/8.1,Math.max(0,59-(y-1018)/8.1)]);
 const expected=Math.abs(poly.reduce((a,p,i)=>a+p[0]*poly[(i+1)%poly.length][1]-poly[(i+1)%poly.length][0]*p[1],0))/2;
 assert.ok(Math.abs(area-expected)<.001,'total section area must preserve the photo profile');
});

test('主塔壁の横の小塔は主塔32m厚へ含めない',()=>{
 const small=model.solids.filter(s=>s.slice(0,s.length/2).some(p=>p[0]>-16.5&&p[0]<-15.3&&p[2]>28&&p[2]<31));
 assert.ok(small.length>0);
 for(const s of small){const n=s.length/2;for(let i=0;i<n;i++)assert.ok(Math.abs(s[i+n][1]-s[i][1]-3.5)<1e-6);}
});
