import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {patchExactTerrain} from './build-exact-terrain.mjs';
const source=readFileSync(new URL('../astronotes-terrain.js',import.meta.url),'utf8');
function fixture(patched,{fail=false,failOnce=false,mode='mixed'}={}){
 let calls=0,failedOnce=false;const tiles=new Map(),layers=[];
 const tile=async(z,x,y,layer)=>{
  calls++;layers.push(layer);const key=[z,x,y,layer].join('/');
  if(failOnce&&!failedOnce){failedOnce=true;throw Error('temporary timeout');}
  if(fail&&(x+y)%2===0)throw Error('tile timeout');
  if(tiles.has(key))return tiles.get(key);
  const order=['dem1a_png','dem5a_png','dem_png','dem5b_png','dem5c_png'].indexOf(layer);
  if((x+y+order)%13===0){tiles.set(key,null);return null;}
  const width=32,height=32,data=new Uint8Array(width*height*4);
  for(let i=0;i<width*height;i++){
   const pick=(i+x+y)%11,missing=mode==='sea'||(order===0?pick<8:order===1?pick<5:order===2?pick===0:order===3?pick%2===0:pick%3===0);
   const v=missing?8388608:((i+x-y+order)*123+16777216)%16777216;
   data[i*4]=v>>>16;data[i*4+1]=(v>>>8)&255;data[i*4+2]=v&255;
  }
  const value={width,height,data};tiles.set(key,value);return value;
 };
 let s=patched?patchExactTerrain(source):source;
 s=s.replace('function loadTile(z, x, y, layer = "dem_png") {','function loadTile(z, x, y, layer = "dem_png") {return __tile(z,x,y,layer);');
 const c=vm.createContext({AstroNotesAstro:{},Image:class{},__tile:tile,console,AbortSignal});vm.runInContext(s,c);
 return {api:c.AstroNotesTerrain,calls:()=>calls,layers};
}
const points=Array.from({length:29161},(_,i)=>({latitude:35.2+(i%241)*.0017,longitude:138.4+Math.floor(i/241)*.0041}));
const equal=(a,b)=>{assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)assert(Object.is(a[i],b[i]),'sample '+i+': '+a[i]+' / '+b[i]);};
test('all exact pixels and DEM fallbacks; one tile await per group',async()=>{
 const a=fixture(false),b=fixture(true),opts={zoom:12,from:{latitude:35.58,longitude:139.56},fetchImpl:async()=>{throw Error('unexpected fallback');}};
 // Missing whole tiles may require the existing fallback: give it exact deterministic values.
 opts.fetchImpl=async url=>({ok:true,json:async()=>({elevation:new URL(url).searchParams.get('latitude').split(',').map(()=>23.75)})});
 equal(await a.api.elevations(points,opts),await b.api.elevations(points,opts));
 assert(b.calls()<a.calls()/100,`${a.calls()} -> ${b.calls()}`);
});
test('mixed zoom and boundaries preserve each pixel including negative heights',async()=>{
 const p=[...points.slice(0,100),...points.slice(-100)].map((p,i)=>({...p,latitude:i%2?p.latitude:35.58+i*.00001,longitude:i%2?p.longitude:139.56+i*.00001}));
 const opts={zoom:11,from:{latitude:35.58,longitude:139.56},fetchImpl:async url=>({ok:true,json:async()=>({elevation:new URL(url).searchParams.get('latitude').split(',').map(()=>7)})})};
 equal(await fixture(false).api.elevations(p,opts),await fixture(true).api.elevations(p,opts));
});
test('sea, foreign points and single point tile paths are unchanged',async()=>{
 const p=[...points.slice(0,100),{latitude:0,longitude:0},{latitude:NaN,longitude:139}];
 for(const mode of ['mixed','sea'])for(const n of [1,31,32,102])equal(await fixture(false,{mode}).api.tileElevations(p.slice(0,n),13),await fixture(true,{mode}).api.tileElevations(p.slice(0,n),13));
});
test('strict terrain errors reject; tolerant tiles keep unaffected values',async()=>{
 const a=fixture(false,{fail:true}),b=fixture(true,{fail:true});
 await assert.rejects(a.api.elevations(points.slice(0,1000),{zoom:12}),/tile timeout/);
 await assert.rejects(b.api.elevations(points.slice(0,1000),{zoom:12}),/tile timeout/);
 equal(await fixture(false,{fail:true}).api.tileElevations(points.slice(0,1000),12),await fixture(true,{fail:true}).api.tileElevations(points.slice(0,1000),12));
});
test('empty inputs keep their original outputs',async()=>{for(const patched of [false,true]){assert.equal((await fixture(patched).api.elevations([])).length,0);assert.equal((await fixture(patched).api.tileElevations([],12)).length,0);}});
test('default zoom and 10m sea guard retain original behavior',async()=>{
 const a=fixture(false,{mode:'sea'}),b=fixture(true,{mode:'sea'});
 const p=points.slice(0,32);equal(await a.api.elevations(p),await b.api.elevations(p));
 assert(!b.layers.includes('dem5b_png'));assert(!b.layers.includes('dem5c_png'));
 equal(await a.api.tileElevations(p),await b.api.tileElevations(p));
});
test('mixed foreign inputs still use the original bulk fallback',async()=>{
 const a=fixture(false),b=fixture(true),p=[...points.slice(0,32),{latitude:0,longitude:0}];
 const opts={fetchImpl:async url=>({ok:true,json:async()=>({elevation:new URL(url).searchParams.get('latitude').split(',').map(()=>7)})})};
 equal(await a.api.elevations(p,opts),await b.api.elevations(p,opts));assert.equal(a.calls(),0);assert.equal(b.calls(),0);
});
test('a strict transient failure does not cache a failed batch',async()=>{
 for(const patched of [false,true]){
  const f=fixture(patched,{failOnce:true,mode:'sea'}),p=points.slice(0,32);
  await assert.rejects(f.api.elevations(p),/temporary timeout/);
  const result=await f.api.elevations(p);assert.equal(result.length,p.length);assert(result.every(v=>v===0));
 }
});
