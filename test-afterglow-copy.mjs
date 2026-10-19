import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),S=require('./sorami-core.js'),P=require('./sorami-prediction.js');
test('朝夕のカード説明は種類と強さの1文で、爆焼けは雲の最高評価だけ',()=>{
 for(const id of ['sunset','sunrise'])for(const style of ['gradient','clouds'])for(const score of [20,50,70,90]){
  const text=S.phrasing(id,S.rankOf(score),{style,descriptive:true}).say;
  assert.ok(text.length<40);assert.equal(text.split('。').filter(Boolean).length,1);
  assert.equal(/爆焼け/.test(text),style==='clouds'&&score>=85);
  if(style==='clouds')assert.doesNotMatch(text,/赤|色|染ま|燃える/,'色名ではなく見え方と迫力で説明する');
  if(score>=40)assert.match(text,style==='gradient'?/グラデーション/:/雲|爆焼け/);
 }
 const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');assert.match(html,/S\.phrasing\(id, ev\.rank, ev\.afterglow\)\.say/);
});
test('種類のない過去データと未知の種類は空一面の雲と断定せず、他現象は不変',()=>{
 for(const id of ['sunset','sunrise'])for(const type of [null,{style:'unknown'},{style:'clouds'}])assert.doesNotMatch(S.phrasing(id,S.rankOf(90),type).say,/雲|爆焼け/);
 assert.equal(S.phrasing('starrySky',S.rankOf(90),{style:'clouds'}).say,S.phrasing('starrySky',S.rankOf(90)).say);
});
test('APIの種類・点数・代表選択の不整合を採用しない',()=>{
 const at=Date.now(),place={latitude:35.7,longitude:139.7};
 const dto=()=>({schemaVersion:1,algorithmVersion:P.VERSION,place:{...place,elevation:null,eyeHeightAGL:1.5,terrain:null},asOf:at,bundle:{fetchedAt:at,utcOffsetSeconds:32400,home:{byModel:{}}},weeks:Object.fromEntries(P.IDS.map(id=>[id,[{dayMs:at,evaluation:{score:90,rank:{key:'spectacular'},factors:[],unavailable:null,...(id==='sunset'?{afterglow:{style:'gradient',scores:{gradient:90,clouds:30}}}:{})}}]]))});
 assert.ok(P.validate(dto(),place));
 for(const mutate of [e=>e.afterglow.style='clouds',e=>e.afterglow.scores.gradient=NaN,e=>e.score=91,e=>e.afterglow.scores.clouds=95]){const d=dto();mutate(d.weeks.sunset[0].evaluation);assert.throws(()=>P.validate(d,place));}
});

test('雨・霧などで種類が不確かな場合は候補がcloudsでも爆焼けと断定しない',()=>{
 for(const id of ['sunset','sunrise'])assert.doesNotMatch(S.phrasing(id,S.rankOf(90),{style:'clouds',descriptive:false}).say,/爆焼け|ダイナミック|グラデーション/);
});
