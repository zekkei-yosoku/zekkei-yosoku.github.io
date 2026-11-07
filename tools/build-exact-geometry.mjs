const patch=(s,from,to)=>{
 if(s.split(from).length!==2)throw Error('Exact geometry boundary changed: '+from.slice(0,120));
 return s.replace(from,to);
};

// distanceKm() and bearing() each solve the same Vincenty inverse problem.
// Consume the two fields from one unchanged inverse() call instead. Geometry,
// ellipsoid, convergence, fallback, vertex order and projection stay identical.
export function patchExactGeometry(s){
 s=patch(s,`    const distanceKm = TR.distanceKm(observer.latitude, observer.longitude, target.latitude, target.longitude);
    return {
      distanceKm,
      azimuth: TR.bearing(observer.latitude, observer.longitude, target.latitude, target.longitude),`,
 `    const {km:distanceKm,azimuth} = TR.inverse(observer.latitude, observer.longitude, target.latitude, target.longitude);
    return {
      distanceKm,
      azimuth,`);
 s=patch(s,`    const d0 = TR.distanceKm(obs.latitude, obs.longitude, rim.latitude, rim.longitude);
    const az0 = TR.bearing(obs.latitude, obs.longitude, rim.latitude, rim.longitude);`,
 `    const {km:d0,azimuth:az0} = TR.inverse(obs.latitude, obs.longitude, rim.latitude, rim.longitude);`);
 s=patch(s,`      const d = TR.distanceKm(obs.latitude, obs.longitude, p.latitude, p.longitude);
      return { rel: azDiff(TR.bearing(obs.latitude, obs.longitude, p.latitude, p.longitude), az0),`,
 `      const {km:d,azimuth} = TR.inverse(obs.latitude, obs.longitude, p.latitude, p.longitude);
      return { rel: azDiff(azimuth, az0),`);
 s=patch(s,`    const d=TR.distanceKm(observer.latitude,observer.longitude,target.latitude,target.longitude);
    const az0=TR.bearing(observer.latitude,observer.longitude,target.latitude,target.longitude),eye=(observer.elevation??0)+eyeM;`,
 `    const {km:d,azimuth:az0}=TR.inverse(observer.latitude,observer.longitude,target.latitude,target.longitude),eye=(observer.elevation??0)+eyeM;`);
 s=patch(s,'let g=sight.get(place);if(!g){g={d:TR.distanceKm(observer.latitude,observer.longitude,place.latitude,place.longitude),az:TR.bearing(observer.latitude,observer.longitude,place.latitude,place.longitude)};sight.set(place,g);}',
 'let g=sight.get(place);if(!g){const ray=TR.inverse(observer.latitude,observer.longitude,place.latitude,place.longitude);g={d:ray.km,az:ray.azimuth};sight.set(place,g);}');
 s=patch(s,`    const d = TR.distanceKm(observer.latitude, observer.longitude, target.latitude, target.longitude);
    const az0 = TR.bearing(observer.latitude, observer.longitude, target.latitude, target.longitude);`,
 `    const {km:d,azimuth:az0} = TR.inverse(observer.latitude, observer.longitude, target.latitude, target.longitude);`);
 return s;
}
