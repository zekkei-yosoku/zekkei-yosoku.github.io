import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
const S=createRequire(import.meta.url)('./sorami-core.js');
const H=3600000, day=Date.UTC(2026,8,11)-9*H;
const times=Array.from({length:49},(_,i)=>day+i*H);
const series=(cols)=>new S.Series(times,Object.fromEntries(Object.entries(cols).map(([k,v])=>[k,Array.isArray(v)?v:times.map(()=>v)])));
const place={latitude:35.73,longitude:139.64,elevation:300,terrain:'basinRim'};
const input=(home)=>({home,lat:place.latitude,lon:place.longitude,elevation:300,terrain:'basinRim',offsets:{low:series({cloud_cover_low:60}),high:series({cloud_cover_high:40})}});
const makeBundle=(homes,ensemble=null)=>({home:{grid:{elevation:300},byModel:Object.fromEntries(homes.map((h,i)=>[S.MODELS[i],h]))},ensemble});
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const confidenceText=runInNewContext(html.slice(html.indexOf('function confidenceText(ev)'),html.indexOf('// 51メンバーの散らばりを見せる。'))+';confidenceText',{S});

test('朝焼けは朝日・日の出方向、夕焼けは夕日・日の入り方向で説明する',()=>{
 const i=input(series({cloud_cover_high:40,cloud_cover_mid:30,cloud_cover_low:50,precipitation:0}));
 for(const kind of ['sunrise','sunset']){
  const r=S.SCORERS[kind].score(S.SCORERS[kind].window(day,i),i);
  const prose=r.factors.map(f=>f.label+f.detail).join('\n');
  assert.match(prose,kind==='sunrise'?/朝日/:/夕日/);
  assert.match(prose,kind==='sunrise'?/日の出方向/:/日の入り方向/);
  if(kind==='sunrise') assert.doesNotMatch(prose,/夕日|日の入り/);
  assert.doesNotMatch(prose,/すじ雲|さえぎられます/);
 }
});
function confidenceCase(scores,ensScores){
 // 実evaluate・集約・ENS経路を通し、気象式と独立に一致率の欠陥を再現する。
 S.SCORERS.qualityTest={window:()=>[day,day+H],score:([s,e],i)=>({score:i.home.mean('test_score',s,e),base:0,factors:[],unavailable:null}),source:''};
 try{return S.evaluate('qualityTest',day,makeBundle(scores.map(v=>series({test_score:v})),{members:ensScores.map(v=>series({test_score:v}))}),place,{asOf:day});}
 finally{delete S.SCORERS.qualityTest;}
}
test('ENSが完全一致しても、モデルの評価が割れたらAにしない。点数と誤差換算は不変',()=>{
 const r=confidenceCase([0,0,0,90,90,90],Array(51).fill(45));
 assert.equal(r.score,45);assert.equal(r.uncertainty.expectedError,0);
 assert.equal(r.uncertainty.agreement,1);assert.equal(r.uncertainty.modelAgreement,0);
 assert.equal(r.confidence.key,'low');assert.equal(r.confidence.cappedByModelDisagreement,true);
 assert.equal(r.confidence.cappedByDisagreement,false);
 const prose=confidenceText(r);assert.match(prose,/6つの予報モデルは別の評価/);
 assert.doesNotMatch(prose,/0通りは別|点数はあまり動きません/);
});
test('モデルもENSも一致する日は高信頼を維持し、ENS自身の不一致理由と区別する',()=>{
 const r=confidenceCase(Array(6).fill(70),Array(51).fill(70));
 assert.equal(r.confidence.key,'high');assert.equal(S.reliabilityGrade(r.confidence,6).key,'A');
 assert.doesNotMatch(confidenceText(r),/モデル間の不一致/);
 const split=confidenceCase(Array(6).fill(45),[...Array(25).fill(0),...Array(26).fill(90)]);
 assert.equal(split.confidence.key,'low');assert.notEqual(split.confidence.cappedByModelDisagreement,true);
});
test('固定asOfで再生すれば実行日の時計が違っても評価・信頼度・leadは再現する',()=>{
 const bundle=makeBundle([series({cloud_cover_high:40,cloud_cover_mid:30,cloud_cover_low:50,precipitation:0})]);
 const before=Date.now;
 try{
  Date.now=()=>day-10*24*H; const a=S.evaluate('sunset',day+24*H,bundle,place,{asOf:day});
  Date.now=()=>day+50*24*H; const b=S.evaluate('sunset',day+24*H,bundle,place,{asOf:day});
  assert.deepEqual(a,b);assert.equal(a.daysAhead,1);assert.equal(a.asOf,day);
  assert.equal(S.evaluateWeek('sunset',bundle,place,1,day)[0].evaluation.daysAhead,0);
  assert.throws(()=>S.evaluate('sunset',day,bundle,place,{asOf:NaN}),TypeError);
 }finally{Date.now=before;}
});
test('虹の降水全欠測・部分欠測は雨なしと区別し、集約から除外して高評価にしない',()=>{
 const rainy=series({precipitation:1.5,direct_radiation:400,cloud_cover:50});
 for(const rain of [times.map(()=>null),times.map((_,i)=>i===9?null:0)]){
  const missing=series({precipitation:rain,direct_radiation:400,cloud_cover:50});
  const single=S.SCORERS.rainbow.score(S.SCORERS.rainbow.window(day,input(missing)),input(missing));
  assert.equal(single.unavailable?.kind,'missingData');
  const r=S.evaluate('rainbow',day,makeBundle([rainy,missing]),place,{asOf:day});
  assert.equal(r.unavailable?.kind,'missingData');assert.match(r.unavailable.message,/一部モデルの降水/);
  assert.equal(r.models,0); // 有効な高い方だけで予測を出していない。
 }
});
test('虹の既知無降水は0点として母数に残り、期間外モデルは欠測による保留を起こさない',()=>{
 const dry=series({precipitation:0,direct_radiation:null});
 const rain=series({precipitation:1.5,direct_radiation:400});
 const expired=new S.Series([day-2*H,day-H],{precipitation:[0,0],cloud_cover:[0,0]});
 const r=S.evaluate('rainbow',day,makeBundle([dry,dry,rain,expired]),place,{asOf:day});
 assert.equal(r.unavailable,null);assert.equal(r.models,3);assert.equal(r.score,0);
 assert.equal(r.perModel[S.MODELS[0]],0);assert.equal(r.perModel[S.MODELS[1]],0);
});
test('虹は日射欠測の50点上限とモデル数を維持する',()=>{
 const rain=series({precipitation:1.5,direct_radiation:null});
 const r=S.evaluate('rainbow',day,makeBundle([rain,rain]),place,{asOf:day});
 assert.equal(r.unavailable,null);assert.equal(r.models,2);assert.ok(r.score<=50);
});
test('雲海の上下判定に使う配点を保ち、気圧面の逆転を霧頂と断定しない',()=>{
 const cols={temperature_2m:4,dew_point_2m:3.5,relative_humidity_2m:95,cloud_cover:5,precipitation:0};
 for(const [l,h,t] of [[1000,80,3],[975,250,3],[950,500,8],[925,760,7],[900,1000,6],[850,1500,2]]){
  cols[`geopotential_height_${l}hPa`]=h;cols[`temperature_${l}hPa`]=t;
 }
 const home=series(cols),scorer=S.SCORERS.seaOfClouds;
 const scores=[];
 for(const elevation of [200,250,800]){
  const i={...input(home),elevation};const r=scorer.score(scorer.window(day+24*H,i),i);scores.push(r.score);
  const text=r.factors.map(f=>f.label+f.detail).join('\n');
  assert.match(text,/逆転層の下端目安 約250m/);assert.match(text,/250〜500m/);
  assert.doesNotMatch(text,/見下ろせます|雲はこれより上へ育ちません|霧の中に入ります/);
  assert.ok(Math.abs(r.base+r.factors.reduce((x,f)=>x+f.c,0)-r.score)<1e-6);
 }
 // 8b2f3e0の同じ入力を隔離実行して確認。地上80＋上側25は100でclamp。
 assert.deepEqual(scores,[20,20,100]);
});

test('虹の時刻列内全面欠測は期限切れと決めつけず、集約を保留する',()=>{
 const rain=series({precipitation:1.5,direct_radiation:400});
 const blank=series({precipitation:null,direct_radiation:null,cloud_cover:null});
 const r=S.evaluate('rainbow',day,makeBundle([rain,blank]),place,{asOf:day});
 assert.equal(r.unavailable?.kind,'missingData');
});

 test('一覧の欠測日は0点と区別し、日付・理由付きで詳細へ進める',()=>{
 const render=runInNewContext(html.slice(html.indexOf('function renderMatrix(order, now)'),html.indexOf('// 一覧と詳細で、点数'))+';renderMatrix',{
 S,weeks:{rainbow:[{dayMs:day,evaluation:{unavailable:{kind:'missingData',message:'降水データが不足し、虹を判定できません'}}},{dayMs:day+24*H,evaluation:{score:0,rank:0,models:1,confidence:{key:'low'},window:[day+24*H,day+25*H]}}]},
 upcoming:()=>null,esc:s=>String(s),cellBg:()=>'',rampGradient:()=>''
 });
 const output=render(['rainbow'],day);
 assert.match(output,new RegExp(`class="cell void" data-cell="rainbow\\|${day}"`));
 assert.match(output,/aria-label="虹[^"]*降水データが不足し、虹を判定できません/);
 assert.match(output,/<span class="v">—<\/span><\/button>/);
 });
