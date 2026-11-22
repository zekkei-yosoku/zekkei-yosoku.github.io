import {sourceHtml,sourceDeclaration,sourceUnit} from './tools/test-source.mjs';
import {createRequire} from 'node:module';
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const h=sourceHtml(),a=h.indexOf('function aimLineAtTime('),c=vm.createContext({});vm.runInContext(h.slice(a,h.indexOf('\n}',a)+2),c);
const pts=[{at:100,latitude:10,longitude:20},{at:200,latitude:20,longitude:40},{at:300,latitude:30,longitude:60}];
test('時刻補間は昇順・降順と端点で連続し区間外を表示しない',()=>{for(const p of [pts,[...pts].reverse()]){const q=c.aimLineAtTime(p,150);assert.equal(q.length,1);assert.equal(q[0].latitude,15);assert.equal(q[0].longitude,30);assert.equal(c.aimLineAtTime(p,200).length,1);assert.equal(c.aimLineAtTime(p,50).length,0);assert.equal(c.aimLineAtTime(p,350).length,0);}});
test('時間が折り返す場合は複数解、無効値は表示しない',()=>{const p=[...pts.slice(0,2),{...pts[2],at:100}];assert.equal(c.aimLineAtTime(p,150).length,2);assert.equal(c.aimLineAtTime(pts,NaN).length,0);assert.equal(c.aimLineAtTime([],100).length,0);});
test('日時は下部固定欄に集約し、見え方と撮影地で同じ時間バーを使う',()=>{
 const p=h.slice(h.indexOf('<script id="previewPresentation">')),css=h.slice(h.indexOf('<style id="previewStyles">'),h.indexOf('</style></head>'));
 assert.match(h,/aria-controls="previewPlaces"[^>]*>撮影地点<\/button>/);
 assert.match(p,/footer\.className='preview-datetime-footer'/);assert.match(p,/footer\.append\(dateRow\)/);
 assert.match(p,/AstroNotesScrollTimeline.mount\(\{root:footerTimeline/,'共通部品でiPhoneの時刻目盛りを横スクロールできる');
 assert.match(p,/mode==='places'\?mapRange:look\.querySelector\('\[data-look-range\]'\)/,'撮影地は出入線、見え方は図の時間幅');
 assert.match(p,/focusin',e=>e\.target\.toggleAttribute\('data-pointer-focus',!keyNav\)/,'指で閉じたカレンダーから戻っても日付に青枠を出さない');assert.match(css,/\[data-pointer-focus\]:focus\{outline:none\}/);
 assert.match(p,/state\.set\(state\.reference\);\}if\(timeDialog\.open\)timeDialog\.close\(\);/,'基準時刻へ移動したら設定を閉じる');
 assert.ok(css.lastIndexOf('#aimView .aim-look-time,')>css.lastIndexOf('#aimView .aim-look-time{'),'重複した時刻バーの非表示が後勝ちになる');
});
test('E79 総点検で見つけた下部欄まわりの不具合を戻さない',()=>{
 const p=h.slice(h.indexOf('<script id="previewPresentation">')),css=h.slice(h.indexOf('<style id="previewStyles">'),h.indexOf('</style></head>'));
 assert.match(h,/e\.target\.closest\("\.mapwrap, canvas, input, select:not\(#sortSelect\), textarea, \.preview-footer-track"\)/,'時間バーの左端からなぞってもメニューを開かない');
 assert.match(p,/root\.addEventListener\('focusin',e=>e\.target\.toggleAttribute\('data-pointer-focus',!keyNav\)\)/,'天体・目標の選択から戻っても青枠を出さない');
 assert.match(css,/#aimView button\[data-pointer-focus\]:focus\{outline:none\}/);
 assert.match(p,/if\(\(!state\|\|look\.hidden\)&&clock\.value\)clock\.value='';/,'図が無い時に前の時刻を残さない');
 assert.match(p,/if\(dateValue&&Number\.isFinite\(aim\.dayMs\)\)/,'日付が入る前に曜日だけを出さない');
 const shared=readFileSync(new URL('./astronotes-datetime-ui.css',import.meta.url),'utf8');assert.match(shared,/grid-template-columns:44px max-content 44px 56px 40px 44px 40px/,'全画面の6列は日付の文字幅に合わせる');
 assert.match(shared,/\.tool-datetime-clock>\.preview-footer-rel\{display:none/);
 const timeline=readFileSync(new URL('./astronotes-scroll-timeline.js',import.meta.url),'utf8');assert.match(timeline,/mode==='date'\?DAY:mode==='hour'\?3600000:MINUTE/,'共通目盛りの矢印は時刻1分・日付1日');
 // Navigation owns non-forecast screens before loading. The runtime case below
 // verifies that a later main-request failure cannot take that screen back.
 assert.match(sourceDeclaration('applyRoute'),/render\(\);[\s\S]*?if \(!predictionNeeded\(\) \|\| predictionDirty \|\| !AstroNotesPrediction\.fresh\([^;]+void load\(false\);/,'予測を使わない画面は取得の成否を待たずURLどおり開く');
 assert.match(p,/focalInput\.value=button\.dataset\.focalPreset;focalInput\.onchange\(\);const sheet=button\.closest\('dialog'\);if\(sheet\?\.open\)sheet\.close\(\);/,'焦点距離の代表値を押したら画角調整を閉じる');
});
test('予測の取得中に天体へ移動すると先に開き、後着の通信失敗でも画面を変えない',async()=>{
 const Library=createRequire(import.meta.url)('./astronotes-library.js'),nodes=new Map(),draws=[];let route=null,rejectRequest,requests=0;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,innerHTML:'',textContent:'',setAttribute(){}});return nodes.get(id);};
 const x=vm.createContext({AstroNotesLibrary:Library,AstroNotesPrediction:{fresh:()=>false,fetch(){requests++;return new Promise((resolve,reject)=>{rejectRequest=reject;});}},
  place:{name:'合成地点',latitude:35,longitude:139},routeFromHash:()=>route,$:node,S:{},forecastSummary:null,renderSkeleton:()=>'',extrasRetry:{reset(){}},
  restoreSharedPlan:()=>null,viewState:{},almanacPlayback:null,almanacTimeline:null,aim:{},SkyMapUI:{leave(){},open(){}},clearAdminView(){},
  currentView:'list',window:{scrollY:0,scrollTo(){}},picked:null,listScrollY:0,selectedDay:{},nextAimCustomRequest(){},localStorage:{setItem(){}},
  render(){x.currentView=x.viewState.skyMap?'skyMap':'list';draws.push(x.currentView);},
  navigator:{onLine:true},console:{warn(){throw Error('stale failure reached error UI');}},document:{removeEventListener(){}},clearTimeout(){},
 });
 vm.runInContext(sourceDeclaration('createForecastRetry')+'\n'+sourceUnit('src/features/forecast/load.js')+'\n'+sourceDeclaration('applyRoute'),x);
 const pending=vm.runInContext('load(false)',x);assert.equal(requests,1);
 route={skymap:true};vm.runInContext('applyRoute()',x);
 assert.deepEqual(draws,['skyMap']);assert.equal(x.currentView,'skyMap');assert.equal(requests,1,'non-forecast navigation makes no new prediction request');
 const before=node('status').innerHTML;rejectRequest(Error('synthetic delayed failure'));await pending;
 assert.deepEqual(draws,['skyMap']);assert.equal(x.currentView,'skyMap');assert.equal(node('status').innerHTML,before,'stale failure does not paint retry UI');
 assert.equal(vm.runInContext('bundle',x),null);assert.equal(vm.runInContext('activePredictionKey',x),null);
});
test('下の時刻欄の高さぶんはページの最後に空け、出典を時刻欄の裏に入れない（2026-10-05 iPhone）',()=>{
 const p=h.slice(h.indexOf('<script id="previewPresentation">')),css=h.slice(h.indexOf('<style id="previewStyles">'),h.indexOf('</style></head>'));
 assert.doesNotMatch(css,/#aimView\{padding-bottom/,'見え方の中で空けると出典の上に余白が出て、出典は時刻欄の裏に入る');
 // 2026-10-15 権限が無いとき（data-locked）は時刻欄を出さないので、その分の余白も取らない
 assert.match(css,/main:has\(>#aimView:not\(\[hidden\],\[data-locked\]\)\)\{padding-bottom:calc\(var\(--aim-footer-h,calc\(84px \+ env\(safe-area-inset-bottom\)\)\) \+ 12px\)\}/);
 assert.match(p,/new ResizeObserver\(\(\)=>\{if\(footer\.offsetHeight\)document\.documentElement\.style\.setProperty\('--aim-footer-h',footer\.offsetHeight\+'px'\);\}\)\.observe\(footer\)/,'空ける高さは時刻欄を測る（安全域を含む）');
 assert.ok(h.indexOf('<div id="aimView"')<h.indexOf('<details class="tiny fav-where" id="footer">'),'出典は見え方の後ろ（main の最後）にある');
});
