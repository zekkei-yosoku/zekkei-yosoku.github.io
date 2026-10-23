/* Fixed-observer celestial map. Direction rings are angular diagrams, not ground distances. */
(function(g){
'use strict';
const DAY=86400000, cache=new Map(),passCache=new WeakMap();
function dayStart(at){return Math.floor((at+32400000)/DAY)*DAY-32400000;}
function context(body,day,o,air=''){return JSON.stringify([body,day,o.latitude,o.longitude,o.elevation??0,air]);}
function daily(body,day,o,provider,air=''){
 const key=context(body,day,o,air);if(cache.has(key))return cache.get(key);
 const points=[],events=[];const height=s=>s.altitude;
 const value=at=>height(provider(body,at,o));
 for(let at=day;at<=day+DAY;at+=120000){const s=provider(body,at,o);points.push({at,azimuth:s.azimuth,altitude:s.altitude,upperAltitude:height(s)});}
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i];if(!((a.upperAltitude<0&&b.upperAltitude>=0)||(a.upperAltitude>=0&&b.upperAltitude<0)))continue;
  let lo=a.at,hi=b.at;const rising=b.upperAltitude>a.upperAltitude;
  while(hi-lo>100){const mid=(lo+hi)/2;if((value(mid)>=0)===rising)hi=mid;else lo=mid;}
  const at=(lo+hi)/2;if(at>=day+DAY)continue;
  events.push({at,side:rising?'rise':'set',azimuth:provider(body,at,o).azimuth});
 }
 const result={points,events};cache.set(key,result);if(cache.size>12)cache.delete(cache.keys().next().value);return result;
}
function delta(a,b){return ((a-b+540)%360)-180;}
// Reuse the day's trajectory and refine only intervals crossing the target bearing.
function passages(data,bearing,body,o,provider){
 if(!data||!Number.isFinite(bearing))return [];
 bearing=((bearing%360)+360)%360;let saved=passCache.get(data);if(!saved){saved=new Map();passCache.set(data,saved);}if(saved.has(bearing))return saved.get(bearing);
 const out=[],points=data.points,finish=points.at(-1)?.at;
 const add=at=>{if(at>=finish||out.some(p=>Math.abs(p.at-at)<500))return;const v=provider(body,at,o);if(!Number.isFinite(v.altitude)||v.altitude<0||Math.abs(delta(v.azimuth,bearing))>.001)return;out.push({at,altitude:v.altitude,azimuth:v.azimuth});};
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],da=delta(a.azimuth,bearing),db=delta(b.azimuth,bearing);
  if(!Number.isFinite(da)||!Number.isFinite(db))continue;
  if(Math.abs(da)<1e-10)add(a.at);
  if(da*db>=0||Math.abs(db-da)>=180)continue;
  let lo=a.at,hi=b.at,best=Math.abs(da)<Math.abs(db)?a.at:b.at,error=Math.min(Math.abs(da),Math.abs(db));
  for(let n=0;n<50;n++){const mid=lo+(hi-lo)/2;if(mid===lo||mid===hi)break;const d=delta(provider(body,mid,o).azimuth,bearing);if(Math.abs(d)<error){best=mid;error=Math.abs(d);}if(error<1e-7)break;if((d>=0)===(da>=0))lo=mid;else hi=mid;}
  add(best);
 }
 out.sort((a,b)=>a.at-b.at);saved.set(bearing,out);if(saved.size>16)saved.delete(saved.keys().next().value);return out;
}
const api={dayStart,context,daily,delta,passages};g.AstroNotesSkyMap=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

/* Legacy global names remain aliases for cached integrations. */
if(typeof AstroNotesSkyMap!=='undefined')globalThis.SoramiSkyMap=AstroNotesSkyMap;
