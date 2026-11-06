// Real trial UI; synthetic account/geocoding only. No production API writes.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.EXPLORE_PLACE_BASE||'http://127.0.0.1:8986/trial/';
const out=process.env.EXPLORE_PLACE_OUT||'/tmp/astronotes-explore-place-entry';fs.mkdirSync(out,{recursive:true});
const tools=['records','tower','diamond','pearl','skymap','multiscene'];
async function assertPrimarySearch(page){
 const layout=await page.evaluate(()=>{
  const direct=document.getElementById('exploreShowResult'),fields=document.querySelector('.explore-condition-fields'),height=document.getElementById('skyMapObserverDetails'),details=document.getElementById('exploreHeightFields'),heading=document.getElementById('candidateWorkspaceHeading');
  const d=direct.getBoundingClientRect(),f=fields.getBoundingClientRect(),h=height.getBoundingClientRect(),e=details.getBoundingClientRect(),a=heading.getBoundingClientRect(),style=getComputedStyle(fields),before=(x,y)=>!!(x.compareDocumentPosition(y)&Node.DOCUMENT_POSITION_FOLLOWING);
  return {count:document.querySelectorAll('#exploreShowResult').length,label:direct.innerText,name:direct.getAttribute('aria-label'),icon:!!direct.querySelector('svg[aria-hidden=true]'),fullWidth:Math.abs(d.left-f.left-parseFloat(style.paddingLeft)-parseFloat(style.borderLeftWidth))<1&&Math.abs(f.right-d.right-parseFloat(style.paddingRight)-parseFloat(style.borderRightWidth))<1,tappable:d.height>=44,afterHeight:(!h.height||h.bottom<=d.top+1)&&(!height.open||e.bottom<=d.top+1),beforeAlternatives:d.bottom<=a.top+1&&before(direct,heading),separateFromHeight:!height.contains(direct)};
 });
 assert.equal(layout.count,1);assert.equal(layout.label,'検索');assert(layout.name.includes('検索')&&layout.icon&&layout.fullWidth&&layout.tappable&&layout.afterHeight&&layout.beforeAlternatives&&layout.separateFromHeight,JSON.stringify(layout));
}
(async()=>{
 const results=[];
 for(const [engine,type] of [['chrome',chromium],['webkit',webkit]]){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{for(const width of [320,390]){
   const context=await browser.newContext({viewport:{width,height:844},colorScheme:engine==='chrome'?'light':'dark',locale:'ja-JP',timezoneId:'Asia/Tokyo',reducedMotion:'reduce'});let writes=0;
   await context.addInitScript(tools=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-place-entry',loginId:'place-entry-test',tools})),tools);
   await context.route('**/*',r=>{
    const u=new URL(r.request().url());if(u.origin===new URL(base).origin)return r.continue();
    if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(r.request().method())){writes++;console.log('synthetic API write',r.request().method(),u.pathname);}return r.fulfill({json:{allowed:true,tool:'skymap',loginId:'place-entry-test',tools,favorites:[],sightings:[],records:[],rev:1}});}
    if(u.hostname==='msearch.gsi.go.jp')return r.fulfill({json:[{type:'Feature',geometry:{type:'Point',coordinates:[139.832,35.642]},properties:{title:'東京都江東区新木場四丁目'}}]});
    if(u.hostname==='nominatim.openstreetmap.org')return r.fulfill({json:u.pathname==='/reverse'?{address:{quarter:'新木場四丁目',state:'東京都',city:'江東区'}}:[]});
    return r.abort();
   });
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
   try{
    await page.goto(base+'#/explore');await page.waitForFunction(()=>typeof MyPlacesUI==='object'&&typeof TrialExplore==='object');
    await page.evaluate(async()=>{
     await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>25;aimBuildingDays=async()=>[];
     navigationHistory.pushRoute('#/explore');SkyMapUI.setTarget('skytree');const body=document.getElementById('skyMapBody');body.value='moon';body.onchange();SkyMapUI.setTime(Date.parse('2026-11-05T03:58:31+09:00'));
     const f={id:'recorded-place',name:'記録した河川敷',latitude:35.69,longitude:139.73,elevation:25,groundManualM:25,eyeHeightAGL:2.5};
     favorites=[f,{...f,id:'bare-favorite',name:'お気に入りのみの地点'}];
     store.set(AstroNotesLibrary.keys(auth.loginId).observations,[{id:'entry-record',placeId:f.id,target:{key:'skytree',name:'東京スカイツリー'},registration:true,result:'seen',createdAt:1,updatedAt:1}]);
     // The fixture represents an already-synced record, not a new local edit.
     RecordSync.accepted([RecordSync.item('rec:obs:entry-record')]);MyPlacesUI.imported();
     window.placeEntryNodes=Object.fromEntries(['skyMapCalendarOpen','skyMapRange','skyMapTimeline','skyMapTime'].map(id=>[id,document.getElementById(id)]));
    });
    await page.locator('#exploreDiscovery-new').click();await page.locator('#candidateSearchAction').waitFor();
    assert(await page.locator('.sky-map-footer').isVisible());assert.equal(await page.locator('#candidateWorkspaceDate,#candidateDateNavigation,#candidateDate').count(),0);
    const initial=await page.evaluate(()=>({at:SkyMapUI.selectionState().at,body:SkyMapUI.selectionState().body,target:SkyMapUI.selectionState().target.id,saved:JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()})}));
    assert.equal(await page.locator('#exploreRecordedPlace,.explore-place-actions').count(),0);assert(await page.locator('#exploreShowResult').isVisible());
    await assertPrimarySearch(page);
    await page.evaluate(()=>{const target=document.getElementById('skyMapTarget');target.value='';target.dispatchEvent(new Event('change',{bubbles:true}));});
    await page.locator('#exploreShowResult').click();await page.locator('#previewTargetDialog').waitFor({state:'visible'});
    await page.keyboard.press('Escape');await page.locator('#previewTargetDialog').waitFor({state:'hidden'});await page.evaluate(()=>SkyMapUI.setTarget('skytree'));
    assert.equal(await page.evaluate(()=>SkyMapUI.selectionState().observer),null);
    await page.locator('#exploreShowResult').click();await page.locator('#placeSheet').waitFor({state:'visible'});assert(await page.locator('#placeSheet .place-search-tools').isVisible());
    await page.locator('#placeSheet .page-back').click();await page.waitForFunction(()=>!document.getElementById('placeSheet').open);await assertPrimarySearch(page);
    await page.screenshot({path:out+'/'+engine+'-'+width+'-initial.png',fullPage:true});
    await page.locator('#skyMapChoose').click();await page.locator('#searchBox').fill('東京都江東区新木場四丁目');await page.locator('#searchBoxGo').click();
    await page.locator('#searchResults button').first().click();await page.waitForFunction(()=>!document.getElementById('placeSheet').open);
    assert.equal(await page.evaluate(()=>SkyMapUI.selectionState().at),initial.at);
    assert.equal(await page.evaluate(()=>SkyMapUI.selectionState().observer.latitude),35.642);
    await page.locator('#skyMapChoose').click();await page.locator('#placeTab-records').click();await page.locator('#recentRecordedPlaces').waitFor({state:'visible'});
    assert.equal(await page.locator('[data-recorded-place]').count(),1);assert.equal(await page.locator('[data-recorded-place=bare-favorite]').count(),0);
    await page.getByRole('searchbox',{name:'撮影地点を検索',exact:true}).fill('一致しない');assert.equal(await page.locator('[data-recorded-place]').count(),0);
    await page.getByRole('searchbox',{name:'撮影地点を検索',exact:true}).fill('河川敷');await page.locator('[data-recorded-place=recorded-place]').click();
    await page.waitForFunction(()=>!document.getElementById('placeSheet').open);
    const selected=await page.evaluate(()=>{const s=SkyMapUI.selectionState();return {name:s.observer.name,at:s.at,body:s.body,target:s.target.id};});
    assert.deepEqual(selected,{name:'記録した河川敷',at:initial.at,body:initial.body,target:initial.target});
    await assertPrimarySearch(page);
    assert(await page.locator('#skyMapShareRow').isHidden(),'place save/share belongs to the preview, not candidate search');
    assert(await page.locator('#skyMapObserverFav').isVisible());
    await page.locator('#skyMapObserverDetails > summary').click();
    await assertPrimarySearch(page);
    assert(await page.locator('#skyMapObserverDetails').evaluate(n=>{const r=n.getBoundingClientRect(),summary=n.querySelector('summary').getBoundingClientRect(),fields=document.getElementById('exploreHeightFields').getBoundingClientRect();return fields.top>=summary.bottom-1&&fields.width>=r.width-2;}),'expanded height fields keep full width above the primary search');
    await page.locator('#skyMapGroundHeight').fill('42');await page.locator('#skyMapGroundHeight').dispatchEvent('change');
    await page.locator('#skyMapStandHeight').fill('4');await page.locator('#skyMapStandHeight').dispatchEvent('change');
    assert.deepEqual(await page.evaluate(()=>{const o=SkyMapUI.selectionState().observer;return [o.groundManualM,o.standAglM];}),[42,4]);
    await page.locator('#skyMapGroundAuto').click();await page.locator('#skyMapStandAuto').click();
    assert.deepEqual(await page.evaluate(()=>{const o=SkyMapUI.selectionState().observer;return [o.groundManualM,o.standAglM];}),[null,null]);
    await page.locator('#skyMapObserverDetails > summary').click();
    await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:out+'/'+engine+'-'+width+'-search.png',fullPage:true});
    for(let visit=0;visit<2;visit++){
     await page.evaluate(()=>navigationHistory.pushRoute('#/records'));await page.waitForFunction(()=>!document.getElementById('candidateSearchAction'));
     assert.equal(await page.locator('#exploreShowResult,.explore-place-tools').count(),0);assert.equal(await page.locator('.aim-observer-card #skyMapObserverDetails').count(),1);
     await page.evaluate(()=>navigationHistory.pushRoute('#/explore'));await page.locator('#candidateSearchAction').waitFor();
     assert.equal(await page.locator('#candidateSearchAction').count(),1);assert.equal(await page.locator('#exploreRecordedPlace,.explore-place-actions').count(),0);assert(await page.locator('.sky-map-footer').isVisible());assert(await page.evaluate(()=>Object.entries(placeEntryNodes).every(([id,n])=>n===document.getElementById(id))));
     await assertPrimarySearch(page);
    }
    assert(await page.locator('#exploreScenePanel').isHidden());
    await page.locator('#exploreShowResult').click();await page.locator('#aimLook').waitFor({state:'visible'});
    const recordSave=page.locator('#trialRecordSave'),recordSheet=page.locator('#trialRecordSaveSheet');
    await recordSave.waitFor({state:'visible'});assert(await page.locator('#aimLook [data-plan-action=share]').isVisible());
    assert(await recordSheet.isHidden());assert.equal(await page.locator('#aimLook .trial-scene-toolbar [data-quick-save]:visible').count(),0,'save destinations are hidden until the record chooser opens');
    const beforeRecordChooser=await page.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()}));
    await recordSave.click();await recordSheet.waitFor({state:'visible'});
    assert(await recordSheet.locator('[data-quick-save=place]').isVisible());assert(await recordSheet.locator('[data-quick-save=plan]').isVisible());
    await page.screenshot({path:out+'/'+engine+'-'+width+'-record-choices.png'});
    await page.keyboard.press('Escape');await recordSheet.waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()})),beforeRecordChooser,'opening and dismissing record choices never saves');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'trialRecordSave');
    assert(await page.evaluate(()=>Object.entries(placeEntryNodes).every(([id,n])=>n===document.getElementById(id))),'existing calendar/time nodes remain owned by the original UI');
    await page.locator('#skyMapCalendarOpen').click();const calendar=page.locator('dialog[open]').filter({has:page.locator('[data-year]')});
    const dayButton=calendar.locator('[data-cal-day]').nth(5),pickedDay=Number(await dayButton.getAttribute('data-cal-day'));
    await dayButton.click();
    await page.waitForFunction(day=>AstroNotesSkyMap.dayStart(SkyMapUI.selectionState().at)===day,pickedDay);
    if(await calendar.isVisible())await calendar.locator('[data-close]').click();
    assert.equal(await page.evaluate(()=>((SkyMapUI.selectionState().at+32400000)%86400000)),((initial.at+32400000)%86400000));
    const oldAt=await page.evaluate(()=>SkyMapUI.selectionState().at),timeline=await page.locator('#skyMapTimeline').boundingBox();assert(timeline);
    await page.mouse.move(timeline.x+timeline.width*.65,timeline.y+timeline.height*.5);await page.mouse.down();await page.mouse.move(timeline.x+timeline.width*.35,timeline.y+timeline.height*.5,{steps:12});await page.mouse.up();
    await page.waitForFunction(old=>SkyMapUI.selectionState().at!==old,oldAt);
    assert.equal(await page.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()})),initial.saved);
    await page.locator('#exploreBackToCandidates').click();
    await page.locator('#skyMapChoose').click();await page.locator('#placeTab-records').click();
    const observerBefore=await page.evaluate(()=>JSON.stringify(SkyMapUI.selectionState().observer));
    await page.evaluate(()=>{const stale=document.querySelector('[data-recorded-place]').onclick;auth.tools=auth.tools.filter(t=>t!=='records');recentHistory.records();stale();});
    assert.equal(await page.locator('[data-recorded-place]').count(),0);assert(await page.locator('#placeTab-records').isHidden());assert.equal(await page.evaluate(()=>JSON.stringify(SkyMapUI.selectionState().observer)),observerBefore);
    await page.locator('#placeSheet .page-back').click();
    assert.equal(writes,0);assert.deepEqual(errors,[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:out+'/'+engine+'-'+width+'-scene.png'});
    results.push({engine,width,addressInput:true,recordsOnly:true,selectionPreservesConditions:true,primarySearchFullWidth:true,missingTargetAndPlaceOpenExistingPickers:true,heightEditorDoesNotOverlapSearch:true,recordTabInPlacePicker:true,removedRecordShortcut:true,noEmptyPlaceActions:true,remountWithoutDuplicateActions:true,recordChooserWithoutImplicitSave:true,sharedSearchAndPreviewDateTimeBar:true,existingCalendarAndTimebar:true,calendarAndTimelineOperable:true,revokedPermissionRefusesStaleSelection:true,savedDataUnchanged:true,writes});
    fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(engine,width,'place entry passed');
   }catch(e){console.error('page errors',errors);await page.screenshot({path:out+'/'+engine+'-'+width+'-failure.png'}).catch(()=>{});console.error(await page.locator('dialog[open]').evaluateAll(ns=>ns.map(n=>({label:n.getAttribute('aria-label'),year:n.querySelector('[data-year]')?.value,month:n.querySelector('[data-month]')?.value}))).catch(()=>[]));throw e;}finally{await context.close();}
  }}finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exit(1);});
