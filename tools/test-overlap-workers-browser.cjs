// The overlap list computed by parallel workers matches the single frame.
// Uses a public summit (Takao, winter-solstice Diamond Fuji) only; real GSI terrain over the network.
// NODE_PATH must reach playwright. OVERLAP_WORKERS_BASE overrides the trial URL.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.OVERLAP_WORKERS_BASE||'http://127.0.0.1:8992/trial/index.html',grants=['records','tower','diamond','pearl','skymap','multiscene'];
const ready=p=>p.waitForFunction(()=>document.getElementById('recordOpportunities')?.getAttribute('aria-busy')==='false'&&!document.getElementById('recordOpportunities').hidden,null,{timeout:300000});
async function listFor(type,mode){
 const browser=await type.launch(type===chromium?{channel:'chrome',headless:true}:{headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:900},locale:'ja-JP',timezoneId:'Asia/Tokyo'});
  await context.addInitScript(({grants,mode})=>{
   if(mode==='frame')globalThis.AstroNotesOverlapEngine='frame';
   sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-workers',loginId:'workers-test',tools:grants}));
   Date.now=()=>Date.parse('2026-12-20T09:00:00+09:00');
  },{grants,mode});
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===new URL(base).origin)return route.continue();if(/zekkei-api|localhost:8787/.test(u.origin))return route.fulfill({json:u.pathname.includes('overlap-preferences')?{enabled:false,prepare:false}:{allowed:true,tool:'skymap',loginId:'workers-test',tools:grants,favorites:[],records:[]}});return route.continue();});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(120000);
  await page.goto(base+'#/almanac');await page.waitForFunction(()=>globalThis.MyPlacesUI&&typeof SkyMapUI==='object');
  await page.evaluate(async()=>{
   await startupSessionReady;await AstroNotesAssets.ensureModels();
   const at={latitude:35.62523,longitude:139.24369,elevation:599,eyeHeightAGL:1.5};
   favorites=[{id:'p1',name:'高尾山山頂',...at}];localStorage.setItem('sorami.favorites',JSON.stringify(favorites));
   const records=[{id:'r00',placeId:'p1',target:{key:'fuji',name:'富士山'},observer:at,result:'seen',registration:true,createdAt:1,updatedAt:1,date:'',note:''}];
   const touched=RecordSync.touched;RecordSync.touched=()=>{};store.set(AstroNotesLibrary.keys(auth.loginId).observations,records);RecordSync.touched=touched;MyPlacesUI.imported();
   location.hash='#/records';
  });
  await page.waitForFunction(()=>!document.getElementById('recordsView').hidden);await page.locator('#notebookOpportunitiesTab').click();await ready(page);
  const days=[];
  for(let i=0;i<3;i++){
   if(i)await page.locator('#recordOpportunityNext').click();await ready(page);
   days.push(await page.evaluate(()=>({status:document.getElementById('recordOpportunityStatus')?.innerText||'',rows:[...document.querySelectorAll('[data-opportunity-id]')].map(n=>n.dataset.opportunityId+'|'+n.textContent)})));
  }
  const stats=await page.evaluate(()=>({...globalThis.AstroNotesOverlapStats}));
  assert.deepEqual(errors,[]);
  return {days,stats};
 }finally{await browser.close();}
}
(async()=>{
 for(const type of (process.env.OVERLAP_WORKERS_ENGINE||'chrome,webkit').split(',').map(e=>e==='webkit'?webkit:chromium)){
  const frame=await listFor(type,'frame'),workers=await listFor(type,'workers');
  assert.equal(frame.stats.workers,undefined,'fixture pin keeps the frame');
  assert(workers.stats.workers>=1,'workers started');
  assert.equal(workers.stats.failures,0);assert.equal(frame.stats.failures,0);
  assert.deepEqual(workers.days,frame.days,'workers list equals frame list');
  assert(frame.days.some(d=>d.rows.length),'at least one day has an overlap');
  console.log('PASS',type.name(),'workers',workers.stats.workers,'rows',workers.days.map(d=>d.rows.length).join('/'));
 }
})().catch(e=>{console.error(e);process.exit(1);});
