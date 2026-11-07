import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./src/features/results/controller.js',import.meta.url),'utf8');
const logic=source.slice(source.indexOf('/// 残した回を'),source.indexOf('/// 写真の時刻・位置から、記録に足す項目'));
const now=Date.parse('2026-11-07T08:00:00Z'),H=3600000;
const snapshot={pid:'sunset',peak:now-2*H,window:[now-3*H,now-H],score:72,rank:'good',confidence:'medium',
  capturedAt:now-5*H,algorithmVersion:'wire-v4',scoringVersion:'quality-v1',predictionAsOf:now-6*H,fetchedAt:now-6*H,
  models:3,dataQuality:{status:'partial',reasons:['一部の値は代替']},uncertainty:{expectedError:null},observations:{cloud:30}};
function harness(existing=[]){
 const context=vm.createContext({Date:{now:()=>now},Number,crypto:{randomUUID:()=> 'record'},
  S:{PHENOMENA:{sunset:{}},RANKS:[{key:'good'}],rankOf:()=>({key:'good'}),JstCal:{sameDay:()=>true},outcomeFromActual:()=> 'seen'},
  place:{name:'test',latitude:35,longitude:139},samePlaceAs:()=>true,
  store:{get:()=>[snapshot],set:(_,rows)=>context.saved=rows},savedRoundClient:{state:()=>({rounds:[]})},
  sightings:existing,accountSync:()=>({queuePush(){}}),render(){},shotFields:(_,shot)=>shot});
 vm.runInContext('const ROUND_KEEP_MS=8*86400000,ROUND_ANSWER_MS=7*86400000;'+logic,context);
 return context;
}
test('独立採点と予測への同意を区別し、事前保存時の版・時刻・品質を維持する',()=>{
 const c=harness();
 vm.runInContext(`recordAnswer('sunset',${snapshot.peak},80,null,'independent')`,c);
 assert.equal(c.saved[0].answerKind,'independent');
 for(const key of ['capturedAt','algorithmVersion','scoringVersion','predictionAsOf','fetchedAt','models'])assert.equal(c.saved[0][key],snapshot[key]);
 assert.equal(c.saved[0].dataQuality.status,'partial');assert.equal(c.saved[0].uncertainty.expectedError,null);
 vm.runInContext(`recordAnswer('sunset',${snapshot.peak},72,null,'agreement')`,c);
 assert.equal(c.saved[0].answerKind,'agreement');assert.equal(c.saved[0].score,72);
 vm.runInContext(`recordAnswer('sunset',${snapshot.peak},72,{observedAtMs:${now-H}})`,c);
 assert.equal(c.saved[0].answerKind,'agreement','写真を添えただけでは独立採点にしない');
 vm.runInContext(`recordAnswer('sunset',${snapshot.peak},null,null,'unchecked')`,c);
 assert.equal(c.saved[0].answerKind,'unchecked');assert.equal(c.saved[0].actualScore,null);
});
test('旧記録への写真追加・答え直しで現在の版や時刻を補わない',()=>{
 const c=harness([{id:'old',phenomenon:'sunset',peak:snapshot.peak,score:58,confidence:'low',actualScore:60}]);
 vm.runInContext(`recordAnswer('sunset',${snapshot.peak},60,{observedAtMs:${now-H}})`,c);
 assert.equal(c.saved[0].answerKind,null);assert.equal(c.saved[0].capturedAt,null);assert.equal(c.saved[0].scoringVersion,null);
 assert.equal(c.saved[0].window,undefined);assert.equal(c.saved[0].perModel,undefined);assert.equal(c.saved[0].factors,undefined);
 vm.runInContext(`recordAnswer('sunset',${snapshot.peak},70,null,'independent')`,c);
 assert.equal(c.saved[0].answerKind,'independent');assert.equal(c.saved[0].score,58);assert.equal(c.saved[0].algorithmVersion,null);
});
test('予測複写・旧由来不明・事後保存を集計せず、現象と採点版を混ぜない',()=>{
 const c=harness();
 vm.runInContext(source.slice(source.indexOf('function calibrationGroups'),source.indexOf('// 出るか出ないかの記録')),c);
 c.S.PHENOMENA.rime={};
 const good={...snapshot,phenomenon:'sunset',answerKind:'independent',actualScore:80};
 c.rows=[good,{...good,answerKind:'agreement'},{...good,answerKind:null},{...good,capturedAt:good.window[0]},
  {...good,algorithmVersion:null,scoringVersion:null},{...good,photoOutsideWindow:true},{...good,outcome:'unchecked'},
  {...good,peak:NaN},{...good,window:[good.window[0],good.window[1],now]},
  {...good,scoringVersion:'quality-v2'},{...good,phenomenon:'rime'}];
 const grouped=vm.runInContext('calibrationGroups(rows)',c);
 assert.equal(grouped.length,3);assert.equal(grouped.reduce((n,g)=>n+g.length,0),3);
 assert.equal(grouped[0][0].scoringVersion,'quality-v1');assert.equal(grouped[1][0].scoringVersion,'quality-v2');assert.equal(grouped[2][0].phenomenon,'rime');
});
test('予測値のまま保存した回答はagreement、ゲージを操作した回答はindependent',()=>{
 const photos=readFileSync(new URL('./src/features/photos/controller.js',import.meta.url),'utf8');
 const wire=photos.slice(photos.indexOf('function wireOutcomes'),photos.indexOf('export {'));
 const gauge={value:'72'},out={},save={dataset:{answer:'save'}},same={dataset:{answer:'same'}},unchecked={dataset:{answer:'unchecked'}};
 const box={dataset:{pid:'sunset',peak:String(snapshot.peak),pred:'72',recorded:''},
  querySelector:s=>s==='[data-gauge]'?gauge:s==='[data-gauge-out]'?out:save,
  querySelectorAll:()=>[save,same,unchecked]};
 const calls=[],c=vm.createContext({requireLogin:()=>true,recordAnswer:(...x)=>calls.push(x),answerHtml:()=>'',root:{querySelectorAll:()=>[box]}});
 vm.runInContext(wire+';wireOutcomes(root);',c);
 save.onclick();assert.equal(calls.at(-1)[4],'agreement');
 gauge.value='80';gauge.oninput();save.onclick();assert.equal(calls.at(-1)[2],80);assert.equal(calls.at(-1)[4],'independent');
 same.onclick();assert.equal(calls.at(-1)[4],'agreement');unchecked.onclick();assert.equal(calls.at(-1)[2],null);assert.equal(calls.at(-1)[4],'unchecked');
});
test('集計の表示は未校正スコアを発生確率や精度保証にしない',()=>{
 const tail=source.slice(source.indexOf('const BANDS'),source.indexOf('export {'));
 const c=harness();c.esc=x=>x;c.S.longNameOf=()=> '夕焼け';c.S.JstCal.monthDay=()=> '11/7';
 vm.runInContext(tail,c);c.rows=[{...snapshot,phenomenon:'sunset',actualScore:80,outcome:'seen'}];
 const occurrence=vm.runInContext('occurrenceCalibration(rows)',c),quality=vm.runInContext('qualityCalibration(rows)',c);
 assert.doesNotMatch(occurrence,/class="mark"|点数どおりの水準/);assert.match(occurrence,/発生確率ではありません/);
 assert.doesNotMatch(quality,/点数は合っています/);assert.match(quality,/これだけで予測精度は判断できません/);
});
test('同期/バックアップの入力検査でも由来を保持し、不正値を未知にする',()=>{
 const state=readFileSync(new URL('./src/app/browser-state.js',import.meta.url),'utf8');
 const clean=state.slice(state.indexOf('const isText'),state.indexOf('/**'));
 const c=vm.createContext({S:{PHENOMENA:{sunset:{}}},r:{...snapshot,id:'record',phenomenon:'sunset',answerKind:'independent'}});
 vm.runInContext(clean+';result=cleanSighting(r);',c);
 assert.equal(c.result.scoringVersion,snapshot.scoringVersion);assert.equal(c.result.capturedAt,snapshot.capturedAt);assert.equal(c.result.answerKind,'independent');
 c.r={...c.r,scoringVersion:{bad:true},capturedAt:'yesterday',answerKind:'forecast'};
 vm.runInContext('result=cleanSighting(r);',c);assert.equal(c.result.scoringVersion,null);assert.equal(c.result.capturedAt,null);assert.equal(c.result.answerKind,null);
});
