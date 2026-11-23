/* GSI native DEM port. Missing pixels stay missing; IO is injected for tests. */
(function(root){
'use strict';
const api=root.AstroNotesCandidateTerrain||(typeof require==='function'?require('./terrain-model.js'):null);
const RAD=Math.PI/180,R=6371008.8;
function createLive({fetchImpl=root.fetch,geo=root.AstroNotesTerrain,maxTiles=96,maxCachedTiles=128,timeoutMs=7000,maxDurationMs=35000,lookAhead=false,layers=[['dem5a',15],['dem5b',15],['dem5c',15],['dem',14]]}={}){
 // A tile is 256 KiB. Keep at most 32 MiB of completed rasters by default,
 // independently of a job's read budget; pending reads stay shared until settled.
 const cache=new Map(),done=new Map(),last=new Map(),readKeys=new Set(),cacheLimit=Math.max(1,Math.floor(Number.isFinite(maxCachedTiles)?maxCachedTiles:128));
 let fetched=0,started=Date.now(),limit=maxTiles,newest=null;
 function touch(key,value){if(newest!==key){done.delete(key);done.set(key,value);newest=key;}}
 function retain(key,value){
  touch(key,value);
  while(done.size>cacheLimit){const old=done.keys().next().value;done.delete(old);for(const [layer,memo]of last)if(memo.key===old)last.delete(layer);}
 }
 const pixel=(p,z)=>[(p.longitude+180)/360*256*2**z,(1-Math.asinh(Math.tan(p.latitude*RAD))/Math.PI)/2*256*2**z];
 async function fetchTile(key,layer,z,x,y,options){
  if(lookAhead&&options.signal?.aborted)return {missing:true,reason:'terrain-fetch'};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  const abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});
  try{
   const response=await fetchImpl(`https://cyberjapandata.gsi.go.jp/xyz/${key}.txt`,{signal:controller.signal});
   if(!response.ok)return {missing:true,reason:response.status===404?'missing-tile':'terrain-fetch'};
   const values=(await response.text()).trim().split(/[\s,]+/);
   if(values.length!==65536)return {missing:true,reason:'terrain-size'};
   const heights=new Float32Array(65536);
   for(let i=0;i<values.length;i++){const v=values[i];heights[i]=v==='e'||v===''?NaN:Number(v);}
   return {heights,z,x,y,layer};
  }catch{return {missing:true,reason:'terrain-fetch'};}
  finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
 }
 async function tile(layer,z,x,y,options){
  const key=[layer,z,x,y].join('/');
  if(done.has(key)){const value=done.get(key);touch(key,value);readKeys.add(key);return value;}
  if(cache.has(key))return cache.get(key);
  if(options.isCurrent?.()===false)throw Error('candidate-cancelled');
  // Eviction must not spend the budget again on ground this job already read.
  // Failed fresh requests still cost a read and remain retryable, as before.
  const reread=readKeys.has(key);
  if(!reread&&fetched>=limit||Date.now()-started>=maxDurationMs)return {missing:true,reason:'terrain-budget'};
  if(!reread)fetched++;
  // A staged read counts towards the budget and cache only when the ray actually needs it.
  const ahead=options.prefetched?.get(key);
  const stop=()=>ahead?.controller.abort();
  if(ahead){
   options.prefetched.delete(key);
   if(options.signal?.aborted)stop();else options.signal?.addEventListener('abort',stop,{once:true});
  }

  const pending=ahead?ahead.data.then(r=>{
   if(options.signal?.aborted||options.isCurrent?.()===false)return r;
   return r.reason==='terrain-fetch'||r.reason==='terrain-size'?fetchTile(key,layer,z,x,y,options):r;
  }):fetchTile(key,layer,z,x,y,options);
  cache.set(key,pending);const result=await pending;
  if(ahead)options.signal?.removeEventListener('abort',stop);
  cache.delete(key);
  // A failed request is retryable, unlike an authoritative absent tile.
  if(result.reason!=='terrain-fetch'&&result.reason!=='terrain-size'){readKeys.add(key);retain(key,result);}
  return result;
 }
 // The height where every tile it needs is already read; undefined when one is still to be read (see sample), null when
 // no layer holds the point. Lets a sweep over many points wait only once per tile (visibility-map.js). seaAsZero: a
 // point every layer leaves empty (an absent tile or a no-value pixel; the 10 m DEM covers all land) is the sea at 0 m,
 // as far along a line (sampleFar).
 function peek(point,{seaAsZero=false}={}){
  let sea=true;
  for(const [layer,z]of layers){const [px,py]=pixel(point,z),x=Math.floor(px/256),y=Math.floor(py/256),memo=last.get(layer);
   const key=layer+'/'+z+'/'+x+'/'+y;
   let d=memo&&memo.x===x&&memo.y===y?memo.d:done.get(key);if(!d)return undefined;touch(key,d);readKeys.add(key);if(!memo||memo.d!==d)last.set(layer,{key,x,y,d});
   if(d.missing){if(d.reason!=='missing-tile')sea=false;if(d.reason==='terrain-budget')return null;continue;}
   const h=d.heights[(Math.floor(py)%256+256)%256*256+(Math.floor(px)%256+256)%256];if(Number.isFinite(h))return h;}
  return seaAsZero&&sea?0:null;
 }
 async function sample(point,options={}){
  if(!Number.isFinite(point?.latitude)||!Number.isFinite(point?.longitude)||Math.abs(point.latitude)>=85)return {height:null,reason:'invalid-dem-position'};
  let reason='missing-dem';
  for(const [layer,z]of layers){
   const [px,py]=pixel(point,z),x=Math.floor(px/256),y=Math.floor(py/256),data=await tile(layer,z,x,y,options);
   if(options.isCurrent?.()===false||options.prefetched&&options.signal?.aborted)throw Error('candidate-cancelled');
   if(data.missing){reason=data.reason;if(reason==='terrain-budget')break;continue;}
   const h=data.heights[(Math.floor(py)%256+256)%256*256+(Math.floor(px)%256+256)%256];
   if(Number.isFinite(h))return {height:h,layer,z,x,y,resolutionM:40075016.686*Math.cos(point.latitude*RAD)/(256*2**z),heightDatum:'GSI orthometric; source epoch not certified'};
  }
  return {height:null,reason};
 }
 // Far along a line that has risen NEAR_RISE_M above the eye, the 10 m DEM at z12 (about 31 m pixels) is
 // read instead of the 5 m tiles, so a sun or moon line of 40 km takes a few tiles, not fifty. A coarse
 // pixel can miss a peak between samples, so there the line must pass FAR_MARGIN_M above it to be clear
 // and below it by as much to be blocked; between, inspect every native cell of that interval. The 40 m
 // allowance is the existing coarse policy, not a bound on every unresolved peak. No value far out is the sea (DEM10B
 // covers all land; whole-sea tiles are absent).
 const NEAR_RISE_M=300,FAR_MIN_M=2000,FAR_Z=12,FAR_MARGIN_M=40;
 async function sampleFar(point,options){
  const [px,py]=pixel(point,FAR_Z),x=Math.floor(px/256),y=Math.floor(py/256),data=await tile('dem',FAR_Z,x,y,options);
  if(data.missing)return data.reason==='missing-tile'?{height:0,layer:'sea',z:FAR_Z}:{height:null,reason:data.reason};
  const h=data.heights[(Math.floor(py)%256+256)%256*256+(Math.floor(px)%256+256)%256];
  return {height:Number.isFinite(h)?h:0,layer:Number.isFinite(h)?'dem':'sea',z:FAR_Z,resolutionM:40075016.686*Math.cos(point.latitude*RAD)/(256*2**FAR_Z)};
 }
 // How far the ground rises within 80 m before the highest point and falls within 80 m beyond it: a levee or bank falls again, a plateau does not.
 const fallAround=(ds,hs,at,top,side)=>{let fall=0;for(let i=0;i<ds.length;i++)if(side*(ds[i]-at)>0&&Math.abs(ds[i]-at)<=80)fall=Math.max(fall,top-hs[i]);return fall;};
 // Evaluate the native piecewise-constant raster model, not a sparse 100-point profile.
 async function trace(observer,{azimuth,altitude,maxM,endpoint=null,refractionK=1,...options}){
  if(!Number.isFinite(observer.elevation)||!Number.isFinite(maxM)||maxM<=0||!Number.isFinite(altitude)||!(refractionK>0))return {status:'unknown',missing:1,reason:'invalid-ray'};
  const eye=observer.elevation+(observer.eyeM??1.5),effectiveR=R*refractionK,theta=maxM/effectiveR;
  const alpha=Number.isFinite(endpoint?.elevation)?Math.atan2((effectiveR+endpoint.elevation)*Math.cos(theta)-(effectiveR+eye),(effectiveR+endpoint.elevation)*Math.sin(theta)):altitude*RAD;
  const height=d=>{const angle=d/effectiveR,den=Math.cos(angle)-Math.tan(alpha)*Math.sin(angle);return den>0?(effectiveR+eye)/den-effectiveR:Infinity;};
  let checked=0,missing=0,minMarginM=Infinity,hit=null,d=0,steps=0,lastSource=null,lastHeight=null,endpointUncertain=false,farUncertain=false,refinementUnavailable=false;
  // The highest ground seen from the eye: up to which height the target is hidden at maxM.
  let skyAlpha=-Infinity,skyAt=null,skyM=null;const seenD=[],seenH=[];
  const nativeZoom=layers.reduce((z,[,level])=>Number.isInteger(level)&&level>=0&&level<=22?Math.max(z,level):NaN,15);
  const current=()=>{if(options.isCurrent?.()===false||options.signal?.aborted)throw Error('candidate-cancelled');};
  const minimum=(lo,hi)=>{const distances=[lo,hi],vertex=-alpha*effectiveR;if(vertex>lo&&vertex<hi)distances.push(vertex);return Math.min(...distances.map(height));};
  function boundaries(from,to,z){
   const a=pixel(from,z),b=pixel(to,z),marks=[0,1];
   for(let axis=0;axis<2;axis++)if(a[axis]!==b[axis])for(let edge=Math.floor(Math.min(a[axis],b[axis]))+1;edge<Math.max(a[axis],b[axis]);edge++)marks.push((edge-a[axis])/(b[axis]-a[axis]));
   marks.sort((x,y)=>x-y);
   return marks;
  }
  function segment(d){
   const next=Math.min(maxM,d+100),from=geo.destination(observer.latitude,observer.longitude,azimuth,d/1000),to=next===maxM&&endpoint?endpoint:geo.destination(observer.latitude,observer.longitude,azimuth,next/1000);
   const far=d>=FAR_MIN_M&&height(d)-eye>NEAR_RISE_M;
   return {next,far,marks:boundaries(from,to,far?FAR_Z:15),from,to};
  }
  function record(value,lo,hi,far){
   const middle=(lo+hi)/2;
   checked++;lastSource=value.layer;lastHeight=value.height;
   const arc=middle/effectiveR,rise=Math.atan2((effectiveR+value.height)*Math.cos(arc)-(effectiveR+eye),(effectiveR+value.height)*Math.sin(arc));
   seenD.push(middle);seenH.push(value.height);if(rise>skyAlpha){skyAlpha=rise;skyAt=middle;skyM=value.height;}
   const ray=minimum(lo,hi),endpointCell=endpoint&&maxM-lo<value.resolutionM*2,margin=ray-value.height;minMarginM=Math.min(minMarginM,margin);
   if(far){if(margin<-FAR_MARGIN_M&&!hit)hit={distanceM:middle,terrainM:value.height,rayM:ray,coarse:true};else if(margin<FAR_MARGIN_M)farUncertain=true;}
   else if(margin<-.1&&!hit){if(endpointCell)endpointUncertain=true;else hit={distanceM:middle,terrainM:value.height,rayM:ray};}
   steps++;
  }
  const prefetched=new Map(),enabled=lookAhead&&maxM>=8000&&layers.length>0;
  let scan=2000;
  if(enabled)options={...options,prefetched};
  function prefetchNative(d){
   if(!enabled||d<2000||fetched>limit-4||Date.now()-started>=maxDurationMs||prefetched.size>=2)return;
   scan=Math.max(d,scan);
   const [layer,z]=layers[0];
   while(scan<Math.min(maxM,d+3000)&&prefetched.size<2){
    const {next,far,marks}=segment(scan);
    if(far)break;
    for(let i=1;i<marks.length&&prefetched.size<2;i++){
     if(marks[i]-marks[i-1]<1e-12)continue;
     const lo=scan+marks[i-1]*(next-scan),hi=scan+marks[i]*(next-scan),middle=(lo+hi)/2;
     const p=geo.destination(observer.latitude,observer.longitude,azimuth,middle/1000);
     const [px,py]=pixel(p,z),x=Math.floor(px/256),y=Math.floor(py/256),key=[layer,z,x,y].join('/');
     if(cache.has(key)||done.has(key)||prefetched.has(key))continue;
     const controller=new AbortController(),data=fetchTile(key,layer,z,x,y,{signal:controller.signal});
     prefetched.set(key,{controller,data});
    }
    if(prefetched.size<2)scan=next;
   }
  }
  try{
   while(d<maxM){
    current();
    const {next,far,marks,from,to}=segment(d);let nativeMarks;
    if(!far)prefetchNative(d);
    for(let i=1;i<marks.length;i++){
     if(marks[i]-marks[i-1]<1e-12)continue;
     const lo=d+marks[i-1]*(next-d),hi=d+marks[i]*(next-d),middle=(lo+hi)/2,p=geo.destination(observer.latitude,observer.longitude,azimuth,middle/1000);
     let value=far?await sampleFar(p,options):await sample(p,options);
     current();
     if(value.reason==='terrain-budget')return {status:'unknown',checked,missing,partial:true,reason:value.reason,hit};
     const coarseMargin=far&&Number.isFinite(value.height)?minimum(lo,hi)-value.height:Infinity;
     if(far&&coarseMargin>=-FAR_MARGIN_M&&coarseMargin<FAR_MARGIN_M&&!refinementUnavailable&&Number.isFinite(nativeZoom)){
      // Keep the original 100 m segment; clip ALL native cell intervals to this coarse interval.
      // Do not put the coarse height into the skyline/last bank before replacing it.
      nativeMarks??=boundaries(from,to,nativeZoom);
      const cuts=[marks[i-1],...nativeMarks.filter(t=>t>marks[i-1]&&t<marks[i]),marks[i]];
      for(let j=1;j<cuts.length;j++){
       if(cuts[j]-cuts[j-1]<1e-12)continue;
       current();
       const low=d+cuts[j-1]*(next-d),high=d+cuts[j]*(next-d),at=geo.destination(observer.latitude,observer.longitude,azimuth,(low+high)/2000);
       const fine=await sample(at,options);current();
       if(fine.reason==='terrain-budget')return {status:'unknown',checked,missing,partial:true,reason:fine.reason,hit};
       // A coarse/last-bank value cannot certify a missing fine cell. Stop further refinement
       // on this ray instead of repeatedly fetching the same failed resource; coarse hits still apply.
       if(!Number.isFinite(fine.height)){missing++;farUncertain=true;refinementUnavailable=true;break;}
       record(fine,low,high,false);
       if(steps%256===0){await (typeof AstroNotesLibrary==='object'&&AstroNotesLibrary.pause?AstroNotesLibrary.pause():new Promise(resolve=>setTimeout(resolve,0)));current();}
       if(steps>=200000)return {status:hit?'blocked':'unknown',hit,checked,missing,partial:true,reason:'terrain-compute-budget'};
       if(hit)break;
      }
      if(hit)break;
      continue;
     }
     // A pixel with no value in any layer (a river or lake surface) lies below its banks: the last bank
     // read on the line stands in for it, which can only make the line look more hidden, never clearer.
     if(!Number.isFinite(value.height)){if(Number.isFinite(lastHeight)&&['missing-dem','missing-tile'].includes(value.reason))value={...value,height:lastHeight,layer:'bank-for-water'};else{missing++;continue;}}
     record(value,lo,hi,far);
     if(steps%256===0){await (typeof AstroNotesLibrary==='object'&&AstroNotesLibrary.pause?AstroNotesLibrary.pause():new Promise(resolve=>setTimeout(resolve,0)));current();}
     if(steps>=200000)return {status:hit?'blocked':'unknown',hit,checked,missing,partial:true,reason:'terrain-compute-budget'};
     if(hit)break;
    }
    d=next;if(hit)break;
   }
   const skyDen=Math.cos(theta)-Math.tan(skyAlpha)*Math.sin(theta),skyline=Number.isFinite(skyAt)&&skyDen>0?{distanceM:skyAt,terrainM:skyM,toM:(effectiveR+eye)/skyDen-effectiveR,riseM:fallAround(seenD,seenH,skyAt,skyM,-1),dropM:fallAround(seenD,seenH,skyAt,skyM,1)}:null;
   return {status:hit?'blocked':missing||endpointUncertain||farUncertain?'unknown':'model-clear',reason:!hit&&farUncertain?'coarse-terrain-margin':undefined,hit,checked,missing,minMarginM:Number.isFinite(minMarginM)?minMarginM:null,source:lastSource,scopeM:d,nativeRaster:true,
   endpointContactUncertain:endpointUncertain,datumUncertainty:true,skyline};
  }finally{for(const request of prefetched.values())request.controller.abort();}
 }
 // resetBudget(scale): a caller reading far more ground for one place (a surveyed observation room's rays) asks for
 // that many times the tiles; without a scale the budget is the one it was made with.
 return {sample,peek,at:async(p,o)=>(await sample(p,o)).height,trace,
  resetBudget:(scale=1)=>{fetched=0;readKeys.clear();started=Date.now();limit=maxTiles*(scale>0?scale:1);},stats:()=>({tiles:done.size+cache.size,cachedTiles:done.size,pendingTiles:cache.size,cacheLimit,fetched}),clearFailures:()=>{fetched=0;}};
}
api.createLive=createLive;
if(typeof module==='object'&&module.exports)module.exports={createLive};
})(globalThis);
