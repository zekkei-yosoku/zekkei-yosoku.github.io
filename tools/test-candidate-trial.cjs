require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.CANDIDATE_TRIAL_BASE||'http://127.0.0.1:8986/trial/index.html';
const out=process.env.CANDIDATE_TRIAL_OUT||'/tmp/candidate-trial-checks';fs.mkdirSync(out,{recursive:true});
const tools=['records','tower','diamond','pearl','skymap','multiscene'];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
(async()=>{
 const results=[];
 for(const [name,type] of [['chrome',chromium],['webkit',webkit]].filter(([name])=>(process.env.CANDIDATE_TRIAL_ENGINES||'chrome,webkit').split(',').includes(name))){
  const browser=await type.launch(name==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  for(const width of (process.env.CANDIDATE_TRIAL_WIDTHS||'320,390,1280').split(',').map(Number))for(const theme of (process.env.CANDIDATE_TRIAL_THEMES||'light,dark').split(',')){
   const c=await browser.newContext({viewport:{width,height:width===320?568:900},colorScheme:theme});
   await c.addInitScript(tools=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-candidate',loginId:'candidate-test',tools})),tools);
   let writes=0,loads=0,modelLoads=0;
   await c.route(/(?:zekkei-api|localhost:8787)/,r=>{if(!['GET','OPTIONS'].includes(r.request().method()))writes++;return r.fulfill({status:200,json:{allowed:true,tool:'skymap',loginId:'candidate-test',tools,favorites:[],sightings:[],records:[],rev:1}});});
   await c.route(/cyberjapandata.*\.png/,r=>r.fulfill({status:200,contentType:'image/png',body:png}));
   const p=await c.newPage(),errors=[];p.setDefaultTimeout(120000);p.on('pageerror',e=>errors.push(e.message));
   p.on('request',r=>{if(r.url().includes('candidate-sidewalks.json'))loads++;if(/candidate-(?:buildings|surfaces|terrain)\.json/.test(r.url()))modelLoads++;});
   await p.goto(base+'#/explore');await p.waitForFunction(()=>{try{return typeof MyPlacesUI==='object'&&typeof TrialExplore==='object'}catch{return false}});
   await p.evaluate(async(testDate)=>{await startupSessionReady;groundAt=async()=>30;aimBuildingDays=async()=>[];await AstroNotesAssets.ensureModels();navigationHistory.pushRoute('#/explore');SkyMapUI.setTarget('skytree');document.getElementById('skyMapBody').value='moon';document.getElementById('skyMapBody').onchange();SkyMapUI.setTime(Date.parse(testDate));},process.env.CANDIDATE_TRIAL_DATE||'2026-11-04T12:00:00+09:00');
   console.log(name,width,theme,'prepared');
   await p.locator('#exploreConditions').waitFor();assert(await p.locator('#exploreTabs').isHidden());assert(await p.locator('#exploreScenePanel').isVisible());assert(await p.locator('#exploreMapPanel').isHidden());
   const stateBefore=await p.evaluate(()=>JSON.stringify({favorites,observations:MyPlacesUI.load(),schedule:schedule().list()}));
   await p.locator('#skyMapChoose').click();await p.locator('#placeTab-candidates').click();await p.locator('#additionalCandidateSearch').waitFor();
   const button=p.getByRole('button',{name:'ほかの候補地点を探す',exact:true});
   assert.equal(loads,0,'no extra search merely opening picker');
   await p.locator('#placeSheet .page-back').click();await p.evaluate(()=>SkyMapUI.setTarget('tokyotower'));await p.locator('#skyMapChoose').click();await p.locator('#placeTab-candidates').click();await p.waitForFunction(()=>document.querySelector('#additionalCandidateSearch button')?.disabled&&document.querySelector('#additionalCandidateSearch [role=status]')?.textContent.includes('東京スカイツリー'));assert.equal(loads,0);await p.locator('#placeSheet .page-back').click();await p.evaluate(()=>SkyMapUI.setTarget('skytree'));await p.locator('#skyMapChoose').click();await p.locator('#placeTab-candidates').click();await p.waitForFunction(()=>!document.querySelector('#additionalCandidateSearch button')?.disabled);

   if(process.env.CANDIDATE_TRIAL_RACES==='1'){
    await button.click();await p.waitForFunction(()=>document.querySelector('#additionalCandidateSearch [role=status]')?.textContent.includes('25地点'));
    console.log(name,'race first progress');await p.getByRole('button',{name:'探索を中止',exact:true}).click();assert((await p.locator('#additionalCandidateSearch [role=status]').innerText()).includes('中止しました'));
    await button.click();await p.waitForFunction(()=>document.querySelector('#additionalCandidateSearch [role=status]')?.textContent.includes('25地点'));
    console.log(name,'race second progress');await p.evaluate(()=>SkyMapUI.setTime(Date.parse('2026-11-04T12:00:00+09:00')));
    await p.waitForFunction(()=>!document.querySelector('#additionalCandidateSearch button').disabled&&document.querySelector('#additionalCandidateSearch [role=status]').textContent==='');
    assert.equal(await p.locator('#additionalCandidateResults button').count(),0);console.log(name,'cancel and condition-change pass');
    await p.evaluate(()=>SkyMapUI.setTime(Date.parse('2026-11-29T12:00:00+09:00')));
    await button.click();await p.waitForFunction(()=>document.querySelector('#additionalCandidateSearch [role=status]')?.textContent.includes('25地点'));
    await p.evaluate(()=>{aimAirSettings.mode='none';AstroNotesAtmosphere.configure('none');});
    await p.waitForFunction(()=>!document.querySelector('#additionalCandidateSearch button').disabled&&document.querySelector('#additionalCandidateSearch [role=status]').textContent==='');
    await button.click();await p.waitForFunction(()=>document.querySelector('#additionalCandidateSearch [role=status]')?.textContent.includes('25地点'));
    await p.locator('#placeSheet .page-back').click();await p.evaluate(()=>SkyMapUI.setTime(Date.parse('2026-11-04T12:00:00+09:00')));
    await p.locator('#skyMapChoose').click();await p.locator('#placeTab-candidates').click();await p.waitForFunction(()=>!document.querySelector('#additionalCandidateSearch button').disabled);console.log(name,'atmosphere change and close/reopen pass');
   }
   let releaseData=null,held=null;if(process.env.CANDIDATE_TRIAL_RACES!=='1'){let started;held=new Promise(r=>started=r);await c.route(/candidate-sidewalks\.json/,async r=>{await new Promise(resolve=>{releaseData=resolve;started();});await r.continue();},{times:1});}
   const t=Date.now();await button.click();await p.locator('#additionalCandidateSearch .note-wait-character').waitFor();
   const waiting=await p.locator('#additionalCandidateSearch [role=status]').evaluate(n=>{const c=n.querySelector('.note-wait-character'),s=getComputedStyle(c);return {width:c.getBoundingClientRect().width,inView:c.getBoundingClientRect().top>=0&&c.getBoundingClientRect().bottom<=innerHeight,opacity:s.opacity,animation:s.animationName,background:s.backgroundImage,hidden:c.getAttribute('aria-hidden'),text:n.textContent};});assert.equal(waiting.width,48);assert(waiting.inView,'waiting character is visible on small screens');assert.equal(waiting.opacity,'1');assert.equal(waiting.animation,'none');assert(waiting.background.includes('astronotes-note-computing-branded-v2.png'));assert.equal(waiting.hidden,'true');assert(!waiting.text.includes('%'));
   assert.equal(await p.locator('#additionalCandidateResults').getAttribute('aria-busy'),'true');await p.screenshot({path:out+'/'+name+'-'+width+'-'+theme+'-waiting.png'});if(held){await held;releaseData();}
   await p.waitForFunction(()=>{const n=document.querySelector('#additionalCandidateSearch'),s=n?.querySelector('[role=status]')?.textContent||'';return !n?.querySelector('button')?.disabled&&(s.includes('モデル上の候補があります')||s.includes('見通しを確認できた候補はありません'));});
   assert.equal(await p.locator('#additionalCandidateSearch .note-wait-character').count(),0);assert.equal(await p.locator('#additionalCandidateResults').getAttribute('aria-busy'),'false');const elapsedMs=Date.now()-t,extraResults=await p.locator('#additionalCandidateResults button').count();assert.equal(loads,1);if(extraResults)assert.equal(await p.locator('#additionalCandidateResults button[data-model-basis="terrain-and-building-model-los"]').count(),extraResults);
   const beforeCached=loads;await button.click();await p.waitForFunction(()=>!document.querySelector('#additionalCandidateSearch button').disabled);assert.equal(loads,beforeCached);
   assert.equal(await p.evaluate(()=>JSON.stringify({favorites,observations:MyPlacesUI.load(),schedule:schedule().list()})),stateBefore);
   const metrics=await p.locator('#additionalCandidateSearch').evaluate(n=>({overflow:n.scrollWidth>n.clientWidth,buttonHeight:n.querySelector('button').getBoundingClientRect().height,width:innerWidth,bodyOverflow:document.documentElement.scrollWidth>innerWidth}));assert(!metrics.overflow&&!metrics.bodyOverflow);assert(metrics.buttonHeight>=43.9);
   await p.screenshot({path:out+'/'+name+'-'+width+'-'+theme+'-result.png'});
   let modelSelection=false;if(extraResults){assert.equal(await p.locator('#additionalCandidateResults a').count(),0);const expectedCandidateName=await p.locator('#additionalCandidateResults button').first().getAttribute('data-candidate-name');await p.locator('#additionalCandidateResults button').first().click();await p.waitForFunction(()=>!document.getElementById('placeSheet').open);const m=await p.evaluate(()=>SkyMapUI.selectionState());assert.equal(m.observer.name,expectedCandidateName);await p.locator('#exploreScenePanel #exploreExternalMap').waitFor();const modelMapHref=await p.locator('#exploreExternalMap').getAttribute('href');assert(modelMapHref.includes(m.observer.latitude.toFixed(7)+','+m.observer.longitude.toFixed(7)));assert.equal(new Date(m.at+32400000).toISOString().slice(0,10),new Date(Date.parse(process.env.CANDIDATE_TRIAL_RACES==='1'?'2026-11-04T12:00:00+09:00':process.env.CANDIDATE_TRIAL_DATE||'2026-11-04T12:00:00+09:00')+32400000).toISOString().slice(0,10));assert(await p.locator('#exploreScenePanel').isVisible());assert.equal(await p.evaluate(()=>JSON.stringify({favorites,observations:MyPlacesUI.load(),schedule:schedule().list()})),stateBefore);modelSelection=true;await p.locator('#skyMapChoose').click();await p.locator('#placeTab-candidates').click();}
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
   assert.deepEqual(errors,[]);results.push({engine:name,width,theme,elapsedMs,loads,modelLoads,extraResults,modelSelection,registeredSelection:true,storageUnchanged:true,apiWrites:writes});
   await c.close();console.log(name,width,theme,'pass',elapsedMs+'ms');
  }
  await browser.close();
 }
 fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exit(1)});
