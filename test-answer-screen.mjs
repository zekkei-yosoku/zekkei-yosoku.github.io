import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),access=require('./sorami-access.js'),html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const grab=name=>{const i=html.indexOf(name);assert.ok(i>=0);return html.slice(i,html.indexOf('\n}',i)+2);};
function fixture({answer=true,allowed=true,status='ready',rounds=6}={}){
 const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,{hidden:false,innerHTML:'',textContent:'',replaceChildren(){this.innerHTML='';}});return elements.get(id);};
 const out=Array.from({length:rounds},(_,i)=>({pid:'sunset',ev:{peak:i,score:74,rank:{key:'good'}}}));
 const c={atAnswers:answer,toolAllowed:()=>allowed,$:el,answerableRounds:()=>out,findSighting:()=>null,savedRoundClient:{state:()=>({status,rounds:[]})},place:{name:'場所'},esc:x=>x,savedRoundUnavailable:()=>'<button data-retry-rounds>再取得</button>',savedPredictionNote:()=>'',RANK_COLOR:{good:'orange'},S:{PHENOMENA:{sunset:{}},longNameOf:()=> '夕焼け',Cal:{relativeDay:()=> '昨日',hhmmRounded:()=> '17:00'},phrasing:()=>({label:'よさそう'})},iconFor:()=>'',outcomeButtons:()=>'<div class="answer">answer form</div>'};
 vm.runInNewContext(grab('function renderPending(')+';renderPending(100,false)',c);return {c,el};
}
test('直URLを独立して解決し、答え合わせは既存records許可を参照する',()=>{
 const c={location:{hash:'#/answers'},S:{PHENOMENA:{}}};vm.runInNewContext(grab('function routeFromHash()')+';this.route=routeFromHash()',c);assert.equal(c.route.answers,true);assert.equal(c.route.records,undefined);
 assert.equal(access.canOpen(['records'],'answers'),true);assert.equal(access.canOpen(['skymap'],'answers'),false);assert.equal(access.canOpen([],'answers'),false);
});
test('専用画面では6件すべて回答でき、予測画面には入口だけ表示する',()=>{
 const a=fixture();assert.equal((a.el('recordsPending').innerHTML.match(/class="answer"/g)||[]).length,6);assert.equal(a.el('recPending').hidden,true);
 const home=fixture({answer:false});assert.match(home.el('recPending').innerHTML,/6件/);assert.match(home.el('recPending').innerHTML,/data-open-answers/);assert.doesNotMatch(home.el('recPending').innerHTML,/class="answer"/);
});
test('未許可では予測や回答フォームをDOMへ描画しない',()=>{for(const answer of [true,false]){const f=fixture({answer,allowed:false});const host=f.el(answer?'recordsPending':'recPending');assert.equal(host.hidden,true);assert.equal(host.innerHTML,'');}});
test('読込中・失敗・候補なしを区別し、失敗では再試行できる',()=>{
 const loading=fixture({status:'loading',rounds:0});assert.match(loading.el('recordsPending').innerHTML,/確認しています/);assert.equal(loading.el('answersEmpty').hidden,true);
 const error=fixture({status:'error',rounds:0});assert.match(error.el('recordsPending').innerHTML,/data-retry-rounds/);assert.equal(error.el('answersEmpty').hidden,true);
 const empty=fixture({rounds:0});assert.equal(empty.el('answersEmpty').hidden,false);assert.equal(empty.el('recordsPending').hidden,true);
});
test('記録と答え合わせは別DOM。写真/地点と採点/書き出しを混在させない',()=>{
 const records=html.slice(html.indexOf('<div id="recordsView"'),html.indexOf('<div id="answersView"'));
 const answers=html.slice(html.indexOf('<div id="answersView"'),html.indexOf('<!-- 終わったのにまだ答えていない回。'));
 assert.match(records,/myRecordsHub/);assert.match(records,/photoPick/);assert.doesNotMatch(records,/recordsPending|recList|exportBtn/);
 assert.match(answers,/recordsPending/);assert.match(answers,/exportBtn/);assert.doesNotMatch(answers,/myRecordsHub|photoPick/);
});
