require('./no-open-meteo.cjs');
require('./explore-open-conditions.cjs'); // 2026-11-26 探すは地図の段で始まる。検索の段を確かめるため入口で撮影条件を開く
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./candidate-date-fixture.cjs');
const base=process.env.HONGO_MOVE_BASE||'http://127.0.0.1:8996/trial/index.html',out=process.env.HONGO_MOVE_OUT||'/tmp/astro-hongo-move';
const token='3/moon/skytree/35.70730860834253,139.75974230531398/1798462978473.7598/W1si5pys6YO3IiwyMS44XSxudWxsLG51bGwsbnVsbCxbbnVsbCxudWxsLDY4LjRdLG51bGwsIm92ZXJsYXAiXQ';
const ready=p=>p.waitForFunction(()=>{const s=SkyMapUI.selectionState(),h=document.getElementById('aimLook');return s?.observer&&!h.hidden&&Math.abs(h._lookAt-s.at)<1000;});
async function prepare(p){
 await p.goto(base+'#/explore');await p.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof AstroNotesCandidatePicker==='object');
 await p.evaluate(async token=>{await startupSessionReady;await AstroNotesAssets.ensureModels();navigationHistory.pushRoute('#/explore');await SkyMapUI.open();const value=AstroNotesPlan.decode(token),o=value.o,host=SkyMapUI.workspaceHost();
  host.restoreTarget({target:value.t,body:value.body,partId:value.part,limb:value.limb,matchMode:value.matchMode});
  host.restoreObserver({name:o[0],latitude:o[1],longitude:o[2],elevation:o[3],groundManualM:o[3],eyeHeightAGL:o[4],standAglM:o[4]},o[3],null);SkyMapUI.setTime(value.at);
 },token);await p.locator('#exploreShowResult').click();await ready(p);
}
(async()=>{fs.mkdirSync(out,{recursive:true});const results=[];
 for(const [engine,type]of[['chrome',chromium],['webkit',webkit]])for(const width of[320,390]){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{
   const context=await browser.newContext({viewport:{width,height:844},locale:'ja-JP',timezoneId:'Asia/Tokyo',colorScheme:'dark'});await context.addInitScript(fixture,['records','tower','diamond','pearl','skymap','multiscene']);
   let reads=0,fail=false;await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(base).origin)return r.continue();
    if(u.origin==='https://api.openstreetmap.org'&&u.pathname==='/api/0.6/map.json'){reads++;return fail?r.fulfill({status:503,body:'offline'}):r.fulfill({contentType:'application/json',body:fs.readFileSync(path.join(__dirname,'fixtures/hongo-walkways.json'))});}
    if(/zekkei-api|localhost:8787/.test(u.origin))return r.fulfill({json:{allowed:true,tool:'skymap',tools:['records','tower','diamond','pearl','skymap','multiscene'],loginId:'date-test',favorites:[],records:[],sightings:[],rev:1}});
    return r.abort();
   });
   const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(30000);
   await prepare(p);
   await p.evaluate(()=>{const factory=createMapView;createMapView=function(...args){const map=factory(...args);if(args[0]?.canvas==='exploreObserverMoveCanvas')window.hongoMap=map;return map;};
    window.groundReads=0;AstroNotesTerrain.groundElevation=async()=>{groundReads++;return 22.4;};
    AstroNotesCandidatePicker.movementGuides=async()=>({guides:[],partial:true});window.hongoBefore=SkyMapUI.selectionState();window.hongoGround=SkyMapUI.workspaceHost().session.ground;
   });
   const move=p.locator('#exploreObserverMove'),undo=p.locator('#exploreObserverMoveUndo'),apply=p.locator('#exploreObserverMoveApply');
   await move.locator('summary').click();await p.waitForFunction(()=>globalThis.hongoMap&&document.getElementById('exploreObserverMove').dataset.onSurface==='true');
   assert.equal(reads,1);assert(await undo.isDisabled());
   await p.evaluate(()=>hongoMap.setCenter(35.707412,139.759744));await p.waitForFunction(()=>!document.getElementById('exploreObserverMoveApply').disabled);
   const coordinate=await p.locator('#exploreObserverMoveCoordinate').innerText();assert(await undo.isEnabled());
   const style=await undo.evaluate(n=>({h:n.getBoundingClientRect().height,b:parseFloat(getComputedStyle(n).borderTopWidth)}));assert(style.h>=44&&style.b>=1);
   await p.screenshot({path:path.join(out,engine+'-'+width+'-draft.png'),fullPage:true});
   await undo.click();assert(await p.evaluate(()=>hongoMap.center().latitude===hongoBefore.observer.latitude));assert.equal(await p.evaluate(()=>groundReads),0);
   await p.evaluate(()=>hongoMap.setCenter(35.707412,139.759744));await apply.click();
   await p.waitForFunction(()=>!document.getElementById('exploreObserverMove').open&&SkyMapUI.selectionState().observer.groundManualM===22.4);await ready(p);
   assert.equal(await p.evaluate(()=>groundReads),1);assert.equal(await p.evaluate(()=>SkyMapUI.selectionState().at),1798462978473.7598);
   assert.equal(await p.evaluate(()=>{const o=SkyMapUI.selectionState().observer;return o.latitude.toFixed(6)+', '+o.longitude.toFixed(6);}),coordinate);
   assert(await undo.isVisible());assert(await undo.isEnabled());await p.screenshot({path:path.join(out,engine+'-'+width+'-applied.png'),fullPage:true});await undo.click();await ready(p);
   assert(await p.evaluate(()=>JSON.stringify(SkyMapUI.selectionState().observer)===JSON.stringify(hongoBefore.observer)&&SkyMapUI.workspaceHost().session.ground===hongoGround));
   assert.equal(await p.evaluate(()=>groundReads),1);assert(await undo.isHidden(),'completed undo disappears while the map is closed');
   await move.locator('summary').click();await p.waitForFunction(()=>document.getElementById('exploreObserverMove').dataset.onSurface==='true');assert.equal(reads,1);
   fail=true;const retryPage=await context.newPage();retryPage.on('pageerror',e=>errors.push(e.message));await prepare(retryPage);
   await retryPage.evaluate(()=>{AstroNotesCandidatePicker.movementGuides=async()=>({guides:[],partial:true});});
   await retryPage.locator('#exploreObserverMove>summary').click();await retryPage.locator('#exploreObserverMoveRetry').waitFor({state:'visible'});assert(await retryPage.locator('#exploreObserverMoveApply').isDisabled());
   const disabled=await retryPage.locator('#exploreObserverMoveApply').evaluate(n=>({bg:getComputedStyle(n).backgroundColor,opacity:Number(getComputedStyle(n).opacity)}));assert(disabled.opacity<1);
   fail=false;await retryPage.locator('#exploreObserverMoveRetry').click();await retryPage.waitForFunction(()=>document.getElementById('exploreObserverMove').dataset.onSurface==='true');assert(await retryPage.locator('#exploreObserverMoveRetry').isHidden());await retryPage.close();
   await p.screenshot({path:path.join(out,engine+'-'+width+'.png'),fullPage:true});
   assert.deepEqual(errors,[]);results.push({engine,width,version:await p.locator('meta[name=app-version]').getAttribute('content'),draftUndo:true,apply:true,closedMapUndo:true,sameTime:true,oneGroundRead:true,cacheReuse:true,retry:true});console.log('PASS '+engine+' '+width+' Hongo movement');
  }finally{await browser.close();}
 }
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
