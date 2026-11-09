// This code runs inside the existing MyPlacesUI closure in the trial only.
const opportunityDateAt=at=>new Date(at+32400000).toISOString().slice(0,10);
const opportunityBounds=date=>{const [y,m,d]=date.split('-').map(Number),start=Date.UTC(y,m-1,d)-32400000;return [start,start+86400000];};
const opportunityPageRows=8;
const opportunityPageEnd=start=>Math.max(start,Math.min(aimCandidateSearchEnd(),start+7*DAY));
let opportunityDateChosen=false;
let opportunityOwner=null,opportunityOwnerId=null,opportunityEpoch=0,opportunityJob=null,opportunityHost=null,opportunityDom=null,opportunityReturn=null,opportunityOpenSeq=0,opportunityInputEpoch=0;
let opportunityPermittedBodies=[],opportunityPlaces=[],opportunityPicker=null,opportunityNotice='';
let opportunityFilters={date:opportunityDateAt(Date.now()),bodies:['sun','moon'],allBodies:false,places:[],allPlaces:true},opportunityRestore=null;
const opportunityCache=new Map();
let opportunityPairMemo=null;
const opportunityListSettings=()=>geometricOpportunitySettings({targetHeights:store.get('sorami.aimHeightsOwner',null)===auth?.loginId?store.get('sorami.aimHeights',{}):{}});
let opportunityListSettingsKey=JSON.stringify(opportunityListSettings());
// Server and device lists both use the geometric candidate model. The
// appearance view applies this device's refraction when a row is opened.
const opportunityAirKey=()=>JSON.stringify(opportunityListSettings());
const opportunityAllowed=()=>!!auth?.token&&toolAllowed('records');
const opportunityActive=()=>opportunityAllowed()&&!document.hidden&&!el('recordsView')?.hidden&&el('recordsView')?.dataset.tab==='opportunities';
let opportunityApplyingPreferences=false,opportunityWarmupKey='',opportunityWarmupFlight=null;
const opportunityServer=createServerOpportunityPreferences({
 api:(...args)=>apiTransport(...args),getSession:()=>[auth?.token,auth?.loginId,accessState.generation],canUse:opportunityAllowed,
 getSettings:opportunityListSettings,
 applySettings:settings=>{opportunityApplyingPreferences=true;try{store.set('sorami.aimHeights',settings.targetHeights??{});store.set('sorami.aimHeightsOwner',auth?.loginId??null);opportunityListSettingsKey=JSON.stringify(opportunityListSettings());}finally{opportunityApplyingPreferences=false;}},
 sync:async()=>{await accountSync().syncNow();if(syncError||pushQueue.length)throw Error('記録を同期できていません。通信を確認して再試行してください。');}
});
function opportunityWarmup(){
 opportunityGeometryHook();
 if(opportunityAllowed()&&!document.hidden&&opportunityServer.state.enabled===false)opportunityDeviceBackground();
 if(!opportunityAllowed()||document.hidden||opportunityWarmupFlight)return;
 const key=JSON.stringify([auth?.token,auth?.loginId,accessState.generation,opportunityDateAt(Date.now()),opportunityAirKey(true)]);
 if(opportunityWarmupKey===key)return;opportunityWarmupKey=key;
 const owner=auth.token,generation=accessState.generation;
 opportunityWarmupFlight=(async()=>{try{const prefs=await opportunityServer.ready();if(owner!==auth?.token||generation!==accessState.generation||!opportunityAllowed())return;if(!prefs.enabled)opportunityDeviceBackground();else await apiTransport('POST','/overlaps/ensure',{environment:'trial',intent:'background',startDay:opportunityDateAt(Date.now()),bodies:['sun','moon'],placeIds:null,sourceRev:prefs.sourceRev});opportunityWarmupKey=JSON.stringify([auth?.token,auth?.loginId,accessState.generation,opportunityDateAt(Date.now()),opportunityAirKey(true)]);}catch{/* The visible list reports failures and offers retry. */}finally{opportunityWarmupFlight=null;if(opportunityActive())renderOpportunities();}})();
}
// Device geometric engine: the same extracted bundle as the server, in a
// hidden same-origin frame. Complete results persist per account, engine,
// settings, pair and day, so closing the app resumes from the next pair.
const opportunityDeviceStats={hits:0,solves:0,failures:0,solveMs:0,frameMs:0,background:0};
globalThis.AstroNotesOverlapStats=opportunityDeviceStats;
let opportunityFrame=null,opportunityFrameSeq=0,opportunityDb=null,opportunityBackgroundFlight=null;
const opportunityDeviceQueue={high:[],low:[],running:0};
const opportunityDeviceFlights=new Map();
function opportunityFrameOpen(){
 if(opportunityFrame)return opportunityFrame.ready;
 const frame=document.createElement('iframe'),calls=new Map(),began=performance.now();
 frame.hidden=true;frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;
 frame.src='overlap-calculation.html?v='+(document.querySelector('meta[name="app-version"]')?.content||'0');
 const state={frame,calls,engine:null};
 state.ready=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('calculation frame unavailable')),60000);
  state.listener=event=>{
   const message=event.data;if(event.source!==frame.contentWindow||event.origin!==location.origin||message?.type!=='astronotes-overlap')return;
   if('ready' in message){clearTimeout(timer);opportunityDeviceStats.frameMs=Math.round(performance.now()-began);if(message.ready&&/^[a-f0-9]{64}$/.test(message.engine||'')){state.engine=message.engine;resolve(state);}else reject(Error('calculation engine unavailable'));return;}
   const call=calls.get(message.id);if(!call)return;calls.delete(message.id);
   if(message.error)call.reject(Error(message.error));else call.resolve(message.result);
  };
  addEventListener('message',state.listener);
 });
 state.ready.catch(()=>{if(opportunityFrame===state)opportunityFrameClose();});
 opportunityFrame=state;document.body.append(frame);return state.ready;
}
function opportunityFrameClose(){
 const state=opportunityFrame;if(!state)return;opportunityFrame=null;removeEventListener('message',state.listener);state.frame.remove();
 for(const call of state.calls.values())call.reject(Error('calculation frame closed'));state.calls.clear();
}
// The frame runs one check at a time. A check that never settles would hold
// every later one, so it is abandoned with its frame and reported unchecked.
async function opportunityFrameSolve(input){
 const state=await opportunityFrameOpen(),id=++opportunityFrameSeq;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{if(opportunityFrame===state)opportunityFrameClose();},120000);
  state.calls.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
  state.frame.contentWindow.postMessage({type:'astronotes-overlap',id,op:'solve',input},location.origin);
 });
}
// 2026-11-09 Where the browser can decode terrain tiles off the main thread,
// the same engine runs in several workers and checks pairs in parallel. The
// frame remains the path for older browsers and for test fixtures, which
// substitute functions inside it (AstroNotesOverlapEngine='frame').
let opportunityWorkers=null,opportunityWorkerSeq=0,opportunityEngineMode=null;
function opportunityWorkerCount(){
 if(globalThis.AstroNotesOverlapEngine==='frame'||typeof Worker!=='function'||typeof OffscreenCanvas!=='function'||typeof createImageBitmap!=='function')return 0;
 const cores=Number(navigator.hardwareConcurrency)||2;return Math.max(1,Math.min(3,cores-1));
}
function opportunityWorkersOpen(){
 if(opportunityWorkers)return opportunityWorkers.ready;
 const count=opportunityWorkerCount(),began=performance.now(),url='overlap-calculation-worker.js?v='+(document.querySelector('meta[name="app-version"]')?.content||'0');
 const pool={slots:[],engine:null};
 pool.ready=Promise.all(Array.from({length:count},()=>new Promise((resolve,reject)=>{
  const worker=new Worker(url),slot={worker,calls:new Map(),engine:null};pool.slots.push(slot);
  const timer=setTimeout(()=>reject(Error('calculation worker unavailable')),60000);
  worker.onmessage=event=>{
   const message=event.data;if(message?.type!=='astronotes-overlap')return;
   if('ready' in message){clearTimeout(timer);if(message.ready&&/^[a-f0-9]{64}$/.test(message.engine||'')){slot.engine=message.engine;resolve(slot);}else reject(Error('calculation engine unavailable'));return;}
   const call=slot.calls.get(message.id);if(!call)return;slot.calls.delete(message.id);
   if(message.error)call.reject(Error(message.error));else call.resolve(message.result);
  };
  worker.onerror=event=>{event.preventDefault?.();clearTimeout(timer);reject(Error('calculation worker failed'));if(opportunityWorkers===pool)opportunityWorkersClose();};
 }))).then(slots=>{
  if(new Set(slots.map(slot=>slot.engine)).size!==1)throw Error('calculation engines differ');
  pool.engine=slots[0].engine;opportunityDeviceStats.frameMs=Math.round(performance.now()-began);opportunityDeviceStats.workers=slots.length;return pool;
 });
 pool.ready.catch(()=>{if(opportunityWorkers===pool)opportunityWorkersClose();});
 opportunityWorkers=pool;return pool.ready;
}
function opportunityWorkersClose(){
 const pool=opportunityWorkers;if(!pool)return;opportunityWorkers=null;
 for(const slot of pool.slots){slot.worker.terminate();for(const call of slot.calls.values())call.reject(Error('calculation worker closed'));slot.calls.clear();}
}
async function opportunityWorkerSolve(input){
 const pool=await opportunityWorkersOpen(),slot=pool.slots.reduce((a,b)=>b.calls.size<a.calls.size?b:a),id=++opportunityWorkerSeq;
 return new Promise((resolve,reject)=>{
  // A check that never settles is abandoned with the pool and reported unchecked.
  const timer=setTimeout(()=>{if(opportunityWorkers===pool)opportunityWorkersClose();},120000);
  slot.calls.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
  slot.worker.postMessage({type:'astronotes-overlap',id,op:'solve',input});
 });
}
// Workers first; if they cannot start here, the frame for the rest of the session.
async function opportunityEngineOpen(){
 if(opportunityEngineMode===null)opportunityEngineMode=opportunityWorkerCount()?'workers':'frame';
 if(opportunityEngineMode==='workers'){try{return await opportunityWorkersOpen();}catch{opportunityEngineMode='frame';}}
 return opportunityFrameOpen();
}
const opportunityEngineSlots=()=>opportunityEngineMode==='workers'&&opportunityWorkers?Math.max(1,opportunityWorkers.slots.length):1;
function opportunityEngineSolve(input){return opportunityEngineMode==='workers'?opportunityWorkerSolve(input):opportunityFrameSolve(input);}
function opportunityDbOpen(){
 if(opportunityDb)return opportunityDb;
 opportunityDb=new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(Error('indexedDB unavailable'));return;}
  const request=indexedDB.open('astronotes-overlap-device',1);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('results'))db.createObjectStore('results',{keyPath:'key'}).createIndex('day','day');};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
 opportunityDb.catch(()=>{opportunityDb=null;});
 return opportunityDb;
}
function opportunityDbDo(mode,work){
 return opportunityDbOpen().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction('results',mode),store=tx.objectStore('results');let value;const request=work(store);if(request)request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(tx.error);}));
}
// Results belong to the signed-in account and the engine that made them.
// Anything else, and past days, is removed instead of being reused.
async function opportunityDbPrune(owner,engine){
 const today=opportunityDateAt(Date.now());
 await opportunityDbDo('readwrite',store=>{const request=store.openCursor();request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const v=cursor.value;if(v.owner!==owner||v.engine!==engine||v.day<today)cursor.delete();cursor.continue();};return null;}).catch(()=>{});
}
function opportunityDeviceForget(){opportunityDbDo('readwrite',store=>store.clear()).catch(()=>{});opportunityGeometryDo('readwrite',store=>store.clear()).catch(()=>{});try{indexedDB.deleteDatabase('astronotes-ridge-caps');}catch{/* Unavailable storage has nothing to forget. */}}
// 2026-11-09 Date-independent geometry (one building outline or summit ridge per
// point, target and eye height) is kept per pair, sent with the records as
// rec:geom:<id> and received from them, so a later day or another device does not
// rebuild it from terrain and 3D models (ユーザー「記録に保存する時に稜線とか建物の縁とか
// 保持しておけば取りに行く必要はなくなる」「絶対に同期して」). Production ignores this kind.
const OPPORTUNITY_GEOMETRY_VERSION=1,opportunityGeometryRow=/^rec:geom:[a-f0-9]{40}$/,OPPORTUNITY_GEOMETRY_BODY=19000;
let opportunityGeometryDb=null,opportunityGeometryTimer=null,opportunityGeometryFlight=null;
function opportunityGeometryOpen(){
 if(opportunityGeometryDb)return opportunityGeometryDb;
 opportunityGeometryDb=new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(Error('indexedDB unavailable'));return;}
  const request=indexedDB.open('astronotes-overlap-geometry',1);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('groups'))db.createObjectStore('groups',{keyPath:'id'});};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
 opportunityGeometryDb.catch(()=>{opportunityGeometryDb=null;});
 return opportunityGeometryDb;
}
function opportunityGeometryDo(mode,work){
 return opportunityGeometryOpen().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction('groups',mode),store=tx.objectStore('groups');let value;const request=work(store);if(request)request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(tx.error);}));
}
// Body and labels do not change the geometry: the sun and moon pairs share one group.
async function opportunityGeometryId(pair){return 'rec:geom:'+(await opportunityDigest(['astronotes.overlap-geometry.v'+OPPORTUNITY_GEOMETRY_VERSION,{...opportunitySemantic(pair),body:undefined}])).slice(0,40);}
async function opportunityGeometryFor(pair){
 const id=await opportunityGeometryId(pair),owner=auth?.loginId,group=await opportunityGeometryDo('readonly',store=>store.get(id)).catch(()=>null);
 return {id,entries:group?.owner===owner&&group.entries&&typeof group.entries==='object'?group.entries:{}};
}
async function opportunityGeometryKeep(id,entries){
 const owner=auth?.loginId;if(!owner||!Object.keys(entries).length)return;
 await opportunityGeometryDo('readwrite',store=>{const request=store.get(id);request.onsuccess=()=>{const old=request.result?.owner===owner?request.result.entries:{};store.put({id,owner,entries:{...old,...entries},uploaded:false,updatedAt:Date.now()});};return null;}).catch(()=>{});
 clearTimeout(opportunityGeometryTimer);opportunityGeometryTimer=setTimeout(()=>void opportunityGeometryUpload(),3000);
}
// One synced row holds at most what fits the server's 20,000-character body. A larger
// group (a line or area: many positions) continues in rows that name it as their group.
function opportunityGeometryChunks(entries){
 const chunks=[];let chunk={},size=120;
 for(const key of Object.keys(entries).sort()){
  const add=JSON.stringify(key).length+JSON.stringify(entries[key]).length+2;if(120+add>OPPORTUNITY_GEOMETRY_BODY)continue;
  if(size+add>OPPORTUNITY_GEOMETRY_BODY){chunks.push(chunk);chunk={};size=120;}
  chunk[key]=entries[key];size+=add;
 }
 if(Object.keys(chunk).length||!chunks.length)chunks.push(chunk);
 return chunks;
}
async function opportunityGeometryPart(id,k){return k?'rec:geom:'+(await opportunityDigest(['astronotes.overlap-geometry-part.v1',id,k])).slice(0,40):id;}
async function opportunityGeometryUpload(){
 if(opportunityGeometryFlight)return opportunityGeometryFlight;
 const owner=auth?.loginId,token=auth?.token;if(!owner||!token)return;
 opportunityGeometryFlight=(async()=>{
  try{
   const pending=((await opportunityGeometryDo('readonly',store=>store.getAll()).catch(()=>[]))||[]).filter(g=>g.owner===owner&&!g.uploaded);
   for(let i=0;i<pending.length;){
    if(auth?.loginId!==owner||auth?.token!==token)return;
    const batch=[],rows=[];
    for(;i<pending.length&&(rows.length<80||!batch.length);i++){
     const g=pending[i],chunks=opportunityGeometryChunks(g.entries),ids=[];
     for(let k=0;k<chunks.length;k++){const id=await opportunityGeometryPart(g.id,k);ids.push(id);rows.push({id,body:{kind:'geom',value:{v:OPPORTUNITY_GEOMETRY_VERSION,entries:chunks[k],...(k?{group:g.id}:{})}},updated_at:Date.now(),deleted:false});}
     batch.push({g,ids});
    }
    const ok=new Set();
    for(let j=0;j<rows.length;j+=100){const res=await apiTransport('POST','/sync',{records:rows.slice(j,j+100)});for(const id of res?.accepted?.records||[])ok.add(id);}
    // A group that gained entries while sending stays pending for the next round.
    await opportunityGeometryDo('readwrite',store=>{for(const {g,ids} of batch){if(!ids.every(id=>ok.has(id)))continue;const request=store.get(g.id);request.onsuccess=()=>{const now=request.result;if(now&&now.updatedAt===g.updatedAt)store.put({...now,uploaded:true});};}return null;});
   }
  }catch{/* Kept on this device and sent after the next check. */}
  finally{opportunityGeometryFlight=null;}
 })();
 return opportunityGeometryFlight;
}
function opportunityGeometryReceive(rows){
 const owner=auth?.loginId;if(!owner||!Array.isArray(rows))return;
 const list=rows.filter(row=>row&&typeof row.id==='string'&&opportunityGeometryRow.test(row.id));if(!list.length)return;
 // Rows of one group are merged before writing; two reads of one record in a transaction see the same old value.
 const groups=new Map(),gone=[];
 for(const row of list){
  if(row.deleted){gone.push(row.id);continue;}
  let body;try{body=JSON.parse(row.body);}catch{continue;}
  const value=body?.kind==='geom'?body.value:null;
  if(value?.v!==OPPORTUNITY_GEOMETRY_VERSION||!value.entries||typeof value.entries!=='object'||Array.isArray(value.entries))continue;
  const id=typeof value.group==='string'&&opportunityGeometryRow.test(value.group)?value.group:row.id;
  groups.set(id,{...(groups.get(id)||{}),...value.entries});
 }
 void opportunityGeometryDo('readwrite',store=>{
  for(const id of gone)if(!groups.has(id))store.delete(id);
  for(const [id,entries] of groups){
   const request=store.get(id);
   request.onsuccess=()=>{const now=request.result?.owner===owner?request.result:null;store.put({id,owner,entries:{...entries,...(now?.entries||{})},uploaded:now?now.uploaded:true,updatedAt:now?now.updatedAt:Date.now()});};
  }
  return null;
 }).catch(()=>{});
}
// Rows of this kind arrive through the account sync; production code skips them.
function opportunityGeometryHook(){
 if(typeof RecordSync==='undefined'||RecordSync.opportunityGeometry)return;
 const apply=RecordSync.apply;RecordSync.apply=rows=>{opportunityGeometryReceive(rows);return apply(rows);};RecordSync.opportunityGeometry=true;
}
opportunityGeometryHook();
const opportunityGeometryTurns=new Map();
async function opportunityGeometryTurn(id){
 const before=opportunityGeometryTurns.get(id);let release;const mine=new Promise(resolve=>{release=resolve;}),chain=(before||Promise.resolve()).then(()=>mine);
 opportunityGeometryTurns.set(id,chain);if(before)await before;
 return ()=>{release();if(opportunityGeometryTurns.get(id)===chain)opportunityGeometryTurns.delete(id);};
}
async function opportunityDigest(value){const bytes=new TextEncoder().encode(JSON.stringify(value)),digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function opportunitySemantic(pair){
 // The same fields the server's inputHash ignores: labels, record metadata.
 const value=structuredClone({...pair,id:undefined,record:undefined,sourcePlaceId:undefined});
 for(const obj of [value.place,value.target])for(const k of ['name','subtitle','note','phenomena','updatedAt','createdAt'])delete obj?.[k];
 return value;
}
function opportunityDeviceInput(pair,day){
 return {input:{...pair,contextFavorites:favorites.filter(f=>f.id===pair.target.favId).map(f=>({id:f.id,targetCategory:f.targetCategory}))},day:opportunityDateAt(day),pairId:pair.id,preferences:opportunityListSettings(),tools:(auth?.tools||[]).slice(),generation:accessState.generation,evaluationNow:Date.now()};
}
function opportunityDeviceRun(priority,work){
 return new Promise((resolve,reject)=>{opportunityDeviceQueue[priority].push({work,resolve,reject});opportunityDevicePump();});
}
// As many checks run at once as the engine has workers (one for the frame).
function opportunityDevicePump(){
 const q=opportunityDeviceQueue;
 while(q.running<opportunityEngineSlots()){
  const item=q.high.shift()||q.low.shift();if(!item)return;q.running++;
  Promise.resolve().then(item.work).then(item.resolve,item.reject).finally(()=>{q.running--;opportunityDevicePump();});
 }
}
// One (pair, day) check. Rows carry the current labels on a stored hit,
// since labels are not part of the calculation key.
async function opportunityDeviceSolve(pair,day,{priority='high',isCurrent=()=>true}={}){
 const owner=auth?.loginId;if(!owner)return {rows:[],failed:1};
 const state=await opportunityEngineOpen(),settings=opportunityListSettings();
 const key=await opportunityDigest(['astronotes.device-overlap.v1',state.engine,owner,(auth?.tools||[]).slice().sort(),settings,opportunitySemantic(pair),opportunityDateAt(day)]);
 const relabel=rows=>rows.map(row=>({...row,place:{...row.place,name:pair.place.name},target:pair.target}));
 let flight=opportunityDeviceFlights.get(key);
 if(!flight){
  flight=(async()=>{
   const saved=await opportunityDbDo('readonly',store=>store.get(key)).catch(()=>null);
   if(saved?.owner===owner&&saved.engine===state.engine){opportunityDeviceStats.hits++;return {rows:saved.rows,stored:true};}
   // A pair whose geometry is not built yet waits for the other body's check of the same
   // place and target, then uses what that check built instead of building it twice.
   const turn=Object.keys((await opportunityGeometryFor(pair)).entries).length?null:await opportunityGeometryTurn(await opportunityGeometryId(pair));
   try{return await opportunityDeviceRun(priority,async()=>{
    if(!isCurrent()||owner!==auth?.loginId)return {rows:[],cancelled:true};
    const geometry=await opportunityGeometryFor(pair);
    const began=performance.now(),result=await opportunityEngineSolve({...opportunityDeviceInput(pair,day),geometry:geometry.entries});
    opportunityDeviceStats.solves++;opportunityDeviceStats.solveMs+=Math.round(performance.now()-began);
    if(result.geometry&&typeof result.geometry==='object'&&Object.keys(result.geometry).length&&owner===auth?.loginId){opportunityDeviceStats.geometry=(opportunityDeviceStats.geometry||0)+Object.keys(result.geometry).length;await opportunityGeometryKeep(geometry.id,result.geometry);}
    if(result.status!=='complete'){opportunityDeviceStats.failures++;return {rows:result.rows||[],failed:1};}
    if(owner===auth?.loginId)await opportunityDbDo('readwrite',store=>store.put({key,owner,engine:state.engine,day:opportunityDateAt(day),savedAt:Date.now(),rows:result.rows})).catch(()=>{});
    return {rows:result.rows};
   });}finally{turn?.();}
  })().finally(()=>{if(opportunityDeviceFlights.get(key)===flight)opportunityDeviceFlights.delete(key);});
  opportunityDeviceFlights.set(key,flight);
 }
 const result=await flight;
 if(result.cancelled)return isCurrent()?opportunityDeviceSolve(pair,day,{priority,isCurrent}):{rows:[],cancelled:true};
 return {...result,rows:relabel(result.rows)};
}
// While the app is in front, the next seven days of sun/moon pairs fill in
// behind whatever screen is open. A visible list always runs first.
function opportunityDeviceBackground(){
 if(opportunityBackgroundFlight)return;
 const owner=auth?.loginId,token=auth?.token,generation=accessState.generation;
 const live=()=>!document.hidden&&opportunityAllowed()&&owner===auth?.loginId&&token===auth?.token&&generation===accessState.generation&&opportunityServer.state.enabled===false;
 let restart=false;
 opportunityBackgroundFlight=(async()=>{
  try{
   const state=await opportunityEngineOpen();await opportunityDbPrune(owner,state.engine);
   const signature=opportunitySignature(),{pairs}=opportunityPairSet(signature,['sun','moon']),[start]=opportunityBounds(opportunityDateAt(Date.now()));
   const tasks=[];for(let i=0;i<7;i++)for(const pair of pairs)tasks.push([pair,start+i*86400000]);
   let next=0;
   const lane=async()=>{
    for(let task;(task=tasks[next++]);){
     if(!live())return;if(signature!==opportunitySignature()){restart=true;return;}
     const result=await opportunityDeviceSolve(task[0],task[1],{priority:'low',isCurrent:live});
     if(!result.stored&&!result.cancelled)opportunityDeviceStats.background++;
     await recordSearchYield();
    }
   };
   await Promise.all(Array.from({length:opportunityEngineSlots()},lane));
  }catch{/* The visible list reports calculation failures. */}
  finally{opportunityBackgroundFlight=null;if(restart&&live())setTimeout(opportunityDeviceBackground,0);}
 })();
}
function opportunityPairs(bodies){
 const {groups,shapes}=recordSearchIndex(),pairs=[],unavailable=[];
 for(const favorite of favorites){
  const targets=groups.get(favorite.id);if(!targets)continue;
  // 2026-11-09 線・範囲の地点は範囲内の立ち位置で確かめる（ユーザー「範囲とか線の時も出るようにできないの？」）。
  // 立ち位置ごとの地面・稜線・外形は一度作って同期し、日ごとには太陽・月の通り道の近くだけを確かめる。
  const shape=recordSearchShape(favorite,shapes),saved=shape?{...favorite,shape}:favorite;
  for(const [targetKey,source] of targets){
   const group=source.slice().sort((a,b)=>Number(!!b.registration)-Number(!!a.registration)||when(b)-when(a)||b.updatedAt-a.updatedAt);
   const best=statusOf(favorite.id,targetKey,source);if(!best||best.result==='hidden')continue;
   const target=resolveTarget(targetKey),seen=new Set(),heightRange=RecordHeight.range(favorite.eyeHeightRangeAGL);if(favorite.eyeHeightRangeAGL!=null&&!heightRange){unavailable.push({placeId:favorite.id,targetKey,reason:'height'});continue;}if(target&&!recordMatchOpts(target,favorite)){unavailable.push({placeId:favorite.id,targetKey,reason:'alignment'});continue;}
   const savedTarget=best.target,targetMoved=target&&finite(savedTarget.latitude)&&finite(savedTarget.longitude)&&AstroNotesTerrain.distanceKm(savedTarget.latitude,savedTarget.longitude,target.latitude,target.longitude)>=NEAR_KM;
   if(!planningPairs([best],bodies).length){unavailable.push({placeId:favorite.id,targetKey,reason:'access'});continue;}if(!target||targetMoved){unavailable.push({placeId:favorite.id,targetKey,reason:'target'});continue;}
   for(const record of heightRange?[best]:group){
    if(record.removed||record.result==='hidden')continue;
    const o=heightRange||shape?favorite:record.observer||favorite;if(!shape&&AstroNotesTerrain.distanceKm(o.latitude,o.longitude,favorite.latitude,favorite.longitude)>=NEAR_KM){continue;}const place={...saved,latitude:o.latitude,longitude:o.longitude,elevation:o.elevation??favorite.elevation,groundManualM:o.elevation??favorite.groundManualM??favorite.elevation,eyeHeightAGL:o.eyeHeightAGL??favorite.eyeHeightAGL??1.5};
    place.standAglM=place.eyeHeightAGL;place.stand='ground';
    const observerKey=JSON.stringify([place.latitude,place.longitude,place.groundManualM,place.eyeHeightAGL,place.shape,heightRange]);
    if(seen.has(observerKey))continue;seen.add(observerKey);
    for(const {body}of planningPairs([record],bodies)){
     const opts=recordMatchOpts(target,favorite,body);if(!opts)continue;const id=JSON.stringify([favorite.id,targetKey,observerKey,body,opts]);pairs.push({id,sourcePlaceId:favorite.id,place,record,target,body,...opts});
    }
   }
  }
 }
 return {pairs,unavailable};
}
function opportunitySignature(){const {records,shapes}=recordSearchIndex();return JSON.stringify([auth?.loginId,accessState.generation,version,favorites,records,shapes,aimTargetList(),opportunityAirKey(),auth?.tools]);}
function opportunityPairSet(signature,bodies){
 if(opportunityPairMemo?.signature!==signature)opportunityPairMemo={signature,sets:new Map()};
 return recordBounded(opportunityPairMemo.sets,JSON.stringify(bodies),()=>opportunityPairs(bodies),4);
}
function opportunityRemember(job){
 if(!job?.scan||job.signature!==opportunitySignature())return;
 const {state}=job.scan;
 opportunityCache.set(job.key,job.remote?{remote:true,through:state.through}:{...state,rows:state.rows.slice(),pending:state.pending.slice(),failures:state.failures.slice()});
 while(opportunityCache.size>4)opportunityCache.delete(opportunityCache.keys().next().value);
}
function opportunityCancel(clear=false){if(clear)opportunityClosePicker();if(!clear)opportunityRemember(opportunityJob);opportunityJob?.scan?.cancel?.();opportunityJob?.controller?.abort();opportunityEpoch++;opportunityJob=null;if(clear){opportunityPairMemo=null;opportunityCache.clear();opportunityHost?.replaceChildren();opportunityDom=null;opportunityReturn=null;opportunityRestore=null;opportunityNotice='';}}
function opportunityCurrent(job){return opportunityActive()&&opportunityJob===job&&job.epoch===opportunityEpoch&&job.owner===auth?.token&&job.loginId===auth?.loginId&&job.generation===accessState.generation&&job.inputEpoch===opportunityInputEpoch&&job.revision===version&&job.air===opportunityAirKey(job.remote);}
function opportunityNode(tag,attrs={},text=''){const n=document.createElement(tag);Object.assign(n,attrs);n.textContent=text;return n;}
function opportunityClosePicker(){const picker=opportunityPicker;if(!picker)return;opportunityPicker=null;if(picker.dialog.open)picker.dialog.close();picker.dialog.remove();picker.trigger.setAttribute('aria-expanded','false');if(picker.trigger.isConnected&&opportunityActive())picker.trigger.focus({preventScroll:true});}
function opportunityPickerOptions(kind){return kind==='bodies'?AstroNotesBodies.definitions.filter(b=>opportunityPermittedBodies.includes(b.id)).map(b=>[b.id,b.name]):opportunityPlaces;}
function opportunityFilterLabel(kind){
 const options=opportunityPickerOptions(kind),all=kind==='bodies'?opportunityFilters.allBodies:opportunityFilters.allPlaces,ids=kind==='bodies'?opportunityFilters.bodies:opportunityFilters.places,selected=options.filter(([id])=>ids.includes(id));
 if(all)return 'すべて';
 if(!selected.length)return '選び直してください';
 if(selected.length===1)return selected[0][1];
 return kind==='bodies'&&selected.length===2?selected[0][1]+'・'+selected[1][1]:selected.length+(kind==='bodies'?'天体':'地点');
}
function opportunityPickerKey(kind){return JSON.stringify([auth?.loginId,accessState.generation,version,favorites,load(),shapeData(),aimTargetList(),auth?.tools,opportunityPickerOptions(kind)]);}
function opportunityOpenPicker(kind,trigger){
 if(!opportunityActive())return;opportunityClosePicker();opportunityNotice='';if(opportunityJob)opportunityDraw(opportunityJob);const options=opportunityPickerOptions(kind),ids=kind==='bodies'?opportunityFilters.bodies:opportunityFilters.places,all=kind==='bodies'?opportunityFilters.allBodies:opportunityFilters.allPlaces;
 const draft=new Set(all?options.map(([id])=>id):ids.filter(id=>options.some(([key])=>key===id))),dialog=opportunityNode('dialog',{id:'recordOpportunityPicker',className:'record-opportunity-picker'}),heading=opportunityNode('h2',{id:'recordOpportunityPickerTitle'},kind==='bodies'?'天体':'撮影地点'),close=opportunityNode('button',{type:'button',className:'chip',id:'recordOpportunityPickerClose'},'取消'),header=opportunityNode('div',{className:'record-opportunity-picker-head'});dialog.setAttribute('aria-labelledby',heading.id);header.append(heading,close);
 const search=opportunityNode('input',{type:'search',id:'recordOpportunityPickerSearch',className:'fav-in',placeholder:'地点名で検索'});search.setAttribute('aria-label','撮影地点を名前で検索');search.hidden=kind!=='places';
 const tools=opportunityNode('div',{className:'record-opportunity-picker-tools'}),selectAll=opportunityNode('button',{type:'button',className:'chip',id:'recordOpportunitySelectAll'},'全選択'),clear=opportunityNode('button',{type:'button',className:'chip',id:'recordOpportunityClearAll'},'全解除');tools.append(selectAll,clear);
 const list=opportunityNode('div',{className:'record-opportunity-picker-list',id:'recordOpportunityPickerList'}),footer=opportunityNode('div',{className:'record-opportunity-picker-foot'}),count=opportunityNode('span',{className:'tiny',id:'recordOpportunityPickerCount'}),apply=opportunityNode('button',{type:'button',className:'chip',id:'recordOpportunityPickerApply'},'適用');count.setAttribute('role','status');footer.append(count,apply);
 const update=()=>{count.textContent=draft.size+' / '+options.length+'件を選択';apply.disabled=!draft.size;selectAll.disabled=!options.length||draft.size===options.length;clear.disabled=!draft.size;};
 const draw=()=>{list.replaceChildren();const query=search.value.trim().normalize('NFKC').toLocaleLowerCase('ja');for(const [id,name]of options){if(query&&!name.normalize('NFKC').toLocaleLowerCase('ja').includes(query))continue;const label=opportunityNode('label',{className:'record-opportunity-picker-item'}),input=opportunityNode('input',{type:'checkbox',value:id,checked:draft.has(id)});input.onchange=()=>{if(input.checked)draft.add(id);else draft.delete(id);update();};label.append(input,opportunityNode('span',{},name));list.append(label);}if(!list.firstChild)list.append(opportunityNode('p',{className:'tiny'},options.length?'該当する地点がありません':'選択できる項目がありません'));update();};
 selectAll.onclick=()=>{for(const [id]of options)draft.add(id);draw();};clear.onclick=()=>{draft.clear();draw();};search.oninput=draw;close.onclick=opportunityClosePicker;dialog.addEventListener('cancel',e=>{e.preventDefault();opportunityClosePicker();});
 apply.onclick=()=>{if(!opportunityPicker||opportunityPicker.signature!==opportunityPickerKey(opportunityPicker.kind)||!opportunityActive()){opportunityClosePicker();opportunityNotice='登録内容や利用条件が変わりました。選択を開き直してください。';renderOpportunities();return;}const chosen=options.map(([id])=>id).filter(id=>draft.has(id));if(!chosen.length)return;const patch=kind==='bodies'?{bodies:chosen,allBodies:chosen.length===options.length}:{places:chosen,allPlaces:chosen.length===options.length};opportunityClosePicker();if(Object.entries(patch).every(([key,value])=>JSON.stringify(opportunityFilters[key])===JSON.stringify(value)))return;opportunitySet(patch);};
 dialog.append(header,search,tools,list,footer);opportunityDom.host.append(dialog);opportunityPicker={dialog,trigger,kind,signature:opportunityPickerKey(kind)};trigger.setAttribute('aria-expanded','true');draw();dialog.showModal();
}
function opportunityBuild(){
 const host=el('recordOpportunities');if(!host)return false;opportunityHost=host;
 if(opportunityDom?.host===host&&host.firstChild)return true;
 host.replaceChildren();const controls=opportunityNode('div',{className:'record-opportunity-controls'}),period=opportunityNode('div',{className:'record-opportunity-period'});
 const prev=opportunityNode('button',{type:'button',className:'chip'},'‹'),date=opportunityNode('input',{type:'date',id:'recordOpportunityDate',className:'fav-in'}),next=opportunityNode('button',{type:'button',className:'chip'},'›'),today=opportunityNode('button',{type:'button',className:'chip'},'今日');
 prev.id='recordOpportunityPrev';next.id='recordOpportunityNext';today.id='recordOpportunityToday';prev.setAttribute('aria-label','前の日');next.setAttribute('aria-label','次の日');date.setAttribute('aria-label','重なる日を調べる日付');
 const change=delta=>{const [start]=opportunityBounds(opportunityFilters.date);opportunitySet({date:opportunityDateAt(start+delta*86400000)});};prev.onclick=()=>change(-1);next.onclick=()=>change(1);date.onchange=()=>opportunitySet({date:date.value});today.onclick=()=>opportunitySet({date:opportunityDateAt(Date.now())});const dateWrap=opportunityNode('label',{className:'record-opportunity-date'}),dateLabel=opportunityNode('span');dateLabel.setAttribute('aria-hidden','true');dateWrap.append(dateLabel,date);period.append(prev,dateWrap,next,today);
 const filters=opportunityNode('div',{className:'record-opportunity-filters'}),body=opportunityNode('button',{type:'button',id:'recordOpportunityBody',className:'fav-in record-opportunity-select'}),place=opportunityNode('button',{type:'button',id:'recordOpportunityPlace',className:'fav-in record-opportunity-select'});
 for(const [control,label,kind]of [[body,'天体','bodies'],[place,'撮影地点','places']]){const wrap=opportunityNode('div',{className:'record-opportunity-filter'}),caption=opportunityNode('span',{id:control.id+'Label'},label);control.setAttribute('aria-labelledby',caption.id+' '+control.id);control.setAttribute('aria-haspopup','dialog');control.setAttribute('aria-expanded','false');control.onclick=()=>opportunityOpenPicker(kind,control);wrap.append(caption,control);filters.append(wrap);}
 const notice=opportunityNode('p',{id:'recordOpportunityNotice',className:'tiny'});notice.setAttribute('role','status');
 const modelNotice=opportunityNode('p',{id:'recordOpportunityModelNotice',className:'tiny',hidden:true},'軌道上の候補。大気差は見え方で確認');
 const status=opportunityNode('div',{id:'recordOpportunityStatus',className:'tiny'});status.setAttribute('role','status');
 const list=opportunityNode('div',{id:'recordOpportunityList'}),pending=opportunityNode('div',{id:'recordOpportunityPending'}),actions=opportunityNode('div',{className:'record-opportunity-actions'});
 const through=opportunityNode('p',{id:'recordOpportunityThrough',className:'tiny record-opportunity-through'});
 const retry=opportunityNode('button',{type:'button',id:'recordOpportunityRetry',className:'chip',hidden:true},'再試行');
 const more=opportunityNode('button',{type:'button',id:'recordOpportunityMore',className:'chip',hidden:true},'さらに先を探す');
 retry.onclick=()=>{
  const job=opportunityJob;if(!job||!opportunityCurrent(job)||job.scan.state.running)return;
  opportunityNotice='';if(job.remote&&(!job.scan.state.error||job.scan.state.error.code==='overlap_plan_failed')&&job.scan.retry?.()){opportunityDom.rendered=-1;void opportunityAdvance(job);return;}const end=job.scan.state.end;opportunityCancel();opportunityCache.delete(job.key);renderOpportunities(end);
 };
 more.onclick=()=>{
  const job=opportunityJob;if(!job||!opportunityCurrent(job))return;
  if(job.scan.extend(opportunityPageEnd(job.scan.state.through),opportunityPageRows))void opportunityAdvance(job);
 };
 actions.append(retry,more);controls.append(period,filters);host.append(controls,modelNotice,notice,status,list,pending,through,actions);
 opportunityDom={host,prev,date,dateLabel,next,today,body,place,modelNotice,notice,status,list,pending,through,retry,more,rendered:0,lastDay:null};return true;
}
function opportunitySet(patch){
 if(!opportunityAllowed())return;opportunityClosePicker();
 const date=patch.date??opportunityFilters.date;
 if(!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)||date<'1900-01-01'||date>'2100-12-31'||opportunityDateAt(opportunityBounds(date)[0])!==date){if(opportunityDom)opportunityDom.date.value=opportunityFilters.date;return;}
 opportunityDateChosen=true;opportunityOpenSeq++;opportunityNotice='';opportunityFilters={...opportunityFilters,...patch,date};opportunityCancel();renderOpportunities();
}
function opportunityRow(row,job){
 const button=opportunityNode('button',{type:'button',className:'record-opportunity-row'}),time=opportunityNode('span',{className:'record-opportunity-time'},S.JstCal.hhmm(row.event.at)),name=opportunityNode('strong',{},row.place.name+' → '+row.target.name),body=opportunityNode('span',{className:'record-opportunity-body'},AstroNotesBodies.definition(row.body)?.name||row.body),arrow=opportunityNode('span',{className:'record-opportunity-arrow'},'›');arrow.setAttribute('aria-hidden','true');button.append(time,name,body,arrow);const details=[];if(!row.place.eyeHeightRangeAGL&&job.pairs.some(p=>p.sourcePlaceId===row.sourcePlaceId&&p.target.id===row.target.id&&p.place.eyeHeightAGL!==row.place.eyeHeightAGL))details.push('地上'+row.place.eyeHeightAGL+'m');if(row.event.matchMode==='limb')details.push(RecordAlignment.text(row.target,row.event));if(row.place.eyeHeightRangeAGL)details.push('地上'+row.place.eyeHeightAGL+'m');if(row.shapeType)details.push((row.shapeType==='line'?'線上':'範囲内')+' '+row.place.latitude.toFixed(5)+', '+row.place.longitude.toFixed(5));if(details.length){button.classList.add('has-height');button.append(opportunityNode('span',{className:'record-opportunity-height'},details.join(' ・ ')));}button.dataset.opportunityId=row.id;button.onclick=()=>openOpportunity(row,job);return button;
}
// Rows of the day still being checked appear below the confirmed days, so
// confirmed rows never move. They join the list in order once the day ends.
function opportunityDrawPending(job){
 const d=opportunityDom,s=job.scan.state,pending=!s.done&&!job.remote?(s.pending||[]).slice().sort((a,b)=>a.event.at-b.event.at):[];
 job.pendingDrawn=pending.length;d.pending.replaceChildren();if(!pending.length)return;
 d.pending.append(opportunityNode('h3',{className:'record-opportunity-day'},dayText(pending[0].event.at)+'（確認中）'));
 for(const row of pending)d.pending.append(opportunityRow(row,job));
}
function opportunityDraw(job){
 if(!opportunityCurrent(job)||!opportunityDom)return;
 const d=opportunityDom,s=job.scan.state,rows=s.rows;
 d.modelNotice.hidden=false;
 d.host.setAttribute('aria-busy',String(s.running&&!s.done));
 if(d.rendered<0){d.list.replaceChildren();d.rendered=0;d.lastDay=null;}
 for(const row of s.rows.slice(d.rendered)){
  const date=opportunityDateAt(row.event.at);if(d.lastDay!==date){d.lastDay=date;d.list.append(opportunityNode('h3',{className:'record-opportunity-day'},dayText(row.event.at)));}
  d.list.append(opportunityRow(row,job));
 }d.rendered=s.rows.length;
 opportunityDrawPending(job);
 const failures=s.failures.length+job.unavailable;
 d.notice.textContent=opportunityNotice;
 if(s.error){job.progressUi=null;d.status.textContent=s.error.message||'サーバーに接続できません。再試行してください。';}
 else if(!s.done&&(job.remote||job.pairs.length)){
  if(job.progressUi?.node.parentNode!==d.status)job.progressUi=showRecordProgress(d.status,job.remote?'サーバーで確認中':'確認中','組');
  job.progressUi.update(s.checked,s.total);
 }else{
  job.progressUi=null;d.status.textContent=!job.pairs.length?(!opportunityFilters.allPlaces&&!opportunityFilters.places.length?'撮影地点を選び直してください。':job.unavailable?(job.policyUnavailable?'撮影地点の高さや重ね方を確認してください。':job.accessUnavailable===job.unavailable?'現在の権限では、この組み合わせを確認できません':'対象の登録を確認してください。'):'この組み合わせで確認できる記録がありません'):failures?(s.failures.length?'確認できなかった組み合わせがあります':job.accessUnavailable===job.unavailable?'現在の権限では確認できない組み合わせがあります':'対象の登録を確認してください。'):rows.length?'':'確認した期間に重なる組み合わせはありません';
 }
 d.through.textContent=job.pairs.length&&s.through>job.start?opportunityDateAt(s.through-1).replaceAll('-','/')+(failures?'まで探索（未確認あり）':'まで確認'):'';
 d.retry.hidden=!s.done||(!s.failures.length&&!s.error);
 d.more.hidden=!job.pairs.length||s.done&&s.through>=aimCandidateSearchEnd();
 d.more.disabled=!s.done||s.running||!!s.error;d.more.textContent=s.running?'計算中…':'さらに先を探す';
 if(opportunityRestore!==null&&(s.done||document.scrollingElement.scrollHeight-innerHeight>=opportunityRestore)){const top=opportunityRestore;opportunityRestore=null;requestAnimationFrame(()=>{if(opportunityActive())scrollTo(0,top);});}
}
async function opportunityAdvance(job){
 if(!job||!opportunityCurrent(job)||job.scan.state.running)return;
 await job.scan.advance();if(!opportunityCurrent(job)){if(opportunityJob===job&&opportunityActive()&&job.air!==opportunityAirKey(job.remote)){opportunityCancel();renderOpportunities();}return;}
 if(job.scan.state.cancelled){opportunityCancel();renderOpportunities();return;}
 if(job.remote&&job.scan.state.done&&!job.scan.state.error&&job.restoreThrough>job.scan.state.through&&job.scan.extend(opportunityPageEnd(job.scan.state.through))){void opportunityAdvance(job);return;}
 if(job.scan.state.done)opportunityRemember(job);
 opportunityDraw(job);
}
function renderOpportunities(retryEnd){
 recordSearchReset();
 const owner=auth?.token;
 if(opportunityOwner!==owner||opportunityOwnerId!==auth?.loginId){if(opportunityOwnerId&&opportunityOwnerId!==auth?.loginId){opportunityBackgroundFlight=null;opportunityDeviceFlights.clear();opportunityDeviceForget();}opportunityCancel(true);opportunityServer.cancel();opportunityWarmupKey='';opportunityOwner=owner;opportunityOwnerId=auth?.loginId;opportunityDateChosen=false;opportunityFilters={date:opportunityDateAt(Date.now()),bodies:['sun','moon'],allBodies:false,places:[],allPlaces:true};}
 if(!opportunityActive()){if(opportunityAllowed())setTimeout(opportunityWarmup,0);opportunityClosePicker();if(opportunityJob)opportunityCancel();if(opportunityHost?.firstChild){opportunityHost.replaceChildren();opportunityDom=null;}return;}
 if(!opportunityDateChosen){const selected=typeof SkyMapUI!=='undefined'?SkyMapUI.selectionState?.():null;opportunityFilters.date=opportunityDateAt(Number.isFinite(selected?.at)?selected.at:Date.now());opportunityDateChosen=true;}
 if(!opportunityBuild())return;
 opportunityPermittedBodies=AstroNotesBodies.definitions.filter(b=>aimTargetList().some(t=>AstroNotesAccess.canFrame(toolAllowed,t.id,b.id))).map(b=>b.id);if(opportunityFilters.allBodies)opportunityFilters.bodies=opportunityPermittedBodies.slice();
 if(opportunityPicker&&opportunityPicker.signature!==opportunityPickerKey(opportunityPicker.kind)){opportunityClosePicker();opportunityNotice='登録内容や利用条件が変わりました。選択を開き直してください。';}
 const signature=opportunitySignature(),d=opportunityDom,{pairs:allPairs,unavailable}=opportunityPairSet(signature,opportunityFilters.bodies),available=opportunityPairSet(signature,opportunityPermittedBodies);
 opportunityPlaces=[...new Map([...available.pairs.map(p=>[p.sourcePlaceId,p.place.name]),...available.unavailable.map(p=>[p.placeId,placeOf(p.placeId)?.name||'撮影地点'])]).entries()];
 if(opportunityFilters.allPlaces)opportunityFilters.places=opportunityPlaces.map(([id])=>id);else opportunityFilters.places=opportunityFilters.places.filter(id=>opportunityPlaces.some(([key])=>key===id));
 d.body.textContent=opportunityFilterLabel('bodies');d.place.textContent=opportunityFilterLabel('places');d.body.dataset.values=JSON.stringify(opportunityFilters.bodies);d.place.dataset.values=JSON.stringify(opportunityFilters.places);d.body.disabled=!opportunityPermittedBodies.length;d.place.disabled=!opportunityPlaces.length;
 d.date.value=opportunityFilters.date;d.dateLabel.textContent=opportunityFilters.date.replaceAll('-','/');d.date.min='1900-01-01';d.date.max='2100-12-31';d.prev.disabled=opportunityFilters.date===d.date.min;d.next.disabled=opportunityFilters.date===d.date.max;
 const [start]=opportunityBounds(opportunityFilters.date),end=Number.isFinite(retryEnd)?retryEnd:opportunityPageEnd(start),key=JSON.stringify([signature,opportunityFilters]);
 if(opportunityJob?.key===key&&opportunityCurrent(opportunityJob)){opportunityDraw(opportunityJob);return;}
 opportunityCancel();d.list.replaceChildren();d.rendered=-1;
 const includesPlace=p=>opportunityFilters.places.includes(p.sourcePlaceId??p.placeId),pairs=allPairs.filter(includesPlace),missing=unavailable.filter(includesPlace).length;
 const scanStart=start,job={remote:opportunityServer.state.enabled!==false,key,signature,owner,loginId:auth?.loginId,generation:accessState.generation,epoch:opportunityEpoch,inputEpoch:opportunityInputEpoch,revision:version,air:opportunityAirKey(opportunityServer.state.enabled!==false),pairs,unavailable:missing,accessUnavailable:unavailable.filter(p=>includesPlace(p)&&p.reason==='access').length,policyUnavailable:unavailable.filter(p=>includesPlace(p)&&['height','alignment'].includes(p.reason)).length,start:scanStart};opportunityJob=job;
 job.controller=new AbortController();
 job.scan={state:{day:start,end,through:start,rows:[],pending:[],failures:[],checked:0,total:0,done:false,running:true,error:null},cancel:()=>job.controller.abort()};
 opportunityDraw(job);void opportunityStart(job,end,retryEnd);
}
async function opportunityStart(job,end,retryEnd){
 try{
  const prefs=await opportunityServer.ready();if(opportunityJob!==job||job.controller.signal.aborted||!opportunityActive()||job.owner!==auth?.token||job.loginId!==auth?.loginId||job.generation!==accessState.generation)return;
  // Applying an existing account preference can change targets and the cache
  // signature. Rebuild pair metadata before accepting any server results.
  if(job.signature!==opportunitySignature()){opportunityCancel();renderOpportunities(retryEnd);return;}
  job.remote=prefs.enabled;job.air=opportunityAirKey(job.remote);
  if(job.remote){const cached=opportunityCache.get(job.key);if(cached?.remote){job.restoreThrough=cached.through;opportunityCache.delete(job.key);}job.scan=createServerOpportunityScan({api:(...args)=>apiTransport(...args),start:job.start,end,bodies:opportunityFilters.bodies.slice(),placeIds:opportunityFilters.allPlaces?null:opportunityFilters.places.slice(),sourceRev:prefs.sourceRev,isCurrent:()=>opportunityCurrent(job),onStart:()=>opportunityDraw(job),onDay:()=>opportunityDraw(job),onProgress:()=>opportunityDraw(job)});}
  else{
   const solve=(pair,day,isCurrent)=>opportunityDeviceSolve(pair,day,{isCurrent});
   job.scan=createOpportunityScan({pairs:job.pairs,start:job.start,end,notBefore:job.start,pageRows:Number.isFinite(retryEnd)?Infinity:opportunityPageRows,solve,ahead:()=>opportunityEngineSlots()*2,isCurrent:()=>opportunityCurrent(job),yieldTask:recordSearchYield,onStart:()=>opportunityDraw(job),onDay:()=>opportunityDraw(job),onProgress:s=>{if(!opportunityCurrent(job))return;job.progressUi?.update(s.checked,s.total);if(s.pending.length!==job.pendingDrawn)opportunityDraw(job);}});
   const cached=opportunityCache.get(job.key);if(cached){opportunityCache.delete(job.key);Object.assign(job.scan.state,cached,{running:false,cancelled:false});opportunityDraw(job);}
  }
  if(!job.scan.state.done)void opportunityAdvance(job);
 }catch(error){
  if(opportunityJob!==job||job.controller.signal.aborted||!opportunityActive()||job.owner!==auth?.token||job.loginId!==auth?.loginId||job.generation!==accessState.generation||job.epoch!==opportunityEpoch||job.inputEpoch!==opportunityInputEpoch||job.revision!==version)return;
  // The GET may have applied the account's target heights before a migration
  // CAS failed. Keep that error visible instead of leaving the old key loading.
  job.air=opportunityAirKey(job.remote);job.signature=opportunitySignature();Object.assign(job.scan.state,{running:false,done:true,error});opportunityDraw(job);
 }

}
function openOpportunityList(placeId='',bodies=null){
 if(!opportunityAllowed())return;
 opportunityOpenSeq++;opportunityNotice='';opportunityFilters={...opportunityFilters,places:placeId?[placeId]:[],allPlaces:!placeId,...(bodies?.length?{bodies:bodies.filter(b=>AstroNotesBodies.definition(b)),allBodies:false}:{})};opportunityCancel();
 if(sheet?.open)sheet.close();setNotebookTab('opportunities');if(!viewState.records)navigationHistory.pushRoute('#/records');renderOpportunities();
 requestAnimationFrame(()=>{el('recordOpportunities')?.scrollIntoView({block:'start'});el('recordOpportunityPlace')?.focus({preventScroll:true});});
}
async function openOpportunity(row,job){
 if(!opportunityCurrent(job)){renderOpportunities();return;}if(!job.scan.state.rows.includes(row)&&!job.scan.state.pending?.includes(row)||!AstroNotesAccess.canFrame(toolAllowed,row.target.id,row.body))return;
 opportunityNotice='';const ticket=++opportunityOpenSeq,owner=auth?.token,loginId=auth?.loginId,generation=accessState.generation,signature=job.signature,top=scrollY;
 try{
  await AstroNotesAssets.ensureModels();
  if(ticket!==opportunityOpenSeq||!opportunityCurrent(job))return;
  opportunityReturn={owner,loginId,generation,signature,top,ticket};navigationHistory.pushRoute('#/explore');await SkyMapUI.open();
  if(ticket!==opportunityOpenSeq||owner!==auth?.token||loginId!==auth?.loginId||!globalThis.TrialExplore?.active())return;if(generation!==accessState.generation||signature!==opportunitySignature())throw Error('conditions changed');
  SkyMapUI.setTarget(row.target.id);if(SkyMapUI.selectionState()?.target?.id!==row.target.id)throw Error('target unavailable');
  const body=el('skyMapBody');body.value=row.body;body.dispatchEvent(new Event('change',{bubbles:true}));SkyMapUI.setAlignment(row.event.partId??matchOpts(row.target).partId,row.event.limb||'center',row.event.matchMode||'overlap');SkyMapUI.setObserver(AstroNotesShooting.savedObserver(row.place));SkyMapUI.setTime(row.event.at);TrialExplore.render();el('exploreShowResult').click();
 }catch{if(ticket!==opportunityOpenSeq||owner!==auth?.token||loginId!==auth?.loginId)return;opportunityNotice='条件が変わったか、見え方を開けませんでした。もう一度お試しください。';if(opportunityReturn?.ticket===ticket){opportunityRestore=top;opportunityReturn=null;opportunityNotice='条件が変わったか、見え方を開けませんでした。もう一度お試しください。';if(globalThis.TrialExplore?.active())navigationHistory.goBack();}renderOpportunities();}
}
function opportunityHasReturn(){return !!opportunityReturn&&opportunityReturn.owner===auth?.token&&opportunityReturn.loginId===auth?.loginId&&opportunityReturn.generation===accessState.generation;}
function opportunityReturnFromPreview(){if(!opportunityHasReturn()||!globalThis.TrialExplore?.active())return false;opportunityRestore=opportunityReturn.top;opportunityReturn=null;navigationHistory.goBack();return true;}
for(const type of ['pointerdown','wheel'])el('recordOpportunities').addEventListener(type,()=>{opportunityRestore=null;},{passive:true});
const opportunityWatch=new MutationObserver(()=>{renderOpportunities();});opportunityWatch.observe(el('recordsView'),{attributes:true,attributeFilter:['hidden','data-tab']});
document.addEventListener('astronotes-records-change',()=>{setTimeout(()=>{if(opportunityAllowed()&&!document.hidden&&opportunityServer.state.enabled===false)opportunityDeviceBackground();},0);if(opportunityJob?.remote&&opportunityJob.signature===opportunitySignature())return;opportunityInputEpoch++;if(opportunityActive())renderOpportunities();});document.addEventListener('visibilitychange',renderOpportunities);document.addEventListener('astronotes-opportunity-input',()=>{if(opportunityApplyingPreferences)return;if(opportunityJob?.remote&&opportunityJob.air===opportunityAirKey(true))return;opportunityInputEpoch++;if(opportunityActive())renderOpportunities();});document.addEventListener('astronotes-opportunity-settings',()=>{if(opportunityApplyingPreferences)return;const key=JSON.stringify(opportunityListSettings()),changed=key!==opportunityListSettingsKey;opportunityListSettingsKey=key;if(changed)opportunityServer.changed();if(!changed&&opportunityServer.state.enabled===true)return;opportunityInputEpoch++;opportunityWarmupKey='';if(opportunityActive())renderOpportunities();else opportunityWarmup();});window.addEventListener('focus',renderOpportunities);
window.addEventListener('pagehide',()=>{if(opportunityJob)opportunityCancel();});window.addEventListener('pageshow',renderOpportunities);
window.addEventListener('hashchange',()=>{if(viewState.records&&opportunityHasReturn()){opportunityRestore=opportunityReturn.top;opportunityReturn=null;}else if(!viewState.records&&!globalThis.TrialExplore?.active())opportunityReturn=null;renderOpportunities();});
setTimeout(()=>{startupSessionReady.then(opportunityWarmup);},0);
const opportunities={render:renderOpportunities,open:openOpportunityList,hasReturn:opportunityHasReturn,returnFromPreview:opportunityReturnFromPreview};
