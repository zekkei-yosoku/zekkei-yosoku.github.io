// Session-local exact-result cache. A request stays alive while any caller still wants it.
export function createRecordSearchCache({limit=768,copy=structuredClone}={}){
 const results=new Map(),jobs=new Map(),cancelled=()=>({rows:[],failed:0,cancelled:true});
 const stats={hits:0,solves:0,joins:0};
 async function read(key,solve,current){
  if(!current())return cancelled();
  if(results.has(key)){const value=results.get(key);results.delete(key);results.set(key,value);stats.hits++;return copy(value);}
  let job=jobs.get(key),joined=!!job;
  if(job)stats.joins++;
  else{
   job={watchers:new Set()};jobs.set(key,job);
   const live=()=>[...job.watchers].some(w=>w());
   job.promise=Promise.resolve().then(()=>{if(!live())return cancelled();stats.solves++;return solve(live);}).then(value=>{
    if(live()&&!value.cancelled&&!value.failed&&!value.issues?.length&&value.rows.length<=256){results.set(key,copy(value));while(results.size>limit)results.delete(results.keys().next().value);}
    return value;
   }).finally(()=>{if(jobs.get(key)===job)jobs.delete(key);});
  }
  const watch=()=>current();job.watchers.add(watch);
  try{const value=await job.promise;if(!current())return cancelled();return joined&&value.cancelled?read(key,solve,current):copy(value);}
  finally{job.watchers.delete(watch);}
 }
 return {read,stats};
}
