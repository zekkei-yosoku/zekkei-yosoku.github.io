// Search a finite 0.1m height grid. Only a conservative caller certificate can prune a band.
// A verified representative is sufficient for this place/target/day; an unfinished negative is not zero.
export async function scanRecordHeights({min,max,evaluate,mayOverlap=async()=>null,isCurrent=()=>true,limit=48}){
 const lo=Math.round(min*10),hi=Math.round(max*10);if(!Number.isFinite(min)||!Number.isFinite(max)||lo<0||hi>7000||lo>=hi||Math.abs(lo-min*10)>1e-7||Math.abs(hi-max*10)>1e-7)throw Error('height-invalid');
 const memo=new Map();let checked=0;
 const at=async tick=>{if(!isCurrent())throw Error('height-cancelled');if(memo.has(tick))return memo.get(tick);if(checked>=limit)throw Error('height-limit');checked++;const result=await evaluate(tick/10);if(!isCurrent())throw Error('height-cancelled');memo.set(tick,result);return result;};
 const accepted=r=>Array.isArray(r?.rows)&&r.rows.length>0;
 const a=await at(lo);if(accepted(a))return {...a,checked};const b=await at(hi);if(accepted(b))return {...b,checked};
 const queue=[{lo,hi,a,b}];let incomplete=false;
 while(queue.length){
  if(!isCurrent())throw Error('height-cancelled');const item=queue.shift();if(item.hi-item.lo<=1)continue;
  const possible=await mayOverlap(item.lo/10,item.hi/10);if(!isCurrent())throw Error('height-cancelled');if(possible===false)continue;
  const mid=Math.floor((item.lo+item.hi)/2);let m;
  try{m=await at(mid);}catch(error){if(error.message==='height-limit'){incomplete=true;break;}throw error;}
  if(accepted(m))return {...m,checked};
  const children=[{lo:item.lo,hi:mid,a:item.a,b:m},{lo:mid,hi:item.hi,a:m,b:item.b}];
  queue.push(...children);queue.sort((x,y)=>Math.min(x.a?.score??Infinity,x.b?.score??Infinity)-Math.min(y.a?.score??Infinity,y.b?.score??Infinity)||(y.hi-y.lo)-(x.hi-x.lo));
 }
 return {rows:[],checked,failed:incomplete?1:0,...(incomplete?{issues:[{reason:'height-limit'}]}:{})};
}
