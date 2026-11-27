// 2026-11-26 trial 探すの全画面地図（段階②）の受入: 撮影地点が中心／目標物が中心の切替、目標物中心の方位リング・
// 重なる範囲（帯）・天体の中心が先端に来る線と時刻、記録の地点のその日の重なり、線のタップ→「ここを撮影地点にする」、
// 「新しい地点を探す」の下部シート（地図のピン、候補→見え方→シートへ戻る）と、記録の地点の「重なる日」（今の条件で絞る）。
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.TARGET_MODE_BASE||'http://127.0.0.1:8992/trial/';
const out=process.env.TARGET_MODE_OUT||'/tmp/astronotes-target-mode';
const realTiles=process.env.TARGET_MODE_REAL_TILES==='1';
let offChecked=0;
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
  // 公開後の目視だけ、国土地理院の地図画像GETに限定して許可。API/syncは下の合成応答、天気等は遮断のまま。
  if(realTiles&&route.request().method()==='GET'&&u.origin==='https://cyberjapandata.gsi.go.jp'&&/^\/xyz\/(?:pale|seamlessphoto|hillshademap)\/\d+\/\d+\/\d+\.(?:png|jpg)$/.test(u.pathname))return route.continue();
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
 const targetChoice=page.locator('#mapWsMode input[value=target]');
 if(!await targetChoice.isChecked())await targetChoice.click();
 await page.waitForFunction(()=>{const s=AstroNotesMapWorkspace.targetState();return s.line&&!s.lineBusy&&s.band>0&&!document.getElementById('mapWsCardView').disabled&&/中心が先端に来る線: /.test(document.getElementById('mapWsCardMeta').textContent);},null,{timeout:30000});
}
// 地図上の緯度経度を画面の点へ。
const screenPoint=(page,p)=>page.evaluate(p=>{const m=SkyMapUI.workspaceHost().map,[x,y]=m.project(p.latitude,p.longitude),r=document.getElementById('skyMapCanvas').getBoundingClientRect();return {x:r.left+x,y:r.top+y,inside:x>8&&y>8&&x<r.width-8&&y<r.height-8};},p);
async function positionOnCanvas(page,p,{requireObserver=true}={}){
 if(requireObserver)await page.waitForFunction(()=>{const h=SkyMapUI.workspaceHost(),s=h?.session;return !!s?.eye&&!s.timelinePending&&Math.abs(s.eye.latitude-s.observer.latitude)<1e-7&&Math.abs(s.eye.longitude-s.observer.longitude)<1e-7;});
 await page.evaluate(async p=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const h=SkyMapUI.workspaceHost(),c=document.getElementById('skyMapCanvas'),box=c.getBoundingClientRect(),w=c.clientWidth,ht=c.clientHeight,candidates=[];
  for(let y=24;y<ht-24;y+=16)for(let x=24;x<w-64;x+=16)if([[-14,-14],[54,-14],[-14,14],[54,14],[0,0]].every(([dx,dy])=>document.elementFromPoint(box.left+x+dx,box.top+y+dy)===c))candidates.push({x,y,d:Math.hypot(x-w*.23,y-ht*.45)});
  candidates.sort((a,b)=>a.d-b.d);if(!candidates.length)throw new Error('記録ピンを操作できる地図の空きがない');const pos=candidates[0];
  h.map.setCenter(p.latitude,p.longitude);
  // 対象を富士山から戻した直後などの広域倍率では、記録が主ピン22px内に入り省略される。
  // 実際の地図を拡大し、別地点のピンとして区別できる状態でタップする。
  if(document.getElementById('skyMapView').dataset.mapCenter==='obs')for(let z=h.map.zoom();z<19;z++){
   const a=h.map.project(p.latitude,p.longitude),others=[h.session.observer,h.session.target].filter(q=>q&&Math.hypot(q.latitude-p.latitude,q.longitude-p.longitude)>1e-8),near=others.some(q=>{const b=h.map.project(q.latitude,q.longitude);return Math.hypot(a[0]-b[0],a[1]-b[1])<44;});
   if(!near)break;h.map.setView(p.latitude,p.longitude,z+1);
  }
  const q=h.map.coordinateAt(w-pos.x,ht-pos.y);h.map.setCenter(q.latitude,q.longitude);h.redraw();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 },p);
}

async function records(type,engine,width,theme,results){
 const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});const label=`${engine}-${width}-${theme}`;
 try{
  const {context,page,errors}=await open(browser,width,theme);
  try{
   assert.equal(await page.locator('#mapWsMode input[value=obs]').isChecked(),true);
   await toTarget(page);
   assert.deepEqual(await view(page),{stage:'map',sheet:false,center:'target'});
   const layout=await page.evaluate(()=>{const r=n=>n.getBoundingClientRect(),mode=r(document.getElementById('mapWsMode')),north=r(document.getElementById('mapWsNorth')),rail=Math.min(...[...document.querySelectorAll('#skyMapView .sky-map-wide .mapzoom>button,#skyMapView .sky-map-wide .map-layers-btn')].filter(n=>n.offsetParent).map(n=>r(n).left)),buttons=[...document.querySelectorAll('#mapWsMode input,#mapWsCardView,#mapWsCardSecond')].filter(b=>b.offsetParent).map(b=>r(b).height);
    return {overlapNorth:mode.left<north.right-1,overlapRail:mode.right>rail+1,buttons,overflowX:document.documentElement.scrollWidth>innerWidth+1};});
   assert(!layout.overlapNorth&&!layout.overlapRail&&!layout.overflowX&&layout.buttons.every(h=>h>=44),label+': '+JSON.stringify(layout));
   assert(await page.locator('#mapWsCardSecond').evaluate(button=>{
    const {left,top,width,height}=button.getBoundingClientRect();
    return [4,height/2,height-4].every(y=>button.contains(document.elementFromPoint(left+width/2,top+y)));
   }),label+': 重なる日のボタンは上下端まで操作できる');
   const card=await page.evaluate(()=>[document.getElementById('mapWsCardPlace').textContent,document.getElementById('mapWsCardMeta').textContent,document.getElementById('mapWsCardView').innerText.trim(),document.getElementById('mapWsCardSecond').innerText.trim()]);
   assert.equal(card[0],'東京スカイツリーを中心に（月）');assert.match(card[1],/^中心が先端に来る線: 月の出側 \d\d:\d\d〜\d\d:\d\d ・ 月の入側 \d\d:\d\d〜\d\d:\d\d$/);assert.deepEqual(card.slice(2),['新しい地点を探す','重なる日']);
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
   const savedCenter=await page.evaluate(()=>{const h=SkyMapUI.workspaceHost(),c=document.getElementById('skyMapCanvas');return h.map.coordinateAt(c.clientWidth/2,c.clientHeight/2);});
   // 重ならない記録の地点（北の記録）はピンを出さない＝押しても選べない（2026-11-26 ユーザー「ラインに重なるところだけ」）
   await positionOnCanvas(page,FAVORITES[1]);await page.waitForTimeout(520);
   const offPin=await screenPoint(page,FAVORITES[1]);
   assert(offPin.inside);assert.equal(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.id,offPin),'skyMapCanvas');
   await page.mouse.click(offPin.x,offPin.y);await page.waitForTimeout(300);const picked=(await state(page)).selection;assert.equal((await view(page)).center,'target',label+': ピン検査で中心modeを誤操作しない');assert(!(picked?.kind==='record'&&picked.name==='北の記録'),label+': 重ならない記録の地点は出さない '+JSON.stringify(picked));
   if(picked)await page.locator('#mapWsCardSecond').click();await page.waitForFunction(()=>!AstroNotesMapWorkspace.targetState().selection);offChecked++;
   // 記録のピンをタップ→その地点のカード（重なる時間）→戻す。
   await positionOnCanvas(page,FAVORITES[0]);await page.waitForTimeout(520);
   const pin=await screenPoint(page,FAVORITES[0]);
   assert(pin.inside);assert.equal(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.id,pin),'skyMapCanvas');await page.mouse.click(pin.x,pin.y);await page.waitForFunction(()=>AstroNotesMapWorkspace.targetState().selection?.kind==='record');
   await page.waitForFunction(()=>document.getElementById('mapWsCardPlace').textContent==='確認地点の記録');assert.match(await page.locator('#mapWsCardOverlap').innerText(),/^重なる \d\d:\d\d〜\d\d:\d\d$/);
   await page.locator('#mapWsCardSecond').click();await page.waitForFunction(()=>!AstroNotesMapWorkspace.targetState().selection);
   await page.evaluate(async p=>{const h=SkyMapUI.workspaceHost();h.map.setCenter(p.latitude,p.longitude);h.redraw();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},savedCenter);
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
   assert.equal(await page.locator('#mapWsMode input[value=obs]').isChecked(),true);
   assert(await page.locator('#mapWsMode input[value=obs]').isEnabled(),label+': 線から撮影地点を選ぶと切り替え可能');
   // 線の上なので、その時刻に月の円盤が塔に掛かる（カードの重なる時間がその時刻を含む）。
   const minute=new Date(after.at+32400000),m=minute.getUTCHours()*60+minute.getUTCMinutes();
   await page.waitForFunction(m=>{const ov=document.getElementById('mapWsCardOverlap').textContent.match(/重なる (\d\d):(\d\d)〜(\d\d):(\d\d)/);return !!ov&&+ov[1]*60+ +ov[2]<=m+1&&m-1<=+ov[3]*60+ +ov[4];},m,{timeout:15000})
    .catch(async()=>assert.fail(label+': 線上の点ではその時刻に重なる '+JSON.stringify({ov:await page.locator('#mapWsCardOverlap').innerText(),m})));
   // 撮影地点中心のピンは、その日の記録判定を使い回し、現在時刻の前後1時間を滑らかに追従する。
   let timeFollow;try{timeFollow=await recordTimeFollow(page,near,label);}catch(error){
    console.error('record-time-follow failure',label,JSON.stringify(await page.evaluate(()=>({at:SkyMapUI.selectionState().at,state:AstroNotesMapWorkspace.targetState(),card:document.getElementById('mapWsCardPlace').textContent,canvas:document.getElementById('skyMapCanvas').getBoundingClientRect().toJSON()}))));
    await page.screenshot({path:`${out}/${label}-time-follow-failure.png`});throw error;
   }
   await toTarget(page);
   // 条件帯はその場で展開し、目標物が中心のまま。帯で畳む。
   await page.locator('#mapWsTitle').click();assert.deepEqual(await view(page),{stage:'map',sheet:false,center:'target'});assert(await page.evaluate(()=>document.getElementById('skyMapView').hasAttribute('data-explore-dropdown')));
   await page.locator('#mapWsTitle').click();assert(!await page.evaluate(()=>document.getElementById('skyMapView').hasAttribute('data-explore-dropdown')));
   // 記録の地点は「重なる日」へ（段階③）。この確認は記録が目標物に登録されていない（地点だけ）ので押せない。
   // 押せる場合の行き先と絞り込みは test-record-discovery（探すの入口と同じ処理）で確かめる。
   const second=await page.evaluate(()=>{const b=document.getElementById('mapWsCardSecond');return {text:b.textContent.trim(),action:b.dataset.action,disabled:b.disabled,view:document.getElementById('mapWsCardView').textContent.trim()};});
   assert.deepEqual(second,{text:'重なる日',action:'list',disabled:true,view:'新しい地点を探す'},label+' '+JSON.stringify(second));
   assert.deepEqual(errors,[],label);
   results.push({label,inside,near:near.windows.length,line:sel.at,timeFollow});
  }finally{await context.close();}
 }finally{await browser.close();}
}

// 時刻の境界を実際に求めた重なり区間で検査する。アプリのフェード式をテスト側へ複写しない。
// 診断値だけで合格にせず、Canvasのピン/時刻ラベルの濃度、通常の地図タップとカードも確認する。
async function recordTimeFollow(page,near,label){
 const name=FAVORITES[0].name,minute=60000,w=near.windows[0],report={boundaries:[]};
 const initial=await page.evaluate(()=>{const h=SkyMapUI.workspaceHost(),s=h.session;return {observer:structuredClone(s.observer),at:s.at,targetState:structuredClone({target:s.target,custom:s.custom,customTarget:s.customTarget,partId:s.partId,matchMode:s.matchMode,limb:s.limb})};});
 const setAt=at=>page.evaluate(at=>SkyMapUI.setTime(at),at);
 const fade=()=>page.evaluate(name=>AstroNotesMapWorkspace.targetState().obsRecordFades?.find(r=>r.name===name)||null,name);
 const waitAlpha=async(expected)=>{
  // alphaが僅かに残る追従中は、描画もhitもまだ有効。不可視の確認は厳密な0まで待つ。
  await page.waitForFunction(({name,expected})=>{const s=AstroNotesMapWorkspace.targetState(),r=s.obsRecordFades?.find(r=>r.name===name);return !s.obsRecordsPending&&(expected===0?(!r||r.alpha===0&&r.targetAlpha===0):r&&Math.abs(r.alpha-expected)<.015&&Math.abs(r.targetAlpha-expected)<.001);},{name,expected},{timeout:5000});
  return fade();
 };
 const positionPin=()=>positionOnCanvas(page,FAVORITES[0]);
 const tapPin=async(visible=true)=>{
  // 地図は同座標500ms以内をダブルタップと解釈する。ここでは独立した選択操作を確かめる。
  await page.waitForTimeout(520);
  // 対象復元のfit/標高表示によるlayoutが落ち着いた後の露出位置を使う。
  await positionPin();if(visible)await page.waitForFunction(name=>AstroNotesMapWorkspace.targetState().obsRecords.includes(name),name,{timeout:3000});
  const p=await screenPoint(page,FAVORITES[0]);assert(p.inside,label+': 記録ピンは実際に操作できる画面内');
  const owner=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.id,p);assert.equal(owner,'skyMapCanvas',label+': 記録ピンが別のボタンに隠れていない');
  await page.mouse.click(p.x,p.y);
 };
 const clearSelection=async()=>{if((await state(page)).selection)await page.locator('#mapWsCardSecond').click();await page.waitForFunction(()=>!AstroNotesMapWorkspace.targetState().selection);};
 await setAt(w.from);await positionPin();await waitAlpha(1);
 assert((await state(page)).obsRecords.includes(name),label+': 重なるピンが実描画とタップ対象にある');
 assert(!(await state(page)).obsRecords.includes('北の記録'),label+': 重ならない記録の地点は描画しない');
 if(realTiles)await page.waitForLoadState('networkidle',{timeout:10000});
 await page.screenshot({path:`${out}/${label}-obs-records-full.png`});
 // 既に確定した記録地点の計算呼出を計測。同日内で時刻だけを変えても再度走査しない。
 await page.evaluate(p=>{const original=AstroNotesAlign.prepareDailyView;window.__recordFollowProbe={calls:0,original};AstroNotesAlign.prepareDailyView=function(o,...rest){if(Math.abs(o.latitude-p.latitude)<1e-7&&Math.abs(o.longitude-p.longitude)<1e-7)window.__recordFollowProbe.calls++;return original.call(this,o,...rest);};},FAVORITES[0]);
 try{
  for(const [edge,at,expected] of [['from-50',w.from-50*minute,1],['from-55',w.from-55*minute,.5],['from-60',w.from-60*minute,0],['to+50',w.to+50*minute,1],['to+55',w.to+55*minute,.5],['to+60',w.to+60*minute,0]]){
   await setAt(at);const f=await waitAlpha(expected);report.boundaries.push({edge,at,alpha:f?.alpha??0});
   const visible=(await state(page)).obsRecords.includes(name);assert.equal(visible,expected>0,label+': '+edge+' の描画・タップ対象');
  }
  // 日中で朝夕どちらにも近くなければ、近い回のピンを無理に出さない。
  await setAt(Date.parse('2026-12-24T12:00:00+09:00'));await waitAlpha(0);
  await tapPin(false);assert(!(await state(page)).selection,label+': 不可視ピンの位置を押しても記録を選ばない');
  // 半透明の時刻とピンが一緒に薄くなることを、描画先から確認。
  await setAt(w.from-55*minute);await waitAlpha(.5);
  const drawn=await page.evaluate(p=>{const h=SkyMapUI.workspaceHost(),source=document.getElementById('skyMapCanvas'),c=document.createElement('canvas');c.width=source.clientWidth;c.height=source.clientHeight;
   const ctx=c.getContext('2d'),[px,py]=h.map.project(p.latitude,p.longitude),arcs=[],texts=[],arc=ctx.arc.bind(ctx),text=ctx.fillText.bind(ctx);
   ctx.arc=function(x,y,r,...args){if(Math.abs(x-px)<.1&&Math.abs(y-py)<.1)arcs.push({r,alpha:this.globalAlpha});return arc(x,y,r,...args);};
   ctx.fillText=function(value,x,y,...args){if(Math.abs(x-px-14)<.1&&Math.abs(y-py-1)<.1)texts.push({value,alpha:this.globalAlpha});return text(value,x,y,...args);};
   AstroNotesMapWorkspace.drawObsRecords(ctx,{project:h.map.project,width:c.width,height:c.height});return {arcs,texts};},FAVORITES[0]);
  assert(drawn.arcs.some(x=>x.r===11)&&drawn.arcs.some(x=>x.r===5.5)&&drawn.texts.length===1,label+': ピンと時刻を描画 '+JSON.stringify(drawn));
  assert([...drawn.arcs,...drawn.texts].every(x=>Math.abs(x.alpha-.5)<.02),label+': ピンと時刻ラベルの濃度が一致 '+JSON.stringify(drawn));
  if(realTiles)await page.waitForLoadState('networkidle',{timeout:10000});
  await page.screenshot({path:`${out}/${label}-obs-records-half.png`});
  // 操作停止まで待たずに追従。往復しても同じ地点を二重化せず、待ち行列を残さない。
  const moving=await page.evaluate(async({from,name})=>{const samples=[];for(const minutes of [49,52,55,58,61,58,55,52,49]){SkyMapUI.setTime(from-minutes*60000);await new Promise(r=>setTimeout(r,55));const s=AstroNotesMapWorkspace.targetState(),rows=(s.obsRecordFades||[]).filter(r=>r.name===name);samples.push({minutes,rows,at:SkyMapUI.selectionState().at});}return samples;},{from:w.from,name});
  assert(moving.every(s=>s.rows.length<=1),label+': 同一地点のピンを二重化しない');
  assert(moving.some(s=>s.rows[0]?.alpha>0&&s.rows[0]?.alpha<1),label+': 時刻操作中に中間の濃度で追従 '+JSON.stringify(moving));
  await waitAlpha(1);const finalAt=await page.evaluate(()=>SkyMapUI.selectionState().at);await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>SkyMapUI.selectionState().at),finalAt);assert((await fade()).alpha>.985,label+': 古いフェードが後から戻らない');report.moving=moving;
  // 実際の再生ボタンで50〜60分の境界内を進める。再生時計はperformance.now差分で進む。
  // Date.nowは開始位置だけ固定し、実際の再生フレームごとに目標濃度が変わることを確認する。
  await setAt(w.from-55*minute);await waitAlpha(.5);
  await page.evaluate(start=>{window.__recordFollowClock=Date.now;Date.now=()=>start;},w.from-55*minute);
  const play=page.locator('.sky-map-footer .tool-datetime-play');
  try{
   await play.click();assert.equal(await play.getAttribute('data-playing'),'true');
   const samples=[];for(let i=0;i<12;i++){await page.waitForTimeout(60);samples.push({at:await page.evaluate(()=>SkyMapUI.selectionState().at),fade:await fade()});}
   assert(samples.at(-1).at-samples[0].at>350,label+': 実際の再生が進む');
   assert(samples.every(s=>s.fade&&s.fade.alpha>0&&s.fade.alpha<1),label+': 再生中も薄いピンを描画 '+JSON.stringify(samples));
   assert(samples.at(-1).fade.targetAlpha>samples[0].fade.targetAlpha+.0001,label+': 再生の各時刻に濃度が随時追従');report.playback=samples;
  }finally{if(await play.getAttribute('data-playing')==='true')await play.click();await page.evaluate(()=>{Date.now=window.__recordFollowClock;delete window.__recordFollowClock;});}
  report.recordRecalculations=await page.evaluate(()=>window.__recordFollowProbe.calls);assert.equal(report.recordRecalculations,0,label+': 同日内の境界・往復・再生で記録の天文計算を再実行しない');
 }finally{await page.evaluate(()=>{AstroNotesAlign.prepareDailyView=window.__recordFollowProbe.original;delete window.__recordFollowProbe;});}
 // 記録ピンが円弧の時刻点と重なった時は、上に描かれている記録を選ぶ。
 // 実在の重なる記録位置へ時刻点を重ねる合成衝突。通常のUIクリックはこの後も別途確認する。
 await setAt(w.from);await waitAlpha(1);await positionPin();
 const beforeCollision=await page.evaluate(p=>{const c=document.getElementById('skyMapCanvas'),at=SkyMapUI.selectionState().at;
  // 実pointerupの直前だけ時刻点を重ねる。描画frameが合成点を消す競合を避け、実際の地図イベント経路で順位を検査。
  c.addEventListener('pointerup',()=>{const [x,y]=SkyMapUI.workspaceHost().map.project(p.latitude,p.longitude),hits=AstroNotesMapWorkspace.hits(),hit={x,y,at:at+1800000};hits.push(hit);setTimeout(()=>{const i=hits.indexOf(hit);if(i>=0)hits.splice(i,1);},0);},{capture:true,once:true});return at;},FAVORITES[0]);
 await tapPin();const collision=await page.evaluate(()=>({at:SkyMapUI.selectionState().at,selected:AstroNotesMapWorkspace.targetState().selection}));
 assert(collision.selected?.kind==='record'&&collision.selected.name===name&&collision.at===beforeCollision,label+': 記録ピンが円弧時刻点より優先 '+JSON.stringify(collision));
 await clearSelection();
 // 選択中は範囲を外れてもピンと実時刻のカードを保持し、選択解除で消す。
 await setAt(w.from);await waitAlpha(1);await positionPin();await tapPin();
 await page.waitForFunction(name=>AstroNotesMapWorkspace.targetState().selection?.kind==='record'&&document.getElementById('mapWsCardPlace').textContent===name,name);
 const card=await page.locator('#mapWsCardOverlap').innerText();assert.match(card,/^重なる \d\d:\d\d〜\d\d:\d\d$/);
 assert.equal((await page.locator('#mapWsCardView').innerText()).trim(),'ここを撮影地点にする');
 await setAt(w.to+120*minute);await waitAlpha(1);assert.equal(await page.locator('#mapWsCardOverlap').innerText(),card,label+': 範囲外であってもカードは実際の重なる時刻');
 await clearSelection();await waitAlpha(0);
 // 手動で撮影地点を変えたら、古い選択を残さない。右側の既存操作導線を使う。
 await setAt(w.from);await waitAlpha(1);await positionPin();await tapPin();await page.waitForFunction(()=>AstroNotesMapWorkspace.targetState().selection?.kind==='record');
 await page.evaluate(()=>{const h=SkyMapUI.workspaceHost();h.map.setCenter(h.session.observer.latitude+.01,h.session.observer.longitude+.01);h.redraw();});
 await page.locator('#skyMapObserverTool').click();await page.waitForFunction(name=>!AstroNotesMapWorkspace.targetState().selection&&document.getElementById('mapWsCardPlace').textContent!==name,name);
 assert.notEqual(await page.locator('#mapWsCardPlace').innerText(),name,label+': 撮影地点を動かすと記録選択を解除');
 await page.locator('#mapWsUndo').click();await waitAlpha(1);await positionPin();
 // 天体の変更直後、前の記録ピンとカードを消し、計算待ちを0件と混同しない。
 await tapPin();await page.waitForFunction(()=>AstroNotesMapWorkspace.targetState().selection?.kind==='record');
 await page.evaluate(()=>{const b=document.getElementById('skyMapBody');b.value='sun';b.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.waitForFunction(name=>!AstroNotesMapWorkspace.targetState().selection&&SkyMapUI.selectionState().body==='sun'&&document.getElementById('mapWsCardPlace').textContent!==name,name);
 assert.notEqual(await page.locator('#mapWsCardPlace').innerText(),name,label+': 天体変更で選択失効');
 await page.evaluate(at=>{const b=document.getElementById('skyMapBody');b.value='moon';b.dispatchEvent(new Event('change',{bubbles:true}));SkyMapUI.setTime(at);},w.from);
 await positionPin();await waitAlpha(1);await tapPin();await page.waitForFunction(()=>AstroNotesMapWorkspace.targetState().selection?.kind==='record');
 await setAt(Date.parse('2026-12-26T16:41:00+09:00'));
 await page.waitForFunction(name=>!AstroNotesMapWorkspace.targetState().selection&&AstroNotesMapWorkspace.targetState().obsRecords.length===0&&document.getElementById('mapWsCardPlace').textContent!==name,name);
 assert.notEqual(await page.locator('#mapWsCardPlace').innerText(),name,label+': 日付変更で選択失効');
 await page.waitForFunction(()=>!AstroNotesMapWorkspace.targetState().obsRecordsPending,null,{timeout:15000});
 assert(!(await state(page)).obsRecords.includes(name),label+': 別日の結果に前のピンを混ぜない');
 // 対象変更・記録削除でも、選択中だった記録のカードを残さない。
 await setAt(w.from);await waitAlpha(1);await positionPin();await tapPin();await page.waitForFunction(()=>AstroNotesMapWorkspace.targetState().selection?.kind==='record');
 await page.evaluate(()=>SkyMapUI.setTarget('fuji'));await page.waitForFunction(name=>!AstroNotesMapWorkspace.targetState().selection&&document.getElementById('mapWsCardPlace').textContent!==name,name);
 await page.evaluate(target=>SkyMapUI.workspaceHost().restoreTarget(target),initial.targetState);await waitAlpha(1);await positionPin();await tapPin();await page.waitForFunction(()=>AstroNotesMapWorkspace.targetState().selection?.kind==='record');
 await page.evaluate(()=>{window.__recordFollowPoints=MyPlacesUI.discoveryPoints;MyPlacesUI.discoveryPoints=()=>[];MyPlacesUI.imported();});
 try{await page.waitForFunction(name=>!AstroNotesMapWorkspace.targetState().selection&&AstroNotesMapWorkspace.targetState().obsRecords.length===0&&document.getElementById('mapWsCardPlace').textContent!==name,name);}
 finally{await page.evaluate(()=>{MyPlacesUI.discoveryPoints=window.__recordFollowPoints;delete window.__recordFollowPoints;MyPlacesUI.imported();});}
 await waitAlpha(1);
 // 記録計算の300ms待ち中に離脱し、同条件へ戻ってもbusyで止まらず再開する。
 const reentry=await page.evaluate(async at=>{SkyMapUI.setTime(at);const h=SkyMapUI.workspaceHost(),source=document.getElementById('skyMapCanvas'),c=document.createElement('canvas');c.width=source.clientWidth;c.height=source.clientHeight;
  AstroNotesMapWorkspace.drawObsRecords(c.getContext('2d'),{project:h.map.project,width:c.width,height:c.height});const pending=AstroNotesMapWorkspace.targetState().obsRecordsPending;navigationHistory.pushRoute('#/records');return {pending};},w.from+86400000);
 assert(reentry.pending,label+': 離脱前に新しい日の記録計算が始まった');
 await page.waitForFunction(()=>!SkyMapUI.workspaceHost());await page.waitForTimeout(420);
 await page.evaluate(()=>navigationHistory.pushRoute('#/explore'));await page.waitForFunction(()=>!!SkyMapUI.workspaceHost()&&document.getElementById('skyMapView').dataset.exploreStage==='map');
 await page.waitForFunction(()=>!AstroNotesMapWorkspace.targetState().obsRecordsPending&&Array.isArray(AstroNotesMapWorkspace.targetState().records),null,{timeout:15000});
 assert.equal((await state(page)).records.length,2,label+': 同条件へ再入場すると記録計算が完了する');report.reentry=true;
 // 後続の既存受入へ戻す。
 await page.evaluate(({observer,at})=>{SkyMapUI.workspaceHost().restoreObserver(observer);SkyMapUI.setTime(at);},initial);
 await page.waitForFunction(()=>!AstroNotesMapWorkspace.targetState().obsRecordsPending,null,{timeout:15000});
 return report;
}

// 一覧が長くなっても地図と日時バーはシートの外。両方の中心で、候補ピンと一覧を往復する。
async function newPlaces(type,engine,center){
 const {fixture}=require('./candidate-date-fixture.cjs');
 const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
 const label=engine+'-new-places-'+center;
 try{
  const {context,page,errors}=await open(browser,390,'dark',{fixture});
  try{
   if(center==='target'){
    await page.waitForFunction(()=>document.querySelector('#mapWsMode input[value=target]').checked);
    assert.deepEqual(await view(page),{stage:'map',sheet:false,center:'target'},label+': 対象だけを選んで開くと自動で対象中心');
    await toTarget(page);
    const observerChoice=page.locator('#mapWsMode input[value=obs]');
    const targetChoice=page.locator('#mapWsMode input[value=target]');
    assert(await observerChoice.isDisabled(),label+': 撮影地点を選ぶまでは撮影地点中心へ切り替えられない');
    await observerChoice.evaluate(input=>input.closest('label').click());
    await targetChoice.press('ArrowLeft');
    assert(await targetChoice.isChecked(),label+': 撮影地点なしでクリック・矢印キーを使っても対象中心のまま');
   }else{
    await page.evaluate(observer=>SkyMapUI.workspaceHost().restoreObserver(observer),OBSERVER);
    await page.locator('#mapWsMode input[value=obs]').click();
   }
   const entry=center==='target'?'#mapWsCardView':'#mapWsNewPlaces';
   await page.locator(entry).click();
   await page.waitForFunction(()=>document.getElementById('skyMapView').hasAttribute('data-explore-sheet')&&document.getElementById('exploreDiscovery-new')?.getAttribute('aria-selected')==='true');
   await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===2&&document.getElementById('candidateSearchAction')?.dataset.state==='idle');
   await page.waitForFunction(()=>AstroNotesMapWorkspace.targetState().newPins>0);
   const readLayout=()=>page.evaluate(()=>{
    const sheet=document.getElementById('exploreConditions'),canvas=document.getElementById('skyMapCanvas'),footer=document.querySelector('#skyMapView .sky-map-footer');
    const r=canvas.getBoundingClientRect(),b=footer.getBoundingClientRect(),p=sheet.getBoundingClientRect();
    const clipAncestors=element=>{
     for(let n=element.parentElement;n&&n!==document.body;n=n.parentElement){
      const style=getComputedStyle(n);
      if(style.position==='fixed'&&['auto','scroll'].includes(style.overflowY))return true;
     }
     return false;
    };
    const date=document.getElementById('skyMapCalendarOpen').getBoundingClientRect();
    return {visible:r.height>120&&b.height>=44&&document.elementFromPoint(r.left+r.width*.35,r.top+r.height/2)===canvas,
     sheetStart:p.top,canvasEnd:r.bottom,footerStart:b.top,sheetEnd:p.bottom,canvasTop:r.top,
     scroll:sheet.scrollTop,docScroll:document.scrollingElement.scrollTop,
     dateVisible:!!document.elementFromPoint(date.left+date.width/2,date.top+date.height/2)?.closest('#skyMapCalendarOpen'),
     sharedScroller:clipAncestors(canvas)||clipAncestors(footer)};
   });
   const before=await readLayout();
   assert(before.visible&&before.dateVisible&&!before.sharedScroller,label+': '+JSON.stringify(before));
   const fit=page.locator('#candidateMapToggle');
   assert.match(await fit.innerText(),/ピンに合わせる/);
   assert.equal(await fit.getAttribute('aria-controls'),'skyMapCanvas');
   await page.evaluate(()=>{const h=SkyMapUI.workspaceHost();h.map.setView(34.7,135.5,14);h.redraw();});
   await page.waitForFunction(()=>AstroNotesMapWorkspace.targetState().newPins===0);
   await fit.click();
   await page.waitForFunction(()=>AstroNotesMapWorkspace.targetState().newPins===2);
   assert.equal(await page.locator('#candidateMapCanvas').count(),0,label+': 候補の位置に上の地図を合わせる');
   const list=page.locator('#candidateUnifiedResults>.list-item');
   assert.equal(await list.first().getAttribute('data-candidate-number'),'1');
   assert.equal(await list.first().evaluate(n=>getComputedStyle(n).paddingLeft),'30px');
   assert.equal(await list.count(),2);
   await page.locator('#exploreConditions').evaluate(n=>n.scrollTop=0);
   assert(Math.abs(before.sheetStart-before.canvasEnd)<=1&&Math.abs(before.sheetEnd-before.footerStart)<=1,label+': '+JSON.stringify(before));
   await page.locator('#exploreConditions').evaluate(n=>n.scrollTop=n.scrollHeight);
   const after=await readLayout();
   assert(after.scroll>before.scroll&&after.docScroll===before.docScroll&&after.visible&&after.dateVisible,label+': '+JSON.stringify(after));
   assert(await page.locator('#exploreBackToMap').evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),label+': 一覧の下でも閉じるボタンを押せる');
   assert.equal(after.canvasTop,before.canvasTop);assert.equal(after.canvasEnd,before.canvasEnd);assert.equal(after.footerStart,before.footerStart);

   await page.locator('#candidateRefinement > summary').click();
   const kind=page.locator('#candidateKindFilter');
   await kind.selectOption('garden');
   await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===0&&AstroNotesMapWorkspace.targetState().newPins===0);
   await kind.selectOption('all');
   await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===2&&AstroNotesMapWorkspace.targetState().newPins>0);
   const row=await page.evaluate(()=>{const r=AstroNotesCandidatePicker.visibleRows()[0];return {latitude:r.place.latitude,longitude:r.place.longitude,id:AstroNotesCandidatePicker.candidateKey(r)};});
   await positionOnCanvas(page,row,{requireObserver:false});
   const point=await screenPoint(page,row);
   assert(point.inside,label+': 候補ピンを地図で押せる');
   await page.mouse.click(point.x,point.y);
   await page.waitForFunction(id=>document.activeElement?.dataset.candidateId===id,row.id);
   assert((await readLayout()).visible,label+': ピンを押しても地図を維持');
   await page.screenshot({path:`${out}/${label}-sheet.png`});

   await page.locator('#candidateUnifiedResults>.list-item').first().click();
   await page.waitForFunction(()=>document.getElementById('skyMapView').dataset.exploreStage==='preview');
   assert.notEqual(await page.locator('#exploreBackToCandidates').getAttribute('aria-label'),'地図へ戻る');
   await page.locator('#exploreBackToCandidates').click();
   await page.waitForFunction(()=>document.getElementById('skyMapView').hasAttribute('data-explore-sheet')&&AstroNotesCandidatePicker.visibleRows().length===2&&AstroNotesMapWorkspace.targetState().newPins>0);
   assert.equal((await view(page)).center,center);
   assert((await readLayout()).visible,label+': 見え方から地図と候補へ戻る');
   await page.locator('#exploreBackToMap').click();
   assert.deepEqual(await view(page),{stage:'map',sheet:false,center});
   if(center==='target'){
    const observerChoice=page.locator('#mapWsMode input[value=obs]');
    await page.evaluate(observer=>SkyMapUI.workspaceHost().restoreObserver(observer),OBSERVER);
    await observerChoice.click();
    assert.equal((await view(page)).center,'obs',label+': 撮影地点を選んだら切り替えられる');
    await page.evaluate(()=>SkyMapUI.workspaceHost().restoreObserver(null));
    await page.waitForFunction(()=>document.querySelector('#mapWsMode input[value=obs]').disabled&&document.querySelector('#mapWsMode input[value=target]').checked);
    assert.equal((await view(page)).center,'target',label+': 撮影地点を外したら自動で対象中心に切り替わる');
    assert(!await observerChoice.isChecked(),label+': 無効な撮影地点に選択表示を残さない');
    await toTarget(page);
    await page.screenshot({path:`${out}/${label}-without-observer.png`});
    await page.locator('#mapWsCardView').click();
    await page.waitForFunction(()=>document.getElementById('skyMapView').hasAttribute('data-explore-sheet'));
    await page.locator('#mapWsTitle').click();
    const targetPicker=page.locator('#skyMapTargetOpen');
    const dialog=page.locator('#previewTargetDialog[open]');
    await targetPicker.click();
    await dialog.locator('[data-target-key="skytree"]').click();
    await dialog.locator('[data-target-key="tokyotower"]').click();
    await dialog.getByRole('button',{name:'戻る',exact:true}).click();
    assert.equal((await view(page)).stage,'search',label+': 対象選択の取り消しで条件に戻る');
    assert.equal(await page.evaluate(()=>SkyMapUI.selectionState().target.id),'skytree',label+': 対象選択の取り消しで元の対象を保持');
    await targetPicker.click();
    await dialog.locator('[data-target-key="skytree"]').click();
    await dialog.locator('[data-target-key="tokyotower"]').click();
    await dialog.locator('[data-target-done]').click();
    await page.waitForFunction(()=>!document.querySelector('#previewTargetDialog[open]')&&document.getElementById('skyMapView').hasAttribute('data-explore-dropdown')&&SkyMapUI.selectionState().target?.id==='tokyotower');
    assert.deepEqual(await view(page),{stage:'map',sheet:false,center:'target'});
    assert(await page.locator('#skyMapCanvas').isVisible(),label+': 候補シート経由でも対象の適用後は地図へ戻る');
    await page.locator('#mapWsTitle').click();
    // Simulate availability independently from the real candidate calculation used by the fixture.
    await page.evaluate(()=>{window.originalSearchBand=AstroNotesMapWorkspace.searchBand;
     window.testBandStatus='pending';
     AstroNotesMapWorkspace.searchBand=()=>({status:window.testBandStatus,key:'test-band-'+window.testBandStatus,samples:[]});});
    try{
     const newPlace=page.locator('#mapWsCardView');
     assert(await newPlace.isEnabled(),label+': 帯が準備中でも通常探索を始められる');
     await newPlace.click();
     await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===2&&document.getElementById('candidateSearchAction')?.dataset.state==='idle');
     await page.locator('#additionalCandidateSearch details > summary').click();
     await page.locator('#candidateOnlyMapBand').check();
     const status=page.locator('#candidateSearchFeedback [role=status]'),action=page.locator('#candidateSearchAction');
     assert.match(await status.innerText(),/地図の帯を計算/);
     assert(await action.isDisabled());
     const setBand=state=>page.evaluate(state=>{window.testBandStatus=state;document.dispatchEvent(new Event('astronotes-search-band-change'));},state);
     await setBand('ready');
     await page.waitForFunction(()=>document.getElementById('candidateSearchFeedback').textContent.includes('この日は地図に帯がありません'));
     assert(await action.isDisabled());
     await setBand('error');
     await page.waitForFunction(()=>document.getElementById('candidateSearchFeedback').textContent.includes('地図の帯を取得できません'));
     assert(await action.isDisabled());
     await page.locator('#candidateOnlyMapBand').uncheck();
     await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===2&&!document.getElementById('candidateSearchAction').disabled);
    }finally{await page.evaluate(()=>{AstroNotesMapWorkspace.searchBand=window.originalSearchBand;delete window.originalSearchBand;delete window.testBandStatus;});}
   }
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 }finally{await browser.close();}
}

(async()=>{
 fs.mkdirSync(out,{recursive:true});const results=[];
 for(const [engine,type] of [['chrome',chromium],['webkit',webkit]].filter(([name])=>engines.includes(name))){
  for(const width of widths)for(const theme of themes)await records(type,engine,width,theme,results);
  for(const center of ['target','obs']){await newPlaces(type,engine,center);results.push({label:engine+'-new-places-'+center});}
 }
 assert(offChecked>0,'重ならない記録の地点を少なくとも1回は押して確かめた');
 console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exit(1);});
