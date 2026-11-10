/* Building tops along a sight line: the PLATEAU top-height grid (tools/build-plateau-heights.py) and,
   for buildings it does not hold, GSI footprints with the tallest height of their type. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateHeights=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const R=6371008.8,RAD=Math.PI/180,LAT=22200,LON=18000,ROWS=185,COLS=225,MARGIN_M=1,NEAR_M=30,NODE_M=250;
// A GSI footprint without a PLATEAU height is clear only above the tallest of its type. In the 23 wards
// (PLATEAU measured heights) 99% of 3101 are under 21.9 m (max 52 m) and 99% of 3102 under 47.8 m;
// 3103 is 60 m or more, so only a ray above Japan's tallest building (330 m) passes it.
// Grounds along the GSI part are taken to lie within GROUND_RISE_M above the observer.
const GSI_MAX_M={3101:22,3102:60,3103:340},GROUND_RISE_M=300;
function meshCode(my,mx){const p=Math.floor(my/80),q=Math.floor(my%80/10),r=my%10,u=Math.floor(mx/80)-100,v=Math.floor(mx%80/10),w=mx%10;return ''+p+u+q+v+r+w;}
function decode(bytes){
 const n=ROWS*COLS,out=new Uint16Array(n);if(bytes.length!==2*n)throw Error('height-grid-size');
 for(let r=0;r<ROWS;r++){let v=0;for(let c=0;c<COLS;c++){const i=r*COLS+c;v=(v+(bytes[i]|bytes[n+i]<<8))&65535;out[i]=v;}}
 return out;
}
function destination(lat,lon,az,m){const d=m/R,a=lat*RAD,t=az*RAD,b=Math.asin(Math.sin(a)*Math.cos(d)+Math.cos(a)*Math.sin(d)*Math.cos(t));return {latitude:b/RAD,longitude:lon+Math.atan2(Math.sin(t)*Math.sin(d)*Math.cos(a),Math.cos(d)-Math.sin(a)*Math.sin(b))/RAD};}
function bearingM(a,b){const p=a.latitude*RAD,q=b.latitude*RAD,dl=(b.longitude-a.longitude)*RAD;
 const az=(Math.atan2(Math.sin(dl)*Math.cos(q),Math.cos(p)*Math.sin(q)-Math.sin(p)*Math.cos(q)*Math.cos(dl))/RAD+360)%360;
 const h=Math.sin((q-p)/2)**2+Math.cos(p)*Math.cos(q)*Math.sin(dl/2)**2;return {azimuth:az,m:2*R*Math.asin(Math.min(1,Math.sqrt(h)))};}
// Height above the sea-level sphere along the ray, as model-evaluator.js traces it: eye + b d + d^2/(2 R k).
function profile(observer,ray){
 const eye=observer.elevation+(observer.eyeM??1.5),c=1/(2*R*(ray.refractionK||1)),D=ray.maxM;
 const b=ray.endpoint?(ray.endpoint.elevation-eye)/D-D*c:Math.tan(ray.altitude*RAD);
 const h=d=>eye+b*d+c*d*d,vertex=-b/(2*c);
 return {eye,h,min:(a,z)=>vertex>a&&vertex<z?h(vertex):Math.min(h(a),h(z)),beyond:(top,d)=>h(d)>top&&b+2*c*d>0};
}
// Every grid cell the ground track crosses between two points, with the distances it enters and leaves it.
function cells(p0,p1,d0,d1,visit){
 const x0=p0.longitude*LON,y0=p0.latitude*LAT,x1=p1.longitude*LON,y1=p1.latitude*LAT,dx=x1-x0,dy=y1-y0;
 let cx=Math.floor(x0),cy=Math.floor(y0);const sx=Math.sign(dx),sy=Math.sign(dy),ex=Math.floor(x1),ey=Math.floor(y1);
 const tdx=dx?Math.abs(1/dx):Infinity,tdy=dy?Math.abs(1/dy):Infinity;
 let tx=dx?(sx>0?cx+1-x0:x0-cx)*tdx:Infinity,ty=dy?(sy>0?cy+1-y0:y0-cy)*tdy:Infinity,t=0;const at=s=>d0+(d1-d0)*s;
 for(let guard=0;guard<100000;guard++){
  const next=Math.min(tx,ty,1);if(visit(cx,cy,at(t),at(next))===false)return false;
  if(next>=1||cx===ex&&cy===ey)return true;
  if(Math.abs(tx-ty)<1e-12){
   // Through a corner: both side cells touch the line.
   if(visit(cx+sx,cy,at(tx),at(tx))===false||visit(cx,cy+sy,at(tx),at(tx))===false)return false;
   cx+=sx;cy+=sy;t=tx;tx+=tdx;ty+=tdy;
  }else if(tx<ty){cx+=sx;t=tx;tx+=tdx;}else{cy+=sy;t=ty;ty+=tdy;}
 }
 return true;
}
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
function create({fetchImpl=(typeof fetch==='function'?fetch.bind(globalThis):null),base='data/building-heights/',loadIndex=null,gsiAlong=null,groundAt=null,ownFootprint=null}={}){
 let indexPromise=null;const meshes=new Map(),ready=new Map(),overlays=new Map(),partLoads=new Map(),parts=new Map(),ownCells=new Map();
 // Cells of a user's target building (lat/lon rings), widened by one cell: that building is the target, not an obstacle.
 function ownSet(targetKey){
  if(!ownFootprint||!targetKey)return null;if(ownCells.has(targetKey))return ownCells.get(targetKey);
  const rings=ownFootprint(targetKey);let set=null;
  if(rings?.length){set=new Set();for(const ring of rings){const xs=ring.map(p=>p[1]*LON),ys=ring.map(p=>p[0]*LAT);
   for(let gy=Math.floor(Math.min(...ys))-1;gy<=Math.floor(Math.max(...ys))+1;gy++)for(let gx=Math.floor(Math.min(...xs))-1;gx<=Math.floor(Math.max(...xs))+1;gx++){
    let on=false;const x=gx+.5,y=gy+.5;for(let i=0,j=xs.length-1;i<xs.length;j=i++)if((ys[i]>y)!==(ys[j]>y)&&x<(xs[j]-xs[i])*(y-ys[i])/(ys[j]-ys[i])+xs[i])on=!on;
    if(on)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)set.add((gx+dx)+','+(gy+dy));}}}
  ownCells.set(targetKey,set);if(ownCells.size>32)ownCells.delete(ownCells.keys().next().value);return set;
 }
 // The main index lists one part per 1st-order mesh (about 80 km); a part lists its meshes. Only parts a line reaches are read.
 const index=()=>indexPromise||(indexPromise=(async()=>{const data=loadIndex?structuredClone(await loadIndex()):await (async()=>{const r=await fetchImpl(base+'index.json');if(!r.ok)throw Error('height-index');return r.json();})();
  data.highestM=Math.max(0,...Object.values(data.parts||{}).map(v=>v[2]??0),...Object.values(data.targets||{}).flatMap(t=>Object.values(t).map(v=>v.topM)));return data;})().catch(e=>{indexPromise=null;throw e;}));
 function part(p4,data){
  if(!partLoads.has(p4))partLoads.set(p4,(async()=>{const r=await fetchImpl(base+p4+'/index.json?v='+data.parts[p4][0]);if(!r.ok)throw Error('height-part');
   const bytes=await r.arrayBuffer();if(!(await sha(bytes)).startsWith(data.parts[p4][0]))throw Error('height-part-version');
   const list=JSON.parse(new TextDecoder().decode(bytes)).meshes;parts.set(p4,list);return list;})().catch(e=>{partLoads.delete(p4);throw e;}));
  return partLoads.get(p4);
 }
 async function mesh(code,entry){
  if(!meshes.has(code))meshes.set(code,(async()=>{const r=await fetchImpl(base+code.slice(0,4)+'/'+code+'.bin?v='+entry[0]);if(!r.ok)throw Error('height-mesh');
   // The part index names each file by its SHA-256; a different file is not used.
   const packed=await r.arrayBuffer();if(!(await sha(packed)).startsWith(entry[0]))throw Error('height-mesh-version');
   const grid=decode(new Uint8Array(await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()));ready.set(code,grid);return grid;})().catch(e=>{meshes.delete(code);throw e;}));
  if(meshes.size>160){const old=meshes.keys().next().value;meshes.delete(old);ready.delete(old);}
  return meshes.get(code);
 }
 // Target buildings live beside the grid; a ray aimed at one target passes through that target only.
 function overlay(code,data,targetKey){
  const key=code+'|'+targetKey;if(overlays.has(key))return overlays.get(key);
  const m=new Map(),own=new Set();for(const [id,byMesh] of Object.entries(data.targets||{})){if(!byMesh[code])continue;if(id===targetKey){for(const [i] of byMesh[code].cells)own.add(i);continue;}for(const [i,v] of byMesh[code].cells)if(v>(m.get(i)||0))m.set(i,v);}
  m.own=own;overlays.set(key,m);if(overlays.size>64)overlays.delete(overlays.keys().next().value);return m;
 }
 async function trace(observer,ray,{isCurrent=()=>true}={}){
  if(![observer.latitude,observer.longitude,observer.elevation,ray.maxM].every(Number.isFinite)||!(ray.maxM>0))return {status:'unknown',reason:'invalid-ray'};
  const data=await index(),offset=data.grid.offsetM,pr=profile(observer,ray);
  // Walk until the line is above every PLATEAU top and above any GSI footprint's bound, whichever is later.
  const stopAt=Math.max(data.highestM+MARGIN_M,observer.elevation+GSI_MAX_M[3103]+GROUND_RISE_M);
  const az=ray.endpoint?bearingM(observer,ray.endpoint).azimuth:ray.azimuth;
  const known=[],uncovered=[];let status='clear',hit=null,cellsChecked=0,reach=0;
  let pending=null,lastKey=null,code=null;const own=ownSet(ray.targetKey);
  const visit=(gx,gy,a,z)=>{
   if(own?.has(gx+','+gy)){known.push([a,z]);return;}
   const my=Math.floor(gy/ROWS),mx=Math.floor(gx/COLS);if(my*1e5+mx!==lastKey){lastKey=my*1e5+mx;code=meshCode(my,mx);}
   const p4=code.slice(0,4),list=data.parts?.[p4]?parts.get(p4):null;
   if(data.parts?.[p4]&&!list){pending={part:p4};return false;}
   const entry=list?.[code];
   if(!entry){const last=uncovered[uncovered.length-1];if(last&&last[1]>=a-.01)last[1]=Math.max(last[1],z);else uncovered.push([a,z]);return;}
   const grid=ready.get(code);if(!grid){pending={code,entry};return false;}
   const i=(gy-my*ROWS)*COLS+(gx-mx*COLS),others=overlay(code,data,ray.targetKey),v=Math.max(grid[i],others.get(i)||0);cellsChecked++;
   // Over the aimed target's own building: its outline is judged by the caller, and its GSI footprint is not an unknown building.
   if(others.own.has(i))known.push([a,z]);
   if(!v)return;
   known.push([a,z]);const top=v-offset,low=pr.min(a,z);
   if(low>top+MARGIN_M)return;
   if(low<top-2&&a>=NEAR_M){status='blocked';hit={distanceM:a,topM:top,rayM:low,code};return false;}
   if(status==='clear'){status='unknown';hit={distanceM:a,topM:top,rayM:low,code,reason:a<NEAR_M?'near-building':'within-margin'};}
  };
  // Resolve meshes as the walk reaches them; a missing mesh file is not evidence of open ground.
  let from={latitude:observer.latitude,longitude:observer.longitude},d=0;
  while(d<ray.maxM&&status!=='blocked'){
   if(!isCurrent())throw Error('candidate-cancelled');
   if(pr.beyond(stopAt,d))break;
   const e=Math.min(ray.maxM,d+NODE_M),to=ray.endpoint&&e>=ray.maxM?{latitude:ray.endpoint.latitude,longitude:ray.endpoint.longitude}:destination(observer.latitude,observer.longitude,az,e);
   const mark=[known.length,uncovered.length,status,hit,cellsChecked];
   for(;;){
    pending=null;const done=cells(from,to,d,e,visit);
    if(done!==false||!pending)break;
    known.length=mark[0];uncovered.length=mark[1];status=mark[2];hit=mark[3];cellsChecked=mark[4];
    try{if(pending.part)await part(pending.part,data);else await mesh(pending.code,pending.entry);}catch{return {status:'unknown',reason:'height-data-unavailable',source:'plateau-grid'};}
   }
   from=to;d=e;reach=e;
  }
  if(status==='blocked')return {status:'blocked',hit,cellsChecked,source:'plateau-grid'};
  // GSI footprints the grid does not hold (new buildings, places outside the wards).
  const gsiEnd=reach;
  let estimated=false,gsiCount=0;
  if(gsiEnd>0){
   const end=destination(observer.latitude,observer.longitude,az,gsiEnd),buildings=gsiAlong?await gsiAlong(observer,end):null;
   if(!Array.isArray(buildings))return {status:'unknown',reason:'footprints-unavailable',cellsChecked,source:'plateau-grid'};
   const cos=Math.cos(observer.latitude*RAD),ux=Math.sin(az*RAD),uy=Math.cos(az*RAD);
   for(const b of buildings){
    const cap=GSI_MAX_M[b.code];if(!cap)continue;
    const pts=b.ring.map(([la,lo])=>[(lo-observer.longitude)*111320*cos,(la-observer.latitude)*110540]);let a=Infinity,z=-Infinity;
    for(let i=0,j=pts.length-1;i<pts.length;j=i++){const [x1,y1]=pts[j],[x2,y2]=pts[i],ex=x2-x1,ey=y2-y1,den=ux*ey-uy*ex;if(Math.abs(den)<1e-9)continue;const t=(x1*ey-y1*ex)/den,u=(x1*uy-y1*ux)/den;if(u<0||u>1||t<0||t>gsiEnd)continue;a=Math.min(a,t);z=Math.max(z,t);}
    if(!Number.isFinite(a))continue;
    if(known.some(([p,q])=>q>=a-3&&p<=z+3))continue;
    gsiCount++;const low=pr.min(a,z);
    if(low>observer.elevation+cap+GROUND_RISE_M)continue;
    const ground=groundAt?await groundAt(b.entry||destination(observer.latitude,observer.longitude,az,a)):null;
    if(!Number.isFinite(ground))return {status:'unknown',reason:'footprint-ground-unknown',cellsChecked,source:'gsi-type-bound'};
    if(low>ground+cap+MARGIN_M){estimated=true;continue;}
    return {status:'unknown',reason:'building-height-unknown',hit:{distanceM:a,code:b.code,rayAboveGroundM:low-ground},cellsChecked,source:'gsi-type-bound'};
   }
  }
  // Outside the grid, a building missing from the GSI footprints would go unseen: say so where low buildings could reach the ray.
  if(uncovered.some(([a])=>a<gsiEnd&&pr.h(a)-observer.elevation<GSI_MAX_M[3102]))estimated=true;
  if(status==='unknown')return {status:'unknown',reason:hit?.reason||'within-margin',hit,cellsChecked,source:'plateau-grid'};
  return {status:'clear',cellsChecked,gsiChecked:gsiCount,heights:estimated?'estimated':'plateau',source:estimated?'gsi-type-bound':'plateau-grid',reachM:reach};
 }
 return {trace,index};
}
return {create,decode,meshCode,profile,cells,GSI_MAX_M,MARGIN_M};
});
