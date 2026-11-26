require('./no-open-meteo.cjs');
require('./explore-open-conditions.cjs'); // 2026-11-26 探すは地図の段で始まる。検索の段を確かめるため入口で撮影条件を開く
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture}=require('./candidate-date-fixture.cjs');
const base=process.env.POSITION_NAV_BASE||'http://127.0.0.1:8998/trial/',out=process.env.POSITION_NAV_OUT||'/tmp/astro-position-navigation';fs.mkdirSync(out,{recursive:true});
const grants=['records','tower','diamond','pearl','skymap','multiscene'];
const ready=page=>page.waitForFunction(()=>{const h=document.getElementById('aimLook');return !h.hidden&&Math.abs(h._lookAt-SkyMapUI.selectionState().at)<1000;});
(async()=>{const results=[];for(const [engine,type] of [['chrome',chromium],['webkit',webkit]].filter(([n])=>(process.env.POSITION_NAV_ENGINES||'chrome,webkit').split(',').includes(n))){
 const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
 try{for(const width of (process.env.POSITION_NAV_WIDTHS||'320,390').split(',').map(Number)){
  const context=await browser.newContext({viewport:{width,height:844},locale:'ja-JP',timezoneId:'Asia/Tokyo',colorScheme:engine==='chrome'?'light':'dark',reducedMotion:'reduce',hasTouch:process.env.POSITION_NAV_TOUCH==='1'});let writes=0;
  await context.addInitScript(fixture,grants);await context.addInitScript(()=>dateFixture.positionDemo=true);
  await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(base).origin)return r.continue();if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(r.request().method()))writes++;return r.fulfill({json:{allowed:true,tool:'skymap',loginId:'date-test',tools:grants,favorites:[],sightings:[],records:[],rev:1}});}return r.abort();});
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(base+'#/explore');await page.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof AstroNotesCandidatePicker==='object');
   await page.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>25;aimBuildingDays=async()=>[];navigationHistory.pushRoute('#/explore');SkyMapUI.setTarget('skytree');const b=document.getElementById('skyMapBody');b.value='moon';b.onchange();SkyMapUI.setTime(Date.parse('2026-11-19T09:59:00+09:00'));});
   const stored=await page.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),plans:schedule().list()}));
   await page.locator('#exploreDiscovery-new').click();await page.locator('#candidateSearchAction').click();
   const rows=page.locator('#candidateUnifiedResults>.list-item:visible');await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===1&&document.getElementById('candidateSearchAction').dataset.state==='idle');
   assert.equal(await rows.count(),1);const loads=await page.evaluate(()=>dateFixture.loads.length);
   await rows.first().click();await ready(page);await page.locator('#exploreCandidatePositions').waitFor({state:'visible'});
   const positions=page.locator('#exploreCandidatePosition'),shortcuts=positions.locator('optgroup[label="部位から選ぶ"] option');assert.equal(await shortcuts.count(),3);
   const options=await shortcuts.evaluateAll(ns=>ns.map(n=>({value:n.value,text:n.textContent})));assert(options.some(o=>o.text.includes('先端'))&&options.some(o=>o.text.includes('天望デッキ')));
   const original=await page.evaluate(()=>({s:SkyMapUI.selectionState(),bar:window.positionBar=document.getElementById('skyMapTimeline')}));
   const deck=options.find(o=>o.text.includes('天望デッキ'));await positions.selectOption(deck.value);await ready(page);
   const changed=await page.evaluate(()=>{const s=SkyMapUI.selectionState();return {latitude:s.observer.latitude,at:s.at,eye:aimObserverAt(s.observer,SkyMapUI.workspaceHost().session.ground).eyeM,stage:document.getElementById('skyMapView').dataset.exploreStage,bar:positionBar===document.getElementById('skyMapTimeline'),loads:dateFixture.loads.length};});
   assert.equal(changed.latitude,35.6905);assert.equal(changed.eye,4);assert.equal(changed.at,AstroTime('2026-11-19T12:20:00+09:00'));assert.equal(changed.stage,'preview');assert(changed.bar);assert.equal(changed.loads,loads);
   await page.getByRole('button',{name:'前の撮影位置',exact:true}).click();await ready(page);assert(Math.abs(await page.evaluate(()=>SkyMapUI.selectionState().observer.latitude)-35.6904)<1e-10);
   await page.getByRole('button',{name:'次の撮影位置',exact:true}).click();await ready(page);assert.equal(await positions.inputValue(),deck.value);
   const fineMovement=await require('./check-observer-movement.cjs')(page,{touch:process.env.POSITION_NAV_TOUCH==='1',screenshot:out+'/'+engine+'-'+width+'-move-map.png'});
   await page.locator('#exploreConditions > summary .explore-condition-edit').click();await page.waitForFunction(()=>document.getElementById('exploreConditions').open);
   assert.equal(await page.locator('#skyMapView').getAttribute('data-explore-stage'),'preview');assert(await page.locator('#exploreScenePanel').isVisible());assert(await page.locator('#exploreFindPlaces').isVisible());assert((await page.locator('#exploreFindPlaces').boundingBox()).height>=44);assert.equal(await page.evaluate(()=>dateFixture.loads.length),loads);
   await page.screenshot({path:out+'/'+engine+'-'+width+'-conditions.png',fullPage:true});
   await page.locator('#exploreShowResult').click();await ready(page);assert.equal(await page.locator('#exploreConditions').getAttribute('open'),null);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/'+engine+'-'+width+'-navigation.png',fullPage:true});
   await page.locator('#exploreBackToCandidates').click();await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===1);assert.equal(await rows.count(),1);assert.equal(await page.evaluate(()=>dateFixture.loads.length),loads);
   assert.equal(await page.evaluate(()=>SkyMapUI.selectionState().at),original.s.at===changed.at?original.s.at:AstroTime('2026-11-19T09:59:00+09:00'));
   await rows.first().click();await ready(page);await page.locator('#exploreCandidatePositions').waitFor({state:'visible'});
   await page.evaluate(()=>SkyMapUI.setTime(SkyMapUI.selectionState().at+2*86400000));await page.waitForFunction(()=>document.getElementById('exploreCandidatePositions').hidden);
   await page.locator('#exploreBackToCandidates').click();await rows.first().click();await ready(page);await page.locator('#exploreCandidatePositions').waitFor({state:'visible'});
   await page.evaluate(()=>SkyMapUI.setAlignment('tip','center','overlap'));await page.waitForFunction(()=>document.getElementById('exploreCandidatePositions').hidden);
   const before=await page.evaluate(()=>SkyMapUI.selectionState());await page.evaluate(()=>document.getElementById('exploreCandidatePosition').dispatchEvent(new Event('change')));assert.deepEqual(await page.evaluate(()=>SkyMapUI.selectionState()),before,'a stale hidden position control cannot execute');
   assert.equal(await page.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),plans:schedule().list()})),stored);assert.equal(writes,0);assert.deepEqual(errors,[]);
   results.push({engine,width,version:await page.locator('meta[name=app-version]').getAttribute('content'),fineMovement,memberCount:3,listCount:1,partShortcuts:3,exactPositionTimeHeight:true,previewRetained:true,barRetained:true,returnReuses:true,staleConditionRejected:true,writes});fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(engine,width,'preview positions passed');
  }catch(e){await page.screenshot({path:out+'/'+engine+'-'+width+'-failure.png',fullPage:true}).catch(()=>{});console.error(errors);throw e;}finally{await context.close();}
 }}finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exit(1);});
function AstroTime(value){return Date.parse(value);}
