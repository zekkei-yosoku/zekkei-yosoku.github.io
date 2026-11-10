import {readFileSync} from 'node:fs';

function patch(source,before,after) {
  if(source.split(before).length!==2)throw Error('Indexed ridge source boundary changed');
  return source.replace(before,()=>after);
}
const body=name=>readFileSync(new URL(name,import.meta.url),'utf8').replace(/^export /gm,'');

export function patchIndexedRidgeTerrain(source) {
  source=patch(source,'tileAvailability.set(p,availability);',`tileAvailability.set(p,availability);
    p.then(image=>{ availability.image=image; },()=>{});`);
  source=patch(source,'  const sampleTiles=createExactTerrainBatch',`  function currentRidgeTile(layer,z,x,y) {
    const key=(layer==='dem_png'?'':layer+'/')+z+'/'+x+'/'+y;
    const pending=tiles.get(key),entry=pending&&tileAvailability.get(pending);
    return entry?.image||entry?.missing===true?entry:null;
  }
  function ridgeSampleCoverage(from,box,range,base) {
    const x0=tileXf(box.west,0),x1=tileXf(box.east,0);
    const y0=tileYf(box.north,0),y1=tileYf(box.south,0);
    return point=>{
      if(!inJapan(point.latitude,point.longitude))return false;
      const x=tileXf(point.longitude,0),y=tileYf(point.latitude,0);
      if(!(x>=x0&&x<=x1&&y>=y0&&y<=y1))return false;
      const z=zoomFor(from,point,base);
      return z>=range.min&&z<=range.max;
    };
  }
  const sampleTiles=createExactTerrainBatch`);
  source=patch(source,'const raw = points.length<32 ?', 'const raw = points.length<32 && !opts.indexedExactBatch ?');
  return patch(source,'    destination, prepareRidgeDestination,','    destination, currentRidgeTile, ridgeSampleCoverage, prepareRidgeDestination,');
}

export function patchIndexedRidgeHtml(source) {
  const before=`async function aimShootingView(obs, target, body, partId, matchMode) {
  if(matchMode!=='overlap'||!aimIsMountain(target))return null;
  const eye=obs.elevation+obs.eyeM,ridge=await aimLookRidge(obs,eye,target,{});
  if(!ridge)throw Error('山の稜線を取得できませんでした。再試行してください');
  const cap=aimSummitCap(ridge,obs,eye,target);`;
  const after=`const trialSearchRidge=(()=>{
${body('./resident-ridge-index.mjs')}
${body('./ridge-fan-bounds.mjs')}
${body('./indexed-search-ridge.mjs')}
  let resident;
  return async (obs,eye,target)=>{
    if(target.id!=='fuji'||typeof AstroNotesTerrain.currentRidgeTile!=='function')return null;
    resident??=createResidentHeightIndex(AstroNotesTerrain.currentRidgeTile);
    const solve=createIndexedSearchRidge({
      terrain:AstroNotesTerrain,align:AstroNotesAlign,atmosphere:AstroNotesAtmosphere,angle:aimAirAngle,
      capOf:aimSummitCap,index:resident.begin(),makeBounds:createMetricFanBounds,zoomRange:ridgeZoomRange
    });
    return solve(obs,eye,target);
  };
})();
// 2026-11-09 稜線（山頂の帽子）は日付と天体に依存しない。同じ地点・目線・山・大気係数なら
// 一度だけ索引で求め、別の日・太陽/月でも使い回す（以前は毎回計算し直していた）。
const aimIndexedCaps=new Map(),AIM_INDEXED_CAP_LIMIT=6000;
// 計算ページ（本体のSHAを持つ別frame）だけは、端末内へも保存して再読み込み後に使い回す。
// 保存は本体のSHAごと。本体が変われば古い稜線は消す。
const aimCapStore=(()=>{
  const engine=globalThis.document?.documentElement?.dataset?.engine,idb=globalThis.indexedDB;
  if(!engine||!idb)return null;
  const LIMIT=20000;let db=null,pruned=false;
  const open=()=>db??=new Promise((resolve,reject)=>{
    const request=idb.open('astronotes-ridge-caps',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('caps',{keyPath:'key'}).createIndex('savedAt','savedAt');
    request.onsuccess=()=>{const opened=request.result;opened.onversionchange=()=>{opened.close();db=null;};resolve(opened);};
    request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('blocked'));
  }).catch(()=>{db=null;return null;});
  const run=(mode,work)=>open().then(opened=>opened&&new Promise(resolve=>{
    let value=null;try{const tx=opened.transaction('caps',mode),request=work(tx.objectStore('caps'));if(request)request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>resolve(null);}catch{resolve(null);}
  })).catch(()=>null);
  const prune=()=>{
    if(pruned)return;pruned=true;
    void run('readwrite',store=>{
      const request=store.openCursor();let kept=0;
      request.onsuccess=()=>{const cursor=request.result;if(cursor){if(cursor.value.engine!==engine)cursor.delete();else kept++;cursor.continue();return;}
        if(kept<=LIMIT)return;let extra=kept-LIMIT;const oldest=store.index('savedAt').openCursor();oldest.onsuccess=()=>{const c=oldest.result;if(!c||extra<=0)return;c.delete();extra--;c.continue();};};
      return null;
    });
  };
  return {
    get:key=>{prune();return run('readonly',store=>store.get(key)).then(v=>v?.engine===engine&&Array.isArray(v.cap?.ridge)&&Number.isFinite(v.cap?.base)?v.cap:null);},
    put:(key,cap)=>run('readwrite',store=>store.put({key,engine,savedAt:Date.now(),cap:{ridge:cap.ridge,base:cap.base}})),
  };
})();
function aimIndexedCap(obs,eye,target){
  const key=JSON.stringify([obs.latitude,obs.longitude,eye,target.id,target.latitude,target.longitude,target.parts?.[0]?.m,target.rim||null,AstroNotesAtmosphere.targetK()]);
  // The overlap list passes caps it already holds (synced with the records) and collects the ones it used.
  const shared=typeof recordGeometry!=='undefined'&&recordGeometry.collect?recordGeometry:null,sharedKey='cap:'+key;
  const note=cap=>{if(cap&&shared)shared.used.set(sharedKey,{ridge:cap.ridge,base:cap.base});return cap;};
  if(aimIndexedCaps.has(key)){const hit=aimIndexedCaps.get(key);aimIndexedCaps.delete(key);aimIndexedCaps.set(key,hit);return hit.then(note);}
  const known=shared?.known.get(sharedKey);
  const pending=(async()=>{if(Array.isArray(known?.ridge)&&Number.isFinite(known?.base))return known;const saved=await aimCapStore?.get(key);if(saved)return saved;const cap=await trialSearchRidge(obs,eye,target);if(cap)void aimCapStore?.put(key,cap);return cap;})().then(cap=>{if(!cap&&aimIndexedCaps.get(key)===pending)aimIndexedCaps.delete(key);return cap;},error=>{if(aimIndexedCaps.get(key)===pending)aimIndexedCaps.delete(key);throw error;});
  aimIndexedCaps.set(key,pending);while(aimIndexedCaps.size>AIM_INDEXED_CAP_LIMIT)aimIndexedCaps.delete(aimIndexedCaps.keys().next().value);
  return pending.then(note);
}
async function aimShootingView(obs, target, body, partId, matchMode, indexed=false) {
  if(matchMode!=='overlap'||!aimIsMountain(target))return null;
  const eye=obs.elevation+obs.eyeM;
  let cap=null,ridge;
  if(indexed)try { cap=await aimIndexedCap(obs,eye,target); } catch { /* Try the original sampler. */ }
  if(!cap) {
    ridge=await aimLookRidge(obs,eye,target,{exactSearch:indexed&&target.id==='fuji'});
    if(!ridge)throw Error('山の稜線を取得できませんでした。再試行してください');
    cap=aimSummitCap(ridge,obs,eye,target);
  }`;
  source=patch(source,before,after);
  // An indexed search that loses its evidence needs a fresh full calculation.
  // Its fallback must neither read nor populate the drawing/height cache.
  for(const anchor of ['if (aimRidgeCache.has(key+airK))','if (aimRidgePending.has(pendingKey))']) {
    source=patch(source,anchor,anchor.replace('if (','if (!win?.exactSearch && '));
  }
  for(const anchor of ['aimRidgeCache.set(key+airK, out);','aimRidgePending.set(pendingKey, task);']) {
    source=patch(source,anchor,'if(!win?.exactSearch)'+anchor);
  }
  return source;
}

export function patchIndexedRidgeRecordSearch(source) {
  source=patch(source,'const viewFor=(obs,p)=>{','const viewFor=(obs,p,indexed=false)=>{');
  source=patch(source,"if(p.matchMode==='overlap'&&aimIsMountain(p.target)){",`if(p.matchMode==='overlap'&&aimIsMountain(p.target)){
   if(indexed&&p.target.id==='fuji'&&variant!=='discovery')return aimShootingView(obs,p.target,p.body,p.partId,p.matchMode,true);`);
  // 探す (discovery) keeps each position's summit cap; the same indexed cap for Fuji as below.
  source=patch(source,"if(variant==='discovery')return recordMountainView(session,shaped,obs,p,false);","if(variant==='discovery')return recordMountainView(session,shaped,obs,p,indexed&&p.target.id==='fuji');");
  source=patch(source,'ensure:b=>AstroNotesBodies.ensure(b),viewFor,yieldTask:recordSearchYield',
    'ensure:b=>AstroNotesBodies.ensure(b),viewFor,fixedViewFor:(obs,p)=>viewFor(obs,p,true),yieldTask:recordSearchYield');
  return patch(source,'const normal={align,isMountain,observerAt,elevationAt,ensure,viewFor,yieldTask:',
    'const normal={align,isMountain,observerAt,elevationAt,ensure,viewFor:deps.fixedViewFor??viewFor,yieldTask:');
}
