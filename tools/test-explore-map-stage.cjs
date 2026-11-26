// 2026-11-26 trial 探すの全画面地図（段階①）の受入: 探すは地図が既定、条件帯→撮影条件ポップアップ→地図へ、
// カードに実際に重なる時間、選んだ天体だけ・軌道は3点円弧、見え方は来た所へ戻る。
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.MAP_STAGE_BASE||'http://127.0.0.1:8992/trial/';
const out=process.env.MAP_STAGE_OUT||'/tmp/astronotes-map-stage';
const tools=['records','tower','diamond','pearl','skymap','multiscene'];
const engines=(process.env.MAP_STAGE_ENGINES||'chrome,webkit').split(',');
const widths=(process.env.MAP_STAGE_WIDTHS||'320,390').split(',').map(Number);
const themes=(process.env.MAP_STAGE_THEMES||'light,dark').split(',');
const OBSERVER={latitude:35.5869,longitude:139.5744,elevation:30,name:'確認地点',eyeHeightAGL:1.5};
const stage=page=>page.evaluate(()=>document.getElementById('skyMapView').dataset.exploreStage);

async function open(browser,width,theme){
 const context=await browser.newContext({viewport:{width,height:width===320?568:844},locale:'ja-JP',timezoneId:'Asia/Tokyo',colorScheme:theme,reducedMotion:'reduce'});
 await context.addInitScript(t=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-ui',loginId:'map-stage',tools:t})),tools);
 await context.route('**/*',route=>{const u=new URL(route.request().url());
  if(/zekkei-api|localhost:8787/.test(u.origin))return route.fulfill({json:{allowed:true,tool:'skymap',loginId:'map-stage',tools,favorites:[],sightings:[],records:[],rev:1}});
  if(/open-meteo|cyberjapandata|overpass|openstreetmap|wikidata/.test(u.host))return route.abort();
  return route.continue();});
 const page=await context.newPage();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'index.html#/explore');
 await page.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof aimTargetList==='function'&&typeof startupSessionReady!=='undefined');
 await page.evaluate(async o=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>30;aimBuildingDays=async()=>[];navigationHistory.pushRoute('#/explore');
  for(let i=0;i<100&&!SkyMapUI.workspaceHost();i++)await new Promise(r=>setTimeout(r,100));
  const t=aimTargetList().find(x=>x.id==='skytree');SkyMapUI.workspaceHost().restoreTarget({target:structuredClone(t),custom:false});SkyMapUI.workspaceHost().restoreObserver(o);
  const b=document.getElementById('skyMapBody');b.value='moon';b.dispatchEvent(new Event('change',{bubbles:true}));SkyMapUI.setTime(Date.parse('2026-12-24T16:41:00+09:00'));},OBSERVER);
 await page.waitForFunction(()=>document.getElementById('skyMapView').classList.contains('map-ws')&&/^重なる \d\d:\d\d〜\d\d:\d\d/.test(document.getElementById('mapWsCardOverlap')?.textContent||''));
 return {context,page,errors};
}

// 時刻の点と目標方位の通過は、どれも出→最高点→入を通る1つの円の上にある。
async function arcResidual(page){
 return page.evaluate(()=>{const p=AstroNotesMapWorkspace.hits().map(h=>[h.x,h.y]);if(p.length<4)return {count:p.length,residual:Infinity};
  const [a,b,c]=[p[0],p[Math.floor(p.length/2)],p.at(-1)],d=2*(a[0]*(b[1]-c[1])+b[0]*(c[1]-a[1])+c[0]*(a[1]-b[1]));if(Math.abs(d)<1e-6)return {count:p.length,residual:0,straight:true};
  const ux=((a[0]**2+a[1]**2)*(b[1]-c[1])+(b[0]**2+b[1]**2)*(c[1]-a[1])+(c[0]**2+c[1]**2)*(a[1]-b[1]))/d,uy=((a[0]**2+a[1]**2)*(c[0]-b[0])+(b[0]**2+b[1]**2)*(a[0]-c[0])+(c[0]**2+c[1]**2)*(b[0]-a[0]))/d,R=Math.hypot(a[0]-ux,a[1]-uy);
  return {count:p.length,residual:Math.max(...p.map(q=>Math.abs(Math.hypot(q[0]-ux,q[1]-uy)-R)))};});
}

// 撮影条件のポップアップを閉じて開き直す: 探し終えた候補は残り、探している途中なら止めたと伝える。
async function reopenKeepsSearch(type,engine){
 const {fixture}=require('./candidate-date-fixture.cjs');
 const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
 try{for(const interrupted of [false,true]){
  const context=await browser.newContext({viewport:{width:390,height:900},locale:'ja-JP',timezoneId:'Asia/Tokyo',reducedMotion:'reduce'});
  await context.addInitScript(fixture,tools);await context.addInitScript(()=>localStorage.setItem('sorami.skyMap:date-test',JSON.stringify({body:'moon',targetId:'skytree',partId:'tip',limb:'center',matchMode:'limb',at:Date.parse('2026-11-05T03:58:31+09:00')})));
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===new URL(base).origin)return route.continue();if(/zekkei-api|localhost:8787/.test(u.origin))return route.fulfill({json:{allowed:true,tool:'skymap',loginId:'date-test',tools,favorites:[],sightings:[],records:[],rev:1}});return route.abort();});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
  try{
   await page.goto(base+'#/explore');await page.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof AstroNotesCandidatePicker==='object');
   await page.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>25;aimBuildingDays=async()=>[];navigationHistory.pushRoute('#/explore');SkyMapUI.setTarget('skytree');const b=document.getElementById('skyMapBody');b.value='moon';b.onchange();SkyMapUI.setTime(Date.parse('2026-11-05T03:58:31+09:00'));});
   await page.waitForFunction(()=>document.getElementById('skyMapView').dataset.exploreStage==='map');
   await page.locator('#mapWsTitle').click();await page.locator('#exploreDiscovery-new').click();
   if(interrupted){await page.evaluate(()=>dateFixture.holdNext=true);await page.locator('#candidateSearchAction').click();await page.waitForFunction(()=>dateFixture.holds.length===1);}
   else{await page.locator('#candidateSearchAction').click();await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===2&&document.getElementById('candidateSearchAction').dataset.state==='idle');}
   await page.locator('#exploreBackToMap').click();assert.equal(await stage(page),'map');
   if(interrupted){await page.evaluate(()=>dateFixture.holds.shift().release());await page.waitForTimeout(300);}
   await page.locator('#mapWsTitle').click();assert.equal(await stage(page),'search');
   if(interrupted){await page.waitForFunction(()=>document.getElementById('candidateSearchAction')?.dataset.state==='idle');
    assert.equal(await page.locator('#candidateSearchEmpty').innerText(),'地図へ戻ったため候補探しを止めました。もう一度「候補を探す」を押してください。');assert.equal(await page.evaluate(()=>AstroNotesCandidatePicker.visibleRows().length),0);}
   else{await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===2);assert(await page.locator('#candidateUnifiedResults>.list-item').first().isVisible());}
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 }}finally{await browser.close();}
}

(async()=>{
 fs.mkdirSync(out,{recursive:true});const results=[];
 for(const [engine,type] of [['chrome',chromium],['webkit',webkit]].filter(([name])=>engines.includes(name)))await reopenKeepsSearch(type,engine);
 for(const [engine,type] of [['chrome',chromium],['webkit',webkit]].filter(([name])=>engines.includes(name))){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{
   for(const width of widths)for(const theme of themes){
    const label=`${engine}-${width}-${theme}`,{context,page,errors}=await open(browser,width,theme);
    try{
     assert.equal(await stage(page),'map',label+': 探すは地図の段で始まる');
     // 下部（カード）の高さは重なる時間が出ると変わり、地図の下端は ResizeObserver で次のフレームに追いつく。揃うのを待ってから測る（揃わなければ下で失敗）。
     await page.waitForFunction(()=>{const c=document.getElementById('skyMapCanvas').getBoundingClientRect(),f=document.querySelector('#skyMapView .sky-map-footer').getBoundingClientRect();return Math.abs(c.bottom-f.top)<=1;},null,{timeout:3000}).catch(()=>{});
     const layout=await page.evaluate(()=>{const r=n=>n.getBoundingClientRect(),top=r(document.getElementById('mapWsTop')),canvas=r(document.getElementById('skyMapCanvas')),footer=r(document.querySelector('#skyMapView .sky-map-footer')),band=r(document.getElementById('mapWsTitle')),view=r(document.getElementById('mapWsCardView'));
      return {top:top.bottom,canvasTop:canvas.top,canvasBottom:canvas.bottom,footerTop:footer.top,footerBottom:footer.bottom,height:innerHeight,overflowX:document.documentElement.scrollWidth>innerWidth+1,scrollable:document.scrollingElement.scrollHeight>innerHeight+1&&getComputedStyle(document.documentElement).overflow!=='hidden',
      band:{h:band.height,w:band.width},view:{h:view.height,w:view.width},chips:[...document.querySelectorAll('#mapWsTitle [data-chip]')].map(n=>n.textContent),date:!!document.getElementById('skyMapCalendarOpen').offsetParent,time:!!document.getElementById('skyMapTimeline').offsetParent,
      conditionsHidden:!document.getElementById('exploreConditions').offsetParent,card:document.getElementById('mapWsCardPlace').textContent+' / '+document.getElementById('mapWsCardMeta').textContent};});
     assert(!layout.overflowX&&!layout.scrollable,label+': 地図の段は横にも縦にも動かない '+JSON.stringify(layout));
     assert(Math.abs(layout.canvasTop-layout.top)<=1&&Math.abs(layout.canvasBottom-layout.footerTop)<=1&&layout.footerBottom<=layout.height+1&&layout.canvasBottom-layout.canvasTop>=150,label+': 地図は上部帯と下部の間を埋める '+JSON.stringify(layout));
     assert.deepEqual(layout.chips,['確認地点','月','東京スカイツリー','全体'],label);
     assert(layout.band.h>=44&&layout.view.h>=44&&layout.view.w>=44&&layout.date&&layout.time&&layout.conditionsHidden,label+' '+JSON.stringify(layout));
     assert.match(layout.card,/確認地点 → 東京スカイツリー \/ 対象まで [\d.]+km ・ 方位 [\d.]+°/);
     // 選んだ天体だけ、軌道は1つの円弧。
     assert.equal(await page.evaluate(()=>AstroNotesMapWorkspace.onlyBody()),'moon');
     const moonArc=await arcResidual(page);assert(moonArc.count>=8&&moonArc.residual<1.5,label+': 月の時刻点は円弧の上 '+JSON.stringify(moonArc));
     // 重なる時間は見え方と同じ外形判定の結果。押すとその時刻へ。
     const windows=await page.evaluate(()=>{const s=SkyMapUI.workspaceHost().session,v=AstroNotesAlign.prepareDailyView(s.eye,s.target,'moon',{partId:'__whole',eyeM:0}),hits=[];
      for(let at=Date.parse('2026-12-24T16:00:00+09:00');at<=Date.parse('2026-12-24T17:20:00+09:00');at+=20000)if(v(at,at)[0]?.intersects)hits.push(at);return hits.length?[hits[0],hits.at(-1)]:null;});
     assert(windows,label+': 確認日に重なりがある');
     const hm=at=>new Date(at+32400000).toISOString().slice(11,16),minute=at=>Math.round(at/60000);
     const shown=(await page.locator('#mapWsCardOverlap').innerText()).match(/^重なる (\d\d):(\d\d)〜(\d\d):(\d\d)$/),dayStart=Date.parse('2026-12-24T00:00:00+09:00');
     assert(shown,label);const [from,to]=[dayStart+(+shown[1]*60+ +shown[2])*60000,dayStart+(+shown[3]*60+ +shown[4])*60000];
     // 分へ丸めた範囲。走査の刻み（20秒）の違いで端が1分ずれることだけ許す。
     assert(Math.abs(minute(from)-Math.ceil(windows[0]/60000))<=1&&Math.abs(minute(to)-Math.floor(windows[1]/60000))<=1,label+': '+JSON.stringify({shown:shown[0],windows:windows.map(hm)}));
     await page.evaluate(()=>SkyMapUI.setTime(Date.parse('2026-12-24T12:00:00+09:00')));await page.locator('#mapWsCardOverlap').click();
     assert.equal(await page.evaluate(()=>SkyMapUI.selectionState().at),from);
     await page.evaluate(()=>SkyMapUI.setTime(Date.parse('2026-12-26T16:41:00+09:00')));
     await page.waitForFunction(()=>document.getElementById('mapWsCardOverlap').textContent==='この日は月が対象に重ならない');
     // 上部の天体を太陽にすると太陽だけ。冬の太陽も南へ膨らむ弧。
     await page.evaluate(()=>{const b=document.getElementById('skyMapBody');b.value='sun';b.dispatchEvent(new Event('change',{bubbles:true}));SkyMapUI.setTime(Date.parse('2026-12-24T12:00:00+09:00'));});
     await page.waitForFunction(()=>AstroNotesMapWorkspace.onlyBody()==='sun'&&document.querySelector('#mapWsTitle [data-chip=body]').textContent==='太陽'&&/太陽/.test(document.getElementById('mapWsCardOverlap').textContent));
     await page.waitForTimeout(200);const sunArc=await arcResidual(page);assert(sunArc.count>=6&&sunArc.residual<1.5&&!sunArc.straight,label+': 太陽も円弧 '+JSON.stringify(sunArc));
     await page.evaluate(()=>{const b=document.getElementById('skyMapBody');b.value='moon';b.dispatchEvent(new Event('change',{bubbles:true}));SkyMapUI.setTime(Date.parse('2026-12-24T16:41:00+09:00'));});
     await page.waitForFunction(()=>document.querySelector('#mapWsTitle [data-chip=body]').textContent==='月'&&/^重なる /.test(document.getElementById('mapWsCardOverlap').textContent));
     await page.screenshot({path:`${out}/${label}-map.png`});
     // 条件帯→ポップアップ（撮影条件と撮影地点を探す）→地図へ。
     await page.locator('#mapWsTitle').click();assert.equal(await stage(page),'search');
     const popup=await page.evaluate(()=>{const back=document.getElementById('exploreBackToMap').getBoundingClientRect(),visible=id=>{const n=document.getElementById(id);return !!(n?.closest('.condition-field')||n)?.offsetParent;};
      return {back:back.height,mapHidden:!document.getElementById('skyMapCanvas').offsetParent,fields:['skyMapBody','skyMapTarget','skyMapChoose','exploreShowResult','candidateWorkspaceAction'].every(visible),overflowX:document.documentElement.scrollWidth>innerWidth+1,
      footer:!!document.getElementById('skyMapCalendarOpen').offsetParent,ws:document.getElementById('skyMapView').classList.contains('map-ws')};});
     assert(popup.back>=44&&popup.mapHidden&&popup.fields&&!popup.overflowX&&popup.footer&&!popup.ws,label+': '+JSON.stringify(popup));
     await page.screenshot({path:`${out}/${label}-conditions.png`});
     await page.locator('#exploreBackToMap').click();assert.equal(await stage(page),'map');
     // 地図のカードから見え方→戻ると地図。
     await page.locator('#mapWsCardView').click();assert.equal(await stage(page),'preview');
     await page.waitForFunction(()=>{const l=document.getElementById('aimLook');return l&&!l.hidden;});
     assert.equal(await page.locator('#exploreBackToCandidates').getAttribute('aria-label'),'地図へ戻る');
     assert(await page.evaluate(()=>!document.getElementById('skyMapCanvas').offsetParent&&!!document.getElementById('skyMapCalendarOpen').offsetParent),label+': 見え方は地図を出さず、日時バーは残る');
     await page.screenshot({path:`${out}/${label}-view.png`});
     await page.locator('#exploreBackToCandidates').click();assert.equal(await stage(page),'map');
     assert(await page.evaluate(()=>document.getElementById('skyMapView').classList.contains('map-ws')));
     // ポップアップの検索から見え方→戻るとポップアップ。
     await page.locator('#mapWsTitle').click();await page.locator('#exploreShowResult').click();assert.equal(await stage(page),'preview');
     assert.notEqual(await page.locator('#exploreBackToCandidates').getAttribute('aria-label'),'地図へ戻る');
     await page.locator('#exploreBackToCandidates').click();assert.equal(await stage(page),'search');
     await page.locator('#exploreBackToMap').click();assert.equal(await stage(page),'map');
     // 重なる日・地図の候補など、ポップアップを開かずに選んだ候補も見え方を開き、戻ると地図（選択の受付は地図の段でも有効）。
     await page.evaluate(()=>{document.dispatchEvent(new Event('astronotes-candidate-selecting'));document.dispatchEvent(new CustomEvent('astronotes-candidate-selected',{detail:{}}));});
     assert.equal(await stage(page),'preview',label+': 地図の段で選んだ候補で見え方が開く');
     assert.equal(await page.locator('#exploreBackToCandidates').getAttribute('aria-label'),'地図へ戻る');
     await page.locator('#exploreBackToCandidates').click();assert.equal(await stage(page),'map');
     // 地図を動かしてからポップアップを開閉しても、同じ撮影地点と対象なら位置と縮尺は保つ。
     const before=await page.evaluate(()=>{const m=SkyMapUI.workspaceHost().map;m.setView(35.6,139.6,12.5);return {c:m.center(),z:m.zoom()};});
     await page.locator('#mapWsTitle').click();await page.locator('#exploreBackToMap').click();
     const after=await page.evaluate(()=>{const m=SkyMapUI.workspaceHost().map;return {c:m.center(),z:m.zoom()};});
     assert(Math.abs(after.z-before.z)<1e-6&&Math.abs(after.c.latitude-before.c.latitude)<1e-6&&Math.abs(after.c.longitude-before.c.longitude)<1e-6,label+': '+JSON.stringify({before,after}));
     // ☰はアプリのメニュー（無い利用者はホーム）。
     const toolsShown=await page.evaluate(()=>!document.getElementById('toolsButton').hidden);
     await page.locator('#mapWsMenuButton').click();
     if(toolsShown)await page.waitForFunction(()=>!document.getElementById('toolsMenu').hidden);else await page.waitForFunction(()=>!/^#\/explore/.test(location.hash));
     assert.deepEqual(errors,[],label+': page errors');
     results.push({label,moonArc,sunArc,windows:windows.map(hm)});
    }finally{await context.close();}
   }
  }finally{await browser.close();}
 }
 console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exit(1);});
