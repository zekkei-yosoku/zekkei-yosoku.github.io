// Search-design acceptance against the real trial UI, with isolated synthetic IO.
require('./no-open-meteo.cjs');
const {openExploreFields}=require('./explore-open-conditions.cjs');
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture}=require('./candidate-date-fixture.cjs');
const base=process.env.SEARCH_DESIGN_BASE||'http://127.0.0.1:8986/trial/';
const out=process.env.SEARCH_DESIGN_OUT||'/tmp/astronotes-search-design';
const tools=['records','tower','diamond','pearl','skymap','multiscene'];
const widths=(process.env.SEARCH_DESIGN_WIDTHS||'320,390,1280').split(',').map(Number);
const themes=(process.env.SEARCH_DESIGN_THEMES||'light,dark').split(',');
const engines=(process.env.SEARCH_DESIGN_ENGINES||'chrome,webkit').split(',');

// Keep the shared synthetic fixture unchanged; this journey also needs a successful empty response.
function emptyProviderFixture(){
 const discovery=Object.getOwnPropertyDescriptor(window,'AstroNotesCandidateDiscovery');
 Object.defineProperty(window,'AstroNotesCandidateDiscovery',{configurable:true,get:discovery.get,set:api=>{
  discovery.set(api);const factory=Object.getOwnPropertyDescriptor(api,'createGenericSearch');
  Object.defineProperty(api,'createGenericSearch',{configurable:true,get:factory.get,set:original=>factory.set(options=>{
   const provider=options.provider;
   return original({...options,provider:{...provider,load:async(...args)=>{
    const result=await provider.load(...args);
    return dateFixture.emptyResults?{...result,points:[],coverage:{...result.coverage,nextCursor:null}}:result;
   }}});
  })});
 }});
}

async function assertFieldLayout(page){
 await openExploreFields(page);
 const metrics=await page.evaluate(()=>{
  const visible=n=>!!n?.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
  const fields=[...document.querySelectorAll('#exploreConditions .condition-field')].filter(visible);
  const labels=fields.flatMap(field=>{
   const label=field.querySelector(':scope > .condition-label');if(!visible(label))return [];
   const a=label.getBoundingClientRect();
   const overlaps=[...field.querySelectorAll('button,input,select')].filter(n=>visible(n)&&!label.contains(n)).some(n=>{
    const b=n.getBoundingClientRect();
    return Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
   });
   return [{text:label.textContent.trim(),overlaps}];
  });
  const confirm=document.getElementById('mapWsConfirmConditions');
  return {labels,overflow:document.documentElement.scrollWidth>innerWidth+1,confirmLabel:confirm.textContent,
   confirmHeight:confirm.getBoundingClientRect().height,searchHidden:!visible(document.getElementById('candidateWorkspaceAction')),
   mapVisible:visible(document.getElementById('skyMapCanvas'))};
 });
 assert(metrics.labels.length>=3&&metrics.labels.some(l=>l.text.includes('撮影地点')),JSON.stringify(metrics));
 assert(metrics.labels.every(l=>!l.overlaps),'labels overlap controls: '+JSON.stringify(metrics));
 assert(!metrics.overflow&&metrics.mapVisible&&metrics.searchHidden&&metrics.confirmLabel==='確定'&&metrics.confirmHeight>=44,JSON.stringify(metrics));
 await page.locator('#mapWsConfirmConditions').click();
 await page.locator('#skyMapView[data-explore-sheet] #candidateSearchAction').waitFor({state:'visible'});
 return metrics;
}

async function assertSearchLayout(page){
 assert(await page.locator('#skyMapCanvas').isVisible());
 assert(await page.locator('#skyMapChoose').isHidden());
 assert(await page.locator('#exploreShowResult').isHidden());
 const layout=await page.evaluate(()=>{
  const action=document.getElementById('candidateWorkspaceAction'),heading=document.getElementById('candidateWorkspaceHeading');
  const primary=action.querySelector('.candidate-search-primary'),results=document.getElementById('exploreSearchResults');
  const before=(a,b)=>!!(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING);
  return {heading:heading.textContent,section:action.tagName,sectionLabel:action.getAttribute('aria-labelledby'),
   ordered:before(heading,primary)&&before(primary,results),
   sharedControls:primary.contains(document.getElementById('candidateSearchAction'))&&primary.contains(document.getElementById('candidateSearchFeedback'))};
 });
 assert.deepEqual(layout,{heading:'撮影地点を探す',section:'SECTION',sectionLabel:'candidateWorkspaceHeading',ordered:true,sharedControls:true});
}

async function assertTargets(page,selectors){
 for(const selector of selectors){
  const sizes=await page.locator(selector).evaluateAll(nodes=>nodes.filter(n=>{const r=n.getBoundingClientRect();return r.width&&r.height&&getComputedStyle(n).visibility!=='hidden';}).map(n=>{const r=n.getBoundingClientRect();return {width:r.width,height:r.height};}));
  assert(sizes.length&&sizes.every(r=>r.width>=44&&r.height>=44),selector+': '+JSON.stringify(sizes));
 }
}

async function assertCompactPicker(page){
 const panel=page.locator('#candidateListControls[data-compact]'),detail=panel.locator('#candidateRefinement');
 assert(await panel.isVisible());assert.equal(await panel.locator('details').count(),1);
 assert.equal(await panel.locator('#exploreResultsHeading').count(),1);
 assert.equal(await page.locator('#exploreResultsHeading').count(),1,'one result heading, owned by the picker');
 assert.equal(await panel.locator('.candidate-list-heading,[data-candidate-headers]').count(),0,'compact rows have no old table header');
 const rows=page.locator('#candidateUnifiedResults>.list-item:visible');assert(await rows.count()>0);
 const content=await rows.evaluateAll(nodes=>nodes.map(n=>({place:!!n.querySelector('[data-candidate-place]')?.textContent.trim(),time:!!n.querySelector('[data-candidate-time]')?.textContent.trim(),address:!!n.querySelector('[data-candidate-address]'),passage:n.querySelector('[data-candidate-passage]')?.textContent})));
 assert(content.every(r=>r.place&&r.time&&r.address&&['先端と天望回廊の間を通過','上部付近を通過'].includes(r.passage)),JSON.stringify(content));
 assert.equal(await detail.locator('summary').innerText(),'絞り込み');
 assert((await detail.locator('summary').getAttribute('aria-label')).includes('並べ替え'));
 await assertTargets(page,['#candidateMapToggle','#candidateRefinement>summary','#candidateUnifiedResults>.list-item:visible']);
 if(!await detail.evaluate(n=>n.open))await detail.locator('summary').click();
 for(const id of ['candidateTimeFilter','candidateKindFilter','candidateSort'])assert.equal(await detail.locator('#'+id).count(),1);
 await assertTargets(page,['#candidateTimeFilter','#candidateKindFilter','#candidateSort']);
 await detail.locator('summary').click();assert(!await detail.evaluate(n=>n.open));
 assert(await page.locator('#candidateTimeFilter').isHidden());
}

async function assertNoPicker(page){
 assert(await page.locator('#candidateListControls').isHidden());
 assert(await page.locator('#exploreResultsHeading').isHidden());
 assert.equal(await page.locator('#candidateUnifiedResults>.list-item:visible').count(),0);
}

async function assertSearchingBar(page){
 const bar=page.locator('#additionalCandidateSearch [data-candidate-searching]');
 assert.equal(await bar.count(),1);assert(await bar.isVisible());
 assert.equal(await bar.locator('#candidateSearchAction').count(),1);assert.equal(await bar.locator('#candidateSearchFeedback').count(),1);
 assert(await bar.locator('.candidate-wait[role=progressbar],.candidate-wait [role=progressbar]').isVisible());assert.equal(await bar.locator('.note-wait-character').count(),0);
 assert(await page.evaluate(()=>document.getElementById('candidateSearchAction')===window.searchDesignAction),'the search/cancel action stays the same DOM node');
 assert(await page.locator('#candidateSearchFeedback [role=status]').isVisible());
 await assertTargets(page,['#candidateSearchAction']);
}

async function captureState(page,path){
 await page.screenshot({path:path+'.png',fullPage:true});
 await page.locator('#candidateWorkspaceHeading').evaluate(n=>n.scrollIntoView({block:'start'}));
 await page.screenshot({path:path+'-viewport.png'});
}

async function settled(page,count){
 await page.waitForFunction(count=>AstroNotesCandidatePicker.visibleRows().length===count&&document.getElementById('candidateSearchAction')?.dataset.state==='idle'&&document.getElementById('additionalCandidateResults')?.getAttribute('aria-busy')==='false',count);
}

async function assertFooterClearance(page,selector='#candidateUnifiedResults>.list-item'){
 const clearance=await page.evaluate(selector=>{
  const sheet=document.getElementById('exploreConditions');
  sheet.scrollTop=sheet.scrollHeight;
  const rows=[...document.querySelectorAll(selector)].filter(n=>!n.hidden&&getComputedStyle(n).display!=='none');
  const row=rows.at(-1).getBoundingClientRect(),footer=document.querySelector('.sky-map-footer').getBoundingClientRect();
  return {lastRowBottom:row.bottom,lastRowRight:row.right,footerLeft:footer.left,
   footerTop:footer.top,footerBottom:footer.bottom,sheetBottom:sheet.getBoundingClientRect().bottom,height:innerHeight};
 },selector);
 const clearOfBar=clearance.lastRowRight<=clearance.footerLeft+1||clearance.lastRowBottom<=clearance.footerTop+1;
 assert(clearOfBar&&clearance.lastRowBottom<=clearance.sheetBottom+1&&clearance.footerBottom<=clearance.height+1,JSON.stringify(clearance));
}

(async()=>{
 fs.mkdirSync(out,{recursive:true});const results=[];
 for(const [engine,type]of [['chrome',chromium],['webkit',webkit]].filter(([name])=>engines.includes(name))){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{for(const width of widths)for(const theme of themes){
   const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme,locale:'ja-JP',timezoneId:'Asia/Tokyo',reducedMotion:'reduce'});
   await context.addInitScript(fixture,tools);await context.addInitScript(()=>localStorage.setItem('sorami.skyMap:date-test',JSON.stringify({body:'moon',targetId:'skytree',partId:'tip',limb:'center',matchMode:'limb',at:Date.parse('2026-11-05T03:58:31+09:00')})));await context.addInitScript(emptyProviderFixture);let writes=0;
   await context.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===new URL(base).origin)return route.continue();
    if(/zekkei-api|localhost:8787/.test(url.origin)){if(!['GET','OPTIONS'].includes(request.method()))writes++;return route.fulfill({json:{allowed:true,tool:'skymap',loginId:'date-test',tools,favorites:[],sightings:[],records:[],rev:1}});}
    return route.abort();
   });
   const page=await context.newPage(),errors=[],tag=engine+'-'+width+'-'+theme;page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
   try{
    await page.goto(base+'#/explore');await page.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof AstroNotesCandidatePicker==='object');
    assert.deepEqual(await page.evaluate(()=>({partId:SkyMapUI.selectionState().partId,matchMode:SkyMapUI.selectionState().matchMode})),{partId:'tip',matchMode:'overlap'},'ordinary old preferences migrate from centre-only to disc passage');
    await page.evaluate(async theme=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>25;aimBuildingDays=async()=>[];document.documentElement.dataset.theme=theme;navigationHistory.pushRoute('#/explore');SkyMapUI.setTarget('skytree');const body=document.getElementById('skyMapBody');body.value='moon';body.onchange();SkyMapUI.setTime(Date.parse('2026-11-05T03:58:31+09:00'));},theme);
    await page.locator('#skyMapView[data-explore-sheet] #candidateSearchAction').waitFor();
    const layout=await assertFieldLayout(page);
    await assertSearchLayout(page);
    await assertNoPicker(page);assert.equal(await page.locator('.explore-search-intro').count(),0);
    assert(await page.locator('.sky-map-footer').isVisible());assert(await page.locator('.sky-map-footer .sky-map-candidates').isHidden());
    assert.equal(await page.locator('#candidateWorkspaceDate,#candidateDateNavigation,#candidateDate').count(),0);
    assert.deepEqual(await page.locator('.sky-map-footer .tool-datetime-row>[data-datetime-slot]').evaluateAll(ns=>ns.map(n=>n.dataset.datetimeSlot)),['previous','date','next','clock','now','play','more']);
    await assertFooterClearance(page,'#candidateWorkspaceAction');await page.locator('#exploreConditions').evaluate(sheet=>{sheet.scrollTop=0;});
    await page.screenshot({path:out+'/'+tag+'-initial.png',fullPage:true});

    // Changing detail controls must keep the opened editor and keyboard focus.
    const detail=page.locator('#additionalCandidateSearch details');await detail.locator('summary').click();
    await page.locator('#candidateSearchMode').focus();await page.locator('#candidateSearchMode').selectOption('window');
    await page.waitForFunction(()=>document.activeElement?.id==='candidateSearchMode');assert(await detail.evaluate(n=>n.open));assert(await page.locator('#candidateSearchStart').isVisible());
    for(const [id,value]of [['candidateSearchStart','21:00'],['candidateSearchEnd','23:00']]){
     await page.locator('#'+id).focus();await page.locator('#'+id).fill(value);await page.locator('#'+id).dispatchEvent('change');
     await page.waitForFunction(id=>document.activeElement?.id===id,id);assert(await detail.evaluate(n=>n.open));assert.equal(await page.locator('#'+id).inputValue(),value);
    }
    await page.locator('#candidateSearchMode').focus();await page.locator('#candidateSearchMode').selectOption('day');
    await page.waitForFunction(()=>document.activeElement?.id==='candidateSearchMode');assert(await detail.evaluate(n=>n.open));await detail.locator('summary').click();

    // Before the first result, only the compact progress/cancel bar is useful.
    await page.evaluate(()=>{window.searchDesignAction=document.getElementById('candidateSearchAction');dateFixture.holdNext=true;dateFixture.autoPages=true;dateFixture.nextCursor=1;});
    await page.locator('#candidateSearchAction').click();await page.waitForFunction(()=>dateFixture.holds.length===1&&document.getElementById('candidateSearchAction')?.dataset.state==='searching');
    assert.equal(await page.evaluate(()=>AstroNotesCandidatePicker.visibleRows().length),0);await assertNoPicker(page);await assertSearchingBar(page);
    await captureState(page,out+'/'+tag+'-searching-zero');
    await page.evaluate(()=>{dateFixture.holdCursor=1;dateFixture.holds.shift().release();});
    await page.waitForFunction(()=>dateFixture.holds.length===1&&AstroNotesCandidatePicker.visibleRows().length===2&&document.getElementById('candidateSearchAction')?.dataset.state==='searching');
    await assertSearchingBar(page);await assertCompactPicker(page);
    await captureState(page,out+'/'+tag+'-partial');
    await page.evaluate(()=>dateFixture.holds.shift().release());await settled(page,2);await assertCompactPicker(page);await assertSearchLayout(page);
    assert(await page.locator('#exploreResultsHeading').isVisible());
    assert(await page.evaluate(()=>document.getElementById('candidateSearchAction')===window.searchDesignAction));
    assert.equal(await page.locator('#candidateSearchFeedback [role=status][data-announcement]').count(),1,'success remains an accessible announcement without a duplicate visual summary');
    assert((await page.locator('#candidateSearchFeedback [role=status]').innerText()).includes('2か所の新たな撮影地点の候補があります'));
    const registeredText=await page.locator('#recentCandidates .my-picker').innerText();
    assert(!registeredText.includes('登録した地点に候補がありません')&&!registeredText.includes('絞り込み前'),registeredText);
    await assertFooterClearance(page);await captureState(page,out+'/'+tag+'-results');
    // A filtered empty list remains recoverable without starting another search.
    const loads=await page.evaluate(()=>dateFixture.loads.length);await page.locator('#candidateRefinement>summary').click();
    const names=()=>page.locator('#candidateUnifiedResults>.list-item:visible [data-candidate-place]').allTextContents();
    await page.locator('#candidateSort').selectOption('name');await settled(page,2);const ascendingNames=await names();
    await page.locator('#candidateSort').selectOption('name-desc');await page.waitForFunction(first=>document.querySelector('#candidateUnifiedResults>.list-item:not([hidden]) [data-candidate-place]')?.textContent!==first,ascendingNames[0]);
    assert.deepEqual(await names(),ascendingNames.slice().reverse());await page.locator('#candidateSort').selectOption('time');
    await page.locator('#candidateKindFilter').selectOption('garden');
    await settled(page,0);assert((await page.locator('[data-filter-status]').innerText()).startsWith('0 / 2'));assert(await page.locator('#candidateMapToggle').isDisabled());
    assert(await page.locator('#candidateListControls').isVisible());assert(await page.locator('#exploreResultsHeading').isVisible());
    await assertTargets(page,['#candidateResetFilters']);await page.locator('#candidateResetFilters').click();await settled(page,2);assert.equal(await page.locator('#candidateKindFilter').inputValue(),'all');assert.equal(await page.evaluate(()=>dateFixture.loads.length),loads);
    await assertCompactPicker(page);

    // A completed search with no actual rows must not expose empty sorting/filtering UI.
    await page.evaluate(()=>dateFixture.emptyResults=true);await page.locator('#candidateSearchAction').click();await settled(page,0);await assertNoPicker(page);
    assert(await page.locator('#candidateSearchFeedback [role=status]').isVisible());assert((await page.locator('#candidateSearchFeedback [role=status]').innerText()).trim());
    await page.screenshot({path:out+'/'+tag+'-complete-zero.png',fullPage:true});
    await page.evaluate(()=>dateFixture.emptyResults=false);await page.locator('#candidateSearchAction').click();await settled(page,2);await assertCompactPicker(page);

    // 2026-11-10 (C22) a re-check of the same condition that cannot fetch keeps that condition's rows (still current,
    // so selectable, never dead choices) and offers a retry; rows of a changed condition are covered by the date test.
    await page.evaluate(()=>dateFixture.failAlways=true);await page.locator('#candidateSearchAction').click();
    await page.waitForFunction(()=>document.querySelector('#candidateSearchFeedback [role=status]')?.textContent.includes('取得できなかった範囲があります')&&document.getElementById('candidateSearchAction').textContent==='再試行');
    assert.equal(await page.evaluate(()=>AstroNotesCandidatePicker.visibleRows().length),2,'rows of the current condition stay selectable');assert(await page.locator('#candidateSearchAction').isEnabled());
    await page.evaluate(()=>dateFixture.failAlways=false);await page.locator('#candidateSearchAction').click();await settled(page,2);await assertCompactPicker(page);
    assert(await page.locator('#exploreOpportunityLink').isHidden());
    assert(await page.locator('#exploreDiscovery-records').isHidden());
    // The summit keeps its ridge contact policy and describes the centre to its left/right.
    await openExploreFields(page);
    await page.evaluate(()=>SkyMapUI.setTarget('fuji'));
    assert(await page.locator('#skyMapAlignmentDetails').isHidden());
    await page.locator('#mapWsConfirmConditions').click();
    await page.locator('#candidateSearchAction').click();await settled(page,2);
    const mountainPassages=await page.locator('#candidateUnifiedResults>.list-item:visible [data-candidate-passage]').allTextContents();
    assert.deepEqual(mountainPassages.slice().sort(),['山頂の右寄りを通過','山頂の左寄りを通過'].sort());
    await page.screenshot({path:out+'/'+tag+'-mountain-passages.png',fullPage:true});
    assert.equal(writes,0);assert.deepEqual(errors,[]);
    results.push({engine,width,theme,visibleLabels:layout.labels.map(l=>l.text),sharedDateTimeBar:true,noSeparateDateField:true,footerDoesNotCoverLastResult:true,labelsDoNotOverlap:true,accessibleConditionsConfirm:true,mapBackedSearch:true,searchLayoutPreserved:true,initialExplanationsReduced:true,feedbackInActionStrip:true,actionNodeStableDuringSearch:true,accessibleSuccessAnnouncement:true,detailOpenAndFocusPreserved:true,compactPicker:true,singleRefinementDetails:true,compactSortSelectWorks:true,touchTargets44px:true,searchingZeroHidesPicker:true,partialResultsKeepProgress:true,completeZeroHidesPicker:true,emptyFilterResetWithoutSearch:true,failedRecheckKeepsCurrentRows:true,retryWorks:true,redundantRegisteredCountHidden:true,recordsEntryOutsideSearchSheet:true,writes,errors});
    fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(tag+' search design passed');
   }catch(error){await page.screenshot({path:out+'/'+tag+'-failure.png',fullPage:true}).catch(()=>{});console.error(tag,errors);throw error;}finally{await context.close();}
  }}finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
