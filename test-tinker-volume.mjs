import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),A=require('./sorami-align.js'),T=require('./sorami-terrain.js');
const t=A.targetById('tinkerbell'),m=A.TINKERBELL_MODEL,ref=A.TOWER_SHAPES.tinkerbell.referenceView.observer;
const width=o=>Math.max(...o.hitPoints.map(p=>p[0]))-Math.min(...o.hitPoints.map(p=>p[0]));
test('像は別方位で厚みと翼の形が変わり、背景は接触対象にしない',()=>{
 const b=T.bearing(t.latitude,t.longitude,ref.latitude,ref.longitude),views=[0,90,180,270].map(d=>A.towerOutline({...T.destination(t.latitude,t.longitude,b+d,1),elevation:2.8},t));
 assert.ok(width(views[0])>width(views[1])*2);assert.ok(width(views[1])>0);
 for(const o of views){assert.equal(o.modelId,'tinkerbell-photo-volume-v1');assert.ok(o.polygons.length>o.hitPolygons.length);assert.ok(o.hitPolygons.length>20);assert.ok(o.points.every(p=>p.every(Number.isFinite)));}
 assert.equal(m.heightMode,'translate-top');assert.equal(m.provenance.depthMeasured,false);
});
test('写真の像と杖の輪郭を保ち、凹部を凸包で埋めない',()=>{
 const poly=A.TOWER_SHAPES.tinkerbell.outline,o=A.towerOutline(ref,t),d=o.distanceKm*1000,eye=ref.elevation+ref.eyeM;
 const B=require('./sorami-astro.js'),P=A.viewProjector(o.azimuth,o.topAngle),polys=o.hitPolygons.map(p=>p.map(q=>P(...q)));
 for(const [x,depth] of poly.filter(p=>p[1]<=2.5)){
  const q=P(o.azimuth+Math.atan(x/d)*180/Math.PI,B.targetElevationAngle(o.distanceKm,eye,t.parts[0].m-depth));
  assert.ok(Math.min(...polys.map(p=>A.polygonDistance(q,p)))<.0002,'写真輪郭の最大角度差');
 }
 const q=P(o.azimuth+Math.atan(.9/d)*180/Math.PI,B.targetElevationAngle(o.distanceKm,eye,t.parts[0].m-.5));
 assert.ok(Math.min(...polys.map(p=>A.polygonDistance(q,p)))>.005,'顔と翼の上の空白');
});
test('高さを変えても像を伸縮せず、写真参照情報を保持',()=>{
 const o=A.towerOutline(ref,t),edit=A.towerOutline(ref,t,{heightM:60});
 assert.ok(Math.abs(width(o)-width(edit))<1e-9);assert.ok(edit.topAngle>o.topAngle);
 assert.equal(A.TOWER_SHAPES.tinkerbell.referenceView.photoAt,'2024-11-29T04:52:23+09:00');
 assert.ok(m.solids.slice(0,m.hitSolidCount).flat().every(v=>v[2]>50));
});

test('像の輪郭生成に失敗しても他目標と旧2D判定を維持する',async()=>{
 const {readFileSync}=await import('node:fs'),vm=await import('node:vm');
 const source=readFileSync(new URL('./sorami-align.js',import.meta.url),'utf8').replace('function triangulate(poly){','function triangulate(poly){throw Error("injected contour failure");');
 const c=vm.createContext({require});vm.runInContext(source,c);assert.equal(c.SoramiAlign.TINKERBELL_MODEL,null);
 const o=c.SoramiAlign.towerOutline(ref,t);assert.equal(o.modelId,'tinkerbell-reference-2d-fallback');assert.ok(o.hitPoints.length>20);
 assert.ok(c.SoramiAlign.towerOutline(ref,c.SoramiAlign.targetById('skytree')).polygons.length>0);
});
