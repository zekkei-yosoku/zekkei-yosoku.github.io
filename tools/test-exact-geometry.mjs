import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {patchExactGeometry} from './build-exact-geometry.mjs';
import {patchAlignHeightGeometry} from './build-record-height-geometry.mjs';
const require=createRequire(new URL('../astronotes-align.js',import.meta.url));
const source=readFileSync(new URL('../astronotes-align.js',import.meta.url),'utf8'),terrain=require('./astronotes-terrain.js');
function load(code){
 let inverses=0;const tracked={...terrain};
 for(const name of ['inverse','distanceKm','bearing'])tracked[name]=(...args)=>{inverses++;return terrain[name](...args);};
 const context=vm.createContext({require,AstroNotesTerrain:tracked});vm.runInContext(patchAlignHeightGeometry(code),context);
 return {api:context.AstroNotesAlign,count:()=>inverses,reset:()=>{inverses=0;}};
}
const old=load(source),current=load(patchExactGeometry(source));
function exact(a,b,path='result'){
 if(b!==null&&typeof b==='object'){
  assert.deepEqual(Reflect.ownKeys(a),Reflect.ownKeys(b),path+' keys');
  for(const k of Reflect.ownKeys(b))exact(a[k],b[k],path+'.'+String(k));
 }else assert(Object.is(a,b),path+': '+a+' !== '+b);
}

test('patch consumes the unchanged inverse function and fails on drift',()=>{
 assert.throws(()=>patchExactGeometry(patchExactGeometry(source)),/boundary changed/);
 for(const coords of [[35.58386,139.56853,35.71006,139.8107],[0,0,0,0],[-89,-179.9,89,179.9],[0,0,0,180],[35,139,35.000000001,139.000000001]]){
  const both=terrain.inverse(...coords);assert(Object.is(both.km,terrain.distanceKm(...coords)));assert(Object.is(both.azimuth,terrain.bearing(...coords)));
 }
});

test('aim geometry remains exact across target parts, eye heights, dateline and antipodes',()=>{
 const targets=['skytree','tokyotower','tocho-building','fuji'].map(id=>old.api.targetById(id));
 const observers=[{latitude:35.58386,longitude:139.56853,elevation:87.2},{latitude:0,longitude:0,elevation:0},{latitude:-35.71006,longitude:-40.1893,elevation:-300},{latitude:89,longitude:179.9,elevation:3776}];
 for(const target of targets)for(const observer of observers)for(const eyeM of [0,1.5,20,150,700])for(const partId of [null,'__whole',...target.parts.slice(0,2).map(p=>p.id)]){
  exact(current.api.geometryFrom(observer,target,{eyeM,partId}),old.api.geometryFrom(observer,target,{eyeM,partId}));
 }
});

test('all outline vertices and convex faces retain their exact values and order',()=>{
 const ids=['skytree','tokyotower','tocho-building','cinderella','tower-terror','tinkerbell'];
 for(const id of ids){
  const target=old.api.targetById(id);assert(target,id);
  for(const [bearing,km,elevation,eyeM]of [[15,.3,5,1.5],[165,3,87.2,150],[285,30,300,20]]){
   const observer={...terrain.destination(target.latitude,target.longitude,bearing,km),elevation};
   for(const opts of [{eyeM},{eyeM,heightM:100}])exact(current.api.towerOutline(observer,target,opts),old.api.towerOutline(observer,target,opts),id);
  }
 }
 const target={id:'custom-schematic',latitude:35.7,longitude:139.8,groundM:5,heightM:100,parts:[{id:'tip',m:105}]},observer={latitude:35.6,longitude:139.7,elevation:20};
 exact(current.api.towerOutline(observer,target),old.api.towerOutline(observer,target));
});

test('mountain rim lookup preserves interpolation and exact slopes',()=>{
 const target=old.api.targetById('fuji');assert(target.rim,'fixture has a rim');
 for(const observer of [{latitude:35.36,longitude:139.4,elevation:1.5},{latitude:35.2,longitude:138.5,elevation:150}]){
  const before=old.api.rimOutline(observer,target),after=current.api.rimOutline(observer,target);
  for(const key of ['azimuth','min','max'])exact(after[key],before[key]);
  for(let i=0;i<=100;i++){const az=before.min+(before.max-before.min)*i/100;exact(after.at(az),before.at(az));}
  exact(after.at(before.min-1),before.at(before.min-1));exact(after.at(before.max+1),before.at(before.max+1));
 }
});

test('prepared daily candidates remain bit-identical for Sun, Moon and height changes',()=>{
 const observer={latitude:35.58386,longitude:139.56853,elevation:87.2},day=Date.parse('2026-11-25T00:00:00+09:00');
 for(const id of ['skytree','tokyotower','tocho-building'])for(const body of ['sun','moon'])for(const eyeM of [1.5,150]){
  const target=old.api.targetById(id),opts={partId:'__whole',eyeM},before=old.api.prepareDailyView(observer,target,body,opts),after=current.api.prepareDailyView(observer,target,body,opts);
  exact(after.heightGeometry,before.heightGeometry);exact(after(day),before(day));
  exact(after(day,day+12*3600000+.125),before(day,day+12*3600000+.125));
 }
});

test('Skytree cold preparation reduces inverse calls without changing a single vertex',t=>{
 const observer={latitude:35.58386,longitude:139.56853,elevation:87.2},target=old.api.targetById('skytree');
 const run=loaded=>{loaded.reset();const start=performance.now();const outline=loaded.api.towerOutline(observer,target,{eyeM:1.5});return {outline,ms:Math.round(performance.now()-start),inverses:loaded.count()};};
 const before=run(old),after=run(current);exact(after.outline,before.outline);assert(after.inverses<before.inverses*.6);
 t.diagnostic(JSON.stringify({beforeMs:before.ms,afterMs:after.ms,beforeInverses:before.inverses,afterInverses:after.inverses}));
});
