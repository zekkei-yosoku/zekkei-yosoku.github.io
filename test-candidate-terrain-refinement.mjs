import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),{createLive}=require('./src/features/candidates/live-terrain.js');
const source=readFileSync(new URL('./src/features/candidates/live-terrain.js',import.meta.url),'utf8');
// Independent reference path: all cells use the established near/native branch.
const nativeModule={exports:{}};
assert(source.includes('FAR_MIN_M=2000'));
new Function('require','module','exports',source.replace('FAR_MIN_M=2000','FAR_MIN_M=Infinity'))(createRequire(new URL('./src/features/candidates/live-terrain.js',import.meta.url)),nativeModule,nativeModule.exports);
const R=6371008.8,DEG=Math.PI/180,M=R*DEG,geo={destination:(lat,lon,az,km)=>({latitude:lat,longitude:lon+km*1000/M})};
const observer={latitude:0,longitude:0,elevation:0,eyeM:1.5},baseRay={azimuth:90,altitude:10,maxM:2600};
const px=(d,z)=>(d/M+180)/360*256*2**z,cell=(d,z=15)=>Math.floor(px(d,z));
const fromPixel=(x,z)=>(x/(256*2**z)*360-180)*M;
function rayHeight(ray,d){
 const effectiveR=R*(ray.refractionK??1),theta=ray.maxM/effectiveR,eye=observer.eyeM;
 const alpha=Number.isFinite(ray.endpoint?.elevation)?Math.atan2((effectiveR+ray.endpoint.elevation)*Math.cos(theta)-(effectiveR+eye),(effectiveR+ray.endpoint.elevation)*Math.sin(theta)):ray.altitude*DEG;
 const angle=d/effectiveR;return (effectiveR+eye)/(Math.cos(angle)-Math.tan(alpha)*Math.sin(angle))-effectiveR;
}
function fixture({ray=baseRay,native=()=>0,coarse,mode,create=createLive,layers=[['dem5a',15]],maxTiles=96,lookAhead=false,hold}={}){
 const requests=[],texts=new Map(),firstUncachedNative=Math.floor(cell(2500)/256);
 const fetchImpl=async(url,{signal}={})=>{
  const m=url.match(/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.txt$/),[,layer,sz,sx,sy]=m,z=+sz,x=+sx,y=+sy;
  requests.push({layer,z,x,y,signal});
  if(hold&&z!==12&&x===firstUncachedNative)await hold({url,signal});
  if(mode&&z!==12&&x===firstUncachedNative){
   if(mode==='fetch')throw Error('fixture transport failure');
   if(mode==='404')return {ok:false,status:404};
   if(mode==='size')return {ok:true,text:async()=>'1,2'};
  }
  if(!texts.has(url)){
   const values=Array.from({length:256},(_,i)=>{
    const gx=x*256+i,d=fromPixel(gx+.5,z),lo=Math.max(2000,fromPixel(gx,z));
    if(z===12)return String(coarse?coarse({gx,d,lo}):rayHeight(ray,lo)-10);
    if(mode==='nodata'&&x===firstUncachedNative)return 'e';
    return String(native({gx,d,z,layer}));
   });
   texts.set(url,Array(256).fill(values.join(',')).join('\n'));
  }
  return {ok:true,text:async()=>texts.get(url)};
 };
 const terrain=create({geo,fetchImpl,layers,maxTiles,lookAhead});return {terrain,requests,firstUncachedNative};
}

test('uncertain coarse intervals visit every native cell and discard coarse skyline heights',async()=>{
 const x=fixture(),reference=fixture({create:nativeModule.exports.createLive});
 const result=await x.terrain.trace(observer,baseRay),expected=await reference.terrain.trace(observer,baseRay);
 assert.equal(result.status,'model-clear');assert.deepEqual(result,expected);
 assert.equal(result.skyline.terrainM,0);assert(result.minMarginM>0);
 assert(x.requests.some(r=>r.z===12));assert(reference.requests.every(r=>r.z===15));
 const calls=x.requests.length;assert.deepEqual(await x.terrain.trace(observer,baseRay),result);assert.equal(x.requests.length,calls);
});

test('a narrow peak away from the coarse midpoint blocks and a lowered fine surface can be clear',async()=>{
 const spike=cell(2020),native=({gx})=>gx===spike?600:0;
 const x=fixture({native}),reference=fixture({native,create:nativeModule.exports.createLive});
 const result=await x.terrain.trace(observer,baseRay),expected=await reference.terrain.trace(observer,baseRay);
 assert.equal(result.status,'blocked');assert.equal(result.hit.coarse,undefined);assert.deepEqual(result,expected);
 assert(result.hit.distanceM>2000&&result.hit.distanceM<2040);
});

test('native fallback zoom and a finer custom grid retain all boundary cells',async()=>{
 for(const z of [14,16]){
  const spike=cell(2020,z),x=fixture({layers:[['dem5a',15],['fixture',z]],native:({layer,gx})=>layer==='dem5a'?'e':gx===spike?600:0});
  const result=await x.terrain.trace(observer,baseRay);assert.equal(result.status,'blocked',String(z));assert.equal(result.hit.coarse,undefined);assert(result.hit.distanceM>2000&&result.hit.distanceM<2040);
 }
});

test('native endpoint contact stays unknown while the same ordinary celestial ray is blocked',async()=>{
 const ray={...baseRay,maxM:2400,endpoint:{...geo.destination(0,0,90,2.4),elevation:450}},spike=cell(2399),native=({gx})=>gx===spike?460:0;
 const x=fixture({ray,native}),result=await x.terrain.trace(observer,ray);
 assert.equal(result.status,'unknown');assert.equal(result.endpointContactUncertain,true);assert.equal(result.hit,null);assert.equal(result.reason,undefined);
 const effectiveR=R,theta=ray.maxM/effectiveR;
 const altitude=Math.atan2((effectiveR+450)*Math.cos(theta)-(effectiveR+1.5),(effectiveR+450)*Math.sin(theta))/DEG;
 assert.equal((await x.terrain.trace(observer,{...ray,endpoint:null,altitude})).status,'blocked');
});

test('unavailable refinement never borrows a coarse or previous bank height and does not retry every cell',async()=>{
 for(const mode of ['nodata','404','fetch','size']){
  const x=fixture({mode}),result=await x.terrain.trace(observer,baseRay);
  assert.equal(result.status,'unknown',mode);assert.equal(result.reason,'coarse-terrain-margin');assert(result.missing>0);assert.equal(result.hit,null);
  const failed=x.requests.filter(r=>r.z!==12&&r.x===x.firstUncachedNative);assert.equal(failed.length,1,mode+' has one failed native read in this ray');
 }
 // A later known coarse obstruction is still found after refinement was unavailable.
 const x=fixture({mode:'fetch',ray:{...baseRay,maxM:2800},coarse:({lo})=>rayHeight(baseRay,lo)+(lo>2650?100:-10)});
 const result=await x.terrain.trace(observer,{...baseRay,maxM:2800});assert.equal(result.status,'blocked');assert.equal(result.hit.coarse,true);assert(result.missing>0);
});

test('refinement consumes the shared unique-tile budget instead of allocating another allowance',async()=>{
 const x=fixture({maxTiles:3}),result=await x.terrain.trace(observer,baseRay);
 assert.equal(result.status,'unknown');assert.equal(result.reason,'terrain-budget');assert(result.partial);assert.equal(x.terrain.stats().fetched,3);assert.equal(x.requests.length,3);
});

test('a late last-cell response is rejected after cancellation; another pending reader remains valid',async()=>{
 let release,started;const began=new Promise(r=>started=r),wait=new Promise(r=>release=r);let current=true;
 const x=fixture({hold:async()=>{started();await wait;}});
 const first=x.terrain.trace(observer,{...baseRay,isCurrent:()=>current});await began;
 const joined=x.terrain.trace(observer,baseRay);current=false;release();
 await assert.rejects(first,/candidate-cancelled/);assert.equal((await joined).status,'model-clear');
 assert.equal(x.requests.filter(r=>r.z!==12&&r.x===x.firstUncachedNative).length,1);
 assert.equal(x.terrain.stats().pendingTiles,0);
 const controller=new AbortController();let stop;
 const y=fixture({hold:async()=>{controller.abort();await new Promise(r=>stop=r);}});
 const cancelled=y.terrain.trace(observer,{...baseRay,signal:controller.signal});
 while(!stop)await new Promise(r=>setImmediate(r));stop();await assert.rejects(cancelled,/candidate-cancelled/);
});

test('clear or blocked coarse intervals never request native refinement',async()=>{
 for(const high of [false,true]){
  const x=fixture({coarse:()=>high?1000:0}),result=await x.terrain.trace(observer,baseRay);
  assert.equal(result.status,high?'blocked':'model-clear');
  assert.equal(x.requests.filter(r=>r.z!==12&&r.x===x.firstUncachedNative).length,0);
  if(high)assert.equal(result.hit.coarse,true);
 }
});
