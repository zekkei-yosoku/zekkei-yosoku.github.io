import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),H=require('./src/features/candidates/height-grid.js'),G=require('./astronotes-terrain.js');
const observer={latitude:35.71,longitude:139.805,elevation:5,eyeM:1.5},ray={azimuth:0,altitude:0,maxM:8000,refractionK:7/6};
const sha=b=>createHash('sha256').update(b).digest('hex').slice(0,16);
function fixture({height=0,reverse=false,fail=-1,delay=4}={}){
 const codes=new Set();let from=observer;
 for(let d=0;d<ray.maxM;d+=250){const end=Math.min(d+250,ray.maxM),to=G.destination(observer.latitude,observer.longitude,0,end/1000);H.cells(from,to,d,end,(gx,gy)=>codes.add(H.meshCode(Math.floor(gy/185),Math.floor(gx/225))));from=to;}
 const ordered=[...codes],payloads=new Map(),index={grid:{offsetM:20},parts:{},targets:{}},groups=new Map();
 const n=185*225,raw=new Uint8Array(n*2);if(height)for(let r=0;r<185;r++){raw[r*225]=(height+20)&255;raw[n+r*225]=(height+20)>>8;}
 const packed=gzipSync(raw);
 for(const code of codes){const p=code.slice(0,4);if(!groups.has(p))groups.set(p,{});groups.get(p)[code]=[sha(packed),height];}
 for(const [p,meshes]of groups){const bytes=Buffer.from(JSON.stringify({meshes}));payloads.set('fixture/'+p+'/index.json?v='+sha(bytes),bytes);index.parts[p]=[sha(bytes),Object.keys(meshes).length,height];for(const code of Object.keys(meshes))payloads.set('fixture/'+p+'/'+code+'.bin?v='+sha(packed),packed);}
 let active=0,peak=0;const calls=[];
 const fetchImpl=async(url,{signal}={})=>{
  const code=url.match(/\/(\d+)\.bin/)?.[1],at=ordered.indexOf(code);calls.push(url);active++;peak=Math.max(peak,active);
  try{await new Promise(r=>setTimeout(r,delay*(reverse&&at>=0?3-at%3:1)));assert.equal(signal?.aborted,false,'one owner must not abort shared IO');
   if(at>=0&&at===fail)throw new DOMException('fixture timeout','TimeoutError');
   const bytes=payloads.get(url);assert(bytes,url);return new Response(bytes);
  }finally{active--;}
 };
 return {model:H.create({base:'fixture/',loadIndex:async()=>index,fetchImpl,gsiAlong:async()=>[],groundAt:async()=>5}),stats:()=>({active,peak,calls:[...calls]}),ordered,
  recover(){fail=-1;},async idle(){while(active)await new Promise(r=>setTimeout(r,2));}};
}
const endpoint={...ray,endpoint:{...G.destination(observer.latitude,observer.longitude,0,8),elevation:5},targetKey:'fixture'};
test('ordered search uses at most three reads, reuses raw meshes and keeps all fields under reversed completion',async()=>{
 const a=fixture(),b=fixture({reverse:true}),one=await a.model.trace(observer,ray),two=await b.model.trace(observer,ray);
 assert.deepEqual(two,one);assert.equal(one.status,'clear');assert.equal(one.reachM,8000);
 assert.equal(a.stats().peak,3);assert.equal(b.stats().peak,3);assert.equal(a.stats().calls.length,a.ordered.length+1);
 assert.deepEqual(await a.model.trace(observer,ray),one);assert.equal(a.stats().calls.length,a.ordered.length+1);
 const x=fixture(),y=fixture({reverse:true});assert.deepEqual(await x.model.skyline(observer,endpoint),await y.model.skyline(observer,endpoint));
 assert.equal(x.stats().peak,3);assert.equal(x.stats().calls.length,x.ordered.length+1);
});
test('the first blocker retains its exact cell verdict and starts no more than two unused meshes',async()=>{
 const f=fixture({height:100}),result=await f.model.trace(observer,ray);assert.equal(result.status,'blocked');assert.equal(result.hit.reason,undefined);
 const count=f.stats().calls.length;await f.idle();assert.equal(f.stats().calls.length,count,'completion starts no more prefetch');
 assert.equal(count,4,'one part, current mesh, two speculative meshes');assert.equal(f.stats().peak,3);
 assert.equal(result.hit.topM,100);assert(result.hit.distanceM>=30&&result.hit.distanceM<40);
});
test('a failed speculative mesh stays unknown in this walk and remains retryable on the next walk',async()=>{
 const f=fixture({fail:1,reverse:true});const result=await f.model.trace(observer,ray);assert.deepEqual(result,{status:'unknown',reason:'height-data-unavailable',source:'plateau-grid'});
 await f.idle();const bad=f.ordered[1];assert.equal(f.stats().calls.filter(u=>u.includes('/'+bad+'.bin')).length,1);
 assert(f.stats().calls.length<=5,'one part, first and failed meshes, at most two unconsumed meshes');
 f.recover();assert.equal((await f.model.trace(observer,ray)).status,'clear');assert.equal(f.stats().calls.filter(u=>u.includes('/'+bad+'.bin')).length,2);
});
test('cancelled search retires its queue without cancelling another reader of the same raw mesh',async()=>{
 const f=fixture({delay:12});let current=true;
 const first=f.model.trace(observer,ray,{isCurrent:()=>current}),rejected=assert.rejects(first,/candidate-cancelled/);
 const second=f.model.trace(observer,ray);await new Promise(r=>setTimeout(r,3));current=false;
 await rejected;assert.equal((await second).status,'clear');await f.idle();
 assert.equal(new Set(f.stats().calls).size,f.stats().calls.length,'each shared URL is fetched once');assert(f.stats().peak<=3);
});
test('preview and search share six physical read slots while search verdict stays independent',async()=>{
 const f=fixture({delay:8}),plain=fixture();
 const [actual,preview]=await Promise.all([f.model.trace(observer,ray),f.model.frontage(observer,[0],8000)]);
 assert.deepEqual(actual,await plain.model.trace(observer,ray));assert.equal(preview[0].complete,true);await f.idle();
 assert(f.stats().peak<=6);assert.equal(new Set(f.stats().calls).size,f.stats().calls.length);
});
