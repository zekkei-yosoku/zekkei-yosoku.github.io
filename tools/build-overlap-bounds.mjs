// 2026-11-10 Trial only. 探す（記録の撮影地点）は立ち位置ごと・日ごとに建物の外形を作ってから
// 判定していた（外形づくりが1か所約20ms、判定そのものは約0.5ms）。外形を作る前に、外形を必ず
// 含む方位・高度の枠を安く求め、天体がその日その枠の近くを通らない立ち位置を外す
// （record-search-runtime.js の recordFar）。枠は prepareDailyView が距離を測る形
// （towerOutline の当たり面、外形が無ければ狙う点）をすべて含む。
export function patchOutlineBounds(source){
 const one=(from,to)=>{if(source.split(from).length!==2)throw Error('Outline bounds boundary changed: '+from.slice(0,60));source=source.replace(from,to);};
 // The model's world (its vertices placed on the ground) is shared by the outline and the bounds.
 const start='    const ref=model.calibration?.observer;\n',endMark='castleWorldCache.set(key,world);\n    }\n';
 if(source.split(start).length!==2)throw Error('Outline bounds world boundary changed');
 const a=source.indexOf(start),b=source.indexOf(endMark,a);if(b<0)throw Error('Outline bounds world end changed');
 const block=source.slice(a,b+endMark.length);
 source=source.slice(0,a)+'    const world=modelWorld(target,model);\n'+source.slice(b+endMark.length);
 one('  function modelOutline(observer,target,model,{eyeM=1.5,heightM=null}={}) {\n',
  '  function modelWorld(target,model){\n'+block+'    return world;\n  }\n'+
  '  const modelHeight=(model,top,z)=>model.heightMode==="translate-top"?(model.groundAnchored&&z===0?0:z+top-model.heightM):z*top/model.heightM;\n'+
  '  function modelOutline(observer,target,model,{eyeM=1.5,heightM=null}={}) {\n');
 one('    const height=z=>model.heightMode==="translate-top"?(model.groundAnchored&&z===0?0:z+top-model.heightM):z*top/model.heightM;\n','    const height=z=>modelHeight(model,top,z);\n');
 const bounds=String.raw`
  // Footprint (convex hull on the ground, metres east/north of the target) and height range of a model.
  const modelFootprints=new WeakMap();
  function modelFootprint(target,model,top){
    const world=modelWorld(target,model);let byTop=modelFootprints.get(world);if(!byTop){byTop=new Map();modelFootprints.set(world,byTop);}
    if(byTop.has(top))return byTop.get(top);
    const places=new Set();let zlo=Infinity,zhi=-Infinity;
    for(const solid of world)for(const v of solid){places.add(v.place);const h=modelHeight(model,top,v.z);if(h<zlo)zlo=h;if(h>zhi)zhi=h;}
    const of=new Map(),xy=[...places].map(p=>{const r=TR.inverse(target.latitude,target.longitude,p.latitude,p.longitude),q=[r.km*1000*Math.sin(r.azimuth*R),r.km*1000*Math.cos(r.azimuth*R)];of.set(q,p);return q;});
    const hull=convexHull(xy),out=hull.length&&Number.isFinite(zlo)&&Number.isFinite(zhi)?{hull,places:hull.map(q=>of.get(q)),zlo,zhi,radius:xy.reduce((m,q)=>Math.max(m,Math.hypot(q[0],q[1])),0)}:null;
    if(byTop.size>=8)byTop.clear();byTop.set(top,out);return out;
  }
  const boxOf=(az,ref,lo,hi,near)=>{
    let a0=Infinity,a1=-Infinity;for(const a of az){const d=azDiff(a,ref);if(d<a0)a0=d;if(d>a1)a1=d;}
    const w=(a1-a0)/2,bulge=(w*Math.PI/90)**2/16*180/Math.PI;
    return {c:ref+(a0+a1)/2,w:w+.002,lo:lo-bulge-.002,hi:hi+bulge+.002,nearKm:near};
  };
  // Every direction prepareDailyView measures against for this observer, as an azimuth/altitude box
  // {c,w,lo,hi} (exact spherical bounds plus the great-circle bulge of the outline's edges), with the
  // distance to its nearest point. Null where it cannot be bounded cheaply (the caller then computes).
  function outlineBounds(observer,target,opts={}){
    const g=geometryFrom(observer,target,opts);if(!g)return null;
    const eyeM=opts.eyeM??1.5,heightM=opts.heightM??null,eye=(observer.elevation??0)+eyeM;
    const CMs=global.AstroNotesCityModels||AstroNotesAlign.CITY_MODELS,TMs=global.AstroNotesTowerModels||AstroNotesAlign.TOWER_MODELS;
    const model=target.id==="tower-terror"?TERROR_MODEL:target.id==="tinkerbell"&&TINKERBELL_MODEL?TINKERBELL_MODEL:target.id==="cinderella"?CASTLE_MODEL:target.id==="tocho-building"?TOCHO_MODEL:CMs?.[target.id]||TMs?.[target.id]||null;
    if(!model){
      const outline=target.rim?null:towerOutline(observer,target,{eyeM,heightM});
      if(!outline)return boxOf([g.azimuth],g.azimuth,g.angle,g.angle,g.distanceKm);
      const pts=(outline.hitPolygons||[outline.hitPoints||outline.points]).flat().filter(p=>p&&Number.isFinite(p[0])&&Number.isFinite(p[1]));
      if(!pts.length)return null;
      return boxOf([g.azimuth,...pts.map(p=>p[0])],g.azimuth,Math.min(g.angle,...pts.map(p=>p[1])),Math.max(g.angle,...pts.map(p=>p[1])),Math.max(0,g.distanceKm-.05));
    }
    const ground=target.groundM??0,top=heightM??((partOf(target,"tip")||target.parts[0]).m-ground);
    if(!(top>.5))return boxOf([g.azimuth],g.azimuth,g.angle,g.angle,g.distanceKm);
    const fp=modelFootprint(target,model,top);if(!fp)return null;
    const rel=TR.inverse(target.latitude,target.longitude,observer.latitude,observer.longitude),ox=rel.km*1000*Math.sin(rel.azimuth*R),oy=rel.km*1000*Math.cos(rel.azimuth*R);
    // Inside or next to the building: no cheap bound.
    if(rel.km*1000<=fp.radius+50)return null;
    let inside=false,dmin=Infinity;const h=fp.hull;
    for(let i=0,j=h.length-1;i<h.length;j=i++){
      const p=h[j],q=h[i];if((p[1]>oy)!==(q[1]>oy)&&ox<(q[0]-p[0])*(oy-p[1])/(q[1]-p[1])+p[0])inside=!inside;
      const dx=q[0]-p[0],dy=q[1]-p[1],len=dx*dx+dy*dy,t=len?Math.max(0,Math.min(1,((ox-p[0])*dx+(oy-p[1])*dy)/len)):0;dmin=Math.min(dmin,Math.hypot(ox-p[0]-t*dx,oy-p[1]-t*dy));
    }
    if(inside||h.length<3)return null;
    const rays=fp.places.map(p=>TR.inverse(observer.latitude,observer.longitude,p.latitude,p.longitude));
    // Plane geometry around the target versus the geodesic: a relative 1e-4 and 1 m cover it.
    const dLo=Math.max(.001,Math.min(dmin/1000,...rays.map(r=>r.km))*(1-1e-4)-.001),dHi=Math.max(...rays.map(r=>r.km))*(1+1e-4)+.001;
    const hLo=ground+fp.zlo,hHi=ground+fp.zhi;
    // The elevation angle rises with the target height; along the distance it has at most one
    // maximum (a target below the eye), so its minimum is at an end and its maximum is found here.
    let lo=Math.min(targetAngle(dLo,eye,hLo),targetAngle(dHi,eye,hLo)),hi=Math.max(targetAngle(dLo,eye,hHi),targetAngle(dHi,eye,hHi));
    {let x=dLo,y=dHi;for(let k=0;k<60;k++){const m1=x+(y-x)/3,m2=y-(y-x)/3;if(targetAngle(m1,eye,hHi)<targetAngle(m2,eye,hHi))x=m1;else y=m2;}hi=Math.max(hi,targetAngle((x+y)/2,eye,hHi)+1e-9);}
    return boxOf([g.azimuth,...rays.map(r=>r.azimuth)],g.azimuth,Math.min(lo,g.angle),Math.max(hi,g.angle),dLo);
  }
`;
 one('  const AstroNotesAlign = { heightVertices,',bounds+'  const AstroNotesAlign = { heightVertices,');
 one('towerOutline, viewWindow,','towerOutline, outlineBounds, viewWindow,');
 return source;
}
// Fresh weather the device has loaded (ground samples and line-of-sight columns), by observer.
// 探す runs places away from these in the calculation workers, which hold no weather.
export function patchAtmosphereSources(source){
 const from='global.AstroNotesAtmosphere={';
 if(source.split(from).length!==2)throw Error('Atmosphere sources boundary changed');
 return source.replace(from,`function sources(){const now=Date.now(),out=[];for(const r of records.values())if(r.rows&&now-r.loadedAt<HOUR)out.push({...r.observer});for(const r of lines.values())if(r.times&&now-r.loadedAt<HOUR)out.push({...r.observer});return out;}
  global.AstroNotesAtmosphere={sources,`);
}
