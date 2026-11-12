// The GSI building cache returns exactly what the routine it replaced (tools/before-promotion.mjs)
// returned, also on repeated calls that reuse a tile's converted rings. No network: one synthetic BldA tile.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {beforePromotion} from './tools/before-promotion.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const load=source=>{const module={exports:{}},context={module,exports:module.exports,require,console,Math,Date,JSON,Promise,Map,Set,WeakMap,TextDecoder,TextEncoder,Uint8Array,DataView,ArrayBuffer,Float64Array,Number,Object,Array,String,Error,RangeError,isFinite,parseFloat,globalThis:{}};vm.createContext(context);vm.runInContext(source,context);return context.module.exports;};
const source=readFileSync(new URL('./astronotes-terrain.js',import.meta.url),'utf8');
const P=load(beforePromotion('astronotes-terrain.js')),T=load(source);

const varint=n=>{const b=[];do{let x=n&0x7f;n=Math.floor(n/128);if(n)x|=0x80;b.push(x);}while(n);return b;};
const zz=n=>(n<<1)^(n>>31);
const field=(f,w,body)=>[...varint((f<<3)|w),...(w===2?[...varint(body.length),...body]:body)];
const ring=pts=>{const out=[];let x=0,y=0;pts.forEach(([px,py],i)=>{if(i===0)out.push(...varint(1|(1<<3)));if(i===1)out.push(...varint(2|((pts.length-1)<<3)));out.push(...varint(zz(px-x)),...varint(zz(py-y)));x=px;y=py;});out.push(...varint(7|(1<<3)));return out;};
let seed=11;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
// 400 buildings of the three height codes (and the wall-less kind that is never returned) over one z16 tile.
const values=[3101,3102,3103,3111],features=[];
for(let i=0;i<400;i++){const cx=100+rnd()*3900,cy=100+rnd()*3900,n=4+Math.floor(rnd()*5),r=10+rnd()*60;
 const pts=Array.from({length:n},(_,k)=>{const a=2*Math.PI*k/n;return [Math.round(cx+r*Math.cos(a)),Math.round(cy+r*Math.sin(a))];});
 features.push(field(2,2,[...field(2,2,[0,i%4]),...field(3,0,varint(3)),...field(4,2,ring(pts))]));}
const layer=[...field(1,2,[...new TextEncoder().encode('BldA')]),...features.flat(),...field(3,2,[...new TextEncoder().encode('vt_code')]),...values.flatMap(v=>field(4,2,field(5,0,varint(v)))),...field(5,0,varint(4096))];
const tile=new Uint8Array(field(3,2,layer));
const Z=16,lat0=35.6862,lon0=139.7307,X=Math.floor((lon0+180)/360*2**Z),r0=lat0*Math.PI/180,Y=Math.floor((1-Math.log(Math.tan(r0)+1/Math.cos(r0))/Math.PI)/2*2**Z);
const at=(u,v)=>{const n=Math.PI-2*Math.PI*(Y+v/4096)/2**Z;return {latitude:Math.atan(Math.sinh(n))*180/Math.PI,longitude:(X+u/4096)/2**Z*360-180};};
const fetchImpl=async url=>url.endsWith(`/16/${X}/${Y}.pbf`)?{ok:true,status:200,arrayBuffer:async()=>tile.buffer}:{ok:false,status:503};

test('the cached tile rings give the same buildings, entries and order as converting every building on each call',async()=>{
 let lines=0,hits=0;
 for(let k=0;k<150;k++){
  const from=at(200+rnd()*3700,200+rnd()*3700),to=at(200+rnd()*3700,200+rnd()*3700);
  for(const pass of [1,2]){
   const a=await T.gsiBuildingsAlong(from,to,{fetchImpl}),b=await P.gsiBuildingsAlong(from,to,{fetchImpl});
   assert.equal(JSON.stringify(a),JSON.stringify(b),'line '+k+' pass '+pass);
   if(pass===1){lines++;hits+=a.length;}
  }
 }
 assert(hits>50,'the lines cross buildings ('+hits+')');assert.equal(lines,150);
});
test('a tile every line passes through stays cached while many other tiles come and go (2026-11-12)',async()=>{
 // Before, the store dropped the oldest of 200 tiles, so the tiles beside the target that every line crosses were fetched again and again.
 const C=load(source),counts=new Map(),anyTile=async url=>{counts.set(url,(counts.get(url)||0)+1);return {ok:true,status:200,arrayBuffer:async()=>tile.buffer};};
 const hot=`/16/${X}/${Y}.pbf`,hotFetches=()=>[...counts].filter(([u])=>u.endsWith(hot)).reduce((a,[,n])=>a+n,0);
 for(let i=1;i<=600;i++){
  await C.gsiBuildingsAlong(at(1000,2000),at(3000,2000),{fetchImpl:anyTile});
  await C.gsiBuildingsAlong(at(4096*i+1000,2000),at(4096*i+3000,2000),{fetchImpl:anyTile});
 }
 assert.equal(hotFetches(),1);assert.equal(counts.size,601);
});
