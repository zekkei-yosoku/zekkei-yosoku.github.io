/* Shooting conditions shared by map candidates and framing. No place discovery. */
(function(global){
'use strict';
const DAY=86400000;
const day=at=>Math.floor((at+32400000)/DAY)*DAY-32400000;
// Trial map/search share one light condition. Point sources require civil twilight or darker;
// use the geometric solar centre at the actual observer, never an apparent-altitude event field.
function nightAllowed(body,at,observer,bodies,angularMargin=0){
 if(body==='sun'||body==='moon')return true;
 if(!bodies?.definition?.(body)||!Number.isFinite(at)||!point(observer))return false;
 // angularMargin is only for conservative search seeds; final events omit it.
 try{const sun=bodies.state('sun',at,observer,{refraction:false}),alt=sun.geometricAltitude??sun.altitude;return Number.isFinite(alt)&&alt<=-6+Math.max(0,Number.isFinite(angularMargin)?angularMargin:0);}catch{return false;}
}

const point=p=>p&&Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180;
// A registered point uses its recorded ground height until the user resets it.
const savedObserver=p=>point(p)?{...p,groundManualM:Number.isFinite(p.groundManualM)?p.groundManualM:Number.isFinite(p.elevation)?p.elevation:null}:null;
// A solved candidate's actual observer wins over its original place anchor.
function candidatePlace(row){
 const p=row?.place,o=row?.assumedObserver;if(!point(o))return p;
 return {...p,latitude:o.latitude,longitude:o.longitude,
  ...(Number.isFinite(o.elevation)?{elevation:o.elevation,groundManualM:o.elevation}:{}),
  ...(Number.isFinite(o.eyeM)&&o.eyeM>=0&&o.eyeM<=700?{standAglM:o.eyeM,eyeHeightAGL:o.eyeM}:{})};
}
function observerMoveKey(s){return JSON.stringify([s?.body,s?.target,s?.partId??null,s?.limb||'center',s?.matchMode||'limb',s?.observer]);}
function movedPlace(from,to,ground,eyeM){
 if(!point(from)||!point(to)||!Number.isFinite(ground)||ground< -500||ground>9000||!Number.isFinite(eyeM)||eyeM<0||eyeM>700)return null;
 const p={...from,...to,name:'微調整した撮影位置',subtitle:to.latitude.toFixed(6)+', '+to.longitude.toFixed(6),elevation:ground,groundManualM:ground,standAglM:eyeM,eyeHeightAGL:eyeM};
 for(const key of ['id','sourcePlaceId','shape','decks','stand','observationElevationM'])delete p[key];return p;
}
function conditions(p){
 if(!p||!point(p.target)||!Number.isFinite(p.at)||typeof p.body!=='string')return null;
 return {observer:point(p.observer)?{...p.observer}:null,target:{...p.target},body:p.body,partId:p.partId??null,limb:p.partId==='__whole'?'center':p.limb||'center',at:p.at,...(p.matchMode?{matchMode:p.matchMode==='overlap'?'overlap':'limb'}:{})};
}
function queryKey(p,records,owner,atmosphere){return JSON.stringify([owner,p?.body,p?.target,p?.partId??null,p?.limb||'center',day(p?.at),records.map(x=>[x.place,x.record]),atmosphere,p?.matchMode||'limb']);}
function searchOptions(p,isMountain){
 const broad=p.matchMode==='overlap',disc=p.body==='sun'||p.body==='moon';
 const partId=p.partId&&p.partId!=='__whole'&&p.target?.parts?.some(part=>part.id===p.partId)?p.partId:broad?(isMountain(p.target)?null:'__whole'):p.partId;
 const named=!!partId&&partId!=='__whole',overlap=broad&&(disc||!named);
 return {partId,limb:broad?'center':p.limb,broad:overlap,disc,...(overlap&&named&&!isMountain(p.target)?{pointOnly:true}:{})};
}
function eventsFor(p,obs,start,{align,isMountain,view}){
 const o=searchOptions(p,isMountain),whole=o.partId==='__whole';
 const rows=view?view(start):(o.broad&&o.disc||whole&&!isMountain(p.target))?align.dailyView(obs,p.target,p.body,start,{partId:o.partId,eyeM:obs.eyeM,...(o.pointOnly?{pointOnly:true}:{})}):
 align.upcoming(obs,p.target,p.body,{from:start,days:1,limit:Infinity,groupDays:false,partId:o.partId,limb:o.limb,eyeM:obs.eyeM,stepMs:3600000});
 return o.broad?rows.map(e=>({...e,matchMode:'overlap',partId:o.partId})):rows;
}
function matches(e,p,isMountain){
 const o=searchOptions(p,isMountain);
 return o.broad||o.partId==='__whole'?!!e.intersects:Number.isFinite(e.gap)&&Math.abs(e.gap)<=Math.max(1/60,.2*(e.radius||0));
}
// Describe the representative event using positions already computed by the solver.
// Direction is the celestial centre relative to the selected target, as seen from the observer.
function passageText(event,plan){
 if(!event||!plan?.target||!['sun','moon'].includes(plan.body)||!(event.radius>0))return '';
 const t=plan.target,groundSummit=Number.isFinite(t.groundM)&&t.parts?.length===1&&Math.abs(t.parts[0].m-t.groundM)<.5;
 const mountain=!event.composition&&(!!t.rim||t.kind==='mountain'||t.id==='fuji'||groundSummit);
 const whole=!event.composition&&!mountain&&(!plan.partId||plan.partId==='__whole');
 if(whole){
  const p=event.targetPosition;if(!p||![p.x,p.y].every(Number.isFinite))return '';
  const horizontal=p.x<1/3?'左':p.x>2/3?'右':'',vertical=p.y<1/3?'下':p.y>2/3?'上':'';
  const position=horizontal+vertical;
  return position?`全体の${position}寄りを通過`:'全体の中央付近を通過';
 }
 const part=plan.target.parts?.find(p=>p.id===plan.partId)||plan.target.parts?.[0];
 const name=event.composition?'指定位置':mountain?'山頂':part?.name;
 if(!name)return '';
 let offset;
 if(mountain){
  if(![event.azimuth,event.targetAzimuth,event.targetAltitude].every(Number.isFinite))return '';
  offset=(((event.azimuth-event.targetAzimuth+540)%360)-180)*Math.cos(event.targetAltitude*Math.PI/180);
 }else offset=Number.isFinite(event.targetAltitude)&&Number.isFinite(event.altitude)?event.altitude-event.targetAltitude:plan.matchMode==='overlap'?event.gap:NaN;
 if(!Number.isFinite(offset))return '';
 if(Math.abs(offset)<=.2*event.radius)return mountain?'山頂の中心を通過':`${name}付近を通過`;
 const direction=mountain?(offset<0?'左':'右'):(offset<0?'下':'上');
 return `${name}の${direction}寄りを通過`;
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
// Connect only adjacent successful samples of the registered geometry. These are
// candidate times along the line/area, not a claim that one fixed point works throughout.
async function annotateShapeRuns(shape,paths,memo,rows,eligible,record,{yieldTask=null,current=()=>true,scope=''}={}){
 let checkpoint=Date.now(),processed=0;
 const pause=async()=>{if(!yieldTask||Date.now()-checkpoint<12)return;await yieldTask();checkpoint=Date.now();if(!current())throw Error('shape-cancelled');};
 const coordinate=p=>p.latitude.toFixed(9)+','+p.longitude.toFixed(9),identity=(p,e)=>coordinate(p)+'|'+e.side+'|'+e.at;
 const nodes=[],byCoordinate=new Map(),byEvent=new Map(),parent=[];
 for(const sample of memo.values()){
  if(++processed%256===0)await pause();
  if(!sample)continue;const ids=[];
  for(const event of sample.accepted||sample.events)if(sample.accepted||eligible(event,sample.place)){
   const id=nodes.length;nodes.push({sample,event});parent.push(id);ids.push(id);byEvent.set(identity(sample.place,event),id);
  }
  if(ids.length)byCoordinate.set(coordinate(sample.place),ids);
 }
 const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 const compatible=(i,j)=>nodes[i].event.side===nodes[j].event.side&&Math.abs(nodes[i].event.at-nodes[j].event.at)<3*3600000;
 const join=(i,j)=>{
  if(!compatible(i,j))return;
  const a=root(i),b=root(j);if(a!==b)parent[b]=a;
 };
 const sampled=new Set(paths.flat().map(coordinate)),extra=[...memo].filter(([key])=>!sampled.has(key)).map(([key,value])=>value?.place||(()=>{const [latitude,longitude]=key.split(',').map(Number);return {latitude,longitude};})());
 // shapePaths keeps each leg of a polyline and each area scan row as a separate straight path.
 for(const path of paths){
  await pause();
  const a=path[0],b=path.at(-1),dx=b.longitude-a.longitude,dy=b.latitude-a.latitude;
  const ordered=extra.length?[...path,...extra.filter(p=>onSegment(p,a,b))].sort((p,q)=>(p.longitude-q.longitude)*dx+(p.latitude-q.latitude)*dy):path;
  for(let i=1;i<ordered.length;i++){
   const left=byCoordinate.get(coordinate(ordered[i-1]))||[],right=byCoordinate.get(coordinate(ordered[i]))||[];
   for(const a of left)for(const b of right)join(a,b);
  }
 }
 if(shape.type==='area'){
  // The scan rows are connected across neighbouring rows, with no shortcut
  // across a concave boundary. Reuse the already evaluated positions only.
  const origin=shape.vertices[0],kx=111195*Math.cos(origin.latitude*Math.PI/180),cells=new Map(),step=SHAPE_STEP_M;
  const insideSegment=(a,b)=>{
   const x=b.longitude-a.longitude,y=b.latitude-a.latitude,ts=[0,1];
   for(let i=0;i<shape.vertices.length;i++){
    const c=shape.vertices[i],d=shape.vertices[(i+1)%shape.vertices.length],u=d.longitude-c.longitude,v=d.latitude-c.latitude,den=x*v-y*u;
    if(Math.abs(den)<1e-20)continue;
    const dx=c.longitude-a.longitude,dy=c.latitude-a.latitude,t=(dx*v-dy*u)/den,s=(dx*y-dy*x)/den;
    if(t>0&&t<1&&s>=0&&s<=1)ts.push(t);
   }
   ts.sort((a,b)=>a-b);
   return ts.slice(1).every((t,i)=>shapeContains(shape,interpolate(a,b,(t+ts[i])/2)));
  };
  for(let i=0;i<nodes.length;i++){
   if(i%128===0)await pause();
   const p=nodes[i].sample.place,x=Math.floor((p.longitude-origin.longitude)*kx/step),y=Math.floor((p.latitude-origin.latitude)*111195/step);
   for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const j of cells.get((x+dx)+','+(y+dy))||[]){
    if(root(i)===root(j)||!compatible(i,j))continue;const q=nodes[j].sample.place;
    if(meters(p,q)<=step*1.5&&insideSegment(p,q))join(i,j);
   }
   const key=x+','+y;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(i);
  }
 }
 const runs=new Map();
 for(let i=0;i<nodes.length;i++){
  const id=root(i),n=nodes[i];let run=runs.get(id);
  if(!run){run={first:n,fromAt:n.event.at,toAt:n.event.at,positions:new Set()};runs.set(id,run);}
  if(n.event.at<run.first.event.at)run.first=n;
  run.fromAt=Math.min(run.fromAt,n.event.at);run.toAt=Math.max(run.toAt,n.event.at);run.positions.add(coordinate(n.sample.place));
 }
 const rowKeys=new Set(rows.map(row=>identity(row.place,row.event)));
 for(const [id,run]of runs){
  const {sample,event}=run.first;
  if(!rowKeys.has(identity(sample.place,event)))rows.push({place:sample.place,record,event,assumedObserver:sample.assumedObserver,shapeType:shape.type});
  run.window={id:scope+':shape:'+id,kind:shape.type,fromAt:run.fromAt,toAt:run.toAt,count:run.positions.size,basis:'sampled-positions'};
 }
 for(const row of rows){const id=byEvent.get(identity(row.place,row.event));if(id!==undefined)row.spatialWindow=runs.get(root(id)).window;}
 return rows;
}

async function shapeCandidates(p,entry,deps){
 const {align,isMountain,observerAt,elevationAt,viewFor,yieldTask,isCurrent=()=>true,onProgress=()=>{}}=deps,s=cleanShape(entry.place.shape);
 if(!s)throw Error('shape-invalid');const o=searchOptions(p,isMountain),paths=shapePaths(s),start=day(p.at),memo=new Map(),rows=[];let missing=0,steps=0;const began=Date.now();
 const check=()=>{if(!isCurrent())throw Error('shape-cancelled');if(Date.now()-began>45000)throw Error('shape-limit');};
 const eligible=(e,f)=>e.at>=start&&e.at<start+DAY&&e.spatialMatched!==false&&(!Number.isFinite(e.altitude)||o.disc||e.altitude>0)&&matches(e,p,isMountain)&&shapeContains(s,f);
 const evaluate=async position=>{
  check();const key=position.latitude.toFixed(9)+','+position.longitude.toFixed(9);if(memo.has(key))return memo.get(key);
  if(++steps%8===0||yieldTask){if(steps%8===0)onProgress({checked:steps});await (yieldTask?yieldTask():new Promise(r=>setTimeout(r,0)));check();}
  // Every candidate has its own DEM. Anchor elevation/manual ground never leaks along a path.
  const ground=await elevationAt(position.latitude,position.longitude);check();
  if(!Number.isFinite(ground)){missing++;memo.set(key,null);return null;}
  const f={...entry.place,...position,elevation:ground,groundManualM:ground,sourcePlaceId:entry.place.id};delete f.shape;
  const obs=observerAt(f,ground),view=viewFor?await viewFor(obs,p):null;check();
  const probes=view?view(start):align.dailyView?align.dailyView(obs,p.target,p.body,start,{partId:o.partId,eyeM:obs.eyeM,...(o.pointOnly?{pointOnly:true}:{})}).map(e=>{
  const exact=align.alignmentAt?.(obs,p.target,p.body,e.at,{partId:o.partId,limb:o.limb,eyeM:obs.eyeM,...(o.pointOnly?{pointOnly:true}:{})});
  return {...e,gap:exact?.gap??e.gap,...(!o.disc&&exact?{spatialMatched:exact.matched}:{})};}):eventsFor(p,obs,start,{align,isMountain});
  const events=view?probes:(!o.disc||o.broad)&&align.dailyView?probes:eventsFor(p,obs,start,{align,isMountain});
  if(o.broad)for(const e of events){e.matchMode='overlap';e.partId=o.partId;}
  const accepted=events.filter(e=>eligible(e,f)),result={place:f,events,probes,accepted,assumedObserver:obs};memo.set(key,result);
  for(const e of accepted){
   // Keep distinct positions, but avoid thousands of indistinguishable pins.
   if(!rows.some(r=>r.event.side===e.side&&meters(r.place,f)<40&&Math.abs(r.event.at-e.at)<120000))rows.push({place:f,record:entry.record,event:e,assumedObserver:obs,shapeType:s.type});
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
 await annotateShapeRuns(s,paths,memo,rows,eligible,entry.record,{yieldTask:yieldTask||(()=>new Promise(r=>setTimeout(r,0))),current:isCurrent,scope:JSON.stringify([p.body,p.target.id??[p.target.latitude,p.target.longitude],o.partId,p.matchMode,start])});
 check();return {rows,missing,checked:memo.size,stepM:SHAPE_STEP_M};
}

async function candidates(plan,points,{align,isMountain,observerAt,elevationAt,ensure,viewFor,yieldTask,isCurrent=()=>true,onProgress=()=>{}}={}){
 const p=conditions(plan);if(!p)return {rows:[],failed:0};
 const issues=[];let checked=0;
 await ensure(p.body);const start=day(p.at),rows=[];let failed=0;
 for(const entry of points){
  await (yieldTask?yieldTask():new Promise(resolve=>setTimeout(resolve,0)));if(!isCurrent())return {rows:[],failed:0,cancelled:true};
  try{
   const f=entry.place;
   if(f.shape){const result=await shapeCandidates(p,entry,{align,isMountain,observerAt,elevationAt,viewFor,yieldTask,isCurrent,onProgress});rows.push(...result.rows);checked+=result.checked;if(result.missing){failed++;issues.push({id:f.id,reason:'elevation',count:result.missing});}continue;}
   const ground=Number.isFinite(f.groundManualM)?f.groundManualM:Number.isFinite(f.elevation)?f.elevation:await elevationAt(f.latitude,f.longitude);
   if(!Number.isFinite(ground))throw Error('missing elevation');
   const obs=observerAt(f,ground),view=viewFor?await viewFor(obs,p):null;
   if(!isCurrent())return {rows:[],failed:0,cancelled:true};
   const events=eventsFor(p,obs,start,{align,isMountain,view});
   for(const e of events){
    if(e.at<start||e.at>=start+DAY||!matches(e,p,isMountain))continue;
    rows.push({place:f,record:entry.record,event:e,assumedObserver:obs});
   }
  }catch(e){if(!isCurrent()||e.message==='shape-cancelled')return {rows:[],failed:0,cancelled:true};failed++;issues.push({id:entry.place.id,reason:e.message==='shape-limit'?'limit':e.message==='shape-invalid'?'invalid':'calculation'});}
 }
 rows.sort((a,b)=>a.event.at-b.event.at||a.place.name.localeCompare(b.place.name));
 return {rows,failed,...(issues.length?{issues}:{}),...(checked?{checked,stepM:SHAPE_STEP_M}:{})};
}
function hapticGate({vibrate=()=>{},clock=Date.now}={}){
 let previous=false,last=-Infinity,identity='';
 return (matched,key)=>{if(key!==identity){identity=key;previous=false;}const entered=matched&&!previous;previous=!!matched;if(entered&&clock()-last>800){last=clock();try{vibrate(12);}catch{/* 振動は無くてもよい */}}return entered;};
}
global.AstroNotesShooting={day,point,nightAllowed,savedObserver,candidatePlace,observerMoveKey,movedPlace,conditions,queryKey,searchOptions,eventsFor,matches,passageText,candidates,hapticGate,
 cleanShape,shapeContains,shapePaths,shapeCandidates,annotateShapeRuns,meters,interpolate};
if(typeof module!=='undefined'&&module.exports)module.exports=global.AstroNotesShooting;
})(globalThis);

/* Legacy global names remain aliases for cached integrations. */
if(typeof AstroNotesShooting!=='undefined')globalThis.SoramiShooting=AstroNotesShooting;
