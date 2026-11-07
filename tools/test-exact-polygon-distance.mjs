import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {prepareExactPolygonDistance} from './exact-polygon-distance.mjs';
import {patchExactPolygonDistance} from './build-exact-polygon-distance.mjs';
const require=createRequire(import.meta.url),align=require('../astronotes-align.js');
const source=readFileSync(new URL('../astronotes-align.js',import.meta.url),'utf8');
// Load the actual unchanged production evaluator as the reference, not a reimplementation.
const oldBody=source.slice(source.indexOf('    const bounds=polygons?.map(poly=>'),source.indexOf('    const evaluate = (at, st = bodyAt(body, at, obs)) => {'));
const original=Function('polygons','polygonDistance',oldBody+'return distanceToPolygons;');
function exact(a,b){
 if(b!==null&&typeof b==='object'){
  assert.deepEqual(Reflect.ownKeys(a),Reflect.ownKeys(b));
  for(const key of Reflect.ownKeys(b))exact(a[key],b[key]);
 }else assert(Object.is(a,b),String(a)+' !== '+String(b));
}
let seed=918723;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
const compare=(polys,points,ratios)=>{
 const old=original(polys,align.polygonDistance),next=prepareExactPolygonDistance(polys,align.polygonDistance);
 for(const point of points)for(const ratio of ratios)assert(Object.is(next(point,ratio),old(point,ratio)),JSON.stringify({point,ratio,next:next(point,ratio),old:old(point,ratio)}));
};
test('hierarchy keeps exact distances for disconnected, concave, thin and random polygons',()=>{
 const polys=Array.from({length:180},()=>{const x=random()*40-20,y=random()*40-20;return Array.from({length:3+Math.floor(random()*9)},()=>[x+random()*3,y+random()*3]);});
 polys.push([[0,0],[1e-12,0],[1e-12,30],[0,30]],[[30,0],[35,0],[35,8],[33,8],[33,2],[32,2],[32,8],[30,8]]);
 const points=Array.from({length:400},()=>[random()*100-50,random()*100-50]);
 for(const poly of polys)points.push(...poly);
 compare(polys,points,[.1,.2,.9999999999999,1,1.0000000000001,2,10,100]);
 compare([polys[0]],points.slice(0,15),[0,-1,Infinity,NaN]);
 for(const value of [NaN,Infinity,-Infinity])compare([...polys.slice(0,17),[[value,0],[1,0],[0,1]]],[[0,0],[100,100]],[.1,1,10]);
 compare([],[[0,0]],[1]);
});
test('bounds never fill gaps and exact/near-edge contacts remain unchanged',()=>{
 const polys=Array.from({length:80},(_,i)=>[[i*3,0],[i*3+1,0],[i*3+1,1],[i*3,1]]);
 compare(polys,polys.flatMap(poly=>poly.flatMap(([x,y])=>[[x,y],[x+1e-11,y-1e-11],[x-.1,y+.1]])),[.1,.4,1,2,10]);
 const next=prepareExactPolygonDistance(polys,align.polygonDistance);
 assert.equal(next([1.5,.5],1),.5);assert.equal(next([0,.5],1),0);
});
test('large separated geometry checks fewer bounds while preserving original polygon calls',()=>{
 const polys=Array.from({length:1024},(_,i)=>[[i,0],[i+.25,0],[i+.25,1],[i,1]]);
 let oldCalls=0,newCalls=0;
 const old=original(polys,(...a)=>{oldCalls++;return align.polygonDistance(...a);});
 const next=prepareExactPolygonDistance(polys,(...a)=>{newCalls++;return align.polygonDistance(...a);});
 assert.equal(next([-1,.5],.6),old([-1,.5],.6));
 // The hierarchy skips groups with the same running minimum as the old loop.
 assert.equal(newCalls,oldCalls);
 const countBounds=code=>{
  let checks=0;const tracked=Object.create(Math);tracked.hypot=(...args)=>{checks++;return Math.hypot(...args);};
  const c=vm.createContext({Math:tracked});vm.runInContext('globalThis.make='+code,c);
  const value=c.make(polys,align.polygonDistance)([-1,.5],.6);return {value,checks};
 };
 const before=countBounds('(polygons,polygonDistance)=>{'+oldBody+'return distanceToPolygons;}'),after=countBounds(prepareExactPolygonDistance.toString());
 assert.equal(after.value,before.value);assert(after.checks<before.checks/10,JSON.stringify({before,after}));
});
test('original evaluation order preserves legacy cancellation near projected horizons',()=>{
 const x=5e7,p=[x+1e-8,0],far=[[-x,0],[x,0],[x,1]],near=[[p[0],3e-9],[p[0]+1,3e-9],[p[0]+1,1],[p[0],1]];
 const polys=[...Array(8).fill(far),...Array(9).fill(near)];
 assert.equal(original(polys,align.polygonDistance)(p,1),0);
 compare(polys,[p],[.1,1,10]);
 const huge=[[-2e160,-2e160],[1e160,-2e160],[-2e160,1e160]];
 compare([[[-1,-1],[1,-1],[1,1],[-1,1]],...Array(16).fill(huge)],[[0,0]],[1]);
 compare(Array(20).fill([[1e307,1e308],[1e308,1e308],[1e308,1e307]]),[[0,0],[1e307,0]],[.1,1]);
});
test('every skipped group contains only polygons that the original bounds would skip',()=>{
 let checked=0;
 const code=prepareExactPolygonDistance.toString().replace('if(bound>nearest+1e-10||nearest===0)return;',`if(bound>nearest+1e-10||nearest===0){
  if(nearest!==0){const audit=n=>{if(n.indices){for(const i of n.indices)assertSkipped(lower(boxes[i])>nearest+1e-10);}else{audit(n.left);audit(n.right);}};audit(node);}return;}`);
 const c=vm.createContext({assertSkipped:ok=>{checked++;assert(ok);}});vm.runInContext('globalThis.make='+code,c);
 for(const scale of [1e-6,1,5e7,1e150,1e307]){
  const polys=Array.from({length:120},(_,i)=>[[i*scale,0],[(i+.5)*scale,0],[(i+.5)*scale,scale]]);
  const next=c.make(polys,align.polygonDistance),old=original(polys,align.polygonDistance);
  for(const p of [[-scale,0],[0,0],[10*scale,.5*scale],[130*scale,scale]])for(const r of [.1,1,10])assert(Object.is(next(p,r),old(p,r)));
 }
 assert(checked>1000);
});
test('patched prepared views retain all event fields for towers, mountains and every body',()=>{
 const load=s=>{const c=vm.createContext({require:createRequire(new URL('../astronotes-align.js',import.meta.url))});vm.runInContext(s,c);return c.AstroNotesAlign;};
 const old=load(source),next=load(patchExactPolygonDistance(source));
 const observers=[{latitude:35.58386,longitude:139.56853,elevation:87.2},{latitude:35.73874,longitude:139.90204,elevation:5}];
 for(const observer of observers)for(const target of old.TARGETS.filter(t=>['skytree','tokyotower','fuji'].includes(t.id)))for(const body of ['sun','moon','sirius','mercury','venus','mars','jupiter','saturn']){
  const opts={eyeM:20,partId:'__whole',...(target.id==='fuji'?{ridge:[[245,1],[246,2],[247,4],[248,2],[249,1]],ridgeBase:0}:{})};
  const a=old.prepareDailyView(observer,target,body,opts),b=next.prepareDailyView(observer,target,body,opts);
  for(const date of ['2026-11-07','2026-11-25']){
   const at=Date.parse(date+'T00:00:00+09:00');exact(b(at),a(at));
  }
 }
 assert.throws(()=>patchExactPolygonDistance(patchExactPolygonDistance(source)),/boundary changed/);
});
