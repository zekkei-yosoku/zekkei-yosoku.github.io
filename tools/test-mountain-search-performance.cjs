// Exact old/new comparison of the real Fuji + Skytree OR search, using frozen GSI PNGs.
// First collect with MOUNTAIN_COLLECT=1; measured runs forbid network tile misses.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const baseline=process.env.MOUNTAIN_BASELINE||'http://127.0.0.1:8998/trial/index.html';
const current=process.env.MOUNTAIN_BASE||'http://127.0.0.1:8997/trial/index.html';
const output=process.env.MOUNTAIN_OUT||'/tmp/astronotes-mountain-search.json';
const fixtureDir=process.env.MOUNTAIN_DEM||'/tmp/astronotes-mountain-dem-fixture';
const engine=process.env.MOUNTAIN_ENGINE||'chrome',count=Number(process.env.MOUNTAIN_POINTS||174),rounds=Number(process.env.MOUNTAIN_ROUNDS||3);
const firstRound=Number(process.env.MOUNTAIN_START_ROUND||0);
const collect=process.env.MOUNTAIN_COLLECT==='1',collectOnly=process.env.MOUNTAIN_COLLECT_ONLY==='1';
const grants=['records','tower','diamond','pearl','skymap','multiscene'];
const tilePattern=/^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/(dem1a_png|dem5a_png|dem5b_png|dem5c_png|dem_png)\/\d+\/\d+\/\d+\.png$/;
const manifestFile=path.join(fixtureDir,'manifest.json');
fs.mkdirSync(fixtureDir,{recursive:true});
const manifest=fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile,'utf8')):{};
const pending=new Map();let fetched=0;
async function tile(route,mayCollect,missing){
 const url=route.request().url(),key=crypto.createHash('sha256').update(url).digest('hex');
 if(!manifest[url]){
  if(!mayCollect){missing.add(url);return route.abort();}
  if(!pending.has(url))pending.set(url,(async()=>{
   assert.equal(route.request().method(),'GET');
   const response=await route.fetch({timeout:30000,maxRetries:1});
   const status=response.status();assert([200,404].includes(status),'unexpected DEM status '+status+' '+url);
   const body=await response.body();
   if(status===200)assert(body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'DEM must be a PNG');
   fs.writeFileSync(path.join(fixtureDir,key+'.bin'),body);
   manifest[url]={file:key+'.bin',status,sha256:crypto.createHash('sha256').update(body).digest('hex'),bytes:body.length};
   fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2));fetched++;
  })().finally(()=>pending.delete(url)));
  await pending.get(url);
 }
 const item=manifest[url],body=fs.readFileSync(path.join(fixtureDir,item.file));
 assert.equal(crypto.createHash('sha256').update(body).digest('hex'),item.sha256,'fixture integrity '+url);
 return route.fulfill({status:item.status,body,headers:{'content-type':item.status===200?'image/png':'text/plain','access-control-allow-origin':'*','cache-control':'public,max-age=2592000'}});
}
async function run(browser,url,{mayCollect=false,profileName=null}={}){
 const context=await browser.newContext({locale:'ja-JP',timezoneId:'Asia/Tokyo',viewport:{width:390,height:900},reducedMotion:'reduce'});
 let writes=0,tileRequests=0;const errors=[],routeErrors=[],missing=new Set();
 await context.addInitScript(grants=>{sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-mountain-perf',loginId:'mountain-perf',tools:grants}));Date.now=()=>Date.parse('2026-11-07T16:29:00+09:00');},grants);
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin===new URL(url).origin)return route.continue();
  if(tilePattern.test(u.href)){tileRequests++;try{return await tile(route,mayCollect,missing);}catch(e){routeErrors.push(String(e));return route.abort();}}
  if(/zekkei-api|localhost:8787/.test(u.origin)){
   if(!['GET','OPTIONS'].includes(route.request().method()))writes++;
   return route.fulfill({json:{allowed:true,tool:'skymap',loginId:'mountain-perf',tools:grants,favorites:[],records:[],sightings:[],rev:1}});
  }
  return route.abort();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(120000);
 try{
  await page.goto(url+'#/records');await page.waitForFunction(()=>typeof MyPlacesUI==='object'&&typeof SkyMapUI==='object'&&typeof AstroNotesTrialOverlap==='object');
  await page.evaluate(async()=>{
   await startupSessionReady;await AstroNotesAssets.ensureModels();AstroNotesAtmosphere.configure('standard');
   RecordSync.kick=()=>{};RecordSync.touched=()=>{};accountSync().syncNow=async()=>{};accountSync().queuePush=()=>{};
   // Ground height is part of the saved synthetic place; ridge elevations are actual frozen GSI data.
   AstroNotesTerrain.groundElevation=async()=>87.2;
  });
  const cdp=profileName&&engine==='chrome'?await context.newCDPSession(page):null;
  if(cdp){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
  const result=await page.evaluate(async count=>{
   const day=s=>Date.parse(s+'T00:00:00+09:00'),fuji=aimTargetList().find(t=>t.id==='fuji'),skytree=aimTargetList().find(t=>t.id==='skytree');
   if(!fuji||!skytree)throw Error('required fixture targets unavailable');
   const p={name:'比較用地点',latitude:35.58386,longitude:139.56853,elevation:87.2,groundManualM:87.2,eyeHeightAGL:1.5,standAglM:1.5,stand:'ground'};
   const entry=(place,id)=>({place:{...place,id},record:{result:'seen'}});
   const soya={...p,latitude:35.73874,longitude:139.90204,elevation:5,groundManualM:5,eyeHeightAGL:20,standAglM:20};
   const points=Array.from({length:count},(_,i)=>{const base=i<Math.ceil(count/2)?p:soya,j=i%Math.ceil(count/2);return entry({...base,latitude:base.latitude+(j%24)*.0004,longitude:base.longitude+Math.floor(j/24)*.0007},'point-'+i);});
   const range=[entry({...soya,eyeHeightRangeAGL:{min:20,max:150}},'height-range')];
   const results={},ridgeCounters={calls:0,ms:0,points:0};
   const originalElevations=AstroNotesTerrain.elevations;
   AstroNotesTerrain.elevations=async(...args)=>{const started=performance.now();ridgeCounters.calls++;ridgeCounters.points+=args[0].length;try{return await originalElevations(...args);}finally{ridgeCounters.ms+=performance.now()-started;}};
   const search=async(name,date,{cancelAfter=Infinity,entries=points}={})=>{
    const plan={target:fuji,body:'sun',at:day(date),partId:null,limb:'center',matchMode:'overlap',overlapMembers:[{target:fuji,partId:null,profile:'summit-contact'},{target:skytree,partId:'__whole',profile:'building-near'}]};
    const started=performance.now(),heapBeforeBytes=performance.memory?.usedJSHeapSize??null,before={...ridgeCounters},progress=[],members=[];let checked=0,member=0,live=true,heartbeat=0,maxPauseMs=0,last=started;
    const timer=setInterval(()=>{const now=performance.now();maxPauseMs=Math.max(maxPauseMs,now-last);last=now;heartbeat++;},16);
    let value;
    try{
     value=await AstroNotesTrialOverlap.discovery(plan,async memberPlan=>{
      const index=member++,offset=index*entries.length,t=performance.now();
      const r=await MyPlacesUI.discoverySearch(memberPlan,entries,()=>live,undefined,s=>{
       checked=offset+s.checked;progress.push({checked,total:entries.length*2,ms:performance.now()-started});
       if(checked>=cancelAfter)live=false;
      });
      members.push({id:memberPlan.target.id,ms:performance.now()-t,rows:r.rows?.length??0});return r;
     });
    }finally{clearInterval(timer);maxPauseMs=Math.max(maxPauseMs,performance.now()-last);}
    results[name]={ms:performance.now()-started,heapBeforeBytes,heapAfterBytes:performance.memory?.usedJSHeapSize??null,value,progress,members,heartbeat,maxPauseMs,terrain:{calls:ridgeCounters.calls-before.calls,points:ridgeCounters.points-before.points,ms:ridgeCounters.ms-before.ms}};
   };
   await search('sunAll','2026-11-07');
   await search('sunNextDay','2026-11-08');
   await search('sunRepeat','2026-11-07');
   await search('sunHeightRange','2026-11-07',{entries:range});
   // A fresh day permits one completed entry, then cancellation must discard the partial union.
   await search('cancel','2026-11-09',{cancelAfter:1});
   await search('afterCancel','2026-11-09',{entries:points.slice(0,1)});
   return {results,version:document.querySelector('meta[name=app-version]').content};
  },count);
  if(cdp){const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync(profileName,JSON.stringify(profile));}
  assert.equal(writes,0);assert.deepEqual(errors,[]);assert.deepEqual(routeErrors,[]);assert.deepEqual([...missing],[],'run MOUNTAIN_COLLECT=1 before measuring');
  assert.equal(result.results.cancel.value.cancelled,true);
  assert(result.results.sunHeightRange.value.rows.length>0,'height range includes a positive OR candidate');
  for(const [name,r]of Object.entries(result.results)){
   if(name==='cancel')continue;
   assert.equal(r.value.failed,0,name+' complete');
   assert.equal(r.value.cancelled,undefined,name+' not cancelled');
   assert.equal(r.progress.at(-1)?.checked,(['afterCancel','sunHeightRange'].includes(name)?1:count)*2,name+' reaches all work');
  }
  return {...result,tileRequests,writes,errors};
 }finally{await context.close();}
}
module.exports={tile,tilePattern,grants,manifest};
if(require.main===module)(async()=>{
 const browser=await (engine==='webkit'?webkit:chromium).launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
 const report={engine,count,fixture:fixtureDir,fixtureUrls:0,externalWrites:0,memoryNote:'Chrome reported JS heap of the entire page, without forced GC; not an exact cache size. WebKit reports null.',rounds:[]};
 try{
  if(collect){
   // Collection time contains public network traffic and is deliberately excluded from the benchmark.
   const warmup=await run(browser,baseline,{mayCollect:true});
   fs.writeFileSync(output+'.collection.json',JSON.stringify({fetched,fixtureUrls:Object.keys(manifest).length,warmup},null,2));
   console.log(JSON.stringify({collection:true,fetched,fixtureUrls:Object.keys(manifest).length,results:Object.fromEntries(Object.entries(warmup.results).map(([name,r])=>[name,{ms:r.ms,rows:r.value.rows?.length??0,terrain:r.terrain,members:r.members,maxPauseMs:r.maxPauseMs}]))}));
  }
  if(collectOnly)return;
  for(let i=0;i<rounds;i++){
   let before,after;
   const opts=side=>({profileName:process.env.MOUNTAIN_PROFILE==='1'&&i===0?output+'.'+side+'.cpuprofile':null});
   if((i+firstRound)%2){after=await run(browser,current,opts('after'));before=await run(browser,baseline,opts('before'));}
   else{before=await run(browser,baseline,opts('before'));after=await run(browser,current,opts('after'));}
   for(const name of Object.keys(before.results))assert.deepEqual(after.results[name].value,before.results[name].value,name+' full numerical result');
   report.rounds.push({before,after});report.fixtureUrls=Object.keys(manifest).length;
   fs.writeFileSync(output,JSON.stringify(report,null,2));
   console.log(JSON.stringify({round:i+firstRound+1,results:Object.fromEntries(Object.keys(before.results).map(name=>[name,{beforeMs:Math.round(before.results[name].ms),afterMs:Math.round(after.results[name].ms),rows:after.results[name].value.rows?.length??0,beforeTerrainCalls:before.results[name].terrain.calls,afterTerrainCalls:after.results[name].terrain.calls}]))}));
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
