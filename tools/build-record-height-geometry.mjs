// Pure source patches for the trial copy only. Codex applies them in the generator; root files stay untouched.
// They expose read-only geometry needed to certify that a height band cannot overlap. They change no result.
const patch=(s,from,to)=>{if(s.split(from).length!==2)throw Error('Record height geometry boundary changed: '+from.slice(0,80));return s.replace(from,to);};

// Align: every world vertex of a model (not only hull vertices), the outline used by prepareDailyView,
// and the projector centre/azimuth of a prepared daily view.
export function patchAlignHeightGeometry(s){
 s=patch(s,'    return {points,polygons,basePoints,hitPolygons,','    return {vertices:world.flat().map(project),vertexPolygons:world.map(face=>face.map(project)),points,polygons,basePoints,hitPolygons,');
 s=patch(s,'    return (dayMs, at = null) => {\n    if(Number.isFinite(at))return [complete(evaluate(at))];','    const run = (dayMs, at = null) => {\n    if(Number.isFinite(at))return [complete(evaluate(at))];');
 s=patch(s,'    return crossings.sort((a, b) => a.at - b.at).map(complete);\n    };\n  }\n  function dailyView(','    return crossings.sort((a, b) => a.at - b.at).map(complete);\n    };\n    run.heightGeometry=Object.freeze({azimuth:g.azimuth,angle:g.angle,centerAlt,ridge:!!mountainRidge,ridgeBase:mountainRidge?ridgeBase:null,outline:!!outline,partId:opts.partId??null,heightM:opts.heightM??null,eyeM:opts.eyeM??1.5});\n    return run;\n  }\n  function dailyView(');
 s=patch(s,'  const AstroNotesAlign = { TARGETS,',`  // Raw directions that bound the outline prepareDailyView projects for this observer and eye height.
  function heightVertices(observer, target, opts = {}) {
    const outline = towerOutline(observer, target, opts);
    if (!outline) { const g = geometryFrom(observer, target, opts); return g ? { vertices: [[g.azimuth, g.angle]], outline: false } : null; }
    const vertices = outline.vertices || [...(outline.points || []), ...(outline.hitPoints || []), ...(outline.hitPolygons || []).flat()];
    return { vertices, polygons:outline.vertexPolygons||outline.hitPolygons||[outline.points], outline: true };
  }
  const AstroNotesAlign = { heightVertices, TARGETS,`);
 return s;
}

// Atmosphere: a sound enclosure of the refraction apply() can return for true altitudes [xLo,xHi],
// times [msLo,msHi] and eye elevations [h0Lo,h0Hi] (above sea level). Returns null when it cannot bound
// (traced sight-line weather may apply, atmosphere disabled, invalid air).
export function patchAtmosphereHeightBounds(s){
 return patch(s,'  global.AstroNotesAtmosphere={dataKey,',`  // Fallback air of at() in auto mode without a weather sample (keep identical to at()).
  const fallbackAir=z=>{z=Math.max(-500,Math.min(10000,z));const temperatureC=15-.0065*z;return {pressureHPa:1013.25*Math.pow((temperatureC+273.15)/288.15,9.80665/(287.05*.0065)),temperatureC};};
  function refractionBounds(q){
    const {xLo,xHi,h0Lo,h0Hi}=q||{},msLo=q?.msLo??q?.ms,msHi=q?.msHi??q?.ms,observers=q?.observers||[];
    if(![xLo,xHi,h0Lo,h0Hi,msLo,msHi].every(Number.isFinite)||xLo>xHi||h0Lo>h0Hi||msLo>msHi||!observers.length)return null;
    if(!enabled)return null;
    if(mode==='none')return {lo:0,hi:0};
    const now=Date.now(),near2=(p,o)=>{const dy=(o.latitude-p.latitude)*111.2,dx=(o.longitude-p.longitude)*111.2*Math.cos(p.latitude*R);return Math.hypot(dx,dy)<=2;};
    const overlaps=(e)=>e-250<=h0Hi&&e+250>=h0Lo;
    if(mode==='auto'&&RF&&lines.size){
      for(const rec of lines.values()){
        if(!rec.times||now-rec.loadedAt>=HOUR)continue;
        if(msHi<rec.times[0]||msLo>rec.times[rec.times.length-1])continue;
        if(Number.isFinite(q.azMid)&&Number.isFinite(q.azHalf)&&Math.max(0,Math.abs((q.azMid-rec.azimuth+540)%360-180)-q.azHalf)>20)continue;
        if(!overlaps(rec.observer.elevation??0)||!observers.some(o=>near2(rec.observer,o)))continue;
        const eHi=A.targetElevationAngle(rec.distanceKm,h0Lo,rec.target.topM,{k:7/6}),eLo=A.targetElevationAngle(rec.distanceKm,h0Hi,rec.target.topM,{k:7/6});
        if(xHi<eLo-3||xLo>eHi+6)continue;
        return null;
      }
    }
    // Break points where the air source, the low-altitude table or its weight changes with eye elevation.
    const knots=new Set([h0Lo,h0Hi]),add=v=>{if(v>h0Lo&&v<h0Hi)knots.add(v);};
    add(100);add(200);for(let k=Math.ceil((h0Lo-25)/50);k*50+25<h0Hi;k++)add(k*50+25);
    const sources=[];
    if(mode==='auto'){
      for(const r of records.values())if(r.rows&&now-r.loadedAt<HOUR&&observers.some(o=>near2(r.observer,o))){add((r.observer.elevation??0)-250);add((r.observer.elevation??0)+250);sources.push(r);}
      for(const r of lines.values())if(r.times&&now-r.loadedAt<HOUR){
        r.surface||(r.surface={observer:{...r.observer,elevation:r.grounds[0]},source:r.source,rows:r.times.map((at,i)=>({at,pressureHPa:r.hourly[0].surface_pressure[i],temperatureC:r.hourly[0].temperature_2m[i]}))});
        if(observers.some(o=>near2(r.surface.observer,o))){add((r.surface.observer.elevation??0)-250);add((r.surface.observer.elevation??0)+250);sources.push(r.surface);}
      }
    }
    const times=[msLo,msHi];for(let t=Math.ceil(msLo/HOUR)*HOUR;t<msHi;t+=HOUR)times.push(t);
    const airs=z=>{
      if(mode==='manual')return [{...manual}];
      if(mode==='standard')return [standardAir(z)];
      const out=[fallbackAir(z)];
      for(const r of sources){
        const used=r.rows.filter(v=>v.at>=msLo-HOUR*1.01&&v.at<=msHi+HOUR*1.01&&valid(v.pressureHPa,v.temperatureC));if(!used.length)continue;
        const pLo=Math.min(...used.map(v=>v.pressureHPa)),pHi=Math.max(...used.map(v=>v.pressureHPa)),tLo=Math.min(...used.map(v=>v.temperatureC)),tHi=Math.max(...used.map(v=>v.temperatureC)),dz=z-(r.observer.elevation??0),scale=[tLo,tHi].map(t=>Math.exp(-9.80665*dz/(287.05*(t+273.15)))),lo=pLo*Math.min(...scale),hi=pHi*Math.max(...scale);
        if(hi>=200&&lo<=1100)for(const t of [tLo,tHi])for(const p of [Math.max(200,lo),Math.min(1100,hi)])out.push({pressureHPa:p,temperatureC:t});
      }
      return out;
    };
    const corr=(x,air)=>correction(x,air);
    const list=[...knots].sort((a,b)=>a-b);let lo=Infinity,hi=-Infinity;
    try{
      for(let i=0;i+1<list.length||i===0&&list.length===1;i++){
        const u=list[i],v=list[Math.min(i+1,list.length-1)],eps=v>u?Math.min(1e-6,(v-u)/4):0,ua=u+eps,va=v-eps,mid=(u+v)/2;
        const air=[...airs(ua),...airs(va)];
        const pMin=Math.min(...air.map(a=>a.pressureHPa)),pMax=Math.max(...air.map(a=>a.pressureHPa)),tMin=Math.min(...air.map(a=>a.temperatureC)),tMax=Math.max(...air.map(a=>a.temperatureC));
        const thin={pressureHPa:pMin,temperatureC:tMax},dense={pressureHPa:pMax,temperatureC:tMin};
        // correction() rises on [-2,-1] and falls above -1, so its minimum is at an end and its maximum at clamp(-1).
        const peak=Math.min(Math.max(-1,xLo),xHi),bLo=Math.min(corr(xLo,thin),corr(xHi,thin)),bHi=corr(peak,dense);
        let rLo=bLo,rHi=bHi;
        if(RF&&va>100&&xLo<2){
          const t=lowTable(mid);
          if(t){
            const xs=[xLo,Math.min(xHi,2),...t.tru.filter(x=>x>xLo&&x<Math.min(xHi,2))],vals=xs.map(x=>t.at(x)),tvLo=Math.min(...vals),tvHi=Math.max(...vals);
            const sdA=standardAir(ua),sdB=standardAir(va),sdpMin=Math.min(sdA.pressureHPa,sdB.pressureHPa),sdpMax=Math.max(sdA.pressureHPa,sdB.pressureHPa),sdtMin=Math.min(sdA.temperatureC,sdB.temperatureC),sdtMax=Math.max(sdA.temperatureC,sdB.temperatureC);
            const sMin=pMin/sdpMax*(sdtMin+273.15)/(tMax+273.15),sMax=pMax/sdpMin*(sdtMax+273.15)/(tMin+273.15);
            const ts=[tvLo*sMin,tvLo*sMax,tvHi*sMin,tvHi*sMax],tsLo=Math.min(...ts),tsHi=Math.max(...ts);
            const wh=z=>Math.max(0,Math.min(1,(z-100)/100)),fx=x=>x<=0?1:Math.max(0,1-x/2);
            const wLo=wh(ua)*fx(Math.min(xHi,2)),wHi=wh(va)*fx(xLo);
            const c=[];for(const b of [bLo,bHi])for(const ts of [tsLo,tsHi])for(const w of [wLo,wHi])c.push(b+(ts-b)*w);
            rLo=Math.min(...c);rHi=Math.max(...c);
          }
        }
        lo=Math.min(lo,rLo);hi=Math.max(hi,rHi);
        if(list.length===1)break;
      }
    }catch{return null;}
    return Number.isFinite(lo)&&Number.isFinite(hi)?{lo:lo-1e-6,hi:hi+1e-6}:null;
  }
  global.AstroNotesAtmosphere={refractionBounds,dataKey,`);
}
