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
async function aimShootingView(obs, target, body, partId, matchMode, indexed=false) {
  if(matchMode!=='overlap'||!aimIsMountain(target))return null;
  const eye=obs.elevation+obs.eyeM;
  let cap=null,ridge;
  if(indexed)try { cap=await trialSearchRidge(obs,eye,target); } catch { /* Try the original sampler. */ }
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
   if(indexed&&p.target.id==='fuji')return aimShootingView(obs,p.target,p.body,p.partId,p.matchMode,true);`);
  source=patch(source,'ensure:b=>AstroNotesBodies.ensure(b),viewFor,yieldTask:recordSearchYield',
    'ensure:b=>AstroNotesBodies.ensure(b),viewFor,fixedViewFor:(obs,p)=>viewFor(obs,p,true),yieldTask:recordSearchYield');
  return patch(source,'const normal={align,isMountain,observerAt,elevationAt,ensure,viewFor,yieldTask:',
    'const normal={align,isMountain,observerAt,elevationAt,ensure,viewFor:deps.fixedViewFor??viewFor,yieldTask:');
}
