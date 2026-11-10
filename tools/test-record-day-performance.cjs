// Real ephemerides, local/synthetic account, constant terrain only for the shape fixture.
require('./no-open-meteo.cjs');
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const choose=require('./choose-record-opportunity-filter.cjs');
const base=process.env.RECORD_DAY_BASE||'http://127.0.0.1:8994/trial/index.html',baseline=process.env.RECORD_DAY_BASELINE;
const out=process.env.RECORD_DAY_OUT||'/tmp/astronotes-record-day-performance.json';
const grants=['records','tower','diamond','pearl','skymap','multiscene'],at=Date.parse('2026-11-25T00:00:00+09:00');
async function fixture(browser,url){
 const c=await browser.newContext({locale:'ja-JP',timezoneId:'Asia/Tokyo',viewport:{width:390,height:900},reducedMotion:'reduce'});
 let writes=0;await c.addInitScript(grants=>{sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-day-perf',loginId:'daily-perf',tools:grants}));Date.now=()=>Date.parse('2026-11-06T09:02:00+09:00');},grants);
 await c.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(url).origin)return r.continue();if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(r.request().method()))writes++;return r.fulfill({json:{allowed:true,tool:'skymap',loginId:'daily-perf',tools:grants,favorites:[],records:[],sightings:[],rev:1}});}return r.abort();});
 const page=await c.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(35000);
 await page.goto(url+'#/records');await page.waitForFunction(()=>typeof MyPlacesUI==='object'&&typeof SkyMapUI==='object');
 await page.evaluate(async()=>{
  await startupSessionReady;await AstroNotesAssets.ensureModels();AstroNotesAtmosphere.configure('standard');
  RecordSync.kick=()=>{};RecordSync.touched=()=>{};const sync=accountSync();sync.syncNow=async()=>{};sync.queuePush=()=>{};
  const p={name:'鷺沼北公園',latitude:35.58386,longitude:139.56853,elevation:87.2,groundManualM:87.2,eyeHeightAGL:1.5,standAglM:1.5,stand:'ground'};
  window.dailyBench={p,target:aimTargetList().find(t=>t.id==='skytree'),calls:0,prepared:0,dem:0};
  const A=AstroNotesAlign,originalPrepare=A.prepareDailyView,originalDaily=A.dailyView,originalCandidates=AstroNotesShooting.candidates;
  A.prepareDailyView=(...args)=>{dailyBench.prepared++;return originalPrepare(...args);};
  A.dailyView=(...args)=>{dailyBench.prepared++;return originalDaily(...args);};
  AstroNotesShooting.candidates=(...args)=>{dailyBench.calls++;return originalCandidates(...args);};
  AstroNotesTerrain.groundElevation=async()=>{dailyBench.dem++;return 87.2;};
  // The counters watch this page's functions; 探す's search runs in the calculation workers otherwise (same code).
  window.AstroNotesDiscoveryEngine='page';
 });
 return {c,page,verify:()=>{assert.equal(writes,0);assert.deepEqual(errors,[]);}};
}
async function calculate(page,at){
 return page.evaluate(async at=>{
  const {p,target}=dailyBench,plan={target,body:'moon',at,partId:'__whole',limb:'center',matchMode:'overlap'};
  const pos=(latitude,longitude)=>({latitude,longitude}),mk=(f,i)=>({place:{...f,id:'perf-'+i},record:{result:'seen'}});
  const points=Array.from({length:24},(_,i)=>mk({...p,name:p.name+' '+i,latitude:p.latitude+i*.0004,longitude:p.longitude+i*.0007},i));
  const line=mk({...p,shape:{type:'line',vertices:[pos(p.latitude,p.longitude),pos(p.latitude+.002,p.longitude)]}},'line');
  const area=mk({...p,shape:{type:'area',vertices:[pos(p.latitude,p.longitude),pos(p.latitude+.0004,p.longitude),pos(p.latitude+.0004,p.longitude+.0004),pos(p.latitude,p.longitude+.0004)]}},'area');
  const run=async(entries,date)=>{const a=dailyBench.prepared,c=dailyBench.calls,d=dailyBench.dem,started=performance.now(),r=await MyPlacesUI.discoverySearch({...plan,at:date},entries,()=>true);
   return {ms:Math.round((performance.now()-started)*10)/10,prepared:dailyBench.prepared-a,solverCalls:dailyBench.calls-c,demCalls:dailyBench.dem-d,failed:r.failed,checked:r.checked||0,rows:r.rows.map(x=>[x.place.id,x.place.latitude,x.place.longitude,x.place.eyeHeightAGL,x.shapeType??null,x.event.at,x.event.side,x.event.intersects])};};
  const cold=await run(points,at),adjacent=await run(points,at+86400000),repeat=await run(points,at);
  const shapeCold=await run([line,area],at),shapeAdjacent=await run([line,area],at+86400000),shapeRepeat=await run([line,area],at);
  return {cold,adjacent,repeat,shapeCold,shapeAdjacent,shapeRepeat,version:document.querySelector('meta[name=app-version]').content};
 },at);
}
async function shared(page){
 const ready=()=>page.waitForFunction(()=>document.querySelector('#recordOpportunities')?.getAttribute('aria-busy')==='false'&&!document.querySelector('#recordOpportunities').hidden);
 await page.evaluate(()=>{
  const f={...dailyBench.p,id:'share-p',recordRegistered:true};favorites=[f];store.set('sorami.favorites',favorites);
  const t=dailyBench.target;store.set(AstroNotesLibrary.keys(auth.loginId).observations,[{id:'share-r',placeId:f.id,target:{key:t.id,name:t.name,latitude:t.latitude,longitude:t.longitude},observer:{latitude:f.latitude,longitude:f.longitude,elevation:f.elevation,eyeHeightAGL:1.5},result:'seen',registration:true,createdAt:1,updatedAt:1}]);MyPlacesUI.imported();
 });
 await page.locator('#notebookOpportunitiesTab').click();await ready();await choose(page,'Body','moon');await ready();
 await page.locator('#recordOpportunityDate').fill('2026-11-25');await ready();
 assert(await page.locator('[data-opportunity-id]').count()>0);
 const d=await page.evaluate(async at=>{
  const plan={target:dailyBench.target,body:'moon',at,partId:'__whole',limb:'center',matchMode:'overlap'},points=MyPlacesUI.discoveryPoints(),before=dailyBench.calls;
  const r=await MyPlacesUI.discoverySearch(plan,points,()=>true),first=dailyBench.calls-before,again=dailyBench.calls;
  await MyPlacesUI.discoverySearch(plan,points,()=>true);const reused=dailyBench.calls-again;
  aimAirSettings.dailyPerf=1;const earlier=dailyBench.calls;const afterAir=await MyPlacesUI.discoverySearch(plan,points,()=>true);delete aimAirSettings.dailyPerf;
  return {first,reused,newAfterAir:dailyBench.calls-earlier,rows:r.rows.length,airRows:afterAir.rows.length};
 },at);
 // 2026-11-10 重なる日 computes in its own engine with the geometric model (no refraction); Explore keeps the
 // app's atmosphere. Explore therefore computes the day/point once itself and reuses that for the same input.
 assert.equal(d.first,1,'Explore computes the day/point with its own atmosphere');
 assert.equal(d.reused,0,'the same exact day/point is reused by the Explore port');
 assert.equal(d.newAfterAir,1,'a changed atmosphere does not reuse numerical results');assert(d.rows>0);
 return d;
}
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  let old;
  if(baseline){const f=await fixture(browser,baseline);try{old=await calculate(f.page,at);f.verify();}finally{await f.c.close();}}
  const f=await fixture(browser,base);
  try{
   const current=await calculate(f.page,at);
   for(const k of ['cold','adjacent','repeat','shapeCold','shapeAdjacent','shapeRepeat']){
    assert.equal(current[k].failed,0,k);if(old){assert.equal(old[k].failed,0,k);assert.deepEqual(current[k].rows,old[k].rows,k+' keeps exact numerical rows');}
   }
   assert(current.cold.rows.length>0);assert(current.shapeCold.rows.length>0);
   assert.equal(current.adjacent.prepared,0);assert.equal(current.repeat.solverCalls,0);
   assert.equal(current.shapeAdjacent.prepared,0);assert.equal(current.shapeAdjacent.demCalls,0);assert.equal(current.shapeRepeat.solverCalls,0);
   const reuse=await shared(f.page);f.verify();const report={old,current,crossScreen:reuse,externalWrites:0};
   fs.writeFileSync(out,JSON.stringify(report,null,2));
   const compact=x=>x?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,typeof v==='object'?{...v,rows:v.rows.length}:v])):null;
   console.log(JSON.stringify({before:compact(old),after:compact(current),crossScreen:reuse}));
  }finally{await f.c.close();}
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
