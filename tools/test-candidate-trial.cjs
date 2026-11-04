require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.CANDIDATE_TRIAL_BASE||'http://127.0.0.1:8986/trial/index.html';
const out=process.env.CANDIDATE_TRIAL_OUT||'/tmp/candidate-trial-checks';fs.mkdirSync(out,{recursive:true});
const tools=['records','tower','diamond','pearl','skymap','multiscene'];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
(async()=>{
 const results=[];
 for(const [name,type] of [['chrome',chromium],['webkit',webkit]]){
  const browser=await type.launch(name==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  for(const width of [320,390,1280])for(const theme of ['light','dark']){
   const c=await browser.newContext({viewport:{width,height:width===320?568:900},colorScheme:theme});
   await c.addInitScript(tools=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-candidate',loginId:'candidate-test',tools})),tools);
   let writes=0,loads=0;
   await c.route(/(?:zekkei-api|localhost:8787)/,r=>{if(!['GET','OPTIONS'].includes(r.request().method()))writes++;return r.fulfill({status:200,json:{allowed:true,tool:'skymap',loginId:'candidate-test',tools,favorites:[],sightings:[],records:[],rev:1}});});
   await c.route(/cyberjapandata.*\.png/,r=>r.fulfill({status:200,contentType:'image/png',body:png}));
   const p=await c.newPage(),errors=[];p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
   p.on('request',r=>{if(r.url().includes('candidate-sidewalks.json'))loads++;});
   await p.goto(base+'#/explore');await p.waitForFunction(()=>{try{return typeof MyPlacesUI==='object'&&typeof TrialExplore==='object'}catch{return false}});
   await p.evaluate(async()=>{await startupSessionReady;groundAt=async()=>30;aimBuildingDays=async()=>[];await AstroNotesAssets.ensureModels();navigationHistory.pushRoute('#/explore');SkyMapUI.setTarget('skytree');document.getElementById('skyMapBody').value='moon';document.getElementById('skyMapBody').onchange();SkyMapUI.setTime(Date.parse('2026-11-04T12:00:00+09:00'));});
   console.log(name,width,theme,'prepared');
   await p.locator('#exploreConditions').waitFor();assert(await p.locator('#exploreTabs').isHidden());assert(await p.locator('#exploreScenePanel').isVisible());assert(await p.locator('#exploreMapPanel').isHidden());
   const stateBefore=await p.evaluate(()=>JSON.stringify({favorites,observations:MyPlacesUI.load(),schedule:schedule().list()}));
   await p.locator('#skyMapChoose').click();await p.locator('#placeTab-candidates').click();await p.locator('#additionalCandidateSearch').waitFor();
   const button=p.getByRole('button',{name:'ほかの候補地点を探す',exact:true});
   assert.equal(loads,0,'no extra search merely opening picker');
   const t=Date.now();await button.click();await p.waitForFunction(()=>document.querySelector('#additionalCandidateSearch [role=status]')?.textContent.includes('見通しを確かめられる候補がありません'));
   const elapsedMs=Date.now()-t;assert.equal(await p.locator('#additionalCandidateResults button').count(),0);assert.equal(loads,1);
   const beforeCached=loads;await button.click();await p.waitForFunction(()=>!document.querySelector('#additionalCandidateSearch button').disabled);assert.equal(loads,beforeCached);
   assert.equal(await p.evaluate(()=>JSON.stringify({favorites,observations:MyPlacesUI.load(),schedule:schedule().list()})),stateBefore);
   const metrics=await p.locator('#additionalCandidateSearch').evaluate(n=>({overflow:n.scrollWidth>n.clientWidth,buttonHeight:n.querySelector('button').getBoundingClientRect().height,width:innerWidth,bodyOverflow:document.documentElement.scrollWidth>innerWidth}));assert(!metrics.overflow&&!metrics.bodyOverflow);assert(metrics.buttonHeight>=43.9);
   await p.screenshot({path:out+'/'+name+'-'+width+'-'+theme+'-unknown.png'});
   await p.locator('#placeSheet .page-back').click();await p.waitForFunction(()=>!document.getElementById('placeSheet').open);
   // Keep existing registered places immediately available above the new section.
   await p.evaluate(()=>{
    const f={id:'registered',name:'登録済みの撮影地点',latitude:35.68626,longitude:139.73068,elevation:30,eyeHeightAGL:1.5};favorites=[f];
    const t=AstroNotesAlign.targetById('skytree');store.set(AstroNotesLibrary.keys(auth.loginId).observations,[{id:'reg-synthetic',placeId:f.id,target:{key:t.id,name:t.name,latitude:t.latitude,longitude:t.longitude},observer:f,result:'seen',registration:true,date:'',createdAt:1,updatedAt:1}]);
    const previous=AstroNotesShooting.candidates;AstroNotesShooting.candidates=async(plan,points,opts)=>points.length?{rows:[{place:f,record:MyPlacesUI.load()[0],event:{at:plan.at,side:'rise',matchMode:'overlap',partId:'__whole'}}],failed:0}:previous(plan,points,opts);
    MyPlacesUI.imported();
   });
   await p.locator('#skyMapChoose').click();await p.locator('#placeTab-candidates').click();await p.locator('#recentCandidates .my-place-row').waitFor();
   assert((await p.locator('#recentCandidates').innerText()).includes('登録済みの撮影地点'));
   assert(await button.isVisible());
   const savedBefore=await p.evaluate(()=>JSON.stringify({favorites,observations:MyPlacesUI.load(),schedule:schedule().list()}));
   await p.locator('#recentCandidates .my-place-row').click();await p.waitForFunction(()=>!document.getElementById('placeSheet').open);
   const selected=await p.evaluate(()=>SkyMapUI.selectionState());assert.equal(selected.observer.name,'登録済みの撮影地点');assert.equal(selected.body,'moon');assert.equal(selected.target.id,'skytree');
   assert(await p.locator('#exploreTabs').isHidden());assert(await p.locator('#exploreScenePanel').isVisible());
   assert.equal(await p.evaluate(()=>JSON.stringify({favorites,observations:MyPlacesUI.load(),schedule:schedule().list()})),savedBefore);
   await p.screenshot({path:out+'/'+name+'-'+width+'-'+theme+'-scene.png'});
   assert.deepEqual(errors,[]);results.push({engine:name,width,theme,elapsedMs,loads,extraResults:0,registeredSelection:true,storageUnchanged:true,apiWrites:writes});
   await c.close();console.log(name,width,theme,'pass',elapsedMs+'ms');
  }
  await browser.close();
 }
 fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exit(1)});
