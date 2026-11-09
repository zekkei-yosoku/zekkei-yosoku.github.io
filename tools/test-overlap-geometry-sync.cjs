// Geometry made on one device is sent with the records (rec:geom:) and lets a
// second device produce the same overlap list without rebuilding it, including a
// line place whose positions' ground and summit ridges continue over several rows. When a record goes away,
// its geometry rows are removed from the account (deleted rec:geom rows) and nothing else is.
// Public places only; real GSI terrain over the network. NODE_PATH must reach playwright.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.OVERLAP_GEOMETRY_BASE||'http://127.0.0.1:8992/trial/index.html',grants=['records','tower','diamond','pearl','skymap','multiscene'];
const ready=p=>p.waitForFunction(()=>document.getElementById('recordOpportunities')?.getAttribute('aria-busy')==='false'&&!document.getElementById('recordOpportunities').hidden,null,{timeout:300000});
async function device(type,incoming){
 const browser=await type.launch(type===chromium?{channel:'chrome',headless:true}:{headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:900},locale:'ja-JP',timezoneId:'Asia/Tokyo'}),sent=[];
  await context.addInitScript(grants=>{
   sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-geometry',loginId:'geometry-test',tools:grants}));
   Date.now=()=>Date.parse('2026-12-20T09:00:00+09:00');
  },grants);
  // The first device removes a record within the test: geometry it made seconds ago may go at once.
  if(!incoming.length)await context.addInitScript(()=>{globalThis.AstroNotesGeometryGraceMs=-1;});
  await context.route('**/*',route=>{
   const request=route.request(),u=new URL(request.url());
   if(u.origin===new URL(base).origin)return route.continue();
   if(!/zekkei-api|localhost:8787/.test(u.origin))return route.continue();
   if(u.pathname.endsWith('/overlap-preferences'))return route.fulfill({json:{enabled:false,prepare:false}});
   if(u.pathname.endsWith('/sync')&&request.method()==='POST'){const body=JSON.parse(request.postData()||'{}');sent.push(...(body.records||[]));return route.fulfill({json:{rev:1,accepted:{favorites:[],sightings:[],records:(body.records||[]).map(r=>r.id)}}});}
   if(u.pathname.endsWith('/sync'))return route.fulfill({json:{rev:incoming.length?2:0,favorites:[],sightings:[],records:incoming.map((r,i)=>({id:r.id,body:JSON.stringify(r.body),rev:i+1,updated_at:1,deleted:0})),more:false}});
   return route.fulfill({json:{allowed:true,tool:'skymap',loginId:'geometry-test',tools:grants,favorites:[],records:[]}});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(120000);
  await page.goto(base+'#/almanac');await page.waitForFunction(()=>globalThis.MyPlacesUI&&typeof SkyMapUI==='object');
  await page.evaluate(async()=>{
   await startupSessionReady;await AstroNotesAssets.ensureModels();
   // Receive the account's rows (geometry from the other device) before any check starts.
   await accountSync().syncNow().catch(()=>{});await new Promise(r=>setTimeout(r,300));
   const takao={latitude:35.62523,longitude:139.24369,elevation:599,eyeHeightAGL:1.5},park={latitude:35.58386,longitude:139.56853,elevation:87.2,eyeHeightAGL:1.5};
   const ridge={latitude:35.62523,longitude:139.24369,elevation:599,eyeHeightAGL:1.5},line={type:'line',vertices:[{latitude:35.62523,longitude:139.24369},{latitude:35.6266,longitude:139.2449}]};
   // A park area near the tower: many positions, so its geometry continues over several rows.
   const sumida={latitude:35.7135,longitude:139.803,elevation:3,eyeHeightAGL:1.5},area={type:'area',vertices:[{latitude:35.7135,longitude:139.803},{latitude:35.7135,longitude:139.806},{latitude:35.711,longitude:139.806},{latitude:35.711,longitude:139.803}]};
   favorites=[{id:'p1',name:'高尾山山頂',...takao},{id:'p2',name:'鷺沼北公園',...park},{id:'p3',name:'高尾山の尾根',...ridge},{id:'p4',name:'隅田公園',...sumida}];localStorage.setItem('sorami.favorites',JSON.stringify(favorites));
   const records=[{id:'r00',placeId:'p1',target:{key:'fuji',name:'富士山'},observer:takao},{id:'r01',placeId:'p2',target:{key:'skytree',name:'東京スカイツリー'},observer:park},{id:'r02',placeId:'p3',target:{key:'fuji',name:'富士山'},observer:ridge},{id:'r03',placeId:'p4',target:{key:'skytree',name:'東京スカイツリー'},observer:sumida}].map(r=>({...r,result:'seen',registration:true,createdAt:1,updatedAt:1,date:'',note:''}));
   const touched=RecordSync.touched;RecordSync.touched=()=>{};store.set(AstroNotesLibrary.keys(auth.loginId).observations,records);store.set(AstroNotesLibrary.keys(auth.loginId).shapes,{p3:{latitude:ridge.latitude,longitude:ridge.longitude,shape:line},p4:{latitude:sumida.latitude,longitude:sumida.longitude,shape:area}});RecordSync.touched=touched;MyPlacesUI.imported();
   location.hash='#/records';
  });
  await page.waitForFunction(()=>!document.getElementById('recordsView').hidden);await page.locator('#notebookOpportunitiesTab').click();await ready(page);
  const rows=await page.evaluate(()=>[...document.querySelectorAll('[data-opportunity-id]')].map(n=>n.dataset.opportunityId+'|'+n.textContent));
  // Uploads are debounced after the checks; wait for the geometry rows of both pairs.
  const uploaded=()=>page.evaluate(()=>new Promise(r=>{const o=indexedDB.open('astronotes-overlap-geometry');o.onsuccess=()=>{try{const q=o.result.transaction('groups').objectStore('groups').getAll();q.onsuccess=()=>{r(q.result.length>=4&&q.result.every(g=>g.uploaded));o.result.close();};}catch{r(false);}};o.onerror=()=>r(false);}));
  if(!incoming.length)for(let i=0;i<120&&!(await uploaded());i++)await page.waitForTimeout(1000);
  const stats=await page.evaluate(()=>({...globalThis.AstroNotesOverlapStats}));
  const built=sent.filter(r=>/^rec:geom:/.test(r.id)&&!r.deleted).map(r=>Object.keys(r.body.value.entries).map(k=>k.slice(0,4))).flat();
  let removed=null;
  if(!incoming.length){
   // Remove the park's record: its pair goes, so its geometry group must go from the account too.
   const before=sent.length,groups=()=>page.evaluate(()=>new Promise(r=>{const o=indexedDB.open('astronotes-overlap-geometry');o.onsuccess=()=>{const q=o.result.transaction('groups').objectStore('groups').getAll();q.onsuccess=()=>{r(q.result.map(g=>g.id));o.result.close();};};}));
   const kept=await groups();
   await page.evaluate(()=>{const key=AstroNotesLibrary.keys(auth.loginId).observations;store.set(key,store.get(key,[]).filter(r=>r.id!=='r01'));MyPlacesUI.imported();document.dispatchEvent(new Event('astronotes-records-change'));});
   for(let i=0;i<120&&!sent.slice(before).some(r=>r.deleted&&/^rec:geom:/.test(r.id));i++)await page.waitForTimeout(1000);
   removed={deleted:sent.slice(before).filter(r=>r.deleted&&/^rec:geom:/.test(r.id)).map(r=>r.id),kept,after:await groups()};
  }
  assert.deepEqual(errors,[]);
  return {rows,stats,sent,removed,built};
 }finally{await browser.close();}
}
(async()=>{
 for(const type of (process.env.OVERLAP_GEOMETRY_ENGINE||'chrome,webkit').split(',').map(e=>e==='webkit'?webkit:chromium)){
  const first=await device(type,[]);
  const geometry=first.sent.filter(r=>/^rec:geom:[a-f0-9]{40}$/.test(r.id)&&!r.deleted);
  const {deleted,kept,after}=first.removed;
  assert(deleted.length>=1,'the removed record\'s geometry is deleted from the account');
  assert(deleted.every(id=>geometry.some(r=>r.id===id)),'only rows that were sent are deleted');
  assert.equal(after.length,kept.length-1,'exactly one geometry group goes from the device');
  assert(after.every(id=>kept.includes(id))&&!deleted.some(id=>after.includes(id)),'the other groups stay');
  if(process.env.OVERLAP_GEOMETRY_DEBUG)console.log(JSON.stringify({sent:first.sent.map(r=>[r.id,JSON.stringify(r.body||{}).length]),stats:first.stats,rows:first.rows.length}));
  assert(geometry.length>=2,'both pairs send their geometry');
  assert(geometry.every(r=>r.body?.kind==='geom'&&r.body.value?.v===1&&JSON.stringify(r.body).length<=20000&&Object.keys(r.body.value.entries).every(k=>/^(sil|cap|shp):/.test(k))),'geometry rows fit the sync contract');
  assert(geometry.some(r=>Object.keys(r.body.value.entries).some(k=>k.startsWith('shp:'))),'the line place sends its positions');
  assert(geometry.some(r=>/^rec:geom:[a-f0-9]{40}$/.test(r.body.value.group||'')&&r.body.value.group!==r.id),'a large area continues in rows naming its group');
  assert(first.rows.some(r=>/線上 35\./.test(r)),'the line place has an overlap at a position on the line');
  assert(Object.keys(Object.assign({},...geometry.map(r=>r.body.value.entries))).some(k=>k.startsWith('cap:'))&&Object.keys(Object.assign({},...geometry.map(r=>r.body.value.entries))).some(k=>k.startsWith('sil:')),'a summit ridge and a building outline are synced');
  assert(first.stats.geometry>0,'the first device built geometry');
  const second=await device(type,geometry);
  if(process.env.OVERLAP_GEOMETRY_DEBUG)console.log(JSON.stringify({second:second.stats,secondGeometry:second.built,geometryIds:geometry.map(r=>[r.id,Object.keys(r.body.value.entries).length,r.body.value.group||null])}));
  assert.equal(second.stats.geometry||0,0,'the second device rebuilt no geometry');
  assert.deepEqual(second.rows,first.rows,'the same list from synced geometry');
  console.log('PASS',type.name(),'geometry rows',geometry.length,'list rows',first.rows.length);
 }
})().catch(e=>{console.error(e);process.exit(1);});
