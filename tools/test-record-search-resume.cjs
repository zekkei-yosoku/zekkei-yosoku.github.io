// Reproduce an OS-suspension loss of one scheduler MessagePort notification.
// The actual record search, cache, progress and page lifecycle stay in use;
// only expensive astronomical candidates and the OS delivery are fixtures.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const choose=require('./choose-record-opportunity-filter.cjs');
const base=process.env.RECORD_RESUME_BASE||'http://127.0.0.1:8997/trial/index.html';
const out=process.env.RECORD_RESUME_OUT||'/tmp/astronotes-record-search-resume';fs.mkdirSync(out,{recursive:true});
const engines=(process.env.RECORD_RESUME_ENGINE||'chrome,webkit').split(',');
const signals=(process.env.RECORD_RESUME_SIGNALS||'visibilitychange,pageshow,focus').split(',');
const screens=(process.env.RECORD_RESUME_SCREENS||'explore,opportunities').split(',');
const expectedStall=process.env.RECORD_RESUME_EXPECT_STALL==='1',grants=['records','tower','diamond','pearl','skymap','multiscene'];
function suspendedOS(grants){
 sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-record-resume',loginId:'resume-test',tools:grants}));
 Date.now=()=>Date.parse('2026-11-07T16:29:00+09:00');
 const state=window.resumeFixture={hidden:false,armed:false,dropNext:false,reached:0,dropped:0,channels:0,progress:[],solves:[],started:false};
 Object.defineProperty(document,'hidden',{configurable:true,get:()=>state.hidden});
 Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>state.hidden?'hidden':'visible'});
 const NativeMessageChannel=window.MessageChannel;
 function PausableMessageChannel(){
  const channel=new NativeMessageChannel();
  if(/recordSearchFrame/.test(new Error().stack||'')){
   state.channels++;
   channel.port1.addEventListener('message',event=>{
    if(!state.dropNext)return;
    state.dropNext=false;state.dropped++;event.stopImmediatePropagation();
    // The queued wake-up is permanently lost. Returning to the page must not
    // depend on replaying this event or on resolving it from the fixture.
    state.hidden=true;document.dispatchEvent(new Event('visibilitychange'));
   },true);
  }
  return channel;
 }
 PausableMessageChannel.prototype=NativeMessageChannel.prototype;Object.setPrototypeOf(PausableMessageChannel,NativeMessageChannel);window.MessageChannel=PausableMessageChannel;
 const setAttribute=Element.prototype.setAttribute;
 Element.prototype.setAttribute=function(name,value){
  const result=setAttribute.call(this,name,value);
  if(state.started&&name==='aria-valuetext'&&this.classList.contains('note-progress')){
   const match=String(value).match(/^(\d+)\s*\/\s*(\d+)/);
   if(match){
    const checked=+match[1],total=+match[2];state.progress.push({checked,total,hidden:state.hidden});
    if(state.armed&&checked===63&&total===174){
     state.armed=false;state.dropNext=true;state.reached=checked;state.condition=window.readResumeCondition?.()??null;
     // Ensure this exact progress update reaches the real cooperative yield.
     const until=performance.now()+20;while(performance.now()<until){}
    }
   }
  }
  return result;
 };
}
async function run(browser,engine,screen,signal){
 const context=await browser.newContext({viewport:{width:390,height:900},locale:'ja-JP',timezoneId:'Asia/Tokyo',colorScheme:'dark',reducedMotion:'reduce'});
 await context.addInitScript(suspendedOS,grants);
 let writes=0;const errors=[];
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===new URL(base).origin)return route.continue();if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(route.request().method()))writes++;return route.fulfill({json:{allowed:true,tool:'skymap',loginId:'resume-test',tools:grants,favorites:[],records:[],sightings:[],rev:1}});}return route.abort();});
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 const report={engine,screen,signal,base};
 try{
  await page.goto(base+'#/almanac');await page.waitForFunction(()=>typeof MyPlacesUI==='object'&&typeof SkyMapUI==='object'&&typeof AstroNotesAssets==='object');
  report.version=await page.locator('meta[name=app-version]').getAttribute('content');
  await page.evaluate(async()=>{
   await startupSessionReady;await AstroNotesAssets.ensureModels();AstroNotesAtmosphere.configure('standard');
   RecordSync.kick=()=>{};RecordSync.touched=()=>{};accountSync().syncNow=async()=>{};accountSync().queuePush=()=>{};
   // Keep recordSearch() and its MessageChannel yields intact, but make the
   // astronomy deterministic so the test is about resumption, not CPU speed.
   AstroNotesShooting.candidates=async(plan,entries,{isCurrent=()=>true}={})=>{
    if(!isCurrent())return {rows:[],failed:0,cancelled:true};
    return {rows:entries.map(entry=>{resumeFixture.solves.push(entry.place.id);return {...entry,assumedObserver:{latitude:entry.place.latitude,longitude:entry.place.longitude,elevation:entry.place.groundManualM,eyeM:entry.place.standAglM},event:{at:AstroNotesShooting.day(plan.at)+12*3600000,intersects:true,sunAltitude:20,side:'set',gap:0,radius:.25,distanceToTarget:0,matchMode:'overlap',partId:'__whole',limb:'center'}};}),failed:0};
   };
  });
  if(screen==='explore'){
   await page.evaluate(async()=>{navigationHistory.pushRoute('#/explore');await SkyMapUI.open();SkyMapUI.setTarget('skytree');const b=document.getElementById('skyMapBody');b.value='sun';b.onchange();SkyMapUI.setTime(Date.parse('2026-11-07T16:29:00+09:00'));});
   await page.locator('#exploreShowResult').waitFor({state:'visible'});
  }else{
   await page.evaluate(()=>navigationHistory.pushRoute('#/records'));
   await page.locator('#notebookOpportunitiesTab').click();await choose(page,'Body','sun');
   await page.locator('#recordOpportunityDate').fill('2026-11-07');
  }
  await page.evaluate(screen=>{window.readResumeCondition=()=>{if(screen!=='explore')return null;const s=SkyMapUI.selectionState();return s?{day:AstroNotesShooting.day(s.at),body:s.body,target:s.target?.id,partId:s.partId,limb:s.limb,matchMode:s.matchMode}:null;};},screen);
  await page.evaluate(()=>{
   const target=aimTargetList().find(t=>t.id==='skytree');
   favorites=Array.from({length:174},(_,i)=>({id:'resume-'+i,name:'復帰試験 '+String(i).padStart(3,'0'),latitude:35.58+i*.0001,longitude:139.56,elevation:87.2,groundManualM:87.2,eyeHeightAGL:1.5,standAglM:1.5,stand:'ground',recordRegistered:true}));
   store.set('sorami.favorites',favorites);
   const records=favorites.map(f=>({id:f.id+'-record',placeId:f.id,target:{key:target.id,name:target.name,latitude:target.latitude,longitude:target.longitude},observer:{latitude:f.latitude,longitude:f.longitude,elevation:f.elevation,eyeHeightAGL:f.eyeHeightAGL},result:'seen',registration:true,date:'',note:'',createdAt:1,updatedAt:1}));
   store.set(AstroNotesLibrary.keys(auth.loginId).observations,records);
   resumeFixture.started=true;resumeFixture.armed=true;MyPlacesUI.imported();
  });
  await page.waitForFunction(()=>resumeFixture.dropped===1);
  const host=screen==='explore'?'#exploreRecordedPlaces':'#recordOpportunities',rows=screen==='explore'?'#exploreRecordedResults .explore-record-row':'#recordOpportunityList [data-opportunity-id]';
  report.suspended=await page.evaluate(()=>({reached:resumeFixture.reached,dropped:resumeFixture.dropped,channels:resumeFixture.channels,hidden:document.hidden,solves:resumeFixture.solves.length,condition:resumeFixture.condition}));
  assert.equal(report.suspended.reached,63);assert.equal(report.suspended.hidden,true);assert(report.suspended.channels>=1);
  await page.evaluate(signal=>{
   resumeFixture.hidden=false;
   if(signal==='visibilitychange')document.dispatchEvent(new Event('visibilitychange'));
   else if(signal==='pageshow')window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
   else window.dispatchEvent(new Event('focus'));
  },signal);
  if(expectedStall){
   await page.waitForTimeout(1200);
   report.finished=await page.locator(rows).count()===174&&await page.locator(host).getAttribute('aria-busy')==='false';
   assert.equal(report.finished,false,'baseline must reproduce the missing-notification stall');
  }else{
   await page.waitForFunction(({host,rows})=>document.querySelectorAll(rows).length===174&&document.querySelector(host)?.getAttribute('aria-busy')==='false',{host,rows},{timeout:7000});
   report.finished=true;
   if(screen==='explore'){report.resumedCondition=await page.evaluate(()=>readResumeCondition());assert(report.suspended.condition,'condition present at suspension');assert.deepEqual(report.resumedCondition,report.suspended.condition,'resume retains exact day/body/target/part/limb/matchMode');}
   const names=await page.locator(rows+' strong').allTextContents();assert.equal(new Set(names).size,174,'every saved place appears once after resume');
   assert.equal(await page.locator(host+' [role=progressbar]').count(),0);
   assert.equal(await page.locator(host).getByRole('button',{name:/続き/}).count(),0);
  }
  report.version=await page.locator('meta[name=app-version]').getAttribute('content');
  report.rows=await page.locator(rows).count();report.busy=await page.locator(host).getAttribute('aria-busy');
  report.state=await page.evaluate(()=>({dropped:resumeFixture.dropped,progress:resumeFixture.progress,solves:resumeFixture.solves}));
  assert.deepEqual(errors,[]);assert.equal(writes,0);Object.assign(report,{passed:true,errors,writes});
  await page.screenshot({path:out+'/'+engine+'-'+screen+'-'+signal+'.png'});
  return report;
 }catch(e){report.error=String(e.stack||e);report.errors=errors;report.writes=writes;report.state=await page.evaluate(()=>window.resumeFixture).catch(()=>null);await page.screenshot({path:out+'/'+engine+'-'+screen+'-'+signal+'-failure.png'}).catch(()=>{});return report;}
 finally{await context.close();}
}
(async()=>{
 const results=[];
 for(const [engine,type]of [['chrome',chromium],['webkit',webkit]].filter(([engine])=>engines.includes(engine))){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{for(const screen of screens)for(const signal of signals){const r=await run(browser,engine,screen,signal);results.push(r);fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify({engine,screen,signal,passed:!!r.passed,finished:r.finished,rows:r.rows,error:r.error}));}}
  finally{await browser.close();}
 }
 if(results.some(r=>!r.passed))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
