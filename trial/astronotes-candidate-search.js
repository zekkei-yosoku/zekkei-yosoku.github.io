/* Lossless packed PLATEAU geometry. Unpack only the building faces a ray needs. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateBuildings=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
async function decode(data){
 if(!data.arrays)return data;
 const unpack=async item=>{const packed=Uint8Array.from(atob(item.gzipBase64),c=>c.charCodeAt(0)),buffer=await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();if(buffer.byteLength!==item.elementCount*4)throw Error('packed-building-size');return new DataView(buffer);};
 const [vertices,indices,rings,faces]=await Promise.all(['vertexCoordinates','ringVertexIndices','ringOffsets','faceRingOffsets'].map(n=>unpack(data.arrays[n]))),q=data.quantization;
 const result={...data,buildings:data.buildings.map(b=>({...b,sourceSha256:b.sourceSha256||data.sourceSha256s[b.sourceIndex]}))};
 for(const b of result.buildings)Object.defineProperty(b,'polygons',{get(){const rows=[];for(let j=0;j<b.faceCount;j++){const face=b.firstFace+j,rr=[];for(let r=faces.getUint32(face*4,true);r<faces.getUint32((face+1)*4,true);r++){const ring=[];for(let i=rings.getUint32(r*4,true);i<rings.getUint32((r+1)*4,true);i++){const v=indices.getUint32(i*4,true)*3;ring.push([q.originLon+vertices.getInt32(v*4,true)*q.angularScale,q.originLat+vertices.getInt32((v+1)*4,true)*q.angularScale,vertices.getInt32((v+2)*4,true)*q.heightScale]);}rr.push(ring);}rows.push({id:data.targetPolygonIds?.[b.id]?.[j]||b.id+':source-face-index:'+j,sourcePolygonIndex:j,rings:rr});}return rows;}});
 return result;
}
return {decode};
});

/* Native GSI DEM samples: terrain diagnostics, never standing surface/visibility proof. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateTerrain=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const R=6371008.8,rad=Math.PI/180,MISSING=-2147483648,Geo=()=>globalThis.AstroNotesTerrain||(typeof require==='function'?require('../../astronotes-terrain.js'):null);
async function decode(data){
 const unpack=async encoded=>new Response(new Blob([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 const buffer=await unpack(data.heightsGzipBase64),view=new DataView(buffer),sources=data.sourceCodesGzipBase64?new Uint8Array(await unpack(data.sourceCodesGzipBase64)):null,tiles=new Map(data.tiles.map(t=>[t.x+','+t.y,t]));
 if(buffer.byteLength!==data.tiles.length*256*256*4||sources&&sources.length*4!==buffer.byteLength)throw Error('invalid-terrain-size');
 const world=256*2**data.zoom;
 function pixel(lat,lon){return [(lon+180)/360*world,(1-Math.asinh(Math.tan(lat*rad))/Math.PI)/2*world];}
 function lookup(x,y){const px=Math.floor(x),py=Math.floor(y),tile=tiles.get(Math.floor(px/256)+','+Math.floor(py/256));if(!tile)return {height:null,sourceCode:0};const i=tile.offset+(py%256+256)%256*256+(px%256+256)%256;if(!Number.isInteger(i)||i<0||i*4+4>buffer.byteLength)return {height:null,sourceCode:0};const cm=view.getInt32(i*4,true);return {height:cm===MISSING?null:cm/100,sourceCode:cm===MISSING?0:sources?.[i]??1};}
 function sample(p){return lookup(...pixel(p.latitude,p.longitude));}
 function at(p){return sample(p).height;}
 function trace(observer,{azimuth,altitude,maxM,endpoint=null,refractionK=1}){
  if(!Number.isFinite(observer.elevation)||!Number.isFinite(azimuth)||!Number.isFinite(altitude)||Math.abs(altitude)>=89||!Number.isFinite(maxM)||maxM<=0||maxM>20000)return {status:'unknown',recommend:false,reason:'invalid-terrain-ray'};
  const segments=[];let lastPoint=null,previous={xy:pixel(observer.latitude,observer.longitude),d:0};
  for(let d=Math.min(100,maxM);;d=Math.min(d+100,maxM)){const p=d===maxM&&endpoint?endpoint:Geo().destination(observer.latitude,observer.longitude,azimuth,d/1000),next={xy:pixel(p.latitude,p.longitude),d};segments.push([previous,next]);previous=next;lastPoint=p;if(d===maxM)break;}
  let checked=0,missing=0,lowerResolutionCells=0,ignoredCells=0,hit=null,minMarginM=Infinity;const eye=observer.elevation+(observer.eyeM??1.5);
  for(const [from,to] of segments){const start=from.xy,finish=to.xy,dx=finish[0]-start[0],dy=finish[1]-start[1],length=to.d-from.d,crossings=[0,1];for(const [a,b] of [[start[0],finish[0]],[start[1],finish[1]]])if(a!==b)for(let n=Math.floor(Math.min(a,b))+1;n<Math.max(a,b);n++)crossings.push((n-a)/(b-a));crossings.sort((a,b)=>a-b);
  for(let i=1;i<crossings.length;i++){const lo=crossings[i-1],hi=crossings[i];if(hi-lo<1e-14)continue;const t=(lo+hi)/2,value=lookup(start[0]+t*dx,start[1]+t*dy),z=value.height;checked++;if(value.sourceCode===2)lowerResolutionCells++;if(z===null)missing++;if(z===null)continue;const a=Math.max(0,from.d+lo*length),b=from.d+hi*length,vertex=-R*refractionK*Math.tan(altitude*rad),distances=[a,b];if(vertex>a&&vertex<b)distances.push(vertex);const heights=distances.map(d=>eye+d*Math.tan(altitude*rad)+d*d/(2*R*refractionK)),ray=Math.min(...heights),d=distances[heights.indexOf(ray)],margin=ray-z;minMarginM=Math.min(minMarginM,margin);if(margin<=0&&!hit)hit={distanceM:d,terrainM:z,rayM:ray};}}

  return {status:hit?'model-blocked':'unknown',recommend:false,checked,missing,lowerResolutionCells,end:lastPoint,ignoredNearObserverM:0,ignoredCells,hit,minMarginM:Number.isFinite(minMarginM)?minMarginM:null,reason:hit?'conditional-dem-intersection':'no-terrain-visibility-certification'};
 }
 return {at,sample,trace,source:data.source};
}
return {decode};
});

/* Terrain/building MODEL LOS. Missing model range or standing height never becomes model-visible. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const R=6371008.8,rad=Math.PI/180,Geo=()=>globalThis.AstroNotesTerrain||(typeof require==='function'?require('../../astronotes-terrain.js'):null);
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
function boxIntersects(box,origin,direction,maxM,padding){let lo=0,hi=maxM;for(let i=0;i<3;i++){const a=box[i]-padding,b=box[i+3]+padding;if(Math.abs(direction[i])<1e-12){if(origin[i]<a||origin[i]>b)return false;continue;}const t=[(a-origin[i])/direction[i],(b-origin[i])/direction[i]].sort((a,b)=>a-b);lo=Math.max(lo,t[0]);hi=Math.min(hi,t[1]);if(hi<lo)return false;}return true;}
function buildingBox(b){const z=b.solidZRangeM||[b.zMin,b.zMax];if(!b.bbox||!z.every(Number.isFinite))return null;const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const lon of [b.bbox[0],b.bbox[2]])for(const lat of [b.bbox[1],b.bbox[3]])for(const h of z){const p=local(lat,lon,h);for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],p[i]);hi[i]=Math.max(hi[i],p[i]);}}return [...lo,...hi];}

function trace(index,observer,{azimuth,altitude,maxM=12000,endpoint=null,targetKey=null,refractionK=1}){
 if(!Number.isFinite(observer.elevation)||!Number.isFinite(azimuth)||!Number.isFinite(altitude)||Math.abs(altitude)>=89||!Number.isFinite(maxM)||maxM<=0||maxM>20000)return {status:'unknown',recommend:false,reason:'invalid-height-or-ray'};
 const eye=observer.elevation+(observer.eyeM??1.5),lat=observer.latitude,lon=observer.longitude,az=azimuth*rad,alt=altitude*rad;
 const end=endpoint||Geo().destination(lat,lon,azimuth,maxM/1000),origin=local(lat,lon,eye),a=lat*rad,b=lon*rad;
 const east=[-Math.sin(b),Math.cos(b),0],north=[-Math.sin(a)*Math.cos(b),-Math.sin(a)*Math.sin(b),Math.cos(a)],up=[Math.cos(a)*Math.cos(b),Math.cos(a)*Math.sin(b),Math.sin(a)];
 const direction=endpoint?local(endpoint.latitude,endpoint.longitude,endpoint.elevation).map((v,i)=>(v-origin[i])/maxM):east.map((v,i)=>v*Math.sin(az)+north[i]*Math.cos(az)+up[i]*Math.tan(alt));
 const curvature=(1-1/refractionK)/(2*R),quadratic=up.map(v=>-v*curvature),chord=direction.slice();if(endpoint)for(let i=0;i<3;i++)direction[i]+=up[i]*curvature*maxM;
 const ids=new Set();for(let x=Math.floor(Math.min(lon,end.longitude)*1000)-1;x<=Math.floor(Math.max(lon,end.longitude)*1000)+1;x++)for(let y=Math.floor(Math.min(lat,end.latitude)*1000)-1;y<=Math.floor(Math.max(lat,end.latitude)*1000)+1;y++)for(const id of index.grid[x+','+y]||[])ids.add(id);
 let compiled=cache.get(index);if(!compiled){compiled=new Map();compiled.boxes=new Map();cache.set(index,compiled);}
 const association=index.targetAssociations?.[targetKey],targetIds=new Set(association?.sourceSha256&&(association.sourceSha256===index.sourceSha256||index.sourceSha256s?.includes(association.sourceSha256))?association.buildingIds||[]:[]),contacts=new Map();
 let hit=null,faces=0;for(const id of ids){const building=index.buildings[id];let box=compiled.boxes.get(id);if(box===undefined){box=buildingBox(building);compiled.boxes.set(id,box);}if(box&&!boxIntersects(box,origin,chord,maxM,1+Math.abs(curvature)*maxM*maxM))continue;let polys=compiled.get(id);if(!polys){polys=building.polygons.map(poly=>({id:poly.id,rings:poly.rings.map(r=>r.map(p=>local(p[1],p[0],p[2])))}));compiled.set(id,polys);}for(const poly of polys){faces++;const own=targetIds.has(building.id)&&(!building.sourceSha256||building.sourceSha256===association.sourceSha256),h=faceHit(poly.rings,origin,direction,own?maxM:hit?.distanceM??maxM,quadratic);if(h){const row={...h,pointFrame:'WGS84 ECEF offset from lon139.73068 lat35.68626 h0; geoid uncorrected diagnostic',buildingId:building.id,polygonId:poly.id,lod:building.lod,observerWithinHitBuildingBBox:building.bbox?lon>=building.bbox[0]&&lon<=building.bbox[2]&&lat>=building.bbox[1]&&lat<=building.bbox[3]:null};if(own){contacts.set(building.id+':'+poly.id,row);}else hit=row;}}}
 return {refractionK,status:hit?'model-blocked':contacts.size?'target-contact':'unknown',recommend:false,hit,targetContacts:[...contacts.values()],faces,buildingsChecked:ids.size,reason:hit?'conditional-model-intersection':contacts.size?'target-complex-contact-needs-component-check':'incomplete-coverage-or-uncertainty'};
}
function covers(index,observer,end){
 const meshes=index.coverageMeshes?.filter(m=>m.provided);if(!meshes?.length)return {complete:false,reason:'no-building-model-range'};
 const within=(p,b)=>p[0]>=b[0]-1e-10&&p[0]<=b[2]+1e-10&&p[1]>=b[1]-1e-10&&p[1]<=b[3]+1e-10;
 const selection=index.geometrySelection,extra=selection?.includedFullSourceMeshes||selection?.unclippedCoverageMeshes||[],boxes=meshes.map(m=>m.bbox),rect=b=>[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]],boundaries=[...boxes.map(rect),...(selection?[selection.envelopeLonLat]:[])];
 const inSelection=p=>!selection||inside(selection.envelopeLonLat,p)||meshes.some(m=>extra.includes(m.code)&&within(p,m.bbox));
 const inv=Geo().inverse(observer.latitude,observer.longitude,end.latitude,end.longitude),n=Math.max(1,Math.ceil(inv.km*1000/50));let checked=0,previous=[observer.longitude,observer.latitude];
 for(let j=1;j<=n;j++){const geo=j===n?end:Geo().destination(observer.latitude,observer.longitude,inv.azimuth,inv.km*j/n),next=[geo.longitude,geo.latitude],delta=sub(next,previous),marks=[0,1];
  for(const ring of boundaries)for(let i=0;i<ring.length;i++){const a=ring[i],edge=sub(ring[(i+1)%ring.length],a),den=delta[0]*edge[1]-delta[1]*edge[0];if(Math.abs(den)<1e-20)continue;const q=sub(a,previous),t=(q[0]*edge[1]-q[1]*edge[0])/den,u=(q[0]*delta[1]-q[1]*delta[0])/den;if(t>0&&t<1&&u>=0&&u<=1)marks.push(t);}
  marks.sort((a,b)=>a-b);for(let k=1;k<marks.length;k++){const t=(marks[k-1]+marks[k])/2,p=previous.map((x,i)=>x+t*delta[i]);if(!inSelection(p))return {complete:false,reason:'outside-selected-building-range',checked};if(!boxes.some(b=>within(p,b)))return {complete:false,reason:'missing-building-source-mesh',checked};checked++;}previous=next;
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

function create({align,shooting,bodies,index,surfaceAt,terrain=null,prefilter=true,mode='diagnostic',yieldTask=()=>new Promise(r=>setTimeout(r,0))}){
 const paths=new Map();
 return async function evaluate(plan,point){
  await yieldTask();const surface=surfaceAt(point)||{},dem=terrain?.at(point),estimate=mode==='model-los'?dem:surface.estimateM;if(!Number.isFinite(estimate))return {status:'unknown',recommend:false,reason:'no-standing-height-estimate'};
  const obs={...point,elevation:estimate,eyeM:1.5};
  if(mode==='model-los'&&point.sourceId&&(!point.structureClassificationKnown||point.nonTerrainStructure))return {status:'model-unknown',recommend:false,reason:'bridge-or-standing-height-unresolved'};
  if(mode==='model-los'&&surface.water===true)return {status:'model-unknown',recommend:false,reason:'water-or-bridge-height-unresolved'};
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
  const distance=geometry?.distanceKm*1000,refractionK=mode==='model-los'?(globalThis.AstroNotesAtmosphere?.targetK?.()??7/6):1;
  const needsTargetProbe=mode!=='model-los'||(plan.partId&&plan.partId!=='__whole'&&plan.matchMode!=='overlap');
  const targetRay=needsTargetProbe&&geometry&&events.length?trace(index,obs,{azimuth:geometry.azimuth,altitude:Math.atan2(geometry.topM-obs.elevation-obs.eyeM-distance*distance/(2*R*refractionK),distance)/rad,maxM:distance,refractionK,targetKey:plan.target.id,endpoint:{...plan.target,elevation:geometry.topM}}):null;
  const targetTerrain=needsTargetProbe&&geometry&&events.length&&terrain?terrain.trace(obs,{azimuth:geometry.azimuth,altitude:Math.atan2(geometry.topM-obs.elevation-obs.eyeM-distance*distance/(2*R*refractionK),distance)/rad,maxM:distance,refractionK,targetKey:plan.target.id,endpoint:{...plan.target,elevation:geometry.topM}}):null;
  const tested=[];for(const event of events){const st=bodies.state(plan.body,event.at,{...obs,elevation:obs.elevation+obs.eyeM});const rays=[];for(const offset of [0,-1,1]){const ray={targetKey:plan.target.id,azimuth:st.azimuth,altitude:(mode==='model-los'?(offset===1?(st.upperAltitude??st.apparentAltitude+st.angularRadius):offset===-1?(st.lowerAltitude??st.apparentAltitude-st.angularRadius):st.apparentAltitude):(st.geometricAltitude??st.altitude??st.apparentAltitude)+offset*st.angularRadius),maxM:mode==='model-los'?distance:12000,refractionK};const building=trace(index,obs,ray),ground=terrain?.trace(obs,ray)??null;const result={...building,terrain:ground,model:mode==='model-los'?classifyRay(index,obs,ray,building,ground):null};rays.push(result);if(mode==='model-los'&&result.model.status==='model-blocked')break;}tested.push({event,rays});}
  if(mode==='model-los'){
   const selectedPartRequired=plan.partId&&plan.partId!=='__whole'&&plan.matchMode!=='overlap';
   const selectedPartModel=selectedPartRequired&&targetRay&&targetTerrain?classifyRay(index,obs,{targetKey:plan.target.id,azimuth:geometry.azimuth,maxM:distance,endpoint:{...plan.target,elevation:geometry.topM}},targetRay,targetTerrain):null;
   const event=(!selectedPartRequired||selectedPartModel?.status==='model-visible')?tested.find(e=>e.rays.every(r=>r.model.status==='model-visible'))?.event:null;
   const evidence={kind:'terrain-and-building-model-los',scope:'observer-to-target',treesModeled:false,actualVisibilityGuaranteed:false,observerHeightBasis:'GSI DEM + 1.5m',buildingRangeComplete:!!event,terrainNumericComplete:!!event,refractionK,bodySamples:'centre/upper/lower'};
   if(event)return {status:'model-visible',recommend:true,aligned:true,event,place:{id:'model-'+point.latitude.toFixed(7)+','+point.longitude.toFixed(7),name:'モデル候補 '+point.latitude.toFixed(5)+', '+point.longitude.toFixed(5),latitude:point.latitude,longitude:point.longitude,elevation:estimate,eyeHeightAGL:1.5},modelEvidence:evidence,events:tested,targetRay,targetTerrain,assumedObserver:obs,surface};
   return {status:!events.length?'no-overlap':tested.some(e=>e.rays.some(r=>r.model.status==='model-blocked'))?'model-blocked':'model-unknown',recommend:false,aligned:events.length>0,events:tested,targetRay,targetTerrain,modelEvidence:evidence,assumedObserver:obs,surface,reason:events.length?'model-obstructed-or-range-unresolved':'no-overlap-event'};
  }
  return {status:'unknown',recommend:false,aligned:events.length>0,events:tested,targetRay,targetTerrain,targetProbe:{kind:plan.matchMode==='overlap'||plan.partId==='__whole'?'whole-object-tip-probe':'selected-height-probe',heightM:geometry?.topM??null,diagnosticOnly:true},assumedObserver:obs,surface,reason:'estimated-surface-and-incomplete-3d-coverage'};
 };
}
return {faceHit,trace,covers,classifyRay,create};
});

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
  // Narrow sidewalks may fall between grid rows; edge midpoints remain inside
  // or on the source polygon and provide deterministic extra sampling positions.
  const candidates=[];
  for(let lat=a+dy/2;lat<b;lat+=dy)for(let lon=lo+dx/2;lon<hi;lon+=dx)if(inside(ring,lat,lon)&&!(feature.interiorRingsLonLatHeight||[]).some(hole=>inside(hole,lat,lon)))candidates.push(point(lat,lon));
  for(let i=1;i<ring.length;i++)candidates.push(point((ring[i-1][1]+ring[i][1])/2,(ring[i-1][0]+ring[i][0])/2));
  for(const p of candidates){
   const key=p.latitude.toFixed(7)+','+p.longitude.toFixed(7);if(seen.has(key))continue;seen.add(key);
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
function keyFor(plan,version,atmosphere){return JSON.stringify([version,plan.owner,plan.body,plan.target,plan.partId,plan.limb,plan.matchMode,day(plan.at),atmosphere]);}
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
  const data=await loadData();if(!isCurrent())return {cancelled:true};
  const key=keyFor(plan,data.version,atmosphere);if(cache.has(key))return {...cache.get(key),cached:true};
  if(jobs.has(key)){const result=await jobs.get(key);return !isCurrent()?{cancelled:true}:result.cancelled?search(plan,{onProgress,isCurrent,atmosphere}):{...result,cached:true};}
  const work=(async()=>{
   const start=clock(),generated=sampleSidewalks(data),counts={sampled:generated.rows.length,checked:0,aligned:0,blocked:0,unknown:0,noOverlap:0,deferred:0};const rows=[];
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
     else if(result?.recommend===true&&((result.status==='verified'&&p.groundKnown&&p.standingSurfaceKnown&&data.visibilityCertified===true)||(result.status==='model-visible'&&result.modelEvidence?.kind==='terrain-and-building-model-los'&&result.modelEvidence.scope==='observer-to-target'&&result.modelEvidence.buildingRangeComplete&&result.modelEvidence.terrainNumericComplete&&result.modelEvidence.actualVisibilityGuaranteed===false))&&result.event&&Number.isFinite(result.event.at)&&day(result.event.at)===day(plan.at))rows.push(result);
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

// Trial adapter: one existing place picker, no new page, no saved-place writes.
(()=>{
'use strict';
let dataPromise=null,run=0,section=null,condition='',watch=null;
const dataTag=new URL(document.currentScript.src,location.href).searchParams.get('v')||'0';
const dataHashes={"candidate-terrain.json":"5c78165203510383eab45feb0e2195a06c6f4d8ec5f3e682db941ca705279779","candidate-buildings.json":"e4ec51ed732be60108959a7854cdd5ae8aab46a94aaa026f0d5094101e1f4c8a","candidate-surfaces.json":"de16ae6e56aa05a1d4a7d6d0fa8974a4373183f35e8282f412f7fbd7c637751f","candidate-sidewalks.json":"efc42ec01902232f52ec36e84808dc3400892d91c5ddf663d91ef34bb123e48a"};
const readData=async name=>{const r=await fetch('data/'+name+'?v='+dataTag);if(!r.ok)throw Error('data');const bytes=await r.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==dataHashes[name])throw Error('data-version');return JSON.parse(new TextDecoder().decode(bytes));};
const stopWatch=()=>{if(watch!==null){clearInterval(watch);watch=null;}};
const loadData=()=>dataPromise||(dataPromise=readData('candidate-sidewalks.json').catch(e=>{dataPromise=null;throw e;}));
let modelPromise=null;
const loadModel=()=>modelPromise||(modelPromise=Promise.all(['candidate-buildings.json','candidate-terrain.json'].map(readData)).then(async([packed,dem])=>AstroNotesCandidateModel.create({align:AstroNotesAlign,shooting:AstroNotesShooting,bodies:AstroNotesBodies,index:await AstroNotesCandidateBuildings.decode(packed),mode:'model-los',terrain:await AstroNotesCandidateTerrain.decode(dem),surfaceAt:()=>({})})).catch(e=>{modelPromise=null;throw e;}));
const engine=AstroNotesCandidateDiscovery.create({loadData,diagnoseUnknown:true,
 // Real candidate astronomy and LOD1/2 faces are diagnostic; missing evidence stays unknown.
 evaluate:async(plan,p)=>plan.target.id==='skytree'&&['moon','sun'].includes(plan.body)?(await loadModel())(plan,p):({status:'unknown',recommend:false,reason:'unsupported-pilot-condition'})});
const context=s=>JSON.stringify([s.body,s.target,s.partId,s.limb,AstroNotesCandidateDiscovery.day(s.at),s.matchMode||'limb']);
function snapshot(){
 if(typeof SkyMapUI==='undefined'||typeof auth==='undefined'||!auth||typeof screenAllowed!=='function'||!screenAllowed('skymap')||!screenAllowed('framing'))return null;
 const s=SkyMapUI.selectionState();if(!s?.target||!Number.isFinite(s.at))return null;
 return {...s,owner:auth.loginId,expected:context(s),atmosphere:air()};
}
const air=()=>JSON.stringify([typeof aimAirSettings==='undefined'?'standard':aimAirSettings,globalThis.AstroNotesAtmosphere?.dataKey?.()??null]);
const key=p=>p?JSON.stringify([p.owner,p.expected,p.atmosphere]):'';
function current(token,p,node){const now=snapshot();return token===run&&node.isConnected&&document.getElementById('placeSheet')?.open&&!document.getElementById('recentCandidates')?.hidden&&key(now)===key(p);}
function mapAnchor(point){
 const data=AstroNotesCandidateDiscovery.mapLink(point,navigator.userAgent,navigator.maxTouchPoints||0);if(!data)return null;
 const link=document.createElement('a');link.className='fav-btn tiny';link.textContent='地図アプリで開く';link.href=data.href;link.setAttribute('aria-label','撮影地点 '+point.latitude.toFixed(5)+', '+point.longitude.toFixed(5)+' を地図アプリで開く');
 if(!data.native){link.target='_blank';link.rel='noopener';}
 if(data.choose)link.onclick=e=>{if(typeof openMapAppSheet==='function'){e.preventDefault();openMapAppSheet(point.latitude.toFixed(7)+', '+point.longitude.toFixed(7));}};
 return link;
}
function syncObserverMap(){
 const previous=document.getElementById('exploreExternalMap'),point=snapshot()?.observer,anchor=document.getElementById('skyMapObserverSummary');
 if(!anchor||!point){previous?.remove();return;}const next=mapAnchor(point);if(!next){previous?.remove();return;}
 if(previous?.href===next.href)return;previous?.remove();next.id='exploreExternalMap';anchor.after(next);
}
function mount(){
 syncObserverMap();
 const panel=document.getElementById('recentCandidates'),sheet=document.getElementById('placeSheet');
 if(!panel||!sheet?.open||panel.hidden||typeof placeSheetFor==='undefined'||placeSheetFor!=='skymap'){
  if(section){stopWatch();run++;section.remove();section=null;condition='';}return;
 }
 const p=snapshot(),id=key(p);if(section?.isConnected&&condition===id)return;
 stopWatch();run++;section?.remove();condition=id;section=document.createElement('section');section.id='additionalCandidateSearch';section.setAttribute('aria-label','ほかの候補地点');
 const description=document.createElement('p');description.className='tiny';description.textContent='登録した撮影地点の候補は上に表示します。追加探索は月・太陽 × 東京スカイツリーに対応し、四ツ谷・スカイツリー周辺の一部歩道で試用しています。選んだ日の0〜24時（日本時間）を調べます。';
 const scope=document.createElement('p');scope.className='tiny';scope.textContent='地形・建物モデルに基づく候補です。樹木などは未考慮で、現地の見え方を保証するものではありません。';
 const status=document.createElement('div');status.className='tiny';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 let waitMessage=null;
 const setStatus=(message,waiting=false)=>{status.className=waiting?'note-wait candidate-wait':'tiny';status.replaceChildren();waitMessage=null;if(waiting){const character=document.createElement('span');character.className='note-wait-character';character.setAttribute('aria-hidden','true');waitMessage=document.createElement('span');waitMessage.className='note-wait-message';waitMessage.textContent=message;status.append(character,waitMessage);}else status.textContent=message;};
 const button=document.createElement('button');button.type='button';button.className='fav-btn';button.textContent='ほかの候補地点を探す';
 const cancel=document.createElement('button');cancel.type='button';cancel.className='fav-btn';cancel.textContent='探索を中止';cancel.hidden=true;
 const resultList=document.createElement('div');resultList.id='additionalCandidateResults';
 const evidence=document.createElement('details'),summary=document.createElement('summary'),source=document.createElement('p'),link=document.createElement('a');
 summary.textContent='探索範囲・出典';source.className='tiny';source.textContent='四ツ谷とスカイツリー周辺の歩道で試用しています。出典：PLATEAU 2025（17メッシュのLOD1/2建物と2メッシュの歩道を加工）。モデルの範囲や立つ高さが不明な地点は候補に含めません。 ';
 link.href='https://www.mlit.go.jp/plateau/site-policy/';link.target='_blank';link.rel='noopener';link.textContent='利用条件';source.append(link);const tokyo=document.createElement('a');tokyo.href='https://catalog.data.metro.tokyo.lg.jp/dataset/t000029d0000000024';tokyo.target='_blank';tokyo.rel='noopener';tokyo.textContent='東京都の出典';const license=document.createElement('a');license.href='https://creativecommons.org/licenses/by/4.0/deed.ja';license.target='_blank';license.rel='noopener';license.textContent='CC BY 4.0';const gsi=document.createElement('a');gsi.href='https://maps.gsi.go.jp/development/demtile.html';gsi.target='_blank';gsi.rel='noopener';gsi.textContent='国土地理院 標高タイル（加工）';source.append(' ／ ',tokyo,'・',license,' ／ ',gsi,'。地形は5m由来を優先し、欠測部は10m由来で代替しています。地面から1.5mを仮定し、撮影地点から対象までの天体中心・上下点を調べます。橋・高架など立面が不明な地点は出しません。樹木・建物以外の構造物・細い遮蔽物・対象より奥の遮蔽や現地の変化は未考慮です。');evidence.append(summary,source);
 section.append(description,scope,button,cancel,status,resultList,evidence);panel.append(section);
 const supported=p&&p.target.id==='skytree'&&['moon','sun'].includes(p.body);button.disabled=!supported;status.textContent=!p?'天体・対象・日付を選んでください。':!supported?'追加探索は月または太陽と東京スカイツリーの条件で試用できます。':'';
 cancel.onclick=()=>{stopWatch();run++;button.disabled=false;cancel.hidden=true;resultList.setAttribute('aria-busy','false');setStatus('探索を中止しました。');};
 button.onclick=async()=>{
  const selected=snapshot();if(!selected){mount();return;}
  if(condition!==key(selected)){mount();section?.querySelector('button')?.click();return;}
  const node=section,token=++run;stopWatch();watch=setInterval(()=>{if(!current(token,selected,node)){stopWatch();mount();}},250);button.disabled=true;cancel.hidden=false;resultList.replaceChildren();resultList.setAttribute('aria-busy','true');setStatus('ほかの候補地点を確認しています…',true);status.scrollIntoView({block:'nearest'});
  try{
   const result=await engine.search(selected,{isCurrent:()=>current(token,selected,node),onProgress:counts=>{if(current(token,selected,node))if(waitMessage)waitMessage.textContent='天体の重なりと見通しを確認しています… '+counts.checked+'地点を確認';},atmosphere:selected.atmosphere});
   if(!current(token,selected,node)||result.cancelled)return;
   for(const row of result.rows){
    const item=document.createElement('button');item.type='button';item.className='list-item';item.dataset.modelBasis=row.modelEvidence?.kind||'unknown';item.textContent=row.place.name+' '+new Date(row.event.at+32400000).toISOString().slice(11,16)+(row.event.at<Date.now()?'（過ぎた時刻）':'');
    item.onclick=()=>{if(current(token,selected,node)&&SkyMapUI.selectCandidate(row,selected.expected))sheet.close();};const rowBox=document.createElement('div');rowBox.append(item);const map=mapAnchor(row.place);if(map)rowBox.append(map);resultList.append(rowBox);
   }
   setStatus('');resultList.setAttribute('aria-busy','false');status.textContent=result.rows.length?result.rows.length+'件のモデル上の候補があります。':'この条件で、地形・建物モデル上の見通しを確認できた候補はありません。';
   if(result.counts.unknown)status.textContent+=' 範囲外や高さ不明など、判定できない地点は含めていません。';
   if(result.counts.deferred)status.textContent+=' 先絞りで詳細計算していない地点があります。';
   if(result.limited)status.textContent+=' 調べ切れていない範囲があります。';
  }catch{if(current(token,selected,node)){resultList.setAttribute('aria-busy','false');setStatus('候補の情報を読み込めませんでした。もう一度お試しください。');}}
  finally{if(token===run){stopWatch();if(!current(token,selected,node))mount();}if(current(token,selected,node)){button.disabled=false;cancel.hidden=true;}}
 };
}
// Observe only the picker so progress and map rendering cannot create a busy loop.
const picker=document.getElementById('placeSheet');if(picker){new MutationObserver(mount).observe(picker,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','aria-selected']});picker.addEventListener('close',()=>{stopWatch();run++;section?.remove();section=null;condition='';});}
mount();
})();

// data-release c20dfe0d846b9172bbccbae0dab4e2ccfff66ebdbd99dfd925b148afe8da6b5c
