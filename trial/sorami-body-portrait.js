/* Shared UI moon thumbnails; never the framing canvas. */
(function(g){
'use strict';
const frames=new Map(),MAX=64,queue=[],watching=new WeakMap();let active=0;
function prune(){for(let i=queue.length-1;i>=0;i--){const e=queue[i].entry;if(frames.get(e.key)!==e||(e.observed&&!e.waiters.size)){queue.splice(i,1);if(frames.get(e.key)===e)frames.delete(e.key);}}}
function watch(entry,fn){if(!fn)return;const old=watching.get(fn);if(old&&old!==entry)old.waiters.delete(fn);watching.set(fn,entry);entry.waiters.add(fn);prune();}
function pump(){if(active||!queue.length)return;const job=queue.shift(),e=job.entry;if(frames.get(e.key)!==e||(e.observed&&!e.waiters.size)){if(frames.get(e.key)===e)frames.delete(e.key);setTimeout(pump,0);return;}active=1;job.run().finally(()=>{active=0;setTimeout(pump,0);});}
const canvas=size=>{const c=document.createElement('canvas');c.width=c.height=size;return c;};
function fallback(c,state){
 const size=c.width,ctx=c.getContext('2d'),base=new Uint8ClampedArray(size*size*4);
 for(let i=0;i<base.length;i+=4){base[i]=209;base[i+1]=208;base[i+2]=202;base[i+3]=255;}
 const image=ctx.createImageData(size,size);image.data.set(g.SoramiMoonPortrait.shade(base,size,state.illuminatedFraction,state.brightLimbZenithAngle));ctx.putImageData(image,0,0);
}
function request(state,onReady){
 const size=40,key=[
  state.illuminatedFraction.toFixed(6),state.brightLimbZenithAngle.toFixed(2),
  state.parallacticAngle||0,state.librationLongitude||0,state.librationLatitude||0,state.axisPositionAngle||0
 ].join(',');
 let entry=frames.get(key);
 if(entry&&entry.status==='fallback'&&Date.now()>=entry.retryAt){frames.delete(key);entry=null;}
 if(entry){frames.delete(key);frames.set(key,entry);watch(entry,onReady);if(entry.status!=='loading'&&onReady)entry.waiters.delete(onReady);return entry;}
 entry={key,canvas:canvas(size),status:'loading',waiters:new Set(),observed:!!onReady};
 watch(entry,onReady);
 fallback(entry.canvas,state);frames.set(key,entry);while(frames.size>MAX)frames.delete(frames.keys().next().value);
 queue.push({entry,run:()=>{
 const work=canvas(size);
 const task=g.SoramiMoonPortrait.draw(work,state,{size,detached:true});
 return task.then(result=>{if(result.stale)throw Error('Stale portrait');const ctx=entry.canvas.getContext('2d');ctx.clearRect(0,0,size,size);ctx.drawImage(work,0,0);entry.status=result.texture?'texture':'fallback';entry.retryAt=Date.now()+15000;})
 .catch(()=>{entry.status='fallback';entry.retryAt=Date.now()+15000;})
 .finally(()=>{const waiting=[...entry.waiters];entry.waiters.clear();for(const f of waiting)if(watching.get(f)===entry)f();});
 }});prune();pump();
 return entry;
}
// Hydrate only generated numeric state, never arbitrary user text.
const fields=['illuminatedFraction','brightLimbZenithAngle','parallacticAngle','librationLongitude','librationLatitude','axisPositionAngle'];
function imageURL(e){if(e.urlStatus!==e.status){e.url=e.canvas.toDataURL();e.urlStatus=e.status;}return e.url;}
function markup(state){
 const values=fields.map(k=>Number.isFinite(state[k])?state[k]:0),e=request(state);
 return '<img class="astro-icon moon-portrait" width="40" height="40" alt="月・輝面'+Math.round(values[0]*100)+'%" data-moon-state="'+values.join(',')+'" src="'+imageURL(e)+'">';
}
function hydrate(el){
 if(el._moonState===el.dataset.moonState)return;
 const key=el.dataset.moonState,values=key.split(',').map(Number);
 if(values.length!==fields.length||!values.every(Number.isFinite)||values[0]<0||values[0]>1)return;
 el._moonState=key;const state=Object.fromEntries(fields.map((k,i)=>[k,values[i]]));
 const paint=()=>{if(!el.isConnected||el.dataset.moonState!==key)return;const e=request(state,paint);el.src=imageURL(e);el.dataset.portraitStatus=e.status;};paint();
}
function scan(node){if(node.nodeType!==1)return;if(node.matches('img[data-moon-state]'))hydrate(node);for(const el of node.querySelectorAll('img[data-moon-state]'))hydrate(el);}
if(typeof MutationObserver!=='undefined'){
 const observer=new MutationObserver(records=>{for(const r of records){if(r.type==='attributes')hydrate(r.target);else for(const n of r.addedNodes)scan(n);}});
 observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['data-moon-state']});scan(document.documentElement);
}
g.SoramiCalendarMoon={request,markup,stats:()=>({entries:frames.size,loading:[...frames.values()].filter(x=>x.status==='loading').length,max:MAX,active,queued:queue.length})};
})(typeof globalThis==='undefined'?window:globalThis);
