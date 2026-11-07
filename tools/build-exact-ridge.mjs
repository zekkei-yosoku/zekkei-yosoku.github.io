import {readFileSync} from 'node:fs';
const patch=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Exact ridge boundary changed: '+a.slice(0,100));return s.replace(a,b);};

// Lift the azimuth-dependent preparation out of the unchanged Vincenty direct
// solver. The iteration, convergence, fallback and final arithmetic stay intact.
export function patchExactRidgeTerrain(s){
 const start=s.indexOf('  function destination(lat, lon, bearingDeg, distanceKm) {'),end=s.indexOf('  /// 2点間の方位角',start);
 if(start<0||end<start)throw Error('Exact ridge destination boundary changed');
 let direct=s.slice(start,end).trimEnd();
 direct=patch(direct,'function destination(lat, lon, bearingDeg, distanceKm)','function prepareRidgeDestination(lat, lon, bearingDeg)');
 direct=patch(direct,'const a1 = bearingDeg * DEG, s = distanceKm * 1000, sa1 = Math.sin(a1), ca1 = Math.cos(a1);','const a1 = bearingDeg * DEG, sa1 = Math.sin(a1), ca1 = Math.cos(a1);');
 direct=patch(direct,'    let sig = s / (WGS_B * A_), cos2sm, sinS, cosS;', '    return distanceKm => {\n    const s = distanceKm * 1000;\n    let sig = s / (WGS_B * A_), cos2sm, sinS, cosS;');
 if(!direct.endsWith('  }'))throw Error('Exact ridge destination end changed');
 direct=direct.slice(0,-3)+'    };\n  }';
 // Check the authoritative formula before lifting its distance-dependent terms.
 const astro=readFileSync(new URL('../astronotes-astro.js',import.meta.url),'utf8');
 const original=`  function targetElevationAngle(distanceKm, observerHeightM, targetHeightM, { k = REFRACTION_K } = {}) {
    const R = EARTH_R_KM * k;
    const ro = R + observerHeightM / 1000;
    const rt = R + targetHeightM / 1000;
    const theta = distanceKm / R;                       // 地心角
    return Math.atan2(rt * Math.cos(theta) - ro, rt * Math.sin(theta)) / DEG;
  }`;
 if(!astro.includes(original))throw Error('Exact ridge elevation formula changed');
 const elevation=`  function prepareRidgeElevation(distanceKm, observerHeightM, { k = A.REFRACTION_K } = {}) {
    const R = A.EARTH_R_KM * k;
    const ro = R + observerHeightM / 1000;
    const theta = distanceKm / R, cosTheta = Math.cos(theta), sinTheta = Math.sin(theta);
    return targetHeightM => {
      const rt = R + targetHeightM / 1000;
      return Math.atan2(rt * cosTheta - ro, rt * sinTheta) / DEG;
    };
  }`;
 s=s.slice(0,end)+direct+'\n\n'+elevation+'\n\n'+s.slice(end);
 return patch(s,'    destination, bearing, distanceKm, inverse,','    destination, prepareRidgeDestination, prepareRidgeElevation, bearing, distanceKm, inverse,');
}

export function patchExactRidgeHtml(html){
 const start=html.indexOf('async function aimLookRidge(obs, eye, target, win) {'),end=html.indexOf('  return task;\n}',start);
 if(start<0||end<start)throw Error('Exact ridge look boundary changed');
 let s=html.slice(start,end);
 s=patch(s,'const D = AstroNotesTerrain.distanceKm(obs.latitude, obs.longitude, target.latitude, target.longitude);', 'const {km:D,azimuth:az0} = AstroNotesTerrain.inverse(obs.latitude, obs.longitude, target.latitude, target.longitude);');
 s=patch(s,'  const az0 = AstroNotesTerrain.bearing(obs.latitude, obs.longitude, target.latitude, target.longitude);\n','');
 s=patch(s,'if (aimRidgeCache.has(key+airK)) return aimRidgeCache.get(key+airK);','if (aimRidgeCache.has(key+airK)) { const cached=aimRidgeCache.get(key+airK);aimRidgeCache.delete(key+airK);aimRidgeCache.set(key+airK,cached);return cached; }');
 s=patch(s,'  const pts = [];','  const pts = [], distances = Array.from({length:n+1},(_,j)=>Math.max(0.15, D - s + (2 * s * j) / n));');
 s=patch(s,'    const az = az0 - spanAz + (2 * spanAz * i) / cols;\n    for (let j = 0; j <= n; j++) {','    const az = az0 - spanAz + (2 * spanAz * i) / cols, destination = AstroNotesTerrain.prepareRidgeDestination(obs.latitude,obs.longitude,az);\n    for (let j = 0; j <= n; j++) {');
 s=patch(s,'      const d = Math.max(0.15, D - s + (2 * s * j) / n);','      const d = distances[j];');
 // Each prepared destination is a fresh {latitude, longitude}; append the same
 // fields in the same order without cloning another object for every sample.
 s=patch(s,'pts.push({ ...AstroNotesTerrain.destination(obs.latitude, obs.longitude, az, d), az, d });','const point = destination(d); point.az = az; point.d = d; pts.push(point);');
 s=patch(s,'  const rim = AstroNotesAlign.rimOutline({ ...obs, elevation: eye }, target);','  const angles=distances.map(d=>AstroNotesTerrain.prepareRidgeElevation(d,eye,{k:airK}));\n  const rim = AstroNotesAlign.rimOutline({ ...obs, elevation: eye }, target);');
 s=patch(s,'aimAirAngle(pts[k].d, eye, el[k])','angles[j](el[k])');
 s=patch(s,'while(aimRidgeCache.size>32)','while(aimRidgeCache.size>256)');
 return html.slice(0,start)+s+html.slice(end);
}
