// Real Explore tabs and UI, with a controlled place provider and event solver.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture}=require('./candidate-date-fixture.cjs');
const base=process.env.CANDIDATE_AUTO_BASE||'http://127.0.0.1:8996/trial/index.html',out=process.env.CANDIDATE_AUTO_OUT||'/tmp/astronotes-auto-candidate';fs.mkdirSync(out,{recursive:true});
const grants=['records','tower','diamond','pearl','skymap','multiscene'];
(async()=>{
 const results=[];
 for(const [engine,type,width,theme]of [['chrome',chromium,390,'light'],['webkit',webkit,320,'dark']]){
  if(process.env.CANDIDATE_AUTO_ENGINE&&engine!==process.env.CANDIDATE_AUTO_ENGINE)continue;
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{
   const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme,locale:'ja-JP',timezoneId:'Asia/Tokyo',reducedMotion:'reduce'});
   let writes=0;const errors=[];
   await context.addInitScript(fixture,grants);
   await context.route('**/*',r=>{const url=new URL(r.request().url());if(url.origin===new URL(base).origin)return r.continue();if(/zekkei-api|localhost:8787/.test(url.origin)){if(!['GET','OPTIONS'].includes(r.request().method()))writes++;return r.fulfill({json:{allowed:true,tool:'skymap',loginId:'date-test',tools:grants,favorites:[],records:[],sightings:[],rev:1}});}return r.abort();});
   const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(20000);
   await p.goto(base+'#/explore');await p.waitForFunction(()=>typeof AstroNotesCandidatePicker==='object');
   await p.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>25;aimBuildingDays=async()=>[];SkyMapUI.setTarget('skytree');const body=document.getElementById('skyMapBody');body.value='moon';body.onchange();SkyMapUI.setTime(Date.parse('2026-11-07T09:00:00+09:00'));dateFixture.autoPages=true;dateFixture.nextCursor=7;dateFixture.holdCursor=7;});
   await p.locator('#exploreDiscovery-new').click();
   const button=p.locator('#candidateSearchAction'),feedback=p.locator('#candidateSearchFeedback [role=status]'),progress=feedback.locator('[role=progressbar]');
   const state=async text=>{await p.waitForFunction(t=>document.getElementById('candidateSearchAction')?.textContent===t,text);assert.equal(await button.innerText(),text);};
   const loads=()=>p.evaluate(()=>dateFixture.loads.map(r=>r.cursor));
   const waitHold=()=>p.waitForFunction(()=>dateFixture.holds.length===1);
   const release=()=>p.evaluate(()=>dateFixture.holds.shift().release());
   const shown=()=>p.evaluate(()=>AstroNotesCandidatePicker.visibleRows().map(r=>r.id));
   await state('候補を探す');assert.deepEqual(await loads(),[]);
   await button.click();await waitHold();assert.deepEqual(await loads(),[0,7]);await state('キャンセル');
   assert(await progress.isVisible());assert(await feedback.locator('.note-wait-character').isVisible());assert.match(await feedback.innerText(),/2地点確認済み/);
   await progress.scrollIntoViewIfNeeded();await p.screenshot({path:out+'/'+engine+'-auto-progress.png'});
   await release();await state('候補を探し直す');assert.equal(await progress.count(),0);const first=await shown();assert.equal(first.length,2);assert.equal(new Set(first).size,2);
   await p.evaluate(()=>dateFixture.repeatCursor=true);await button.click();await state('再試行');assert.match(await feedback.innerText(),/取得できなかった/);assert.deepEqual(await loads(),[0,7,0,7]);assert.deepEqual(await shown(),first);
   await p.evaluate(()=>dateFixture.repeatCursor=false);await button.click();await state('候補を探し直す');
   await p.evaluate(()=>dateFixture.holdCursor=7);await button.click();await waitHold();await state('キャンセル');
   await button.click();await state('続きを探す');assert.match(await feedback.innerText(),/キャンセルしました/);assert.deepEqual(await shown(),first);
   const beforeResume=(await loads()).length;
   await button.click();await state('候補を探し直す');assert.equal((await loads()).length,beforeResume+1);assert.equal((await loads()).at(-1),7);
   await release();assert.deepEqual(await shown(),first);
   await p.evaluate(()=>dateFixture.holdCursor=7);await button.click();await waitHold();await p.locator('#skyMapNext').click();await state('候補を探す');
   await release();assert.equal(await progress.count(),0);assert.deepEqual(await shown(),[]);
   await button.click();await state('候補を探し直す');const next=await shown();assert(next.every(id=>id.startsWith('2026-11-08')));assert.equal(next.length,2);
   assert.equal(writes,0);assert.deepEqual(errors,[]);
   const version=await p.evaluate(()=>new URL([...document.scripts].find(s=>s.src.includes('astronotes-candidate-search.js')).src).searchParams.get('v'));
   results.push({engine,width,theme,version,passed:true,autoPages:[0,7],stalledCursorReportsRetry:true,manualCancelAndResume:true,lateOldDateIgnored:true,writes,errors});fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS',engine,width,'automatic candidate search');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
