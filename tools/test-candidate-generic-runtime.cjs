// Real trial app integration. Synthetic inverse/provider/evaluation ports isolate
// presentation, freshness and exact (position,time,height) selection; this is not
// a celestial/LOS accuracy test. No personal API writes or forecast requests.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.CANDIDATE_GENERIC_BASE||'http://127.0.0.1:8997/trial/';
const out=process.env.CANDIDATE_GENERIC_OUT||'/tmp/astronotes-generic-runtime';fs.mkdirSync(out,{recursive:true});
const granted=['records','tower','diamond','pearl','skymap','multiscene'];
function installFixture(granted){
 sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-generic-runtime',loginId:'generic-runtime-test',tools:granted}));
 window.candidateFixture={plans:[],rows:[],loads:0};
 let discovery;
 Object.defineProperty(window,'AstroNotesCandidateDiscovery',{configurable:true,get:()=>discovery,set:api=>{
  discovery=api;let factory;
  Object.defineProperty(api,'createGenericSearch',{configurable:true,get:()=>factory,set:original=>{factory=options=>{
   AstroNotesCandidateComposition.inverseSeeds=async()=>({seeds:[{latitude:35.69,longitude:139.73,at:Date.parse('2026-11-05T12:00:00+09:00'),radiusM:500}],partial:true});
   const points=[
    {id:'road',name:'記録外の歩道',placeKind:'road',latitude:35.6900,longitude:139.7300,groundM:25,eyeM:1.5,rank:0},
    {id:'park',name:'任意対象の公園',placeKind:'park',latitude:35.6903,longitude:139.7304,groundM:28,eyeM:4,rank:99},
    {id:'deck-low',name:'同じ展望地点 下層',placeKind:'viewpoint',latitude:35.6906,longitude:139.7308,groundM:31,eyeM:2,rank:100},
    {id:'deck-high',name:'同じ展望地点 上層',placeKind:'viewpoint',latitude:35.6906,longitude:139.7308,groundM:31,eyeM:101.5,rank:101}
   ].map(p=>({...p,surfaceId:p.id,standingSurfaceKnown:true,accessKnown:true}));
   return original({...options,loadStatic:null,provider:{load:async plan=>{candidateFixture.loads++;candidateFixture.plans.push(structuredClone(plan));return {points,coverage:{nextCursor:null},partial:false};}},evaluate:async(plan,point)=>{
    const range=AstroNotesCandidateComposition.timeRange(plan),at=range.start===range.end?range.start:Math.min(range.end,range.start+12*3600000);
    const row={id:plan.body+'-'+point.id+'-'+at,requestKey:plan.requestKey,recommend:true,aligned:true,status:'model-visible',placeKind:point.placeKind,surfaceId:point.surfaceId,rank:point.rank,
     place:{name:point.name,latitude:point.latitude,longitude:point.longitude,elevation:point.groundM,groundManualM:point.groundM,standAglM:point.eyeM,eyeHeightAGL:point.eyeM,decks:[],stand:'ground'},
     assumedObserver:{latitude:point.latitude,longitude:point.longitude,elevation:point.groundM,eyeM:point.eyeM},
     event:{at,partId:plan.partId,matchMode:'limb',side:'rise',relation:point.id==='park'?'near':'exact',gapAngleDeg:point.id==='park'?.08:0},
     quality:{photographyClass:'normal',visibility:'model-clear'},modelEvidence:{kind:'synthetic-runtime-fixture',status:'model-clear'}};
    candidateFixture.rows.push(structuredClone(row));return row;
   }});
  };}});
 }});
}
const state=p=>p.evaluate(()=>{const s=SkyMapUI.selectionState(),o=s.observer,eye=o?aimObserverAt(o,SkyMapUI.workspaceHost().session.ground):null;return {body:s.body,target:s.target?.id,observer:o&&{name:o.name,latitude:o.latitude,longitude:o.longitude},at:s.at,ground:eye?.elevation,eyeM:eye?.eyeM,partId:s.partId,limb:s.limb};});
const saved=p=>p.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()}));
async function openCandidates(p){
 // 2026-11-11 新しい撮影地点は「探す」の検索画面のタブ（見え方からは戻るボタンで戻る）。
 if(await p.locator('#exploreBackToCandidates').isVisible())await p.locator('#exploreBackToCandidates').click();
 await p.locator('#exploreDiscovery-new').click();await p.waitForFunction(()=>{const button=document.getElementById('candidateSearchAction');return button?.dataset.state==='idle'&&!button.disabled&&button.getBoundingClientRect().width>0;});
}
async function search(p,visibleCount=3){
 await p.locator('#candidateSearchAction').click();
 await p.waitForFunction(n=>document.querySelector('#candidateSearchFeedback [role=status]')?.textContent.includes(n+'件の新たな撮影地点の候補があります'),visibleCount);
 await p.waitForFunction(n=>AstroNotesCandidatePicker.visibleRows().length===n&&document.getElementById('candidateSearchAction')?.dataset.state==='idle'&&document.getElementById('additionalCandidateResults')?.getAttribute('aria-busy')==='false',visibleCount);
}
async function prepare(p,body){
 // 戻るボタンは選ぶ前の検索条件へ戻すので、条件を変える前に検索画面へ戻る。
 if(await p.locator('#exploreBackToCandidates').isVisible())await p.locator('#exploreBackToCandidates').click();
 await p.evaluate(body=>{
  const custom={name:'登録外テストビル',latitude:35.72,longitude:139.78,groundM:15,heightM:150,topM:165,heightAuto:false};
  const target={...custom,id:'custom',type:'building',widthM:40,parts:[{id:'tip',name:'てっぺん',m:165}]};
  SkyMapUI.workspaceHost().restoreTarget({target,custom,customTarget:target,partId:'tip',limb:'lower',matchMode:'limb'});
  const select=document.getElementById('skyMapBody');select.value=body;select.onchange();SkyMapUI.setTime(Date.parse('2026-11-05T12:00:00+09:00'));
 },body);
}
async function assertSelected(p,row,before,body,target='custom'){
 await p.waitForFunction(()=>!document.getElementById('placeSheet').open);
 const actual=await state(p);assert.equal(actual.body,body);assert.equal(actual.target,target);
 assert.equal(actual.at,row.event.at);assert.equal(actual.observer.name,row.place.name);
 assert.equal(actual.observer.latitude,row.place.latitude);assert.equal(actual.observer.longitude,row.place.longitude);
 assert.equal(actual.ground,row.assumedObserver.elevation);assert.equal(actual.eyeM,row.assumedObserver.eyeM);
 assert.equal(await saved(p),before,'selection does not save personal data');
 await p.waitForFunction(()=>{try{const h=document.getElementById('aimLook'),s=SkyMapUI.selectionState();return !h.hidden&&Math.abs(h._lookAt-s.at)<1000&&Math.abs(h._lookSpec.obs.latitude-s.observer.latitude)<1e-8;}catch{return false;}});
 const appearance=await p.evaluate(()=>{const h=document.getElementById('aimLook');return {at:h._lookAt,latitude:h._lookSpec.obs.latitude,longitude:h._lookSpec.obs.longitude,elevation:h._lookSpec.obs.elevation,eyeM:h._lookSpec.eyeM};});
 assert.equal(appearance.at,row.event.at);assert.equal(appearance.latitude,row.place.latitude);assert.equal(appearance.longitude,row.place.longitude);
 assert.equal(appearance.elevation,row.assumedObserver.elevation);assert.equal(appearance.eyeM,row.assumedObserver.eyeM);
}
(async()=>{
 const results=[];
 for(const [engine,type]of [['chrome',chromium],['webkit',webkit]].filter(([n])=>(process.env.CANDIDATE_GENERIC_ENGINES||'chrome,webkit').split(',').includes(n))){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{for(const width of(process.env.CANDIDATE_GENERIC_WIDTHS||'320,390,1280').split(',').map(Number))for(const theme of(process.env.CANDIDATE_GENERIC_THEMES||'light,dark').split(',')){
   const context=await browser.newContext({viewport:{width,height:width===320?700:900},colorScheme:theme,reducedMotion:'reduce'});let writes=0,external=0;
   await context.addInitScript(installFixture,granted);
   await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(base).origin)return r.continue();if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(r.request().method()))writes++;return r.fulfill({status:200,json:{allowed:true,tool:'skymap',loginId:'generic-runtime-test',tools:granted,credentials:[],hasPassword:true,recoveryCodes:10,favorites:[],sightings:[],records:[],rev:1}});}external++;return r.abort();});
   const p=await context.newPage(),errors=[];p.setDefaultTimeout(30000);p.on('pageerror',e=>errors.push(e.message));
   try{
    await p.goto(base+'#/explore');await p.waitForFunction(()=>typeof AstroNotesCandidatePicker==='object'&&typeof SkyMapUI==='object');
    await p.evaluate(async theme=>{await startupSessionReady;groundAt=async()=>30;aimBuildingDays=async()=>[];await AstroNotesAssets.ensureModels();navigationHistory.pushRoute('#/explore');document.documentElement.dataset.theme=theme;SkyMapUI.setTarget('skytree');},theme);
    const before=await saved(p),bodies=['sun','moon','sirius','mercury','venus','mars','jupiter','saturn'];
    for(const [index,body]of bodies.entries()){
     await prepare(p,body);await openCandidates(p);assert.equal(await p.evaluate(()=>SkyMapUI.selectionState().body),body);
     const beforeLoads=await p.evaluate(()=>candidateFixture.loads);await search(p);assert.equal(await p.evaluate(()=>candidateFixture.loads),beforeLoads+1);
     const names=await p.locator('#candidateUnifiedResults .list-item').evaluateAll(ns=>ns.map(n=>n.firstElementChild.textContent));// The list opens in time order (all three at 12:00 here); the new places are only parks, plazas, viewpoints and riverbanks.
     assert.deepEqual([...names].sort(),['任意対象の公園','同じ展望地点 下層','同じ展望地点 上層'].sort(),'only parks, plazas, viewpoints and riverbanks are new places');
     assert.equal(await p.evaluate(()=>AstroNotesCandidatePicker.visibleRows().filter(r=>r.place.latitude===35.6906).length),2,'same point different height preserved');
     const metrics=await p.locator('#candidateListControls').evaluate(n=>({overflow:n.scrollWidth>n.clientWidth+1,bodyOverflow:document.documentElement.scrollWidth>innerWidth+1}));assert(!metrics.overflow&&!metrics.bodyOverflow,JSON.stringify(metrics));
     if(index===0)await p.screenshot({path:out+'/'+engine+'-'+width+'-'+theme+'-list.png'});
     const selectedIndex=index%3,row=await p.evaluate(i=>structuredClone(AstroNotesCandidatePicker.visibleRows()[i]),selectedIndex),selectionBefore=await state(p);
     await p.locator('#candidateMapToggle').click();await p.locator('#candidateMapCanvas').waitFor();assert.deepEqual(await state(p),selectionBefore,'map preview must not alter session');
     const option=await p.locator('#candidateMapChoice option').nth(selectedIndex).getAttribute('value');await p.locator('#candidateMapChoice').selectOption(option);
     assert((await p.locator('#candidateMapDetail').innerText()).includes((row.assumedObserver.elevation+row.assumedObserver.eyeM).toFixed(1)+'m'));
     if(index===0)await p.screenshot({path:out+'/'+engine+'-'+width+'-'+theme+'-map.png'});
     await p.locator('#candidateMapUse').click();await assertSelected(p,row,before,body);
     if(index===2)await p.screenshot({path:out+'/'+engine+'-'+width+'-'+theme+'-appearance.png'});
    }
    // 記録の撮影地点は「記録の撮影地点」タブの別一覧（test-candidate-workspace-flow.cjs）。
    // Capture the original row callback and call it immediately after a changed
    // request, before a DOM watcher can remove the old row.
    await prepare(p,'moon');await openCandidates(p);
    await p.evaluate(()=>{const d=document.querySelector('#additionalCandidateSearch details');d.open=true;const mode=document.getElementById('candidateSearchMode');mode.value='instant';mode.onchange();});await search(p);
    const instant=await state(p);await p.evaluate(()=>{const click=document.querySelector('#candidateUnifiedResults .list-item').onclick;SkyMapUI.setTime(SkyMapUI.selectionState().at+60000);click();});
    assert.equal((await state(p)).at,instant.at+60000);assert.equal(await p.evaluate(()=>document.getElementById('skyMapView').dataset.exploreStage),'search','old instant candidate refused');
    await p.waitForFunction(()=>{const button=document.getElementById('candidateSearchAction');return button?.dataset.state==='idle'&&!button.disabled;});await search(p);
    // 2026-11-11: with one target overlapped as a whole the lens does not decide the places (ユーザー「天体と重なる所だけ確認」),
    // so a lens change keeps the list and its rows stay current.
    const lensRows=await p.evaluate(()=>AstroNotesCandidatePicker.visibleRows().length);await p.evaluate(()=>{aimLens.on=true;aimLens.mode='manual';aimLens.focal=(aimLens.focal||200)+100;document.dispatchEvent(new Event('astronotes-composition-change'));});await p.waitForTimeout(300);assert.equal(await p.evaluate(()=>AstroNotesCandidatePicker.visibleRows().length),lensRows,'a lens change keeps single-target rows');
    await p.waitForFunction(()=>{const button=document.getElementById('candidateSearchAction');return button?.dataset.state==='idle'&&!button.disabled;});await search(p);
    const rangeBefore=await state(p);await p.evaluate(()=>{const click=document.querySelector('#candidateUnifiedResults .list-item').onclick,mode=document.getElementById('candidateSearchMode');mode.value='window';mode.onchange();click();});assert.deepEqual(await state(p),rangeBefore,'changed time range candidate refused');
    await search(p);await p.evaluate(()=>{const mode=document.getElementById('candidateSearchMode');mode.value='day';mode.onchange();});
    assert.equal(await saved(p),before);assert.equal(writes,0,'no API writes');assert.deepEqual(errors,[]);
    results.push({engine,width,theme,bodies:bodies.length,arbitraryTarget:true,distinctHeights:[2,4,101.5],exactMapToAppearance:true,placeKindsOnly:true,staleInstantRangeRefusedLensKept:true,personalDataUnchanged:true,writes,externalBlocked:external});console.log(engine,width,theme,'passed');
   }catch(e){await p.screenshot({path:out+'/'+engine+'-'+width+'-'+theme+'-failure.png'}).catch(()=>{});console.error('fixture failure',engine,width,theme,await p.evaluate(()=>({status:document.querySelector('#candidateSearchFeedback [role=status]')?.textContent,rows:globalThis.AstroNotesCandidatePicker?.visibleRows?.().length,fixture:globalThis.candidateFixture,selection:typeof SkyMapUI==='object'?SkyMapUI.selectionState():null})).catch(()=>null));throw e;}
   finally{await context.close();}
  }}finally{await browser.close();}
 }
 fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
