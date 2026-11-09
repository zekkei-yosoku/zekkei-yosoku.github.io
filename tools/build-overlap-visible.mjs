// 2026-11-09 Trial only: around each crossing (and the nearest approach) prepareDailyView picked the sample
// nearest the target and judged the overlap there alone. When the disc touched the target while its upper
// limb was still above the horizon but sat deeper only after it had set, that visible contact was lost.
// A sample that overlaps now wins over one that does not; among equals the nearer one wins as before.
export function patchVisibleBest(source){
 const patch=(s,from,to)=>{if(s.split(from).length!==2)throw Error('Visible best boundary changed: '+from.slice(0,60));return s.replace(from,()=>to);};
 source=patch(source,'  function prepareDailyView(observer, target, body, opts = {}) {','  const visibleBetter = (e, b) => e.intersects !== b.intersects ? e.intersects : e.distanceToTarget < b.distanceToTarget;\n  function prepareDailyView(observer, target, body, opts = {}) {');
 source=patch(source,'if (at < end && (!nearest || row.distanceToTarget < nearest.distanceToTarget)) nearest = row;','if (at < end && (!nearest || visibleBetter(row, nearest))) nearest = row;');
 source=patch(source,'if (e.distanceToTarget < best.distanceToTarget) best = e;','if (visibleBetter(e, best)) best = e;');
 source=patch(source,'const e = evaluate(at); if (e.distanceToTarget < nearest.distanceToTarget) nearest = e;','const e = evaluate(at); if (visibleBetter(e, nearest)) nearest = e;');
 return patch(source,'else if(nearest.distanceToTarget<crossings[i].distanceToTarget||(nearest.distanceToTarget===crossings[i].distanceToTarget&&nearest.at<crossings[i].at))crossings[i]=nearest;','else if(visibleBetter(nearest,crossings[i])||(nearest.intersects===crossings[i].intersects&&nearest.distanceToTarget===crossings[i].distanceToTarget&&nearest.at<crossings[i].at))crossings[i]=nearest;');
}
