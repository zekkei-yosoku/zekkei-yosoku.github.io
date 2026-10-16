import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),access=require('./sorami-access.js'),html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const grab=name=>{const i=html.indexOf(name);assert.ok(i>=0);return html.slice(i,html.indexOf('\n}',i)+2);};
function fixture({answer=true,allowed=true,status='ready',rounds=6}={}){
 const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,{hidden:false,innerHTML:'',textContent:'',replaceChildren(){this.innerHTML='';}});return elements.get(id);};
 const out=Array.from({length:rounds},(_,i)=>({pid:'sunset',ev:{peak:i,score:74,rank:{key:'good'}}}));
 const c={atAnswers:answer,toolAllowed:()=>allowed,$:el,answerableRounds:()=>out,findSighting:()=>null,savedRoundClient:{state:()=>({status,rounds:[]})},place:{name:'場所'},esc:x=>x,savedRoundUnavailable:()=>'<button data-retry-rounds>再取得</button>',savedPredictionNote:()=>'',RANK_COLOR:{good:'orange'},S:{PHENOMENA:{sunset:{}},longNameOf:()=> '夕焼け',Cal:{relativeDay:()=> '昨日',hhmmRounded:()=> '17:00'},phrasing:()=>({label:'よさそう'})},iconFor:()=>'',outcomeButtons:()=>'<div class="answer">answer form</div>'};
 vm.runInNewContext(grab('function renderPending(')+';renderPending(100,false)',c);return {c,el};
}
test('旧URLと結果URLを解決し、結果は既存records許可を参照する',()=>{
 for(const hash of ['#/answers','#/forecast/results']){const c={location:{hash},S:{PHENOMENA:{}}};vm.runInNewContext(grab('function routeFromHash()')+';this.route=routeFromHash()',c);assert.equal(c.route.answers,true);assert.equal(c.route.records,undefined);}
 assert.equal(access.canOpen(['records'],'answers'),true);assert.equal(access.canOpen(['skymap'],'answers'),false);assert.equal(access.canOpen([],'answers'),false);
});
test('結果では全件回答でき、予測には件数だけ表示する',()=>{
 const a=fixture();assert.equal((a.el('recordsPending').innerHTML.match(/class="answer"/g)||[]).length,6);assert.equal(a.el('recPending').hidden,true);
 const home=fixture({answer:false});assert.equal(home.el('forecastResultsCount').textContent,'6');assert.equal(home.el('recPending').hidden,true);assert.equal(home.el('recPending').innerHTML,'');
});
test('未許可では予測や回答フォームをDOMへ描画しない',()=>{for(const answer of [true,false]){const f=fixture({answer,allowed:false});const host=f.el(answer?'recordsPending':'recPending');assert.equal(host.hidden,true);assert.equal(host.innerHTML,'');}});
test('読込中・失敗・候補なしを区別し、失敗では再試行できる',()=>{
 const loading=fixture({status:'loading',rounds:0});assert.match(loading.el('recordsPending').innerHTML,/確認しています/);assert.equal(loading.el('answersEmpty').hidden,true);
 const error=fixture({status:'error',rounds:0});assert.match(error.el('recordsPending').innerHTML,/data-retry-rounds/);assert.equal(error.el('answersEmpty').hidden,true);
 const empty=fixture({rounds:0});assert.equal(empty.el('answersEmpty').hidden,false);assert.equal(empty.el('recordsPending').hidden,true);
});
test('撮影ポイントと空の結果を別DOMへ分け、空の写真を予測の振り返りへ置く',()=>{
 const records=html.slice(html.indexOf('<div id="recordsView"'),html.indexOf('<div id="answersView"'));
 const answers=html.slice(html.indexOf('<div id="answersView"'),html.indexOf('<!-- 旧一覧用の描画先。'));
 assert.match(records,/myRecordsHub/);assert.doesNotMatch(records,/photoPick|photoList|recordsPending|recList|exportBtn/);
 assert.match(answers,/recordsPending/);assert.match(answers,/exportBtn/);assert.match(answers,/photoPick/);assert.match(answers,/photoList/);assert.doesNotMatch(answers,/myRecordsHub/);
});
test('結果は予測と同じ場所・メニューで使い、独立した画面見出しを置かない',()=>{
 const menu=html.slice(html.indexOf('<nav class="drawer-list">'),html.indexOf('</nav>',html.indexOf('<nav class="drawer-list">')));
 assert.doesNotMatch(menu,/data-tool="#\/(?:answers|forecast\/results)"/);
 for(const hash of ['#/answers','#/forecast/results','#/records']){const c={location:{hash},S:{PHENOMENA:{}}};vm.runInNewContext(grab('function routeFromHash()')+';'+grab('function isMenuPage()')+';this.menu=isMenuPage()',c);assert.equal(c.menu,true);}
 assert.doesNotMatch(html,/id="answersPlace"|id="answersPlaceName"|<h2>予測の振り返り<\/h2>/);
 assert.match(html,/const placeCardShown = \(\) => \["list", "detail", "answers"\]/);
 const none=fixture({answer:false,rounds:0});assert.equal(none.el('recPending').hidden,true);assert.equal(none.el('forecastResultsCount').hidden,true);
 const denied=fixture({allowed:false});assert.equal(denied.el('forecastResultsCount').hidden,true);assert.equal(denied.el('forecastResultsCount').textContent,'');
});
test('タブの選択とフォーカスを同期し、他の機能ではタブを隠す',()=>{
 const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,{hidden:false,attrs:{},setAttribute(k,v){this.attrs[k]=v;},focus(){c.document.activeElement=this;},id});return elements.get(id);};
 const routes=[],c={$:el,document:{activeElement:el('forecastTab')},atAnswers:false,currentView:'list',pushRoute:hash=>routes.push(hash)};
 const start=html.indexOf('function renderForecastTabs('),end=html.indexOf('function render() {',start);
 vm.runInNewContext(html.slice(start,end),c);
 c.renderForecastTabs('answers');assert.equal(el('forecastTabs').hidden,false);assert.equal(el('resultsTab').attrs['aria-selected'],'true');assert.equal(el('resultsTab').tabIndex,0);assert.equal(el('forecastTab').tabIndex,-1);
 c.renderForecastTabs('records');assert.equal(el('forecastTabs').hidden,true);
 c.renderForecastTabs('list');assert.equal(el('forecastTab').attrs['aria-selected'],'true');
 let prevented=0;el('forecastTabs').onkeydown({key:'ArrowRight',preventDefault(){prevented++;}});assert.equal(routes.pop(),'#/forecast/results');assert.equal(c.document.activeElement.id,'resultsTab');assert.equal(prevented,1);
 c.atAnswers=true;c.currentView='answers';el('forecastTabs').onkeydown({key:'Home',preventDefault(){}});assert.equal(routes.pop(),'#/');assert.equal(c.document.activeElement.id,'forecastTab');
 c.selectForecastTab(true);assert.equal(routes.length,0);
});
