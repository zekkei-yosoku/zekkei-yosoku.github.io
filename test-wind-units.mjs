import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { historicalURL } from './study-x-sightings.mjs';
import { compareCloudview, summarize } from './study-cloudview-accuracy.mjs';
const S=createRequire(import.meta.url)('./sorami-core.js');
test('通常予報と過去予報は採点器と同じm/sを要求する',()=>{
 const coords=[{latitude:36,longitude:139}];
 for(const url of [S.buildURL(coords,S.HOME_VARS,2,1,370),historicalURL(coords,S.HOME_VARS,'2026-09-03','2026-09-05',370)])
   assert.equal(new URL(url).searchParams.get('wind_speed_unit'),'ms');
});
test('51メンバーも同じ風速単位で取得する',async()=>{
 const original=globalThis.fetch;let requested;
 globalThis.fetch=async url=>{requested=new URL(url);return {ok:true,json:async()=>({hourly:{time:[]}})};};
 try{await S.fetchEnsemble(36,139,2,370);assert.equal(requested.searchParams.get('wind_speed_unit'),'ms');}
 finally{globalThis.fetch=original;}
});
test('観測照合はkm/hの応答をm/sとして黙って採点しない',()=>{
 assert.throws(()=>compareCloudview({records:[]},{hourly:{time:[],wind_speed_10m:[]},hourly_units:{wind_speed_10m:'km/h'}}),/m\/s/);
});
test('判別不能・窓外・欠測を不発例の集計へ含めない',()=>{
 const base={status:'confirmed',withinPredictionWindow:true,observedQuality:'none',score:55};
 const result=summarize([base,{...base,status:'unreviewed'},{...base,withinPredictionWindow:false},
   {...base,score:null},{...base,observedQuality:null},{...base,observedQuality:'weak',score:30}]);
 assert.equal(result.none.count,1);assert.equal(result.none.meanScore,55);
 assert.equal(result.weak.count,1);assert.equal(result.strong.meanScore,null);
});
