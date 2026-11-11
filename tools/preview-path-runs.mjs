// Which runs of the body's path the 見え方 keeps for a day. The page carries these two functions verbatim
// (src/features/framing/scene/render.js); test-baked-policies.mjs fails when the copies differ.
// The path for this day must remain visible before its candidate time is selected.
export function visibleDayRuns(path,runs,win,day){
 const crosses=(a,b)=>{
  if(a.x===null||b.x===null||![a.x,a.y,b.x,b.y].every(Number.isFinite)||b.at<day||a.at>=day+86400000)return false;
  const dx=b.x-a.x,dy=b.y-a.y;let lo=0,hi=1;
  for(const [p,q]of [[-dx,a.x+win.halfW],[dx,win.halfW-a.x],[-dy,a.y+win.halfH],[dy,win.halfH-a.y]]){
   if(p===0){if(q<0)return false;continue;}
   const ratio=q/p;if(p<0)lo=Math.max(lo,ratio);else hi=Math.min(hi,ratio);if(lo>hi)return false;
  }
  return true;
 };
 return runs.filter(([start,end])=>{for(let i=start+1;i<=end;i++)if(crosses(path[i-1],path[i]))return true;return false;});
}
export function nearestPathRun(path,runs,at){let best=null,gap=Infinity;for(const run of runs){const a=path[run[0]].at,b=path[run[1]].at,d=at<a?a-at:at>b?at-b:0;if(d<gap){gap=d;best=run;}}return best;}
