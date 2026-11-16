import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {createRecordSearchCache} from './tools/record-search-cache.mjs';
const result=(at=1)=>({rows:[{event:{at}}],failed:0});
const alive=()=>true;
test('recorded-place results use the weather at evaluation time across selected days',async()=>{
 const hour=3600000,day=24*hour,loadedAt=Date.parse('2026-11-16T10:00:00Z');
 let now=loadedAt,calls=0;
 const observer={latitude:35.6,longitude:139.7,elevation:5};
 const selected={at:loadedAt,target:{id:'test-tower'},body:'moon',partId:'__whole',limb:'center',matchMode:'overlap'};
 const shootingDay=at=>Math.floor((at+9*hour)/day)*day-9*hour;
 const context=vm.createContext({require:createRequire(import.meta.url),Date:class extends Date{static now(){return now}},URLSearchParams,AbortController,setTimeout,clearTimeout,
  SkyMapUI:{selectionState:()=>selected},AstroNotesShooting:{conditions:s=>s,day:shootingDay},AstroNotesLibrary:{gate:()=>({})},
  auth:{loginId:'test'},accessState:{generation:1},flowOwner:'test',flowGeneration:1,active:alive,toolAllowed:alive,
  MyPlacesUI:{discoveryRevision:()=>1,discoveryPoints:()=>[{place:observer}],discoverySearch:async()=>result(++calls)}});
 vm.runInContext(readFileSync(new URL('./astronotes-atmosphere.js',import.meta.url),'utf8'),context);
 const controller=readFileSync(new URL('./src/features/explore/controller.js',import.meta.url),'utf8');
 vm.runInContext(controller.slice(controller.indexOf("let discoveryTab='records'"),controller.indexOf('function chooseDiscovery(')),context);
 const atmosphere=context.AstroNotesAtmosphere;
 atmosphere.configure('auto');
 const loadWeather=async()=>{
  const raw={hourly_units:{surface_pressure:'hPa',temperature_2m:'°C'},hourly:{time:[loadedAt/1000,(loadedAt+2*hour)/1000],surface_pressure:[1020,1018],temperature_2m:[9,10]}};
  await atmosphere.load(observer,loadedAt,{now,fetcher:async()=>({ok:true,json:async()=>raw})});
 };
 const run=request=>context.recordRows(request,()=>context.recordCurrent(request));
 await loadWeather();
 const first=context.recordRequest(),tomorrow=context.recordRequest(loadedAt+day);
 assert.notEqual(first.key,tomorrow.key,'the shooting dates still have separate results');
 assert.equal(tomorrow.atmosphere,first.atmosphere,'weather freshness has one clock for all shooting dates');
 assert.equal((await run(first)).rows[0].event.at,1);
 now+=hour-1;
 assert.equal((await run(context.recordRequest())).rows[0].event.at,1,'fresh results still reuse the exact calculation');
 now++;
 const expired=context.recordRequest();
 assert.equal(context.recordCurrent(first),false,'the expired calculation is no longer current');
 assert.equal((await run(expired)).rows[0].event.at,2);
 await loadWeather();
 const refreshed=context.recordRequest();
 assert.equal(context.recordCurrent(expired),false,'new weather supersedes the fallback result');
 assert.equal((await run(refreshed)).rows[0].event.at,3);
 assert.equal((await run(context.recordRequest())).rows[0].event.at,3);
});
test('completed positive and empty results reuse exact keys without sharing mutable rows',async()=>{
 const c=createRecordSearchCache(),solve=async()=>result();
 const a=await c.read('day1',solve,alive);a.rows[0].event.at=99;
 assert.deepEqual(await c.read('day1',solve,alive),result());
 assert.deepEqual(await c.read('day2',async()=>({rows:[],failed:0}),alive),{rows:[],failed:0});
 assert.deepEqual(await c.read('day2',()=>{throw Error('should reuse complete empty');},alive),{rows:[],failed:0});
 assert.deepEqual(c.stats,{hits:2,solves:2,joins:0});
});
test('overlapping callers share work, and a cancelled caller cannot receive it',async()=>{
 const c=createRecordSearchCache();let release,open=true,live;
 const a=c.read('day',l=>{live=l;return new Promise(r=>release=r);},()=>open);
 const b=c.read('day',()=>{throw Error('must join');},alive);
 await Promise.resolve();open=false;assert(live());release(result());
 assert.equal((await a).cancelled,true);assert.deepEqual(await b,result());assert.equal(c.stats.solves,1);
});
test('failed, cancelled and rejected work can be retried',async()=>{
 const c=createRecordSearchCache({limit:1});let keep=true,release;
 const old=c.read('cancelled',()=>new Promise(r=>release=r),()=>keep);
 await Promise.resolve();keep=false;release(result());assert.equal((await old).cancelled,true);
 assert.deepEqual(await c.read('cancelled',()=>result(2),alive),result(2));
 await c.read('partial',()=>({rows:[{event:{at:3}}],failed:1}),alive);
 await assert.rejects(c.read('partial',()=>{throw Error('network');},alive),/network/);
 assert.deepEqual(await c.read('partial',()=>result(4),alive),result(4));
 assert.deepEqual(await c.read('cancelled',()=>result(5),alive),result(5),'LRU cap evicts prior success');
});
test('returning starts the interrupted pair without waiting for an obsolete solver', {timeout:1000},async()=>{
 const c=createRecordSearchCache();let keep=true,release;
 const old=c.read('day',()=>new Promise(r=>release=r),()=>keep);
 await Promise.resolve();keep=false;
 assert.deepEqual(await c.read('day',()=>result(2),alive),result(2));
 release(result(9));assert.equal((await old).cancelled,true);
 assert.deepEqual(await c.read('day',()=>{throw Error('must reuse the new result');},alive),result(2));
});
