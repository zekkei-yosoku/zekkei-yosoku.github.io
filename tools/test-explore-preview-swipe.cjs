// Real runtime listeners. Chromium uses trusted CDP touch input; WebKit uses
// DOM touch events because Playwright exposes no WebKit touch-drag API.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture}=require('./candidate-date-fixture.cjs');
const base=process.env.PREVIEW_SWIPE_BASE||'http://127.0.0.1:8992/trial/index.html';
const out=process.env.PREVIEW_SWIPE_OUT||'/tmp/astronotes-preview-swipe';
const values=(name,fallback)=>(process.env[name]||fallback).split(',');
const grants=['records','tower','diamond','pearl','skymap','multiscene'];
fs.mkdirSync(out,{recursive:true});
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const state=page=>page.evaluate(()=>({hash:location.hash,stage:document.getElementById('skyMapView').dataset.exploreStage,selection:SkyMapUI.selectionState(),history:history.state,scroll:document.scrollingElement.scrollTop,menu:!document.getElementById('toolsMenu').hidden&&document.getElementById('toolsMenu').classList.contains('on')}));
const saved=page=>page.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()}));
// Candidate opportunity is derived from the chosen result, not a search condition.
const conditions=selection=>{const {candidateOpportunity,...value}=selection;return value;};
async function readyPreview(page){await page.waitForFunction(()=>{const h=document.getElementById('aimLook'),s=SkyMapUI.selectionState(),scene=document.getElementById('exploreScenePanel');return scene&&!scene.hidden&&!scene.hasAttribute('data-loading')&&!h.hidden&&h._trialCompositionView&&Math.abs(h._lookAt-s.at)<1000;});}
async function boot(page){
 await page.goto(base+'#/almanac');await page.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof AstroNotesCandidatePicker==='object');
 await page.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>25;aimBuildingDays=async()=>[];navigationHistory.pushRoute('#/explore');});
 await page.waitForFunction(()=>!!SkyMapUI.workspaceHost());
 await page.evaluate(()=>{window.previewSwipeTrace=[];for(const type of ['pointerdown','pointercancel','touchstart','touchmove','touchend','touchcancel'])document.addEventListener(type,event=>{const item={type,target:event.target.id||event.target.tagName,x:event.touches?.[0]?.clientX??event.clientX,y:event.touches?.[0]?.clientY??event.clientY,touches:event.touches?.length,trusted:event.isTrusted,cancelable:event.cancelable};setTimeout(()=>previewSwipeTrace.push({...item,defaultPrevented:event.defaultPrevented,composition:AstroNotesTrialComposition.plan()}),0);},true);});
 await page.evaluate(()=>{SkyMapUI.setTarget('skytree');const input=document.getElementById('skyMapBody');input.value='moon';input.onchange();SkyMapUI.setTime(Date.parse('2026-11-05T03:58:31+09:00'));SkyMapUI.setObserver({name:'スワイプ検査地点',latitude:35.7119003406,longitude:139.8088988752,groundManualM:25,standAglM:1.5});window.swipeDateNodes=Object.fromEntries(['skyMapCalendarOpen','skyMapTimeline','skyMapRange','skyMapTime'].map(id=>[id,document.getElementById(id)]));});
}
async function touchDriver(page,engine){
 if(engine==='chrome'){
  const cdp=await page.context().newCDPSession(page);
  return {kind:'cdp-native-touch',async start(points){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points.map((p,id)=>({...p,id}))});},async move(points){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points.map((p,id)=>({...p,id}))});},async end(cancel=false){await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});}};
 }
 const send=async(type,points)=>page.evaluate(({type,points})=>{
  if(type==='touchstart')window.previewSwipeTouchTarget=document.elementFromPoint(points[0].x,points[0].y);
  const target=window.previewSwipeTouchTarget;if(!target)throw Error('Touch start needs a hit target');
  const touches=points.map((p,identifier)=>({identifier,target,clientX:p.x,clientY:p.y,pageX:p.x+scrollX,pageY:p.y+scrollY,screenX:p.x,screenY:p.y}));
  const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperties(event,{touches:{value:touches},targetTouches:{value:touches},changedTouches:{value:touches.length?touches:window.previewSwipeLastTouches||[]}});target.dispatchEvent(event);if(touches.length)window.previewSwipeLastTouches=touches;
 },{type,points});
 return {kind:'dom-touch-fixture',start:points=>send('touchstart',points),move:points=>send('touchmove',points),end:cancel=>send(cancel?'touchcancel':'touchend',[])};
}
async function swipe(page,driver,points,{cancel=false,delay=25}={}){await page.evaluate(()=>previewSwipeTrace=[]);await driver.start([points[0]]);for(const p of points.slice(1)){await page.waitForTimeout(delay);await driver.move([p]);}await driver.end(cancel);await page.waitForTimeout(160);await frames(page);}
async function edgePoints(page,{x=8,dx=152,dy=0,y}={}){if(y===undefined)y=await page.locator('#aimLook [data-look-canvas]').evaluate(node=>{const r=node.getBoundingClientRect();return Math.min(innerHeight-210,r.top+r.height*.4);});return [0,.25,.5,.75,1].map(t=>({x:x+dx*t,y:y+dy*t}));}
async function directReturn(page,driver,result,key='direct',editing=false){
 const before=await state(page);await page.locator('#exploreShowResult').click();await readyPreview(page);const preview=await state(page);
 if(editing)await page.locator('#trialCompositionToggle').click();const composition=await page.evaluate(()=>AstroNotesTrialComposition.plan());
 if(editing){result.outerEditingCancelled=[];for(const [name,dx,cancel]of [['tap',0,false],['short',12,false],['cancel',140,true]]){await swipe(page,driver,await edgePoints(page,{x:12,dx}),{cancel});assert.equal((await state(page)).stage,'preview',name+' does not return');assert.deepEqual(await page.evaluate(()=>AstroNotesTrialComposition.plan()),composition,name+' on the outside edge does not change the composition');assert.equal(await page.evaluate(()=>SkyMapUI.selectionState().at),preview.selection.at,name+' on the outside edge does not select a path time');result.outerEditingCancelled.push({name,trace:await page.evaluate(()=>previewSwipeTrace)});}}
 await swipe(page,driver,await edgePoints(page));const after=await state(page),trace=await page.evaluate(()=>previewSwipeTrace);result[key]={before,preview,after,trace};
 assert.equal(after.stage,'search','left-edge swipe returns from preview to search');assert.equal(after.hash,before.hash,'preview return stays on the Explore route');assert(!after.menu,'preview return does not open the drawer');assert.deepEqual(after.selection,before.selection,'direct preview returns to its original search conditions');assert.deepEqual(after.history,before.history,'preview return does not change route history');
 assert(trace.find(event=>event.type==='touchstart')?.defaultPrevented,'the outer 8px preview gesture prevents the native back gesture');
 assert.deepEqual(await page.evaluate(()=>AstroNotesTrialComposition.plan()),composition,'an outer-edge swipe does not change the composition');
 if(editing)for(const event of trace)assert.deepEqual(event.composition,composition,'pointerdown before touchstart must not select outside the canvas');
 assert(await page.evaluate(()=>Object.entries(swipeDateNodes).every(([id,node])=>node===document.getElementById(id))),'shared datetime nodes survive preview return');
}
async function expectPreview(page,before,label){const after=await state(page);assert.equal(after.stage,'preview',label+' stays in preview');assert.equal(after.hash,before.hash,label+' keeps the route');assert(!after.menu,label+' does not open the drawer');return after;}
async function negativeGestures(page,driver,result){
 await page.locator('#exploreShowResult').click();await readyPreview(page);const before=await state(page);result.negative=[];
 for(const [name,options,gesture]of [['short',{dx:20}],['slow-short',{dx:30},{delay:90}],['vertical',{dx:3,dy:90}],['reverse',{x:24,dx:-20}],['central',{x:80,dx:120}],['cancel',{}, {cancel:true}]]){
  await swipe(page,driver,await edgePoints(page,options),gesture);await expectPreview(page,before,name);result.negative.push({name,trace:await page.evaluate(()=>previewSwipeTrace)});
 }
 for(const secondFinger of [false,true]){
  const points=await edgePoints(page),a=points[0],b={x:a.x+18,y:a.y+35};await page.evaluate(()=>previewSwipeTrace=[]);await driver.start(secondFinger?[a]:[a,b]);if(secondFinger){await page.waitForTimeout(20);await driver.move([{x:a.x+20,y:a.y}]);await driver.start([{x:a.x+20,y:a.y},b]);}await driver.move([{x:a.x+110,y:a.y},{x:b.x+110,y:b.y}]);await driver.end();await page.waitForTimeout(160);await expectPreview(page,before,secondFinger?'added-finger':'two-fingers');result.negative.push({name:secondFinger?'added-finger':'two-fingers',trace:await page.evaluate(()=>previewSwipeTrace)});
 }
 const canvas=page.locator('#aimLook [data-look-canvas]'),rect=await canvas.boundingBox();
 await swipe(page,driver,await edgePoints(page,{x:rect.x+4,dx:120,y:rect.y+rect.height*.4}));await expectPreview(page,before,'inside-canvas');result.negative.push({name:'inside-canvas',trace:await page.evaluate(()=>previewSwipeTrace)});
 const timeline=page.locator('#skyMapTimeline'),track=page.locator('.sky-map-footer .preview-footer-track'),tr=await track.boundingBox();assert(tr,'shared timeline track exists');
 await swipe(page,driver,[{x:tr.x+8,y:tr.y+tr.height/2},{x:tr.x+70,y:tr.y+tr.height/2},{x:tr.x+140,y:tr.y+tr.height/2}]);await expectPreview(page,before,'datetime-track');result.negative.push({name:'datetime-track',trace:await page.evaluate(()=>previewSwipeTrace)});
 // A real mouse pointer drag exercises the scrolling timeline in both engines;
 // DOM touch events alone do not generate WebKit native scrolling.
 const at=await page.evaluate(()=>SkyMapUI.selectionState().at),box=await timeline.boundingBox();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.35,box.y+box.height*.5,{steps:8});await page.mouse.up();await page.waitForFunction(at=>SkyMapUI.selectionState().at!==at,at);await expectPreview(page,before,'datetime-drag');result.datetimeDragWorks=true;
 await page.evaluate(at=>SkyMapUI.setTime(at),before.selection.at);await readyPreview(page);
 const offset=await page.evaluate(()=>[...(document.getElementById('aimLook')._lensOffset||[0,0])]);await page.mouse.move(rect.x+rect.width*.45,rect.y+rect.height*.55);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.45+70,rect.y+rect.height*.55,{steps:8});await page.mouse.up();await frames(page);const moved=await page.evaluate(()=>document.getElementById('aimLook')._lensOffset||[0,0]);assert(Math.abs(moved[0]-offset[0])>.001,'scene pointer drag still pans the drawing');await expectPreview(page,before,'scene-drag');await page.locator('.trial-scene-center').click();result.sceneDragWorks=true;
 await page.locator('#trialRecordSave').click();const dialog=page.locator('#trialRecordSaveSheet');await dialog.waitFor({state:'visible'});await swipe(page,driver,await edgePoints(page));assert(await dialog.isVisible(),'an open modal keeps ownership of edge input');await expectPreview(page,before,'modal');await dialog.locator('[data-record-save-close]').click();await dialog.waitFor({state:'hidden'});result.modalPriority=true;
 await page.locator('#toolsButton').click();await page.waitForFunction(()=>document.getElementById('toolsMenu').classList.contains('on'));await swipe(page,driver,[{x:180,y:180},{x:120,y:180},{x:60,y:180},{x:16,y:180}]);await page.waitForFunction(()=>document.getElementById('toolsMenu').hidden);await expectPreview(page,before,'drawer-close');result.drawerPriority=true;
 await swipe(page,driver,await edgePoints(page));assert.equal((await state(page)).stage,'search');
}
async function candidateReturn(page,driver,result){
 await page.evaluate(()=>SkyMapUI.setTime(Date.parse('2026-11-16T03:58:31+09:00')));await page.locator('#candidateSearchAction').click();await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===2&&document.getElementById('candidateSearchAction').dataset.state==='idle');
 await page.locator('#candidateKindFilter').selectOption('park');await page.locator('[data-candidate-sort=name]').click();await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===1);const row=page.locator('#candidateUnifiedResults .list-item:visible').first();await row.scrollIntoViewIfNeeded();
 const before=await state(page),loads=await page.evaluate(()=>dateFixture.loads.length),rows=await page.evaluate(()=>AstroNotesCandidatePicker.visibleRows().map(row=>row.id));await row.click();await readyPreview(page);
 await page.locator('#skyMapTimeMore').click();await page.locator('#skyMapLater').click();await page.locator('.sky-map-time-dialog [data-close]').click();await swipe(page,driver,await edgePoints(page));await page.waitForFunction(()=>document.getElementById('skyMapView').dataset.exploreStage==='search');await page.waitForFunction(scroll=>Math.abs(document.scrollingElement.scrollTop-scroll)<2,before.scroll);
 const after=await state(page);assert.deepEqual(conditions(after.selection),conditions(before.selection),'swipe restores original candidate-search conditions and datetime');assert.deepEqual(after.history,before.history);assert(!after.menu);assert.equal(await page.locator('#candidateKindFilter').inputValue(),'park');assert.equal(await page.locator('[data-candidate-sort=name]').getAttribute('aria-pressed'),'true');assert.equal(await page.evaluate(()=>dateFixture.loads.length),loads,'swipe return uses cached candidates');assert.deepEqual(await page.evaluate(()=>AstroNotesCandidatePicker.visibleRows().map(row=>row.id)),rows);assert(await page.evaluate(()=>Object.entries(swipeDateNodes).every(([id,node])=>node===document.getElementById(id))));result.candidate={before,after,loads,restoredFilterSortScroll:true,datetimeNodesRetained:true};
}
async function searchDrawer(page,driver,result){await page.evaluate(()=>window.scrollTo(0,0));await swipe(page,driver,await edgePoints(page,{y:140,dx:230}));await page.waitForFunction(()=>!document.getElementById('toolsMenu').hidden&&document.getElementById('toolsMenu').classList.contains('on'));assert.equal((await state(page)).stage,'search');await page.locator('#toolsClose').click();await page.waitForFunction(()=>document.getElementById('toolsMenu').hidden);result.searchDrawerPreserved=true;}
async function staleGestures(page,driver,result){
 result.stale=[];
 for(const kind of ['return-reenter','generation','owner']){
  await page.locator('#exploreShowResult').click();await readyPreview(page);const points=await edgePoints(page);await page.evaluate(()=>previewSwipeTrace=[]);await driver.start([points[0]]);await page.waitForTimeout(30);await driver.move([points[1]]);
  if(kind==='return-reenter'){await page.evaluate(()=>document.getElementById('exploreBackToCandidates').click());await page.waitForFunction(()=>document.getElementById('skyMapView').dataset.exploreStage==='search');await page.evaluate(()=>document.getElementById('exploreShowResult').click());await readyPreview(page);}
  else await page.evaluate(kind=>{if(kind==='generation')accessState.generation++;else auth.loginId='stale-swipe-owner';},kind);
  await driver.move([points.at(-1)]);await driver.end();await page.waitForTimeout(180);await frames(page);const after=await state(page);assert.equal(after.stage,'preview',kind+' invalidates an already-started preview return');assert.equal(after.hash,'#/explore');assert(!after.menu);result.stale.push({kind,after,trace:await page.evaluate(()=>previewSwipeTrace)});
  if(kind!=='return-reenter')await page.evaluate(()=>TrialExplore.render());else await page.locator('#exploreBackToCandidates').click();await page.waitForFunction(()=>document.getElementById('skyMapView').dataset.exploreStage==='search');
 }
}
(async()=>{
 const results=[];
 for(const [engine,type]of [['chrome',chromium],['webkit',webkit]].filter(([name])=>values('PREVIEW_SWIPE_ENGINE','chrome,webkit').includes(name))){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{for(const width of values('PREVIEW_SWIPE_WIDTH','320,390').map(Number)){
   const context=await browser.newContext({viewport:{width,height:844},colorScheme:engine==='chrome'?'light':'dark',hasTouch:true,isMobile:true,locale:'ja-JP',timezoneId:'Asia/Tokyo',reducedMotion:'reduce'});let writes=0;const errors=[],result={engine,width,base};
   await context.addInitScript(fixture,grants);if(process.env.PREVIEW_SWIPE_STANDALONE==='1')await context.addInitScript(()=>Object.defineProperty(navigator,'standalone',{configurable:true,get:()=>true}));await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===new URL(base).origin)return route.continue();if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(route.request().method()))writes++;return route.fulfill({json:{allowed:true,tool:'skymap',loginId:'date-test',tools:grants,favorites:[],sightings:[],records:[],rev:1}});}return route.abort();});
   const page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));const name=engine+'-'+width;
   try{
    await boot(page);result.noHistory=await page.evaluate(()=>navigationHistory.noHistory);if(process.env.PREVIEW_SWIPE_STANDALONE==='1')assert.equal(result.noHistory,true,'standalone fixture exercises the existing no-history owner');result.version=await page.locator('meta[name=app-version]').getAttribute('content');const personal=await saved(page),driver=await touchDriver(page,engine);result.input=driver.kind;
    await directReturn(page,driver,result);
    if(process.env.PREVIEW_SWIPE_CASE!=='direct'){
     await negativeGestures(page,driver,result);await candidateReturn(page,driver,result);
     await directReturn(page,driver,result,'repeatOne');await directReturn(page,driver,result,'repeatTwo');await directReturn(page,driver,result,'editingOuterEdge',true);
     await searchDrawer(page,driver,result);await staleGestures(page,driver,result);
    }
    assert.equal(await saved(page),personal);assert.equal(writes,0);assert.deepEqual(errors,[]);Object.assign(result,{passed:true,writes,errors});results.push(result);await page.screenshot({path:out+'/'+name+'-final.png'});fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS',name);
   }catch(error){Object.assign(result,{passed:false,writes,errors,error:String(error)});fs.writeFileSync(out+'/'+name+'-failure.json',JSON.stringify(result,null,2));await page.screenshot({path:out+'/'+name+'-failure.png',timeout:5000}).catch(()=>{});throw error;}finally{await context.close();}
  }}finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exit(1);});
