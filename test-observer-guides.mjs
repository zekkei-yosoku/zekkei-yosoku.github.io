import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),align=require('./astronotes-align.js'),bodies=require('./astronotes-bodies.js');
const target=align.targetById('skytree'),at=Date.parse('2026-11-19T14:27:00+09:00');
test('map guide positions align each named part at one fixed time and assumed height',()=>{
 for(const body of ['moon','sun'])for(const limb of ['center','onTop','behind']){
  const guides=align.observerGuides(target,body,{at,groundM:4,eyeM:1.5,limb});assert.equal(guides.length,3);
  for(const p of guides){const g=align.geometryFrom({...p,elevation:4},target,{partId:p.partId,eyeM:1.5}),s=bodies.state(body,at,{...p,elevation:5.5});
   const altitude=limb==='onTop'?s.apparentAltitude-s.angularRadius:limb==='behind'?s.apparentAltitude+s.angularRadius:s.apparentAltitude;
   const residual=align.viewProjector(g.azimuth,g.angle)(s.azimuth,altitude);
   assert(Math.hypot(...residual)<.0005);assert.equal(p.at,at);assert.equal(p.groundM,4);assert(p.approximate);
  }
 }
});
test('guides support custom part coordinates and mountain names without inventing heights',()=>{
 const custom={...target,id:'custom',parts:[{id:'roof',name:'屋上',m:220,latitude:target.latitude+.001,longitude:target.longitude+.001},{id:'unknown',name:'高さ不明'}]};
 const [guide]=align.observerGuides(custom,'moon',{at,groundM:4});assert.equal(guide.label,'屋上');assert.equal(guide.partId,'roof');
 const g=align.geometryFrom({...guide,elevation:4},custom,{partId:'roof',eyeM:1.5}),s=bodies.state('moon',at,{...guide,elevation:5.5});
 assert(Math.hypot(...align.viewProjector(g.azimuth,g.angle)(s.azimuth,s.apparentAltitude))<.0005);
 const fuji=align.observerGuides(align.targetById('fuji'),'sun',{at,groundM:100});assert(fuji.some(p=>p.label.includes('山頂')));
});
test('no false guide with unknown ground, missing names, body below horizon or impossible height',()=>{
 assert.deepEqual(align.observerGuides(target,'moon',{at}),[]);
 assert.deepEqual(align.observerGuides(target,'moon',{at,groundM:1000}),[]);
 assert.deepEqual(align.observerGuides({...target,parts:[{id:'x',m:634}]},'moon',{at,groundM:4}),[]);
 assert.deepEqual(align.observerGuides(target,'sun',{at:Date.parse('2026-11-19T00:00:00+09:00'),groundM:4}),[]);
});
