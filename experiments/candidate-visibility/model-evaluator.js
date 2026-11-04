/* Model diagnostics only. Missing survey/standing/access evidence NEVER becomes clear. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const R=6371008.8,rad=Math.PI/180;
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),sub=(a,b)=>a.map((x,i)=>x-b[i]);
function inside(r,p){let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>p[1])!==(r[j][1]>p[1])&&p[0]<(r[j][0]-r[i][0])*(p[1]-r[i][1])/(r[j][1]-r[i][1])+r[i][0])yes=!yes;return yes;}
function faceHit(rings,origin,direction,maxM){
 if(!rings.length||rings[0].length<3)return null;const ring=rings[0],normal=[0,0,0];
 for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];normal[0]+=(a[1]-b[1])*(a[2]+b[2]);normal[1]+=(a[2]-b[2])*(a[0]+b[0]);normal[2]+=(a[0]-b[0])*(a[1]+b[1]);}
 const den=dot(normal,direction);if(Math.abs(den)<1e-9)return null;const t=dot(normal,sub(ring[0],origin))/den;if(t<=.05||t>maxM)return null;
 const p=origin.map((x,i)=>x+t*direction[i]),axis=normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs))),project=q=>q.filter((_,i)=>i!==axis),pp=project(p);
 return inside(rings[0].map(project),pp)&&!rings.slice(1).some(r=>inside(r.map(project),pp))?{distanceM:t,point:p}:null;
}
function trace(index,observer,{azimuth,altitude,maxM=12000}){
 if(!Number.isFinite(observer.elevation)||!Number.isFinite(azimuth)||!Number.isFinite(altitude))return {status:'unknown',recommend:false,reason:'invalid-height-or-ray'};
 const eye=observer.elevation+(observer.eyeM??1.5),lat=observer.latitude,lon=observer.longitude,scale=Math.cos(lat*rad),az=azimuth*rad,alt=altitude*rad;
 // Parameter t is horizontal metres, matching geometry distance and curvature.
 const direction=[Math.sin(az),Math.cos(az),Math.tan(alt)],end=[lon+direction[0]*maxM/(111195*scale),lat+direction[1]*maxM/111195];
 const ids=new Set();for(let x=Math.floor(Math.min(lon,end[0])*1000);x<=Math.floor(Math.max(lon,end[0])*1000);x++)for(let y=Math.floor(Math.min(lat,end[1])*1000);y<=Math.floor(Math.max(lat,end[1])*1000);y++)for(const id of index.grid[x+','+y]||[])ids.add(id);
 let hit=null,faces=0;for(const id of ids){const b=index.buildings[id];for(const poly of b.polygons){faces++;const rings=poly.rings.map(r=>r.map(p=>{const x=(p[0]-lon)*111195*scale,y=(p[1]-lat)*111195;return [x,y,p[2]-(x*x+y*y)/(2*R)];}));const h=faceHit(rings,[0,0,eye],direction,hit?.distanceM??maxM);if(h)hit={...h,buildingId:b.id,polygonId:poly.id,lod:b.lod};}}
 return {status:hit?'model-blocked':'unknown',recommend:false,hit,faces,buildingsChecked:ids.size,reason:hit?'conditional-model-intersection':'incomplete-coverage-or-uncertainty'};
}
function create({align,shooting,bodies,index,surfaceAt,prefilter=true,yieldTask=()=>new Promise(r=>setTimeout(r,0))}){
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
  const targetRay=geometry&&events.length?trace(index,obs,{azimuth:geometry.azimuth,altitude:Math.atan2(geometry.topM-obs.elevation-obs.eyeM-distance*distance/(2*R),distance)/rad,maxM:distance}):null;
  const tested=[];for(const event of events){const st=bodies.state(plan.body,event.at,{...obs,elevation:obs.elevation+obs.eyeM});const rays=[0,-1,1].map(offset=>trace(index,obs,{azimuth:st.azimuth,altitude:(st.geometricAltitude??st.altitude??st.apparentAltitude)+offset*st.angularRadius,maxM:12000}));tested.push({event,rays});}
  return {status:'unknown',recommend:false,aligned:events.length>0,events:tested,targetRay,assumedObserver:obs,surface,reason:'estimated-surface-and-incomplete-3d-coverage'};
 };
}
return {faceHit,trace,create};
});
