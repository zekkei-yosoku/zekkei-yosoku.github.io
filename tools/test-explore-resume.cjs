require('./no-open-meteo.cjs');
// 2026-11-25 ユーザー「重なる日時の候補を押してもボタンが効いてない」「別のAppに飛んで戻ると一覧に移動してる」
// 「一覧に移動すると条件変わってないのに毎回検索始める」:
// 1) the view loads weather (気象予報) after the dates were found; the date buttons still move the time.
// 2) iOS drops a backgrounded page and reloads it: the same candidate's view and its time come back, and the list
//    returns without searching again.
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict');
const {fixture}=require('./candidate-date-fixture.cjs');
const base=process.env.COMPOSE_BASE||'http://127.0.0.1:8992/trial/',tools=['records','tower','diamond','pearl','skymap','multiscene'];
const day=Date.parse('2026-11-25T16:52:00+09:00');
(async()=>{
 for(const [engine,type,width] of [['chrome',chromium,390],['webkit',webkit,320]]){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{
   const context=await browser.newContext({viewport:{width,height:844},locale:'ja-JP',timezoneId:'Asia/Tokyo',reducedMotion:'reduce'});
   await context.addInitScript(fixture,tools);
   await context.addInitScript(d=>{window.__days=[{at:d,side:'rise',illuminated:.99,sunAltitude:-1},{at:d+27*86400000,side:'rise',illuminated:.97,sunAltitude:-1}];},day);
   // The resume scenario uses an offline elevation service so reloading a direct
   // preview never depends on WebKit's handling of aborted cross-origin terrain tiles.
   await context.addInitScript(()=>{
    const fetch=window.fetch.bind(window);
    window.fetch=(input,options)=>{
     const url=new URL(input instanceof Request?input.url:input,location.href);
     if(url.hostname==='cyberjapandata2.gsi.go.jp')return Promise.resolve(Response.json({elevation:25,hsrc:'DEM5A'}));
     if(url.hostname==='cyberjapandata.gsi.go.jp')return Promise.resolve(new Response(null,{status:404}));
     return fetch(input,options);
    };
   });
   await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(base).origin)return r.continue();if(u.hostname==='cyberjapandata.gsi.go.jp')return r.fulfill({status:404,headers:{'access-control-allow-origin':'*'},body:''});if(/zekkei-api|localhost:8787/.test(u.origin))return r.fulfill({json:{allowed:true,tool:'skymap',loginId:'date-test',tools,favorites:[],sightings:[],records:[],rev:1}});return r.abort();});
   const p=await context.newPage(),errors=[];p.setDefaultTimeout(30000);p.on('pageerror',e=>errors.push(e.message));
   const boot=async()=>{await p.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof AstroNotesCandidatePicker==='object'&&typeof startupSessionReady!=='undefined');
    await p.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>25;aimBuildingDays=async()=>window.__days;});};
   await p.goto(base+'#/explore');await boot();
   await p.evaluate(d=>{navigationHistory.pushRoute('#/explore');SkyMapUI.setTarget('skytree');const b=document.getElementById('skyMapBody');b.value='moon';b.onchange();SkyMapUI.setTime(d);},day);
   await p.waitForFunction(()=>document.getElementById('skyMapView').classList.contains('map-ws')&&SkyMapUI.workspaceHost());
   await p.evaluate(()=>SkyMapUI.workspaceHost().restoreObserver(null));
   await p.waitForFunction(()=>document.getElementById('skyMapView').dataset.mapCenter==='target'&&document.getElementById('mapWsCardView')?.dataset.action==='search');
   await p.locator('#mapWsCardView').click();
   await p.locator('#skyMapView[data-explore-sheet] #skyMapCanvas').waitFor({state:'visible'});
   await p.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===2&&document.getElementById('candidateSearchAction').dataset.state==='idle');
   await p.locator('#candidateUnifiedResults .list-item:not([hidden])').first().click();
   await p.waitForFunction(()=>{const h=document.getElementById('aimLook');return !h.hidden&&h._lookLayers?.stats?.frames>0&&h._compose&&!h._compose.apply;});
   await p.waitForFunction(()=>document.querySelectorAll('#skyMapDates [data-from-day]').length===2);
   const id=await p.evaluate(()=>SkyMapUI.selectionState().candidateOpportunity?.id);
   // 1) Weather arrives in the view: the second date still moves the time there.
   await p.evaluate(()=>{const key=AstroNotesAtmosphere.dataKey;AstroNotesAtmosphere.dataKey=(...a)=>key(...a)+'+weather-loaded-in-view';});
   await p.locator('#skyMapDates [data-from-day]').nth(1).click();
   const second=day+27*86400000;await p.waitForFunction(at=>SkyMapUI.selectionState().at===at,second);
   assert.equal(await p.locator('#skyMapDates [data-from-day]').nth(1).getAttribute('aria-pressed'),'true');
   // 2) The page goes to the background and iOS reloads it.
   await p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
   assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('astronotes.exploreResume')).stage),'preview');
   await p.reload();await boot();
   await p.waitForFunction(({at,id})=>document.getElementById('skyMapView').dataset.exploreStage==='preview'&&SkyMapUI.selectionState()?.at===at&&SkyMapUI.selectionState()?.candidateOpportunity?.id===id,{at:second,id});
   assert.equal(await p.evaluate(()=>dateFixture.loads.length),0,'the view comes back without searching');
   await p.locator('#exploreBackToCandidates').click();await p.waitForFunction(()=>document.getElementById('skyMapView').hasAttribute('data-explore-sheet'));
   await p.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===2);
   await p.waitForTimeout(800);assert.equal(await p.evaluate(()=>dateFixture.loads.length),0,'the list comes back without searching');
   assert(await p.locator('#skyMapView[data-explore-sheet] #skyMapCanvas').isVisible(),'the restored list stays over the map');
   assert.equal(await p.evaluate(()=>document.getElementById('candidateSearchAction').dataset.state),'idle');
   // A reload on the list keeps the list too.
   await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
   await p.reload();await boot();
   await p.waitForFunction(()=>document.getElementById('skyMapView').hasAttribute('data-explore-sheet')&&AstroNotesCandidatePicker.visibleRows().length===2);
   assert.equal(await p.evaluate(()=>dateFixture.loads.length),0);
   // 3) The confirmed rows of a large unfinished search survive reload and
   // continue through the real button, keeping the old entries exactly once.
   await p.evaluate(at=>{dateFixture.autoPages=true;dateFixture.nextCursor=7;dateFixture.holdCursor=7;dateFixture.largeCoverage=true;SkyMapUI.setTime(at);},second+86400000);
   const action=p.locator('#candidateSearchAction');
   await p.waitForFunction(()=>document.getElementById('candidateSearchAction')?.textContent==='候補を探す');
   await action.click();
   await p.waitForFunction(()=>dateFixture.holds.length===1&&AstroNotesCandidatePicker.visibleRows().length===2);
   await action.click();
   await p.waitForFunction(()=>document.getElementById('candidateSearchAction')?.textContent==='続きを探す');
   await p.evaluate(()=>dateFixture.holds.shift().release());
   const cached=()=>p.evaluate(()=>AstroNotesCandidatePicker.exportSearch()?.result.rows.map(r=>({id:r.id,rank:r.rank})));
   const before=await cached();
   await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
   const stored=await p.evaluate(()=>localStorage.getItem('astronotes.exploreResume'));
   assert(stored&&stored.length<20000,'only the rows and coverage summary belong in the reload snapshot');
   assert.equal(JSON.parse(stored).search.result.coverage.loaded,undefined);
   await p.reload();await boot();
   await p.waitForFunction(()=>document.getElementById('candidateSearchAction')?.textContent==='続きを探す'&&AstroNotesCandidatePicker.visibleRows().length===2);
   assert.deepEqual(await cached(),before);
   assert.equal(await p.evaluate(()=>dateFixture.loads.length),0);
   await p.evaluate(()=>{dateFixture.extraOnCursor=0;});
   await action.click();
   await p.waitForFunction(()=>document.getElementById('candidateSearchAction')?.textContent==='候補を探し直す'&&AstroNotesCandidatePicker.visibleRows().length===3);
   const after=await cached();
   assert.deepEqual(after.slice(0,before.length),before);
   assert.equal(new Set(after.map(row=>row.id)).size,3);
   assert.deepEqual(await p.evaluate(()=>dateFixture.loads.map(load=>load.cursor)),[0]);
   // Closing the sheet preserves its cache without opening the sheet on a reload.
   await p.locator('#exploreBackToMap').click();
   await p.waitForFunction(()=>document.getElementById('skyMapView').dataset.exploreStage==='map');
   await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
   assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('astronotes.exploreResume')).stage),'map');
   await p.reload();await boot();
   await p.locator('#skyMapView[data-explore-stage="map"] #skyMapCanvas').waitFor({state:'visible'});
   await p.waitForFunction(()=>AstroNotesCandidatePicker.exportSearch()?.result.rows.length===3);
   assert.equal(await p.locator('#skyMapView').getAttribute('data-explore-sheet'),null);
   assert.equal(await p.evaluate(()=>dateFixture.loads.length),0);
   // A preview opened by the map card restores directly and goes back to the map.
   await p.evaluate(()=>{SkyMapUI.setObserver({name:'復元検査地点',latitude:35.7119,longitude:139.8089,groundManualM:25,standAglM:1.5});});
   const center=p.locator('#mapWsCenterToggle');
   if(await center.getAttribute('data-center')==='target')await center.click();
   await p.getByRole('button',{name:'見え方を開く',exact:true}).click();
   await p.waitForFunction(()=>document.getElementById('skyMapView').dataset.exploreStage==='preview');
   await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
   assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('astronotes.exploreResume')).from),'map');
   await p.reload();await boot();
   await p.getByRole('button',{name:'地図へ戻る',exact:true}).waitFor({state:'visible'});
   await p.getByRole('button',{name:'地図へ戻る',exact:true}).click();
   await p.locator('#skyMapView[data-explore-stage="map"] #skyMapCanvas').waitFor({state:'visible'});
   assert.equal(await p.locator('#skyMapView').getAttribute('data-explore-sheet'),null);
   assert.deepEqual(errors,[]);console.log('PASS',engine,width);
   await context.close();
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exit(1);});
