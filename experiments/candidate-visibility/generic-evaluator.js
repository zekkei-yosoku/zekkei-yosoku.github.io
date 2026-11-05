/* Generic candidate evaluation. Domain geometry and IO ports remain separate. */
(function(root){
'use strict';
const Model=root.AstroNotesCandidateModel||(typeof require==='function'?require('./model-evaluator.js'):null);
const Composition=root.AstroNotesCandidateComposition||(typeof require==='function'?require('./composition.js'):null);
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
 const halfX=w/(2*lens.focal)/D,halfY=h/(2*lens.focal)/D,axis=cameraAxis(plan,observer,state,geometry,align,halfX,halfY);
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
function skyRange(eye,altitude,k){
 // A computational horizon for the DEM model, not a proof of absent buildings.
 const effectiveR=R*k,alpha=altitude*D,height=d=>{const t=d/effectiveR,den=Math.cos(t)-Math.tan(alpha)*Math.sin(t);return den>0?(effectiveR+eye)/den-effectiveR:Infinity;};
 let lo=Math.max(0,-alpha*effectiveR),hi=Math.max(1000,lo+1000);while(height(hi)<9000&&hi<Math.PI*effectiveR/2)hi*=2;
 for(let i=0;i<40;i++){const mid=(lo+hi)/2;if(height(mid)<9000)lo=mid;else hi=mid;}
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
 const raised=t=>t&&(t.location==='roof'||t.location==='rooftop'||t.location==='underground'||t.indoor==='yes'||t.bridge&&t.bridge!=='no'||t.tunnel&&t.tunnel!=='no'||t.covered==='yes'||t.level!=null&&Number(t.level)!==0||t.layer!=null&&Number(t.layer)!==0);
 if(!source&&seed.sourceEvidence?.kind!=='PLATEAU-pedestrian-surface')return false;
 if(forbidden(source?.tags)||areas.some(f=>forbidden(f.tags)))return false;
 const knownRaised=seed.nonTerrainStructure&&seed.standingSurfaceKnown&&[seed.surfaceAglM,seed.surfaceHeightM,seed.surfaceElevationM].some(Number.isFinite);
 if(areas.some(f=>f.water)&&!knownRaised)return false;
 if((raised(source?.tags)||areas.some(f=>raised(f.tags)))&&!knownRaised)return false;
 const containingBuilding=areas.find(f=>f.building);
 if(containingBuilding&&(!knownRaised||seed.sourceEvidence?.buildingContaining!==containingBuilding.id))return false;
 const viewpoint=areas.find(f=>f.kind==='viewpoint'),square=areas.find(f=>f.kind==='plaza'),river=areas.find(f=>/河川敷|川.*テラス|川緑道|riverbank|riverside/i.test(f.name)),park=areas.find(f=>f.kind==='park');
 if(viewpoint&&!knownRaised)return false;
 const walkSquare=source?.walking&&(source.tags?.area==='yes'||source.tags?.['area:highway']);
 const area=viewpoint||square||river||park,placeKind=viewpoint?'viewpoint':square||walkSquare?'plaza':river?'riverbank':park?'park':'road';
 const name=area?.name||source?.name||({viewpoint:'展望地点',plaza:'歩行広場',riverbank:'河川沿いの歩道',park:'公園の園路',road:'歩道の撮影候補'}[placeKind]);
 return {placeKind,name,placeId:area?.sourceId||source?.sourceId||seed.placeId,accessKnown:!![source,...areas].find(f=>['yes','public','permissive','designated'].includes(f?.tags?.foot)||['yes','public','permissive'].includes(f?.tags?.access)),
  sourceEvidence:{...seed.sourceEvidence,placeOsmId:area?.id||source?.id||null,areaTags:area?.tags||null,classification:area?'mapped-area-at-resolved-position':'walkway-at-resolved-position',resolvedPositionAreaChecked:true,actualVisibilityGuaranteed:false}};
}
function createGeneric({align,bodies,geo,terrain,index=null,staticTerrain=null,sidewalks=null,yieldTask=()=>new Promise(r=>setTimeout(r,0))}={}){
 const visibilityCache=new Map();
 async function terrainRay(observer,ray,options){
  if(staticTerrain){const tested=staticTerrain.trace(observer,ray);if(tested.hit||tested.checked>0&&tested.missing===0)return {...tested,status:tested.hit?'blocked':'model-clear',nativeRaster:true};}
  return terrain?terrain.trace(observer,{...ray,...options}):{status:'unknown',reason:'terrain-unavailable',missing:1};
 }
 function buildingRay(observer,ray){
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
 async function visibility(plan,solution,options={}){
  const obs=solution.observer,g=solution.geometry,at=solution.event.at,eye={...obs,elevation:obs.elevation+obs.eyeM};
  const state=bodies.state(plan.body,at,eye),target=solution.anchor||plan.target,distance=g.distanceKm*1000,k=root.AstroNotesAtmosphere?.targetK?.()??7/6;
  const stateKey=[state.azimuth,state.apparentAltitude,state.angularRadius,state.upperAltitude,state.lowerAltitude];
  const cacheKey=JSON.stringify([obs,at,plan.body,plan.target,plan.partId,target,g,plan.atmosphere,root.AstroNotesAtmosphere?.dataKey?.()??null,stateKey,k]);
  if(visibilityCache.has(cacheKey))return visibilityCache.get(cacheKey);
  const targetRay={azimuth:g.azimuth,altitude:g.angle,maxM:distance,endpoint:{...target,elevation:g.topM},targetKey:plan.target.id,refractionK:k};
  const tg=await terrainRay(obs,targetRay,options),tb=buildingRay(obs,targetRay);
  if(tg.hit||tb.status==='blocked')return {status:'blocked',target:{terrain:tg,buildings:tb},reason:'target-obstructed'};
  const outline=align.towerOutline?.(obs,plan.target,{eyeM:obs.eyeM}),outlineAvailable=!!(outline?.known&&!outline.schematic),polygons=outline?.polygons||[outline?.hitPoints||outline?.points||[]];
  const projection=align.viewProjector(state.azimuth,state.apparentAltitude),unproject=align.viewUnprojector(state.azimuth,state.apparentAltitude);
  const projected=outlineAvailable?polygons.filter(r=>r.length>=3).map(r=>r.map(p=>projection(p[0],p[1]))).filter(r=>r.every(p=>p?.every(Number.isFinite))):[],knownOutline=outlineAvailable&&projected.length>0;
  const radius=state.angularRadius||0,disc=radius>0,offsets=disc?[[0,0],[0,.9],[0,-.9],[.9,0],[-.9,0],[.6364,.6364],[-.6364,.6364],[.6364,-.6364],[-.6364,-.6364]]:[[0,0]],rays=[];
  for(const [x,y]of offsets){
   if(options.isCurrent?.()===false)throw Error('candidate-cancelled');
   const rx=Math.tan(radius*D)/D,ry=Math.tan((y>=0?(state.upperAltitude??state.apparentAltitude+radius)-state.apparentAltitude:state.apparentAltitude-(state.lowerAltitude??state.apparentAltitude-radius))*D)/D;
   const angular=unproject(x*rx,y*ry),inTarget=projected.some(r=>inside(r,[x*rx,y*ry]));
   if(inTarget){rays.push({status:'blocked',intentionalTarget:true});continue;}
   const ray={azimuth:angular[0],altitude:angular[1],maxM:Math.max(distance,skyRange(eye.elevation,angular[1],k)),refractionK:k,targetKey:plan.target.id};
   const ground=await terrainRay(obs,ray,options),building=buildingRay(obs,ray);
   rays.push({status:ground.hit||building.status==='blocked'?'blocked':ground.status==='model-clear'&&building.status==='model-clear'&&knownOutline?'model-clear':'unknown',terrain:ground,buildings:building,rangeM:ray.maxM});
   await yieldTask();
  }
  const clear=rays.filter(r=>r.status==='model-clear').length,unknown=rays.filter(r=>r.status==='unknown').length;
  const result={status:!clear&&!unknown?'blocked':tg.status==='model-clear'&&tb.status==='model-clear'&&clear?'model-clear':'unknown',target:{terrain:tg,buildings:tb},rays,visibleSamples:clear,unknownSamples:unknown,totalSamples:rays.length,shapeKnown:knownOutline,treesModeled:false,actualVisibilityGuaranteed:false,datumUncertainty:true};
  if(result.status!=='unknown')visibilityCache.set(cacheKey,result);while(visibilityCache.size>150)visibilityCache.delete(visibilityCache.keys().next().value);
  return result;
 }
 async function evaluate(plan,point,data,options={}){
  if(point.access==='no'||point.access==='private')return {status:'excluded',recommend:false,reason:'access-restricted'};
  if(point.standingSurfaceKnown!==true||point.nonTerrainStructure&&![point.surfaceElevationM,point.surfaceAglM,point.surfaceHeightM].some(Number.isFinite))return {status:'unknown',recommend:false,reason:'standing-height-unknown'};
  const ground=Number.isFinite(point.groundM)?point.groundM:await terrain?.at(point,options);
  if(!Number.isFinite(ground))return {status:'unknown',recommend:false,reason:'standing-height-unknown'};
  const floor=Number.isFinite(point.surfaceElevationM)?point.surfaceElevationM:ground+(point.surfaceAglM??point.surfaceHeightM??0),eyeM=Number.isFinite(point.eyeM)?point.eyeM:1.5;
  const obs={...point,elevation:floor,eyeM};
  const solved=await Composition.opportunities(plan,obs,{align,bodies,terrain,sidewalks,groundAt:p=>terrain?.at(p,options),standingAt:p=>standingMetadata(p,data,point),isCurrent:options.isCurrent,yieldTask});
  const accepted=[];let blocked=0,outside=0;
  for(const solution of solved.solutions||[]){
   if(options.isCurrent?.()===false)throw Error('candidate-cancelled');
   const state=bodies.state(plan.body,solution.event.at,{...solution.observer,elevation:solution.observer.elevation+solution.observer.eyeM});
   const frame=lensCheck(plan,solution.observer,state,solution.geometry,align);if(!frame.fits){outside++;continue;}
   const los=await visibility(plan,solution,options);if(los.status==='blocked'){blocked++;continue;}
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
    // Retain the main event's (p,t); do not search a different time for an extra.
    const extraSolution={observer:position,event:{at},geometry,anchor:other},extraLos=await visibility(extraPlan,extraSolution,options);
    extras.push({id:other.id,frame:otherFrame,visibility:extraLos.status,evidence:extraLos,at,observer:{latitude:position.latitude,longitude:position.longitude,elevation:position.elevation,eyeM:position.eyeM}});
   }
   if(plan.requireAllTargets&&extras.some(x=>!x.frame.fits||x.frame.status==='unknown')){outside++;continue;}
   // Even an optional extra is a real occulting object. Its own obstruction
   // may be optional; a known obstruction of the photographed body is not.
   if(extras.some(x=>x.visibility==='blocked'&&x.evidence?.reason!=='target-obstructed')){blocked++;continue;}
   if(plan.requireAllTargets&&extras.some(x=>x.visibility==='blocked')){blocked++;continue;}
   const combinedClear=los.status==='model-clear'&&extras.every(x=>x.visibility==='model-clear'),visibilityQuality=combinedClear?'model-clear':'unknown';
   const kind=position.placeKind||point.placeKind;
   accepted.push({id,requestKey:plan.requestKey,status:combinedClear&&frame.status!=='unknown'?'model-visible':'geometry-only',recommend:true,aligned:true,placeKind:kind==='sidewalk'?'road':kind||'unknown',surfaceId:point.surfaceId,
    place:{id,name:position.name||point.name||'撮影候補地点',latitude:position.latitude,longitude:position.longitude,elevation:finalGround,groundManualM:finalGround,stand:'ground',standAglM:position.elevation-finalGround+position.eyeM,eyeHeightAGL:position.elevation-finalGround+position.eyeM,decks:[],surfaceId:point.surfaceId},
    assumedObserver:{...position},event:{...solution.event,sunAltitude:sun.apparentAltitude},quality:{visibility:visibilityQuality,frame:frame.status,photographyClass:photo,geometry:solution.event.targetGeometryKind||'anchor',datum:'source-epoch-unverified'},rank:[combinedClear?0:1,solution.event.gapAngleDeg??0],
    frame,extraTargets:extras,visibility:los,sourceEvidence:position.sourceEvidence||point.sourceEvidence,modelEvidence:{kind:combinedClear?'terrain-and-building-model-los':'geometry-with-partial-los',scope:'target-and-celestial-rays',actualVisibilityGuaranteed:false,treesModeled:false,terrainNumericComplete:!!los.rays?.every(r=>r.intentionalTarget||r.terrain?.status==='model-clear'),buildingRangeComplete:!!los.rays?.every(r=>r.intentionalTarget||r.buildings?.complete&&r.buildings?.evaluated),targetSelfGeometryComplete:los.shapeKnown&&los.target?.buildings?.evaluated&&!los.target?.buildings?.unresolvedTargetContacts,extraTargetsAssessed:extras.length,datumUncertainty:true}});
  }
  return accepted.length?{...accepted[0],additionalCandidates:accepted.slice(1),partial:solved.partial}: {status:blocked?'model-blocked':outside?'outside-frame':'no-overlap',recommend:false,partial:solved.partial,reason:solved.reason};
 }
 return {evaluate,visibility,clear:()=>visibilityCache.clear()};
}
Model.createGeneric=createGeneric;Model.lensCheck=lensCheck;Model.photographability=photographability;Model.skyRange=skyRange;
if(typeof module==='object'&&module.exports)module.exports={createGeneric,lensCheck,photographability,skyRange,angularDistance,standingMetadata};
})(globalThis);
