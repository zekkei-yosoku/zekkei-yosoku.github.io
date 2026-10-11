/* Fixed-observer celestial map. Direction rings are angular diagrams, not ground distances. */
(function(g){
'use strict';
const DAY=86400000, cache=new Map();
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
const api={dayStart,context,daily,delta};g.SoramiSkyMap=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
