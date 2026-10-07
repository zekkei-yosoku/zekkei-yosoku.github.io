import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const A=require('./sorami-align.js'),T=require('./sorami-terrain.js');
function view(id,bearing=0){const t=A.targetById(id),obs={...T.destination(t.latitude,t.longitude,bearing,2),elevation:10};return {t,obs,o:A.towerOutline(obs,t)};}
test('無料2塔は方位で形が変わり、公表高さを保つ',()=>{
 for(const id of ['tokyotower','skytree']){
  const a=view(id,0),b=view(id,45),width=o=>Math.max(...o.points.map(p=>p[0]))-Math.min(...o.points.map(p=>p[0]));
  assert.notEqual(width(a.o),width(b.o));assert.equal(a.o.modelId,id+'-free-lattice-v1');
  assert.equal(a.o.polygons,a.o.hitPolygons);assert.ok(a.o.points.every(p=>p.every(Number.isFinite)));
  assert.ok(a.o.sourceLabel.includes('推定'));assert.ok(a.o.approximate);
  const expected=A.geometryFrom(a.obs,a.t).angle;assert.ok(Math.abs(a.o.topAngle-expected)<1e-9);
 }
 assert.equal(A.geometryFrom(view('tokyotower').obs,A.targetById('tokyotower'),{partId:'main'}).topM,168);
 assert.equal(A.geometryFrom(view('tokyotower').obs,A.targetById('tokyotower'),{partId:'top'}).topM,268);
});
test('格子の内部に隙間を残し、部材内は接触する',()=>{
 for(const id of ['tokyotower','skytree']){
  const {obs,t,o}=view(id,45),P=A.viewProjector(o.azimuth,(o.baseAngle+o.topAngle)/2);
  const polys=o.hitPolygons.map(p=>p.map(q=>P(...q))),whole=A.convexHull(o.points.map(q=>P(...q)));
  let gap=false;
  for(let h=60;h<110&&!gap;h+=3){
   const alt=A.geometryFrom(obs,{...t,parts:[{m:t.groundM+h}]}).angle;
   for(let w=5;w<25;w+=1){const q=P(o.azimuth+Math.atan(w/2000)*180/Math.PI,alt);
    if(A.polygonDistance(q,whole)===0&&Math.min(...polys.map(p=>A.polygonDistance(q,p)))>.006){gap=true;break;}
   }
  }
  assert.ok(gap,id+'の凸包内にも空が見える');
  const p=polys[Math.floor(polys.length/2)],c=[0,1].map(i=>p.reduce((s,q)=>s+q[i],0)/p.length);
  assert.equal(Math.min(...polys.map(p=>A.polygonDistance(c,p))),0,id+'の鉄骨には接触する');
 }
});
test('高さ編集・連続検索・他の3Dを維持する',()=>{
 for(const id of ['tokyotower','skytree']){
  const {obs,t}=view(id);const o=A.towerOutline(obs,t,{heightM:100});
  assert.ok(Math.abs(o.topAngle-A.geometryFrom(obs,{...t,parts:[{m:t.groundM+100}]}).angle)<1e-9);
  const start=performance.now();const events=A.dailyView(obs,t,'moon',Date.parse('2026-11-04T00:00:00+09:00'));
  assert.ok(Array.isArray(events));assert.ok(performance.now()-start<2500,id+'の検索時間');
 }
 for(const id of ['tocho-building','cinderella'])assert.ok(view(id).o.polygons.length>0);
});
