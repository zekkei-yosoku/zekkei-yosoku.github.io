import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
const require=createRequire(import.meta.url),S=require('./sorami-core.js'),P=require('./sorami-prediction.js');
const at=Date.parse('2026-10-12T14:50:00Z'),place={latitude:35.68,longitude:139.76,elevation:40.7,eyeHeightAGL:80,terrain:'plain'};
function dto(){return {schemaVersion:1,algorithmVersion:P.VERSION,place,asOf:at,lightPollution:null,bundle:{utcOffsetSeconds:32400,fetchedAt:at,home:{byModel:{test:{times:[at],columns:{visibility:[null],precipitation:[0]}}}}},weeks:Object.fromEntries(P.IDS.map(id=>[id,[{dayMs:at,evaluation:{score:0,rank:{key:'poor'},factors:[],unavailable:null}}]]))};}
test('0点と判定不能を混同せず、欠測・モデル別seriesを復元する',()=>{
 const original=dto();original.weeks.rime[0].evaluation={score:0,factors:[],unavailable:{kind:'terrain',message:'山地ではありません'}};
 assert.equal(P.validate(original,place),original);
 const bundle=P.restore(original.bundle,S),series=bundle.home.byModel.test;
 assert.ok(series instanceof S.Series);assert.equal(series.valueAt('visibility',at),null);assert.equal(series.valueAt('precipitation',at),0);
 assert.equal(original.weeks.sunset[0].evaluation.rank.key,'poor');assert.equal(original.weeks.rime[0].evaluation.rank,undefined);
});
test('高さ違い・不正評価・期限切れ・日付変更の結果を採用しない',()=>{
 assert.throws(()=>P.validate(dto(),{...place,eyeHeightAGL:81.5}));
 const bad=dto();bad.weeks.sunset[0].evaluation.score=NaN;assert.throws(()=>P.validate(bad,place));
 assert.ok(P.fresh(dto(),place,at+300000));assert.ok(!P.fresh(dto(),place,at+900000));assert.ok(!P.fresh(dto(),place,at-1));
 const late=dto();late.asOf=at+29*60000;late.bundle.utcOffsetSeconds=0;
 assert.ok(P.fresh(late,place,at+29*60000));assert.ok(!P.fresh(late,place,at+31*60000));
});
test('同条件の並行取得と画面再表示は新たなAPI計算を求めない',async()=>{
 let calls=0;const client=P.createClient({cacheStorage:undefined,now:()=>at,transport:async()=>{calls++;await Promise.resolve();return new Response(JSON.stringify(dto()));}});
 const values=await Promise.all(Array.from({length:8},()=>client.request(place)));assert.equal(calls,1);assert.equal(values.length,8);
 await client.request(place);assert.equal(calls,1);
});
test('API失敗を永久保存せず、保存領域が使えなくても再試行できる',async()=>{
 let calls=0;const client=P.createClient({now:()=>at,cacheStorage:{open:async()=>{throw Error('保存不可');}},transport:async()=>{calls++;return new Response(JSON.stringify(dto()),{status:calls===1?503:200});}});
 await assert.rejects(client.request(place));assert.ok(await client.request(place));assert.equal(calls,2);
});
test('公開coreには8現象の採点器・係数書き出しを配信しない',()=>{
 assert.equal(typeof S.evaluate,'undefined');assert.equal(typeof S.evaluateWeek,'undefined');
 assert.ok(Object.values(S.SCORERS).every(s=>typeof s.score!=='function'));
 const source=readFileSync(new URL('./sorami-core.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/AFTERGLOW_MODEL|function afterglowScorer|function ensembleSpread/);
 assert.equal(existsSync(new URL('./fixtures/afterglow-model-export.json',import.meta.url)),false);
});
