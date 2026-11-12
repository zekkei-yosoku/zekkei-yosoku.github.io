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
  // Narrow sidewalks can miss the grid. Sample inside each edge, never on its boundary.
  const holes=feature.interiorRingsLonLatHeight||[],k=Math.cos((a+b)*Math.PI/360),near=r=>p=>r.some((u,i)=>{const v=r[(i+1)%r.length],x=(v[0]-u[0])*k,y=v[1]-u[1],t=Math.max(0,Math.min(1,((p.longitude-u[0])*k*x+(p.latitude-u[1])*y)/(x*x+y*y||1)));
  return Math.hypot((p.longitude-u[0])*k-t*x,p.latitude-u[1]-t*y)*111195<.1;}),eligible=p=>inside(ring,p.latitude,p.longitude)&&!holes.some(h=>inside(h,p.latitude,p.longitude))&&!near(ring)(p)&&!holes.some(h=>near(h)(p));
  const candidates=[];
  for(let lat=a+dy/2;lat<b;lat+=dy)for(let lon=lo+dx/2;lon<hi;lon+=dx)if(inside(ring,lat,lon)&&!(feature.interiorRingsLonLatHeight||[]).some(hole=>inside(hole,lat,lon)))candidates.push(point(lat,lon));
  for(let i=1;i<ring.length;i++){const u=ring[i-1],v=ring[i],x=(v[0]-u[0])*k,y=v[1]-u[1],length=Math.hypot(x,y);if(!length)continue;let found=false;
  for(const offset of [.5,.25,.125]){for(const sign of [1,-1]){const p=point((u[1]+v[1])/2+sign*x/length*offset/111195,(u[0]+v[0])/2-sign*y/length*offset/(111195*k));if(eligible(p)){candidates.push(p);found=true;break;}}if(found)break;}}
  for(const p of candidates){
   if(!eligible(p))continue;const key=p.latitude.toFixed(7)+','+p.longitude.toFixed(7);if(seen.has(key))continue;seen.add(key);
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
function keyFor(plan,version,atmosphere){return JSON.stringify([version,plan.owner,plan.body,plan.target,plan.partId,plan.limb,plan.matchMode,day(plan.at),atmosphere,plan.composition||null,plan.timeWindow||null,!!plan.compositionInvalid]);}
// OS location handlers; app identity is never embedded in Android/iOS default schemes.
function mapLink(p,ua='',touchPoints=0){
 if(!p||!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude)||Math.abs(p.latitude)>90||Math.abs(p.longitude)>180)return null;
 const coord=p.latitude.toFixed(7)+','+p.longitude.toFixed(7);
 if(/Android/i.test(ua))return {href:'geo:'+coord+'?q='+coord,native:true};
 const ios=ua.match(/(?:iPhone|iPad|iPod).*?OS (\d+)[_.](\d+)/i);
 const safari=ua.match(/Version\/(\d+)\.(\d+)/),modern=v=>v&&(Number(v[1])>26||Number(v[1])===26&&Number(v[2])>=2),appleMobile=/iPhone|iPad|iPod/.test(ua)||/Macintosh/.test(ua)&&touchPoints>1;
 if(appleMobile&&(modern(ios)||modern(safari)))return {href:'geo-navigation:///place?coordinate='+coord,native:true};
 if(/iPhone|iPad|iPod|Macintosh/i.test(ua))return {href:'https://maps.apple.com/?ll='+coord+'&q='+coord,native:false};
 return {href:'geo:'+coord+'?q='+coord,native:true,choose:true};
}
function create({loadData,evaluate,clock=()=>performance.now(),yieldTask=()=>new Promise(r=>setTimeout(r,0)),diagnoseUnknown=false}){
 const cache=new Map(),jobs=new Map();
 async function search(plan,{onProgress=()=>{},isCurrent=()=>true,atmosphere='standard'}={}){
  if(plan.compositionInvalid)throw Error('invalid-composition');
  const data=await loadData();if(!isCurrent())return {cancelled:true};
  const key=keyFor(plan,data.version,atmosphere);if(cache.has(key))return {...cache.get(key),cached:true};
  if(jobs.has(key)){const result=await jobs.get(key);return !isCurrent()?{cancelled:true}:result.cancelled?search(plan,{onProgress,isCurrent,atmosphere}):{...result,cached:true};}
  const work=(async()=>{
   const start=clock(),generated=sampleSidewalks(data),counts={sampled:generated.rows.length,checked:0,aligned:0,blocked:0,unknown:0,noOverlap:0,deferred:0};const rows=[],seenRows=new Set();
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
     else if(result?.recommend===true&&((result.status==='verified'&&p.groundKnown&&p.standingSurfaceKnown&&data.visibilityCertified===true)||(result.status==='model-visible'&&result.modelEvidence?.kind==='terrain-and-building-model-los'&&result.modelEvidence.scope==='observer-to-target'&&
     result.modelEvidence.buildingRangeComplete&&result.modelEvidence.terrainNumericComplete&&result.modelEvidence.targetSelfGeometryComplete&&result.modelEvidence.sceneModelExposureChecked&&result.modelEvidence.celestialInteriorSampleVisible&&
     result.modelEvidence.actualVisibilityGuaranteed===false))&&result.event&&Number.isFinite(result.event.at)&&day(result.event.at)===day(plan.at)){for(const row of [result,...(result.additionalCandidates||[])]){if(row?.recommend!==true||!['model-visible',
     'verified'].includes(row.status)||!row.place||!Number.isFinite(row.place.latitude)||!Number.isFinite(row.place.longitude)||!row.event||day(row.event.at)!==day(plan.at))continue;
     if(row.status==='model-visible'&&!(row.modelEvidence?.kind==='terrain-and-building-model-los'&&row.modelEvidence.scope==='observer-to-target'&&row.modelEvidence.buildingRangeComplete&&row.modelEvidence.terrainNumericComplete&&row.modelEvidence.targetSelfGeometryComplete&&
     row.modelEvidence.sceneModelExposureChecked&&row.modelEvidence.celestialInteriorSampleVisible&&row.modelEvidence.actualVisibilityGuaranteed===false))continue;
     const k=[row.place.latitude.toFixed(6),row.place.longitude.toFixed(6),Math.round(row.event.at/1000)].join(',');if(!seenRows.has(k)){seenRows.add(k);rows.push(row);}}}
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
return {create,sampleSidewalks,keyFor,day,mapLink};
});
