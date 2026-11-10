require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture}=require('./candidate-date-fixture.cjs');
const base=process.env.CANDIDATE_FLOW_BASE||'http://127.0.0.1:8986/trial/';
const out=process.env.CANDIDATE_FLOW_OUT||'/tmp/astronotes-candidate-workspace';fs.mkdirSync(out,{recursive:true});
const tools=['records','tower','diamond','pearl','skymap','multiscene'];
async function assertIdleSearch(page){
 // The section heading replaces the duplicate empty-state explanation; results still stay hidden until a search completes.
 const heading=page.locator('#candidateWorkspaceHeading');assert(await heading.isVisible());assert.equal(await heading.innerText(),'撮影地点を探す');assert(await page.locator('#candidateSearchEmpty').isHidden());assert(await page.locator('#recentCandidates').isHidden());assert(await page.locator('#exploreResultsHeading').isHidden());
}
(async()=>{
 const results=[];
 for(const [engine,type] of [['chrome',chromium],['webkit',webkit]].filter(([n])=>(process.env.CANDIDATE_FLOW_ENGINES||'chrome,webkit').split(',').includes(n))){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{for(const width of (process.env.CANDIDATE_FLOW_WIDTHS||'320,390').split(',').map(Number)){
   const context=await browser.newContext({viewport:{width,height:844},colorScheme:engine==='chrome'?'light':'dark',locale:'ja-JP',timezoneId:'Asia/Tokyo',reducedMotion:'reduce'});let writes=0;
   await context.addInitScript(fixture,tools);if(process.env.CANDIDATE_FLOW_LENS==='manual')await context.addInitScript(()=>localStorage.setItem('sorami.lens',JSON.stringify({on:true,mode:'manual',focal:50,sensor:'full',portrait:false})));
   await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(base).origin)return r.continue();if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(r.request().method()))writes++;return r.fulfill({json:{allowed:true,tool:'skymap',loginId:'date-test',tools,favorites:[],sightings:[],records:[],rev:1}});}return r.abort();});
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
   const sheet=page.locator('#placeSheet');
   try{
    await page.goto(base+'#/explore');const version=await page.locator('meta[name=app-version]').getAttribute('content');await page.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof AstroNotesCandidatePicker==='object');
    await page.evaluate(async()=>{await startupSessionReady;window.flowRenderCalls=0;const draw=aimLookRender;aimLookRender=async(...args)=>{flowRenderCalls++;return draw(...args);};await AstroNotesAssets.ensureModels();groundAt=async()=>25;aimBuildingDays=async()=>[];navigationHistory.pushRoute('#/explore');SkyMapUI.setTarget('skytree');const b=document.getElementById('skyMapBody');b.value='moon';b.onchange();SkyMapUI.setTime(Date.parse('2026-11-05T03:58:31+09:00'));window.flowDateNodes=Object.fromEntries(['skyMapCalendarOpen','skyMapTimeline','skyMapRange','skyMapTime'].map(id=>[id,document.getElementById(id)]));});
    const stored=await page.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()}));
    await page.locator('#exploreDiscovery-new').click();await page.locator('#candidateSearchAction').waitFor({state:'visible'});
    const conditionLayout=await page.evaluate(()=>{const fields=document.querySelector('.explore-condition-fields'),point=document.getElementById('skyMapChoose').closest('.aim-say-from'),search=document.getElementById('candidateSearchAction'),a=point.getBoundingClientRect(),b=search.getBoundingClientRect(),f=fields.getBoundingClientRect();return {sameConditions:fields.contains(point)&&fields.contains(search),pointBeforeSearch:!!(point.compareDocumentPosition(search)&Node.DOCUMENT_POSITION_FOLLOWING),pointAboveSearch:a.bottom<=b.top,pointFullWidth:Math.abs(a.width-f.width)<2,separatePlaceSections:document.querySelectorAll('.explore-known-place').length};});
    assert.deepEqual(conditionLayout,{sameConditions:true,pointBeforeSearch:true,pointAboveSearch:true,pointFullWidth:true,separatePlaceSections:0},'location belongs to the common conditions before search at every viewport');
    assert(await page.locator('#exploreScenePanel').isHidden());assert(await page.locator('.sky-map-footer').isVisible());assert(await page.locator('.sky-map-footer .sky-map-candidates').isHidden());await assertIdleSearch(page);assert.equal(await page.evaluate(()=>flowRenderCalls),0);assert.equal(await page.locator('#aimLook canvas').count(),0);assert(!await sheet.evaluate(n=>n.open));
    assert.equal(await page.locator('#candidateWorkspaceDate,#candidateDateNavigation,#candidateDate').count(),0);assert.equal(await page.locator('.sky-map-footer .tool-datetime-row').count(),1);assert.equal(await page.locator('#candidateWorkspaceAction #candidateSearchAction').count(),1);
    await page.screenshot({path:out+'/'+engine+'-'+width+'-page.png'});
    await page.locator('#skyMapBody').selectOption('sun',{force:true});await page.waitForFunction(()=>SkyMapUI.selectionState().body==='sun');await page.locator('#skyMapBody').selectOption('moon',{force:true});
    await page.evaluate(()=>SkyMapUI.setTarget('tokyotower')); await page.waitForFunction(()=>SkyMapUI.selectionState().target.id==='tokyotower');await page.evaluate(()=>SkyMapUI.setTarget('skytree'));
    await page.locator('#skyMapCalendarOpen').click();const calendar=page.locator('dialog.tool-date-calendar[open]');await calendar.locator('[data-cal-day="'+Date.parse('2026-11-16T00:00:00+09:00')+'"]').click();
    await page.locator('#exploreDiscovery-new').click();await page.locator('#candidateSearchAction').click();await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===2&&document.getElementById('candidateSearchAction').dataset.state==='idle');
    assert(await page.locator('#exploreScenePanel').isHidden());assert(!await sheet.evaluate(n=>n.open));assert.equal(await page.evaluate(()=>flowRenderCalls),0);
    await page.locator('#candidateKindFilter').selectOption('park');await page.locator('[data-candidate-sort=name]').click();await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===1);
    const row=page.locator('#candidateUnifiedResults .list-item:visible').first();await row.scrollIntoViewIfNeeded();
    const search=await page.evaluate(()=>({at:SkyMapUI.selectionState().at,body:SkyMapUI.selectionState().body,target:SkyMapUI.selectionState().target.id,loads:dateFixture.loads.length,scroll:document.scrollingElement.scrollTop}));
    const candidate=await page.evaluate(()=>structuredClone(AstroNotesCandidatePicker.visibleRows()[0]));
    await page.screenshot({path:out+'/'+engine+'-'+width+'-candidates.png'});await row.click();
    await page.waitForFunction(()=>!document.getElementById('placeSheet').open&&!document.getElementById('exploreBackToCandidates').hidden);
    await page.locator('#aimLook').waitFor({state:'visible'});
    // 2026-11-11 見え方でも条件は折りたたんで出す（何の条件の見え方か分かり、その場で変えられる）。戻るボタンはその行の左。
    assert(await page.locator('#exploreConditions').isVisible());assert.equal(await page.locator('#exploreConditions').getAttribute('open'),null);assert(await page.locator('#exploreConditions > summary #exploreBackToCandidates').isVisible());
    const actual=await page.evaluate(()=>{const s=SkyMapUI.selectionState();return {at:s.at,latitude:s.observer.latitude,longitude:s.observer.longitude};});
    assert.deepEqual(actual,{at:candidate.event.at,latitude:candidate.place.latitude,longitude:candidate.place.longitude});
    assert(await page.evaluate(()=>Object.entries(flowDateNodes).every(([id,n])=>n===document.getElementById(id))));
    await page.locator('#skyMapTimeMore').click();await page.locator('#skyMapLater').click();await page.locator('.sky-map-time-dialog [data-close]').click();
    assert.equal(await page.evaluate(()=>SkyMapUI.selectionState().at),candidate.event.at+60000);
    await page.locator('#skyMapCalendarOpen').click();const detailCal=page.locator('dialog[open]').filter({has:page.locator('[data-cal-day]')});
    await detailCal.locator('[data-cal-day]').nth(16).click();if(await detailCal.isVisible())await detailCal.locator('[data-close]').click();
    await page.locator('#exploreBackToCandidates').click();await page.locator('#candidateSearchAction').waitFor({state:'visible'});await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===1);
    assert.equal(await page.locator('#skyMapBody').inputValue(),search.body);assert.equal(await page.evaluate(()=>SkyMapUI.selectionState().target.id),search.target);assert.equal(await page.locator('#skyMapCalendarOpen').getAttribute('data-display-date'),'2026-11-16');
    assert.equal(await page.locator('#candidateKindFilter').inputValue(),'park');assert.equal(await page.locator('[data-candidate-sort=name]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>dateFixture.loads.length),search.loads,'back restores cached candidates without searching again');assert(await page.locator('.sky-map-footer').isVisible());assert(await page.evaluate(()=>Object.entries(flowDateNodes).every(([id,n])=>n===document.getElementById(id))));
    await page.waitForFunction(top=>Math.abs(document.scrollingElement.scrollTop-top)<2,search.scroll);
    if(process.env.CANDIDATE_FLOW_LENS!=='manual'){
    // The records tab runs in the calculation workers (C20); keep it on this page so the stub below is used.
    await page.evaluate(()=>{globalThis.AstroNotesDiscoveryEngine='page';AstroNotesShooting.candidates=async plan=>({failed:0,rows:plan.target.id==='skytree'?[{id:'registered-flow',record:{result:'seen'},placeKind:'park',quality:{photographyClass:'normal'},place:{name:'登録した公園',latitude:35.692,longitude:139.732,elevation:25,groundManualM:25,eyeHeightAGL:2,decks:[]},assumedObserver:{latitude:35.692,longitude:139.732,elevation:25,eyeM:2},event:{at:AstroNotesCandidateDiscovery.day(plan.at)+13*3600000,side:'rise'}}]:[]});MyPlacesUI.discoveryPoints=()=>[{place:{id:'registered-flow',name:'登録した公園',latitude:35.692,longitude:139.732,elevation:25,eyeHeightAGL:2},record:{result:'seen'}}];MyPlacesUI.imported();});
    await page.locator('#exploreDiscovery-records').click();await page.locator('#exploreRecordedResults .explore-record-row').filter({hasText:'登録した公園'}).click();await page.waitForFunction(()=>!document.getElementById('placeSheet').open);
    assert.equal(await page.evaluate(()=>SkyMapUI.selectionState().observer.name),'登録した公園');assert(await page.locator('#exploreBackToCandidates').isVisible());
    await page.locator('#exploreBackToCandidates').click();await page.locator('#exploreDiscovery-new').click();await page.locator('#candidateSearchAction').waitFor({state:'visible'});assert.equal(await page.locator('#skyMapCalendarOpen').getAttribute('data-display-date'),'2026-11-16');
    }
    await page.evaluate(()=>SkyMapUI.setTarget('tokyotower')); await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===0);
    const changedNotice=page.locator('#candidateSearchEmpty');await changedNotice.waitFor({state:'visible'});assert(await changedNotice.isVisible(),'changing a searched condition keeps the re-search instruction visible');assert.equal(await changedNotice.innerText(),'条件を変更しました。もう一度候補を探してください。');assert(await page.locator('#recentCandidates').isHidden());assert.equal(await page.locator('#candidateUnifiedResults .list-item:visible').count(),0,'old candidates disappear after the target changes');await page.screenshot({path:out+'/'+engine+'-'+width+'-changed-condition.png'});
    assert(await page.locator('#exploreScenePanel').isHidden());
    await page.locator('#skyMapChoose').click();assert(await page.locator('#placeSheet .place-search-tools').isVisible());assert(await page.locator('#placeTab-records').isVisible());await page.locator('#placeTab-records').click();
    await page.locator('#placeSheet .page-back').click();assert.equal(await page.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()})),stored);
    await page.evaluate(()=>dateFixture.holdNext=true);await page.locator('#candidateSearchAction').click();await page.waitForFunction(()=>dateFixture.holds.length===1);
    await page.evaluate(()=>{accessState.generation++;TrialExplore.render();});await page.waitForFunction(()=>document.getElementById('candidateSearchAction')?.dataset.state==='idle');
    await page.evaluate(()=>dateFixture.holds.shift().release());await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>AstroNotesCandidatePicker.visibleRows().length),0);await assertIdleSearch(page);
    await page.evaluate(()=>{auth.loginId='other-fixture-owner';TrialExplore.render();});
    assert(await page.locator('#exploreBackToCandidates').isHidden());assert(await page.locator('#exploreScenePanel').isHidden());
    assert.equal(writes,0);assert.deepEqual(errors,[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    results.push({engine,width,version,idleSearchHeading:true,changedConditionNoticeVisible:true,inlineCandidatePage:true,lens:process.env.CANDIDATE_FLOW_LENS||'auto',generationRetiresPendingJob:true,initialPreviewHidden:true,searchPreviewHidden:true,conditionsEditableInPage:true,generatedAndRegisteredToExistingScene:true,existingDateControls:true,returnRestoresConditionsResultsFilterSortScroll:true,noSearchOnReturn:true,recordPickerUnchanged:true,accountChangeClearsWorkspace:true,writes});fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(engine,width,'approved candidate flow passed');
   }catch(e){await page.screenshot({path:out+'/'+engine+'-'+width+'-failure.png'}).catch(()=>{});console.error('flow state',await page.evaluate(()=>({title:document.getElementById('placeSheetTitle')?.textContent,workspace:document.getElementById('placeSheet')?.dataset.candidateWorkspace,open:document.getElementById('placeSheet')?.open,back:document.getElementById('exploreBackToCandidates')?.hidden,body:document.getElementById('candidateWorkspaceBody')?.value,target:document.getElementById('candidateWorkspaceTarget')?.value,rows:AstroNotesCandidatePicker.visibleRows().length})).catch(()=>null),errors);throw e;}finally{await context.close();}
  }}finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exit(1);});
