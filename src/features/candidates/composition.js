/* Trial composition: drawing-surface anchor (legacy plane supported for numerical tests), exact topocentric solve and optional rise/set windows. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateComposition=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const Surface=globalThis.AstroNotesTrialSurface||(typeof require==='function'?require('./scene-surface.js'):null);
const rad=Math.PI/180,DAY=86400000,R=6371008.8,Geo=()=>globalThis.AstroNotesTerrain||(typeof require==='function'?require('../../../astronotes-terrain.js'):null),inside=(r,p)=>{let yes=false;for(let i=0,j=r.length-1;i<r.length;
j=i++)if((r[i][1]>p.latitude)!==(r[j][1]>p.latitude)&&p.longitude<(r[j][0]-r[i][0])*(p.latitude-r[i][1])/(r[j][1]-r[i][1])+r[i][0])yes=!yes;return yes;};
function valid(c,target){
 if(!c||![c.heightM,c.xM].every(Number.isFinite)||!['center','upper','lower'].includes(c.limb))return false;
 if(!c.basis)return c.heightM>=(target.groundM??0)&&c.heightM<=Math.max(...target.parts.map(p=>p.m));
 if(c.basis!=='scene-surface'||!Surface.compatible(c,target)||![c.eastM,c.northM].every(Number.isFinite))return false;
 const b=Surface.bounds({target});return !!b&&c.heightM>=b.heightMinM-.01&&c.heightM<=b.heightMaxM+.01&&c.eastM>=b.eastMinM-.01&&c.eastM<=b.eastMaxM+.01&&c.northM>=b.northMinM-.01&&c.northM<=b.northMaxM+.01;
}
function windowValid(w){return !w||w.kind==='none'||(['rise','set','both'].includes(w.kind)&&[w.beforeMin,w.afterMin].every(n=>Number.isFinite(n)&&n>=0&&n<=1440));}
function day(at){return Math.floor((at+32400000)/DAY)*DAY-32400000;}
function limb(st,kind){return kind==='upper'?(st.upperAltitude??st.apparentAltitude+st.angularRadius):kind==='lower'?(st.lowerAltitude??st.apparentAltitude-st.angularRadius):st.apparentAltitude;}
const limbKind=kind=>kind==='onTop'?'lower':kind==='behind'?'upper':['lower','upper'].includes(kind)?kind:'center';
function anchorAt(obs,target,c){if(c.basis==='scene-surface')return Surface.anchor(target,c);const bearing=Geo().inverse(target.latitude,target.longitude,obs.latitude,obs.longitude).azimuth;
return {...(c.xM?Geo().destination(target.latitude,target.longitude,bearing+(c.xM<0?90:-90),Math.abs(c.xM)/1000):target),heightM:c.heightM};}
function geometry(obs,target,c,align){const anchor=anchorAt(obs,target,c),g=align.geometryFrom(obs,{...target,latitude:anchor.latitude,longitude:anchor.longitude,parts:[{id:'__surface',m:c.heightM}]},{eyeM:obs.eyeM??1.5,heightM:c.heightM});return {anchor,...g};}
const roadCache=new WeakMap();
function roadAt(data,p){let boxes=roadCache.get(data);if(!boxes){boxes=(data.features||[]).filter(f=>['2000','2010','2020'].includes(f.function)).map(f=>{const r=f.coordinatesLonLatHeight;
return {f,box:[Math.min(...r.map(v=>v[0])),Math.min(...r.map(v=>v[1])),Math.max(...r.map(v=>v[0])),Math.max(...r.map(v=>v[1]))]};});roadCache.set(data,boxes);}let result=null;
const k=Math.cos(p.latitude*rad),nearEdge=r=>r.some((a,i)=>{const b=r[(i+1)%r.length],dx=(b[0]-a[0])*k,dy=b[1]-a[1],u=Math.max(0,Math.min(1,((p.longitude-a[0])*k*dx+(p.latitude-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot((p.longitude-a[0])*k-u*dx,p.latitude-a[1]-u*dy)*111195<.1;});
 for(const {f,box:b} of boxes)if(p.longitude>=b[0]&&p.longitude<=b[2]&&p.latitude>=b[1]&&p.latitude<=b[3]&&inside(f.coordinatesLonLatHeight,p)&&!(f.interiorRingsLonLatHeight||[]).some(h=>inside(h,p))){if(!f.structureClassificationKnown||f.nonTerrainStructure)return null;
 if(!nearEdge(f.coordinatesLonLatHeight)&&!(f.interiorRingsLonLatHeight||[]).some(nearEdge))result=f;}
 return result;
}
// Upper-limb apparent altitude crossing flat 0 degrees. Not a terrain/building horizon.
function riseSet(body,start,end,obs,bodies){const f=t=>limb(bodies.state(body,t,{...obs,elevation:obs.elevation+(obs.eyeM??1.5)}),'upper'),out=[],edge=t=>{if(Math.abs(f(t))>1e-10)return;const derivative=f(t+1000)-f(t-1000);
if(Math.abs(derivative)>1e-10)out.push({at:t,kind:derivative>0?'rise':'set'});};edge(start);let at=start,previous=f(at);for(let t=Math.min(end,start+300000);at<end;t=Math.min(end,t+300000)){const v=f(t);if((previous>0)!==(v>0)){let lo=at,hi=t;for(let i=0;i<30&&hi-lo>100;i++){const mid=(lo+hi)/2;
if((f(mid)>0)===(previous>0))lo=mid;else hi=mid;}out.push({at:(lo+hi)/2,kind:v>previous?'rise':'set'});}at=t;previous=v;}edge(end);return out.sort((a,b)=>a.at-b.at).filter((e,i,a)=>!i||Math.abs(e.at-a[i-1].at)>200||e.kind!==a[i-1].kind);}
function inWindow(at,w,events){return !w||w.kind==='none'||events.some(e=>(w.kind==='both'||e.kind===w.kind)&&at>=e.at-w.beforeMin*60000&&at<=e.at+w.afterMin*60000);}
function windowEvents(plan,obs,bodies){const w=plan.timeWindow;if(!windowValid(w))throw Error('invalid-time-window');if(!w||w.kind==='none')return [];const start=day(plan.at);return riseSet(plan.body,start-w.afterMin*60000,start+DAY+w.beforeMin*60000,obs,bodies);}
function screenAnchor({azimuth,altitude,obs,target,align,eyeM=1.5}){
 const base=Geo().inverse(obs.latitude,obs.longitude,target.latitude,target.longitude),d=base.km*1000,k=globalThis.AstroNotesAtmosphere?.targetK?.()??7/6,diff=(a,b)=>((a-b+540)%360)-180;let xM=d*Math.tan(diff(azimuth,base.azimuth)*rad),anchor;
 for(let i=0;i<8;i++){anchor=anchorAt(obs,target,{heightM:0,xM});const g=Geo().inverse(obs.latitude,obs.longitude,anchor.latitude,anchor.longitude),error=diff(g.azimuth,azimuth);if(Math.abs(error)<1e-8)break;
 const shifted=anchorAt(obs,target,{heightM:0,xM:xM+1}),q=Geo().inverse(obs.latitude,obs.longitude,shifted.latitude,shifted.longitude),slope=diff(q.azimuth,g.azimuth);if(!Number.isFinite(slope)||Math.abs(slope)<1e-10)return {heightM:NaN,xM:NaN};xM-=error/slope;}
 anchor=anchorAt(obs,target,{heightM:0,xM});const distance=Geo().inverse(obs.latitude,obs.longitude,anchor.latitude,anchor.longitude).km*1000;const radius=R*k,theta=distance/radius;return {heightM:(radius+obs.elevation+eyeM)/(Math.cos(theta)-Math.tan(altitude*rad)*Math.sin(theta))-radius,xM};
}
function make({align,bodies,terrain,sidewalks,yieldTask=typeof AstroNotesLibrary==='object'&&AstroNotesLibrary.pause||(()=>new Promise(r=>setTimeout(r,0)))}){
 const pathCache=new Map();
 function guesses(plan,seed){const start=day(plan.at),key=plan.body+','+start+','+(plan.atmosphere||'');let path=pathCache.get(key);if(!path){path=[];const ref={latitude:35.68626,longitude:139.73068,elevation:30};for(let t=start;t<start+DAY;t+=120000){const s=bodies.state(plan.body,t,ref);
 path.push({at:t,azimuth:s.azimuth});}pathCache.set(key,path);while(pathCache.size>4)pathCache.delete(pathCache.keys().next().value);
 }const bearing=Geo().inverse(seed.latitude,seed.longitude,plan.target.latitude,plan.target.longitude).azimuth,diff=a=>Math.abs(((a-bearing+540)%360)-180),ordered=path.slice().sort((a,b)=>diff(a.azimuth)-diff(b.azimuth)),out=[];
 for(const q of ordered){if(out.every(t=>Math.abs(t-q.at)>4*3600000))out.push(q.at);if(out.length===2)break;}return out;}
 async function solve(plan,seed){
  const c=plan.composition;if(!valid(c,plan.target)||!windowValid(plan.timeWindow))return {solutions:[],reason:'invalid-composition-or-time-window'};
  const D=Geo().inverse(plan.target.latitude,plan.target.longitude,seed.latitude,seed.longitude).km;if(!(D>.02&&D<=20))return {solutions:[],reason:'unsupported-distance'};
  const base=Geo().inverse(plan.target.latitude,plan.target.longitude,seed.latitude,seed.longitude).azimuth,start=day(plan.at),solutions=[];
  for(const at0 of guesses(plan,seed)){
   await yieldTask();let th=base,t=at0,ground=terrain.at(seed),failed=false,converged=false;if(!Number.isFinite(ground))continue;
   const at=(bearing,time,h)=>{const pos=Geo().destination(plan.target.latitude,plan.target.longitude,bearing,D),obs={...pos,elevation:h,eyeM:1.5},g=geometry(obs,plan.target,c,align),st=bodies.state(plan.body,time,{...obs,elevation:h+1.5}),xy=align.viewProjector(g.azimuth,g.angle)(st.azimuth,
   limb(st,c.limb));return xy?{residual:xy,obs,g,st}:null;};
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
   const next=bodies.state(plan.body,t+60000,{...q.obs,elevation:ground+1.5}),event={at:t,intersects:true,side:next.apparentAltitude<q.st.apparentAltitude?'set':'rise',matchMode:'overlap',partId:'__whole',composition:{...c},compositionResidualDeg:Math.hypot(...q.residual),
   sunAltitude:bodies.state('sun',t,{...q.obs,elevation:ground+1.5}).apparentAltitude};
   solutions.push({observer:{...q.obs,sourceId:road.sourceId,polygonId:road.polygonId,structureClassificationKnown:true,nonTerrainStructure:false},anchor:q.g.anchor,geometry:{...q.g,topM:c.heightM},event});
  }
  return {solutions,reason:solutions.length?'composition-solutions':'no-solved-walkway-point'};
 }
 return {solve};
}
// Generic opportunity search. The old inverse solver above is kept for its
// surveyed drawing-surface workflow. These functions never certify visibility.
function timeRange(plan){
 const s=plan.timeSpec||{kind:'day'},kind=s.kind||'day';
 if(kind==='instant'){const at=s.at;return Number.isFinite(at)?{kind,start:at,end:at}:null;}
 if(kind==='window')return Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.end>=s.start?{kind,start:s.start,end:s.end}:null;
 if(kind!=='day')return null;
 const zone=s.timezone||'Asia/Tokyo',at=Number.isFinite(s.at)?s.at:plan.at;
 try{
  const format=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}),ymd=t=>{const p=Object.fromEntries(format.formatToParts(t).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day;};
  const date=s.date||(Number.isFinite(at)?ymd(at):null);if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return null;
  const nominal=Date.parse(date+'T00:00:00Z');if(!Number.isFinite(nominal)||new Date(nominal).toISOString().slice(0,10)!==date)return null;
  const next=new Date(nominal+DAY).toISOString().slice(0,10),boundary=label=>{let lo=nominal-2*DAY,hi=nominal+3*DAY;while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(ymd(mid)<label)lo=mid;else hi=mid;}return hi;};
  const start=boundary(date),exclusive=boundary(next);return ymd(start)===date&&exclusive>start?{kind,start,end:exclusive-1,timezone:zone}:null;
 }catch{return null;}
}
function targetInput(t){
 if(!t||![t.latitude,t.longitude].every(Number.isFinite)||Math.abs(t.latitude)>90||Math.abs(t.longitude)>180)return null;
 if(t.parts?.some(p=>Number.isFinite(p.m)))return t;
 if(Number.isFinite(t.groundM)&&Number.isFinite(t.targetHeightM))return {...t,parts:[{id:'tip',m:t.groundM+t.targetHeightM}]};
 return null;
}
function nearPolicy(plan,bodies,state){
 const disc=bodies.definition?.(plan.body)?.limbs??['sun','moon'].includes(plan.body);
 const radius=Number.isFinite(state.angularRadius)?state.angularRadius:NaN;
 return {disc,radius,tolerance:disc?2*radius:(bodies.nearAngle?.(plan.body)??.5)};
}
// One point evaluation asks this thousands of times against the same projected outline (2026-11-11: about half the
// search time on a phone). The rings are flattened with their boxes once; a ring whose box is no nearer than the
// best edge so far cannot hold a nearer edge, so the answer is the same as checking every edge.
const flatRings=new WeakMap();
function flat(polygons){
 let rings=flatRings.get(polygons);if(rings)return rings;
 rings=polygons.map(ring=>{const n=ring.length,xs=new Float64Array(n),ys=new Float64Array(n);let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(let i=0;i<n;i++){const x=ring[i][0],y=ring[i][1];xs[i]=x;ys[i]=y;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}return {n,xs,ys,minX,minY,maxX,maxY};});
 flatRings.set(polygons,rings);return rings;
}
// 2026-11-12 スカイツリーの輪郭は多角形3511個（頂点2.3万）で、1地点の時刻探しのたびに全部を見ていた（探索のCPUの14%）。
// 左右の位置で32個ずつに分け、その中を上下の位置で8個ずつの塊にまとめ、届かない塊を飛ばす。結果は元の順番どおりに見た時と同じ:
// 中なら距離0、外なら最も近い辺（同じ距離なら多角形・辺の番号が小さい方）。
const clusterCache=new WeakMap();
function clusters(polygons){
 let found=clusterCache.get(polygons);if(found)return found;
 const rings=flat(polygons),order=rings.map((r,i)=>i).sort((a,b)=>(rings[a].minX+rings[a].maxX)-(rings[b].minX+rings[b].maxX)||a-b);found=[];
 for(let k=0;k<order.length;k+=32){const members=order.slice(k,k+32).sort((a,b)=>(rings[a].minY+rings[a].maxY)-(rings[b].minY+rings[b].maxY)||a-b);
  for(let m=0;m<members.length;m+=8){const ids=members.slice(m,m+8);let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
   for(const i of ids){const r=rings[i];if(r.minX<minX)minX=r.minX;if(r.maxX>maxX)maxX=r.maxX;if(r.minY<minY)minY=r.minY;if(r.maxY>maxY)maxY=r.maxY;}found.push({ids,minX,minY,maxX,maxY});}}
 clusterCache.set(polygons,found);return found;
}
function closestPoint(p,polygons){
 const px=p[0],py=p[1],rings=flat(polygons),groups=clusters(polygons);
 for(const c of groups){
  if(px<c.minX||px>c.maxX||py<c.minY||py>c.maxY)continue;
  for(const i of c.ids){const r=rings[i];
   if(px<r.minX||px>r.maxX||py<r.minY||py>r.maxY)continue;
   const {n,xs,ys}=r;let on=false;for(let a=0,b=n-1;a<n;b=a++)if((ys[a]>py)!==(ys[b]>py)&&px<(xs[b]-xs[a])*(py-ys[a])/(ys[b]-ys[a])+xs[a])on=!on;
   if(on)return {point:p,distance:0};
  }
 }
 let distance=Infinity,nx=0,ny=0,found=false,bestRing=Infinity,bestEdge=Infinity;
 const gap=b=>Math.hypot(Math.max(b.minX-px,0,px-b.maxX),Math.max(b.minY-py,0,py-b.maxY));
 for(const c of groups){
  if(gap(c)>distance)continue;
  for(const ri of c.ids){const r=rings[ri];if(gap(r)>distance)continue;
   const {n,xs,ys}=r;
   for(let i=0;i<n;i++){const k=i+1===n?0:i+1,ax=xs[i],ay=ys[i],dx=xs[k]-ax,dy=ys[k]-ay,u=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1))),qx=ax+u*dx,qy=ay+u*dy,d=Math.hypot(px-qx,py-qy);
    if(d<distance||found&&d===distance&&(ri<bestRing||ri===bestRing&&i<bestEdge)){distance=d;nx=qx;ny=qy;found=true;bestRing=ri;bestEdge=i;}}
  }
 }
 return {point:found?[nx,ny]:[0,0],distance};
}
function ridgeGeometry(observer,target,align){
 const raw=target.rim?.points||align.rimPoints?.(target.rim);if(!Array.isArray(raw)||!raw.length)return null;
 const center=Geo().inverse(observer.latitude,observer.longitude,target.rim.latitude??target.latitude,target.rim.longitude??target.longitude),difference=(a,b)=>((a-b+540)%360)-180;
 const points=raw.filter(p=>[p.latitude,p.longitude,p.m??p.heightM].every(Number.isFinite)).map(p=>{const anchor={latitude:p.latitude,longitude:p.longitude,heightM:p.m??p.heightM},geometry=align.geometryFrom(observer,{...target,...anchor,rim:null,parts:[{id:'ridge',m:anchor.heightM}]},{
 heightM:anchor.heightM,eyeM:observer.eyeM??1.5});return {anchor,geometry,relative:difference(geometry.azimuth,center.azimuth)};}).filter(p=>Number.isFinite(p.geometry?.angle)).sort((a,b)=>a.relative-b.relative);
 if(!points.length)return null;
 const bin=Math.atan(.015/Math.max(.001,center.km))/rad;
 return {points,at(azimuth){const relative=difference(azimuth,center.azimuth);let visible=null,closest=null;
  for(const p of points){if(!closest||Math.abs(p.relative-relative)<Math.abs(closest.relative-relative))closest=p;if(Math.abs(p.relative-relative)<=bin&&(!visible||p.geometry.angle>visible.geometry.angle))visible=p;}
  return visible||closest;
 }};
}
function standingDomain(point,sidewalks){
 const s=point.surfaceGeometry;
 if(s){
  const polygons=(s.polygons||[]).filter(p=>p?.[0]?.length>=3),lines=(s.lines||[]).filter(p=>p?.length>=2);
  return {polygons,lines,contains:p=>polygons.some(r=>inside(r[0],p)&&!r.slice(1).some(h=>inside(h,p))),metadata:{}};
 }
 const road=sidewalks&&roadAt(sidewalks,point);
 if(!sidewalks)return null;
 const eligible=(sidewalks.features||[]).filter(f=>['2000','2010','2020'].includes(f.function)&&f.structureClassificationKnown&&!f.nonTerrainStructure),named=eligible.filter(f=>point.polygonId?f.polygonId===point.polygonId:point.sourceId&&f.sourceId===point.sourceId),roads={
 features:road?[road]:named.length?named:eligible};
 // A legacy seed can be a distance/bearing hint outside every surveyed face.
 // Its solved point must still be on an actual surveyed face. Dynamic places
 // above always retain their individual surface instead of this legacy union.
 return {polygons:roads.features.map(f=>[f.coordinatesLonLatHeight,...(f.interiorRingsLonLatHeight||[])]),lines:[],contains:p=>!!roadAt(roads,p),metadata:{},metadataAt:p=>{const f=roadAt(roads,p);
 return f?{sourceId:f.sourceId,polygonId:f.polygonId,structureClassificationKnown:true,nonTerrainStructure:false}:{};}};
}
// This is a constrained local inverse, not an exhaustive surface search. A
// line has no invented width; every trial position is parameterized on it.
async function surfaceInverse(plan,seed,range,timeSeeds,deps){
 const {align,bodies,terrain,groundAt,sidewalks,standingAt,isCurrent,yieldTask}=deps,domain=standingDomain(seed,sidewalks),solutions=[];
 if(!domain||!domain.polygons.length&&!domain.lines.length)return {solutions,attempted:false,calls:0};
 const limit=Math.max(1,Math.floor(deps.budget)),c=plan.composition,target=plan.target,eyeM=seed.eyeM??seed.eyeHeightAGL??1.5,groundCache=new Map(),ridgeCache=new Map();let calls=0,exhausted=false,unknown=false,cancelled=false;
 async function at(pos,time){
  if(!isCurrent()){cancelled=true;return null;}if(calls>=limit){exhausted=true;return null;}if(calls++%48===0){await yieldTask();if(!isCurrent()){cancelled=true;return null;}}
  if(![pos.latitude,pos.longitude,time].every(Number.isFinite))return null;
  const key=pos.latitude.toFixed(8)+'/'+pos.longitude.toFixed(8);let ground=groundCache.get(key);
  if(ground===undefined){try{ground=groundAt?await groundAt(pos):await terrain?.at(pos);}catch{ground=null;}groundCache.set(key,ground);}
  if(!Number.isFinite(ground)){unknown=true;return null;}
  const agl=Number.isFinite(seed.surfaceAglM)?seed.surfaceAglM:Number.isFinite(seed.surfaceHeightM)?seed.surfaceHeightM:null;
  const absolute=seed.heightBasis==='constant-absolute-floor'||seed.sourceEvidence?.heightBasis==='constant-absolute-floor';
  const floor=absolute?(seed.standingElevationM??seed.surfaceElevationM):ground+(agl??0);
  if(!Number.isFinite(floor)){unknown=true;return null;}
  const observer={...seed,...pos,...domain.metadata,groundM:ground,groundKnown:true,elevation:floor,surfaceElevationM:floor,standingElevationM:floor,eyeM};
  try{
   const st=bodies.state(plan.body,time,{...observer,elevation:floor+eyeM});let g=c?geometry(observer,target,c,align):align.geometryFrom(observer,target,{partId:plan.partId==='__whole'?null:plan.partId,eyeM});
   if(!c&&target.rim){let rim=ridgeCache.get(key);if(!rim){rim=ridgeGeometry(observer,target,align);if(rim)ridgeCache.set(key,rim);}const hit=rim?.at(st.azimuth);if(!hit){unknown=true;return null;}g={...hit.geometry,anchor:hit.anchor};}
   const selected=limbKind(c?.limb||((bodies.definition?.(plan.body)?.limbs??['sun','moon'].includes(plan.body))?plan.limb:'center')),residual=g&&align.viewProjector(g.azimuth,g.angle)(st.azimuth,limb(st,selected));
   return residual?.every(Number.isFinite)?{observer,at:time,geometry:g,residual,loss:Math.hypot(...residual)}:null;
  }catch{unknown=true;return null;}
 }
 const timeStarts=range.kind==='instant'?[range.start]:[...new Set([...(timeSeeds||[]),range.start,(range.start+range.end)/2,range.end])].slice(0,10);
 const bounded=(n,a,b)=>Math.max(a,Math.min(b,n));
 async function accept(q,inDomain){
  if(!q||q.loss>.002||!inDomain(q.observer)||q.at<range.start||q.at>range.end)return;
  if(standingAt){let standing;try{standing=await standingAt(q.observer);}catch{unknown=true;return;}if(!standing)return;if(typeof standing==='object')Object.assign(q.observer,standing);}
  Object.assign(q.observer,domain.metadataAt?.(q.observer)||{});
  if(solutions.some(s=>Math.abs(s.at-q.at)<1000&&Geo().distanceKm(s.observer.latitude,s.observer.longitude,q.observer.latitude,q.observer.longitude)<.001))return;
  solutions.push(q);
 }
 async function optimize(initial,map,bounds,steps,inDomain){
  let x=initial.slice(),q=await at(...map(x));
  for(let i=0;i<30&&q&&!exhausted&&!cancelled;i++){
   if(q.loss<.0005)break;
   const columns=[];
   for(let j=0;j<x.length;j++){
    let h=steps[j];if(x[j]+h>bounds[j][1])h=-h;const xx=x.slice();xx[j]=bounded(x[j]+h,...bounds[j]);h=xx[j]-x[j];const v=h&&await at(...map(xx));if(!v){columns.length=0;break;}columns.push(v.residual.map((n,k)=>(n-q.residual[k])/h));
   }
   if(columns.length!==x.length)break;
   let delta;
   if(x.length===1){const a=columns[0],norm=a[0]*a[0]+a[1]*a[1];if(norm<1e-18)break;delta=[-(a[0]*q.residual[0]+a[1]*q.residual[1])/norm];}
   else{const [a,b]=columns,det=a[0]*b[1]-b[0]*a[1];if(!Number.isFinite(det)||Math.abs(det)<1e-15)break;delta=[(-b[1]*q.residual[0]+b[0]*q.residual[1])/det,(a[1]*q.residual[0]-a[0]*q.residual[1])/det];}
   const scale=Math.min(1,...delta.map((v,j)=>Math.max(steps[j],(bounds[j][1]-bounds[j][0])*.25)/Math.max(1e-12,Math.abs(v))));let improved=false;
   for(let back=0;back<7;back++){
    const next=x.map((v,j)=>bounded(v+delta[j]*scale/2**back,...bounds[j])),candidate=await at(...map(next));
    if(candidate&&candidate.loss<q.loss-1e-10){x=next;q=candidate;improved=true;break;}
    if(exhausted||cancelled)break;
   }
   if(!improved)break;
  }
  await accept(q,inDomain);
 }
 for(const line of domain.lines){
  if(exhausted||cancelled)break;
  const parts=[],vertices=[0];let total=0;
  for(let i=1;i<line.length;i++){const [lon,lat]=line[i-1],[endLon,endLat]=line[i],g=Geo().inverse(lat,lon,endLat,endLon),length=g.km*1000;if(!(length>0))continue;parts.push({start:total,end:total+length,lat,lon,azimuth:g.azimuth});total+=length;vertices.push(total);}
  if(!(total>0))continue;
  const position=s=>{const p=parts.find(p=>s<=p.end)||parts.at(-1);return Geo().destination(p.lat,p.lon,p.azimuth,(bounded(s,0,total)-p.start)/1000);};
  let nearest={s:0,d:Infinity};for(const p of parts){const v=Geo().inverse(p.lat,p.lon,seed.latitude,seed.longitude),s=bounded(v.km*1000*Math.cos((v.azimuth-p.azimuth)*rad),0,p.end-p.start)+p.start,pos=position(s),d=Geo().distanceKm(pos.latitude,pos.longitude,seed.latitude,seed.longitude);
  if(d<nearest.d)nearest={s,d};}
  const stations=[nearest.s,...vertices,...parts.map(p=>(p.start+p.end)/2)].filter((s,i,a)=>a.indexOf(s)===i).slice(0,16);
  for(const t of timeStarts){for(const s of stations){
   if(exhausted||cancelled)break;
   if(range.kind==='instant')await optimize([s],x=>[position(x[0]),range.start],[[0,total]],[Math.min(1,total/100)],()=>true);
   else await optimize([s,(t-range.start)/1000],x=>[position(x[0]),range.start+x[1]*1000],[[0,total],[0,(range.end-range.start)/1000]],[Math.min(1,total/100),5],()=>true);
  }if(exhausted||cancelled)break;}
 }
 if(domain.polygons.length&&!exhausted&&!cancelled){
  const inverse=Geo().inverse(target.latitude,target.longitude,seed.latitude,seed.longitude),distanceM=inverse.km*1000;
  const offsets=domain.polygons.flatMap(r=>r[0]).map(([lon,lat])=>{const g=Geo().inverse(seed.latitude,seed.longitude,lat,lon);return [g.km*1000*Math.sin(g.azimuth*rad),g.km*1000*Math.cos(g.azimuth*rad)];});
  const bounds=[0,1].map(i=>[Math.min(...offsets.map(p=>p[i])),Math.max(...offsets.map(p=>p[i]))]);
  if(range.kind==='instant'){
   const position=xy=>Geo().destination(seed.latitude,seed.longitude,Math.atan2(xy[0],xy[1])/rad,Math.hypot(...xy)/1000);
   const starts=[[0,0],bounds.map(([a,b])=>(a+b)/2),...offsets].slice(0,10);
   for(const start of starts){if(exhausted||cancelled)break;await optimize(start,x=>[position(x),range.start],bounds,[1,1],domain.contains);}
  }else if(distanceM>0){
   // Preserve the old explicit-composition distance constraint while replacing
   // its geographic/time caps with the supplied surface and time range.
   const angles=domain.polygons.flatMap(r=>r[0]).map(([lon,lat])=>{const g=Geo().inverse(target.latitude,target.longitude,lat,lon);return (((g.azimuth-inverse.azimuth+540)%360)-180)*rad*distanceM;}),bound=[Math.min(0,...angles),Math.max(0,...angles)];
   for(const t of timeStarts){if(exhausted||cancelled)break;await optimize([0,(t-range.start)/1000],x=>[Geo().destination(target.latitude,target.longitude,inverse.azimuth+x[0]/distanceM/rad,distanceM/1000),range.start+x[1]*1000],[bound,[0,(range.end-range.start)/1000]],[1,5],domain.contains);}
  }
 }
 return {solutions,attempted:true,calls,exhausted,unknown,cancelled};
}
async function opportunities(plan,point,{align,bodies,terrain,groundAt,sidewalks,standingAt,isCurrent=()=>true,yieldTask=typeof AstroNotesLibrary==='object'&&AstroNotesLibrary.pause||(()=>new Promise(r=>setTimeout(r,0))),budget=12000,_surfaceSolved=false}={}){
 const empty=(reason,partial=false)=>({solutions:[],partial,reason}),range=timeRange(plan),target=targetInput(plan.target);
 if(!range)return empty('invalid-time-spec');
 if(!target||!align||!bodies||![point?.latitude,point?.longitude].every(Number.isFinite))return empty('invalid-target-or-observer');
 if(bodies.definition&&!bodies.definition(plan.body))return empty('unknown-body');
 if(!windowValid(plan.timeWindow)||plan.compositionInvalid||plan.composition&&!valid(plan.composition,target))return empty('invalid-composition-or-time-window');
 if(!isCurrent())return empty('cancelled',true);
 try{await bodies.ensure?.(plan.body);}catch{return empty('body-data-unavailable',true);}
 let ground;try{ground=Number.isFinite(point.groundM)?point.groundM:groundAt?await groundAt(point):await terrain?.at(point);}catch{ground=null;}
 const elevation=Number.isFinite(point.standingElevationM)?point.standingElevationM:Number.isFinite(point.surfaceElevationM)?point.surfaceElevationM:Number.isFinite(point.elevation)?point.elevation:Number.isFinite(ground)?ground+(point.surfaceAglM??point.surfaceHeightM??0):null,
 eyeM=point.eyeM??point.eyeHeightAGL??1.5;
 if(!Number.isFinite(elevation)||!Number.isFinite(eyeM)||eyeM<0)return empty('standing-height-unknown',true);
 const observer={...point,elevation,eyeM},eye={...observer,elevation:elevation+eyeM},c=plan.composition;
 const g=c?geometry(observer,target,c,align):align.geometryFrom(observer,target,{partId:plan.partId==='__whole'?null:plan.partId,eyeM});
 if(!g||![g.azimuth,g.angle,g.topM,g.distanceKm].every(Number.isFinite))return empty('target-geometry-unknown',true);
 const partTarget=align.partTarget?.(target,plan.partId==='__whole'?null:plan.partId)||target;
 const strict=!!(c||plan.strict||plan.profile==='summit-contact'||target.rim),project=align.viewProjector(g.azimuth,g.angle),anchor=g.anchor||{latitude:partTarget.latitude,longitude:partTarget.longitude,heightM:g.topM};
 const pointBody=!(bodies.definition?.(plan.body)?.limbs??['sun','moon'].includes(plan.body)),whole=!plan.partId||plan.partId==='__whole';
 const outline=pointBody||!strict&&whole?align.towerOutline?.(observer,target,{eyeM}):null;
 const selfPolygons=outline?.known&&!outline.schematic?(outline.hitPolygons||outline.polygons||[outline.hitPoints||outline.points]).filter(Boolean).map(r=>r.map(p=>project(p[0],p[1])).filter(Boolean)).filter(r=>r.length>=3):[];
 const polygons=!strict&&whole?selfPolygons:[];
 const ridge=!c&&target.rim?ridgeGeometry(observer,target,align):null;if(!c&&target.rim&&!ridge)return empty('ridge-data-unavailable',true);
 const geometryKind=ridge?'ridge':polygons.length?'silhouette':'anchor',samples=new Map();let calls=0,exhausted=false,unknown=false,cancelled=false;
 const limit=Math.max(1,Math.floor(Number.isFinite(budget)?budget:12000));
 async function evaluate(at){
  at=Math.max(range.start,Math.min(range.end,at));if(samples.has(at))return samples.get(at);
  if(!isCurrent()){cancelled=true;return null;}if(calls>=limit){exhausted=true;return null;}
  if(calls%96===0){await yieldTask();if(!isCurrent()){cancelled=true;return null;}}
  calls++;let st;try{st=bodies.state(plan.body,at,eye);}catch{unknown=true;return null;}
  const policy=nearPolicy(plan,bodies,st);if(![st.azimuth,st.apparentAltitude,policy.radius,policy.tolerance].every(Number.isFinite)||policy.radius<0){unknown=true;return null;}
  const selectedRidge=ridge?.at(st.azimuth),activeGeometry=selectedRidge?.geometry||g,activeAnchor=selectedRidge?.anchor||anchor,activeProject=selectedRidge?align.viewProjector(activeGeometry.azimuth,activeGeometry.angle):project;
  const chosen=limbKind(c?.limb||(policy.disc?plan.limb:'center')),height=limb(st,chosen),xy=activeProject(st.azimuth,strict?height:st.apparentAltitude);
  if(!xy)return {at,score:Infinity,eligible:false,state:st};
  const near=polygons.length?closestPoint(xy,polygons):{point:[0,0],distance:Math.hypot(...xy)},angle=Math.atan(near.distance*rad)/rad;
  const gap=strict?Math.atan(Math.hypot(...xy)*rad)/rad:Math.max(0,angle-policy.radius),tolerance=c ? .002 : strict ? 1/60 : policy.tolerance;
  const overlaps=!strict&&angle<=policy.radius,dx=xy[0]-near.point[0],dy=xy[1]-near.point[1],below=!strict&&!overlaps&&dy<0&&Math.abs(dy)>Math.abs(dx);
  const center=pointBody&&project(st.azimuth,st.apparentAltitude),selfOccluded=!!(center&&selfPolygons.length&&closestPoint(center,selfPolygons).distance<=1e-8);
  // An elevated observer can see below their local horizontal plane. This is
  // only the ellipsoid horizon; terrain/buildings are the evaluator's job.
  const horizon=elevation+eyeM>0?-Math.acos(R/(R+elevation+eyeM))/rad:0;
  const above=(st.upperAltitude??st.apparentAltitude+policy.radius)>=horizon;
  const row={at,score:gap-tolerance,eligible:above&&!below&&!selfOccluded&&gap<=tolerance+1e-10,state:st,gap,tolerance,overlaps,below,above,selfOccluded,geometryKind,geometry:activeGeometry,anchor:activeAnchor};samples.set(at,row);return row;
 }
 let windows=[],riseLimited=false;
 if(plan.timeWindow?.kind&&plan.timeWindow.kind!=='none'){
  const w=plan.timeWindow,events=[],from=range.start-w.afterMin*60000,until=range.end+w.beforeMin*60000;
  const limitedBodies={state:(...args)=>{if(calls>=limit){riseLimited=true;throw Error('rise-budget');}calls++;return bodies.state(...args);}};
  try{for(let cursor=from;;cursor+=DAY){await yieldTask();if(!isCurrent())return empty('cancelled',true);const end=Math.min(until,cursor+DAY);events.push(...riseSet(plan.body,cursor,end,observer,limitedBodies));if(end===until)break;}}catch{if(!riseLimited)return empty('rise-set-unavailable',true);}
  windows=events.filter(e=>w.kind==='both'||e.kind===w.kind).map(e=>[Math.max(range.start,e.at-w.beforeMin*60000),Math.min(range.end,e.at+w.afterMin*60000)]).filter(([a,b])=>a<=b);
 }else windows=[[range.start,range.end]];
 const candidates=[];
 for(const [start,end]of windows){
  if(cancelled||exhausted)break;
  if(start===end){const e=await evaluate(start);if(e?.eligible)candidates.push({...e,interval:[start,end]});continue;}
  // Five-minute brackets plus midpoint and local minima refinement. Finite
  // bracketing is deliberately reported as partial, never an absence proof.
  const count=Math.max(1,Math.ceil((end-start)/300000)),rows=[];
  for(let i=0;i<=count;i++){const e=await evaluate(start+(end-start)*i/count);if(e)rows.push(e);if(cancelled||exhausted)break;}
  for(let i=1;i<rows.length;i++){const e=await evaluate((rows[i-1].at+rows[i].at)/2);if(e)candidates.push(e);if(cancelled||exhausted)break;}
  candidates.push(...rows);
  const ordered=[...samples.values()].filter(e=>e.at>=start&&e.at<=end).sort((a,b)=>a.at-b.at);
  for(let i=1;i<ordered.length-1;i++){
   if(cancelled||exhausted)break;const e=ordered[i];if(!Number.isFinite(e.score)||e.score>ordered[i-1].score||e.score>ordered[i+1].score||e.score===ordered[i-1].score&&e.score===ordered[i+1].score)continue;
   let lo=ordered[i-1].at,hi=ordered[i+1].at;const ratio=(Math.sqrt(5)-1)/2;
   let x=hi-ratio*(hi-lo),y=lo+ratio*(hi-lo),a=await evaluate(x),b=await evaluate(y);
   for(let n=0;n<25&&hi-lo>100;n++){if(!a||!b||cancelled||exhausted)break;if(a.score<=b.score){hi=y;y=x;b=a;x=hi-ratio*(hi-lo);a=await evaluate(x);}else{lo=x;x=y;a=b;y=lo+ratio*(hi-lo);b=await evaluate(y);}}
   if(a)candidates.push(a);if(b)candidates.push(b);
  }
  // A point body crossing a building has a blocked minimum between two useful
  // near passages. Refine both silhouette transitions instead of returning
  // only the occluded minimum and losing its visible neighbours.
  if(pointBody&&selfPolygons.length){
   const edges=[...samples.values()].filter(e=>e.at>=start&&e.at<=end).sort((a,b)=>a.at-b.at);
   for(let i=1;i<edges.length;i++){
    let a=edges[i-1],b=edges[i];if(a.selfOccluded===b.selfOccluded)continue;
    for(let n=0;n<25&&b.at-a.at>100&&!cancelled&&!exhausted;n++){const mid=await evaluate((a.at+b.at)/2);if(!mid)break;candidates.push(mid);if(mid.selfOccluded===a.selfOccluded)a=mid;else b=mid;}
   }
  }
 }
 if(cancelled)return empty('cancelled',true);
 const eligible=candidates.filter(e=>e.eligible).sort((a,b)=>a.at-b.at),clusters=[];
 for(const row of eligible){let group=clusters.at(-1);const intervening=group&&[...samples.values()].some(e=>e.at>group.at(-1).at&&e.at<row.at&&!e.eligible);if(!group||row.at-group.at(-1).at>300000||intervening){group=[];clusters.push(group);}group.push(row);}
 const solutions=[];
 for(const cluster of clusters){
  const best=cluster.reduce((a,b)=>b.gap<a.gap?b:a),interval=[cluster[0].at,cluster.at(-1).at];let sunAltitude=null,side=null;
  try{sunAltitude=bodies.state('sun',best.at,eye).apparentAltitude;side=bodies.state(plan.body,best.at+1000,eye).apparentAltitude<best.state.apparentAltitude?'set':'rise';}catch{unknown=true;}
  const contactLimb=limbKind(c?.limb||plan.limb),event={at:range.kind==='instant'?range.start:best.at,intersects:strict||best.overlaps,nearTarget:!strict,
  relation:strict?(contactLimb!=='center'?'edge-contact':'anchor-hit'):best.overlaps?(geometryKind==='silhouette'?'silhouette-overlap':'anchor-hit'):'near',matchMode:strict?'limb':'near',partId:plan.partId||'tip',contactLimb,gapAngleDeg:best.gap,gapAngleRad:best.gap*rad,
  toleranceAngleDeg:best.tolerance,toleranceAngleRad:best.tolerance*rad,radius:best.state.angularRadius,altitude:best.state.apparentAltitude,azimuth:best.state.azimuth,sunAltitude,side,targetGeometryKind:geometryKind,timeInterval:interval,timeIntervalSampled:true,visibility:'unknown',...(c?{
  composition:{...c},compositionResidualDeg:best.gap}:{})};
  solutions.push({observer:{...observer},event,geometry:{...best.geometry},anchor:{...best.anchor}});
 }
 let surfaceAttempted=false;
 if(strict&&!_surfaceSolved&&calls>=limit&&(point.surfaceGeometry?.polygons?.length||point.surfaceGeometry?.lines?.length||!point.surfaceGeometry&&sidewalks?.features?.length))exhausted=true;
 if(strict&&!_surfaceSolved&&!exhausted&&calls<limit){
  const starts=[];for(const s of [...samples.values()].sort((a,b)=>a.score-b.score))if(starts.every(t=>Math.abs(t-s.at)>1800000)){starts.push(s.at);if(starts.length>=6)break;}
  const inverse=await surfaceInverse({...plan,target},observer,range,starts,{align,bodies,terrain,groundAt,sidewalks,standingAt,isCurrent,yieldTask,budget:Math.min(2500,limit-calls)});
  calls+=inverse.calls;exhausted||=inverse.exhausted;unknown||=inverse.unknown;surfaceAttempted=inverse.attempted;
  if(inverse.cancelled)return empty('cancelled',true);
  for(const q of inverse.solutions){
   if(calls>=limit){exhausted=true;break;}
   const checked=await opportunities({...plan,timeSpec:{kind:'instant',at:range.kind==='instant'?range.start:q.at}},q.observer,{align,bodies,terrain,groundAt,isCurrent,yieldTask,budget:Math.max(1,limit-calls),_surfaceSolved:true});calls+=checked.evaluated||0;
   if(checked.reason==='cancelled')return empty('cancelled',true);
   exhausted||=checked.reason==='budget-exhausted';unknown||=checked.partial&&checked.reason==='some-calculations-unknown';
   for(const s of checked.solutions)if(!solutions.some(p=>Math.abs(p.event.at-s.event.at)<1000&&Geo().distanceKm(p.observer.latitude,p.observer.longitude,s.observer.latitude,s.observer.longitude)<.001))solutions.push({...s,event:{...s.event,inverseSurfaceSolved:true,alignmentResidualDeg:q.loss,
   ...(c?{compositionResidualDeg:q.loss}:{})}});
  }
 }
 const partial=range.kind!=='instant'||exhausted||riseLimited||unknown||surfaceAttempted;
 return {solutions,partial,reason:exhausted||riseLimited?'budget-exhausted':unknown?'some-calculations-unknown':solutions.length?'geometric-opportunities':partial?'no-opportunity-found-in-sampled-range':'no-opportunity-at-fixed-time',evaluated:calls};
}
async function inverseSeeds(plan,{bodies,isCurrent=()=>true,yieldTask=typeof AstroNotesLibrary==='object'&&AstroNotesLibrary.pause||(()=>new Promise(r=>setTimeout(r,0))),groundHypothesesM,budget=2500}={}){
 const target=targetInput(plan.target),range=timeRange(plan),none=reason=>({seeds:[],partial:true,reason});
 if(!target||!range||!bodies)return none('invalid-target-or-time-spec');
 if(bodies.definition&&!bodies.definition(plan.body))return none('unknown-body');
 const part=target.parts.find(p=>p.id===plan.partId)||target.parts.find(p=>p.id==='tip')||target.parts.find(p=>Number.isFinite(p.m)),top=plan.composition?.heightM??part?.m;
 if(!Number.isFinite(top))return none('target-height-unknown');
 try{await bodies.ensure?.(plan.body);}catch{return none('body-data-unavailable');}
 const ground=Number.isFinite(target.groundM)?target.groundM:0,heights=Array.isArray(groundHypothesesM)?groundHypothesesM:[0,ground,ground-100,ground+100,ground-500,ground+500],hypotheses=[...new Set(heights.filter(Number.isFinite))],seeds=[],seen=new Set();
 const count=range.kind==='instant'?0:Math.max(1,Math.ceil((range.end-range.start)/600000)),maxSeeds=Math.max(1,Math.floor(Number.isFinite(budget)?budget:2500));let exhausted=false,unknown=false;
 for(let i=0;i<=count;i++){
  if(i>=maxSeeds){exhausted=true;break;}
  if(!isCurrent())return none('cancelled');if(i%12===0){await yieldTask();if(!isCurrent())return none('cancelled');}
  const at=count?range.start+(range.end-range.start)*i/count:range.start;let state;try{state=bodies.state(plan.body,at,{latitude:target.latitude,longitude:target.longitude,elevation:top});}catch{unknown=true;continue;}
  const policy=nearPolicy(plan,bodies,state);if(![state.azimuth,state.apparentAltitude,policy.radius,policy.tolerance].every(Number.isFinite)){unknown=true;continue;}
  const strict=!!(plan.composition||plan.strict||plan.profile==='summit-contact'||target.rim),chosen=limbKind(plan.composition?.limb||(policy.disc?plan.limb:'center')),bodyHeight=limb(state,chosen);
  // Intersect the reverse celestial ray from the target with several possible
  // observer-height spheres. The altitude here belongs to the TARGET's local
  // frame; using it directly as the observer's altitude breaks distant seeds.
  // These spheres and angular offsets describe acquisition hypotheses only.
  const padding=strict?.25:Math.max(.25,policy.tolerance),angles=[bodyHeight,bodyHeight-padding,bodyHeight+padding];
  for(const h of hypotheses)for(const angle of angles){
   if(!(angle>-90&&angle<90))continue;const rt=R+top,ro=R+h+1.5,sine=Math.sin(angle*rad),cosine=Math.cos(angle*rad),disc=ro*ro-rt*rt*cosine*cosine;if(!(rt>0&&ro>0)||disc<0)continue;
   for(const length of [rt*sine-Math.sqrt(disc),rt*sine+Math.sqrt(disc)]){
    if(!(length>0))continue;
    // The far sphere intersection can lie behind the solid Earth. Omit that
    // coarse branch instead of spending the acquisition budget on its tiles.
    if(length>rt*sine&&rt*sine>0&&rt*Math.abs(cosine)<R+Math.min(0,h,ground))continue;
    const theta=Math.atan2(length*cosine,rt-length*sine),distanceM=R*theta;
    if(!(distanceM>0&&distanceM<Math.PI*R))continue;
    if(seeds.length>=maxSeeds){exhausted=true;break;}
    const bearing=(state.azimuth+180)%360,p=Geo().destination(target.latitude,target.longitude,bearing,distanceM/1000),key=[p.latitude.toFixed(5),p.longitude.toFixed(5),Math.round(at/60000)].join('/');if(seen.has(key))continue;seen.add(key);
    const radiusM=Math.max(250,distanceM*Math.tan((padding+.25)*rad));seeds.push({...p,at,distanceM,azimuth:bearing,bodyAltitude:bodyHeight,assumedGroundM:h,radiusM,approximate:true,source:'inverse-geometry-seed',priority:Math.abs(angle-bodyHeight)+Math.abs(h-ground)/10000});
   }
   if(exhausted)break;
  }
  if(exhausted)break;
 }
 seeds.sort((a,b)=>a.priority-b.priority||a.at-b.at||a.distanceM-b.distanceM);
 return {seeds,partial:true,reason:exhausted?'seed-budget-exhausted':unknown?'some-ephemeris-unknown':'approximate-terrain-hypotheses'};
}
return {valid,windowValid,limb,anchorAt,geometry,roadAt,riseSet,inWindow,windowEvents,screenAnchor,make,timeRange,opportunities,inverseSeeds,closestPoint};
});
