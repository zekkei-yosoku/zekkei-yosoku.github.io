// 2026-11-26 trial 探すの全画面地図（段階②）の受入: 撮影地点が中心／目標物が中心の切替、目標物中心の方位リング・
// 重なる範囲（帯）・天体の中心が先端に来る線と時刻、記録の地点のその日の重なり、線のタップ→「ここを撮影地点にする」、
// 一覧と「新しい地点を探す」の下部シート（地図のピン、候補→見え方→シートへ戻る）。
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.TARGET_MODE_BASE||'http://127.0.0.1:8992/trial/';
const out=process.env.TARGET_MODE_OUT||'/tmp/astronotes-target-mode';
const tools=['records','tower','diamond','pearl','skymap','multiscene'];
const engines=(process.env.TARGET_MODE_ENGINES||'chrome,webkit').split(',');
const widths=(process.env.TARGET_MODE_WIDTHS||'320,390').split(',').map(Number);
const themes=(process.env.TARGET_MODE_THEMES||'light,dark').split(',');
const OBSERVER={latitude:35.5869,longitude:139.5744,elevation:30,name:'確認地点',eyeHeightAGL:1.5};
// 記録の地点: 確認地点（12/24の月がスカイツリーに重なる）と、方向の違う地点（重ならない）。
const FAVORITES=[{id:'fav-near',name:'確認地点の記録',latitude:35.5869,longitude:139.5744,elevation:30,groundManualM:30,eyeHeightAGL:1.5},
 {id:'fav-off',name:'北の記録',latitude:35.95,longitude:139.75,elevation:20,groundManualM:20,eyeHeightAGL:1.5}];
const view=page=>page.evaluate(()=>{const v=document.getElementById('skyMapView');return {stage:v.dataset.exploreStage,sheet:v.hasAttribute('data-explore-sheet'),center:v.dataset.mapCenter||'obs'};});
const state=page=>page.evaluate(()=>AstroNotesMapWorkspace.targetState());

async function open(browser,width,theme,{fixture=null}={}){
 const context=await browser.newContext({viewport:{width,height:width===320?568:844},locale:'ja-JP',timezoneId:'Asia/Tokyo',colorScheme:theme,reducedMotion:'reduce'});
 await context.addInitScript(t=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-ui',loginId:'target-mode',tools:t})),tools);
 if(fixture){await context.addInitScript(fixture,tools);await context.addInitScript(()=>localStorage.setItem('sorami.skyMap:date-test',JSON.stringify({body:'moon',targetId:'skytree',partId:'tip',limb:'center',matchMode:'limb',at:Date.parse('2026-11-05T03:58:31+09:00')})));}
 await context.route('**/*',route=>{const u=new URL(route.request().url());
  if(u.origin===new URL(base).origin)return route.continue();
  if(/zekkei-api|localhost:8787/.test(u.origin))return route.fulfill({json:{allowed:true,tool:'skymap',loginId:fixture?'date-test':'target-mode',tools,favorites:[],sightings:[],records:[],rev:1}});
  return route.abort();});
 const page=await context.newPage();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'index.html#/explore');
 await page.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof aimTargetList==='function'&&typeof startupSessionReady!=='undefined'&&typeof AstroNotesCandidatePicker==='object');
 if(fixture)await page.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>25;aimBuildingDays=async()=>[];navigationHistory.pushRoute('#/explore');SkyMapUI.setTarget('skytree');const b=document.getElementById('skyMapBody');b.value='moon';b.onchange();SkyMapUI.setTime(Date.parse('2026-11-05T03:58:31+09:00'));});
 else await page.evaluate(async ([o,f])=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>30;aimBuildingDays=async()=>[];navigationHistory.pushRoute('#/explore');
  for(let i=0;i<100&&!SkyMapUI.workspaceHost();i++)await new Promise(r=>setTimeout(r,100));
  const t=aimTargetList().find(x=>x.id==='skytree');SkyMapUI.workspaceHost().restoreTarget({target:structuredClone(t),custom:false});SkyMapUI.workspaceHost().restoreObserver(o);
  const b=document.getElementById('skyMapBody');b.value='moon';b.dispatchEvent(new Event('change',{bubbles:true}));SkyMapUI.setTime(Date.parse('2026-12-24T16:41:00+09:00'));
  // 記録の地点は探すの記録タブと同じ入口（観測記録のある撮影地点）。記録探索の既存検査と同じく、その入口に合成の地点を返させる。
  MyPlacesUI.discoveryPoints=()=>f.map(p=>({place:{...p,discoveryKey:p.id},record:{result:'seen'}}));MyPlacesUI.imported();},[OBSERVER,FAVORITES]);
 await page.waitForFunction(()=>document.getElementById('skyMapView').dataset.exploreStage==='map'&&document.getElementById('skyMapView').classList.contains('map-ws'));
 return {context,page,errors};
}
async function toTarget(page){
 await page.locator('#mapWsMode [data-mode=target]').click();
 await page.waitForFunction(()=>{const s=AstroNotesMapWorkspace.targetState();return s.line&&!s.lineBusy&&s.band>0&&!document.getElementById('mapWsCardView').disabled&&/中心が先端に来る線: /.test(document.getElementById('mapWsCardMeta').textContent);},null,{timeout:30000});
}
// 地図上の緯度経度を画面の点へ。
const screenPoint=(page,p)=>page.evaluate(p=>{const m=SkyMapUI.workspaceHost().map,[x,y]=m.project(p.latitude,p.longitude),r=document.getElementById('skyMapCanvas').getBoundingClientRect();return {x:r.left+x,y:r.top+y,inside:x>8&&y>8&&x<r.width-8&&y<r.height-8};},p);

async function records(type,engine,width,theme,results){
 const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});const label=`${engine}-${width}-${theme}`;
 try{
  const {context,page,errors}=await open(browser,width,theme);
  try{
   assert.equal(await page.locator('#mapWsMode [data-mode=obs]').getAttribute('aria-pressed'),'true');
   await toTarget(page);
   assert.deepEqual(await view(page),{stage:'map',sheet:false,center:'target'});
   const layout=await page.evaluate(()=>{const r=n=>n.getBoundingClientRect(),mode=r(document.getElementById('mapWsMode')),north=r(document.getElementById('mapWsNorth')),rail=Math.min(...[...document.querySelectorAll('#skyMapView .sky-map-wide .mapzoom>button,#skyMapView .sky-map-wide .map-layers-btn')].filter(n=>n.offsetParent).map(n=>r(n).left)),buttons=[...document.querySelectorAll('#mapWsMode button,#mapWsCardView,#mapWsCardSecond')].filter(b=>b.offsetParent).map(b=>r(b).height);
    return {overlapNorth:mode.left<north.right-1,overlapRail:mode.right>rail+1,buttons,overflowX:document.documentElement.scrollWidth>innerWidth+1};});
   assert(!layout.overlapNorth&&!layout.overlapRail&&!layout.overflowX&&layout.buttons.every(h=>h>=40),label+': '+JSON.stringify(layout));
   const card=await page.evaluate(()=>[document.getElementById('mapWsCardPlace').textContent,document.getElementById('mapWsCardMeta').textContent,document.getElementById('mapWsCardView').innerText.trim(),document.getElementById('mapWsCardSecond').innerText.trim()]);
   assert.equal(card[0],'東京スカイツリーを中心に（月）');assert.match(card[1],/^中心が先端に来る線: 月の出側 \d\d:\d\d〜\d\d:\d\d ・ 月の入側 \d\d:\d\d〜\d\d:\d\d$/);assert.deepEqual(card.slice(2),['新しい地点を探す','一覧']);
   const s=await state(page);assert.equal(s.line.length,2,label+': 月の出側と入側の線');assert(s.band>0,label+': 重なる範囲がある');
   // 中心が先端に来る線は、重なる範囲（全体の帯）の中にある（帯は下端まで・大気差ぶん広い）。
   const inside=await page.evaluate(async()=>{const lines=await AstroNotesAlign.line(SkyMapUI.selectionState().target,'moon',AstroNotesSkyMap.dayStart(SkyMapUI.selectionState().at),{partId:'__whole',limb:'center',eyeM:1.5,elevationAt:async()=>30});
    const pts=lines.flatMap(l=>l.points).filter(p=>p.altitude>.5);return {n:pts.length,inside:pts.filter(p=>AstroNotesMapWorkspace.inBand(p)).length};});
   assert(inside.n>10&&inside.inside===inside.n,label+': 線は全距離で帯の中 '+JSON.stringify(inside));
   // 記録の地点: その日に実際に重なる地点だけ時刻が付く（段階①のカードと同じ判定）。
   await page.waitForFunction(()=>AstroNotesMapWorkspace.targetState().records?.length===2);
   const rec=(await state(page)).records;const near=rec.find(r=>r.name==='確認地点の記録'),off=rec.find(r=>r.name==='北の記録');
   assert(near.windows.length>0&&off.windows.length===0,label+': '+JSON.stringify(rec));
   const expected=await page.evaluate(o=>{const s=SkyMapUI.selectionState(),v=AstroNotesAlign.prepareDailyView(o,s.target,'moon',{partId:'__whole',eyeM:0}),hits=[];
    for(let at=Date.parse('2026-12-24T16:00:00+09:00');at<=Date.parse('2026-12-24T17:20:00+09:00');at+=20000)if(v(at,at)[0]?.intersects)hits.push(at);return hits[0];},{latitude:35.5869,longitude:139.5744,elevation:31.5});
   assert(Math.abs(near.windows[0].from-Math.ceil(expected/60000)*60000)<=60000,label+': 記録の重なりの始まり '+JSON.stringify({near,expected}));
   assert.match(await page.locator('#mapWsCardOverlap').innerText(),/^この日重なる記録の地点 1件（確認地点の記録 \d\d:\d\d）$/);
   await page.screenshot({path:`${out}/${label}-target.png`});
   // 記録のピンをタップ→その地点のカード（重なる時間）→戻す。
   const pin=await screenPoint(page,FAVORITES[0]);
   if(pin.inside){await page.mouse.click(pin.x,pin.y);await page.waitForFunction(()=>AstroNotesMapWorkspace.targetState().selection?.kind==='record');
    await page.waitForFunction(()=>document.getElementById('mapWsCardPlace').textContent==='確認地点の記録');assert.match(await page.locator('#mapWsCardOverlap').innerText(),/^重なる \d\d:\d\d〜\d\d:\d\d$/);
    await page.locator('#mapWsCardSecond').click();await page.waitForFunction(()=>!AstroNotesMapWorkspace.targetState().selection);}
   // 線の近くをタップ→線上に吸着→「ここを撮影地点にする」→撮影地点が中心、名前は線上の地点、時刻はその点の時刻。
   const target=await page.evaluate(()=>{const m=SkyMapUI.workspaceHost().map,c=document.getElementById('skyMapCanvas'),w=c.clientWidth,h=c.clientHeight;
    return AstroNotesMapWorkspace.targetState().line.length&&null;});void target;
   const linePoint=await page.evaluate(async()=>{const s=SkyMapUI.selectionState(),lines=await AstroNotesAlign.line(s.target,'moon',AstroNotesSkyMap.dayStart(s.at),{partId:'__whole',limb:'center',eyeM:1.5,elevationAt:async()=>30});
    const m=SkyMapUI.workspaceHost().map,c=document.getElementById('skyMapCanvas'),ok=p=>{const [x,y]=m.project(p.latitude,p.longitude);return x>60&&y>70&&x<c.clientWidth-70&&y<c.clientHeight-20;};
    const p=lines.find(l=>l.side==='rise').points.find(q=>q.distanceKm>3&&ok(q));return p&&{latitude:p.latitude,longitude:p.longitude,at:p.at};});
   assert(linePoint,label+': 画面内に線の点がある');
   const lp=await screenPoint(page,linePoint);await page.mouse.click(lp.x+6,lp.y);
   await page.waitForFunction(()=>AstroNotesMapWorkspace.targetState().selection?.kind==='line');
   const sel=(await state(page)).selection;await page.waitForFunction(()=>document.getElementById('mapWsCardPlace').textContent==='線上の地点');
   assert.match(await page.locator('#mapWsCardMeta').innerText(),/^月の中心が先端に来るのは \d\d:\d\d$/);assert.equal((await page.locator('#mapWsCardView').innerText()).trim(),'ここを撮影地点にする');
   await page.locator('#mapWsCardView').click();
   await page.waitForFunction(()=>document.getElementById('skyMapView').dataset.mapCenter==='obs'&&SkyMapUI.selectionState().observer?.name==='線上の地点');
   const after=await page.evaluate(()=>{const s=SkyMapUI.selectionState();return {at:s.at,lat:s.observer.latitude,lon:s.observer.longitude};});
   assert.equal(after.at,Math.round(sel.at/60000)*60000);assert(Math.abs(after.lat-sel.latitude)<1e-6&&Math.abs(after.lon-sel.longitude)<1e-6);
   assert.equal(await page.locator('#mapWsMode [data-mode=obs]').getAttribute('aria-pressed'),'true');
   // 線の上なので、その時刻に月の円盤が塔に掛かる（カードの重なる時間がその時刻を含む）。
   const minute=new Date(after.at+32400000),m=minute.getUTCHours()*60+minute.getUTCMinutes();
   await page.waitForFunction(m=>{const ov=document.getElementById('mapWsCardOverlap').textContent.match(/重なる (\d\d):(\d\d)〜(\d\d):(\d\d)/);return !!ov&&+ov[1]*60+ +ov[2]<=m+1&&m-1<=+ov[3]*60+ +ov[4];},m,{timeout:15000})
    .catch(async()=>assert.fail(label+': 線上の点ではその時刻に重なる '+JSON.stringify({ov:await page.locator('#mapWsCardOverlap').innerText(),m})));
   // 一覧→下部シート（記録）。地図は上に残り、閉じると目標物が中心の地図。
   await toTarget(page);await page.locator('#mapWsCardSecond').click();
   await page.waitForFunction(()=>document.getElementById('skyMapView').hasAttribute('data-explore-sheet'));
   assert.deepEqual(await view(page),{stage:'search',sheet:true,center:'target'});
   const sheet=await page.evaluate(()=>{const r=n=>n.getBoundingClientRect(),c=r(document.getElementById('skyMapCanvas')),content=r(document.getElementById('skyMapContent'));
    return {mapH:c.height,mapBottom:c.bottom,sheetTop:content.top,records:document.getElementById('exploreDiscovery-records')?.getAttribute('aria-selected'),close:r(document.getElementById('exploreBackToMap')).height,conditionsHidden:!document.getElementById('skyMapBody').closest('.condition-field').offsetParent,
    docScroll:document.scrollingElement.scrollHeight>innerHeight+1&&getComputedStyle(document.documentElement).overflow!=='hidden'};});
   assert(sheet.mapH>=120&&Math.abs(sheet.mapBottom-sheet.sheetTop)<=2&&sheet.records==='true'&&sheet.close>=44&&sheet.conditionsHidden&&!sheet.docScroll,label+': '+JSON.stringify(sheet));
   // 下部シートの記録タブも同じ地点（その日重なる記録の地点）を挙げる。
   await page.waitForFunction(()=>document.getElementById('exploreRecordedPlaces')?.textContent.includes('確認地点の記録'),null,{timeout:30000});
   assert(!(await page.locator('#exploreRecordedPlaces').innerText()).includes('北の記録'),label+': 重ならない記録の地点は挙げない');
   await page.screenshot({path:`${out}/${label}-sheet.png`});
   await page.locator('#exploreBackToMap').click();assert.deepEqual(await view(page),{stage:'map',sheet:false,center:'target'});
   // 条件帯からはいつもの撮影条件（全画面）。地図へ戻ると目標物が中心のまま。
   await page.locator('#mapWsTitle').click();assert.deepEqual(await view(page),{stage:'search',sheet:false,center:'target'});
   await page.locator('#exploreBackToMap').click();assert.deepEqual(await view(page),{stage:'map',sheet:false,center:'target'});
   assert.deepEqual(errors,[],label);
   results.push({label,inside,near:near.windows.length,line:sel.at});
  }finally{await context.close();}
 }finally{await browser.close();}
}

// 新しい地点を探す: 下部シートで新規探索を始め、結果を地図のピンと一覧に出す。候補→見え方→戻るとシート。
async function newPlaces(type,engine){
 const {fixture}=require('./candidate-date-fixture.cjs');
 const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
 try{
  const {context,page,errors}=await open(browser,390,'dark',{fixture});
  try{
   await toTarget(page);await page.locator('#mapWsCardView').click();
   await page.waitForFunction(()=>document.getElementById('skyMapView').hasAttribute('data-explore-sheet')&&document.getElementById('exploreDiscovery-new')?.getAttribute('aria-selected')==='true');
   await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===2&&document.getElementById('candidateSearchAction')?.dataset.state==='idle');
   await page.waitForFunction(()=>AstroNotesMapWorkspace.targetState().newPins===2);
   await page.locator('#candidateUnifiedResults>.list-item').first().click();
   await page.waitForFunction(()=>document.getElementById('skyMapView').dataset.exploreStage==='preview');
   assert.notEqual(await page.locator('#exploreBackToCandidates').getAttribute('aria-label'),'地図へ戻る');
   await page.locator('#exploreBackToCandidates').click();
   await page.waitForFunction(()=>document.getElementById('skyMapView').hasAttribute('data-explore-sheet')&&AstroNotesCandidatePicker.visibleRows().length===2);
   assert.equal((await view(page)).center,'target');
   await page.locator('#exploreBackToMap').click();assert.deepEqual(await view(page),{stage:'map',sheet:false,center:'target'});
   // 新しい地点のピンをタップ→カード→「見え方」でその候補の見え方。
   const row=await page.evaluate(()=>{const r=AstroNotesCandidatePicker.visibleRows()[0];return r&&{latitude:r.place.latitude,longitude:r.place.longitude};});
   if(row){const p=await screenPoint(page,row);if(p.inside){await page.mouse.click(p.x,p.y);const kind=await page.evaluate(()=>AstroNotesMapWorkspace.targetState().selection?.kind);
    if(kind==='new'){assert.equal((await page.locator('#mapWsCardView').innerText()).trim(),'見え方');await page.locator('#mapWsCardView').click();await page.waitForFunction(()=>document.getElementById('skyMapView').dataset.exploreStage==='preview');}}}
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 }finally{await browser.close();}
}

(async()=>{
 fs.mkdirSync(out,{recursive:true});const results=[];
 for(const [engine,type] of [['chrome',chromium],['webkit',webkit]].filter(([name])=>engines.includes(name))){
  for(const width of widths)for(const theme of themes)await records(type,engine,width,theme,results);
  await newPlaces(type,engine);results.push({label:engine+'-new-places'});
 }
 console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exit(1);});
