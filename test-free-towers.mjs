import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const A=require('./sorami-align.js'),T=require('./sorami-terrain.js');
function view(id,bearing=0){const t=A.targetById(id),obs={...T.destination(t.latitude,t.longitude,bearing,2),elevation:10};return {t,obs,o:A.towerOutline(obs,t)};}
test('無料2塔は方位で形が変わり、公表高さを保つ',()=>{
 for(const id of ['tokyotower','skytree']){
  const a=view(id,0),b=view(id,45),width=o=>Math.max(...o.points.map(p=>p[0]))-Math.min(...o.points.map(p=>p[0]));
  assert.notEqual(width(a.o),width(b.o));assert.equal(a.o.modelId,id+'-drawing-envelope-v'+(id==='skytree'?3:2));
  assert.equal(a.o.polygons,a.o.hitPolygons);assert.ok(a.o.points.every(p=>p.every(Number.isFinite)));
  assert.ok(a.o.sourceLabel.includes('推定'));assert.ok(a.o.approximate);
  const expected=A.geometryFrom(a.obs,a.t).angle;assert.ok(Math.abs(a.o.topAngle-expected)<1e-9);
 }
 assert.equal(A.geometryFrom(view('tokyotower').obs,A.targetById('tokyotower'),{partId:'main'}).topM,148.389);
 assert.equal(A.geometryFrom(view('tokyotower').obs,A.targetById('tokyotower'),{partId:'top'}).topM,247.55);
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

test('図面の正方形脚と円形移行を実頂点で確認する',()=>{
 const models=require('./sorami-tower-models.js'),t=models.tokyotower,s=models.skytree;
 const centre=v=>[0,1,2].map(k=>v.reduce((sum,p)=>sum+p[k],0)/v.length);
 const feet=t.faces.slice(0,4).map(f=>centre(f.slice(0,4).map(i=>t.vertices[i])));
 const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
 for(let i=0;i<4;i++)assert.ok(Math.abs(dist(feet[i],feet[(i+1)%4])-80)<.001,'脚間は四辺とも80m');
 assert.ok(Math.abs(dist(feet[0],feet[2])-80*Math.SQRT2)<.001,'正方形の対角');
 const centres=[];for(const f of s.faces){if(f.length!==8)continue;for(const half of [f.slice(0,4),f.slice(4)]){const c=centre(half.map(i=>s.vertices[i]));if(Math.abs(c[2]-315)<1e-4)centres.push(c);}}
 assert.ok(centres.length>=24);for(const c of centres)assert.ok(Math.abs(Math.hypot(c[0],c[1])-16)<.001,'315mでは直径32mの円');
 const mid=[];for(const f of s.faces){if(f.length!==8)continue;for(const half of [f.slice(0,4),f.slice(4)]){const c=centre(half.map(i=>s.vertices[i]));if(Math.abs(c[2]-150)<1e-4)mid.push(Math.hypot(c[0],c[1]));}}
 const base=68/Math.sqrt(3);assert.ok(Math.max(...mid)<base+(16-base)*150/315-1,'角は線形より内にそる');assert.ok(Math.min(...mid)>base/2+(16-base/2)*150/315+1,'辺中央は線形より外にむくる');
 const groundFeet=s.faces.filter(f=>f.length===8).map(f=>centre(f.slice(0,4).map(i=>s.vertices[i]))).filter(c=>Math.abs(c[2])<1e-4);
 assert.equal(new Set(groundFeet.map(c=>c.slice(0,2).map(x=>x.toFixed(3)).join(','))).size,9,'地上の端点は3脚群×3点（24脚にしない）');
 assert.ok(!('nominalVisitorDeckAglM' in t.provenance),'公称値を床の地上高と断定しない');
 const main=A.targetById('tokyotower').parts.find(p=>p.id==='main');assert.match(main.name,/上端/);
 assert.ok(T.decksFor('東京タワー')[0].aglM < main.m-A.targetById('tokyotower').groundM,'観測床は照準用屋根より低い');
});
test('アーチは傾斜脚の構面に収まり、外側に浮かない',()=>{
 const m=require('./sorami-tower-models.js').tokyotower,rot=m.provenance.rotationEastNorthCCWDeg*Math.PI/180;
 const centres=m.faces.filter(f=>f.length===8).map(f=>[0,1,2].map(k=>f.reduce((s,i)=>s+m.vertices[i][k],0)/f.length)).filter(c=>c[2]>39&&c[2]<40);
 assert.equal(centres.length,8,'4面×アーチ頂点の前後2材');
 for(const [x,y] of centres){const east=x*Math.cos(rot)+y*Math.sin(rot),north=-x*Math.sin(rot)+y*Math.cos(rot);assert.ok(Math.max(Math.abs(east),Math.abs(north))<24,'高さ40m付近のアーチが半幅40mの外側に残らない');}
});

test('スカイツリー天望デッキは上へ広がる逆円錐と広い上端',()=>{
 const m=require('./sorami-tower-models.js').skytree,r=z=>m.vertices.filter(v=>Math.abs(v[2]-z)<.001).map(v=>Math.hypot(v[0],v[1]));
 assert.ok(Math.max(...r(375))>28.9);assert.ok(Math.max(...r(334))<17);assert.ok(Math.max(...r(350))<23);assert.ok(Math.max(...r(371))>29);assert.match(m.provenance.deckProfileReference,/photo/);
});
