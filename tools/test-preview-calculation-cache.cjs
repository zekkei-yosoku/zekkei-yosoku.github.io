// Exact preview reuse through the normal lens change handler. Synthetic read-only
// ports isolate calculation/rendering; no surveyed visibility claim is made.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.PREVIEW_CACHE_BASE||'http://127.0.0.1:8997/trial/';
const out=process.env.PREVIEW_CACHE_OUT||'/tmp/astronotes-preview-calculation-cache';
const grants=['records','tower','diamond','pearl','skymap','multiscene'];
const initialAt=Date.parse('2026-11-25T16:52:07+09:00');
const initialObserver={latitude:35.58386,longitude:139.56853,elevation:87.2,eyeHeightAGL:1.5,standAglM:1.5,name:'合成読取・計算再利用の確認地点'};
const hms=at=>new Date(at+9*3600000).toISOString().slice(11,19);

async function prepare(page){
 await page.goto(base+'index.html#/explore');
 await page.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof aimTargetList==='function'&&typeof AstroNotesAssets==='object'&&AstroNotesAssets.modelsReady());
 await page.evaluate(async({observer,at})=>{
  await startupSessionReady;await AstroNotesAssets.ensureModels();
  groundAt=async()=>observer.elevation;aimBuildingDays=async()=>[];
  aimAirSettings.mode='standard';AstroNotesAtmosphere.configure('standard',aimAirSettings);
  AstroNotesCandidatePicker.hiddenView=async()=>({read:true,note:null});
  AstroNotesCandidatePicker.skylineView=async(_o,_t,azimuths)=>azimuths.map(()=>({angle:-Infinity,complete:true}));
  aimLookRidge=async(o,_eye,t)=>{const az=AstroNotesTerrain.bearing(o.latitude,o.longitude,t.latitude,t.longitude);return [[az-2,0],[az,1],[az+2,0]];};
  aimTerrainFront=async()=>({ridge:[],block:null});aimTerrainBeyond=async()=>[];
  const f=window.previewCacheFixture={renders:0,mapRenders:0,counts:{dayPath:0,edgePath:0,framePath:0,scene:0},calls:[],modelsKey:null};
  const skyRender=MyPlacesUI.skyRender;
  MyPlacesUI.skyRender=function(...args){f.mapRenders++;return skyRender.apply(this,args);};
  for(const name of ['viewPath','frameDayPath','sceneTargets']){
   const original=AstroNotesAlign[name];
   AstroNotesAlign[name]=function(...args){
    const result=original.apply(this,args);
    const kind=name==='viewPath'?(Number.isFinite(args[5]?.dayMs)?'dayPath':'edgePath'):name==='frameDayPath'?'framePath':'scene';
    f.counts[kind]++;
    if(kind!=='edgePath'){
     const observer=kind==='scene'?args[0]:args[1],options=kind==='scene'?args[2]:kind==='dayPath'?args[5]:args[4];
     f.calls.push({kind,at:kind==='scene'?null:args[2],day:kind==='dayPath'?options.dayMs:null,
      observer:{latitude:observer.latitude,longitude:observer.longitude,elevation:observer.elevation},eyeM:options?.eyeM,
      samples:result.length,firstAt:result[0]?.at,lastAt:result.at(-1)?.at,
      geometry:kind==='scene'?result.map(q=>({id:q.target.id,azimuth:q.azimuth,topAngle:q.topAngle,distanceKm:q.distanceKm})):undefined});
    }
    return result;
   };
  }
  new MutationObserver(rows=>{f.renders+=rows.filter(r=>r.target.matches?.('[data-look-canvas]')&&r.attributeName==='aria-label').length;})
   .observe(document.getElementById('aimLook'),{subtree:true,attributes:true,attributeFilter:['aria-label']});
  const target=aimTargetList().find(t=>t.id==='skytree');if(!target)throw Error('skytree missing');
  SkyMapUI.workspaceHost().restoreTarget({target:structuredClone(target),custom:false});
  SkyMapUI.workspaceHost().restoreObserver(structuredClone(observer));
  const body=document.getElementById('skyMapBody');body.value='moon';body.dispatchEvent(new Event('change',{bubbles:true}));
  SkyMapUI.setTime(at);
 },{observer:initialObserver,at:initialAt});
 await page.locator('#exploreShowResult').click();await ready(page,0,initialAt);
}

async function ready(page,previous,at){
 await page.waitForFunction(({previous,at})=>{
  const canvas=document.querySelector('#aimLook [data-look-canvas]');
  if(previewCacheFixture.renders<=previous||!canvas?.getClientRects().length||SkyMapUI.selectionState().at!==at)return false;
  const time=new Date(at+9*3600000).toISOString().slice(11,19);
  return canvas.getAttribute('aria-label')?.includes(time)&&document.querySelector('#aimLook [data-look-at]').textContent.includes(time);
 },{previous,at});
 // Synthetic reader promises and the canvas MutationObserver must both settle.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}

async function action(page,fn,arg,at){
 const previous=await page.evaluate(()=>previewCacheFixture.renders);
 await page.evaluate(fn,arg);await ready(page,previous,at);
}

async function lens(page,focal,at){
 await action(page,value=>{const input=document.querySelector('#aimLook [data-lens-focal]');input.value=String(value);input.onchange();},focal,at);
}

async function measure(page,label,at){
 const row=await page.evaluate(()=>{
  const canvas=document.querySelector('#aimLook [data-look-canvas]'),data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  let hash=2166136261,opaque=0;for(let i=0;i<data.length;i++){hash=Math.imul(hash^data[i],16777619);if(i%4===3&&data[i]>0)opaque++;}
  const s=SkyMapUI.selectionState();
  return {counts:{...previewCacheFixture.counts},renders:previewCacheFixture.renders,at:s.at,
   observer:s.observer,target:s.target.id,canvas:{width:canvas.width,height:canvas.height,hash:(hash>>>0).toString(16),opaque},
   aria:canvas.getAttribute('aria-label'),shownTime:document.querySelector('#aimLook [data-look-at]').textContent,
   frameTimes:document.querySelector('#aimLook [data-look-frame-times]').textContent,
   lens:document.querySelector('#aimLook [data-lens-info]').textContent,
   atmosphere:AstroNotesAtmosphere.mode(),atmosphereKey:AstroNotesAtmosphere.dataKey(),
   recentCalls:previewCacheFixture.calls.slice(-6)};
 });
 assert.equal(row.at,at,label+': selected time is exact');
 assert(row.shownTime.includes(hms(at)),label+': displayed time is current: '+row.shownTime);
 assert(row.aria.includes(hms(at)),label+': accessible canvas time is current: '+row.aria);
 assert(row.canvas.opaque>1000,label+': canvas is rendered');
 assert.match(row.frameTimes,/画角内/,label+': frame passage text remains available');
 return {label,...row};
}

async function scrubMinutes(page,at,offsets=[5,30],changeWeather=false){
 const mapRenders=await page.evaluate(()=>{
  const look=document.getElementById('aimLook');
  previewCacheFixture.retained={lookSeq:look._lookSeq,layers:look._lookLayers,buildings:look._lookLayers.stats.buildings};
  return previewCacheFixture.mapRenders;
 });
 const check=await page.evaluate(({startAt,offsets,changeWeather})=>new Promise(resolve=>{
  const ruler=document.getElementById('skyMapTimeline'),look=document.getElementById('aimLook');
  const original=MyPlacesUI.skyRender,prepare=AstroNotesAlign.prepareDailyView,checks=[];
  const frameTimes=look.querySelector('[data-look-frame-times]'),initialDay=look._uiTime.day;
  let lastAt=startAt,position=ruler.scrollLeft;
  const move=offset=>{ruler.scrollLeft=position+offset;ruler.dispatchEvent(new Event('scroll'));};
  let renders=0,preparations=0;
  MyPlacesUI.skyRender=function(...args){renders++;return original.apply(this,args);};
  AstroNotesAlign.prepareDailyView=function(...args){preparations++;return prepare.apply(this,args);};
  const finish=()=>{
   watcher.disconnect();clearTimeout(timeout);
   MyPlacesUI.skyRender=original;AstroNotesAlign.prepareDailyView=prepare;
   resolve({frames:checks,renders,preparations,initialSky,initialDay,drawDay:look._uiTime.day,buildings:look._lookLayers.stats.buildings-initialBuildings});
  };
  const initialSky=look._lookSkyKey,initialBuildings=look._lookLayers.stats.buildings;
  const watcher=new MutationObserver(()=>{
   const at=Number(ruler.getAttribute('aria-valuenow'));
   if(at===lastAt)return;lastAt=at;
   const {observer,ground,eyeM}=SkyMapUI.renderState();
   const sun=AstroNotesAstro.sun(at,{latitude:observer.latitude,longitude:observer.longitude,elevation:ground+eyeM});
   const expectedSky=AstroNotesSceneAppearance.aimLookSky(sun.apparentAltitude).map(rgb=>rgb.join(',')).join('|');
   checks.push({at,drawnAt:look._lookAt,uiAt:look._uiTime.current,sky:look._lookSkyKey,expectedSky,
    barDate:document.getElementById('skyMapDate').value,frameTimesHidden:frameTimes.style.visibility==='hidden'});
   if(changeWeather&&checks.length===1){
    const dataKey=AstroNotesAtmosphere.dataKey;
    AstroNotesAtmosphere.dataKey=()=>dataKey()+'-new-weather';
    previewCacheFixture.restoreDataKey=()=>{AstroNotesAtmosphere.dataKey=dataKey;};
    TrialExplore.sync(false,true);
   }
   if(checks.length<offsets.length)move(offsets[checks.length]);else finish();
  });
  const timeout=setTimeout(finish,5000);
  watcher.observe(ruler,{attributes:true,attributeFilter:['aria-valuenow']});
  ruler.dispatchEvent(new Event('touchstart'));move(offsets[0]);
 }),{startAt:at,offsets,changeWeather});
 await page.locator('#skyMapTimeline').evaluate(ruler=>ruler.dispatchEvent(new Event('touchend')));
 assert.deepEqual(check.frames.map(frame=>frame.at),offsets.map(px=>at+px*15000));
 for(const frame of check.frames){
  assert.equal(frame.drawnAt,frame.at,'scene follows the same update as the ruler, including seconds');
  assert.equal(frame.uiAt,frame.at);
  assert.equal(frame.sky,frame.expectedSky,'sky color is from the same instant as the body');
  const jst=new Date(frame.at+9*3600000).toISOString().slice(0,10);
  assert.equal(frame.barDate,jst,'footer date follows the time immediately when crossing midnight');
  assert.equal(frame.frameTimesHidden,Date.parse(jst+'T00:00:00+09:00')!==check.initialDay,'frame times are only visible for the current day');
 }
 if(check.frames[0].at<Date.parse('2026-11-25T20:00:00+09:00'))assert.notEqual(check.frames[1].sky,check.initialSky,'test moves through changing twilight');
 assert.equal(check.drawDay,check.initialDay,'daily trajectory is retained until the gesture settles');
 assert.equal(check.renders,0,'held gesture does not rerender the map workspace');
 assert.equal(check.preparations,0,'held gesture reuses the prepared overlap geometry');
 assert.equal(check.buildings,0,'held gesture leaves the building pixels cached');
 const snappedAt=at+Math.round(offsets.at(-1)/4)*60000;
 await page.waitForFunction(ms=>{
  const look=document.getElementById('aimLook'),ruler=document.getElementById('skyMapTimeline');
  const saved=JSON.parse(localStorage.getItem('sorami.skyMap:preview-cache'));
  return look._lookAt===ms&&look._uiTime.day===AstroNotesSkyMap.dayStart(ms)&&!look.querySelector('[data-look-frame-times]').style.visibility&&
   SkyMapUI.selectionState().at===ms&&+ruler.getAttribute('aria-valuenow')===ms&&saved?.at===ms;
 },snappedAt);
 assert.equal(await page.evaluate(()=>previewCacheFixture.mapRenders),mapRenders,'settling a minute gesture does not rebuild the hidden map workspace');
 const sameScene=await page.evaluate(()=>{
  const look=document.getElementById('aimLook'),saved=previewCacheFixture.retained;
  return look._lookSeq===saved.lookSeq&&look._lookLayers===saved.layers&&look._lookLayers.stats.buildings===saved.buildings&&look._planKey===aimLookKey();
 });
 assert(sameScene,'day change or weather arrival keeps the exact ground canvas and scene generation');
 if(changeWeather){
  await page.evaluate(()=>{previewCacheFixture.restoreDataKey();TrialExplore.sync(false,true);});
  await page.waitForFunction(()=>{try{TrialExplore.assertScene();return true;}catch{return false;}});
 }
 return snappedAt;
}

function reused(before,after,kinds=['dayPath','framePath','scene']){
 for(const kind of kinds)assert.equal(after.counts[kind],before.counts[kind],after.label+': no repeated '+kind+' calculation');
}
function invalidated(before,after,kinds){
 for(const kind of kinds)assert(after.counts[kind]>before.counts[kind],after.label+': recalculates '+kind+' after its input changes');
}

(async()=>{
 fs.mkdirSync(out,{recursive:true});const results=[];
 for(const [engine,type]of [['chrome',chromium],['webkit',webkit]].filter(([e])=>(process.env.PREVIEW_CACHE_ENGINES||'chrome,webkit').split(',').includes(e))){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,locale:'ja-JP',timezoneId:'Asia/Tokyo',colorScheme:'dark',reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];let writes=0,externalBlocked=0;page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(tools=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-ui',loginId:'preview-cache',tools})),grants);
  await context.route('**/*',r=>{
   const u=new URL(r.request().url());if(u.origin===new URL(base).origin)return r.continue();
   if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(r.request().method()))writes++;return r.fulfill({json:{allowed:true,tool:'skymap',loginId:'preview-cache',tools:grants,favorites:[],sightings:[],records:[],rev:1}});}
   externalBlocked++;return r.abort();
  });
  const rows=[];
  const record=async(label,at)=>{const row=await measure(page,label,at);rows.push(row);await page.locator('#aimLook [data-look-canvas]').screenshot({path:`${out}/${engine}-${label}.png`});return row;};
  try{
   await prepare(page);await lens(page,200,initialAt);const first=await record('first-200',initialAt);
   for(const kind of ['dayPath','framePath','scene'])assert(first.counts[kind]>0,'fixture observed '+kind);
   await lens(page,400,initialAt);const zoom=await record('zoom-400',initialAt);reused(first,zoom);assert.notEqual(zoom.canvas.hash,first.canvas.hash,'zoom changes projection');
   await lens(page,400,initialAt);const repeat=await record('repeat-400',initialAt);reused(zoom,repeat);assert.deepEqual(repeat.canvas,zoom.canvas,'identical render preserves the canvas pixels');assert.equal(repeat.frameTimes,zoom.frameTimes);
   await lens(page,200,initialAt);const back=await record('return-200',initialAt);reused(repeat,back);assert.deepEqual(back.canvas,first.canvas,'cached angular data is not mutated by projection');assert.equal(back.frameTimes,first.frameTimes);

   const minute=await scrubMinutes(page,initialAt);
   const later=await record('next-minute',minute);reused(back,later);
   assert.notEqual(later.canvas.hash,back.canvas.hash,'a new minute renders its current Moon and sky');

   await action(page,()=>{aimAirSettings.mode='none';AstroNotesAtmosphere.configure('none',aimAirSettings);document.querySelector('#aimLook [data-lens-focal]').onchange();},null,minute);
   const air=await record('atmosphere-none',minute);invalidated(later,air,['dayPath','framePath','scene']);assert.notEqual(air.atmosphereKey,later.atmosphereKey);assert.notEqual(air.canvas.hash,later.canvas.hash,'atmosphere invalidation updates visible geometry');
   await lens(page,200,minute);const airRepeat=await record('atmosphere-repeat',minute);reused(air,airRepeat);assert.deepEqual(airRepeat.canvas,air.canvas);

   const beforeMidnight=Date.parse('2026-11-25T23:58:07+09:00');
   await action(page,at=>SkyMapUI.setTime(at),beforeMidnight,beforeMidnight);
   const beforeGesture=await measure(page,'before-midnight',beforeMidnight);
   const sameDay=await scrubMinutes(page,beforeMidnight,[5,30,0]);
   assert.equal(sameDay,beforeMidnight,'moving across midnight and back retains the selected day on release');
   const backBeforeMidnight=await measure(page,'back-before-midnight',sameDay);reused(beforeGesture,backBeforeMidnight);
   const midnight=await scrubMinutes(page,beforeMidnight,[5,30],true);
   const nextDay=await record('next-day',midnight);invalidated(backBeforeMidnight,nextDay,['dayPath','framePath']);
   const detail=await page.evaluate(()=>{
    const more=document.getElementById('skyMapTimeMore'),s=SkyMapUI.renderState();
    const {observer,ground,eyeM,at}=s,eye={latitude:observer.latitude,longitude:observer.longitude,elevation:ground+eyeM};
    const moon=AstroNotesAstro.moon(at,eye);
    more.click();
    const dialog=document.querySelector('.sky-map-time-dialog'),result={open:dialog.open,actual:document.getElementById('skyMapAngles').textContent,expected:moon.geometricAltitude.toFixed(2)};
    dialog.close();return result;
   });
   assert(detail.open&&detail.actual.includes(detail.expected),'time details uses the settled day and exact current altitude');
   const dayCall=nextDay.recentCalls.filter(q=>q.kind==='dayPath').at(-1);assert.equal(dayCall.day,Date.parse('2026-11-26T00:00:00+09:00'),'day samples switch at JST midnight');

   await action(page,()=>{if(!SkyMapUI.setEyeHeight(11.5))throw Error('eye height change rejected');},null,midnight);
   const eye=await record('eye-11-5',midnight);invalidated(nextDay,eye,['dayPath','framePath','scene']);assert.equal(eye.recentCalls.filter(q=>q.kind==='scene').at(-1).eyeM,11.5);
   await action(page,()=>{const s=SkyMapUI.selectionState(),o=s.observer;SkyMapUI.setObserver({name:'合成読取・移動後の確認地点',latitude:o.latitude+.001,longitude:o.longitude,groundManualM:87.2,standAglM:11.5});},null,midnight);
   const moved=await record('observer-moved',midnight);invalidated(eye,moved,['dayPath','framePath','scene']);assert.notEqual(moved.observer.latitude,eye.observer.latitude);

   // Replacing a registry table with the same effective entries is harmless;
   // replacing the active entry must invalidate the angular geometry.
   await action(page,()=>{const city=AstroNotesAlign.CITY_MODELS;const key=city.skytree?'AstroNotesCityModels':'AstroNotesTowerModels';previewCacheFixture.modelsKey=key;globalThis[key]={...globalThis[key]};document.querySelector('#aimLook [data-lens-focal]').onchange();},null,midnight);
   const table=await record('registry-table-replaced',midnight);reused(moved,table);assert.deepEqual(table.canvas,moved.canvas);
   await action(page,()=>{const key=previewCacheFixture.modelsKey;globalThis[key]={...globalThis[key],skytree:{...globalThis[key].skytree}};document.querySelector('#aimLook [data-lens-focal]').onchange();},null,midnight);
   const models=await record('registry-entry-replaced',midnight);invalidated(table,models,['scene']);assert.deepEqual(models.canvas,table.canvas,'equivalent replacement model renders the same picture');
   await lens(page,200,midnight);const modelsRepeat=await record('registry-repeat',midnight);reused(models,modelsRepeat);assert.deepEqual(modelsRepeat.canvas,models.canvas);
   assert.deepEqual(errors,[]);assert.equal(writes,0,'preview work never writes user data');
   results.push({engine,passed:true,writes,externalBlocked,rows});fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS',engine,'preview calculation reuse',JSON.stringify(modelsRepeat.counts));
  }catch(e){const current=await page.evaluate(()=>({counts:previewCacheFixture?.counts,renders:previewCacheFixture?.renders,aria:document.querySelector('#aimLook [data-look-canvas]')?.getAttribute('aria-label'),shownTime:document.querySelector('#aimLook [data-look-at]')?.textContent,selectedAt:SkyMapUI.selectionState().at,recentCalls:previewCacheFixture?.calls.slice(-6)})).catch(()=>null);fs.writeFileSync(`${out}/${engine}-failure.json`,JSON.stringify({error:String(e),errors,writes,rows,current},null,2));await page.screenshot({path:`${out}/${engine}-failure.png`,fullPage:true}).catch(()=>{});throw e;}
  finally{await context.close();await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
