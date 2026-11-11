import test from 'node:test';
import assert from 'node:assert/strict';
import {beforePromotion} from './before-promotion.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createNativeGroundPoint} from './native-ground-point.mjs';

const terrainSource=readFileSync(new URL('../astronotes-terrain.js',import.meta.url),'utf8');
const astroSource=readFileSync(new URL('../astronotes-astro.js',import.meta.url),'utf8');
const POINT='https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php';
const pixel=cm=>{
 const n=cm<0?cm+16777216:cm,data=new Uint8ClampedArray(256*256*4);
 const rgba=[Math.floor(n/65536),Math.floor(n/256)%256,n%256,255];
 for(let i=0;i<data.length;i+=4)data.set(rgba,i);
 return {width:256,height:256,data};
};
const tileResponse=(cm=12345)=>new Response(JSON.stringify({cm}),{status:200});
const plain=value=>JSON.parse(JSON.stringify(value));

test('native source order and rounding retain centimetre ties, negatives and signed zero',async()=>{
 for(const [cm,expected] of [[12344,123.4],[12345,123.5],[12346,123.5],[-12345,-123.5],[-4,-0],[0,0],[4,0],[5,.1],[-5,-.1]]){
  const calls=[],sample=createNativeGroundPoint({readTile:async(...args)=>{calls.push(args);return {image:pixel(cm)};}});
  const v=await sample(35.1234567,139.7654321);assert(Object.is(v.elevation,expected));assert.equal(v.hsrc,'1m（レーザ）');assert.equal(calls.length,1);assert.equal(calls[0][0],17);assert.equal(calls[0][3],'dem1a_png');
 }
 const calls=[],sample=createNativeGroundPoint({readTile:async(z,x,y,layer)=>{calls.push([z,layer]);return layer==='dem_png'?{image:pixel(-250)}:{missing:true};}});
 assert.deepEqual(await sample(35,139),{elevation:-3,hsrc:'10m'});
 assert.deepEqual(calls,[[17,'dem1a_png'],[15,'dem5a_png'],[15,'dem5b_png'],[15,'dem5c_png'],[14,'dem_png']]);
});

test('coordinates are rounded to API six decimals before the official pixel calculation',async()=>{
 const seen=[];const sample=createNativeGroundPoint({readTile:async(z,x,y,layer)=>{seen.push([z,x,y,layer]);return {image:pixel(1)};}});
 await sample(35.00000049,139.00000049);await sample(35,139);assert.deepEqual(seen[0],seen[1]);
 // At the equator/prime meridian the official formula selects the first pixel.
 const data=new Uint8ClampedArray(256*256*4);data[2]=25;
 assert.equal((await createNativeGroundPoint({readTile:async(z,x,y)=>{assert.equal(x,65536);assert.equal(y,65536);return {image:{width:256,height:256,data}};}})(0,0)).elevation,.3);
});

test('only confirmed absent/nodata sources advance; unknown or failed sources cool down',async()=>{
 let now=100,calls=0,fail=true;
 const sample=createNativeGroundPoint({clock:()=>now,readTile:async()=>{calls++;if(fail)throw Error('synthetic timeout');return {image:pixel(10)};}});
 assert.equal(await sample(35,139),null);assert.equal(calls,1);
 now+=29999;fail=false;assert.equal(await sample(36,140),null);assert.equal(calls,1);
 now++;assert.equal((await sample(36,140)).elevation,.1);assert.equal(calls,2);
 for(const result of [null,{}, {image:{width:1,height:1,data:[0,0,0,255]}}]){
  let n=0;assert.equal(await createNativeGroundPoint({readTile:async()=>{n++;return result;}})(35,139),null);assert.equal(n,1);
 }
 let n=0;const missing=createNativeGroundPoint({readTile:async()=>{n++;return n%2?{missing:true}:{image:pixel(8388608)};}});
 assert.deepEqual(await missing(35,139),{elevation:'-----',hsrc:''});assert.equal(n,5);
});

function load({native=true,fetchImpl=async()=>tileResponse(),disk=new Map(),cache=true,putFails=false,bitmap=true,imageFails=false,at=1000000000}={}){
 let now=at;const calls=[],images=[],blobs=new Map();let nextBlob=0;
 const imageFor=async blob=>pixel(JSON.parse(await blob.text()).cm);
 class FakeImage{
  set src(url){images.push(url);queueMicrotask(async()=>{try{if(imageFails)throw Error('image failure');this.pixels=blobs.has(url)?await imageFor(blobs.get(url)):pixel(2222);this.onload?.();}catch{this.onerror?.();}});}
 }
 class Clock extends Date{static now(){return now;}}
 const fetch=async(...args)=>{calls.push(args);return fetchImpl(...args);};
 const context=vm.createContext({console,setTimeout,clearTimeout,queueMicrotask,AbortSignal,Response,Blob,Date:Clock,fetch,Image:FakeImage,
  URL:{createObjectURL:blob=>{const u='blob:unit-'+(++nextBlob);blobs.set(u,blob);return u;},revokeObjectURL:u=>blobs.delete(u)},
  ...(cache?{caches:{open:async()=>({match:async u=>disk.get(typeof u==='string'?u:u.url)?.clone(),put:async(u,r)=>{if(putFails)throw Error('quota');disk.set(u,r.clone());},keys:async()=>[...disk.keys()].map(url=>({url})),delete:async u=>disk.delete(typeof u==='string'?u:u.url)})}}:{}),
  ...(bitmap?{createImageBitmap:async blob=>({...await imageFor(blob),close(){}})}:{}),
  document:{createElement:()=>{let image;return {getContext:()=>({drawImage:i=>{image=i.pixels||i;},getImageData:()=>image})};}}
 });
 vm.runInContext(astroSource,context);vm.runInContext(native?terrainSource:beforePromotion('astronotes-terrain.js'),context);
 return {terrain:context.AstroNotesTerrain,calls,images,disk,blobs,advance:ms=>now+=ms};
}

test('strict native reads verify HTTP without CacheStorage, and use only the verified blob when ImageBitmap is absent',async()=>{
 for(const bitmap of [true,false]){
  const a=load({cache:false,bitmap,fetchImpl:async url=>url.includes('dem1a_png')?new Response('',{status:404}):tileResponse(98765)});
  const v=await a.terrain.groundElevation(35,139,{withSource:true});assert.deepEqual(plain(v),{elevation:987.7,source:'5m（レーザ）'});
  assert.equal(a.calls.length,2);assert(a.calls.every(([u])=>!u.startsWith(POINT)));
  assert(a.images.every(u=>u.startsWith('blob:')));assert.equal(a.blobs.size,0);
 }
});

test('an unavailable better layer uses the ordinary API without requesting a coarser native layer',async()=>{
 for(const failure of ['throw',500]){
  const a=load({imageFails:true,fetchImpl:async url=>{
   if(url.startsWith(POINT))return new Response(JSON.stringify({elevation:42.1,hsrc:'api-source'}));
   if(failure==='throw')throw new TypeError('offline');return new Response('',{status:500});
  }});
  assert.deepEqual(plain(await a.terrain.groundElevation(35,139,{withSource:true})),{elevation:42.1,source:'api-source'});
  assert.equal(a.calls.length,2);assert(a.calls[0][0].includes('dem1a_png'));assert(a.calls[1][0].startsWith(POINT));assert.equal(a.images.length,failure==='throw'?1:0);
  await a.terrain.groundElevation(36,140);assert.equal(a.calls.length,3,'native failure cooldown skips a second failed tile');assert(a.calls[2][0].startsWith(POINT));
 }
});

test('existing four-argument tile consumers retain their Image fallback and explicit point providers',async()=>{
 for(const cache of [true,false]){
  const a=load({cache,fetchImpl:async()=>{throw new TypeError('blocked');}});
  assert.equal(await a.terrain.elevationFromTile(35,139,17),22.22);assert.equal(a.images.length,1);
  const oldCalls=a.calls.length;
  const custom=async()=>new Response(JSON.stringify({elevation:9,hsrc:'injected'}));
  assert.equal(await a.terrain.groundElevation(35,139,{fetchImpl:custom}),9);assert.equal(a.calls.length,oldCalls,'explicit point provider bypasses native tiles');
 }
});

test('strict-first and ordinary-first consumers share failures and preserve the legacy Image retry',async()=>{
 const old=load({native:false,fetchImpl:async()=>{throw new TypeError('blocked');}});
 const expected=await old.terrain.elevationFromTile(35,139,17);
 for(const strictFirst of [true,false]){
  let release,entered;const started=new Promise(ok=>entered=ok),gate=new Promise(ok=>release=ok);
  const a=load({fetchImpl:async()=>{entered();await gate;throw new TypeError('blocked');}});
  let point,ridge;
  if(strictFirst){point=a.terrain.groundElevation(35,139);await started;ridge=a.terrain.elevationFromTile(35,139,17);}
  else{ridge=a.terrain.elevationFromTile(35,139,17);await started;point=a.terrain.groundElevation(35,139);}
  // Let the second consumer join the same promise before the request fails.
  await new Promise(ok=>setImmediate(ok));release();
  assert.equal(await ridge,expected);assert.equal(await point,22.2);
  assert.equal(a.calls.length,1);assert.equal(a.images.length,1);
 }
});

test('five-decimal first-writer key, six-decimal disk URL, source, TTL and cache write failure keep their contracts',async()=>{
 const a=load(),lat=35.123451,lon=139.123451;
 const one=await a.terrain.groundElevation(lat,lon,{withSource:true}),two=await a.terrain.groundElevation(35.123454,139.123454,{withSource:true});
 assert.equal(one,two);assert.equal(a.calls.length,1);
 const url=POINT+'?lon=139.123451&lat=35.123451&outtype=JSON';assert(a.disk.has(url));
 const b=load({disk:a.disk});assert.equal(await b.terrain.groundElevation(lat,lon),123.5);assert.equal(b.calls.length,0,'fresh native JSON uses the existing point disk cache');
 const c=load({disk:a.disk,at:1000000000+30*86400000+1,fetchImpl:async()=>tileResponse(54321)});assert.equal(await c.terrain.groundElevation(lat,lon),543.2);assert.equal(c.calls.length,1,'expired point and tile cache refetch');
 const quota=load({putFails:true});assert.equal(await quota.terrain.groundElevation(lat,lon),123.5);assert.equal(quota.calls.length,1);
 const outside=load();assert.equal(await outside.terrain.groundElevation(0,0),null);assert.equal(outside.calls.length,0);
});

test('negative zero on the first response and positive zero after JSON cache reload match the old API path',async()=>{
 for(const native of [false,true]){
  const a=load({native,fetchImpl:async url=>url.startsWith(POINT)?new Response('{"elevation":-0,"hsrc":"1m（レーザ）"}'):tileResponse(-4)});
  assert(Object.is(await a.terrain.groundElevation(35,139),-0));
  const b=load({native,disk:a.disk});assert(Object.is(await b.terrain.groundElevation(35,139),0));assert.equal(b.calls.length,0);
 }
});

test('unknown native data and unavailable API retain the original tile fallback; confirmed no-data keeps sea source',async()=>{
 const a=load({fetchImpl:async url=>url.startsWith(POINT)?new Response('',{status:500}):new Response('',{status:404})});
 assert.deepEqual(plain(await a.terrain.groundElevation(35,139,{withSource:true})),{elevation:0,source:'海'});
 assert.equal(a.calls.length,5);assert(a.calls.every(([u])=>!u.startsWith(POINT)),'all five confirmed missing sources need no API');
 for(const native of [false,true]){
  const b=load({native,fetchImpl:async url=>url.startsWith(POINT)?new Response('',{status:500}):tileResponse(12345)});
  // An injected API implementation preserves the legacy failure/fallback path.
  const unavailable=async()=>new Response('',{status:500});
  const v=await b.terrain.groundElevation(35,139,{withSource:true,fetchImpl:unavailable});assert.deepEqual(plain(v),{elevation:123.45,source:'標高タイル'});
 }
});
