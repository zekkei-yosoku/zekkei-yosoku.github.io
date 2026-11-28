// Real trial app integration. Synthetic inverse/provider/evaluation ports isolate
// presentation, freshness and exact (position,time,height) selection; this is not
// a celestial/LOS accuracy test. No personal API writes or forecast requests.
require('./no-open-meteo.cjs');
require('./explore-open-conditions.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.CANDIDATE_GENERIC_BASE||'http://127.0.0.1:8997/trial/';
const out=process.env.CANDIDATE_GENERIC_OUT||'/tmp/astronotes-generic-runtime';fs.mkdirSync(out,{recursive:true});
const granted=['records','tower','diamond','pearl','skymap','multiscene'];
function installFixture(granted){
 sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-generic-runtime',loginId:'generic-runtime-test',tools:granted}));
 window.candidateFixture={plans:[],rows:[],loads:0,holdSecond:false,releaseSecond:null};
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
   const riverPoints=[
    {id:'named-river',name:'河川沿いの歩道',placeKind:'riverbank',latitude:35.73521881818182,longitude:139.8707811818182,groundM:4,eyeM:1.5,rank:0,riverName:'新中川'},
    {id:'unlocated-river',name:'河川沿いの歩道',placeKind:'riverbank',latitude:35.59,longitude:140.02,groundM:2,eyeM:1.5,rank:1}
   ].map(p=>({...p,surfaceId:p.id,standingSurfaceKnown:true,accessKnown:true}));
   // Synthetic places: the real visibility map (2026-11-13) is left out.
   return original({...options,prefilter:null,provider:{load:async plan=>{candidateFixture.loads++;candidateFixture.plans.push(structuredClone(plan));return {points:candidateFixture.riverRows?riverPoints:points,coverage:{nextCursor:null},partial:false};}},evaluate:async(plan,point)=>{
    if(candidateFixture.holdSecond&&point.id==='deck-high')await new Promise(resolve=>{candidateFixture.releaseSecond=resolve;});
    // trial段階④は点天体の昼を除外する。UI検査の合成候補も有効な夜の時刻に置く。
    const range=AstroNotesCandidateComposition.timeRange(plan),at=range.start===range.end?range.start:Math.min(range.end,range.start+(plan.pointNight?23:12)*3600000);
    const row={id:plan.body+'-'+point.id+'-'+at,requestKey:plan.requestKey,recommend:true,aligned:true,status:'model-visible',placeKind:point.placeKind,surfaceId:point.surfaceId,rank:point.rank,
     place:{name:point.name,latitude:point.latitude,longitude:point.longitude,elevation:point.groundM,groundManualM:point.groundM,standAglM:point.eyeM,eyeHeightAGL:point.eyeM,decks:[],stand:'ground'},
     assumedObserver:{latitude:point.latitude,longitude:point.longitude,elevation:point.groundM,eyeM:point.eyeM},
     event:{at,partId:plan.partId,matchMode:'limb',side:'rise',relation:point.id==='park'?'near':'exact',gapAngleDeg:point.id==='park'?.08:0},
     sourceEvidence:point.riverName?{riverName:point.riverName}:undefined,
     quality:{photographyClass:'normal',visibility:'model-clear'},modelEvidence:{kind:'synthetic-runtime-fixture',status:'model-clear'}};
    candidateFixture.rows.push(structuredClone(row));return row;
   }});
  };}});
 }});
}
const state=p=>p.evaluate(()=>{const s=SkyMapUI.selectionState(),o=s.observer,eye=o?aimObserverAt(o,SkyMapUI.workspaceHost().session.ground):null;return {body:s.body,target:s.target?.id,observer:o&&{name:o.name,latitude:o.latitude,longitude:o.longitude},at:s.at,ground:eye?.elevation,eyeM:eye?.eyeM,partId:s.partId,limb:s.limb};});
const saved=p=>p.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()}));
async function openCandidates(p){
 // 見え方で選んだ候補から、地図付きの検索シートへ戻る。
 if(await p.locator('#exploreBackToCandidates').isVisible())await p.locator('#exploreBackToCandidates').click();
 await p.waitForFunction(()=>{const button=document.getElementById('candidateSearchAction');return document.getElementById('skyMapView').hasAttribute('data-explore-sheet')&&button?.dataset.state==='idle'&&!button.disabled&&button.getBoundingClientRect().width>0;});
}
async function search(p,visibleCount=3,checkFirst=false,releaseLabels=null){
 if(checkFirst)await p.evaluate(()=>{candidateFixture.holdSecond=true;});
 await p.locator('#candidateSearchAction').click();
 if(checkFirst){
  await p.waitForFunction(()=>candidateFixture.releaseSecond&&AstroNotesCandidatePicker.visibleRows().length===1&&document.getElementById('candidateSearchAction')?.dataset.state==='searching',null,{timeout:releaseLabels?3000:30000});
  assert(await p.locator('#candidateUnifiedResults .list-item').first().isVisible());
  const working=p.locator('.candidate-search-primary[data-candidate-searching]');
  assert(await working.getByRole('status').isVisible());
  assert(await working.getByRole('progressbar').isVisible());
  assert(await working.getByRole('button',{name:'キャンセル',exact:true}).isVisible());
  assert(!(await working.innerText()).match(/\d+地点/),'progress does not present checked samples as candidate counts');
  if(releaseLabels)releaseLabels();
  await p.evaluate(()=>{candidateFixture.holdSecond=false;candidateFixture.releaseSecond();candidateFixture.releaseSecond=null;});
 }
 await p.waitForFunction(n=>document.querySelector('#candidateSearchFeedback [role=status]')?.textContent.includes(n+'か所の新たな撮影地点の候補があります'),visibleCount);
 await p.waitForFunction(n=>AstroNotesCandidatePicker.visibleRows().length===n&&document.getElementById('candidateSearchAction')?.dataset.state==='idle'&&document.getElementById('additionalCandidateResults')?.getAttribute('aria-busy')==='false',visibleCount);
}
async function fitCandidatePins(page,expected){
 const fit=page.locator('#candidateMapToggle');
 assert.equal(await fit.getAttribute('aria-controls'),'skyMapCanvas');
 assert.match(await fit.innerText(),/ピンに合わせる/);
 await fit.click();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.waitForFunction(n=>AstroNotesMapWorkspace.targetState().newPins===n,expected);
 assert(await page.locator('#skyMapCanvas').isVisible());
}
async function focusCandidatePin(page,row){
 const pin=await page.evaluate(row=>{
  const canvas=document.getElementById('skyMapCanvas'),rect=canvas.getBoundingClientRect();
  const [x,y]=SkyMapUI.workspaceHost().map.project(row.place.latitude,row.place.longitude);
  const screenX=rect.left+x,screenY=rect.top+y;
  return {x:screenX,y:screenY,hit:document.elementFromPoint(screenX,screenY)===canvas,id:AstroNotesCandidatePicker.candidateKey(row)};
 },row);
 assert(pin.hit,'the visible pin is on the shared map');
 const focused=page.locator('#candidateUnifiedResults [data-map-candidate-selected]');
 // Two observation heights at identical coordinates have separate candidates and tapped pins cycle between them.
 for(let i=0;i<2;i++){
  if(i)await page.waitForTimeout(520); // A second separate tap must not be interpreted as double-click zoom.
  await page.mouse.click(pin.x,pin.y);
  await focused.waitFor({state:'visible'});
  if(await focused.getAttribute('data-candidate-id')===pin.id)return focused;
 }
 assert.equal(await focused.getAttribute('data-candidate-id'),pin.id);
 return focused;
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
   let releaseLabels,labelsFailedResolve,labelsRecoveredResolve;const heldLabels=new Promise(resolve=>{releaseLabels=resolve;}),labelsFailed=new Promise(resolve=>{labelsFailedResolve=resolve;}),labelsRecovered=new Promise(resolve=>{labelsRecoveredResolve=resolve;});
   const labelRequests=new Map(),failedLabels=new Set(),recoveredLabels=new Set();
   await context.route(/\/candidate-label-(?:addresses|facilities)\.json(?:\?|$)/,async route=>{
    const name=new URL(route.request().url()).pathname,count=(labelRequests.get(name)||0)+1;labelRequests.set(name,count);
    await heldLabels;
    if(count===1){await route.fulfill({status:503,body:'temporarily unavailable'});failedLabels.add(name);if(failedLabels.size===2)labelsFailedResolve();}
    else{await route.continue().catch(()=>{});recoveredLabels.add(name);if(recoveredLabels.size===2)labelsRecoveredResolve();}
   });
   const p=await context.newPage(),errors=[];p.setDefaultTimeout(30000);p.on('pageerror',e=>errors.push(e.message));
   try{
    await p.goto(base+'#/explore');await p.waitForFunction(()=>typeof AstroNotesCandidatePicker==='object'&&typeof SkyMapUI==='object');
    await p.evaluate(async theme=>{await startupSessionReady;groundAt=async()=>30;aimBuildingDays=async()=>[];await AstroNotesAssets.ensureModels();navigationHistory.pushRoute('#/explore');document.documentElement.dataset.theme=theme;SkyMapUI.setTarget('skytree');},theme);
    const before=await saved(p),bodies=['sun','moon','sirius','mercury','venus','mars','jupiter','saturn'];
    for(const [index,body]of bodies.entries()){
     await prepare(p,body);await openCandidates(p);assert.equal(await p.evaluate(()=>SkyMapUI.selectionState().body),body);
     const beforeLoads=await p.evaluate(()=>candidateFixture.loads);await search(p,3,index===0,index===0?releaseLabels:null);assert.equal(await p.evaluate(()=>candidateFixture.loads),beforeLoads+1);
     if(index===0)await labelsFailed;
     if(index===1){await labelsRecovered;assert.equal(recoveredLabels.size,2,'next search retries both missing optional label files');}
     const names=await p.locator('#candidateUnifiedResults .list-item').evaluateAll(ns=>ns.map(n=>n.firstElementChild.textContent));// All three share one eligible event time; standard scope excludes independent roads.
     if(await p.evaluate(()=>candidateFixture.plans.at(-1)?.pointNight===true))assert(await p.evaluate(()=>AstroNotesCandidatePicker.visibleRows().every(r=>AstroNotesBodies.state('sun',r.event.at,r.assumedObserver,{refraction:false}).altitude<=-6)),'point-body UI fixtures satisfy the actual night condition');
     assert.deepEqual([...names].sort(),['任意対象の公園','同じ展望地点 下層','同じ展望地点 上層'].sort(),'standard scope excludes independent roads');
     assert.equal(await p.evaluate(()=>AstroNotesCandidatePicker.visibleRows().filter(r=>r.place.latitude===35.6906).length),2,'same point different height preserved');
     const metrics=await p.locator('#candidateListControls').evaluate(n=>({overflow:n.scrollWidth>n.clientWidth+1,bodyOverflow:document.documentElement.scrollWidth>innerWidth+1}));assert(!metrics.overflow&&!metrics.bodyOverflow,JSON.stringify(metrics));
     if(index===0)await p.screenshot({path:out+'/'+engine+'-'+width+'-'+theme+'-list.png'});
     const selectedIndex=index%3,row=await p.evaluate(i=>structuredClone(AstroNotesCandidatePicker.visibleRows()[i]),selectedIndex),selectionBefore=await state(p);
     if(index===0){
      await p.evaluate(()=>{const h=SkyMapUI.workspaceHost();h.map.setView(34.7,135.5,14);h.redraw();});
      await p.waitForFunction(()=>AstroNotesMapWorkspace.targetState().newPins===0);
     }
     await fitCandidatePins(p,3);
     const selected=await focusCandidatePin(p,row);
     assert(await selected.getByText(row.place.name,{exact:true}).isVisible());
     assert.deepEqual(await state(p),selectionBefore,'focusing a pin does not alter the Explore conditions');
     if(index===0)await p.screenshot({path:out+'/'+engine+'-'+width+'-'+theme+'-map.png'});
     await selected.click();await assertSelected(p,row,before,body);
     if(index===2)await p.screenshot({path:out+'/'+engine+'-'+width+'-'+theme+'-appearance.png'});
    }
    // Capture the original row callback and call it immediately after a changed
    // request, before a DOM watcher can remove the old row.
    await prepare(p,'moon');await openCandidates(p);
    if(!await p.locator('#additionalCandidateSearch details').evaluate(d=>d.open))await p.locator('#additionalCandidateSearch details > summary').click();
    await p.locator('#candidateSearchMode').selectOption('instant');await search(p);
    const instant=await state(p);await p.evaluate(()=>{const click=document.querySelector('#candidateUnifiedResults .list-item').onclick;SkyMapUI.setTime(SkyMapUI.selectionState().at+60000);click();});
    assert.equal((await state(p)).at,instant.at+60000);assert.equal(await p.evaluate(()=>document.getElementById('skyMapView').dataset.exploreStage),'search','old instant candidate refused');
    await p.waitForFunction(()=>{const button=document.getElementById('candidateSearchAction');return button?.dataset.state==='idle'&&!button.disabled;});await search(p);
    // 2026-11-11: with one target overlapped as a whole the lens does not decide the places (ユーザー「天体と重なる所だけ確認」),
    // so a lens change keeps the list and its rows stay current.
    await p.evaluate(()=>SkyMapUI.setAlignment('__whole','center','overlap'));
    await p.waitForFunction(()=>{const b=document.getElementById('candidateSearchAction');return b?.dataset.state==='idle'&&!b.disabled;});await search(p);
    const lensRows=await p.evaluate(()=>AstroNotesCandidatePicker.visibleRows().length);await p.evaluate(()=>{aimLens.on=true;aimLens.mode='manual';aimLens.focal=(aimLens.focal||200)+100;document.dispatchEvent(new Event('astronotes-composition-change'));});await p.waitForTimeout(300);assert.equal(await p.evaluate(()=>AstroNotesCandidatePicker.visibleRows().length),lensRows,'a lens change keeps single-target rows');
    await p.waitForFunction(()=>{const button=document.getElementById('candidateSearchAction');return button?.dataset.state==='idle'&&!button.disabled;});await search(p);
    const rangeBefore=await state(p);await p.evaluate(()=>{const click=document.querySelector('#candidateUnifiedResults .list-item').onclick,mode=document.getElementById('candidateSearchMode');mode.value='window';mode.onchange();click();});assert.deepEqual(await state(p),rangeBefore,'changed time range candidate refused');
    await search(p);await p.evaluate(()=>{const mode=document.getElementById('candidateSearchMode');mode.value='day';mode.onchange();});
    const townShard=/\/candidate-towns\/13122\.json(?:\?|$)/;
    let releaseTown;const heldTown=new Promise(resolve=>{releaseTown=resolve;});
    await context.route(townShard,async route=>{await heldTown;await route.continue().catch(()=>{});},{times:1});
    await p.evaluate(()=>{candidateFixture.riverRows=true;SkyMapUI.setTime(Date.parse('2026-11-06T12:00:00+09:00'));});
    await openCandidates(p);
    // Riverbanks remain in standard scope, including their asynchronous town labels.
    assert.equal(await p.locator('#candidateIncludeRoads').isChecked(),false,'riverbank candidates do not require road opt-in');
    const namedRiver='新中川沿いの歩道',town='東京都葛飾区奥戸九丁目',riverCoords='35.73522, 139.87078',unnamedCoords='35.59000, 140.02000';
    const rows=p.locator('#candidateUnifiedResults .list-item');
    const named=rows.filter({hasText:namedRiver}),unnamed=rows.filter({hasText:'河川沿いの歩道'});
    const candidateByName=name=>p.evaluate(name=>structuredClone(AstroNotesCandidatePicker.visibleRows().find(r=>r.place.name===name)),name);
    let labelledBefore;
    const focused=p.locator('#candidateUnifiedResults [data-map-candidate-selected]');
    try{
     await Promise.all([p.waitForRequest(townShard),search(p,2)]);
     assert.equal(await named.locator('[data-candidate-address]').innerText(),riverCoords,'search completes and lists the river while its town file waits');
     assert.equal(await unnamed.locator('[data-candidate-address]').innerText(),unnamedCoords);
     labelledBefore=await state(p);
     await fitCandidatePins(p,2);
     await focusCandidatePin(p,await candidateByName(namedRiver));
     assert.equal(await focused.locator('[data-candidate-address]').innerText(),riverCoords,'the river pin focuses the row while the town file waits');
    }finally{releaseTown();}
    await focused.getByText(town,{exact:true}).waitFor();
    assert.equal(await named.locator('[data-candidate-address]').innerText(),town);
    assert.equal(await unnamed.locator('[data-candidate-address]').innerText(),unnamedCoords);
    const labelledMetrics=await p.locator('#candidateListControls').evaluate(n=>({overflow:n.scrollWidth>n.clientWidth+1,bodyOverflow:document.documentElement.scrollWidth>innerWidth+1}));assert(!labelledMetrics.overflow&&!labelledMetrics.bodyOverflow,JSON.stringify(labelledMetrics));
    const labelled=await candidateByName(namedRiver);
    await focusCandidatePin(p,await candidateByName('河川沿いの歩道'));
    assert.equal(await focused.locator('[data-candidate-address]').innerText(),unnamedCoords);
    assert.deepEqual(await state(p),labelledBefore,'river labels and pin focus do not change the selected place or time');
    await focusCandidatePin(p,labelled);
    await focused.click();await assertSelected(p,labelled,before,'moon');
    assert.equal(await saved(p),before);assert.equal(writes,0,'no API writes');assert.deepEqual(errors,[]);
    results.push({engine,width,theme,bodies:bodies.length,arbitraryTarget:true,distinctHeights:[2,4,101.5],exactMapToAppearance:true,placeKindsOnly:true,staleInstantRangeRefusedLensKept:true,riverAndTownLabels:true,personalDataUnchanged:true,writes,externalBlocked:external});console.log(engine,width,theme,'passed');
   }catch(e){await p.screenshot({path:out+'/'+engine+'-'+width+'-'+theme+'-failure.png'}).catch(()=>{});console.error('fixture failure',engine,width,theme,await p.evaluate(()=>({status:document.querySelector('#candidateSearchFeedback [role=status]')?.textContent,rows:globalThis.AstroNotesCandidatePicker?.visibleRows?.().length,fixture:globalThis.candidateFixture,selection:typeof SkyMapUI==='object'?SkyMapUI.selectionState():null})).catch(()=>null));throw e;}
   finally{releaseLabels();await context.close();}
  }}finally{await browser.close();}
 }
 fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
