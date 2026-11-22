// Synthetic read-only scene lifecycle. Real terrain/profile math, fixed heights;
// all external requests are intercepted and no surveyed visibility is asserted.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.PREVIEW_TERRAIN_BASE||'http://127.0.0.1:8992/trial/';
const out=process.env.PREVIEW_TERRAIN_OUT||'/tmp/astronotes-preview-terrain-lifecycle';
const grants=['records','tower','diamond','pearl','skymap','multiscene'];
const at=Date.parse('2026-11-25T16:52:07+09:00');
const observer={latitude:35.58386,longitude:139.56853,elevation:87.2,eyeHeightAGL:1.5,standAglM:1.5,name:'合成読取・地形寿命の確認地点'};
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function visible(page){await page.waitForFunction(at=>{const h=document.getElementById('aimLook');return h.getClientRects().length&&h._uiTime&&h._lookAt===at;},at);await settle(page);}
async function reenter(page){await page.evaluate(()=>location.hash='#/explore');await page.locator('#exploreShowResult').click();}
async function jobAfter(page,work){const before=await page.evaluate(()=>terrainFixture.jobs.length);await work();await page.waitForFunction(before=>terrainFixture.jobs.length>before,before);return before;}
const inspect=page=>page.evaluate(()=>{const f=terrainFixture,h=document.getElementById('aimLook');return {render:f.render,jobs:f.jobs.map(({release,...r})=>r),angles:f.angles,seq:h._lookSeq,at:h._lookAt,refresh:h._lookNeedsRefresh,rects:h.getClientRects().length,active:TrialExplore.active(),cache:{ridge:aimRidgeCache.size,front:aimFrontCache.size,beyond:aimBeyondCache.size}};});
const release=page=>page.evaluate(()=>{for(const j of terrainFixture.jobs)j.release?.();});
(async()=>{
 fs.mkdirSync(out,{recursive:true});const results=[];
 for(const [engine,type] of [['chrome',chromium],['webkit',webkit]].filter(([e])=>(process.env.PREVIEW_TERRAIN_ENGINES||'chrome,webkit').split(',').includes(e))){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,locale:'ja-JP',timezoneId:'Asia/Tokyo',reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];let writes=0,externalBlocked=0;page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(tools=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-ui',loginId:'terrain-lifecycle',tools})),grants);
  await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(base).origin)return r.continue();
   if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(r.request().method()))writes++;return r.fulfill({json:{allowed:true,tool:'skymap',loginId:'terrain-lifecycle',tools:grants,favorites:[],sightings:[],records:[],rev:1}});}
   externalBlocked++;return r.abort();});
  const rows=[];
  try{
   await page.goto(base+'index.html#/explore');
   await page.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof aimTargetList==='function'&&AstroNotesAssets.modelsReady());
   await page.evaluate(async({observer,at})=>{
    await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>observer.elevation;aimBuildingDays=async()=>[];
    aimAirSettings.mode='standard';AstroNotesAtmosphere.configure('standard',aimAirSettings);
    AstroNotesCandidatePicker.hiddenView=async()=>({read:true,note:null});
    AstroNotesCandidatePicker.skylineView=async(_o,_t,az)=>az.map(()=>({angle:-Infinity,complete:true}));
    const f=window.terrainFixture={render:0,jobs:[],angles:0,hold:false,documentHidden:false};
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>f.documentHidden});
    const render=aimLookRender;aimLookRender=(...a)=>{f.render++;return render(...a);};
    const angle=AstroNotesTerrain.prepareRidgeElevation;
    AstroNotesTerrain.prepareRidgeElevation=(...a)=>{const fn=angle(...a);return h=>{f.angles++;return fn(h);};};
    const heights=async(points,options)=>{const row={points:points.length,seq:document.getElementById('aimLook')._lookSeq,complete:false};f.jobs.push(row);
     if(f.hold)await new Promise(r=>row.release=()=>{row.release=null;r();});row.complete=true;return points.map(()=>100);};
    AstroNotesTerrain.elevations=heights;AstroNotesTerrain.tileElevations=heights;
    SkyMapUI.workspaceHost().restoreTarget({target:structuredClone(aimTargetList().find(t=>t.id==='skytree')),custom:false});
    SkyMapUI.workspaceHost().restoreObserver(structuredClone(observer));
    const body=document.getElementById('skyMapBody');body.value='moon';body.dispatchEvent(new Event('change',{bubbles:true}));SkyMapUI.setTime(at);
   },{observer,at});
   await page.locator('#exploreShowResult').click();await visible(page);await page.waitForTimeout(180);
   const initial=await inspect(page);rows.push({step:'initial',...initial});
   await page.evaluate(()=>location.hash='#/almanac');await page.waitForTimeout(100);const hidden=await inspect(page);
   await page.setViewportSize({width:420,height:844});await page.waitForTimeout(250);
   await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
   const resized=await inspect(page);assert.equal(resized.render,hidden.render,'hidden ancestors never trigger a resize render');assert.equal(resized.jobs.length,hidden.jobs.length);rows.push({step:'hidden-resize',...resized});
   await reenter(page);await visible(page);
   await page.evaluate(()=>{terrainFixture.hold=true;aimRidgeCache.clear();aimFrontCache.clear();aimBeyondCache.clear();});
   const baseline=await jobAfter(page,()=>page.evaluate(()=>{SkyMapUI.workspaceHost().restoreTarget({target:structuredClone(aimTargetList().find(t=>t.id==='fuji')),custom:false});TrialExplore.sync();}));
   for(const height of [11.5,21.5])await jobAfter(page,()=>page.evaluate(h=>SkyMapUI.setEyeHeight(h),height));
   const waiting=await inspect(page);assert.equal(waiting.jobs.length-baseline,3);assert(waiting.jobs.slice(baseline).every(j=>j.points===29161));
   await page.evaluate(()=>location.hash='#/almanac');await page.waitForTimeout(100);await release(page);await settle(page);
   const cancelled=await inspect(page);assert.equal(cancelled.angles,waiting.angles,'expired ridge jobs perform no angle reduction');assert.equal(cancelled.cache.ridge,0);rows.push({step:'three-heights-cancelled',...cancelled});
   await jobAfter(page,()=>reenter(page));await page.evaluate(()=>terrainFixture.hold=false);await release(page);await visible(page);
   await page.waitForFunction(()=>!document.querySelector('#aimLook [data-look-note]').textContent.includes('読み込んで'));
   const returned=await inspect(page);assert(returned.cache.ridge>0);assert.equal(returned.at,at);rows.push({step:'returned',...returned});
   // The browser visibility event is synthetic; it runs the real lifecycle hooks.
   await page.evaluate(()=>terrainFixture.hold=true);
   await jobAfter(page,()=>page.evaluate(()=>SkyMapUI.setEyeHeight(31.5)));const beforeBackground=await inspect(page);
   await page.evaluate(()=>{terrainFixture.documentHidden=true;document.dispatchEvent(new Event('visibilitychange'));});await release(page);await settle(page);
   const background=await inspect(page);assert.equal(background.angles,beforeBackground.angles);rows.push({step:'background-cancelled',...background});
   await jobAfter(page,()=>page.evaluate(()=>{terrainFixture.documentHidden=false;document.dispatchEvent(new Event('visibilitychange'));}));
   await page.evaluate(()=>terrainFixture.hold=false);await release(page);await visible(page);
   rows.push({step:'background-returned',...await inspect(page)});
   // Legacy direct URL uses a separate resume handler. Isolate its scene from day discovery.
   await page.evaluate(()=>{aimShootingView=async()=>null;aim.matchMode='limb';auth.tools=['tower','diamond','pearl'];location.hash='#/aim';});
   await page.waitForFunction(()=>!document.getElementById('aimView').hidden&&!TrialExplore.ownsScene());await page.waitForTimeout(250);
   await page.evaluate(()=>{terrainFixture.hold=true;aimRidgeCache.clear();});
   await jobAfter(page,()=>page.evaluate(at=>{aim.target=aimTargetList().find(t=>t.id==='fuji');return aimLookRender(document.getElementById('aimLook'),{obs:{latitude:35.58386,longitude:139.56853,elevation:87.2},eyeM:41.5,at});},at));
   const legacyWaiting=await inspect(page);
   await page.evaluate(()=>{terrainFixture.documentHidden=true;document.dispatchEvent(new Event('visibilitychange'));});await release(page);await settle(page);
   const legacyHidden=await inspect(page);assert.equal(legacyHidden.angles,legacyWaiting.angles);assert.equal(legacyHidden.refresh,true);
   await jobAfter(page,()=>page.evaluate(()=>{terrainFixture.documentHidden=false;document.dispatchEvent(new Event('visibilitychange'));}));
   await page.evaluate(()=>terrainFixture.hold=false);await release(page);await visible(page);
   const legacyReturned=await inspect(page);assert.equal(legacyReturned.at,at);assert.equal(legacyReturned.refresh,false);rows.push({step:'legacy-returned',...legacyReturned});
   const completeRenders=legacyReturned.render;
   await page.evaluate(()=>{terrainFixture.documentHidden=true;document.dispatchEvent(new Event('visibilitychange'));terrainFixture.documentHidden=false;document.dispatchEvent(new Event('visibilitychange'));});await settle(page);
   assert.equal((await inspect(page)).render,completeRenders,'completed legacy view is retained on return');
   await page.evaluate(at=>document.getElementById('aimLook')._uiTime.set(at+60000),at);
   assert.equal((await inspect(page)).at,at+60000,'retained legacy time control still works after return');
   assert.deepEqual(errors,[]);assert.equal(writes,0);
   results.push({engine,passed:true,rows,writes,externalBlocked});fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS',engine,'preview terrain lifecycle');
  }catch(e){fs.writeFileSync(out+'/'+engine+'-failure.json',JSON.stringify({error:String(e),rows,current:await inspect(page).catch(()=>null),errors,writes},null,2));throw e;}
  finally{await context.close();await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
