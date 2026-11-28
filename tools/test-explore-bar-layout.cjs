require('./no-open-meteo.cjs');
require('./explore-open-conditions.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');const {fixture}=require('./candidate-date-fixture.cjs');
// The trial's overlap geometry cache (rec:geom, ignored by production) syncs to the account; any other write fails.
const geometryCacheOnly=q=>{try{const u=new URL(q.url()),b=JSON.parse(q.postData()||'{}');return u.pathname==='/sync'&&Array.isArray(b.records)&&b.records.length>0&&b.records.every(x=>/^rec:geom:/.test(x.id))&&!b.favorites&&!b.sightings;}catch{return false;}};
const base=process.env.BAR_LAYOUT_BASE||'http://127.0.0.1:8992/trial/index.html',out=process.env.BAR_LAYOUT_OUT||'/tmp/astronotes-bar-layout';fs.mkdirSync(out,{recursive:true});const grants=['records','tower','diamond','pearl','skymap','multiscene'];
async function ready(page){await page.waitForFunction(()=>{const h=document.getElementById('aimLook'),p=document.getElementById('exploreScenePanel');return !p.hidden&&!p.hasAttribute('data-loading')&&!h.hidden&&h._trialCompositionView&&Math.abs(h._lookAt-SkyMapUI.selectionState().at)<1000;});await page.waitForTimeout(250);}
(async()=>{let results=[];for(const [engine,type]of [['chrome',chromium],['webkit',webkit]].filter(([e])=>(process.env.BAR_LAYOUT_ENGINE||'chrome,webkit').split(',').includes(e))){const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});try{for(const width of (process.env.BAR_LAYOUT_WIDTH||'320,390,440,1024').split(',').map(Number))for(const theme of (process.env.BAR_LAYOUT_THEME||'light,dark').split(',')){const c=await browser.newContext({viewport:{width,height:900},isMobile:width<960,hasTouch:true,locale:'ja-JP',timezoneId:'Asia/Tokyo',colorScheme:theme,reducedMotion:'reduce'});await c.addInitScript(fixture,grants);let writes=0;await c.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(base).origin)return r.continue();if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(r.request().method())&&!geometryCacheOnly(r.request()))writes++;return r.fulfill({json:{allowed:true,tool:'skymap',loginId:'date-test',tools:grants,favorites:[],sightings:[],records:[],rev:1}});}return r.abort();});const page=await c.newPage(),errors=[],result={engine,width,theme,base};page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);try{await page.goto(base+'#/almanac');await page.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof MyPlacesUI==='object'&&typeof AstroNotesCandidatePicker==='object'&&typeof TrialExplore==='object');await page.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>87.2;navigationHistory.pushRoute('#/explore');});await page.waitForFunction(()=>!!SkyMapUI.workspaceHost());await page.evaluate(()=>{
favorites=[{id:'current-id',name:'鷺沼北公園',latitude:35.58386,longitude:139.56853,elevation:87.2,eyeHeightAGL:1.5},{id:'other',name:'別地点',latitude:35.7119,longitude:139.8089,elevation:25,eyeHeightAGL:4}];const records=favorites.map((p,i)=>({id:'record-'+i,placeId:i?'other':'current-id',target:{key:'skytree',name:'東京スカイツリー'},observer:{latitude:p.latitude,longitude:p.longitude,elevation:p.elevation,eyeHeightAGL:p.eyeHeightAGL},result:'seen',registration:true,date:'',note:'',createdAt:1,updatedAt:1}));const touched=RecordSync.touched;RecordSync.touched=()=>{};store.set(AstroNotesLibrary.keys(auth.loginId).observations,records);const hash=v=>{const t=JSON.stringify(v);let h=2166136261;for(let i=0;i<t.length;i++)h=Math.imul(h^t.charCodeAt(i),16777619);return(h>>>0).toString(36)+t.length.toString(36);};localStorage.setItem('sorami.recordSync.v1:'+encodeURIComponent(auth.loginId),JSON.stringify({obs:Object.fromEntries(records.map(r=>[r.id,hash(r)])),shape:{},plan:{},receiving:{}}));RecordSync.touched=touched;SkyMapUI.setTarget('skytree');const b=document.getElementById('skyMapBody');b.value='moon';b.onchange();SkyMapUI.setTime(Date.parse('2026-11-25T09:02:00+09:00'));SkyMapUI.setObserver({...favorites[0],groundManualM:87.2,standAglM:1.5});MyPlacesUI.imported();});await page.locator('#skyMapView[data-explore-sheet] #candidateSearchAction').waitFor({state:'visible'});
// Wait for the shared geometry stylesheet, rather than accepting a fixed footer from an earlier paint.
await page.waitForFunction(()=>[...document.styleSheets].some(sheet=>sheet.href?.includes('astronotes-datetime-ui.css')&&sheet.cssRules.length>0));
result.version=await page.locator('meta[name=app-version]').getAttribute('content');
const frames=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const geometry=label=>page.evaluate(label=>{const f=document.querySelector('#skyMapView .sky-map-footer'),m=document.querySelector('main'),t=document.getElementById('skyMapTimeline');const rect=n=>{const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height,width:r.width}};return {label,scrollY,innerHeight,desktopAnchor:parseFloat(getComputedStyle(f).left),scrollHeight:document.scrollingElement.scrollHeight,footer:rect(f),padding:parseFloat(getComputedStyle(m).paddingBottom),pageEdge:getComputedStyle(document.documentElement).overscrollBehaviorY,bodyEdge:getComputedStyle(document.body).overscrollBehaviorY,scrollPadding:parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom),track:rect(t),timelineLeft:t.scrollLeft,ticks:t.querySelectorAll('*').length,stage:document.getElementById('skyMapView').dataset.exploreStage};},label);
const assertFixed=g=>{
 result.lastGeometry=g;
 assert(g.footer.height>0&&g.footer.left>=0&&g.footer.right<=width+1,'bar stays horizontally inside the viewport');
 if(g.stage==='search'&&width>=900){
  assert(Math.abs(g.footer.right-width)<1&&g.footer.left>0,'desktop search keeps the time bar in the right rail');
 }else if(width>=960){
  assert(Math.abs((g.footer.left+g.footer.right)/2-g.desktopAnchor)<1,'desktop preview keeps the centered bar');
 }
 assert(Math.abs(g.footer.bottom-g.innerHeight)<1,'bar stays at the viewport bottom: '+g.label);
 if(g.stage==='preview')assert(g.padding>=g.footer.height+11,'preview content reserves the footer height');
 assert(g.track.height>0&&g.track.width>0&&g.ticks>0,'timeline has visible geometry and ticks');
 assert.equal(g.pageEdge,g.stage==='search'?'none':'auto');
 assert.equal(g.bodyEdge,g.pageEdge);
};
const expose=async(selector,label)=>{
 const target=typeof selector==='string'?page.locator(selector):selector;
 let position;
 for(let k=0;k<6;k++){
  await target.evaluate(n=>n.scrollIntoView({block:'end',behavior:'instant'}));
  await frames();if(k)await page.waitForTimeout(200);
  position=await target.evaluate(n=>{
   const r=n.getBoundingClientRect(),rects=n.getClientRects(),hitRect=rects[rects.length-1]||r;
   const f=document.querySelector('#skyMapView .sky-map-footer').getBoundingClientRect();
   const sheet=n.closest('#skyMapView[data-explore-sheet] #exploreConditions');
   const b=sheet?.getBoundingClientRect();
   const x=hitRect.left+hitRect.width/2,y=hitRect.top+hitRect.height/2;
   return {top:r.top,bottom:r.bottom,right:r.right,
    limit:b?.bottom??(f.top-8),sheetRight:b?.right??innerWidth,
    clearOfFooter:!sheet||f.left>=r.right-1||f.top>=r.bottom-1,
    hit:n.contains(document.elementFromPoint(x,y))};
  });
  if(position.bottom<=position.limit+1&&position.clearOfFooter&&position.hit)break;
 }
 assert(position.bottom<=position.limit+1&&position.right<=position.sheetRight+1&&position.clearOfFooter,label+' is clear of the fixed bar '+JSON.stringify(position));
 assert(position.top>=0&&position.hit,label+' is hit-testable '+JSON.stringify(position));
 return position;
};
result.samples=[];result.hits=[];
const sheet=page.locator('#skyMapView[data-explore-sheet] #exploreConditions');
const searchAction=sheet.locator('#candidateSearchAction');
const lastCandidate=sheet.locator('#candidateUnifiedResults .list-item:visible').last();
for(const height of [900,600,956]){
 await page.setViewportSize({width,height});
 await frames();
 const g=await geometry('search-'+height);assertFixed(g);result.samples.push(g);
 assert(await page.locator('#skyMapCanvas').isVisible());
 result.hits.push(await expose(searchAction,'new-place search action'));
}
await searchAction.click();await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===2);
await page.locator('#candidateRefinement > summary').click();
await page.setViewportSize({width,height:600});
await page.waitForFunction(()=>{const s=document.getElementById('exploreConditions');return s.scrollHeight>s.clientHeight;});
await sheet.evaluate(n=>{n.scrollTop=0;});
await frames();
// Scroll the candidate sheet while measuring the actual shared bar on each frame.
const observe=page.evaluate(()=>new Promise(resolve=>{
 const rows=[];let remaining=32;
 const tick=()=>{
  const f=document.querySelector('#skyMapView .sky-map-footer').getBoundingClientRect(),t=document.getElementById('skyMapTimeline');
  const tape=t.firstElementChild,tr=tape.getBoundingClientRect();
  rows.push({bottom:f.bottom,height:innerHeight,scroll:document.getElementById('exploreConditions').scrollTop,documentScroll:scrollY,
   left:t.scrollLeft,ticks:t.querySelectorAll('.sky-timeline-label').length,tapeHeight:tr.height,paint:getComputedStyle(tape).backgroundImage});
  if(--remaining)requestAnimationFrame(tick);else resolve(rows);
 };requestAnimationFrame(tick);
}));
if(engine==='chrome'){
 result.scrollDriver='native browser wheel in candidate sheet';
 const bounds=await sheet.boundingBox();
 await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.wheel(0,1000);
}else{
 result.scrollDriver='browser sheet scrolling';
 await sheet.evaluate(n=>n.scrollTo({top:n.scrollHeight,behavior:'smooth'}));
}
result.moving=await observe;
assert(result.moving.every(x=>Math.abs(x.bottom-x.height)<1&&x.ticks>0&&x.tapeHeight>0&&x.paint!=='none'));
assert(Math.max(...result.moving.map(x=>x.scroll))-Math.min(...result.moving.map(x=>x.scroll))>1,'the candidate sheet really scrolls');
assert(Math.max(...result.moving.map(x=>x.documentScroll))-Math.min(...result.moving.map(x=>x.documentScroll))<1,'sheet scrolling leaves the page fixed');
assert(Math.max(...result.moving.map(x=>x.left))-Math.min(...result.moving.map(x=>x.left))<1,'vertical scroll never resets the ruler');
result.hits.push(await expose(lastCandidate,'last new-place candidate'));
await page.screenshot({path:out+'/'+engine+'-'+width+'-'+theme+'-new.png',fullPage:true});
await lastCandidate.click();
await ready(page);
await page.waitForFunction(()=>document.querySelector('#skyMapDates [data-from-day]'));
for(const height of [600,956]){
 await page.setViewportSize({width,height});
 await frames();
 const g=await geometry('preview-'+height);assertFixed(g);result.samples.push(g);
 result.hits.push(await expose('#footer>summary','preview source summary'));
}
await page.locator('#footer>summary').click();
assert(await page.locator('#footer').evaluate(n=>n.open));
const lastSource=page.locator('#footerBody a').last();
assert(await lastSource.count()>0,'real source links are rendered');
result.hits.push(await expose(lastSource,'last source link'));
const beforeAt=await page.evaluate(()=>SkyMapUI.selectionState().at);await page.locator('#skyMapNext').click();await page.waitForFunction(t=>SkyMapUI.selectionState().at>t,beforeAt);await page.locator('#skyMapPrev').click();await page.waitForFunction(t=>SkyMapUI.selectionState().at===t,beforeAt);
await page.locator('#skyMapCalendarOpen').click();assert(await page.locator('dialog[open]').count());await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
await page.locator('#exploreBackToCandidates').click();
await sheet.waitFor({state:'visible'});
await page.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===2);
await frames();assertFixed(await geometry('return-search'));
await page.screenshot({path:out+'/'+engine+'-'+width+'-'+theme+'-return-sheet.png',fullPage:true});
await page.evaluate(()=>location.hash='#/almanac');await page.waitForFunction(()=>!globalThis.TrialExplore.active());assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).overscrollBehaviorY),'auto','page-edge rule is removed on route leave');assert.equal(await page.evaluate(()=>getComputedStyle(document.body).overscrollBehaviorY),'auto');assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollPaddingBottom),'auto');assert.equal(await page.locator('#footer>summary').evaluate(n=>getComputedStyle(n).minHeight),'0px');
Object.assign(result,{writes,errors,passed:true});assert.equal(writes,0);assert.deepEqual(errors,[]);results.push(result);fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS',engine,width,theme,result.samples.length,'samples',result.hits.length,'exposed items');
}catch(e){Object.assign(result,{error:String(e),writes,errors,stage:await page.evaluate(()=>({hash:location.hash,host:!!SkyMapUI.workspaceHost(),body:document.body.innerText.slice(-800)})).catch(()=>null)});fs.writeFileSync(out+'/'+engine+'-'+width+'-failure.json',JSON.stringify(result,null,2));throw e;}finally{await c.close();}}}finally{await browser.close();}}})().catch(e=>{console.error(e);process.exit(1)});
