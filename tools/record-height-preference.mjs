// Refine a verified representative toward the selected target/limb centre.
// This never turns an unfinished search into zero or calls a tested point a global optimum.
export async function preferRecordHeight({min,max,seed,evaluate,isCurrent=()=>true,limit=18,clock=()=>Date.now(),deadline=Infinity}){
 const lo=Math.round(min*10),hi=Math.round(max*10),memo=new Map(),valid=r=>r?.rows?.length&&Number.isFinite(r.residual),tick=h=>Math.max(lo,Math.min(hi,Math.round(h*10)));let best=seed,checked=0,incomplete=false;
 const improve=r=>{if(valid(r)&&(!valid(best)||Math.abs(r.residual)<Math.abs(best.residual)-1e-12||Math.abs(Math.abs(r.residual)-Math.abs(best.residual))<=1e-12&&r.height<best.height))best=r;};
 if(!Number.isFinite(seed?.residual))return {...seed,fit:'unavailable',fitChecked:0};
 memo.set(tick(seed.height),seed);improve(seed);
 const at=async k=>{if(!isCurrent())throw Error('height-cancelled');if(memo.has(k))return memo.get(k);if(checked>=limit||clock()>deadline){incomplete=true;return null;}checked++;const r=await evaluate(k/10);if(!isCurrent())throw Error('height-cancelled');memo.set(k,r);improve(r);return r;};
 await at(lo);await at(hi);await at(Math.floor((lo+hi)/2));
 const initial=[...memo.values()].filter(r=>Number.isFinite(r?.residual)).sort((a,b)=>a.height-b.height),sameSide=initial.length>=3&&initial.every(r=>r.residual>0)||initial.length>=3&&initial.every(r=>r.residual<0),deltas=initial.slice(1).map((r,i)=>r.residual-initial[i].residual),ordered=deltas.every(d=>d>=-1e-12)||deltas.every(d=>d<=1e-12);
 // These are measured fit choices, not negative/existence certificates.
 if(sameSide&&ordered&&(tick(best.height)===lo||tick(best.height)===hi))return {...best,fit:'range-edge',fitChecked:checked,fitIncomplete:incomplete};

 // A sign-changing bracket is refined to adjacent 0.1m ticks. Other intervals
 // stay eligible: discontinuous apparent limbs can make the closest tested fit differ.
 const visited=new Set();
 for(;;){
  const items=[...memo].filter(([,r])=>Number.isFinite(r?.residual)).sort((a,b)=>a[0]-b[0]),bands=[];
  for(let i=1;i<items.length;i++){const [a,A]=items[i-1],[b,B]=items[i];if(b-a<=1)continue;const k=a+':'+b;if(visited.has(k))continue;bands.push({a,b,k,sign:A.residual*B.residual<=0,score:Math.min(Math.abs(A.residual),Math.abs(B.residual))});}
  if(!bands.length||incomplete)break;
  bands.sort((a,b)=>Number(b.sign)-Number(a.sign)||a.score-b.score||(b.b-b.a)-(a.b-a.a));const band=bands[0];
  // Once a crossing has adjacent grid samples, prefer their actual verified rows.
  if(!band.sign&&items.some(([a,A],i)=>i&&a-items[i-1][0]<=1&&A.residual*items[i-1][1].residual<=0))break;
  visited.add(band.k);if(!await at(Math.floor((band.a+band.b)/2)))break;
 }
 const edge=tick(best.height)===lo||tick(best.height)===hi,fit=Number.isFinite(best.residual)&&Math.abs(best.residual)<=.01?'centered':edge?'range-edge':'closest-tested';
 return {...best,fit,fitChecked:checked,fitIncomplete:incomplete};
}
