// Real UI/owners, synthetic public geometry and empty account; no external IO.
require('./no-open-meteo.cjs');
require('./explore-open-conditions.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.CANDIDATE_RECOMMENDED_BASE||'http://127.0.0.1:8992/trial/';
const out=process.env.CANDIDATE_RECOMMENDED_OUT||'/tmp/astronotes-practical-search-20261123/ui/browser';fs.mkdirSync(out,{recursive:true});
function install(){
 const granted=['records','tower','diamond','pearl','skymap','multiscene'];
 sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-recommended',loginId:'recommended-test',tools:granted}));
 window.roundFixture={budget:null,zeroBefore:null,hold:2,pending:false,release:null,allRecorded:false,recordPriority:false,recordRemoved:false,scopeMode:false,evaluated:[],pages:[],firstVisibleWhileSearching:false};
 const observer=new MutationObserver(()=>{if(document.getElementById('candidateSearchAction')?.dataset.state==='searching'&&globalThis.AstroNotesCandidatePicker?.visibleRows?.().length)roundFixture.firstVisibleWhileSearching=true;});
 observer.observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','data-state']});
 let discovery;
 Object.defineProperty(window,'AstroNotesCandidateDiscovery',{configurable:true,get:()=>discovery,set:api=>{
  discovery=api;let factory;
  Object.defineProperty(api,'createGenericSearch',{configurable:true,get:()=>factory,set:original=>{factory=options=>{
   AstroNotesCandidateComposition.inverseSeeds=async()=>({seeds:[{latitude:35.69,longitude:139.73,radiusM:500}],partial:true});
   const pointAt=i=>({id:'round-'+i,name:'合成撮影地点'+i,placeKind:'park',latitude:35.69+i*.004,longitude:139.73,groundM:25,eyeM:1.5,surfaceId:'round-'+i,standingSurfaceKnown:true});
   const points=Array.from({length:24},(_,i)=>pointAt(i));
   roundFixture.savedPlaces=()=>points.filter((_,i)=>!roundFixture.recordRemoved&&(i===0||roundFixture.allRecorded)).map(p=>({...p,elevation:p.groundM,groundManualM:p.groundM,standAglM:p.eyeM}));
   const engine=original({...options,prefilter:null,provider:{
    surveyed:async plan=>roundFixture.recordPriority&&!roundFixture.scopeMode?[{...points[0],surfaceAglM:0,sourceId:'surveyed/round-0',surfaceId:'surveyed/round-0',quality:'surveyed-viewpoint',surveyedTargets:[plan.target.id],
     sourceEvidence:{kind:'surveyed-viewpoint',sourceId:'round-0'},surfaceGeometry:{position:{latitude:points[0].latitude,longitude:points[0].longitude},lines:[],polygons:[]}}]:[],
    load:async()=>({points:roundFixture.zeroBefore!==null?Array.from({length:172},(_,i)=>pointAt(i)):roundFixture.scopeMode?points.slice(0,3).map((p,i)=>({...p,placeKind:['park','riverbank','sidewalk'][i]})):roundFixture.recordPriority?points.slice(1):points,coverage:{nextCursor:null}})},evaluate:async(plan,point,data,options)=>{
    roundFixture.evaluated.push(point.id);
    if(roundFixture.zeroBefore!==null&&point.id==='round-0')await new Promise(resolve=>setTimeout(resolve,80));
    if(roundFixture.zeroBefore!==null&&+point.id.slice(6)<roundFixture.zeroBefore)return {status:'no-overlap',recommend:false};
    if(+point.id.slice(6)===roundFixture.hold){roundFixture.pending=true;await new Promise(resolve=>roundFixture.release=resolve);}
    return {id:point.id,requestKey:plan.requestKey,recommend:true,aligned:true,status:'model-visible',placeKind:point.placeKind==='sidewalk'?'road':point.placeKind,surfaceId:point.surfaceId,
     place:{name:point.name,latitude:point.latitude,longitude:point.longitude,elevation:25,groundManualM:25,standAglM:1.5,eyeHeightAGL:1.5,stand:'ground',decks:[]},
     assumedObserver:{latitude:point.latitude,longitude:point.longitude,elevation:25,eyeM:1.5},event:{at:AstroNotesCandidateComposition.timeRange(plan).start+12*3600000},
     quality:{visibility:'model-clear',photographyClass:'normal'},modelEvidence:{kind:'synthetic-recommended-fixture'}};
   }});
   return {...engine,searchRecommended:async(plan,options)=>{const result=await engine.searchRecommended(plan,{...options,...(roundFixture.budget?{hardBudgetMs:roundFixture.budget}:{})});roundFixture.pages.push(structuredClone(result));return result;}};
  };}});
 }});
}
async function rendered(page,count){await page.waitForFunction(n=>AstroNotesCandidatePicker.visibleRows().length===n,count);}
async function ready(page){await page.waitForFunction(()=>document.getElementById('candidateSearchAction')?.dataset.state==='idle'&&!document.getElementById('candidateSearchAction').disabled);}
(async()=>{
 const results=[];
 for(const [name,type]of [['chrome',chromium],['webkit',webkit]].filter(([name])=>(process.env.CANDIDATE_RECOMMENDED_ENGINES||'chrome,webkit').split(',').includes(name))){
  const browser=await type.launch(name==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{for(const theme of (process.env.CANDIDATE_RECOMMENDED_THEMES||'light,dark').split(',')){
   const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:theme,reducedMotion:'reduce'});let writes=0,external=0;const errors=[];
   await context.addInitScript(install);
   await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin===new URL(base).origin)return route.continue();
    if(/zekkei-api|localhost:8787/.test(url.origin)){if(!['GET','OPTIONS'].includes(request.method()))writes++;return route.fulfill({status:200,json:{allowed:true,tool:'skymap',loginId:'recommended-test',tools:['records','tower','diamond','pearl','skymap','multiscene'],credentials:[],hasPassword:true,recoveryCodes:10,favorites:[],sightings:[],records:[],rev:1}});}
    external++;return route.abort();
   });
   const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.stack||error.message));
   try{
    await page.goto(base+'#/explore',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof AstroNotesCandidatePicker==='object'&&typeof SkyMapUI==='object');
    await page.evaluate(async theme=>{await startupSessionReady;groundAt=async()=>30;aimBuildingDays=async()=>[];await AstroNotesAssets.ensureModels();await AstroNotesBodies.ensure('moon');
     navigationHistory.pushRoute('#/explore');document.documentElement.dataset.theme=theme;SkyMapUI.setTarget('skytree');const body=document.getElementById('skyMapBody');body.value='moon';body.onchange();SkyMapUI.setTime(Date.parse('2026-11-21T12:00:00+09:00'));
    },theme);
    await page.locator('#skyMapView[data-explore-sheet] #candidateSearchAction').waitFor({state:'visible'});
    await ready(page);
    assert.equal(await page.locator('#candidateIncludeRoads').isChecked(),false,'roads are opt-in without persistent state');
    await page.evaluate(()=>{MyPlacesUI.savedPlaces=()=>roundFixture.savedPlaces();roundFixture.budget=700;});
    const before=await page.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load()}));
    await page.locator('#candidateSearchAction').click();await page.waitForFunction(()=>roundFixture.pending);await ready(page);await rendered(page,1);
    let state=await page.evaluate(()=>({page:roundFixture.pages.at(-1),first:roundFixture.firstVisibleWhileSearching,visible:AstroNotesCandidatePicker.visibleRows().length,status:document.querySelector('#candidateSearchFeedback [role=status]').textContent}));
    assert.equal(state.page.pauseReason,'time-budget');assert.equal(state.page.counts.checked,2);assert.equal(state.visible,1);assert(state.first,'the first NEW row appears before the blocked third evaluation finishes');assert.match(state.status,/続きを探せます/);assert.equal(await page.locator('#candidateSearchAction').innerText(),'続きを探す');
    assert.equal(state.page.coverage.timeDeferredPoints,1);assert.match(await page.locator('#candidateSearchCredits').textContent(),/時間内に確認できなかった1地点/);
    await page.screenshot({path:out+'/'+name+'-'+theme+'-paused.png'});
    await page.locator('#candidateUnifiedResults .list-item').first().scrollIntoViewIfNeeded();await page.screenshot({path:out+'/'+name+'-'+theme+'-candidate.png'});
    await page.evaluate(()=>{roundFixture.budget=null;});
    await page.locator('#candidateSearchAction').click();await ready(page);await rendered(page,11);
    state=await page.evaluate(()=>({page:roundFixture.pages.at(-1),visible:AstroNotesCandidatePicker.visibleRows().length}));
    assert.equal(state.page.pauseReason,'enough-places');assert.equal(state.page.counts.checked,12);assert.equal(state.visible,11);assert.equal(state.page.coverage.pendingPoints,12);
    await page.locator('#candidateSearchAction').click();await ready(page);await rendered(page,21);assert.equal(await page.evaluate(()=>AstroNotesCandidatePicker.visibleRows().length),21);
    assert.equal(await page.evaluate(()=>roundFixture.evaluated.filter(id=>id==='round-2').length),1,'two continuations must progress while the slow point remains unresolved');
    await page.evaluate(()=>{roundFixture.hold=-1;roundFixture.release();roundFixture.pending=false;});
    await page.locator('#candidateSearchAction').click();await ready(page);await rendered(page,23);
    const done=await page.evaluate(()=>roundFixture.pages.at(-1));assert.equal(done.canContinue,false);assert.equal(done.counts.checked,24);assert.equal(await page.evaluate(()=>AstroNotesCandidatePicker.visibleRows().length),23);
    await page.evaluate(()=>{roundFixture.allRecorded=true;roundFixture.hold=1;roundFixture.budget=700;roundFixture.pending=false;SkyMapUI.setTime(Date.parse('2026-11-22T12:00:00+09:00'));});await ready(page);
    await page.locator('#candidateSearchAction').click();await page.waitForFunction(()=>roundFixture.pending);await ready(page);await rendered(page,0);
    const empty=await page.evaluate(()=>({page:roundFixture.pages.at(-1),visible:AstroNotesCandidatePicker.visibleRows().length,status:document.querySelector('#candidateSearchFeedback [role=status]').textContent}));
    assert.equal(empty.page.pauseReason,'time-budget');assert.equal(empty.visible,0);assert.match(empty.status,/見つかった撮影地点は記録にあります/);assert.match(empty.status,/新たな撮影地点はまだ見つかっていません/);assert.match(empty.status,/続きを探せます/);assert.equal(await page.locator('#candidateSearchAction').innerText(),'続きを探す');
    await page.screenshot({path:out+'/'+name+'-'+theme+'-not-yet.png'});
    await page.evaluate(()=>{roundFixture.hold=-1;roundFixture.release();});
    await page.evaluate(()=>{roundFixture.allRecorded=false;roundFixture.recordPriority=true;roundFixture.budget=null;roundFixture.evaluated=[];SkyMapUI.setTime(Date.parse('2026-11-23T12:00:00+09:00'));});await ready(page);
    await page.locator('#candidateSearchAction').click();await ready(page);await rendered(page,10);
    const priority=await page.evaluate(()=>({page:roundFixture.pages.at(-1),evaluated:roundFixture.evaluated.slice()}));
    assert.equal(priority.page.counts.checked,10);assert.equal(priority.page.coverage.pendingPoints,14);assert(!priority.evaluated.includes('round-0'),'fixed recorded point remains queued behind new places');
    await page.evaluate(()=>{roundFixture.recordRemoved=true;document.dispatchEvent(new Event('astronotes-records-change'));});await ready(page);
    await page.locator('#candidateSearchAction').click();await ready(page);await rendered(page,20);
    assert.equal(await page.evaluate(()=>roundFixture.evaluated[10]),'round-0','removing the synthetic saved place restores normal priority on Continue');
    await page.evaluate(()=>{roundFixture.scopeMode=true;roundFixture.evaluated=[];SkyMapUI.setTime(Date.parse('2026-11-24T12:00:00+09:00'));});await ready(page);
    await page.locator('#candidateSearchAction').click();await ready(page);await rendered(page,2);
    assert.deepEqual(await page.evaluate(()=>roundFixture.evaluated),['round-0','round-1'],'standard scope includes the riverbank and never evaluates independent road seeds');
    assert.deepEqual(await page.evaluate(()=>AstroNotesCandidatePicker.visibleRows().map(r=>r.placeKind).sort()),['park','riverbank']);
    await page.locator('#additionalCandidateSearch > details > summary').click();await page.locator('#candidateIncludeRoads').check();await ready(page);
    await page.locator('#candidateSearchAction').click();await ready(page);await rendered(page,3);
    assert.deepEqual(await page.evaluate(()=>AstroNotesCandidatePicker.visibleRows().map(r=>r.placeKind).sort()),['park','riverbank','road']);
    await page.locator('#additionalCandidateSearch > details > summary').click();
    await page.locator('#candidateIncludeRoads').uncheck();await ready(page);await rendered(page,2);
    assert.deepEqual(await page.evaluate(()=>AstroNotesCandidatePicker.visibleRows().map(r=>r.placeKind).sort()),['park','riverbank'],'turning roads off retains the riverbank');
    await page.locator('#candidateIncludeRoads').check();await ready(page);await rendered(page,3);
    await page.locator('#candidateIncludeRoads').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/'+name+'-'+theme+'-road-scope.png'});
    await page.locator('#candidateIncludeRoads').uncheck();await ready(page);
    await page.evaluate(()=>{roundFixture.scopeMode=false;roundFixture.recordPriority=false;roundFixture.zeroBefore=160;roundFixture.hold=-1;roundFixture.budget=null;roundFixture.evaluated=[];SkyMapUI.setTime(Date.parse('2026-11-25T12:00:00+09:00'));});await ready(page);
    const beforePages=await page.evaluate(()=>roundFixture.pages.length);
    await page.locator('#candidateSearchAction').click();await ready(page);await rendered(page,10);
    const useful=await page.evaluate(()=>({page:roundFixture.pages.at(-1),actions:roundFixture.pages.length,evaluated:roundFixture.evaluated.length}));
    assert.equal(useful.actions,beforePages+1,'the first useful candidate must not require repeated Continue clicks');assert.equal(useful.evaluated,170);
    assert.equal(useful.page.pauseReason,'enough-places');assert.equal(useful.page.counts.checked,170);assert.equal(useful.page.rows.length,10);
    assert.match(await page.locator('#candidateSearchCredits').textContent(),/重なりが見つからない160/);
    await page.locator('#candidateUnifiedResults .list-item').first().evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));
    const usefulHit=await page.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
     const n=document.querySelector('#candidateUnifiedResults button[data-candidate-id]'),r=n.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
     return r.width>=44&&r.height>=44&&y>22&&y<innerHeight-22&&[-21,0,21].every(dx=>[-21,0,21].every(dy=>{const hit=document.elementFromPoint(x+dx,y+dy);return hit===n||n.contains(hit);}));});
    assert(usefulHit,'after ordinary scrolling, the new candidate has an unobscured 44px tap square');
    const fit=page.locator('#candidateMapToggle');
    assert.equal(await fit.getAttribute('aria-controls'),'skyMapCanvas');
    await fit.click();
    await page.waitForFunction(()=>AstroNotesMapWorkspace.targetState().newPins===10);
    assert(await page.locator('#skyMapCanvas').isVisible());
    assert.equal(await page.locator('#candidateUnifiedResults .list-item:visible').count(),10);
    await page.screenshot({path:out+'/'+name+'-'+theme+'-first-useful.png'});
    assert.equal(await page.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load()})),before);assert.equal(writes,0);assert.deepEqual(errors,[]);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    results.push({engine:name,theme,width:390,firstNewBeforeBatch:true,deadlinePause:true,additionalQuota:10,distinctNew:23,pendingPreserved:true,slowPointDoesNotStarve:true,zeroIsNotExhausted:true,recordPriorityRestores:true,riverbankStandard:true,roadScopeOptIn:true,firstUsefulBeyond160InOneAction:true,firstUsefulHitReady:true,firstUsefulPinsReady:true,writes,externalBlocked:external,errors,version:await page.locator('meta[name="app-version"]').getAttribute('content').catch(()=>null)});
   }catch(error){await page.screenshot({path:out+'/'+name+'-'+theme+'-failure.png'}).catch(()=>{});fs.writeFileSync(out+'/'+name+'-'+theme+'-failure.json',JSON.stringify(await page.evaluate(()=>({fixture:roundFixture,status:document.querySelector('#candidateSearchFeedback')?.innerText})).catch(()=>({})),null,2));throw error;}
   finally{await context.close();}
  }}finally{await browser.close();}
 }
 fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exitCode=1;});
