// R04: real selection, surface picking and search UI; synthetic engine completion and account, no external writes.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.COMPOSITION_ENTRY_BASE||'http://127.0.0.1:8992/trial/index.html';
const out=process.env.COMPOSITION_ENTRY_OUT||'/tmp/astronotes-composition-search-entry';
const grants=['records','tower','diamond','pearl','skymap','multiscene'];

function fixture(grants){
 sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-entry',loginId:'composition-entry-test',tools:grants}));
 const f=window.compositionEntryFixture={searches:[],pending:[],aborts:0,holdMount:false,held:[]};
 const empty=()=>({rows:[],counts:{checked:3,blocked:0,outsideFrame:0,unknown:0},coverage:{regions:1,loaded:[]},canContinue:false});
 f.finish=kind=>{const task=f.pending.find(p=>!p.done);if(!task)throw Error('No pending synthetic search');task.done=true;if(kind==='failed')task.reject(Error('synthetic search failure'));else task.resolve(empty());};
 let discovery;
 Object.defineProperty(window,'AstroNotesCandidateDiscovery',{configurable:true,get:()=>discovery,set:api=>{
  discovery=api;let factory;
  Object.defineProperty(api,'createGenericSearch',{configurable:true,get:()=>factory,set:original=>{factory=options=>{
   const engine=original(options);return {...engine,cached:()=>null,restart:()=>true,searchAll:async(plan,options)=>{
    f.searches.push(structuredClone(plan));options.onProgress?.({stage:'evaluate',checked:3});
    return new Promise((resolve,reject)=>{const task={resolve,reject,done:false};f.pending.push(task);
     options.signal?.addEventListener('abort',()=>{if(!task.done){task.done=true;f.aborts++;resolve({...empty(),cancelled:true});}},{once:true});
    });
   }};
  };}});
 }});
 // Delay the adapter's real section insertion, leaving the public entry waiting for its existing action.
 const prepend=Element.prototype.prepend;
 Element.prototype.prepend=function(...nodes){
  if(f.holdMount&&this.id==='exploreNewPlaces'&&nodes.some(n=>n?.id==='additionalCandidateSearch')){
   for(const n of nodes){if(n?.id==='additionalCandidateSearch'){f.held.push(n);n.remove();}else prepend.call(this,n);}return;
  }
  return prepend.apply(this,nodes);
 };
 f.release=()=>{f.holdMount=false;const node=f.held.at(-1),pane=document.getElementById('exploreNewPlaces');f.held=[];if(node&&pane)prepend.call(pane,node);};
}

const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const selection=page=>page.evaluate(()=>structuredClone(SkyMapUI.selectionState()));
const saved=page=>page.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()}));
async function readyPreview(page){
 await page.waitForFunction(()=>{const h=document.getElementById('aimLook'),s=SkyMapUI.selectionState();return document.getElementById('skyMapView').dataset.exploreStage==='preview'&&!document.getElementById('exploreScenePanel').hasAttribute('data-loading')&&h&&!h.hidden&&h._trialCompositionView&&Math.abs(h._lookAt-s.at)<1000;});
}
async function preview(page){await page.locator('#exploreShowResult').click();await readyPreview(page);}
async function pickSurface(page){
 await page.locator('#trialCompositionToggle').click();
 const point=await page.evaluate(()=>{
  const h=document.getElementById('aimLook'),v=h._trialCompositionView,s=SkyMapUI.selectionState(),obs={...v.spec.obs,eyeM:v.spec.eyeM};
  const c=AstroNotesTrialSurface.preset({obs,target:s.target,align:AstroNotesAlign,heightM:452,xM:0,limb:'center'});
  const g=AstroNotesTrialSurface.geometry(obs,s.target,c,AstroNotesAlign),xy=AstroNotesAlign.viewProjector(v.win.az0,v.win.alt0)(g.azimuth,g.angle),r=v.cv.getBoundingClientRect(),pan=h._lensOffset||[0,0];
  return {x:r.left+(v.W/2+xy[0]*v.k+pan[0]*v.W)*r.width/v.W,y:r.top+(v.H/2-xy[1]*v.k+pan[1]*v.H)*r.height/v.H};
 });
 await page.mouse.click(point.x,point.y);
 await page.waitForFunction(()=>{const p=AstroNotesTrialComposition.plan();return p.composition&&!p.compositionInvalid;});
 return page.evaluate(()=>structuredClone(AstroNotesTrialComposition.plan()));
}
async function waitSearch(page,count){
 await page.waitForFunction(n=>compositionEntryFixture.searches.length===n&&document.getElementById('candidateSearchAction')?.dataset.state==='searching',count);
 assert.equal(await page.locator('#skyMapView').getAttribute('data-explore-stage'),'search');
 assert.equal(await page.locator('#exploreDiscovery-new').getAttribute('aria-selected'),'true');
 assert(await page.locator('#candidateSearchFeedback').isVisible());
 assert.match(await page.locator('#candidateSearchFeedback').innerText(),/構図と見通しを確認中/);
 await feedbackVisible(page);
}
async function feedbackVisible(page){
 await frames(page);
 const metrics=await page.locator('#candidateSearchFeedback').evaluate(n=>{const r=n.getBoundingClientRect(),top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {top:r.top,bottom:r.bottom,viewport:innerHeight,uncovered:!!top&&(top===n||n.contains(top))};});
 assert(metrics.top>=0&&metrics.bottom<=metrics.viewport&&metrics.uncovered,'feedback is visible above fixed controls: '+JSON.stringify(metrics));
}
async function complete(page,kind){
 await page.evaluate(kind=>compositionEntryFixture.finish(kind),kind);
 await page.waitForFunction(()=>document.getElementById('candidateSearchAction')?.dataset.state==='idle');
 assert.match(await page.locator('#candidateSearchFeedback').innerText(),kind==='failed'?/候補の情報を取得できませんでした/:/今回確認した範囲では候補がありません/);
 assert(await page.locator('#candidateSearchAction').isEnabled());
 await feedbackVisible(page);
}

(async()=>{
 fs.mkdirSync(out,{recursive:true});const results=[];
 for(const [engine,type]of [['chrome',chromium],['webkit',webkit]].filter(([e])=>(process.env.COMPOSITION_ENTRY_ENGINE||'chrome,webkit').split(',').includes(e))){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{for(const width of (process.env.COMPOSITION_ENTRY_WIDTH||'320,390').split(',').map(Number)){
   const context=await browser.newContext({viewport:{width,height:900},locale:'ja-JP',timezoneId:'Asia/Tokyo',reducedMotion:'reduce'});
   await context.addInitScript(fixture,grants);let writes=0;const errors=[],result={engine,width,base,fixture:'Synthetic search completion; real selection and surface geometry.'};
   await context.route('**/*',r=>{const u=new URL(r.request().url());if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(r.request().method()))writes++;return r.fulfill({json:{allowed:true,tool:'skymap',loginId:'composition-entry-test',tools:grants,favorites:[],sightings:[],records:[],rev:1}});}if(u.origin===new URL(base).origin)return r.continue();return r.abort();});
   const page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));
   const prefix=out+'/'+engine+'-'+width;
   try{
    await page.goto(base+'#/almanac');await page.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof AstroNotesTrialComposition==='object'&&typeof TrialExplore.searchCompositionPlaces==='function');
    await page.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>3.7;aimBuildingDays=async()=>[];AstroNotesCandidatePicker.hiddenView=async()=>({read:true,note:null});navigationHistory.pushRoute('#/explore');});
    await page.waitForFunction(()=>!!SkyMapUI.workspaceHost());
    await page.evaluate(()=>{SkyMapUI.setTarget('skytree');const b=document.getElementById('skyMapBody');b.value='moon';b.onchange();SkyMapUI.setTime(Date.parse('2026-11-25T12:00:00+09:00'));SkyMapUI.setObserver({name:'元の検索地点',latitude:35.7119,longitude:139.8089,elevation:3.7,groundManualM:3.7,standAglM:1.5});});
    const savedBefore=await saved(page);await preview(page);
    await page.evaluate(()=>{SkyMapUI.setTime(Date.parse('2026-11-25T06:14:00+09:00'));SkyMapUI.setObserver({name:'新候補の歩道（合成検証）',latitude:35.7115447,longitude:139.8083335,elevation:3.7,groundManualM:3.7,standAglM:1.5});});
    await readyPreview(page);const current=await selection(page);result.current=current;
    assert.equal(await page.evaluate(()=>TrialExplore.searchCompositionPlaces()),false,'a missing composition is not accepted');
    await page.locator('#exploreConditions > summary .explore-condition-edit').click();
    await page.waitForFunction(()=>document.getElementById('skyMapView').dataset.exploreStage==='search');
    assert.deepEqual(await selection(page),current,'editing keeps the current time and place, not the old return intent');
    await page.locator('#exploreDiscovery-records').click();await page.waitForFunction(()=>document.getElementById('exploreRecordedPlaces').textContent.trim().length>0);
    result.recordsText=await page.locator('#exploreRecordedPlaces').innerText();assert.match(result.recordsText,/記録の撮影地点/);await page.screenshot({path:prefix+'-records.png',fullPage:true});
    await page.locator('#exploreDiscovery-new').click();await page.locator('#candidateSearchAction').waitFor({state:'visible'});assert(await page.locator('#candidateSearchAction').isEnabled());
    assert.equal(await page.evaluate(()=>compositionEntryFixture.searches.length),0,'opening conditions never starts a search by itself');
    await page.screenshot({path:prefix+'-new.png',fullPage:true});

    await preview(page);const composition=await pickSurface(page);result.composition=composition;
    await page.locator('#trialCompositionToggle').click();await waitSearch(page,1);
    assert.deepEqual(await selection(page),current);assert.deepEqual(await page.evaluate(()=>compositionEntryFixture.searches[0].composition),composition.composition);
    assert.deepEqual(await page.evaluate(()=>[TrialExplore.searchCompositionPlaces(),TrialExplore.searchCompositionPlaces(),TrialExplore.searchCompositionPlaces()]),[true,true,true]);await frames(page);
    assert.equal(await page.evaluate(()=>compositionEntryFixture.searches.length),1,'repeated acceptance does not restart or cancel the running search');assert.equal(await page.evaluate(()=>compositionEntryFixture.aborts),0);
    await page.screenshot({path:prefix+'-progress.png',fullPage:true});await complete(page,'empty');await page.screenshot({path:prefix+'-empty.png',fullPage:true});
    await preview(page);await page.locator('#exploreBackToCandidates').click();await page.waitForFunction(()=>document.getElementById('skyMapView').dataset.exploreStage==='search');
    assert.deepEqual(await selection(page),current);assert.deepEqual(await page.evaluate(()=>AstroNotesTrialComposition.plan()),composition,'returning keeps the exact search composition');
    await preview(page);assert.equal(await page.evaluate(()=>TrialExplore.searchCompositionPlaces()),true);await waitSearch(page,2);await complete(page,'failed');await page.screenshot({path:prefix+'-failed.png',fullPage:true});

    await preview(page);await page.evaluate(()=>{compositionEntryFixture.holdMount=true;compositionEntryFixture.held=[];});
    assert.equal(await page.evaluate(()=>TrialExplore.searchCompositionPlaces()),true);await page.waitForFunction(()=>compositionEntryFixture.held.length>0);await frames(page);
    assert.equal(await page.evaluate(()=>compositionEntryFixture.searches.length),2,'no search starts before its real action mounts');
    await page.evaluate(()=>compositionEntryFixture.release());await waitSearch(page,3);await complete(page,'empty');
    await preview(page);await page.evaluate(()=>{compositionEntryFixture.holdMount=true;compositionEntryFixture.held=[];});
    assert.equal(await page.evaluate(()=>TrialExplore.searchCompositionPlaces()),true);await page.waitForFunction(()=>compositionEntryFixture.held.length>0);
    await page.evaluate(()=>SkyMapUI.setTime(SkyMapUI.selectionState().at+60000));await frames(page);await page.evaluate(()=>compositionEntryFixture.release());await frames(page);
    assert.equal(await page.evaluate(()=>compositionEntryFixture.searches.length),3,'a date change cancels the waiting request before mount');
    await preview(page);await page.evaluate(()=>{compositionEntryFixture.holdMount=true;compositionEntryFixture.held=[];});
    assert.equal(await page.evaluate(()=>TrialExplore.searchCompositionPlaces()),true);await page.waitForFunction(()=>compositionEntryFixture.held.length>0);
    await page.evaluate(()=>navigationHistory.pushRoute('#/records'));await page.waitForFunction(()=>!document.getElementById('exploreShowResult'));await page.evaluate(()=>{compositionEntryFixture.release();navigationHistory.pushRoute('#/explore');});
    await page.locator('#candidateSearchAction').waitFor({state:'attached'});await frames(page);
    assert.equal(await page.evaluate(()=>compositionEntryFixture.searches.length),3,'leaving and returning does not resurrect a waiting request');
    assert.equal(await saved(page),savedBefore);assert.equal(writes,0);assert.deepEqual(errors,[]);
    Object.assign(result,{passed:true,recordsAndNewVisible:true,currentSelectionRetained:true,progressEmptyAndFailureVisible:true,delayedMountStartsOnce:true,conditionChangeCancelsPending:true,routeExitCancelsPending:true,writes,errors});
    results.push(result);fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS',engine,width);
   }catch(e){Object.assign(result,{error:String(e),writes,errors});fs.writeFileSync(prefix+'-failure.json',JSON.stringify(result,null,2));await page.screenshot({path:prefix+'-failure.png',fullPage:true}).catch(()=>{});throw e;}
   finally{await context.close();}
  }}finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
