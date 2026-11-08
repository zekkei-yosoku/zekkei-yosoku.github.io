import test from 'node:test';import assert from 'node:assert/strict';import {createOpportunityScan} from './tools/record-opportunity-scan.mjs';
const day=Date.parse('2026-11-25T00:00:00+09:00'),DAY=86400000,pairs=[{id:'a',body:'moon',target:{id:'skytree',name:'塔'},sourcePlaceId:'a'},{id:'b',body:'sun',target:{id:'tower',name:'別塔'},sourcePlaceId:'b'}];
const row=(at,name='地点')=>({place:{name,latitude:35,longitude:139,eyeHeightAGL:1.5},event:{at}});
const options={pairs,start:day,end:day+2*DAY,isCurrent:()=>true,yieldTask:async()=>{}};
test('publishes all occurrences in day order, not one occurrence per registered pair',async()=>{const published=[];const scan=createOpportunityScan({...options,solve:async(p,d)=>({rows:p.id==='a'?[row(d+7200000),row(d+3600000)]:[row(d+5400000)]}),onDay:s=>published.push(s.rows.map(r=>r.event.at))});await scan.advance(Infinity);assert.equal(scan.state.rows.length,6);assert.equal(published.length,2);assert.deepEqual(published[0],[day+3600000,day+5400000,day+7200000]);assert.equal(scan.state.done,true);});
test('retains partial failures and does not turn them into a successful empty result',async()=>{const scan=createOpportunityScan({...options,solve:async()=>{throw Error('DEM unavailable');}});await scan.advance(Infinity);assert.equal(scan.state.done,true);assert.equal(scan.state.failures.length,4);assert.equal(scan.state.rows.length,0);});
test('cancellation and late results never publish a stale day',async()=>{let current=true,release;const scan=createOpportunityScan({...options,isCurrent:()=>current,solve:()=>new Promise(r=>release=r)});const job=scan.advance();current=false;release({rows:[row(day+3600000)]});await job;assert.equal(scan.state.cancelled,true);assert.equal(scan.state.rows.length,0);assert.equal(scan.state.through,day);});
test('automatically yields and completes all 460 checks with one advance',async()=>{
 const pairs=Array.from({length:460},(_,i)=>({...options.pairs[0],id:String(i)})),checked=[],yielded=[];
 const scan=createOpportunityScan({...options,pairs,end:day+DAY,solve:async(p,d)=>({rows:p.id==='459'?[row(d+3600000)]:[]}),onProgress:s=>checked.push(s.checked),yieldTask:async()=>{yielded.push(scan.state.checked);assert(scan.state.running);assert.equal(scan.state.rows.length,0);}});
 await scan.advance();assert.equal(checked.length,460);assert.equal(yielded.length,459);assert.equal(scan.state.rows.length,1);assert.equal(scan.state.done,true);
});
test('filters elapsed times, wrong-day results and duplicate rows without discarding distinct observers',async()=>{const scan=createOpportunityScan({...options,pairs:pairs.slice(0,1),end:day+DAY,notBefore:day+7200000,solve:async()=>({rows:[row(day+3600000),row(day+7200000),row(day+7200000),{...row(day+7200000),place:{...row(0).place,eyeHeightAGL:10}},row(day+DAY)]})});await scan.advance(Infinity);assert.equal(scan.state.rows.length,2);assert.deepEqual(scan.state.rows.map(r=>r.place.eyeHeightAGL),[1.5,10]);});
test('an empty registered set is a completed empty scope without any solver calls',async()=>{const scan=createOpportunityScan({...options,pairs:[],solve:async()=>{throw Error('must not run')}});await scan.advance();assert.equal(scan.state.done,true);assert.equal(scan.state.through,day+2*DAY);assert.equal(scan.state.checked,0);});
test('extends from the first unchecked day and keeps the full final day of each page',async()=>{
 const called=[];
 const scan=createOpportunityScan({...options,pageRows:1,solve:async(p,d)=>{
  called.push([p.id,d]);
  return {rows:[row(d+3600000)]};
 }});
 assert.equal(scan.extend(day+DAY),false);
 await scan.advance();
 assert.equal(scan.state.through,day+DAY);
 const first=scan.state.rows.map(r=>r.id);
 assert.equal(first.length,2);
 for(let i=1;i<=2;i++){
  assert.equal(scan.extend(day+(i+2)*DAY),true);
  assert.equal(scan.extend(day+(i+3)*DAY),false);
  await scan.advance();
  assert.equal(scan.state.through,day+(i+1)*DAY);
 }
 assert.deepEqual(scan.state.rows.slice(0,2).map(r=>r.id),first);
 assert.equal(new Set(scan.state.rows.map(r=>r.id)).size,6);
 assert.deepEqual(called,[0,1,2].flatMap(i=>pairs.map(p=>[p.id,day+i*DAY])));
});
