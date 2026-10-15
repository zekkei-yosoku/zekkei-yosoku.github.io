import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
function harness(){const makeCtx=()=>new Proxy({getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)})},{get:(o,k)=>k in o?o[k]:()=>{}});const c=vm.createContext({document:{createElement:()=>({width:0,height:0,getContext:makeCtx})}});vm.runInContext(html.slice(html.indexOf('function aimLookSolidSilhouette('),html.indexOf('async function aimLookRender(')),c);return c.aimLookSolidSilhouette;}
test('横長の輪郭でも縦の解像度を保ち、穴埋めの判定範囲を切り取らない',()=>{
 const make=harness(),polygons=[[[-100000,230],[100000,230],[100000,330],[-100000,330]]];
 const full=make(polygons);assert.ok(full.canvas.width/full.width<.02);assert.ok(full.canvas.height/full.height>=1);
 assert.ok(full.width>=200000);assert.ok(full.height>=100);
 const narrow=make([[[10,10],[20,10],[20,20],[10,20]]]);assert.ok(narrow.canvas.width/narrow.width>=1);assert.ok(narrow.canvas.height/narrow.height>=1);
});
