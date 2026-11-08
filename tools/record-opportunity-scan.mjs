// Cooperative day-first scan. Publish a day only after every registered pair
// has been checked, so already visible rows do not move under the user's finger.
export function createOpportunityScan({pairs,start,end,notBefore=start,pageRows=Infinity,solve,isCurrent,onStart=()=>{},onProgress=()=>{},onDay=()=>{},yieldTask=()=>new Promise(r=>setTimeout(r,0))}){
 const dayMs=86400000;
 const state={day:start,end,rowLimit:pageRows,index:0,checked:0,total:Math.ceil((end-start)/dayMs)*pairs.length,through:start,rows:[],pending:[],failures:[],done:false,running:false,cancelled:false};
 const seen=new Set();
 async function advance(){
  if(state.running||state.done||state.cancelled)return state;
  state.running=true;
  try{
   onStart(state);
   if(!pairs.length){state.done=true;state.through=state.end;onDay(state);return state;}
   while(state.day<state.end){
    if(!isCurrent()){state.cancelled=true;return state;}
    const pair=pairs[state.index];let result;
    try{result=await solve(pair,state.day,isCurrent);}catch(error){if(!isCurrent()){state.cancelled=true;return state;}result={rows:[],failed:1};}
    if(!isCurrent()||result?.cancelled){state.cancelled=true;return state;}
    if(result?.failed)state.failures.push({pairId:pair.id,day:state.day});
    for(const row of result?.rows||[]){
     const at=row.event?.at;
     if(!Number.isFinite(at)||at<Math.max(state.day,notBefore)||at>=Math.min(state.end,state.day+dayMs))continue;
     const id=JSON.stringify([pair.id,at,row.place?.latitude,row.place?.longitude,row.place?.groundManualM,row.place?.eyeHeightAGL]);
     if(seen.has(id))continue;seen.add(id);state.pending.push({...row,id,pairId:pair.id,body:pair.body,target:pair.target,sourcePlaceId:pair.sourcePlaceId});
    }
    state.checked++;state.index++;
    if(state.index===pairs.length){
     state.pending.sort((a,b)=>a.event.at-b.event.at||a.place.name.localeCompare(b.place.name,'ja')||a.target.name.localeCompare(b.target.name,'ja'));
     state.rows.push(...state.pending);state.pending=[];state.day+=dayMs;state.index=0;state.through=state.day;
     if(state.rows.length>=state.rowLimit){state.end=Math.min(state.end,state.day);state.total=state.checked;}
     onDay(state);
    }
    onProgress(state);
    if(state.day>=state.end){state.done=true;return state;}
    await yieldTask();
    if(!isCurrent()){state.cancelled=true;return state;}
   }
   state.done=true;return state;
  }finally{state.running=false;}
 }
 function extend(end,rows=pageRows){
  if(!state.done||state.running||state.cancelled||!pairs.length||!Number.isFinite(end)||end<=state.day)return false;
  state.end=end;state.rowLimit=state.rows.length+rows;state.done=false;
  state.total=state.checked+Math.ceil((end-state.day)/dayMs)*pairs.length;
  return true;
 }
 return {state,advance,extend};
}
