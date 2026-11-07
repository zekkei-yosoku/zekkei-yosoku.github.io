// Real Explore lifecycle with 174 saved places and two targets (348 work items).
// Uses only the frozen GSI fixture produced by test-mountain-search-performance.cjs.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const {tile,tilePattern,grants}=require('./test-mountain-search-performance.cjs');
const beforeURL=process.env.MOUNTAIN_BASELINE||'http://127.0.0.1:8998/trial/index.html';
const afterURL=process.env.MOUNTAIN_BASE||'http://127.0.0.1:8997/trial/index.html';
const count=Number(process.env.MOUNTAIN_POINTS||174),engine=process.env.MOUNTAIN_ENGINE||'chrome';
const out=process.env.MOUNTAIN_UI_OUT||'/tmp/astronotes-mountain-ui';fs.mkdirSync(out,{recursive:true});
async function run(browser,url,label){
 const context=await browser.newContext({locale:'ja-JP',timezoneId:'Asia/Tokyo',viewport:{width:390,height:900},colorScheme:'dark',reducedMotion:'reduce'});
 let writes=0;const errors=[],missing=new Set(),routeErrors=[];
 await context.addInitScript(grants=>{sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-mountain-ui',loginId:'mountain-ui',tools:grants}));Date.now=()=>Date.parse('2026-11-07T16:29:00+09:00');},grants);
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin===new URL(url).origin)return route.continue();
  if(tilePattern.test(u.href)){try{return await tile(route,false,missing);}catch(e){routeErrors.push(String(e));return route.abort();}}
  if(/zekkei-api|localhost:8787/.test(u.origin)){
   if(!['GET','OPTIONS'].includes(route.request().method()))writes++;
   return route.fulfill({json:{allowed:true,tool:'skymap',loginId:'mountain-ui',tools:grants,favorites:[],records:[],sightings:[],rev:1}});
  }
  return route.abort();
 });
 const page=await context.newPage();page.setDefaultTimeout(180000);page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(url+'#/almanac');await page.waitForFunction(()=>typeof MyPlacesUI==='object'&&typeof SkyMapUI==='object'&&globalThis.AstroNotesTrialOverlap);
  await page.evaluate(async()=>{
   await startupSessionReady;await AstroNotesAssets.ensureModels();AstroNotesAtmosphere.configure('standard');
   RecordSync.touched=()=>{};RecordSync.kick=()=>{};accountSync().queuePush=()=>{};accountSync().syncNow=async()=>{};
   AstroNotesTerrain.groundElevation=async()=>87.2;groundAt=async()=>87.2;
   navigationHistory.pushRoute('#/explore');await SkyMapUI.open();
  });
  await page.locator('#exploreShowResult').waitFor({state:'visible'});
  await page.evaluate(()=>{
   aimSetSceneExtras(['skytree']);SkyMapUI.setTarget('fuji');store.set('sorami.sceneOverlap:'+encodeURIComponent(auth.loginId),{all:true});
   const body=document.getElementById('skyMapBody');body.value='sun';body.onchange();
   SkyMapUI.setTime(Date.parse('2026-11-07T16:29:00+09:00'));SkyMapUI.render();AstroNotesTrialOverlap.sync();
  });
  assert.equal(await page.evaluate(()=>AstroNotesTrialOverlap.isAll()),true);
  assert.deepEqual(await page.evaluate(()=>AstroNotesTrialOverlap.members().map(t=>t.id)),['fuji','skytree']);
  assert.match(await page.locator('#skyMapTargetOpen').innerText(),/富士山.*東京スカイツリー/);
  const cdp=process.env.MOUNTAIN_PROFILE==='1'&&engine==='chrome'?await context.newCDPSession(page):null;
  if(cdp){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
  const measured=await page.evaluate(async count=>{
   const p={name:'比較用地点',latitude:35.58386,longitude:139.56853,elevation:87.2,groundManualM:87.2,eyeHeightAGL:1.5,standAglM:1.5,stand:'ground'},soya={...p,latitude:35.73874,longitude:139.90204,elevation:5,groundManualM:5,eyeHeightAGL:20,standAglM:20};
   favorites=Array.from({length:count},(_,i)=>{const base=i<Math.ceil(count/2)?p:soya,j=i%Math.ceil(count/2);return {...base,id:'point-'+i,name:(base===p?'鷺沼':'曽谷')+' '+i,latitude:base.latitude+(j%24)*.0004,longitude:base.longitude+Math.floor(j/24)*.0007,recordRegistered:true};});
   store.set('sorami.favorites',favorites);
   const targets=aimTargetList().filter(t=>['fuji','skytree'].includes(t.id));
   const records=favorites.flatMap(f=>targets.map(t=>({id:f.id+'-'+t.id,placeId:f.id,target:{key:t.id,name:t.name,latitude:t.latitude,longitude:t.longitude},observer:{latitude:f.latitude,longitude:f.longitude,elevation:f.elevation,eyeHeightAGL:f.eyeHeightAGL},result:'seen',registration:true,date:'',note:'',createdAt:1,updatedAt:1})));
   store.set(AstroNotesLibrary.keys(auth.loginId).observations,records);
   const original=MyPlacesUI.discoverySearch,measure={progress:[],members:[],currentCalls:0,firstBusy:null,finished:null},host=document.getElementById('exploreRecordedPlaces');
   const started=performance.now(),heapBeforeBytes=performance.memory?.usedJSHeapSize??null;
   MyPlacesUI.discoverySearch=async(plan,points,current,terrain,onProgress)=>{
    const t=performance.now();
    const value=await original(plan,points,()=>{measure.currentCalls++;return current();},terrain,s=>{measure.progress.push({target:plan.target.id,checked:s.checked,total:s.total,ms:performance.now()-started});onProgress?.(s);});
    measure.members.push({target:plan.target.id,ms:performance.now()-t,value});return value;
   };
   await new Promise((resolve,reject)=>{
    const observer=new MutationObserver(()=>{
     const busy=host.getAttribute('aria-busy')==='true';
     if(busy&&measure.firstBusy===null)measure.firstBusy=performance.now()-started;
     if(measure.firstBusy!==null&&!busy){measure.finished=performance.now()-started;observer.disconnect();clearTimeout(timer);resolve();}
    });
    const timer=setTimeout(()=>{observer.disconnect();reject(Error('real UI did not finish'));},180000);
    observer.observe(host,{attributes:true,attributeFilter:['aria-busy']});MyPlacesUI.imported();
   });
   MyPlacesUI.discoverySearch=original;
   return {...measure,heapBeforeBytes,heapAfterBytes:performance.memory?.usedJSHeapSize??null,points:MyPlacesUI.discoveryPoints().length,rows:[...document.querySelectorAll('#exploreRecordedResults .explore-record-row')].map(n=>n.innerText),status:host.innerText,version:document.querySelector('meta[name=app-version]').content};
  },count);
  if(cdp){const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync(out+'/'+engine+'-'+label+'.cpuprofile',JSON.stringify(profile));}
  assert.equal(measured.points,count);assert.equal(measured.members.length,2);
  assert.deepEqual(measured.members.map(m=>m.target),['fuji','skytree']);
  assert.equal(measured.progress.length,count*2);assert(measured.rows.length>0);
  assert(measured.members.every(m=>!m.value.cancelled&&!m.value.failed));
  assert.equal(await page.locator('#exploreRecordedPlaces').getAttribute('aria-busy'),'false');
  assert.deepEqual(errors,[]);assert.deepEqual(routeErrors,[]);assert.deepEqual([...missing],[]);assert.equal(writes,0);
  // Capture the native viewport before fullPage temporarily resizes Chromium's layout viewport.
  await page.screenshot({path:out+'/'+engine+'-'+label+'-viewport.png'});
  await page.screenshot({path:out+'/'+engine+'-'+label+'.png',fullPage:true});
  let retainedHeapBytes=null;
  if(engine==='chrome'){const heap=await context.newCDPSession(page);await heap.send('HeapProfiler.collectGarbage');retainedHeapBytes=(await heap.send('Runtime.getHeapUsage')).usedSize;await heap.detach();}
  return {...measured,retainedHeapBytes,writes,errors};
 }catch(e){await page.screenshot({path:out+'/'+engine+'-'+label+'-failure.png',fullPage:true}).catch(()=>{});throw e;}
 finally{await context.close();}
}
(async()=>{
 const browser=await(engine==='webkit'?webkit:chromium).launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
 try{
  const before=process.env.MOUNTAIN_UI_ONLY==='after'?null:await run(browser,beforeURL,'before'),after=await run(browser,afterURL,'after');
  if(before){assert.deepEqual(after.members.map(m=>m.value),before.members.map(m=>m.value),'all numerical UI results');assert.deepEqual(after.rows,before.rows,'visible rows');}
  fs.writeFileSync(out+'/'+engine+'.json',JSON.stringify({engine,count,memoryNote:'Timing uses whole-page heap without forced GC; retainedHeapBytes is a separate CDP measurement after completion/screenshots and explicit GC. Neither is an exact cache size. WebKit reports null.',before,after},null,2));
  console.log(JSON.stringify({engine,count,beforeMs:before?.finished,afterMs:after.finished,beforeCurrentCalls:before?.currentCalls,afterCurrentCalls:after.currentCalls,rows:after.rows.length}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
