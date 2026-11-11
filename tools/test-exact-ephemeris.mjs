import test from 'node:test';
import assert from 'node:assert/strict';
import {beforePromotion} from './before-promotion.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {createExactTimeMemo} from './exact-time-memo.mjs';

const source=beforePromotion('astronotes-astro.js'),patched=readFileSync(new URL('../astronotes-astro.js',import.meta.url),'utf8');
function load(code){const context=vm.createContext({});vm.runInContext(code,context);return context.AstroNotesAstro;}
// Object.is retains NaN, signed zero and every bit of each number. No rounding,
// tolerances or JSON conversion can conceal a changed astronomical result.
function exact(actual,expected,path='result'){
 if(expected!==null&&typeof expected==='object'){
  assert.deepEqual(Reflect.ownKeys(actual),Reflect.ownKeys(expected),path+' keys');
  for(const key of Reflect.ownKeys(expected))exact(actual[key],expected[key],path+'.'+String(key));
 }else assert(Object.is(actual,expected),path+': '+actual+' !== '+expected);
}
const baseline=load(source),current=load(patched);

test('trial patch preserves the public API and every original calculation body',()=>{
 assert.deepEqual(Object.keys(current),Object.keys(baseline));
 for(const name of ['sunPosition','moonGeocentric']){
  assert.equal(current[name].name,name);assert.equal(current[name].length,baseline[name].length);
  assert(Object.values(baseline[name](Date.UTC(2026,10,25))).every(value=>typeof value==='number'),'shallow-copy contract: ephemerides contain scalar numbers only');
 }
 assert(source.includes('function sunPosition(ms) {'));
});

test('exact numeric keys, bounded LRU, fresh objects and uncached coercion/errors',()=>{
 let calls=0;const memo=createExactTimeMemo(ms=>{calls++;return {value:ms};},3);
 const first=memo(1);first.value=99;first.extra=true;
 assert.deepEqual(memo(1),{value:1});assert.equal(calls,1);
 assert.notEqual(memo(1),memo(1));
 memo(2);memo(3);memo(1);memo(4); // 2 is least recently used.
 assert.equal(calls,4);memo(1);assert.equal(calls,4);memo(2);assert.equal(calls,5);
 memo(1+.0000000000000002);assert.equal(calls,6,'adjacent doubles stay distinct');
 for(const key of [NaN,Infinity,-Infinity,undefined,null,'1',new Date(1),-0]){
  const before=calls;memo(key);memo(key);assert.equal(calls,before+2);
 }
 const throwing=createExactTimeMemo(()=>{throw Error('raw failure');});assert.throws(()=>throwing(1),/raw failure/);
});

test('both ephemerides preserve fractional times, Date/coercion and invalid input',()=>{
 const times=[0,-0,1,-1,Date.UTC(2000,0,1,12),Date.UTC(2026,10,25),Date.UTC(2028,1,29),Date.UTC(2030,11,31,23,59,59,999),NaN,Infinity,-Infinity,undefined,null,'12345',new Date('2026-11-25T00:00:00Z')];
 for(const name of ['sunPosition','moonGeocentric']){
  for(const at of times)for(let repeated=0;repeated<2;repeated++)exact(current[name](at),baseline[name](at),name+' '+String(at));
  const at=Date.UTC(2026,10,25)+.125,result=current[name](at);for(const key of Object.keys(result))result[key]=0;
  exact(current[name](at),baseline[name](at),name+' mutated result');
  for(const at of [Symbol('timestamp'),1n]){
   let expected,actual;try{baseline[name](at);}catch(e){expected=e.name;}
   try{current[name](at);}catch(e){actual=e.name;}assert.equal(actual,expected);
  }
 }
});

test('full Sun/Moon output remains bit-identical across scan times, observers, heights and air',()=>{
 const start=Date.parse('2026-11-25T00:00:00+09:00');let checks=0;
 for(const body of ['sun','moon'])for(let j=0;j<24;j++)for(let i=0;i<=144;i++){
  const at=start+i*600000+(j%3===0?.125:0),obs={latitude:35.58386+j*.0004,longitude:139.56853+j*.0007,elevation:87.2+j*1.1};
  exact(current[body](at,obs),baseline[body](at,obs),body+' '+j+'/'+i);checks++;
 }
 const dates=[Date.UTC(2000,0,1,12),Date.UTC(2026,0,1),Date.UTC(2028,1,29,23,59,59,999),Date.UTC(2030,11,31)];
 const sites=[[-89,0],[-45,-179.9],[0,0],[35.73874,139.90204],[89,179.9]];
 for(const at of dates)for(const [latitude,longitude]of sites)for(const elevation of [-400,0,1.5,20,150,700,3776])for(const air of [{},{pressureHPa:800,temperatureC:-15},{pressureHPa:1050,temperatureC:35}])for(const body of ['sun','moon']){
  const obs={latitude,longitude,elevation};exact(current[body](at+.375,obs,air),baseline[body](at+.375,obs,air));checks++;
 }
 assert.equal(checks,7800);
});

test('evicting more than the production limit retains exact results',()=>{
 const start=Date.UTC(2026,10,25),api=load(patched);
 for(const name of ['sunPosition','moonGeocentric']){
  const initial=api[name](start);
  for(let i=1;i<=4100;i++)exact(api[name](start+i*.5),baseline[name](start+i*.5));
  exact(api[name](start),initial);
 }
});

test('64 observers reuse 145 lunar ephemerides without changing topocentric results',t=>{
 const instrument=code=>code.replace('    const T = centuries(ms);\n    const Lp', '    globalThis.moonCount=(globalThis.moonCount||0)+1;\n    const T = centuries(ms);\n    const Lp');
 function context(code){const ctx=vm.createContext({});vm.runInContext(instrument(code),ctx);return ctx;}
 const old=context(source),next=context(patched),start=Date.UTC(2026,10,25),run=ctx=>{
  let sum=0;const begin=performance.now();
  for(let j=0;j<64;j++)for(let i=0;i<=144;i++)sum+=ctx.AstroNotesAstro.moon(start+i*600000,{latitude:35.58386+j*.0004,longitude:139.56853+j*.0007,elevation:87.2+j*.1}).azimuth;
  return {ms:Math.round(performance.now()-begin),sum};
 };
 const before=run(old),after=run(next);assert.equal(before.sum,after.sum);assert.equal(old.moonCount,9280);assert.equal(next.moonCount,145);
 t.diagnostic(JSON.stringify({beforeMs:before.ms,afterMs:after.ms,beforeEphemerides:old.moonCount,afterEphemerides:next.moonCount}));
});
