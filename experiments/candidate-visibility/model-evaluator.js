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
  const targetRay=geometry&&events.length?trace(index,obs,{azimuth:geometry.azimuth,altitude:Math.atan2(geometry.topM-obs.elevation-obs.eyeM-distance*distance/(2*R*refractionK),distance)/rad,maxM:distance,refractionK,targetKey:plan.target.id,endpoint:{...plan.target,elevation:geometry.topM}}):null;
  const targetTerrain=geometry&&events.length&&terrain?terrain.trace(obs,{azimuth:geometry.azimuth,altitude:Math.atan2(geometry.topM-obs.elevation-obs.eyeM-distance*distance/(2*R*refractionK),distance)/rad,maxM:distance,refractionK,targetKey:plan.target.id,endpoint:{...plan.target,elevation:geometry.topM}}):null;
  const tested=[];for(const event of events){const st=bodies.state(plan.body,event.at,{...obs,elevation:obs.elevation+obs.eyeM});const rays=[0,-1,1].map(offset=>{const ray={targetKey:plan.target.id,azimuth:st.azimuth,altitude:(mode==='model-los'?(offset===1?(st.upperAltitude??st.apparentAltitude+st.angularRadius):offset===-1?(st.lowerAltitude??st.apparentAltitude-st.angularRadius):st.apparentAltitude):(st.geometricAltitude??st.altitude??st.apparentAltitude)+offset*st.angularRadius),maxM:mode==='model-los'?distance:12000,refractionK};const building=trace(index,obs,ray),ground=terrain?.trace(obs,ray)??null;return {...building,terrain:ground,model:mode==='model-los'?classifyRay(index,obs,ray,building,ground):null};});tested.push({event,rays});}
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
