// Compare complete numerical search results with a separate, unchanged release.
// Synthetic account only; all external I/O is blocked and terrain is deterministic.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const baseline=process.env.EXACT_BASELINE||'http://127.0.0.1:8998/trial/index.html';
const current=process.env.EXACT_BASE||'http://127.0.0.1:8997/trial/index.html';
const output=process.env.EXACT_OUT||'/tmp/astronotes-exact-search.json';
const engine=process.env.EXACT_ENGINE||'chrome',rounds=Number(process.env.EXACT_ROUNDS||3),count=Number(process.env.EXACT_POINTS||174);
const grants=['records','tower','diamond','pearl','skymap','multiscene'];
async function run(browser,url,profile=false){
 const context=await browser.newContext({locale:'ja-JP',timezoneId:'Asia/Tokyo',viewport:{width:390,height:900},reducedMotion:'reduce'});
 let writes=0;const errors=[];
 await context.addInitScript(grants=>{sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-exact-perf',loginId:'exact-perf',tools:grants}));Date.now=()=>Date.parse('2026-11-06T09:02:00+09:00');},grants);
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===new URL(url).origin)return route.continue();if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(route.request().method()))writes++;return route.fulfill({json:{allowed:true,tool:'skymap',loginId:'exact-perf',tools:grants,favorites:[],records:[],sightings:[],rev:1}});}return route.abort();});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(120000);
 try{
  await page.goto(url+'#/records');await page.waitForFunction(()=>typeof MyPlacesUI==='object'&&typeof SkyMapUI==='object');
  await page.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();AstroNotesAtmosphere.configure('standard');RecordSync.kick=()=>{};RecordSync.touched=()=>{};accountSync().syncNow=async()=>{};accountSync().queuePush=()=>{};AstroNotesTerrain.groundElevation=async()=>87.2;});
  const cdp=profile&&engine==='chrome'?await context.newCDPSession(page):null;
  if(cdp){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
  const result=await page.evaluate(async count=>{
   const day=s=>Date.parse(s+'T00:00:00+09:00'),target=aimTargetList().find(t=>t.id==='skytree');
   const p={name:'比較用地点',latitude:35.58386,longitude:139.56853,elevation:87.2,groundManualM:87.2,eyeHeightAGL:1.5,standAglM:1.5,stand:'ground'};
   const entry=(place,id)=>({place:{...place,id},record:{result:'seen'}});
   const points=Array.from({length:count},(_,i)=>entry({...p,latitude:p.latitude+(i%24)*.0004,longitude:p.longitude+Math.floor(i/24)*.0007},'point-'+i));
   const position=(latitude,longitude)=>({latitude,longitude});
   const line=entry({...p,shape:{type:'line',vertices:[position(p.latitude,p.longitude),position(p.latitude+.002,p.longitude)]}},'line');
   const area=entry({...p,shape:{type:'area',vertices:[position(p.latitude,p.longitude),position(p.latitude+.0004,p.longitude),position(p.latitude+.0004,p.longitude+.0004),position(p.latitude,p.longitude+.0004)]}},'area');
   const range=entry({...p,latitude:35.73874,longitude:139.90204,elevation:5,groundManualM:5,eyeHeightAGL:20,standAglM:20,eyeHeightRangeAGL:{min:20,max:150}},'height-range');
   const results={};
   const search=async(name,body,date,entries,extra={})=>{
    const t=performance.now(),r=await MyPlacesUI.discoverySearch({target,body,at:day(date),partId:'__whole',limb:'center',matchMode:'overlap',...extra},entries,()=>true);
    // Include every event number, chosen coordinate/height, verification and incompleteness status.
    results[name]={ms:performance.now()-t,value:r};
   };
   await search('moonPoints','moon','2026-11-25',points);
   await search('moonNextDay','moon','2026-11-26',points);
   await search('moonRepeat','moon','2026-11-25',points);
   await search('sunPoints','sun','2026-11-07',points);
   await search('moonShapes','moon','2026-11-25',[line,area]);
   await search('sunHeightRange','sun','2026-11-07',[range]);
   AstroNotesAtmosphere.configure('manual',{pressureHPa:990,temperatureC:25});
   await search('changedAir','moon','2026-11-25',points.slice(0,3));
   await search('changedPoint','moon','2026-11-25',[entry({...p,latitude:35.59,longitude:139.56,eyeHeightAGL:80,standAglM:80},'point-0')]);
   AstroNotesAtmosphere.configure('standard');
   await search('restoredAir','moon','2026-11-25',points.slice(0,3));
   return {results,version:document.querySelector('meta[name=app-version]').content};
  },count);
  if(cdp){const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync(output+'.cpuprofile',JSON.stringify(profile));}
  assert.equal(writes,0);assert.deepEqual(errors,[]);return result;
 }finally{await context.close();}
}
(async()=>{
 const browser=await (engine==='webkit'?webkit:chromium).launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
 const report={engine,count,rounds:[],externalWrites:0};
 try{
  for(let i=0;i<rounds;i++){
   let before,after;
   // Alternate execution order to reduce warmup/thermal bias; each uses a fresh context.
   if(i%2){after=await run(browser,current);before=await run(browser,baseline);}
   else{before=await run(browser,baseline,process.env.EXACT_PROFILE==='1');after=await run(browser,current);}
   for(const key of Object.keys(before.results)){
    assert.deepEqual(after.results[key].value,before.results[key].value,key+' exact full result');
    assert.equal(after.results[key].value.failed,0,key+' complete');
   }
   assert(after.results.moonPoints.value.rows.length>0);
   assert(after.results.moonShapes.value.rows.length>0);
   const height=after.results.sunHeightRange.value.rows[0]?.place.eyeHeightAGL;
   assert(height>90&&height<105,'range still chooses the verified fitted height');
   report.rounds.push({before,after});fs.writeFileSync(output,JSON.stringify(report,null,2));
   console.log(JSON.stringify({round:i+1,results:Object.fromEntries(Object.keys(before.results).map(k=>[k,{beforeMs:Math.round(before.results[k].ms),afterMs:Math.round(after.results[k].ms),rows:after.results[k].value.rows.length}]))}));
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
