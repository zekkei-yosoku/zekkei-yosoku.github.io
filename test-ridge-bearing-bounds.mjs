import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const G=require('./astronotes-terrain.js'),A=require('./astronotes-align.js');
const Astro=require('./astronotes-astro.js'),Air=require('./astronotes-atmosphere.js');
const rad=Math.PI/180,difference=(a,b)=>Math.abs(((a-b+540)%360)-180);
const spherical=(a,b)=>{
 const p1=a.latitude*rad,p2=b.latitude*rad,L=(b.longitude-a.longitude)*rad;
 return ((Math.atan2(Math.sin(L)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(L))/rad)%360+360)%360;
};
function region(points){return G.prepareInverseRegion(points);}
function bounds(a,b){return region([a])?.bearingIntervalsTo(region([b]));}
const contains=(intervals,value)=>intervals.some(p=>difference(p.azimuth,value)<=p.marginDeg);
function original(observer,anchor){return A.geometryFrom(observer,{...anchor,rim:null,parts:[{id:'ridge',m:anchor.heightM}]},{heightM:anchor.heightM,eyeM:observer.eyeM??1.5});}

test('conservative bearing intervals contain the unchanged finite inverse and spherical fallback',()=>{
 let seed=0x8d452f17;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
 let checked=0,narrow=0;
 for(let i=0;i<20000;i++){
  const a={latitude:(random()<.5?-1:1)*(1+84*random()),longitude:-180+360*random()};
  const b={latitude:-85+170*random(),longitude:-180+360*random()},bound=bounds(a,b);
  if(!bound)continue;checked++;
  const result=G.inverse(a.latitude,a.longitude,b.latitude,b.longitude);
  assert(contains(bound,result.azimuth),JSON.stringify({a,b,bound,result}));
  assert(contains(bound,spherical(a,b)));
  if(bound.every(p=>p.marginDeg<.01))narrow++;
 }
 assert(checked>9000&&narrow>9000,{checked,narrow});
});

test('dateline, north/south wrap, equal longitude and hemisphere boundary stay conservative',()=>{
 const pairs=[[[35,179.9],[35,-179.9]],[[35,-179.9],[35,179.9]],[[35,139],[36,139]],[[35,139],[34,139]],
  [[-35,139],[-36,139]],[[35,0],[0,89.9]],[[1,0],[-1,89]],[[85,0],[84,90]],[[35,0],[35,179]]];
 for(const [[lat,lon],[lat2,lon2]]of pairs){
  const a={latitude:lat,longitude:lon},b={latitude:lat2,longitude:lon2},bound=bounds(a,b);
  if(!bound)continue;
  assert(contains(bound,G.inverse(lat,lon,lat2,lon2).azimuth));
 }
 assert.equal(bounds({latitude:35,longitude:0},{latitude:0,longitude:90}),null);
 assert.equal(bounds({latitude:35,longitude:0},{latitude:0,longitude:90.1}),null);
});

test('convergent and spherical intervals remain separate without filling the gap',()=>{
 const a={latitude:35,longitude:139},b={latitude:35.36,longitude:138.727},intervals=bounds(a,b);
 assert.equal(intervals.length,2);
 assert(intervals.every(p=>p.marginDeg<.001));
 assert(contains(intervals,G.inverse(a.latitude,a.longitude,b.latitude,b.longitude).azimuth));
 assert(contains(intervals,spherical(a,b)));
 assert(!contains(intervals,(intervals[0].azimuth+intervals[1].azimuth)/2));
});

test('coincident, short, equatorial, polar, antipodal and invalid inputs request the original path',()=>{
 const a={latitude:35,longitude:139};
 assert.equal(bounds(a,a),null);
 assert.equal(bounds(a,{latitude:35.000001,longitude:139}),null);
 assert.equal(bounds({latitude:.999,longitude:139},{latitude:35,longitude:140}),null);
 assert.equal(bounds(a,{latitude:-35,longitude:-41}),null);
 for(const [lat,lon]of [[90,0],[-90,0],[86,0]])assert.equal(bounds(a,{latitude:lat,longitude:lon}),null);
 for(const [lat,lon]of [[91,0],[-91,0],[35,181],[NaN,0],[35,Infinity]])assert.equal(region([{latitude:lat,longitude:lon}]),null);
 assert.equal(region([a]).bearingIntervalsTo({latitude:36,longitude:140}),null);
 assert.equal(region([]),null);assert.equal(region([null]),null);
 const fallback=G.inverse(35,139,-35,-41);
 assert(Number.isFinite(fallback.km)&&Number.isFinite(fallback.azimuth));
 assert.equal(fallback.azimuth,spherical(a,{latitude:-35,longitude:-41}));
 const short=bounds(a,G.destination(a.latitude,a.longitude,45,1));assert(short);
 assert(short.every(p=>p.marginDeg<.01));
});

test('prepared target records are immutable and reject an injected inverse',()=>{
 const p=region([{latitude:35,longitude:139}]);assert(Object.isFrozen(p));assert(Object.isFrozen(Object.getPrototypeOf(p)));
 assert.throws(()=>{p.latitude=0;},TypeError);
 const custom={...G,inverse:()=>({km:1,azimuth:2})};assert.equal(custom.prepareInverseRegion([{latitude:35,longitude:139}]),null);
 const detached=G.prepareInverseRegion;assert.equal(detached([{latitude:35,longitude:139}]),null);
});

test('merged opaque regions contain every canonical Fuji vertex and snapshot raw mutations',()=>{
 const raw=A.rimPoints(A.targetById('fuji').rim).map(p=>({...p})),left=region(raw.slice(0,500)),right=region(raw.slice(500)),all=region([left,right]);
 const observers=[{latitude:35,longitude:139},{latitude:36,longitude:139},{latitude:35,longitude:138},{latitude:34.5,longitude:138.7}];
 for(const observer of observers){const intervals=region([observer]).bearingIntervalsTo(all);assert(intervals);
  for(const p of raw){assert(contains(intervals,G.inverse(observer.latitude,observer.longitude,p.latitude,p.longitude).azimuth));assert(contains(intervals,spherical(observer,p)));}
 }
 const origin=region([observers[0]]),before=origin.bearingIntervalsTo(all);raw[0].latitude=0;raw[0].longitude=0;
 assert.deepEqual(origin.bearingIntervalsTo(all),before);
 assert.equal(region([observers[0],observers[1]]).bearingIntervalsTo(all),null);
});

test('canonical lazy geometry is bit-for-bit equal to the original eager geometry',()=>{
 for(const mode of ['standard','none']){
  Air.configure(mode);
  for(const observer of [{latitude:35,longitude:139,elevation:30,eyeM:1.5},{latitude:-40,longitude:-170,elevation:-35,eyeM:0},{latitude:80,longitude:170,elevation:1500,eyeM:20}]){
   const prepared=A.prepareRidgeObserver(observer);assert(prepared);assert.equal(prepared.inverse,G.inverse);
   for(let i=0;i<300;i++){
    const p=G.destination(observer.latitude,observer.longitude,i*1.2,1+i*25),anchor={...p,heightM:-100+i*13};
    assert.deepEqual(prepared.geometry(anchor),original(observer,anchor));
   }
  }
 }
 Air.configure('standard');
});

test('all captured geometry inputs remain from one eager evaluation across later changes',()=>{
 Air.configure('standard');const observer={latitude:35,longitude:139,elevation:30,eyeM:1.5},anchor={latitude:35.4,longitude:138.7,heightM:3776};
 const expected=original(observer,anchor),prepared=A.prepareRidgeObserver(observer);assert(prepared);
 observer.elevation=900;observer.eyeM=100;Air.configure('none');
 assert.deepEqual(prepared.geometry(anchor),expected);
 assert.deepEqual(A.prepareRidgeObserver(observer).geometry(anchor),original(observer,anchor));
 const inverse=G.inverse;
 try{G.inverse=()=>({km:1,azimuth:2});assert.equal(A.prepareRidgeObserver(observer),null);assert.deepEqual(prepared.geometry(anchor),expected);}
 finally{G.inverse=inverse;Air.configure('standard');}
});

test('ridge cache identity exposes only the immutable exact captured geometry tuple',()=>{
 Air.configure('standard');
 const observer={latitude:35,longitude:-0,elevation:-0,eyeM:0},reader=A.prepareRidgeObserver(observer);
 assert(reader);assert(Object.isFrozen(reader.cacheKey));
 assert.deepEqual(reader.cacheKey,[35,-0,-0,0,7/6]);
 assert.throws(()=>{reader.cacheKey[0]=0;},TypeError);
 observer.latitude=36;observer.elevation=100;observer.eyeM=2;Air.configure('none');
 try{
  assert.deepEqual(reader.cacheKey,[35,-0,-0,0,7/6]);
  assert.deepEqual(A.prepareRidgeObserver(observer).cacheKey,[36,-0,100,2,1]);
  assert.deepEqual(A.prepareRidgeObserver({latitude:35,longitude:139}).cacheKey,[35,139,0,1.5,1]);
 }finally{Air.configure('standard');}
});

test('overridden align, region preparation, elevation and refraction providers use the old path',()=>{
 const observer={latitude:35,longitude:139,elevation:30};
 assert.equal(A.prepareRidgeObserver.call({...A,geometryFrom:()=>null},observer),null);
 assert.equal(A.prepareRidgeObserver.call({...A,rimPoints:()=>[]},observer),null);
 const cases=[[G,'prepareInverseRegion'],[Astro,'targetElevationAngle'],[Air,'targetK']];
 for(const [owner,key]of cases){const old=owner[key];try{owner[key]=(...args)=>old(...args);assert.equal(A.prepareRidgeObserver(observer),null);}finally{owner[key]=old;}}
 assert.equal(A.prepareRidgeObserver({...observer,latitude:0}),null);
 assert.equal(A.prepareRidgeObserver({...observer,latitude:90}),null);
 assert.equal(A.prepareRidgeObserver({...observer,elevation:NaN}),null);
});
