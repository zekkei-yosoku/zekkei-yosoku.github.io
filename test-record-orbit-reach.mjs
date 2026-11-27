import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const require=createRequire(import.meta.url);
const S=require('./experiments/moon-map/astronotes-shooting.js');
const Align=require('./astronotes-align.js');
const data=require('./data/candidate-surveyed-viewpoints.json');

test('the stored Arakura viewpoint and Fuji crown are beyond the two reach limits',()=>{
 const park=data.places.find(p=>p.id==='AN20261107-157');
 const obs={latitude:park.latitude,longitude:park.longitude,elevation:park.groundM};
 const fuji=Align.TARGETS.find(p=>p.id==='fuji'), center=Align.geometryFrom(obs,fuji,{eyeM:park.eyeM});
 const rim=Align.rimPoints(fuji.rim).map(p=>{
  const g=Align.geometryFrom(obs,{...fuji,...p,rim:null},{eyeM:park.eyeM,heightM:p.m});
  return [g.azimuth,g.angle];
 });
 assert(S.outlineOutsideOrbit('sun',obs.latitude,center.azimuth,rim));
 assert(S.outlineOutsideOrbit('moon',obs.latitude,center.azimuth,rim));
 assert(!S.outlineOutsideOrbit('venus',obs.latitude,center.azimuth,rim));
});

test('Sun can be excluded independently of Moon, and a reachable boundary stays in the scan',()=>{
 assert(S.outlineOutsideOrbit('sun',35,55,[[55,4],[56,4.5]]));
 assert(!S.outlineOutsideOrbit('moon',35,55,[[55,4],[56,4.5]]));
 assert(!S.outlineOutsideOrbit('sun',35,120,[[112,11],[122,12]]));
 assert(!S.outlineOutsideOrbit('moon',35,205,[[205,9],[205,NaN]]));
});

test('a point target can be ruled out for a whole line or area, not only its anchor',()=>{
 const farSouth={latitude:34.8,longitude:139.8,m:850};
 const line=[{latitude:35.5,longitude:139.79},{latitude:35.51,longitude:139.81}];
 const area=[...line,{latitude:35.5,longitude:139.82}];
 for(const shape of [line,area])for(const body of ['sun','moon']){
  assert(S.pointOutsideOrbit(body,shape,-1000,10700,farSouth));
 }
 const spread=[...line,{latitude:34.82,longitude:139.93}];
 assert(!S.pointOutsideOrbit('moon',spread,-1000,10700,farSouth));
 assert(!S.pointOutsideOrbit('moon',line,NaN,10700,farSouth));
});
