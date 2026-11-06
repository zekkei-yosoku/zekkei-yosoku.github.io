// Trial-only policy for "重ねる対象": the display set stays the existing main
// target plus scene extras; the overlap scope is either one member (the
// existing single main target) or all members. "All" is the union of the
// members' occupied silhouettes seen from one observer: a body overlaps it
// exactly when it overlaps at least one member. Each member is judged by the
// existing exact solver in its own projection, then combined with OR. No
// bounding box or centroid of the group is ever used, so gaps between members
// are not overlaps. An unknown member keeps the union unknown unless another
// member is positively overlapped.
export function createOverlapPolicy(){
 const DAY=86400000,JST=32400000;
 const unique=ids=>[...new Set((ids||[]).filter(id=>typeof id==='string'&&id))];
 function members(mainId,extraIds){return mainId?unique([mainId,...(extraIds||[])]):[];}
 function scope(state,ids){const n=unique(ids).length;return n<2?'single':state?.all===true?'all':'one';}
 // Keep the chosen overlap target while it remains displayed. A removed target
 // falls back explicitly to the first remaining one (map-placed custom first).
 function chooseMain(ids,previous){ids=unique(ids);if(!ids.length)return {main:'',fallback:false};if(previous&&ids.includes(previous))return {main:previous,fallback:false};return {main:ids[0],fallback:!!previous&&ids.length>1};}
 function combine(values){
  // true: some member overlaps. false: every member is known not to. null: unknown.
  let unknown=false;for(const v of values){if(v===true)return true;if(v!==false)unknown=true;}
  return unknown||!values.length?null:false;
 }
 function unionAt(rows){return {intersects:combine(rows.map(r=>r==null?null:typeof r.intersects==='boolean'?r.intersects:null)),distanceToTarget:Math.min(...rows.map(r=>Number.isFinite(r?.distanceToTarget)?r.distanceToTarget:Infinity)),member:rows.findIndex(r=>r?.intersects===true)};}
 const jstDay=at=>Math.floor((at+JST)/DAY);
 // Candidate days: day d is a union day iff it is a day of some member. The
 // first `limit` union days are contained in the union of each member's first
 // `limit` days over the same horizon, so per-member limited scans suffice.
 function mergeDays(results,limit=4){
  const byDay=new Map();
  results.forEach((res,i)=>{for(const row of res.rows||[]){if(!Number.isFinite(row?.at))continue;const d=jstDay(row.at),old=byDay.get(d);if(!old||row.at<old.at)byDay.set(d,{...row,overlapMember:i});}});
  return [...byDay.values()].sort((a,b)=>a.at-b.at).slice(0,limit);
 }
 function scannedUntil(results,rows,limit=4){
  if(results.some(r=>!Number.isFinite(r.scanned)))return null;
  if(rows.length>=limit)return (jstDay(rows[rows.length-1].at)+1)*DAY-JST;
  const values=results.map(r=>r.scanned).filter(Number.isFinite);return values.length?Math.min(...values):null;
 }
 const rowKey=row=>JSON.stringify([row.place?.sourcePlaceId??row.place?.id??null,row.place?.latitude,row.place?.longitude,row.assumedObserver?.eyeM??row.place?.standAglM??null,Math.round((row.event?.at??NaN)/1000)]);
 function retag(row,i,anchor){return {...row,overlapMember:i,event:{...row.event,matchMode:'overlap',partId:anchor.partId,limb:'center',overlapTargetId:row.event?.overlapTargetId??null}};}
 // Registered-place rows: every member event is a union event. Duplicates of
 // the same place and second collapse; failures and cancellation propagate.
 function mergeRows(results,anchor,ids=[]){
  if(results.some(r=>r?.cancelled))return {cancelled:true};
  const seen=new Set(),rows=[];let failed=0;
  results.forEach((res,i)=>{failed+=res?.failed||0;for(const row of res?.rows||[]){const tagged=retag(row,i,anchor);tagged.event.overlapTargetId=ids[i]??null;const k=rowKey(tagged);if(seen.has(k))continue;seen.add(k);rows.push(tagged);}});
  rows.sort((a,b)=>a.event.at-b.event.at);return {rows,failed};
 }
 // Generic point evaluation: positive if any member recommends; otherwise the
 // weakest negative (unknown beats a definite negative, blocked beats frame).
 const NEGATIVE=['unknown','model-blocked','outside-frame','no-overlap','excluded'];
 function mergeEvaluations(results,anchor,ids=[]){
  const positives=[],seen=new Set();let partial=false;
  results.forEach((res,i)=>{partial=partial||!!res?.partial;for(const row of res?.recommend?[res,...(res.additionalCandidates||[])]:[]){if(!row.recommend)continue;const tagged=retag(row,i,anchor);tagged.event.overlapTargetId=ids[i]??null;delete tagged.additionalCandidates;if(seen.has(tagged.id))continue;seen.add(tagged.id);positives.push(tagged);}});
  if(positives.length)return {...positives[0],additionalCandidates:positives.slice(1),partial};
  const statuses=results.map(r=>NEGATIVE.includes(r?.status)?r.status:'unknown'),status=NEGATIVE.find(s=>statuses.includes(s))||'unknown';
  return {status,recommend:false,partial,reason:results.find(r=>r?.status===status)?.reason||(status==='unknown'?'overlap-member-unknown':undefined)};
 }
 function mergeSeeds(results){return {seeds:results.flatMap(r=>r?.seeds||[]),partial:results.some(r=>r?.partial!==false),reason:results.find(r=>r?.reason)?.reason};}
 function wholePart(target,isMountain){return isMountain(target)?null:'__whole';}
 // Share/plan extension. Members are identified by id and position; a
 // recipient must resolve every member or the plan opens as the single anchor.
 function payloadExt(list){return {v:1,scope:'all',members:list.map(t=>({id:String(t.id),name:String(t.name||''),latitude:t.latitude,longitude:t.longitude}))};}
 function parseExt(ov){
  if(!ov||ov.v!==1||ov.scope!=='all'||!Array.isArray(ov.members)||ov.members.length<2||ov.members.length>16)return null;
  if(!ov.members.every(m=>m&&typeof m.id==='string'&&m.id.length<=80&&typeof m.name==='string'&&m.name.length<=100&&!/[\u0000-\u001f]/.test(m.name)&&Number.isFinite(m.latitude)&&Math.abs(m.latitude)<=90&&Number.isFinite(m.longitude)&&Math.abs(m.longitude)<=180))return null;
  if(new Set(ov.members.map(m=>m.id)).size!==ov.members.length)return null;
  return ov.members;
 }
 function resolveMembers(ext,list){
  const out=[];for(const m of ext){const t=list.find(x=>x.id===m.id&&Number.isFinite(x.latitude)&&Math.abs(x.latitude-m.latitude)<1e-4&&Math.abs(x.longitude-m.longitude)<1e-4&&(x.parts||[]).length);if(!t)return null;out.push(t);}return out;
 }
 return {members,scope,chooseMain,combine,unionAt,mergeDays,scannedUntil,mergeRows,mergeEvaluations,mergeSeeds,wholePart,payloadExt,parseExt,resolveMembers,jstDay};
}
