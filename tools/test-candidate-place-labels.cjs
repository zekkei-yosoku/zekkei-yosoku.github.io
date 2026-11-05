require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const base=process.env.LABEL_BASE||'http://127.0.0.1:8988/trial/index.html',out=process.env.LABEL_OUT||'../place-labels-ui',tools=['records','tower','diamond','pearl','skymap','multiscene'];
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const results=[];
 for(const [engine,type] of [['chrome',chromium],['webkit',webkit]].filter(([n])=>!process.env.LABEL_ENGINE||process.env.LABEL_ENGINE===n)){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{for(const scenario of (process.env.LABEL_SCENARIOS||'normal').split(',')){
   const context=await browser.newContext({viewport:{width:engine==='webkit'?320:390,height:844},colorScheme:engine==='webkit'?'dark':'light'}),releases=[];let writes=0,addressLoads=0,facilityLoads=0,externalNameRequests=0;
   await context.addInitScript(tools=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-labels',loginId:'labels-test',tools})),tools);
   await context.route(/(?:zekkei-api|localhost:8787)/,r=>{if(!['GET','OPTIONS'].includes(r.request().method()))writes++;return r.fulfill({status:200,json:{allowed:true,tool:'skymap',loginId:'labels-test',tools,favorites:[],sightings:[],records:[],rev:1}});});
   await context.route(/cyberjapandata.*\.png/,r=>r.abort());
   let heldResolve;const held=new Promise(r=>heldResolve=r);
   const addressPattern=/candidate-label-addresses\.json/,facilityPattern=/candidate-label-facilities\.json/;
   if(scenario==='failure-retry'){await context.route(addressPattern,r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));await context.route(facilityPattern,r=>r.abort());}
   if(['timeout-retry','cancel-stale','date-stale'].includes(scenario))await context.route(addressPattern,async r=>{await new Promise(release=>{releases.push(release);heldResolve();});try{await r.continue();}catch{}},{times:1});
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(90000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(addressPattern.test(r.url()))addressLoads++;if(facilityPattern.test(r.url()))facilityLoads++;if(/nominatim|overpass-api|geoshape\.ex/.test(r.url()))externalNameRequests++;});
   try{
    await page.goto(base+'#/explore');await page.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof AstroNotesCandidateLabels==='object');
    await page.evaluate(async()=>{await startupSessionReady;groundAt=async()=>30;aimBuildingDays=async()=>[];await AstroNotesAssets.ensureModels();navigationHistory.pushRoute('#/explore');SkyMapUI.setTarget('skytree');const body=document.getElementById('skyMapBody');body.value='moon';body.onchange();SkyMapUI.setTime(Date.parse('2026-11-04T12:00:00+09:00'));const original=AstroNotesCandidateLabels.enrich;window.labelChecks=[];AstroNotesCandidateLabels.enrich=(row,data)=>{const result=original(row,data),signature=x=>JSON.stringify([x.place.latitude,x.place.longitude,x.place.elevation,x.event.at,x.modelEvidence]);window.labelChecks.push({before:signature(row),after:signature(result),address:result.labels.address.status,facility:result.labels.facility.status});return result;};});
    const unchanged=await page.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()}));
    await page.locator('#skyMapChoose').click();await page.locator('#placeTab-candidates').click();const search=page.locator('#candidateSearchAction');
    assert.equal(addressLoads,0);assert.equal(facilityLoads,0);
    const done=()=>page.waitForFunction(()=>{const n=document.querySelector('#additionalCandidateSearch');return !n?.querySelector('button')?.disabled&&n?.querySelector('[role=status]')?.textContent.includes('モデル上の候補があります');});
    await search.click();
    if(scenario==='cancel-stale'){
     await held;await page.getByRole('button',{name:'キャンセル',exact:true}).click();releases.forEach(r=>r());await page.waitForTimeout(300);assert.equal(await page.locator('#additionalCandidateResults button.list-item').count(),0);assert((await page.locator('#additionalCandidateSearch [role=status]').innerText()).includes('キャンセルしました'));await search.click();await done();
    }else if(scenario==='date-stale'){
     await held;await page.evaluate(()=>SkyMapUI.setTime(Date.parse('2026-11-29T12:00:00+09:00')));await page.waitForFunction(()=>!document.querySelector('#additionalCandidateSearch button')?.disabled&&document.querySelector('#additionalCandidateSearch [role=status]')?.textContent==='');releases.forEach(r=>r());await page.waitForTimeout(300);assert.equal(await page.locator('#additionalCandidateResults button.list-item').count(),0);await search.click();await done();
    }else{
     await done();
     if(scenario==='failure-retry'||scenario==='timeout-retry'){
      assert(await page.locator('#additionalCandidateResults button.list-item').count()>0);assert.equal(await page.locator('#additionalCandidateResults button.list-item[data-label-address-status="unavailable"]').count(),await page.locator('#additionalCandidateResults button.list-item').count());assert((await page.locator('#additionalCandidateSearch [role=status]').innerText()).includes('読み込めませんでした'));
      if(scenario==='failure-retry'){await context.unroute(addressPattern);await context.unroute(facilityPattern);}releases.forEach(r=>r());await search.click();await done();
     }
    }
    const rows=page.locator('#additionalCandidateResults button.list-item'),count=await rows.count();assert(count>0);assert(await page.locator('#additionalCandidateResults button.list-item[data-label-address-status="matched"]').count()>0);
    assert(await page.locator('#additionalCandidateSearch a[href="https://www.openstreetmap.org/copyright"]:visible').count()>0);
    const chosen=page.locator('#additionalCandidateResults button.list-item[data-label-address-status="matched"]').first(),expectedName=await chosen.getAttribute('data-candidate-name');assert(expectedName.includes('モデル候補'));assert((await chosen.innerText()).includes('町丁目'));
    const checks=await page.evaluate(()=>window.labelChecks);assert(checks.length);for(const check of checks)assert.equal(check.before,check.after,'labels must preserve exact coordinates, time and LOS evidence');
    const metrics=await page.locator('#additionalCandidateSearch').evaluate(n=>({overflow:n.scrollWidth>n.clientWidth,bodyOverflow:document.documentElement.scrollWidth>innerWidth}));assert(!metrics.overflow&&!metrics.bodyOverflow);
    await page.locator('#additionalCandidateSearch').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/'+engine+'-'+scenario+'-results.png'});
    const dataLoads=[addressLoads,facilityLoads];await search.click();await done();assert.deepEqual([addressLoads,facilityLoads],dataLoads,'completed labels reuse the dataset cache');
    await chosen.click();await page.waitForFunction(()=>!document.getElementById('placeSheet').open);const selected=await page.evaluate(()=>SkyMapUI.selectionState());assert.equal(selected.observer.name,expectedName);
    assert.equal(new Date(selected.at+32400000).toISOString().slice(0,10),scenario==='date-stale'?'2026-11-29':'2026-11-04');assert.equal(await page.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()})),unchanged);assert.equal(writes,0);assert.equal(externalNameRequests,0);assert.deepEqual(errors,[]);
    results.push({engine,scenario,count,addressLoads,facilityLoads,writes,externalNameRequests,errors,selectedName:selected.observer.name,numericChecks:checks.length});console.log(engine,scenario,'pass',count,'candidates');
   }finally{releases.forEach(r=>r());await context.close();}
  }}finally{await browser.close();}
 }
 fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exit(1);});
