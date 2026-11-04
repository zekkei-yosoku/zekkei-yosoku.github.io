/* Model diagnostics only. Missing survey/standing/access evidence NEVER becomes clear. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const R=6371008.8,rad=Math.PI/180,Geo=()=>globalThis.AstroNotesTerrain||(typeof require==='function'?require('../../astronotes-terrain.js'):null);
const cache=new WeakMap(),earthA=6378137,earthE2=6.6943799901413165e-3;
function ecef(lat,lon,h){const a=lat*rad,b=lon*rad,n=earthA/Math.sqrt(1-earthE2*Math.sin(a)**2);return [(n+h)*Math.cos(a)*Math.cos(b),(n+h)*Math.cos(a)*Math.sin(b),(n*(1-earthE2)+h)*Math.sin(a)];}
const reference=ecef(35.68626,139.73068,0),local=(lat,lon,h)=>ecef(lat,lon,h).map((v,i)=>v-reference[i]);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),sub=(a,b)=>a.map((x,i)=>x-b[i]);
function inside(r,p){let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>p[1])!==(r[j][1]>p[1])&&p[0]<(r[j][0]-r[i][0])*(p[1]-r[i][1])/(r[j][1]-r[i][1])+r[i][0])yes=!yes;return yes;}
function faceHit(rings,origin,direction,maxM){
 if(!rings.length||rings[0].length<3)return null;const ring=rings[0],normal=[0,0,0];
 for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];normal[0]+=(a[1]-b[1])*(a[2]+b[2]);normal[1]+=(a[2]-b[2])*(a[0]+b[0]);normal[2]+=(a[0]-b[0])*(a[1]+b[1]);}
 const den=dot(normal,direction);if(Math.abs(den)<1e-9)return null;const t=dot(normal,sub(ring[0],origin))/den;if(t<=.05||t>maxM)return null;
 const p=origin.map((x,i)=>x+t*direction[i]),axis=normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs))),project=q=>q.filter((_,i)=>i!==axis),pp=project(p);
 return inside(rings[0].map(project),pp)&&!rings.slice(1).some(r=>inside(r.map(project),pp))?{distanceM:t,point:p}:null;
}
function trace(index,observer,{azimuth,altitude,maxM=12000,endpoint=null}){
 if(!Number.isFinite(observer.elevation)||!Number.isFinite(azimuth)||!Number.isFinite(altitude)||Math.abs(altitude)>=89||!Number.isFinite(maxM)||maxM<=0||maxM>20000)return {status:'unknown',recommend:false,reason:'invalid-height-or-ray'};
 const eye=observer.elevation+(observer.eyeM??1.5),lat=observer.latitude,lon=observer.longitude,az=azimuth*rad,alt=altitude*rad;
 const end=endpoint||Geo().destination(lat,lon,azimuth,maxM/1000),origin=local(lat,lon,eye),a=lat*rad,b=lon*rad;
 const east=[-Math.sin(b),Math.cos(b),0],north=[-Math.sin(a)*Math.cos(b),-Math.sin(a)*Math.sin(b),Math.cos(a)],up=[Math.cos(a)*Math.cos(b),Math.cos(a)*Math.sin(b),Math.sin(a)];
 const direction=endpoint?local(endpoint.latitude,endpoint.longitude,endpoint.elevation).map((v,i)=>(v-origin[i])/maxM):east.map((v,i)=>v*Math.sin(az)+north[i]*Math.cos(az)+up[i]*Math.tan(alt));
 const ids=new Set();for(let x=Math.floor(Math.min(lon,end.longitude)*1000)-1;x<=Math.floor(Math.max(lon,end.longitude)*1000)+1;x++)for(let y=Math.floor(Math.min(lat,end.latitude)*1000)-1;y<=Math.floor(Math.max(lat,end.latitude)*1000)+1;y++)for(const id of index.grid[x+','+y]||[])ids.add(id);
 let compiled=cache.get(index);if(!compiled){compiled=new Map();cache.set(index,compiled);}
 let hit=null,faces=0;for(const id of ids){const building=index.buildings[id];let polys=compiled.get(id);if(!polys){polys=building.polygons.map(poly=>({id:poly.id,rings:poly.rings.map(r=>r.map(p=>local(p[1],p[0],p[2])))}));compiled.set(id,polys);}for(const poly of polys){faces++;const h=faceHit(poly.rings,origin,direction,hit?.distanceM??maxM);if(h)hit={...h,pointFrame:'WGS84 ECEF offset from lon139.73068 lat35.68626 h0; geoid uncorrected diagnostic',buildingId:building.id,polygonId:poly.id,lod:building.lod};}}
 return {status:hit?'model-blocked':'unknown',recommend:false,hit,faces,buildingsChecked:ids.size,reason:hit?'conditional-model-intersection':'incomplete-coverage-or-uncertainty'};
}
function create({align,shooting,bodies,index,surfaceAt,terrain=null,prefilter=true,yieldTask=()=>new Promise(r=>setTimeout(r,0))}){
 const paths=new Map();
 return async function evaluate(plan,point){
  await yieldTask();const surface=surfaceAt(point);if(!surface||!Number.isFinite(surface.estimateM))return {status:'unknown',recommend:false,reason:'no-standing-height-estimate'};
  const obs={...point,elevation:surface.estimateM,eyeM:1.5};
  const start=Math.floor((plan.at+32400000)/86400000)*86400000-32400000;
  // Conservative pilot optimisation only: rejected positions remain UNKNOWN.
  // This is not a proof that no astronomical opportunity exists.
  const geometry=align.geometryFrom(obs,plan.target,{partId:plan.partId,eyeM:obs.eyeM});
  if(prefilter&&geometry&&['moon','sun'].includes(plan.body)){
   const key=plan.body+','+start+','+(plan.atmosphere||'standard');let path=paths.get(key);
   if(!path){path=[];const ref={latitude:35.68626,longitude:139.73068,elevation:30};for(let t=start;t<=start+86400000;t+=60000){const st=bodies.state(plan.body,t,ref);path.push([st.azimuth,st.apparentAltitude]);}paths.set(key,path);while(paths.size>4)paths.delete(paths.keys().next().value);}
   if(!path.some(([az,alt])=>Math.abs(((az-geometry.azimuth+540)%360)-180)<3&&alt>-3&&alt<geometry.angle+3))return {status:'unknown',recommend:false,deferred:true,assumedObserver:obs,surface,reason:'pilot-prefilter-deferred-not-certified-no-event'};
  }
  const events=shooting.eventsFor(plan,obs,start,{align,isMountain:()=>false}).filter(e=>shooting.matches(e,plan,()=>false)&&e.at>=start&&e.at<start+86400000&&(plan.body!=='moon'||e.sunAltitude<0));
  const distance=geometry?.distanceKm*1000;
  const targetRay=geometry&&events.length?trace(index,obs,{azimuth:geometry.azimuth,altitude:Math.atan2(geometry.topM-obs.elevation-obs.eyeM-distance*distance/(2*R),distance)/rad,maxM:distance,endpoint:{...plan.target,elevation:geometry.topM}}):null;
  const targetTerrain=geometry&&events.length&&terrain?terrain.trace(obs,{azimuth:geometry.azimuth,altitude:Math.atan2(geometry.topM-obs.elevation-obs.eyeM-distance*distance/(2*R),distance)/rad,maxM:distance,endpoint:{...plan.target,elevation:geometry.topM}}):null;
  const tested=[];for(const event of events){const st=bodies.state(plan.body,event.at,{...obs,elevation:obs.elevation+obs.eyeM});const rays=[0,-1,1].map(offset=>{const ray={azimuth:st.azimuth,altitude:(st.geometricAltitude??st.altitude??st.apparentAltitude)+offset*st.angularRadius,maxM:12000};return {...trace(index,obs,ray),terrain:terrain?.trace(obs,ray)??null};});tested.push({event,rays});}
  return {status:'unknown',recommend:false,aligned:events.length>0,events:tested,targetRay,targetTerrain,assumedObserver:obs,surface,reason:'estimated-surface-and-incomplete-3d-coverage'};
 };
}
return {faceHit,trace,create};
});
