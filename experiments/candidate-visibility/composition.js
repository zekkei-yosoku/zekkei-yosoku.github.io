/* Trial composition: drawing-surface anchor (legacy plane supported for numerical tests), exact topocentric solve and optional rise/set windows. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateComposition=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const Surface=globalThis.AstroNotesTrialSurface||(typeof require==='function'?require('./scene-surface.js'):null);
const rad=Math.PI/180,DAY=86400000,R=6371008.8,Geo=()=>globalThis.AstroNotesTerrain||(typeof require==='function'?require('../../astronotes-terrain.js'):null),inside=(r,p)=>{let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>p.latitude)!==(r[j][1]>p.latitude)&&p.longitude<(r[j][0]-r[i][0])*(p.latitude-r[i][1])/(r[j][1]-r[i][1])+r[i][0])yes=!yes;return yes;};
function valid(c,target){return !!c&&(!c.basis||c.basis==='scene-surface'&&Surface.compatible(c,target)&&[c.eastM,c.northM].every(Number.isFinite)&&Math.hypot(c.eastM,c.northM)<=200&&typeof c.modelId==='string')&&[c.heightM,c.xM].every(Number.isFinite)&&c.heightM>=target.groundM&&c.heightM<=Math.max(...target.parts.map(p=>p.m))&&Math.abs(c.xM)<=200&&['center','upper','lower'].includes(c.limb);}
function windowValid(w){return !w||w.kind==='none'||(['rise','set','both'].includes(w.kind)&&[w.beforeMin,w.afterMin].every(n=>Number.isFinite(n)&&n>=0&&n<=1440));}
function day(at){return Math.floor((at+32400000)/DAY)*DAY-32400000;}
function limb(st,kind){return kind==='upper'?(st.upperAltitude??st.apparentAltitude+st.angularRadius):kind==='lower'?(st.lowerAltitude??st.apparentAltitude-st.angularRadius):st.apparentAltitude;}
function anchorAt(obs,target,c){if(c.basis==='scene-surface')return Surface.anchor(target,c);const bearing=Geo().inverse(target.latitude,target.longitude,obs.latitude,obs.longitude).azimuth;return {...(c.xM?Geo().destination(target.latitude,target.longitude,bearing+(c.xM<0?90:-90),Math.abs(c.xM)/1000):target),heightM:c.heightM};}
function geometry(obs,target,c,align){const anchor=anchorAt(obs,target,c),g=align.geometryFrom(obs,{...target,latitude:anchor.latitude,longitude:anchor.longitude},{eyeM:obs.eyeM??1.5,heightM:c.heightM});return {anchor,...g};}
const roadCache=new WeakMap();
function roadAt(data,p){let boxes=roadCache.get(data);if(!boxes){boxes=(data.features||[]).filter(f=>['2000','2010','2020'].includes(f.function)).map(f=>{const r=f.coordinatesLonLatHeight;return {f,box:[Math.min(...r.map(v=>v[0])),Math.min(...r.map(v=>v[1])),Math.max(...r.map(v=>v[0])),Math.max(...r.map(v=>v[1]))]};});roadCache.set(data,boxes);}let result=null;const k=Math.cos(p.latitude*rad),nearEdge=r=>r.some((a,i)=>{const b=r[(i+1)%r.length],dx=(b[0]-a[0])*k,dy=b[1]-a[1],u=Math.max(0,Math.min(1,((p.longitude-a[0])*k*dx+(p.latitude-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot((p.longitude-a[0])*k-u*dx,p.latitude-a[1]-u*dy)*111195<.1;});
 for(const {f,box:b} of boxes)if(p.longitude>=b[0]&&p.longitude<=b[2]&&p.latitude>=b[1]&&p.latitude<=b[3]&&inside(f.coordinatesLonLatHeight,p)&&!(f.interiorRingsLonLatHeight||[]).some(h=>inside(h,p))){if(!f.structureClassificationKnown||f.nonTerrainStructure)return null;if(!nearEdge(f.coordinatesLonLatHeight)&&!(f.interiorRingsLonLatHeight||[]).some(nearEdge))result=f;}
 return result;
}
// Upper-limb apparent altitude crossing flat 0 degrees. Not a terrain/building horizon.
function riseSet(body,start,end,obs,bodies){const f=t=>limb(bodies.state(body,t,{...obs,elevation:obs.elevation+(obs.eyeM??1.5)}),'upper'),out=[],edge=t=>{if(Math.abs(f(t))>1e-10)return;const derivative=f(t+1000)-f(t-1000);if(Math.abs(derivative)>1e-10)out.push({at:t,kind:derivative>0?'rise':'set'});};edge(start);let at=start,previous=f(at);for(let t=Math.min(end,start+300000);at<end;t=Math.min(end,t+300000)){const v=f(t);if((previous>0)!==(v>0)){let lo=at,hi=t;for(let i=0;i<30&&hi-lo>100;i++){const mid=(lo+hi)/2;if((f(mid)>0)===(previous>0))lo=mid;else hi=mid;}out.push({at:(lo+hi)/2,kind:v>previous?'rise':'set'});}at=t;previous=v;}edge(end);return out.sort((a,b)=>a.at-b.at).filter((e,i,a)=>!i||Math.abs(e.at-a[i-1].at)>200||e.kind!==a[i-1].kind);}
function inWindow(at,w,events){return !w||w.kind==='none'||events.some(e=>(w.kind==='both'||e.kind===w.kind)&&at>=e.at-w.beforeMin*60000&&at<=e.at+w.afterMin*60000);}
function windowEvents(plan,obs,bodies){const w=plan.timeWindow;if(!windowValid(w))throw Error('invalid-time-window');if(!w||w.kind==='none')return [];const start=day(plan.at);return riseSet(plan.body,start-w.afterMin*60000,start+DAY+w.beforeMin*60000,obs,bodies);}
function screenAnchor({azimuth,altitude,obs,target,align,eyeM=1.5}){
 const base=Geo().inverse(obs.latitude,obs.longitude,target.latitude,target.longitude),d=base.km*1000,k=globalThis.AstroNotesAtmosphere?.targetK?.()??7/6,diff=(a,b)=>((a-b+540)%360)-180;let xM=d*Math.tan(diff(azimuth,base.azimuth)*rad),anchor;
 for(let i=0;i<8;i++){anchor=anchorAt(obs,target,{heightM:0,xM});const g=Geo().inverse(obs.latitude,obs.longitude,anchor.latitude,anchor.longitude),error=diff(g.azimuth,azimuth);if(Math.abs(error)<1e-8)break;const shifted=anchorAt(obs,target,{heightM:0,xM:xM+1}),q=Geo().inverse(obs.latitude,obs.longitude,shifted.latitude,shifted.longitude),slope=diff(q.azimuth,g.azimuth);if(!Number.isFinite(slope)||Math.abs(slope)<1e-10)return {heightM:NaN,xM:NaN};xM-=error/slope;}
 anchor=anchorAt(obs,target,{heightM:0,xM});const distance=Geo().inverse(obs.latitude,obs.longitude,anchor.latitude,anchor.longitude).km*1000;const radius=R*k,theta=distance/radius;return {heightM:(radius+obs.elevation+eyeM)/(Math.cos(theta)-Math.tan(altitude*rad)*Math.sin(theta))-radius,xM};
}
function make({align,bodies,terrain,sidewalks,yieldTask=()=>new Promise(r=>setTimeout(r,0))}){
 const pathCache=new Map();
 function guesses(plan,seed){const start=day(plan.at),key=plan.body+','+start+','+(plan.atmosphere||'');let path=pathCache.get(key);if(!path){path=[];const ref={latitude:35.68626,longitude:139.73068,elevation:30};for(let t=start;t<start+DAY;t+=120000){const s=bodies.state(plan.body,t,ref);path.push({at:t,azimuth:s.azimuth});}pathCache.set(key,path);while(pathCache.size>4)pathCache.delete(pathCache.keys().next().value);}const bearing=Geo().inverse(seed.latitude,seed.longitude,plan.target.latitude,plan.target.longitude).azimuth,diff=a=>Math.abs(((a-bearing+540)%360)-180),ordered=path.slice().sort((a,b)=>diff(a.azimuth)-diff(b.azimuth)),out=[];for(const q of ordered){if(out.every(t=>Math.abs(t-q.at)>4*3600000))out.push(q.at);if(out.length===2)break;}return out;}
 async function solve(plan,seed){
  const c=plan.composition;if(!valid(c,plan.target)||!windowValid(plan.timeWindow))return {solutions:[],reason:'invalid-composition-or-time-window'};
  const D=Geo().inverse(plan.target.latitude,plan.target.longitude,seed.latitude,seed.longitude).km;if(!(D>.02&&D<=20))return {solutions:[],reason:'unsupported-distance'};
  const base=Geo().inverse(plan.target.latitude,plan.target.longitude,seed.latitude,seed.longitude).azimuth,start=day(plan.at),solutions=[];
  for(const at0 of guesses(plan,seed)){
   await yieldTask();let th=base,t=at0,ground=terrain.at(seed),failed=false,converged=false;if(!Number.isFinite(ground))continue;
   const at=(bearing,time,h)=>{const pos=Geo().destination(plan.target.latitude,plan.target.longitude,bearing,D),obs={...pos,elevation:h,eyeM:1.5},g=geometry(obs,plan.target,c,align),st=bodies.state(plan.body,time,{...obs,elevation:h+1.5}),xy=align.viewProjector(g.azimuth,g.angle)(st.azimuth,limb(st,c.limb));return xy?{residual:xy,obs,g,st}:null;};
   for(let round=0;round<5;round++){
    converged=false;
    for(let i=0;i<40;i++){
     const q=at(th,t,ground);if(!q){failed=true;break;}if(Math.hypot(...q.residual)<.0005){converged=true;break;}
     const dh=3/(D*1000)/rad,dt=5000,a=at(th+dh,t,ground),b=at(th,t+dt,ground);if(!a||!b){failed=true;break;}
     const j00=(a.residual[0]-q.residual[0])/dh,j01=(b.residual[0]-q.residual[0])/dt,j10=(a.residual[1]-q.residual[1])/dh,j11=(b.residual[1]-q.residual[1])/dt,det=j00*j11-j01*j10;if(!Number.isFinite(det)||Math.abs(det)<1e-16){failed=true;break;}
     const dth=-(j11*q.residual[0]-j01*q.residual[1])/det,dtime=-(-j10*q.residual[0]+j00*q.residual[1])/det,s=Math.min(1,20/Math.max(1e-9,Math.abs(dth)),1800000/Math.max(1,Math.abs(dtime)));th+=dth*s;t+=dtime*s;if(t<start-3600000||t>start+DAY+3600000){failed=true;break;}
    }
    if(failed||!converged)break;const q=at(th,t,ground);if(!q){failed=true;break;}const next=terrain.at(q.obs);if(!Number.isFinite(next)){failed=true;break;}if(Math.abs(next-ground)<.02){ground=next;break;}ground=next;
   }
   if(failed||!converged||t<start||t>=start+DAY)continue;const q=at(th,t,ground);if(!q)continue;const actual=terrain.at(q.obs);if(!Number.isFinite(actual)||Math.abs(actual-ground)>.02||Math.hypot(...q.residual)>.002||limb(q.st,'upper')<=0)continue;
   const road=roadAt(sidewalks,q.obs);if(!road)continue;const times=windowEvents(plan,q.obs,bodies);if(!inWindow(t,plan.timeWindow,times))continue;
   if(solutions.some(s=>Geo().distanceKm(s.observer.latitude,s.observer.longitude,q.obs.latitude,q.obs.longitude)<.001&&Math.abs(s.event.at-t)<1000))continue;
   const next=bodies.state(plan.body,t+60000,{...q.obs,elevation:ground+1.5}),event={at:t,intersects:true,side:next.apparentAltitude<q.st.apparentAltitude?'set':'rise',matchMode:'overlap',partId:'__whole',composition:{...c},compositionResidualDeg:Math.hypot(...q.residual),sunAltitude:bodies.state('sun',t,{...q.obs,elevation:ground+1.5}).apparentAltitude};
   solutions.push({observer:{...q.obs,sourceId:road.sourceId,polygonId:road.polygonId,structureClassificationKnown:true,nonTerrainStructure:false},anchor:q.g.anchor,geometry:{...q.g,topM:c.heightM},event});
  }
  return {solutions,reason:solutions.length?'composition-solutions':'no-solved-walkway-point'};
 }
 return {solve};
}
return {valid,windowValid,limb,anchorAt,geometry,roadAt,riseSet,inWindow,windowEvents,screenAnchor,make};
});
