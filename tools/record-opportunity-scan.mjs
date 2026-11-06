// Cooperative day-first scan. Publish a day only after every registered pair
// has been checked, so already visible rows do not move under the user's finger.
export function createOpportunityScan({pairs,start,end,notBefore=start,solve,isCurrent,clock=Date.now,onProgress=()=>{},onDay=()=>{},yieldTask=()=>new Promise(r=>setTimeout(r,0))}){
 const state={day:start,index:0,checked:0,total:Math.ceil((end-start)/86400000)*pairs.length,through:start,rows:[],pending:[],failures:[],done:false,running:false,paused:false,cancelled:false};
 const seen=new Set();
 async function advance(budgetMs=8000){
  if(state.running||state.done||state.cancelled)return state;
  state.running=true;state.paused=false;const began=clock();
  try{
   if(!pairs.length){state.done=true;state.through=end;onDay(state);return state;}
   while(state.day<end){
    if(!isCurrent()){state.cancelled=true;return state;}
    const pair=pairs[state.index];let result;
    try{result=await solve(pair,state.day,isCurrent);}catch(error){if(!isCurrent()){state.cancelled=true;return state;}result={rows:[],failed:1};}
    if(!isCurrent()||result?.cancelled){state.cancelled=true;return state;}
    if(result?.failed)state.failures.push({pairId:pair.id,day:state.day});
    for(const row of result?.rows||[]){
     const at=row.event?.at;
     if(!Number.isFinite(at)||at<Math.max(state.day,notBefore)||at>=Math.min(end,state.day+86400000))continue;
     const id=JSON.stringify([pair.id,at,row.place?.latitude,row.place?.longitude,row.place?.groundManualM,row.place?.eyeHeightAGL]);
     if(seen.has(id))continue;seen.add(id);state.pending.push({...row,id,pairId:pair.id,body:pair.body,target:pair.target,sourcePlaceId:pair.sourcePlaceId});
    }
    state.checked++;state.index++;
    if(state.index===pairs.length){
     state.pending.sort((a,b)=>a.event.at-b.event.at||a.place.name.localeCompare(b.place.name,'ja')||a.target.name.localeCompare(b.target.name,'ja'));
     state.rows.push(...state.pending);state.pending=[];state.day+=86400000;state.index=0;state.through=state.day;onDay(state);
    }
    onProgress(state);
    if(state.day>=end){state.done=true;return state;}
    await yieldTask();
    if(!isCurrent()){state.cancelled=true;return state;}
    if(clock()-began>=budgetMs){state.paused=true;return state;}
   }
   state.done=true;return state;
  }finally{state.running=false;}
 }
 return {state,advance};
}
