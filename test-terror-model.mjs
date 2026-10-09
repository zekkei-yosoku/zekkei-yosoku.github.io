import test from 'node:test';
import assert from 'node:assert/strict';
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
 const o=A.towerOutline(obs,target);assert.equal(o.modelId,'tower-terror-photo-volume-v1');
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
