require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture}=require('./candidate-date-fixture.cjs');
const base=process.env.CANDIDATE_FLOW_BASE||'http://127.0.0.1:8986/trial/';
const out=process.env.CANDIDATE_FLOW_OUT||'/tmp/astronotes-candidate-workspace';fs.mkdirSync(out,{recursive:true});
const tools=['records','tower','diamond','pearl','skymap','multiscene'];
(async()=>{
 const results=[];
 for(const [engine,type] of [['chrome',chromium],['webkit',webkit]].filter(([n])=>(process.env.CANDIDATE_FLOW_ENGINES||'chrome,webkit').split(',').includes(n))){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{for(const width of (process.env.CANDIDATE_FLOW_WIDTHS||'320,390').split(',').map(Number)){
   const context=await browser.newContext({viewport:{width,height:844},colorScheme:engine==='chrome'?'light':'dark',locale:'ja-JP',timezoneId:'Asia/Tokyo',reducedMotion:'reduce'});let writes=0;
   await context.addInitScript(fixture,tools);
   await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(base).origin)return r.continue();if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(r.request().method()))writes++;return r.fulfill({json:{allowed:true,tool:'skymap',loginId:'date-test',tools,favorites:[],sightings:[],records:[],rev:1}});}return r.abort();});
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
   const sheet=page.locator('#placeSheet');
   try{
    await page.goto(base+'#/explore');await page.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof AstroNotesCandidatePicker==='object');
    await page.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>25;aimBuildingDays=async()=>[];navigationHistory.pushRoute('#/explore');SkyMapUI.setTarget('skytree');const b=document.getElementById('skyMapBody');b.value='moon';b.onchange();SkyMapUI.setTime(Date.parse('2026-11-05T03:58:31+09:00'));window.flowDateNodes=Object.fromEntries(['skyMapCalendarOpen','skyMapTimeline','skyMapRange','skyMapTime'].map(id=>[id,document.getElementById(id)]));});
    const stored=await page.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()}));
    await page.locator('#exploreFindCandidates').click();await page.locator('#candidateWorkspaceBody').waitFor({state:'visible'});await page.locator('#candidateSearchAction').waitFor();
    assert.equal(await page.locator('#placeSheetTitle').innerText(),'候補を探す');assert(await page.locator('#placeSheet .place-search-tools').isHidden());assert(await page.locator('#placeSheet .place-tabs').isHidden());
    assert.equal(await page.locator('#candidateWorkspaceDate #candidateDate').count(),1);assert.equal(await page.locator('#candidateWorkspaceAction #candidateSearchAction').count(),1);
    await page.screenshot({path:out+'/'+engine+'-'+width+'-page.png'});
    await page.locator('#candidateWorkspaceBody').selectOption('sun');await page.waitForFunction(()=>SkyMapUI.selectionState().body==='sun');await page.locator('#candidateWorkspaceBody').selectOption('moon');
    await page.locator('#candidateWorkspaceTarget').selectOption('tokyotower');await page.waitForFunction(()=>SkyMapUI.selectionState().target.id==='tokyotower');await page.locator('#candidateWorkspaceTarget').selectOption('skytree');
    await page.locator('#candidateDate').click();const calendar=page.locator('#candidateDateCalendar');await calendar.getByRole('button',{name:'2026年11月16日',exact:true}).click();
    await page.locator('#candidateSearchAction').click();await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===2&&document.getElementById('candidateSearchAction').dataset.state==='idle');
    await page.locator('#candidateKindFilter').selectOption('park');await page.locator('[data-candidate-sort=name]').click();await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===1);
    const row=page.locator('#candidateUnifiedResults .list-item:visible').first();await row.scrollIntoViewIfNeeded();
    const search=await page.evaluate(()=>({at:SkyMapUI.selectionState().at,body:SkyMapUI.selectionState().body,target:SkyMapUI.selectionState().target.id,loads:dateFixture.loads.length,scroll:document.querySelector('#placeSheet > .sheet-body').scrollTop}));
    const candidate=await page.evaluate(()=>structuredClone(AstroNotesCandidatePicker.visibleRows()[0]));
    await page.screenshot({path:out+'/'+engine+'-'+width+'-candidates.png'});await row.click();
    await page.waitForFunction(()=>!document.getElementById('placeSheet').open&&!document.getElementById('exploreBackToCandidates').hidden);
    await page.locator('#aimLook').waitFor({state:'visible'});assert.equal(await page.locator('#exploreConditions').evaluate(n=>n.open),false);
    const actual=await page.evaluate(()=>{const s=SkyMapUI.selectionState();return {at:s.at,latitude:s.observer.latitude,longitude:s.observer.longitude};});
    assert.deepEqual(actual,{at:candidate.event.at,latitude:candidate.place.latitude,longitude:candidate.place.longitude});
    assert(await page.evaluate(()=>Object.entries(flowDateNodes).every(([id,n])=>n===document.getElementById(id))));
    await page.locator('#skyMapTimeMore').click();await page.locator('#skyMapLater').click();await page.locator('.sky-map-time-dialog [data-close]').click();
    assert.equal(await page.evaluate(()=>SkyMapUI.selectionState().at),candidate.event.at+60000);
    await page.locator('#skyMapCalendarOpen').click();const detailCal=page.locator('dialog[open]').filter({has:page.locator('[data-cal-day]')});
    await detailCal.locator('[data-cal-day]').nth(16).click();if(await detailCal.isVisible())await detailCal.locator('[data-close]').click();
    await page.locator('#exploreBackToCandidates').click();await page.locator('#candidateWorkspaceBody').waitFor({state:'visible'});await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===1);
    assert.equal(await page.locator('#candidateWorkspaceBody').inputValue(),search.body);assert.equal(await page.locator('#candidateWorkspaceTarget').inputValue(),search.target);assert.equal(await page.locator('#candidateDate').getAttribute('data-date'),'2026-11-16');
    assert.equal(await page.locator('#candidateKindFilter').inputValue(),'park');assert.equal(await page.locator('[data-candidate-sort=name]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>dateFixture.loads.length),search.loads,'back restores cached candidates without searching again');
    assert(Math.abs(await page.locator('#placeSheet > .sheet-body').evaluate(n=>n.scrollTop)-search.scroll)<2,'restore candidate scroll');
    await page.evaluate(()=>{AstroNotesShooting.candidates=async plan=>({failed:0,rows:plan.target.id==='skytree'?[{id:'registered-flow',record:{result:'seen'},placeKind:'park',quality:{photographyClass:'normal'},place:{name:'登録した公園',latitude:35.692,longitude:139.732,elevation:25,groundManualM:25,eyeHeightAGL:2,decks:[]},assumedObserver:{latitude:35.692,longitude:139.732,elevation:25,eyeM:2},event:{at:AstroNotesCandidateDiscovery.day(plan.at)+13*3600000,side:'rise'}}]:[]});MyPlacesUI.imported();MyPlacesUI.renderPickerPanel(document.getElementById('recentCandidates'));});
    await page.locator('#candidateUnifiedResults .list-item').filter({hasText:'登録した公園'}).click();await page.waitForFunction(()=>!document.getElementById('placeSheet').open);
    assert.equal(await page.evaluate(()=>SkyMapUI.selectionState().observer.name),'登録した公園');assert(await page.locator('#exploreBackToCandidates').isVisible());
    await page.locator('#exploreBackToCandidates').click();await page.locator('#candidateWorkspaceBody').waitFor({state:'visible'});assert.equal(await page.locator('#candidateDate').getAttribute('data-date'),'2026-11-16');
    await page.locator('#candidateWorkspaceTarget').selectOption('tokyotower');await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===0);
    await page.locator('#placeSheet .page-back').click();await page.waitForFunction(()=>!document.getElementById('placeSheet').open);
    if(!await page.locator('#exploreConditions').evaluate(n=>n.open))await page.locator('#exploreConditions > summary').click();
    await page.locator('#exploreRecordedPlace').click();assert(await page.locator('#placeSheet .place-search-tools').isVisible());assert(await page.locator('#placeTab-records').isVisible());
    await page.locator('#placeSheet .page-back').click();assert.equal(await page.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()})),stored);
    await page.locator('#exploreFindCandidates').click();await page.locator('#candidateWorkspaceBody').waitFor({state:'visible'});
    await page.evaluate(()=>{auth.loginId='other-fixture-owner';TrialExplore.render();});await page.waitForFunction(()=>!document.getElementById('placeSheet').open);
    assert(await page.locator('#exploreBackToCandidates').isHidden());assert.equal(await page.locator('#candidateWorkspaceTarget option').count(),0);
    assert.equal(writes,0);assert.deepEqual(errors,[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    results.push({engine,width,dedicatedCandidatePage:true,conditionsEditableInPage:true,generatedAndRegisteredToExistingScene:true,existingDateControls:true,returnRestoresConditionsResultsFilterSortScroll:true,noSearchOnReturn:true,recordPickerUnchanged:true,accountChangeClearsWorkspace:true,writes});fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(engine,width,'approved candidate flow passed');
   }catch(e){await page.screenshot({path:out+'/'+engine+'-'+width+'-failure.png'}).catch(()=>{});console.error('flow state',await page.evaluate(()=>({title:document.getElementById('placeSheetTitle')?.textContent,workspace:document.getElementById('placeSheet')?.dataset.candidateWorkspace,open:document.getElementById('placeSheet')?.open,back:document.getElementById('exploreBackToCandidates')?.hidden,body:document.getElementById('candidateWorkspaceBody')?.value,target:document.getElementById('candidateWorkspaceTarget')?.value,rows:AstroNotesCandidatePicker.visibleRows().length})).catch(()=>null),errors);throw e;}finally{await context.close();}
  }}finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exit(1);});
