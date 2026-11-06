// Record-only eye height ranges. A fixed height delegates to Shooting.candidates unchanged.
// A range searches the finite 0.1m grid with scanHeights. A band is dropped only by a certificate that
// encloses every candidate time, eye height, refraction value and projector the normal calculation could use.
// Every returned row is recomputed by Shooting.candidates at its exact height. Unfinished work is an issue, never zero.
// Self-contained for factory.toString() injection: all runtime modules arrive in deps.
export function createRecordHeightCandidates(deps){
 const {shooting,align,bodies,atmosphere,astro,terrain=null,scanHeights,rangeOf,isMountain,observerAt,elevationAt,ensure,viewFor=null,mountainRidge=null,summitCapM=300,yieldTask=()=>new Promise(r=>setTimeout(r,0)),clock=()=>Date.now(),limits={}}=deps;
 const LIM={heights:48,positions:12000,shapeMs:45000,views:64,evaluations:512,regions:512,states:40000,coarseMs:600000,leafMs:20000,mergeMs:1800000,pointMs:15000,...limits};
 const DAY=86400000,RAD=Math.PI/180,DEG=180/Math.PI,MOON_KM=300000,EARTH_KM=6371.0088;
 const lru=n=>{const m=new Map();return {get(k){if(!m.has(k))return undefined;const v=m.get(k);m.delete(k);m.set(k,v);return v;},set(k,v){m.delete(k);m.set(k,v);while(m.size>n)m.delete(m.keys().next().value);return v;},delete(k){m.delete(k);},get size(){return m.size;}};};
 const views=lru(LIM.views),evals=lru(LIM.evaluations),regions=lru(LIM.regions),states=lru(LIM.states);
 const stats={realEvaluations:0,verifications:0,certificates:0,geometryBuilds:0,leafTests:0,bodyStates:0};
 const unit=(az,alt)=>{const a=az*RAD,h=alt*RAD;return [Math.cos(h)*Math.sin(a),Math.cos(h)*Math.cos(a),Math.sin(h)];};
 const angle=(u,v)=>{const c=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];return Math.atan2(Math.hypot(c[0],c[1],c[2]),u[0]*v[0]+u[1]*v[1]+u[2]*v[2])*DEG;};
 const altOf=u=>Math.asin(Math.max(-1,Math.min(1,u[2])))*DEG,azOf=u=>(Math.atan2(u[0],u[1])*DEG+360)%360;
 const azDiff=(a,b)=>((a-b+540)%360)-180;
 const cancelled=()=>Error('height-cancelled');
 const ready=()=>typeof align?.heightVertices==='function'&&typeof align?.viewProjector==='function'&&typeof atmosphere?.refractionBounds==='function'&&typeof bodies?.state==='function'&&typeof scanHeights==='function';
 const placeAt=(ctx,h)=>({...ctx.place,eyeHeightAGL:h,standAglM:h,stand:'ground',groundManualM:ctx.ground});
 // The eye height is the stand height itself. A second 1.5m must never be added.
 function observer(ctx,h){
  const obs=observerAt(placeAt(ctx,h),ctx.ground);
  if(!obs||Math.abs(obs.eyeM-h)>1e-9||Math.abs(obs.elevation-ctx.ground)>1e-9)throw Error('height-observer');
  return obs;
 }
 const viewOf=(obs,p)=>{
  const k=JSON.stringify([obs,p.target,p.body,p.partId,p.limb,p.matchMode??null,atmosphere.dataKey?.()??null]);let v=views.get(k);
  if(!v){v=Promise.resolve().then(async()=>{const prepared=viewFor?await viewFor(obs,p):null;if(prepared)return prepared;const o=shooting.searchOptions(p,isMountain);return o.broad&&o.disc||o.partId==='__whole'&&!isMountain(p.target)?align.prepareDailyView(obs,p.target,p.body,{partId:o.partId,eyeM:obs.eyeM}):null;}).catch(e=>{views.delete(k);throw e;});views.set(k,v);}
  return v;
 };
 const closeness=(ctx,e)=>ctx.family==='overlap'?(Number.isFinite(e.distanceToTarget)?e.distanceToTarget-(e.radius||0):Infinity):(Number.isFinite(e.gap)?Math.abs(e.gap)-Math.max(1/60,.2*(e.radius||0)):Infinity);
 const shapeOk=(ctx,e)=>!ctx.shape||e.spatialMatched!==false&&(!Number.isFinite(e.altitude)||ctx.o.disc||e.altitude>0)&&shooting.shapeContains(ctx.shape,ctx.place);
 // Same point path as Shooting.candidates: observerAt → viewFor → eventsFor → day window → matches.
 function real(ctx,h){
  const k=ctx.key+'|'+h.toFixed(1);let r=evals.get(k);if(r)return r;
  r=(async()=>{
   const obs=observer(ctx,h),view=await viewOf(obs,ctx.p);stats.realEvaluations++;ctx.heights.add(h);
   const events=shooting.eventsFor(ctx.p,obs,ctx.start,{align,isMountain,view}).filter(e=>e.at>=ctx.start&&e.at<ctx.start+DAY);
   const rows=events.filter(e=>shooting.matches(e,ctx.p,isMountain)&&shapeOk(ctx,e)).map(e=>({place:placeAt(ctx,h),record:ctx.entry.record,event:e,assumedObserver:obs}));
   return {rows,events,height:h};
  })().catch(e=>{evals.delete(k);throw e;});
  evals.set(k,r);return r;
 }
 async function verify(ctx,h,accept){
  stats.verifications++;
  const result=await shooting.candidates(ctx.plan,[{place:placeAt(ctx,h),record:ctx.entry.record}],{align,isMountain,observerAt,elevationAt,ensure,viewFor:viewOf,isCurrent:ctx.isCurrent});
  if(result.cancelled||!ctx.isCurrent())throw cancelled();
  return result.rows.filter(r=>accept(r)&&shapeOk(ctx,r.event)).map(r=>({...r,...(ctx.shape?{shapeType:ctx.shape.type}:{}),heightSearch:{min:ctx.range.min,max:ctx.range.max,height:h}}));
 }
 // Geometric (airless) body direction at the reference position. Refraction is bounded separately.
 function stateAt(ctx,t,h){
  const e=ctx.ground+h,k=ctx.p.body+'|'+t+'|'+ctx.place.latitude+'|'+ctx.place.longitude+'|'+e;let s=states.get(k);
  if(!s){stats.bodyStates++;const st=bodies.state(ctx.p.body,t,{latitude:ctx.place.latitude,longitude:ctx.place.longitude,elevation:e},{refraction:false});s={u:unit(st.azimuth,st.apparentAltitude),alt:st.apparentAltitude,r:st.angularRadius||0};states.set(k,s);}
  return s;
 }
 const geoUnit=p=>unit(p.longitude,p.latitude);
 async function regionOf(ctx,a,b){
  const k=ctx.geometryKey+'|'+a+'|'+b;let r=regions.get(k);if(r!==undefined)return r;
  stats.geometryBuilds++;r=(async()=>{
   const oa=observer(ctx,a),ob=observer(ctx,b),t=ctx.p.target;
   if(ctx.family==='gap'){
    const ths=[],azs=[];
    for(const o of [oa,ob]){
     const g=align.geometryFrom(o,t,{partId:ctx.o.partId,eyeM:o.eyeM});if(g){ths.push(g.angle);azs.push(g.azimuth);}if(t.rim&&typeof align.rimOutline==='function'){const rim=align.rimOutline({...o,elevation:o.elevation+o.eyeM},t);if(rim)azs.push(rim.azimuth+rim.min,rim.azimuth+rim.max);}
     const hg=(await viewOf(o,ctx.p))?.heightGeometry;if(hg)ths.push(hg.angle);
     if(t.rim){if(typeof align.rimPoints!=='function'||!terrain)return null;for(const q of align.rimPoints(t.rim))ths.push(astro.targetElevationAngle(terrain.distanceKm(o.latitude,o.longitude,q.latitude,q.longitude),o.elevation+o.eyeM,q.m,{k:atmosphere.targetK()}));}
    }
    return ths.length&&ths.every(Number.isFinite)&&azs.every(Number.isFinite)?{family:'gap',thMin:Math.min(...ths),thMax:Math.max(...ths),azimuth:azs[0],azHalf:Math.max(...azs.map(a=>Math.abs(azDiff(a,azs[0]))))}:null;
   }
   const ga=(await viewOf(oa,ctx.p))?.heightGeometry,gb=(await viewOf(ob,ctx.p))?.heightGeometry;
   if(!ga||!gb||Math.abs(azDiff(ga.azimuth,gb.azimuth))>1e-9||ga.ridge!==gb.ridge)return null;
   const facePairs=[],verts=[],centers=[ga.centerAlt,gb.centerAlt];
   if(ga.ridge){
    // Each ridge column is a maximum of terrain angles, all falling with eye height: it lies between the two ends.
    if(!mountainRidge)return null;
    const ra=await mountainRidge(oa,t),rb=await mountainRidge(ob,t),A=ra?.ridge,B=rb?.ridge;
    if(!Array.isArray(A)||!Array.isArray(B)||A.length!==B.length||A.length<2||A.some((p,i)=>Math.abs(azDiff(p[0],B[i][0]))>1e-9))return null;
    const tops=(t.parts||[]).map(x=>x.m).filter(Number.isFinite),proven=!!ra.cap&&!!rb.cap&&tops.length&&t.parts[0].m>Math.max(...tops)-summitCapM;
    const bottom=proven?Math.min(ra.cap.base,rb.cap.base):Math.min(0,ra.cap?.base??0,rb.cap?.base??0);
    const used=new Set();A.forEach((p,i)=>{if(!proven||p[1]>bottom){used.add(i);if(i)used.add(i-1);if(i<A.length-1)used.add(i+1);}});
    if(!used.size)return null;
    for(const i of used)verts.push(A[i],B[i],[A[i][0],bottom]);
    verts.push([ga.azimuth,bottom],[ga.azimuth,Math.max(...verts.map(v=>v[1]))]);
    if(!proven)centers.push(ga.angle/2,gb.angle/2,(bottom+ga.angle)/2,(bottom+gb.angle)/2);
   }else for(const [o,g] of [[oa,ga],[ob,gb]]){
    const hv=align.heightVertices(o,t,{partId:g.partId,eyeM:g.eyeM,...(g.heightM!=null?{heightM:g.heightM}:{})});
    if(!hv?.vertices?.length)return null;verts.push(...hv.vertices);if(hv.polygons)facePairs.push(hv.polygons);
   }
   if(!centers.every(Number.isFinite))return null;
   const cLo=Math.min(...centers),cHi=Math.max(...centers),cq=(cLo+cHi)/2,project=align.viewProjector(ga.azimuth,cq);
   let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
   for(const v of verts){const xy=project(v[0],v[1]);if(!xy||!xy.every(Number.isFinite))return null;minX=Math.min(minX,xy[0]);maxX=Math.max(maxX,xy[0]);minY=Math.min(minY,xy[1]);maxY=Math.max(maxY,xy[1]);}
   if(ga.ridge){
    // Cap cut vertices interpolate in az/alt, not world coordinates. Enclose that angular rectangle too.
    const rel=verts.map(v=>azDiff(v[0],ga.azimuth)),alts=verts.map(v=>v[1]);if(rel.some(x=>Math.abs(x)>=89))return null;
    const corners=[Math.min(...rel),Math.max(...rel)].flatMap(a=>[Math.min(...alts),Math.max(...alts)].map(h=>unit(ga.azimuth+a,h))),q=unit(ga.azimuth,cq),theta=Math.max(...corners.map(v=>angle(q,v)));if(theta>=85)return null;const radius=Math.tan(theta*RAD)*DEG;minX=Math.min(minX,-radius);maxX=Math.max(maxX,radius);minY=Math.min(minY,-radius);maxY=Math.max(maxY,radius);
   }
   const thetaB=Math.max(...[[minX,minY],[minX,maxY],[maxX,minY],[maxX,maxY]].map(([x,y])=>Math.atan(Math.hypot(x,y)*RAD)*DEG));
   let boxes=null;
   if(facePairs.length===2&&facePairs[0].length===facePairs[1].length){
    const step=(maxY-minY)/32||1,bins=Array.from({length:32},()=>null);
    for(let i=0;i<facePairs[0].length;i++){
     const ps=[...facePairs[0][i],...facePairs[1][i]].map(v=>project(v[0],v[1]));if(ps.some(x=>!x))return null;
     const x0=Math.min(...ps.map(x=>x[0])),x1=Math.max(...ps.map(x=>x[0])),y0=Math.min(...ps.map(x=>x[1])),y1=Math.max(...ps.map(x=>x[1]));
     const lo=Math.max(0,Math.min(31,Math.floor((y0-minY)/step))),hi=Math.max(0,Math.min(31,Math.floor((y1-minY)/step)));
     for(let k=lo;k<=hi;k++){const b=bins[k];bins[k]={minX:Math.min(b?.minX??Infinity,x0),maxX:Math.max(b?.maxX??-Infinity,x1),minY:minY+k*step,maxY:minY+(k+1)*step};}
    }
    boxes=bins.filter(Boolean);
   }
   return {boxes,family:'overlap',qc:unit(ga.azimuth,cq),project,delta:(cHi-cLo)/2,bbox:{minX,maxX,minY,maxY},thetaB};
  })().catch(e=>{regions.delete(k);throw e;});
  regions.set(k,r);return r;
 }
 function groupOf(members){
  const ref=members[0],grounds=members.map(m=>m.ground);
  return {ref,members,observers:members.map(m=>({latitude:m.place.latitude,longitude:m.place.longitude})),groundMin:Math.min(...grounds),groundMax:Math.max(...grounds),
   // Local frames of two places differ by at most |Δlat|+|Δlon|; the Moon's parallax adds distance/356000km.
   spread:members.map(m=>Math.abs(m.place.latitude-ref.place.latitude)+Math.abs(m.place.longitude-ref.place.longitude)+angle(geoUnit(ref.place),geoUnit(m.place))*RAD*EARTH_KM/MOON_KM*DEG)};
 }
 // Can any member, at any lattice height in [a,b] and any instant in [t1,t2], meet the normal match condition?
 function leafTest(group,list,a,b,t1,t2){
  stats.leafTests++;
  const ref=group.ref,s=[stateAt(ref,t1,a),stateAt(ref,t2,a),stateAt(ref,t1,b),stateAt(ref,t2,b)],C=s[0].u;
  const rad=Math.max(...s.map(x=>angle(C,x.u))),chordA=angle(s[0].u,s[1].u),chordB=angle(s[2].u,s[3].u),chord=Math.max(chordA,chordB);
  // A short diurnal arc stays within half its chord of the chord; the Moon's parallax is height/356000km.
  const base=rad+chord/2+(group.groundMax-group.groundMin+(b-a))/(MOON_KM*1000)*DEG;
  const r=Math.max(...s.map(x=>x.r))*(1+1e-6),eMax=Math.max(...group.spread),xC=altOf(C),xLo=xC-base-eMax-r,xHi=xC+base+eMax+r;
  const sides=new Set();for(const [p,q,c] of [[s[0],s[1],chordA],[s[2],s[3],chordB]]){const d=q.alt-p.alt;if(d>c/2)sides.add('rise');else if(d<-c/2)sides.add('set');else{sides.add('rise');sides.add('set');}}
  const all={members:list.map((_,i)=>i),sides};
  if(Math.max(Math.abs(xLo),Math.abs(xHi))>=88)return all;
  const azHalf=Math.min(180,(base+eMax+r)/Math.cos(Math.max(Math.abs(xLo),Math.abs(xHi))*RAD));
  const rb=atmosphere.refractionBounds({xLo,xHi,msLo:t1,msHi:t2,h0Lo:group.groundMin+a,h0Hi:group.groundMax+b,observers:group.observers,azMid:azOf(C),azHalf});
  if(!rb)return all;
  // Raising every altitude by c changes lengths by at most max(1,cos c − tan(alt)·sin c) over the cap.
  const c=(rb.lo+rb.hi)/2,f=Math.max(1,Math.cos(c*RAD)-Math.tan(xLo*RAD)*Math.sin(c*RAD),Math.cos(c*RAD)-Math.tan(xHi*RAD)*Math.sin(c*RAD));
  const Capp=unit(azOf(C),xC+c),span=2*r+(rb.hi-rb.lo),members=[];
  for(let i=0;i<list.length;i++){
   const reg=list[i];if(!reg){members.push(i);continue;}
   const radApp=(base+group.spread[i]+r)*f+(rb.hi-rb.lo)/2+1e-9;
   if(reg.family==='gap'){
    if(Math.abs(azDiff(azOf(C),reg.azimuth))>reg.azHalf+azHalf+1e-6)continue;
    const lo=altOf(Capp)-radApp,hi=altOf(Capp)+radApp,tol=Math.max(1/60,.2*r)+1e-12;
    if(hi-reg.thMin<-tol||lo-reg.thMax>tol)continue;members.push(i);continue;
   }
   // Horizontal extent of the normal projected ellipse is ALWAYS tan(radius),
   // even when its vertical limb ratio is large near the projector horizon.
   // Test the homogeneous x coordinate before division so a horizon crossing
   // cannot turn an unrelated azimuth into an unbounded false possibility.
   const az=azOf(reg.qc)*RAD,right=[Math.cos(az),-Math.sin(az),0],dot=(a,b)=>a.reduce((n,x,k)=>n+x*b[k],0),eps=2*Math.sin((radApp+reg.delta)*RAD/2),den=dot(Capp,reg.qc),dHi=Math.min(1,den+eps),nx=dot(Capp,right),targetPad=reg.delta/Math.cos((reg.thetaB+reg.delta)*RAD)**2;
   if(dHi<=0)continue;
   const xlo=(reg.bbox.minX-targetPad-Math.tan(r*RAD)*DEG)*RAD,xhi=(reg.bbox.maxX+targetPad+Math.tan(r*RAD)*DEG)*RAD,products=[0,xlo*dHi,xhi*dHi];
   if(nx+eps<Math.min(...products)-1e-12||nx-eps>Math.max(...products)+1e-12)continue;
   const dLo=den-eps;
   if(dLo>0){
    const q=reg.qc,up=[-Math.sin(az)*q[2],-Math.cos(az)*q[2],Math.hypot(q[0],q[1])],ny=dot(Capp,up),ys=[(ny-eps)/dLo,(ny-eps)/dHi,(ny+eps)/dLo,(ny+eps)/dHi].map(x=>x*DEG),floor=.1*Math.tan(r*RAD)*DEG;
    if(Math.max(...ys)+floor<reg.bbox.minY-targetPad||Math.min(...ys)-floor>reg.bbox.maxY+targetPad)continue;
    if(reg.boxes&&!reg.boxes.some(box=>{
     if(Math.max(...ys)+floor<box.minY-targetPad||Math.min(...ys)-floor>box.maxY+targetPad)return false;
     const xl=(box.minX-targetPad-Math.tan(r*RAD)*DEG)*RAD,xh=(box.maxX+targetPad+Math.tan(r*RAD)*DEG)*RAD,prods=[xl*dLo,xl*dHi,xh*dLo,xh*dHi];return nx+eps>=Math.min(...prods)-1e-12&&nx-eps<=Math.max(...prods)+1e-12;
    }))continue;
   }
   const dC=angle(Capp,reg.qc);
   if(dC-radApp-reg.delta>=90)continue;           // beyond every projector hemisphere: distance is Infinity
   let thetaP=dC+radApp+reg.delta;if(thetaP>=89.9){members.push(i);continue;}
   // Plane-p length ≥ angle and ≤ angle·sec²θ. Limb midpoint (x of centre, y of limbs) may leave the limb arc by the limb span.
   const pad=span/Math.cos(thetaP*RAD)**2;
   const D=Math.max(Math.tan(r*RAD)*DEG,span/(2*Math.cos(thetaP*RAD)**2))+pad;
   let lb=dC-reg.thetaB;const xy=reg.project(azOf(Capp),altOf(Capp));
   if(xy){const {minX,maxX,minY,maxY}=reg.bbox,pd=Math.hypot(Math.max(minX-xy[0],0,xy[0]-maxX),Math.max(minY-xy[1],0,xy[1]-maxY)),ts=Math.max(Math.atan(Math.hypot(xy[0],xy[1])*RAD)*DEG,reg.thetaB);if(ts<89)lb=Math.max(lb,pd*Math.cos(ts*RAD)**2);}
   if(lb-radApp>D*(1+1e-9)+1e-12)continue;members.push(i);
  }
  return {members,sides};
 }
 async function leaves(group,a,b,from,to,ctl){
  stats.certificates++;
  const list=await Promise.all(group.members.map(m=>regionOf(m,a,b)));if(!ctl.isCurrent())throw cancelled();
  const out=[],stack=[];for(let t=from;t<to;t+=LIM.coarseMs)stack.push([t,Math.min(to,t+LIM.coarseMs)]);
  let n=0;
  while(stack.length){
   const [t1,t2]=stack.shift();
   if(++n%24===0){await yieldTask();if(!ctl.isCurrent())throw cancelled();if(ctl.deadline&&clock()>ctl.deadline)throw Error(ctl.kind==='point'?'height-limit':'shape-limit');}
   const res=leafTest(group,list,a,b,t1,t2);if(!res.members.length)continue;
   if(t2-t1<=LIM.leafMs){out.push({t1,t2,members:res.members,sides:res.sides});continue;}
   const m=Math.round((t1+t2)/2);stack.unshift([t1,m],[m,t2]);
  }
  return out;
 }
 function windowsOf(list){
  const out=[];for(const l of [...list].sort((x,y)=>x.t1-y.t1)){const w=out[out.length-1];if(w&&l.t1-w.to<=LIM.mergeMs){w.to=Math.max(w.to,l.t2);w.leaves.push(l);}else out.push({from:l.t1,to:l.t2,leaves:[l]});}
  return out;
 }
 // Whole-object fit uses the normal view's visual vertical centre; named parts
 // use the existing apparent limb gap. Feasibility is still the original match.
 async function fitResidual(ctx,result,accept){
  const matched=result.rows.filter(accept).map(r=>r.event),events=matched.length?matched:result.events.filter(e=>accept({event:e}));
  let center=null;if(ctx.family==='overlap'){const obs=observer(ctx,result.height);center=isMountain(ctx.p.target)?align.geometryFrom(obs,ctx.p.target,{partId:ctx.o.partId,eyeM:obs.eyeM})?.angle:(await viewOf(obs,ctx.p))?.heightGeometry?.centerAlt;}
  const values=events.map(e=>ctx.family==='overlap'?Number.isFinite(center)&&Number.isFinite(e.altitude)?e.altitude-center:null:Number.isFinite(e.gap)?e.gap:null).filter(Number.isFinite);
  return values.length?values.reduce((a,b)=>Math.abs(a)<=Math.abs(b)?a:b):null;
 }
 // A range returns verified representative heights for distinct possible time windows. Fixed mode is unchanged.
 async function solveMember(ctx,dayLeaves,issues,ctl){
  const rows=[],windows=windowsOf(dayLeaves),single=groupOf([ctx]);let checked=0;
  for(const w of windows){
   const accept=r=>r.event.at>=w.from&&r.event.at<=w.to;
   const evaluate=async h=>{await yieldTask();if(!ctl.isCurrent())throw cancelled();const x=await real(ctx,h),inside=x.events.filter(e=>e.at>=w.from&&e.at<=w.to);return {rows:x.rows.filter(accept),score:Math.min(Infinity,...inside.map(e=>closeness(ctx,e))),height:h,residual:await fitResidual(ctx,x,accept)};};
   const mayOverlap=async(lo,hi)=>(await leaves(single,lo,hi,w.from,w.to,ctl)).length?null:false;
   try{
    const res=await scanHeights({min:ctx.range.min,max:ctx.range.max,evaluate,mayOverlap,isCurrent:ctl.isCurrent,limit:LIM.heights});checked+=res.checked||0;
    if(res.rows?.length){
     let fit=deps.preferHeights?await deps.preferHeights({min:ctx.range.min,max:ctx.range.max,seed:res,evaluate,isCurrent:ctl.isCurrent,clock,deadline:clock()+6000}):res;
     let v=await verify(ctx,fit.height,accept);if(!v.length&&fit.height!==res.height){fit=res;v=await verify(ctx,res.height,accept);}
     if(v.length)rows.push(...v.map(row=>({...row,heightSearch:{...row.heightSearch,fit:fit.fit||'candidate',residualDeg:fit.residual??null,preferenceChecked:fit.fitChecked??0,preferenceIncomplete:!!fit.fitIncomplete}})));else issues.push({id:ctx.id,reason:'height-verify',at:w.from});
    }
    else if(res.failed)issues.push({id:ctx.id,reason:'height-limit',from:w.from,to:w.to});
   }catch(error){if(!['height-limit','shape-limit'].includes(error.message))throw error;issues.push({id:ctx.id,reason:error.message==='shape-limit'?'limit':'height-limit'});break;}
  }
  for(const h of ctx.heights){const x=await real(ctx,h);for(const r of x.rows)if(!windows.some(w=>r.event.at>=w.from&&r.event.at<=w.to)&&!rows.some(y=>y.event.side===r.event.side&&Math.abs(y.event.at-r.event.at)<3*3600000)){issues.push({id:ctx.id,reason:'height-certificate',at:r.event.at,height:h});const v=await verify(ctx,h,y=>Math.abs(y.event.at-r.event.at)<1000);rows.push(...v);}}
  return {rows,checked};
 }
 function makeCtx(base,entry,place,ground,shape){
  const p=base.p;
  // Prepared target geometry is independent of the day; event evaluations are not.
  // This memo remains private to one owner/revision/atmosphere job.
  const geometryKey=JSON.stringify([entry.place.id,place.latitude,place.longitude,ground,p.body,p.target,p.partId,p.limb,p.matchMode??null,atmosphere.dataKey?.()??null]);
  return {...base,entry,place,ground,shape,id:entry.place.id,heights:new Set(),geometryKey,key:geometryKey+'|'+base.start};
 }
 async function solvePoint(base,entry,range,ctl){
  const f=entry.place,ground=Number.isFinite(f.groundManualM)?f.groundManualM:Number.isFinite(f.elevation)?f.elevation:await elevationAt(f.latitude,f.longitude);
  if(!ctl.isCurrent())throw cancelled();
  if(!Number.isFinite(ground))return {rows:[],checked:0,issues:[{id:f.id,reason:'elevation'}]};
  const ctx=makeCtx({...base,range},entry,{...f},ground,null),issues=[];ctl={...ctl,kind:'point',deadline:clock()+LIM.pointMs};await real(ctx,range.min);await real(ctx,range.max);
  const ls=await leaves(groupOf([ctx]),range.min,range.max,base.start,base.start+DAY,ctl);
  const r=await solveMember(ctx,ls,issues,ctl);return {rows:r.rows,checked:r.checked,issues};
 }
 // Preserve the normal spatial solver, including crossings BETWEEN horizontal samples.
 // No negative certificate is inferred from sampled positions. An unsearched height band stays incomplete.
 async function solveShape(base,entry,range,ctl){
  if(!shooting.cleanShape(entry.place.shape))throw Error('shape-invalid');
  const deadline=clock()+LIM.shapeMs,issues=[],memo=new Map();let checked=0,bestRows=[];
  const evaluate=async height=>{
   if(memo.has(height))return memo.get(height);if(clock()>deadline)throw Error('shape-limit');
   const place={...entry.place,eyeHeightAGL:height,standAglM:height,stand:'ground'};
   const result=await shooting.candidates(base.plan,[{place,record:entry.record}],{align,isMountain,observerAt,elevationAt,ensure,viewFor:viewOf,isCurrent:ctl.isCurrent});
   if(result.cancelled||!ctl.isCurrent())throw cancelled();
   stats.realEvaluations++;checked+=result.checked||0;
   if(result.failed)issues.push(...(result.issues||[{id:entry.place.id,reason:'calculation'}]));
   const rows=result.rows.map(row=>({...row,heightSearch:{min:range.min,max:range.max,height}})),values=[];
   for(const row of rows){
    const e=row.event,g=row.place.groundManualM??row.place.elevation,obs=row.assumedObserver||observerAt(row.place,g),view=await viewOf(obs,base.p),center=isMountain(base.p.target)?align.geometryFrom(obs,base.p.target,{partId:base.o.partId,eyeM:obs.eyeM})?.angle:view?.heightGeometry?.centerAlt;
    const residual=base.family==='overlap'?Number.isFinite(center)&&Number.isFinite(e.altitude)?e.altitude-center:null:Number.isFinite(e.gap)?e.gap:null;
    row.heightSearch.residualDeg=residual;if(Number.isFinite(residual))values.push(residual);
   }
   const value={rows,height,score:Infinity,residual:values.length?values.reduce((a,b)=>Math.abs(a)<=Math.abs(b)?a:b):null};memo.set(height,value);return value;
  };
  try{
   let result=await scanHeights({min:range.min,max:range.max,evaluate,isCurrent:ctl.isCurrent,limit:LIM.heights});bestRows=result.rows;
   if(result.rows?.length&&deps.preferHeights){result=await deps.preferHeights({min:range.min,max:range.max,seed:result,evaluate,isCurrent:ctl.isCurrent,clock,deadline});bestRows=result.rows;}
   if(result.failed)issues.push({id:entry.place.id,reason:'height-limit'});
   return {rows:bestRows.map(row=>({...row,heightSearch:{...row.heightSearch,fit:Number.isFinite(row.heightSearch.residualDeg)&&Math.abs(row.heightSearch.residualDeg)<=.01?'centered':result.fit==='range-edge'?'range-edge':'candidate',preferenceChecked:result.fitChecked??0,preferenceIncomplete:!!result.fitIncomplete}})),checked,issues};
  }catch(e){if(e.message!=='shape-limit')throw e;return {rows:bestRows,checked,issues:[...issues,{id:entry.place.id,reason:'limit'}]};}
 }
 async function candidates(plan,entries,{isCurrent=()=>true,onProgress=()=>{}}={}){
  const fixed=[],ranged=[],invalid=[];
  for(const e of entries){const r=rangeOf(e.place);if(r)ranged.push({entry:e,range:r});else if(e.place.eyeHeightRangeAGL!=null)invalid.push(e);else fixed.push(e);}
  const normal={align,isMountain,observerAt,elevationAt,ensure,viewFor,isCurrent,onProgress};
  if(!ranged.length&&!invalid.length)return shooting.candidates(plan,entries,normal);
  if(ranged.length&&deps.ensureModels){await deps.ensureModels();if(!isCurrent())return {rows:[],failed:0,cancelled:true};}
  const off={rows:[],failed:0,cancelled:true};
  const out=fixed.length?await shooting.candidates(plan,fixed,normal):{rows:[],failed:0};
  if(out.cancelled||!isCurrent())return off;
  const p=shooting.conditions(plan);if(!p)return out;
  const rows=[...out.rows],issues=[...(out.issues||[]),...invalid.map(e=>({id:e.place.id,reason:'height-invalid'}))];let failed=(out.failed||0)+invalid.length,checked=out.checked||0,shaped=false;
  if(!ready()){for(const {entry}of ranged){failed++;issues.push({id:entry.place.id,reason:'height-geometry'});}return {rows,failed,issues,...(checked?{checked}:{})};}
  await ensure(p.body);if(!isCurrent())return off;
  const o=shooting.searchOptions(p,isMountain),base={plan,p,o,start:shooting.day(p.at),family:o.broad||o.partId==='__whole'?'overlap':'gap',isCurrent},ctl={isCurrent};
  for(const {entry,range} of ranged){
   await yieldTask();if(!isCurrent())return off;
   try{
    const r=entry.place.shape?(shaped=true,await solveShape(base,entry,range,ctl)):await solvePoint(base,entry,range,ctl);
    if(!isCurrent())return off;
    rows.push(...r.rows);checked+=r.checked||0;if(r.issues.length){failed++;issues.push(...r.issues);}
    onProgress({checked});
   }catch(e){
    if(e.message==='height-cancelled'||!isCurrent())return off;
    failed++;issues.push({id:entry.place.id,reason:e.message==='shape-limit'?'limit':e.message==='shape-invalid'?'invalid':e.message==='height-observer'?'height-observer':e.message==='height-limit'?'height-limit':'calculation'});
   }
  }
  if(!isCurrent())return off;
  rows.sort((a,b)=>a.event.at-b.event.at||a.place.name.localeCompare(b.place.name));
  return {rows,failed,...(issues.length?{issues}:{}),...(checked?{checked}:{}),...(shaped||out.stepM?{stepM:out.stepM||25}:{})};
 }
 return {candidates,ready,stats};
}
