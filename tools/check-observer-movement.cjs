const assert=require('node:assert/strict');
module.exports=async function checkObserverMovement(page,{screenshot}={}){
 const ready=()=>page.waitForFunction(()=>{const s=SkyMapUI.selectionState(),h=document.getElementById('aimLook');return !h.hidden&&Math.abs(h._lookAt-s.at)<1000&&Math.abs(h._lookSpec?.obs.latitude-s.observer.latitude)<1e-10;});
 const move=page.locator('#exploreObserverMove'),controls=page.locator('#exploreObserverMoveControls'),canvas=page.locator('#exploreObserverMoveCanvas'),apply=page.locator('#exploreObserverMoveApply');
 const open=async()=>{if(await move.getAttribute('open')===null)await move.locator('summary').click();await controls.waitFor({state:'visible'});await page.waitForFunction(()=>document.getElementById('exploreObserverMoveCanvas').width>0&&document.getElementById('exploreObserverMoveCoordinate').textContent.includes(','));};
 const drag=async(dx=45,dy=10)=>{await canvas.scrollIntoViewIfNeeded();const b=await canvas.boundingBox(),x=b.x+b.width*.5,y=b.y+b.height*.5;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:8});await page.mouse.up();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForFunction(()=>!document.getElementById('exploreObserverMoveApply').disabled);};
 const coordinate=()=>page.locator('#exploreObserverMoveCoordinate').innerText();
 await page.evaluate(()=>{window.observerMoveFixture={ground:AstroNotesTerrain.groundElevation,apply:SkyMapUI.moveObserver,select:SkyMapUI.selectCandidate,guides:AstroNotesAlign.observerGuides,guideCalls:0,calls:[],applies:0,mode:'ok',holds:[]};AstroNotesTerrain.groundElevation=async(latitude,longitude)=>{const f=observerMoveFixture;f.calls.push({latitude,longitude});if(f.mode==='hold')return new Promise(resolve=>f.holds.push(resolve));return f.mode==='fail'?NaN:40;};SkyMapUI.moveObserver=(...args)=>{observerMoveFixture.applies++;return observerMoveFixture.apply(...args);};AstroNotesAlign.observerGuides=(...args)=>{observerMoveFixture.guideCalls++;return observerMoveFixture.guides(...args);};});
 try{
  await page.evaluate(()=>SkyMapUI.setTime(Date.parse('2026-11-19T14:27:00+09:00')));await ready();
  await open();assert((await move.locator('summary').innerText()).includes('地図'));
  const guides=page.locator('#exploreObserverGuides button');assert.equal(await guides.count(),3);assert((await page.locator('#exploreObserverGuideNote').innerText()).includes('14:27'));
  const hiddenWhileScrubbing=await page.evaluate(()=>{SkyMapUI.setTime(SkyMapUI.selectionState().at+60000);TrialExplore.paintScrubTime();return document.getElementById('exploreObserverGuides').children.length;});assert.equal(hiddenWhileScrubbing,0,'scrubbing cannot show old-time guides');
  await page.evaluate(()=>TrialExplore.sync());await page.waitForFunction(()=>document.getElementById('exploreObserverGuideNote').textContent.includes('14:28'));assert.equal(await guides.count(),3);
  await page.evaluate(()=>{observerMoveFixture.liveGuides=AstroNotesAlign.observerGuides;AstroNotesAlign.observerGuides=()=>{throw Error('synthetic guide failure');};SkyMapUI.setTime(SkyMapUI.selectionState().at+60000);});
  await page.waitForFunction(()=>document.getElementById('exploreObserverGuideNote').textContent.includes('計算できませんでした'));assert.equal(await guides.count(),0);
  await page.locator('#exploreObserverMoveDone').click();await page.evaluate(()=>{AstroNotesAlign.observerGuides=observerMoveFixture.liveGuides;SkyMapUI.setTime(Date.parse('2026-11-19T14:27:00+09:00'));});await ready();await open();assert.equal(await guides.count(),3,'an exception is not cached as no guide');
  if(screenshot)await page.screenshot({path:screenshot.replace('.png','-guides.png')});
  await guides.filter({hasText:'先端'}).click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const guidePoint=await guides.filter({hasText:'先端'}).evaluate(b=>Number(b.dataset.latitude).toFixed(6)+', '+Number(b.dataset.longitude).toFixed(6));assert.equal(await coordinate(),guidePoint);
  const layout=await controls.evaluate(n=>({buttons:[...n.querySelectorAll('button')].filter(b=>b.getClientRects().length).map(b=>b.getBoundingClientRect().height),overflow:document.documentElement.scrollWidth>innerWidth+1}));assert(!layout.overflow&&layout.buttons.every(h=>h>=44),JSON.stringify(layout));
  const original=await page.evaluate(()=>({s:SkyMapUI.selectionState(),bar:window.observerMoveBar=document.getElementById('skyMapTimeline'),canvas:window.observerMoveCanvas=document.querySelector('#aimLook [data-look-canvas]')}));
  const guideCalls=await page.evaluate(()=>observerMoveFixture.guideCalls);
  await drag();await drag(25,-10);
  if(page.context().browser().browserType().name()==='chromium'){
   const cdp=await page.context().newCDPSession(page),box=await canvas.boundingBox(),x=box.x+box.width*.5,y=box.y+box.height*.5,previous=await coordinate(),scroll=await page.evaluate(()=>scrollY);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
   for(let i=1;i<=4;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+i*2,y:y+i*10,id:1}]});await page.waitForTimeout(20);}
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
   await page.waitForFunction(text=>document.getElementById('exploreObserverMoveCoordinate').textContent!==text,previous);assert.equal(await page.evaluate(()=>scrollY),scroll,'one-finger movement pans this map rather than scrolling the page');
  }
  const destination=await coordinate();if(screenshot)await page.screenshot({path:screenshot});
  assert.equal(await page.evaluate(()=>observerMoveFixture.calls.length),0,'panning the map performs no elevation or preview search');
  assert.equal(await page.evaluate(()=>observerMoveFixture.guideCalls),guideCalls,'panning reuses guide calculations');
  assert.deepEqual(await page.evaluate(()=>SkyMapUI.selectionState()),original.s,'unconfirmed map movement does not change the view');
  await page.locator('#exploreObserverMoveMap>.sky-map-expand').click();
  await page.waitForFunction(()=>document.getElementById('exploreObserverMoveCard').parentElement.classList.contains('shared-map-footer'));
  const footerState=await page.evaluate(()=>{const n=document.querySelector('#skyMapView .sky-map-footer');return {display:getComputedStyle(n).display,parent:n.parentElement.id,wide:document.getElementById('skyMapView').classList.contains('explore-observer-map-wide')};});assert.equal(footerState.display,'none',JSON.stringify(footerState));
  assert(await apply.isVisible(),'the confirmation remains usable in the shared fullscreen map');
  await apply.click();await page.waitForFunction(()=>observerMoveFixture.applies===1);await ready();
  let state=await page.evaluate(()=>{const s=SkyMapUI.selectionState();return {s,calls:observerMoveFixture.calls.length,eye:aimObserverAt(s.observer,SkyMapUI.workspaceHost().session.ground).eyeM,bar:observerMoveBar===document.getElementById('skyMapTimeline'),canvas:observerMoveCanvas===document.querySelector('#aimLook [data-look-canvas]')};});
  assert(!(await page.locator('#exploreObserverMoveMap').getAttribute('class')).includes('sky-map-wide'),'applying returns from fullscreen to the view');assert.equal(state.calls,1,'the chosen point supplies its known elevation to the weather/preview cache too');assert.equal(state.s.at,original.s.at);assert.equal(state.s.observer.groundManualM,40);assert.equal(state.eye,4);assert(state.bar&&state.canvas);
  assert.equal(state.s.observer.latitude.toFixed(6)+', '+state.s.observer.longitude.toFixed(6),destination);assert.equal(await page.locator('#exploreCandidatePosition').inputValue(),'adjusted');assert.equal(await move.getAttribute('open'),null);
  await open();await page.locator('#exploreObserverMoveUndo').click();await ready();
  const restored=await page.evaluate(()=>SkyMapUI.selectionState());assert.equal(restored.observer.latitude,original.s.observer.latitude);assert.equal(restored.at,original.s.at);assert.deepEqual(restored.candidateOpportunity,original.s.candidateOpportunity);assert.equal(await page.evaluate(()=>observerMoveFixture.calls.length),1,'undo reuses the known origin elevation');
  await page.evaluate(()=>observerMoveFixture.mode='fail');await drag();await apply.click();await page.waitForFunction(()=>document.getElementById('exploreObserverMoveNote').textContent.includes('標高を確認できません'));
  assert.equal(await page.evaluate(()=>SkyMapUI.selectionState().observer.latitude),original.s.observer.latitude);
  await page.evaluate(()=>observerMoveFixture.mode='hold');await apply.click();await page.waitForFunction(()=>observerMoveFixture.holds.length===1);
  await drag(-30,15);await apply.click();await page.waitForFunction(()=>observerMoveFixture.holds.length===2);const latestPoint=await coordinate();
  await page.evaluate(()=>{SkyMapUI.setTime(SkyMapUI.selectionState().at+180000);observerMoveFixture.holds[1](80);});await page.waitForFunction(()=>observerMoveFixture.applies===2);await ready();
  const latest=await page.evaluate(()=>SkyMapUI.selectionState());assert.equal(latest.at,original.s.at+180000);assert.equal(latest.observer.groundManualM,80);assert.equal(latest.observer.latitude.toFixed(6)+', '+latest.observer.longitude.toFixed(6),latestPoint);
  await page.evaluate(()=>observerMoveFixture.holds[0](10));await page.waitForTimeout(150);assert.deepEqual(await page.evaluate(()=>SkyMapUI.selectionState()),latest,'late elevation cannot undo the latest position');
  const choice=page.locator('#exploreCandidatePosition'),deck=await choice.locator('optgroup[label="部位から選ぶ"] option').evaluateAll(ns=>ns.find(n=>n.textContent.includes('天望デッキ')).value);
  await page.evaluate(()=>SkyMapUI.selectCandidate=()=>false);await choice.selectOption(deck);await open();assert.equal(await page.locator('#exploreObserverMoveUndo').isEnabled(),true,'a rejected candidate switch keeps the fine-move origin');
  await page.evaluate(()=>SkyMapUI.selectCandidate=observerMoveFixture.select);await choice.selectOption(deck);await ready();assert.equal(await page.evaluate(()=>SkyMapUI.selectionState().observer.latitude),original.s.observer.latitude);
  assert.equal(await choice.locator('optgroup[label="すべての撮影位置"] option').count(),3,'map adjustment keeps the candidate group usable');
  await open();await page.evaluate(()=>observerMoveFixture.mode='hold');await drag();await apply.click();await page.waitForFunction(()=>observerMoveFixture.holds.length===3);
  await page.locator('#exploreBackToCandidates').click();await page.evaluate(()=>observerMoveFixture.holds[2](100));await page.waitForTimeout(150);assert.equal(await page.locator('#skyMapView').getAttribute('data-explore-stage'),'search');assert.equal(await page.evaluate(()=>SkyMapUI.selectionState().at),Date.parse('2026-11-19T09:59:00+09:00'));
  await page.locator('#candidateUnifiedResults>.list-item:visible').first().click();await ready();await choice.selectOption(deck);await ready();
  return {mapDrag:true,mapPanComputesNothing:true,confirmAppliesCenter:true,timePreserved:true,eyePreserved:true,groundUpdated:true,staleElevationRejected:true,unknownElevationRejected:true,undoReusedGround:true,failedSwitchKeepsOrigin:true,leavingCancels:true,candidatesRetained:true,canvasAndTimeBarRetained:true};
 }finally{await page.evaluate(()=>{AstroNotesTerrain.groundElevation=observerMoveFixture.ground;SkyMapUI.moveObserver=observerMoveFixture.apply;SkyMapUI.selectCandidate=observerMoveFixture.select;AstroNotesAlign.observerGuides=observerMoveFixture.guides;});}
};
