// The clustered closestPoint (2026-11-12) returns exactly what the routine it replaced returned
// (7c0cc457: every polygon in order), on the real projected Skytree outline and on polygons that share edges.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const before=execFileSync('git',['show','7c0cc457:src/features/candidates/composition.js'],{cwd:new URL('.',import.meta.url),encoding:'utf8',maxBuffer:1<<26});
const old=(()=>{const module={exports:{}},near=createRequire(new URL('./src/features/candidates/composition.js',import.meta.url));vm.runInNewContext(before,{module,exports:module.exports,require:near,globalThis:{},Math,Number,Object,Array,Map,Set,WeakMap,Float64Array,JSON,Promise,Error,Infinity,NaN,isFinite});return module.exports;})();
const C=require('./src/features/candidates/composition.js'),A=require('./astronotes-align.js');
let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
function compare(polygons,points){for(const p of points){const a=old.closestPoint(p,polygons),b=C.closestPoint(p,polygons);assert.equal(JSON.stringify(b),JSON.stringify(a),'point '+p);}}
test('the real projected Skytree outline gives the same nearest point and distance',()=>{
 const t=A.targetById('skytree');
 for(const o of [{latitude:35.73,longitude:139.80,elevation:5},{latitude:35.69,longitude:139.70,elevation:30}]){
  const out=A.towerOutline(o,t,{eyeM:1.5}),g=A.geometryFrom(o,t,{eyeM:1.5}),project=A.viewProjector(g.azimuth,g.angle);
  const polygons=out.hitPolygons.map(r=>r.map(q=>project(q[0],q[1])).filter(Boolean)).filter(r=>r.length>=3);assert(polygons.length>1000);
  const xs=polygons.flat().map(q=>q[0]),ys=polygons.flat().map(q=>q[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),w=x1-x0,h=y1-y0;
  const points=[];for(let i=0;i<1500;i++)points.push([x0-w+rnd()*3*w,y0-h+rnd()*3*h]);for(let i=0;i<300;i++){const q=polygons[Math.floor(rnd()*polygons.length)][0];points.push([q[0],q[1]],[q[0]+1e-9,q[1]]);}
  compare(polygons,points);
 }
});
test('shared edges, shared corners, empty input and non-finite points behave the same',()=>{
 const grid=[];for(let i=0;i<12;i++)for(let j=0;j<12;j++)grid.push([[i,j],[i+1,j],[i+1,j+1],[i,j+1]]);
 const points=[];for(let i=0;i<800;i++)points.push([-3+rnd()*18,-3+rnd()*18]);for(let i=0;i<=12;i++)points.push([i,-1],[-1,i],[i,13.5],[13.5,i]);
 compare(grid,points);compare([],[[1,2]]);compare(grid,[[NaN,1],[Infinity,0]]);
});
