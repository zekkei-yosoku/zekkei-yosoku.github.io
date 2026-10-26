/* Date pagination over the existing registered line/area solver. No anchor shortcut. */
(function(g){
'use strict';
const DAY=86400000;
async function search(plan,entry,{from,end,limit=4,budgetMs=5000,clock=Date.now,shooting=g.AstroNotesShooting,isCurrent=()=>true,onProgress=()=>{},cache={},...deps}){
 if(!shooting?.cleanShape(entry.place?.shape)||!Number.isFinite(from)||!Number.isFinite(end)||end<=from)throw Error('shape-invalid');
 const rows=[],grounds=cache.grounds||(cache.grounds=new Map()),views=cache.views||(cache.views=new Map()),started=clock();let cursor=shooting.day(from),checked=0,partial=null;
 const key=p=>p.latitude.toFixed(9)+','+p.longitude.toFixed(9);
 const cached={...deps,isCurrent,elevationAt:async(lat,lon)=>{const k=key({latitude:lat,longitude:lon});if(grounds.has(k))return grounds.get(k);const v=await deps.elevationAt(lat,lon);if(Number.isFinite(v))grounds.set(k,v);return v;},
  ...(deps.viewFor?{viewFor:async(obs,p)=>{const k=key(obs)+','+obs.elevation+','+obs.eyeM;if(views.has(k))return views.get(k);const v=await deps.viewFor(obs,p);if(views.size>=256)views.delete(views.keys().next().value);views.set(k,v);return v;}}:{}),
  onProgress:p=>onProgress({day:cursor,checked:checked+(p.checked||0)})};
 while(cursor<end&&rows.length<limit){
  if(!isCurrent())return {cancelled:true,rows:[],searchedUntil:from};
  if(cursor>shooting.day(from)&&clock()-started>=budgetMs)break;
  const result=await shooting.candidates({...plan,at:cursor},[entry],cached);
  if(!isCurrent()||result.cancelled)return {cancelled:true,rows:[],searchedUntil:from};
  checked+=result.checked||0;
  const candidates=result.rows.filter(r=>r.event.at>=from&&r.event.at<end&&shooting.shapeContains(entry.place.shape,r.place)).sort((a,b)=>a.event.at-b.event.at);
  // One actual location per candidate day. More positions remain available in the map's daily search.
  if(candidates.length)rows.push(candidates[0]);
  if(result.failed){partial=result.issues?.[0]?.reason||'calculation';break;}
  cursor+=DAY;onProgress({day:cursor-DAY,checked,searchedUntil:cursor});
  await new Promise(r=>setTimeout(r,0));
 }
 return {rows,searchedUntil:Math.max(from,cursor),partial,checked,paused:!partial&&cursor<end&&rows.length<limit};
}
const api={search};g.AstroNotesShapePlanner=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);
