import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),A=require('./astronotes-astro.js'),I=require('./astronotes-iss.js');
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const oldSource=execFileSync('git',['show','5fb848fa:astronotes-iss.js'],{cwd:new URL('.',import.meta.url),encoding:'utf8'});
const oldModule={exports:{}};
Function('module','require','globalThis',oldSource)(oldModule,require,{AstroNotesAstro:A});
const old=oldModule.exports;
const io=await import('./vendor/satellite/io.js'),pr=await import('./vendor/satellite/propagation.js'),tr=await import('./vendor/satellite/transforms.js');
const sat={twoline2satrec:io.twoline2satrec,propagate:pr.propagate,gstime:pr.gstime,eciToEcf:tr.eciToEcf,ecfToLookAngles:tr.ecfToLookAngles};
const tle=I.parseTle(read('./fixtures/iss-20260929.tle')),fromMs=Date.parse('2026-09-30T00:00:00+09:00');
const center={latitude:35.71,longitude:139.81},base={center,radiusKm:300,fromMs,hours:168};
const tick=()=>new Promise(setImmediate);
function exact(a,b,path='result'){
 if(a&&b&&typeof a==='object'&&typeof b==='object'){
  assert.deepEqual(Object.keys(a),Object.keys(b),path+' fields');
  for(const key of Object.keys(a))exact(a[key],b[key],path+'.'+key);
 }else assert(Object.is(a,b),`${path}: ${a} != ${b}`);
}

test('sync and cooperative transits preserve every old field for nonempty moon/sun weeks',async()=>{
 for(const body of ['moon','sun']){
  const options={...base,body},expected=old.transits(sat,tle,options);
  assert(expected.length>0);exact(I.transits(sat,tle,options),expected);
  exact(await I.transitsAsync(sat,tle,options),expected);
 }
 const options={observer:{...center,elevation:40},fromMs,hours:168,minEl:0};
 const expected=old.passes(sat,tle,options);assert(expected.length>20);
 exact(I.passes(sat,tle,options),expected);exact(await I.passesAsync(sat,tle,options),expected);
});

test('coarse scan, refinement and passAt all expose bounded propagation work between yields',async()=>{
 let count=0,last=0,max=0,yields=0,clock=0;
 const instrumented={...sat,propagate(...args){count++;return sat.propagate(...args);}};
 const rows=await I.transitsAsync(instrumented,tle,{...base,body:'moon'},{clock:()=>++clock*9,yieldTask:async()=>{
  max=Math.max(max,count-last);last=count;yields++;await tick();
 }});
 max=Math.max(max,count-last);assert(rows.length>0);assert(yields>1000);
 assert(max<=96,`nested refine/passAt checkpoint lost: ${max} propagation calls`);
});

test('actual task cancellation stops propagation, publishes no rows and leaves the next scan intact',async()=>{
 let current=true,count=0;
 const instrumented={...sat,propagate(...args){count++;return sat.propagate(...args);}};
 await assert.rejects(I.transitsAsync(instrumented,tle,base,{isCurrent:()=>false}),{name:'AbortError'});assert.equal(count,0);
 setTimeout(()=>current=false,0);
 await assert.rejects(I.transitsAsync(instrumented,tle,base,{isCurrent:()=>current}),{name:'AbortError'});
 const stopped=count;assert(stopped>0&&stopped<100000);await tick();await tick();assert.equal(count,stopped);
 const options={...base,hours:24,body:'sun'};
 exact(await I.transitsAsync(sat,tle,options),old.transits(sat,tle,options));
});

test('pass scans also cancel during an actual task and can immediately run again',async()=>{
 let current=true,count=0;
 const instrumented={...sat,propagate(...args){count++;return sat.propagate(...args);}};
 const options={observer:{...center,elevation:40},fromMs,hours:168};
 setTimeout(()=>current=false,0);
 await assert.rejects(I.passesAsync(instrumented,tle,options,{isCurrent:()=>current}),{name:'AbortError'});
 const stopped=count;assert(stopped>0);await tick();assert.equal(count,stopped);
 exact(await I.passesAsync(sat,tle,options),old.passes(sat,tle,options));
});

const controller=read('./src/features/satellites/controller.js');
const extract=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
function makeFunction(code,name,deps){return Function('deps',`const {${Object.keys(deps).join(',')}}=deps;${code};return ${name};`)(deps);}
test('late transit and pass replies after leaving or changing conditions do not replace visible state',async()=>{
 const state={iss:true},iss={tab:'transit',body:'moon',rangeKm:300,result:['old'],passes:['old'],seq:{current:n=>n===generation}};
 let generation=1,release,renders=0,stands=0;
 const deps={iss,viewState:state,toolAllowed:()=>true,AstroNotesISS:{transitsAsync:()=>new Promise(r=>release=r),passesAsync:()=>new Promise(r=>release=r)},
  issStand:async()=>{stands++;return {};},issRender:()=>renders++,issRenderPasses:()=>renders++,IssMap:{open(){}},requestAnimationFrame(){},Date};
 const current=extract(controller,'const issCalculationCurrent =','async function issApplyTransits(');
 const transit=makeFunction(current+extract(controller,'async function issApplyTransits(', '\n/**\n * ISS の帯'), 'issApplyTransits',deps);
 const pass=makeFunction(current+extract(controller,'async function issApplyPasses(', '\n/// 方角図と地図'), 'issApplyPasses',deps);
 const p=transit(1,sat,tle,center);state.iss=false;release([{at:1,center}]);await p;
 assert.deepEqual(iss.result,['old']);assert.equal(renders,0);assert.equal(stands,0);
 state.iss=true;iss.tab='pass';const q=pass(1,sat,tle,center);generation=2;release([{at:2}]);await q;
 assert.deepEqual(iss.passes,['old']);assert.equal(renders,0);
 const next=pass(2,sat,tle,center);release([]);await next;assert.deepEqual(iss.passes,[]);assert.equal(renders,1);
});

test('land candidate scan keeps the old exact selection and cancels before more reads',async()=>{
 const oldController=execFileSync('git',['show','5fb848fa:src/features/satellites/controller.js'],{cwd:new URL('.',import.meta.url),encoding:'utf8'});
 const index=JSON.parse(read('./data/place-index.json')),points=JSON.parse(read('./data/aim-viewpoints.json')).places;
 const row=I.transits(sat,tle,base)[0];assert(row);
 let waterCalls=0,indexCalls=0;
 const deps={issFromPoint:()=>center,iss:{rangeKm:300},aimPlaces:async()=>points,placeIndex:async()=>{indexCalls++;return index;},AstroNotesTerrain:{distanceKm:I.distanceKm,waterAt:async p=>{waterCalls++;return p.map(()=>false);}}};
 const before=makeFunction(extract(oldController,'async function issStand(', '\nfunction issRender('),'issStand',deps);
 const after=makeFunction(extract(controller,'async function issStand(', '\nfunction issRender('),'issStand',deps);
 exact(await after(row),await before(row));
 let current=true,clock=0;waterCalls=0;indexCalls=0;
 await assert.rejects(after(row,{isCurrent:()=>current,clock:()=>++clock*9,yieldTask:async()=>{current=false;await tick();}}),{name:'AbortError'});
 assert.equal(waterCalls,0);assert.equal(indexCalls,0);
 exact(await after(row),await before(row));
});

test('satellite-picker scan checks cancellation inside one satellite and drops late results',async()=>{
 let generation=0,release,calls=0,renders=0;
 const els={issPickSheet:{open:true},issPickVisible:{},issPickQuery:{},issPickInfo:{}};
 const issPick={list:[tle,tle],visible:['old'],visSeq:{next:()=>++generation,current:n=>n===generation}};
 const deps={issPick,issFromPoint:()=>center,viewState:{iss:true},$:id=>els[id],toolAllowed:()=>true,issLoadSat:async()=>sat,
  AstroNotesISS:{passesAsync:async(s,t,o,control)=>{calls++;assert(control.isCurrent());return new Promise(r=>release=r);}},
  issPickRender:()=>renders++,ISS_PRESETS:[],iss:{},issDir16:()=>'',performance,setTimeout};
 const run=makeFunction(extract(controller,'async function issPickFindVisible(', '\nIssMap.setOverlay('),'issPickFindVisible',deps);
 const first=run();await tick();els.issPickSheet.open=false;release([{visible:{}}]);await first;
 assert.equal(calls,1);assert.deepEqual(issPick.visible,['old']);assert.equal(renders,0);
 els.issPickSheet.open=true;issPick.list=[tle];const second=run();await tick();release([]);await second;
 assert.deepEqual(issPick.visible,[]);assert.equal(renders,1);assert.equal(els.issPickVisible.disabled,false);
});
