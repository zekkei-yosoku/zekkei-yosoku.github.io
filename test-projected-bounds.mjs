import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),A=require('./astronotes-align.js'),T=require('./astronotes-terrain.js');
// Independent oracle: the photo volumes are triangular prisms / boxes.
// Use their actual two face rings and corresponding connecting edges, rather
// than the renderer's unordered-convex-solid pair traversal.
function upperVolumeBase(obs,target,heightM){
 const m=A.TINKERBELL_MODEL,top=heightM??target.parts[0].m-target.groundM;
 const cutoff=Math.max(0,top-m.viewFromTopM),ref=m.calibration.observer;
 const bearing=T.bearing(target.latitude,target.longitude,ref.latitude,ref.longitude),rad=Math.PI/180;
 const axis=(bearing-90)*rad,depth=(bearing+180)*rad;
 const B=require('./astronotes-astro.js'),ATM=require('./astronotes-atmosphere.js');
 const project=p=>B.targetElevationAngle(T.distanceKm(obs.latitude,obs.longitude,p.latitude,p.longitude),(obs.elevation??0)+1.5,target.groundM+p.h,{k:ATM.targetK()});
 let minimum=Infinity;
 for(const solid of m.solids){
  assert.ok(solid.length===6||solid.length===8,'oracle requires prism/box topology');
  const n=solid.length/2,vertices=solid.map(([x,y,z])=>{
   const east=x*Math.sin(axis)+y*Math.sin(depth),north=x*Math.cos(axis)+y*Math.cos(depth);
   return {...T.destination(target.latitude,target.longitude,Math.atan2(east,north)/rad,Math.hypot(east,north)/1000),h:m.groundAnchored&&z===0?0:z+top-m.heightM};
  });
  for(const v of vertices)if(v.h>=cutoff)minimum=Math.min(minimum,project(v));
  const edges=[];
  for(let i=0;i<n;i++)edges.push([i,(i+1)%n],[i+n,(i+1)%n+n],[i,i+n]);
  for(const [i,j]of edges){
   const a=vertices[i],b=vertices[j];
   if((a.h-cutoff)*(b.h-cutoff)>=0)continue;
   const f=(cutoff-a.h)/(b.h-a.h);
   minimum=Math.min(minimum,project({latitude:a.latitude+f*(b.latitude-a.latitude),longitude:a.longitude+f*(b.longitude-a.longitude),h:cutoff}));
  }
 }
 return minimum;
}

test('upper-only framing includes prism connecting-edge intersections, near/far and after height edits',()=>{
 const t=A.targetById('tinkerbell');
 for(const distance of [.05,.3])for(let bearing=0;bearing<360;bearing+=15)for(const heightM of [null,40,70]){
  const obs={...T.destination(t.latitude,t.longitude,bearing,distance),elevation:5};
  const expected=upperVolumeBase(obs,t,heightM),actual=A.towerOutline(obs,t,{heightM}).viewBaseAngle;
  assert.ok(Math.abs(actual-expected)<1e-8,`${distance}km ${bearing}deg height=${heightM}: ${actual} vs ${expected}`);
 }
 const obs={...T.destination(t.latitude,t.longitude,120,.05),elevation:5};
 assert.ok(upperVolumeBase(obs,t,null)<24,'regression: the omitted connecting edge gives a lower bound than 25 degrees');
});
test('近遠24方位と高所から、全建物の実投影輪郭が表示上下端に収まる',()=>{
 for(const t of A.TARGETS.filter(t=>t.id!=='fuji'))for(const d of [.3,5])for(let b=0;b<360;b+=15){
  const obs={...T.destination(t.latitude,t.longitude,b,d),elevation:b===180?400:5};
  const g=A.geometryFrom(obs,t),o=A.towerOutline(obs,t);
  assert.ok(o.points.length>0,t.id);
  for(const p of o.points)assert.ok(p[1]>=o.baseAngle-1e-10&&p[1]<=o.topAngle+1e-10,t.id+' '+b);
  assert.deepEqual(A.geometryFrom(obs,t),g,'輪郭生成は照準条件を変更しない');
  assert.ok(o.viewBaseAngle>=o.baseAngle-1e-10&&o.viewBaseAngle<=o.topAngle+1e-10);
 }
});
test('森JPタワーの近距離では、中心照準より高く見える屋根の端まで表示する',()=>{
 const t=A.targetById('azabudai-hills'),obs={...T.destination(t.latitude,t.longitude,75,.3),elevation:5};
 const o=A.towerOutline(obs,t),g=A.geometryFrom(obs,t);
 assert.ok(o.topAngle-g.angle>4);
 assert.equal(o.modelId,'azabudai-hills-plateau-lod2-2025');
});
test('ティンカーベルは高さを移動しても上部だけの表示と接触対象を保つ',()=>{
 const t=A.targetById('tinkerbell');
 for(const heightM of [null,40,70])for(const b of [0,90,180,270]){
  const obs={...T.destination(t.latitude,t.longitude,b,.3),elevation:5},o=A.towerOutline(obs,t,{heightM});
  assert.ok(o.viewBaseAngle>o.baseAngle+.1);
  assert.ok(o.hitPolygons.length<o.polygons.length);
  assert.equal(o.topAngle,o.points.reduce((a,p)=>Math.max(a,p[1]),-Infinity));
 }
});
