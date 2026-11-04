/* Trial-only discovery. Existing registered-place search is not modified. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateDiscovery=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const day=at=>Math.floor((at+32400000)/86400000)*86400000-32400000;
const point=(latitude,longitude)=>({latitude,longitude});
function inside(ring,lat,lon){let on=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
 const a=ring[i],b=ring[j];if((a[1]>lat)!==(b[1]>lat)&&lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0])on=!on;
}return on;}
// Generate positions inside sidewalk geometry, not a list of named viewpoints.
// Heights of 0 in a 2D road model are deliberately not used as ground heights.
function sampleSidewalks(data,limit=600){
 const rows=[],seen=new Set(),scanLimit=data.samplingStrategy==='even'?12000:limit;let limited=false;
 for(const feature of data.features||[]){
  if(!['2000','2010','2020'].includes(feature.function))continue;
  const ring=feature.coordinatesLonLatHeight;if(!Array.isArray(ring)||ring.length<4)continue;
  const valid=ring.every(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90);if(!valid)continue;
  const lo=Math.min(...ring.map(p=>p[0])),hi=Math.max(...ring.map(p=>p[0])),a=Math.min(...ring.map(p=>p[1])),b=Math.max(...ring.map(p=>p[1]));
  const dy=12.5/111195,dx=dy/Math.max(.1,Math.cos((a+b)*Math.PI/360));
  // Narrow sidewalks may fall between grid rows; edge midpoints remain inside
  // or on the source polygon and provide deterministic extra sampling positions.
  const candidates=[];
  for(let lat=a+dy/2;lat<b;lat+=dy)for(let lon=lo+dx/2;lon<hi;lon+=dx)if(inside(ring,lat,lon)&&!(feature.interiorRingsLonLatHeight||[]).some(hole=>inside(hole,lat,lon)))candidates.push(point(lat,lon));
  for(let i=1;i<ring.length;i++)candidates.push(point((ring[i-1][1]+ring[i][1])/2,(ring[i-1][0]+ring[i][0])/2));
  for(const p of candidates){
   const key=p.latitude.toFixed(7)+','+p.longitude.toFixed(7);if(seen.has(key))continue;seen.add(key);
   if(rows.length>=scanLimit){limited=true;break;}
   rows.push({...p,sourceId:feature.sourceId,polygonId:feature.polygonId,
    groundKnown:feature.groundKnown===true,standingSurfaceKnown:feature.standingSurfaceKnown===true,
    accessKnown:feature.accessKnown===true,groundM:feature.groundM??null,region:feature.region,sourceMesh:feature.sourceMesh,nonTerrainStructure:feature.nonTerrainStructure===true,structureClassificationKnown:feature.structureClassificationKnown===true});
  }
  if(limited)break;
 }
 if(rows.length>limit){const selected=Array.from({length:limit},(_,i)=>rows[Math.floor(i*(rows.length-1)/Math.max(1,limit-1))]);return {rows:selected,limited:true};}
 return {rows,limited};
}
function keyFor(plan,version,atmosphere){return JSON.stringify([version,plan.owner,plan.body,plan.target,plan.partId,plan.limb,plan.matchMode,day(plan.at),atmosphere]);}
function create({loadData,evaluate,clock=()=>performance.now(),yieldTask=()=>new Promise(r=>setTimeout(r,0)),diagnoseUnknown=false}){
 const cache=new Map(),jobs=new Map();
 async function search(plan,{onProgress=()=>{},isCurrent=()=>true,atmosphere='standard'}={}){
  const data=await loadData();if(!isCurrent())return {cancelled:true};
  const key=keyFor(plan,data.version,atmosphere);if(cache.has(key))return {...cache.get(key),cached:true};
  if(jobs.has(key)){const result=await jobs.get(key);return !isCurrent()?{cancelled:true}:result.cancelled?search(plan,{onProgress,isCurrent,atmosphere}):{...result,cached:true};}
  const work=(async()=>{
   const start=clock(),generated=sampleSidewalks(data),counts={sampled:generated.rows.length,checked:0,aligned:0,blocked:0,unknown:0,noOverlap:0,deferred:0};const rows=[];
   for(const p of generated.rows){
    if(!isCurrent())return {cancelled:true};
    if(counts.checked%20===0)await yieldTask();if(!isCurrent())return {cancelled:true};
    counts.checked++;
    if((!p.groundKnown||!p.standingSurfaceKnown)&&!diagnoseUnknown){counts.unknown++;}
    else {
     const result=await evaluate(plan,p,data);if(!isCurrent())return {cancelled:true};
     if(result?.aligned)counts.aligned++;
     if(result?.targetRay?.hit||result?.events?.some(e=>e.rays.some(r=>r.hit)))counts.modelBlocked=(counts.modelBlocked||0)+1;
     if(result?.deferred)counts.deferred++;
     else if(result?.status==='no-overlap')counts.noOverlap++;
     else if(result?.status==='blocked'||result?.status==='model-blocked')counts.blocked++;
     else if(result?.recommend===true&&((result.status==='verified'&&p.groundKnown&&p.standingSurfaceKnown&&data.visibilityCertified===true)||(result.status==='model-visible'&&result.modelEvidence?.kind==='terrain-and-building-model-los'&&result.modelEvidence.scope==='observer-to-target'&&result.modelEvidence.buildingRangeComplete&&result.modelEvidence.terrainNumericComplete&&result.modelEvidence.actualVisibilityGuaranteed===false))&&result.event&&Number.isFinite(result.event.at)&&day(result.event.at)===day(plan.at))rows.push(result);
     else counts.unknown++;
    }
    if(counts.checked%25===0)onProgress({...counts});
   }
   const result={rows,counts,limited:generated.limited,elapsedMs:clock()-start,cached:false,dataVersion:data.version};
   cache.set(key,result);while(cache.size>8)cache.delete(cache.keys().next().value);return result;
  })();
  jobs.set(key,work);try{return await work;}finally{if(jobs.get(key)===work)jobs.delete(key);}
 }
 return {search,clear:()=>cache.clear()};
}
return {create,sampleSidewalks,keyFor,day};
});
