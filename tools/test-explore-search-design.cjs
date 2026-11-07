// Search-design acceptance against the real trial UI, with isolated synthetic IO.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture}=require('./candidate-date-fixture.cjs');
const base=process.env.SEARCH_DESIGN_BASE||'http://127.0.0.1:8986/trial/';
const out=process.env.SEARCH_DESIGN_OUT||'/tmp/astronotes-search-design';
const tools=['records','tower','diamond','pearl','skymap','multiscene'];
const widths=(process.env.SEARCH_DESIGN_WIDTHS||'320,390,1280').split(',').map(Number);
const themes=(process.env.SEARCH_DESIGN_THEMES||'light,dark').split(',');
const engines=(process.env.SEARCH_DESIGN_ENGINES||'chrome,webkit').split(',');

async function assertFieldLayout(page){
 const metrics=await page.evaluate(()=>{
  const visible=n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const fields=[...document.querySelectorAll('#exploreConditions .condition-field')].filter(visible);
  const labels=fields.map(field=>{
   const label=field.querySelector(':scope > .condition-label');if(!label||!visible(label))return null;
   const a=label.getBoundingClientRect();
   const overlaps=[...field.querySelectorAll('button,input,select')].filter(n=>visible(n)&&!label.contains(n)).filter(n=>{const b=n.getBoundingClientRect();return Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;}).map(n=>n.id||n.className);
   return {text:label.textContent.trim(),overlaps};
  }).filter(Boolean);
  const search=document.getElementById('candidateSearchAction'),direct=document.getElementById('exploreShowResult'),action=document.getElementById('candidateWorkspaceAction'),results=document.getElementById('exploreSearchResults'),feedback=document.getElementById('candidateSearchFeedback');
  const conditions=document.querySelector('.explore-condition-fields'),observer=document.getElementById('skyMapChoose').closest('.aim-say-from'),height=document.getElementById('skyMapObserverDetails'),heading=document.getElementById('candidateWorkspaceHeading'),detail=action.querySelector('#additionalCandidateSearch details');
  const before=(a,b)=>!!(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING),o=observer.getBoundingClientRect(),f=conditions.getBoundingClientRect(),d=direct.getBoundingClientRect(),h=height.getBoundingClientRect(),a=heading.getBoundingClientRect(),e=detail.getBoundingClientRect(),s=search.getBoundingClientRect(),fieldStyle=getComputedStyle(conditions),primaryStyle=getComputedStyle(direct),secondaryStyle=getComputedStyle(search);
  const left=f.left+parseFloat(fieldStyle.paddingLeft)+parseFloat(fieldStyle.borderLeftWidth),right=f.right-parseFloat(fieldStyle.paddingRight)-parseFloat(fieldStyle.borderRightWidth);
  return {labels,overflow:document.documentElement.scrollWidth>innerWidth+1,directInConditions:conditions.contains(direct)&&!height.contains(direct)&&!action.contains(direct),oneDirectAction:document.querySelectorAll('#exploreShowResult').length===1,directFullWidthAndAccessible:Math.abs(left-d.left)<1&&Math.abs(right-d.right)<1&&d.height>=44,directAfterPlaceBeforeAlternative:o.bottom<=d.top+1&&(!visible(height)||h.bottom<=d.top+1)&&d.bottom<=a.top+1&&a.bottom<=e.top+1&&e.bottom<=s.top+1,shortVisibleLabel:direct.innerText==='検索'&&!!direct.querySelector('svg[aria-hidden=true]')&&direct.getAttribute('aria-label').includes('検索'),alternativeSection:action.tagName==='SECTION'&&action.getAttribute('aria-labelledby')===heading.id&&heading.textContent==='撮影地点を探す'&&action.contains(detail),primaryAndSecondaryDistinct:primaryStyle.backgroundColor!==secondaryStyle.backgroundColor&&parseFloat(secondaryStyle.borderTopWidth)>=1,actionOrder:before(observer,direct)&&(!visible(height)||before(height,direct))&&before(direct,heading)&&before(heading,detail)&&before(detail,search),searchInAction:search.closest('#candidateWorkspaceAction')===action,feedbackInResults:results.contains(feedback)&&document.getElementById('exploreNewPlaces').contains(feedback)};
 });
 assert(metrics.labels.length>=3,JSON.stringify(metrics));
 assert(metrics.labels.some(l=>l.text.includes('撮影地点')),JSON.stringify(metrics));
 assert(metrics.labels.every(l=>!l.overlaps.length),'labels overlap controls: '+JSON.stringify(metrics));
 assert(!metrics.overflow&&metrics.directInConditions&&metrics.oneDirectAction&&metrics.directFullWidthAndAccessible&&metrics.directAfterPlaceBeforeAlternative&&metrics.shortVisibleLabel&&metrics.alternativeSection&&metrics.primaryAndSecondaryDistinct&&metrics.actionOrder&&metrics.searchInAction&&metrics.feedbackInResults,JSON.stringify(metrics));
 return metrics;
}

async function assertColumns(page){
 const columns=await page.evaluate(()=>{
  const header=document.querySelector('.candidate-list-heading');
  const row=[...document.querySelectorAll('#candidateUnifiedResults>.list-item')].find(n=>!n.hidden&&getComputedStyle(n).display!=='none');
  const rects=nodes=>[...nodes].slice(0,3).map(n=>{const r=n.getBoundingClientRect();return {x:r.x,width:r.width};});
  return {heads:rects(header.children),cells:rects(row.children),place:!!row.querySelector('[data-candidate-place]'),time:!!row.querySelector('[data-candidate-time]')};
 });
 assert(columns.place&&columns.time);
 for(let i=0;i<3;i++)assert(Math.abs(columns.heads[i].x-columns.cells[i].x)<1&&Math.abs(columns.heads[i].width-columns.cells[i].width)<1,JSON.stringify(columns));
}

async function settled(page,count){
 await page.waitForFunction(count=>AstroNotesCandidatePicker.visibleRows().length===count&&document.getElementById('candidateSearchAction')?.dataset.state==='idle'&&document.getElementById('additionalCandidateResults')?.getAttribute('aria-busy')==='false',count);
}

async function assertFooterClearance(page,selector='#candidateUnifiedResults>.list-item'){
 const clearance=await page.evaluate(selector=>{
  window.scrollTo(0,document.scrollingElement.scrollHeight);
  const rows=[...document.querySelectorAll(selector)].filter(n=>!n.hidden&&getComputedStyle(n).display!=='none');
  const row=rows.at(-1).getBoundingClientRect(),footer=document.querySelector('.sky-map-footer').getBoundingClientRect();
  return {lastRowBottom:row.bottom,footerTop:footer.top,footerBottom:footer.bottom,height:innerHeight};
 },selector);
 assert(clearance.lastRowBottom<=clearance.footerTop+1&&clearance.footerBottom<=clearance.height+1,JSON.stringify(clearance));
}

(async()=>{
 fs.mkdirSync(out,{recursive:true});const results=[];
 for(const [engine,type]of [['chrome',chromium],['webkit',webkit]].filter(([name])=>engines.includes(name))){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{for(const width of widths)for(const theme of themes){
   const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme,locale:'ja-JP',timezoneId:'Asia/Tokyo',reducedMotion:'reduce'});
   await context.addInitScript(fixture,tools);let writes=0;
   await context.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===new URL(base).origin)return route.continue();
    if(/zekkei-api|localhost:8787/.test(url.origin)){if(!['GET','OPTIONS'].includes(request.method()))writes++;return route.fulfill({json:{allowed:true,tool:'skymap',loginId:'date-test',tools,favorites:[],sightings:[],records:[],rev:1}});}
    return route.abort();
   });
   const page=await context.newPage(),errors=[],tag=engine+'-'+width+'-'+theme;page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
   try{
    await page.goto(base+'#/explore');await page.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof AstroNotesCandidatePicker==='object');
    await page.evaluate(async theme=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>25;aimBuildingDays=async()=>[];document.documentElement.dataset.theme=theme;navigationHistory.pushRoute('#/explore');SkyMapUI.setTarget('skytree');const body=document.getElementById('skyMapBody');body.value='moon';body.onchange();SkyMapUI.setTime(Date.parse('2026-11-05T03:58:31+09:00'));},theme);
    await page.locator('#exploreDiscovery-new').click();await page.locator('#candidateSearchAction').waitFor();const layout=await assertFieldLayout(page);
    assert(await page.locator('#exploreResultsHeading').isHidden());assert.equal(await page.locator('.explore-search-intro,.explore-results-heading').count(),0);
    assert(await page.locator('.sky-map-footer').isVisible());assert(await page.locator('.sky-map-footer .sky-map-candidates').isHidden());
    assert.equal(await page.locator('#candidateWorkspaceDate,#candidateDateNavigation,#candidateDate').count(),0);
    assert.deepEqual(await page.locator('.sky-map-footer .tool-datetime-row>[data-datetime-slot]').evaluateAll(ns=>ns.map(n=>n.dataset.datetimeSlot)),['previous','date','next','clock','now','play','more']);
    await assertFooterClearance(page,'#candidateWorkspaceAction');await page.evaluate(()=>window.scrollTo(0,0));
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

    await page.locator('#candidateSearchAction').click();await settled(page,2);await assertColumns(page);await assertFieldLayout(page);
    assert(await page.locator('#exploreResultsHeading').isVisible());
    assert(await page.locator('#candidateSearchFeedback [role=status]').isVisible());
    assert((await page.locator('#candidateSearchFeedback [role=status]').innerText()).includes('新たな地点で2件'));
    const registeredText=await page.locator('#recentCandidates .my-picker').innerText();
    assert(!registeredText.includes('登録した地点に候補がありません')&&!registeredText.includes('絞り込み前'),registeredText);
    await assertFooterClearance(page);await page.screenshot({path:out+'/'+tag+'-results.png',fullPage:true});
    // A filtered empty list remains recoverable without starting another search.
    const loads=await page.evaluate(()=>dateFixture.loads.length);await page.locator('#candidateKindFilter').selectOption('garden');
    await settled(page,0);assert((await page.locator('[data-filter-status]').innerText()).startsWith('0 / 2'));assert(await page.locator('#candidateMapToggle').isDisabled());
    await page.locator('#candidateKindFilter').selectOption('all');await settled(page,2);assert.equal(await page.evaluate(()=>dateFixture.loads.length),loads);

    // Rechecking invalidates the previous generated rows; failure cannot leave dead choices.
    await page.evaluate(()=>dateFixture.failNext=true);await page.locator('#candidateSearchAction').click();
    await page.waitForFunction(()=>document.querySelector('#candidateSearchFeedback [role=status]')?.textContent.includes('取得できませんでした'));
    await settled(page,0);await page.waitForFunction(()=>![...document.querySelectorAll('#candidateUnifiedResults>.list-item')].some(n=>!n.hidden&&getComputedStyle(n).display!=='none'));
    assert(await page.locator('#candidateMapToggle').isDisabled());assert(await page.locator('#candidateSearchAction').isEnabled());
    await page.locator('#candidateSearchAction').click();await settled(page,2);await assertColumns(page);
    // Record failures belong to the dedicated record tab, never the new-place panel.
    await page.evaluate(()=>{window.registeredFailureCalls=0;MyPlacesUI.discoverySearch=async()=>{registeredFailureCalls++;return {rows:[],failed:1};};MyPlacesUI.imported();});
    await page.locator('#exploreDiscovery-records').click();const registered=page.locator('#exploreRecordedPlaces');
    await page.waitForFunction(()=>registeredFailureCalls===1&&document.getElementById('exploreRecordedPlaces').getAttribute('aria-busy')==='false');
    assert((await registered.innerText()).includes('記録の撮影地点を確認できませんでした'));assert(await registered.getByRole('button',{name:'再試行',exact:true}).isVisible());
    await page.evaluate(()=>{MyPlacesUI.discoverySearch=async()=>{registeredFailureCalls++;throw Error('synthetic registered failure');};MyPlacesUI.imported();});
    await page.waitForFunction(()=>registeredFailureCalls===2&&document.getElementById('exploreRecordedPlaces').getAttribute('aria-busy')==='false');
    assert((await registered.innerText()).includes('記録の撮影地点を確認できませんでした'));assert(await registered.getByRole('button',{name:'再試行',exact:true}).isVisible());
    assert.equal(writes,0);assert.deepEqual(errors,[]);
    results.push({engine,width,theme,visibleLabels:layout.labels.map(l=>l.text),sharedDateTimeBar:true,noSeparateDateField:true,footerDoesNotCoverLastResult:true,labelsDoNotOverlap:true,primarySearchInConditions:true,fullWidthAccessibleButton:true,separateAlternativeLocationSection:true,directActionBeforeCandidateDetails:true,actionDomAndVisualOrderMatch:true,initialExplanationsReduced:true,feedbackInResults:true,detailOpenAndFocusPreserved:true,headerColumnsAligned:true,emptyFilterRecoverable:true,failedRecheckRemovesStaleRows:true,retryWorks:true,redundantRegisteredCountHidden:true,registeredFailuresRemainVisible:true,writes,errors});
    fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(tag+' search design passed');
   }catch(error){await page.screenshot({path:out+'/'+tag+'-failure.png',fullPage:true}).catch(()=>{});console.error(tag,errors);throw error;}finally{await context.close();}
  }}finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
