require('./no-open-meteo.cjs');
// 2026-11-11 ユーザー（ヒアリング）: a new place opens with the whole target about 6/10 of the frame height and the frame's
// lower edge on the ground line; 天体に寄る makes the body's diameter about 1/4 of the frame height; each sets the focal
// length of 撮影設定. With one target overlapped as a whole, the lens is not part of the search, so the list stays on return.
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict');
const {fixture}=require('./candidate-date-fixture.cjs');
const base=process.env.COMPOSE_BASE||'http://127.0.0.1:8992/trial/',tools=['records','tower','diamond','pearl','skymap','multiscene'];
(async()=>{
 for(const [engine,type,width] of [['chrome',chromium,390],['webkit',webkit,320]]){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{
   const context=await browser.newContext({viewport:{width,height:844},locale:'ja-JP',timezoneId:'Asia/Tokyo',reducedMotion:'reduce'});
   await context.addInitScript(fixture,tools);
   await context.addInitScript(()=>localStorage.setItem('sorami.lens',JSON.stringify({on:true,mode:'manual',focal:130.2,sensor:'full',portrait:false,grid:'none'})));
   let writes=0;await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(base).origin)return r.continue();if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(r.request().method())&&!/^\/sync$/.test(u.pathname))writes++;return r.fulfill({json:{allowed:true,tool:'skymap',loginId:'date-test',tools,favorites:[],sightings:[],records:[],rev:1}});}return r.abort();});
   const p=await context.newPage(),errors=[];p.setDefaultTimeout(30000);p.on('pageerror',e=>errors.push(e.message));
   await p.goto(base+'#/explore');await p.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof AstroNotesCandidatePicker==='object'&&typeof startupSessionReady!=='undefined');
   await p.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>25;aimBuildingDays=async()=>[];navigationHistory.pushRoute('#/explore');SkyMapUI.setTarget('skytree');const b=document.getElementById('skyMapBody');b.value='sun';b.onchange();SkyMapUI.setTime(Date.parse('2026-11-05T12:00:00+09:00'));});
   await p.waitForTimeout(500);await p.locator('#exploreDiscovery-new').click();await p.locator('#candidateSearchAction').click();
   await p.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===2&&document.getElementById('candidateSearchAction').dataset.state==='idle');
   const loads=await p.evaluate(()=>dateFixture.loads.length);
   await p.locator('#candidateUnifiedResults .list-item:not([hidden])').first().click();
   await p.waitForFunction(()=>{const h=document.getElementById('aimLook');return !h.hidden&&h._lookLayers?.stats?.frames>0&&h._compose&&!h._compose.apply;});
   const expect=await p.evaluate(()=>{const s=SkyMapUI.selectionState(),h=document.getElementById('aimLook'),spec=h._lookSpec,o=AstroNotesAlign.towerOutline(spec.obs,s.target,{eyeM:spec.eyeM}),ground=o.hiddenAngle!==null?Math.max(o.hiddenAngle,o.baseAngle):o.baseAngle,vfov=(o.topAngle-ground)/0.6,st=AstroNotesBodies.state('sun',h._lookAt,{...spec.obs,elevation:spec.obs.elevation+spec.eyeM});
    return {whole:24/(2*Math.tan(vfov/2*Math.PI/180)),body:24/(2*Math.tan(4*st.angularRadius*Math.PI/180))};});
   const lens=()=>p.evaluate(()=>({focal:aimLens.focal,mode:aimLens.mode,saved:JSON.parse(localStorage.getItem('sorami.lens')).focal,offset:document.getElementById('aimLook')._lensOffset,pressed:document.querySelector('#aimLook [data-lens-compose]').getAttribute('aria-pressed'),label:document.querySelector('#aimLook [data-lens-compose]').getAttribute('aria-label')}));
   let l=await lens();assert.equal(l.mode,'manual');assert(Math.abs(l.focal-expect.whole)<0.11,JSON.stringify([l,expect]));assert.equal(l.saved,l.focal,'撮影設定 holds the focal length');assert.equal(l.pressed,'false');assert.equal(l.label,'天体に寄る');assert.notDeepEqual(l.offset,[0,0],'frame lowered onto the ground line');
   const icon=await p.locator('#aimLook [data-lens-compose]').evaluate(n=>{const r=n.getBoundingClientRect(),c=[...document.querySelectorAll('#aimLook [data-lens-center]')].map(x=>x.getBoundingClientRect()).find(x=>x.width>0);return {w:r.width,h:r.height,belowCenter:r.top>=c.bottom,sameColumn:Math.abs(r.right-c.right)<1,r:[r.left,r.top,r.right],c:[c.left,c.top,c.right],cls:n.className,parent:n.parentElement.className};});
   assert(icon.w>=44&&icon.h>=44&&icon.belowCenter&&icon.sameColumn,JSON.stringify(icon));
   // At the fixture's noon the sun is far from the tower: 天体に寄る is not offered.
   assert.equal(await p.locator('#aimLook [data-lens-compose]').isDisabled(),true,'no zoom to a body away from the target');
   // A real overlap: the sun on the Skytree's top from the Edogawa levee at Shibamata, 2026-11-20 16:05.
   await p.evaluate(()=>{SkyMapUI.workspaceHost().restoreObserver({latitude:35.745342,longitude:139.893711,elevation:9.7,name:'柴又（確認）',eyeHeightAGL:1.5});SkyMapUI.setTime(Date.parse('2026-11-20T16:05:00+09:00'));});
   await p.waitForFunction(()=>{const b=document.querySelector('#aimLook [data-lens-compose]');return b&&!b.disabled&&Math.abs(document.getElementById('aimLook')._lookAt-Date.parse('2026-11-20T16:05:00+09:00'))<60000;});
   expect.body=await p.evaluate(()=>{const h=document.getElementById('aimLook'),spec=h._lookSpec,st=AstroNotesBodies.state('sun',h._lookAt,{...spec.obs,elevation:spec.obs.elevation+spec.eyeM});return 24/(2*Math.tan(4*st.angularRadius*Math.PI/180));});
   await p.locator('#aimLook [data-lens-compose]').click();await p.waitForFunction(()=>{const h=document.getElementById('aimLook');return h._compose?.mode==='body'&&!h._compose.apply&&h.querySelector('[data-lens-compose]').getAttribute('aria-pressed')==='true';});
   l=await lens();assert(Math.abs(l.focal-expect.body)<0.11,JSON.stringify([l,expect]));assert.deepEqual(l.offset,[0,0]);assert.equal(l.pressed,'true');assert.equal(l.label,'全体を入れる');
   await p.locator('#aimLook [data-lens-compose]').click();await p.waitForFunction(()=>{const h=document.getElementById('aimLook');return h._compose?.mode==='whole'&&!h._compose.apply&&h.querySelector('[data-lens-compose]').getAttribute('aria-pressed')==='false';});
   const wholeHere=await p.evaluate(()=>{const s=SkyMapUI.selectionState(),h=document.getElementById('aimLook'),spec=h._lookSpec,o=AstroNotesAlign.towerOutline(spec.obs,s.target,{eyeM:spec.eyeM}),ground=o.hiddenAngle!==null?Math.max(o.hiddenAngle,o.baseAngle):o.baseAngle;return 24/(2*Math.tan((o.topAngle-ground)/0.6/2*Math.PI/180));});
   l=await lens();assert(Math.abs(l.focal-wholeHere)<0.11,JSON.stringify([l,wholeHere]));assert.equal(l.pressed,'false');
   await p.locator('#exploreBackToCandidates').click();await p.waitForFunction(()=>document.getElementById('skyMapView').dataset.exploreStage==='search');
   await p.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===2);assert.equal(await p.evaluate(()=>dateFixture.loads.length),loads,'the list stays without searching again');
   assert.equal(writes,0);assert.deepEqual(errors,[]);console.log('PASS',engine,width,JSON.stringify({whole:+expect.whole.toFixed(1),body:+expect.body.toFixed(1)}));
   await context.close();
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exit(1);});
