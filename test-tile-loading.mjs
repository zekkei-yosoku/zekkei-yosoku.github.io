// A slow network must not fail a whole horizon measurement, and one failure must not be remembered for the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const timeoutError=()=>Object.assign(new Error('signal timed out'),{name:'TimeoutError'});
const pixels={width:256,height:256,data:new Uint8ClampedArray(256*256*4)};
const LASER='https://cyberjapandata.gsi.go.jp/xyz/dem1a_png/';
function load({fetch}){
 const images=[];
 class Image{constructor(){images.push(this);}set src(url){this.url=url;setTimeout(()=>this.onerror?.(),0);}}
 const context=vm.createContext({console,setTimeout,clearTimeout,AbortSignal,fetch,Image,Response,
  caches:{open:async()=>({match:async()=>undefined,put:async()=>{},keys:async()=>[]})},
  createImageBitmap:async()=>({width:256,height:256,close(){}}),
  document:{createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>pixels})})}});
 vm.runInContext(read('astronotes-astro.js'),context);
 vm.runInContext(read('astronotes-terrain.js'),context);
 return {terrain:context.AstroNotesTerrain,images};
}
const okTile=()=>({ok:true,status:200,blob:async()=>new Blob(['x'])});
const pointAt=i=>[31+i*0.2,135];
test('the limit covers the whole download, so queued tiles do not run out of time',async()=>{
 let active=0,peak=0,fetched=0;
 const {terrain}=load({fetch:async()=>{active++;fetched++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));
  return {ok:true,status:200,blob:async()=>{await new Promise(r=>setTimeout(r,2));active--;return new Blob(['x']);}};}});
 await Promise.all(Array.from({length:40},(_,i)=>terrain.elevationFromTile(...pointAt(i),11)));
 assert(fetched>=40,'every tile was fetched: '+fetched);
 assert(peak>1&&peak<=8,'peak '+peak);
});
test('a timeout while reading the body is not remembered',async()=>{
 let calls=0;
 const {terrain}=load({fetch:async url=>{if(!url.startsWith(LASER))return okTile();
  return ++calls===1?{ok:true,status:200,blob:async()=>{throw timeoutError();}}:okTile();}});
 await assert.rejects(terrain.elevationFromTile(35.68,139.76,11),{name:'TimeoutError'});
 assert.equal(typeof await terrain.elevationFromTile(35.68,139.76,11),'number');
 assert.equal(calls,2);
});
test('a timeout before the response does not fall back to a coarser layer or the image path',async()=>{
 const layers=[];
 const {terrain,images}=load({fetch:async url=>{layers.push(url);throw timeoutError();}});
 await assert.rejects(terrain.elevationFromTile(35.68,139.76,11),{name:'TimeoutError'});
 assert.equal(layers.length,1);
 assert.equal(images.length,0);
});
test('other fetch failures still use the image path',async()=>{
 const {terrain,images}=load({fetch:async()=>{throw new TypeError('blocked');}});
 assert.equal(await terrain.elevationFromTile(35.68,139.76,11),null);
 assert(images.length>0);
});
test('a failed download gives its place to the next tile',async()=>{
 let n=0;
 const {terrain}=load({fetch:async()=>{if(++n<=8)throw timeoutError();return okTile();}});
 const results=await Promise.allSettled(Array.from({length:12},(_,i)=>terrain.elevationFromTile(...pointAt(i),11)));
 assert(results.some(r=>r.status==='rejected'));
 assert(results.some(r=>r.status==='fulfilled'),'later tiles still load');
});
