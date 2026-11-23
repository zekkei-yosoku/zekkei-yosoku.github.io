import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),A=require('./astronotes-astro.js'),Air=require('./astronotes-atmosphere.js'),B=require('./astronotes-bodies.js');
const C=require('./src/features/candidates/composition.js');
const fields=['azimuth','geometricAltitude','apparentAltitude','refraction','distanceKm','angularRadius','angularDiameter','horizontalParallax',
 'upperLimbAltitude','lowerLimbAltitude','rightAscension','declination','hourAngle','eclipticLongitude','eclipticLatitude',
 'upperAltitude','lowerAltitude','upperRadius','lowerRadius','lowAltitude','altitude'];
function sameDirection(actual,expected){for(const key of fields)assert.equal(actual[key],expected[key],key);assert.deepEqual(actual.atmosphere,expected.atmosphere);}
const start=Date.parse('2026-11-21T00:00:00+09:00');

test('direction keeps exact topocentric Moon geometry over dates, poles, heights and changing air',()=>{
 const sites=[{latitude:35.35,longitude:139.07,elevation:31.5},{latitude:35.35,longitude:139.07,elevation:701.5},
  {latitude:0,longitude:-180,elevation:-400},{latitude:89.99,longitude:179.99,elevation:4000},{latitude:-89.99,longitude:0,elevation:0}];
 for(const mode of ['none','standard','manual','auto']){
  Air.configure(mode,{pressureHPa:950,temperatureC:-20});
  for(const day of [-365,0,365])for(let hour=0;hour<24;hour+=1.5)for(const site of sites){
   const ms=start+day*86400000+hour*3600000;sameDirection(B.direction('moon',ms,site),B.state('moon',ms,site));
   sameDirection(B.direction('moon',ms,site,{refraction:false}),B.state('moon',ms,site,{refraction:false}));
  }
 }
 Air.configure('standard');
});
test('prepared time never captures atmospheric settings or observer height',()=>{
 const site={latitude:35,longitude:139,elevation:1.5},first=B.direction('moon',start,site);
 Air.configure('manual',{pressureHPa:1050,temperatureC:35});site.elevation=2501.5;
 const changed=B.direction('moon',start,site);sameDirection(changed,B.state('moon',start,site));assert.notEqual(changed.geometricAltitude,first.geometricAltitude);
 changed.azimuth=999;sameDirection(B.direction('moon',start,site),B.state('moon',start,site));
 Air.configure('standard');
});
test('non-finite and unusual timestamps retain the full geometry behavior',()=>{
 const site={latitude:35,longitude:139,elevation:0};
 for(const ms of [NaN,Infinity,-Infinity,-0,0,new Date(start),'1805742000000']){
  let expected,error;try{expected=B.state('moon',ms,site);}catch(e){error=e;}
  if(error)assert.throws(()=>B.direction('moon',ms,site),{name:error.name,message:error.message});
  else sameDirection(B.direction('moon',ms,site),expected);
 }
 assert.throws(()=>B.direction('moon',start,undefined),TypeError);assert.throws(()=>B.direction('not-a-body',start,site));
});
test('exact context eviction and changed timestamp retain the original equations',()=>{
 const site={latitude:35.8,longitude:139.4,elevation:151.5},first=B.direction('moon',start,site);
 for(let i=1;i<=4100;i++)B.direction('moon',start+i*1001.001,site);
 sameDirection(B.direction('moon',start,site),first);
 for(const delta of [.001,1,1001.001])sameDirection(B.direction('moon',start+delta,site),B.state('moon',start+delta,site));
});
test('custom state and Astro overrides bypass the optional directional calculation',()=>{
 const sentinel={custom:true},custom={...B,state:()=>sentinel};assert.strictEqual(custom.direction('moon',start,{}),sentinel);
 const moon=A.moon;try{A.moon=()=>sentinel;assert.strictEqual(B.direction('moon',start,{}, {refraction:false}).custom,true);}finally{A.moon=moon;}
 const direction=A.moonDirection;try{A.moonDirection=()=>{throw Error('wrong capability');};sameDirection(B.direction('moon',start,{latitude:35,longitude:139}),B.state('moon',start,{latitude:35,longitude:139}));}finally{A.moonDirection=direction;}
});
test('older Astro assets and other celestial bodies preserve their state API',()=>{
 const oldAstro={...A};delete oldAstro.moonDirection;
 const context=vm.createContext({AstroNotesAstro:oldAstro,AstroNotesAtmosphere:Air,require});
 vm.runInContext(fs.readFileSync(new URL('./astronotes-bodies.js',import.meta.url),'utf8'),context);
 const old=context.AstroNotesBodies,site={latitude:35,longitude:139,elevation:21.5};
 assert.deepEqual(old.direction('moon',start,site),B.state('moon',start,site));
 for(const body of ['sun','sirius','mercury','venus','mars','jupiter','saturn'])assert.deepEqual(B.direction(body,start,site),B.state(body,start,site));
});

const target={latitude:35.1,longitude:139.1,parts:[{id:'tip',m:100}]};
const align={geometryFrom:()=>({azimuth:100,angle:10,topM:100,distanceKm:1}),viewProjector:()=>((az,alt)=>[az-100,alt-10]),partTarget:t=>t};
const plan={body:'moon',target,at:start,timeSpec:{kind:'instant',at:start},partId:'tip',limb:'center',strict:true};
const observer={latitude:35,longitude:139,groundM:0,eyeM:1.5};
const state=()=>({azimuth:100,geometricAltitude:10,apparentAltitude:10,angularRadius:.25});
test('solver intermediates use direction and accepted events require full state agreement',async()=>{
 let directions=0,full=0;const bodies={definition:()=>({limbs:true}),direction:()=>{directions++;return state();},state:()=>{full++;return state();}};
 const result=await C.opportunities(plan,observer,{align,bodies,yieldTask:async()=>{}});
 assert.equal(result.solutions.length,1);assert(directions>0&&full>0);
 const old=await C.opportunities(plan,observer,{align,bodies:{definition:bodies.definition,state:bodies.state},yieldTask:async()=>{}});
 assert.deepEqual(result,old);
});
test('a late direction change or failed full read cannot become a confirmed event',async()=>{
 for(const read of [()=>({...state(),apparentAltitude:11}),()=>{throw Error('provider unavailable');}]){
  const result=await C.opportunities(plan,observer,{align,bodies:{definition:()=>({limbs:true}),direction:state,state:read},yieldTask:async()=>{}});
  assert.equal(result.solutions.length,0);assert.equal(result.partial,true);assert.equal(result.reason,'some-calculations-unknown');
 }
});
test('actual Moon/Fuji and surface refinement return every field of the full-state solver',async()=>{
 const align=require('./astronotes-align.js'),geo=require('./astronotes-terrain.js');
 const p={...plan,target:align.targetById('fuji'),partId:'tip',profile:'summit-contact',timeSpec:{kind:'day',at:start,timezone:'Asia/Tokyo'}};
 const origin={latitude:35.351637,longitude:139.136991,groundM:169.8,elevation:169.8,eyeM:1.5,surfaceAglM:0};
 const end=geo.destination(origin.latitude,origin.longitude,90,.15),line=[[origin.longitude,origin.latitude],[end.longitude,end.latitude]];
 let directions=0;const fast={...B,direction(...args){directions++;return B.direction.apply(this,args);}},full={...B,direction:undefined};
 for(const point of [origin,{...origin,surfaceGeometry:{lines:[line],polygons:[]}}]){
  const options={align,groundAt:()=>169.8,standingAt:()=>true,yieldTask:async()=>{}};
  const expected=await C.opportunities(p,point,{...options,bodies:full});
  const actual=await C.opportunities(p,point,{...options,bodies:fast});
  assert(expected.solutions.length>0,'fixture has a genuine geometric solution');assert.deepEqual(actual,expected);
 }
 assert(directions>1000,'the prepared capability is used during actual day/surface solving');
});
