/* Shooting conditions shared by map candidates and framing. No place discovery. */
(function(global){
'use strict';
const DAY=86400000;
const day=at=>Math.floor((at+32400000)/DAY)*DAY-32400000;
const point=p=>p&&Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180;
// A registered point uses its recorded ground height until the user resets it.
const savedObserver=p=>point(p)?{...p,groundManualM:Number.isFinite(p.groundManualM)?p.groundManualM:Number.isFinite(p.elevation)?p.elevation:null}:null;
function conditions(p){
 if(!p||!point(p.target)||!Number.isFinite(p.at)||typeof p.body!=='string')return null;
 return {observer:point(p.observer)?{...p.observer}:null,target:{...p.target},body:p.body,partId:p.partId??null,limb:p.partId==='__whole'?'center':p.limb||'center',at:p.at,...(p.matchMode?{matchMode:p.matchMode==='overlap'?'overlap':'limb'}:{})};
}
function queryKey(p,records,owner,atmosphere){return JSON.stringify([owner,p?.body,p?.target,p?.partId??null,p?.limb||'center',day(p?.at),records.map(x=>[x.place,x.record]),atmosphere,p?.matchMode||'limb']);}
function searchOptions(p,isMountain){
 const broad=p.matchMode==='overlap',disc=p.body==='sun'||p.body==='moon';
 return {partId:broad?(isMountain(p.target)?null:'__whole'):p.partId,limb:broad?'center':p.limb,broad,disc};
}
function eventsFor(p,obs,start,{align,isMountain}){
 const o=searchOptions(p,isMountain),whole=o.partId==='__whole';
 const rows=(o.broad&&o.disc||whole&&!isMountain(p.target))?align.dailyView(obs,p.target,p.body,start,{partId:o.partId,eyeM:obs.eyeM}):align.upcoming(obs,p.target,p.body,{from:start,days:1,limit:Infinity,groupDays:false,partId:o.partId,limb:o.limb,eyeM:obs.eyeM,stepMs:3600000});
 return o.broad?rows.map(e=>({...e,matchMode:'overlap',partId:o.partId})):rows;
}
function matches(e,p,isMountain){
 const o=searchOptions(p,isMountain);
 return o.broad&&o.disc||o.partId==='__whole'?!!e.intersects:Number.isFinite(e.gap)&&Math.abs(e.gap)<=Math.max(1/60,.2*(e.radius||0));
}
// Registered paths/areas use ordered vertices, never the favorite's anchor.
const SHAPE_STEP_M=25,SHAPE_LIMIT=12000;
const interpolate=(a,b,t)=>({latitude:a.latitude+(b.latitude-a.latitude)*t,longitude:a.longitude+(b.longitude-a.longitude)*t});
const meters=(a,b)=>Math.hypot((b.latitude-a.latitude)*111195,(b.longitude-a.longitude)*111195*Math.cos((a.latitude+b.latitude)*Math.PI/360));
function cleanShape(value){
 if(!value||!['line','area'].includes(value.type)||!Array.isArray(value.vertices)||value.vertices.length>200||value.vertices.some(p=>!point(p)))return null;
 const vertices=value.vertices.map(p=>({latitude:p.latitude,longitude:p.longitude}));
 if(vertices.length<(value.type==='line'?2:3)||vertices.some((p,i)=>i&&meters(p,vertices[i-1])<.1))return null;
 const origin=vertices[0];if(vertices.some(p=>meters(origin,p)>50000))return null;
 const cross=(a,b,c)=>(b.longitude-a.longitude)*(c.latitude-a.latitude)-(b.latitude-a.latitude)*(c.longitude-a.longitude);
 if(value.type==='area'){
  let area=0;for(let i=0;i<vertices.length;i++){const a=vertices[i],b=vertices[(i+1)%vertices.length];area+=(a.longitude-origin.longitude)*(b.latitude-origin.latitude)-(b.longitude-origin.longitude)*(a.latitude-origin.latitude);}
  if(Math.abs(area)<1e-10)return null;
  const on=(a,b,p)=>Math.abs(cross(a,b,p))<1e-13&&p.latitude>=Math.min(a.latitude,b.latitude)&&p.latitude<=Math.max(a.latitude,b.latitude)&&p.longitude>=Math.min(a.longitude,b.longitude)&&p.longitude<=Math.max(a.longitude,b.longitude);
  for(let i=0;i<vertices.length;i++)for(let j=i+1;j<vertices.length;j++){
   if(j===i+1||i===0&&j===vertices.length-1)continue;
   const a=vertices[i],b=vertices[(i+1)%vertices.length],c=vertices[j],d=vertices[(j+1)%vertices.length];
   if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))return null;
  }
 }
 return {type:value.type,vertices};
}
function onSegment(p,a,b,tolerance=.05){
 const k=Math.cos(p.latitude*Math.PI/180),x=(b.longitude-a.longitude)*k,y=b.latitude-a.latitude;
 const t=Math.max(0,Math.min(1,((p.longitude-a.longitude)*k*x+(p.latitude-a.latitude)*y)/(x*x+y*y||1)));
 return meters(p,interpolate(a,b,t))<=tolerance;
}
function shapeContains(shape,p){
 if(!point(p)||!shape)return false;const v=shape.vertices;
 for(let i=1;i<v.length;i++)if(onSegment(p,v[i-1],v[i]))return true;
 if(shape.type==='line')return false;
 if(onSegment(p,v[v.length-1],v[0]))return true;
 let inside=false;for(let i=0,j=v.length-1;i<v.length;j=i++)if((v[i].latitude>p.latitude)!==(v[j].latitude>p.latitude)&&p.longitude<(v[j].longitude-v[i].longitude)*(p.latitude-v[i].latitude)/(v[j].latitude-v[i].latitude)+v[i].longitude)inside=!inside;
 return inside;
}
function shapePaths(value){
 const s=cleanShape(value);if(!s)throw Error('shape-invalid');const v=s.vertices,paths=[];let total=0;
 const add=(a,b)=>{const n=Math.max(1,Math.ceil(meters(a,b)/SHAPE_STEP_M));total+=n+1;if(total>SHAPE_LIMIT)throw Error('shape-limit');paths.push(Array.from({length:n+1},(_,i)=>interpolate(a,b,i/n)));};
 for(let i=1;i<v.length;i++)add(v[i-1],v[i]);
 if(s.type==='area'){
  add(v[v.length-1],v[0]);
  const low=Math.min(...v.map(p=>p.latitude)),high=Math.max(...v.map(p=>p.latitude)),n=Math.max(1,Math.ceil((high-low)*111195/SHAPE_STEP_M));
  if(n>SHAPE_LIMIT)throw Error('shape-limit');
  for(let row=1;row<n;row++){
   const latitude=low+(high-low)*row/n,x=[];
   for(let i=0,j=v.length-1;i<v.length;j=i++)if((v[i].latitude>latitude)!==(v[j].latitude>latitude))x.push(v[i].longitude+(v[j].longitude-v[i].longitude)*(latitude-v[i].latitude)/(v[j].latitude-v[i].latitude));
   x.sort((a,b)=>a-b);for(let i=0;i+1<x.length;i+=2)add({latitude,longitude:x[i]},{latitude,longitude:x[i+1]});
  }
 }
 return paths;
}
async function shapeCandidates(p,entry,deps){
 const {align,isMountain,observerAt,elevationAt,isCurrent=()=>true,onProgress=()=>{}}=deps,s=cleanShape(entry.place.shape);
 if(!s)throw Error('shape-invalid');const paths=shapePaths(s),start=day(p.at),memo=new Map(),rows=[];let missing=0,steps=0;const began=Date.now();
 const check=()=>{if(!isCurrent())throw Error('shape-cancelled');if(Date.now()-began>45000)throw Error('shape-limit');};
 const evaluate=async position=>{
  check();const key=position.latitude.toFixed(9)+','+position.longitude.toFixed(9);if(memo.has(key))return memo.get(key);
  if(++steps%8===0){onProgress({checked:steps});await new Promise(r=>setTimeout(r,0));check();}
  // Every candidate has its own DEM. Anchor elevation/manual ground never leaks along a path.
  const ground=await elevationAt(position.latitude,position.longitude);check();
  if(!Number.isFinite(ground)){missing++;memo.set(key,null);return null;}
  const f={...entry.place,...position,elevation:ground,groundManualM:ground,sourcePlaceId:entry.place.id};delete f.shape;
  const obs=observerAt(f,ground),o=searchOptions(p,isMountain);
  const probes=align.dailyView?align.dailyView(obs,p.target,p.body,start,{partId:o.partId,eyeM:obs.eyeM}).map(e=>{const exact=align.alignmentAt?.(obs,p.target,p.body,e.at,{partId:o.partId,limb:o.limb,eyeM:obs.eyeM});return {...e,gap:exact?.gap??e.gap,...(!o.disc&&exact?{spatialMatched:exact.matched}:{})};}):eventsFor(p,obs,start,{align,isMountain});
  const events=(!o.disc||o.broad)&&align.dailyView?probes:eventsFor(p,obs,start,{align,isMountain});
  if(o.broad)for(const e of events){e.matchMode='overlap';e.partId=o.partId;}
  const result={place:f,events,probes};memo.set(key,result);
  for(const e of events)if(e.at>=start&&e.at<start+DAY&&e.spatialMatched!==false&&(!Number.isFinite(e.altitude)||o.disc||e.altitude>0)&&matches(e,p,isMountain)&&(p.body!=='moon'||e.sunAltitude<0)&&shapeContains(s,f)){
   // Keep distinct positions, but avoid thousands of indistinguishable pins.
   if(!rows.some(r=>r.event.side===e.side&&meters(r.place,f)<40&&Math.abs(r.event.at-e.at)<120000))rows.push({place:f,record:entry.record,event:e,shapeType:s.type});
  }
  return result;
 };
 for(const path of paths){let previous=null;
  for(const position of path){check();const current=await evaluate(position);
   if(previous&&current)for(const a of previous.probes){
    const b=current.probes.find(e=>e.side===a.side&&Math.abs(e.at-a.at)<3*3600000);
    if(!b||!Number.isFinite(a.gap)||!Number.isFinite(b.gap)||a.gap*b.gap>=0)continue;
    // Solve a crossing between samples, including very narrow stellar alignments.
    let left=previous,right=current,le=a;
    for(let k=0;k<20&&meters(left.place,right.place)>.05;k++){
     const mid=await evaluate(interpolate(left.place,right.place,.5));if(!mid)break;
     const me=mid.probes.find(e=>e.side===a.side&&Math.abs(e.at-a.at)<3*3600000);if(!me||!Number.isFinite(me.gap))break;
     if(le.gap*me.gap<=0)right=mid;else{left=mid;le=me;}
    }
   }
   previous=current;
  }
 }
 check();return {rows,missing,checked:memo.size,stepM:SHAPE_STEP_M};
}

async function candidates(plan,points,{align,isMountain,observerAt,elevationAt,ensure,isCurrent=()=>true,onProgress=()=>{}}={}){
 const p=conditions(plan);if(!p)return {rows:[],failed:0};
 const issues=[];let checked=0;
 await ensure(p.body);const start=day(p.at),rows=[];let failed=0;
 for(const entry of points){
  await new Promise(resolve=>setTimeout(resolve,0));if(!isCurrent())return {rows:[],failed:0,cancelled:true};
  try{
   const f=entry.place;
   if(f.shape){const result=await shapeCandidates(p,entry,{align,isMountain,observerAt,elevationAt,isCurrent,onProgress});rows.push(...result.rows);checked+=result.checked;if(result.missing){failed++;issues.push({id:f.id,reason:'elevation',count:result.missing});}continue;}
   const ground=Number.isFinite(f.groundManualM)?f.groundManualM:Number.isFinite(f.elevation)?f.elevation:await elevationAt(f.latitude,f.longitude);
   if(!Number.isFinite(ground))throw Error('missing elevation');
   const obs=observerAt(f,ground),events=eventsFor(p,obs,start,{align,isMountain});
   for(const e of events){
    if(e.at<start||e.at>=start+DAY||!matches(e,p,isMountain)||(p.body==='moon'&&!(e.sunAltitude<0)))continue;
    rows.push({place:f,record:entry.record,event:e});
   }
  }catch(e){if(!isCurrent()||e.message==='shape-cancelled')return {rows:[],failed:0,cancelled:true};failed++;issues.push({id:entry.place.id,reason:e.message==='shape-limit'?'limit':e.message==='shape-invalid'?'invalid':'calculation'});}
 }
 rows.sort((a,b)=>a.event.at-b.event.at||a.place.name.localeCompare(b.place.name));
 return {rows,failed,...(issues.length?{issues}:{}),...(checked?{checked,stepM:SHAPE_STEP_M}:{})};
}
function hapticGate({vibrate=()=>{},clock=Date.now}={}){
 let previous=false,last=-Infinity,identity='';
 return (matched,key)=>{if(key!==identity){identity=key;previous=false;}const entered=matched&&!previous;previous=!!matched;if(entered&&clock()-last>800){last=clock();try{vibrate(12);}catch{}}return entered;};
}
global.SoramiShooting={day,point,savedObserver,conditions,queryKey,searchOptions,eventsFor,matches,candidates,hapticGate,cleanShape,shapeContains,shapePaths,shapeCandidates,meters,interpolate};
if(typeof module!=='undefined'&&module.exports)module.exports=global.SoramiShooting;
})(globalThis);
