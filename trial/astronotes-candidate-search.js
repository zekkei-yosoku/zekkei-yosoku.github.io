/* Optional shape data: one request per asset, shared across screen generations. */
(function(global){
 'use strict';
 // A cached candidate may reintroduce this canonical loader. Keep current flights
 // and the same API when this page already understands the split surface asset.
 const previous=global.AstroNotesAssets;
 if(previous?.supportsSurfaceHulls){if(typeof module!=='undefined'&&module.exports)module.exports=previous;return;}
 function createLoader({manifest,integrity={},document=global.document,setTimer=global.setTimeout,clearTimer=global.clearTimeout,timeout=60000,ready}={}){
  const pending=new Map();
  function load(name){
   if(ready(name))return Promise.resolve();
   if(pending.has(name))return pending.get(name);
   const src=manifest[name];
   if(typeof src!=='string'||!/^astronotes-(?:(?:city|tower)-models|scene-hulls)\.js\?v=\d+$/.test(src))return Promise.reject(Error('Unknown shape asset'));
   let script,timer;
   const job=new Promise((resolve,reject)=>{
    script=document.createElement('script');let done=false;
    const finish=error=>{if(done)return;done=true;clearTimer(timer);script.onload=script.onerror=null;if(error){script.remove();reject(error);}else resolve();};
    script.src=src;script.async=true;
    if(integrity[name]){script.integrity=integrity[name];script.crossOrigin="anonymous";}
    script.onload=()=>finish(ready(name)?null:Error('Shape asset missing'));
    script.onerror=()=>finish(Error('Shape asset unavailable'));
    timer=setTimer(()=>finish(Error('Shape asset timeout')),timeout);
    document.head.append(script);
   }).finally(()=>{if(pending.get(name)===job)pending.delete(name);});
   pending.set(name,job);return job;
  }
  return {load};
 }
 const assets=[['city','astronotes-city-models.js'],['tower','astronotes-tower-models.js'],['surface','astronotes-scene-hulls.js']];
 const ready=name=>name==='astronotes-city-models.js'?!!global.AstroNotesCityModels:name==='astronotes-tower-models.js'?!!global.AstroNotesTowerModels:name==='astronotes-scene-hulls.js'?!!global.AstroNotesTrialSurfaceHulls:false;
 const meta=kind=>global.document?.querySelector('meta[name="shape-'+kind+'"]')?.content;
 // Cached HTML predates the surface meta. Its existing content version is a
 // safe cache key for the newly split asset until the HTML update arrives.
 const previousVersion=(meta('city')||meta('tower')||'').match(/\?v=(\d+)$/)?.[1];
 const manifest=Object.fromEntries(assets.map(([kind,name])=>[name,meta(kind)||(kind==='surface'&&previousVersion?name+'?v='+previousVersion:undefined)]));
 const integrity=Object.fromEntries(assets.map(([kind,name])=>[name,meta(kind+'-integrity')||'']));
 const loader=createLoader({manifest,integrity,ready});
 const names=assets.map(([,name])=>name);
 // An older loader can already be fetching city/tower data. Delegate those two
 // to it, retaining its shared flights and retry behavior, and add only surface.
 const legacyModels=typeof previous?.ensureModels==='function'?previous.ensureModels.bind(previous):null;
 const api={createLoader,supportsSurfaceHulls:true,modelsReady:()=>names.every(ready),ensureModels:()=>legacyModels?Promise.all([legacyModels(),loader.load('astronotes-scene-hulls.js')]):Promise.all(names.map(loader.load))};
 global.AstroNotesAssets=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);

/* Legacy global names remain aliases for cached integrations. */
if(typeof AstroNotesAssets!=='undefined')globalThis.SoramiAssets=AstroNotesAssets;if(typeof AstroNotesCityModels!=='undefined')globalThis.SoramiCityModels=AstroNotesCityModels;if(typeof AstroNotesTowerModels!=='undefined')globalThis.SoramiTowerModels=AstroNotesTowerModels;

// Pass candidate data as bytes so reloads do not leave WebKit reading a document-owned Blob.
function decompressCandidateBytes(bytes, format = 'gzip') {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let offset = 0;
  const source = new ReadableStream({
    pull(controller) {
      const end = Math.min(offset + 65536, data.byteLength);
      if (end > offset) controller.enqueue(data.subarray(offset, end));
      offset = end;
      if (offset === data.byteLength) controller.close();
    }
  });
  return new Response(source.pipeThrough(new DecompressionStream(format)));
}
/* Lossless packed PLATEAU geometry. Unpack only the building faces a ray needs. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateBuildings=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
async function decode(data){
 if(!data.arrays)return data;
 const unpack=async item=>{const packed=Uint8Array.from(atob(item.gzipBase64),c=>c.charCodeAt(0)),buffer=await decompressCandidateBytes(packed).arrayBuffer();if(buffer.byteLength!==item.elementCount*4)throw Error('packed-building-size');
 return new DataView(buffer);};
 const [vertices,indices,rings,faces]=await Promise.all(['vertexCoordinates','ringVertexIndices','ringOffsets','faceRingOffsets'].map(n=>unpack(data.arrays[n]))),q=data.quantization;
 const result={...data,buildings:data.buildings.map(b=>({...b,sourceSha256:b.sourceSha256||data.sourceSha256s[b.sourceIndex]}))};
 for(const b of result.buildings)Object.defineProperty(b,'polygons',{get(){const rows=[];for(let j=0;j<b.faceCount;j++){const face=b.firstFace+j,rr=[];for(let r=faces.getUint32(face*4,true);r<faces.getUint32((face+1)*4,true);r++){const ring=[];for(let i=rings.getUint32(r*4,true);
 i<rings.getUint32((r+1)*4,true);i++){const v=indices.getUint32(i*4,true)*3;ring.push([q.originLon+vertices.getInt32(v*4,true)*q.angularScale,q.originLat+vertices.getInt32((v+1)*4,true)*q.angularScale,vertices.getInt32((v+2)*4,true)*q.heightScale]);}rr.push(ring);
 }rows.push({id:data.targetPolygonIds?.[b.id]?.[j]||b.id+':source-face-index:'+j,sourcePolygonIndex:j,rings:rr});}return rows;}});
 return result;
}
return {decode};
});

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
 return walkGrid(p0.longitude*LON,p0.latitude*LAT,p1.longitude*LON,p1.latitude*LAT,d0,d1,visit);
}
function walkGrid(x0,y0,x1,y1,d0,d1,visit){
 const dx=x1-x0,dy=y1-y0;
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
function endpointKey(observer,ray){
 const endpoint=ray.endpoint;
 if(!endpoint||typeof ray.targetKey!=='string'||!ray.targetKey)return null;
 const values=[observer.latitude,observer.longitude,observer.elevation,observer.eyeM??1.5,endpoint.latitude,endpoint.longitude,endpoint.elevation,ray.maxM,ray.refractionK||1];
 return values.every(Number.isFinite)?JSON.stringify([ray.targetKey,...values]):null;
}
// An associated structure is still checked over its full OSM width. This only
// replaces unknown height when its complete polyline has a verified model.
function structureModelTop(o,data){
 const m=data.structureModels?.[o.id],g=m?.geometry,s=m?.source,polygons=m?.coverage?.polygons;
 if(!m||!g||!s||!['road','railway','bridge'].includes(o.kind)||o.kind!==g.kind||!Object.is(o.halfWidthM??0,g.halfWidthM))return null;
 if(!Number.isFinite(g.halfWidthM)||g.halfWidthM<0||!Number.isFinite(m.topM))return null;
 if(typeof s.url!=='string'||!/^[a-f0-9]{64}$/.test(s.sha256)||typeof s.buildingId!=='string'||!s.buildingId)return null;
 try{const url=new URL(s.url);if(url.protocol!=='https:'||!url.hostname||url.username||url.password)return null;}catch{return null;}
 if(!Array.isArray(s.surfaces)||s.surfaces.length<3||s.surfaces.some(id=>typeof id!=='string'||!id)||new Set(s.surfaces).size!==s.surfaces.length)return null;
 if(!Array.isArray(s.topRangeM)||s.topRangeM.length!==2||!s.topRangeM.every(Number.isFinite)||s.topRangeM[0]>s.topRangeM[1]||m.topM<Math.ceil(s.topRangeM[1]))return null;
 if(typeof s.lod!=='string'||!s.lod||!Number.isInteger(s.surveyYear)||typeof m.coverage?.basis!=='string'||!m.coverage.basis)return null;
 // This data contract describes complete line structures. Area/point models
 // need their own coverage proof and fall back to unknown in this version.
 if(!Array.isArray(g.rings)||!Array.isArray(g.points)||g.rings.length||g.points.length||(o.rings||[]).length||(o.points||[]).length)return null;
 const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=85&&Math.abs(p[1])<=180;
 if(!Array.isArray(o.lines)||!Array.isArray(g.lines)||!g.lines.length||o.lines.length!==g.lines.length)return null;
 for(let i=0;i<g.lines.length;i++){
  const a=o.lines[i],b=g.lines[i];if(!Array.isArray(a)||!Array.isArray(b)||b.length<2||a.length!==b.length)return null;
  for(let j=0;j<b.length;j++)if(!point(a[j])||!point(b[j])||!a[j].every((v,k)=>Object.is(v,b[j][k])))return null;
 }
 const cross=(a,b)=>a[0]*b[1]-a[1]*b[0],sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
 const crossing=(a,b,c,d)=>{
  const v=sub(b,a),w=sub(d,c),den=cross(v,w);if(!den)return null;
  const t=cross(sub(c,a),w)/den,u=cross(sub(c,a),v)/den;return u>=0&&u<=1&&t>=0&&t<=1?t:null;
 };
 const ringValid=ring=>{
  if(!Array.isArray(ring)||ring.length<4||ring.length>128||!ring.every(point)||!ring[0].every((v,k)=>v===ring.at(-1)[k]))return false;
  let area=0;for(let i=1;i<ring.length;i++)area+=cross(sub(ring[i-1],ring[0]),sub(ring[i],ring[0]));
  if(!Number.isFinite(area)||!area)return false;
  for(let i=1;i<ring.length;i++)for(let j=i+2;j<ring.length;j++)if(!(i===1&&j===ring.length-1)&&crossing(ring[i-1],ring[i],ring[j-1],ring[j])!==null)return false;
  return true;
 };
 if(!Array.isArray(polygons)||!polygons.length||polygons.length>16)return null;
 for(const p of polygons)if(!p||!ringValid(p.outer)||!Array.isArray(p.holes)||p.holes.length>16||!p.holes.every(ringValid))return null;
 const inside=(p,ring)=>{
  let found=false;
  for(let i=1;i<ring.length;i++){
   const a=ring[i-1],b=ring[i],v=sub(b,a),w=sub(p,a);
   // Refuse boundary-scale rounding instead of filling a microscopic gap.
   const vv=v[0]*v[0]+v[1]*v[1],t=vv?Math.max(0,Math.min(1,(w[0]*v[0]+w[1]*v[1])/vv)):0;
   if(Math.hypot(w[0]-t*v[0],w[1]-t*v[1])<=1e-10)return null;
   if((a[0]>p[0])!==(b[0]>p[0])&&p[1]<(b[1]-a[1])*(p[0]-a[0])/(b[0]-a[0])+a[1])found=!found;
  }
  return found;
 };
 const covered=p=>polygons.some(poly=>inside(p,poly.outer)===true&&poly.holes.every(h=>inside(p,h)===false));
 for(const line of g.lines)for(let i=1;i<line.length;i++){
  const a=line[i-1],b=line[i];if(!covered(a)||!covered(b))return null;
  const cuts=[0,1];for(const p of polygons)for(const ring of [p.outer,...p.holes])for(let j=1;j<ring.length;j++){
   const t=crossing(a,b,ring[j-1],ring[j]);if(t!==null)cuts.push(t);
  }
  cuts.sort((a,b)=>a-b);
  for(let j=1;j<cuts.length;j++)if(cuts[j]>cuts[j-1]){
   const t=(cuts[j]+cuts[j-1])/2;if(!covered([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]))return null;
  }
 }
 return m.topM;
}
function create({fetchImpl=(typeof fetch==='function'?fetch.bind(globalThis):null),base='data/building-heights/',loadIndex=null,gsiAlong=null,groundAt=null,ownFootprint=null,ownFootprintVersion=null,obstacles=null}={}){
 let indexPromise=null;const meshes=new Map(),ready=new Map(),overlays=new Map(),partLoads=new Map(),parts=new Map(),ownCells=new Map();
 const blockedEndpoints=new Map(),BLOCKED_ENDPOINT_LIMIT=1024;
 const footprintVersionOf=targetKey=>targetKey&&ownFootprint?ownFootprintVersion?.(targetKey):undefined;
 // Cells of a user's target building (lat/lon rings), widened by one cell: that building is the target, not an obstacle.
 function ownSet(targetKey,version=footprintVersionOf(targetKey)){
  if(!ownFootprint||!targetKey)return null;
  const cached=ownCells.get(targetKey);
  if(cached&&cached.version===version)return cached.set;
  const rings=ownFootprint(targetKey);let set=null;
  if(rings?.length){set=new Set();for(const ring of rings){const xs=ring.map(p=>p[1]*LON),ys=ring.map(p=>p[0]*LAT);
   for(let gy=Math.floor(Math.min(...ys))-1;gy<=Math.floor(Math.max(...ys))+1;gy++)for(let gx=Math.floor(Math.min(...xs))-1;gx<=Math.floor(Math.max(...xs))+1;gx++){
    let on=false;const x=gx+.5,y=gy+.5;for(let i=0,j=xs.length-1;i<xs.length;j=i++)if((ys[i]>y)!==(ys[j]>y)&&x<(xs[j]-xs[i])*(y-ys[i])/(ys[j]-ys[i])+xs[i])on=!on;
    if(on)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)set.add((gx+dx)+','+(gy+dy));}}}
  ownCells.set(targetKey,{version,set});if(ownCells.size>32)ownCells.delete(ownCells.keys().next().value);return set;
 }
 // The main index lists one part per 1st-order mesh (about 80 km); a part lists its meshes. Only parts a line reaches are read.
 let indexData=null;
 const index=()=>indexPromise||(indexPromise=(async()=>{const data=loadIndex?structuredClone(await loadIndex()):await (async()=>{const r=await fetchImpl(base+'index.json');if(!r.ok)throw Error('height-index');return r.json();})();
  data.highestM=Math.max(0,...Object.values(data.parts||{}).map(v=>v[2]??0),...Object.values(data.targets||{}).flatMap(t=>Object.values(t).map(v=>v.topM)));indexData=data;return data;})().catch(e=>{indexPromise=null;throw e;}));
 function part(p4,data){
  if(!partLoads.has(p4))partLoads.set(p4,(async()=>{const r=await fetchImpl(base+p4+'/index.json?v='+data.parts[p4][0],{signal:globalThis.AbortSignal?.timeout?.(20000)});if(!r.ok)throw Error('height-part');
   const bytes=await r.arrayBuffer();if(!(await sha(bytes)).startsWith(data.parts[p4][0]))throw Error('height-part-version');
   const list=JSON.parse(new TextDecoder().decode(bytes)).meshes;parts.set(p4,list);return list;})().catch(e=>{partLoads.delete(p4);throw e;}));
  return partLoads.get(p4);
 }
 async function mesh(code,entry){
  if(!meshes.has(code))meshes.set(code,(async()=>{const r=await fetchImpl(base+code.slice(0,4)+'/'+code+'.bin?v='+entry[0],{signal:globalThis.AbortSignal?.timeout?.(20000)});if(!r.ok)throw Error('height-mesh');
   // The part index names each file by its SHA-256; a different file is not used.
   const packed=await r.arrayBuffer();if(!(await sha(packed)).startsWith(entry[0]))throw Error('height-mesh-version');
   const grid=decode(new Uint8Array(await decompressCandidateBytes(packed).arrayBuffer()));ready.set(code,grid);return grid;})().catch(e=>{meshes.delete(code);throw e;}));
  if(meshes.size>160){const old=meshes.keys().next().value;meshes.delete(old);ready.delete(old);}
  return meshes.get(code);
 }
 // All height readers share six IO slots. A search uses at most three (current
 // mesh + two ahead); preview margins still leave a slot for a central reader.
 // Already-issued raw reads remain shared: cancelling one owner never aborts
 // a mesh another owner needs. Cancelled queued work starts no request.
 const heightReads=[],PREVIEW_READ_LIMIT=6,PREVIEW_MESH_LIMIT=256,PREVIEW_WAIT_MS=8000,PREVIEW_RANGE_M=50000;
 let activePreviewReads=0,activeSearchReads=0;
 function runPreviewReads(){
  while(activePreviewReads<PREVIEW_READ_LIMIT){
   for(let i=heightReads.length-1;i>=0;i--)if(!heightReads[i].owner.current()){heightReads.splice(i,1)[0].reject(Error('candidate-cancelled'));}
   let chosen=-1;
   for(let i=0;i<heightReads.length;i++){
    const kind=heightReads[i].owner.kind,search=kind==='demand'||kind==='ahead';
    if(search&&activeSearchReads>=3||kind==='frontage'&&activePreviewReads>=PREVIEW_READ_LIMIT-1)continue;
    if(chosen<0||readPriority(kind)<readPriority(heightReads[chosen].owner.kind))chosen=i;
   }
   if(chosen<0)return;
   const {load,owner,resolve,reject}=heightReads.splice(chosen,1)[0],search=owner.kind==='demand'||owner.kind==='ahead';
   activePreviewReads++;
   if(search)activeSearchReads++;
   Promise.resolve().then(()=>{requireCurrent(owner.current);return load();}).then(resolve,reject).finally(()=>{activePreviewReads--;if(search)activeSearchReads--;runPreviewReads();});
  }
 }
 const readPriority=kind=>({demand:0,center:1,ahead:2,frontage:3})[kind];
 function queueHeightRead(load,owner){return new Promise((resolve,reject)=>{heightReads.push({load,owner,resolve,reject});runPreviewReads();});}
 function queuePreviewRead(load,isCurrent,center){
  return queueHeightRead(load,{current:isCurrent,kind:center?'center':'frontage'});
 }
 const requireCurrent=isCurrent=>{if(!isCurrent())throw Error('candidate-cancelled');};
 function* sightline(observer,azimuth,maxM,endpoint=null){
  let from=observer;
  for(let d=0;d<maxM;){
   const end=Math.min(maxM,d+NODE_M),to=end===maxM&&endpoint?endpoint:destination(observer.latitude,observer.longitude,azimuth,end);
   yield {from,to,d,end};from=to;d=end;
  }
 }
 function meshReader(visit){
  let lastMy,lastMx,code;
  return (gx,gy,a,z)=>{
   const my=Math.floor(gy/ROWS),mx=Math.floor(gx/COLS);
   if(my!==lastMy||mx!==lastMx){lastMy=my;lastMx=mx;code=meshCode(my,mx);}
   visit(code,(gy-my*ROWS)*COLS+(gx-mx*COLS),a,z);
  };
 }
 function collectMeshes(observer,azimuth,maxM,needed,own,ownMeshes,endpoint=null){
  const remember=(code,a)=>{if(a<(needed.get(code)??Infinity))needed.set(code,a);};
  const fine=meshReader((code,_,a)=>remember(code,a));
  const visit=(gx,gy,a,z)=>{if(z>=NEAR_M&&!own?.has(gx+','+gy))fine(gx,gy,a,z);};
  const chord=[],onEdge=value=>Math.abs(value-Math.round(value))<1e-10;
  for(const {from,to,d,end} of sightline(observer,azimuth,maxM,endpoint)){
   const x0=from.longitude*LON/COLS,y0=from.latitude*LAT/ROWS,x1=to.longitude*LON/COLS,y1=to.latitude*LAT/ROWS;
   chord.length=0;let useFine=d<=NEAR_M||onEdge(x0)||onEdge(y0)||onEdge(x1)||onEdge(y1);
   if(!useFine){
    walkGrid(x0,y0,x1,y1,d,end,(mx,my,a,z)=>{
     const code=meshCode(my,mx);
     // Retain the fine traversal at corner touches and wherever target exclusions can change the first cell.
     if(a===z||ownMeshes?.has(code)){useFine=true;return false;}
     chord.push([code,a]);
    });
   }
   if(useFine)cells(from,to,d,end,visit);
   else for(const [code,a] of chord)remember(code,a);
  }
 }
 function containingMeshes(own){
  if(!own?.size)return null;
  const result=new Set();
  for(const cell of own){
   const [gx,gy]=cell.split(',').map(Number);
   result.add(meshCode(Math.floor(gy/ROWS),Math.floor(gx/COLS)));
  }
  return result;
 }
 // Enumerate service meshes, not cells or verdicts. The original ordered cell
 // walk below remains the only source of visibility evidence.
 function* orderedMeshes(observer,az,maxM,endpoint,beyond){
  const seen=new Set();
  for(const {from,to,d,end}of sightline(observer,az,maxM,endpoint)){
   if(beyond?.(d))return;
   const codes=[];
   walkGrid(from.longitude*LON/COLS,from.latitude*LAT/ROWS,to.longitude*LON/COLS,to.latitude*LAT/ROWS,d,end,(mx,my)=>{
    const code=meshCode(my,mx);if(!seen.has(code)){seen.add(code);codes.push(code);}
   });
   yield* codes;
  }
 }
 function orderedReader(data,observer,az,maxM,endpoint,isCurrent,beyond){
  const sequence=orderedMeshes(observer,az,maxM,endpoint,beyond),staged=new Map(),order=new Map();let open=true,finished=false;
  const current=()=>open&&isCurrent();
  const nextCode=()=>{const next=sequence.next();if(next.done){finished=true;return null;}order.set(next.value,order.size);return next.value;};
  function stage(code,kind){
   const owner={current,kind},entry={owner,promise:null};
   entry.promise=queueHeightRead(async()=>{
    requireCurrent(current);
    const p4=code.slice(0,4),list=data.parts?.[p4]?(parts.get(p4)||await part(p4,data)):null;
    requireCurrent(current);
    return list?.[code]?(ready.get(code)||await mesh(code,list[code])):null;
   },owner).then(value=>(entry.result={value}),error=>(entry.result={error}));
   staged.set(code,entry);return entry;
  }
  return {
   async read(code){
    requireCurrent(current);
    while(!order.has(code)&&!finished)nextCode();
    for(const key of staged.keys())if(order.get(key)<order.get(code))staged.delete(key);
    const entry=staged.get(code)||stage(code,'demand');entry.owner.kind='demand';runPreviewReads();
    if(entry.result?.error)throw entry.result.error;
    while(staged.size<3&&!finished){const code=nextCode();if(code===null)break;if(staged.has(code)||ready.has(code)||!data.parts?.[code.slice(0,4)])continue;stage(code,'ahead');}
    const result=await entry.promise;requireCurrent(current);staged.delete(code);
    // Preserve the first failed read until its ordered consumer reaches it.
    // Speculation must not silently retry malformed/missing data into success.
    if(result.error)throw result.error;
    return result.value;
   },
   close(){open=false;runPreviewReads();},
   failed:code=>!!staged.get(code)?.result?.error,
  };
 }
 async function readPreviewItems(keys,load,isCurrent,expires,center){
  const results=new Map();
  let open=true,timer;
  const current=()=>open&&isCurrent();
  const tasks=Promise.all([...keys].map(async key=>{
   try{const value=await queuePreviewRead(()=>load(key),current,center);if(current())results.set(key,value);}
   catch(e){if(e?.message==='candidate-cancelled'&&open)requireCurrent(isCurrent);}
  }));
  try{
   await Promise.race([tasks,new Promise(resolve=>{timer=setTimeout(()=>{open=false;resolve();},Math.max(0,expires-Date.now()));})]);
   requireCurrent(isCurrent);return results;
  }finally{open=false;clearTimeout(timer);}
 }
 async function prefetchGrids(data,needed,isCurrent,center=false){
  // Keep the nearest available roofs if a wide or slow request cannot load every mesh.
  const codes=[...needed].sort((a,b)=>a[1]-b[1]).slice(0,PREVIEW_MESH_LIMIT).map(([code])=>code);
  const expires=Date.now()+PREVIEW_WAIT_MS,partKeys=new Set();
  for(const code of codes){const p4=code.slice(0,4);if(data.parts?.[p4]&&!parts.has(p4))partKeys.add(p4);}
  await readPreviewItems(partKeys,p4=>part(p4,data),isCurrent,expires,center);
  const entries=new Map(),grids=new Map();
  for(const code of codes){
   const grid=ready.get(code),entry=parts.get(code.slice(0,4))?.[code];
   if(grid)grids.set(code,grid);else if(entry)entries.set(code,entry);
  }
  if(Date.now()>=expires)return grids;
  // Retain these grids for both passes of this call even if a wide view evicts them from the shared cache.
  const loaded=await readPreviewItems(entries.keys(),code=>mesh(code,entries.get(code)),isCurrent,expires,center);
  for(const [code,grid] of loaded)if(grid)grids.set(code,grid);
  return grids;
 }
 // Target buildings live beside the grid; a ray aimed at one target passes through that target only.
 function overlay(code,data,targetKey){
  const key=code+'|'+targetKey;if(overlays.has(key))return overlays.get(key);
  const m=new Map(),own=new Set();for(const [id,byMesh] of Object.entries(data.targets||{})){if(!byMesh[code])continue;if(id===targetKey){for(const [i] of byMesh[code].cells)own.add(i);continue;}for(const [i,v] of byMesh[code].cells)if(v>(m.get(i)||0))m.set(i,v);}
  m.own=own;overlays.set(key,m);if(overlays.size>64)overlays.delete(overlays.keys().next().value);return m;
 }
 // skipTrees: the caller read the trees' own heights on this line (tree-heights.js), so OSM woods add nothing.
 async function trace(observer,ray,{isCurrent=()=>true,skipTrees=false}={}){
  if(![observer.latitude,observer.longitude,observer.elevation,ray.maxM].every(Number.isFinite)||!(ray.maxM>0))return {status:'unknown',reason:'invalid-ray'};
  const data=await index();
  requireCurrent(isCurrent);
  const footprintVersion=footprintVersionOf(ray.targetKey),key=!ownFootprint||footprintVersion!==undefined?endpointKey(observer,ray):null;
  const confirmed=key&&blockedEndpoints.get(key);
  // The index instance pins all part/mesh versions. Footprint exclusions can change independently of it.
  if(confirmed&&confirmed.data===data&&confirmed.footprintVersion===footprintVersion){
   blockedEndpoints.delete(key);blockedEndpoints.set(key,confirmed);
   return {...confirmed.result,hit:{...confirmed.result.hit}};
  }
  const offset=data.grid.offsetM,pr=profile(observer,ray);
  // Walk until the line is above every PLATEAU top and above any GSI footprint's bound, whichever is later.
  const stopAt=Math.max(data.highestM+MARGIN_M,observer.elevation+GSI_MAX_M[3103]+GROUND_RISE_M);
  const az=ray.endpoint?bearingM(observer,ray.endpoint).azimuth:ray.azimuth;
  const known=[],uncovered=[];let status='clear',hit=null,cellsChecked=0,reach=0;
  let pending=null,lastKey=null,code=null;const own=ownSet(ray.targetKey,footprintVersion);
  const visit=(gx,gy,a,z)=>{
   if(own?.has(gx+','+gy)){known.push([a,z]);return;}
   const my=Math.floor(gy/ROWS),mx=Math.floor(gx/COLS);if(my*1e5+mx!==lastKey){lastKey=my*1e5+mx;code=meshCode(my,mx);}
   if(reads.failed(code)){pending={code};return false;}
   const p4=code.slice(0,4),list=data.parts?.[p4]?parts.get(p4):null;
   if(data.parts?.[p4]&&!list){pending={part:p4,code};return false;}
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
  const reads=orderedReader(data,observer,az,ray.maxM,ray.endpoint,isCurrent,d=>pr.beyond(stopAt,d));
  let from={latitude:observer.latitude,longitude:observer.longitude},d=0;
  try{
  while(d<ray.maxM&&status!=='blocked'){
   if(!isCurrent())throw Error('candidate-cancelled');
   if(pr.beyond(stopAt,d))break;
   const e=Math.min(ray.maxM,d+NODE_M),to=ray.endpoint&&e>=ray.maxM?{latitude:ray.endpoint.latitude,longitude:ray.endpoint.longitude}:destination(observer.latitude,observer.longitude,az,e);
   const mark=[known.length,uncovered.length,status,hit,cellsChecked];
   for(;;){
    pending=null;const done=cells(from,to,d,e,visit);
    if(done!==false||!pending)break;
    known.length=mark[0];uncovered.length=mark[1];status=mark[2];hit=mark[3];cellsChecked=mark[4];
    try{await reads.read(pending.code);}catch(e){requireCurrent(isCurrent);return {status:'unknown',reason:'height-data-unavailable',source:'plateau-grid'};}
   }
   from=to;d=e;reach=e;
  }
  }finally{reads.close();}
  if(status==='blocked'){
   requireCurrent(isCurrent);
   const result={status:'blocked',hit,cellsChecked,source:'plateau-grid'};
   if(key&&footprintVersionOf(ray.targetKey)===footprintVersion){
    blockedEndpoints.delete(key);
    blockedEndpoints.set(key,{data,footprintVersion,result:{...result,hit:{...hit}}});
    if(blockedEndpoints.size>BLOCKED_ENDPOINT_LIMIT)blockedEndpoints.delete(blockedEndpoints.keys().next().value);
   }
   return result;
  }
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
  // Trees and elevated structures (bundled OSM) have no height: the line must clear the tallest of their kind.
  if(obstacles&&reach>0){
   const capMax=30,obsEnd=(()=>{let x=0;while(x<reach&&!pr.beyond(observer.elevation+capMax+GROUND_RISE_M,x))x+=NODE_M/5;return Math.min(reach,x);})();
   if(obsEnd>0){
    const end=destination(observer.latitude,observer.longitude,az,obsEnd);let list;try{list=await obstacles(observer,end);}catch{return {status:'unknown',reason:'obstacles-unavailable',cellsChecked,source:'osm'};}
    const cos=Math.cos(observer.latitude*RAD),ux=Math.sin(az*RAD),uy=Math.cos(az*RAD),xy=([la,lo])=>[(lo-observer.longitude)*111320*cos,(la-observer.latitude)*110540];
    for(const o of list||[]){if(skipTrees&&o.kind==='tree')continue;let a=Infinity,z=-Infinity;
     const take=t=>{if(t>=0&&t<=obsEnd){a=Math.min(a,t);z=Math.max(z,t);}};
     for(const ring of o.rings||[]){const p=ring.map(xy);let inside=false;
      for(let i=0,j=p.length-1;i<p.length;j=i++){const [x1,y1]=p[j],[x2,y2]=p[i];if((y1>0)!==(y2>0)&&0<(x2-x1)*(0-y1)/(y2-y1)+x1)inside=!inside;const ex=x2-x1,ey=y2-y1,den=ux*ey-uy*ex;if(Math.abs(den)<1e-9)continue;const t=(x1*ey-y1*ex)/den,u=(x1*uy-y1*ux)/den;if(u>=0&&u<=1)take(t);}
      if(inside)take(0);}
     const near=(x,y,w)=>{const t=x*ux+y*uy,d=Math.abs(x*uy-y*ux);if(d<=w)take(t);};
     for(const line of o.lines||[]){const p=line.map(xy);for(let i=1;i<p.length;i++){const [x1,y1]=p[i-1],[x2,y2]=p[i],n=Math.max(1,Math.ceil(Math.hypot(x2-x1,y2-y1)/3));for(let k=0;k<=n;k++)near(x1+(x2-x1)*k/n,y1+(y2-y1)*k/n,o.halfWidthM);}}
     for(const pt of o.points||[]){const [x,y]=xy(pt);near(x,y,o.halfWidthM);}
     if(!Number.isFinite(a))continue;const low=pr.min(a,z);
     if(low>observer.elevation+o.capM+GROUND_RISE_M)continue;
     const ground=groundAt?await groundAt(destination(observer.latitude,observer.longitude,az,a)):null;
     if(!Number.isFinite(ground))return {status:'unknown',reason:'obstacle-ground-unknown',cellsChecked,source:'osm'};
     if(low<=ground+o.capM+MARGIN_M)return {status:'unknown',reason:o.kind==='tree'?'trees':'elevated-structure',hit:{distanceM:a,kind:o.kind,id:o.id,rayAboveGroundM:low-ground},cellsChecked,source:'osm'};
    }
   }
  }
  // Outside the grid, a building missing from the GSI footprints would go unseen: say so where low buildings could reach the ray.
  if(uncovered.some(([a])=>a<gsiEnd&&pr.h(a)-observer.elevation<GSI_MAX_M[3102]))estimated=true;
  if(status==='unknown')return {status:'unknown',reason:hit?.reason||'within-margin',hit,cellsChecked,source:'plateau-grid'};
  return {status:'clear',cellsChecked,gsiChecked:gsiCount,heights:estimated?'estimated':'plateau',source:estimated?'gsi-type-bound':'plateau-grid',reachM:reach};
 }
 // How high up the target's axis the building tops along the whole line hide it (2026-11-13, user: from 新宿御苑 the
 // buildings leave only Tokyo Tower's mast, so it is no candidate). PLATEAU tops only: GSI footprints have no height.
 async function skyline(observer,ray,{isCurrent=()=>true,preview=false}={}){
  if(!ray.endpoint||![observer.latitude,observer.longitude,observer.elevation,ray.maxM].every(Number.isFinite)||!(ray.maxM>0))return {status:'unknown',reason:'invalid-ray'};
  const data=await index(),offset=data.grid.offsetM,D=ray.maxM,c=1/(2*R*(ray.refractionK||1)),eye=observer.elevation+(observer.eyeM??1.5),own=ownSet(ray.targetKey);
  const az=bearingM(observer,ray.endpoint).azimuth,hide=(top,s)=>eye+(top-eye-c*s*s)/s*D+c*D*D;
  let previewGrids=null;
  if(preview&&D<=PREVIEW_RANGE_M){
   requireCurrent(isCurrent);
   if(D<=NEAR_M)return {status:'ok',toM:-Infinity,distanceM:null,topM:null,complete:false};
   const needed=new Map();
   collectMeshes(observer,az,D,needed,own,containingMeshes(own),ray.endpoint);
   previewGrids=await prefetchGrids(data,needed,isCurrent,true);
  }
  let best=null,uncovered=0,pending=null,lastKey=null,code=null;
  const visit=(gx,gy,a,z)=>{
   if(a<NEAR_M||own?.has(gx+','+gy))return;
   const my=Math.floor(gy/ROWS),mx=Math.floor(gx/COLS);if(my*1e5+mx!==lastKey){lastKey=my*1e5+mx;code=meshCode(my,mx);}
   if(reads.failed(code)){pending={code};return false;}
   const p4=code.slice(0,4),list=data.parts?.[p4]?parts.get(p4):null;
   if(data.parts?.[p4]&&!list){pending={part:p4,code};return false;}
   const entry=list?.[code];if(!entry){uncovered++;return;}
   const grid=previewGrids?previewGrids.get(code):ready.get(code);if(!grid){pending={code,entry};return false;}
   const i=(gy-my*ROWS)*COLS+(gx-mx*COLS),others=overlay(code,data,ray.targetKey);if(others.own.has(i))return;
   const v=Math.max(grid[i],others.get(i)||0);if(!v)return;
   const top=v-offset,toM=Math.max(hide(top,a),hide(top,Math.max(z,a+.01)));
   if(!best||toM>best.toM)best={toM,distanceM:a,topM:top};
  };
  const reads=orderedReader(data,observer,az,D,ray.endpoint,isCurrent);
  let from={latitude:observer.latitude,longitude:observer.longitude},d=0;
  try{
  while(d<D){
   if(!isCurrent())throw Error('candidate-cancelled');
   const e=Math.min(D,d+NODE_M),to=e>=D?{latitude:ray.endpoint.latitude,longitude:ray.endpoint.longitude}:destination(observer.latitude,observer.longitude,az,e),mark=[best,uncovered];
   for(;;){
    pending=null;const done=cells(from,to,d,e,visit);
    if(done!==false||!pending)break;
    if(previewGrids)return {status:'unknown',reason:'height-data-unavailable'};
    [best,uncovered]=mark;
    try{await reads.read(pending.code);}catch(e){requireCurrent(isCurrent);return {status:'unknown',reason:'height-data-unavailable'};}
   }
   from=to;d=e;
  }
  }finally{reads.close();}
  return {status:'ok',toM:best?.toM??-Infinity,distanceM:best?.distanceM??null,topM:best?.topM??null,complete:uncovered===0};
 }
 // The building top (sea-level metres) at a point without waiting: 0 for no building or the aimed target's own cells,
 // null where no PLATEAU mesh covers it, undefined while the index, part or mesh is still to be read (loadAt reads it).
 let lastMesh=null;
 function topNow(lat,lon,targetKey){
  const data=indexData;if(!data)return undefined;const gy=Math.floor(lat*LAT),gx=Math.floor(lon*LON),own=ownSet(targetKey);if(own?.has(gx+','+gy))return 0;
  const my=Math.floor(gy/ROWS),mx=Math.floor(gx/COLS);let m=lastMesh;
  if(!m||m.my!==my||m.mx!==mx||m.targetKey!==targetKey){
   const code=meshCode(my,mx),p4=code.slice(0,4);if(!data.parts?.[p4])return null;const list=parts.get(p4);if(!list)return undefined;const entry=list[code];if(!entry)return null;
   const grid=ready.get(code);if(!grid)return undefined;m=lastMesh={my,mx,targetKey,grid,others:overlay(code,data,targetKey)};
  }
  const i=(gy-my*ROWS)*COLS+(gx-mx*COLS);if(m.others.own.has(i))return 0;const v=Math.max(m.grid[i],m.others.get(i)||0);return v?v-data.grid.offsetM:0;
 }
 async function loadAt(lat,lon,{isCurrent=()=>true}={}){
  requireCurrent(isCurrent);
  const data=await index(),gy=Math.floor(lat*LAT),gx=Math.floor(lon*LON),my=Math.floor(gy/ROWS),mx=Math.floor(gx/COLS),code=meshCode(my,mx),p4=code.slice(0,4);
  if(!data.parts?.[p4])return;
  await queueHeightRead(async()=>{const list=parts.get(p4)||await part(p4,data);requireCurrent(isCurrent);if(list[code])await mesh(code,list[code]);},{current:isCurrent,kind:'demand'});
 }
 // New-place tower quality uses every cell of a conservative width patch.
 // Missing PLATEAU coverage is unknown: GSI class percentiles are not height
 // upper bounds. This path never uses the padded target footprint exclusion.
 async function upperPatch(patch,targetKey,{isCurrent=()=>true,check=()=>requireCurrent(isCurrent)}={}){
  check();
  // obstaclesAlong returns all rows in its padded bbox, using the crossed
  // 0.01-degree cells and neighbours. A patch narrower than half a cell has
  // every bbox cell in that neighbourhood; larger/custom envelopes stay unknown.
  if(!obstacles||patch.east-patch.west>.005||patch.north-patch.south>.005)return {status:'unknown',reason:'upper-obstacles-unavailable'};
  const extra=await obstacles({latitude:patch.south,longitude:patch.west},{latitude:patch.north,longitude:patch.east});check();
  if(!Array.isArray(extra))return {status:'unknown',reason:'upper-obstacles-unavailable'};
  const data=await index();check();
  const overlaps=(a,b,width=0,refine=true,modelTop=null)=>{
   if(!Number.isFinite(width)||width<0)return true;
   const py=width/110000,px=py/Math.cos(Math.max(Math.abs(a[0]),Math.abs(b[0]))*RAD);
   let lo=0,hi=1;
   for(const [v,d,min,max]of [[a[0],b[0]-a[0],patch.south-py,patch.north+py],[a[1],b[1]-a[1],patch.west-px,patch.east+px]]){
    if(Math.abs(d)<1e-15){if(v<min||v>max)return false;continue;}
    const t0=(min-v)/d,t1=(max-v)/d;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));if(lo>hi)return false;
   }
   if(!refine)return true;
   // The clipped centre segment plus its full width encloses every contact.
   // +Infinity alone means outside the tower fan/range; missing/NaN heights
   // cannot prove absence. Outward padding preserves touching endpoints.
   const ay=a[0]+lo*(b[0]-a[0]),ax=a[1]+lo*(b[1]-a[1]),by=a[0]+hi*(b[0]-a[0]),bx=a[1]+hi*(b[1]-a[1]),pad=1e-10;
   const box={south:Math.min(ay,by)-py-pad,north:Math.max(ay,by)+py+pad,west:Math.min(ax,bx)-px-pad,east:Math.max(ax,bx)+px+pad};
   const low=typeof patch.lowAt==='function'?patch.lowAt(box):patch.lowM;
   if(typeof patch.lowAt==='function'&&low===Infinity)return false;
   return !(modelTop!==null&&Number.isFinite(low)&&low>modelTop+MARGIN_M);
  };
  for(const o of extra){
   if(o.kind==='tree')continue; // Native canopy cells are checked independently.
   const geometry=[...(o.lines||[]),...(o.rings||[]),o.points||[]].flat();
   if(!geometry.length||geometry.some(p=>!Array.isArray(p)||p.length<2||!p.slice(0,2).every(Number.isFinite)))return {status:'unknown',reason:'upper-obstacle-geometry-unavailable'};
   const modelTop=structureModelTop(o,data);
   let touch=(o.points||[]).some(p=>overlaps(p,p,o.halfWidthM??0,true,modelTop));
   for(const line of [...(o.lines||[]),...(o.rings||[])]){
    const ring=(o.rings||[]).includes(line);
    // Filled rings keep their broad intersection: filtering only their edges
    // would not prove the enclosed interior outside the fan.
    for(let i=1;i<line.length&&!touch;i++)touch=overlaps(line[i-1],line[i],o.halfWidthM??0,!ring,modelTop);
    if(!touch&&ring&&line.length>1)touch=overlaps(line.at(-1),line[0],o.halfWidthM??0,false);
    // A large closed ring may contain the entire patch without an edge touch.
    if(!touch&&(o.rings||[]).includes(line)){
     const x=(patch.west+patch.east)/2,y=(patch.south+patch.north)/2;let inside=false;
     for(let i=0,j=line.length-1;i<line.length;j=i++)if((line[i][0]>y)!==(line[j][0]>y)&&x<(line[j][1]-line[i][1])*(y-line[i][0])/(line[j][0]-line[i][0])+line[i][1])inside=!inside;
     touch=inside;
    }
   }
   if(touch)return {status:'unknown',reason:'upper-structure-height-unknown',kind:o.kind,obstacleId:o.id,fromM:patch.fromM,toM:patch.toM};
  }
  let count=0,lastCode=null,grid,other;
  for(let gy=Math.floor(patch.south*LAT);gy<=Math.floor(patch.north*LAT);gy++)for(let gx=Math.floor(patch.west*LON);gx<=Math.floor(patch.east*LON);gx++){
   check();const my=Math.floor(gy/ROWS),mx=Math.floor(gx/COLS),code=meshCode(my,mx),p4=code.slice(0,4);
   if(code!==lastCode){
    if(!data.parts?.[p4])return {status:'unknown',reason:'height-coverage-unavailable'};
    await queueHeightRead(async()=>{const list=parts.get(p4)||await part(p4,data);check();if(list[code])await mesh(code,list[code]);},{current:isCurrent,kind:'demand'});check();
    if(!parts.get(p4)?.[code]||!ready.has(code))return {status:'unknown',reason:'height-coverage-unavailable'};
    lastCode=code;grid=ready.get(code);other=overlay(code,data,targetKey);
   }
   const i=(gy-my*ROWS)*COLS+(gx-mx*COLS),v=Math.max(grid[i],other.get(i)||0);count++;
   const low=patch.lowAt?.({west:gx/LON,east:(gx+1)/LON,south:gy/LAT,north:(gy+1)/LAT})??patch.lowM;
   if(!v||low>v-data.grid.offsetM+MARGIN_M)continue;
   // Target-only overlay cells are absent from the base grid. A base height
   // at the same cell cannot be separated from an associated/adjacent building.
   if(other.own.has(i))return {status:'unknown',reason:'target-building-contact'};
   return {status:low<v-data.grid.offsetM-2?'blocked':'unknown',reason:'upper-building',topM:v-data.grid.offsetM,rayM:low,cells:count};
  }
  return {status:'clear',cells:count,source:'plateau-grid',estimated:false};
 }
 // The highest a building top rises above the eye along each bearing (deg, with the earth's curve), up to maxM: whether
 // other buildings stand into the sky beside the target in the photograph (generic-evaluator.js compositionOf). PLATEAU
 // tops only; the aimed target's own cells are left out.
 async function angles(observer,azimuths,maxM,{targetKey=null,isCurrent=()=>true,refractionK=7/6}={}){
  const eye=observer.elevation+(observer.eyeM??1.5),c=1/(2*R*refractionK),out=[];
  for(const az of azimuths){
   let best=-Infinity,d=NEAR_M;
   while(d<maxM){
    if(!isCurrent())throw Error('candidate-cancelled');
    const p=destination(observer.latitude,observer.longitude,az,d);let top=topNow(p.latitude,p.longitude,targetKey);
    if(top===undefined){try{await loadAt(p.latitude,p.longitude,{isCurrent});}catch{requireCurrent(isCurrent);return null;}top=topNow(p.latitude,p.longitude,targetKey);}
    if(Number.isFinite(top)&&top>0)best=Math.max(best,Math.atan2(top-eye-c*d*d,d)/RAD);
    d+=d<1000?5:d<5000?10:20;
   }
   out.push(best);
  }
  return out;
 }
 // Preview-only skyline. A known roof establishes a lower bound even when another cell on the same bearing is missing.
 // complete describes just the sampled interval [NEAR_M, maxM], not other obstacle types or the real world's coverage.
 async function frontage(observer,azimuths,maxM,{targetKey=null,refractionK=7/6,isCurrent=()=>true}={}){
  requireCurrent(isCurrent);
  const unread=()=>({angle:-Infinity,complete:false});
  if(!azimuths.length)return [];
  if(![observer.latitude,observer.longitude,observer.elevation,maxM,refractionK].every(Number.isFinite)||!(maxM>NEAR_M&&refractionK>0))return azimuths.map(unread);
  let data;
  try{data=await index();}catch{requireCurrent(isCurrent);return azimuths.map(unread);}
  const range=Math.min(maxM,PREVIEW_RANGE_M);
  const eye=observer.elevation+(observer.eyeM??1.5),c=1/(2*R*refractionK),own=ownSet(targetKey),needed=new Map(),rows=[];
  const ownMeshes=containingMeshes(own);
  const now=()=>typeof performance==='undefined'?Date.now():performance.now();
  const yieldWalk=()=>new Promise(resolve=>setTimeout(resolve,0));
  let deadline=now()+6;
  for(let i=0;i<azimuths.length;i++){
   requireCurrent(isCurrent);
   if(Number.isFinite(azimuths[i]))collectMeshes(observer,azimuths[i],range,needed,own,ownMeshes);
   if(now()>=deadline){await yieldWalk();deadline=now()+6;}
  }
  const grids=await prefetchGrids(data,needed,isCurrent);
  deadline=now()+6;
  for(let i=0;i<azimuths.length;i++){
   requireCurrent(isCurrent);
   const azimuth=azimuths[i];
   let angle=-Infinity,complete=Number.isFinite(azimuth);
   if(complete){
    let lastCode,grid,other;
    const roof=meshReader((code,cell,a,z)=>{
     if(code!==lastCode){lastCode=code;grid=grids.get(code);other=grid?overlay(code,data,targetKey):null;}
     if(!grid){complete=false;return;}
     if(other.own.has(cell))return;
     const v=Math.max(grid[cell],other.get(cell)||0);
     if(!v)return;
     const h=v-data.grid.offsetM-eye,lo=Math.max(NEAR_M,a);
     const slope=d=>h/d-c*d;
     // Below the eye, the apparent maximum may be inside the cell rather than at either edge.
     const peak=h<0?Math.max(lo,Math.min(z,Math.sqrt(-h/c))):lo;
     angle=Math.max(angle,Math.atan(slope(peak))/RAD);
    });
    const visit=(gx,gy,a,z)=>{if(z>=NEAR_M&&!own?.has(gx+','+gy))roof(gx,gy,a,z);};
    for(const {from,to,d,end} of sightline(observer,azimuth,range)){
     cells(from,to,d,end,visit);
     if(now()>=deadline){await yieldWalk();requireCurrent(isCurrent);deadline=now()+6;}
    }
   }
   rows.push({angle,complete:complete&&range===maxM});
  }
  requireCurrent(isCurrent);return rows;
 }
 return {trace,skyline,index,topNow,loadAt,angles,frontage,upperPatch};
}
return {create,decode,meshCode,profile,cells,GSI_MAX_M,MARGIN_M};
});

/* Tree tops along a sight line (2026-11-13, user: 新宿御苑's trees were not judged; "必要ならば全部やって"). The Meta/WRI
   canopy height map v2 (CC BY 4.0) is read where a line needs it: Cloud Optimized GeoTIFFs on Source Cooperative, one
   file per zoom-10 quadkey (Web Mercator), 512 px DEFLATE blocks of uint8 metres above the ground. The 2.39 m overview is
   the mean of 2x2 full pixels and keeps crown tops within a metre (checked over 新宿御苑). */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesTreeHeights=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const R=6371008.8,RM=6378137,RAD=Math.PI/180,ZOOM=10,HEAD_BYTES=131072;
// Trees nearer than NEAR_M (30 m, the building grid's near zone) are stepped around; past RANGE_M a 25 m crown is under 0.3 degrees and the terrain decides.
// The last END_M before the target is its own ground (a summit's slope, a tower's park). Crowns under MIN_M are shrubs.
const NEAR_M=30,RANGE_M=5000,END_M=300,MIN_M=3,MARGIN_M=2,TALLEST_M=45,GROUND_BIN_M=25;
// The map puts crown tops 2-3 m low: against Tokyo's 2023 airborne laser survey over 新宿御苑 (two 1/500 sheets, 23,000
// pixels outside buildings) the highest laser return within 1.5 m was 1.03 x map + 2.3 m. Crowns are raised by 2 m.
const CROWN_ADD_M=2;
// A step of one 2.4 m pixel near the stand point, wider where a crown spans several steps anyway.
const stepAt=d=>d<500?2:d<2000?4:8;
const BASE='https://data.source.coop/tge-labs/meta-chm-v2/chm/';
function quadkey(x,y,z=ZOOM){let q='';for(let i=z;i>0;i--){const m=1<<(i-1);q+=((x&m)?1:0)+((y&m)?2:0);}return q;}
function tileOf(lat,lon){const n=2**ZOOM;return {x:Math.floor((lon+180)/360*n),y:Math.floor((1-Math.asinh(Math.tan(lat*RAD))/Math.PI)/2*n)};}
const merc=(lat,lon)=>[RM*lon*RAD,RM*Math.log(Math.tan(Math.PI/4+lat*RAD/2))];
function destination(lat,lon,az,m){const d=m/R,a=lat*RAD,t=az*RAD,b=Math.asin(Math.sin(a)*Math.cos(d)+Math.cos(a)*Math.sin(d)*Math.cos(t));
 return {latitude:b/RAD,longitude:lon+Math.atan2(Math.sin(t)*Math.sin(d)*Math.cos(a),Math.cos(d)-Math.sin(a)*Math.sin(b))/RAD};}
function bearingM(a,b){const p=a.latitude*RAD,q=b.latitude*RAD,dl=(b.longitude-a.longitude)*RAD;
 const az=(Math.atan2(Math.sin(dl)*Math.cos(q),Math.cos(p)*Math.sin(q)-Math.sin(p)*Math.cos(q)*Math.cos(dl))/RAD+360)%360;
 const h=Math.sin((q-p)/2)**2+Math.cos(p)*Math.cos(q)*Math.sin(dl/2)**2;return {azimuth:az,m:2*R*Math.asin(Math.min(1,Math.sqrt(h)))};}
// The TIFF directories a COG needs (classic TIFF, either byte order). An array that lies past the bytes read is returned
// as {at,count,size} for the caller to fetch.
function directories(buf){
 const v=new DataView(buf),le=v.getUint16(0)===0x4949,u16=o=>v.getUint16(o,le),u32=o=>v.getUint32(o,le);
 if(u16(2)!==42)throw Error('canopy-not-classic-tiff');
 const SIZE={1:1,3:2,4:4,5:8,12:8,16:8},out=[];let off=u32(4);
 for(let guard=0;off&&off+2<=buf.byteLength&&guard<64;guard++){
  const n=u16(off),d={};
  for(let i=0;i<n;i++){
   const e=off+2+i*12,tag=u16(e),type=u16(e+2),count=u32(e+4),size=(SIZE[type]||1)*count,at=size<=4?e+8:u32(e+8);
   const read=k=>type===3?u16(at+2*k):type===12?v.getFloat64(at+8*k,le):u32(at+4*k);
   if(at+size>buf.byteLength){d[tag]={at,count,size:SIZE[type]||1};continue;}
   d[tag]=count===1?read(0):Array.from({length:count},(_,k)=>read(k));
  }
  out.push(d);off=u32(off+2+n*12);
 }
 return out;
}
function create({fetchImpl=(typeof fetch==='function'?fetch.bind(globalThis):null),base=BASE,groundAt=null,level=1,maxBlocks=96}={}){
 const heads=new Map(),blocks=new Map(),infos=new Map(),ready=new Map();
 const range=async(url,a,b)=>{const r=await fetchImpl(url,{headers:{Range:`bytes=${a}-${b}`},signal:globalThis.AbortSignal?.timeout?.(20000)});
  if(r.status===404)return null;if(!r.ok)throw Error('canopy-fetch');return r.arrayBuffer();};
 // One file per quadkey: its directory once. A missing file (open sea) holds no trees.
 function head(q){
  if(!heads.has(q))heads.set(q,(async()=>{
   const url=base+q+'.tif',buf=await range(url,0,HEAD_BYTES-1);if(!buf)return null;
   const dirs=directories(buf).filter(d=>d[258]===8&&Number.isFinite(d[256])).sort((a,b)=>b[256]-a[256]),full=dirs[0];
   const pick=dirs[Math.min(level,dirs.length-1)];if(!full||!pick||pick[259]!==8||pick[322]!==512)throw Error('canopy-format');
   for(const tag of [324,325])if(typeof pick[tag]==='number')pick[tag]=[pick[tag]];else if(!Array.isArray(pick[tag])){const p=pick[tag],more=await range(url,p.at,p.at+p.count*p.size-1),dv=new DataView(more),le=new DataView(buf).getUint16(0)===0x4949;
    pick[tag]=Array.from({length:p.count},(_,k)=>p.size===2?dv.getUint16(2*k,le):dv.getUint32(4*k,le));}
   const scale=full[33550][0]*full[256]/pick[256];
   const info={url,x0:full[33922][3],y0:full[33922][4],scale,width:pick[256],height:pick[257]??pick[256],across:Math.ceil(pick[256]/512),offsets:pick[324],counts:pick[325]};infos.set(q,info);return info;
  })().catch(e=>{heads.delete(q);throw e;}));
  return heads.get(q);
 }
 async function block(info,bx,by){
  const key=info.url+'#'+bx+','+by;if(blocks.has(key)){const b=blocks.get(key);blocks.delete(key);blocks.set(key,b);return b;}
  const p=(async()=>{const i=by*info.across+bx,raw=await range(info.url,info.offsets[i],info.offsets[i]+info.counts[i]-1);
   const out=new Uint8Array(await decompressCandidateBytes(raw, 'deflate').arrayBuffer());
   if(out.length!==512*512)throw Error('canopy-block-size');ready.set(key,out);return out;})().catch(e=>{blocks.delete(key);throw e;});
  blocks.set(key,p);while(blocks.size>maxBlocks){const old=blocks.keys().next().value;blocks.delete(old);ready.delete(old);}return p;
 }
 // Without waiting when the file's directory and the block are already read (most steps of a walk).
 let lastTile=null,lastBlock=null;
 function canopyNow(lat,lon){
  const t=tileOf(lat,lon);let info;
  if(lastTile&&lastTile.x===t.x&&lastTile.y===t.y)info=lastTile.info;else{info=infos.get(quadkey(t.x,t.y));if(!info)return undefined;lastTile={x:t.x,y:t.y,info};}
  const [X,Y]=merc(lat,lon),col=Math.floor((X-info.x0)/info.scale),row=Math.floor((info.y0-Y)/info.scale);
  if(col<0||row<0||col>=info.across*512||row>=info.across*512)return 0;
  const bx=col>>9,by=row>>9;let b;
  if(lastBlock&&lastBlock.info===info&&lastBlock.bx===bx&&lastBlock.by===by)b=lastBlock.b;else{b=ready.get(info.url+'#'+bx+','+by);if(!b)return undefined;lastBlock={info,bx,by,b};}
  return b[(row&511)*512+(col&511)];
 }
 async function canopy(lat,lon){
  const t=tileOf(lat,lon),info=await head(quadkey(t.x,t.y));if(!info)return 0;
  const [X,Y]=merc(lat,lon),col=Math.floor((X-info.x0)/info.scale),row=Math.floor((info.y0-Y)/info.scale);
  if(col<0||row<0||col>=info.across*512||row>=info.across*512)return 0;
  const b=await block(info,col>>9,row>>9);return b[(row&511)*512+(col&511)];
 }
 // One walk gives the line's verdict and how high up the target the crowns hide it. The ray is the parabola the building
 // grid uses (eye + b d + d^2 / (2 R k)); crowns stand on the DEM ground. `footM` bounds the walk for the hidden part.
 async function sight(observer,ray,{isCurrent=()=>true,sampleGround=groundAt}={}){
  if(!sampleGround||![observer.latitude,observer.longitude,observer.elevation,ray.maxM].every(Number.isFinite))return {status:'unread',reason:'no-ground'};
  const eye=observer.elevation+(observer.eyeM??1.5),c=1/(2*R*(ray.refractionK||1)),D=ray.maxM;
  const b=ray.endpoint?(ray.endpoint.elevation-eye)/D-D*c:Math.tan(ray.altitude*RAD),h=d=>eye+b*d+c*d*d;
  const foot=ray.endpoint&&Number.isFinite(ray.footM)?(ray.footM-eye)/D-D*c:null,low=d=>foot===null?h(d):Math.min(h(d),eye+foot*d+c*d*d);
  const az=ray.endpoint?bearingM(observer,ray.endpoint).azimuth:ray.azimuth,end=Math.min(RANGE_M,ray.endpoint?D-END_M:D),grounds=new Map();
  const hide=(top,s)=>eye+(top-eye-c*s*s)/s*D+c*D*D;
  let status='clear',hit=null,sky=null;
  try{
   for(let d=NEAR_M;d<=end;d+=stepAt(d)){
    if(!isCurrent())throw Error('candidate-cancelled');
    const bin=Math.floor(d/GROUND_BIN_M);if(!grounds.has(bin)){const q=destination(observer.latitude,observer.longitude,az,(bin+.5)*GROUND_BIN_M);grounds.set(bin,await sampleGround(q));}
    const ground=grounds.get(bin);if(!Number.isFinite(ground))return {status:'unread',reason:'ground-unavailable'};
    if(low(d)-ground>TALLEST_M)continue;
    const p=destination(observer.latitude,observer.longitude,az,d),now=canopyNow(p.latitude,p.longitude),crown=now===undefined?await canopy(p.latitude,p.longitude):now;if(crown<MIN_M)continue;
    const top=ground+crown+CROWN_ADD_M,at=h(d);
    if(ray.endpoint){const m=hide(top,d);if(!sky||m>sky.toM)sky={toM:m,distanceM:d,topM:top,crownM:crown};}
    if(status==='blocked'||at>top+MARGIN_M)continue;
    if(at<top-MARGIN_M){status='blocked';hit={distanceM:d,topM:top,crownM:crown,rayM:at};if(!ray.endpoint)break;}
    else if(status==='clear'){status='unknown';hit={distanceM:d,topM:top,crownM:crown,rayM:at,reason:'trees-margin'};}
   }
  }catch(e){if(e?.message==='candidate-cancelled')throw e;return {status:'unread',reason:'canopy-unavailable'};}
  return {status,hit,skyline:sky,source:'meta-wri-chm-v2'};
 }
 // Complete native-overview coverage for an upper-tower width patch. Unlike
 // the legacy point ray, this includes near, far and endpoint crowns; absent
 // files and no-data values stay unknown. The supplied ground is the maximum
 // over all DEM cells in the same patch, not a single ground sample.
 async function upperPatch(patch,{groundMaxM,groundMax,isCurrent=()=>true,check=()=>{if(!isCurrent())throw Error('candidate-cancelled');}}={}){
  if(!Number.isFinite(groundMaxM))return {status:'unknown',reason:'tree-ground-unavailable'};
  const nw=tileOf(patch.north,patch.west),se=tileOf(patch.south,patch.east),[west,south]=merc(patch.south,patch.west),[east,north]=merc(patch.north,patch.east);
  const span=2*Math.PI*RM/2**ZOOM,origin=Math.PI*RM;let cells=0;
  for(let ty=nw.y;ty<=se.y;ty++)for(let tx=nw.x;tx<=se.x;tx++){
   check();const info=await head(quadkey(tx,ty));check();if(!info)return {status:'unknown',reason:'canopy-coverage-unavailable'};
   const l=Math.max(west,tx*span-origin),r=Math.min(east,(tx+1)*span-origin),t=Math.min(north,origin-ty*span),b=Math.max(south,origin-(ty+1)*span);
   if(l<info.x0-1e-6||r>info.x0+info.width*info.scale+1e-6||t>info.y0+1e-6||b<info.y0-info.height*info.scale-1e-6)return {status:'unknown',reason:'canopy-coverage-unavailable'};
   // Each quadkey owns a half-open extent. The neighbour checks its own
   // boundary cell; an exactly touching edge is not a missing TIFF column.
   const x0=Math.max(0,Math.floor((l-info.x0)/info.scale)),x1=Math.min(info.width-1,Math.floor((r-info.x0)/info.scale));
   const y0=Math.max(0,Math.floor((info.y0-t)/info.scale)),y1=Math.min(info.height-1,Math.floor((info.y0-b)/info.scale));
   let lastKey=null,bytes;
   for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    check();const bx=x>>9,by=y>>9,key=bx+','+by;if(key!==lastKey){bytes=await block(info,bx,by);check();lastKey=key;}
    const crown=bytes[(y&511)*512+(x&511)];cells++;if(crown===255)return {status:'unknown',reason:'canopy-no-data'};
    if(!crown)continue;
    const lon=X=>X/RM/RAD,lat=Y=>(2*Math.atan(Math.exp(Y/RM))-Math.PI/2)/RAD;
    const bounds={west:lon(info.x0+x*info.scale),east:lon(info.x0+(x+1)*info.scale),north:lat(info.y0-y*info.scale),south:lat(info.y0-(y+1)*info.scale)};
    const low=patch.lowAt?.(bounds)??patch.lowM;if(low===Infinity)continue;
    const ground=groundMax?groundMax(bounds):groundMaxM;if(!Number.isFinite(ground))return {status:'unknown',reason:'tree-ground-unavailable'};
    const top=ground+crown+CROWN_ADD_M;
    if(low<=top+MARGIN_M)return {status:low<top-MARGIN_M?'blocked':'unknown',reason:'upper-trees',cells,topM:top,rayM:low,source:'meta-wri-chm-v2'};
   }
  }
  if(!cells)return {status:'unknown',reason:'canopy-coverage-unavailable'};
  return {status:'clear',cells,source:'meta-wri-chm-v2'};
 }
 return {sight,canopy,canopyNow,upperPatch};
}
return {create,directories,quadkey,tileOf,NEAR_M,RANGE_M,END_M,MARGIN_M,CROWN_ADD_M};
});

/* 見える場所の地図 (2026-11-13, user's choice "対象ごとに作って保存"): instead of drawing each place's line to the target one
   by one (on 月×東京タワー 68% of 15,499 places were blocked), rays go out from the target every 0.05 degrees. Along each
   ray the highest obstacle seen from each level of the target (ground, PLATEAU building tops, tree crowns) is carried
   outward, so one walk tells every ground cell on the ray how many levels of the target, from the top, it sees: the lines
   from all those places converge on the target. Obstacles within 30 m of a place are left out, as in the place's own
   check (building-grid near zone; trees within 30 m are stepped around). The map is a coarse pre-filter: a place it keeps
   is still checked exactly on its own line. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesVisibilityMap=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const R=6371008.8,RAD=Math.PI/180,REFRACTION_K=7/6,STEP_DEG=.05,STEP_M=5,START_M=20,SECTOR_DEG=1,NEAR_M=30,EYE_M=1.5,CROWN_MIN_M=3,CROWN_ADD_M=2;
const MAX_M=50000,UNKNOWN=255,RAYS=Math.round(SECTOR_DEG/STEP_DEG),BIN=5;
// Trees count as the place's own check counts them (tree-heights.js): from 30 m to 5 km in front of the place, and not
// within 300 m of the target.
const TREE_RANGE_M=5000,TREE_END_M=300;
// A saved or shipped map is used only with the same reading of the data; bump when the walk or its rules change.
const VERSION='vm2-near30-crown2-tree5k-bin25-sea0';
function destination(lat,lon,az,m){const d=m/R,a=lat*RAD,t=az*RAD,b=Math.asin(Math.sin(a)*Math.cos(d)+Math.cos(a)*Math.sin(d)*Math.cos(t));
 return {latitude:b/RAD,longitude:lon+Math.atan2(Math.sin(t)*Math.sin(d)*Math.cos(a),Math.cos(d)-Math.sin(a)*Math.sin(b))/RAD};}
function bearingM(a,b){const p=a.latitude*RAD,q=b.latitude*RAD,dl=(b.longitude-a.longitude)*RAD;
 const az=(Math.atan2(Math.sin(dl)*Math.cos(q),Math.cos(p)*Math.sin(q)-Math.sin(p)*Math.cos(q)*Math.cos(dl))/RAD+360)%360;
 const h=Math.sin((q-p)/2)**2+Math.cos(p)*Math.cos(q)*Math.sin(dl/2)**2;return {azimuth:az,m:2*R*Math.asin(Math.min(1,Math.sqrt(h)))};}
// The levels tested, top first: the target's named parts and every fifth of its height above its ground.
function levelsFor(target){
 const ground=Number.isFinite(target?.groundM)?target.groundM:0,named=(target?.parts||[]).filter(p=>Number.isFinite(p.m)&&p.m>ground+5).map(p=>({m:p.m,name:p.name||p.id||null}));
 if(!named.length)return [];
 const top=Math.max(...named.map(p=>p.m)),out=named.slice();
 for(const f of [.8,.6,.4,.2]){const m=ground+(top-ground)*f;if(!out.some(l=>Math.abs(l.m-m)<3))out.push({m,name:null});}
 return out.sort((a,b)=>b.m-a.m);
}
// As far as a body half a degree up can stand behind the top (at least 2 km, at most 50 km).
const reach=(target,levels)=>Math.min(MAX_M,Math.max(2000,(levels[0].m-(Number.isFinite(target.groundM)?target.groundM:0))/Math.tan(.5*RAD)));
const mapKey=target=>JSON.stringify([target.id,target.latitude,target.longitude,target.groundM??null,(target.parts||[]).map(p=>[p.id,p.m])]);
// A ray's counts as runs: value byte, run length as a varint.
function encodeRay(counts){const out=[];for(let i=0;i<counts.length;){let j=i;while(j<counts.length&&counts[j]===counts[i])j++;out.push(counts[i]);let n=j-i;while(n>=128){out.push(n&127|128);n>>>=7;}out.push(n);i=j;}return Uint8Array.from(out);}
function decodeRay(bytes,n){const out=new Uint8Array(n);let i=0,k=0;while(k<bytes.length&&i<n){const v=bytes[k++];let len=0,s=0,b;do{b=bytes[k++];len|=(b&127)<<s;s+=7;}while(b&128);out.fill(v,i,Math.min(n,i+len));i+=len;}return out;}
const b64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);};
const unb64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
function create({ground,buildings=null,trees=null,store=null,builtIn=null,capM=Infinity,yieldTask=typeof AstroNotesLibrary==='object'&&AstroNotesLibrary.pause||(()=>new Promise(r=>setTimeout(r,0)))}={}){
 const maps=new Map();
 // Everything a sector's rays will read, in parallel before the walk (its two edges and middle every 250 m), so the walk
 // waits on no tile.
 async function prefetch(target,index,maxM,key,isCurrent){
  const jobs=[];for(const f of [0,.5,1])for(let u=START_M;u<=maxM;u+=250){const p=destination(target.latitude,target.longitude,(index+f)*SECTOR_DEG,u);
   jobs.push(()=>ground.at(p),()=>buildings?buildings.loadAt(p.latitude,p.longitude):null,()=>trees?trees.canopy(p.latitude,p.longitude):null);}
  let next=0;const worker=async()=>{while(next<jobs.length){if(!isCurrent())throw Error('candidate-cancelled');const job=jobs[next++];try{await job();}catch(e){if(e?.message==='candidate-cancelled')throw e;}}};
  await Promise.all(Array.from({length:8},worker));
 }
 // One sector (1 degree, 20 rays) of the map. Ground that cannot be read ends the ray as unknown; a missing building mesh
 // or crown counts as nothing there, so the map never rules out a place its own check could keep.
 async function sector(target,index,{isCurrent=()=>true}={}){
  const levels=levelsFor(target);if(!levels.length)return null;
  const maxM=Math.min(capM,reach(target,levels)),N=Math.floor((maxM-START_M)/STEP_M)+1,K=levels.length,delay=Math.ceil(NEAR_M/STEP_M),window=Math.floor(TREE_RANGE_M/STEP_M),c=1/(2*R*REFRACTION_K),key=target.id;
  if(!isCurrent())throw Error('candidate-cancelled');
  await prefetch(target,index,maxM,key,isCurrent);if(!isCurrent())throw Error('candidate-cancelled');
  const solid=Array.from({length:K},()=>new Float64Array(N)),tree=Array.from({length:K},()=>new Float64Array(N)),running=new Float64Array(K),rays=[];
  const queue=Array.from({length:K},()=>new Int32Array(N));
  for(let r=0;r<RAYS;r++){
   const az=(index*SECTOR_DEG+(r+.5)*STEP_DEG)%360,out=new Uint8Array(N),head=new Int32Array(K),tail=new Int32Array(K);running.fill(-Infinity);
   for(let i=0;i<N;i++){
    if(i%400===0&&!isCurrent())throw Error('candidate-cancelled');
    const u=START_M+i*STEP_M,p=destination(target.latitude,target.longitude,az,u),drop=c*u*u;
    let g=ground.peek(p,{seaAsZero:true});if(g===undefined){await ground.at(p);g=ground.peek(p,{seaAsZero:true});}
    if(!Number.isFinite(g)){out.fill(UNKNOWN,i);break;}
    let b=buildings?buildings.topNow(p.latitude,p.longitude,key):null;if(b===undefined){await buildings.loadAt(p.latitude,p.longitude).catch(()=>{});b=buildings.topNow(p.latitude,p.longitude,key);}
    let t=trees?trees.canopyNow(p.latitude,p.longitude):0;if(t===undefined)t=await trees.canopy(p.latitude,p.longitude).catch(()=>0);
    const top=Math.max(g,Number.isFinite(b)?b:g),crown=t>=CROWN_MIN_M&&u>=TREE_END_M?g+t+CROWN_ADD_M:-Infinity,eye=g+EYE_M,j=i-delay;let n=0;
    for(let k=0;k<K;k++){
     running[k]=Math.max(running[k],(top-levels[k].m-drop)/u);solid[k][i]=running[k];tree[k][i]=crown>-Infinity?(crown-levels[k].m-drop)/u:-Infinity;
     // Crowns within the place's 5 km: a sliding maximum (monotonic queue of indices) over [j-window, j].
     if(j>=0){const q=queue[k];while(tail[k]>head[k]&&tree[k][q[tail[k]-1]]<=tree[k][j])tail[k]--;q[tail[k]++]=j;while(q[head[k]]<j-window)head[k]++;}
    }
    for(let k=0;k<K;k++){const blocked=j>=0?Math.max(solid[k][j],tree[k][queue[k][head[k]]]):-Infinity;if((eye-levels[k].m-drop)/u<blocked)break;n++;}
    out[i]=n;
   }
   // Stored in 25 m bins, each the most levels any of its steps sees (a generous reading, as the lookup is).
   const bins=new Uint8Array(Math.ceil(N/BIN));for(let b=0;b<bins.length;b++){let v=0,unknown=false;for(let x=b*BIN;x<Math.min(N,b*BIN+BIN);x++){if(out[x]===UNKNOWN)unknown=true;else v=Math.max(v,out[x]);}bins[b]=unknown&&!v?UNKNOWN:v;}
   rays.push(bins);await yieldTask();
  }
  return {index,levels,maxM,steps:Math.ceil(N/BIN),rays};
 }
 const decode=saved=>({levels:saved.levels,maxM:saved.maxM,steps:saved.steps,sectors:new Map(Object.entries(saved.sectors).map(([i,rays])=>[+i,rays.map(r=>decodeRay(unb64(r),saved.steps))]))});
 // A shipped map of a built-in target (tools/build-visibility-maps.mjs), when it was made for this target and this walk.
 async function shipped(target,key){if(!builtIn)return null;try{const saved=await builtIn(target);return saved?.v===1&&saved.version===VERSION&&saved.key===key?decode(saved):null;}
  catch(e){globalThis.AstroNotesErrors?.note('visibility-map.builtIn',e);return null;}}
 async function restore(key){if(!store)return null;try{const saved=await store.get(key);if(!saved||saved.v!==1||saved.version!==VERSION)return null;
  return {levels:saved.levels,maxM:saved.maxM,steps:saved.steps,sectors:new Map(Object.entries(saved.sectors).map(([i,rays])=>[+i,rays.map(r=>decodeRay(unb64(r),saved.steps))]))};}
  catch(e){globalThis.AstroNotesErrors?.note('visibility-map.restore',e);return null;}}
 async function save(key,m){if(!store)return;try{await store.set(key,{v:1,version:VERSION,levels:m.levels,maxM:m.maxM,steps:m.steps,sectors:Object.fromEntries([...m.sectors].map(([i,rays])=>[i,rays.map(r=>b64(encodeRay(r)))]))});}
  catch(e){globalThis.AstroNotesErrors?.note('visibility-map.save',e);}}
 // The sectors holding these bearings from the target (and their neighbours), in the order given, computed once and kept
 // for the target. Past the deadline no more sectors are computed this time (a later search adds them).
 async function ensure(target,bearings,{isCurrent=()=>true,deadline=Infinity}={}){
  const key=mapKey(target);let m=maps.get(key);
  if(!m){m=await shipped(target,key)||await restore(key)||{levels:levelsFor(target),maxM:null,steps:null,sectors:new Map()};maps.set(key,m);while(maps.size>8)maps.delete(maps.keys().next().value);}
  // The persisted ray counts do not change; the new-place acceptance policy
  // requires the lower named deck, using the target's existing height datum.
  const named=(target.parts||[]).filter(p=>['main','deck'].includes(p.id)&&Number.isFinite(p.m)).sort((a,b)=>a.m-b.m)[0];
  const partId=target.id==='skytree'?'deck':target.id==='tokyotower'?'main':named?.id;
  m.requiredUpperM=partId?target.parts?.find(p=>p.id===partId)?.m:undefined;
  m.requiredUpperPart=partId;
  if(!m.levels.length)return m;
  const want=new Set();for(const a of bearings)if(Number.isFinite(a)){const i=Math.floor(((a%360)+360)%360/SECTOR_DEG);for(const d of [0,-1,1])want.add((i+d+360)%360);}
  let added=0;for(const i of want){if(m.sectors.has(i))continue;if(Date.now()>deadline)break;const s=await sector(target,i,{isCurrent});if(!s)continue;m.sectors.set(i,s.rays);m.maxM=s.maxM;m.steps=s.steps;added++;}
  if(added)await save(key,m);
  return m;
 }
 return {sector,ensure,maps};
}
// What a place at (lat,lon) sees on the map: the most levels any of the 3x3 nearest ray steps around it sees (a coarse,
// generous reading), or known:false outside the computed sectors and range.
function lookup(m,target,lat,lon){
 if(!m?.levels?.length||!m.sectors?.size||!Number.isFinite(m.steps))return {known:false};
 const {azimuth,m:d}=bearingM(target,{latitude:lat,longitude:lon});if(d<START_M||d>m.maxM)return {known:false};
 const ray=Math.floor(azimuth/STEP_DEG),i=Math.floor((d-START_M)/(STEP_M*BIN));let best=-1;
 for(const dr of [-1,0,1]){const g=(ray+dr+360/STEP_DEG)%(360/STEP_DEG),rays=m.sectors.get(Math.floor(g/RAYS));if(!rays)return {known:false};const counts=rays[g%RAYS];
  for(const di of [-1,0,1]){const v=counts[i+di];if(v===undefined)continue;if(v===UNKNOWN)return {known:false};best=Math.max(best,v);}}
 return best<0?{known:false}:{known:true,count:best,lowestM:best>0?m.levels[best-1].m:null};
}
// How many levels from the top a place must see to keep it: down to the second named part (the user's choice of
// 2026-11-13, generic-evaluator.js partsHidden), or the top alone for a target named by its tip only.
function needFor(m){
 if(m?.requiredUpperPart){const i=m.levels?.findIndex(l=>l.m===m.requiredUpperM);return i>=0?i+1:0;}
 const named=(m?.levels||[]).map((l,i)=>({...l,i})).filter(l=>l.name);return named.length>1?named[1].i+1:1;
}
// A region (lon/lat box) the map shows seeing too little everywhere it was computed; unknown anywhere keeps it.
function regionHidden(m,target,bbox,need){
 for(let a=0;a<6;a++)for(let b=0;b<6;b++){const r=lookup(m,target,bbox[1]+(bbox[3]-bbox[1])*(b+.5)/6,bbox[0]+(bbox[2]-bbox[0])*(a+.5)/6);if(!r.known||r.count>=need)return false;}
 return true;
}
return {create,lookup,needFor,regionHidden,levelsFor,encodeRay,decodeRay,mapKey,VERSION,STEP_DEG,STEP_M,START_M,SECTOR_DEG,BIN,UNKNOWN};
});

/* PLATEAU building shapes (tools/build-plateau-models.py) for targets the user adds. A saved target that stands
   on a PLATEAU building of about its height takes that building's shape on this page (見え方 and new places);
   calculation workers keep their own models. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesPlateauBuildings=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
'use strict';
const RAD=Math.PI/180;
// Files are per 2nd-order mesh (6 digits, about 10 km).
function part(lat,lon){const my=Math.floor(lat*120),mx=Math.floor(lon*80);return ''+Math.floor(my/80)+(Math.floor(mx/80)-100)+Math.floor(my%80/10)+Math.floor(mx%80/10);}
function inside(ring,x,y){let on=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++)if((ring[i][1]>y)!==(ring[j][1]>y)&&x<(ring[j][0]-ring[i][0])*(y-ring[i][1])/(ring[j][1]-ring[i][1])+ring[i][0])on=!on;return on;}
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
// A row: [id, name, aim latitude, aim longitude, ground m, height m, LOD, columns]; a column: [top dm, east/north dm pairs].
function shape(row){
 const [id,name,lat,lon,groundM,heightM,lod,cols]=row,kx=111320*Math.cos(lat*RAD),ky=110540;
 const rings=cols.map(([top,flat])=>{const r=[];for(let i=0;i<flat.length;i+=2)r.push([flat[i]/10,flat[i+1]/10]);return {top:top/10,ring:r};}),geo=p=>[lat+p[1]/ky,lon+p[0]/kx];
 const aim=aimPoint(rings);
 return {id,name,latitude:aim?+geo(aim)[0].toFixed(7):lat,longitude:aim?+geo(aim)[1].toFixed(7):lon,originLatitude:lat,originLongitude:lon,groundM,heightM,lod,rings,geo};
}
// The packed aim point is the middle of every roof within 1.5 m of the top. Twin towers of one height put that in the
// gap between them (都庁第一本庁舎), so aim at the middle of the tower that holds the highest roof instead.
function aimPoint(rings){
 if(!rings.length)return null;
 const box=r=>{let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;for(const [x,y] of r.ring){a=Math.min(a,x);b=Math.min(b,y);c=Math.max(c,x);d=Math.max(d,y);}return [a,b,c,d];};
 const top=Math.max(...rings.map(r=>r.top)),high=rings.filter(r=>r.top>=top-1.5).map(r=>({r,b:box(r)}));
 const first=high.reduce((a,c)=>c.r.top>a.r.top?c:a),group=[first],rest=high.filter(x=>x!==first),near=(p,q)=>p[0]<=q[2]+3&&q[0]<=p[2]+3&&p[1]<=q[3]+3&&q[1]<=p[3]+3;
 for(let grew=true;grew;){grew=false;for(let i=rest.length-1;i>=0;i--)if(group.some(g=>near(g.b,rest[i].b))){group.push(...rest.splice(i,1));grew=true;}}
 if(!rest.length)return null;
 const a=Math.min(...group.map(g=>g.b[0])),b=Math.min(...group.map(g=>g.b[1])),c=Math.max(...group.map(g=>g.b[2])),d=Math.max(...group.map(g=>g.b[3]));
 return [(a+c)/2,(b+d)/2];
}
// The app's city-model form: every column is one face of its ground and roof corners, placed by absolute position.
function cityModel(b){
 const vertices=[],geoVertices=[],faces=[];
 for(const {top,ring} of b.rings){const face=[];for(const z of [0,top])for(const p of ring){face.push(vertices.length);vertices.push([p[0],p[1],z]);geoVertices.push(b.geo(p));}faces.push(face);}
 return {id:'plateau-'+b.id,buildingId:b.id,heightM:b.heightM,groundM:b.groundM,vertices,geoVertices,faces,approximate:true,
  sourceLabel:'PLATEAU（加工）・LOD'+b.lod,sourceUrl:'https://www.mlit.go.jp/plateau/site-policy/'};
}
function create({load=null,loadNames=null,fetchImpl=(typeof fetch==='function'?fetch.bind(root):null),base='data/building-shapes/'}={}){
 let indexPromise=null;const parts=new Map(),ready=new Map(),attached=new Map();
 const index=()=>indexPromise||(indexPromise=(load?load('building-shapes/index.json'):fetchImpl(base+'index.json').then(r=>{if(!r.ok)throw Error('shape-index');return r.json();})).catch(e=>{indexPromise=null;throw e;}));
 async function partAt(lat,lon){
  const data=await index(),p=part(lat,lon),entry=data.parts?.[p];if(!entry)return [];
  if(!parts.has(p))parts.set(p,(async()=>{const r=await fetchImpl(base+p+'.json.gz?v='+entry[0],{signal:globalThis.AbortSignal?.timeout?.(20000)});if(!r.ok)throw Error('shape-part');
   const bytes=await r.arrayBuffer();if(!(await sha(bytes)).startsWith(entry[0]))throw Error('shape-part-version');
   const json=JSON.parse(await decompressCandidateBytes(bytes).text());
   const list=json.buildings.map(shape);ready.set(p,list);return list;})().catch(e=>{parts.delete(p);throw e;}));
  const wanted=parts.get(p);if(parts.size>24){const old=parts.keys().next().value;parts.delete(old);ready.delete(old);}
  return wanted;
 }
 const metres=(b,lat,lon)=>{const kx=111320*Math.cos(lat*RAD),ky=110540;return [(lon-b.originLongitude)*kx,(lat-b.originLatitude)*ky];};
 const onFootprint=(b,lat,lon)=>{const [x,y]=metres(b,lat,lon);return b.rings.some(({ring})=>inside(ring,x,y));};
 const distance=(b,lat,lon)=>{if(onFootprint(b,lat,lon))return 0;const [x,y]=metres(b,lat,lon);let best=Infinity;for(const {ring} of b.rings)for(let i=0,j=ring.length-1;i<ring.length;
 j=i++){const [x1,y1]=ring[j],[x2,y2]=ring[i],dx=x2-x1,dy=y2-y1,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((x-x1)*dx+(y-y1)*dy)/l)):0;best=Math.min(best,Math.hypot(x-x1-t*dx,y-y1-t*dy));}return best;};
 // Buildings within radiusM of a point, nearest first (a point on a footprint is at 0 m).
 async function near(lat,lon,{radiusM=300,limit=8,minHeightM=0}={}){
  const list=await partAt(lat,lon);
  return list.filter(b=>b.heightM>=minHeightM).map(b=>({b,d:distance(b,lat,lon)})).filter(x=>x.d<=radiusM).sort((a,c)=>a.d-c.d||c.b.heightM-a.b.heightM).slice(0,limit)
   .map(({b,d})=>({id:b.id,name:b.name,latitude:b.latitude,longitude:b.longitude,groundM:b.groundM,heightM:b.heightM,lod:b.lod,distanceM:Math.round(d)}));
 }
 // This ID lookup augments the editor only. Geometry and saved names do not depend on it.
 async function namesFor(ids){
  const result=new Map();
  if(!loadNames||!ids.length)return result;
  const data=await loadNames();
  if(data?.format!=='AstroNotes OSM building name matches v1')return result;
  for(const id of ids){
   const row=Object.hasOwn(data.names||{},id)?data.names[id]:null;
   if(typeof row?.[0]==='string'&&row[0].length<=200)result.set(id,row[0]);
  }
  return result;
 }
 // A saved target (id "fav:…") on a PLATEAU building whose height is within 15% (5 m) of the target's takes its shape.
 function match(target){
  if(!target||!String(target.id||'').startsWith('fav:')||target.rim)return null;
  const top=(target.parts?.find(p=>p.id==='tip')||target.parts?.[0])?.m,h=Number.isFinite(top)?top-(target.groundM??0):NaN;if(!(h>0))return null;
  const list=ready.get(part(target.latitude,target.longitude));if(!list)return null;
  let best=null;for(const b of list){if(Math.abs(b.heightM-h)>Math.max(5,b.heightM*.15))continue;const d=distance(b,target.latitude,target.longitude);if(d<=3&&(!best||d<best.d))best={b,d};}
  return best?.b||null;
 }
 // Register shapes for saved targets on this page. Returns the ids that changed.
 async function prepare(targets){
  const changed=[],models=root.AstroNotesCityModels||(root.AstroNotesCityModels={});
  for(const t of targets||[]){if(!String(t?.id||'').startsWith('fav:'))continue;try{await partAt(t.latitude,t.longitude);}catch{continue;}
   const b=match(t),prev=attached.get(t.id);
   if(b&&prev?.id!==b.id){models[t.id]=cityModel(b);attached.set(t.id,b);changed.push(t.id);}
   else if(!b&&prev){delete models[t.id];attached.delete(t.id);changed.push(t.id);}}
  return changed;
 }
 // Footprint of the building a target stands on (lat/lon rings), for leaving it out of its own sight lines.
 function footprint(targetId){const b=attached.get(targetId);return b?b.rings.map(({ring})=>ring.map(p=>b.geo(p))):null;}
 return {near,namesFor,prepare,match,footprint,attachedTo:id=>attached.get(id)||null};
}
return {create,part,shape,cityModel,aimPoint};
});

/* Bundled OpenStreetMap places (tools/build-osm-places.mjs): the parks, squares, viewpoints, riverbank paths, water,
   rivers, small woods, trees and bridges that new places need, per 2nd-order mesh, so a search does not wait on Overpass. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesOsmPlaces=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const RAD=Math.PI/180;
function mesh(lat,lon){const my=Math.floor(lat*120),mx=Math.floor(lon*80);return ''+Math.floor(my/80)+(Math.floor(mx/80)-100)+Math.floor(my%80/10)+Math.floor(mx%80/10);}
function meshesIn([w,s,e,n]){const out=new Set();for(let y=Math.floor(s*12)/12;y<=n+1/24;y+=1/12)for(let x=Math.floor(w*8)/8;x<=e+1/16;x+=1/8){const la=Math.min(n,Math.max(s,y+1e-9)),lo=Math.min(e,Math.max(w,x+1e-9));out.add(mesh(la,lo));}out.add(mesh(s,w));out.add(mesh(n,e));out.add(mesh(s,e));
out.add(mesh(n,w));return [...out];}
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
const pts=g=>{const out=[];for(let i=0;i<g.length;i+=2)out.push({lat:g[i]/1e7,lon:g[i+1]/1e7});return out;};
// The Overpass "out geom" shape the place provider already parses.
function element(row){
 if(row.t==='n')return {type:'node',id:row.i,tags:row.k,lat:row.a/1e7,lon:row.o/1e7};
 if(row.t==='w')return {type:'way',id:row.i,tags:row.k,geometry:pts(row.g)};
 return {type:'relation',id:row.i,tags:row.k,members:row.m.map(m=>({type:'way',role:m.r,geometry:pts(m.g)}))};
}
function bbox(row){let s=Infinity,w=Infinity,n=-Infinity,e=-Infinity;const add=g=>{for(let i=0;i<g.length;i+=2){const a=g[i]/1e7,o=g[i+1]/1e7;if(a<s)s=a;if(a>n)n=a;if(o<w)w=o;if(o>e)e=o;}};
 if(row.t==='n')add([row.a,row.o]);else if(row.t==='w')add(row.g);else for(const m of row.m)add(m.g);return [w,s,e,n];}
// Lines are stored as the first pair and then differences from the previous pair.
const undelta=g=>{for(let i=2;i<g.length;i++)g[i]+=g[i-2];return g;};
function decode(row){if(row.t==='w')undelta(row.g);else if(row.t==='r')for(const m of row.m)undelta(m.g);return row;}
// Rows of a part on 0.01 deg cells (about 1 km), so a query reads only the cells it touches (2026-11-11: a sight line
// used to scan every row of its parts).
const CELL=.01,cellOf=v=>Math.floor(v/CELL);
function indexed(rows){const cells=new Map();for(const row of rows){const [w,s,e,n]=row.b;for(let x=cellOf(w);x<=cellOf(e);x++)for(let y=cellOf(s);y<=cellOf(n);y++){const k=x*100000+y;let c=cells.get(k);if(!c)cells.set(k,c=[]);c.push(row);}}rows.cells=cells;return rows;}
const overlaps=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
// Obstacles of unknown height: the line must pass this far above the ground at them to be clear.
function obstacle(row){
 const k=row.k;
 if(['wood','tree_row','tree'].includes(k.natural))return {kind:'tree',capM:25,halfWidthM:k.natural==='tree'?6:k.natural==='tree_row'?5:0};
 if(k.man_made==='bridge')return {kind:'bridge',capM:30,halfWidthM:0};
 if(k.railway&&(k.bridge&&k.bridge!=='no'||Number(k.layer)>=1))return {kind:'railway',capM:15,halfWidthM:8};
 // Layer orders overlapping features; it is not a height or proof of an outdoor road.
 // Indoor paths and building elevators belong to the building model. Explicit bridges remain obstacles.
 const indoor=['yes','area','room','corridor'].includes(k.indoor);
 if(k.highway&&!(k.bridge&&k.bridge!=='no')&&(indoor||k.highway==='elevator'&&k.building==='yes'))return null;
 if(k.highway&&(k.bridge&&k.bridge!=='no'||Number(k.layer)>=1))return {kind:'road',capM:20,halfWidthM:12};
 return null;
}
function create({load=null,fetchImpl=(typeof fetch==='function'?fetch.bind(globalThis):null),base='data/osm-places/'}={}){
 let indexPromise=null;const parts=new Map();
 const index=()=>indexPromise||(indexPromise=(load?load('osm-places/index.json'):fetchImpl(base+'index.json').then(r=>{if(!r.ok)throw Error('osm-index');return r.json();})).catch(e=>{indexPromise=null;throw e;}));
 async function part(code){
  const data=await index(),entry=data.parts?.[code];if(!entry)return [];
  if(!parts.has(code))parts.set(code,(async()=>{const r=await fetchImpl(base+code+'.json.gz?v='+entry[0],{signal:globalThis.AbortSignal?.timeout?.(20000)});if(!r.ok)throw Error('osm-part');
   const bytes=await r.arrayBuffer();if(!(await sha(bytes)).startsWith(entry[0]))throw Error('osm-part-version');
   const rows=JSON.parse(await decompressCandidateBytes(bytes).text());for(const row of rows){decode(row);row.b=bbox(row);}return indexed(rows);})().catch(e=>{parts.delete(code);throw e;}));
  if(parts.size>48)parts.delete(parts.keys().next().value);
  return parts.get(code);
 }
 async function rowsIn(box,cells=null){const seen=new Set(),out=[];
  const keys=cells||(()=>{const k=[];for(let x=cellOf(box[0]);x<=cellOf(box[2]);x++)for(let y=cellOf(box[1]);y<=cellOf(box[3]);y++)k.push(x*100000+y);return k;})();
  for(const code of meshesIn(box)){const rows=await part(code);for(const k of keys)for(const row of rows.cells?.get(k)||[]){const key=row.t+row.i+'/'+(row.s??'');if(seen.has(key)||!overlaps(row.b,box))continue;seen.add(key);out.push(row);}}
  return out;}
 // Elements for a place-provider tile.
 async function elementsIn(box){return (await rowsIn(box)).map(element);}
 // Trees and elevated structures near the ground track from a to b (lat/lon), as rings [[lat,lon]], lines or points.
 async function obstaclesAlong(a,b){
  const pad=40/110540,box=[Math.min(a.longitude,b.longitude)-pad/Math.cos(a.latitude*RAD),Math.min(a.latitude,b.latitude)-pad,Math.max(a.longitude,b.longitude)+pad/Math.cos(a.latitude*RAD),Math.max(a.latitude,b.latitude)+pad];
  // Only the cells the track passes through (and their neighbours, wider than the 40 m pad), not its whole box.
  const cells=new Set(),steps=Math.max(1,Math.ceil(Math.max(Math.abs(b.latitude-a.latitude),Math.abs(b.longitude-a.longitude))/(CELL/2)));
  for(let i=0;i<=steps;i++){const la=a.latitude+(b.latitude-a.latitude)*i/steps,lo=a.longitude+(b.longitude-a.longitude)*i/steps;for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)cells.add((cellOf(lo)+dx)*100000+cellOf(la)+dy);}
  const out=[];for(const row of await rowsIn(box,[...cells])){const o=obstacle(row);if(!o)continue;
   if(row.t==='n')out.push({...o,id:'node/'+row.i,points:[[row.a/1e7,row.o/1e7]]});
   else if(row.t==='w'){const p=[];for(let i=0;i<row.g.length;i+=2)p.push([row.g[i]/1e7,row.g[i+1]/1e7]);const closed=p.length>3&&p[0][0]===p[p.length-1][0]&&p[0][1]===p[p.length-1][1];
    out.push({...o,id:'way/'+row.i,...(closed&&!o.halfWidthM?{rings:[p]}:{lines:[p],halfWidthM:o.halfWidthM||4})});}
   else out.push({...o,id:'relation/'+row.i,rings:row.m.filter(m=>m.r!=='inner').map(m=>{const p=[];for(let i=0;i<m.g.length;i+=2)p.push([m.g[i]/1e7,m.g[i+1]/1e7]);return p;})});}
  return out;
 }
 return {elementsIn,obstaclesAlong,index};
}
return {create,mesh,meshesIn,element,obstacle,decode};
});

/* Native GSI DEM samples: terrain diagnostics, never standing surface/visibility proof. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateTerrain=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const R=6371008.8,rad=Math.PI/180,MISSING=-2147483648,Geo=()=>globalThis.AstroNotesTerrain||(typeof require==='function'?require('../../../astronotes-terrain.js'):null);
async function decode(data){
 const unpack=async encoded=>decompressCandidateBytes(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))).arrayBuffer();
 const buffer=await unpack(data.heightsGzipBase64),view=new DataView(buffer),sources=data.sourceCodesGzipBase64?new Uint8Array(await unpack(data.sourceCodesGzipBase64)):null,tiles=new Map(data.tiles.map(t=>[t.x+','+t.y,t]));
 if(buffer.byteLength!==data.tiles.length*256*256*4||sources&&sources.length*4!==buffer.byteLength)throw Error('invalid-terrain-size');
 const world=256*2**data.zoom;
 function pixel(lat,lon){return [(lon+180)/360*world,(1-Math.asinh(Math.tan(lat*rad))/Math.PI)/2*world];}
 function lookup(x,y){const px=Math.floor(x),py=Math.floor(y),tile=tiles.get(Math.floor(px/256)+','+Math.floor(py/256));if(!tile)return {height:null,sourceCode:0};const i=tile.offset+(py%256+256)%256*256+(px%256+256)%256;
 if(!Number.isInteger(i)||i<0||i*4+4>buffer.byteLength)return {height:null,sourceCode:0};const cm=view.getInt32(i*4,true);return {height:cm===MISSING?null:cm/100,sourceCode:cm===MISSING?0:sources?.[i]??1};}
 function sample(p){return lookup(...pixel(p.latitude,p.longitude));}
 function at(p){return sample(p).height;}
 function trace(observer,{azimuth,altitude,maxM,endpoint=null,refractionK=1}){
  if(!Number.isFinite(observer.elevation)||!Number.isFinite(azimuth)||!Number.isFinite(altitude)||Math.abs(altitude)>=89||!Number.isFinite(maxM)||maxM<=0)return {status:'unknown',recommend:false,reason:'invalid-terrain-ray'};
  const segments=[];let lastPoint=null,previous={xy:pixel(observer.latitude,observer.longitude),d:0};
  for(let d=Math.min(100,maxM);;d=Math.min(d+100,maxM)){const p=d===maxM&&endpoint?endpoint:Geo().destination(observer.latitude,observer.longitude,azimuth,d/1000),next={xy:pixel(p.latitude,p.longitude),d};segments.push([previous,next]);previous=next;lastPoint=p;if(d===maxM)break;}
  let checked=0,missing=0,lowerResolutionCells=0,ignoredCells=0,hit=null,minMarginM=Infinity;const eye=observer.elevation+(observer.eyeM??1.5);
  // The highest ground seen from the eye: up to which height the target is hidden at maxM.
  let skyTan=-Infinity,skyAt=null,skyM=null;const seen=[];
  for(const [from,to] of segments){const start=from.xy,finish=to.xy,dx=finish[0]-start[0],dy=finish[1]-start[1],length=to.d-from.d,crossings=[0,1];for(const [a,b] of [[start[0],finish[0]],[start[1],finish[1]]])if(a!==b)for(let n=Math.floor(Math.min(a,b))+1;n<Math.max(a,b);
  n++)crossings.push((n-a)/(b-a));crossings.sort((a,b)=>a-b);
  for(let i=1;i<crossings.length;i++){const lo=crossings[i-1],hi=crossings[i];if(hi-lo<1e-14)continue;const t=(lo+hi)/2,value=lookup(start[0]+t*dx,start[1]+t*dy),z=value.height;checked++;if(value.sourceCode===2)lowerResolutionCells++;if(z===null)missing++;if(z===null)continue;
  const at=from.d+t*length;if(at>0){seen.push([at,z]);const rise=(z-eye-at*at/(2*R*refractionK))/at;if(rise>skyTan){skyTan=rise;skyAt=at;skyM=z;}}
  const a=Math.max(0,from.d+lo*length),b=from.d+hi*length,vertex=-R*refractionK*Math.tan(altitude*rad),distances=[a,b];if(vertex>a&&vertex<b)distances.push(vertex);
  const heights=distances.map(d=>eye+d*Math.tan(altitude*rad)+d*d/(2*R*refractionK)),ray=Math.min(...heights),d=distances[heights.indexOf(ray)],margin=ray-z;minMarginM=Math.min(minMarginM,margin);if(margin<=0&&!hit)hit={distanceM:d,terrainM:z,rayM:ray};}}

  return {status:hit?'model-blocked':'unknown',recommend:false,checked,missing,lowerResolutionCells,end:lastPoint,ignoredNearObserverM:0,ignoredCells,hit,minMarginM:Number.isFinite(minMarginM)?minMarginM:null,reason:hit?'conditional-dem-intersection':'no-terrain-visibility-certification',
  skyline:skyAt===null?null:{distanceM:skyAt,terrainM:skyM,toM:eye+maxM*skyTan+maxM*maxM/(2*R*refractionK),
  riseM:seen.reduce((rise,[d,h])=>d<skyAt&&d>=skyAt-80?Math.max(rise,skyM-h):rise,0),dropM:seen.reduce((drop,[d,h])=>d>skyAt&&d<=skyAt+80?Math.max(drop,skyM-h):drop,0)}};
 }
 return {at,sample,trace,source:data.source};
}
return {decode};
});

/* GSI native DEM port. Missing pixels stay missing; IO is injected for tests. */
(function(root){
'use strict';
const api=root.AstroNotesCandidateTerrain||(typeof require==='function'?require('./terrain-model.js'):null);
const RAD=Math.PI/180,R=6371008.8;
function createLive({fetchImpl=root.fetch,geo=root.AstroNotesTerrain,maxTiles=96,maxCachedTiles=128,timeoutMs=7000,maxDurationMs=35000,lookAhead=false,layers=[['dem5a',15],['dem5b',15],['dem5c',15],['dem',14]]}={}){
 // A tile is 256 KiB. Keep at most 32 MiB of completed rasters by default,
 // independently of a job's read budget; pending reads stay shared until settled.
 const cache=new Map(),done=new Map(),last=new Map(),readKeys=new Set(),cacheLimit=Math.max(1,Math.floor(Number.isFinite(maxCachedTiles)?maxCachedTiles:128));
 let fetched=0,started=Date.now(),limit=maxTiles,newest=null;
 function touch(key,value){if(newest!==key){done.delete(key);done.set(key,value);newest=key;}}
 function retain(key,value){
  touch(key,value);
  while(done.size>cacheLimit){const old=done.keys().next().value;done.delete(old);for(const [layer,memo]of last)if(memo.key===old)last.delete(layer);}
 }
 const pixel=(p,z)=>[(p.longitude+180)/360*256*2**z,(1-Math.asinh(Math.tan(p.latitude*RAD))/Math.PI)/2*256*2**z];
 async function fetchTile(key,layer,z,x,y,options){
  if(lookAhead&&options.signal?.aborted)return {missing:true,reason:'terrain-fetch'};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  const abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});
  try{
   const response=await fetchImpl(`https://cyberjapandata.gsi.go.jp/xyz/${key}.txt`,{signal:controller.signal});
   if(!response.ok)return {missing:true,reason:response.status===404?'missing-tile':'terrain-fetch'};
   const values=(await response.text()).trim().split(/[\s,]+/);
   if(values.length!==65536)return {missing:true,reason:'terrain-size'};
   const heights=new Float32Array(65536);
   for(let i=0;i<values.length;i++){const v=values[i];heights[i]=v==='e'||v===''?NaN:Number(v);}
   return {heights,z,x,y,layer};
  }catch{return {missing:true,reason:'terrain-fetch'};}
  finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
 }
 async function tile(layer,z,x,y,options){
  const key=[layer,z,x,y].join('/');
  if(done.has(key)){const value=done.get(key);touch(key,value);readKeys.add(key);return value;}
  if(cache.has(key))return cache.get(key);
  if(options.isCurrent?.()===false)throw Error('candidate-cancelled');
  // Eviction must not spend the budget again on ground this job already read.
  // Failed fresh requests still cost a read and remain retryable, as before.
  const reread=readKeys.has(key);
  if(!reread&&fetched>=limit||Date.now()-started>=maxDurationMs)return {missing:true,reason:'terrain-budget'};
  if(!reread)fetched++;
  // A staged read counts towards the budget and cache only when the ray actually needs it.
  const ahead=options.prefetched?.get(key);
  const stop=()=>ahead?.controller.abort();
  if(ahead){
   options.prefetched.delete(key);
   if(options.signal?.aborted)stop();else options.signal?.addEventListener('abort',stop,{once:true});
  }

  const pending=ahead?ahead.data.then(r=>{
   if(options.signal?.aborted||options.isCurrent?.()===false)return r;
   return r.reason==='terrain-fetch'||r.reason==='terrain-size'?fetchTile(key,layer,z,x,y,options):r;
  }):fetchTile(key,layer,z,x,y,options);
  cache.set(key,pending);const result=await pending;
  if(ahead)options.signal?.removeEventListener('abort',stop);
  cache.delete(key);
  // A failed request is retryable, unlike an authoritative absent tile.
  if(result.reason!=='terrain-fetch'&&result.reason!=='terrain-size'){readKeys.add(key);retain(key,result);}
  return result;
 }
 // The height where every tile it needs is already read; undefined when one is still to be read (see sample), null when
 // no layer holds the point. Lets a sweep over many points wait only once per tile (visibility-map.js). seaAsZero: a
 // point every layer leaves empty (an absent tile or a no-value pixel; the 10 m DEM covers all land) is the sea at 0 m,
 // as far along a line (sampleFar).
 function peek(point,{seaAsZero=false}={}){
  let sea=true;
  for(const [layer,z]of layers){const [px,py]=pixel(point,z),x=Math.floor(px/256),y=Math.floor(py/256),memo=last.get(layer);
   const key=layer+'/'+z+'/'+x+'/'+y;
   let d=memo&&memo.x===x&&memo.y===y?memo.d:done.get(key);if(!d)return undefined;touch(key,d);readKeys.add(key);if(!memo||memo.d!==d)last.set(layer,{key,x,y,d});
   if(d.missing){if(d.reason!=='missing-tile')sea=false;if(d.reason==='terrain-budget')return null;continue;}
   const h=d.heights[(Math.floor(py)%256+256)%256*256+(Math.floor(px)%256+256)%256];if(Number.isFinite(h))return h;}
  return seaAsZero&&sea?0:null;
 }
 async function sample(point,options={}){
  if(!Number.isFinite(point?.latitude)||!Number.isFinite(point?.longitude)||Math.abs(point.latitude)>=85)return {height:null,reason:'invalid-dem-position'};
  let reason='missing-dem';
  for(const [layer,z]of layers){
   const [px,py]=pixel(point,z),x=Math.floor(px/256),y=Math.floor(py/256),data=await tile(layer,z,x,y,options);
   if(options.isCurrent?.()===false||options.prefetched&&options.signal?.aborted)throw Error('candidate-cancelled');
   if(data.missing){reason=data.reason;if(reason==='terrain-budget')break;continue;}
   const h=data.heights[(Math.floor(py)%256+256)%256*256+(Math.floor(px)%256+256)%256];
   if(Number.isFinite(h))return {height:h,layer,z,x,y,resolutionM:40075016.686*Math.cos(point.latitude*RAD)/(256*2**z),heightDatum:'GSI orthometric; source epoch not certified'};
  }
  return {height:null,reason};
 }
 // Far along a line that has risen NEAR_RISE_M above the eye, the 10 m DEM at z12 (about 31 m pixels) is
 // read instead of the 5 m tiles, so a sun or moon line of 40 km takes a few tiles, not fifty. A coarse
 // pixel can miss a peak between samples, so there the line must pass FAR_MARGIN_M above it to be clear
 // and below it by as much to be blocked; between, inspect every native cell of that interval. The 40 m
 // allowance is the existing coarse policy, not a bound on every unresolved peak. No value far out is the sea (DEM10B
 // covers all land; whole-sea tiles are absent).
 const NEAR_RISE_M=300,FAR_MIN_M=2000,FAR_Z=12,FAR_MARGIN_M=40;
 async function sampleFar(point,options){
  const [px,py]=pixel(point,FAR_Z),x=Math.floor(px/256),y=Math.floor(py/256),data=await tile('dem',FAR_Z,x,y,options);
  if(data.missing)return data.reason==='missing-tile'?{height:0,layer:'sea',z:FAR_Z}:{height:null,reason:data.reason};
  const h=data.heights[(Math.floor(py)%256+256)%256*256+(Math.floor(px)%256+256)%256];
  return {height:Number.isFinite(h)?h:0,layer:Number.isFinite(h)?'dem':'sea',z:FAR_Z,resolutionM:40075016.686*Math.cos(point.latitude*RAD)/(256*2**FAR_Z)};
 }
 // How far the ground rises within 80 m before the highest point and falls within 80 m beyond it: a levee or bank falls again, a plateau does not.
 const fallAround=(ds,hs,at,top,side)=>{let fall=0;for(let i=0;i<ds.length;i++)if(side*(ds[i]-at)>0&&Math.abs(ds[i]-at)<=80)fall=Math.max(fall,top-hs[i]);return fall;};
 // Evaluate the native piecewise-constant raster model, not a sparse 100-point profile.
 async function trace(observer,{azimuth,altitude,maxM,endpoint=null,refractionK=1,...options}){
  if(!Number.isFinite(observer.elevation)||!Number.isFinite(maxM)||maxM<=0||!Number.isFinite(altitude)||!(refractionK>0))return {status:'unknown',missing:1,reason:'invalid-ray'};
  const eye=observer.elevation+(observer.eyeM??1.5),effectiveR=R*refractionK,theta=maxM/effectiveR;
  const alpha=Number.isFinite(endpoint?.elevation)?Math.atan2((effectiveR+endpoint.elevation)*Math.cos(theta)-(effectiveR+eye),(effectiveR+endpoint.elevation)*Math.sin(theta)):altitude*RAD;
  const height=d=>{const angle=d/effectiveR,den=Math.cos(angle)-Math.tan(alpha)*Math.sin(angle);return den>0?(effectiveR+eye)/den-effectiveR:Infinity;};
  let checked=0,missing=0,minMarginM=Infinity,hit=null,d=0,steps=0,lastSource=null,lastHeight=null,endpointUncertain=false,farUncertain=false,refinementUnavailable=false;
  // The highest ground seen from the eye: up to which height the target is hidden at maxM.
  let skyAlpha=-Infinity,skyAt=null,skyM=null;const seenD=[],seenH=[];
  const nativeZoom=layers.reduce((z,[,level])=>Number.isInteger(level)&&level>=0&&level<=22?Math.max(z,level):NaN,15);
  const current=()=>{if(options.isCurrent?.()===false||options.signal?.aborted)throw Error('candidate-cancelled');};
  const minimum=(lo,hi)=>{const distances=[lo,hi],vertex=-alpha*effectiveR;if(vertex>lo&&vertex<hi)distances.push(vertex);return Math.min(...distances.map(height));};
  function boundaries(from,to,z){
   const a=pixel(from,z),b=pixel(to,z),marks=[0,1];
   for(let axis=0;axis<2;axis++)if(a[axis]!==b[axis])for(let edge=Math.floor(Math.min(a[axis],b[axis]))+1;edge<Math.max(a[axis],b[axis]);edge++)marks.push((edge-a[axis])/(b[axis]-a[axis]));
   marks.sort((x,y)=>x-y);
   return marks;
  }
  function segment(d){
   const next=Math.min(maxM,d+100),from=geo.destination(observer.latitude,observer.longitude,azimuth,d/1000),to=next===maxM&&endpoint?endpoint:geo.destination(observer.latitude,observer.longitude,azimuth,next/1000);
   const far=d>=FAR_MIN_M&&height(d)-eye>NEAR_RISE_M;
   return {next,far,marks:boundaries(from,to,far?FAR_Z:15),from,to};
  }
  function record(value,lo,hi,far){
   const middle=(lo+hi)/2;
   checked++;lastSource=value.layer;lastHeight=value.height;
   const arc=middle/effectiveR,rise=Math.atan2((effectiveR+value.height)*Math.cos(arc)-(effectiveR+eye),(effectiveR+value.height)*Math.sin(arc));
   seenD.push(middle);seenH.push(value.height);if(rise>skyAlpha){skyAlpha=rise;skyAt=middle;skyM=value.height;}
   const ray=minimum(lo,hi),endpointCell=endpoint&&maxM-lo<value.resolutionM*2,margin=ray-value.height;minMarginM=Math.min(minMarginM,margin);
   if(far){if(margin<-FAR_MARGIN_M&&!hit)hit={distanceM:middle,terrainM:value.height,rayM:ray,coarse:true};else if(margin<FAR_MARGIN_M)farUncertain=true;}
   else if(margin<-.1&&!hit){if(endpointCell)endpointUncertain=true;else hit={distanceM:middle,terrainM:value.height,rayM:ray};}
   steps++;
  }
  const prefetched=new Map(),enabled=lookAhead&&maxM>=8000&&layers.length>0;
  let scan=2000;
  if(enabled)options={...options,prefetched};
  function prefetchNative(d){
   if(!enabled||d<2000||fetched>limit-4||Date.now()-started>=maxDurationMs||prefetched.size>=2)return;
   scan=Math.max(d,scan);
   const [layer,z]=layers[0];
   while(scan<Math.min(maxM,d+3000)&&prefetched.size<2){
    const {next,far,marks}=segment(scan);
    if(far)break;
    for(let i=1;i<marks.length&&prefetched.size<2;i++){
     if(marks[i]-marks[i-1]<1e-12)continue;
     const lo=scan+marks[i-1]*(next-scan),hi=scan+marks[i]*(next-scan),middle=(lo+hi)/2;
     const p=geo.destination(observer.latitude,observer.longitude,azimuth,middle/1000);
     const [px,py]=pixel(p,z),x=Math.floor(px/256),y=Math.floor(py/256),key=[layer,z,x,y].join('/');
     if(cache.has(key)||done.has(key)||prefetched.has(key))continue;
     const controller=new AbortController(),data=fetchTile(key,layer,z,x,y,{signal:controller.signal});
     prefetched.set(key,{controller,data});
    }
    if(prefetched.size<2)scan=next;
   }
  }
  try{
   while(d<maxM){
    current();
    const {next,far,marks,from,to}=segment(d);let nativeMarks;
    if(!far)prefetchNative(d);
    for(let i=1;i<marks.length;i++){
     if(marks[i]-marks[i-1]<1e-12)continue;
     const lo=d+marks[i-1]*(next-d),hi=d+marks[i]*(next-d),middle=(lo+hi)/2,p=geo.destination(observer.latitude,observer.longitude,azimuth,middle/1000);
     let value=far?await sampleFar(p,options):await sample(p,options);
     current();
     if(value.reason==='terrain-budget')return {status:'unknown',checked,missing,partial:true,reason:value.reason,hit};
     const coarseMargin=far&&Number.isFinite(value.height)?minimum(lo,hi)-value.height:Infinity;
     if(far&&coarseMargin>=-FAR_MARGIN_M&&coarseMargin<FAR_MARGIN_M&&!refinementUnavailable&&Number.isFinite(nativeZoom)){
      // Keep the original 100 m segment; clip ALL native cell intervals to this coarse interval.
      // Do not put the coarse height into the skyline/last bank before replacing it.
      nativeMarks??=boundaries(from,to,nativeZoom);
      const cuts=[marks[i-1],...nativeMarks.filter(t=>t>marks[i-1]&&t<marks[i]),marks[i]];
      for(let j=1;j<cuts.length;j++){
       if(cuts[j]-cuts[j-1]<1e-12)continue;
       current();
       const low=d+cuts[j-1]*(next-d),high=d+cuts[j]*(next-d),at=geo.destination(observer.latitude,observer.longitude,azimuth,(low+high)/2000);
       const fine=await sample(at,options);current();
       if(fine.reason==='terrain-budget')return {status:'unknown',checked,missing,partial:true,reason:fine.reason,hit};
       // A coarse/last-bank value cannot certify a missing fine cell. Stop further refinement
       // on this ray instead of repeatedly fetching the same failed resource; coarse hits still apply.
       if(!Number.isFinite(fine.height)){missing++;farUncertain=true;refinementUnavailable=true;break;}
       record(fine,low,high,false);
       if(steps%256===0){await (typeof AstroNotesLibrary==='object'&&AstroNotesLibrary.pause?AstroNotesLibrary.pause():new Promise(resolve=>setTimeout(resolve,0)));current();}
       if(steps>=200000)return {status:hit?'blocked':'unknown',hit,checked,missing,partial:true,reason:'terrain-compute-budget'};
       if(hit)break;
      }
      if(hit)break;
      continue;
     }
     // A pixel with no value in any layer (a river or lake surface) lies below its banks: the last bank
     // read on the line stands in for it, which can only make the line look more hidden, never clearer.
     if(!Number.isFinite(value.height)){if(Number.isFinite(lastHeight)&&['missing-dem','missing-tile'].includes(value.reason))value={...value,height:lastHeight,layer:'bank-for-water'};else{missing++;continue;}}
     record(value,lo,hi,far);
     if(steps%256===0){await (typeof AstroNotesLibrary==='object'&&AstroNotesLibrary.pause?AstroNotesLibrary.pause():new Promise(resolve=>setTimeout(resolve,0)));current();}
     if(steps>=200000)return {status:hit?'blocked':'unknown',hit,checked,missing,partial:true,reason:'terrain-compute-budget'};
     if(hit)break;
    }
    d=next;if(hit)break;
   }
   const skyDen=Math.cos(theta)-Math.tan(skyAlpha)*Math.sin(theta),skyline=Number.isFinite(skyAt)&&skyDen>0?{distanceM:skyAt,terrainM:skyM,toM:(effectiveR+eye)/skyDen-effectiveR,riseM:fallAround(seenD,seenH,skyAt,skyM,-1),dropM:fallAround(seenD,seenH,skyAt,skyM,1)}:null;
   return {status:hit?'blocked':missing||endpointUncertain||farUncertain?'unknown':'model-clear',reason:!hit&&farUncertain?'coarse-terrain-margin':undefined,hit,checked,missing,minMarginM:Number.isFinite(minMarginM)?minMarginM:null,source:lastSource,scopeM:d,nativeRaster:true,
   endpointContactUncertain:endpointUncertain,datumUncertainty:true,skyline};
  }finally{for(const request of prefetched.values())request.controller.abort();}
 }
 // resetBudget(scale): a caller reading far more ground for one place (a surveyed observation room's rays) asks for
 // that many times the tiles; without a scale the budget is the one it was made with.
 return {sample,peek,at:async(p,o)=>(await sample(p,o)).height,trace,
  resetBudget:(scale=1)=>{fetched=0;readKeys.clear();started=Date.now();limit=maxTiles*(scale>0?scale:1);},stats:()=>({tiles:done.size+cache.size,cachedTiles:done.size,pendingTiles:cache.size,cacheLimit,fetched}),clearFailures:()=>{fetched=0;}};
}
api.createLive=createLive;
if(typeof module==='object'&&module.exports)module.exports={createLive};
})(globalThis);

/* Trial picking on the existing drawing's convex volumes. This is approximate drawing geometry, not surveyed PLATEAU geometry. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesTrialSurface=api;})(globalThis,function(){
'use strict';
const rad=Math.PI/180,G=()=>globalThis.AstroNotesTerrain||(typeof require==='function'?require('../../../astronotes-terrain.js'):null),surfaceHulls=()=>globalThis.AstroNotesTrialSurfaceHulls||(typeof require==='function'?require('./scene-hulls.js'):null);
let cached=null;const modelChecks=new WeakMap(),compiled=new WeakMap();
const targetFrame=t=>JSON.stringify([t.id,t.latitude,t.longitude,t.groundM,t.parts]);
const hash=value=>{const text=JSON.stringify(value);let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return h>>>0;};
const validPoint=p=>Array.isArray(p)&&p.length>=3&&p.slice(0,3).every(Number.isFinite),sub=(a,b)=>a.map((x,i)=>x-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0);
// Existing drawing solids are convex volumes, not ordered polygon boundaries.
// Incremental hulls keep that contract; explicit triangle meshes are never
// convexified, preserving concavities and openings in their supplied geometry.
function convexTriangles(vertices,indices){
 const ids=[...new Set(indices)].filter((id,i,a)=>!a.slice(0,i).some(j=>vertices[j].every((x,k)=>Math.abs(x-vertices[id][k])<1e-9)));
 if(ids.length<3)return [];
 const a=ids[0],b=ids.reduce((j,k)=>dot(sub(vertices[k],vertices[a]),sub(vertices[k],vertices[a]))>dot(sub(vertices[j],vertices[a]),sub(vertices[j],vertices[a]))?k:j,a),ab=sub(vertices[b],vertices[a]);
 const c=ids.reduce((j,k)=>dot(cross(ab,sub(vertices[k],vertices[a])),cross(ab,sub(vertices[k],vertices[a])))>dot(cross(ab,sub(vertices[j],vertices[a])),cross(ab,sub(vertices[j],vertices[a])))?k:j,a),normal=cross(ab,sub(vertices[c],vertices[a])),norm=Math.hypot(...normal);
 if(norm<1e-10)return [];
 const scale=Math.max(1,...ids.map(i=>Math.hypot(...sub(vertices[i],vertices[a])))),eps=scale*1e-8,d=ids.reduce((j,k)=>Math.abs(dot(normal,sub(vertices[k],vertices[a])))>Math.abs(dot(normal,sub(vertices[j],vertices[a])))?k:j,a);
 if(Math.abs(dot(normal,sub(vertices[d],vertices[a])))/norm<=eps){
  const axis=normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs))),xy=id=>vertices[id].filter((_,i)=>i!==axis),turn=(a,b,c)=>{const p=xy(a),q=xy(b),r=xy(c);return(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  },sorted=ids.slice().sort((a,b)=>xy(a)[0]-xy(b)[0]||xy(a)[1]-xy(b)[1]),low=[],high=[];
  for(const i of sorted){while(low.length>=2&&turn(low.at(-2),low.at(-1),i)<=0)low.pop();low.push(i);}for(const i of sorted.reverse()){while(high.length>=2&&turn(high.at(-2),high.at(-1),i)<=0)high.pop();high.push(i);}const ring=low.slice(0,-1).concat(high.slice(0,-1));
  return ring.slice(1,-1).map((id,i)=>[ring[0],id,ring[i+2]]);
 }
 const center=[0,1,2].map(k=>(vertices[a][k]+vertices[b][k]+vertices[c][k]+vertices[d][k])/4),face=(i,j,k)=>{const n=cross(sub(vertices[j],vertices[i]),sub(vertices[k],vertices[i]));return dot(n,sub(center,vertices[i]))>0?[i,k,j]:[i,j,k];};
 let faces=[face(a,b,c),face(a,d,b),face(a,c,d),face(b,d,c)];
 for(const id of ids){if([a,b,c,d].includes(id))continue;const visible=f=>{const n=cross(sub(vertices[f[1]],vertices[f[0]]),sub(vertices[f[2]],vertices[f[0]]));return dot(n,sub(vertices[id],vertices[f[0]]))>eps*Math.hypot(...n);},removed=faces.filter(visible);if(!removed.length)continue;
 const edges=new Map();for(const f of removed)for(let i=0;i<3;i++){const u=f[i],v=f[(i+1)%3],key=u<v?u+','+v:v+','+u;if(edges.has(key))edges.delete(key);else edges.set(key,[u,v]);}faces=faces.filter(f=>!visible(f));for(const [u,v]of edges.values())faces.push(face(u,v,id));}
 return faces;
}
function sourceModel(align,target){
 const has=m=>!!m&&(Array.isArray(m.vertices)||Array.isArray(m.solids));
 if(has(target.model))return target.model;
 const direct=(globalThis.AstroNotesTowerModels||align.TOWER_MODELS)?.[target.id]||(globalThis.AstroNotesCityModels||align.CITY_MODELS)?.[target.id];if(has(direct))return direct;
 // Built-in drawings outside the registries expose their model ID through the
 // actual outline. Resolve by capability/identity, without a target-name list.
 let id;try{id=align.towerOutline?.({...G().destination(target.latitude,target.longitude,180,1),elevation:target.groundM??0},target)?.modelId;}catch{return null;}
 return id?Object.values(align).find(m=>has(m)&&m.id===id)||null:null;
}
function model(align,target){
 if(!align||!target?.parts?.length)return null;const hulls=surfaceHulls();if(!hulls)return null;
 const raw=sourceModel(align,target);if(!raw)return null;
 const frameKey=targetFrame(target);let byFrame=compiled.get(raw);if(byFrame?.has(frameKey))return byFrame.get(frameKey);
 if(!(raw.heightM>0)||raw.heightMode&&!['scale','translate-top'].includes(raw.heightMode))return null;
 if(raw.id===hulls?.modelId){if(!modelChecks.has(raw))modelChecks.set(raw,raw.vertices?.length===hulls.vertexCount&&raw.faces?.length===hulls.triangles.length&&hash({vertices:raw.vertices,faces:raw.faces,heightM:raw.heightM})===hulls.signature);if(!modelChecks.get(raw))return null;}
 const ground=target.groundM??0,top=(target.parts.find(p=>p.id==='tip')||target.parts[0]).m-ground;if(!Number.isFinite(ground)||!(top>0))return null;
 const ref=raw.calibration?.observer,bearing=ref?G().inverse(target.latitude,target.longitude,ref.latitude,ref.longitude).azimuth:raw.referenceBearing??0,axis=(bearing-90)*rad,depth=(bearing+180)*rad;
 let original,groups;
 if(raw.vertices){original=raw.vertices;if(!original.every(validPoint))return null;groups=raw.triangles?raw.triangles.map(t=>[t]):raw.faces;if(!Array.isArray(groups))return null;}
 else {original=[];groups=[];for(const solid of raw.solids||[]){if(!Array.isArray(solid)||!solid.every(validPoint))return null;groups.push(solid.map(p=>{original.push(p);return original.length-1;}));}}
 const vertices=original.map(([x,y,z],i)=>{let east=raw.vertices?x:x*Math.sin(axis)+y*Math.sin(depth),north=raw.vertices?y:x*Math.cos(axis)+y*Math.cos(depth);
  if(raw.geoVertices){const p=raw.geoVertices[i];if(!Array.isArray(p)||!p.slice(0,2).every(Number.isFinite))return null;const g=G().inverse(target.latitude,target.longitude,p[0],p[1]);east=g.km*1000*Math.sin(g.azimuth*rad);north=g.km*1000*Math.cos(g.azimuth*rad);}
  const height=ground+(raw.heightMode==='translate-top'?(raw.groundAnchored&&z===0?0:z+top-raw.heightM):z*top/raw.heightM);return [east,north,height];});if(vertices.some(p=>!p))return null;
 const indexValid=i=>Number.isInteger(i)&&i>=0&&i<vertices.length;
 let triangles;if(raw.triangles){if(!raw.triangles.every(t=>t.length===3&&t.every(indexValid)))return null;triangles=raw.triangles.map(t=>[t]);}
 else{if(!groups.every(f=>Array.isArray(f)&&f.every(indexValid)))return null;triangles=raw.id===hulls?.modelId?hulls.triangles:groups.map(f=>convexTriangles(vertices,f));}
 if(!triangles.some(t=>t.length))return null;
 const signature=hash({vertices,triangles}),m={...raw,id:raw.id||'registered-shape-'+signature,vertices,faces:triangles.map(ts=>[...new Set(ts.flat())]),surfaceTriangles:triangles,signature,approximate:true};
 if(!byFrame){byFrame=new Map();compiled.set(raw,byFrame);}if(byFrame.size>=8)byFrame.clear();byFrame.set(frameKey,m);return m;
}
function compatible(c,t,align=globalThis.AstroNotesAlign||(typeof require==='function'?require('../../../astronotes-align.js'):null)){const m=model(align,t);return !!m&&c.modelId===m.id&&c.modelSignature===m.signature&&c.targetFrame===targetFrame(t);}
function bounds({target,align=globalThis.AstroNotesAlign||(typeof require==='function'?require('../../../astronotes-align.js'):null),obs}){
 const m=model(align,target);if(!m)return null;
 const bearing=obs?G().inverse(target.latitude,target.longitude,obs.latitude,obs.longitude).azimuth*rad:0,b={heightMinM:Infinity,heightMaxM:-Infinity,eastMinM:Infinity,eastMaxM:-Infinity,northMinM:Infinity,northMaxM:-Infinity,xMinM:Infinity,xMaxM:-Infinity};
 for(const [east,north,height]of m.vertices){const x=-Math.cos(bearing)*east+Math.sin(bearing)*north;b.heightMinM=Math.min(b.heightMinM,height);b.heightMaxM=Math.max(b.heightMaxM,height);b.eastMinM=Math.min(b.eastMinM,east);b.eastMaxM=Math.max(b.eastMaxM,east);
 b.northMinM=Math.min(b.northMinM,north);b.northMaxM=Math.max(b.northMaxM,north);b.xMinM=Math.min(b.xMinM,x);b.xMaxM=Math.max(b.xMaxM,x);}return b;
}
function world(target,eastM,northM,heightM){return {...G().destination(target.latitude,target.longitude,Math.atan2(eastM,northM)/rad,Math.hypot(eastM,northM)/1000),heightM};}
function anchor(target,c){return world(target,c.eastM,c.northM,c.heightM);}
function geometry(obs,target,c,align){const p=anchor(target,c);return {anchor:p,...align.geometryFrom(obs,{...target,latitude:p.latitude,longitude:p.longitude,parts:[{id:'__surface',m:c.heightM}]},{eyeM:obs.eyeM??1.5,heightM:c.heightM})};}
function frame(obs,target,align){const m=model(align,target);if(!m)return null;const key=JSON.stringify([obs.latitude,obs.longitude,obs.elevation,obs.eyeM,targetFrame(target),m.signature,globalThis.AstroNotesAtmosphere?.targetK?.()]);if(cached?.key===key)return cached;
 const bearing=G().inverse(obs.latitude,obs.longitude,target.latitude,target.longitude).azimuth,project=align.viewProjector(bearing,0);
 const vertices=m.vertices.map(([e,n,h])=>{const p=world(target,e,n,h),g=align.geometryFrom(obs,{...target,...p,parts:[{id:'__surface',m:h}]},{eyeM:obs.eyeM??1.5,heightM:h}),xy=project(g.azimuth,g.angle),depth=g.distanceKm*1000*Math.cos((g.azimuth-bearing)*rad);return {e,n,h,xy,depth};});
 const solids=m.faces.map((f,i)=>{const pts=f.map(j=>vertices[j]);if(!pts.length||pts.some(v=>!v.xy||v.depth<=0))return null;
 return {triangles:m.surfaceTriangles[i],box:[Math.min(...pts.map(v=>v.xy[0])),Math.min(...pts.map(v=>v.xy[1])),Math.max(...pts.map(v=>v.xy[0])),Math.max(...pts.map(v=>v.xy[1]))]};});
 return cached={key,vertices,solids,project,model:m,bearing};
}
function bary(a,b,c,p){const det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(det)<1e-12)return null;const u=((b[1]-c[1])*(p[0]-c[0])+(c[0]-b[0])*(p[1]-c[1]))/det,v=((c[1]-a[1])*(p[0]-c[0])+(a[0]-c[0])*(p[1]-c[1]))/det;return [u,v,1-u-v].every(x=>x>=-1e-7)?[u,v,1-u-v]:null;}
function composition(f,obs,target,p,limb='center'){const bearing=G().inverse(target.latitude,target.longitude,obs.latitude,obs.longitude).azimuth*rad;
return {basis:'scene-surface',modelId:f.model.id,modelSignature:f.model.signature,targetFrame:targetFrame(target),eastM:p.e,northM:p.n,heightM:p.h,xM:-Math.cos(bearing)*p.e+Math.sin(bearing)*p.n,limb,approximate:true};}
function pick({obs,target,align,azimuth,altitude,limb='center'}){const f=frame(obs,target,align),q=f?.project(azimuth,altitude);if(!q)return null;let best=null;
 for(const solid of f.solids){if(!solid)continue;const b=solid.box;if(q[0]<b[0]-1e-8||q[0]>b[2]+1e-8||q[1]<b[1]-1e-8||q[1]>b[3]+1e-8)continue;
  for(const ids of solid.triangles){const v=ids.map(i=>f.vertices[i]),weights=bary(...v.map(p=>p.xy),q);if(!weights)continue;const inv=weights.reduce((s,x,i)=>s+x/v[i].depth,0),depth=1/inv;if(!(depth>0)||best&&depth>=best.depth)continue;const mu=weights.map((x,i)=>x/v[i].depth/inv);
  best={v,mu,depth};}
 }
 if(!best)return null;
 // Refine in the selected triangle using the exact same geographic projection as the scene.
 let [u,v]=best.mu;const pts=best.v,point=(u,v)=>({e:pts[0].e*u+pts[1].e*v+pts[2].e*(1-u-v),n:pts[0].n*u+pts[1].n*v+pts[2].n*(1-u-v),h:pts[0].h*u+pts[1].h*v+pts[2].h*(1-u-v)}),at=(u,v)=>{const p=point(u,v),c=composition(f,obs,target,p),g=geometry(obs,target,c,align);
 return f.project(g.azimuth,g.angle);};
 for(let i=0;i<5;i++){const p=at(u,v);if(!p)return null;const x=p[0]-q[0],y=p[1]-q[1];if(Math.hypot(x,y)<1e-8)break;const d=1e-4,a=at(u+d,v),b=at(u,v+d);if(!a||!b)return null;const j00=(a[0]-p[0])/d,j10=(a[1]-p[1])/d,j01=(b[0]-p[0])/d,j11=(b[1]-p[1])/d,det=j00*j11-j01*j10;
 if(Math.abs(det)<1e-14)return null;u-=(j11*x-j01*y)/det;v-=(-j10*x+j00*y)/det;}
 if(u<-.002||v<-.002||u+v>1.002)return null;const p=point(u,v),back=at(u,v);if(!back||Math.hypot(back[0]-q[0],back[1]-q[1])>1e-5)return null;return composition(f,obs,target,p,limb);
}
function preset({obs,target,align,heightM,xM=0,limb='center'}){const m=model(align,target);if(!m||!Number.isFinite(heightM)||!Number.isFinite(xM))return null;
const bearing=G().inverse(target.latitude,target.longitude,obs.latitude,obs.longitude).azimuth*rad,right=p=>-Math.cos(bearing)*p[0]+Math.sin(bearing)*p[1],front=p=>Math.sin(bearing)*p[0]+Math.cos(bearing)*p[1],z=heightM;let chosen=null,depth=-Infinity;
 for(const triangles of m.surfaceTriangles)for(const ids of triangles){const verts=ids.map(i=>m.vertices[i]);if(z<Math.min(...verts.map(p=>p[2]))-1e-7||z>Math.max(...verts.map(p=>p[2]))+1e-7)continue;const cut=[];for(let i=0;i<3;i++){const a=verts[i],b=verts[(i+1)%3];
 if(Math.abs(a[2]-z)<1e-7)cut.push(a);if((a[2]<z&&b[2]>z)||(a[2]>z&&b[2]<z)){const t=(z-a[2])/(b[2]-a[2]);cut.push(a.map((x,j)=>x+t*(b[j]-x)));}}
  for(let i=0;i<cut.length;i++)for(let j=i+1;j<cut.length;j++){const a=cut[i],b=cut[j],ra=right(a),rb=right(b);if(xM<Math.min(ra,rb)-1e-7||xM>Math.max(ra,rb)+1e-7)continue;const t=Math.abs(rb-ra)<1e-9?(front(a)>front(b)?0:1):(xM-ra)/(rb-ra),p=a.map((x,k)=>x+t*(b[k]-x)),d=front(p);
  if(d>depth){chosen=p;depth=d;}}
 }
 return chosen?composition({model:m},obs,target,{e:chosen[0],n:chosen[1],h:heightM},limb):null;
}
function visible({obs,target,align,composition:c,toleranceM=.5}){if(!model(align,target)||!compatible(c,target,align))return {known:false,visible:false};const g=geometry(obs,target,c,align),first=pick({obs,target,align,azimuth:g.azimuth,altitude:g.angle});
if(!first)return {known:false,visible:false};const distance=Math.hypot(first.eastM-c.eastM,first.northM-c.northM,first.heightM-c.heightM);return {known:true,visible:distance<=toleranceM,distanceM:distance};}
return {model,bounds,compatible,anchor,geometry,pick,preset,visible};
});

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
function directionAt(bodies,...args){return (typeof bodies.direction==='function'?bodies.direction:bodies.state).apply(bodies,args);}
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
const horizonAt=eye=>eye>0?-Math.acos(R/(R+eye))/rad:0;
// Every apparent altitude at a fixed azimuth projects onto the same line.
// The line equation comes from the azimuth plane's normal in the target's tangent basis.
function azimuthDistance(box,g,azimuth){
 const delta=(azimuth-g.azimuth)*rad,alt=g.angle*rad;
 const x=Math.cos(delta),y=Math.sin(alt)*Math.sin(delta),c=-Math.cos(alt)*Math.sin(delta)/rad;
 const lo=c+Math.min(x*box.minX,x*box.maxX)+Math.min(y*box.minY,y*box.maxY);
 const hi=c+Math.max(x*box.minX,x*box.maxX)+Math.max(y*box.minY,y*box.maxY);
 return Math.max(0,lo,-hi)/Math.hypot(x,y);
}
// A negative result leaves the normal solver in charge. Only a single instant
// with no surface search or rise/set window has no unsampled positions or times.
function definiteAngularMiss(plan,observer,{align,bodies}={}){
 if(plan?.timeSpec?.kind!=='instant'||!Number.isFinite(plan.timeSpec.at)||plan.composition||plan.compositionInvalid||plan.strict||
  plan.profile==='summit-contact'||plan.target?.rim||!windowValid(plan.timeWindow)||(plan.timeWindow?.kind&&plan.timeWindow.kind!=='none'))return false;
 const target=targetInput(plan.target),partId=plan.partId==='__whole'?null:plan.partId;
 if(!target||!align||!bodies||![observer?.latitude,observer?.longitude].every(Number.isFinite))return false;
 const elevation=Number.isFinite(observer.standingElevationM)?observer.standingElevationM:
  Number.isFinite(observer.surfaceElevationM)?observer.surfaceElevationM:observer.elevation;
 const eyeM=observer.eyeM??observer.eyeHeightAGL??1.5;
 if(!Number.isFinite(elevation)||!Number.isFinite(eyeM)||eyeM<0)return false;
 const point={...observer,elevation,eyeM},eye=elevation+eyeM;
 try{
  if(bodies.definition&&!bodies.definition(plan.body))return false;
  const g=align.geometryFrom(point,target,{partId,eyeM});
  if(!g||![g.azimuth,g.angle,g.topM,g.distanceKm].every(Number.isFinite))return false;
  // Weather data can arrive during the detailed checks in auto mode. Azimuth
  // and the body's angular radius are independent of those refraction updates.
  const auto=globalThis.AstroNotesAtmosphere?.mode?.()==='auto';
  const state=bodies.state(plan.body,plan.timeSpec.at,{...point,elevation:eye},{refraction:!auto}),policy=nearPolicy(plan,bodies,state);
  if(![state.azimuth,policy.radius,policy.tolerance].every(Number.isFinite)||policy.radius<0)return false;
  let xy;
  if(!auto){
   if(!Number.isFinite(state.apparentAltitude))return false;
   const upper=state.upperAltitude??state.apparentAltitude+policy.radius;
   if(Number.isFinite(upper)&&upper<horizonAt(eye))return true;
   xy=align.viewProjector(g.azimuth,g.angle)(state.azimuth,state.apparentAltitude);
   if(!xy)return true;
   if(!xy.every(Number.isFinite))return false;
  }
  // The origin is the solver's fallback if no outline projects into usable rings.
  const box=partId?{minX:0,minY:0,maxX:0,maxY:0}:align.outlineScreenBounds?.(point,target,g,{eyeM});
  if(!box||![box.minX,box.minY,box.maxX,box.maxY].every(Number.isFinite)||
   box.minX>0||box.minY>0||box.maxX<0||box.maxY<0)return false;
  if(auto){
   const distance=azimuthDistance(box,g,state.azimuth);
   return Number.isFinite(distance)&&Math.max(0,Math.atan(distance*rad)/rad-policy.radius)>policy.tolerance+1e-6;
  }
  if(!partId){
   const [x,y]=xy,dx=Math.max(0,box.minX-x,x-box.maxX),dy=Math.max(0,box.minY-y,y-box.maxY);
   const lowerAngle=Math.atan(Math.hypot(dx,dy)*rad)/rad;
   return Math.max(0,lowerAngle-policy.radius)>policy.tolerance+1e-6;
  }
  const angle=Math.atan(Math.hypot(...xy)*rad)/rad,gap=Math.max(0,angle-policy.radius);
  const below=angle>policy.radius&&xy[1]<0&&Math.abs(xy[1])>Math.abs(xy[0]);
  return below||gap>policy.tolerance+1e-10;
 }catch{return false;}
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
// Keep the existing small groups of projected rings. A hierarchy bounds whole
// groups so a query need not scan every group before reaching nearby edges.
const clusterCache=new WeakMap();
function groupTree(groups){
 if(groups.length===1)return groups[0];
 const box={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
 for(const g of groups){
  box.minX=Math.min(box.minX,g.minX);box.minY=Math.min(box.minY,g.minY);
  box.maxX=Math.max(box.maxX,g.maxX);box.maxY=Math.max(box.maxY,g.maxY);
 }
 const byX=box.maxX-box.minX>=box.maxY-box.minY;
 groups.sort(byX?(a,b)=>(a.minX+a.maxX)-(b.minX+b.maxX):(a,b)=>(a.minY+a.maxY)-(b.minY+b.maxY));
 const mid=Math.floor(groups.length/2);
 return {...box,left:groupTree(groups.slice(0,mid)),right:groupTree(groups.slice(mid))};
}
function outlineClusters(polygons,rings){
 if(clusterCache.has(polygons))return clusterCache.get(polygons);
 const order=rings.map((r,i)=>i).sort((a,b)=>(rings[a].minX+rings[a].maxX)-(rings[b].minX+rings[b].maxX)||a-b),groups=[];
 for(let k=0;k<order.length;k+=32){
  const members=order.slice(k,k+32).sort((a,b)=>(rings[a].minY+rings[a].maxY)-(rings[b].minY+rings[b].maxY)||a-b);
  for(let m=0;m<members.length;m+=8){const ids=members.slice(m,m+8);let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
   for(const i of ids){const r=rings[i];if(r.minX<minX)minX=r.minX;if(r.maxX>maxX)maxX=r.maxX;if(r.minY<minY)minY=r.minY;if(r.maxY>maxY)maxY=r.maxY;}
   groups.push({ids,minX,minY,maxX,maxY});
  }
 }
 const tree=groups.length?groupTree(groups):null;
 clusterCache.set(polygons,tree);return tree;
}
function outsideBox(x,y,b){return x<b.minX||x>b.maxX||y<b.minY||y>b.maxY;}
function insideTree(x,y,node,rings){
 if(outsideBox(x,y,node))return false;
 if(!node.ids)return insideTree(x,y,node.left,rings)||insideTree(x,y,node.right,rings);
 for(const i of node.ids){
  const r=rings[i];if(outsideBox(x,y,r))continue;
  const {n,xs,ys}=r;let on=false;
  for(let a=0,b=n-1;a<n;b=a++)if((ys[a]>y)!==(ys[b]>y)&&x<(xs[b]-xs[a])*(y-ys[a])/(ys[b]-ys[a])+xs[a])on=!on;
  if(on)return true;
 }
 return false;
}
function closestPoint(p,polygons){
 const px=p[0],py=p[1],rings=flat(polygons),tree=outlineClusters(polygons,rings);
 if(!tree)return {point:[0,0],distance:Infinity};
 if(insideTree(px,py,tree,rings))return {point:p,distance:0};
 let distance=Infinity,nx=0,ny=0,bestRing=Infinity,bestEdge=Infinity;
 const gap=b=>Math.hypot(Math.max(b.minX-px,0,px-b.maxX),Math.max(b.minY-py,0,py-b.maxY));
 const visit=(node,bound)=>{
  // Equal-distance branches still compete by the original ring and edge order.
  if(bound>distance)return;
  if(!node.ids){
   const left=gap(node.left),right=gap(node.right);
   if(left<=right){visit(node.left,left);visit(node.right,right);}
   else{visit(node.right,right);visit(node.left,left);}
   return;
  }
  for(const ri of node.ids){
   const r=rings[ri];if(gap(r)>distance)continue;
   const {n,xs,ys}=r;
   for(let i=0;i<n;i++){
    const k=i+1===n?0:i+1,ax=xs[i],ay=ys[i],dx=xs[k]-ax,dy=ys[k]-ay,u=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1)));
    const qx=ax+u*dx,qy=ay+u*dy,d=Math.hypot(px-qx,py-qy);
    if(d<distance||bestRing<Infinity&&d===distance&&(ri<bestRing||ri===bestRing&&i<bestEdge)){distance=d;nx=qx;ny=qy;bestRing=ri;bestEdge=i;}
   }
  }
 };
 visit(tree,gap(tree));
 return {point:[nx,ny],distance};
}
const sameRidgeRaw=(prepared,raw)=>raw===prepared.raw&&raw.length===prepared.slots.length&&prepared.slots.every((p,i)=>Object.is(p.latitude,raw[i].latitude)&&Object.is(p.longitude,raw[i].longitude)&&Object.is(p.heightM,raw[i].m??raw[i].heightM));
// A model owns one active request context, never one cache per retained search
// session. Old async owners keep only a retired handle after key/clear changes.
function createRidgeContext({capacity=8192}={}){
 capacity=Math.max(1,Math.min(8192,Math.floor(Number.isFinite(capacity)?capacity:8192)));
 const rows=new Map(),rangeRows=new Map();let binding=null,epoch=0,retired=false,hits=0,rangeHits=0,misses=0,builds=0;
 const reset=()=>{rows.clear();rangeRows.clear();binding=null;epoch++;};
 const copy=p=>({anchor:{...p.anchor},geometry:{...p.geometry},relative:p.relative});
 const usable=p=>p&&[p.anchor?.latitude,p.anchor?.longitude,p.anchor?.heightM,p.geometry?.distanceKm,p.geometry?.azimuth,p.geometry?.angle,p.geometry?.topM,p.relative].every(Number.isFinite);
 const keyOf=values=>values.every(Number.isFinite)?values.map(n=>Object.is(n,-0)?'-0':String(n)).join('|'):null;
 return {retire(){retired=true;reset();},stats:()=>({size:rows.size,rangeRows:rangeRows.size,capacity,retired,hits,rangeHits,misses,builds}),forOwner:(current=()=>true)=>({prepare(target,align,observer){
  if(retired||current()===false)return null;
  const geo=Geo();if(!align.prepareRidgeObserver||!geo.prepareInverseRegion||!align.prepareRidgeObserver(observer)){reset();return null;}
  const raw=target.rim?.points||align.rimPoints?.(target.rim),signature=[target,target.rim,align,geo,align.geometryFrom,align.rimPoints,align.prepareRidgeObserver,geo.inverse,geo.prepareInverseRegion,target.rim?.latitude??target.latitude,target.rim?.longitude??target.longitude];
  if(!binding||!signature.every((v,i)=>Object.is(v,binding.signature[i]))||!sameRidgeRaw(binding.prepared,raw)){
   reset();const prepared=prepareRidge(target,align,observer);if(!prepared)return null;binding={signature,prepared};builds++;
  }
  const token=epoch,active=()=>!retired&&token===epoch&&current()!==false;
  const forget=key=>{const old=rows.get(key);if(old&&rangeRows.get(old.base)===old)rangeRows.delete(old.base);rows.delete(key);};
  const memo={invalidate(){if(active())reset();},reader(values){const prefix=keyOf(values);if(prefix===null)return null;const base=prefix+'|';return {
   key:az=>Number.isFinite(az)?base+(Object.is(az,-0)?'-0':String(az)):null,
   get(key,q){if(!active()||key===null)return null;let entry=rows.get(key);
    if(entry)hits++;else{const candidate=rangeRows.get(base),c=candidate?.certificate;if(c&&c.lo<q&&q<c.hi){entry=candidate;rangeHits++;}else{misses++;return null;}}
    rows.delete(entry.key);rows.set(entry.key,entry);return {row:copy(entry.row),certificate:entry.certificate&&{...entry.certificate}};
   },
   put(key,p,certificate){if(!active()||key===null||!usable(p))return;forget(key);const entry={key,base,row:copy(p),certificate:certificate&&{...certificate}};rows.set(key,entry);if(certificate)rangeRows.set(base,entry);
    while(rows.size>capacity)forget(rows.keys().next().value);
   }
  };}};
  return {...binding.prepared,memo};
 }})};
}
// Fixed anchor terms and the tree belong to one opportunity solve, or its
// current request context. No rounded key crosses solves.
function prepareRidge(target,align,observer){
 const geo=Geo();if(!align.prepareRidgeObserver||!geo.prepareInverseRegion||!observer||!align.prepareRidgeObserver(observer))return null;
 const raw=target.rim?.points||align.rimPoints?.(target.rim);if(!Array.isArray(raw)||!raw.length)return null;
 const slots=raw.map(p=>{const latitude=p.latitude,longitude=p.longitude,heightM=p.m??p.heightM,valid=[latitude,longitude,heightM].every(Number.isFinite);
  return {latitude,longitude,heightM,valid,anchor:valid?{latitude,longitude,heightM}:null};});
 const ids=[];for(let i=0;i<slots.length;i++)if(slots[i].valid){if(Math.abs(slots[i].latitude)>90||Math.abs(slots[i].longitude)>180)return null;ids.push(i);}
 if(!ids.length)return null;
 const make=list=>{if(list.length<=8)return {ids:list,region:geo.prepareInverseRegion(list.map(i=>slots[i].anchor))};
  let minLat=Infinity,maxLat=-Infinity,minLon=Infinity,maxLon=-Infinity;
  for(const i of list){const p=slots[i];minLat=Math.min(minLat,p.latitude);maxLat=Math.max(maxLat,p.latitude);minLon=Math.min(minLon,p.longitude);maxLon=Math.max(maxLon,p.longitude);}
  const axis=maxLat-minLat>maxLon-minLon?'latitude':'longitude';list=list.slice().sort((a,b)=>slots[a][axis]-slots[b][axis]||a-b);const middle=list.length>>>1,left=make(list.slice(0,middle)),right=make(list.slice(middle));
  return {left,right,region:left.region&&right.region?geo.prepareInverseRegion([left.region,right.region]):null};
 };
 return {raw,slots,ids,tree:make(ids)};
}
// A final DFS partition (visited leaves plus pruned frontier) certifies only
// an open interval selecting the same exact row. Unknown/crossing bounds and
// close left bearings refuse reuse: far-away rounded distances could tie and
// favour the earlier row. One-nanodegree inward slack protects finite edges;
// output geometry and the original bin/tie comparison remain unchanged.
function certifyRidgeRange(q,bin,selected,ids,row,frontier,visible){
 if(!(q> -180&&q<180))return null;const p=row(selected),s=p.relative,eps=1e-9;let lo=-180,hi=180;
 const exclude=(a,b)=>{if(q<a)hi=Math.min(hi,a-eps);else if(q>b)lo=Math.max(lo,b+eps);else return false;return true;};
 if(visible){
  lo=Math.max(lo,s-bin+eps);hi=Math.min(hi,s+bin-eps);
  for(const i of ids){if(i===selected)continue;const r=row(i);if(!r)continue;
   if(r.geometry.angle>p.geometry.angle||r.geometry.angle===p.geometry.angle&&(r.relative<s||r.relative===s&&i<selected))if(!exclude(r.relative-bin,r.relative+bin))return null;
  }
  for(const arcs of frontier){if(!arcs)return null;for(const [a,b]of arcs)if(!exclude(a-bin,b+bin))return null;}
 }else{
  const lower=x=>{if(!(s-x>eps))return false;lo=Math.max(lo,(s+x)/2+eps);return true;};
  const upper=x=>{if(!(x>s))return false;hi=Math.min(hi,(s+x)/2-eps);return true;};
  for(const i of ids){if(i===selected)continue;const r=row(i);if(!r)continue;
   if(r.relative<s){if(!lower(r.relative))return null;}else if(r.relative>s){if(!upper(r.relative))return null;}else if(i<selected)return null;
  }
  for(const arcs of frontier){if(!arcs)return null;for(const [a,b]of arcs){if(b<s){if(!lower(b))return null;}else if(a>s){if(!upper(a))return null;}else return null;}}
  if(q<s)hi=Math.min(hi,s-bin-eps);else if(q>s)lo=Math.max(lo,s+bin+eps);else return null;
 }
 return lo<q&&q<hi?{lo,hi}:null;
}
function lazyRidge(observer,target,align,prepared,center,bin){
 if(!prepared||![center.km,center.azimuth,bin].every(Number.isFinite)||bin<0)return null;
 const raw=target.rim?.points||align.rimPoints?.(target.rim),reader=align.prepareRidgeObserver?.(observer);
 if(!sameRidgeRaw(prepared,raw)||!reader?.bearingIntervals||reader.inverse!==Geo().inverse){prepared.memo?.invalidate();return null;}
 const memo=Array.isArray(reader.cacheKey)&&reader.cacheKey.length===5&&reader.cacheKey.every(Number.isFinite)?prepared.memo?.reader([...reader.cacheKey,center.km,center.azimuth,bin]):null;let certificate=null,certifiedRow=null;
 const difference=(a,b)=>((a-b+540)%360)-180,padding=1e-9,rows=new Map(),regions=new Map();let materialized=null;
 const row=i=>{if(!rows.has(i)){const anchor=prepared.slots[i].anchor,geometry=reader.geometry(anchor);rows.set(i,Number.isFinite(geometry?.angle)?{anchor:{...anchor},geometry,relative:difference(geometry.azimuth,center.azimuth)}:null);}return rows.get(i);};
 const all=()=>materialized||=prepared.ids.map(i=>({row:row(i),ordinal:i})).filter(p=>p.row).sort((a,b)=>a.row.relative-b.row.relative||a.ordinal-b.ordinal).map(p=>p.row);
 const earlier=(i,j)=>{const a=row(i),b=row(j);return a.relative<b.relative||a.relative===b.relative&&i<j;};
 const intervals=node=>{if(regions.has(node))return regions.get(node);const arcs=node.region?reader.bearingIntervals(node.region):null;let found=null;
  if(arcs?.length){found=[];for(const a of arcs){if(![a.azimuth,a.marginDeg].every(Number.isFinite)||a.marginDeg<0||a.marginDeg>=180){found=null;break;}
   const r=difference(a.azimuth,center.azimuth),lo=r-a.marginDeg,hi=r+a.marginDeg;
   if(lo< -180)found.push([-180,hi],[lo+360,180]);else if(hi>=180)found.push([lo,180],[-180,hi-360]);else found.push([lo,hi]);
  }}regions.set(node,found);return found;};
 const distanceBound=(node,q)=>{const list=intervals(node);if(!list)return 0;let d=Infinity;for(const [a,b]of list)d=Math.min(d,q<a?a-q:q>b?q-b:0);return d;};
 // Canonical finite point geometry is expected. Preserve eager null handling
 // if its first valid anchor cannot provide a usable geometry.
 if(!row(prepared.ids[0])||!Number.isFinite(row(prepared.ids[0]).relative))return null;
 return {get points(){return all();},at:azimuth=>{
  const q=difference(azimuth,center.azimuth);if(materialized||!Number.isFinite(q))return ridgeAt(all(),q,bin,all().every(p=>Number.isFinite(p.relative)));
  if(certificate&&certificate.lo<q&&q<certificate.hi){return certifiedRow;}
  // The immutable observer prefix is prepared once, not stringified per query.
  const memoKey=memo?.key(azimuth),hit=memoKey&&memo.get(memoKey,q);if(hit){certificate=hit.certificate;certifiedRow=hit.row;return hit.row;}
  const checked=[],frontier=[];
  let visible=null,closest=null,best=Infinity;
  const consider=i=>{const p=row(i);if(!p)return;checked.push(i);const d=Math.abs(p.relative-q);
   if(closest===null||d<best||d===best&&earlier(i,closest)){closest=i;best=d;}
   if(d<=bin&&(visible===null||p.geometry.angle>row(visible).geometry.angle||p.geometry.angle===row(visible).geometry.angle&&earlier(i,visible)))visible=i;
  };
  const visit=(node,limit,gap=distanceBound(node,q))=>{if(gap>limit()+padding){frontier.push(intervals(node));return;}
   if(node.ids){for(const i of node.ids)consider(i);return;}
   const a=distanceBound(node.left,q),b=distanceBound(node.right,q);
   if(a<=b){visit(node.left,limit,a);visit(node.right,limit,b);}else{visit(node.right,limit,b);visit(node.left,limit,a);}
  };
  const finish=(i,visible)=>{if(i===null)return null;const p=row(i);certificate=certifyRidgeRange(q,bin,i,checked,row,frontier,visible);certifiedRow=p;if(memoKey)memo.put(memoKey,p,certificate);return p;};
  visit(prepared.tree,()=>bin);if(visible!==null)return finish(visible,true);
  checked.length=0;frontier.length=0;visit(prepared.tree,()=>best);return finish(closest,false);
 }};
}
// The ridge is already sorted by relative bearing. Preserve the original
// subtraction and tie order at its bin edges; rounded angular buckets would
// change which summit point supplies the contact height.
function ridgeAt(points,relative,bin,ordered=true){
 if(!points.length)return null;
 if(!ordered||!Number.isFinite(relative)||!Number.isFinite(bin)||bin<0){
  let visible=null,closest=null;
  for(const p of points){if(!closest||Math.abs(p.relative-relative)<Math.abs(closest.relative-relative))closest=p;if(Math.abs(p.relative-relative)<=bin&&(!visible||p.geometry.angle>visible.geometry.angle))visible=p;}
  return visible||closest;
 }
 const lower=before=>{let lo=0,hi=points.length;while(lo<hi){const mid=(lo+hi)>>>1;if(before(points[mid].relative))lo=mid+1;else hi=mid;}return lo;};
 const first=lower(value=>value<relative&&Math.abs(value-relative)>bin);let visible=null;
 for(let i=first;i<points.length&&Math.abs(points[i].relative-relative)<=bin;i++){const p=points[i];if(!visible||p.geometry.angle>visible.geometry.angle)visible=p;}
 if(visible)return visible;
 const right=lower(value=>value<relative);if(!right)return points[0];
 // For equal bearings, the old forward scan kept the first point, including
 // when the nearest point lies just to the left of the query.
 const left=points[lower(value=>value<points[right-1].relative)];
 return right===points.length||Math.abs(left.relative-relative)<=Math.abs(points[right].relative-relative)?left:points[right];
}
function ridgeGeometry(observer,target,align,prepared=prepareRidge(target,align,observer)){
 const raw=target.rim?.points||align.rimPoints?.(target.rim);if(!Array.isArray(raw)||!raw.length)return null;
 const center=Geo().inverse(observer.latitude,observer.longitude,target.rim.latitude??target.latitude,target.rim.longitude??target.longitude),difference=(a,b)=>((a-b+540)%360)-180;
 const bin=Math.atan(.015/Math.max(.001,center.km))/rad,lazy=lazyRidge(observer,target,align,prepared,center,bin);if(lazy)return lazy;
 const points=raw.filter(p=>[p.latitude,p.longitude,p.m??p.heightM].every(Number.isFinite)).map(p=>{const anchor={latitude:p.latitude,longitude:p.longitude,heightM:p.m??p.heightM},geometry=align.geometryFrom(observer,{...target,...anchor,rim:null,parts:[{id:'ridge',m:anchor.heightM}]},{
 heightM:anchor.heightM,eyeM:observer.eyeM??1.5});return {anchor,geometry,relative:difference(geometry.azimuth,center.azimuth)};}).filter(p=>Number.isFinite(p.geometry?.angle)).sort((a,b)=>a.relative-b.relative);
 if(!points.length)return null;
 const ordered=points.every(p=>Number.isFinite(p.relative));
 return {points,at:azimuth=>ridgeAt(points,difference(azimuth,center.azimuth),bin,ordered)};
}
function standingDomain(point,sidewalks){
 const s=point.surfaceGeometry;
 if(s){
  const polygons=(s.polygons||[]).filter(p=>p?.[0]?.length>=3),lines=(s.lines||[]).filter(p=>p?.length>=2);
  const inPolygons=(rows,p)=>rows.some(r=>inside(r[0],p)&&!r.slice(1).some(h=>inside(h,p)));
  const within=s.within&&(Array.isArray(s.within)?s.within:[]).filter(p=>p?.[0]?.length>=3),allows=p=>!within||inPolygons(within,p);
  return {polygons,lines,contains:p=>inPolygons(polygons,p)&&allows(p),allows,metadata:{}};
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
// Fair scheduling groups samples on the same mapped surface, not adjacent
// coordinates. This key does not certify that a solve or visibility is reusable.
function surfaceDomainKey(point){
 const shape=point?.surfaceGeometry;if(!shape)return null;
 const polygons=shape.polygons||[],lines=shape.lines||[],within=shape.within;
 if(!Array.isArray(polygons)||!Array.isArray(lines)||!polygons.length&&!lines.length)return null;
 const coordinate=p=>Array.isArray(p)&&p.length>=2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
 if(lines.some(line=>!Array.isArray(line)||line.length<2||!line.every(coordinate)))return null;
 if(polygons.some(poly=>!Array.isArray(poly)||!poly.length||poly.some(ring=>!Array.isArray(ring)||ring.length<3||!ring.every(coordinate))))return null;
 if(within&&(!Array.isArray(within)||within.some(poly=>!Array.isArray(poly)||!poly.length||poly.some(ring=>!Array.isArray(ring)||ring.length<3||!ring.every(coordinate)))))return null;
 const eye=point.eyeM??point.eyeHeightAGL??1.5;if(!Number.isFinite(eye)||eye<0)return null;
 const absolute=point.heightBasis==='constant-absolute-floor'||point.sourceEvidence?.heightBasis==='constant-absolute-floor';
 const floor=absolute?(point.standingElevationM??point.surfaceElevationM):Number.isFinite(point.surfaceAglM)?point.surfaceAglM:point.surfaceHeightM;
 if(!Number.isFinite(floor))return null;
 const source=[point.sourceId??null,point.surfaceId??null,point.polygonId??null];
 if(source.some(id=>id!==null&&typeof id!=='string')||!source.some(id=>typeof id==='string'&&id))return null;
 return JSON.stringify([source,polygons,lines,absolute,floor,eye,...(within?[within]:[])],(_key,value)=>Object.is(value,-0)?'-0':value);
}
// This is a constrained local inverse, not an exhaustive surface search. A
// line has no invented width; every trial position is parameterized on it.
async function surfaceInverse(plan,seed,range,timeSeeds,deps){
 const {align,bodies,terrain,groundAt,sidewalks,standingAt,isCurrent,yieldTask}=deps,domain=standingDomain(seed,sidewalks),solutions=[];
 if(!domain||!domain.polygons.length&&!domain.lines.length)return {solutions,attempted:false,calls:0};
 const limit=Math.max(1,Math.floor(deps.budget)),c=plan.composition,target=plan.target,eyeM=seed.eyeM??seed.eyeHeightAGL??1.5,groundCache=new Map(),ridgeCache=new Map(),ridgePrepared=!c&&target.rim?(deps.ridgePrepared||prepareRidge(target,align,seed)):null;
 let calls=0,exhausted=false,unknown=false,cancelled=false;
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
   const st=directionAt(bodies,plan.body,time,{...observer,elevation:floor+eyeM});let g=c?geometry(observer,target,c,align):align.geometryFrom(observer,target,{partId:plan.partId==='__whole'?null:plan.partId,eyeM});
   if(!c&&target.rim){let rim=ridgeCache.get(key);if(!rim){rim=ridgeGeometry(observer,target,align,ridgePrepared);if(rim)ridgeCache.set(key,rim);}const hit=rim?.at(st.azimuth);if(!hit){unknown=true;return null;}g={...hit.geometry,anchor:hit.anchor};}
   const selected=limbKind(c?.limb||((bodies.definition?.(plan.body)?.limbs??['sun','moon'].includes(plan.body))?plan.limb:'center')),residual=g&&align.viewProjector(g.azimuth,g.angle)(st.azimuth,limb(st,selected));
   return residual?.every(Number.isFinite)?{observer,at:time,geometry:g,residual,loss:Math.hypot(...residual)}:null;
  }catch{unknown=true;return null;}
 }
 const timeStarts=range.kind==='instant'?[range.start]:[...new Set([...(timeSeeds||[]),range.start,(range.start+range.end)/2,range.end])].slice(0,10);
 const bounded=(n,a,b)=>Math.max(a,Math.min(b,n));
 async function accept(q,inDomain){
  if(!q||q.loss>.002||!inDomain(q.observer)||q.at<range.start||q.at>range.end)return;
  if(domain.allows&&!domain.allows(q.observer))return;
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
    if(exhausted||cancelled||solutions.length>=(deps.maxSolutions??Infinity))break;
   }
   if(!improved)break;
  }
  await accept(q,inDomain);
 }
 for(const line of domain.lines){
  if(exhausted||cancelled||solutions.length>=(deps.maxSolutions??Infinity))break;
  const parts=[],vertices=[0];let total=0;
  for(let i=1;i<line.length;i++){const [lon,lat]=line[i-1],[endLon,endLat]=line[i],g=Geo().inverse(lat,lon,endLat,endLon),length=g.km*1000;if(!(length>0))continue;parts.push({start:total,end:total+length,lat,lon,azimuth:g.azimuth});total+=length;vertices.push(total);}
  if(!(total>0))continue;
  const position=s=>{const p=parts.find(p=>s<=p.end)||parts.at(-1);return Geo().destination(p.lat,p.lon,p.azimuth,(bounded(s,0,total)-p.start)/1000);};
  let nearest={s:0,d:Infinity};for(const p of parts){const v=Geo().inverse(p.lat,p.lon,seed.latitude,seed.longitude),s=bounded(v.km*1000*Math.cos((v.azimuth-p.azimuth)*rad),0,p.end-p.start)+p.start,pos=position(s),d=Geo().distanceKm(pos.latitude,pos.longitude,seed.latitude,seed.longitude);
  if(d<nearest.d)nearest={s,d};}
  const starts=[nearest.s,...vertices,...parts.map(p=>(p.start+p.end)/2)].filter((s,i,a)=>a.indexOf(s)===i);
  if(deps.nearbyFirst)starts.sort((a,b)=>Math.abs(a-nearest.s)-Math.abs(b-nearest.s));const stations=starts.slice(0,16);
  for(const t of timeStarts){for(const s of stations){
   if(exhausted||cancelled||solutions.length>=(deps.maxSolutions??Infinity))break;
   if(range.kind==='instant')await optimize([s],x=>[position(x[0]),range.start],[[0,total]],[Math.min(1,total/100)],()=>true);
   else await optimize([s,(t-range.start)/1000],x=>[position(x[0]),range.start+x[1]*1000],[[0,total],[0,(range.end-range.start)/1000]],[Math.min(1,total/100),5],()=>true);
  }if(exhausted||cancelled||solutions.length>=(deps.maxSolutions??Infinity))break;}
 }
 if(domain.polygons.length&&!exhausted&&!cancelled){
  const inverse=Geo().inverse(target.latitude,target.longitude,seed.latitude,seed.longitude),distanceM=inverse.km*1000;
  const offsets=domain.polygons.flatMap(r=>r[0]).map(([lon,lat])=>{const g=Geo().inverse(seed.latitude,seed.longitude,lat,lon);return [g.km*1000*Math.sin(g.azimuth*rad),g.km*1000*Math.cos(g.azimuth*rad)];});
  const bounds=[0,1].map(i=>[Math.min(...offsets.map(p=>p[i])),Math.max(...offsets.map(p=>p[i]))]);
  if(range.kind==='instant'){
   const position=xy=>Geo().destination(seed.latitude,seed.longitude,Math.atan2(xy[0],xy[1])/rad,Math.hypot(...xy)/1000);
   const starts=[[0,0],bounds.map(([a,b])=>(a+b)/2),...offsets].slice(0,10);
   for(const start of starts){if(exhausted||cancelled||solutions.length>=(deps.maxSolutions??Infinity))break;await optimize(start,x=>[position(x),range.start],bounds,[1,1],domain.contains);}
  }else if(distanceM>0){
   // Preserve the old explicit-composition distance constraint while replacing
   // its geographic/time caps with the supplied surface and time range.
   const angles=domain.polygons.flatMap(r=>r[0]).map(([lon,lat])=>{const g=Geo().inverse(target.latitude,target.longitude,lat,lon);return (((g.azimuth-inverse.azimuth+540)%360)-180)*rad*distanceM;}),bound=[Math.min(0,...angles),Math.max(0,...angles)];
   for(const t of timeStarts){if(exhausted||cancelled||solutions.length>=(deps.maxSolutions??Infinity))break;
   await optimize([0,(t-range.start)/1000],x=>[Geo().destination(target.latitude,target.longitude,inverse.azimuth+x[0]/distanceM/rad,distanceM/1000),range.start+x[1]*1000],[bound,[0,(range.end-range.start)/1000]],[1,5],domain.contains);
   }
  }
 }
 return {solutions,attempted:true,calls,exhausted,unknown,cancelled};
}
// Nearby part guides vary time on the actual selected surface; they never
// substitute a distant fixed-time inverse point. Ground is an explicit estimate.
async function localGuides(plan,domain,{groundM,eyeM=1.5,align,bodies,isCurrent=()=>true,yieldTask}={}){
 if(!domain||!Number.isFinite(groundM)||!plan.target?.parts?.length)return {guides:[],partial:false};
 const seed={...domain.origin,groundM,elevation:groundM,groundKnown:true,surfaceAglM:0,eyeM,surfaceGeometry:domain.geometry};
 const range={kind:'window',start:plan.at-2*3600000,end:plan.at+2*3600000},out=[];let partial=false;
 const tracks=new Map(),pause=yieldTask||(()=>Promise.resolve()),cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
 if(align.observerGuides)for(let i=0;i<=16;i++){
  if(!isCurrent())return {guides:[],partial:true,cancelled:true};if(i%4===0)await pause();if(!isCurrent())return {guides:[],partial:true,cancelled:true};const at=range.start+i*900000;
  for(const p of align.observerGuides(plan.target,plan.body,{at,groundM,eyeM})){if(!tracks.has(p.partId))tracks.set(p.partId,[]);tracks.get(p.partId).push(p);}
 }
 const localPoint=p=>Geo().distanceKm(domain.origin.latitude,domain.origin.longitude,p.latitude,p.longitude)*1000<=domain.radiusM+.01;

 for(const part of (plan.target?.parts||[]).slice(0,12)){
  if(!isCurrent())return {guides:[],partial:true,cancelled:true};if(!part.id||!Number.isFinite(part.m)||typeof part.name!=='string'||!part.name.trim())continue;
  const anchor=align.partTarget?.(plan.target,part.id)||plan.target,local={...plan,target:{...anchor,rim:null,parts:[part]},partId:part.id,matchMode:'limb',composition:null,limb:'center'};
  const track=tracks.get(part.id)||[],insideArea=p=>(domain.geometry.polygons||[]).some(r=>inside(r[0],p)&&!r.slice(1).some(h=>inside(h,p)));
  const direct=track.filter(p=>localPoint(p)&&insideArea(p)).sort((a,b)=>Math.abs(a.at-plan.at)-Math.abs(b.at-plan.at))[0];
  if(direct){
   const g=align.geometryFrom({...direct,elevation:groundM,eyeM},local.target,{partId:part.id,eyeM}),st=bodies.state(plan.body,direct.at,{...direct,elevation:groundM+eyeM});
   const residual=g&&align.viewProjector(g.azimuth,g.angle)(st.azimuth,st.apparentAltitude);
   if(residual?.every(Number.isFinite)&&Math.hypot(...residual)<.002){out.push({...direct,groundM,eyeM,label:part.name.replace(/（[^）]*）/g,''),approximate:true});continue;}
  }
  const hints=[];
  for(const line of domain.geometry.lines||[])for(let j=1;j<line.length;j++){
   const a=line[j-1],d=[line[j][0]-a[0],line[j][1]-a[1]];
   for(let k=1;k<track.length;k++){
    const p=track[k-1],q=track[k];if(q.at<=p.at||q.at-p.at>900001)continue;
    const b=[p.longitude,p.latitude],v=[q.longitude-b[0],q.latitude-b[1]],den=cross(d,v);if(Math.abs(den)<1e-20)continue;
    const w=[b[0]-a[0],b[1]-a[1]],u=cross(w,v)/den,t=cross(w,d)/den;if(u<0||u>1||t<0||t>1)continue;
    hints.push({line,latitude:a[1]+u*d[1],longitude:a[0]+u*d[0],at:p.at+t*(q.at-p.at)});
   }
  }
  hints.sort((a,b)=>Math.abs(a.at-plan.at)-Math.abs(b.at-plan.at));
  const starts=hints.filter((h,i)=>hints.findIndex(p=>p.line===h.line&&Math.abs(p.at-h.at)<60000)===i).slice(0,3);if(!starts.length)starts.push(null);
  let found=null;
  for(const hint of starts){
   const start=hint?{...seed,latitude:hint.latitude,longitude:hint.longitude,surfaceGeometry:{lines:[hint.line],polygons:[]}}:seed;
   const result=await surfaceInverse(local,start,range,hint?[hint.at]:[plan.at],{align,bodies,groundAt:()=>groundM,isCurrent,yieldTask:pause,budget:Math.floor(480/starts.length),maxSolutions:1,nearbyFirst:true,standingAt:localPoint});
   if(result.cancelled||!isCurrent())return {guides:[],partial:true,cancelled:true};
   found=result.solutions[0];if(found)break;
  }
  if(found)out.push({latitude:found.observer.latitude,longitude:found.observer.longitude,at:found.at,partId:part.id,label:part.name.replace(/（[^）]*）/g,''),groundM,eyeM,approximate:true});
  else partial=true;

 }
 return {guides:out,partial};
}
async function opportunities(plan,point,{align,bodies,terrain,groundAt,sidewalks,standingAt,isCurrent=()=>true,yieldTask=typeof AstroNotesLibrary==='object'&&AstroNotesLibrary.pause||(()=>new Promise(r=>setTimeout(r,0))),budget=12000,_surfaceSolved=false,ridgeContext=null}={}){
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
 const strict=!!(c||plan.strict||plan.profile==='summit-contact'||target.rim&&plan.matchMode!=='overlap'),project=align.viewProjector(g.azimuth,g.angle),anchor=g.anchor||{latitude:partTarget.latitude,longitude:partTarget.longitude,heightM:g.topM};
 const pointBody=!(bodies.definition?.(plan.body)?.limbs??['sun','moon'].includes(plan.body)),whole=!plan.partId||plan.partId==='__whole';
 const outline=pointBody||!strict&&whole?align.towerOutline?.(observer,target,{eyeM}):null;
 const selfPolygons=outline?.known&&!outline.schematic?(outline.hitPolygons||outline.polygons||[outline.hitPoints||outline.points]).filter(Boolean).map(r=>r.map(p=>project(p[0],p[1])).filter(Boolean)).filter(r=>r.length>=3):[];
 const polygons=!strict&&whole?selfPolygons:[];
 const ridgePrepared=!c&&target.rim?(ridgeContext?ridgeContext.prepare(target,align,observer):prepareRidge(target,align,observer)):null,ridge=!c&&target.rim?ridgeGeometry(observer,target,align,ridgePrepared):null;if(!c&&target.rim&&!ridge)return empty('ridge-data-unavailable',true);
 const targetBounds=polygons.length?outlineClusters(polygons,flat(polygons)):null;
 const passage=!strict&&!pointBody&&plan.matchMode==='overlap'&&(!whole||!!ridge);
 const geometryKind=ridge?'ridge':polygons.length?'silhouette':'anchor',samples=new Map();let calls=0,exhausted=false,unknown=false,cancelled=false;
 const limit=Math.max(1,Math.floor(Number.isFinite(budget)?budget:12000));
 async function evaluate(at){
  at=Math.max(range.start,Math.min(range.end,at));if(samples.has(at))return samples.get(at);
  if(!isCurrent()){cancelled=true;return null;}if(calls>=limit){exhausted=true;return null;}
  if(calls%96===0){await yieldTask();if(!isCurrent()){cancelled=true;return null;}}
  calls++;let st;try{st=directionAt(bodies,plan.body,at,eye);}catch{unknown=true;return null;}
  const policy=nearPolicy(plan,bodies,st);if(![st.azimuth,st.apparentAltitude,policy.radius,policy.tolerance].every(Number.isFinite)||policy.radius<0){unknown=true;return null;}
  const selectedRidge=ridge?.at(st.azimuth),activeGeometry=selectedRidge?.geometry||g,activeAnchor=selectedRidge?.anchor||anchor,activeProject=selectedRidge?align.viewProjector(activeGeometry.azimuth,activeGeometry.angle):project;
  const chosen=limbKind(c?.limb||(policy.disc?plan.limb:'center')),height=limb(st,chosen),xy=activeProject(st.azimuth,strict?height:st.apparentAltitude);
  if(!xy)return {at,score:Infinity,eligible:false,state:st};
  const near=polygons.length?closestPoint(xy,polygons):{point:[0,0],distance:Math.hypot(...xy)},angle=Math.atan(near.distance*rad)/rad;
  const gap=strict?Math.atan(Math.hypot(...xy)*rad)/rad:Math.max(0,angle-policy.radius),tolerance=c ? .002 : strict ? 1/60 : passage ? 0 : policy.tolerance;
  const overlaps=!strict&&angle<=policy.radius,dx=xy[0]-near.point[0],dy=xy[1]-near.point[1],below=!strict&&!overlaps&&dy<0&&Math.abs(dy)>Math.abs(dx);
  const center=pointBody&&project(st.azimuth,st.apparentAltitude),selfOccluded=!!(center&&selfPolygons.length&&closestPoint(center,selfPolygons).distance<=1e-8);
  // An elevated observer can see below their local horizontal plane. This is
  // only the ellipsoid horizon; terrain/buildings are the evaluator's job.
  const horizon=horizonAt(elevation+eyeM);
  const above=(st.upperAltitude??st.apparentAltitude+policy.radius)>=horizon;
  const row={at,score:passage?angle-policy.radius:gap-tolerance,centerDistance:angle,centerXY:xy,eligible:above&&!below&&!selfOccluded&&gap<=tolerance+1e-10,state:st,gap,tolerance,overlaps,below,above,selfOccluded,geometryKind,geometry:activeGeometry,anchor:activeAnchor};samples.set(at,row);return row;
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
 const ineligibleTimes=[];
 if(eligible.length>1){
  for(const sample of samples.values())if(!sample.eligible)ineligibleTimes.push(sample.at);
  ineligibleTimes.sort((a,b)=>a-b);
 }
 let nextIneligible=0;
 for(const row of eligible){
  let group=clusters.at(-1);
  const previous=group?.at(-1);
  if(previous)while(ineligibleTimes[nextIneligible]<=previous.at)nextIneligible++;
  if(!previous||row.at-previous.at>300000||ineligibleTimes[nextIneligible]<row.at){
   group=[];clusters.push(group);
  }
  group.push(row);
 }
 const solutions=[];
 for(const cluster of clusters){
  const best=cluster.reduce((a,b)=>b.gap<a.gap||passage&&b.gap===a.gap&&b.centerDistance<a.centerDistance?b:a),interval=[cluster[0].at,cluster.at(-1).at];let sunAltitude=null,side=null;
  // Return an event only after the full provider agrees at this exact time.
  // A late atmosphere/provider change must not turn an old trial into a hit.
  if(typeof bodies.direction==='function'){
   let full;try{full=bodies.state(plan.body,best.at,eye);}catch{unknown=true;continue;}
   const fields=['azimuth','geometricAltitude','apparentAltitude','angularRadius','upperAltitude','lowerAltitude','upperLimbAltitude','lowerLimbAltitude'];
   if(fields.some(key=>!Object.is(full?.[key],best.state[key]))){unknown=true;continue;}
   best.state=full;
  }
  try{sunAltitude=bodies.state('sun',best.at,eye).apparentAltitude;side=bodies.state(plan.body,best.at+1000,eye).apparentAltitude<best.state.apparentAltitude?'set':'rise';}catch{unknown=true;}
  const contactLimb=limbKind(c?.limb||plan.limb),event={at:range.kind==='instant'?range.start:best.at,intersects:strict||best.overlaps,nearTarget:!strict,
  relation:strict?(contactLimb!=='center'?'edge-contact':'anchor-hit'):best.overlaps?(geometryKind==='silhouette'?'silhouette-overlap':'anchor-hit'):'near',matchMode:strict?'limb':passage?'overlap':'near',partId:plan.partId||'tip',contactLimb,gapAngleDeg:best.gap,gapAngleRad:best.gap*rad,
  toleranceAngleDeg:best.tolerance,toleranceAngleRad:best.tolerance*rad,radius:best.state.angularRadius,altitude:best.state.apparentAltitude,azimuth:best.state.azimuth,
  targetAzimuth:g.azimuth,targetAltitude:g.angle,...(targetBounds?{targetPosition:{
    x:(best.centerXY[0]-targetBounds.minX)/(targetBounds.maxX-targetBounds.minX),y:(best.centerXY[1]-targetBounds.minY)/(targetBounds.maxY-targetBounds.minY)}}:{}),sunAltitude,side,targetGeometryKind:geometryKind,timeInterval:interval,timeIntervalSampled:true,visibility:'unknown',...(c?{
  composition:{...c},compositionResidualDeg:best.gap}:{})};
  solutions.push({observer:{...observer},event,geometry:{...best.geometry},anchor:{...best.anchor}});
 }
 let surfaceAttempted=false;
 if(strict&&!_surfaceSolved&&calls>=limit&&(point.surfaceGeometry?.polygons?.length||point.surfaceGeometry?.lines?.length||!point.surfaceGeometry&&sidewalks?.features?.length))exhausted=true;
 if(strict&&!_surfaceSolved&&!exhausted&&calls<limit){
  const starts=[];for(const s of [...samples.values()].sort((a,b)=>a.score-b.score))if(starts.every(t=>Math.abs(t-s.at)>1800000)){starts.push(s.at);if(starts.length>=6)break;}
  const inverse=await surfaceInverse({...plan,target},observer,range,starts,{align,bodies,terrain,groundAt,sidewalks,standingAt,isCurrent,yieldTask,ridgePrepared,budget:Math.min(2500,limit-calls)});
  calls+=inverse.calls;exhausted||=inverse.exhausted;unknown||=inverse.unknown;surfaceAttempted=inverse.attempted;
  if(inverse.cancelled)return empty('cancelled',true);
  for(const q of inverse.solutions){
   if(calls>=limit){exhausted=true;break;}
   const checked=await opportunities({...plan,timeSpec:{kind:'instant',at:range.kind==='instant'?range.start:q.at}},q.observer,{align,bodies,terrain,groundAt,isCurrent,yieldTask,budget:Math.max(1,limit-calls),_surfaceSolved:true,ridgeContext});calls+=checked.evaluated||0;
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
return {valid,windowValid,limb,anchorAt,geometry,roadAt,riseSet,inWindow,windowEvents,screenAnchor,make,timeRange,opportunities,localGuides,inverseSeeds,closestPoint,definiteAngularMiss,createRidgeContext,surfaceDomainKey};
});

/* Terrain/building MODEL LOS. Missing model range or standing height never becomes model-visible. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const Surface=globalThis.AstroNotesTrialSurface||(typeof require==='function'?require('./scene-surface.js'):null);
const Composition=globalThis.AstroNotesCandidateComposition||(typeof require==='function'?require('./composition.js'):null);
const R=6371008.8,rad=Math.PI/180,Geo=()=>globalThis.AstroNotesTerrain||(typeof require==='function'?require('../../../astronotes-terrain.js'):null);
const cache=new WeakMap(),earthA=6378137,earthE2=6.6943799901413165e-3;
function ecef(lat,lon,h){const a=lat*rad,b=lon*rad,n=earthA/Math.sqrt(1-earthE2*Math.sin(a)**2);return [(n+h)*Math.cos(a)*Math.cos(b),(n+h)*Math.cos(a)*Math.sin(b),(n*(1-earthE2)+h)*Math.sin(a)];}
const reference=ecef(35.68626,139.73068,0),local=(lat,lon,h)=>ecef(lat,lon,h).map((v,i)=>v-reference[i]);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),sub=(a,b)=>a.map((x,i)=>x-b[i]);
function inside(r,p){let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>p[1])!==(r[j][1]>p[1])&&p[0]<(r[j][0]-r[i][0])*(p[1]-r[i][1])/(r[j][1]-r[i][1])+r[i][0])yes=!yes;return yes;}
function faceHit(rings,origin,direction,maxM,quadratic=[0,0,0]){
 if(!rings.length||rings[0].length<3)return null;const ring=rings[0],normal=[0,0,0];
 for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];normal[0]+=(a[1]-b[1])*(a[2]+b[2]);normal[1]+=(a[2]-b[2])*(a[0]+b[0]);normal[2]+=(a[0]-b[0])*(a[1]+b[1]);}
 const A=dot(normal,quadratic),B=dot(normal,direction),C=dot(normal,sub(origin,ring[0]));let roots=[];
 if(Math.abs(A)*maxM<1e-10*Math.max(1,Math.abs(B))){if(Math.abs(B)>1e-9)roots=[-C/B];}
 else {const discriminant=B*B-4*A*C;if(discriminant>=0){const q=-.5*(B+(B<0?-1:1)*Math.sqrt(discriminant));roots=q?[q/A,C/q]:[-B/(2*A)];}}
 const axis=normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs))),project=q=>q.filter((_,i)=>i!==axis);
 for(const t of roots.sort((a,b)=>a-b)){if(t<=.05||t>maxM)continue;const p=origin.map((x,i)=>x+t*direction[i]+t*t*quadratic[i]),pp=project(p);if(inside(rings[0].map(project),pp)&&!rings.slice(1).some(r=>inside(r.map(project),pp)))return {distanceM:t,point:p};}return null;
}
function boxIntersects(box,origin,direction,maxM,padding){let lo=0,hi=maxM;for(let i=0;i<3;i++){const a=box[i]-padding,b=box[i+3]+padding;if(Math.abs(direction[i])<1e-12){if(origin[i]<a||origin[i]>b)return false;continue;
}const t=[(a-origin[i])/direction[i],(b-origin[i])/direction[i]].sort((a,b)=>a-b);lo=Math.max(lo,t[0]);hi=Math.min(hi,t[1]);if(hi<lo)return false;}return true;}
function buildingBox(b){const z=b.solidZRangeM||[b.zMin,b.zMax];if(!b.bbox||!z.every(Number.isFinite))return null;const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
for(const lon of [b.bbox[0],b.bbox[2]])for(const lat of [b.bbox[1],b.bbox[3]])for(const h of z){const p=local(lat,lon,h);for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],p[i]);hi[i]=Math.max(hi[i],p[i]);}}return [...lo,...hi];}

function trace(index,observer,{azimuth,altitude,maxM=12000,endpoint=null,targetKey=null,refractionK=1,onlyTarget=false}){
 if(!Number.isFinite(observer.elevation)||!Number.isFinite(azimuth)||!Number.isFinite(altitude)||Math.abs(altitude)>=89||!Number.isFinite(maxM)||maxM<=0)return {status:'unknown',recommend:false,reason:'invalid-height-or-ray'};
 const eye=observer.elevation+(observer.eyeM??1.5),lat=observer.latitude,lon=observer.longitude,az=azimuth*rad,alt=altitude*rad;
 const end=endpoint||Geo().destination(lat,lon,azimuth,maxM/1000),origin=local(lat,lon,eye),a=lat*rad,b=lon*rad;
 const east=[-Math.sin(b),Math.cos(b),0],north=[-Math.sin(a)*Math.cos(b),-Math.sin(a)*Math.sin(b),Math.cos(a)],up=[Math.cos(a)*Math.cos(b),Math.cos(a)*Math.sin(b),Math.sin(a)];
 const direction=endpoint?local(endpoint.latitude,endpoint.longitude,endpoint.elevation).map((v,i)=>(v-origin[i])/maxM):east.map((v,i)=>v*Math.sin(az)+north[i]*Math.cos(az)+up[i]*Math.tan(alt));
 const curvature=(1-1/refractionK)/(2*R),quadratic=up.map(v=>-v*curvature),chord=direction.slice();if(endpoint)for(let i=0;i<3;i++)direction[i]+=up[i]*curvature*maxM;
 const ids=new Set(),loX=Math.floor(Math.min(lon,end.longitude)*1000)-1,hiX=Math.floor(Math.max(lon,end.longitude)*1000)+1,loY=Math.floor(Math.min(lat,end.latitude)*1000)-1,hiY=Math.floor(Math.max(lat,end.latitude)*1000)+1;
 for(const [key,entries]of Object.entries(index.grid||{})){const [x,y]=key.split(',').map(Number);if(x>=loX&&x<=hiX&&y>=loY&&y<=hiY)for(const id of entries)ids.add(id);}
 let compiled=cache.get(index);if(!compiled){compiled=new Map();compiled.boxes=new Map();cache.set(index,compiled);}
 const association=index.targetAssociations?.[targetKey],targetIds=new Set(association?.sourceSha256&&(association.sourceSha256===index.sourceSha256||index.sourceSha256s?.includes(association.sourceSha256))?association.buildingIds||[]:[]),contacts=new Map();
 let hit=null,faces=0;for(const id of ids){const building=index.buildings[id];if(onlyTarget&&!targetIds.has(building.id))continue;let box=compiled.boxes.get(id);if(box===undefined){box=buildingBox(building);compiled.boxes.set(id,box);
 }if(box&&!boxIntersects(box,origin,chord,maxM,1+Math.abs(curvature)*maxM*maxM))continue;let polys=compiled.get(id);if(!polys){polys=building.polygons.map(poly=>({id:poly.id,rings:poly.rings.map(r=>r.map(p=>local(p[1],p[0],p[2])))}));compiled.set(id,polys);}for(const poly of polys){faces++;
 const own=targetIds.has(building.id)&&(!building.sourceSha256||building.sourceSha256===association.sourceSha256),h=faceHit(poly.rings,origin,direction,own?maxM:hit?.distanceM??maxM,quadratic);
 if(h){const row={...h,pointFrame:'WGS84 ECEF offset from lon139.73068 lat35.68626 h0; geoid uncorrected diagnostic',buildingId:building.id,polygonId:poly.id,lod:building.lod,
 observerWithinHitBuildingBBox:building.bbox?lon>=building.bbox[0]&&lon<=building.bbox[2]&&lat>=building.bbox[1]&&lat<=building.bbox[3]:null};if(own){contacts.set(building.id+':'+poly.id,row);}else hit=row;}}}
 return {refractionK,status:hit?'model-blocked':contacts.size?'target-contact':'unknown',recommend:false,hit,targetContacts:[...contacts.values()],faces,buildingsChecked:ids.size,
 reason:hit?'conditional-model-intersection':contacts.size?'target-complex-contact-needs-component-check':'incomplete-coverage-or-uncertainty'};
}
function targetGeometry(index,observer,targetKey){
 const association=index.targetAssociations?.[targetKey],sha=association?.sourceSha256;if(!sha||!(sha===index.sourceSha256||index.sourceSha256s?.includes(sha)))return {complete:false,reason:'missing-target-geometry-source'};
 const ids=new Set(association.buildingIds||[]),rows=index.buildings.filter(b=>ids.has(b.id));
 if(!ids.size||rows.length!==ids.size||rows.some(b=>(b.sourceSha256||index.sourceSha256)!==sha||!b.bbox?.every(Number.isFinite)||!(b.faceCount>0||b.polygons?.length>0)))return {complete:false,reason:'incomplete-target-geometry'};
 let maxM=0;for(const b of rows)for(const lon of [b.bbox[0],b.bbox[2]])for(const lat of [b.bbox[1],b.bbox[3]])maxM=Math.max(maxM,Geo().inverse(observer.latitude,observer.longitude,lat,lon).km*1000+5);
 return {complete:maxM>0,maxM,reason:'entire-identified-target-building-depth'};
}
function covers(index,observer,end){
 const meshes=index.coverageMeshes?.filter(m=>m.provided);if(!meshes?.length)return {complete:false,reason:'no-building-model-range'};
 const within=(p,b)=>p[0]>=b[0]-1e-10&&p[0]<=b[2]+1e-10&&p[1]>=b[1]-1e-10&&p[1]<=b[3]+1e-10;
 const selection=index.geometrySelection,extra=selection?.includedFullSourceMeshes||selection?.unclippedCoverageMeshes||[],boxes=meshes.map(m=>m.bbox),rect=b=>[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]],boundaries=[...boxes.map(rect),...(selection?[selection.envelopeLonLat]:[])];
 const inSelection=p=>{if(!selection||meshes.some(m=>extra.includes(m.code)&&within(p,m.bbox)))return true;const ring=selection.envelopeLonLat;if(!inside(ring,p))return false;const k=Math.cos(p[1]*rad),scale=111195;for(let i=0;i<ring.length;
 i++){const a=ring[i],b=ring[(i+1)%ring.length],x=(b[0]-a[0])*k,y=b[1]-a[1],u=Math.max(0,Math.min(1,((p[0]-a[0])*k*x+(p[1]-a[1])*y)/(x*x+y*y||1)));if(Math.hypot((p[0]-a[0]-u*(b[0]-a[0]))*k,p[1]-a[1]-u*y)*scale<5)return false;}return true;};
 const inv=Geo().inverse(observer.latitude,observer.longitude,end.latitude,end.longitude),n=Math.max(1,Math.ceil(inv.km*1000/50));let checked=0,previous=[observer.longitude,observer.latitude];
 for(let j=1;j<=n;j++){const geo=j===n?end:Geo().destination(observer.latitude,observer.longitude,inv.azimuth,inv.km*j/n),next=[geo.longitude,geo.latitude],delta=sub(next,previous),marks=[0,1];
  for(const ring of boundaries)for(let i=0;i<ring.length;i++){const a=ring[i],edge=sub(ring[(i+1)%ring.length],a),den=delta[0]*edge[1]-delta[1]*edge[0];if(Math.abs(den)<1e-20)continue;const q=sub(a,previous),t=(q[0]*edge[1]-q[1]*edge[0])/den,u=(q[0]*delta[1]-q[1]*delta[0])/den;
  if(t>0&&t<1&&u>=0&&u<=1)marks.push(t);}
  marks.sort((a,b)=>a-b);for(let k=1;k<marks.length;k++){const t=(marks[k-1]+marks[k])/2,p=previous.map((x,i)=>x+t*delta[i]);if(!inSelection(p))return {complete:false,reason:'outside-selected-building-range',checked};
  if(!boxes.some(b=>within(p,b)))return {complete:false,reason:'missing-building-source-mesh',checked};checked++;}previous=next;
 }
 return {complete:true,checked,kind:'provided-PLATEAU-model-range'};
}

function classifyRay(index,observer,ray,building,terrain){
 const end=ray.endpoint||Geo().destination(observer.latitude,observer.longitude,ray.azimuth,ray.maxM/1000),coverage=covers(index,observer,end);
 if(building.hit||terrain?.hit)return {status:'model-blocked',coverage,reason:building.hit?'building-model-intersection':'terrain-model-intersection'};
 if(!coverage.complete||!Number.isFinite(building.faces)||!terrain||!(terrain.checked>0)||terrain.missing!==0)return {status:'model-unknown',coverage,reason:!coverage.complete?coverage.reason:'missing-terrain-model'};
 const unresolved=building.targetContacts?.some(c=>!index.targetAssociations?.[ray.targetKey]?.targetSurfacePolygonIds?.includes(c.polygonId));
 if(unresolved)return {status:'model-unknown',coverage,reason:'unresolved-target-complex-component'};
 return {status:'model-visible',coverage,reason:'no-intersection-in-modelled-segment'};
}

function sceneExposure(align,observer,target,state){
 const outline=align.towerOutline?.(observer,target,{eyeM:observer.eyeM??1.5});if(!outline?.known||outline.schematic)return {known:false,visible:false};
 const project=align.viewProjector(state.azimuth,state.apparentAltitude),polygons=(outline.polygons||outline.hitPolygons||[outline.hitPoints||outline.points]).filter(Boolean).map(r=>r.map(p=>project(p[0],p[1])).filter(Boolean)).filter(r=>r.length>=3);
 if(!polygons.length)return {known:false,visible:false};
 const radius=Math.tan(state.angularRadius*rad)/rad,upper=project(state.azimuth,state.upperAltitude??state.apparentAltitude+state.angularRadius)?.[1],lower=project(state.azimuth,state.lowerAltitude??state.apparentAltitude-state.angularRadius)?.[1];
 if(![radius,upper,lower].every(Number.isFinite))return {known:false,visible:false};
 const samples=[[0,0],[0,.9],[0,-.9],[-.9,0],[.9,0],[-.6363961,-.6363961],[.6363961,-.6363961],[-.6363961,.6363961],[.6363961,.6363961]],visible=samples.some(([x,y])=>!polygons.some(r=>inside(r,[x*radius,y*(y>=0?upper:-lower)])));
 return {known:true,visible,samples:samples.length,modelId:outline.modelId||'existing-scene-outline',approximate:!!outline.approximate};
}
function create({align,shooting,bodies,index,surfaceAt,terrain=null,prefilter=true,mode='diagnostic',sidewalks=null,yieldTask=()=>new Promise(r=>setTimeout(r,0))}){
 const paths=new Map(),composer=sidewalks&&terrain?Composition.make({align,bodies,terrain,sidewalks,yieldTask}):null;
 async function evaluateBase(plan,point,prepared=null){
  await yieldTask();const surface=surfaceAt(point)||{},dem=terrain?.at(point),estimate=mode==='model-los'?dem:surface.estimateM;if(!Number.isFinite(estimate))return {status:'unknown',recommend:false,reason:'no-standing-height-estimate'};
  const obs={...point,elevation:estimate,eyeM:1.5};
  if(mode==='model-los'&&sidewalks&&!Composition.roadAt(sidewalks,obs))return {status:'model-unknown',recommend:false,reason:'walkway-interior-or-standing-surface-unresolved'};
  if(mode==='model-los'&&point.sourceId&&(!point.structureClassificationKnown||point.nonTerrainStructure))return {status:'model-unknown',recommend:false,reason:'bridge-or-standing-height-unresolved'};
  if(mode==='model-los'&&surface.water===true)return {status:'model-unknown',recommend:false,reason:'water-or-bridge-height-unresolved'};
  const ownTarget=mode==='model-los'?targetGeometry(index,obs,plan.target.id):null;if(mode==='model-los'&&!ownTarget.complete)return {status:'model-unknown',recommend:false,reason:ownTarget.reason};
  const start=Math.floor((plan.at+32400000)/86400000)*86400000-32400000;
  // Conservative pilot optimisation only: rejected positions remain UNKNOWN.
  // This is not a proof that no astronomical opportunity exists.
  const geometry=prepared?.geometry||align.geometryFrom(obs,plan.target,{partId:plan.partId,eyeM:obs.eyeM});
  if(!prepared&&prefilter&&geometry&&['moon','sun'].includes(plan.body)){
   const key=plan.body+','+start+','+(plan.atmosphere||'standard');let path=paths.get(key);
   if(!path){path=[];const ref={latitude:35.68626,longitude:139.73068,elevation:30};for(let t=start;t<=start+86400000;t+=60000){const st=bodies.state(plan.body,t,ref);path.push([st.azimuth,st.apparentAltitude]);}paths.set(key,path);while(paths.size>4)paths.delete(paths.keys().next().value);}
   if(!path.some(([az,alt])=>Math.abs(((az-geometry.azimuth+540)%360)-180)<3&&alt>-3&&alt<geometry.angle+3))return {status:'unknown',recommend:false,deferred:true,assumedObserver:obs,surface,reason:'pilot-prefilter-deferred-not-certified-no-event'};
  }
  let events=(prepared?[prepared.event]:shooting.eventsFor(plan,obs,start,{align,isMountain:()=>false})).filter(e=>(prepared||shooting.matches(e,plan,()=>false))&&e.at>=start&&e.at<start+86400000&&(mode==='model-los'||plan.body!=='moon'||e.sunAltitude<0));
  if(!prepared&&plan.timeWindow?.kind&&plan.timeWindow.kind!=='none'){const times=Composition.windowEvents(plan,obs,bodies);events=events.filter(e=>Composition.inWindow(e.at,plan.timeWindow,times));}
  const distance=geometry?.distanceKm*1000,refractionK=mode==='model-los'?(globalThis.AstroNotesAtmosphere?.targetK?.()??7/6):1;
  const needsTargetProbe=!!prepared||mode!=='model-los'||(plan.partId&&plan.partId!=='__whole');
  const targetRay=needsTargetProbe&&geometry&&events.length?trace(index,obs,{azimuth:geometry.azimuth,altitude:Math.atan2(geometry.topM-obs.elevation-obs.eyeM-distance*distance/(2*R*refractionK),distance)/rad,maxM:distance,refractionK,targetKey:plan.target.id,endpoint:{
  ...(prepared?.anchor||plan.target),elevation:geometry.topM}}):null;
  const targetTerrain=needsTargetProbe&&geometry&&events.length&&terrain?terrain.trace(obs,{azimuth:geometry.azimuth,altitude:Math.atan2(geometry.topM-obs.elevation-obs.eyeM-distance*distance/(2*R*refractionK),distance)/rad,maxM:distance,refractionK,targetKey:plan.target.id,endpoint:{
  ...(prepared?.anchor||plan.target),elevation:geometry.topM}}):null;
  const tested=[];for(const event of events){const st=bodies.state(plan.body,event.at,{...obs,elevation:obs.elevation+obs.eyeM});const rays=[];for(const offset of [0,-1,1]){const ray={targetKey:plan.target.id,azimuth:st.azimuth,altitude:(mode==='model-los'?(offset===1?(st.upperAltitude??st.apparentAltitude+st.angularRadius):offset===-1?(st.lowerAltitude??st.apparentAltitude-st.angularRadius):st.apparentAltitude):(st.geometricAltitude??st.altitude??st.apparentAltitude)+offset*st.angularRadius),maxM:mode==='model-los'?distance:12000,refractionK};const building=trace(index,obs,ray),ground=terrain?.trace(obs,ray)??null;if(mode==='model-los'){const self=trace(index,obs,{...ray,maxM:ownTarget.maxM,onlyTarget:true});building.targetContacts=self.targetContacts;building.targetDepthM=ownTarget.maxM;}const result={...building,terrain:ground,model:mode==='model-los'?classifyRay(index,obs,ray,building,ground):null};rays.push(result);if(mode==='model-los'&&result.model.status==='model-blocked')break;}const targetVisibilityProbes=[];let targetOccluded=false;
   if(mode==='model-los'&&rays.length===3&&rays.every(r=>r.model.status==='model-visible')&&rays[0].targetContacts?.length){
    for(const [x,y] of [[0,-.9],[0,.9],[-.9,0],[.9,0],[-.6363961,-.6363961],[.6363961,-.6363961],[-.6363961,.6363961],[.6363961,.6363961]]){
     const rx=Math.tan(st.angularRadius*rad)/rad,ry=Math.tan((y>=0?(st.upperAltitude??st.apparentAltitude+st.angularRadius)-st.apparentAltitude:st.apparentAltitude-(st.lowerAltitude??st.apparentAltitude-st.angularRadius))*rad)/rad,angle=align.viewUnprojector(st.azimuth,st.apparentAltitude)(x*rx,
     y*ry),probe={targetKey:plan.target.id,azimuth:angle[0],altitude:angle[1],maxM:distance,refractionK},building=trace(index,obs,probe),ground=terrain.trace(obs,probe);const self=trace(index,obs,{...probe,maxM:ownTarget.maxM,onlyTarget:true});building.targetContacts=self.targetContacts;
     building.targetDepthM=ownTarget.maxM;targetVisibilityProbes.push({...building,terrain:ground,model:classifyRay(index,obs,probe,building,ground)});
    }
    targetOccluded=targetVisibilityProbes.every(r=>r.targetContacts?.length);
   }
   const selectedSurface=prepared?.event.composition?.basis==='scene-surface'?Surface.visible({obs,target:plan.target,align,composition:prepared.event.composition}):null;
   const shown=mode==='model-los'&&!targetOccluded&&rays.every(r=>r.model?.status==='model-visible')&&targetVisibilityProbes.every(r=>r.model.status==='model-visible')?sceneExposure(align,obs,plan.target,st):null;
   tested.push({event,rays,targetVisibilityProbes,targetOccluded,selectedSurface,sceneExposure:shown});}
  if(mode==='model-los'){
   const selectedPartRequired=!!prepared||plan.partId&&plan.partId!=='__whole';
   const selectedPartModel=selectedPartRequired&&targetRay&&targetTerrain?classifyRay(index,obs,{targetKey:plan.target.id,azimuth:geometry.azimuth,maxM:distance,endpoint:{...(prepared?.anchor||plan.target),elevation:geometry.topM}},targetRay,targetTerrain):null;
   const event=(!selectedPartRequired||selectedPartModel?.status==='model-visible')?tested.find(e=>(!e.selectedSurface||e.selectedSurface.visible)&&e.sceneExposure?.visible&&!e.targetOccluded&&e.rays.every(r=>r.model.status==='model-visible')&&
   e.targetVisibilityProbes.every(r=>r.model.status==='model-visible'))?.event:null;
   const evidence={kind:'terrain-and-building-model-los',scope:'observer-to-target',treesModeled:false,actualVisibilityGuaranteed:false,observerHeightBasis:'GSI DEM + 1.5m',buildingRangeComplete:!!event,terrainNumericComplete:!!event,targetSelfGeometryComplete:ownTarget.complete,sceneModelExposureChecked:!!event,selectedSurfaceChecked:!!event&&!!prepared?.event.composition?.basis,celestialInteriorSampleVisible:!!event,targetSelfCheckedToM:ownTarget.maxM,refractionK,bodySamples:'centre/upper/lower; target-occlusion interior probes when needed'};
   if(event)return {status:'model-visible',recommend:true,aligned:true,event,place:{id:'model-'+point.latitude.toFixed(7)+','+point.longitude.toFixed(7),name:'モデル候補 '+point.latitude.toFixed(5)+', '+point.longitude.toFixed(5),latitude:point.latitude,longitude:point.longitude,elevation:estimate,
   eyeHeightAGL:1.5},modelEvidence:evidence,events:tested,targetRay,targetTerrain,assumedObserver:obs,surface};
   return {status:!events.length?'no-overlap':tested.some(e=>e.targetOccluded||e.rays.some(r=>r.model.status==='model-blocked')||e.targetVisibilityProbes.some(r=>r.model.status==='model-blocked'))?'model-blocked':'model-unknown',recommend:false,aligned:events.length>0,events:tested,targetRay,
   targetTerrain,modelEvidence:evidence,assumedObserver:obs,surface,
   reason:!events.length?'no-overlap-event':tested.some(e=>e.selectedSurface&&!e.selectedSurface.visible)?'selected-drawing-surface-occluded-or-unknown':tested.some(e=>e.sceneExposure?.known&&!e.sceneExposure.visible)?'display-model-disagreement':'model-obstructed-or-range-unresolved'};
  }
  return {status:'unknown',recommend:false,aligned:events.length>0,events:tested,targetRay,targetTerrain,targetProbe:{kind:!plan.partId||plan.partId==='__whole'?'whole-object-tip-probe':'selected-height-probe',heightM:geometry?.topM??null,diagnosticOnly:true},assumedObserver:obs,
  surface,reason:'estimated-surface-and-incomplete-3d-coverage'};
 }
 return async function evaluate(plan,point){
  if(!plan.composition)return evaluateBase(plan,point);
  if(!composer)return {status:'model-unknown',recommend:false,reason:'composition-data-unavailable'};
  const solved=await composer.solve(plan,point),all=[];for(const solution of solved.solutions)all.push(await evaluateBase(plan,solution.observer,solution));
  const visible=all.filter(r=>r.recommend);if(visible.length)return {...visible[0],additionalCandidates:visible.slice(1)};
  return all.find(r=>r.status==='model-blocked')||all[0]||{status:'unknown',deferred:true,recommend:false,reason:solved.reason};
 };
}
return {faceHit,trace,targetGeometry,covers,classifyRay,sceneExposure,create};
});

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

/* Trial-only discovery. Existing registered-place search is not modified. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateDiscovery=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const day=at=>Math.floor((at+32400000)/86400000)*86400000-32400000;
const point=(latitude,longitude)=>({latitude,longitude});
function inside(ring,lat,lon){let on=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
 const a=ring[i],b=ring[j];if((a[1]>lat)!==(b[1]>lat)&&lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0])on=!on;
}return on;}
// Generate positions inside sidewalk geometry, not a list of named viewpoints.
// Heights of 0 in a 2D road model are deliberately not used as ground heights.
function sampleSidewalks(data,limit=600){
 const rows=[],seen=new Set(),scanLimit=data.samplingStrategy==='even'?12000:limit;let limited=false;
 for(const feature of data.features||[]){
  if(!['2000','2010','2020'].includes(feature.function))continue;
  const ring=feature.coordinatesLonLatHeight;if(!Array.isArray(ring)||ring.length<4)continue;
  const valid=ring.every(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90);if(!valid)continue;
  const lo=Math.min(...ring.map(p=>p[0])),hi=Math.max(...ring.map(p=>p[0])),a=Math.min(...ring.map(p=>p[1])),b=Math.max(...ring.map(p=>p[1]));
  const dy=12.5/111195,dx=dy/Math.max(.1,Math.cos((a+b)*Math.PI/360));
  // Narrow sidewalks can miss the grid. Sample inside each edge, never on its boundary.
  const holes=feature.interiorRingsLonLatHeight||[],k=Math.cos((a+b)*Math.PI/360),near=r=>p=>r.some((u,i)=>{const v=r[(i+1)%r.length],x=(v[0]-u[0])*k,y=v[1]-u[1],t=Math.max(0,Math.min(1,((p.longitude-u[0])*k*x+(p.latitude-u[1])*y)/(x*x+y*y||1)));
  return Math.hypot((p.longitude-u[0])*k-t*x,p.latitude-u[1]-t*y)*111195<.1;}),eligible=p=>inside(ring,p.latitude,p.longitude)&&!holes.some(h=>inside(h,p.latitude,p.longitude))&&!near(ring)(p)&&!holes.some(h=>near(h)(p));
  const candidates=[];
  for(let lat=a+dy/2;lat<b;lat+=dy)for(let lon=lo+dx/2;lon<hi;lon+=dx)if(inside(ring,lat,lon)&&!(feature.interiorRingsLonLatHeight||[]).some(hole=>inside(hole,lat,lon)))candidates.push(point(lat,lon));
  for(let i=1;i<ring.length;i++){const u=ring[i-1],v=ring[i],x=(v[0]-u[0])*k,y=v[1]-u[1],length=Math.hypot(x,y);if(!length)continue;let found=false;
  for(const offset of [.5,.25,.125]){for(const sign of [1,-1]){const p=point((u[1]+v[1])/2+sign*x/length*offset/111195,(u[0]+v[0])/2-sign*y/length*offset/(111195*k));if(eligible(p)){candidates.push(p);found=true;break;}}if(found)break;}}
  for(const p of candidates){
   if(!eligible(p))continue;const key=p.latitude.toFixed(7)+','+p.longitude.toFixed(7);if(seen.has(key))continue;seen.add(key);
   if(rows.length>=scanLimit){limited=true;break;}
   rows.push({...p,sourceId:feature.sourceId,polygonId:feature.polygonId,
    groundKnown:feature.groundKnown===true,standingSurfaceKnown:feature.standingSurfaceKnown===true,
    accessKnown:feature.accessKnown===true,groundM:feature.groundM??null,region:feature.region,sourceMesh:feature.sourceMesh,nonTerrainStructure:feature.nonTerrainStructure===true,structureClassificationKnown:feature.structureClassificationKnown===true});
  }
  if(limited)break;
 }
 if(rows.length>limit){const selected=Array.from({length:limit},(_,i)=>rows[Math.floor(i*(rows.length-1)/Math.max(1,limit-1))]);return {rows:selected,limited:true};}
 return {rows,limited};
}
function keyFor(plan,version,atmosphere){return JSON.stringify([version,plan.owner,plan.body,plan.target,plan.partId,plan.limb,plan.matchMode,day(plan.at),atmosphere,plan.composition||null,plan.timeWindow||null,!!plan.compositionInvalid]);}
// OS location handlers; app identity is never embedded in Android/iOS default schemes.
function mapLink(p,ua='',touchPoints=0){
 if(!p||!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude)||Math.abs(p.latitude)>90||Math.abs(p.longitude)>180)return null;
 const coord=p.latitude.toFixed(7)+','+p.longitude.toFixed(7);
 if(/Android/i.test(ua))return {href:'geo:'+coord+'?q='+coord,native:true};
 const ios=ua.match(/(?:iPhone|iPad|iPod).*?OS (\d+)[_.](\d+)/i);
 const safari=ua.match(/Version\/(\d+)\.(\d+)/),modern=v=>v&&(Number(v[1])>26||Number(v[1])===26&&Number(v[2])>=2),appleMobile=/iPhone|iPad|iPod/.test(ua)||/Macintosh/.test(ua)&&touchPoints>1;
 if(appleMobile&&(modern(ios)||modern(safari)))return {href:'geo-navigation:///place?coordinate='+coord,native:true};
 if(/iPhone|iPad|iPod|Macintosh/i.test(ua))return {href:'https://maps.apple.com/?ll='+coord+'&q='+coord,native:false};
 return {href:'geo:'+coord+'?q='+coord,native:true,choose:true};
}
function create({loadData,evaluate,clock=()=>performance.now(),yieldTask=()=>new Promise(r=>setTimeout(r,0)),diagnoseUnknown=false}){
 const cache=new Map(),jobs=new Map();
 async function search(plan,{onProgress=()=>{},isCurrent=()=>true,atmosphere='standard'}={}){
  if(plan.compositionInvalid)throw Error('invalid-composition');
  const data=await loadData();if(!isCurrent())return {cancelled:true};
  const key=keyFor(plan,data.version,atmosphere);if(cache.has(key))return {...cache.get(key),cached:true};
  if(jobs.has(key)){const result=await jobs.get(key);return !isCurrent()?{cancelled:true}:result.cancelled?search(plan,{onProgress,isCurrent,atmosphere}):{...result,cached:true};}
  const work=(async()=>{
   const start=clock(),generated=sampleSidewalks(data),counts={sampled:generated.rows.length,checked:0,aligned:0,blocked:0,unknown:0,noOverlap:0,deferred:0};const rows=[],seenRows=new Set();
   for(const p of generated.rows){
    if(!isCurrent())return {cancelled:true};
    if(counts.checked%20===0)await yieldTask();if(!isCurrent())return {cancelled:true};
    counts.checked++;
    if((!p.groundKnown||!p.standingSurfaceKnown)&&!diagnoseUnknown){counts.unknown++;}
    else {
     const result=await evaluate(plan,p,data);if(!isCurrent())return {cancelled:true};
     if(result?.aligned)counts.aligned++;
     if(result?.targetRay?.hit||result?.events?.some(e=>e.rays.some(r=>r.hit)))counts.modelBlocked=(counts.modelBlocked||0)+1;
     if(result?.deferred)counts.deferred++;
     else if(result?.status==='no-overlap')counts.noOverlap++;
     else if(result?.status==='blocked'||result?.status==='model-blocked')counts.blocked++;
     else if(result?.recommend===true&&((result.status==='verified'&&p.groundKnown&&p.standingSurfaceKnown&&data.visibilityCertified===true)||(result.status==='model-visible'&&result.modelEvidence?.kind==='terrain-and-building-model-los'&&result.modelEvidence.scope==='observer-to-target'&&
     result.modelEvidence.buildingRangeComplete&&result.modelEvidence.terrainNumericComplete&&result.modelEvidence.targetSelfGeometryComplete&&result.modelEvidence.sceneModelExposureChecked&&result.modelEvidence.celestialInteriorSampleVisible&&
     result.modelEvidence.actualVisibilityGuaranteed===false))&&result.event&&Number.isFinite(result.event.at)&&day(result.event.at)===day(plan.at)){for(const row of [result,...(result.additionalCandidates||[])]){if(row?.recommend!==true||!['model-visible',
     'verified'].includes(row.status)||!row.place||!Number.isFinite(row.place.latitude)||!Number.isFinite(row.place.longitude)||!row.event||day(row.event.at)!==day(plan.at))continue;
     if(row.status==='model-visible'&&!(row.modelEvidence?.kind==='terrain-and-building-model-los'&&row.modelEvidence.scope==='observer-to-target'&&row.modelEvidence.buildingRangeComplete&&row.modelEvidence.terrainNumericComplete&&row.modelEvidence.targetSelfGeometryComplete&&
     row.modelEvidence.sceneModelExposureChecked&&row.modelEvidence.celestialInteriorSampleVisible&&row.modelEvidence.actualVisibilityGuaranteed===false))continue;
     const k=[row.place.latitude.toFixed(6),row.place.longitude.toFixed(6),Math.round(row.event.at/1000)].join(',');if(!seenRows.has(k)){seenRows.add(k);rows.push(row);}}}
     else counts.unknown++;
    }
    if(counts.checked%25===0)onProgress({...counts});
   }
   const result={rows,counts,limited:generated.limited,elapsedMs:clock()-start,cached:false,dataVersion:data.version};
   cache.set(key,result);while(cache.size>8)cache.delete(cache.keys().next().value);return result;
  })();
  jobs.set(key,work);try{return await work;}finally{if(jobs.get(key)===work)jobs.delete(key);}
 }
 return {search,clear:()=>cache.clear()};
}
return {create,sampleSidewalks,keyFor,day,mapLink};
});

/* Trial: acquire actual walking surfaces around inverse-search regions.
 * OSM geometry describes a mapped surface, never certifies visibility or current access.
 * No target catalog or geographic search radius is imposed here. Resource budgets
 * produce partial coverage and a resumable tile queue, not an empty-result claim.
 */
(function(root,factory){
 const D=root.AstroNotesCandidateDiscovery||(typeof require==='function'?require('./search.js'):null);
 if(!D)throw Error('candidate search.js must be loaded first');
 D.createPlaceProvider=factory();
 if(typeof module==='object'&&module.exports)module.exports=D.createPlaceProvider;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const RAD=Math.PI/180,M=111195,TILE=.005;
const credits=[{name:'© OpenStreetMap contributors',url:'https://www.openstreetmap.org/copyright',license:'ODbL'},{name:'国土地理院 標高・地理院地図',url:'https://maps.gsi.go.jp/development/ichiran.html'}];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const key=p=>p.longitude.toFixed(7)+','+p.latitude.toFixed(7);
const bboxPoint=(p,b)=>p.longitude>=b[0]&&p.longitude<=b[2]&&p.latitude>=b[1]&&p.latitude<=b[3];
const forbidden=t=>['private','no'].includes(t?.access)||['private','no'].includes(t?.foot);
const nonGround=(t,ignoreLayer=false)=>!!t&&(t.location==='roof'||t.location==='rooftop'||t.location==='underground'||t.indoor==='yes'||t.bridge&&t.bridge!=='no'||t.tunnel&&t.tunnel!=='no'||t.covered==='yes'
 ||t.level!=null&&String(t.level)!=='0'||!ignoreLayer&&finite(Number(t.layer))&&Number(t.layer)!==0);
// A park boundary's layer orders overlaps; a negative layer is not an underground floor.
// Keep the path's own structure tags, and explicit raised/indoor tags on the parent.
// Check highway tags too: movement constraints temporarily set walking=false.
const nonGroundArea=f=>nonGround(f.tags,f.kind==='park'&&!f.walking&&!f.building&&!f.tags?.highway&&!f.tags?.['area:highway']&&f.polygons?.length>0);
function hash(s){let x=2166136261;for(let i=0;i<s.length;i++){x^=s.charCodeAt(i);x=Math.imul(x,16777619);}return (x>>>0).toString(16);}
function distance(a,b){return Math.hypot((a[0]-b[0])*Math.cos((a[1]+b[1])*RAD/2),a[1]-b[1])*M;}
function inside(r,p){let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>p.latitude)!==(r[j][1]>p.latitude)&&p.longitude<(r[j][0]-r[i][0])*(p.latitude-r[i][1])/(r[j][1]-r[i][1])+r[i][0])yes=!yes;return yes;}
const contains=(f,p)=>(!f.bbox||bboxPoint(p,f.bbox))&&f.polygons.some(poly=>inside(poly[0],p)&&!poly.slice(1).some(r=>inside(r,p)));
const boxesMeet=(a,b)=>!a||!b||a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3];
const walkingSquare=f=>f.tags.highway==='pedestrian'&&(f.tags.area==='yes'||f.tags['area:highway']);
function edgeDistance(line,p,c,closest=null){let d=Infinity;for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],x=(b[0]-a[0])*c,y=b[1]-a[1],u=Math.max(0,Math.min(1,((p.longitude-a[0])*c*x+(p.latitude-a[1])*y)/(x*x+y*y||1)));
 const m=Math.hypot((p.longitude-a[0])*c-u*x,p.latitude-a[1]-u*y)*M;
 if(m<d){d=m;if(closest){closest.longitude=a[0]+(b[0]-a[0])*u;closest.latitude=a[1]+y*u;closest.axis=[a,b];}}
 }return d;}
function edgeBoxInReach(feature,p,metres,c){
 const b=feature.bbox,limit=metres/M+1e-10;
 // Use the same local projection as edgeDistance, with room for rounding at the threshold.
 return !(b?.every(finite)&&b[0]<=b[2]&&b[1]<=b[3]&&
   (Math.max(b[0]-p.longitude,p.longitude-b[2])*Math.abs(c)>limit||Math.max(b[1]-p.latitude,p.latitude-b[3])>limit));
}
function nearEdges(feature,p,metres,c){
 return edgeBoxInReach(feature,p,metres,c)&&feature.lines.some(line=>edgeDistance(line,p,c)<=metres);
}
// Look for the name of the water beside the sampled walking point. A centerline
// must actually pass through that water; proximity alone can pick a different
// river across a levee, or a river running alongside a pond.
function riverNameAt(point,waters,rivers){
 const c=Math.cos(point.latitude*RAD),nearby=[];
 let nearest=150;
 for(const water of waters){
  if(!water.polygons.length||!edgeBoxInReach(water,point,nearest+8,c))continue;
  let distance=contains(water,point)?0:Infinity;
  for(const line of water.lines)distance=Math.min(distance,edgeDistance(line,point,c));
  if(distance>150)continue;
  nearby.push({water,distance});nearest=Math.min(nearest,distance);
 }
 let name=null;
 for(const {water,distance} of nearby){
  // Nearby banks within the map's walking-width uncertainty must agree.
  if(distance>nearest+8)continue;
  if(water.geometryIncomplete)return null;
  const {water:kind,waterway}=water.tags;
  if(kind&&!['river','canal','stream'].includes(kind))return null;
  const typed=!!kind||['river','canal','stream','riverbank'].includes(waterway);
  const mapped=water.name.trim(),names=new Set();
  if(typed&&mapped)names.add(mapped);
  let namedDistance=Infinity,unnamedDistance=Infinity;
  for(const river of rivers){
   if(!edgeBoxInReach(river,point,300,c))continue;
   const closest={};let best=Infinity,contact=null;
   for(const line of river.lines){
    const metres=edgeDistance(line,point,c,closest);
    if(metres<best){best=metres;contact={...closest};}
   }
   if(best>300||!contact||!contains(water,contact))continue;
   const lineName=river.name.trim();
   if(lineName){names.add(lineName);namedDistance=Math.min(namedDistance,best);}
   else unnamedDistance=Math.min(unnamedDistance,best);
  }
  if(!mapped&&Number.isFinite(unnamedDistance)&&unnamedDistance<=namedDistance+8)return null;
  if(names.size!==1)return null;
  const found=names.values().next().value;
  if(mapped&&found!==mapped||name&&found!==name)return null;
  name=found;
 }
 return name;
}
// Retain the local river axis for grouping. Consumers compare both points
// against one axis, so reversing or bending the digitised line cannot flip a bank.
function riverBankAt(point,waters,rivers,name){
 const c=Math.cos(point.latitude*RAD);let best=null;
 for(const river of rivers){if(river.name.trim()!==name||!edgeBoxInReach(river,point,500,c))continue;
  for(const line of river.lines){const q={},d=edgeDistance(line,point,c,q);if(d>500||best&&d>=best.d||!q.axis||!waters.some(w=>contains(w,q)))continue;
   const [a,b]=q.axis,cross=(b[0]-a[0])*c*(point.latitude-a[1])-(b[1]-a[1])*(point.longitude-a[0])*c;
   best={d,side:Math.sign(cross),axis:q.axis};
  }
 }
 return best?.side?{river:name,side:best.side,axis:best.axis}:null;
}
const xy=g=>(g||[]).filter(p=>p&&finite(p.lon)&&finite(p.lat)&&Math.abs(p.lon)<=180&&Math.abs(p.lat)<=90).map(p=>[p.lon,p.lat]);
const closed=r=>r.length>=4&&distance(r[0],r[r.length-1])<.01;
// Multipolygon member fragments are joined only by equal endpoints. An unclosed
// ring is unavailable geometry, not an invitation to fill the relation's bbox.
function joinRings(lines){const todo=lines.map(x=>x.slice()),rings=[];while(todo.length){let r=todo.shift(),changed=true;while(!closed(r)&&changed){changed=false;for(let i=0;i<todo.length;i++){let b=todo[i];if(distance(r[r.length-1],b[0])<.01)r.push(...b.slice(1));
else if(distance(r[r.length-1],b[b.length-1])<.01)r.push(...b.slice(0,-1).reverse());else if(distance(r[0],b[b.length-1])<.01)r.unshift(...b.slice(0,-1));else if(distance(r[0],b[0])<.01)r.unshift(...b.slice(1).reverse());else continue;todo.splice(i,1);changed=true;break;}}if(closed(r))rings.push(r);
}return rings;}
function parseElements(elements){
 const rows=[];
 for(const e of elements){
  if(!e.tags||!['node','way','relation'].includes(e.type))continue;
  const tags={...e.tags},id=e.type+'/'+e.id,lines=[],polygons=[];let position=null,geometryIncomplete=false;
  if(e.type==='node'&&finite(e.lat)&&finite(e.lon))position={latitude:e.lat,longitude:e.lon};
  if(e.type==='way'){const r=xy(e.geometry);if(r.length>1)lines.push(r);if(closed(r))polygons.push([r]);}
  if(e.type==='relation'){
   const members=(e.members||[]).filter(m=>m.type==='way'),outer=members.filter(m=>m.role!=='inner').map(m=>xy(m.geometry)).filter(r=>r.length>1),inner=members.filter(m=>m.role==='inner').map(m=>xy(m.geometry)).filter(r=>r.length>1),outers=joinRings(outer),inners=joinRings(inner);
   geometryIncomplete=members.some(m=>!m.geometry)||outer.length>0&&!outers.length||inner.length>0&&!inners.length;
   for(const r of outers)polygons.push([r,...inners.filter(h=>inside(r,{longitude:h[0][0],latitude:h[0][1]}))]);
   lines.push(...outers);
  }
  const viewpoint=tags.tourism==='viewpoint'||tags['tower:type']==='observation';
  const kind=viewpoint?'viewpoint':tags.place==='square'?'plaza':['park','garden','recreation_ground'].includes(tags.leisure)?'park':null;
  const walking=['footway','path','pedestrian','steps'].includes(tags.highway)||['footway','pedestrian'].includes(tags['area:highway']);
  const water=tags.natural==='water'||tags.waterway==='riverbank';
  const building=!!tags.building&&tags.building!=='no';
  if(!kind&&!walking&&!water&&!building&&!['river','stream','canal'].includes(tags.waterway))continue;
  let bbox=null;for(const line of lines)for(const [lon,lat] of line){if(!bbox)bbox=[lon,lat,lon,lat];else{bbox[0]=Math.min(bbox[0],lon);bbox[1]=Math.min(bbox[1],lat);bbox[2]=Math.max(bbox[2],lon);bbox[3]=Math.max(bbox[3],lat);}}
  rows.push({id,sourceId:'osm/'+id,tags,name:tags['name:ja']||tags.name||'',kind,walking,water,building,position,polygons,lines,bbox,geometryIncomplete});
 }
 return rows;
}
function query(b){const box=[b[1],b[0],b[3],b[2]].map(x=>x.toFixed(6)).join(',');return '[out:json][timeout:18];('+[
 'nwr[leisure~"^(park|garden|recreation_ground)$"]','nwr[place=square]','nwr[tourism=viewpoint]','nwr["tower:type"=observation]',
 'way[highway~"^(footway|path|pedestrian|steps)$"]','way["area:highway"~"^(footway|pedestrian)$"]',
 'way[natural=water]','relation[natural=water]','way[waterway~"^(riverbank|river|stream|canal)$"]','way[building]','relation[building]'
 ].map(s=>s+'('+box+');').join('')+');out geom;out count;';}
// The official OSM map API is a bounded read-only fallback. It returns XML,
// including node coordinates for way references. Parse only these data tags;
// never interpret markup or resolve external entities.
function mapElements(xml){
 let rows=[];
 if(typeof xml!=='string'){
  if(!Array.isArray(xml?.elements)||xml.remark||xml.error)throw Error('incomplete-osm-map-response');
  rows=xml.elements.filter(e=>['node','way','relation'].includes(e.type)).map(e=>({type:e.type,id:e.id,tags:e.tags||{},lat:e.lat,lon:e.lon,
   ...(e.type==='way'?{refs:(e.nodes||[]).map(String)}:e.type==='relation'?{members:e.members||[]}:{})}));
 }else{
 if(!/<osm\b/.test(xml)||!/<\/osm>/.test(xml)||/<(?:error|remark)\b/.test(xml))throw Error('incomplete-osm-map-response');
 const decode=s=>s.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi,(_,x)=>x[0]==='#'?String.fromCodePoint(x[1].toLowerCase()==='x'?parseInt(x.slice(2),16):Number(x.slice(1))):({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[x]||_));
 const attrs=s=>Object.fromEntries([...s.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));
 const re=/<(node|way|relation)\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/\1\s*>)/g;let m;
 while((m=re.exec(xml))){const a=attrs(m[2]),body=m[3]||'',tags={};for(const t of body.matchAll(/<tag\b([^>]*?)\/\s*>/g)){const p=attrs(t[1]);if(p.k!=null)tags[p.k]=p.v;}
  const e={type:m[1],id:Number(a.id),tags};if(e.type==='node'){e.lat=Number(a.lat);e.lon=Number(a.lon);}else if(e.type==='way'){e.refs=[...body.matchAll(/<nd\b([^>]*?)\/\s*>/g)].map(t=>attrs(t[1]).ref);}else e.members=[...body.matchAll(/<member\b([^>]*?)\/\s*>/g)].map(t=>attrs(t[1]));rows.push(e);
 }
 }
 const nodes=new Map(rows.filter(e=>e.type==='node').map(e=>[String(e.id),e])),ways=new Map(rows.filter(e=>e.type==='way').map(e=>[String(e.id),e]));
 for(const e of ways.values()){e.geometry=e.refs.map(r=>nodes.get(r)).filter(Boolean).map(n=>({lat:n.lat,lon:n.lon}));if(e.geometry.length!==e.refs.length)e.geometry=[];delete e.refs;}
 for(const e of rows)if(e.type==='relation')e.members=e.members.map(m=>({...m,ref:Number(m.ref),geometry:m.type==='way'?ways.get(String(m.ref))?.geometry:undefined}));
 return rows;
}
function regionsFor(regions){
 const out=[];for(const [i,r] of (regions||[]).entries()){
  const b=Array.isArray(r)?r:r.bbox;if(!Array.isArray(b)||b.length!==4||!b.every(finite)||b[1]>=b[3]||b[1]<-90||b[3]>90||b[0]<-180||b[0]>180||b[2]<-180||b[2]>180||b[0]===b[2])continue;
  const meta={id:r.id||'region-'+i,priority:finite(r.priority)?r.priority:i,source:r.source||'inverse-geometry'};
  if(b[0]<b[2])out.push({...meta,bbox:b.slice()});else {out.push({...meta,bbox:[b[0],b[1],180,b[3]]},{...meta,id:meta.id+'-west',bbox:[-180,b[1],b[2],b[3]]});}
 }return out.sort((a,b)=>a.priority-b.priority);
}
function* tileQueue(regions){const seen=new Set();for(const r of regions){const b=r.bbox;for(let y=Math.floor(b[1]/TILE);y<=Math.floor((b[3]-1e-10)/TILE);y++)for(let x=Math.floor(b[0]/TILE);x<=Math.floor((b[2]-1e-10)/TILE);x++){
 const id=x+':'+y;if(seen.has(id))continue;seen.add(id);
 yield {id,bbox:[Math.max(-180,x*TILE),Math.max(-90,y*TILE),Math.min(180,(x+1)*TILE),Math.min(90,(y+1)*TILE)],regionId:r.id};
 }}}
function sampleFeatures(features,regions,{spacingM=30,maxPoints=480,skipPoints=0,pointKinds}={}){
 const generationBudget=maxPoints+skipPoints;
 const areas=features.filter(f=>f.kind&&f.polygons.length),waters=features.filter(f=>f.water),rivers=features.filter(f=>['river','canal'].includes(f.tags.waterway)),buildings=features.filter(f=>f.building),groups=[],unknownGeometry=features.filter(f=>f.geometryIncomplete).map(f=>f.id);
 let generationLimited=false,excludedPoints=0,excludedFeatures=0;
 const surfaces=new Map(),excluded=features.filter(f=>(f.water||f.building||forbidden(f.tags)||nonGroundArea(f))&&f.polygons.length);
 const surfaceFor=(f,area,p)=>{
  const direct={polygons:f.walking&&(f.tags.area==='yes'||f.tags['area:highway'])?f.polygons:[],lines:f.walking&&f.tags.area!=='yes'&&!f.tags['area:highway']?f.lines:[],...(f.position?{position:f.position}:{})};
  if(!f.walking||!area||!area.polygons.length||area===f)return direct;
  const id=f.id+'/'+area.id;if(surfaces.has(id))return surfaces.get(id);
  // Reuse the movement boundary intersections, on this source only. Never
  // extend a park seed onto connected roads outside its actual place.
  const constraints=[area,...excluded.filter(x=>x!==f&&x!==area)].map(x=>({...x,walking:false}));
  const domain=movementDomain({...p,placeId:area.sourceId,surfaceId:f.sourceId},[f,...constraints],{radiusM:Infinity,allComponents:true});
  const shape=domain?.geometry||{polygons:[],lines:[]};surfaces.set(id,shape);return shape;
 };
 const inRegion=p=>regions.some(r=>bboxPoint(p,r.bbox));
 for(const f of features){
  if(forbidden(f.tags)||(!f.walking&&f.kind!=='viewpoint'))continue;
  if(f.geometryIncomplete)continue;
  const intrinsic=f.kind==='viewpoint'?'viewpoint':walkingSquare(f)?'plaza':null;
  if(pointKinds&&!pointKinds.has('sidewalk')&&!pointKinds.has('riverbank')&&!pointKinds.has(intrinsic)&&
   !areas.some(a=>pointKinds.has(a.kind)&&boxesMeet(a.bbox,f.bbox))){excludedFeatures++;continue;}
  const candidates=[];
  const addCandidate=p=>{
   if(!inRegion(p))return;
   const containers=areas.filter(a=>contains(a,p));if(containers.some(a=>forbidden(a.tags)))return;
   const water=waters.find(a=>contains(a,p));if(water&&!nonGround(f.tags))return;
   const roofArea=containers.find(nonGroundArea),building=buildings.find(a=>contains(a,p)),viewpoint=containers.find(a=>a.kind==='viewpoint');
   const square=containers.find(a=>a.kind==='plaza'),park=containers.find(a=>a.kind==='park');
   const longitudeScale=Math.cos(p.latitude*RAD);
   const river=!viewpoint&&!square&&!park&&rivers.find(a=>nearEdges(a,p,80,longitudeScale));
   const riverArea=!park&&containers.find(a=>/河川敷|川テラス|川緑道|riverbank|riverside/i.test(a.name));
   const riverPath=!park&&/河川敷|川.*テラス|riverside|riverbank/i.test(f.name)&&waters.some(a=>nearEdges(a,p,80,longitudeScale));
   // A levee-top path stands well back from a wide river's centre line: within 150 m of its water and
   // 300 m of the centre line it is the riverbank, while streets behind the levee are not.
   const wideRiver=!park&&rivers.find(a=>a.tags.waterway==='river'&&nearEdges(a,p,300,longitudeScale))&&waters.some(a=>nearEdges(a,p,150,longitudeScale));
   const riverside=riverArea||riverPath||river&&waters.some(a=>nearEdges(a,p,80,longitudeScale))||wideRiver;
   const area=viewpoint||square||(walkingSquare(f)?f:park)||riverArea;
   const placeKind=f.kind==='viewpoint'||viewpoint?'viewpoint':square||walkingSquare(f)?'plaza':park?'park':riverside?'riverbank':'sidewalk';
   if(pointKinds&&!pointKinds.has(placeKind)){excludedPoints++;return;}
   const elevated=nonGround(f.tags)||!!roofArea||!!building;
   const surface=area&&nonGroundArea(area)?area:f;
   // ele = absolute feature elevation, height = structure top, level = floor
   // index. None identifies the physical standing floor on its own.
   const floor=Number(surface.tags['floor:height']),floorSource=surface.tags['source:floor:height'];
   const knownFloor=surface.tags['floor:height']!=null&&finite(floor)&&floor>=0&&floorSource;
   const accessKnown=!![f,...containers].find(a=>['yes','public','permissive','designated'].includes(a.tags.foot)||['yes','public','permissive'].includes(a.tags.access));
   const structuralUnknown=f.kind==='viewpoint'||!!viewpoint||elevated;
   candidates.push({...p,lat:p.latitude,lon:p.longitude,placeId:'osm/'+(area||f).id,name:(area||f).name||f.name||({park:'公園の園路',plaza:'歩行広場',riverbank:'河川沿いの歩道',sidewalk:'歩道',viewpoint:'展望地点'}[placeKind]),placeKind,
    sourceId:f.sourceId,surfaceId:f.sourceId,polygonId:f.id,region:regions.find(r=>bboxPoint(p,r.bbox))?.id,
    surfaceGeometry:surfaceFor(f,area,p),
    groundM:null,groundKnown:false,surfaceAglM:knownFloor?floor:structuralUnknown?null:0,surfaceHeightM:knownFloor?floor:structuralUnknown?null:0,surfaceElevationM:null,eyeM:1.5,
    standingSurfaceKnown:false,accessKnown,structureClassificationKnown:!structuralUnknown||!!knownFloor,nonTerrainStructure:!!elevated||!!knownFloor&&floor>0,
    sourceEvidence:{kind:'osm-mapped-walking-surface',heightBasis:'surfaceAglM/surfaceHeightM:height-above-local-ground; surfaceElevationM:groundM+surfaceAglM; eyeM:height-above-surface',osmId:f.id,placeOsmId:(area||f).id,tags:{...f.tags},areaTags:area?{...area.tags}:null,
    classification:riverArea?'named-riverside-area':riverPath?'named-riverside-walkway':riverside?'mapped-river-proximity':'mapped-feature',floor:knownFloor?{heightM:floor,source:floorSource}:null,buildingContaining:building?.id||null,access:'mapped-only',vegetation:'unknown',
    actualVisibilityGuaranteed:false}
   });
  };
  if(f.kind==='viewpoint'&&f.position)addCandidate(f.position);
  // A viewpoint polygon provides no known camera location; walkable geometry
  // inside it is handled below, but its arbitrary centroid is never a deck.
  if(f.walking){
   const filled=f.tags.area==='yes'||!!f.tags['area:highway'];
   if(filled){for(const poly of f.polygons){const r=poly[0],xs=r.map(p=>p[0]),ys=r.map(p=>p[1]),a=Math.min(...ys),b=Math.max(...ys),lo=Math.min(...xs),hi=Math.max(...xs),dy=spacingM/M,dx=dy/Math.max(.01,Math.cos((a+b)*RAD/2));let count=0;
    for(const region of regions){const box=region.bbox,fromLat=Math.max(a,box[1]),toLat=Math.min(b,box[3]),fromLon=Math.max(lo,box[0]),toLon=Math.min(hi,box[2]);for(let lat=fromLat+dy/2;lat<toLat&&count<generationBudget*4;lat+=dy)for(let lon=fromLon+dx/2;lon<toLon&&count<generationBudget*4;
    lon+=dx){const p={latitude:lat,longitude:lon};if(inside(r,p)&&!poly.slice(1).some(h=>inside(h,p))){const before=candidates.length;addCandidate(p);count+=candidates.length-before;}}}if(count>=generationBudget*4)generationLimited=true;
    // Small pedestrian squares may be smaller than one grid cell.
    const p={latitude:(a+b)/2,longitude:(lo+hi)/2};if(inside(r,p)&&!poly.slice(1).some(h=>inside(h,p)))addCandidate(p);
   }}else for(const line of f.lines){for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],n=Math.max(1,Math.ceil(distance(a,b)/spacingM));for(let j=0;j<n;j++){const p={longitude:a[0]+(b[0]-a[0])*j/n,latitude:a[1]+(b[1]-a[1])*j/n};if(!inRegion(p))continue;
   if(candidates.length>=generationBudget*8){generationLimited=true;break;}addCandidate(p);}}const last=line[line.length-1];if(last)addCandidate({longitude:last[0],latitude:last[1]});}
  }
  const points=candidates;
  if(points.length){const preferred=points.filter(p=>p.placeKind!=='sidewalk'),support=points.filter(p=>p.placeKind==='sidewalk');if(preferred.length)groups.push(preferred);if(support.length)groups.push(support);}
 }
 // Round-robin surfaces within each priority group; one long path cannot consume
 // the entire budget before a small park or a viewpoint is considered.
 groups.sort((a,b)=>(a[0].placeKind==='sidewalk')-(b[0].placeKind==='sidewalk'));
 const rows=[],seen=new Set();let remaining=0,remainingWanted=0,visited=0;
 for(const priority of [false,true]){const g=groups.filter(a=>(a[0].placeKind==='sidewalk')===priority);for(let i=0;g.some(a=>i<a.length);i++)for(const a of g)if(i<a.length){const p=a[i],k=key(p)+'/'+p.surfaceId;if(seen.has(k))continue;seen.add(k);if(visited++<skipPoints)continue;
 if(rows.length<maxPoints)rows.push(p);else{remaining++;remainingWanted++;}}}
 // Enrich only the rows returned by this page. Classification, ordering and
 // height/visibility checks stay driven by the same original walking points.
 for(const p of rows)if(p.placeKind==='riverbank'&&(!pointKinds||pointKinds.has('riverbank'))){
  const name=riverNameAt(p,waters,rivers);if(name){p.sourceEvidence.riverName=name;const bank=riverBankAt(p,waters,rivers,name);if(bank)p.sourceEvidence.riverBank=bank;}
 }
 return {rows,limited:remaining>0||generationLimited,omittedPoints:remaining,remainingWanted,generationLimited,unknownGeometry,excludedPoints,excludedFeatures};
}
// Keep movement on the selected walking place. A bridge or a nearby opposite
// bank is not a continuation merely because its coordinates are close.
function movementDomain(seed,features,{radiusM=600,allComponents=false}={}){
 const origin={latitude:seed.latitude,longitude:seed.longitude},c=Math.cos(origin.latitude*RAD);
 const usable=f=>f.walking&&!f.geometryIncomplete&&!forbidden(f.tags)&&!nonGround(f.tags);
 const area=features.find(f=>f.sourceId===seed.placeId&&f.polygons.length&&(f.kind||f.tags.area==='yes'||f.tags['area:highway']))||features.find(f=>f.kind==='park'&&contains(f,origin));
 const excluded=features.filter(f=>(f.water||f.building||forbidden(f.tags)||nonGroundArea(f))&&f.polygons.length);
 const riverbank=seed.placeKind==='riverbank'&&!area,waters=features.filter(f=>f.water),rivers=features.filter(f=>['river','canal'].includes(f.tags.waterway));
 const nearbySegments=rows=>rows.flatMap(f=>f.lines.flatMap(l=>l.slice(1).map((b,i)=>[l[i],b]))).filter(l=>edgeBoxInReach({bbox:[Math.min(l[0][0],l[1][0]),Math.min(l[0][1],l[1][1]),Math.max(l[0][0],l[1][0]),Math.max(l[0][1],l[1][1])]},origin,radiusM+300,c));
 const shores=riverbank?nearbySegments(waters):[],axes=riverbank?nearbySegments(rivers):[];
 const alongRiver=p=>!riverbank||shores.some(l=>edgeDistance(l,p,c)<=150)&&axes.some(l=>edgeDistance(l,p,c)<=300);
 const valid=p=>distance([origin.longitude,origin.latitude],[p.longitude,p.latitude])<=radiusM+.01&&(!area||contains(area,p))&&alongRiver(p)&&!excluded.some(f=>contains(f,p));
 const walks=features.filter(usable),nearest={};let best=Infinity,source=null;
 for(const f of walks){let d=Infinity;for(const line of f.lines)d=Math.min(d,edgeDistance(line,origin,c,nearest));
  if(f.sourceId===seed.surfaceId||f.sourceId===seed.sourceId){source=f;break;}if(d<best){best=d;source=f;}}
 if(!source||!area&&best>12&&source.sourceId!==seed.surfaceId&&source.sourceId!==seed.sourceId)return null;
 if(source.tags.area==='yes'||source.tags['area:highway']){
  const polygons=source.polygons.map(poly=>[...poly,...excluded.filter(f=>!source.bbox||!f.bbox||f.bbox[0]<=source.bbox[2]&&f.bbox[2]>=source.bbox[0]&&f.bbox[1]<=source.bbox[3]&&f.bbox[3]>=source.bbox[1]).flatMap(f=>f.polygons.map(p=>p[0]))]);
  return {origin,radiusM,label:area?.name||seed.name||'この付近の広場',kind:'plaza',sourceIds:[source.sourceId],boundary:area?.polygons||source.polygons,
   geometry:{polygons,lines:[],...(area&&area!==source?{within:area.polygons}:{})}};
 }
 const vertices=f=>f.lines.flat().filter(([lon,lat])=>distance([origin.longitude,origin.latitude],[lon,lat])<=radiusM+10);
 const key=([lon,lat])=>lon.toFixed(7)+','+lat.toFixed(7),byVertex=new Map();
 for(const f of walks)for(const p of vertices(f)){const k=key(p);if(!byVertex.has(k))byVertex.set(k,[]);byVertex.get(k).push(f);}
 const connected=new Set([source]),queue=[source];
 while(queue.length){const f=queue.shift();for(const p of vertices(f))for(const next of byVertex.get(key(p))||[]){
  if(connected.has(next))continue;connected.add(next);queue.push(next);
 }}
 // Split at every real boundary (including holes), then test the open interval.
 // This preserves concave parks and never draws a shortcut across water.
 const rings=[...(area?.polygons||[]).flat(),...excluded.flatMap(f=>f.polygons.flat())].map(r=>({r,b:r.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity])})),lines=[];
 const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
 for(const f of connected)for(const line of f.lines)for(let i=1;i<line.length;i++){
  const a=line[i-1],b=line[i],v=[b[0]-a[0],b[1]-a[1]],ts=[0,1];
  for(const {r:ring,b:box} of rings){
   if(box[0]>Math.max(a[0],b[0])||box[2]<Math.min(a[0],b[0])||box[1]>Math.max(a[1],b[1])||box[3]<Math.min(a[1],b[1]))continue;
   for(let j=1;j<ring.length;j++){
   const u=ring[j-1],w=[ring[j][0]-u[0],ring[j][1]-u[1]],den=cross(v,w);if(Math.abs(den)<1e-20)continue;
   const d=[u[0]-a[0],u[1]-a[1]],t=cross(d,w)/den,r=cross(d,v)/den;if(t>0&&t<1&&r>=0&&r<=1)ts.push(t);
  }}
  const x=(a[0]-origin.longitude)*c*M,y=(a[1]-origin.latitude)*M,dx=v[0]*c*M,dy=v[1]*M,A=dx*dx+dy*dy,B=2*(x*dx+y*dy),C=x*x+y*y-radiusM*radiusM,disc=B*B-4*A*C;
  if(A>0&&disc>=0)for(const t of [(-B-Math.sqrt(disc))/(2*A),(-B+Math.sqrt(disc))/(2*A)])if(t>0&&t<1)ts.push(t);
  if(riverbank){const n=Math.ceil(distance(a,b)/20);for(let j=1;j<n;j++)ts.push(j/n);}
  const at=t=>[a[0]+v[0]*t,a[1]+v[1]*t];ts.sort((a,b)=>a-b);
  for(let j=1;j<ts.length;j++){const m=at((ts[j-1]+ts[j])/2);if(ts[j]-ts[j-1]>1e-10&&valid({longitude:m[0],latitude:m[1]}))lines.push([at(ts[j-1]),at(ts[j])]);}
 }
 if(!lines.length)return null;
 const vertex=p=>p[0].toFixed(7)+','+p[1].toFixed(7),touching=new Map();let first=0,nearestDistance=Infinity;
 lines.forEach((line,i)=>{const d=edgeDistance(line,origin,c);if(d<nearestDistance){first=i;nearestDistance=d;}for(const p of line){const k=vertex(p);if(!touching.has(k))touching.set(k,[]);touching.get(k).push(i);}});
 const reached=new Set([first]),pending=[first];while(pending.length){const i=pending.shift();for(const p of lines[i])for(const j of touching.get(vertex(p))||[])if(!reached.has(j)){reached.add(j);pending.push(j);}}
 if(!allComponents){const retained=lines.filter((_,i)=>reached.has(i));lines.splice(0,lines.length,...retained);}
 const ends=new Map(),used=new Set(),joined=[];
 lines.forEach((line,i)=>{for(const p of line){const k=vertex(p);if(!ends.has(k))ends.set(k,[]);ends.get(k).push(i);}});
 function chain(i,start){const path=[start];let at=start;
  while(!used.has(i)){used.add(i);const edge=lines[i],next=vertex(at)===vertex(edge[0])?edge[1]:edge[0];path.push(next);at=next;
   const following=ends.get(vertex(at));if(following.length!==2)break;const j=following.find(j=>!used.has(j));if(j===undefined)break;i=j;
  }joined.push(path);}
 lines.forEach((line,i)=>{if(used.has(i))return;const end=line.find(p=>ends.get(vertex(p)).length!==2);if(end)chain(i,end);});
 lines.forEach((line,i)=>{if(!used.has(i))chain(i,line[0]);});lines.splice(0,lines.length,...joined);
 lines.sort((a,b)=>edgeDistance(a,origin,c)-edgeDistance(b,origin,c));
 return {origin,radiusM,label:area?.name||seed.name||'この付近の歩道',kind:area?.kind||seed.placeKind||'sidewalk',
  sourceIds:[...connected].map(f=>f.sourceId),boundary:area?.polygons||[],geometry:{lines,polygons:[],...(area?{within:area.polygons}:{})}};
}
function movementPoint(domain,p,maxDistanceM=20){
 if(!domain||!p||![p.latitude,p.longitude].every(finite))return null;
 if(distance([domain.origin.longitude,domain.origin.latitude],[p.longitude,p.latitude])>domain.radiusM+maxDistanceM)return null;
 const within=domain.geometry.within;
 if(distance([domain.origin.longitude,domain.origin.latitude],[p.longitude,p.latitude])<=domain.radiusM&&(!within||within.some(poly=>inside(poly[0],p)&&!poly.slice(1).some(r=>inside(r,p))))&&
  (domain.geometry.polygons||[]).some(poly=>inside(poly[0],p)&&!poly.slice(1).some(r=>inside(r,p))))return {...p,distanceM:0};
 const nearest={},c=Math.cos(p.latitude*RAD);let best=Infinity,point=null;
 for(const line of domain.geometry.lines){const d=edgeDistance(line,p,c,nearest);if(d<best){best=d;point={...nearest};}}
 return best<=maxDistanceM?{...point,distanceM:best}:null;
}
function publishedViewpoints(data,regions){
 const points=[];
 for(const p of data?.places||[]){
  const source=p.source||p.sightline?.source,basis=p.heightBasis,published=basis==='published-viewpoint',floor=['floor','standing-floor','published-floor','survey-floor'].includes(basis);
  if(p.kind!=='展望台'||!p.heightKnown||!finite(p.latitude)||!finite(p.longitude)||!finite(p.deckM)||p.deckM<0||!source||(!published&&!floor)||!regions.some(r=>bboxPoint(p,r.bbox))||['no','private'].includes(p.access?.type))continue;
  // targetIds and historical target-specific sightline evidence do not restrict
  // input, and do not prove windows/visibility for a new arbitrary target.
  points.push({latitude:p.latitude,longitude:p.longitude,lat:p.latitude,lon:p.longitude,placeId:'viewpoint/'+p.id,name:p.name,placeKind:'viewpoint',sourceId:'viewpoint/'+p.id,surfaceId:'viewpoint/'+p.id,polygonId:p.id,region:regions.find(r=>bboxPoint(p,r.bbox))?.id,
   surfaceGeometry:{polygons:[],lines:[],position:{latitude:p.latitude,longitude:p.longitude}},
   groundM:null,groundKnown:false,surfaceAglM:p.deckM,surfaceHeightM:p.deckM,surfaceElevationM:null,eyeM:published?0:1.5,standingSurfaceKnown:false,accessKnown:false,structureClassificationKnown:true,nonTerrainStructure:true,heightBasis:basis,
   quality:published?'published-viewpoint-point-model':'documented-floor-point-model',
   sourceEvidence:{kind:'documented-viewpoint-point-model',source,checkedAt:p.sightline?.checkedAt||null,heightBasis:basis,heightM:p.deckM,reference:'height-above-local-ground',eyeHeightIncluded:published,positionBasis:'existing-point-model',physicalFloorMeasured:!published&&basis==='survey-floor',
   windowOpening:'unknown',targetVisibility:'unknown',buildingLOS:'unknown',vegetation:'unknown',actualVisibilityGuaranteed:false}
  });
 }return points;
}
// Surveyed places (data/candidate-surveyed-viewpoints.json, tools/build-surveyed-viewpoints.mjs): places looked up as seeing
// the target, with the height one stands at. 2026-11-14 ユーザー「調査済み159地点をアプリに組み込み、新しい撮影地点にも出してもいい」。
// They are offered for the targets they were surveyed for only, wherever the search's regions lie (a far mountain pass or
// an observation room is not on the line the regions follow), and the survey stands for the sight line to the target.
function surveyedViewpoints(data,targetId){
 const points=[];
 for(const p of data?.places||[]){
  if(!targetId||!p.targets?.includes(targetId)||![p.latitude,p.longitude,p.groundM,p.eyeM].every(finite)||p.eyeM<0)continue;
  const id='surveyed/'+p.id;
  const placeKind=['viewpoint','park','plaza','sidewalk','riverbank','road','unknown'].includes(p.placeKind)?p.placeKind:'unknown',e=p.categoryEvidence;
  const categoryEvidence=e&&['research-kind','research-description','mapped-category','official-description','unclassified'].includes(e.basis)&&typeof e.detail==='string'&&Array.isArray(e.sourceUrls)&&e.sourceUrls.every(u=>typeof u==='string')?
   {...e,sourceUrls:e.sourceUrls.slice()}:null;
  points.push({latitude:p.latitude,longitude:p.longitude,lat:p.latitude,lon:p.longitude,placeId:id,name:p.name,placeKind,sourceId:id,surfaceId:id,polygonId:p.id,
   surfaceGeometry:{polygons:[],lines:[],position:{latitude:p.latitude,longitude:p.longitude}},
   // The surveyed height is the lens above the stated ground or floor, so the floor is that ground itself (surfaceAglM 0):
   // a place off the terrain without a floor height is refused as standing-height-unknown (generic-evaluator.js).
   groundM:p.groundM,groundKnown:true,surfaceAglM:0,eyeM:p.eyeM,standingSurfaceKnown:true,accessKnown:false,structureClassificationKnown:true,nonTerrainStructure:p.eyeM>3||!!p.groundManual,surveyedTargets:p.targets.slice(),
   quality:'surveyed-viewpoint',
   sourceEvidence:{kind:'surveyed-viewpoint',sourceId:p.id,heightM:p.eyeM,reference:p.groundManual?'height-above-stated-floor':'height-above-local-ground',positionBasis:'representative-point',shape:p.shape,
   ...(categoryEvidence?{categoryEvidence}:{}),targetVisibility:'surveyed',actualVisibilityGuaranteed:false}
  });
 }return points;
}
function createPlaceProvider({terrain,fetchImpl=globalThis.fetch,loadViewpoints,loadSurveyed,isCurrent:providerCurrent=()=>true,maxTiles=12,maxPoints=480,timeoutMs=25000,maxDurationMs=55000,spacingM=30,endpoints,places=null}={}){
 if(!terrain)throw Error('terrain provider is required');
 const servers=endpoints||terrain.OVERPASS||[],cache=new Map(),heightCache=new Map(),nearbyCache=new Map();
 let endpointCursor=0,overpassRetryAfter=0,overpassNextRequest=0;
 async function load(plan,{regions=plan?.regions||plan?.searchRegions||[],isCurrent=()=>true,onProgress=()=>{},signal,deadline=Infinity,maxTiles:tileBudget=maxTiles,maxPoints:pointBudget=maxPoints,pointKinds,cursor,offset=0,retryFailed=true}={}){
  const wanted=pointKinds==null?null:new Set(pointKinds),pointKindsKey=wanted?JSON.stringify([...wanted].sort()):null;
  if(cursor&&typeof cursor==='object'&&'pointKindsKey'in cursor&&cursor.pointKindsKey!==pointKindsKey){cursor=null;offset=0;}
  offset=Math.max(0,Number(cursor?.offset??cursor??offset)||0);const retryTiles=Array.isArray(cursor?.retryTiles)?cursor.retryTiles:[],batchTiles=Array.isArray(cursor?.batchTiles)?cursor.batchTiles:null,pointOffset=Math.max(0,Number(cursor?.pointOffset)||0);
  const requested=regionsFor(regions),started=Date.now(),current=()=>!signal?.aborted&&Date.now()<deadline&&providerCurrent()&&isCurrent(),controller=new AbortController();
  let timedOut=false;const cancel=()=>controller.abort(),timer=setInterval(()=>{if(!current())cancel();if(Date.now()-started>maxDurationMs){timedOut=true;cancel();}},100);signal?.addEventListener('abort',cancel,{once:true});
  const coverage={status:'partial',requestedRegions:requested,fetchedRegions:[],failedRegions:[],pendingRegions:[],missing:[],osmComplete:false,samplingComplete:false,heightComplete:false,visibilityAssessed:false,actualVisibilityGuaranteed:false,queryTileDegrees:TILE};
  const merged=new Map();let nextOffset=offset,hasPending=false;
  async function bounded(promise,ms){let t,abort;return Promise.race([promise,new Promise((_,reject)=>{t=setTimeout(()=>reject(Error('timeout')),ms);}),new Promise((_,reject)=>{abort=()=>reject(Error('cancelled'));if(controller.signal.aborted)abort();
  else controller.signal.addEventListener('abort',abort,{once:true});})]).finally(()=>{clearTimeout(t);controller.signal.removeEventListener('abort',abort);});}
  async function request(url,opts={}){
   if(!current()||controller.signal.aborted)throw Error('cancelled');
   const own=new AbortController(),abort=()=>own.abort(),t=setTimeout(abort,timeoutMs);controller.signal.addEventListener('abort',abort,{once:true});opts.signal?.addEventListener('abort',abort,{once:true});
   try{return await bounded(fetchImpl(url,{...opts,signal:own.signal}),timeoutMs+50);}finally{clearTimeout(t);controller.signal.removeEventListener('abort',abort);opts.signal?.removeEventListener('abort',abort);}
  }
  async function acquire(tile){
   const previous=cache.get(tile.id);if(previous&&Date.now()-previous.at<86400000)return {...previous,cached:true};
   // Expand for containing parks/river edges, but select only inside requested
   // regions. out geom without an output bbox preserves full returned rings.
   const b=tile.bbox.map((v,i)=>v+(i<2?-.0003:.0003));b[0]=Math.max(-180,b[0]);b[1]=Math.max(-90,b[1]);b[2]=Math.min(180,b[2]);b[3]=Math.min(90,b[3]);
   // Bundled OSM places first (no Overpass round trip); Overpass only if they cannot be read.
   if(places)try{const value={features:parseElements(await bounded(places.elementsIn(b),timeoutMs)),at:Date.now(),timestamp:null,endpoint:'bundled-osm',version:'bundled',local:true};
    cache.set(tile.id,value);while(cache.size>120)cache.delete(cache.keys().next().value);return value;}catch{/* Overpass below. */}
   let reason=Date.now()<overpassRetryAfter?'overpass-cooldown':'no-overpass-endpoint',overpassAttempted=false;
   for(let attempt=0;attempt<Math.min(2,servers.length)&&current()&&!controller.signal.aborted&&(tile.retry||Date.now()>=overpassRetryAfter);attempt++){
    overpassAttempted=true;
    const endpoint=servers[(endpointCursor+attempt)%servers.length];
    try{
     if(!retryFailed){
      const delay=overpassNextRequest-Date.now();if(delay>0){let wait;try{await bounded(new Promise(resolve=>{wait=setTimeout(resolve,delay);}),delay+250);}finally{clearTimeout(wait);}}
      if(!current()||controller.signal.aborted)throw Error('cancelled');
      overpassNextRequest=Date.now()+1000;
     }
     const res=await request(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'data='+encodeURIComponent(query(b))});if(!res.ok)throw Error('HTTP '+res.status);const data=await bounded(res.json(),timeoutMs);
     if(data.remark||!Array.isArray(data.elements)||!data.elements.some(e=>e.type==='count'))throw Error(data.remark||'incomplete-overpass-response');
     const value={features:parseElements(data.elements),at:Date.now(),timestamp:data.osm3s?.timestamp_osm_base||null,endpoint,version:hash(JSON.stringify(data.elements))};cache.set(tile.id,value);while(cache.size>120)cache.delete(cache.keys().next().value);endpointCursor=(endpointCursor+attempt)%Math.max(1,servers.length);overpassRetryAfter=0;return value;
    }catch(e){reason=String(e.message||e);if(!retryFailed&&reason==='HTTP 429')break;}
   }if(!current()||controller.signal.aborted)throw Error('cancelled');
   // A refusal (429) waits a minute; a slow answer only briefly, as a dense Tokyo tile can take Overpass 10-20 s.
   endpointCursor=(endpointCursor+1)%Math.max(1,servers.length);if(overpassAttempted)overpassRetryAfter=Date.now()+(/429/.test(reason)?60000:20000);
   if(retryFailed&&current()&&!controller.signal.aborted)try{const endpoint='https://api.openstreetmap.org/api/0.6/map',res=await request(endpoint+'?bbox='+b.join(','));if(!res.ok)throw Error('HTTP '+res.status);
   const xml=await bounded(res.text(),timeoutMs),elements=mapElements(xml),value={features:parseElements(elements),at:Date.now(),timestamp:null,endpoint,version:hash(xml),fallback:true};cache.set(tile.id,value);return value;}catch(e){reason+='; map '+String(e.message||e);}
   throw Error(reason);
  }
  try{
   if(!requested.length)coverage.missing.push('no-search-regions');
   let visited=0,used=0;const deferredRetries=[];
   function* queue(){if(batchTiles){for(const tile of batchTiles)yield {...tile,page:true};return;}for(const tile of retryTiles)yield {...tile,retry:true};for(const tile of tileQueue(requested)){if(visited++<offset)continue;yield tile;}}
   for(const tile of queue()){
    if(!current()||controller.signal.aborted||used>=Math.max(1,tileBudget,batchTiles?.length||0)||used>0&&Date.now()-started>maxDurationMs*.55){coverage.pendingRegions.push(tile);hasPending=true;break;}
    // While Overpass is cooling down, a tile is left for the next page instead of failing, so one slow
    // answer does not turn the rest of a drained search into failed regions.
    if(!retryFailed&&!tile.retry&&!tile.page&&servers.length&&Date.now()<overpassRetryAfter&&!(cache.get(tile.id)&&Date.now()-cache.get(tile.id).at<86400000)){coverage.pendingRegions.push(tile);hasPending=true;coverage.retryAfterMs=overpassRetryAfter-Date.now();break;}
    used++;if(!tile.retry&&!tile.page)nextOffset=visited;
    try{const data=await acquire(tile);if(!current())break;coverage.fetchedRegions.push({...tile,timestamp:data.timestamp,endpoint:data.endpoint,cached:!!data.cached,version:data.version,fallback:!!data.fallback});for(const f of data.features)merged.set(f.id,f);}
    catch(e){coverage.failedRegions.push({...tile,reason:String(e.message||e)});}
    onProgress({phase:'places',fetched:coverage.fetchedRegions.length,failed:coverage.failedRegions.length,points:0});
   }
   const attemptedIds=new Set([...coverage.fetchedRegions,...coverage.failedRegions].map(r=>r.id));for(const tile of retryTiles)if(!attemptedIds.has(tile.id))deferredRetries.push(tile);
   coverage.evaluatedRegionIds=coverage.fetchedRegions.map(r=>r.id);coverage.nextCursor=batchTiles?cursor.afterCursor||null:hasPending||retryFailed&&coverage.failedRegions.length?{offset:nextOffset,retryTiles:retryFailed?[...deferredRetries,...coverage.failedRegions]:[]}:null;
   coverage.osmComplete=requested.length>0&&!hasPending&&!coverage.failedRegions.length&&offset===0&&current()&&!timedOut;
   const selectionRegions=[];for(const r of requested)for(const tile of coverage.fetchedRegions){const b=[Math.max(r.bbox[0],tile.bbox[0]),Math.max(r.bbox[1],tile.bbox[1]),Math.min(r.bbox[2],tile.bbox[2]),Math.min(r.bbox[3],tile.bbox[3])];if(b[0]<b[2]&&b[1]<b[3])selectionRegions.push({...r,bbox:b});}
   const features=[...merged.values()],sampled=batchTiles&&coverage.failedRegions.length
    // A point offset is only valid for the same complete set of tiles.
    ?{rows:[],limited:true,omittedPoints:0,unknownGeometry:[]}
    :sampleFeatures(features,selectionRegions,{spacingM,maxPoints:Math.max(1,pointBudget),skipPoints:pointOffset,pointKinds:wanted});
   let points=sampled.rows;
   // Both the generation and page budgets count only eligible place kinds.
   const limited=sampled.limited;
   if(limited&&points.length)coverage.nextCursor={offset,pointOffset:pointOffset+points.length,batchTiles:coverage.fetchedRegions.map(r=>({id:r.id,bbox:r.bbox,regionId:r.regionId})),afterCursor:coverage.nextCursor};
   else if(batchTiles&&retryFailed&&coverage.failedRegions.length)coverage.nextCursor={...cursor};
   if(coverage.nextCursor)coverage.nextCursor={...coverage.nextCursor,pointKindsKey};
   coverage.samplingComplete=!limited;coverage.omittedPoints=sampled.omittedPoints;coverage.incompleteGeometry=sampled.unknownGeometry;
   coverage.pointsExcludedByKind=sampled.excludedPoints||0;coverage.featuresExcludedByKind=sampled.excludedFeatures||0;
   if(limited)coverage.missing.push('point-budget');if(hasPending)coverage.missing.push('tile-budget-or-timeout');if(sampled.unknownGeometry.length)coverage.missing.push('incomplete-osm-geometry');
   // A small documented viewpoint supplement is independent of OSM availability.
   // Add once at the beginning; continuation pages only advance dynamic geometry.
   coverage.documentedViewpoints=0;
   if(!cursor&&offset===0&&typeof loadViewpoints==='function'&&current()&&!controller.signal.aborted)try{const supplement=publishedViewpoints(await bounded(loadViewpoints(plan,{signal:controller.signal,isCurrent:current}),timeoutMs),requested);points.unshift(...supplement);
   coverage.documentedViewpoints=supplement.length;}catch{coverage.missing.push('documented-viewpoints-unavailable');}
   // Supplements are independent of the dynamic point cursor. Apply the same
   // requested kinds before their height/water reads too.
   if(wanted){
    const sampleCount=points.length;
    points=points.filter(p=>wanted.has(p.placeKind));
    coverage.pointsExcludedByKind+=sampleCount-points.length;
   }
   // Query ground only for the sampled surfaces. GSI failures and sea sentinels
   // stay null; tileElevations() is deliberately not used (it maps failures to 0).
   terrain.resetBudget?.();
   let index=0;
   await Promise.all(Array.from({length:Math.min(4,points.length)},async()=>{while(index<points.length&&current()&&!controller.signal.aborted){const p=points[index++],k=key(p);let g=heightCache.get(k)||null;
    try{if(!g&&typeof terrain.groundElevation==='function')g=await bounded(terrain.groundElevation(p.latitude,p.longitude,{withSource:true,fetchImpl:request}),timeoutMs+250);if(g&&finite(g.elevation)&&g.source&&g.source!=='海'){heightCache.set(k,g);
    if(heightCache.size>20000)heightCache.delete(heightCache.keys().next().value);}else g=null;}catch{g=null;}
    if(!current())break;if(g){p.groundM=g.elevation;p.groundKnown=true;p.surfaceElevationM=finite(p.surfaceAglM)?g.elevation+p.surfaceAglM:null;p.standingSurfaceKnown=p.structureClassificationKnown&&finite(p.surfaceAglM);p.sourceEvidence.ground={source:g.source,heightM:g.elevation,kind:'dem'};}
   }}));
   // Worldwide data remains usable as a coarse model, with its resolution
   // explicit. Missing GSI within Japan is not quietly replaced by coarse DEM.
   const world=points.filter(p=>!p.groundKnown&&typeof terrain.inJapan==='function'&&!terrain.inJapan(p.latitude,p.longitude));
   if(world.length&&current()&&!controller.signal.aborted&&typeof terrain.fetchElevations==='function')try{const h=await bounded(terrain.fetchElevations(world,{fetchImpl:request,timeoutMs}),timeoutMs+250);world.forEach((p,i)=>{if(finite(h[i])){p.groundM=h[i];p.groundKnown=true;
   p.surfaceElevationM=finite(p.surfaceAglM)?h[i]+p.surfaceAglM:null;p.standingSurfaceKnown=p.structureClassificationKnown&&finite(p.surfaceAglM);p.sourceEvidence.ground={source:'Open-Meteo Copernicus DEM',heightM:h[i],resolutionM:90,kind:'coarse-dem'};}});
   if(!credits.some(c=>c.name==='Open-Meteo'))credits.push({name:'Open-Meteo',url:'https://open-meteo.com/en/docs/elevation-api'});}catch{/* 通信できない時は粗い標高なしで続ける */}
   // Water polygons in OSM already remove obvious water points. GSI supplies
   // additional evidence; unknown tiles do not turn into land or a global veto.
   if(points.length&&current()&&!controller.signal.aborted&&typeof terrain.waterAt==='function')try{const water=await bounded(terrain.waterAt(points,{fetchImpl:request,useDem:false}),timeoutMs+250);
   points.forEach((p,i)=>{p.sourceEvidence.water=water[i]===true?'water':water[i]===false?'land':'unknown';if(water[i]===true&&!p.nonTerrainStructure){p.excludedReason='water';p.standingSurfaceKnown=false;}});}catch{points.forEach(p=>{p.sourceEvidence.water='unknown';});}
   const kept=points.filter(p=>p.excludedReason!=='water');coverage.heightComplete=kept.every(p=>p.groundKnown&&p.standingSurfaceKnown);coverage.unknownSurfacePoints=kept.filter(p=>!p.standingSurfaceKnown).length;
   if(coverage.unknownSurfacePoints)coverage.missing.push('standing-surface-height');if(timedOut)coverage.missing.push('time-budget');if(!current())coverage.missing.push('cancelled');
   coverage.status=coverage.osmComplete&&coverage.samplingComplete&&coverage.heightComplete&&!coverage.incompleteGeometry.length&&!coverage.missing.length?'loaded':'partial';
   const version='dynamic-places-v1/'+hash(JSON.stringify([coverage.fetchedRegions.map(r=>[r.id,r.version]),kept.map(p=>[key(p),p.surfaceId,p.groundM,p.surfaceHeightM]),coverage.missing]));
   onProgress({phase:'places',fetched:coverage.fetchedRegions.length,failed:coverage.failedRegions.length,points:kept.length,partial:coverage.status!=='loaded'});
   return {version,points:kept,features,coverage,partial:coverage.status!=='loaded',cancelled:!current(),credits:credits.slice(),continuation:coverage.nextCursor?{...coverage.nextCursor,regions:requested}:null,visibilityCertified:false};
  }finally{clearInterval(timer);signal?.removeEventListener('abort',cancel);controller.abort();}
 }
 // The surveyed places of the plan's target; none when the data cannot be read (the search goes on without them).
 async function surveyed(plan){if(typeof loadSurveyed!=='function'||!plan?.target?.id)return [];try{return surveyedViewpoints(await loadSurveyed(plan),plan.target.id);}catch{return [];}}
 async function nearby(seed,{isCurrent=()=>true,radiusM=600,refresh=false}={}){
  if(![seed?.latitude,seed?.longitude].every(finite)||!isCurrent())return null;
  const lat=Number(seed.latitude.toFixed(3)),lon=Number(seed.longitude.toFixed(3)),reach=Math.min(radiusM,250),id=lat+','+lon+','+reach,pad=(reach+80)/M;
  const domainKey=JSON.stringify([seed.latitude,seed.longitude,radiusM,seed.placeKind,seed.placeId,seed.surfaceId,seed.sourceId,seed.name]);
  if(refresh)nearbyCache.delete(id);
  const cached=nearbyCache.get(id);if(cached?.until>Date.now()&&cached.domains.has(domainKey))return cached.domains.get(domainKey);
  const dy=(radiusM+30)/M,dx=dy/Math.max(.1,Math.cos(seed.latitude*RAD));
  let features=[];
  if(places)try{features=parseElements(await places.elementsIn([seed.longitude-dx,seed.latitude-dy,seed.longitude+dx,seed.latitude+dy]));}catch{/* Try the bounded live map below. */}
  if(!isCurrent())return null;
  const local=movementDomain(seed,features,{radiusM});if(local)return local;
  // The bundled extract omits sidewalks outside candidate parks. Supplement only
  // on opening a missing movement domain, never on pan or with celestial/DEM work.
  const box=[lon-pad/Math.max(.1,Math.cos(lat*RAD)),lat-pad,lon+pad/Math.max(.1,Math.cos(lat*RAD)),lat+pad];
  let entry=nearbyCache.get(id);
  if(!entry||entry.until<Date.now()){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
   entry={until:Date.now()+3600000,promise:null,domains:new Map()};
   entry.promise=(async()=>{
    const res=await fetchImpl('https://api.openstreetmap.org/api/0.6/map.json?bbox='+box.join(','),{signal:controller.signal,priority:'low'});
    if(!res.ok)throw Error('movement-map-http-'+res.status);
    const text=await res.text();if(text.length>6000000)throw Error('movement-map-size');
    return parseElements(mapElements(JSON.parse(text)));
   })().catch(e=>{if(nearbyCache.get(id)===entry)nearbyCache.delete(id);throw e;}).finally(()=>clearTimeout(timer));
   nearbyCache.set(id,entry);while(nearbyCache.size>12)nearbyCache.delete(nearbyCache.keys().next().value);
  }
  const extra=await entry.promise;if(!isCurrent())return null;
  const merged=[...new Map([...features,...extra].map(f=>[f.sourceId,f])).values()];
  const domain=movementDomain(seed,merged,{radiusM:reach});if(domain){entry.domains.set(domainKey,domain);if(entry.domains.size>4)entry.domains.delete(entry.domains.keys().next().value);}return domain;
 }
 return {load,surveyed,nearby,clear(){cache.clear();heightCache.clear();nearbyCache.clear();}};
}
createPlaceProvider.parseElements=parseElements;
createPlaceProvider.movementDomain=movementDomain;createPlaceProvider.movementPoint=movementPoint;
return createPlaceProvider;
});

/* Generic candidate evaluation. Domain geometry and IO ports remain separate. */
(function(root){
'use strict';
const Model=root.AstroNotesCandidateModel||(typeof require==='function'?require('./model-evaluator.js'):null);
const Composition=root.AstroNotesCandidateComposition||(typeof require==='function'?require('./composition.js'):null);
const TowerQuality=Model.towerQuality||(typeof require==='function'?require('./tower-quality.js'):null);
const R=6371008.8,D=Math.PI/180;
function inside(r,p){let on=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>p[1])!==(r[j][1]>p[1])&&p[0]<(r[j][0]-r[i][0])*(p[1]-r[i][1])/(r[j][1]-r[i][1])+r[i][0])on=!on;return on;}
function angularDistance(a,b){const alt1=a[1]*D,alt2=b[1]*D,daz=(a[0]-b[0])*D;return Math.atan2(Math.hypot(Math.cos(alt2)*Math.sin(daz),Math.cos(alt1)*Math.sin(alt2)-Math.sin(alt1)*Math.cos(alt2)*Math.cos(daz)),Math.sin(alt1)*Math.sin(alt2)+Math.cos(alt1)*Math.cos(alt2)*Math.cos(daz))/D;}
function cameraAxis(plan,observer,state,geometry,align,halfX,halfY){
 const lens=plan.lens;if(lens.axis)return lens.axis;
 if(lens.viewModel!=='scene')return {azimuth:geometry.azimuth,altitude:geometry.angle};
 if(typeof align.viewWindow!=='function'||typeof align.viewUnprojector!=='function'||!(lens.aspect>0))return null;
 // Match framing/scene/render.js: its initial window centres the visible
 // target extent, and pan translates the sky under the fixed camera frame.
 const full=align.geometryFrom(observer,plan.target,{eyeM:observer.eyeM}),outline=plan.target.rim?null:align.towerOutline?.(observer,plan.target,{eyeM:observer.eyeM});
 if(!full)return null;
 const radius=state.angularRadius||0,topAngle=outline?.topAngle??full.angle,baseAngle=outline?.baseAngle??topAngle-5*Math.max(radius,.27),viewBase=outline?.viewBaseAngle??baseAngle;
 if(![topAngle,viewBase,full.azimuth].every(Number.isFinite))return null;
 const win=align.viewWindow({azimuth:full.azimuth,baseAngle:viewBase,topAngle,radiusDeg:radius,aspect:lens.aspect,include:state.apparentAltitude>=0&&Math.abs(state.apparentAltitude-topAngle)<=Math.max(topAngle-viewBase,5*radius)?[state.apparentAltitude]:[]});
 const halfH=Math.max(halfY,halfX/lens.aspect)*1.12,halfW=halfH*lens.aspect,pan=lens.pan||[0,0];
 if(![win?.az0,win?.alt0,pan[0],pan[1]].every(Number.isFinite))return null;
 const axis=align.viewUnprojector(win.az0,win.alt0)(-2*halfW*pan[0],2*halfH*pan[1]);
 return axis?.every(Number.isFinite)?{azimuth:axis[0],altitude:axis[1]}:null;
}
function lensCheck(plan,observer,state,geometry,align){
 const lens=plan.lens;if(!lens||lens.mode==='unspecified'||!Number.isFinite(lens.focal))return {status:'unspecified',fits:true};
 let w=lens.sensorWidth,h=lens.sensorHeight;if(!(w>0&&h>0&&lens.focal>0))return {status:'unknown',fits:lens.mode!=='required'};
 const crop=Number.isFinite(lens.crop)&&lens.crop>0?lens.crop:1;w/=crop;h/=crop;if(lens.portrait)[w,h]=[h,w];
 const halfX=w/(2*lens.focal)/D,halfY=h/(2*lens.focal)/D;
 // 'overlap' (the whole target, 2026-11-11): whether the whole target fits depends on the lens and on how one shoots — a
 // telephoto of the sun sitting on the Skytree's gain tower is the shot itself (ユーザー). So only the body and what it
 // overlaps have to fit. Where the whole target fits, the frame is the usual one (as before); where it does not, the
 // camera is on the body and overflow tells the first view to put its frame there.
 if(lens.targetExtent==='overlap'){
  const whole=lensCheck({...plan,lens:{...lens,targetExtent:'whole'}},observer,state,geometry,align);if(whole.fits)return {...whole,overflow:false};
  const r=Math.tan((state.angularRadius||0)*D)/D,fits=r<=Math.min(halfX,halfY);
  return {status:fits?'fits':'outside',fits,horizontalFov:2*Math.atan(w/(2*lens.focal))/D,verticalFov:2*Math.atan(h/(2*lens.focal))/D,targetKnown:true,axis:{azimuth:state.azimuth,altitude:state.apparentAltitude},overflow:true};
 }
 const axis=cameraAxis(plan,observer,state,geometry,align,halfX,halfY);
 if(!axis||![axis.azimuth,axis.altitude].every(Number.isFinite))return {status:'unknown',fits:lens.mode!=='required',reason:'camera-axis-unavailable'};
 const project=align.viewProjector(axis.azimuth,axis.altitude);
 const target=project(geometry.azimuth,geometry.angle),centre=project(state.azimuth,state.apparentAltitude);
 const outline=lens.targetExtent==='whole'?align.towerOutline?.(observer,plan.target,{eyeM:observer.eyeM}):null;
 const targetKnown=lens.targetExtent!=='whole'||!!(outline?.known&&!outline.schematic);
 const points=[target,centre];if(outline?.known&&!outline.schematic)for(const ring of outline.polygons||[outline.hitPoints||outline.points||[]])for(const p of ring)points.push(project(p[0],p[1]));
 const r=Math.tan((state.angularRadius||0)*D)/D;
 const fits=points.every(p=>p&&Math.abs(p[0])<=halfX&&Math.abs(p[1])<=halfY)&&centre&&Math.abs(centre[0])+r<=halfX&&Math.abs(centre[1])+r<=halfY;
 return {status:!targetKnown?'unknown':fits?'fits':'outside',fits:!!fits&&(targetKnown||lens.mode!=='required'),horizontalFov:2*Math.atan(w/(2*lens.focal))/D,verticalFov:2*Math.atan(h/(2*lens.focal))/D,targetKnown,axis};
}
function photographability(body,state,sunAltitude){
 if(!Number.isFinite(state.apparentAltitude)||state.apparentAltitude+(state.angularRadius||0)<=0)return 'unfavorable';
 if(body==='sun')return 'normal';
 if(body==='moon')return sunAltitude>=0?'conditional':'normal';
 // Daylight is retained as a conditional opportunity, never a blanket rejection (e.g. Venus).
 return sunAltitude>=-6?'conditional':sunAltitude<-12?'normal':'conditional';
}
// No ground in Japan stands above Mt Fuji (3776 m); a ray above this has no terrain left to meet.
const TERRAIN_CEILING_M=3800;
function skyRange(eye,altitude,k){
 // A computational horizon for the DEM model, not a proof of absent buildings.
 const effectiveR=R*k,alpha=altitude*D,height=d=>{const t=d/effectiveR,den=Math.cos(t)-Math.tan(alpha)*Math.sin(t);return den>0?(effectiveR+eye)/den-effectiveR:Infinity;};
 let lo=Math.max(0,-alpha*effectiveR),hi=Math.max(1000,lo+1000);while(height(hi)<TERRAIN_CEILING_M&&hi<Math.PI*effectiveR/2)hi*=2;
 for(let i=0;i<40;i++){const mid=(lo+hi)/2;if(height(mid)<TERRAIN_CEILING_M)lo=mid;else hi=mid;}
 return Math.max(1000,hi);
}
function standingMetadata(position,data,seed){
 const features=data?.features;if(!Array.isArray(features))return false;
 const contains=f=>(f.polygons||[]).some(poly=>poly[0]?.length>=4&&inside(poly[0],[position.longitude,position.latitude])&&!poly.slice(1).some(r=>inside(r,[position.longitude,position.latitude])));
 const inBounds=b=>position.longitude>=b[0]&&position.longitude<=b[2]&&position.latitude>=b[1]&&position.latitude<=b[3];
 // A way can extend far beyond the requested tile. Its geometry alone does
 // not carry the area's restrictions/structures outside the fetched region.
 if(data.coverage?.fetchedRegions&&!data.coverage.fetchedRegions.some(r=>inBounds(r.bbox)))return false;
 const source=features.find(f=>f.sourceId===seed.sourceId||f.id===seed.polygonId),areas=features.filter(contains),forbidden=t=>['no','private'].includes(t?.access)||['no','private'].includes(t?.foot);
 const raised=(t,ignoreLayer=false)=>t&&(t.location==='roof'||t.location==='rooftop'||t.location==='underground'||t.indoor==='yes'||t.bridge&&t.bridge!=='no'||t.tunnel&&t.tunnel!=='no'||t.covered==='yes'
  ||t.level!=null&&Number(t.level)!==0||!ignoreLayer&&t.layer!=null&&Number(t.layer)!==0);
 // Match place-provider's parent-only rule; the walking source keeps its own layer.
 const raisedArea=f=>raised(f.tags,f.kind==='park'&&!f.walking&&!f.building&&!f.tags?.highway&&!f.tags?.['area:highway']&&f.polygons?.length>0);
 if(!source&&seed.sourceEvidence?.kind!=='PLATEAU-pedestrian-surface')return false;
 if(forbidden(source?.tags)||areas.some(f=>forbidden(f.tags)))return false;
 const knownRaised=seed.nonTerrainStructure&&seed.standingSurfaceKnown&&[seed.surfaceAglM,seed.surfaceHeightM,seed.surfaceElevationM].some(Number.isFinite);
 if(areas.some(f=>f.water)&&!knownRaised)return false;
 if((raised(source?.tags)||areas.some(raisedArea))&&!knownRaised)return false;
 const containingBuilding=areas.find(f=>f.building);
 if(containingBuilding&&(!knownRaised||seed.sourceEvidence?.buildingContaining!==containingBuilding.id))return false;
 const viewpoint=areas.find(f=>f.kind==='viewpoint'),square=areas.find(f=>f.kind==='plaza'),river=areas.find(f=>/河川敷|川.*テラス|川緑道|riverbank|riverside/i.test(f.name)),park=areas.find(f=>f.kind==='park');
 if(viewpoint&&!knownRaised)return false;
 const walkSquare=source?.walking&&(source.tags?.area==='yes'||source.tags?.['area:highway']);
 const area=viewpoint||square||park||river,placeKind=viewpoint?'viewpoint':square||walkSquare?'plaza':park?'park':river?'riverbank':'road';
 const name=area?.name||source?.name||({viewpoint:'展望地点',plaza:'歩行広場',riverbank:'河川沿いの歩道',park:'公園の園路',road:'歩道の撮影候補'}[placeKind]);
 return {placeKind,name,placeId:area?.sourceId||source?.sourceId||seed.placeId,accessKnown:!![source,...areas].find(f=>['yes','public','permissive','designated'].includes(f?.tags?.foot)||['yes','public','permissive'].includes(f?.tags?.access)),
  sourceEvidence:{...seed.sourceEvidence,placeOsmId:area?.id||source?.id||null,areaTags:area?.tags||null,classification:area?'mapped-area-at-resolved-position':'walkway-at-resolved-position',resolvedPositionAreaChecked:true,actualVisibilityGuaranteed:false}};
}
// One point evaluation builds the same target outline (every model vertex projected from the observer) in the solver,
// the line-of-sight check and the frame check; on a phone that was about a quarter of the search (2026-11-11). Keep the
// last outlines for a few seconds, keyed by everything the outline depends on (a later model registration changes the
// model key). Callers only read the outline.
function memoOutlines(align){
 if(!align?.towerOutline||align.__memoOutlines)return align;
 const memo=new Map(),models=()=>globalThis.AstroNotesCityModels||null,ids=new WeakMap();let nextId=0;
 const modelKey=target=>{const m=models()?.[target?.id];if(!m)return 0;if(!ids.has(m))ids.set(m,++nextId);return ids.get(m);};
 const towerOutline=(observer,target,options={})=>{
  const key=JSON.stringify([observer?.latitude,observer?.longitude,observer?.elevation,observer?.eyeM,target?.id,target?.latitude,target?.longitude,target?.groundM,target?.parts,target?.heightM,options,modelKey(target),!!globalThis.AstroNotesTowerModels,!!globalThis.AstroNotesCityModels]),
  now=Date.now(),hit=memo.get(key);
  if(hit&&now-hit.at<3000){memo.delete(key);memo.set(key,hit);return hit.value;}
  const value=align.towerOutline(observer,target,options);memo.set(key,{at:now,value});while(memo.size>32)memo.delete(memo.keys().next().value);return value;
 };
 return Object.assign(Object.create(align),{towerOutline,__memoOutlines:true});
}
function createGeneric({align:rawAlign,bodies,geo,terrain,index=null,heights=null,trees=null,staticTerrain=null,sidewalks=null,angularPrefilter=false,yieldTask=typeof AstroNotesLibrary==='object'&&AstroNotesLibrary.pause||(()=>new Promise(r=>setTimeout(r,0)))}={}){
 const align=memoOutlines(rawAlign);
 const visibilityCache=new Map(),targetLines=new Map();
 const upperQuality=async(observer,target,options)=>{
  const k=root.AstroNotesAtmosphere?.targetK?.()??7/6,weather=weatherKey();
  const result=await (TowerQuality?.check(observer,target,{...options,align,terrain,heights,trees,yieldTask,refractionK:k})
   ||Promise.resolve({status:['skytree','tokyotower'].includes(target?.id)?'unknown':'not-applicable',reason:'upper-model-unavailable'}));
  return result.status==='model-clear'&&(k!==(root.AstroNotesAtmosphere?.targetK?.()??7/6)||weather!==weatherKey())?{status:'unknown',reason:'upper-atmosphere-changed'}:result;
 };
 let ridgeScope=null;
 const ridgeContextFor=(key,current)=>{
  if(typeof Composition.createRidgeContext!=='function'||typeof key!=='string'||!key)return null;
  if(!ridgeScope||ridgeScope.key!==key){ridgeScope?.context.retire();ridgeScope={key,context:Composition.createRidgeContext()};}
  return ridgeScope.context.forOwner(current);
 };
 // Only the current point evaluation owns these reads. Its precheck and event
 // check may share a confirmed endpoint ray, never a sky ray or an unknown read.
 // Endpoint readers derive altitude from endpoint height; the supplied altitude
 // is immaterial there. Bearing, foot height, model and weather still must match.
 async function targetRead(kind,observer,ray,options,read,usable){
  const memo=options.targetReads,end=ray.endpoint;
  if(!memo||!end||![end.latitude,end.longitude,end.elevation,ray.maxM].every(Number.isFinite))return read();
  const key=JSON.stringify([kind,observer.latitude,observer.longitude,observer.elevation,observer.eyeM??1.5,end.latitude,end.longitude,end.elevation,
   ray.azimuth,ray.maxM,ray.refractionK,ray.targetKey,kind==='trees'?ray.footM:null,!!options.skipTrees,!!options.preview,weatherKey()]);
  const city=root.AstroNotesCityModels?.[ray.targetKey],towers=root.AstroNotesTowerModels,hit=memo.get(key);
  if(hit&&hit.city===city&&hit.towers===towers)return hit.value;
  const value=await read();
  if(options.isCurrent?.()!==false&&usable(value)&&city===root.AstroNotesCityModels?.[ray.targetKey]&&towers===root.AstroNotesTowerModels)memo.set(key,{city,towers,value});
  return value;
 }
 const heightTrace=(observer,ray,options)=>targetRead('buildings',observer,ray,options,
  ()=>heights.trace(observer,ray,{isCurrent:options.isCurrent,skipTrees:!!options.skipTrees}),r=>r?.status==='clear'&&!r.partial);
 // Whether the place was surveyed as seeing this target (and not merely some other one).
 const surveyedFor=(place,target)=>!!target?.id&&Array.isArray(place?.surveyedTargets)&&place.surveyedTargets.includes(target.id);
 // What hides the lower part of the target on its line (2026-11-12, user: name it, not a distance).
 const hiddenNotes=new WeakMap(),TOWN_M=500;
 function hiddenNote(target,observer,azimuth,sky,built,tree){
  // Buildings or trees higher on the target than the ground in front (2026-11-13): named as such, from the same line.
  // Buildings far in front are a townscape, not a building (2026-11-15, user: 22 km from 東京スカイツリー the words
  // 「手前の建物」 did not fit the skyline that hides its foot); TOWN_M and nearer it is still the building in front.
  const front=[[Number.isFinite(built?.distanceM)&&built.distanceM>=TOWN_M?'街並み':'建物',built],['木',tree]].filter(([,s])=>Number.isFinite(s?.toM)).sort((a,b)=>b[1].toM-a[1].toM)[0];
  if(front&&!(front[1].toM<=(sky?.toM??-Infinity))&&typeof align.hiddenBelowText==='function'){
   const [kind,{toM}]=front,text=align.hiddenBelowText(target,toM,kind);return Promise.resolve(text?{m:toM,kind,text,label:'手前の'+kind}:null);
  }
  if(!sky||typeof align.hiddenBelowText!=='function'||typeof geo?.obstacleKind!=='function')return null;
  if(!hiddenNotes.has(sky))hiddenNotes.set(sky,(async()=>{
   if(!align.hiddenBelowText(target,sky.toM,'高台'))return null;
   const kind=await geo.obstacleKind(observer,azimuth,sky,observer.elevation+observer.eyeM),text=kind?align.hiddenBelowText(target,sky.toM,kind):'';
   return text?{m:sky.toM,kind,text,label:kind==='地球の丸み'?kind:'手前の'+kind}:null;
  })().catch(()=>null));
  return hiddenNotes.get(sky);
 }
 // How high up the target the ground or the buildings in front hide it, whichever is higher.
 const hiddenTop=(...lines)=>Math.max(...lines.map(s=>s?.toM??-Infinity));
 // A place that sees none of the target's named parts over what is in front is no candidate (2026-11-13, user's
 // choice: 東京タワー needs the top of its トップデッキ in sight). A target named by its tip alone keeps the tip rule.
 function partsHidden(target,m){
  const tops=(target?.parts||[]).map(p=>p.m).filter(Number.isFinite).sort((a,b)=>b-a);return tops.length>1&&Number.isFinite(m)&&m>=tops[1];
 }
 const skylineOf=async(observer,ray,options)=>{
  if(!heights?.skyline||!ray.endpoint)return null;
  const s=await targetRead('skyline',observer,ray,options,()=>heights.skyline(observer,ray,{isCurrent:options.isCurrent,preview:options.preview}).catch(e=>{if(e?.message==='candidate-cancelled')throw e;return null;}),r=>r?.status==='ok'&&r.complete);
  return s?.status==='ok'?s:null;
 };
 // Tree tops on the line (tree-heights.js). Unread (offline, the map's server) leaves trees as before: OSM woods only.
 const treesOf=async(observer,ray,options)=>trees?targetRead('trees',observer,ray,options,()=>trees.sight(observer,ray,{isCurrent:options.isCurrent}),r=>r?.status==='clear'):null;
 // How the place frames the target (2026-11-13, user's choice for the order: 対象がよく見える・高い所・見晴らし・
 // 背景がすっきり; the size beside the body was dropped on 2026-11-14, "月との比率はいらないよ"): how much of the target shows
 // over what is in front, how far the place stands above the ground around it, and how many bearings beside the target
 // have other buildings rising into the sky above the target's hidden line (a window of three body diameters).
 async function compositionOf(plan,position,solution,state,los,options){
  const t=plan.target,groundT=Number.isFinite(t.groundM)?t.groundM:0,tops=(t.parts||[]).map(p=>p.m).filter(Number.isFinite);if(!tops.length)return null;
  const top=Math.max(...tops),eye=position.elevation+position.eyeM,Dm=solution.geometry.distanceKm*1000,c=1/(2*R*(root.AstroNotesAtmosphere?.targetK?.()??7/6));
  const angleTo=h=>Math.atan2(h-eye-c*Dm*Dm,Dm)/D,hidden=Math.min(top,Math.max(groundT,hiddenTop(los.target?.terrain?.skyline,los.target?.buildings?.skyline,los.target?.buildings?.treeSkyline)));
  const body=2*(state.angularRadius||0);
  let gain=null;
  if(terrain?.at){const hs=[];for(let k=0;k<8;k++){const q=geo.destination(position.latitude,position.longitude,k*45,.2),h=await terrain.at(q,options).catch(e=>{if(e?.message==='candidate-cancelled')throw e;return null;});if(Number.isFinite(h))hs.push(h);}
   if(hs.length>=4){hs.sort((a,b)=>a-b);gain=position.elevation-hs[Math.floor(hs.length/2)];}}
  let clean=null;
  if(heights?.angles){const halfW=Math.max(3*body,2*Math.atan2((t.widthM||40)/2,Dm)/D,.5),az=solution.geometry.azimuth,floor=angleTo(hidden)+.05;
   const seen=await heights.angles(position,[-1,-.75,-.5,-.3,.3,.5,.75,1].map(f=>(az+f*halfW+360)%360),Dm+3000,{targetKey:t.id,isCurrent:options.isCurrent});
   if(seen)clean=seen.filter(a=>!(a>floor)).length/seen.length;}
  return {visibleFraction:Math.max(0,Math.min(1,(top-hidden)/Math.max(1,top-groundT))),heightGainM:gain,cleanSky:clean};
 }
 async function terrainRay(observer,ray,options){
  // The archived raster still traces the supplied altitude, even with an
  // endpoint. Recheck it for every ray before sharing only the native fallback.
  if(staticTerrain){const tested=staticTerrain.trace(observer,ray);if(tested.hit||tested.checked>0&&tested.missing===0)return {...tested,status:tested.hit?'blocked':'model-clear',nativeRaster:true};}
  return targetRead('terrain',observer,ray,options,
   ()=>terrain?terrain.trace(observer,{...ray,...options}):{status:'unknown',reason:'terrain-unavailable',missing:1},r=>r?.status==='model-clear'&&!r.missing&&!r.partial);
 }
 async function buildingRay(observer,ray,options={}){
  if(!trees)return buildingsOnly(observer,ray,options,false);
  // Buildings first (local data): a line they stop needs no trees. Unread trees: OSM woods judge as before.
  const first=await buildingsOnly(observer,ray,options,true);if(first.status==='blocked')return first;
  const t=await treesOf(observer,ray,options);
  if(t.status==='unread')return {...await buildingsOnly(observer,ray,options,false),trees:t};
  const b=first;
  const status=b.status==='blocked'||t.status==='blocked'?'blocked':b.status==='model-clear'&&t.status==='unknown'?'unknown':b.status;
  const byTrees=t.status==='blocked'&&b.status!=='blocked'||t.status==='unknown'&&b.status==='model-clear';
  return {...b,status,trees:t,treeSkyline:t.skyline||null,...(byTrees?{reason:'trees',hit:t.hit}:{})};
 }
 async function buildingsOnly(observer,ray,options,skipTrees){
  // Building tops along the whole line (PLATEAU heights, GSI footprints elsewhere). Unknown is never clear.
  if(heights){const r=await heightTrace(observer,ray,{...options,skipTrees}),skyline=r.status==='blocked'?null:await skylineOf(observer,ray,options);
   return {...r,skyline,status:r.status==='clear'?'model-clear':r.status,complete:r.status!=='unknown',evaluated:r.status!=='unknown',unresolvedTargetContacts:false};}
  if(!index)return {status:'unknown',complete:false};
  const end=ray.endpoint||geo.destination(observer.latitude,observer.longitude,ray.azimuth,ray.maxM/1000);
  const coverage=Model.covers(index,observer,end),result=Model.trace(index,observer,ray);
  const evaluated=Number.isFinite(result.faces)&&Number.isFinite(result.buildingsChecked),contacts=result.targetContacts||[];
  const permitted=new Set(index.targetAssociations?.[ray.targetKey]?.targetSurfacePolygonIds||[]);
  // A catalogue association identifies a target complex, not the particular
  // visible surface. Only a documented terminal surface may be a target hit;
  // an unresolved earlier contact stays unknown. Sky rays hit opaque targets.
  const unresolvedTargetContacts=!!ray.endpoint&&contacts.some(c=>!permitted.has(c.polygonId)||!Number.isFinite(c.distanceM)||Math.abs(c.distanceM-ray.maxM)>.1);
  const selfBlocked=!ray.endpoint&&contacts.length>0;
  return {...result,complete:coverage.complete,evaluated,unresolvedTargetContacts,status:result.hit||selfBlocked?'blocked':coverage.complete&&evaluated&&!unresolvedTargetContacts?'model-clear':'unknown'};
 }
 // The composition draws its ground line from the same line and the same ground as the search (2026-11-13,
 // user: one ground line where the building stands), so the list and the figure give one number.
 async function hiddenView(observer,target,{partId=null,isCurrent,refractionK=root.AstroNotesAtmosphere?.targetK?.()??7/6}={}){
  const obs={...observer,eyeM:observer.eyeM??1.5},g=align.geometryFrom(obs,target,{eyeM:obs.eyeM,partId:partId==='__whole'?null:partId});
  if(!g||![g.azimuth,g.angle,g.topM,g.distanceKm].every(Number.isFinite))return null;
  const ray={azimuth:g.azimuth,altitude:g.angle,maxM:g.distanceKm*1000,endpoint:{...target,elevation:g.topM},footM:target.groundM,targetKey:target.id,refractionK};
  // These three readers use separate terrain, building and canopy budgets.
  const [tg,built,tr]=await Promise.all([
   terrainRay(obs,ray,{isCurrent}),
   skylineOf(obs,ray,{isCurrent,preview:true}),
   treesOf(obs,ray,{isCurrent}),
  ]);
  const tree=tr?.skyline||null;
  const complete=!!tg?.skyline&&!tg.missing&&!!built?.complete&&tr?.status!=='unread';
  if(!tg?.skyline)return {status:tg?.status||'unknown',read:false,complete,note:built||tree?await hiddenNote(target,obs,g.azimuth,null,built,tree):null};
  return {status:tg.status,read:true,complete,note:await hiddenNote(target,obs,g.azimuth,tg.skyline,built,tree)};
 }
 // Standalone preview reader, so the outline can appear before the terrain archive is ready.
 async function skylineView(observer,target,azimuths,{isCurrent,refractionK=root.AstroNotesAtmosphere?.targetK?.()??7/6}={}){
  const obs={...observer,eyeM:observer.eyeM??1.5},g=align.geometryFrom(obs,target,{eyeM:obs.eyeM});
  if(!heights?.frontage||!g||!(g.distanceKm>0)||!Array.isArray(azimuths)||!azimuths.length)return null;
  return heights.frontage(obs,azimuths,g.distanceKm*1000,{targetKey:target.id,isCurrent,refractionK}).catch(e=>{
   if(e?.message==='candidate-cancelled')throw e;
   return null;
  });
 }
 const weatherKey=()=>root.AstroNotesAtmosphere?.dataKey?.()??null;
 async function visibility(plan,solution,options={},eventSky){
  const obs=solution.observer,g=solution.geometry,at=solution.event.at,eye={...obs,elevation:obs.elevation+obs.eyeM};
  const weather=weatherKey();
  // Terrain tracing can yield while new atmosphere data are installed.
  const state=eventSky?.weather===weather?eventSky.state:bodies.state(plan.body,at,eye);
  if(eventSky&&eventSky.weather!==weather){eventSky.weather=weather;eventSky.state=state;}
  const target=solution.anchor||plan.target,distance=g.distanceKm*1000,k=root.AstroNotesAtmosphere?.targetK?.()??7/6;
  const stateKey=[state.azimuth,state.apparentAltitude,state.angularRadius,state.upperAltitude,state.lowerAltitude];
  const cacheKey=JSON.stringify([obs,at,plan.body,plan.target,plan.partId,target,g,plan.atmosphere,weather,stateKey,k]);
  if(visibilityCache.has(cacheKey))return visibilityCache.get(cacheKey);
  const targetRay={azimuth:g.azimuth,altitude:g.angle,maxM:distance,endpoint:{...target,elevation:g.topM},footM:target.groundM,targetKey:plan.target.id,refractionK:k};
  // Events of one point share their line to the target's anchor; it decides before any sky line can.
  const lineKey=JSON.stringify([obs.latitude,obs.longitude,obs.elevation,obs.eyeM,targetRay.endpoint.latitude,targetRay.endpoint.longitude,targetRay.endpoint.elevation,distance,k,plan.target.id]);
  let line=targetLines.get(lineKey);
  // A surveyed place (place-provider.js): the survey stands for its sight line to the target, so buildings and trees are
  // not asked (an observation room's own walls would stop it); the ground still is, for the body beside the target.
  const surveyed=surveyedFor(obs,plan.target);
  if(!line&&surveyed){line={tg:await terrainRay(obs,targetRay,options),tb:{status:'surveyed'}};targetLines.set(lineKey,line);}
  if(!line){const tb=await buildingRay(obs,targetRay,options),tg=tb.status==='blocked'?{status:'not-needed'}:await terrainRay(obs,targetRay,options);line={tg,tb};targetLines.set(lineKey,line);while(targetLines.size>400)targetLines.delete(targetLines.keys().next().value);}
  const {tg,tb}=line;
  if(!surveyed&&(tg.hit||tb.status==='blocked'))return {status:'blocked',target:{terrain:tg,buildings:tb},reason:'target-obstructed'};
  // An unconfirmed line to the target cannot make the event confirmed, whatever the sky lines show.
  if(!surveyed&&(tg.status!=='model-clear'||tb.status!=='model-clear'))return {status:'unknown',target:{terrain:tg,buildings:tb},rays:[],reason:'target-line-unconfirmed',treesModeled:false,actualVisibilityGuaranteed:false};
  const outline=align.towerOutline?.(obs,plan.target,{eyeM:obs.eyeM}),outlineAvailable=!!(outline?.known&&!outline.schematic),polygons=outline?.polygons||[outline?.hitPoints||outline?.points||[]];
  const projection=align.viewProjector(state.azimuth,state.apparentAltitude),unproject=align.viewUnprojector(state.azimuth,state.apparentAltitude);
  const projected=outlineAvailable?polygons.filter(r=>r.length>=3).map(r=>r.map(p=>projection(p[0],p[1]))).filter(r=>r.every(p=>p?.every(Number.isFinite))):[],knownOutline=outlineAvailable&&projected.length>0||!!plan.target.rim;
  // A mountain's shape is the terrain model itself: a ray it blocks is blocked, one it clears is clear.
  // The upper sample needs a shorter terrain line near the horizon. Read it before the centre, which can spend the
  // whole tile budget without finishing (渋谷スカイ, 2026-11-24). Keep all nine samples and their individual outcomes;
  // an unfinished line stays unknown, even when a different sample is confirmed clear.
  const radius=state.angularRadius||0,disc=radius>0,offsets=disc?[[0,.9],[0,0],[0,-.9],[.9,0],[-.9,0],[.6364,.6364],[-.6364,.6364],[.6364,-.6364],[-.6364,-.6364]]:[[0,0]],rays=[];
  for(const [x,y]of offsets){
   if(options.isCurrent?.()===false)throw Error('candidate-cancelled');
   const rx=Math.tan(radius*D)/D,ry=Math.tan((y>=0?(state.upperAltitude??state.apparentAltitude+radius)-state.apparentAltitude:state.apparentAltitude-(state.lowerAltitude??state.apparentAltitude-radius))*D)/D;
   const angular=unproject(x*rx,y*ry),inTarget=projected.some(r=>inside(r,[x*rx,y*ry]));
   if(inTarget){rays.push({status:'blocked',intentionalTarget:true});continue;}
   const ray={azimuth:angular[0],altitude:angular[1],maxM:Math.max(distance,skyRange(eye.elevation,angular[1],k)),refractionK:k,targetKey:plan.target.id};
   const ground=await terrainRay(obs,ray,options),building=ground.hit?{status:'not-needed'}:surveyed?{status:'model-clear',surveyed:true}:await buildingRay(obs,ray,options);
   rays.push({status:ground.hit||building.status==='blocked'?'blocked':ground.status==='model-clear'&&building.status==='model-clear'&&knownOutline?'model-clear':'unknown',terrain:ground,buildings:building,rangeM:ray.maxM});
   await yieldTask();
  }
  const clear=rays.filter(r=>r.status==='model-clear').length,unknown=rays.filter(r=>r.status==='unknown').length;
  const result={status:!clear&&!unknown?'blocked':(surveyed||tg.status==='model-clear'&&tb.status==='model-clear')&&clear?'model-clear':'unknown',surveyed,
   target:{terrain:tg,buildings:tb},rays,visibleSamples:clear,unknownSamples:unknown,totalSamples:rays.length,shapeKnown:knownOutline,treesModeled:false,actualVisibilityGuaranteed:false,datumUncertainty:true};
  if(result.status!=='unknown')visibilityCache.set(cacheKey,result);while(visibilityCache.size>150)visibilityCache.delete(visibilityCache.keys().next().value);
  return result;
 }
 async function evaluate(plan,point,data,options={}){
  options={...options,targetReads:new Map(),upperReads:new Map()};
  const ridgeContext=options.isCurrent?.()===false?null:ridgeContextFor(plan.requestKey,options.isCurrent);
  if(point.access==='no'||point.access==='private')return {status:'excluded',recommend:false,reason:'access-restricted'};
  if(point.standingSurfaceKnown!==true||point.nonTerrainStructure&&![point.surfaceElevationM,point.surfaceAglM,point.surfaceHeightM].some(Number.isFinite))return {status:'unknown',recommend:false,reason:'standing-height-unknown'};
  const ground=Number.isFinite(point.groundM)?point.groundM:await terrain?.at(point,options);
  if(!Number.isFinite(ground))return {status:'unknown',recommend:false,reason:'standing-height-unknown'};
  const floor=Number.isFinite(point.surfaceElevationM)?point.surfaceElevationM:ground+(point.surfaceAglM??point.surfaceHeightM??0),eyeM=Number.isFinite(point.eyeM)?point.eyeM:1.5;
  let obs={...point,elevation:floor,eyeM};
  const fixedStanding=!!point.nonTerrainStructure||Number.isFinite(point.surfaceElevationM)||Number.isFinite(point.standingElevationM);
  // A movable point may match after the existing move up a bank, even when its seed misses.
  if(angularPrefilter&&fixedStanding){
   if(options.isCurrent?.()===false||options.signal?.aborted)throw Error('candidate-cancelled');
   if(Composition.definiteAngularMiss(plan,obs,{align,bodies}))return {status:'no-overlap',recommend:false,reason:'angular-prefilter'};
  }
  // Resolve a matching time and frame before the upper-width data reads. Every
  // surviving solution, including a surveyed observer, is checked below.
  const missingHeights=b=>['building-height-unknown','height-data-unavailable','footprints-unavailable','footprint-ground-unknown'].includes(b?.reason);
  // Where the observer cannot move (no composition, not a mountain), every event's line ends on the
  // target's axis at or below its top, so a line to the top that buildings stop rules out every time
  // of day. Checking it first spares the event search for most points in a dense city.
  // A ground point a few metres down a slope or levee is often hidden by the rise in front of it, while
  // the top of the rise, in the same park or riverbank, sees the target. Such a point is moved up onto
  // the rise (at most three steps) and judged there, at the position it is then shown at.
  if(heights&&!surveyedFor(point,plan.target)&&!(plan.composition||plan.strict||plan.profile==='summit-contact'||plan.target.rim)){
   const top=Math.max(...(plan.target.parts||[]).map(p=>p.m).filter(Number.isFinite)),k=root.AstroNotesAtmosphere?.targetK?.()??7/6;
   for(let step=0;Number.isFinite(top);step++){
    if(options.isCurrent?.()===false)throw Error('candidate-cancelled');
    const inv=geo.inverse(obs.latitude,obs.longitude,plan.target.latitude,plan.target.longitude);if(!(inv.km>0))break;
    const line={azimuth:inv.azimuth,altitude:0,maxM:inv.km*1000,endpoint:{latitude:plan.target.latitude,longitude:plan.target.longitude,elevation:top},footM:plan.target.groundM,targetKey:plan.target.id,refractionK:k};
    // Buildings and terrain first (local data); the trees' walk only for a line they leave open.
    const lineUnverified=pre=>({status:'unverified',recommend:false,heightUnknown:missingHeights(pre),nearBuilding:pre.reason==='near-building',obstacle:['trees','elevated-structure'].includes(pre.reason),reason:'target-line-unverified',partial:true});
    const pre=await heightTrace(obs,line,{...options,skipTrees:!!trees});
    if(pre.status==='blocked')return {status:'model-blocked',recommend:false,reason:'target-line-blocked',partial:true};
    if(pre.status!=='clear')return lineUnverified(pre);
    const land=await terrainRay(obs,line,options);
    if(!land.hit){
     const built=await skylineOf(obs,line,options),partsGone={status:'model-blocked',recommend:false,reason:'target-parts-hidden',partial:true};
     if(partsHidden(plan.target,hiddenTop(land.skyline,built)))return partsGone;
     const tr=await treesOf(obs,line,options);
     if(tr?.status==='blocked')return {status:'model-blocked',recommend:false,reason:'target-line-trees',partial:true};
     if(tr?.status==='unknown')return {status:'unverified',recommend:false,obstacle:true,reason:'target-line-unverified',partial:true};
     if(tr?.status==='unread'){const osm=await heightTrace(obs,line,options);if(osm.status==='blocked')return {status:'model-blocked',recommend:false,reason:'target-line-blocked',partial:true};if(osm.status!=='clear')return lineUnverified(osm);}
     if(partsHidden(plan.target,hiddenTop(land.skyline,built,tr?.skyline)))return partsGone;
     break;
    }
    const d=land.hit.distanceM,movable=Number.isFinite(d)&&d<=60&&step<3&&!obs.nonTerrainStructure&&!fixedStanding;
    // The highest ground on the first 60 m towards the target: the top of the bank in front.
    let up=null,ground=-Infinity;if(movable&&terrain?.at)for(let m=3;m<=60;m+=3){const q=geo.destination(obs.latitude,obs.longitude,inv.azimuth,m/1000),h=await terrain.at(q,options);if(Number.isFinite(h)&&h>ground+.05){ground=h;up=q;}}
    const meta=up&&ground>obs.elevation+.3?standingMetadata({...up,elevation:ground},data,point):false;
    if(!meta)return {status:'model-blocked',recommend:false,reason:'target-line-terrain',partial:true};
    // The step stays in the same park or riverbank, which keeps the point's kind and name.
    obs={...obs,...meta,placeKind:point.placeKind,name:point.name||meta.name,latitude:up.latitude,longitude:up.longitude,groundM:ground,elevation:ground,surfaceAglM:0,surfaceHeightM:0,surfaceId:(point.surfaceId||'ground')+':up'+(step+1),movedUpFrom:{latitude:point.latitude,longitude:point.longitude,
    elevation:floor}};
   }
  }
  const solved=await Composition.opportunities(plan,obs,{align,bodies,terrain,sidewalks,groundAt:p=>terrain?.at(p,options),standingAt:p=>standingMetadata(p,data,point),isCurrent:options.isCurrent,yieldTask,ridgeContext});
  const accepted=[];let blocked=0,outside=0,unverified=0,heightUnknown=0,lastUnverified=null;
  for(const solution of solved.solutions||[]){
   if(options.isCurrent?.()===false)throw Error('candidate-cancelled');
   const weather=weatherKey(),state=bodies.state(plan.body,solution.event.at,{...solution.observer,elevation:solution.observer.elevation+solution.observer.eyeM}),eventSky={weather,state};
   const frame=plan.overlapAnchor?lensCheck({...plan,target:plan.overlapAnchor.target,partId:plan.overlapAnchor.partId},solution.observer,state,align.geometryFrom(solution.observer,plan.overlapAnchor.target,{eyeM:solution.observer.eyeM})||solution.geometry,align):lensCheck(plan,solution.observer,
   state,solution.geometry,align);if(!frame.fits){outside++;continue;}
   const upper=await upperQuality(solution.observer,plan.target,options);
   if(!['model-clear','not-applicable'].includes(upper.status)){
    if(upper.status==='blocked')blocked++;else{unverified++;lastUnverified={upperQuality:upper};}
    continue;
   }
   const los=await visibility(plan,solution,options,eventSky);if(los.status==='blocked'){blocked++;continue;}
   if(!los.surveyed&&partsHidden(plan.target,hiddenTop(los.target?.terrain?.skyline,los.target?.buildings?.skyline,los.target?.buildings?.treeSkyline))){blocked++;continue;}
   const at=solution.event.at,position=solution.observer,finalGround=Number.isFinite(position.groundM)?position.groundM:ground;
   const sun=bodies.state('sun',at,{...position,elevation:position.elevation+position.eyeM});
   const photo=photographability(plan.body,state,sun.apparentAltitude);
   const id=[point.surfaceId||point.sourceId||'surface',position.latitude.toFixed(7),position.longitude.toFixed(7),position.elevation.toFixed(2),Math.round(at/1000)].join(':');
   const extras=[];for(const other of plan.extraTargets||[]){
    if(options.isCurrent?.()===false)throw Error('candidate-cancelled');
    const geometry=align.geometryFrom(position,other,{eyeM:position.eyeM});
    if(!geometry||![geometry.azimuth,geometry.angle,geometry.topM,geometry.distanceKm].every(Number.isFinite)){extras.push({id:other.id,frame:{status:'unknown',fits:false},visibility:'unknown',reason:'target-geometry-unavailable'});continue;}
    const extraPlan={...plan,target:other,partId:null,composition:null,lens:plan.lens?{...plan.lens,...(frame.axis?{axis:frame.axis}:{})}:null};
    const otherFrame=lensCheck(extraPlan,position,state,geometry,align);
    const upperOther=plan.requireAllTargets?await upperQuality(position,other,options):null;
    if(upperOther&&!['model-clear','not-applicable'].includes(upperOther.status)){
     extras.push({id:other.id,frame:otherFrame,visibility:'unknown',reason:'upper-tower-unverified',upperQuality:upperOther,at,observer:{...position}});continue;
    }
    // Retain the main event's (p,t); do not search a different time for an extra.
    const extraSolution={observer:position,event:{at},geometry,anchor:other},extraLos=await visibility(extraPlan,extraSolution,options,eventSky);
    extras.push({id:other.id,frame:otherFrame,visibility:extraLos.status,evidence:extraLos,at,observer:{latitude:position.latitude,longitude:position.longitude,elevation:position.elevation,eyeM:position.eyeM}});
   }
   if(plan.requireAllTargets&&extras.some(x=>!x.frame.fits||x.frame.status==='unknown')){outside++;continue;}
   // Even an optional extra is a real occulting object. Its own obstruction
   // may be optional; a known obstruction of the photographed body is not.
   if(extras.some(x=>x.visibility==='blocked'&&x.evidence?.reason!=='target-obstructed')){blocked++;continue;}
   if(plan.requireAllTargets&&extras.some(x=>x.visibility==='blocked')){blocked++;continue;}
   const combinedClear=los.status==='model-clear'&&extras.every(x=>x.visibility==='model-clear'),visibilityQuality=combinedClear?'model-clear':'unknown';
   // Only a sight line shown clear of terrain and buildings is a candidate (design note 21): unknown is not shown.
   if(los.status!=='model-clear'||plan.requireAllTargets&&!combinedClear){
    unverified++;lastUnverified=los;
    // An extra's upper failure describes this rejection only after the main
    // target is clear; it must not mask an unread main sight line.
    const extraUpper=los.status==='model-clear'&&plan.requireAllTargets?extras.find(x=>x.upperQuality):null;
    if(extraUpper)lastUnverified={...los,upperQuality:extraUpper.upperQuality};
    if(missingHeights(los.target?.buildings)||los.rays?.some(r=>missingHeights(r.buildings)))heightUnknown++;continue;
   }
   const usedBuildings=[los.target?.buildings,...(los.rays||[]).filter(r=>r.status==='model-clear').map(r=>r.buildings)],buildingHeights=usedBuildings.some(b=>b?.heights==='estimated')?'estimated':usedBuildings.every(b=>b?.heights==='plateau')?'plateau':'model';
   const hiddenBelow=los.surveyed?null:await hiddenNote(plan.target,position,solution.geometry.azimuth,los.target?.terrain?.skyline,los.target?.buildings?.skyline,los.target?.buildings?.treeSkyline);
   const treesRead=!!los.target?.buildings?.trees&&los.target.buildings.trees.status!=='unread';
   // A surveyed row says what the survey found and no more: how much of the target shows and what stands beside it
   // were not read from the data (its buildings and trees were not asked), so no composition and no tree note.
   const composition=los.surveyed?null:await compositionOf(plan,position,solution,state,los,options).catch(e=>{if(e?.message==='candidate-cancelled')throw e;globalThis.AstroNotesErrors?.note('candidates.composition',e);return null;});
   const kind=position.placeKind||point.placeKind;
   accepted.push({id,requestKey:plan.requestKey,status:combinedClear&&frame.status!=='unknown'?'model-visible':'visible-partial',recommend:true,aligned:true,placeKind:kind==='sidewalk'?'road':kind||'unknown',surfaceId:point.surfaceId,
    place:{id,name:position.name||point.name||'撮影候補地点',latitude:position.latitude,longitude:position.longitude,elevation:finalGround,groundManualM:finalGround,stand:'ground',standAglM:position.elevation-finalGround+position.eyeM,eyeHeightAGL:position.elevation-finalGround+position.eyeM,decks:[],
    surfaceId:point.surfaceId},
    assumedObserver:{...position},event:{...solution.event,sunAltitude:sun.apparentAltitude},quality:{visibility:los.status,extraTargets:visibilityQuality,buildingHeights,targetAngleDeg:solution.geometry.angle,frame:frame.status,photographyClass:photo,
    geometry:solution.event.targetGeometryKind||'anchor',datum:'source-epoch-unverified',...(los.surveyed?{surveyed:true}:{}),hiddenBelow,
    trees:los.surveyed?'surveyed':trees?(treesRead?'checked':'unread'):'not-modeled',composition,...(upper.status==='model-clear'?{upperTower:upper}:{})},rank:[Math.round(solution.geometry.angle*10)/10,solution.event.gapAngleDeg??0],
    frame,extraTargets:extras,visibility:los,sourceEvidence:position.sourceEvidence||point.sourceEvidence,modelEvidence:{kind:combinedClear?'terrain-and-building-model-los':'geometry-with-partial-los',scope:'target-and-celestial-rays',actualVisibilityGuaranteed:false,treesModeled:false,
    terrainNumericComplete:!!los.rays?.every(r=>r.intentionalTarget||r.terrain?.status==='model-clear'),buildingRangeComplete:!!los.rays?.every(r=>r.intentionalTarget||r.buildings?.complete&&r.buildings?.evaluated),
    targetSelfGeometryComplete:los.shapeKnown&&los.target?.buildings?.evaluated&&!los.target?.buildings?.unresolvedTargetContacts,extraTargetsAssessed:extras.length,datumUncertainty:true}});
  }
  return accepted.length?{...accepted[0],additionalCandidates:accepted.slice(1),partial:solved.partial}: {status:unverified?'unverified':blocked?'model-blocked':outside?'outside-frame':'no-overlap',recommend:false,heightUnknown:heightUnknown>0,
  obstacle:!!lastUnverified&&[lastUnverified.target?.buildings,...(lastUnverified.rays||[]).map(r=>r.buildings)].some(b=>['trees','elevated-structure'].includes(b?.reason)),unverifiedBy:lastUnverified?{target:[lastUnverified.target?.terrain?.status,lastUnverified.target?.terrain?.reason,
  lastUnverified.target?.buildings?.status,lastUnverified.target?.buildings?.reason],rays:(lastUnverified.rays||[]).map(r=>r.intentionalTarget?'target':[r.status,r.terrain?.reason||r.terrain?.status,r.buildings?.reason||r.buildings?.status].join('/'))}:null,partial:solved.partial,
  reason:solved.reason,...(lastUnverified?.upperQuality?{upperQuality:lastUnverified.upperQuality}:{})};
 }
 return {evaluate,visibility:(plan,solution,options={})=>visibility(plan,solution,options),hiddenView,skylineView,clear:()=>{visibilityCache.clear();targetLines.clear();ridgeScope?.context.retire();ridgeScope=null;}};
}
Model.createGeneric=createGeneric;Model.standingMetadata=standingMetadata;Model.lensCheck=lensCheck;Model.photographability=photographability;Model.skyRange=skyRange;
if(typeof module==='object'&&module.exports)module.exports={createGeneric,lensCheck,photographability,skyRange,angularDistance,standingMetadata};
})(globalThis);

/* Search job owner for the generic trial. No DOM, storage, or ambient IO. */
(function(root){
'use strict';
const api=root.AstroNotesCandidateDiscovery||(typeof require==='function'?require('./search.js'):null);
const Composition=root.AstroNotesCandidateComposition||(typeof require==='function'?require('./composition.js'):null);
const allowedPoint=p=>p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<85&&Math.abs(p.longitude)<=180;
function requestKey(p){return JSON.stringify([p.owner,p.body,p.target,p.partId,p.limb,p.matchMode,p.profile,p.strict,p.composition,!!p.compositionInvalid,p.timeWindow,p.timeSpec||{kind:'day',at:api.day(p.at)},p.atmosphere,p.lens?.mode==='unspecified'?{mode:'unspecified'}:p.lens,p.extraTargets,
p.requireAllTargets,p.includeRoads===true,...(p.overlapMembers?[p.overlapMembers]:[]),...(p.pointNight?[{pointNight:true}]:[]),...(p.seedBand?[{seedBand:p.seedBand.key,...(p.seedBand.status?{status:p.seedBand.status,body:p.seedBand.body}:{})}]:[])]);}
// 2026-11-26 trial（段階②）: 目標物が中心の地図から探す時は、逆算の種を重なる範囲（帯）の中だけにする。
// 帯は1分ごとの [目標物から見た方位（子午線の収束を直した値）, 外端までの距離km, 半幅°, 対象の横幅の半分km]。
// 対象の横幅は距離が近いほど大きく見えるので距離ごとに角度へ直し、種の半径ぶんの余裕も見る。
function inSeedBand(band,seed){
 const t=band.target,R=6371,rad=Math.PI/180,dLat=(seed.latitude-t.latitude)*rad,dLon=(seed.longitude-t.longitude)*rad,mean=(seed.latitude+t.latitude)/2*rad;
 const x=dLon*Math.cos(mean)*R,y=dLat*R,dist=Math.hypot(x,y),bearing=(Math.atan2(x,y)/rad+360)%360,pad=Math.max(.05,Math.atan2((seed.radiusM||250)/1000,Math.max(dist,.05))/rad);
 for(const [b,d,w,hw=0] of band.samples){const delta=Math.abs(((bearing-b+540)%360)-180),width=w+Math.atan(hw/Math.max(dist,.05))/rad;if(delta<=width+pad&&dist<=d+(seed.radiusM||250)/1000)return true;}
 return false;
}
function bandSeeds(inverse,band){
 if(!band||!Array.isArray(band.samples)||!inverse?.seeds)return inverse;
 const seeds=inverse.seeds.filter(seed=>inSeedBand(band,seed));
 return {...inverse,seeds,bandFiltered:inverse.seeds.length-seeds.length};
}
function regionsFor(seeds){
 const map=new Map(),size=.005;
 for(const seed of seeds||[]){
  if(!allowedPoint(seed))continue;
  // Small service tiles are scheduling units. A budget never turns the unvisited tiles into 'no solution'.
  const radius=Math.max(200,seed.radiusM||500),dy=radius/111195,dx=dy/Math.max(.1,Math.cos(seed.latitude*Math.PI/180));
  const cx=Math.floor(seed.longitude/size),cy=Math.floor(seed.latitude/size);
  const nx=Math.min(3,Math.ceil(dx/size)),ny=Math.min(3,Math.ceil(dy/size));
  for(let x=cx-nx;x<=cx+nx;x++)for(let y=cy-ny;y<=cy+ny;y++){
   const bbox=[x*size,y*size,(x+1)*size,(y+1)*size];if(bbox[0]<-180||bbox[2]>180||bbox[1]<-85||bbox[3]>85)continue;
   const near=Math.hypot(((x+.5)*size-seed.longitude)*Math.cos(seed.latitude*Math.PI/180),(y+.5)*size-seed.latitude)*111195;
   // A low body is seen from far away, nearly level; a high one only from close by, looking up.
   // Recorded shots centre on 2-6 deg (median 2.9, 75% under 5.8). Below 2 deg the line rises
   // under 35 m per km, so the first house in front decides; those seeds come after the 2-6 deg band.
   const alt=Math.max(0,seed.bodyAltitude||0),preferAngle=alt<2?(2-alt)*1.5:alt<6?0:(alt-6)/4;
   const priority=(seed.priority||0)+near/radius+preferAngle,id=x+','+y;
   const previous=map.get(id);if(!previous||priority<previous.priority)map.set(id,{id,bbox,priority,source:'inverse-celestial-rays',seedAt:seed.at,seedRadiusM:radius,localEnvelopeIncomplete:dx>3*size||dy>3*size});
  }
 }
 return [...map.values()].sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
}
const placeKindsFor=plan=>new Set(['viewpoint','plaza','park','riverbank',...(plan.includeRoads===true?['sidewalk','road']:[])]);
function createGenericSearch({provider,evaluate,bodies,prefilter=null,acceptCandidate=()=>true,maxPointsPerBatch=40,maxDeferredPoints=384,inverseOptions={},now=()=>Date.now(),yieldTask=typeof AstroNotesLibrary==='object'&&AstroNotesLibrary.pause||(()=>new Promise(r=>setTimeout(r,0)))}={}){
 const sessions=new Map();
 const fresh=(key,inverse,lastResult=null)=>({key,regions:regionsFor(inverse?.seeds),inverse,lastResult,rows:[],queue:[],pointData:new Map(),pointDomains:new Map(),visitedDomains:new Set(),timeDeferred:new Set(),seen:new Set(),seenRows:new Set(),cursor:0,started:false,
 counts:{checked:0,unknown:0,blocked:0,noOverlap:0,unverified:0,heightUnknown:0,nearBuilding:0,obstacle:0,outsideFrame:0,mapRegions:0,mapPoints:0,
 deferred:0},coverage:[],retryWork:new Map(),busy:false});
 // Rechecking the same conditions replaces only working progress. The last
 // complete result remains available when a recheck fails or is cancelled.
 function restart(plan){const key=requestKey(plan),previous=sessions.get(key);if(previous?.busy&&previous.current?.()!==false)return false;if(previous)sessions.set(key,fresh(key,previous.inverse,previous.lastResult));return true;}
 async function search(plan,{onProgress=()=>{},onFirstResult,onRows,isCurrent=()=>true,signal,more=false,retryFailed=true,deadline=Infinity,pointLimit=maxPointsPerBatch,
  shouldPause=()=>false,providerOptions={},prioritizeKnown=false,diverse=false,deferTimedOut=()=>false,deprioritizePoints=()=>()=>false,mapBudgetMs=Infinity,retryWork=null,retainFailures=false}={}){
  if(plan.compositionInvalid)throw Error('invalid-composition');
  const key=requestKey(plan),placeKinds=placeKindsFor(plan);let session=sessions.get(key);
  const kindAllowed=(row,fallback)=>{
   const kind=row.placeKind??fallback;if(placeKinds.has(kind))return true;
   if(plan.includeRoads!==true)return false;
   const source=row.sourceEvidence,evidence=source?.categoryEvidence;
   return kind==='unknown'&&source?.kind==='surveyed-viewpoint'&&!!evidence&&['research-kind','research-description','mapped-category','official-description','unclassified'].includes(evidence.basis)
    &&typeof evidence.detail==='string'&&Array.isArray(evidence.sourceUrls)&&evidence.sourceUrls.every(url=>typeof url==='string');
  };
  const wanted=()=>!signal?.aborted&&now()<deadline&&isCurrent();
  // Shared loaders may finish after this action. Stop waiting without granting
  // their late response ownership of the queue or any displayed result.
  const wait=(promise,reader=signal)=>{
   if(!reader)return promise;
   let abort;return Promise.race([promise,new Promise((_,reject)=>{abort=()=>reject(Error('candidate-cancelled'));if(reader.aborted)abort();else reader.addEventListener('abort',abort,{once:true});})])
    .finally(()=>reader.removeEventListener('abort',abort));
  };
  try{
  if(!wanted())return {cancelled:true};
  // An applicable but unfinished/empty band must never become an unrestricted search.
  if(plan.seedBand?.status&&plan.seedBand.status!=='ready')return {cancelled:true,reason:'seed-band-'+plan.seedBand.status};
  if(plan.seedBand?.body&&plan.seedBand.body!==plan.body)return {cancelled:true,reason:'seed-band-body'};
  if(plan.seedBand?.status==='ready'&&!plan.seedBand.samples.length){const empty=fresh(key,{seeds:[]});empty.started=true;empty.cursor=null;empty.lastResult=result(empty);sessions.set(key,empty);return empty.lastResult;}
  // A cancelled A job may still await shared IO when the user returns A→B→A.
  // Retire only the obsolete owner; an active same-key job still owns its queue.
  if(session?.busy&&session.current?.()===false){
   // Detach mutable progress from the obsolete owner. Completed batches and
   // the pending point/cursor survive even if its IO never acknowledges abort.
   session={...session,rows:session.rows.slice(),queue:session.queue.slice(),pointData:new Map(session.pointData),pointDomains:new Map(session.pointDomains),visitedDomains:new Set(session.visitedDomains),
    timeDeferred:new Set(session.timeDeferred),seen:new Set(session.seen),seenRows:new Set(session.seenRows),retryWork:new Map(session.retryWork),
    counts:{...session.counts},coverage:session.coverage.slice(),busy:false,current:null};sessions.set(key,session);
  }
  if(session?.busy)return {cancelled:true,reason:'busy'};
  if(!session?.inverse){
   await wait(bodies.ensure(plan.body));if(!wanted())return {cancelled:true};
   onProgress({stage:'inverse',checked:0});
   const inverse=bandSeeds(await wait(root.AstroNotesTrialOverlap?.inverse?.(plan,p=>Composition.inverseSeeds(p,{bodies,isCurrent:wanted,yieldTask,...inverseOptions}))??Composition.inverseSeeds(plan,{bodies,isCurrent:wanted,yieldTask,...inverseOptions})),plan.seedBand);
   if(!wanted())return {cancelled:true};
   session=fresh(key,inverse);
   sessions.set(key,session);while(sessions.size>4)sessions.delete(sessions.keys().next().value);
  }
  if(!more&&session.started)return {...result(session),cached:true};
  session.busy=true;session.current=wanted;let pendingPoint=null;
  try{
   const enqueue=(points,data)=>{for(const p of points){if(!allowedPoint(p)||!kindAllowed(p))continue;
    const id=[p.surfaceId||p.sourceId,p.latitude.toFixed(7),p.longitude.toFixed(7),p.surfaceHeightM??p.groundM].join(':');if(session.seen.has(id))continue;
    session.seen.add(id);session.queue.push(p);session.pointData.set(p,data);if(diverse)session.pointDomains.set(p,Composition.surfaceDomainKey(p));}};
   const visited=p=>{const domain=session.pointDomains.get(p);return domain!=null&&session.visitedDomains.has(domain);};
   const deferred=p=>session.timeDeferred.has(p);
   const hold=(id,work)=>{
    const previous=session.retryWork.get(id),attempts=(previous?.attempts||0)+1;
    session.retryWork.set(id,{...work,id,attempts,retryAt:now()+Math.min(60000,5000*2**Math.min(4,attempts-1))});
   };
   if(retryWork?.kind==='point'){
    const index=session.queue.indexOf(retryWork.point);if(index>=0)session.queue.splice(index,1);
    session.queue.unshift(retryWork.point);session.pointData.set(retryWork.point,retryWork.data);
    if(diverse)session.pointDomains.set(retryWork.point,Composition.surfaceDomainKey(retryWork.point));
   }
   // Known fixed viewpoints need no OSM page or hundreds of ground samples.
   // They still pass the same exact geometry and visibility evaluation.
   if(prioritizeKnown&&!session.surveyedChecked&&typeof provider.surveyed==='function'){
    const known=await wait(provider.surveyed(plan));if(!wanted())return {cancelled:true};
    enqueue(known,{features:[]});session.surveyedChecked=true;
   }
   // Read the current records once per scheduling decision, not once for each
   // point inspected by find/every. Priority changes never remove queued work.
   const lowerPriority=deprioritizePoints();
   const retrySource=retryWork?.kind==='source'?retryWork:null;
   const room=()=>session.queue.length+session.retryWork.size<maxDeferredPoints;
   if(retrySource||room()&&(!session.queue.length||diverse&&session.queue.every(p=>deferred(p)||visited(p)||lowerPriority(p)))&&(session.cursor!==null||!session.started)){
    // The optional map must not hold known fixed viewpoints. Compute it once,
    // just before the first ordinary provider page, within the same deadline.
    if(prefilter&&!session.mapChecked){
     const mapOwner=new AbortController(),cancelMap=()=>mapOwner.abort(),mapDeadline=Math.min(deadline,now()+mapBudgetMs);
     signal?.addEventListener('abort',cancelMap,{once:true});
     const mapTimer=Number.isFinite(mapDeadline)?setTimeout(cancelMap,Math.max(1,mapDeadline-now())):null;
     const mapCurrent=()=>wanted()&&!mapOwner.signal.aborted&&now()<mapDeadline;
     try{const f=await wait(prefilter.regions(plan,session.regions,{isCurrent:mapCurrent,signal:mapOwner.signal,deadline:mapDeadline}),mapOwner.signal);
      if(!wanted())return {cancelled:true};
      if(f&&mapCurrent()){session.counts.mapRegions=session.regions.length-f.regions.length;session.regions=f.regions;session.mapContext=f.context||null;}}
     catch(e){if(!wanted())return {cancelled:true};if(e?.message!=='candidate-cancelled')globalThis.AstroNotesErrors?.note('candidates.visibility-map',e);}
     finally{if(mapTimer!==null)clearTimeout(mapTimer);signal?.removeEventListener('abort',cancelMap);mapOwner.abort();
      // A slow optional filter must not prevent exact evaluation on every resume.
      session.mapChecked=true;}}
    onProgress({stage:'places',...session.counts});
    const cursor=retrySource?.cursor??session.cursor??0;
    const data=await wait(provider.load(plan,{...providerOptions,regions:session.regions,cursor,isCurrent:wanted,onProgress,signal,deadline,retryFailed,pointKinds:placeKinds}));
    if(!wanted()||data.cancelled)return {cancelled:true};
    const points=[...(data.points||[])];
    // Surveyed places of this target go in once, wherever the regions lie (place-provider.js surveyedViewpoints).
    if(!session.started&&!session.surveyedChecked&&typeof provider.surveyed==='function'){const known=await wait(provider.surveyed(plan));if(!wanted())return {cancelled:true};points.unshift(...known);session.surveyedChecked=true;}
    // Commit a provider page only after all awaited preparation is current.
    if(!wanted())return {cancelled:true};
    session.coverage.push(data.coverage||{});session.providerPartial=!!data.partial;
    if(!retrySource)session.cursor=data.coverage?.nextCursor??null;
    session.retryAt=data.coverage?.retryAfterMs>0?now()+data.coverage.retryAfterMs:0;
    if(retrySource){
     if(data.coverage?.failedRegions?.length)hold(retrySource.id,retrySource);
     else if(data.coverage?.nextCursor){session.retryWork.set(retrySource.id,{...retrySource,cursor:data.coverage.nextCursor});}
     else{session.retryWork.delete(retrySource.id);}
    }else if(retainFailures)for(const tile of data.coverage?.failedRegions||[]){
     const id='source:'+tile.id;
     if(!session.retryWork.has(id))hold(id,{kind:'source',cursor:{batchTiles:[{id:tile.id,bbox:tile.bbox,regionId:tile.regionId}],afterCursor:null}});
    }
    // Public places are the default; independent roads need an explicit opt-in.
    enqueue(points,data);
    const order=['viewpoint','plaza','park','riverbank','sidewalk'];session.queue.sort((a,b)=>order.indexOf(a.placeKind)-order.indexOf(b.placeKind));
    session.data=data;
   }
   session.started=true;let count=0;
   let publishFirst=onFirstResult&&!session.rows.length;
   while(session.queue.length&&count<Math.min(maxPointsPerBatch,pointLimit)){
    if(!wanted())return {cancelled:true};
    if(shouldPause())break;
    // Try one seed of each proven surface domain before revisiting the same
    // walkable surface. Keep every other seed and its own page's geometry.
    if(diverse&&!(count===0&&retryWork?.kind==='point'&&session.queue[0]===retryWork.point)){
     const lower=deprioritizePoints();
     let index=session.queue.findIndex(p=>!lower(p)&&!deferred(p)&&!visited(p));
     if(index<0&&session.cursor!==null&&room())break;
     if(index<0)index=session.queue.findIndex(p=>!lower(p)&&!deferred(p));
     if(index<0)index=session.queue.findIndex(p=>!lower(p));
     if(index<0)index=session.queue.findIndex(p=>!deferred(p));
     if(index>0)session.queue.unshift(...session.queue.splice(index,1));
    }
    const point=session.queue[0],data=session.pointData.get(point)||session.data;
    const consume=()=>{session.queue.shift();session.pointData.delete(point);session.timeDeferred.delete(point);pendingPoint=null;
     const domain=session.pointDomains.get(point);if(domain!=null)session.visitedDomains.add(domain);session.pointDomains.delete(point);};
    if(session.mapContext&&!point.surveyedTargets?.includes(plan.target?.id)&&prefilter.point(plan,point,session.mapContext)===false){
     session.retryWork.delete(point);consume();session.counts.checked++;session.counts.blocked++;session.counts.mapPoints++;continue;}
    onProgress({stage:'evaluate',...session.counts,pending:session.queue.length});
    pendingPoint=point;
    const tested=await wait(root.AstroNotesTrialOverlap?.evaluate?.(plan,p=>evaluate({...p,requestKey:key},point,data,{isCurrent:wanted,signal,deadline}))??evaluate({...plan,requestKey:key},point,data,{isCurrent:wanted,signal,deadline}));
    if(!wanted())return {cancelled:true};
    // Only this explicit, non-cached transport failure is retryable. A missing
    // model, a 404 tile or an unknown structure height is not a transport retry.
    const retryable=retainFailures&&tested.status==='unverified'&&tested.upperQuality?.layer==='terrain'&&tested.upperQuality.reason==='terrain-fetch';
    if(retryable){hold(point,{kind:'point',point,data});consume();count++;continue;}
    session.retryWork.delete(point);
    consume();count++;session.counts.checked++;
    if(tested.partial)session.counts.deferred++;
    if(tested.status==='model-blocked')session.counts.blocked++;else if(tested.status==='no-overlap')session.counts.noOverlap++;
    else if(tested.status==='unverified'){session.counts.unverified++;if(tested.heightUnknown)session.counts.heightUnknown++;if(tested.nearBuilding)session.counts.nearBuilding++;if(tested.obstacle)session.counts.obstacle++;}
    else if(tested.status==='outside-frame')session.counts.outsideFrame++;else if(!tested.recommend)session.counts.unknown++;
    const beforeRows=session.rows.length;
    for(const row of [tested,...tested.additionalCandidates||[]]){
     if(!row.recommend||!allowedPoint(row.place)||!Number.isFinite(row.event?.at))continue;
     // The accepted event can occur at another time/position than its inverse seed.
     if(!acceptCandidate(plan,row))continue;
     // Solving may move a park seed onto a road. Check the solved kind too.
     if(!kindAllowed(row,point.placeKind))continue;
     const range=Composition.timeRange(plan);if(!range||row.event.at<range.start||row.event.at>range.end)continue;
     const id=row.id||[row.surfaceId,row.place.latitude,row.place.longitude,row.event.at].join(',');
     if(!session.seenRows.has(id)){session.seenRows.add(id);session.rows.push({...row,id,requestKey:key});}
    }
    if(publishFirst&&session.rows.length){
     publishFirst=false;
     // The first verified row can be selected immediately. Save its position in the
     // search before showing it, just as with the later completed batches.
     session.lastResult=result(session);
     onFirstResult(session.lastResult);
    }
    if(onRows&&session.rows.length>beforeRows){session.lastResult=result(session);onRows(session.lastResult);}
    await yieldTask();
   }
   session.lastResult=result(session);return session.lastResult;
  }finally{
   // A slow location must not starve every other location on each Continue.
   // Retain its exact source data and retry it after untried work; cancellation
   // by the user keeps the original pending position instead.
   if(pendingPoint&&deferTimedOut()){
    const index=session.queue.indexOf(pendingPoint);
    if(index>=0){session.queue.push(...session.queue.splice(index,1));session.timeDeferred.add(pendingPoint);}
   }
   session.busy=false;
  }
  }catch(error){if(!wanted())return {cancelled:true};throw error;}
 }
 // Yield between batches. The normal search ends at the place quota, source
 // exhaustion or a recoverable stall. Callers may opt into a diagnostic deadline.
 async function searchRecommended(plan,{hardBudgetMs=Infinity,mapBudgetMs=2000,targetPlaces=10,maxEvaluations=Infinity,countPlaces=rows=>rows.length,onPage=()=>{},onBatchStart=()=>{},...options}={}){
  if(plan.compositionInvalid)throw Error('invalid-composition');
  const key=requestKey(plan),active=sessions.get(key);
  if(active?.busy&&active.current?.()!==false)return {cancelled:true,reason:'busy'};
  const started=now(),deadline=started+Math.max(1,hardBudgetMs),own=new AbortController();
  const external=()=>!options.signal?.aborted&&(options.isCurrent?.()??true);
  const cancel=()=>own.abort();options.signal?.addEventListener('abort',cancel,{once:true});
  if(options.signal?.aborted)cancel();const timer=Number.isFinite(deadline)?setTimeout(cancel,deadline-started):null;
  let page,more=!!options.more,places=countPlaces(active?.rows||[]),reason=null;
  const initialChecked=active?.counts.checked||0,cursors=new Set();
  // Retry only failures present when the user started this action. A failed
  // request cannot recursively schedule itself throughout the foreground job.
  const retries=new Set(more?active?.retryWork.keys():[]);
  const publish=p=>{page=p;places=countPlaces(p.rows);onPage(p,places);};
  // Continue means more new choices, not an immediate stop at the old quota.
  const goal=places+targetPlaces;
  try{
   while(external()&&!own.signal.aborted&&now()<deadline){
    const session=sessions.get(key),checked=(session?.counts.checked||0)-initialChecked;
    if(checked>=maxEvaluations){reason='point-budget';break;}
    const room=!session||session.queue.length+session.retryWork.size<maxDeferredPoints;
    const work=session?[...session.retryWork.values()]:[],sourceFits=room||!session.queue.length&&!work.some(item=>item.kind==='point');
    const retryWork=work.find(item=>retries.has(item.id)&&item.retryAt<=now()&&(item.kind==='point'||sourceFits));
    if(session?.started&&!session.queue.length&&!retryWork){
     if(session.retryAt>now()||session.retryWork.size&&(!room||session.cursor===null)){reason='source-wait';break;}
    }
    onBatchStart();
    const next=await search(plan,{...options,signal:own.signal,deadline,more,retryFailed:false,retryWork,retainFailures:true,onRows:publish,prioritizeKnown:true,diverse:true,mapBudgetMs,
     deferTimedOut:()=>external()&&(own.signal.aborted||now()>=deadline),
     pointLimit:Math.min(maxPointsPerBatch,maxEvaluations-checked),shouldPause:()=>places>=goal||(sessions.get(key)?.counts.checked||0)-initialChecked>=maxEvaluations,
     providerOptions:{maxTiles:2,maxPoints:48}});
    if(!external())return {cancelled:true};
    if(next.cancelled){if(next.reason==='busy')return next;break;}
    if(retryWork){const retained=sessions.get(key)?.retryWork.get(retryWork.id);if(!retained||retained.attempts!==retryWork.attempts)retries.delete(retryWork.id);}
    page=next;places=countPlaces(page.rows);
    if(!page.canContinue)return page;
    if(places>=goal){reason='enough-places';break;}
    onPage(page,places);
    // Cooling sources resume on a later user action; never wait a minute here.
    if(!page.coverage.pendingPoints&&page.retryAt>now()){reason='source-wait';break;}
    const retryProgress=[...sessions.get(key).retryWork.values()].map(work=>[work.kind,work.attempts,work.cursor]);
    const cursor=JSON.stringify([page.coverage.nextCursor,page.counts.checked,retryProgress]);
    if(cursors.has(cursor)){reason='source-stalled';break;}cursors.add(cursor);
    more=true;await yieldTask();
   }
  }catch(error){if(external()&&!own.signal.aborted&&now()<deadline)throw error;}
  finally{if(timer!==null)clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);own.abort();}
  if(!external())return {cancelled:true};
  let session=sessions.get(key);if(!session){session=fresh(key,null);sessions.set(key,session);while(sessions.size>4)sessions.delete(sessions.keys().next().value);}
  page=result(session);if(session.started&&!page.canContinue)return page;
  const paused={...page,paused:true,pauseReason:reason||'time-budget',stalled:reason==='source-stalled',jobStatus:'paused',canContinue:true,elapsedMs:Math.max(0,now()-started)};
  session.lastResult=paused;
  return paused;
 }
 // Drain scheduled pages and point batches as one cancellable foreground search.
 // onPage(page): each finished page with every row found so far, so a long search can show its rows as it goes.
 async function searchAll(plan,{onBatchStart=()=>{},onPage=()=>{},...options}={}){
  const wanted=()=>!options.signal?.aborted&&(options.isCurrent?.()??true);
  const cursors=new Set();let more=!!options.more,waits=0;
  while(wanted()){
   onBatchStart();
   const page=await search(plan,{...options,more,retryFailed:false,onFirstResult:onPage});
   if(!wanted()||page.cancelled)return {cancelled:true};
   if(!page.canContinue)return page;
   onPage(page);
   // The place source asked to wait (Overpass cooling down): wait, then fetch the regions it left. Three waits at most;
   // a busier Overpass ends the search with its regions reported as not fetched.
   const waitMs=(page.retryAt||0)-Date.now();
   if(!page.coverage.pendingPoints&&waitMs>0&&waits<3){waits++;options.onProgress?.({stage:'places-wait',waitMs,...page.counts});for(const end=Date.now()+waitMs+250;Date.now()<end;){if(!wanted())return {cancelled:true};await new Promise(r=>setTimeout(r,Math.min(250,end-Date.now())));}more=true;
   continue;}
   if(!page.coverage.pendingPoints){
    const cursor=JSON.stringify(page.coverage.nextCursor);
    if(cursors.has(cursor)){const stalled={...page,stalled:true};sessions.get(page.requestKey).lastResult=stalled;return stalled;}
    cursors.add(cursor);
   }
   more=true;await yieldTask();
  }
  return {cancelled:true};
 }
 function result(s){
  const retry=[...s.retryWork.values()],sourceFits=s.queue.length+retry.length<maxDeferredPoints||!s.queue.length&&!retry.some(work=>work.kind==='point');
  const eligible=retry.filter(work=>work.kind==='point'||sourceFits),retryAt=eligible.length?Math.min(...eligible.map(work=>work.retryAt)):0;
  const waitsForRetry=!s.queue.length&&(s.cursor===null||s.retryWork.size>=maxDeferredPoints);
  return {rows:s.rows.slice(),counts:{...s.counts},retryAt:Math.max(s.retryAt||0,waitsForRetry?retryAt:0),requestKey:s.key,cached:false,limited:true,coverageStatus:'partial',jobStatus:'complete',
   canContinue:s.queue.length>0||s.cursor!==null||retry.length>0,coverage:{regions:s.regions.length,loaded:s.coverage,pendingPoints:s.queue.length,timeDeferredPoints:s.timeDeferred.size,
   retryPending:retry.length,retryPoints:retry.filter(work=>work.kind==='point').length,retrySources:retry.filter(work=>work.kind==='source').length,
   nextCursor:s.cursor,approximateInverse:true},dataVersion:'generic-v1'};
 }
 return {search,searchAll,searchRecommended,restart,cached:plan=>{const s=sessions.get(requestKey(plan));return s?.lastResult?{...s.lastResult,rows:s.lastResult.rows.slice(),cached:true}:null;},clear:()=>sessions.clear(),
  // A result kept across a page reload (iOS drops a backgrounded page). It only answers cached(); continuing searches afresh.
  prime:(plan,saved)=>{const key=requestKey(plan);if(!saved||!Array.isArray(saved.rows)||saved.requestKey!==key||sessions.get(key)?.lastResult)return false;
   sessions.set(key,{key,lastResult:{...saved,rows:saved.rows.slice(),cached:false}});while(sessions.size>4)sessions.delete(sessions.keys().next().value);return true;}};
}
api.requestKey=requestKey;api.regionsFor=regionsFor;api.createGenericSearch=createGenericSearch;
if(typeof module==='object'&&module.exports)module.exports={requestKey,regionsFor,createGenericSearch,bandSeeds};
})(globalThis);

/* Trial-only composition draft. Canvas picks the visible surface of the existing approximate drawing model; not surveyed geometry. */
(()=>{
'use strict';const C=AstroNotesCandidateComposition,S=AstroNotesTrialSurface,states=new WeakMap();let ownerKey='',config={composition:null,timeWindow:{kind:'none'},compositionInvalid:false,invalidDraft:null},editing=null;
const current=()=>typeof SkyMapUI==='undefined'?null:SkyMapUI.selectionState(),owner=()=>typeof auth==='undefined'?'':auth?.loginId||'';
function syncContext(s=current()){const key=JSON.stringify([owner(),s?.target,s?.body,s?.partId,s?.limb,s?.matchMode,globalThis.AstroNotesTrialOverlap?.key?.(s)??null]);if(key!==ownerKey){ownerKey=key;config={composition:null,timeWindow:{kind:'none'},compositionInvalid:false,invalidDraft:null};
for(const st of statesList){st.invalid=false;st.dragging=false;st.active=false;st.error='';}if(editing){editing.active=false;editing=null;}}return s;}
function notify(){document.dispatchEvent(new Event('astronotes-composition-change'));for(const st of statesList)update(st);}
function pickHint(){return '重ねたい位置を選んでください';}
function selectedHeight(s,c){return `高さ ${(c.heightM-(s?.target?.groundM??0)).toFixed(1)} m`;}
function selectedLimb(s){if(typeof AstroNotesBodies==='undefined'||!AstroNotesBodies.definition(s?.body)?.limbs)return 'center';return s.limb==='onTop'?'lower':s.limb==='behind'?'upper':['lower','upper'].includes(s.limb)?s.limb:'center';}
// An explicit first arrow key selects an actual visible face, just like a tap.
function firstKeyboardPick(st,choose){
 const s=current(),v=st.host._trialCompositionView,m=S.model(AstroNotesAlign,s?.target);if(!m?.vertices?.length)return false;
 const center=points=>[0,1,2].map(k=>points.reduce((sum,p)=>sum+p[k],0)/points.length),points=[center(m.vertices),...m.surfaceTriangles.flat().map(ids=>center(ids.map(id=>m.vertices[id])))];
 const obs={...v.spec.obs,eyeM:v.spec.eyeM},project=AstroNotesAlign.viewProjector(v.win.az0,v.win.alt0),r=v.cv.getBoundingClientRect(),off=st.host._lensOffset||[0,0];
 for(const [eastM,northM,heightM]of points){const g=S.geometry(obs,s.target,{basis:'scene-surface',eastM,northM,heightM},AstroNotesAlign),xy=project(g.azimuth,g.angle);if(!xy)continue;
  const x=v.W/2+xy[0]*v.k+off[0]*v.W,y=v.H/2-xy[1]*v.k+off[1]*v.H;if(x<0||x>v.W||y<0||y>v.H)continue;
  if(choose({clientX:r.left+x*r.width/v.W,clientY:r.top+y*r.height/v.H}))return true;
 }return false;
}
function cancelEdit(st){config=structuredClone(st.beforeEdit||config);st.beforeEdit=null;st.active=st.dragging=false;st.invalid=false;st.error='';editing=null;notify();st.button.focus({preventScroll:true});}
const statesList=new Set();
function plan(s=current()){syncContext(s);return structuredClone(config);}
function label(s=current()){syncContext(s);const c=config.composition;return c?`${selectedHeight(s,c)}・${c.limb==='upper'?'天体の上の縁':c.limb==='lower'?'天体の下の縁':'天体の中心'}`:null;}
function clear(){syncContext();config={composition:null,timeWindow:{kind:'none'},compositionInvalid:false,invalidDraft:null};editing=null;
 for(const st of statesList){st.beforeEdit=null;st.active=st.dragging=st.invalid=false;st.error='';}notify();}
function capabilities(s,obs){
 const target=s?.target;let model=null,bounds=null;try{model=target&&S.model(AstroNotesAlign,target);bounds=model&&S.bounds({target,align:AstroNotesAlign,obs});}catch(e){globalThis.AstroNotesErrors?.note('composition.bounds',e);}
 const definition=typeof AstroNotesBodies==='undefined'?null:AstroNotesBodies.definition(s?.body),limbs=definition?.limbs===true;
 return {surface:!!model,bounds,limbs,limbOptions:limbs?[['center','中心'],['upper','上の縁'],['lower','下の縁']]:[['center','中心']]};
}
function syncToolbar(host){const st=states.get(host);if(!st)return;const toolbar=host.closest('#exploreScenePanel')&&host.querySelector('.trial-scene-toolbar');
 if(toolbar&&st.button.parentElement!==toolbar)toolbar.append(st.button);const hidden=!toolbar||!st.available;if(st.button.hidden!==hidden)st.button.hidden=hidden;
}
function update(st){
 const s=syncContext(),t=s?.target,cap=capabilities(s,st.host._trialCompositionView?.spec.obs);
 st.available=!!t&&!!st.host.closest('#exploreScenePanel')&&!globalThis.AstroNotesTrialOverlap?.isAll?.(s)&&cap.surface;
 if(!st.available){st.active=st.dragging=false;if(editing===st)editing=null;}
 syncToolbar(st.host);
 const unselected=st.active&&(!config.composition||config.compositionInvalid);
 st.button.disabled=!st.available||unselected;st.button.setAttribute('aria-description',!st.available?'この対象は図から位置を選べません。':unselected?pickHint():'');
 st.button.setAttribute('aria-label',st.active?'確定して撮影地点を探す':'重ねる位置を選ぶ');st.button.title=st.active?'確定して撮影地点を探す':'重ねる位置を選ぶ';st.button.setAttribute('aria-pressed',String(!!st.active));
 const buttonLabel=st.active?'確定':'位置を<wbr>選ぶ';if(st.buttonLabel.innerHTML!==buttonLabel)st.buttonLabel.innerHTML=buttonLabel;
 const glyph=st.active?'<path d="m5 12 4 4L19 6"/>':'<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>';
 if(st.glyph!==glyph){st.buttonIcon.innerHTML=icon(glyph);st.glyph=glyph;}
 const hint=st.error||(!config.composition||config.compositionInvalid?pickHint():selectedHeight(s,config.composition));
 if(st.noteText.textContent!==hint)st.noteText.textContent=hint;st.cancel.hidden=st.note.hidden=!st.active;redraw(st.host);
}
function dispose(st){for(const node of [st.button,st.cancel,st.overlay,st.note])node.remove();statesList.delete(st);states.delete(st.host);}
const icon=paths=>'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths+'</svg>';
function bind(host,view){host._trialCompositionView=view;let st=states.get(host);if(!host.closest('#exploreScenePanel')){
 if(st){st.available=false;st.active=st.dragging=false;syncToolbar(host);st.cancel.hidden=st.overlay.hidden=st.note.hidden=true;redraw(host);}return;}if(st&&(!st.button.isConnected||st.cv!==view.cv)){dispose(st);st=null;
}if(st){update(st);return;}
 const figure=host.querySelector('.aim-look-figure');
 const button=document.createElement('button');button.type='button';button.id='trialCompositionToggle';button.className='trial-composition-action';button.hidden=true;
 const buttonIcon=document.createElement('span');buttonIcon.style.display='contents';const buttonLabel=document.createElement('span');button.append(buttonIcon,buttonLabel);host.append(button);
 // Feedback never participates in the drawing's layout or intercepts a pick.
 const note=document.createElement('p');note.id='trialCompositionStatus';note.className='trial-composition-status';note.hidden=true;note.setAttribute('role','status');note.setAttribute('aria-live','polite');note.setAttribute('aria-atomic','true');
 const noteText=document.createElement('span'),cancel=document.createElement('button');cancel.id='trialCompositionCancel';cancel.type='button';cancel.className='chip';cancel.textContent='やめる';
 Object.assign(cancel.style,{position:'absolute',right:'10px',top:'118px',zIndex:'3',width:'44px',minHeight:'44px',padding:'0',fontSize:'12px',background:'var(--card)',color:'var(--text)'});note.append(noteText);
 Object.assign(note.style,{position:'absolute',left:'12px',right:'64px',top:'12px',zIndex:'3',margin:'0',padding:'8px 12px',border:'1px solid var(--line)',borderRadius:'10px',background:'var(--card)',color:'var(--text)',fontSize:'14px',lineHeight:'1.5',textAlign:'center',pointerEvents:'none'});
 const overlay=document.createElement('div');overlay.setAttribute('aria-hidden','true');Object.assign(overlay.style,{position:'absolute',inset:'0',pointerEvents:'none',overflow:'hidden'});const marker=document.createElement('span'),disc=document.createElement('span');
 Object.assign(marker.style,{position:'absolute',width:'12px',height:'12px',border:'2px solid var(--accent)',borderRadius:'50%',transform:'translate(-50%,-50%)'});
 Object.assign(disc.style,{position:'absolute',border:'2px dashed var(--accent)',borderRadius:'50%',transform:'translate(-50%,-50%)',background:'rgba(180,190,200,.12)'});overlay.append(disc,marker);figure.append(overlay,note,cancel);
 st={normalTouchAction:view.cv.style.touchAction,host,cv:view.cv,button,buttonIcon,buttonLabel,cancel,note,noteText,overlay,marker,disc,active:false,available:false};states.set(host,st);statesList.add(st);
 cancel.onclick=()=>cancelEdit(st);
 button.onclick=ev=>{st.dragging=false;if(!st.active){syncContext();st.beforeEdit=structuredClone(config);st.active=true;st.error='';editing=st;notify();cv.focus({preventScroll:true});return;}
 if(!config.composition||config.compositionInvalid){st.error=pickHint();notify();return;}
 st.active=false;st.error='';editing=null;notify();
 if(globalThis.TrialExplore?.searchCompositionPlaces?.()){st.beforeEdit=null;return;}st.active=true;editing=st;st.error='検索を開始できませんでした。もう一度押してください。';notify();};
 const cv=view.cv;
 function choose(ev){if(!st.active)return;
 const v=host._trialCompositionView,s=syncContext(),r=cv.getBoundingClientRect(),px=(ev.clientX-r.left)*v.W/r.width,py=(ev.clientY-r.top)*v.H/r.height,off=host._lensOffset||[0,0],angle=AstroNotesAlign.viewUnprojector(v.win.az0,v.win.alt0)((px-off[0]*v.W-v.W/2)/v.k,(v.H/2-py+off[1]*v.H)/v.k);
 if(!angle)return;const obs={...v.spec.obs,elevation:v.spec.obs.elevation??0,eyeM:v.spec.eyeM},c=S.pick({azimuth:angle[0],altitude:angle[1],obs,target:s.target,align:AstroNotesAlign,limb:selectedLimb(s)});if(c){config.composition=c;st.invalid=false;config.compositionInvalid=false;
 config.invalidDraft=null;st.error='';}else {
 // A miss does not replace the last exact surface point shown in the drawing.
 st.invalid=!config.composition||config.compositionInvalid;config.compositionInvalid=st.invalid;st.error=st.invalid?pickHint():'';
 }notify();return !!c;}
 for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])cv.addEventListener(type,ev=>{if(!st.active){if(type==='pointerdown')st.suppressClick=false;else if(st.suppressClick){ev.preventDefault();ev.stopImmediatePropagation();}return;}ev.preventDefault();
 ev.stopImmediatePropagation();if(type==='pointerdown'){st.dragging=true;st.pointerStart=[ev.clientX,ev.clientY];st.pointerMoved=false;try{cv.setPointerCapture(ev.pointerId);}catch{/* 既に離れた指は捕まえられないだけ */}}
 // A tap on a thin spire keeps its exact down-point when the finger lifts a few pixels away. Real drags still use exact surface picks.
 if(st.dragging&&st.pointerStart&&Math.hypot(ev.clientX-st.pointerStart[0],ev.clientY-st.pointerStart[1])>6)st.pointerMoved=true;
 if(type==='pointerdown'||st.dragging&&st.pointerMoved&&type!=='pointercancel')choose(ev);if(type==='pointerup'||type==='pointercancel')st.dragging=false;},true);
 cv.addEventListener('click',e=>{if(st.active||st.suppressClick){st.suppressClick=false;e.preventDefault();e.stopImmediatePropagation();}},true);
 cv.addEventListener('keydown',e=>{if(!st.active)return;const dirs={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(!dirs[e.key])return;e.preventDefault();e.stopImmediatePropagation();
 if(!config.composition){if(!firstKeyboardPick(st,choose)){st.error=pickHint();notify();}return;}
 const c=config.composition,v=host._trialCompositionView,s=syncContext(),g=C.geometry({...v.spec.obs,eyeM:v.spec.eyeM},s.target,c,AstroNotesAlign),xy=AstroNotesAlign.viewProjector(v.win.az0,v.win.alt0)(g.azimuth,g.angle),off=host._lensOffset||[0,0],r=cv.getBoundingClientRect(),step=e.shiftKey?10:1;
 choose({clientX:r.left+(v.W/2+xy[0]*v.k+off[0]*v.W+dirs[e.key][0]*step)*r.width/v.W,clientY:r.top+(v.H/2-xy[1]*v.k+off[1]*v.H+dirs[e.key][1]*step)*r.height/v.H});},true);
 update(st);
}
function redraw(host){const st=states.get(host),v=host._trialCompositionView,c=config.composition;if(!st||!v)return;if(st.active){if(!st.wasEditing)st.normalTouchAction=v.cv.style.touchAction;v.cv.style.touchAction='none';st.wasEditing=true;
}else if(st.wasEditing){v.cv.style.touchAction=st.normalTouchAction;st.wasEditing=false;}
st.overlay.hidden=!c||config.compositionInvalid||!st.available||!host.closest('#exploreScenePanel');if(st.overlay.hidden)return;if(!c)return;const s=current();if(!s?.target)return;
const g=C.geometry({...v.spec.obs,eyeM:v.spec.eyeM},s.target,c,AstroNotesAlign),xy=AstroNotesAlign.viewProjector(v.win.az0,v.win.alt0)(g.azimuth,g.angle);if(!xy){st.overlay.hidden=true;return;
}const r=v.cv.getBoundingClientRect(),off=host._lensOffset||[0,0],x=(v.W/2+xy[0]*v.k+off[0]*v.W)*r.width/v.W,y=(v.H/2-xy[1]*v.k+off[1]*v.H)*r.height/v.H,rad=Math.max(2,(host._bodyRadius||.25)*v.k*r.width/v.W);Object.assign(st.marker.style,{left:x+'px',top:y+'px'});
Object.assign(st.disc.style,{left:x+'px',top:(y+(c.limb==='upper'?rad:c.limb==='lower'?-rad:0))+'px',width:2*rad+'px',height:2*rad+'px'});st.disc.hidden=!st.active||!capabilities(s,v.spec.obs).limbs;}
document.addEventListener('keydown', event => {
 const st = editing;
 if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !st?.active) return;
 const scene = st.host.closest('#exploreScenePanel');
 if (!scene || scene.hidden || document.querySelector('dialog[open],#toolsMenu:not([hidden])')) return;
 event.preventDefault();
 event.stopPropagation();
 st.suppressClick = !!st.dragging;
 cancelEdit(st);
}, true);
document.addEventListener('astronotes-preview-leave',()=>{editing=null;for(const st of statesList){if(st.active&&st.beforeEdit)config=structuredClone(st.beforeEdit);
 st.beforeEdit=null;st.active=false;st.dragging=false;st.error='';update(st);}notify();});
globalThis.AstroNotesTrialComposition={bind,redraw,plan,label,clear,capabilities,syncToolbar};const host=document.getElementById('aimLook');if(host?._trialCompositionView)bind(host,host._trialCompositionView);
})();

/* Display labels only: never move a candidate or change its visibility evidence. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateLabels=api;})(globalThis,function(){
'use strict';
const cache=new WeakMap(),rad=Math.PI/180;
const point=p=>p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;
const within=(p,b)=>p.longitude>=b[0]&&p.longitude<=b[2]&&p.latitude>=b[1]&&p.latitude<=b[3];
function inside(r,p){let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>p.latitude)!==(r[j][1]>p.latitude)&&p.longitude<(r[j][0]-r[i][0])*(p.latitude-r[i][1])/(r[j][1]-r[i][1])+r[i][0])yes=!yes;return yes;}
function edgeDistance(r,p){const k=Math.cos(p.latitude*rad);let distance=Infinity;for(let i=1;i<r.length;i++){const a=r[i-1],b=r[i],x=(b[0]-a[0])*k,y=b[1]-a[1],u=Math.max(0,Math.min(1,((p.longitude-a[0])*k*x+(p.latitude-a[1])*y)/(x*x+y*y||1)));
distance=Math.min(distance,Math.hypot((p.longitude-a[0])*k-u*x,p.latitude-a[1]-u*y)*111195);}return distance;}
function prepared(data,kind){
 if(!data||typeof data!=='object')return null;const previous=cache.get(data);if(previous?.kind===kind)return previous.result;
 const ring=r=>Array.isArray(r)&&r.length>=4&&r.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90)&&r[0][0]===r.at(-1)[0]&&r[0][1]===r.at(-1)[1];
 const box=b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]<b[2]&&b[1]<b[3];
 const valid=data.version===1&&data.kind===kind&&Array.isArray(data.coverageBboxes)&&data.coverageBboxes.every(box)&&Array.isArray(data.features)&&data.features.every(f=>typeof f.id==='string'&&typeof f.name==='string'&&f.name.trim()&&f.name.length<=300&&box(f.bbox)&&Array.isArray(f.polygons)&&
 f.polygons.length&&f.polygons.every(p=>Array.isArray(p)&&p.length&&p.every(ring)));
 const result=valid?data:null;cache.set(data,{kind,result});return result;
}
function resolve(data,p,kind){
 data=prepared(data,kind);if(!data||!point(p))return {status:'unavailable',names:[],sourceIds:[]};if(!data.coverageBboxes.some(b=>within(p,b)))return {status:'outside-coverage',names:[],sourceIds:[]};
 const matches=[];let boundary=false;
 for(const f of data.features){if(!within(p,f.bbox))continue;for(const poly of f.polygons){if(!inside(poly[0],p)||poly.slice(1).some(r=>inside(r,p)))continue;if(poly.some(r=>edgeDistance(r,p)<1)){boundary=true;continue;}matches.push(f);break;}}
 const names=[...new Set(matches.map(f=>f.name.trim()))];
 if(boundary&&(kind==='census-town-areas'||!names.length))return {status:'boundary',names:[],sourceIds:[]};
 if(!names.length)return {status:'no-area-match',names:[],sourceIds:[]};
 // An overlapping census area is ambiguous, not a reason to choose the nearest name.
 if(kind==='census-town-areas'&&names.length!==1)return {status:'ambiguous',names:[],sourceIds:[]};
 return {status:'matched',names,sourceIds:matches.map(f=>f.id)};
}
function enrich(row,{addresses=null,facilities=null}={}){
 const p=row.place,address=resolve(addresses,p,'census-town-areas'),facility=resolve(facilities,p,'osm-named-areas');
 const area=address.status==='matched'?address.names[0]:'',fallback=facility.status==='matched'?facility.names.join('／'):area;
 const riverName=row.placeKind==='riverbank'&&typeof row.sourceEvidence?.riverName==='string'?row.sourceEvidence.riverName.trim():'';
 let name=p.name;
 if(riverName&&(!name||name==='河川沿いの歩道'||/^(?:撮影候補|モデル候補)/.test(name)))name=riverName+'沿いの歩道';
 else if(fallback&&(!name||/^(?:撮影候補|モデル候補)/.test(name)))name=fallback+'（モデル候補）';
 return {...row,place:{...p,name,subtitle:area,...(riverName?{riverName}:{})},labels:{address,facility,coordinate:point(p)?p.latitude.toFixed(5)+', '+p.longitude.toFixed(5):'',addressYear:addresses?.year??null,facilityDataDate:facilities?.dataDate??null}};
}
function townFiles(index,p){
 if(index?.version!==1||!Array.isArray(index.wards)||!point(p))return [];
 return index.wards.filter(ward=>/^\d{5}\.json$/.test(ward?.file)&&/^[0-9a-f]{64}$/.test(ward.sha256)&&
  Array.isArray(ward.bbox)&&ward.bbox.length===4&&ward.bbox.every(Number.isFinite)&&within(p,ward.bbox));
}
function townAddress(layers,p){
 const matches=layers.map(layer=>resolve(layer,p,'census-town-areas'));
 if(matches.some(r=>['boundary','ambiguous','unavailable'].includes(r.status)))return null;
 const found=matches.filter(r=>r.status==='matched');
 if(new Set(found.flatMap(r=>r.names)).size!==1)return null;
 return {status:'matched',names:found[0].names,sourceIds:found.flatMap(r=>r.sourceIds)};
}
// Roads are display context, not permission to stand or evidence of visibility.
// Decode just the two line layers. The calculation bundle and its cache key stay unchanged.
function roadLines(bytes){
 const u=new Uint8Array(bytes),text=new TextDecoder();let p=0;
 const vi=()=>{let n=0,s=0;for(let i=0;i<10&&p<u.length;i++){const b=u[p++];n+=(b&127)*2**s;if(b<128)return n;s+=7;}throw Error('road-varint');};
 const end=()=>{const n=vi(),e=p+n;if(e>u.length)throw Error('road-length');return e;};
 const skip=w=>{if(w===0)vi();else if(w===1)p+=8;else if(w===2)p=end();else if(w===5)p+=4;else throw Error('road-wire');if(p>u.length)throw Error('road-truncated');};
 const str=()=>{const e=end(),s=text.decode(u.subarray(p,e));p=e;return s;},zz=n=>(n>>>1)^-(n&1),out={};
 while(p<u.length){const t=vi();if(t!==26){skip(t&7);continue;}const le=end(),rows=[],keys=[],values=[];let name='',extent=4096;
  while(p<le){const t=vi(),f=t>>3,w=t&7;
   if(f===1&&w===2)name=str();
   else if(f===5&&w===0)extent=vi();
   else if(f===3&&w===2)keys.push(str());
   else if(f===4&&w===2){const ve=end();let v=null;while(p<ve){const t=vi(),f=t>>3,w=t&7;if(f===1&&w===2)v=str();else if([4,5,6,7].includes(f)&&w===0){v=vi();if(f===6)v=zz(v);}else skip(w);}values.push(v);}
   else if(f===2&&w===2){const fe=end(),tags=[],geom=[];let type=0;
    while(p<fe){const t=vi(),f=t>>3,w=t&7;if(f===3&&w===0)type=vi();else if((f===2||f===4)&&w===2){const e=end(),a=f===2?tags:geom;while(p<e)a.push(vi());}else skip(w);}
    if(type===2)rows.push({tags,geom});
   }else skip(w);
  }
  if(name!=='RdCL'&&name!=='RdEdg')continue;
  if(!(extent>0&&extent<=65536))throw Error('road-extent');
  out[name]={extent,features:rows.map(({tags,geom})=>{const attrs={};for(let i=0;i<tags.length;i+=2)attrs[keys[tags[i]]]=values[tags[i+1]];
   const lines=[];let x=0,y=0,line=null;for(let i=0;i<geom.length;){const c=geom[i++],id=c&7,count=c>>3;if(![1,2].includes(id)||count>geom.length)throw Error('road-command');
    for(let j=0;j<count;j++){if(i+1>=geom.length)throw Error('road-geometry');x+=zz(geom[i++]);y+=zz(geom[i++]);if(id===1){line=[];lines.push(line);}if(!line)throw Error('road-line');line.push([x/extent,y/extent]);}}
   return {attrs,lines};})};
 }
 return out;
}
const tileXY=p=>[(p.longitude+180)/360*65536,(1-Math.asinh(Math.tan(p.latitude*rad))/Math.PI)/2*65536];
function roadMatch(p,tiles){
 if(!point(p)||!tiles.length||tiles.some(t=>!t))return null;
 const [x,y]=tileXY(p),scale=Math.cos(p.latitude*rad)*40075016.686/65536,lines=[],edges=[];
 for(const t of tiles){
  const px=x-t.x,py=y-t.y;
  // Never turn a roof or water polygon into a ground road.
  if(inTileArea(t.water,px,py)||inTileArea(t.buildings,px,py))return null;
  for(const [layer,out]of [[t.roads.RdCL,lines],[t.roads.RdEdg,edges]])for(const f of layer?.features||[]){
   if(f.attrs.vt_lvorder!=null&&f.attrs.vt_lvorder!==0)continue;
   if(out===lines&&f.attrs.vt_code!==2701)continue; // normal ground roads only; no bridges or tunnels
   for(const l of f.lines)out.push({attrs:f.attrs,points:l.map(q=>[(q[0]+t.x-x)*scale,(q[1]+t.y-y)*scale])});
  }
 }
 // The map's vt_width is a drawing width, not a measured safe corridor. Require
 // real road edges on both sides of the centreline and the point between them.
 const nearest=points=>{let best=null;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy;if(!d)continue;
  const t=Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/d)),q=[a[0]+t*dx,a[1]+t*dy],distance=Math.hypot(...q);
  if(!best||distance<best.distance)best={q,distance,interior:t>0&&t<1,direction:[dx/Math.sqrt(d),dy/Math.sqrt(d)],normal:distance>1e-6?[-q[0]/distance,-q[1]/distance]:[-dy/Math.sqrt(d),dx/Math.sqrt(d)]};}return best;};
 const candidates=lines.map(l=>({...l,near:nearest(l.points)})).filter(l=>l.near?.interior&&l.near.distance<30).sort((a,b)=>a.near.distance-b.near.distance);
 const widths={'3m未満':[0,3],'3m-5.5m未満':[3,5.5],'5.5m-13m未満':[5.5,13],'13m-19.5m未満':[13,19.5],'19.5m以上':[19.5,60]};
 for(const l of candidates){const {q,normal:v,distance,direction}=l.near,range=widths[l.attrs.vt_rnkwidth];if(!range)continue;let left=-Infinity,right=Infinity;
  for(const edge of edges)for(let i=1;i<edge.points.length;i++){const a=edge.points[i-1],b=edge.points[i],dx=b[0]-a[0],dy=b[1]-a[1],den=v[0]*dy-v[1]*dx;if(Math.abs(den)<1e-8)continue;
   if(Math.abs(direction[0]*dx+direction[1]*dy)<Math.hypot(dx,dy)*Math.cos(Math.PI/6))continue;
   const ax=a[0]-q[0],ay=a[1]-q[1],t=(ax*dy-ay*dx)/den,u=(ax*v[1]-ay*v[0])/den;
   if(u<0||u>1||Math.abs(t)>30)continue;if(t>=0)right=Math.min(right,t);else left=Math.max(left,t);
  }
  const width=right-left;
  if(Number.isFinite(width)&&width>=range[0]&&width<=range[1]&&Math.abs(right+left)<=Math.max(2,.35*width)&&
   left<-.5&&right>.5&&distance<=right-.3)return {kind:'road',source:'gsi-road-edges',distanceM:distance};
 }
 return null;
}
function inTileArea(area,x,y){
 if(!area)return false;const px=x*area.extent,py=y*area.extent;
 return area.polys.some(rings=>{let inside=false;for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[i],b=ring[j];if((a[1]>py)!==(b[1]>py)&&px<(b[0]-a[0])*(py-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }return inside;});
}
// Facility context uses the same complete OSM geometry as candidate discovery.
// A nearby park name or viewpoint is not proof that the observer is inside it.
function facilityMatch(p,features){
 if(!point(p))return null;const kinds=new Set(),sourceIds=[];
 for(const f of features||[]){
  if(f.geometryIncomplete)continue;
  const t=f.tags||{},kind=t.tourism==='viewpoint'||t['tower:type']==='observation'?'viewpoint':t.place==='square'?'plaza':t.leisure==='garden'?'garden':['park','recreation_ground'].includes(t.leisure)?'park':null;
  if(!kind)continue;
  const area=f.polygons?.some(poly=>inside(poly[0],p)&&!poly.slice(1).some(r=>inside(r,p))&&poly.every(r=>edgeDistance(r,p)>=1));
  const exact=f.position&&Math.hypot((p.longitude-f.position.longitude)*Math.cos(p.latitude*rad),p.latitude-f.position.latitude)*111195<=1;
  if(area||exact){kinds.add(kind);sourceIds.push(f.id);}
 }
 return kinds.size?{kind:[...kinds][0],kinds:[...kinds],source:'osm-facility-geometry',sourceIds}:null;
}
function createRoadContext({fetchImpl=fetch,decodeAreas,loadFacilities=null,now=Date.now,base='https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/16/'}={}){
 const tiles=new Map(),points=new Map(),jobs=new Map(),failedUntil=new Map(),key=p=>p.latitude+','+p.longitude;
 const ground=p=>point(p)&&!p.nonTerrainStructure&&(p.standAglM??p.eyeHeightAGL??p.eyeM??1.5)>=0&&(p.standAglM??p.eyeHeightAGL??p.eyeM??1.5)<=3&&Math.abs(p.latitude)<85;
 async function tile(x,y){
  const k=x+'/'+y;if(tiles.has(k))return tiles.get(k);if((failedUntil.get(k)||0)>now())throw Error('road-retry-later');
  const job=(async()=>{const r=await fetchImpl(base+k+'.pbf',{priority:'low',signal:globalThis.AbortSignal?.timeout?.(8000)});if(!r.ok)throw Error('road-tile');
   const b=await r.arrayBuffer();if(b.byteLength>2000000)throw Error('road-size');return {x,y,roads:roadLines(b),water:decodeAreas(new Uint8Array(b),'WA'),buildings:decodeAreas(new Uint8Array(b),'BldA')};})();
  tiles.set(k,job);if(tiles.size>48)tiles.delete(tiles.keys().next().value);
  try{const value=await job;failedUntil.delete(k);return value;}catch(e){if(tiles.get(k)===job)tiles.delete(k);failedUntil.set(k,now()+5000);if(failedUntil.size>48)failedUntil.delete(failedUntil.keys().next().value);throw e;}
 }
 function peek(p){return ground(p)?points.get(key(p))||null:null;}
 async function read(p){
  if(!ground(p))return null;const k=key(p);if(points.has(k))return points.get(k);if(jobs.has(k))return jobs.get(k);
  const job=(async()=>{
   // A failed facility read must not block existing roads or permanently cache a
   // weaker road/null result. Reuse tile reads and retry the facility after cooldown.
   let facilityFailed=false;const fk='facility/'+k;
   if(loadFacilities){
    if((failedUntil.get(fk)||0)>now())facilityFailed=true;
    else try{const value=facilityMatch(p,await loadFacilities(p));failedUntil.delete(fk);if(value){points.set(k,value);if(points.size>512)points.delete(points.keys().next().value);return value;}}
    catch{facilityFailed=true;failedUntil.set(fk,now()+5000);if(failedUntil.size>48)failedUntil.delete(failedUntil.keys().next().value);}
   }
   const [x,y]=tileXY(p),pad=65/(Math.cos(p.latitude*rad)*40075016.686/65536),pending=[];
   for(let ix=Math.floor(x-pad);ix<=Math.floor(x+pad);ix++)for(let iy=Math.floor(y-pad);iy<=Math.floor(y+pad);iy++)pending.push(tile(ix,iy));
   const data=await Promise.all(pending),value=roadMatch(p,data);if(!facilityFailed){points.set(k,value);if(points.size>512)points.delete(points.keys().next().value);}return value;
  })();jobs.set(k,job);try{return await job;}catch{return null;}finally{jobs.delete(k);}
 }
 return {read,peek};
}
return {resolve,enrich,edgeDistance,townFiles,townAddress,roadLines,roadMatch,facilityMatch,createRoadContext};
});

// Trial-only candidate presentation. A row keeps its evidence and selection handler.
(()=>{
'use strict';
const names={viewpoint:'展望地点',park:'公園',plaza:'広場',riverbank:'河川敷',garden:'庭園',facility:'その他の施設',road:'道路・歩道',unknown:'種類未確認'};
const photoOrder={normal:0,conditional:1,unfavorable:2,unknown:3};
// 2026-11-13 ユーザーの選択: おすすめ順は構図の良さで並べる。見える部分の割合、周りの地面より高いこと（20mで満点）、背景のすっきり
// （対象の横の空に他のビルが出ていない方位の割合）。2026-11-14 ユーザー「月との比率はいらないよ」: 天体の大きさの比は使わない。
function compositionScore(row){
 // A surveyed place (調査で確認) is the best there is: it was looked up as seeing the target.
 if(row.quality?.surveyed)return 1;
 const c=row.quality?.composition;if(!c)return null;const parts=[];
 if(Number.isFinite(c.visibleFraction))parts.push(c.visibleFraction);
 if(Number.isFinite(c.heightGainM))parts.push(Math.max(0,Math.min(1,c.heightGainM/20)));
 if(Number.isFinite(c.cleanSky))parts.push(c.cleanSky);
 return parts.length?parts.reduce((a,b)=>a+b,0)/parts.length:null;
}
// The same in words under the row: what shows, how high the place stands, the sky beside it.
function compositionText(row){
 const c=row.quality?.composition;if(!c)return '';const out=[];
 if(Number.isFinite(c.visibleFraction))out.push('見える部分'+Math.round(c.visibleFraction*100)+'%');
 if(Number.isFinite(c.heightGainM)&&c.heightGainM>=3)out.push('周りより'+Math.round(c.heightGainM)+'m高い');
 if(Number.isFinite(c.cleanSky))out.push(c.cleanSky>=.75?'背景すっきり':c.cleanSky<=.35?'横に他のビル':'');
 return out.filter(Boolean).join(' ・ ');
}
const preferred=new Set(['viewpoint','park','plaza','riverbank']);
function kinds(row,facilities){
 const result=new Set(),declared=Array.isArray(row.placeKind)?row.placeKind:[row.placeKind];
 for(const type of declared)if(Object.hasOwn(names,type)&&type!=='unknown')result.add(type);
 const p=positionPlace(row),same=p?.latitude===row.place?.latitude&&p?.longitude===row.place?.longitude;
 const ids=same&&row.labels?.facility?.status==='matched'?row.labels.facility.sourceIds:globalThis.AstroNotesCandidateLabels?.resolve(facilities,p,'osm-named-areas')?.sourceIds;
 for(const f of facilities?.features||[]){if(!ids?.includes(f.id))continue;const t=f.tags||{};
  result.add(t.tourism==='viewpoint'?'viewpoint':t.leisure==='park'?'park':t.place==='square'?'plaza':t.leisure==='garden'?'garden':'facility');
 }
 // A source ID alone is not proof that a newly generated park is a road.
 if(!result.size&&row.assumedObserver?.sourceId&&row.modelEvidence?.kind==='terrain-and-building-model-los')result.add('road');
 if(!result.size){const context=ports.placeContext?.peek(positionPlace(row));for(const kind of context?.kinds||[context?.kind])if(kind&&kind!=='unknown'&&Object.hasOwn(names,kind))result.add(kind);}
 return result.size?[...result].sort((a,b)=>Object.keys(names).indexOf(a)-Object.keys(names).indexOf(b)):['unknown'];
}
function accepts(row,time,kind,types,events){return (kind==='all'||types.includes(kind))&&(time==='all'||Number.isFinite(row.event?.at)&&!!events?.some(e=>e.kind===time&&Math.abs(row.event.at-e.at)<=3600000));}
const placePriority=types=>types.some(t=>preferred.has(t))?0:types.some(t=>t==='garden'||t==='facility')?1:types.includes('road')?2:3;
function rankCompare(a,b){
 const ranks=r=>Array.isArray(r.rank)?r.rank:[r.rank],aa=ranks(a),bb=ranks(b);
 for(let i=0;i<Math.max(aa.length,bb.length);i++){const x=Number.isFinite(aa[i])?aa[i]:Infinity,y=Number.isFinite(bb[i])?bb[i]:Infinity;if(x!==y)return x<y?-1:1;}return 0;
}
function candidateKey(row){
 const p=positionPlace(row)||{},o=row.assumedObserver||{};
 // Preserve height and exact time: different decks or different opportunities do not merge.
 return JSON.stringify([p.latitude,p.longitude,p.surfaceId??row.surfaceId??null,p.groundManualM??p.elevation??o.elevation??null,p.standAglM??p.eyeHeightAGL??o.eyeM??null,p.stand??null,row.event?.at,row.event?.partId??null,row.event?.matchMode??null]);
}
// How far one looks up at the target from the place (deg); unknown last.
const angleOf=row=>Number.isFinite(row.quality?.targetAngleDeg)?row.quality.targetAngleDeg:Infinity;
function compare(a,b,sort='recommended'){
 let primary=0;
 if(sort==='recommended'){
  // 2026-11-11 ユーザー「高いのも出て欲しい時はある」「他と混ぜて並べる」: views looking up steeply are no longer put last.
  const sa=compositionScore(a.row),sb=compositionScore(b.row),bucket=v=>v===null?-1:Math.round(v*20);
  primary=(photoOrder[a.row.quality?.photographyClass]??3)-(photoOrder[b.row.quality?.photographyClass]??3)
   ||bucket(sb)-bucket(sa)||placePriority(a.types)-placePriority(b.types)||rankCompare(a.row,b.row);
 }else{
  const key=sort.replace(/-desc$/,''),direction=sort.endsWith('-desc')?-1:1;
  primary=direction*(key==='name'?String(a.row.place?.name||'').localeCompare(String(b.row.place?.name||''),'ja',{numeric:true}):key==='kind'?Object.keys(names).indexOf(a.types[0])-Object.keys(names).indexOf(b.types[0]):key==='angle'?angleOf(a.row)-angleOf(b.row):a.row.event.at-b.row.event.at);
 }
 return primary||(a.row.event.at-b.row.event.at)||String(a.id||'').localeCompare(String(b.id||''))||a.index-b.index;
}
function mergeEntries(entries,sort){
 const unique=new Map();
 for(const e of entries){const key=candidateKey(e.row),previous=unique.get(key);
  // Merge only identical (p,t,h). Use one existing row; never combine evidence into a stronger claim.
  if(!previous||(previous.show===false&&e.show!==false)||(previous.show===false)===(e.show===false)&&compare(e,previous,'recommended')<0)unique.set(key,e);
 }
 // 2026-11-12 実機: 同じ公園や川沿いで30m隣の点が、同じ名前・同じ分・同じ種類のまま2行ずつ並び、見分けがつかなかった。
 // 2026-11-14 ユーザー「同じような地点が複数出てたり」「エリア化から」: 計測（太陽×東京スカイツリー 11/20）で107行が
 // 300m以内のまとまり9つだった。隣の点は重なる時刻が数秒〜数分ずれるだけで、同じ公園の中を歩けば時刻は続けて移る。
 // おすすめ順が上の行をエリアの中心にし、同じ種類で、中心からAREA_M以内・立つ高さの差AREA_RISE_M以内、時刻がエリアの時刻の幅から
 // AREA_MS以内の行をそのエリアにまとめる。名前は見ず、種類は1つでも同じならよい（同じ岸の「河川沿いの歩道」と、公園の名前で公園・河川敷の
 // 両方が付く行が並んでいた）。高さの差はAREA_RISE_Mまで（同じ公園の斜面で5m強違う隣の点が分かれた。展望台の床と地上は
 // これより離れる）。AREA_MSは1時間（対象のすぐ近くでは、70m隣の点の時刻が25分ずれて別の行になった。朝と夕方は何時間も
 // 離れる）。時刻が続かない朝と夕方、別の高さ、別の種類は別のエリア。
 // エリアで出す行（代表）は、対象が一番下まで見える立ち位置（ユーザー「土手の上を候補に出せばいいのに土手の下とかを候補に
 // 出して」）: 隠れる高さがAREA_SEES_M以上低い行があればそちらを代表にし、差がなければおすすめ順が上の行。代表は自分の根拠
 // だけを持ち、エリアは立つ位置の数と時刻の幅だけを持つ。調査済みの地点（quality.surveyed）は、名前と立つ高さを調べてあるので、
 // 同じ場所の探索で見つけた行と種類が違ってもまとめ、代表にする（ユーザー「重複しないような何かを考えて」）。
 // The height one stands at: the ground and the floor above it (a deck's floor and the ground below it are two areas).
 const standM=e=>{const p=positionPlace(e.row)||{},g=p.groundManualM??p.elevation,up=p.standAglM??p.eyeHeightAGL??1.5;return (Number.isFinite(g)?g:0)+(Number.isFinite(up)?up:0);};
 // How high up the target is hidden from the place (m); nothing hidden is the best there is.
 const hiddenM=e=>Number.isFinite(e.row.quality?.hiddenBelow?.m)?e.row.quality.hiddenBelow.m:-Infinity,sees=(a,b)=>surveyed(a)!==surveyed(b)?(surveyed(a)?a:b):hiddenM(a)<hiddenM(b)-AREA_SEES_M?a:b;
 const kept=[],timeOf=e=>Number.isFinite(e.row.event?.at)?e.row.event.at:null,spot=e=>{const p=positionPlace(e.row);return p?.latitude+','+p?.longitude;};
 const surveyed=e=>!!e.row.quality?.surveyed;
 const sameRun=(a,b)=>{
  const x=a.row.spatialWindow,y=b.row.spatialWindow;if(!x&&!y)return true;
  const source=e=>e.row.place.sourcePlaceId??e.row.place.id,eye=e=>e.row.assumedObserver?.eyeM??e.row.place.standAglM??e.row.place.eyeHeightAGL;
  return !!x&&!!y&&x.id===y.id&&source(a)===source(b)&&eye(a)===eye(b);
 };
 const sameBank=(a,b)=>{
  const x=a.row.sourceEvidence?.riverBank,y=b.row.sourceEvidence?.riverBank;if(!x||!y||x.river!==y.river)return true;
  const p=positionPlace(a.row),q=positionPlace(b.row),side=(p,axis)=>(axis[1][0]-axis[0][0])*(p.latitude-axis[0][1])-(axis[1][1]-axis[0][1])*(p.longitude-axis[0][0]);
  return x.axis&&y.axis?[x.axis,y.axis].every(axis=>side(p,axis)*side(q,axis)>=0):x.side===y.side;
 };
 const near=(k,e)=>sameRun(k.e,e)&&sameBank(k.e,e)&&(surveyed(k.e)||surveyed(e)||k.e.types.some(t=>e.types.includes(t)))&&metres(positionPlace(k.e.row),positionPlace(e.row))<=AREA_M
  &&!(Math.abs(standM(k.e)-standM(e))>AREA_RISE_M);
 const touches=(k,from,to)=>k.fromAt===null?from===null:from!==null&&from<=k.toAt+AREA_MS&&to>=k.fromAt-AREA_MS;
 for(const e of [...unique.values()].sort((a,b)=>(a.show===false)-(b.show===false)||compare(a,b,'recommended'))){
  const at=timeOf(e),home=kept.find(k=>near(k,e)&&touches(k,at,at));
  if(!home){kept.push({e,best:e,members:[e],spots:new Set([spot(e)]),fromAt:at,toAt:at});continue;}
  // A row the filters hide does not widen what the shown representative says.
  if((home.e.show===false)!==(e.show===false))continue;
  home.members.push(e);home.spots.add(spot(e));home.best=sees(e,home.best);if(at!==null){home.fromAt=Math.min(home.fromAt,at);home.toAt=Math.max(home.toAt,at);}
 }
 // Areas whose times have grown to meet join the better-ranked one (kept is in recommended order).
 for(let again=true;again;){again=false;
  for(let i=0;i<kept.length&&!again;i++)for(let j=i+1;j<kept.length;j++){const a=kept[i],b=kept[j];
   if((a.e.show===false)!==(b.e.show===false)||!near(a,b.e)||!touches(a,b.fromAt,b.toAt))continue;
   a.members.push(...b.members);for(const p of b.spots)a.spots.add(p);a.best=sees(b.best,a.best);if(b.fromAt!==null){a.fromAt=Math.min(a.fromAt,b.fromAt);a.toAt=Math.max(a.toAt,b.toAt);}kept.splice(j,1);again=true;break;}
 }
 for(const k of kept){areas.set(k.best,{count:k.spots.size,fromAt:k.fromAt,toAt:k.toAt});areaMembers.set(k.best,k.members);}
 return kept.map(k=>k.best).sort((a,b)=>compare(a,b,sort));
}
// The area a representative stands for (mergeEntries): how many places it gathers and the span of their times.
const AREA_M=300,AREA_RISE_M=10,AREA_MS=60*60000,AREA_SEES_M=10,areas=new WeakMap(),areaOf=entry=>areas.get(entry)||null;
const areaMembers=new WeakMap(),previewGroups=new WeakMap(),recordedMembers=new WeakMap();
const membersOf=entry=>areaMembers.get(entry)||[entry],previewFor=row=>previewGroups.get(row)||null;
const positionPlace=row=>typeof AstroNotesShooting!=='undefined'&&AstroNotesShooting.candidatePlace?AstroNotesShooting.candidatePlace(row):row.place;
const positionKey=row=>candidateKey({...row,place:positionPlace(row),event:{...row.event,partId:null,matchMode:null}});
function areaText(area){
 if(!area)return '';const clock=at=>new Date(at+32400000).toISOString().slice(11,16);
 const from=Number.isFinite(area.fromAt)?clock(area.fromAt):'',to=Number.isFinite(area.toAt)?clock(area.toAt):'',span=from&&to&&from!==to?from+'〜'+to:'';
 // One place with several times still says its times; one place with one time says nothing.
 return area.count>1?'この付近'+area.count+'地点'+(span?' ・ '+span:''):span;
}
// 2026-11-14 ユーザー「重複しないような何かを考えて」: 新しい撮影地点には自分の記録に無い場所だけを出す。記録の撮影地点から
// RECORD_M以内で、立つ高さ（足元＋その上の高さ）の差がRECORD_RISE_M以内の行は、記録の撮影地点の側に出るので出さない。
const RECORD_M=100,RECORD_RISE_M=10;
// The foreground quota counts new places, not several times at one place.
// Reuse the list's height, opposite-bank and area rules without changing any
// real event or the entries that the list presents.
function countNewPlaces(rows,places,facilities){
 const entries=rows.filter(row=>!inRecords(row,places)).map((row,index)=>({row:{...row,event:{...row.event,at:0}},types:kinds(row,facilities),show:true,index}));
 return mergeEntries(entries,'recommended').length;
}
function inRecords(row,places){
 const p=row?.place,o=row?.assumedObserver||{};if(!p||!Array.isArray(places)||!places.length)return false;
 const ground=p.groundManualM??p.elevation??o.elevation,up=p.standAglM??p.eyeHeightAGL??o.eyeM,stand=Number.isFinite(ground)&&Number.isFinite(up)?ground+up:null;
 return places.some(f=>{if(!(metres(f,p)<=RECORD_M))return false;const g=f.groundManualM??f.elevation,h=f.standAglM??f.eyeHeightAGL;
  if(stand===null||!Number.isFinite(g)||!Number.isFinite(h))return !Number.isFinite(up)||!Number.isFinite(h)||Math.abs(up-h)<=RECORD_RISE_M;
  return Math.abs(stand-(g+h))<=RECORD_RISE_M;});
}
// Only this provider's fixed surveyed wrapper has the same (position, height)
// before and after solving. A surface seed may move and must never use this.
function fixedSurveyedInRecords(point,targetId,places){
 const shape=point?.surfaceGeometry,source=point?.sourceEvidence,id='surveyed/'+source?.sourceId;
 if(source?.kind!=='surveyed-viewpoint'||point.quality!=='surveyed-viewpoint'||point.sourceId!==id||point.surfaceId!==id||point.standingSurfaceKnown!==true
  ||!targetId||!Array.isArray(point.surveyedTargets)||!point.surveyedTargets.includes(targetId)||!shape||!Array.isArray(shape.lines)||!Array.isArray(shape.polygons)||shape.lines.length||shape.polygons.length
  ||shape.position?.latitude!==point.latitude||shape.position?.longitude!==point.longitude||point.surfaceAglM!==0
  ||point.surfaceElevationM!=null||point.standingElevationM!=null||point.surfaceHeightM!=null&&point.surfaceHeightM!==0||point.heightBasis==='constant-absolute-floor'
  ||![point.latitude,point.longitude,point.groundM,point.eyeM].every(Number.isFinite)||point.eyeM<0)return false;
 return inRecords({place:{latitude:point.latitude,longitude:point.longitude,elevation:point.groundM,groundManualM:point.groundM,standAglM:point.eyeM,eyeHeightAGL:point.eyeM}},places);
}
function metres(a,b){
 if(![a?.latitude,a?.longitude,b?.latitude,b?.longitude].every(Number.isFinite))return Infinity;
 const r=Math.PI/180,x=(b.longitude-a.longitude)*r*Math.cos((a.latitude+b.latitude)*r/2),y=(b.latitude-a.latitude)*r;return Math.hypot(x,y)*6371008.8;
}
const groups=new Map(),windows=new Map(),boundNodes=new WeakSet();
// The list opens in time order (2026-11-11 ユーザー「並びのデフォルトを時刻順で」); おすすめ順 stays one tap away.
let control=null,list=null,scope='',filterScope='',revision=AstroNotesLibrary.gate(),loadLabels=async()=>({}),ports={},time='all',kind='all',sort='time';
let visibleEntries=[],selectedId=null,mapPanel=null,mapInstance=null,mapMode=false,mapHits=[],mapScroll=null,mapFitPending=false,suspendedView=null;
let compactMode=false,refinementOpen=false;
const columns='minmax(0,1fr) 50px 64px 70px';
const refinementIcon='<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+
 '<path d="M4 7h6m4 0h6M4 12h10m4 0h2M4 17h2m4 0h10"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="17" r="2"/></svg>';
const sortOptions=[['time','早い時刻順'],['time-desc','遅い時刻順'],['recommended','おすすめ順'],['name','地点名順'],['name-desc','地点名の逆順'],
 ['kind','種類順'],['kind-desc','種類の逆順'],['angle','低い角度順'],['angle-desc','高い角度順']];
const day=at=>globalThis.AstroNotesCandidateDiscovery?.day(at)??Math.floor((at+32400000)/86400000)*86400000-32400000;
const clockText=at=>Number.isFinite(at)?new Date(at+32400000).toISOString().slice(11,16):'時刻未確認';
const uncertainty=row=>[row.record?.result==='partial'?'一部見える対象':'',row.quality?.surveyed?'調査で確認':'',row.quality?.hiddenBelow?.text||'',
 row.quality?.visibility==='unknown'?'見通し未確認':'',row.quality?.buildingHeights==='estimated'?'建物の高さは推定':'',row.quality?.trees==='unread'?'木の高さ未確認':'',row.frame?.status==='unknown'?'全体の画角未確認':''].filter(Boolean);
function configure(value){if(typeof value==='function')loadLabels=value;else if(value){ports={...ports,...value};if(typeof value.loadLabels==='function')loadLabels=value.loadLabels;}}
function planKey(plan){return typeof ports.requestKey==='function'?ports.requestKey(plan):JSON.stringify([plan.requestKey,plan.owner,plan.body,plan.target,plan.partId,plan.limb,plan.matchMode,plan.composition,plan.compositionInvalid,plan.timeSpec||null,day(plan.at),plan.atmosphere,
plan.cameraHeight]);}
function locationText(row){
 const {name,riverName,subtitle}=row.place;
 const address=row.labels?.address?.status==='matched'||row.record&&subtitle?subtitle:row.placeKind==='riverbank'||row.record?row.labels?.coordinate:null;
 const river=riverName&&!name?.includes(riverName)?riverName:null;
 return [river,address].filter(Boolean).join(' ・ ');
}
// One display policy for the list, map details and position choices. Reuse the
// solved body direction; projecting named target points never solves an event.
const partProjections=new WeakMap();
const partName=part=>part.name.replace(/（[^）]*）/g,'').replace(/の上端$/,'').trim();
const mountain=target=>!!(ports.isMountain?.(target)||target?.rim||target?.kind==='mountain'||target?.id==='fuji'||target?.parts?.length===1&&Math.abs(target.parts[0].m-target.groundM)<.5);
function projectedParts(row,plan,geometryFrom=ports.geometryFrom){
 const e=row.event,p=positionPlace(row),t=plan.target;
 if(!e||!p||!t||!geometryFrom||plan.matchMode==='limb'||plan.composition||e.composition||!['sun','moon'].includes(plan.body)||mountain(t)||
  plan.partId&&plan.partId!=='__whole'||![e.altitude,e.azimuth,e.radius,p.latitude,p.longitude,p.groundManualM??p.elevation].every(Number.isFinite)||e.radius<=0)return [];
 const o={...p,elevation:p.groundManualM??p.elevation,eyeM:p.standAglM??p.eyeHeightAGL??1.5};
 const key=JSON.stringify([t.id,t.latitude,t.longitude,t.groundM,t.parts,o.latitude,o.longitude,o.elevation,o.eyeM,ports.geometryKey?.(),e.altitude,e.azimuth,e.radius,e.targetAltitude]);
 const cached=partProjections.get(e);if(cached?.key===key&&cached.geometryFrom===geometryFrom)return cached.parts;
 const parts=(t.parts||[]).filter(p=>typeof p.name==='string'&&p.name.trim()).map(part=>({part,g:geometryFrom(o,t,{partId:part.id,eyeM:o.eyeM})})).filter(p=>[p.g?.angle,p.g?.azimuth].every(Number.isFinite));
 // The event's reference angle belongs to its solver settings. Only transfer
 // relative part heights, rather than silently applying today's atmosphere.
 const reference=parts.find(p=>p.part.id===t.parts?.[0]?.id),shift=reference&&Number.isFinite(e.targetAltitude)?e.targetAltitude-reference.g.angle:0,rad=Math.PI/180;
 for(const p of parts){p.angle=p.g.angle+shift;const a=e.altitude*rad,b=p.angle*rad,d=(e.azimuth-p.g.azimuth)*rad;
  p.score=Math.acos(Math.max(-1,Math.min(1,Math.sin(a)*Math.sin(b)+Math.cos(a)*Math.cos(b)*Math.cos(d))))/rad/e.radius;}
 partProjections.set(e,{key,geometryFrom,parts});return parts;
}
function wholePassage(row,plan,parts){
 if(plan.matchMode!=='overlap'||plan.partId&&plan.partId!=='__whole'||mountain(plan.target)||plan.composition||row.event?.composition)return '';
 const e=row.event;if(!['sun','moon'].includes(plan.body)||!Number.isFinite(e?.radius)||e.radius<=0)return '';
 const near=parts.filter(p=>p.score<=1).sort((a,b)=>a.score-b.score)[0];
 if(near)return partName(near.part)+'付近を通過';
 const levels=[...parts].sort((a,b)=>b.angle-a.angle);
 const vertical=levels.length>1&&levels.every(p=>metres({latitude:p.part.latitude??plan.target.latitude,longitude:p.part.longitude??plan.target.longitude},
  {latitude:levels[0].part.latitude??plan.target.latitude,longitude:levels[0].part.longitude??plan.target.longitude})<=5)&&levels[0].angle-levels.at(-1).angle>0;
 if(vertical&&Number.isFinite(e.altitude)){
  const below=levels.findIndex(p=>e.altitude>=p.angle);
  if(below>0)return partName(levels[below-1].part)+'と'+partName(levels[below].part)+'の間を通過';
  if(below<0)return partName(levels.at(-1).part)+'より下を通過';
 }
 const v=e.targetPosition;if(!v||![v.x,v.y].every(Number.isFinite))return '';
 if(v.y>=.9)return 'てっぺん付近を通過';
 const x=v.x<1/3?'左':v.x>2/3?'右':'',y=v.y<1/3?'下部':v.y>2/3?'上部':'中央';
 return (x?y+'の'+x+'寄り':y+'付近')+'を通過';
}
function passageOf(row,plan){
 if(!plan?.target)return '';
 const e=row.event||{},part=plan.target.parts?.find(p=>p.id===plan.partId)||(!plan.partId?plan.target.parts?.[0]:null);
 if(plan.matchMode==='limb')return ports.alignmentText?.(plan.target,plan)||'旧条件の候補';
 const whole=wholePassage(row,plan,projectedParts(row,plan));if(whole)return whole;
 const passage=typeof AstroNotesShooting==='undefined'?'':AstroNotesShooting.passageText(e,plan);if(passage)return passage;
 // Sparse geometric server results do not contain a solved disc position.
 if(plan.matchMode==='overlap')return plan.partId&&plan.partId!=='__whole'?(ports.alignmentText?.(plan.target,plan)||part?.name&&part.name+'を通過'||'指定部位の候補'):'全体に重なる候補';
 return '';
}
const candidateTimeText=row=>{
 const w=row.spatialWindow;
 if(!w||![w.fromAt,w.toAt].every(Number.isFinite)||w.toAt<w.fromAt)return clockText(row.event?.at);
 const from=clockText(w.fromAt),to=clockText(w.toAt),next=day(w.toAt)>day(w.fromAt)?'翌':'';
 return from===to&&!next?from:from+'〜'+next+to;
};
// A saved place is grouped by its connected sampled interval, never by name.
function recordedEntries(rows){
 const groups=new Map();
 for(const row of rows){
  const source=row.sourcePlaceId??row.place.sourcePlaceId??row.place.id,eye=row.assumedObserver?.eyeM??row.place.standAglM??row.place.eyeHeightAGL??null;
  const scope=[row.body??null,row.target?.id??null,row.event.partId??null,row.event.limb??null,row.event.matchMode??null,day(row.spatialWindow?.fromAt??row.event.at)];
  const key=JSON.stringify([source,eye,scope,row.spatialWindow?.id??candidateKey(row)]);
  let group=groups.get(key);if(!group){group={first:row,rows:[]};groups.set(key,group);}group.rows.push(row);if(row.event.at<group.first.event.at)group.first=row;
 }
 for(const g of groups.values())recordedMembers.set(g.first,g.rows);
 return [...groups.values()].map(g=>g.first).sort((a,b)=>(a.spatialWindow?.fromAt??a.event.at)-(b.spatialWindow?.fromAt??b.event.at));
}
// Labels reuse the solved celestial direction. Target-point geometry is local,
// with no ephemeris, terrain requests or new search for a position switch.
function positionChoices(rows,plan,geometryFrom=ports.geometryFrom){
 const unique=[...new Map(rows.map(row=>[positionKey(row),row])).values()].sort((a,b)=>a.event.at-b.event.at),shortcuts=new Map();
 const choices=unique.map(row=>{
  const e=row.event,parts=projectedParts(row,plan,geometryFrom);
  for(const {part,score} of parts){
   if(score>1)continue;
   const prev=shortcuts.get(part.id);if(!prev||score<prev.score)shortcuts.set(part.id,{row,score,partId:part.id,label:partName(part)+'付近'});
  }
  const nearest=parts.filter(p=>p.score<=1).sort((a,b)=>a.score-b.score)[0];
  const passage=wholePassage(row,plan,parts)||(nearest?partName(nearest.part)+'付近':passageOf(row,plan))||'重なる位置';
  return {row,key:positionKey(row),passage,label:clockText(e.at)+' ・ '+passage};
 });
 return {choices,shortcuts:[...shortcuts.values()].map(s=>({...s,key:positionKey(s.row)}))};
}
// All recorded-candidate surfaces share this projection and renderer. Labels do not
// trigger a solve. Each host owns a render ticket; old labels cannot replace a new list.
const recordedRenders=new WeakMap();
function recordedPlan(row,plan={}){
 const e=row.event;return {...plan,target:row.target||plan.target,body:row.body||plan.body,
  partId:Object.hasOwn(e,'partId')?e.partId:plan.partId,limb:e.limb??plan.limb,matchMode:e.matchMode??plan.matchMode};
}
const recordedHeightScope=(row,targetId=null)=>JSON.stringify([row.sourcePlaceId??row.place.sourcePlaceId??row.place.id,row.target?.id??targetId]);
function recordedRow(raw,rows,labels,heights=null,targetId=null){
 const projected={...raw,place:positionPlace(raw)},labelled=globalThis.AstroNotesCandidateLabels?.enrich(projected,labels)||projected;
 const row={...labelled,place:{...labelled.place,name:raw.place.name,subtitle:labelled.place.subtitle||raw.place.subtitle||''},record:raw.record||{},quality:{...raw.quality}};
 if(!Number.isFinite(row.quality.targetAngleDeg)&&Number.isFinite(row.event.targetAltitude))row.quality.targetAngleDeg=row.event.targetAltitude;
 const source=raw.sourcePlaceId??raw.place.sourcePlaceId??raw.place.id,eye=raw.assumedObserver?.eyeM??raw.place.standAglM??raw.place.eyeHeightAGL;
 if(Number.isFinite(eye)&&(raw.heightSearch||raw.place.eyeHeightRangeAGL||(heights?heights.get(recordedHeightScope(raw,targetId))?.size>1:rows.some(r=>recordedHeightScope(r,targetId)===recordedHeightScope(raw,targetId)&&
  (r.assumedObserver?.eyeM??r.place.standAglM??r.place.eyeHeightAGL)!==eye))))row.heightNote='撮影高さ 地上'+eye+'m';
 return row;
}
async function renderRecorded(box,rows,plan,{select,current=()=>true,context=false,heading=null,rowClass='explore-record-row',rowId=null,heightRows=rows,aggregate=true,decorate=null,compact=true}={}){
 const ticket={},live=()=>recordedRenders.get(box)===ticket&&current()&&box.isConnected;recordedRenders.set(box,ticket);
 let labels={};try{if(rows.length)labels=await loadLabels()||{};}catch(e){globalThis.AstroNotesErrors?.note('candidates.record-labels',e);}
 if(!live())return null;
 const selected=aggregate?recordedEntries(rows):rows,nodes=[],heights=new Map(),unclassified=[];
 for(const r of [...rows,...heightRows]){const id=recordedHeightScope(r,plan?.target?.id),h=r.assumedObserver?.eyeM??r.place.standAglM??r.place.eyeHeightAGL;
  if(Number.isFinite(h)){if(!heights.has(id))heights.set(id,new Set());heights.get(id).add(h);}}
 const previous=new Map([...box.querySelectorAll('[data-recorded-key]')].map(n=>[n.dataset.recordedKey,n]));
 const headings=new Map([...box.querySelectorAll('h3.record-opportunity-day')].map(n=>[n.textContent,n]));
 let processed=0,lastHeading=null;
 for(const raw of selected){
  if(++processed%12===0){await new Promise(r=>setTimeout(r,0));if(!live())return null;}
  const selectedPlan=recordedPlan(raw,plan||{});previewGroups.set(raw,{plan:selectedPlan,rows:recordedMembers.get(raw)||[raw]});
  const row=recordedRow(raw,rows,labels,heights,selectedPlan.target?.id),key=JSON.stringify([raw.id??null,raw.sourcePlaceId??raw.place.sourcePlaceId??raw.place.id,raw.body,raw.target?.id,candidateKey(raw)]);
  const button=previous.get(key)||document.createElement('button');button.type='button';button.className='list-item candidate-record-row '+rowClass;button.dataset.recordedKey=key;
  if(heading){const text=heading(raw);if(text!==lastHeading){lastHeading=text;const h=headings.get(text)||document.createElement('h3');h.className='record-opportunity-day';h.textContent=text;nodes.push(h);}}
  const types=kinds(row,labels.facilities);
  formatRow(button,row,types,selectedPlan,compact);
  if(types.includes('unknown'))unclassified.push({button,row,selectedPlan,key});
  let identity=button.querySelector('[data-candidate-context]');
  if(context){if(!identity){identity=document.createElement('span');identity.dataset.candidateContext='';identity.className='tiny sub-line';identity.style.gridColumn='1 / -1';button.append(identity);}
   identity.textContent=[ports.bodyName?.(selectedPlan.body)||selectedPlan.body,selectedPlan.target?.name].filter(Boolean).join(' × ');
   button.append(identity);
  }else identity?.remove();
  if(rowId)button.dataset.opportunityId=rowId(raw);
  if(decorate)decorate(button,raw,selectedPlan,row);
  button.onclick=()=>{if(current())select(raw);};nodes.push(button);
 }
 if(!live())return null;
 // Reuse existing buttons, including their focus, when a page is appended.
 let cursor=box.firstChild;
 for(const n of nodes){if(n===cursor)cursor=cursor.nextSibling;else box.insertBefore(n,cursor);}
 while(cursor){const next=cursor.nextSibling;cursor.remove();cursor=next;}
 // Commit first. Context arrives in place without restarting the list, search,
 // ephemeris or visibility calculation. Stop queued work for a superseded host.
 if(ports.placeContext&&unclassified.length)void (async()=>{
  let changed=false;
  for(const {button,row,selectedPlan,key}of unclassified){
   await new Promise(r=>setTimeout(r,0));if(!live())return;
   const result=await ports.placeContext.read(positionPlace(row));
   if(!live())return;
   if(result&&button.dataset.recordedKey===key){formatRow(button,row,kinds(row,labels.facilities),selectedPlan,compact);changed=true;}
  }
  if(changed&&live()&&groups.has(box))void apply();
 })().catch(e=>globalThis.AstroNotesErrors?.note('candidates.place-context',e));
 return selected.length;
}

const angleMarkup=new WeakMap();
function renderCandidateAngle(cell,angle,compact){
 const known=Number.isFinite(angle),rounded=Math.round(angle),degrees=Math.abs(rounded);
 const direction=known?(degrees?(rounded<0?'down':'up'):'level'):'unknown';
 const label=direction==='level'?'水平':direction==='down'?'俯角':'仰角';
 let icon=cell.querySelector('[data-angle-icon]'),text=cell.querySelector('[data-angle-label]');
 if(!text){
  cell.setAttribute('role','img');
  icon=document.createElement('span');icon.dataset.angleIcon='';icon.setAttribute('aria-hidden','true');
  text=document.createElement('span');text.dataset.angleLabel='';cell.replaceChildren(icon,text);
 }
 const markup=known?ports.angleIcons?.[direction]||'':'';
 if(angleMarkup.get(icon)!==markup){icon.innerHTML=markup;angleMarkup.set(icon,markup);}
 icon.hidden=!markup;cell.hidden=compact&&!known;
 const value=known?(compact?label+' '+degrees:rounded)+'°':'—';
 if(text.textContent!==value)text.textContent=value;
 const description=known?(degrees?'対象の'+label+' '+degrees+'度、水平より'+(direction==='down'?'下':'上')+'を見る角度':'対象は水平、0度'):'対象の角度 不明';
 if(cell.getAttribute('aria-label')!==description)cell.setAttribute('aria-label',description);
}
function formatRow(node,row,types,plan,compact=compactMode){
 // A registered row may move between hosts. Its existing DOM owns its layout.
 if(node.hasAttribute('data-candidate-columns'))compact=!!node.querySelector('[data-candidate-meta]');
 if(!node.hasAttribute('data-candidate-columns')){
  const notes=[...node.querySelectorAll('.sub-line')].filter(n=>!n.hasAttribute('data-place-kind')).map(n=>n.textContent.replace(/^\d{2}:\d{2}・/,'').replace(/ · \d{2}:\d{2}/,''));
  node.replaceChildren();node.dataset.candidateColumns='';
  Object.assign(node.style,{display:'grid',gridTemplateColumns:compact?'minmax(0,1fr) max-content':columns,columnGap:'8px',rowGap:'4px',alignItems:'start',textAlign:'left',padding:'12px 0',minHeight:'44px'});
  const title=document.createElement('span');title.dataset.candidatePlace='';Object.assign(title.style,{minWidth:'0',overflowWrap:'anywhere',fontSize:'14px',fontWeight:'600'});
  const clock=document.createElement('span');clock.dataset.candidateTime='';clock.textContent=candidateTimeText(row);Object.assign(clock.style,{fontSize:'14px',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'});
  const kind=document.createElement('span');kind.dataset.placeKind='';Object.assign(kind.style,{fontSize:'14px',minWidth:'0',overflowWrap:'anywhere'});
  const angle=document.createElement('span');angle.dataset.candidateAngle='';Object.assign(angle.style,{fontSize:'14px',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',textAlign:'right'});node.append(title,clock);
  if(compact){const meta=document.createElement('span');meta.className='tiny sub-line';meta.dataset.candidateMeta='';
   Object.assign(meta.style,{gridColumn:'1 / -1',display:'flex',flexWrap:'wrap',gap:'4px 10px'});meta.append(kind,angle);node.append(meta);}
  else node.append(kind,angle);
  if(notes.length){const detail=document.createElement('span');detail.className='tiny sub-line';detail.textContent=notes.join(' · ');Object.assign(detail.style,{gridColumn:'1 / -1',whiteSpace:'normal',overflowWrap:'anywhere'});node.append(detail);}
 }
 const title=node.querySelector('[data-candidate-place]');if(title.textContent!==row.place.name)title.textContent=row.place.name;
 node.querySelector('[data-place-kind]').textContent=types.map(t=>names[t]).join('・');
 node.querySelector('[data-candidate-time]').textContent=candidateTimeText(row);
 const angleCell=node.querySelector('[data-candidate-angle]');
 if(angleCell)renderCandidateAngle(angleCell,angleOf(row),compact);
 const location=locationText(row);let address=node.querySelector('[data-candidate-address]');
 if(location){
  if(!address){address=document.createElement('span');address.dataset.candidateAddress='';address.className='tiny sub-line';Object.assign(address.style,{gridColumn:'1 / -1',whiteSpace:'normal',overflowWrap:'anywhere'});
   const before=node.querySelector('[data-candidate-meta],[data-candidate-area],[data-candidate-composition],[data-candidate-uncertainty]');if(before)node.insertBefore(address,before);else node.append(address);}
  if(address.textContent!==location)address.textContent=location;
 }else address?.remove();
 const passage=passageOf(row,plan);let position=node.querySelector('[data-candidate-passage]');
 if(passage){if(!position){position=document.createElement('span');position.dataset.candidatePassage='';position.className='tiny sub-line';Object.assign(position.style,{gridColumn:'1 / -1',whiteSpace:'normal',overflowWrap:'anywhere'});
  const before=node.querySelector('[data-candidate-composition],[data-candidate-uncertainty]');if(before)node.insertBefore(position,before);else node.append(position);}if(position.textContent!==passage)position.textContent=passage;}else position?.remove();
 const framed=compositionText(row);let line=node.querySelector('[data-candidate-composition]');
 if(framed){if(!line){line=document.createElement('span');line.dataset.candidateComposition='';line.className='tiny sub-line';Object.assign(line.style,{gridColumn:'1 / -1',whiteSpace:'normal',overflowWrap:'anywhere'});
  const before=node.querySelector('[data-candidate-uncertainty]');if(before)node.insertBefore(line,before);else node.append(line);}line.textContent=framed;}else line?.remove();
 const w=row.spatialWindow,movement=w?(w.kind==='line'?'線上':'範囲内')+(w.count>1&&w.toAt>w.fromAt?'で移動':'の候補'):row.shapeType?(row.shapeType==='line'?'線上':'範囲内')+'の候補':'';
 const detail=[movement,row.heightNote||''].filter(Boolean).join(' ・ ');let spatial=node.querySelector('[data-candidate-spatial]');
 if(detail){if(!spatial){spatial=document.createElement('span');spatial.dataset.candidateSpatial='';spatial.className='tiny sub-line';spatial.style.gridColumn='1 / -1';node.append(spatial);}spatial.textContent=detail;}else spatial?.remove();
 const unconfirmed=uncertainty(row);let note=node.querySelector('[data-candidate-uncertainty]');
 if(unconfirmed.length){if(!note){note=document.createElement('span');note.dataset.candidateUncertainty='';note.className='tiny sub-line';Object.assign(note.style,{gridColumn:'1 / -1',whiteSpace:'normal',overflowWrap:'anywhere'});node.append(note);}note.textContent=unconfirmed.join(' ・ ');
 }else note?.remove();
}
// Under a representative row: the places and times of its area (2026-11-14).
function showArea(node,area){
 const text=areaText(area);let line=node.querySelector('[data-candidate-area]');
 if(!text){line?.remove();return;}
 if(!line){line=document.createElement('span');line.dataset.candidateArea='';line.className='tiny sub-line';Object.assign(line.style,{gridColumn:'1 / -1',whiteSpace:'normal',overflowWrap:'anywhere'});
  if(compactMode)node.querySelector('[data-candidate-meta]').append(line);
  else node.insertBefore(line,node.querySelector('[data-candidate-composition],[data-candidate-uncertainty]'));}
 if(line.textContent!==text)line.textContent=text;
}
function createHeader(){
 const header=document.createElement('div');header.className='candidate-list-heading';header.dataset.candidateHeaders='';header.setAttribute('role','group');header.setAttribute('aria-label','候補の並べ替え');
 Object.assign(header.style,{display:'grid',gridTemplateColumns:columns,gap:'8px',borderBottom:'1px solid var(--line)',marginTop:'8px'});
 for(const [key,label]of [['name','地点'],['time','時刻'],['kind','種類'],['angle','角度']]){const button=document.createElement('button');button.type='button';button.dataset.candidateSort=key;button.dataset.label=label;
 Object.assign(button.style,{minWidth:'0',minHeight:'44px',padding:'8px 0',border:'0',borderRadius:'0',background:'transparent',boxShadow:'none',textAlign:'left',fontSize:'14px',fontWeight:'600',whiteSpace:'nowrap'});button.onclick=()=>{sort=sort===key?key+'-desc':key;updateHeaders();apply();};
 header.append(button);}return header;
}
function updateHeaders(){
 if(!control)return;
 if(compactMode){const picker=control.querySelector('#candidateSort');if(picker)picker.value=sort;return;}
 const key=sort.replace(/-desc$/,''),descending=sort.endsWith('-desc');
 for(const button of control.querySelectorAll('[data-candidate-sort]')){const active=button.dataset.candidateSort===key;button.textContent=button.dataset.label+(active?(descending?' ↓':' ↑'):' ↕');
 button.setAttribute('aria-label',button.dataset.label+(active?'、現在は'+(descending?'降順':'昇順')+'。':'。')+(active&&!descending?'降順':'昇順')+'に並べ替え');button.setAttribute('aria-pressed',String(active));button.style.color=active?'var(--accent)':'var(--secondary)';}
 const reset=control.querySelector('[data-candidate-recommended]');if(reset)reset.hidden=sort==='recommended';
}
function button(label,handler){const b=document.createElement('button');b.type='button';b.className='fav-btn';b.textContent=label;b.style.minHeight='44px';b.onclick=handler;return b;}
function setMapDisplay(on){
 const toggle=control?.querySelector('#candidateMapToggle'),header=control?.querySelector('[data-candidate-headers]');
 if(!toggle)return;
 const label=toggle.querySelector('[data-candidate-map-label]')||toggle;
 label.textContent=on?'一覧に戻る':compactMode?'地図':'地図で見る';toggle.setAttribute('aria-expanded',String(on));
 if(header)header.hidden=on;
 if(list)list.hidden=on;
}
function compactToolbar(status,toggle,filters){
 const toolbar=document.createElement('header');toolbar.className='candidate-results-toolbar';
 const title=document.createElement('div');title.className='candidate-results-title';
 const heading=document.createElement('h2');heading.id='exploreResultsHeading';heading.textContent='撮影候補';title.append(heading,status);
 toggle.classList.add('candidate-results-action');toggle.innerHTML=ports.mapIcon||'';
 const mapLabel=document.createElement('span');mapLabel.dataset.candidateMapLabel='';mapLabel.textContent='地図';toggle.append(mapLabel);
 const refine=document.createElement('details');refine.id='candidateRefinement';refine.open=refinementOpen;
 const summary=document.createElement('summary');summary.className='candidate-results-action';summary.setAttribute('aria-label','絞り込み・並べ替え');summary.innerHTML=refinementIcon+'<span>絞り込み</span>';
 refine.append(summary,filters);
 refine.addEventListener('toggle',()=>{if(control?.contains(refine))refinementOpen=refine.open;});
 refine.addEventListener('keydown',event=>{if(event.key==='Escape'&&refine.open){event.preventDefault();event.stopPropagation();refine.open=false;summary.focus({preventScroll:true});}});
 toolbar.append(title,toggle,refine);return toolbar;
}
function mount(panel,plan,{compact=panel.closest('#exploreNewPlaces')!==null}={}){
 const next=planKey(plan),nextFilters=typeof ports.filterKey==='function'?ports.filterKey(plan):next;
 const modeChanged=compact!==compactMode;
 if(next!==scope||modeChanged){
  const previous=scope,keepFilters=nextFilters===filterScope;
  if(mapPanel)mapPanel.querySelector('.mapwrap')?._mapShell?.setWide(false);
  for(const g of groups.values())for(const node of g.nodes)node.remove();
  scope=next;filterScope=nextFilters;groups.clear();windows.clear();visibleEntries=[];selectedId=null;revision.cancel();mapMode=false;mapHits=[];
  if(!keepFilters){time=kind='all';sort='time';refinementOpen=false;}
  compactMode=compact;
  if(!keepFilters||modeChanged){control?.remove();control=null;list=null;}
  else if(control){list?.replaceChildren();setMapDisplay(false);control.querySelector('#candidateMapToggle').disabled=true;
   const status=control.querySelector('[data-filter-status]');status.textContent='';status.hidden=true;
   if(compactMode)control.hidden=true;
   const reset=control.querySelector('#candidateResetFilters');if(reset)reset.hidden=true;}
  if(mapPanel)mapPanel.hidden=true;
  if(previous)queueMicrotask(()=>{if(scope===next&&panel.isConnected)globalThis.MyPlacesUI?.renderPickerPanel(panel);});
 }
 if(!control?.isConnected){
  control=document.createElement('section');control.id='candidateListControls';control.className='aim-disclosure';Object.assign(control.style,{padding:'12px 0',marginTop:'12px'});
  if(compactMode){control.dataset.compact='';control.hidden=true;control.setAttribute('aria-labelledby','exploreResultsHeading');}
  else control.setAttribute('aria-label','この日の候補の絞り込みと並び順');
  const filters=document.createElement('div');filters.className='candidate-filter-fields';
  const add=(label,id,options,value,change)=>{const l=document.createElement('label');l.className='tiny';Object.assign(l.style,{display:'grid',gridTemplateColumns:'76px minmax(0,1fr)',alignItems:'center',gap:'12px',margin:'0 0 8px',fontSize:'14px'});l.textContent=label;
  const s=document.createElement('select');s.id=id;s.setAttribute('aria-label',label);Object.assign(s.style,{width:'100%',minWidth:'0',maxWidth:'100%',minHeight:'44px',margin:'0',fontSize:'16px'});for(const [v,n]of options)s.add(new Option(n,v));s.value=value;s.onchange=()=>{change(s.value);apply();
  };l.append(s);filters.append(l);};
  add('時間帯','candidateTimeFilter',[['all','すべての時間'],['rise','出の前後1時間'],['set','入の前後1時間']],time,v=>time=v);
  add('場所の種類','candidateKindFilter',[['all','すべての種類'],...Object.entries(names)],kind,v=>kind=v);
  const toggle=button('地図で見る',()=>showMap(!mapMode));toggle.id='candidateMapToggle';toggle.disabled=true;toggle.setAttribute('aria-expanded','false');
  const status=document.createElement('p');status.className='tiny candidate-filter-status';status.dataset.filterStatus='';status.setAttribute('role','status');status.style.margin='12px 0 0';
  if(compactMode){
   add('並べ替え','candidateSort',sortOptions,sort,v=>sort=v);
   const clear=button('絞り込みを解除',()=>{
    time=kind='all';control.querySelector('#candidateTimeFilter').value=time;control.querySelector('#candidateKindFilter').value=kind;
    control.querySelector('#candidateRefinement > summary').focus({preventScroll:true});apply();
   });clear.id='candidateResetFilters';clear.hidden=true;
   control.append(compactToolbar(status,toggle,filters),clear);
  }else{
   const actions=document.createElement('div');actions.className='candidate-list-actions';Object.assign(actions.style,{display:'flex',gap:'8px',flexWrap:'wrap'});
   const reset=button('おすすめ順にする',()=>{sort='recommended';updateHeaders();apply();});reset.dataset.candidateRecommended='';
   actions.append(toggle,reset);control.append(filters,actions,status,createHeader());
  }
  list=document.createElement('div');list.id='candidateUnifiedResults';control.append(list);
  if(mapPanel)control.append(mapPanel);updateHeaders();
 }
 if(panel.firstElementChild!==control)panel.prepend(control);return control;
}
function currentEntry(e){return !!e&&e.group===groups.get(e.box)&&e.box.isConnected&&e.group.current()&&control?.isConnected;}
async function apply(){
 const token=revision.next(),selection={time,kind,sort},status=control?.querySelector('[data-filter-status]');if(!status||!list)return;
 // The count already shown stays while the list is placed again, so the line does not flicker.
 if(status.hidden||!status.textContent){status.hidden=false;status.textContent='候補の絞り込みを確認しています…';}
 // The discovery owner republishes rows when optional labels arrive. Keep its
 // already verified rows selectable while those files are still loading.
 let labels={};try{if([...groups.values()].some(g=>g.rows.length))labels=ports.labelsSnapshot?ports.labelsSnapshot()||{}:await loadLabels()||{};}catch(e){globalThis.AstroNotesErrors?.note('candidates.labels',e);}
 if(!revision.current(token)||!control?.isConnected)return;
 const entries=[];let unknownTime=0,index=0;
 for(const [box,g]of groups){
  if(!box.isConnected||!g.current()){for(const node of g.nodes)node.remove();groups.delete(box);continue;}
  for(let i=0;i<g.rows.length;i++){
   const row=g.rows[i],node=g.nodes[i];if(!node)continue;const types=kinds(row,labels.facilities);let events=null;
   if(selection.time!=='all'){
    const obs=row.assumedObserver,key=JSON.stringify([g.plan.body,day(g.plan.at),obs,g.plan.atmosphere]);
    if(obs&&[obs.latitude,obs.longitude,obs.elevation].every(Number.isFinite)){
     if(!windows.has(key)){try{await AstroNotesBodies.ensure(g.plan.body);if(!revision.current(token)||!g.current())return;windows.set(key,AstroNotesCandidateComposition.windowEvents({...g.plan,timeWindow:{kind:'both',beforeMin:60,afterMin:60}},obs,AstroNotesBodies));}catch{windows.set(key,null);}}
     events=windows.get(key);
    }
    if(!events)unknownTime++;
   }
   const id=candidateKey(row);formatRow(node,row,types,g.plan);node.dataset.candidateKinds=types.join(',');node.dataset.candidateId=id;
   if(!boundNodes.has(node)){boundNodes.add(node);node.addEventListener('click',()=>{selectedId=node.dataset.candidateId;},true);}
   entries.push({row,node,types,index:index++,id,box,group:g,show:accepts(row,selection.time,selection.kind,types,events)});
   if(i%12===11){await new Promise(r=>setTimeout(r,0));if(!revision.current(token)||!g.current())return;}
  }
 }
 if(!revision.current(token))return;
 const merged=mergeEntries(entries,selection.sort),chosen=new Set(merged.map(e=>e.node));
 for(const e of merged)previewGroups.set(e.row,{plan:e.group.plan,rows:membersOf(e).filter(m=>m.show!==false).map(m=>m.row)});
 const focused=list.contains(document.activeElement)?document.activeElement:null;
 for(const e of entries)if(!chosen.has(e.node))e.node.remove();
 // Remove orphaned nodes left by a source re-render or cancelled job.
 for(const node of [...list.children])if(!chosen.has(node))node.remove();
 let next=list.firstElementChild;
 for(const e of merged){
  e.node.hidden=!e.show;e.node.style.display=e.show?'grid':'none';showArea(e.node,areaOf(e));
  if(e.node===next)next=next.nextElementSibling;else list.insertBefore(e.node,next);
 }
 if(focused?.isConnected&&!focused.hidden&&document.activeElement!==focused)focused.focus({preventScroll:true});
 visibleEntries=merged.filter(e=>e.show);visibleEntries.forEach((e,i)=>e.node.dataset.candidateNumber=String(i+1));
 if(!visibleEntries.some(e=>e.id===selectedId))selectedId=null;
 const allVisible=visibleEntries.length===merged.length,count=compactMode&&allVisible?`${merged.length}件`:`${visibleEntries.length} / ${merged.length}件を表示`;
 const message=count+(unknownTime?`。出入り時刻を確認できない${unknownTime}件は時間帯の絞り込みから除外しています。`:'')+(merged.length&&!labels.facilities?'。種類データを読み込めない地点は種類未確認です。':'');
 status.hidden=!merged.length;if(status.textContent!==message)status.textContent=message;
 if(compactMode){control.hidden=!merged.length;control.querySelector('#candidateResetFilters').hidden=!merged.length||!!visibleEntries.length;}
 const toggle=control.querySelector('#candidateMapToggle');toggle.disabled=!visibleEntries.length||typeof ports.createMapView!=='function';
 if(mapMode){if(!visibleEntries.length)showMap(false);else refreshMap();}updateHeaders();
 if(suspendedView?.scope===scope&&visibleEntries.length&&(!suspendedView.selectedId||visibleEntries.some(e=>e.id===suspendedView.selectedId))){const saved=suspendedView;suspendedView=null;selectedId=saved.selectedId;if(saved.mapMode)showMap(true);
 else requestAnimationFrame(()=>{if(scope===saved.scope&&control?.isConnected){const scroller=ports.getScroller?.()||control.closest('.sheet-body')||control.closest('[role=tabpanel]');if(scroller)scroller.scrollTop=saved.scrollTop;}});}
 ports.onRendered?.(visibleEntries.length);return visibleEntries.map(e=>e.row);
}
function unregister(box){const g=groups.get(box);if(g){for(const node of g.nodes)node.remove();groups.delete(box);}return apply();}
function register(box,rows,plan,current,nodes=null){
 // Registered results can resolve before the adapter's animation-frame mount.
 // Establish the same scope first so that the later mount cannot discard them.
 // The same panel the page mounts (ui.js): in 探す the results list sits under the tab panel's #recentCandidates.
 const tab=box.closest('[role=tabpanel]'),panel=box.closest('#recentCandidates')||tab?.querySelector('#recentCandidates')||tab;if(panel&&box.isConnected)mount(panel,plan);
 // A caller that keeps its buttons across updates passes them; only buttons it dropped leave the list.
 const own=nodes||[...box.children].filter(n=>n.tagName==='BUTTON'&&n.classList.contains('list-item')),keep=new Set(own);
 const previous=groups.get(box);if(previous)for(const node of previous.nodes)if(!keep.has(node))node.remove();
 groups.set(box,{rows,plan,current:typeof current==='function'?current:()=>true,nodes:own});
 box.querySelector('[data-candidate-headers]')?.remove();return apply();
}
function mapSelection(){return visibleEntries.find(e=>e.id===selectedId)||null;}
function chooseMap(id){if(!visibleEntries.some(e=>e.id===id&&currentEntry(e)))return;selectedId=id;refreshMap();}
function ensureMap(){
 if(!mapPanel){
  mapPanel=document.createElement('section');mapPanel.id='candidateMapPanel';mapPanel.hidden=true;mapPanel.setAttribute('aria-label','この日の候補地図');
  const note=document.createElement('p');note.className='tiny';note.dataset.candidateMapNote='';note.textContent='各ピンは、それぞれの時刻の候補です。';mapPanel.append(note);
  const wrap=document.createElement('div');wrap.className='mapwrap';Object.assign(wrap.style,{position:'relative',height:'min(55vh,480px)',minHeight:'280px',overflow:'hidden',borderRadius:'12px'});
  const canvas=document.createElement('canvas');canvas.id='candidateMapCanvas';canvas.setAttribute('aria-label','候補の位置。下の候補選択欄でも選べます。');Object.assign(canvas.style,{width:'100%',height:'100%',display:'block',touchAction:'none'});wrap.append(canvas);
  const zoom=document.createElement('div');zoom.className='mapzoom';const plus=button('＋',()=>{}),minus=button('−',()=>{});plus.id='candidateMapZoomIn';minus.id='candidateMapZoomOut';plus.setAttribute('aria-label','地図を拡大');minus.setAttribute('aria-label','地図を縮小');zoom.append(plus,minus);
  wrap.append(zoom);mapPanel.append(wrap);
  const card=document.createElement('div');card.id='candidateMapCard';mapPanel.append(card);
  const select=document.createElement('select');select.id='candidateMapChoice';select.setAttribute('aria-label','地図の候補');Object.assign(select.style,{width:'100%',fontSize:'16px',minHeight:'44px',marginTop:'12px'});select.onchange=()=>chooseMap(select.value);card.append(select);
  const detail=document.createElement('p');detail.id='candidateMapDetail';detail.className='tiny';detail.setAttribute('role','status');card.append(detail);
  const use=button('見え方を確認',()=>{const e=mapSelection();if(!currentEntry(e)){detail.textContent='条件が変わりました。一覧に戻って候補を確認してください。';return;}e.node.click();});use.id='candidateMapUse';card.append(use);
  const back=button('一覧に戻る',()=>{wrap._mapShell?.setWide(false);showMap(false);});back.hidden=true;card.append(back);
  new MutationObserver(()=>{const wide=wrap.classList.contains('sky-map-wide'),footer=wrap.querySelector('.shared-map-footer');back.hidden=!wide;if(wide&&footer){footer.hidden=false;if(card.parentNode!==footer)footer.append(card);}else if(card.parentNode!==mapPanel)mapPanel.append(card);
  }).observe(wrap,{attributes:true,attributeFilter:['class']});
 }
 mapPanel.querySelector('[data-candidate-map-note]').hidden=compactMode;
 if(mapPanel.parentNode!==control)control.append(mapPanel);
 if(!mapInstance){mapInstance=ports.createMapView({canvas:'candidateMapCanvas',zoomIn:'candidateMapZoomIn',zoomOut:'candidateMapZoomOut'});mapInstance.setOverlay(drawMap);mapInstance.onPick((_point,pixel)=>{
  const hits=visibleEntries.filter(currentEntry).map(e=>{const q=mapInstance.project(e.row.place.latitude,e.row.place.longitude);return {x:q[0],y:q[1],id:e.id};}).filter(h=>Math.hypot(h.x-pixel.x,h.y-pixel.y)<=24).sort((a,b)=>Math.hypot(a.x-pixel.x,a.y-pixel.y)-Math.hypot(b.x-pixel.x,b.y-pixel.y));
  if(!hits.length)return;const nearest=hits[0],cluster=hits.filter(h=>Math.hypot(h.x-nearest.x,h.y-nearest.y)<3),at=cluster.findIndex(h=>h.id===selectedId);chooseMap(cluster[(at+1)%cluster.length].id);
 });}
}
function showMap(on){
 if(!control)return false;if(on&&(!visibleEntries.length||typeof ports.createMapView!=='function'))return false;
 const scrollHost=ports.getScroller?.()||control.closest('[role=tabpanel]')||control.closest('dialog'),toggle=control.querySelector('#candidateMapToggle');
 if(on){mapScroll={node:scrollHost,top:scrollHost?.scrollTop||0};ensureMap();mapMode=true;mapPanel.hidden=false;toggle.setAttribute('aria-controls',mapPanel.id);setMapDisplay(true);mapFitPending=true;refreshMap();
 mapPanel.scrollIntoView?.({block:'nearest'});}
 else{const restoreFocus=compactMode&&mapPanel?.contains(document.activeElement);mapMode=false;if(mapPanel){mapPanel.querySelector('.mapwrap')?._mapShell?.setWide(false);mapPanel.hidden=true;}setMapDisplay(false);
 if(restoreFocus&&!toggle.disabled)toggle.focus({preventScroll:true});
 const saved=mapScroll,expected=scope;if(saved?.node)requestAnimationFrame(()=>{if(!mapMode&&scope===expected&&saved.node.isConnected)saved.node.scrollTop=saved.top;});}
 return true;
}
function refreshMap(){
 if(!mapMode||!mapInstance)return;
 if(!mapSelection())selectedId=visibleEntries[0]?.id??null;
 const select=mapPanel.querySelector('#candidateMapChoice'),signature=JSON.stringify(visibleEntries.map(e=>[e.id,e.row.place.name,e.row.event?.at]));
 if(select.dataset.signature!==signature){select.replaceChildren();visibleEntries.forEach((e,i)=>select.add(new Option(`${i+1}. ${e.row.place.name} ・ ${clockText(e.row.event?.at)}`,e.id)));select.dataset.signature=signature;}
 select.value=selectedId||'';const e=mapSelection();
 const detail=mapPanel.querySelector('#candidateMapDetail');if(e){const obs=e.row.assumedObserver,p=e.row.place,base=Number.isFinite(obs?.elevation)?obs.elevation:p.groundManualM??p.elevation,eye=Number.isFinite(obs?.eyeM)?obs.eyeM:p.standAglM??p.eyeHeightAGL;
 detail.textContent=[locationText(e.row),e.types.map(t=>names[t]).join('・'),clockText(e.row.event?.at),passageOf(e.row,e.group.plan),
  Number.isFinite(base)&&Number.isFinite(eye)?'撮影位置の標高 '+(base+eye).toFixed(1)+'m':'高さ未確認',...uncertainty(e.row)].filter(Boolean).join(' ・ ');}
 mapPanel.querySelector('#candidateMapUse').disabled=!currentEntry(e);
 if(mapFitPending){mapFitPending=false;const ps=visibleEntries.map(e=>e.row.place).filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));
 if(ps.length){const lat0=Math.min(...ps.map(p=>p.latitude)),lat1=Math.max(...ps.map(p=>p.latitude)),lon0=Math.min(...ps.map(p=>p.longitude)),lon1=Math.max(...ps.map(p=>p.longitude)),lat=(lat0+lat1)/2,lon=(lon0+lon1)/2,cv=mapPanel.querySelector('canvas'),dx=Math.max(.00001,(lon1-lon0)/360),
 dy=Math.max(.00001,(lat1-lat0)/(360*Math.cos(lat*Math.PI/180))),z=Math.min(17,Math.log2(Math.max(160,cv.clientWidth)*.7/(256*dx)),Math.log2(Math.max(200,cv.clientHeight)*.7/(256*dy)));mapInstance.open({latitude:lat,longitude:lon},z);}}
 mapInstance.redraw();
}
function drawMap(ctx,{project,width,height}){
 mapHits=[];if(!mapMode)return;const selected=mapSelection();
 ctx.save();ctx.font='600 13px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
 if(selected&&currentEntry(selected)){
  const p=selected.row.place,t=selected.group.plan.target;
  if(t&&Number.isFinite(t.latitude)&&Number.isFinite(t.longitude)){const a=project(p.latitude,p.longitude),b=project(t.latitude,t.longitude);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.strokeStyle='#f4bb44';ctx.lineWidth=3;ctx.stroke();
   const top=64,off=b[0]<24||b[0]>width-24||b[1]<top||b[1]>height-24,origin=a[0]>=24&&a[0]<=width-24&&a[1]>=top&&a[1]<=height-24?a:[width/2,height/2],dx=b[0]-origin[0],dy=b[1]-origin[1],scale=off?Math.min(1,dx>0?(width-24-origin[0])/dx:dx<0?(24-origin[0])/dx:Infinity,
   dy>0?(height-24-origin[1])/dy:dy<0?(top-origin[1])/dy:Infinity):1,tx=off?origin[0]+dx*scale:b[0],ty=off?origin[1]+dy*scale:b[1];ctx.beginPath();ctx.arc(tx,ty,7,0,Math.PI*2);ctx.fillStyle='#bc7cff';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#fff';
   ctx.strokeStyle='#222';ctx.lineWidth=4;let label=(off?'対象方向：':'')+(t.name||'対象');const maxLabelWidth=Math.max(20,width-20);if(ctx.measureText(label).width>maxLabelWidth){while(label.length&&ctx.measureText(label+'…').width>maxLabelWidth)label=label.slice(0,-1);label+='…';
   }const half=ctx.measureText(label).width/2+5,labelX=Math.max(half,Math.min(width-half,tx)),labelY=Math.max(14,Math.min(height-14,ty+(ty<84||ty>=a[1]?20:-20)));ctx.strokeText(label,labelX,labelY);ctx.fillText(label,labelX,labelY);
  }
 }
 visibleEntries.map((e,i)=>({e,i})).sort((a,b)=>Number(a.e.id===selectedId)-Number(b.e.id===selectedId)).forEach(({e,i})=>{if(!currentEntry(e))return;const p=e.row.place;if(!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude))return;const [x,y]=project(p.latitude,p.longitude);
 if(x<-24||x>width+24||y<-24||y>height+24)return;mapHits.push({x,y,id:e.id});ctx.beginPath();ctx.arc(x,y,e.id===selectedId?16:13,0,Math.PI*2);ctx.fillStyle=e.id===selectedId?'#176cc5':'#273b52';ctx.fill();ctx.lineWidth=e.id===selectedId?3:2;ctx.strokeStyle='#fff';ctx.stroke();ctx.fillStyle='#fff';
 ctx.fillText(String(i+1),x,y);});ctx.restore();
}
// Keep UI preferences and a valid return position, never old executable rows.
function suspend(){
 if(!control?.isConnected)return;
 const scroller=ports.getScroller?.()||control.closest('.sheet-body')||control.closest('[role=tabpanel]');
 suspendedView={scope,selectedId,mapMode,scrollTop:ports.getReturnScroll?.()??scroller?.scrollTop??0};
 if(compactMode)refinementOpen=control.querySelector('#candidateRefinement').open;
 if(mapPanel)mapPanel.querySelector('.mapwrap')?._mapShell?.setWide(false);
 revision.cancel();for(const g of groups.values())for(const node of g.nodes)node.remove();groups.clear();visibleEntries=[];mapHits=[];mapMode=false;if(mapPanel)mapPanel.hidden=true;control.remove();
}
function reset(){
 if(mapPanel){mapPanel.querySelector('.mapwrap')?._mapShell?.setWide(false);mapPanel.hidden=true;}
 revision.cancel();groups.clear();windows.clear();visibleEntries=[];selectedId=null;mapHits=[];mapMode=false;
 control?.remove();control=null;list=null;scope='';filterScope='';refinementOpen=false;mapScroll=null;suspendedView=null;
}
const api={mount,configure,renderRecorded,previewFor,positionChoices,positionKey,positionPlace,candidateKey,registerRegistered:register,registerAdditional:register,unregister,apply,kinds,accepts,compare,inRecords,showMap,suspend,reset,
 countNewPlaces,fixedSurveyedInRecords,visibleRows:()=>visibleEntries.filter(currentEntry).map(e=>e.row)};
globalThis.AstroNotesCandidatePicker=api;
if(typeof module!=='undefined')module.exports={recordedEntries,recordedPlan,recordedRow,passageOf,uncertainty,candidateTimeText,positionChoices,membersOf,kinds,accepts,compare,candidateKey,mergeEntries,placePriority,areaOf,areaText,inRecords,countNewPlaces,fixedSurveyedInRecords};
})();

// Trial adapter. Existing session owns selection; discovery owns search jobs.
(()=>{
'use strict';
let run=0,section=null,condition='',watch=null,controller=null,homeCondition='';
const mainWorkspace=()=>globalThis.TrialExplore?.candidateWorkspace?.();
const dateSelection=()=>{const s=SkyMapUI.selectionState();return Number.isFinite(s?.at)?s:SkyMapUI.workspaceHost()?.session;};
const contextActive=()=>{const main=mainWorkspace();return main?main.active():document.getElementById('placeSheet')?.open&&typeof placeSheetFor!=='undefined'&&placeSheetFor==='skymap'&&!document.getElementById('recentCandidates')?.hidden;};
let dateNavigation=null,dateCalendar=null,autoSearchTimer=null,dateRefreshPending=false,hasSearched=false,returnSearch=null,returnedSearchFrame=null;
let timeChoice='day',windowStart='00:00',windowEnd='23:59',includeRoads=false;
const dataTag=new URL(document.currentScript.src,location.href).searchParams.get('v')||'0';
const dataHashes={"candidate-viewpoints.json":"f9496da00f09be194ea770c3c7e851afd84f388fe5fa388922635e53c86950c5","candidate-surveyed-viewpoints.json":"04cdbec2b777e9e2725cca737e194efb8cfcab94544cedaa62f16ed9873187ff","candidate-terrain.json":"5c78165203510383eab45feb0e2195a06c6f4d8ec5f3e682db941ca705279779","candidate-buildings.json":"e4ec51ed732be60108959a7854cdd5ae8aab46a94aaa026f0d5094101e1f4c8a","building-heights/index.json":"77a390e9e8a76264d0aad3e53b60a8ed1f7efc4243abc39c1dd65e9d5994fb12","building-shapes/index.json":"0298fc54cd928ed403b637b456b0871fe984d3978a02961a40e89e07c7d6c10c","osm-places/index.json":"101f0c969fcfdf205b775f6dad761b00b99264fd4c6905a751da38de859a4bdc","candidate-surfaces.json":"de16ae6e56aa05a1d4a7d6d0fa8974a4373183f35e8282f412f7fbd7c637751f","candidate-sidewalks.json":"efc42ec01902232f52ec36e84808dc3400892d91c5ddf663d91ef34bb123e48a","candidate-label-addresses.json":"3919fc5e919863ba593174cdd805f860d41882938667055ab456b9abe33d869b","candidate-label-facilities.json":"ca92359defa9b765fe86db8bf5053cd5921182a39af1975b9324274615efdf53","candidate-towns/index.json":"5ef17e0a21bd0dbad7d4b7244b157cafa0205a07d0e088d1f1876c06435df1b1","visibility/tokyotower.json":"c84ac9ff18a62aa3441c6a7a099f94de7873e7a4c49e86c39cec7dd52d65fdc6","visibility/skytree.json":"014ae6629d51233b56fb73f8dcafdfd7df45a632070e08c030defeae75cb7630","visibility/tocho-building.json":"9d953e2b62591e2b67fafd7f841cfc8d4643ab945309bb2eb89f495e88c40458","visibility/shibuya-sky.json":"fb4c4990b1fcd55dac45d92a96cffc0062c0fb5dbaaedc14b31c466f2e3b6bc5","visibility/azabudai-hills.json":"ac28e1b2ec05a20d5e98159e19961428e2e137e70a33e1ad644c1f2c2a907a64","visibility/kabukicho-tower.json":"f237c33491c5643248c5a8e5acd40671b604b5cc559fe1f05440d4df7903c298","visibility/tower-terror.json":"8c7c0e667c8ee8699cfe44db094b40668a8596f36edd9e9558554451f07c037f","visibility/cinderella.json":"d8df5afa0b15b14d1ccfb448c4a035c3821f9f0b63f34895d6ac112dc9902201","visibility/tinkerbell.json":"4f8936733b89e0816c1146e71b1dd20f57f79e99020a1202f31fd52e005b50ac"};
// The trial keeps no copy of this data: its page points at the production folder (build-preview.py).
const dataBase=document.querySelector('meta[name="astronotes-data-base"]')?.content||'data/';
async function readData(name,{signal,expectedHash=dataHashes[name],version=dataTag,priority}={}){
 const r=await fetch(dataBase+name+'?v='+version,{signal,priority});
 if(!r.ok)throw Error('data');
 const bytes=await r.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 if(hash!==expectedHash)throw Error('data-version');
 return JSON.parse(new TextDecoder().decode(bytes));
}
const cachedData=new Map();
function loaded(name,options={}){
 if(!cachedData.has(name)){
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),10000);
  cachedData.set(name,readData(name,{...options,signal:ctrl.signal}).catch(e=>{cachedData.delete(name);throw e;}).finally(()=>clearTimeout(timer)));
 }
 return cachedData.get(name);
}
// Saved targets standing on a PLATEAU building take its shape on this page (見え方 and new places).
const osmNamesHash=document.querySelector('meta[name="astronotes-osm-building-names"]')?.content;
const plateauShapes=globalThis.AstroNotesPlateauBuildings?.create({
 load:loaded,base:dataBase+'building-shapes/',
 loadNames:osmNamesHash?()=>loaded('building-shapes/osm-names.json',{expectedHash:osmNamesHash,version:osmNamesHash}):null
})||null;globalThis.AstroNotesPlateauShapes=plateauShapes;
// The targets the app lists carry their PLATEAU shape, so the overlap list and registered places (calculation
// workers) use it too; it is part of a pair's geometry key, so geometry made with the estimate is not reused.
if(typeof globalThis.aimTargetList==='function'&&!globalThis.aimTargetList.plateauShapes){
 const listed=globalThis.aimTargetList,withShape=function(){return listed.apply(this,arguments).map(t=>{const m=String(t?.id||'').startsWith('fav:')&&globalThis.AstroNotesCityModels?.[t.id];return m&&String(m.id).startsWith('plateau-')?{...t,cityModel:m}:t;});};
 withShape.plateauShapes=true;globalThis.aimTargetList=withShape;
}
async function refreshShapes(){
 if(!plateauShapes||typeof aimTargetList!=='function')return;
 try{const changed=await plateauShapes.prepare(aimTargetList());if(!changed.length)return;if(changed.includes(SkyMapUI?.selectionState?.()?.target?.id))SkyMapUI.render?.();document.dispatchEvent(new Event('astronotes-records-change'));
 }catch{/* Shapes are an enhancement; the outline estimate stays. */}
}
document.addEventListener('astronotes-records-change',refreshShapes);
let againForRecords=null;document.addEventListener('astronotes-records-change',()=>againForRecords?.());
(globalThis.startupSessionReady||Promise.resolve()).then(refreshShapes,()=>{});
let availableLabels=null;
const loadLabels=async()=>{const [addresses,facilities]=await Promise.all(['candidate-label-addresses.json','candidate-label-facilities.json'].map(n=>loaded(n).catch(()=>null)));return availableLabels={addresses,facilities};};
const knownTownAddresses=new Map(),townKey=({latitude,longitude})=>latitude+','+longitude;
function setTownAddress(row,{address,year}){
 row.place.subtitle=address.names[0];row.labels.address=address;row.labels.addressYear=year;
}
async function fillTownAddresses(rows,isCurrent){
 const unresolved=rows.filter(row=>['outside-coverage','no-area-match','unavailable'].includes(row.labels.address.status));
 if(!unresolved.length)return false;
 const index=await loaded('candidate-towns/index.json',{priority:'low'}).catch(()=>null);
 if(!index||!isCurrent())return false;
 const matches=await Promise.all(unresolved.map(async row=>{
  const files=AstroNotesCandidateLabels.townFiles(index,row.place);
  const layers=await Promise.all(files.map(ward=>loaded('candidate-towns/'+ward.file,{expectedHash:ward.sha256,priority:'low'}).catch(()=>null)));
  return {row,address:AstroNotesCandidateLabels.townAddress(layers,row.place)};
 }));
 if(!isCurrent())return false;
 let changed=false;
 for(const {row,address} of matches)if(address){
  const value={address,year:index.year};
  knownTownAddresses.set(townKey(row.place),value);
  if(knownTownAddresses.size>1024)knownTownAddresses.delete(knownTownAddresses.keys().next().value);
  setTownAddress(row,value);changed=true;
 }
 return changed;
}
const filterKey=p=>JSON.stringify([p.owner,p.body,p.target,p.partId,p.limb,p.matchMode,p.includeRoads===true]);
// Shared, bounded tile cache for recorded rows. Road edges classify a location;
// they never make it a new candidate or change its visibility evidence.
const recordedPlaceContext=AstroNotesCandidateLabels.createRoadContext({fetchImpl:fetch.bind(globalThis),decodeAreas:(...args)=>AstroNotesTerrain.decodeWaterLayer(...args),
 loadFacilities:async p=>{try{if(!osmPlaces)throw Error('facility-data-unavailable');return AstroNotesCandidateDiscovery.createPlaceProvider.parseElements(await osmPlaces.elementsIn([p.longitude,p.latitude,p.longitude,p.latitude]));}
  catch(e){globalThis.AstroNotesErrors?.note('candidates.facilities',e);throw e;}}});
AstroNotesCandidatePicker.configure({loadLabels,labelsSnapshot:()=>availableLabels,createMapView,filterKey,alignmentText:(t,v)=>MyPlacesUI.alignmentText(t,v),bodyName:id=>AstroNotesBodies.definition(id)?.name||id,mapIcon:UI_ICONS.map,
 angleIcons:{up:UI_ICONS.angleUp,down:UI_ICONS.angleDown,level:UI_ICONS.angleLevel},
 geometryFrom:(...args)=>AstroNotesAlign.geometryFrom(...args),isMountain:t=>aimIsMountain(t),geometryKey:()=>AstroNotesAtmosphere.targetK(),
 placeContext:recordedPlaceContext,
 getScroller:()=>mainWorkspace()?.scroller(),getReturnScroll:()=>mainWorkspace()?.returnScroll?.(),
 onRendered(count){mainWorkspace()?.restoreScroll(count);globalThis.AstroNotesMapWorkspace?.refreshCandidatePins();
  const toggle=document.getElementById('candidateMapToggle'),label=toggle?.querySelector('[data-candidate-map-label]');
  if(!label)return;
  const onMap=document.getElementById('skyMapView').hasAttribute('data-explore-sheet');
  const text=onMap?'ピンに合わせる':toggle.getAttribute('aria-expanded')==='true'?'一覧に戻る':'地図';
  if(label.textContent!==text)label.textContent=text;
  if(onMap){toggle.removeAttribute('aria-expanded');toggle.setAttribute('aria-controls','skyMapCanvas');}
  else if(toggle.getAttribute('aria-controls')==='skyMapCanvas'){toggle.removeAttribute('aria-controls');toggle.setAttribute('aria-expanded','false');}
 },requestKey:p=>AstroNotesCandidateDiscovery.requestKey(p)});
const live=AstroNotesCandidateTerrain.createLive({geo:AstroNotesTerrain,maxDurationMs:120000,lookAhead:true});
 // Ground under GSI footprints the height grid lacks: the 10 m DEM (a building's base, not a sight line) on its own
 // tile budget, so it never starves the sight-line terrain. A search step longer than 35 s no longer runs out of time.
 const footprintGround=AstroNotesCandidateTerrain.createLive({geo:AstroNotesTerrain,maxTiles:160,maxDurationMs:120000,layers:[['dem',14]]});
const groundPort={...AstroNotesTerrain,resetBudget:()=>live.resetBudget(),groundElevation:async(lat,lon,options={})=>{const r=await live.sample({latitude:lat,longitude:lon},options);return options.withSource?(Number.isFinite(r.height)?{elevation:r.height,source:r.layer}:null):r.height;}};
// Places, woods and bridges from the bundled OSM extract (Overpass only if it cannot be read).
 const osmPlaces=globalThis.AstroNotesOsmPlaces?.create({load:loaded,base:dataBase+'osm-places/'})||null;
 const provider=AstroNotesCandidateDiscovery.createPlaceProvider({terrain:groundPort,fetchImpl:fetch.bind(globalThis),loadViewpoints:()=>loaded('candidate-viewpoints.json'),loadSurveyed:()=>loaded('candidate-surveyed-viewpoints.json'),places:osmPlaces});
let modelPromise=null,staticPromise=null,viewModelPromise=null;
const staticTerrain=()=>staticPromise||=loaded('candidate-terrain.json').then(d=>d?AstroNotesCandidateTerrain.decode(d):null).catch(()=>null);
// The composition's ground line comes from the search's own sight line to the target (2026-11-13): one calculation
// for the list and the figure. Its own tile budget, so a figure never starves a running search.
const viewLive=AstroNotesCandidateTerrain.createLive({geo:AstroNotesTerrain,maxTiles:300,maxDurationMs:60000});
// Buildings: PLATEAU top heights (every city PLATEAU covers) along each line, GSI footprints elsewhere. One instance, so
// the figure's buildings in front and the search's share their tiles.
let heightsModel=null;
// Trees: the canopy map read where a line needs it, standing on the 10 m DEM. Its own tile budget for the ground.
const treeGround=AstroNotesCandidateTerrain.createLive({geo:AstroNotesTerrain,maxTiles:200,maxDurationMs:120000,layers:[['dem',14]]});
const treeHeights=globalThis.AstroNotesTreeHeights?.create({groundAt:p=>treeGround.sample(p).then(r=>r.height)})||null;
const sharedHeights=()=>heightsModel||=AstroNotesCandidateHeights.create({base:dataBase+'building-heights/',loadIndex:()=>loaded('building-heights/index.json'),ownFootprint:key=>plateauShapes?.footprint(key)||null,ownFootprintVersion:key=>plateauShapes?.attachedTo(key)||null,
 obstacles:osmPlaces?(a,b)=>osmPlaces.obstaclesAlong(a,b):null,gsiAlong:(a,b)=>AstroNotesTerrain.gsiBuildingsAlong(a,b),groundAt:p=>footprintGround.sample(p).then(r=>r.height)});
// 見える場所の地図 (visibility-map.js). Built-in targets carry a map made beforehand (tools/build-visibility-maps.mjs);
// a saved target's map is made on this device while searching (at most MAP_BUDGET_MS a search, to 20 km) and kept here.
const MAP_BUDGET_MS=20000;
const visibilityStore=(()=>{let db=null;
 const open=()=>db||=new Promise((resolve,reject)=>{if(typeof indexedDB==='undefined'){reject(Error('indexedDB unavailable'));return;}const r=indexedDB.open('astronotes-visibility-map',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('maps');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}).catch(e=>{db=null;throw e;});
 const run=(mode,fn)=>open().then(d=>new Promise((resolve,reject)=>{const tx=d.transaction('maps',mode),req=fn(tx.objectStore('maps'));tx.oncomplete=()=>resolve(req?.result);tx.onerror=()=>reject(tx.error);}));
 return {get:key=>run('readonly',s=>s.get(key)),set:(key,value)=>run('readwrite',s=>s.put(value,key))};})();
const mapGround=AstroNotesCandidateTerrain.createLive({geo:AstroNotesTerrain,maxTiles:3000,maxDurationMs:600000,layers:[['dem',14]]});
const builtInMaps=new Set(Object.keys(dataHashes).filter(n=>n.startsWith('visibility/')).map(n=>n.slice(11,-5)));
const visibilityMap=globalThis.AstroNotesVisibilityMap?.create({ground:mapGround,buildings:sharedHeights(),trees:treeHeights,store:visibilityStore,capM:20000,
 builtIn:target=>builtInMaps.has(target.id)?loaded('visibility/'+target.id+'.json'):null})||null;
const mapEligible=plan=>!!plan?.target&&!(plan.composition||plan.strict||plan.profile==='summit-contact'||plan.target.rim)&&(plan.target.parts||[]).some(p=>Number.isFinite(p.m));
const prefilter=visibilityMap&&{
 async regions(plan,regions,{isCurrent,deadline=Infinity}){
  if(!mapEligible(plan))return null;const t=plan.target,inv=(lat,lon)=>AstroNotesTerrain.inverse(t.latitude,t.longitude,lat,lon).azimuth;
  const bearings=regions.flatMap(r=>{const [w,s,e,n]=r.bbox;return [inv((s+n)/2,(w+e)/2),inv(s,w),inv(s,e),inv(n,w),inv(n,e)];});
  const m=await visibilityMap.ensure(t,bearings,{isCurrent,deadline:Math.min(deadline,Date.now()+MAP_BUDGET_MS)});if(!m?.levels?.length||!m.sectors.size)return null;
  const need=AstroNotesVisibilityMap.needFor(m);
  return {regions:regions.filter(r=>!AstroNotesVisibilityMap.regionHidden(m,t,r.bbox,need)),context:{map:m,need}};
 },
 point(plan,point,{map,need}){const r=AstroNotesVisibilityMap.lookup(map,plan.target,point.latitude,point.longitude);return !(r.known&&r.count<need);}
};
// Share canopy pixels, while the preview and search use independent DEM request budgets.
const viewTreeGround=AstroNotesCandidateTerrain.createLive({geo:AstroNotesTerrain,maxTiles:160,maxDurationMs:60000,layers:[['dem',14]]});
const viewTrees=treeHeights&&{sight:(observer,ray,options)=>treeHeights.sight(observer,ray,{...options,sampleGround:p=>viewTreeGround.sample(p).then(r=>r.height)})};
const viewModel=()=>viewModelPromise||=staticTerrain().then(dem=>AstroNotesCandidateModel.createGeneric({align:AstroNotesAlign,bodies:AstroNotesBodies,geo:AstroNotesTerrain,terrain:viewLive,heights:sharedHeights(),trees:viewTrees,
 staticTerrain:dem}));
const roofViewModel=AstroNotesCandidateModel.createGeneric({align:AstroNotesAlign,heights:sharedHeights()});
const previewCache=new Map();
const previewKey=(o,t,refractionK)=>[o.latitude,o.longitude,o.elevation,o.eyeM,t.id,t.latitude,t.longitude,plateauShapes?.attachedTo(t.id)?.id??null,refractionK];
function cachedPreview(key,current,read,complete){
 const saved=previewCache.get(key);
 if(saved&&saved.until>Date.now()&&!saved.cancelled){
  saved.readers?.add(current);previewCache.delete(key);previewCache.set(key,saved);
  return saved.promise;
 }
 const entry={until:Infinity,promise:null,readers:new Set([current]),cancelled:false};
 const isCurrent=()=>{
  if(!entry.readers)return false;
  for(const reader of entry.readers)if(!reader())entry.readers.delete(reader);
  if(entry.readers.size)return true;
  entry.cancelled=true;return false;
 };
 entry.promise=Promise.resolve().then(()=>read(isCurrent)).then(value=>{
  if(!complete(value))entry.until=Date.now()+12000;
  return value;
 }).catch(error=>{if(previewCache.get(key)===entry)previewCache.delete(key);throw error;})
 .finally(()=>{entry.readers=null;});
 previewCache.set(key,entry);
 while(previewCache.size>12)previewCache.delete(previewCache.keys().next().value);
 return entry.promise;
}
const stillHere=()=>true;
AstroNotesCandidatePicker.movementSurface=async(seed,current=stillHere,{refresh=false}={})=>{
 const shape=AstroNotesShooting.cleanShape(seed.shape||globalThis.MyPlacesUI?.withShape?.(seed)?.shape);
 if(shape){const vertices=shape.vertices.map(p=>[p.longitude,p.latitude]),ring=[...vertices,vertices[0]];
  return {origin:{latitude:seed.latitude,longitude:seed.longitude},radiusM:600,label:seed.name||'記録の撮影範囲',kind:'recorded',sourceIds:[],boundary:shape.type==='area'?[[ring]]:[],
   geometry:shape.type==='area'?{polygons:[[ring]],lines:[]}:{polygons:[],lines:[vertices]}};
 }
 if(seed.nonTerrainStructure)return null;
 return provider.nearby(seed,{isCurrent:current,refresh});
};
AstroNotesCandidatePicker.movementPoint=AstroNotesCandidateDiscovery.createPlaceProvider.movementPoint;
AstroNotesCandidatePicker.movementGuides=(plan,domain,options)=>AstroNotesCandidateComposition.localGuides(plan,domain,{...options,align:AstroNotesAlign,bodies:AstroNotesBodies,yieldTask:AstroNotesLibrary.pause});
AstroNotesCandidatePicker.hiddenView=(observer,target,partId,current=stillHere)=>{
 const refractionK=AstroNotesAtmosphere.targetK();
 return cachedPreview(JSON.stringify(['center',...previewKey(observer,target,refractionK),target.groundM,target.parts,partId]),current,async isCurrent=>{
  const model=await viewModel();
  if(!isCurrent())throw Error('candidate-cancelled');
  viewLive.resetBudget();viewTreeGround.resetBudget();
  return model.hiddenView(observer,target,{partId,isCurrent,refractionK});
 },value=>value?.complete);
};
AstroNotesCandidatePicker.skylineView=(observer,target,azimuths,current=stillHere)=>{
 const refractionK=AstroNotesAtmosphere.targetK();
 return cachedPreview(JSON.stringify(['roof',...previewKey(observer,target,refractionK),azimuths]),current,isCurrent=>
  roofViewModel.skylineView(observer,target,azimuths,{isCurrent,refractionK}),rows=>rows?.every(row=>row.complete));
};
async function loadModel(){
 // The 3D band model is no longer loaded.
 if(!modelPromise)modelPromise=(async()=>{await AstroNotesAssets.ensureModels();const dem=await staticTerrain();
  return AstroNotesCandidateModel.createGeneric({align:AstroNotesAlign,bodies:AstroNotesBodies,geo:AstroNotesTerrain,terrain:live,heights:sharedHeights(),trees:treeHeights,staticTerrain:dem,sidewalks:await loaded('candidate-sidewalks.json').catch(()=>null),angularPrefilter:true});
  })().catch(e=>{modelPromise=null;throw e;});
 return modelPromise;
}
let evaluationBudgetStarted=false;
const engine=AstroNotesCandidateDiscovery.createGenericSearch({provider,bodies:AstroNotesBodies,prefilter,acceptCandidate:(plan,row)=>{
 if(!plan.pointNight)return true;const o=row.assumedObserver||row.place;if(!o)return false;
 return AstroNotesShooting.nightAllowed(plan.body,row.event?.at,{...o,elevation:(o.elevation??0)+(o.eyeM??o.eyeHeightAGL??1.5)},AstroNotesBodies);
},evaluate:async(p,point,data,options)=>{const model=await loadModel();
if(plateauShapes&&String(p.target?.id||'').startsWith('fav:')&&!plateauShapes.attachedTo(p.target.id))await plateauShapes.prepare([p.target]).catch(()=>{});if(!options.isCurrent())throw Error('candidate-cancelled');
if(!evaluationBudgetStarted){live.resetBudget();footprintGround.resetBudget();treeGround.resetBudget();
evaluationBudgetStarted=true;}
// A surveyed place lies off the day's line and reads ground no other place of the batch reads (an observation room's rays
// run far over the land): the 96 tiles of a batch ran out on the surveyed places and left them and the places after them
// unconfirmed (2026-11-15). Each gets a tile budget to itself, four times a batch's (渋谷スカイ, 229 m up and 11 km from
// 東京スカイツリー, did not fit in one), and leaves a fresh one behind.
if(point.surveyedTargets){live.resetBudget(4);try{return await model.evaluate(p,point,data,options);}finally{live.resetBudget();}}
return model.evaluate(p,point,data,options);}});
const stop=()=>{if(autoSearchTimer!==null)clearTimeout(autoSearchTimer);autoSearchTimer=null;if(watch!==null)clearInterval(watch);watch=null;controller?.abort();controller=null;};
// The refraction settings only: weather the view loads later for a chosen place (気象予報) must not discard the places
// already found when going back to the list (2026-11-11, seen on the iPhone). The evaluator keys its own caches by the data.
const air=()=>JSON.stringify([typeof aimAirSettings==='undefined'?'standard':aimAirSettings]);
const context=s=>JSON.stringify([s.body,s.target,s.partId,s.limb,AstroNotesCandidateDiscovery.day(s.at),s.matchMode||'limb']);
function missingSearchTime() {
 if (timeChoice !== 'window') return null;
 if (!windowStart) return 'candidateSearchStart';
 return windowEnd ? null : 'candidateSearchEnd';
}
AstroNotesCandidatePicker.searchTiming = at => ({timeSpec: timeSpec(at), missingField: missingSearchTime()});
function timeSpec(at){
 if(timeChoice==='instant')return {kind:'instant',at};
 if(timeChoice==='window'){const start=AstroNotesCandidateDiscovery.day(at),ms=x=>{const [h,m]=x.split(':').map(Number);return (h*60+m)*60000;},a=ms(windowStart),b=ms(windowEnd);return {kind:'window',start:start+a,end:start+b+(b<a?86400000:0)};}
 return {kind:'day',at:AstroNotesCandidateDiscovery.day(at),timezone:'Asia/Tokyo'};
}
let onlyMapBand=false;
function snapshot(){
 if(typeof SkyMapUI==='undefined'||typeof auth==='undefined'||!auth||typeof screenAllowed!=='function'||!screenAllowed('skymap')||!screenAllowed('framing'))return null;
 const s=SkyMapUI.selectionState();if(!s?.target||!Number.isFinite(s.at))return null;
 const host=document.querySelector('#exploreScenePanel #aimLook'),view=host?._trialCompositionView;
 // The preview fills the same map-owned content width (max 780px); derive its dimensions without revealing or painting it.
 const W=mainWorkspace()?.previewWidth(),H=W?(host?._full&&host._fullH?Math.round(host._fullH):Math.round(Math.min(W>=640?620:440,W*(aimIsMountain(s.target)?.66:.9)))):null;
 const lens=typeof aimLens==='undefined'?null:{mode:aimLens.on&&aimLens.mode==='manual'?'evaluate':'unspecified',focal:aimLens.focal,sensorWidth:AIM_SENSOR[aimLens.sensor]?.[0],sensorHeight:AIM_SENSOR[aimLens.sensor]?.[1],portrait:aimLens.portrait,crop:1,viewModel:'scene',
 aspect:W&&H?W/H:view?.W&&view?.H?view.W/view.H:1,pan:[...(host?._lensOffset||[0,0])],targetExtent:s.partId==='__whole'?'overlap':'anchor'};
 const extraTargets=typeof aimSceneExtraTargets==='function'?aimSceneExtraTargets(s.target.id):[];
 // With one target overlapped as a whole, only the body and what it overlaps have to fit (2026-11-11 ユーザー「天体と重なる所
 // だけ確認」): no lens drops a place then, so the lens stays out of the search. Choosing a place sets the focal length and the
 // frame for its view; leaving the lens in the key would drop the found places on the way back.
 const searchLens=s.partId==='__whole'&&!extraTargets.length?{mode:'unspecified'}:lens;
 const seedBand=onlyMapBand?globalThis.AstroNotesMapWorkspace?.searchBand?.(s):null;
 const selected={...s,authGeneration:mainWorkspace()?.epoch(),owner:auth.loginId,expected:context(s),atmosphere:air(),lens:searchLens,extraTargets,timeSpec:timeSpec(s.at),pointNight:!AstroNotesBodies.definition(s.body)?.limbs,profile:typeof aimIsMountain==='function'&&aimIsMountain(s.target)?'summit-contact':'building-near',
  ...(globalThis.AstroNotesTrialComposition?.plan(s)||{}),...(globalThis.AstroNotesTrialOverlap?.searchPlan?.(s)||{}),includeRoads,
  // 地図の帯を指定した場合は、その範囲に探索の種を絞る。
  ...(seedBand?{seedBand}:{})};
 // A next-day event in an overnight window does not change the search day.
 const overnight=returnSearch&&s.candidateOpportunity?.id===returnSearch.rowId&&s.at===returnSearch.viewAt?
  {...selected,at:returnSearch.plan.at,timeSpec:returnSearch.plan.timeSpec}:null;
 // The preview can change the focal length and pan to frame a candidate.
 // On return, keep those preview values out of the original search's identity.
 if(returnedSearchFrame&&mainWorkspace()?.active()){
  for(const plan of overnight?[overnight,selected]:[selected]){
   const originalFrame={...plan,lens:returnedSearchFrame.lens};
   if(uiKey(originalFrame)===returnedSearchFrame.identity)return originalFrame;
  }
  returnedSearchFrame=null;
 }
 if(overnight&&key(overnight)===returnSearch.key)return overnight;
 return selected;
}
const key=p=>p?AstroNotesCandidateDiscovery.requestKey(p):'';
const uiKey=p=>key(p)+'|'+(p?.authGeneration??'');
AstroNotesCandidatePicker.captureSearchPlan=()=>{const plan=snapshot();return plan&&engine.cached(plan)?plan:null;};
// 2026-11-25 ユーザー「別のAppに飛んで戻ると一覧に移動してる」「条件変わってないのに毎回検索始める」: iPhoneは裏へ回したページを
// 捨てて読み直す。見つけた候補を持ち越し、読み直した後も同じ条件なら探し直さずに出す。
AstroNotesCandidatePicker.exportSearch=plan=>{plan=plan||snapshot();const result=plan&&engine.cached(plan);return result?{key:key(plan),result}:null;};
AstroNotesCandidatePicker.importSearch=saved=>{const plan=snapshot();if(!plan||!saved||key(plan)!==saved.key||!engine.prime?.(plan,saved.result))return false;
 // The section for these conditions may already be on the page without results: build it again from the kept result.
 condition='';scheduleMount();return true;};
AstroNotesCandidatePicker.restoreSearchFrame=plan=>{returnedSearchFrame=plan?{lens:plan.lens,identity:uiKey(plan)}:null;};
AstroNotesCandidatePicker.registeredPlan=fallback=>mainWorkspace()||typeof placeSheetFor!=='undefined'&&placeSheetFor==='skymap'?snapshot()||fallback:fallback;
// Registered rows keep their original selection action, but use the same full
// request identity and explicit time/lens eligibility as generated rows.
AstroNotesCandidatePicker.registerRegisteredFromSession=(box,rows,legacyPlan,legacyCurrent)=>{
 const selected=snapshot();if(!selected)return;
 const identity=key(selected),eligible=()=>legacyCurrent()&&key(snapshot())===identity;
 const range=AstroNotesCandidateComposition.timeRange(selected),nodes=[...box.children].filter(n=>n.tagName==='BUTTON'&&n.classList.contains('list-item')),kept=[];
 for(let i=0;i<rows.length;i++){
  const row=rows[i],node=nodes[i];if(!node)continue;let allowed=range&&row.event?.at>=range.start&&row.event.at<=range.end;
  if(allowed&&selected.lens&&selected.lens.mode!=='unspecified')try{
   const obs=row.assumedObserver,g=obs&&AstroNotesAlign.geometryFrom(obs,selected.target,{partId:selected.partId==='__whole'?null:selected.partId,eyeM:obs.eyeM});
   const st=g&&AstroNotesBodies.state(selected.body,row.event.at,{...obs,elevation:obs.elevation+obs.eyeM});allowed=!!g&&AstroNotesCandidateModel.lensCheck(selected,obs,st,g,AstroNotesAlign).fits;
  }catch{allowed=false;}
  if(!allowed){node.remove();continue;}const click=node.onclick;node.onclick=event=>{if(eligible())click?.call(node,event);};kept.push(row);
 }
 AstroNotesCandidatePicker.registerRegistered(box,kept,selected,eligible);
};

function resultsCurrent(p,node){
 return node===section&&node.isConnected&&contextActive()&&p.authGeneration===mainWorkspace()?.epoch()&&key(snapshot())===key(p);
}
function current(token,p,node){return token===run&&resultsCurrent(p,node);}
function mapAnchor(point){
 const apps=AstroNotesPlan.externalApps;if(!apps||!point||!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude))return null;
 const link=document.createElement('a');link.className='fav-btn tiny';link.textContent='地図アプリで開く';link.href=apps.mapApps.google.url(point.latitude.toFixed(7)+', '+point.longitude.toFixed(7));link.target='_blank';link.rel='noopener';
 link.onclick=e=>{e.preventDefault();apps.requestMap(point,{source:link,isCurrent:()=>link.isConnected});};return link;
}
function syncRecordSave(host,toolbar){
 const share=toolbar.querySelector('.aim-figure-share');if(!share)return;
 const place=share.querySelector('[data-quick-save=place]'),plan=share.querySelector('[data-quick-save=plan]');if(!place||!plan)return;
 let dialog=share.querySelector('#trialRecordSaveSheet'),button=share.querySelector('#trialRecordSave');
 if(!dialog){
  button=document.createElement('button');button.id='trialRecordSave';button.type='button';button.className='trial-record-action';button.setAttribute('aria-label','記録に保存');button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');
  button.setAttribute('aria-controls','trialRecordSaveSheet');
  const svg=document.querySelector('#recordsMenu svg').cloneNode(true);svg.removeAttribute('class');svg.setAttribute('width','24');svg.setAttribute('height','24');
  const plus=document.createElementNS('http://www.w3.org/2000/svg','path');plus.setAttribute('d','M19 13v8m-4-4h8');plus.setAttribute('data-record-add','');
  const gap=document.createElementNS('http://www.w3.org/2000/svg','path');gap.setAttribute('d','M19 13v8m-4-4h8');gap.setAttribute('stroke','var(--card)');gap.setAttribute('stroke-width','5');svg.append(gap,plus);button.append(svg);const label=document.createElement('span');label.textContent='記録';
  button.append(label);
  dialog=document.createElement('dialog');dialog.id='trialRecordSaveSheet';dialog.className='sheet trial-record-dialog';dialog.setAttribute('aria-label','記録に保存');dialog.tabIndex=-1;
  const head=document.createElement('div');head.className='sheet-head';const title=document.createElement('strong');title.textContent='記録に保存';const close=document.createElement('button');close.type='button';close.textContent='閉じる';close.setAttribute('data-record-save-close','');
  head.append(title,close);
  const choices=document.createElement('div');choices.className='sheet-body';for(const [option,text] of [[place,'撮影地点に保存'],[plan,'予定に保存']]){const label=document.createElement('span');label.setAttribute('data-save-choice-label','');label.textContent=text;option.append(label);
  option.setAttribute('aria-label',text);option.title=text;choices.append(option);}
  dialog.append(head,choices);share.append(button,dialog);
  button.onclick=()=>{if(!host.closest('#exploreScenePanel')||host.closest('#exploreScenePanel').hidden)return;if(dialog.open&&dialog.matches(':modal'))return;if(dialog.open)dialog.close();dialog.restoreRecordFocus=true;button.setAttribute('aria-expanded','true');showSheet(dialog);};
  close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>{if(dialog.open)return;button.setAttribute('aria-expanded','false');if(dialog.restoreRecordFocus&&button.isConnected&&host.closest('#exploreScenePanel'))button.focus({preventScroll:true});});
  dialog.addEventListener('click',e=>{const choice=e.target.closest('[data-quick-save]');if(choice&&!choice.disabled){queueMicrotask(()=>{if(dialog.open)dialog.close();});return;}if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();
  if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
 }
 const choices=dialog.querySelector('.sheet-body');
 for(const [option,text] of [[place,'撮影地点に保存'],[plan,'予定に保存']]){if(!option.querySelector('[data-save-choice-label]')){const label=document.createElement('span');label.setAttribute('data-save-choice-label','');label.textContent=text;option.append(label);option.setAttribute('aria-label',text);
 option.title=text;}if(option.parentElement!==choices)choices.append(option);}
 const hidden=!!host.closest('#exploreScenePanel')?.hidden;if(button.hidden!==hidden)button.hidden=hidden;button.disabled=place.disabled&&plan.disabled;
}
function syncObserverMap(){
 watchPreview();
 const old=document.getElementById('exploreExternalMap'),s=snapshot(),point=s?.observer,toolbar=document.querySelector('#exploreScenePanel #aimLook .trial-scene-toolbar');
 if(toolbar)globalThis.AstroNotesTrialComposition?.syncToolbar?.(toolbar.closest('#aimLook'));
 if(!toolbar||!point){old?.remove();return;}syncRecordSave(toolbar.closest('#aimLook'),toolbar);
 const next=mapAnchor(point);if(!next){old?.remove();return;}
 if(old?.href===next.href){if(old.parentElement!==toolbar)toolbar.append(old);return;}
 old?.remove();next.id='exploreExternalMap';next.className='trial-map-action';next.setAttribute('aria-label','撮影地点を地図アプリで開く');next.title='地図アプリで開く';next.innerHTML=UI_ICONS.map+'<span>地図</span>';toolbar.append(next);
}
const dateValue=at=>new Date(at+32400000).toISOString().slice(0,10);
function changeCandidateDay(value){
 const selected=snapshot()||dateSelection();if(!selected||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const start=Date.parse(value+'T00:00:00+09:00');if(!Number.isFinite(start)||dateValue(start)!==value)return false;
 const previous=AstroNotesCandidateDiscovery.day(selected.at);if(start===previous)return true;
 const repeat=hasSearched,family=filterKey(selected);returnSearch=null;stop();run++;
 SkyMapUI.setTime(start+(selected.at-previous));mount();
 if(repeat)autoSearchTimer=setTimeout(()=>{autoSearchTimer=null;const latest=snapshot();if(!latest||filterKey(latest)!==family||AstroNotesCandidateDiscovery.day(latest.at)!==start||!contextActive())return;const button=document.querySelector('#additionalCandidateSearch > button');
 if(button&&!button.disabled&&button.dataset.state!=='searching')button.click();},350);
 return true;
}
function syncCandidateDate(control,p){
 if(mainWorkspace())return;
 if(!dateNavigation){
  dateNavigation=document.createElement('div');dateNavigation.id='candidateDateNavigation';dateNavigation.setAttribute('role','group');dateNavigation.setAttribute('aria-label','候補を探す日');
  Object.assign(dateNavigation.style,{display:'grid',gridTemplateColumns:'44px minmax(0,1fr) 44px',gap:'8px',marginBottom:'14px',alignItems:'center'});
  const prev=document.createElement('button'),next=document.createElement('button'),input=document.createElement('button');
  for(const [b,id,label,text,step]of [[prev,'candidatePreviousDay','前日の候補','‹',-1],[next,'candidateNextDay','翌日の候補','›',1]]){b.type='button';b.className='chip';b.id=id;b.textContent=text;b.setAttribute('aria-label',label);
  Object.assign(b.style,{width:'44px',height:'44px',padding:'0',fontSize:'26px',lineHeight:'1'});b.onclick=()=>{const current=snapshot()||dateSelection();if(current)changeCandidateDay(dateValue(current.at+step*86400000));};}
  input.id='candidateDate';input.type='button';input.className='fav-btn';input.setAttribute('aria-label','カレンダーで候補日を選ぶ');input.setAttribute('aria-haspopup','dialog');
  Object.assign(input.style,{width:'100%',minWidth:'0',maxWidth:'100%',boxSizing:'border-box',height:'44px',minHeight:'44px',fontSize:'16px',textAlign:'center',padding:'8px'});
  dateCalendar=ToolDateTimeBar.calendar({button:input,getAt:()=>dateSelection()?.at??Date.now(),setDay:at=>changeCandidateDay(dateValue(at))});dateCalendar.id='candidateDateCalendar';

  dateNavigation.append(prev,input,next);
 }
 if(dateNavigation.parentNode!==control)control.prepend(dateNavigation);
 const input=dateNavigation.querySelector('#candidateDate');input.dataset.date=dateValue(p.at);ToolDateTimeBar.dateText(input,p.at);
}
function syncWorkspaceSection(panel){
 if(!section?.isConnected)return;
 const dedicated=!!mainWorkspace(),parent=dedicated?(mainWorkspace().newPlacesHost?.()||document.getElementById('candidateWorkspaceAction')):panel;
 if(parent&&section.parentNode!==parent){if(dedicated)parent.prepend(section);else parent.append(section);}
}
function showCandidateProgress(status,label,compact){
 status.removeAttribute('data-announcement');
 if(!compact){
  const progress=globalThis.MyPlacesUI.recordProgress(status,label);
  progress.node.classList.add('candidate-wait');
  return message=>progress.update(undefined,undefined,message);
 }
 const waiting=document.createElement('div'),text=document.createElement('span'),track=document.createElement('div'),fill=document.createElement('span');
 waiting.className='candidate-wait';text.textContent=label;
 track.className='note-progress';track.setAttribute('data-indeterminate','');track.setAttribute('role','progressbar');track.setAttribute('aria-label','検索の進捗');
 fill.className='note-progress-fill';fill.setAttribute('aria-hidden','true');track.append(fill);waiting.append(text,track);status.replaceChildren(waiting);
 return message=>{if(text.textContent!==message)text.textContent=message;};
}
function keepCandidateFeedbackInView(status){
 const feedback=status.parentElement;
 if(feedback?.id!=='candidateSearchFeedback'||!feedback.parentElement.hasAttribute('data-candidate-searching'))return;
 const rect=feedback.getBoundingClientRect();
 if(!feedback.contains(document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)))return;
 // Restoring the search options after the compact progress row can put the
 // outcome under the fixed time controls. Respect a user who has scrolled away.
 requestAnimationFrame(()=>{
  if(!feedback.isConnected||status.hasAttribute('data-announcement')||feedback.closest('[hidden]')||feedback.parentElement.hasAttribute('data-candidate-searching'))return;
  const bar=document.querySelector('#skyMapView .sky-map-footer')?.getBoundingClientRect();
  const available=bar?.height?Math.min(innerHeight,bar.top):innerHeight;
  const overlap=feedback.getBoundingClientRect().bottom-available;
  const scroller=mainWorkspace()?.scroller()||document.scrollingElement;
  if(overlap>=0&&scroller)scroller.scrollTop+=overlap+12;
 });
}
function mount(){
 syncObserverMap();const panel=document.getElementById('recentCandidates'),sheet=document.getElementById('placeSheet');
 if(!panel||!contextActive()){dateRefreshPending=false;if(section){stop();run++;hasSearched=false;AstroNotesCandidatePicker.suspend?.();if(dateCalendar?.open)dateCalendar.close();section.remove();section=null;condition='';}return;}
 const p=snapshot(),id=uiKey(p),main=mainWorkspace();if(main&&homeCondition&&homeCondition!==id)main.reset();homeCondition=id;
 if(p)syncCandidateDate(AstroNotesCandidatePicker.mount(panel,p,{compact:!!main}),p);
 if(section?.isConnected&&condition===id){syncWorkspaceSection(panel);return;}
 const detailsOpen=!!section?.querySelector('details')?.open,editing=section?.contains(document.activeElement)?document.activeElement.id:null;
 stop();run++;section?.remove();condition=id;section=document.createElement('section');section.id='additionalCandidateSearch';section.setAttribute('aria-label','撮影候補地点の探索');
 const status=document.createElement('div');status.className='tiny';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 function setStatus(text,announceOnly=false){
  if(!announceOnly)keepCandidateFeedbackInView(status);
  status.toggleAttribute('data-announcement',announceOnly);status.textContent=text;
 }
 const button=document.createElement('button');button.type='button';button.className='fav-btn';button.id='candidateSearchAction';button.setAttribute('aria-controls',main?'exploreSearchResults':'additionalCandidateResults');
 const resultList=document.createElement('div');resultList.id='additionalCandidateResults';
 const evidence=document.createElement('details');evidence.className='aim-disclosure';evidence.open=detailsOpen;
 const summary=document.createElement('summary');summary.textContent=main?'検索範囲':'候補の条件・注意点・出典';evidence.append(summary);
 if(main){
  const range=document.createElement('span');range.className='candidate-query-range';
  range.textContent=timeChoice==='instant'?'選択した時刻':timeChoice==='window'?windowStart&&windowEnd?windowStart+'〜'+windowEnd:'時間帯を指定':'この日全体';
  if(p?.seedBand)range.textContent+='・地図の帯';
  if(includeRoads)range.textContent+='・道路含む';
  summary.append(range);
 }
 const description=document.createElement('p');description.className='tiny';description.textContent=(p?.overlapMembers?'全ての対象を合わせた輪郭に重なる地点を探します。':p?.extraTargets?.length?'重ねる対象で探します。ほかの対象は見え方で一緒に確認できます。 ':'')
  +'選択した天体と登録対象の位置・高さから撮影する地域を逆算し、展望台・展望スペース・公園・高台・広場・河川敷を探します。'+(includeRoads?'道路などの地点も含めます。':'')+'建物は近くを通る構図も含みます。見え方で確認できます。';
 if(!main)evidence.append(description);
 const timeLabel=document.createElement('label');timeLabel.className='tiny';timeLabel.textContent='探索する日時 ';const mode=document.createElement('select');mode.id='candidateSearchMode';mode.setAttribute('aria-label','探索する日時');
 for(const [value,label]of [['day','この日全体'],['instant','選択した時刻'],['window','時間帯を指定']])mode.add(new Option(label,value));mode.value=timeChoice;timeLabel.append(mode);evidence.append(timeLabel);
 const times=document.createElement('div');times.hidden=timeChoice!=='window';for(const [label,id,value]of [['開始','candidateSearchStart',windowStart],['終了','candidateSearchEnd',windowEnd]]){const l=document.createElement('label');l.textContent=label+' ';const input=document.createElement('input');
 input.type='time';input.required=true;input.id=id;input.value=value;input.style.minHeight='44px';
 input.onchange=()=>{returnSearch=null;if(id.endsWith('Start'))windowStart=input.value;else windowEnd=input.value;mount();};l.append(input);times.append(l);}evidence.append(times);mode.onchange=()=>{returnSearch=null;
 timeChoice=mode.value;mount();};
 if(main&&globalThis.AstroNotesMapWorkspace?.centerMode()==='target'){
  const bandLabel=document.createElement('label');bandLabel.className='remember';
  const bandCheck=document.createElement('input');bandCheck.type='checkbox';bandCheck.id='candidateOnlyMapBand';bandCheck.checked=onlyMapBand;
  bandLabel.append(bandCheck,'地図の帯の中だけ');evidence.append(bandLabel);
  bandCheck.onchange=()=>{onlyMapBand=bandCheck.checked;returnSearch=null;mount();};
 }
 const roads=document.createElement('label');roads.className='remember';const roadCheck=document.createElement('input');roadCheck.type='checkbox';roadCheck.id='candidateIncludeRoads';roadCheck.checked=includeRoads;
 const roadLabel=document.createElement('span');roadLabel.textContent='道路などの地点も含める';roads.append(roadCheck,roadLabel);evidence.append(roads);
 roadCheck.onchange=()=>{includeRoads=roadCheck.checked;returnSearch=null;mount();};
 const notes=document.createElement('p');notes.className='tiny';notes.textContent='地形・建物の収録範囲や高さの精度に限界があります。未確認の見通しを撮影可能と保証しません。樹木・現地の変化・営業時間等は現地条件も確認してください。取得できない情報がある場合は、結果に表示します。';
 const resultNotes=document.createElement('p');resultNotes.className='tiny';
 const credits=document.createElement('p');credits.className='tiny';
 for(const [label,url]of [['© OpenStreetMap contributors (ODbL)','https://www.openstreetmap.org/copyright'],['国土地理院 標高タイル','https://maps.gsi.go.jp/development/demtile.html'],['3D都市モデル（Project PLATEAU）全国の整備都市（2020〜2025年度・国土交通省）を加工して作成','https://www.mlit.go.jp/plateau/site-policy/'],
 ['国土地理院 最適化ベクトルタイル（建物・道路）','https://github.com/gsi-cyberjapan/optimal_bvmap'],
 ['樹高：Meta・WRI High Resolution Canopy Height Maps v2（CC BY 4.0、衛星画像 © Vantor）','https://registry.opendata.aws/dataforgood-fb-forestsv2/'],['町丁目：CODH/e-Stat（2020）','https://geoshape.ex.nii.ac.jp/ka/resource/']]){
 const a=document.createElement('a');a.textContent=label;a.href=url;a.target='_blank';a.rel='noopener';credits.append(a,' ');}
 const primary=document.createElement('div'),visibleCredits=document.createElement(main?'details':'p');
 visibleCredits.hidden=true;
 if(main){
  primary.className='candidate-search-primary';
  const feedback=document.createElement('div');feedback.id='candidateSearchFeedback';feedback.append(status);
  primary.append(button,feedback);section.append(evidence,primary);
  const sourcesTitle=document.createElement('summary');sourcesTitle.textContent='判定の詳細';
  visibleCredits.className='candidate-search-sources';visibleCredits.append(sourcesTitle,description,notes,resultNotes,credits);
  document.getElementById('candidateSearchResultStore').replaceChildren(resultList);
  document.getElementById('candidateSearchCredits').replaceChildren(visibleCredits);
 }else{
  evidence.append(notes,resultNotes);
  visibleCredits.className='tiny';
  for(const [i,title] of [[0,'© OpenStreetMap contributors'],[2,'3D都市モデル（Project PLATEAU）国土交通省 を加工'],[4,'樹高：Meta・WRI（CC BY 4.0）']]){
   const link=credits.children[i].cloneNode(true);link.textContent=title;visibleCredits.append(link,' ');
  }
  evidence.append(credits);section.append(button,status,visibleCredits,resultList,evidence);
 }
 panel.append(section);syncWorkspaceSection(panel);
 if(editing&&['candidateSearchMode','candidateSearchStart','candidateSearchEnd','candidateIncludeRoads','candidateOnlyMapBand'].includes(editing))section.querySelector('#'+editing)?.focus({preventScroll:true});
 const missingField=missingSearchTime();
 const band=p?.seedBand;
 const bandMessage=band&&(band.status==='pending'?'地図の帯を計算しています。':band.status==='error'?'地図の帯を取得できませんでした。「地図の帯の中だけ」を外すと候補を探せます。':!band.samples.length?'この日は地図に帯がありません。日付を変えるか、「地図の帯の中だけ」を外してください。':'');
 const valid=p&&AstroNotesBodies.definition(p.body)&&!p.compositionInvalid&&!missingField&&!bandMessage&&AstroNotesCandidateComposition.timeRange(p);
 status.textContent=bandMessage|| (missingField?(missingField.endsWith('Start')?'探索の開始時刻を入力してください。':'探索の終了時刻を入力してください。')
  :!p?'天体・対象・日付を選んでください。':!valid?'指定した日時と構図を確認してください。':'');
 let continuation=false,hasRun=false,searching=false,failed=false,hasResults=false,items=new Map(),shown=null,publishedRows=0;
 const presentation=AstroNotesLibrary.gate();
 let labelsAttempt=null;
 // A place saved to the records leaves this list at once, and one removed from them comes back.
 againForRecords=()=>{
  if(!shown||searching||!section?.isConnected)return;
  const {result,selected,node,options}=shown;
  present(result,selected,node,run,options);
 };
 function renderAction(){
  button.dataset.state=searching?'searching':'idle';
  button.toggleAttribute('data-candidate-started',hasRun);
  button.textContent=searching?'キャンセル':failed?'再試行':continuation?'続きを探す':hasRun?(main?'候補を探し直す':'もう一度確認'):main?'候補を探す':'ほかの候補地点を探す';
  button.disabled=!valid;resultList.setAttribute('aria-busy',String(searching));
  if(main){
   primary.toggleAttribute('data-candidate-searching',searching);evidence.hidden=searching;
   section.toggleAttribute('data-results-ready',hasResults&&!searching&&!failed&&!continuation);
  }
 }
 renderAction();
 // partial: rows found so far while the search goes on; the list is replaced, the progress and the action stay.
 async function present(result,selected,node,token,{cancelled=false,interrupted=false,partial=false}={}){
   const ticket=presentation.next(),isPresented=()=>presentation.current(ticket)&&current(token,selected,node);
   // Keep the async commit boundary: a new search queued during cache restore
   // owns the action and rows before this old presentation may touch the DOM.
   await Promise.resolve();
   if(!isPresented()||partial&&!searching)return;
   // Names and coordinates already belong to the verified row. Address/facility
   // labels may arrive later; they must not hold the first selectable result.
   const labels=availableLabels||{};
   if(result.rows.length&&(!availableLabels?.addresses||!availableLabels?.facilities)){
    // Retry missing labels once on the next search/return, not repeatedly for
    // every progress page. Preserve any labels that did load successfully.
    if(labelsAttempt?.token!==token)labelsAttempt={token,done:false,promise:loadLabels()};
    const attempt=labelsAttempt;
    if(!attempt.done)attempt.promise.then(()=>{
     attempt.done=true;
     if(isPresented()&&(!partial||searching))return present(result,selected,node,token,{cancelled,interrupted,partial});
    }).catch(error=>globalThis.AstroNotesErrors?.note('candidates.labels',error));
   }
   // Rows already shown keep their buttons and new ones wait hidden until the list places them: emptying and
   // refilling the list for every place found made the page jump while searching (2026-11-13, seen on the iPhone).
   // Places already among the user's saved shooting places are shown on the records side only (candidate-picker.js inRecords).
   const rows=[],nodes=[],kept=new Map(),recorded=globalThis.MyPlacesUI?.savedPlaces?.()||[];
   if(!partial)shown={result,selected,node,options:{cancelled,interrupted}};
   for(const raw of result.rows){if(AstroNotesCandidatePicker.inRecords(raw,recorded))continue;const row=AstroNotesCandidateLabels.enrich(raw,labels),town=knownTownAddresses.get(townKey(row.place));
   if(town&&row.labels.address.status!=='matched')setTownAddress(row,town);rows.push(row);
   let item=items.get(row.id);if(!item){item=document.createElement('button');item.type='button';item.className='list-item';item.hidden=true;item.textContent=row.place.name;resultList.append(item);}
   kept.set(row.id,item);nodes.push(item);item.dataset.modelBasis=row.modelEvidence?.kind||'unknown';item.dataset.candidateName=row.place.name;item.dataset.candidateId=row.id;item.dataset.sourceId=raw.id;
    item.onclick=()=>{
    if(!item.isConnected||items.get(row.id)!==item||mainWorkspace()&&!mainWorkspace().selectable()||!resultsCurrent(selected,node)||row.requestKey!==key(selected))return;
    const event={...row.event};delete event.matchMode;const candidate={...row,event};const host=document.getElementById('aimLook'),previous=host?._compose;
    if(host)host._compose={mode:'whole',apply:true};
    if(SkyMapUI.selectCandidate(candidate,context(SkyMapUI.selectionState()),AstroNotesCandidatePicker.previewFor(row))){
     returnSearch=selected.timeSpec?.kind==='window'&&AstroNotesCandidateDiscovery.day(row.event.at)!==AstroNotesCandidateDiscovery.day(selected.at)?{plan:selected,key:key(selected),rowId:row.id,viewAt:row.event.at}:null;
    sheet.close();}else if(host)host._compose=previous;};
   }
   for(const [id,old] of items)if(!kept.has(id))old.remove();items=kept;
   // Published rows belong to the current selection. Starting another batch
   // for that selection only invalidates the previous search's async work.
   AstroNotesCandidatePicker.registerAdditional(resultList,rows,selected,()=>resultsCurrent(selected,node),nodes);
   (availableLabels?fillTownAddresses(rows,isPresented):Promise.resolve(false)).then(changed=>{if(changed&&isPresented())AstroNotesCandidatePicker.apply();})
    .catch(error=>globalThis.AstroNotesErrors?.note('candidates.town-address',error));
   hasResults=!!rows.length;publishedRows=result.rows.length;
   if(partial){visibleCredits.hidden=!hasResults;main?.reveal();return;}
   const sourcePending=result.coverage.retryPending??Number(result.coverage.loaded?.some(c=>c.failedRegions?.length||c.missing?.includes('time-budget')));
   const incomplete=!!result.stalled||interrupted||sourcePending>0;
   continuation=cancelled||interrupted||!!result.canContinue;failed=!cancelled&&incomplete;
   renderAction();visibleCredits.hidden=!rows.length&&!result.paused;
   const unknown=rows.some(r=>r.quality?.buildingHeights==='estimated'),unknownFrame=rows.some(r=>r.frame?.status==='unknown');
   const placeCount=AstroNotesCandidatePicker.countNewPlaces(result.rows,recorded,labels.facilities);
   const summaryText=rows.length?`${placeCount}か所の新たな撮影地点の候補があります。${unknown?'建物の高さを推定した候補を含みます。':''}${unknownFrame?'全体の画角を確認できない候補を含みます。':''}`
    :result.rows.length?'見つかった撮影地点は記録にあります。新たな撮影地点はまだ見つかっていません。'
    :sourcePending?'情報を取得できず、まだ判定できない地点があります。':result.paused?'まだ新たな撮影地点は見つかっていません。'
    :result.counts.unverified?'確認した範囲では見通しの確かな候補を見つけられませんでした。':'今回確認した範囲では候補がありません。';
   const waitSeconds=Math.max(0,Math.ceil(((result.retryAt||0)-Date.now())/1000));
   const next=sourcePending?(waitSeconds?`${waitSeconds}秒ほど待って情報を再取得できます。`:'確認済みの地点をやり直さず、情報を再取得できます。')
    :result.stalled?'情報の取得が進まないため、ここで停止しました。':interrupted?'取得できなかった範囲があります。'
    :result.pauseReason==='time-budget'?'時間内に確認しきれない地点が残っています。続きを探せます。'
    :result.paused?'未探索の範囲も、続きから探せます。':result.canContinue?'探索を再開できます。':'';
   const tryAnother=main&&!rows.length&&!sourcePending&&!interrupted&&!result.paused&&!result.canContinue?
    (selected.seedBand?' 日付を変えるか、「地図の帯の中だけ」を外して探せます。':' 日付や検索範囲を変えると別の条件で探せます。'):'';
   setStatus(cancelled?'探索をキャンセルしました。続きから探せます。':summaryText+(next?' '+next:'')+tryAnother,!!main&&!!rows.length&&!cancelled&&!next);
   const c=result.counts,unverifiedWhy=[c.nearBuilding?`立つ点のすぐ脇に建物${c.nearBuilding}`:'',c.heightUnknown?`建物の高さが分からない${c.heightUnknown}`:'',c.obstacle?`木・橋・高架${c.obstacle}`:''].filter(Boolean).join('・');
   resultNotes.textContent=`見通しを地形と建物で確かめられた地点だけを候補にしています。${c.checked}地点を確認：遮られる${c.blocked}、`
    +`見通しを確かめられない${c.unverified||0}${unverifiedWhy?`（うち${unverifiedWhy}）`:''}、重なりが見つからない${c.noOverlap||0}、構図に合わない${c.outsideFrame||0}、立つ高さが分からない${c.unknown}。`
    +(sourcePending?`情報取得待ち${sourcePending}件は、確認済みの地点をやり直さず再試行できます。`:'')
    +(result.coverage.timeDeferredPoints?`時間内に確認できなかった${result.coverage.timeDeferredPoints}地点は、ほかの地点の後に再確認します。`:'')
    +(c.mapRegions||c.mapPoints?`見える場所の地図で、対象の名前のある部分が見えない区画${c.mapRegions||0}を探す前に外し、地点${c.mapPoints||0}を確かめる前に外しました（遮られるに含む）。`:'')
    +'建物の高さはPLATEAUを整備した都市はその高さ、ほかは国土地理院の建物の形と種類から見積もります。木はMeta・WRIの樹高地図（衛星写真からの推定、約2.4m刻み）の高さで判定し、読めないときはOpenStreetMapにある木だけを高さが分からないものとして扱います。橋・高架はOpenStreetMapにあるものだけ、高さが分からないものとして判定します。'
    +`探索地域 ${result.coverage.regions}区画。全地域・全時刻の網羅や実写成功は保証していません。`;
 }
 button.onclick=async()=>{
  const selected=snapshot();if(!selected)return;if(condition!==uiKey(selected)){mount();return;}
  if(!button.isConnected||!contextActive()||main&&!main.selectable())return;dateRefreshPending=false;main?.reveal();
  if(!valid)return;
  if(searching){
   stop();const token=++run;hasSearched=false;continuation=true;failed=false;searching=false;
   setStatus('探索をキャンセルしました。続きから探せます。');renderAction();
   const completed=engine.cached(selected);if(completed)present(completed,selected,section,token,{cancelled:true}).catch(()=>{});
   return;
  }
  const resuming=continuation;
  if(hasRun&&!resuming&&!engine.restart(selected))return;
  // Once the inputs are accepted, keep progress and results next to the search action.
  if(main&&evidence.open)evidence.open=false;
  if(!resuming){
   AstroNotesCandidatePicker.unregister?.(resultList);resultList.replaceChildren();items=new Map();
   hasResults=false;publishedRows=0;shown=null;
  }
  hasRun=true;hasSearched=true;const node=section,token=++run;
  stop();controller=new AbortController();const signal=controller.signal;live.resetBudget();
  footprintGround.resetBudget();treeGround.resetBudget();evaluationBudgetStarted=false;watch=setInterval(()=>{if(!current(token,selected,node)){stop();mount();}},250);
  searching=true;failed=false;renderAction();
  visibleCredits.hidden=!hasResults;
  const label='撮影できる地域を計算しています…',updateProgress=showCandidateProgress(status,label,!!main);
  let progressLabel=label,foundPlaces=0;
  const renderProgress=()=>updateProgress(foundPlaces?`新規${foundPlaces}か所 ・ ${progressLabel}`:progressLabel);
  try{
   // The search asks this between every few calculations; rebuilding the page snapshot each time took about a quarter of
   // a phone's search time (2026-11-11). The run and the section are checked every time, the page conditions at most
   // every 250 ms (a change of conditions also restarts the search through mount()).
   let checkedAt=-Infinity,stillCurrent=true,offeredRows=publishedRows;
   const searchCurrent=()=>{if(token!==run||!node.isConnected)return false;const now=performance.now();if(now-checkedAt>=250){checkedAt=now;stillCurrent=current(token,selected,node);}return stillCurrent;};
   const result=await engine.searchRecommended(selected,{more:resuming,signal,isCurrent:searchCurrent,
   deprioritizePoints:()=>{const recorded=globalThis.MyPlacesUI?.savedPlaces?.()||[];return point=>AstroNotesCandidatePicker.fixedSurveyedInRecords?.(point,selected.target?.id,recorded)??false;},
   countPlaces:rows=>AstroNotesCandidatePicker.countNewPlaces(rows,globalThis.MyPlacesUI?.savedPlaces?.()||[],availableLabels?.facilities),onPage:(page,places)=>{
    if(searchCurrent()&&Number.isFinite(places)&&places!==foundPlaces){foundPlaces=places;renderProgress();}
    if(page.rows?.length>offeredRows&&searchCurrent()){offeredRows=page.rows.length;present(page,selected,node,token,{partial:true}).catch(()=>{});}
   },onBatchStart:()=>{live.resetBudget();
   footprintGround.resetBudget();treeGround.resetBudget();evaluationBudgetStarted=false;},
   onProgress:counts=>{if(!searchCurrent())return;
    progressLabel=counts.stage==='inverse'?label:counts.stage==='evaluate'?'構図と見通しを確認中':'撮影場所の情報を取得中';
    renderProgress();
   }});
   if(!current(token,selected,node))return;if(result.cancelled){failed=true;continuation=true;setStatus('候補の情報を取得できませんでした。');return;}
   await present(result,selected,node,token);
  }catch(e){if(current(token,selected,node)){const completed=engine.cached(selected);if(completed)await present(completed,selected,node,token,{interrupted:true});else{setStatus('候補の情報を取得できませんでした。');failed=true;continuation=true;}}}
  finally{if(token===run){stop();if(current(token,selected,node)){searching=false;renderAction();}else mount();}}
 };
 if(main?.visible())globalThis.MyPlacesUI?.renderPickerPanel(panel);
 // Returning from another page can build the section before its place is back on the page (seen on wide screens):
 // show the cached results once it is attached, or they would be dropped as stale.
 const cached=p&&engine.cached(p);if(cached){main?.reveal();hasRun=true;hasSearched=true;renderAction();const token=++run,node=section;let frames=0;
  const show=()=>{if(token!==run||node!==section)return;if(node.isConnected)present(cached,p,node,token).catch(()=>{});else if(++frames<300)requestAnimationFrame(show);};show();}
}
let mountFrame=null;const scheduleMount=()=>{if(mountFrame===null)mountFrame=requestAnimationFrame(()=>{mountFrame=null;mount();});};
const picker=document.getElementById('placeSheet');if(picker){new MutationObserver(scheduleMount).observe(picker,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','aria-selected']});picker.addEventListener('close',()=>{if(picker.open)return;
if(mainWorkspace()){scheduleMount();return;}stop();run++;hasSearched=false;if(dateCalendar?.open)dateCalendar.close();AstroNotesCandidatePicker.suspend?.();section?.remove();section=null;condition='';});}
let observedScene=null,previewObserver=null;
function watchPreview(){const scenePanel=document.getElementById('exploreScenePanel');if(!scenePanel||scenePanel===observedScene)return;previewObserver?.disconnect();observedScene=scenePanel;previewObserver=new MutationObserver(()=>{const host=scenePanel.querySelector('#aimLook');
if((scenePanel.hidden||scenePanel.hasAttribute('data-loading')||host?.hidden)&&scenePanel.querySelector('#trialComposition[open],#trialRecordSaveSheet[open]'))document.dispatchEvent(new Event('astronotes-preview-leave'));syncObserverMap();scheduleMount();});
previewObserver.observe(scenePanel,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','data-loading']});}
// The shared bar owns the selected instant. This adapter only owns cancellation
// and the pending search intent while its native ruler is moving.
document.addEventListener('astronotes-candidate-date-change',event=>{
 if(!mainWorkspace()?.active())return;
 const {changed,settled}=event.detail;
 if(!changed&&!dateRefreshPending)return;
 const repeat=hasSearched||dateRefreshPending;dateRefreshPending=repeat&&!settled;
 returnSearch=null;stop();run++;mount();
 if(mainWorkspace()?.separateRecords||!repeat||!settled)return;
 const selected=snapshot(),identity=uiKey(selected);
 autoSearchTimer=setTimeout(()=>{autoSearchTimer=null;const latest=snapshot();if(!selected||!contextActive()||uiKey(latest)!==identity||engine.cached(latest))return;const button=document.getElementById('candidateSearchAction');
 if(button&&!button.disabled&&button.dataset.state!=='searching')button.click();},350);
});
document.addEventListener('astronotes-preview-leave',()=>{const button=document.getElementById('trialRecordSave');if(button)button.hidden=true;const dialog=document.getElementById('trialRecordSaveSheet');if(dialog?.open){dialog.restoreRecordFocus=false;dialog.close();}});
document.addEventListener('astronotes-search-band-change',()=>{if(onlyMapBand)scheduleMount();});
document.addEventListener('astronotes-search-state',scheduleMount);document.addEventListener('astronotes-composition-change',mount);mount();
})();

/* Trial-only "重ねる対象". Display set = existing SkyMap main target + scene extras.
   One member: the existing main target (single solver, alignment and saving unchanged).
   All: OR of the members' exact per-target results; see overlap-scope-policy.mjs. */
(()=>{
'use strict';
const P=(function createOverlapPolicy(){
 const DAY=86400000,JST=32400000;
 const unique=ids=>[...new Set((ids||[]).filter(id=>typeof id==='string'&&id))];
 function members(mainId,extraIds){return mainId?unique([mainId,...(extraIds||[])]):[];}
 function scope(state,ids){const n=unique(ids).length;return n<2?'single':state?.all===true?'all':'one';}
 // Keep the chosen overlap target while it remains displayed. A removed target
 // falls back explicitly to the first remaining one (map-placed custom first).
 function chooseMain(ids,previous){ids=unique(ids);if(!ids.length)return {main:'',fallback:false};if(previous&&ids.includes(previous))return {main:previous,fallback:false};return {main:ids[0],fallback:!!previous&&ids.length>1};}
 function combine(values){
  // true: some member overlaps. false: every member is known not to. null: unknown.
  let unknown=false;for(const v of values){if(v===true)return true;if(v!==false)unknown=true;}
  return unknown||!values.length?null:false;
 }
 function unionAt(rows){return {intersects:combine(rows.map(r=>r==null?null:typeof r.intersects==='boolean'?r.intersects:null)),distanceToTarget:Math.min(...rows.map(r=>Number.isFinite(r?.distanceToTarget)?r.distanceToTarget:Infinity)),member:rows.findIndex(r=>r?.intersects===true)};}
 const jstDay=at=>Math.floor((at+JST)/DAY);
 // Candidate days: day d is a union day iff it is a day of some member. The
 // first `limit` union days are contained in the union of each member's first
 // `limit` days over the same horizon, so per-member limited scans suffice.
 function mergeDays(results,limit=4){
  const byDay=new Map();
  results.forEach((res,i)=>{for(const row of res.rows||[]){if(!Number.isFinite(row?.at))continue;const d=jstDay(row.at),old=byDay.get(d);if(!old||row.at<old.at)byDay.set(d,{...row,overlapMember:i});}});
  return [...byDay.values()].sort((a,b)=>a.at-b.at).slice(0,limit);
 }
 function scannedUntil(results,rows,limit=4){
  if(results.some(r=>!Number.isFinite(r.scanned)))return null;
  if(rows.length>=limit)return (jstDay(rows[rows.length-1].at)+1)*DAY-JST;
  const values=results.map(r=>r.scanned).filter(Number.isFinite);return values.length?Math.min(...values):null;
 }
 const rowKey=row=>JSON.stringify([row.place?.sourcePlaceId??row.place?.id??null,row.place?.latitude,row.place?.longitude,row.assumedObserver?.eyeM??row.place?.standAglM??null,Math.round((row.event?.at??NaN)/1000)]);
 function retag(row,i,anchor){return {...row,overlapMember:i,event:{...row.event,matchMode:'overlap',partId:anchor.partId,limb:'center',overlapTargetId:row.event?.overlapTargetId??null}};}
 // Registered-place rows: every member event is a union event. Duplicates of
 // the same place and second collapse; failures and cancellation propagate.
 function mergeRows(results,anchor,ids=[]){
  if(results.some(r=>r?.cancelled))return {cancelled:true};
  const seen=new Set(),rows=[];let failed=0;
  results.forEach((res,i)=>{failed+=res?.failed||0;for(const row of res?.rows||[]){const tagged=retag(row,i,anchor);tagged.event.overlapTargetId=ids[i]??null;const k=rowKey(tagged);if(seen.has(k))continue;seen.add(k);rows.push(tagged);}});
  rows.sort((a,b)=>a.event.at-b.event.at);return {rows,failed};
 }
 // Generic point evaluation: positive if any member recommends; otherwise the
 // weakest negative (unknown beats a definite negative, blocked beats frame).
 const NEGATIVE=['unknown','model-blocked','outside-frame','no-overlap','excluded'];
 function mergeEvaluations(results,anchor,ids=[]){
  const positives=[],seen=new Set();let partial=false;
  results.forEach((res,i)=>{partial=partial||!!res?.partial;for(const row of res?.recommend?[res,...(res.additionalCandidates||[])]:[]){if(!row.recommend)continue;const tagged=retag(row,i,anchor);tagged.event.overlapTargetId=ids[i]??null;delete tagged.additionalCandidates;
  if(seen.has(tagged.id))continue;seen.add(tagged.id);positives.push(tagged);}});
  if(positives.length)return {...positives[0],additionalCandidates:positives.slice(1),partial};
  const statuses=results.map(r=>NEGATIVE.includes(r?.status)?r.status:'unknown'),status=NEGATIVE.find(s=>statuses.includes(s))||'unknown';
  return {status,recommend:false,partial,reason:results.find(r=>r?.status===status)?.reason||(status==='unknown'?'overlap-member-unknown':undefined)};
 }
 function mergeSeeds(results){return {seeds:results.flatMap(r=>r?.seeds||[]),partial:results.some(r=>r?.partial!==false),reason:results.find(r=>r?.reason)?.reason};}
 function wholePart(target,isMountain){return isMountain(target)?null:'__whole';}
 // Share/plan extension. Members are identified by id and position; a
 // recipient must resolve every member or the plan opens as the single anchor.
 function payloadExt(list){return {v:1,scope:'all',members:list.map(t=>({id:String(t.id),name:String(t.name||''),latitude:t.latitude,longitude:t.longitude}))};}
 function parseExt(ov){
  if(!ov||ov.v!==1||ov.scope!=='all'||!Array.isArray(ov.members)||ov.members.length<2||ov.members.length>16)return null;
  if(!ov.members.every(m=>m&&typeof m.id==='string'&&m.id.length<=80&&typeof m.name==='string'&&m.name.length<=100&&!/[\u0000-\u001f]/.test(m.name)&&Number.isFinite(m.latitude)&&Math.abs(m.latitude)<=90&&Number.isFinite(m.longitude)&&Math.abs(m.longitude)<=180))return null;
  if(new Set(ov.members.map(m=>m.id)).size!==ov.members.length)return null;
  return ov.members;
 }
 function resolveMembers(ext,list){
  const out=[];for(const m of ext){const t=list.find(x=>x.id===m.id&&Number.isFinite(x.latitude)&&Math.abs(x.latitude-m.latitude)<1e-4&&Math.abs(x.longitude-m.longitude)<1e-4&&(x.parts||[]).length);if(!t)return null;out.push(t);}return out;
 }
 return {members,scope,chooseMain,combine,unionAt,mergeDays,scannedUntil,mergeRows,mergeEvaluations,mergeSeeds,wholePart,payloadExt,parseExt,resolveMembers,jstDay};
})();
const state={notice:'',noticeOwner:'',lastAccent:null};
// Classic-script globals of the inline document (lexical bindings are reachable by name, not via globalThis).
const G={auth:()=>typeof auth==='undefined'?null:auth,store:()=>typeof store==='undefined'?null:store,aimSceneExtrasAllowed:()=>typeof aimSceneExtrasAllowed==='undefined'?null:aimSceneExtrasAllowed,aimIsMountain:()=>typeof aimIsMountain==='undefined'?null:aimIsMountain,aimSceneExtraTargets:()=>typeof aimSceneExtraTargets==='undefined'?null:aimSceneExtraTargets,aimSetSceneExtras:()=>typeof aimSetSceneExtras==='undefined'?null:aimSetSceneExtras,aimTargetList:()=>typeof aimTargetList==='undefined'?null:aimTargetList};
const ref=name=>G[name]();
const owner=()=>ref('auth')?.loginId||'guest';
const storeKey=()=>'sorami.sceneOverlap:'+encodeURIComponent(owner());
const allowed=()=>{const f=ref('aimSceneExtrasAllowed');return typeof f!=='function'||f();};
const current=()=>typeof SkyMapUI==='undefined'?null:SkyMapUI.selectionState?.()||null;
const isMountain=t=>{const f=ref('aimIsMountain');return typeof f==='function'&&!!f(t);};
function members(s=current()){
 if(!s?.target||!allowed())return [];const f=ref('aimSceneExtraTargets'),out=[s.target];
 for(const t of typeof f==='function'?f(s.target.id):[])if(t&&!out.some(x=>x.id===t.id))out.push(t);
 return out;
}
const flag=()=>{const v=ref('store')?.get(storeKey(),null);return v?.all===true;};
function setFlag(all){ref('store')?.set(storeKey(),{all:!!all});}
const usable=(s,list)=>typeof toolAllowed!=='function'||!globalThis.AstroNotesAccess?.canFrame||list.every(t=>AstroNotesAccess.canFrame(toolAllowed,t.id,s?.body));
function isAll(s=current()){const list=members(s);return list.length>=2&&flag()&&usable(s,list);}
function key(s=current()){return isAll(s)?JSON.stringify(['all',members(s).map(t=>[t.id,t.latitude,t.longitude,t.groundM,t.parts,t.widthM])]):null;}
function label(s=current()){return isAll(s)?'全てに重なる':null;}
const memberEntry=t=>({target:t,partId:P.wholePart(t,isMountain),profile:isMountain(t)?'summit-contact':'building-near'});
function searchPlan(s=current()){return isAll(s)?{overlapMembers:members(s).map(memberEntry),composition:null,compositionInvalid:false}:null;}
function notify(){document.dispatchEvent(new Event('astronotes-composition-change'));globalThis.TrialExplore?.invalidate?.();SkyMapUI?.render?.();}
function setNotice(text){state.notice=text;state.noticeOwner=owner();}
// Called from the target picker: keep the overlap target if it is still shown.
function chooseMain(ids,previous){
 const r=P.chooseMain(ids,previous);
 if(r.fallback)setNotice('重ねる対象を外したため「'+(ref('aimTargetList')?.().find(t=>t.id===r.main)?.name||r.main)+'」に重ねます');
 if(new Set(ids).size<2&&flag())setFlag(false);
 return r.main||null;
}
// A custom (map-placed) target shown as an extra must be the Explore session's own geometry.
function custom(){return SkyMapUI?.workspaceHost?.()?.session?.customTarget||null;}
let field=null,select=null,noticeNode=null,syncing=false;
function ensureField(){
 if(field?.isConnected)return field;const source=document.getElementById('skyMapTarget'),home=source?.closest('.condition-field');if(!home)return null;
 field=document.createElement('div');field.id='skyMapOverlapField';field.className='aim-say condition-field overlap-target-field';field.hidden=true;
 select=document.createElement('select');select.id='skyMapOverlapTarget';select.className='fav-in overlap-target-select';select.setAttribute('aria-labelledby','skyMapOverlapLabel');
 const lab=document.createElement('span');lab.className='aim-say-v condition-label';lab.id='skyMapOverlapLabel';
 lab.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/></svg><span>重ねる対象</span>';
 noticeNode=document.createElement('p');noticeNode.id='skyMapOverlapNotice';noticeNode.className='tiny overlap-target-notice';noticeNode.setAttribute('role','status');noticeNode.hidden=true;
 field.append(select,lab,noticeNode);home.after(field);
 select.onchange=()=>choose(select.value);
 const style=document.createElement('style');style.textContent=`#skyMapOverlapField[hidden]{display:none!important}
#skyMapOverlapField .overlap-target-select{box-sizing:border-box;width:100%;min-width:0;min-height:44px;margin:0;font-size:16px}
#skyMapOverlapField .overlap-target-notice{grid-column:1/-1;margin:2px 0 0;color:var(--secondary)}`;document.head.append(style);
 return field;
}
function choose(value){
 const s=current(),list=members(s);if(!s?.target||list.length<2||!ref('auth')?.token)return sync();
 setNotice('');
 if(value==='__all'&&!usable(s,list)){setFlag(false);setNotice('選択した対象を利用する権限がありません');notify();return sync();}
 if(value==='__all'){setFlag(true);SkyMapUI.setAlignment('__whole','center','overlap');notify();return sync();}
 const next=list.find(t=>t.id===value);if(!next)return sync();setFlag(false);
 if(next.id!==s.target.id){
  // The display set is unchanged; only the solver's main target moves. Its alignment restarts at 全体.
  ref('aimSetSceneExtras')?.(list.map(t=>t.id).filter(id=>id!==next.id));SkyMapUI.setTarget(next.id);
  if(SkyMapUI.selectionState()?.target?.id!==next.id){ref('aimSetSceneExtras')?.(list.filter(t=>t.id!==s.target.id).map(t=>t.id));setNotice('この対象を重ねる対象にできませんでした');}
 }else if(isMountain(next)&&s.matchMode==='overlap')SkyMapUI.setTarget(next.id);
 notify();sync();
}
function sync(){
 if(syncing)return;syncing=true;
 try{
  const host=ensureField();const s=current(),list=members(s);
  if(state.noticeOwner!==owner())state.notice='';
  if(!host)return;
  host.hidden=list.length<2;
  if(list.length>=2){
   const all=isAll(s),sig=JSON.stringify(list.map(t=>[t.id,t.name]));
   if(select.dataset.sig!==sig){select.dataset.sig=sig;select.replaceChildren(...list.map(t=>new Option(t.name,t.id)),new Option('全て','__all'));}
   const value=all?'__all':s.target.id;if(select.value!==value)select.value=value;
   select.setAttribute('aria-label','重ねる対象：'+(all?'全て（'+list.map(t=>t.name).join('、')+'）':s.target.name));
   if(all&&s.matchMode!=='overlap')SkyMapUI.setAlignment('__whole','center','overlap');
  }
  noticeNode.textContent=state.notice;noticeNode.hidden=!state.notice||list.length<1;
 }finally{syncing=false;}
}
// Candidate dates: union of each member's own day scan.
function buildingDays(fn,plan){
 if(!isAll(plan))return null;const list=members(plan);
 return async(obs,_target,body,_partId,seq,opts={})=>{
  const limit=opts.limit??4,scanned=list.map(()=>null);
  const report=()=>{if(scanned.every(Number.isFinite))opts.onScanned?.(Math.min(...scanned));};
  const results=await Promise.all(list.map(async(t,i)=>({rows:await fn(obs,t,body,P.wholePart(t,isMountain),seq,{...opts,limb:'center',matchMode:'overlap',onScanned:end=>{scanned[i]=end;report();}})})));
  results.forEach((r,i)=>{r.scanned=scanned[i];});
  if(opts.isCurrent&&!opts.isCurrent())return [];
  const rows=P.mergeDays(results,limit),until=P.scannedUntil(results,rows,limit);if(Number.isFinite(until))opts.onScanned?.(until);
  return rows.map(r=>({...r,overlapTargetId:list[r.overlapMember]?.id??null}));
 };
}
function memberPlan(plan,i){
 const list=plan.overlapMembers,m=list[i];
 const next={...plan,target:m.target,partId:m.partId,limb:'center',matchMode:'overlap',profile:m.profile,composition:null,compositionInvalid:false,extraTargets:list.filter((_,j)=>j!==i).map(x=>x.target),requireAllTargets:false,lens:plan.lens?{...plan.lens,targetExtent:'whole'}:plan.lens};
 delete next.overlapMembers;if(i)next.overlapAnchor={target:list[0].target,partId:list[0].partId};return next;
}
function inverse(plan,fn){if(!plan?.overlapMembers)return null;return (async()=>{const out=[];for(let i=0;i<plan.overlapMembers.length;i++)out.push(await fn(memberPlan(plan,i)));return P.mergeSeeds(out);})();}
function evaluate(plan,fn){if(!plan?.overlapMembers)return null;return (async()=>{const out=[];for(let i=0;i<plan.overlapMembers.length;i++)out.push(await fn(memberPlan(plan,i)));return P.mergeEvaluations(out,{partId:plan.overlapMembers[0].partId},plan.overlapMembers.map(m=>m.target.id));})();}
// Registered places from 探す: union of the existing per-target solver.
function discovery(plan,run){
 if(!plan?.overlapMembers)return null;
 return (async()=>{const out=[];for(const m of plan.overlapMembers){const r=await run({...plan,target:m.target,partId:m.partId,limb:'center',matchMode:'overlap',overlapMembers:undefined});if(r?.cancelled)return {cancelled:true};out.push(r);
 }return P.mergeRows(out,{partId:plan.overlapMembers[0].partId},plan.overlapMembers.map(m=>m.target.id));})();
}
// Figure accent: the selected member's silhouette, or the outline of the union
// (internal borders removed) when 全て. Drawn only when several targets are shown.
function accentColor(){return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#3b8cff';}
function accent(ctx,{scene,t,shape,sceneBottom}){
 const s=current(),list=members(s);state.lastAccent=null;if(list.length<2||!t||!scene)return;
 const all=isAll(s),ids=new Set(all?list.map(x=>x.id):[t.id]),canvas=ctx.canvas,w=canvas.width,h=canvas.height,m=ctx.getTransform();
 const mask=document.createElement('canvas');mask.width=w;mask.height=h;const mc=mask.getContext('2d');mc.setTransform(m);mc.fillStyle='#000';const drawn=[];
 for(const item of scene){
  if(!ids.has(item.target.id))continue;
  if(item.polygons?.length&&item.solidSilhouette){const k=item.solidSilhouette;mc.drawImage(k.canvas,k.x,k.y,k.width,k.height);drawn.push(item.target.id);continue;}
  const pts=item.target.id===t.id?shape:item.shape;if(!pts||pts.length<2)continue;
  mc.beginPath();if(!item.outline){mc.moveTo(pts[0][0],sceneBottom);for(const [x,y]of pts)mc.lineTo(x,y);mc.lineTo(pts[pts.length-1][0],sceneBottom);}else{mc.moveTo(pts[0][0],pts[0][1]);for(const [x,y]of pts)mc.lineTo(x,y);}
  mc.closePath();mc.fill();drawn.push(item.target.id);
 }
 state.lastAccent={mode:all?'all':'one',ids:[...ids],drawn};if(!drawn.length)return;
 const ring=document.createElement('canvas');ring.width=w;ring.height=h;const rc=ring.getContext('2d'),r=Math.max(1,Math.round(2*Math.hypot(m.a,m.b)));
 for(let dx=-r;dx<=r;dx++)for(let dy=-r;dy<=r;dy++)if((dx||dy)&&dx*dx+dy*dy<=r*r+1)rc.drawImage(mask,dx,dy);
 rc.globalCompositeOperation='source-in';rc.fillStyle=accentColor();rc.fillRect(0,0,w,h);rc.globalCompositeOperation='destination-out';rc.drawImage(mask,0,0);
 ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(ring,0,0);ctx.restore();
}
// Share / plan payload: v1 codec keeps unknown fields losslessly.
function annotate(kind,s,payload){
 const sel=current();if(!payload||payload.kind!=='aim'||!isAll(sel)||payload.t?.id!==sel.target.id)return;
 const list=members(sel);if(list.length>16)throw Error('共有できる対象は16件までです');const names=list.map(t=>t.name).join('、');payload.ov=P.payloadExt(list);
 s.title=s.title.replace(/ × .*$/,' × 全て（'+names+'）');
 for(const row of s.rows||[]){if(row[0]==='対象・重ね方')row[1]='全て（'+names+'） / 全体 / 全ての対象を合わせた輪郭に重なる';else if(row[0]==='重ね方')row[1]='全て（'+names+'）を合わせた輪郭に重なる';}
}
function restore(p){
 if(p?.kind!=='aim')return;const ext=P.parseExt(p.ov),list=ref('aimTargetList')?.()||[];
 if(!ext){setFlag(false);return;}
 const anchor=ext.find(m=>m.id===p.t.id),others=ext.filter(m=>m.id!==p.t.id),resolved=anchor?P.resolveMembers(others,list):null;
 if(!resolved||resolved.length!==ext.length-1){setFlag(false);setNotice('共有された「全て」の対象の一部をこの端末で表示できないため、'+p.t.name+'に重ねます');return;}
 ref('aimSetSceneExtras')?.(resolved.map(t=>t.id));setFlag(true);setNotice('');
}
// Recording 全て registers every member at this place with 全体; a partial
// failure is reported, never presented as a complete save.
function quickRecord(cur){
 const ext=P.parseExt(cur?.payload?.ov);if(!ext)return null;const sel=current(),list=members(sel);
 if(!isAll(sel)||JSON.stringify(list.map(t=>t.id))!==JSON.stringify(ext.map(m=>m.id)))return {ok:false,error:'重ねる対象が変わりました。見え方を開き直してください'};
 const observer={...sel.observer,...cur.observer,elevation:cur.payload.o[3],eyeHeightAGL:cur.payload.o[4]};let already=true,placeId=null;const saved=[];
 for(const t of list){const r=MyPlacesUI.quickRecord(observer,t.id===cur.target.id?cur.target:t);if(!r?.ok)return {ok:false,error:(r?.error||'撮影地点を保存できませんでした')+(saved.length?'（'+saved.join('、')+'は登録済み）':'')};already=already&&r.already;placeId=placeId||r.placeId;saved.push(t.name);}
 return {ok:true,already,placeId};
}
for(const type of ['astronotes-search-state','astronotes-composition-change','astronotes-records-change'])document.addEventListener(type,()=>queueMicrotask(sync));
globalThis.AstroNotesTrialOverlap={policy:P,members,isAll,key,label,searchPlan,chooseMain,custom,sync,buildingDays,inverse,evaluate,discovery,accent,annotate,restore,quickRecord,get lastAccent(){return state.lastAccent;}};
sync();
})();


// 画面で起きた異常の直近20件をこの端末の中に残す（外へは送らない。同期・書き出しの対象外の鍵）。
// 利用者の報告だけでは分からない端末側の不具合を、後から端末をつないで読むため。
(()=>{
 const KEY='astronotes.trial.errors',MAX=20;
 const version=()=>{try{return document.querySelector('meta[name="app-version"]')?.content||'';}catch{return '';}};
 const file=s=>String(s||'').split(/[?#]/)[0].split('/').pop().slice(0,60);
 const keep=(kind,message,source,line)=>{try{
  const list=JSON.parse(localStorage.getItem(KEY)||'[]'),row={at:new Date().toISOString(),v:version(),kind,message:String(message||'').slice(0,200),source:file(source),line:Number(line)||0,page:String(location.hash||'').split('?')[0].slice(0,40)};
  const last=list[list.length-1];if(last&&last.message===row.message&&last.source===row.source&&last.line===row.line){last.count=(last.count||1)+1;last.at=row.at;}else list.push(row);
  localStorage.setItem(KEY,JSON.stringify(list.slice(-MAX)));
 }catch{/* 保存できない端末では何も残さない */}};
 // 握って続行する箇所からの記録。同じ場所は5秒に1回まで（描画の繰り返しで端末の保存を叩かない）。
 const noted=new Map();
 globalThis.AstroNotesErrors={note(where,error){if(error?.name==='AbortError')return;const now=Date.now();if(now-(noted.get(where)||0)<5000)return;noted.set(where,now);keep('handled',error?.message||error,where,0);}};
 addEventListener('error',e=>{if(e&&(e.message||e.error))keep('error',e.message||e.error?.message,e.filename,e.lineno);});
 addEventListener('unhandledrejection',e=>{const r=e?.reason;if(r?.name==='AbortError')return;const where=/([\w.-]+\.js)[^:\s]*:(\d+)/.exec(String(r?.stack||''));keep('rejection',r?.message||r,where?.[1],where?.[2]);});
})();


// data-release 91c6ccb66fe3777bdd84e834f0ba896f60068bb799f0f4af347955be8590c27d
