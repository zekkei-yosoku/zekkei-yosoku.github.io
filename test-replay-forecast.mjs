import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {replay} from './replay-forecast.mjs';
const core=readFileSync(new URL('./sorami-core.js',import.meta.url),'utf8');
const H=3600000,day=Date.UTC(2026,8,11)-9*H;
const time=Array.from({length:72},(_,i)=>(day-24*H+i*H)/1000);
const hourly={time};
for(const [v,value] of Object.entries({cloud_cover:20,cloud_cover_low:10,cloud_cover_mid:30,cloud_cover_high:40,temperature_2m:5,dew_point_2m:4,relative_humidity_2m:95,precipitation:0,direct_radiation:400}))hourly[v+'_jma_msm']=time.map(()=>value);
const base={asOf:day,dayMs:day,utcOffsetSeconds:32400,runtimeUtcOffsetSeconds:32400,inputKind:'synthetic',place:{latitude:35.73,longitude:139.64,elevation:500,terrain:'basinRim'},homeRaw:{latitude:35.73,longitude:139.64,elevation:400,hourly}};
const manifest={schemaVersion:1,events:['sunrise','sunset','seaOfClouds','rainbow','starrySky'].map(phenomenon=>({...base,id:phenomenon,phenomenon}))};
test('5現象の保存原応答を同じ版へ再生すると出力差0、入力とソースのhashを保存',()=>{
 const a=replay(manifest,{baseline:core,candidate:core});
 assert.equal(a.rows.length,5);assert.equal(a.comparisons.candidate.paired,5);assert.equal(a.comparisons.candidate.changed,0);
 assert.equal(a.accuracyStatus,'not_evaluated');assert.equal(a.versions.baseline.sha256,a.versions.candidate.sha256);
 assert.ok(a.rows.every(x=>/^[a-f0-9]{64}$/.test(x.inputSha256)));
 assert.deepEqual(a,replay(manifest,{baseline:core,candidate:core}));
});
test('ソース差を独立再生し、現行版の係数を上書きしない',()=>{
 const candidate=core.replace('highCloudBonus: 25','highCloudBonus: 0');
 assert.notEqual(candidate,core);
 const a=replay(manifest,{baseline:core,candidate});
 assert.notEqual(a.versions.baseline.sha256,a.versions.candidate.sha256);
 assert.ok(a.comparisons.candidate.changed>=2);
 const b=replay(manifest,{baseline:core,control:core});assert.equal(b.comparisons.control.changed,0);
});
test('時計・入力種別・取得時刻・重複IDの不備を拒否する',()=>{
 for(const change of [{asOf:NaN},{inputKind:'unknown'},{inputKind:'forecast'},{inputKind:'forecast',fetchedAt:day+H}]){
  assert.throws(()=>replay({schemaVersion:1,events:[{...manifest.events[0],...change}]},{a:core,b:core}));
 }
 assert.throws(()=>replay({schemaVersion:1,events:[manifest.events[0],manifest.events[0]]},{a:core,b:core}),/重複/);
});

test('月境界の旧版再生もUTC/Tokyoホストで同じになり、実行環境時差を記録する',async()=>{
 const {execFileSync}=await import('node:child_process');
 const boundary=Date.UTC(2026,8,30,15); // JST 10/1。UTCでは前月。
 const event=structuredClone(manifest.events.find(x=>x.phenomenon==='seaOfClouds'));
 event.asOf=boundary;event.dayMs=boundary;
 event.homeRaw.hourly.time=event.homeRaw.hourly.time.map(t=>t+(boundary-day)/1000);
 for(const [l,h,t] of [[1000,80,3],[975,250,3],[950,500,8],[925,760,7]]){
  event.homeRaw.hourly[`geopotential_height_${l}hPa_jma_msm`]=time.map(()=>h);
  event.homeRaw.hourly[`temperature_${l}hPa_jma_msm`]=time.map(()=>t);
 }
 const old=core.replace('month: Cal.month(ws),','month: new Date(ws).getMonth() + 1,');
 assert.notEqual(old,core);
 const payload=JSON.stringify({manifest:{schemaVersion:1,events:[event]},sources:{old,current:core}});
 const script=`import {readFileSync} from 'node:fs';import {replay} from ${JSON.stringify(new URL('./replay-forecast.mjs',import.meta.url).href)};const x=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(replay(x.manifest,x.sources)));`;
 const results=['UTC','Asia/Tokyo'].map(TZ=>execFileSync(process.execPath,['--input-type=module','-e',script],{input:payload,encoding:'utf8',env:{...process.env,TZ}}));
 assert.equal(results[0],results[1]);
 const row=JSON.parse(results[0]).rows[0];assert.equal(row.runtimeUtcOffsetSeconds,32400);
 assert.ok(row.predictions.old.factors.some(f=>f.label==='型: 湿りはあります'));
 assert.ok(row.predictions.current.factors.some(f=>f.label==='型: 湿りはあります'));
});
