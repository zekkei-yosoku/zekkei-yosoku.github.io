/* New-place quality gate. A lower envelope over the upper tower's width is
   checked against represented raster cells; this is not a real-world warranty. */
(function(root){
'use strict';
const Model=root.AstroNotesCandidateModel||(typeof require==='function'?require('./model-evaluator.js'):null);
const R=6371008.8,RAD=Math.PI/180,N=256*2**15;
function requiredPart(target){
 if(!target||target.rim)return null;
 const id=target.id==='skytree'?'deck':target.id==='tokyotower'?'main':null;
 if(id)return {id,m:target.parts?.find(p=>p.id===id)?.m};
 const named=(target.parts||[]).filter(p=>['main','deck'].includes(p.id)&&Number.isFinite(p.m)).sort((a,b)=>a.m-b.m)[0];
 return named?{id:named.id,m:named.m}:null;
}
function inverse(a,b){
 const p=a.latitude*RAD,q=b.latitude*RAD,l=(b.longitude-a.longitude)*RAD;
 const h=Math.sin((q-p)/2)**2+Math.cos(p)*Math.cos(q)*Math.sin(l/2)**2;
 return {d:2*R*Math.asin(Math.min(1,Math.sqrt(h))),az:Math.atan2(Math.sin(l)*Math.cos(q),Math.cos(p)*Math.sin(q)-Math.sin(p)*Math.cos(q)*Math.cos(l))/RAD};
}
const mul=(a,b)=>{const v=[a[0]*b[0],a[0]*b[1],a[1]*b[0],a[1]*b[1]];return [Math.min(...v),Math.max(...v)];};
const intersection=(a,b)=>({west:Math.max(a.west,b.west),east:Math.min(a.east,b.east),south:Math.max(a.south,b.south),north:Math.min(a.north,b.north)});
function cellDistances(observer,box){
 if(box.west>box.east||box.south>box.north)return null;
 const longitude=Math.max(box.west,Math.min(box.east,observer.longitude)),p=observer.latitude*RAD,dl=(longitude-observer.longitude)*RAD;
 const latitude=Math.max(box.south,Math.min(box.north,Math.atan2(Math.sin(p),Math.cos(p)*Math.cos(dl))/RAD));
 const near=inverse(observer,{latitude,longitude}).d;let far=0;
 for(const latitude of [box.south,box.north])for(const longitude of [box.west,box.east])far=Math.max(far,inverse(observer,{latitude,longitude}).d);
 return [Math.max(0,near-.001),far+.001];
}
function sinRange(lo,hi){
 const values=[Math.sin(lo),Math.sin(hi)];
 for(let n=Math.ceil((lo-Math.PI/2)/Math.PI);Math.PI/2+n*Math.PI<=hi;n++)values.push(n%2===0?1:-1);
 return [Math.min(...values),Math.max(...values)];
}
// The patch rectangle is only a broad bound. Reject a cell only when interval
// east/north bearing components prove its whole rectangle outside the fan.
// This keeps angle wrap and cells containing the observer out of atan2 tests.
function outsideFan(observer,az,half){
 const p=observer.latitude*RAD,sp=Math.sin(p),cp=Math.cos(p),sa=Math.sin(az*RAD),ca=Math.cos(az*RAD),t=Math.tan(half*RAD),pad=1e-10;
 const add=(a,b)=>[a[0]+b[0],a[1]+b[1]],neg=a=>[-a[1],-a[0]],scale=(a,b)=>mul(a,[b,b]);
 return box=>{
  if(box.west>box.east||box.south>box.north)return true;
  if(observer.latitude>=box.south&&observer.latitude<=box.north&&observer.longitude>=box.west&&observer.longitude<=box.east)return false;
  const lo=box.south*RAD,hi=box.north*RAD,dl=(box.west-observer.longitude)*RAD,dh=(box.east-observer.longitude)*RAD;
  const cosLat=sinRange(lo+Math.PI/2,hi+Math.PI/2),east=mul(cosLat,sinRange(dl,dh));
  const north=add(scale(sinRange(lo,hi),cp),neg(scale(mul(cosLat,sinRange(dl+Math.PI/2,dh+Math.PI/2)),sp)));
  const forward=add(scale(east,sa),scale(north,ca)),side=add(scale(east,ca),neg(scale(north,sa))),edge=t*Math.max(0,forward[1]);
  return forward[1]<-pad||side[0]>edge+pad||side[1]<-edge-pad;
 };
}
// Interval evaluation of the spherical destination formula, over every
// bearing and distance in the patch. No centre/edge sampling is used to
// infer the absence of an interior obstacle. The restricted domain keeps
// the longitude denominator positive and avoids poles/antimeridian wraps.
function patchBounds(observer,az,half,lo,hi){
 const a=observer.latitude*RAD,s=Math.sin(a),c=Math.cos(a),sd=[Math.sin(lo/R),Math.sin(hi/R)],cd=[Math.cos(hi/R),Math.cos(lo/R)];
 const ca=sinRange((az-half)*RAD+Math.PI/2,(az+half)*RAD+Math.PI/2),sa=sinRange((az-half)*RAD,(az+half)*RAD);
 const v=mul([s,s],cd),w=mul([c,c],mul(sd,ca)),z=[v[0]+w[0],v[1]+w[1]],sz=mul([s,s],z),x=[cd[0]-sz[1],cd[1]-sz[0]],y=mul([c,c],mul(sd,sa));
 if(!(x[0]>0))return null;
 const q=mul(y,[1/x[1],1/x[0]]),pad=1e-8;
 return {south:Math.asin(Math.max(-1,z[0]))/RAD-pad,north:Math.asin(Math.min(1,z[1]))/RAD+pad,
  west:observer.longitude+Math.atan(q[0])/RAD-pad,east:observer.longitude+Math.atan(q[1])/RAD+pad};
}
// At fixed ground distance, height increases with target height and with the
// ray's launch angle. Over target distances [near,far], the minimum launch
// angle is at an endpoint (its only possible interior extremum is a maximum).
function lowerProfile(observer,height,near,far,k){
 const E=observer.elevation+(observer.eyeM??1.5),r=R*k;
 const alpha=d=>Math.atan2((r+height)*Math.cos(d/r)-(r+E),(r+height)*Math.sin(d/r));
 const a=Math.min(alpha(near),alpha(far)),h=s=>(r+E)/(Math.cos(s/r)-Math.tan(a)*Math.sin(s/r))-r;
 const bottom=-a*r;
 return {h,min:(lo,hi)=>Math.min(h(lo),h(hi),bottom>lo&&bottom<hi?h(bottom):Infinity)};
}
function upperRadius(target,model,part){
 const vertices=model.vertices;let radius=0;
 for(const p of vertices)if(!Array.isArray(p)||p.length<3||!p.every(Number.isFinite))return null;
 const faces=model.faces||model.triangles,ground=target.groundM,tip=target.parts?.find(p=>p.id==='tip')?.m;
 if(!Array.isArray(faces)||!Number.isFinite(ground)||!(model.heightM>0)||!(tip>part.m)||model.heightMode){
  for(const p of vertices)radius=Math.max(radius,Math.hypot(p[0],p[1]));return radius;
 }
 const cut=(part.m-ground)*model.heightM/(tip-ground);let found=false;
 for(const face of faces){
  if(!Array.isArray(face)||face.some(i=>!Number.isInteger(i)||!vertices[i]))return null;
  const points=face.map(i=>vertices[i]);
  for(let i=0;i<points.length;i++){
   const a=points[i];if(a[2]>=cut){radius=Math.max(radius,Math.hypot(a[0],a[1]));found=true;}
   // Built-in faces include convex solids as well as triangles. All pairs
   // contain every real edge; extra chords remain inside the convex hull.
   for(let j=i+1;j<points.length;j++){
    const b=points[j];if((a[2]<cut)===(b[2]<cut)||a[2]===b[2])continue;
    const f=(cut-a[2])/(b[2]-a[2]);radius=Math.max(radius,Math.hypot(a[0]+f*(b[0]-a[0]),a[1]+f*(b[1]-a[1])));found=true;
   }
  }
 }
 return found?radius:null;
}
function corridor(observer,target,model,k){
 const part=requiredPart(target),vertices=model?.vertices;
 if(!part||!Number.isFinite(part.m)||!Array.isArray(vertices)||!vertices.length||model.geoVertices||!Number.isFinite(k)||k<1||k>2)return null;
 if(![observer.latitude,observer.longitude,observer.elevation,observer.eyeM??1.5,target.latitude,target.longitude].every(Number.isFinite))return null;
 if(Math.abs(observer.elevation+(observer.eyeM??1.5))>10000||Math.abs(part.m)>10000)return null;
 if(Math.abs(observer.latitude)>60||Math.abs(target.latitude)>60)return null;
 let radius=upperRadius(target,model,part);if(!Number.isFinite(radius))return null;
 // Clip at the named lower deck, including crossing edges rather than just
 // upper vertices. 1% covers local WGS84/spherical distance; 1 m rounds outward.
 radius=radius*1.01+1;
 const {d,az}=inverse(observer,target);if(!(d>radius+5&&d+radius<=50000))return null;
 // Spherical tangent triangle: sin(half angle)=sin(radius/R)/sin(distance/R).
 const near=d-radius,far=d+radius,half=Math.asin(Math.min(1,Math.sin(radius/R)/Math.sin(d/R)))/RAD;
 // Existing terrain paths use spherical coordinates but their endpoint
 // distance comes from WGS84 inverse. Its metric radii (6335439..6399594 m)
 // differ from R by less than 1%; enclose both distance conventions explicitly.
 const profile=lowerProfile(observer,part.m,.99*near,1.01*far,k),outside=outsideFan(observer,az,half);
 return {part,radius,near,far,az,half,profile,*patches(){
  // Closed 25 m interval patches enclose the entire spherical wedge.
  // Raster cells touching each rectangle are included in full.
  for(let lo=0;lo<far;lo+=25){
   const hi=Math.min(far,lo+25),bounds=patchBounds(observer,az,half,lo,hi);
   if(!bounds)throw Error('upper-corridor-unavailable');
   const lowAt=box=>{
    const clipped=intersection(box,bounds);if(outside(clipped))return Infinity;
    const range=cellDistances(observer,clipped);if(!range)return Infinity;
    const a=Math.max(lo,range[0]),b=Math.min(hi,range[1]);
    return a>b?Infinity:profile.min(.99*a,1.01*b)-.001;
   };
   yield {...bounds,lowM:profile.min(.99*lo,1.01*hi)-.001,lowAt,fromM:lo,toM:hi};
  }
 }};
}
const pixel=p=>[(p.longitude+180)/360*N,(1-Math.asinh(Math.tan(p.latitude*RAD))/Math.PI)/2*N];
const point=(x,y)=>({longitude:(x+.5)/N*360-180,latitude:Math.atan(Math.sinh(Math.PI*(1-2*(y+.5)/N)))/RAD});
const pixelBox=(x,y)=>({west:x/N*360-180,east:(x+1)/N*360-180,north:Math.atan(Math.sinh(Math.PI*(1-2*y/N)))/RAD,south:Math.atan(Math.sinh(Math.PI*(1-2*(y+1)/N)))/RAD});
async function terrainPatch(terrain,patch,options){
 const a=pixel({longitude:patch.west,latitude:patch.north}),b=pixel({longitude:patch.east,latitude:patch.south});
 const x0=Math.floor(a[0]),y0=Math.floor(a[1]),x1=Math.floor(b[0]),y1=Math.floor(b[1]),width=x1-x0+1,values=new Float64Array(width*(y1-y0+1)).fill(NaN);
 let top=-Infinity,cells=0;
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
  options.check();const low=patch.lowAt?.(pixelBox(x,y))??patch.lowM;
  if(low===Infinity)continue;
  const p=point(x,y),s=await terrain.sample(p,options);options.check();
  if(!Number.isFinite(s?.height))return {status:'unknown',reason:s?.reason||'terrain-unavailable'};
  top=Math.max(top,s.height);values[(y-y0)*width+x-x0]=s.height;cells++;
  if(low<=s.height+.25)return {status:low<s.height-.25?'blocked':'unknown',reason:'upper-terrain',topM:s.height,rayM:low,cells};
 }
 const groundMax=box=>{
  const bound=intersection(box,patch);if(bound.west>bound.east||bound.south>bound.north)return null;
  const a=pixel({longitude:bound.west,latitude:bound.north}),b=pixel({longitude:bound.east,latitude:bound.south});let high=-Infinity;
  for(let y=Math.max(y0,Math.floor(a[1]));y<=Math.min(y1,Math.floor(b[1]));y++)for(let x=Math.max(x0,Math.floor(a[0]));x<=Math.min(x1,Math.floor(b[0]));x++){
   const value=values[(y-y0)*width+x-x0];if(Number.isFinite(value))high=Math.max(high,value);
  }
  return Number.isFinite(high)?high:null;
 };
 return {status:'clear',topM:top,cells,groundMax};
}
async function check(observer,target,{align,terrain,heights,trees,refractionK=7/6,yieldTask=()=>Promise.resolve(),...options}={}){
 const part=requiredPart(target);if(!part)return {status:'not-applicable'};
 const current=()=>options.isCurrent?.()!==false&&!options.signal?.aborted;
 const checkpoint=()=>{if(Date.now()>=options.deadline)throw Error('candidate-time-budget');if(!current())throw Error('candidate-cancelled');};
 let timer,abort;
 const run=async()=>{
  checkpoint();
  const model=align?.outlineModel?.(target),shape=corridor(observer,target,model,refractionK);
  if(!shape||!terrain?.sample||!heights?.upperPatch||!trees?.upperPatch)return {status:'unknown',reason:'upper-model-unavailable',partId:part.id};
  const identity=[target.latitude,target.longitude,target.groundM,part.m,model.vertices,model.vertices.length];
  const keyOf=radius=>JSON.stringify([observer.latitude,observer.longitude,observer.elevation,observer.eyeM??1.5,target.id,target.latitude,target.longitude,requiredPart(target),radius,refractionK]);
  const key=keyOf(shape.radius),providers=[model,terrain,terrain.sample,heights,heights.upperPatch,trees,trees.upperPatch],memo=options.upperReads,cached=memo?.get(key);
  if(cached&&providers.every((p,i)=>p===cached.providers[i]))return {...cached.result};
  const opts={...options,isCurrent:()=>current()&&!(Date.now()>=options.deadline),check:checkpoint};
  let patches=0,terrainCells=0,buildingCells=0,treeCells=0,until=performance.now()+6;
  for(const patch of shape.patches()){
   checkpoint();
   const building=await heights.upperPatch(patch,target.id,opts);checkpoint();
   if(building.status!=='clear')return {...building,status:'unknown',layer:'buildings',partId:part.id};
   const land=await terrainPatch(terrain,patch,opts);checkpoint();
   if(land.status!=='clear')return {...land,status:'unknown',layer:'terrain',partId:part.id};
   const crown=await trees.upperPatch(patch,{...opts,groundMaxM:land.topM,groundMax:land.groundMax});checkpoint();
   if(crown.status!=='clear')return {...crown,status:'unknown',layer:'trees',partId:part.id};
   patches++;terrainCells+=land.cells;buildingCells+=building.cells;treeCells+=crown.cells;
   if(performance.now()>=until){await yieldTask();checkpoint();until=performance.now()+6;}
  }
  if(align.outlineModel(target)!==model||[target.latitude,target.longitude,target.groundM,requiredPart(target)?.m,model.vertices,model.vertices.length].some((v,i)=>!Object.is(v,identity[i])))return {status:'unknown',reason:'upper-model-changed',partId:part.id};
  const finalShape=corridor(observer,target,model,refractionK);
  if(!finalShape||keyOf(finalShape.radius)!==key||[model,terrain,terrain.sample,heights,heights.upperPatch,trees,trees.upperPatch].some((p,i)=>p!==providers[i]))return {status:'unknown',reason:'upper-model-changed',partId:part.id};
  const result={status:'model-clear',partId:part.id,fromM:part.m,scope:'upper-model-corridor',widthCovered:true,patches,terrainCells,buildingCells,treeCells,actualVisibilityGuaranteed:false};
  // Only complete results live for this evaluate call. No shared search cache,
  // pending request or mutable row is retained; changed providers cannot hit.
  if(memo){memo.set(key,{providers,result:{...result}});while(memo.size>16)memo.delete(memo.keys().next().value);}
  return result;
 };
 try{
  const jobs=[run()];
  if(Number.isFinite(options.deadline))jobs.push(new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('candidate-time-budget')),Math.max(0,options.deadline-Date.now()));}));
  if(options.signal)jobs.push(new Promise((_,reject)=>{abort=()=>reject(Error('candidate-cancelled'));options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted)abort();}));
  return await Promise.race(jobs);
 }catch(e){
  if(Date.now()>=options.deadline||e?.message==='candidate-time-budget')return {status:'deferred',reason:'time-budget',partId:part.id};
  if(e?.message==='candidate-cancelled')throw e;
  return {status:'unknown',reason:'upper-data-unavailable',partId:part.id};
 }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
}
const api={requiredPart,lowerProfile,corridor,terrainPatch,patchBounds,check};
Model.towerQuality=api;
if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
