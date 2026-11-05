/* GSI native DEM port. Missing pixels stay missing; IO is injected for tests. */
(function(root){
'use strict';
const api=root.AstroNotesCandidateTerrain||(typeof require==='function'?require('./terrain-model.js'):null);
const RAD=Math.PI/180,R=6371008.8;
function createLive({fetchImpl=root.fetch,geo=root.AstroNotesTerrain,maxTiles=96,timeoutMs=7000,maxDurationMs=35000}={}){
 const cache=new Map();let fetched=0,started=Date.now();
 const pixel=(p,z)=>[(p.longitude+180)/360*256*2**z,(1-Math.asinh(Math.tan(p.latitude*RAD))/Math.PI)/2*256*2**z];
 async function tile(layer,z,x,y,options){
  const key=[layer,z,x,y].join('/');
  if(cache.has(key))return cache.get(key);
  if(options.isCurrent?.()===false)throw Error('candidate-cancelled');
  if(fetched>=maxTiles||Date.now()-started>=maxDurationMs)return {missing:true,reason:'terrain-budget'};
  fetched++;
  const pending=(async()=>{
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
  })();
  cache.set(key,pending);const result=await pending;
  // A failed request is retryable, unlike an authoritative absent tile.
  if(result.reason==='terrain-fetch'||result.reason==='terrain-size')cache.delete(key);
  return result;
 }
 async function sample(point,options={}){
  if(!Number.isFinite(point?.latitude)||!Number.isFinite(point?.longitude)||Math.abs(point.latitude)>=85)return {height:null,reason:'invalid-dem-position'};
  let reason='missing-dem';
  for(const [layer,z]of [['dem5a',15],['dem5b',15],['dem5c',15],['dem10b',14]]){
   const [px,py]=pixel(point,z),x=Math.floor(px/256),y=Math.floor(py/256),data=await tile(layer,z,x,y,options);
   if(options.isCurrent?.()===false)throw Error('candidate-cancelled');
   if(data.missing){reason=data.reason;if(reason==='terrain-budget')break;continue;}
   const h=data.heights[(Math.floor(py)%256+256)%256*256+(Math.floor(px)%256+256)%256];
   if(Number.isFinite(h))return {height:h,layer,z,x,y,resolutionM:40075016.686*Math.cos(point.latitude*RAD)/(256*2**z),heightDatum:'GSI orthometric; source epoch not certified'};
  }
  return {height:null,reason};
 }
 // Evaluate the native piecewise-constant raster model, not a sparse 100-point profile.
 async function trace(observer,{azimuth,altitude,maxM,endpoint=null,refractionK=1,...options}){
  if(!Number.isFinite(observer.elevation)||!Number.isFinite(maxM)||maxM<=0||!Number.isFinite(altitude)||!(refractionK>0))return {status:'unknown',missing:1,reason:'invalid-ray'};
  const eye=observer.elevation+(observer.eyeM??1.5),effectiveR=R*refractionK,theta=maxM/effectiveR;
  const alpha=Number.isFinite(endpoint?.elevation)?Math.atan2((effectiveR+endpoint.elevation)*Math.cos(theta)-(effectiveR+eye),(effectiveR+endpoint.elevation)*Math.sin(theta)):altitude*RAD;
  const height=d=>{const angle=d/effectiveR,den=Math.cos(angle)-Math.tan(alpha)*Math.sin(angle);return den>0?(effectiveR+eye)/den-effectiveR:Infinity;};
  let checked=0,missing=0,minMarginM=Infinity,hit=null,d=0,steps=0,lastSource=null,endpointUncertain=false;
  while(d<maxM){
   if(options.isCurrent?.()===false||options.signal?.aborted)throw Error('candidate-cancelled');
   const next=Math.min(maxM,d+100),from=geo.destination(observer.latitude,observer.longitude,azimuth,d/1000),to=next===maxM&&endpoint?endpoint:geo.destination(observer.latitude,observer.longitude,azimuth,next/1000);
   const a=pixel(from,15),b=pixel(to,15),marks=[0,1];
   for(let axis=0;axis<2;axis++)if(a[axis]!==b[axis])for(let edge=Math.floor(Math.min(a[axis],b[axis]))+1;edge<Math.max(a[axis],b[axis]);edge++)marks.push((edge-a[axis])/(b[axis]-a[axis]));
   marks.sort((x,y)=>x-y);
   for(let i=1;i<marks.length;i++){
    if(marks[i]-marks[i-1]<1e-12)continue;
    const lo=d+marks[i-1]*(next-d),hi=d+marks[i]*(next-d),middle=(lo+hi)/2,p=geo.destination(observer.latitude,observer.longitude,azimuth,middle/1000),value=await sample(p,options);
    if(!Number.isFinite(value.height)){missing++;if(value.reason==='terrain-budget')return {status:'unknown',checked,missing,partial:true,reason:value.reason,hit};continue;}
    checked++;lastSource=value.layer;
    const distances=[lo,hi],vertex=-alpha*effectiveR;if(vertex>lo&&vertex<hi)distances.push(vertex);
    const ray=Math.min(...distances.map(height)),endpointCell=endpoint&&maxM-lo<value.resolutionM*2;
    const margin=ray-value.height;minMarginM=Math.min(minMarginM,margin);
    if(margin<-.1&&!hit){if(endpointCell)endpointUncertain=true;else hit={distanceM:middle,terrainM:value.height,rayM:ray};}
    if(++steps%256===0)await new Promise(resolve=>setTimeout(resolve,0));
    if(steps>=200000)return {status:hit?'blocked':'unknown',hit,checked,missing,partial:true,reason:'terrain-compute-budget'};
    if(hit)break;
   }
   d=next;if(hit)break;
  }
  return {status:hit?'blocked':missing||endpointUncertain?'unknown':'model-clear',hit,checked,missing,minMarginM:Number.isFinite(minMarginM)?minMarginM:null,source:lastSource,scopeM:d,nativeRaster:true,endpointContactUncertain:endpointUncertain,datumUncertainty:true};
 }
 return {sample,at:async(p,o)=>(await sample(p,o)).height,trace,resetBudget:()=>{fetched=0;started=Date.now();},stats:()=>({tiles:cache.size,fetched}),clearFailures:()=>{fetched=0;}};
}
api.createLive=createLive;
if(typeof module==='object'&&module.exports)module.exports={createLive};
})(globalThis);
