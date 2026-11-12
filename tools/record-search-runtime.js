// One in-memory calculation session for both registered-place screens.
let recordSearchSession=null,recordIndexMemo=null;
const recordSearchFrame=()=>{
 let yielded=performance.now(),pending=null,finish=null,timer=null,ticket=0;
 const wake=id=>{if(!pending||id!==ticket)return;const done=finish;finish=null;pending=null;if(timer!==null)clearTimeout(timer);timer=null;yielded=performance.now();done();};
 const channel=new MessageChannel();channel.port1.onmessage=e=>wake(e.data);
 // A mobile page can suspend while its posted task is still pending. Neither
 // all future searches nor foreground recovery may depend on that one task.
 const resume=()=>{if(typeof document==='undefined'||!document.hidden)wake(ticket);};
 if(typeof document!=='undefined')document.addEventListener('visibilitychange',resume);
 globalThis.addEventListener?.('pageshow',resume);globalThis.addEventListener?.('focus',resume);
 return ()=>{
  if(pending)return pending;if(performance.now()-yielded<8)return Promise.resolve();
  const id=++ticket;pending=new Promise(resolve=>{finish=resolve;});
  timer=setTimeout(()=>wake(id),50);channel.port2.postMessage(id);return pending;
 };
};
const recordSearchYield=recordSearchFrame();
const recordSearchScope=()=>[auth?.token,auth?.loginId,accessState.generation,version,JSON.stringify([auth?.tools,aimAirSettings]),AstroNotesAtmosphere.dataKey(),globalThis.AstroNotesTowerModels,globalThis.AstroNotesCityModels];
const recordSameScope=(a,b)=>a?.length===b.length&&a.every((v,i)=>v===b[i]);
function recordSearchIndex(){
 const scope=[auth?.token,auth?.loginId,accessState.generation,version];
 if(!recordSameScope(recordIndexMemo?.scope,scope)){
  const records=load(),groups=new Map(),shapes=shapeData();
  for(const record of records){
   let targets=groups.get(record.placeId);if(!targets){targets=new Map();groups.set(record.placeId,targets);}
   let group=targets.get(record.target.key);if(!group){group=[];targets.set(record.target.key,group);}group.push(record);
  }
  recordIndexMemo={scope,records,groups,shapes};
 }
 return recordIndexMemo;
}
function recordSearchShape(f,shapes){const r=shapes[f.id];return r&&r.latitude===f.latitude&&r.longitude===f.longitude?AstroNotesShooting.cleanShape(r.shape):null;}
function recordBounded(map,key,build,limit){
 if(map.has(key)){const value=map.get(key);map.delete(key);map.set(key,value);return value;}
 const value=build();map.set(key,value);while(map.size>limit)map.delete(map.keys().next().value);return value;
}
// 2026-11-09 重なる日の一覧（opportunity）は、建物を位置ごとに1つの外形（輪郭点の凸包）で判定する
// （ユーザー「計算で使うのは一つの地点で一つの建物の縁とか稜線でいい。正確な見え方は見え方でわかる」）。
// 外形と山頂の稜線は日付・天体に依存しない。渡された分を使い、新しく作った分は呼び出し元へ返して
// 記録と一緒に同期する。見え方・探すの計算はこれを使わない。
const recordGeometry={known:new Map(),used:new Map(),collect:false};
function recordSilhouette(obs,target,opts){
 const key='sil:'+JSON.stringify([obs.latitude,obs.longitude,obs.elevation??0,opts.eyeM??1.5,target.id??null,target.latitude,target.longitude,target.groundM??null,(target.parts||[]).map(p=>[p.id,p.m]),opts.heightM??null,AstroNotesAtmosphere.targetK()]);
 if(recordGeometry.known.has(key)){const hit=recordGeometry.known.get(key);recordGeometry.used.set(key,hit);return hit;}
 const outline=AstroNotesAlign.towerOutline(obs,target,{eyeM:opts.eyeM??1.5,heightM:opts.heightM??null});
 let value=null;
 if(outline){const polygon=AstroNotesAlign.convexHull(outline.hitPolygons?outline.hitPolygons.flat():outline.hitPoints||outline.points||[]);
 if(polygon.length>=3&&Number.isFinite(outline.viewBaseAngle)&&Number.isFinite(outline.topAngle))value={viewBaseAngle:outline.viewBaseAngle,topAngle:outline.topAngle,approximate:!!outline.approximate,polygon};}
 recordGeometry.known.set(key,value);recordGeometry.used.set(key,value);return value;
}
// 2026-11-09 線・範囲の地点も一覧に出す（ユーザー「範囲とか線の時も出るようにできないの？」）。
// 立ち位置ごとの地面の高さと、そこから見た稜線・建物の外形は日付に依存しないので、範囲ごとに一度
// 作り、記録と一緒に同期する（"shp:"、立ち位置16個ずつ）。太陽・月の通り道は範囲内のどこでも
// ほぼ同じ（1km動いても月の直径の約3500分の1）なので、日ごとには代表点で1本だけ求め、
// 通り道が外形の近くを通る立ち位置だけを1点ずつの判定（見え方と同じ計算）で確かめる。
// 立ち位置の間隔は見え方の25mが基準で、対象が遠いほど広げる（対象の向きの変化が太陽の直径の1/4以内）。
const RECORD_SHAPE_MIN_STEP_M=25,RECORD_SHAPE_MAX_STEP_M=400,RECORD_SHAPE_STEP_RAD=.0023,RECORD_SHAPE_LIMIT=12000,RECORD_SHAPE_BLOCK=16,RECORD_SHAPE_UNIT=1e-4,RECORD_SHAPE_TOLERANCE=1e-3,RECORD_SHAPE_TRACK_MS=240000;
const recordShapeMemo=new Map();
function recordHash(text){
 let a=0x811c9dc5,b=0x9747b28c;
 for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);a=Math.imul(a^c,0x01000193);b=Math.imul(b^c,0x5bd1e995);b^=b>>>15;}
 return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}
function recordShapeStep(s,target){
 const v=s.vertices,k=Math.cos(target.latitude*Math.PI/180),xy=p=>[(p.longitude-target.longitude)*111195*k,(p.latitude-target.latitude)*111195];
 let near=Infinity;
 const edge=(a,b)=>{const [ax,ay]=xy(a),[bx,by]=xy(b),dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));near=Math.min(near,Math.hypot(ax+t*dx,ay+t*dy));};
 for(let i=1;i<v.length;i++)edge(v[i-1],v[i]);
 if(s.type==='area'){edge(v[v.length-1],v[0]);if(AstroNotesShooting.shapeContains(s,target))near=0;}
 return Math.round(Math.max(RECORD_SHAPE_MIN_STEP_M,Math.min(RECORD_SHAPE_MAX_STEP_M,near*RECORD_SHAPE_STEP_RAD)));
}
// The preview's sampling (AstroNotesShooting.shapePaths) with a given step; 25 m gives the same points.
function recordShapePoints(s,step){
 const S=AstroNotesShooting,v=s.vertices,paths=[];let total=0;
 const add=(a,b)=>{const n=Math.max(1,Math.ceil(S.meters(a,b)/step));total+=n+1;if(total>RECORD_SHAPE_LIMIT)throw Error('shape-limit');paths.push(Array.from({length:n+1},(_,i)=>S.interpolate(a,b,i/n)));};
 for(let i=1;i<v.length;i++)add(v[i-1],v[i]);
 if(s.type==='area'){
  add(v[v.length-1],v[0]);
  const low=Math.min(...v.map(p=>p.latitude)),high=Math.max(...v.map(p=>p.latitude)),n=Math.max(1,Math.ceil((high-low)*111195/step));
  if(n>RECORD_SHAPE_LIMIT)throw Error('shape-limit');
  for(let row=1;row<n;row++){
   const latitude=low+(high-low)*row/n,x=[];
   for(let i=0,j=v.length-1;i<v.length;j=i++)if((v[i].latitude>latitude)!==(v[j].latitude>latitude))x.push(v[i].longitude+(v[j].longitude-v[i].longitude)*(latitude-v[i].latitude)/(v[j].latitude-v[i].latitude));
   x.sort((a,b)=>a-b);for(let i=0;i+1<x.length;i+=2)add({latitude,longitude:x[i]},{latitude,longitude:x[i+1]});
  }
 }
 const seen=new Map(),points=[];
 const order=paths.map(path=>path.map(q=>{const key=q.latitude.toFixed(9)+','+q.longitude.toFixed(9);if(!seen.has(key)){seen.set(key,points.length);points.push(q);}return seen.get(key);}));
 return {points,paths:order};
}
// Douglas-Peucker within 0.001° (0.4% of the sun's radius), then integers of 0.0001°.
function recordSimplify(points,closed){
 if(points.length<=3)return points.slice();
 const ref=points[0][0],k=Math.cos(points.reduce((s,p)=>s+p[1],0)/points.length*Math.PI/180),xy=points.map(([a,h])=>[(((a-ref)%360+540)%360-180)*k,h]),keep=new Uint8Array(points.length);
 const rdp=(i,j)=>{
  let best=-1,far=0;const [ax,ay]=xy[i],[bx,by]=xy[j],dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy);
  for(let m=i+1;m<j;m++){const [px,py]=xy[m],d=len?Math.abs(dx*(ay-py)-dy*(ax-px))/len:Math.hypot(px-ax,py-ay);if(d>far){far=d;best=m;}}
  if(best>=0&&far>RECORD_SHAPE_TOLERANCE){keep[best]=1;rdp(i,best);rdp(best,j);}
 };
 keep[0]=keep[points.length-1]=1;
 if(closed){let far=-1,m=1;for(let i=1;i<points.length;i++){const d=Math.hypot(xy[i][0]-xy[0][0],xy[i][1]-xy[0][1]);if(d>far){far=d;m=i;}}keep[m]=1;rdp(0,m);rdp(m,points.length-1);}
 else rdp(0,points.length-1);
 return points.filter((_,i)=>keep[i]);
}
const recordQ=v=>Math.round(v/RECORD_SHAPE_UNIT);
// 'r' summit ridge (or the whole ridge when the summit is hidden), 's' building outline,
// 'p' a target without an outline (a point), 'm' the full model (outline could not be reduced).
function recordShapeEncode(geo){
 if(geo.kind==='p'||geo.kind==='m')return geo.kind;
 const out=geo.kind==='r'?['r',recordQ(geo.base)]:['s',recordQ(geo.viewBaseAngle),recordQ(geo.topAngle),geo.approximate?1:0];
 let pa=0,ph=0;for(const [a,h] of recordSimplify(geo.points,geo.kind==='s')){const qa=recordQ(a),qh=recordQ(h);out.push(qa-pa,qh-ph);pa=qa;ph=qh;}
 return out;
}
function recordShapeDecode(q){
 if(q==='p'||q==='m')return {kind:q};
 if(!Array.isArray(q)||q.length>4000||(q[0]!=='r'&&q[0]!=='s'))return null;
 const head=q[0]==='r'?2:4,min=q[0]==='r'?2:3;
 if(q.length<head+2*min||(q.length-head)%2||!q.slice(1).every(Number.isSafeInteger)||(head===4&&q[3]!==0&&q[3]!==1))return null;
 const U=RECORD_SHAPE_UNIT,points=[];let a=0,h=0;for(let i=head;i<q.length;i+=2){a+=q[i];h+=q[i+1];points.push([a*U,h*U]);}
 return q[0]==='r'?{kind:'r',base:q[1]*U,points}:{kind:'s',viewBaseAngle:q[1]*U,topAngle:q[2]*U,approximate:q[3]===1,points};
}
function recordShapeBlockValid(value){
 if(!value||!Number.isInteger(value.i0)||value.i0<0||!Array.isArray(value.g)||!Array.isArray(value.q)||!value.g.length||value.g.length>RECORD_SHAPE_BLOCK||value.g.length!==value.q.length)return false;
 return value.g.every((g,i)=>Number.isFinite(g)&&!!recordShapeDecode(value.q[i]));
}
// Angular region holding the outline as seen from one position: azimuth span about c, altitude lo..hi.
// Great-circle edges bulge past their end points by at most (span)^2/16 radians.
function recordShapeBox(geo,g){
 if(geo.kind==='m')return null;
 if(geo.kind==='p')return {c:g.azimuth,w:0,lo:g.angle,hi:g.angle};
 const ref=geo.points[0][0];let a0=Infinity,a1=-Infinity,lo=geo.kind==='r'?geo.base:Infinity,hi=-Infinity;
 for(const [a,h] of geo.points){const d=(((a-ref)%360+540)%360)-180;a0=Math.min(a0,d);a1=Math.max(a1,d);lo=Math.min(lo,h);hi=Math.max(hi,h);}
 const w=(a1-a0)/2,bulge=(w*Math.PI/90)**2/16*180/Math.PI;
 return {c:ref+(a0+a1)/2,w,lo:lo-bulge,hi:hi+bulge};
}
// Exact spherical distance (degrees) from a direction to that region.
function recordBoxDistance(az,alt,b){
 const da=Math.abs((((az-b.c)%360+540)%360)-180)-b.w;
 if(da<=0)return alt>b.hi?alt-b.hi:alt<b.lo?b.lo-alt:0;
 if(da>=90)return 90;
 const D=Math.PI/180,phi=alt*D,dz=da*D,foot=Math.atan2(Math.sin(phi),Math.cos(phi)*Math.cos(dz))/D;
 if(foot>=b.lo&&foot<=b.hi)return Math.asin(Math.min(1,Math.cos(phi)*Math.sin(dz)))/D;
 const a2=(foot>b.hi?b.hi:b.lo)*D;
 return Math.acos(Math.max(-1,Math.min(1,Math.sin(phi)*Math.sin(a2)+Math.cos(phi)*Math.cos(a2)*Math.cos(dz))))/D;
}
const recordArc=(a,b)=>{const D=Math.PI/180;return Math.acos(Math.max(-1,Math.min(1,Math.sin(a.alt*D)*Math.sin(b.alt*D)+Math.cos(a.alt*D)*Math.cos(b.alt*D)*Math.cos((a.az-b.az)*D))))/D;};
// What one position's daily check uses (aimShootingView's summit cap, recordSilhouette's outline),
// without adding per-position entries to the synced geometry.
async function recordShapeGeometry(obs,target){
 if(aimIsMountain(target)){
  const eye=obs.elevation+obs.eyeM,fuji=target.id==='fuji';let cap=null;
  if(fuji){const collect=recordGeometry.collect;let pending;recordGeometry.collect=false;try{pending=aimIndexedCap(obs,eye,target);}finally{recordGeometry.collect=collect;}try{cap=await pending;}catch{/* The original sampler below. */}}
  if(!cap){const ridge=await aimLookRidge(obs,eye,target,{exactSearch:fuji});if(!ridge)throw Error('山の稜線を取得できませんでした');cap=aimSummitCap(ridge,obs,eye,target)||{ridge,base:0};}
  return {kind:'r',base:cap.base,points:cap.ridge};
 }
 const outline=AstroNotesAlign.towerOutline(obs,target,{eyeM:obs.eyeM??1.5,heightM:null});
 if(!outline)return {kind:'p'};
 const polygon=AstroNotesAlign.convexHull(outline.hitPolygons?outline.hitPolygons.flat():outline.hitPoints||outline.points||[]);
 return polygon.length>=3&&Number.isFinite(outline.viewBaseAngle)&&Number.isFinite(outline.topAngle)?{kind:'s',viewBaseAngle:outline.viewBaseAngle,topAngle:outline.topAngle,approximate:!!outline.approximate,points:polygon}:{kind:'m'};
}
async function recordShapeOpportunity(session,p,place,record,solver,live){
 const S=AstroNotesShooting,DAY=86400000,s=S.cleanShape(place.shape),target=p.target,o=S.searchOptions(p,aimIsMountain),start=S.day(p.at);
 if(!s)return {rows:[],failed:1,issues:[{id:place.id,reason:'invalid'}]};
 const cancelled={rows:[],failed:0,cancelled:true};
 try{
  const step=recordShapeStep(s,target),{points,paths}=recordShapePoints(s,step),mountain=aimIsMountain(target);
  const base=recordHash(JSON.stringify(['astronotes.shape-geometry.v1',s.type,s.vertices,step,target.id??null,target.latitude,target.longitude,target.groundM??null,(target.parts||[]).map(x=>[x.id,x.m]),!!target.rim,place.eyeHeightAGL??null,place.standAglM??null,place.stand??null,o.partId,
  aimIsMountain(target),AstroNotesAtmosphere.targetK()]));
  let memo=recordShapeMemo.get(base);
  if(!memo||memo.count!==points.length){
   const blocks=[];
   for(let i0=0;i0<points.length;i0+=RECORD_SHAPE_BLOCK){
    const key='shp:'+base+':'+i0,known=recordGeometry.known.get(key);
    if(recordShapeBlockValid(known)&&known.i0===i0&&known.g.length===Math.min(RECORD_SHAPE_BLOCK,points.length-i0)){blocks.push([key,known,true]);continue;}
    // A position whose ground could not be read is retried later and never kept or synced.
    const value={i0,g:[],q:[]};let complete=true;
    for(let i=i0;i<Math.min(points.length,i0+RECORD_SHAPE_BLOCK);i++){
     if(!live())return cancelled;
     const ground=await solver.elevationAt(points[i].latitude,points[i].longitude);
     if(!Number.isFinite(ground)){complete=false;value.g.push(null);value.q.push(null);continue;}
     const f={...place,...points[i],elevation:ground,groundManualM:ground,sourcePlaceId:place.id};delete f.shape;
     value.g.push(ground);value.q.push(recordShapeEncode(await recordShapeGeometry(aimObserverAt(aimSavedFrom(f),ground),target)));
     await recordSearchYield();
    }
    if(complete)recordGeometry.known.set(key,value);blocks.push([key,value,complete]);
   }
   memo={count:points.length,blocks,geometry:blocks.flatMap(([,value])=>value.q.map(q=>q===null?null:recordShapeDecode(q)))};
   if(blocks.every(b=>b[2])){recordShapeMemo.set(base,memo);while(recordShapeMemo.size>64)recordShapeMemo.delete(recordShapeMemo.keys().next().value);}
  }
  for(const [key,value,complete] of memo.blocks)if(complete)recordGeometry.used.set(key,value);
  const grounds=memo.blocks.flatMap(([,value])=>value.g),samples=[];let missing=0;
  for(let i=0;i<points.length;i++){
   const ground=grounds[i],geo=memo.geometry[i];if(ground===null||!geo){missing++;continue;}
   const f={...place,...points[i],elevation:ground,groundManualM:ground,sourcePlaceId:place.id};delete f.shape;
   const obs=aimObserverAt(aimSavedFrom(f),ground),g=AstroNotesAlign.geometryFrom(obs,target,{partId:o.partId,eyeM:obs.eyeM});
   // A narrow alignment between two positions is refined from both (below), so each position's
   // margin also covers how far the outline moves to the next position.
   const shift=g&&!mountain?Math.min(10,step/(g.distanceKm*1000)*(1+Math.abs(Math.tan(g.angle*Math.PI/180)))*180/Math.PI):0;
   samples.push({i,f,obs,geo,shift,box:g?recordShapeBox(geo,g):null});
  }
  if(!samples.length)return {rows:[],failed:missing?1:0,checked:0,stepM:step,...(missing?{issues:[{id:place.id,reason:'elevation',count:missing}]}:{})};
  await AstroNotesBodies.ensure(p.body);if(!live())return cancelled;
  // One path of the body per day, from the first position.
  const anchor=samples[0].obs,eyeObs={...anchor,elevation:anchor.elevation+anchor.eyeM},track=[];
  for(let at=start-RECORD_SHAPE_TRACK_MS;at<=start+DAY+RECORD_SHAPE_TRACK_MS;at+=RECORD_SHAPE_TRACK_MS){
   const st=AstroNotesBodies.state(p.body,at,eyeObs),up=st.upperAltitude??st.apparentAltitude+st.angularRadius,low=st.lowerAltitude??st.apparentAltitude-st.angularRadius;
   track.push({az:st.azimuth,alt:st.apparentAltitude,up,r:Math.max(st.angularRadius,up-st.apparentAltitude,st.apparentAltitude-low)+.01});
  }
  for(let i=0;i<track.length;i++)track[i].half=Math.max(i?recordArc(track[i-1],track[i]):0,i+1<track.length?recordArc(track[i],track[i+1]):0)/2;
  // Directions differ between positions by the vertical's tilt (0.009°/km), the moon's parallax
  // and refraction at another height; the margin covers all of them.
  const best=new Map(),evaluated=new Map();let checked=0;
  const optsOf=(obs,geo)=>geo.kind==='r'?{partId:null,eyeM:obs.eyeM,ridge:geo.points,ridgeBase:geo.base}:{partId:o.partId,eyeM:obs.eyeM,...(geo.kind==='s'?{silhouette:{viewBaseAngle:geo.viewBaseAngle,topAngle:geo.topAngle,approximate:geo.approximate,polygon:geo.points}}:{})};
  const consider=(events,f,obs)=>{
   for(const e of events){
    if(o.broad){e.matchMode='overlap';e.partId=o.partId;}
    if(!(e.at>=start&&e.at<start+DAY&&e.spatialMatched!==false&&(!Number.isFinite(e.altitude)||o.disc||e.altitude>0)&&S.matches(e,p,aimIsMountain)&&S.shapeContains(s,f)))continue;
    // Daytime moons are kept. One row per side of the day:
    // the position where the body sits deepest in the outline.
    const now=best.get(e.side);
    if(!now||e.distanceToTarget<now.event.distanceToTarget||e.distanceToTarget===now.event.distanceToTarget&&e.at<now.event.at)best.set(e.side,{place:f,record,event:e,assumedObserver:obs,shapeType:s.type});
   }
  };
  for(const sample of samples){
   const margin=.05+sample.shift+.015*AstroNotesTerrain.distanceKm(anchor.latitude,anchor.longitude,sample.obs.latitude,sample.obs.longitude)+1e-4*Math.abs(sample.obs.elevation+sample.obs.eyeM-eyeObs.elevation);
   if(sample.box&&!track.some(t=>t.up+t.half+margin>0&&recordBoxDistance(t.az,t.alt,sample.box)<=t.r+t.half+margin))continue;
   if(!live())return cancelled;
   const {f,obs,geo}=sample,view=recordBounded(session.shapeSamples,base+':'+sample.i+':'+p.body,()=>AstroNotesAlign.prepareDailyView(obs,target,p.body,optsOf(obs,geo)),4096);
   const events=view(start);checked++;evaluated.set(sample.i,{f,events});consider(events,f,obs);
   if(checked%16===0)await recordSearchYield();
  }
  // As the preview does: where the body passes the top between two neighbouring positions
  // (its height minus the top's changes sign), halve the gap and check there. A narrow figure
  // can be met only between positions. Only for a side of the day still without a match, and
  // not for mountains, whose positions are spaced well inside the summit's width.
  if(!mountain)for(const path of paths)for(let k=1;k<path.length;k++){
   const A=evaluated.get(path[k-1]),B=evaluated.get(path[k]);if(!A||!B)continue;
   for(const a of A.events){
    if(best.has(a.side))continue;
    const near=list=>list.find(e=>e.side===a.side&&Math.abs(e.at-a.at)<3*3600000),b=near(B.events);
    if(!b||!Number.isFinite(a.gap)||!Number.isFinite(b.gap)||a.gap*b.gap>=0)continue;
    let left=A.f,right=B.f,le=a;
    for(let n=0;n<20&&S.meters(left,right)>.05&&!best.has(a.side);n++){
     if(!live())return cancelled;
     const position=S.interpolate(left,right,.5),ground=await solver.elevationAt(position.latitude,position.longitude);if(!Number.isFinite(ground))break;
     const f={...place,...position,elevation:ground,groundManualM:ground,sourcePlaceId:place.id};delete f.shape;
     const obs=aimObserverAt(aimSavedFrom(f),ground),geo=recordShapeDecode(recordShapeEncode(await recordShapeGeometry(obs,target)));
     const events=AstroNotesAlign.prepareDailyView(obs,target,p.body,optsOf(obs,geo))(start);consider(events,f,obs);checked++;
     const me=near(events);if(!me||!Number.isFinite(me.gap))break;
     if(le.gap*me.gap<=0)right=f;else{left=f;le=me;}
    }
   }
  }
  return {rows:[...best.values()].sort((a,b)=>a.event.at-b.event.at),failed:missing?1:0,checked:samples.length,candidates:checked,stepM:step,...(missing?{issues:[{id:place.id,reason:'elevation',count:missing}]}:{})};
 }catch(e){
  if(!live())return cancelled;
  return {rows:[],failed:1,issues:[{id:place.id,reason:e.message==='shape-limit'?'limit':'calculation'}]};
 }
}
// 2026-11-10 探す（記録の撮影地点）も重なる日と同じ作りに（ユーザー「同じ作りにして」）。今までは立ち位置ごと・
// 日ごとに建物の外形を作ってから判定していた（外形づくり1か所約20ms、判定そのものは約0.5ms。範囲の地点は
// 立ち位置が数百あり、外形の覚え置き128か所からあふれて毎日作り直していた）。外形を作る前に、その日の
// 天体の通り道（その立ち位置から、この端末の大気差で4分ごと）が外形を必ず含む枠
// （AstroNotesAlign.outlineBounds）の近くを通るかを調べ、通らない日は外形を作らずに重ならないとする。
// 通る日は今までと同じ計算。余裕は円盤の半径、4分の間の動きの半分、投影と縦横比の差0.02°。線・範囲では
// 隣の立ち位置との間（25m以内）を二分して調べるので、その間で外形が動く分（25mと地面の差30mを最寄りの
// 外形までの距離で割った角度）も足す。
const RECORD_FAR_STEP_MS=240000;
function recordFar(obs,target,body,opts,day,spaced){
 const box=AstroNotesAlign.outlineBounds?.(obs,target,opts);if(!box||!Number.isFinite(box.nearKm))return false;
 const D=Math.PI/180,shift=spaced?Math.atan(55/Math.max(1,box.nearKm*1000))/D:0;if(shift>5)return false;
 return recordTrackFar(obs,body,opts.eyeM,box,day,shift);
}
function recordTrackFar(obs,body,eyeM,box,day,shift){
 const D=Math.PI/180,eye={...obs,elevation:(obs.elevation??0)+(eyeM??1.5)},track=[];
 for(let at=day-RECORD_FAR_STEP_MS;at<=day+86400000+RECORD_FAR_STEP_MS;at+=RECORD_FAR_STEP_MS){
  const st=AstroNotesBodies.state(body,at,eye),r=st.angularRadius||0,up=st.upperAltitude??st.apparentAltitude+r,low=st.lowerAltitude??st.apparentAltitude-r;
  if(![st.azimuth,st.apparentAltitude,up,low].every(Number.isFinite))return false;
  track.push({az:st.azimuth,alt:(up+low)/2,r:Math.tan(Math.max(r,up-st.apparentAltitude,st.apparentAltitude-low)*D)/D});
 }
 for(let i=0;i<track.length;i++){
  const t=track[i],half=Math.max(i?recordArc(track[i-1],t):0,i+1<track.length?recordArc(t,track[i+1]):0)/2;
  if(recordBoxDistance(t.az,t.alt,box)<=t.r+half+.02+shift)return false;
 }
 return true;
}
// 2026-11-10 山（重ね方が全体）: 山頂付近の稜線は日付・天体に依存しないので立ち位置ごとに覚えておき
// （今までは日ごとの判定を覚え置き、範囲の地点では96か所を超えると毎日作り直していた）、その日の判定だけを
// 作る。稜線の作り方は aimShootingView と同じ。点の地点は建物と同じく、通り道が稜線の枠から遠い日は判定を
// 作らない。線・範囲は隣の立ち位置との間を二分するので、手前の地形までの距離が分からない稜線では外さない。
async function recordMountainView(session,shaped,obs,p,indexed){
 const key=JSON.stringify([obs,p.target,indexed]),geometry=session.mountainGeometry||(session.mountainGeometry=new Map());
 const geo=await recordBounded(geometry,key,()=>{
  const pending=(async()=>{
   const eye=obs.elevation+obs.eyeM;let cap=null,ridge;
   if(indexed)try{cap=await aimIndexedCap(obs,eye,p.target);}catch{/* The original sampler follows. */}
   if(!cap){ridge=await aimLookRidge(obs,eye,p.target,{exactSearch:indexed&&p.target.id==='fuji'});if(!ridge)throw Error('山の稜線を取得できませんでした。再試行してください');cap=aimSummitCap(ridge,obs,eye,p.target);}
   return cap?{ridge:cap.ridge,base:cap.base,opts:{partId:null,eyeM:obs.eyeM,ridge:cap.ridge,ridgeBase:cap.base}}:{ridge,base:0,opts:{partId:null,eyeM:obs.eyeM,ridge}};
  })();
  pending.catch(()=>{if(geometry.get(key)===pending)geometry.delete(key);});return pending;
 },20000);
 const full=()=>recordBounded(shaped?session.shapeMountains:session.mountains,JSON.stringify([obs,p.target,p.body,indexed]),()=>{session.prepares++;return AstroNotesAlign.prepareDailyView(obs,p.target,p.body,geo.opts);},shaped?96:384);
 let box;
 const far=day=>{
  if(shaped)return false;
  if(box===undefined){
   const g=AstroNotesAlign.geometryFrom(obs,p.target,{partId:null,eyeM:obs.eyeM});box=null;
   if(g&&Array.isArray(geo.ridge)&&geo.ridge.length&&geo.ridge.every(q=>Number.isFinite(q[0])&&Number.isFinite(q[1]))&&Number.isFinite(geo.base)){
    const ref=g.azimuth;let a0=0,a1=0,lo=Math.min(geo.base,g.angle),hi=g.angle;
    for(const [a,h] of geo.ridge){const d=(((a-ref)%360+540)%360)-180;a0=Math.min(a0,d);a1=Math.max(a1,d);lo=Math.min(lo,h);hi=Math.max(hi,h);}
    const w=(a1-a0)/2,bulge=(w*Math.PI/90)**2/16*180/Math.PI;box={c:ref+(a0+a1)/2,w:w+.002,lo:lo-bulge-.002,hi:hi+bulge+.002};
   }
  }
  return !!box&&recordTrackFar(obs,p.body,obs.eyeM,box,day,0);
 };
 const view=(day,at)=>{if(Number.isFinite(at)||!far(day))return full()(day,at);session.far=(session.far||0)+1;return [];};
 Object.defineProperty(view,'heightGeometry',{get:()=>full().heightGeometry});
 return view;
}
function recordDiscoveryView(session,shaped,obs,target,body,opts){
 const full=()=>recordPrepared(session,shaped,obs,target,body,opts);
 const view=(day,at)=>{if(Number.isFinite(at)||!recordFar(obs,target,body,opts,day,shaped))return full()(day,at);session.far=(session.far||0)+1;return [];};
 Object.defineProperty(view,'heightGeometry',{get:()=>full().heightGeometry});
 return view;
}
function recordPrepared(session,shaped,obs,target,body,opts){
 const views=shaped?session.shapeViews:session.pointViews,key=JSON.stringify([obs,target,body,opts]);
 return recordBounded(views,key,()=>{session.prepares++;return AstroNotesAlign.prepareDailyView(obs,target,body,opts);},shaped?128:192);
}
function recordSolverFor(session,variant,shaped,override){
 const terrain=override||session.terrain,align=Object.create(AstroNotesAlign);
 const prepare=(obs,target,body,opts)=>{const silhouette=variant==='opportunity'&&!aimIsMountain(target)?recordSilhouette(obs,target,opts):null;if(variant==='discovery'&&!opts.ridge&&!opts.silhouette)return recordDiscoveryView(session,shaped,obs,target,body,opts);
 return recordPrepared(session,shaped,obs,target,body,silhouette?{...opts,silhouette}:opts);};
 align.prepareDailyView=prepare;
 align.dailyView=(obs,target,body,day,{at,...opts}={})=>prepare(obs,target,body,opts)(day,at);
 const viewFor=(obs,p)=>{
  if(p.matchMode==='overlap'&&aimIsMountain(p.target)){
   if(variant==='discovery')return recordMountainView(session,shaped,obs,p,false);
   // Keep the registered-point set across date/body switches. Dense line/area
   // samples have a separate, smaller budget and cannot evict these views.
   const views=shaped?session.shapeMountains:session.mountains,key=JSON.stringify([obs,p.target,p.body,p.partId,p.matchMode]);
   return recordBounded(views,key,()=>{
    const pending=aimShootingView(obs,p.target,p.body,p.partId,p.matchMode).catch(e=>{if(views.get(key)===pending)views.delete(key);throw e;});
    return pending;
   },shaped?96:384);
  }
  // Explore's original spatial branch computes an exact gap for its crossing probes.
  // Keep that branch while sharing its prepareDailyView through align.dailyView.
  if(shaped&&variant==='discovery')return null;
  const o=AstroNotesShooting.searchOptions(p,aimIsMountain);
  if(!(o.broad&&o.disc||o.partId==='__whole'&&!aimIsMountain(p.target)))return null;
  return prepare(obs,p.target,p.body,{partId:o.partId,eyeM:obs.eyeM});
 };
 const elevationAt=(lat,lon)=>{
  const key=lat+','+lon;
  return recordBounded(terrain,key,()=>candidateElevation(lat,lon).then(value=>{if(!Number.isFinite(value))terrain.delete(key);return value;}),12000);
 };
 const solver=recordHeightSolver({align,observerAt:(f,g)=>aimObserverAt(aimSavedFrom(f),g),ensure:b=>AstroNotesBodies.ensure(b),viewFor,yieldTask:recordSearchYield,elevationAt});
 solver.elevationAt=elevationAt;return solver;
}
async function recordSearch(plan,entries,{isCurrent=()=>true,variant='discovery',terrainCache,onProgress=()=>{}}={}){
 const cancelled=()=>({rows:[],failed:0,cancelled:true});
 if(!isCurrent())return cancelled();
 const owner=auth?.token,loginId=auth?.loginId,generation=accessState.generation,revision=version;
 if(!owner||!toolAllowed('records'))return cancelled();
 const p=AstroNotesShooting.conditions(plan);if(!p)return {rows:[],failed:0};
 if(entries.length&&!AstroNotesAssets.modelsReady()){await AstroNotesAssets.ensureModels();if(!isCurrent()||owner!==auth?.token||loginId!==auth?.loginId||generation!==accessState.generation||revision!==version||!toolAllowed('records'))return cancelled();}
 const start=AstroNotesShooting.day(p.at),scope=recordSearchScope(),air=AstroNotesAtmosphere.dataKey(start);
 if(!recordSameScope(recordSearchSession?.scope,scope))recordSearchSession={scope,cache:createRecordSearchCache(),pointViews:new Map(),shapeViews:new Map(),mountains:new Map(),shapeMountains:new Map(),shapeSamples:new Map(),terrain:new Map(),solvers:new Map(),prepares:0};
 const session=recordSearchSession,current=()=>isCurrent()&&recordSearchSession===session&&recordSameScope(scope,recordSearchScope())&&air===AstroNotesAtmosphere.dataKey(start)&&toolAllowed('records');
 const planKey=JSON.stringify([start,air,p.target,p.body,p.partId,p.limb,p.matchMode]),rows=[],issues=[];
 let failed=0,checked=0,processed=0,stepM;
 for(const entry of entries){
  if(!current())return cancelled();
  const shaped=!!entry.place.shape,kind=shaped?variant:'point',solverKey=kind+(shaped?':shape':'');
  let solver=terrainCache?null:session.solvers.get(solverKey);
  if(!solver){solver=recordSolverFor(session,variant,shaped,terrainCache);if(!terrainCache)session.solvers.set(solverKey,solver);}
  const {discoveryKey,discoveryRecordIds,...place}=entry.place;
  const key=planKey+'|'+kind+'|'+JSON.stringify(Object.entries(place).sort(([a],[b])=>a.localeCompare(b)));
  const solve=async live=>{
   const value=variant==='opportunity'&&place.shape&&place.eyeHeightRangeAGL==null?await recordShapeOpportunity(session,{...p,at:start},place,entry.record,solver,live):await solver.candidates({...p,at:start},[{place,record:entry.record}],{isCurrent:live});
   const result=Array.isArray(value)?{rows:value,failed:0}:value;
   return {...result,rows:(result.rows||[]).map(({record,...row})=>row)};
  };
  const result=terrainCache?await solve(current):await session.cache.read(key,solve,current);
  if(!current()||result.cancelled)return cancelled();
  rows.push(...result.rows.map(row=>({...row,record:entry.record,...(discoveryKey?{place:{...row.place,discoveryKey,discoveryRecordIds}}:{})})));
  failed+=result.failed||0;checked+=result.checked||0;stepM=result.stepM??stepM;issues.push(...(result.issues||[]));
  onProgress({checked:++processed,total:entries.length});
  await recordSearchYield();
 }
 if(!current())return cancelled();
 rows.sort((a,b)=>a.event.at-b.event.at||a.place.name.localeCompare(b.place.name));
 return {rows,failed,...(checked?{checked}:{}),...(stepM?{stepM}:{}),...(issues.length?{issues}:{})};
}
// Use the forecast's existing mascot, speech bubble, track and motion rules.
function showRecordProgress(host,label,unit='件'){
 const element=(tag,cls)=>{const n=document.createElement(tag);n.className=cls;return n;};
 const node=element('div','note-wait record-search-progress'),character=element('span','note-wait-character'),bubble=element('div','note-wait-message'),headline=element('span','record-progress-title'),count=element('span','record-progress-count'),bar=element('div','note-progress'),
 fill=element('span','note-progress-fill');
 character.setAttribute('aria-hidden','true');count.setAttribute('aria-hidden','true');fill.setAttribute('aria-hidden','true');
 bar.setAttribute('role','progressbar');bar.setAttribute('aria-label','検索の進捗');bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');
 bar.append(fill);bubble.append(headline,count,bar);node.append(character,bubble);host.replaceChildren(node);
 let last='';
 function update(n,total,message=label){
  const known=Number.isInteger(n)&&Number.isInteger(total)&&total>0&&n>=0&&n<=total,key=[n,total,message].join('|');if(last===key)return;last=key;
  if(headline.textContent!==message)headline.textContent=message;
  count.textContent=known?' '+n+' / '+total+unit:'';
  if(known)bar.setAttribute('aria-valuetext',n+' / '+total+unit);else bar.removeAttribute('aria-valuetext');
  if(known&&n>0){const percent=Math.min(99,Math.floor(n/total*100));bar.removeAttribute('data-indeterminate');bar.setAttribute('aria-valuenow',String(percent));fill.style.transform='scaleX('+percent/100+')';}
  else{bar.setAttribute('data-indeterminate','');bar.removeAttribute('aria-valuenow');fill.style.removeProperty('transform');}
 }
 update(0,0);return {node,update};
}
function recordSearchReset(){
 if(recordSearchSession&&!recordSameScope(recordSearchSession.scope,recordSearchScope()))recordSearchSession=null;
 if(recordIndexMemo&&!recordSameScope(recordIndexMemo.scope,[auth?.token,auth?.loginId,accessState.generation,version]))recordIndexMemo=null;
}
