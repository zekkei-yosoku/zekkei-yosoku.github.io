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

const frameTimeoutMs=25000;
async function frames(page){
 let timer;
 try{
  // Keep the deadline in Node: a stalled renderer cannot run its own timeout.
  await Promise.race([
   page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Two animation frames did not complete within '+frameTimeoutMs+' ms')),frameTimeoutMs);})
  ]);
 }finally{clearTimeout(timer);}
}
const selection=page=>page.evaluate(()=>structuredClone(SkyMapUI.selectionState()));
const saved=page=>page.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()}));
async function readyPreview(page){
 await page.waitForFunction(()=>{const h=document.getElementById('aimLook'),s=SkyMapUI.selectionState();return document.getElementById('skyMapView').dataset.exploreStage==='preview'&&!document.getElementById('exploreScenePanel').hasAttribute('data-loading')&&h&&!h.hidden&&h._trialCompositionView&&Math.abs(h._lookAt-s.at)<1000;});
}
async function preview(page){await page.locator('#exploreShowResult').click();await readyPreview(page);}
async function pickSurface(page){
 await page.getByRole('button',{name:'重ねる位置を選ぶ',exact:true}).click();
 assert.equal(await page.locator('#trialComposition,#trialCompositionAdjust').count(),0,'duplicate numeric/limb dialog is absent');
 assert.equal(await page.locator('#trialCompositionToggle').getAttribute('aria-label'),'確定して撮影地点を探す');
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
  console.log('composition-entry',engine,'launch');
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{for(const width of (process.env.COMPOSITION_ENTRY_WIDTH||'320,390').split(',').map(Number)){
   const result={engine,width,base,fixture:'Synthetic search completion; real selection and surface geometry.'};
   const stage=name=>{result.stage=name;console.log('composition-entry',engine,width,name);};
   stage('context');
   const context=await browser.newContext({viewport:{width,height:900},locale:'ja-JP',timezoneId:'Asia/Tokyo',reducedMotion:'reduce'});
   await context.addInitScript(fixture,grants);let writes=0;const errors=[];
   await context.route('**/*',r=>{const u=new URL(r.request().url());if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(r.request().method()))writes++;return r.fulfill({json:{allowed:true,tool:'skymap',loginId:'composition-entry-test',tools:grants,favorites:[],sightings:[],records:[],rev:1}});}if(u.origin===new URL(base).origin)return r.continue();return r.abort();});
   const page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));
   const prefix=out+'/'+engine+'-'+width;
   try{
    stage('navigate');
    await page.goto(base+'#/almanac');await page.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof AstroNotesTrialComposition==='object'&&typeof TrialExplore.searchCompositionPlaces==='function');
    stage('startup-and-models');
    await page.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>3.7;aimBuildingDays=async()=>[];AstroNotesCandidatePicker.hiddenView=async()=>({read:true,note:null});navigationHistory.pushRoute('#/explore');});
    stage('workspace');
    await page.waitForFunction(()=>!!SkyMapUI.workspaceHost());
    await page.evaluate(()=>{SkyMapUI.setTarget('skytree');const b=document.getElementById('skyMapBody');b.value='moon';b.onchange();SkyMapUI.setTime(Date.parse('2026-11-25T12:00:00+09:00'));SkyMapUI.setObserver({name:'元の検索地点',latitude:35.7119,longitude:139.8089,elevation:3.7,groundManualM:3.7,standAglM:1.5});});
    stage('preview-current-selection');
    const savedBefore=await saved(page);await preview(page);
    await page.evaluate(()=>{SkyMapUI.setTime(Date.parse('2026-11-25T06:14:00+09:00'));SkyMapUI.setObserver({name:'新候補の歩道（合成検証）',latitude:35.7115447,longitude:139.8083335,elevation:3.7,groundManualM:3.7,standAglM:1.5});});
    await readyPreview(page);const current=await selection(page);result.current=current;
    assert.equal(await page.evaluate(()=>TrialExplore.searchCompositionPlaces()),false,'a missing composition is not accepted');
    stage('condition-editor');
    await page.locator('#exploreConditions > summary .explore-condition-edit').click();
    await page.waitForFunction(()=>document.getElementById('skyMapView').dataset.exploreStage==='search');
    assert.deepEqual(await selection(page),current,'editing keeps the current time and place, not the old return intent');
    stage('recorded-places');
    await page.locator('#exploreDiscovery-records').click();await page.waitForFunction(()=>document.getElementById('exploreRecordedPlaces').textContent.trim().length>0);
    result.recordsText=await page.locator('#exploreRecordedPlaces').innerText();assert.match(result.recordsText,/記録の撮影地点/);await page.screenshot({path:prefix+'-records.png',fullPage:true});
    stage('new-places-idle');
    await page.locator('#exploreDiscovery-new').click();await page.locator('#candidateSearchAction').waitFor({state:'visible'});assert(await page.locator('#candidateSearchAction').isEnabled());
    assert.equal(await page.evaluate(()=>compositionEntryFixture.searches.length),0,'opening conditions never starts a search by itself');
    await page.screenshot({path:prefix+'-new.png',fullPage:true});

    stage('pick-surface');
    await preview(page);const composition=await pickSurface(page);result.composition=composition;
    stage('first-search');
    await page.locator('#trialCompositionToggle').click();await waitSearch(page,1);
    assert.deepEqual(await selection(page),current);assert.deepEqual(await page.evaluate(()=>compositionEntryFixture.searches[0].composition),composition.composition);
    stage('repeat-acceptance');
    assert.deepEqual(await page.evaluate(()=>[TrialExplore.searchCompositionPlaces(),TrialExplore.searchCompositionPlaces(),TrialExplore.searchCompositionPlaces()]),[true,true,true]);await frames(page);
    assert.equal(await page.evaluate(()=>compositionEntryFixture.searches.length),1,'repeated acceptance does not restart or cancel the running search');assert.equal(await page.evaluate(()=>compositionEntryFixture.aborts),0);
    stage('finish-empty');
    await page.screenshot({path:prefix+'-progress.png',fullPage:true});await complete(page,'empty');await page.screenshot({path:prefix+'-empty.png',fullPage:true});
    stage('return-to-preview');
    await preview(page);await page.locator('#exploreBackToCandidates').click();await page.waitForFunction(()=>document.getElementById('skyMapView').dataset.exploreStage==='search');
    assert.deepEqual(await selection(page),current);assert.deepEqual(await page.evaluate(()=>AstroNotesTrialComposition.plan()),composition,'returning keeps the exact search composition');
    stage('finish-failed');
    await preview(page);assert.equal(await page.evaluate(()=>TrialExplore.searchCompositionPlaces()),true);await waitSearch(page,2);await complete(page,'failed');await page.screenshot({path:prefix+'-failed.png',fullPage:true});

    stage('delayed-mount');
    await preview(page);await page.evaluate(()=>{compositionEntryFixture.holdMount=true;compositionEntryFixture.held=[];});
    assert.equal(await page.evaluate(()=>TrialExplore.searchCompositionPlaces()),true);await page.waitForFunction(()=>compositionEntryFixture.held.length>0);await frames(page);
    assert.equal(await page.evaluate(()=>compositionEntryFixture.searches.length),2,'no search starts before its real action mounts');
    stage('release-delayed-mount');
    await page.evaluate(()=>compositionEntryFixture.release());await waitSearch(page,3);await complete(page,'empty');
    stage('date-change-cancels-pending');
    await preview(page);await page.evaluate(()=>{compositionEntryFixture.holdMount=true;compositionEntryFixture.held=[];});
    assert.equal(await page.evaluate(()=>TrialExplore.searchCompositionPlaces()),true);await page.waitForFunction(()=>compositionEntryFixture.held.length>0);
    await page.evaluate(()=>SkyMapUI.setTime(SkyMapUI.selectionState().at+60000));await frames(page);await page.evaluate(()=>compositionEntryFixture.release());await frames(page);
    assert.equal(await page.evaluate(()=>compositionEntryFixture.searches.length),3,'a date change cancels the waiting request before mount');
    stage('route-exit-cancels-pending');
    await preview(page);await page.evaluate(()=>{compositionEntryFixture.holdMount=true;compositionEntryFixture.held=[];});
    assert.equal(await page.evaluate(()=>TrialExplore.searchCompositionPlaces()),true);await page.waitForFunction(()=>compositionEntryFixture.held.length>0);
    await page.evaluate(()=>navigationHistory.pushRoute('#/records'));await page.waitForFunction(()=>!document.getElementById('exploreShowResult'));await page.evaluate(()=>{compositionEntryFixture.release();navigationHistory.pushRoute('#/explore');});
    await page.locator('#candidateSearchAction').waitFor({state:'attached'});await frames(page);
    assert.equal(await page.evaluate(()=>compositionEntryFixture.searches.length),3,'leaving and returning does not resurrect a waiting request');
    // Leaving the Explore route may clear its transient composition. Make a fresh selection before testing its explicit clear action.
    stage('new-selection-after-route-return');
    await preview(page);await pickSurface(page);await page.getByRole('button',{name:'確定して撮影地点を探す',exact:true}).click();await waitSearch(page,4);await complete(page,'empty');
    const selectedHeight=page.locator('#exploreCompositionSelection');await selectedHeight.waitFor({state:'visible'});
    const heightText=await page.evaluate(()=>{const s=SkyMapUI.selectionState(),c=AstroNotesTrialComposition.plan().composition;return '高さ '+(c.heightM-(s.target.groundM??0)).toFixed(1)+' m';});
    assert((await selectedHeight.innerText()).includes(heightText),'the search conditions show the selected height above ground');await page.screenshot({path:prefix+'-selected-height.png',fullPage:true});
    stage('clear-selection');
    await page.locator('#exploreCompositionClear').click();assert.equal(await page.evaluate(()=>AstroNotesTrialComposition.plan().composition),null);assert(await selectedHeight.isHidden());
    stage('verify-preservation');
    assert.equal(await saved(page),savedBefore);assert.equal(writes,0);assert.deepEqual(errors,[]);
    Object.assign(result,{passed:true,recordsAndNewVisible:true,currentSelectionRetained:true,progressEmptyAndFailureVisible:true,delayedMountStartsOnce:true,conditionChangeCancelsPending:true,routeExitCancelsPending:true,writes,errors});
    results.push(result);fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS',engine,width);
   }catch(e){console.error('composition-entry',engine,width,'failed at',result.stage,e);Object.assign(result,{error:String(e),writes,errors});fs.writeFileSync(prefix+'-failure.json',JSON.stringify(result,null,2));await page.screenshot({path:prefix+'-failure.png',fullPage:true}).catch(()=>{});throw e;}
   finally{stage('close-context');await context.close();console.log('composition-entry',engine,width,'closed-context');}
  }}finally{console.log('composition-entry',engine,'close-browser');await browser.close();console.log('composition-entry',engine,'closed-browser');}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
