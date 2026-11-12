// Self-contained so the trial builder can embed the exact tested adapter.
export function createServerOpportunityScan({api,start,end,bodies,placeIds,targetIds=null,sourceRev,isCurrent,onStart=()=>{},onProgress=()=>{},onDay=()=>{},pollDelay=ms=>new Promise(r=>setTimeout(r,ms)),initialView=null}){
 const dayMs=86400000,date=at=>new Date(at+32400000).toISOString().slice(0,10),at=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))throw Error('invalid overlap day');const n=Date.parse(value+'T00:00:00+09:00');if(!Number.isFinite(n)||date(n)!==value)throw Error('invalid overlap day');return n;};
 const model='geometric-candidate-v1',state={model,day:start,end,through:start,rows:[],pending:[],failures:[],checked:0,total:0,done:false,running:false,cancelled:false,error:null,status:'preparing',viewId:null,nextCursor:null};
 let controller=new AbortController(),cursor=date(start),action='ensure',initial=initialView,generation=null,completedChecked=0;
 const seen=new Set(),settled=new Set();
 const current=()=>!state.cancelled&&!controller.signal.aborted&&isCurrent();
 const request=(method,path,body)=>api(method,path,body,controller.signal);
 function cancel(){state.cancelled=true;controller.abort();}
 async function assemble(response){
  if(!response?.transport)return response;
  const anchor=response,first=anchor.transport,invalid=()=>Error('計算結果の受信を確認できません。再試行してください。');
  if(typeof anchor.viewId!=='string'||typeof anchor.generation!=='string'||!['ready','partial'].includes(anchor.status)||!first||typeof first.id!=='string'||!/^([a-f0-9]{64})$/.test(first.id)||!Number.isInteger(first.count)||first.count<2||first.count>2048||first.index!==0)throw invalid();
  if(generation!==null&&generation!==anchor.generation)throw Object.assign(invalid(),{code:'overlap_stale'});
  const chunks=[],encoder=new TextEncoder();let bytes=0;
  for(let index=0;index<first.count;index++){
   if(!current())throw new DOMException('cancelled','AbortError');
   if(index)response=await request('GET','/overlaps?viewId='+encodeURIComponent(anchor.viewId)+'&cursor='+encodeURIComponent(cursor)+'&part='+index);
   if(!current())throw new DOMException('cancelled','AbortError');
   const part=response?.transport;
   if(response?.viewId!==anchor.viewId||response?.generation!==anchor.generation||response?.status!==anchor.status||!part||part.id!==first.id||part.index!==index||part.count!==first.count||part.nextPart!==(index+1<first.count?index+1:null)||typeof part.text!=='string')throw invalid();
   const size=encoder.encode(part.text).byteLength;bytes+=size;if(size>48*1024||bytes>64*1024*1024)throw invalid();chunks.push(part.text);
  }
  const raw=chunks.join(''),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(raw)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(!current())throw new DOMException('cancelled','AbortError');if(digest!==first.id)throw invalid();
  let page;try{page=JSON.parse(raw);}catch{throw invalid();}
  if(page?.transport||page?.viewId!==anchor.viewId||page?.generation!==anchor.generation||page?.status!==anchor.status)throw invalid();return page;
 }
 function ingest(response){
  if(!response||!['preparing','ready','partial','failed'].includes(response.status)||typeof response.viewId!=='string'||!Array.isArray(response.days)||response.days.length>7)throw Error('invalid overlap response');
  if(response.model!==model)throw Object.assign(Error('一覧の計算条件が更新されました。再試行してください。'),{code:'overlap_model_mismatch'});
  if(generation!==null&&generation!==response.generation)throw Object.assign(Error('結果の条件が変わりました。再試行してください。'),{code:'overlap_stale'});
  generation=response.generation;state.viewId=response.viewId;state.status=response.status;state.nextCursor=response.nextCursor??null;
  if(response.status==='failed')throw Object.assign(Error(response.error?.message||'計算の準備を完了できませんでした。再試行してください。'),{code:response.error?.code||'overlap_plan_failed'});
  let through=state.through;const accepted=[];
  for(const day of response.days){
   const stamp=at(day.day);if(stamp<start||stamp>=end||settled.has(day.day))continue;
   if(stamp!==through)throw Error('overlap days are not contiguous');
   // The API exposes only settled days. complete=false means unknown pairs,
   // not an unfinished day; keep these visible with an explicit warning.
   if(!Array.isArray(day.rows)||!Number.isFinite(day.unknownPairs)||!Number.isFinite(day.checkedPairs))throw Error('invalid overlap coverage');
   const rows=day.rows.map(row=>{if(!Number.isFinite(row.event?.at)||row.event.at<stamp||row.event.at>=stamp+dayMs||!row.place||!row.target||!bodies.includes(row.body)||(placeIds&&!placeIds.includes(row.sourcePlaceId)))throw Error('invalid overlap row');
   return {...row,id:row.id||JSON.stringify([row.pairId,row.event.at,row.place.latitude,row.place.longitude,row.place.groundManualM,row.place.eyeHeightAGL])};
   // The API filters by place only; the chosen targets are kept here.
   }).filter(row=>!targetIds||targetIds.includes(row.target.id)).sort((a,b)=>a.event.at-b.event.at||String(a.place.name).localeCompare(String(b.place.name),'ja')||String(a.target.name).localeCompare(String(b.target.name),'ja'));
   accepted.push({day,stamp,rows});through=stamp+dayMs;
  }
  if(response.days.length){
   const boundary=at(response.coverage?.attemptedThroughExclusive);
   if(boundary!==through||response.nextCursor!==date(through))throw Error('invalid overlap cursor');
   // Validate the entire page before publishing any of its rows.
   for(const {day,stamp,rows}of accepted){for(const row of rows){if(seen.has(row.id))continue;seen.add(row.id);state.rows.push(row);}if(day.unknownPairs)state.failures.push({day:stamp,count:day.unknownPairs});settled.add(day.day);}
   completedChecked+=accepted.reduce((n,d)=>n+d.day.checkedPairs,0);state.checked=completedChecked;state.through=state.day=through;
   state.done=true;state.end=through;state.total=state.checked;onDay(state);
  }else{state.checked=completedChecked+(Number(response.coverage?.checkedPairs)||0);state.total=Math.max(state.checked,completedChecked+(Number(response.coverage?.totalPairs)||0));}
  onProgress(state);
 }
 async function advance(){
  if(state.running||state.done||!current())return state;
  state.running=true;state.error=null;
  try{
   onStart(state);
   while(current()){
    let response;
    if(initial){response=initial;initial=null;}
    else if(action==='ensure')response=await request('POST','/overlaps/ensure',{environment:'trial',startDay:date(start),bodies,placeIds,sourceRev});
    else if(action==='extend')response=await request('POST','/overlaps/extend',{viewId:state.viewId,cursor});
    else if(action==='retry')response=await request('POST','/overlaps/retry',{viewId:state.viewId});
    else response=await request('GET','/overlaps?viewId='+encodeURIComponent(state.viewId)+'&cursor='+encodeURIComponent(cursor));
    if(!current()){cancel();return state;}
    response=await assemble(response);if(!current()){cancel();return state;}
    ingest(response);action='poll';if(state.done)return state;
    // Cancellation releases the waiter immediately even if a custom clock is used.
    await new Promise(resolve=>{const finish=()=>{controller.signal.removeEventListener('abort',finish);resolve();};controller.signal.addEventListener('abort',finish,{once:true});Promise.resolve(pollDelay(Math.max(250,Math.min(10000,response.retryAfterMs||2000)))).then(finish,finish);});
   }
  }catch(error){if(!current()){cancel();return state;}state.error=error;state.done=true;state.status='error';}
  finally{state.running=false;}
  return state;
 }
 function extend(nextEnd){if(!state.done||state.running||state.error||state.cancelled||!state.nextCursor||nextEnd<=state.through)return false;cursor=state.nextCursor;state.end=nextEnd;end=nextEnd;state.done=false;action='extend';return true;}
 function retry(){if(state.running||state.cancelled)return false;state.rows=[];state.failures=[];state.checked=0;completedChecked=0;state.through=state.day=start;state.end=end=Math.max(end,start+7*dayMs);state.error=null;state.done=false;seen.clear();settled.clear();cursor=date(start);
 generation=null;action=state.viewId?'retry':'ensure';return true;}
 return {state,advance,extend,retry,cancel};
}
