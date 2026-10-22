/* Trial: shared home portraits at the resolution needed by calendars and framing. */
(function(g){
'use strict';
const frames=new Map(),MAX=64,queue=[],watching=new WeakMap();let active=0;
function prune(){for(let i=queue.length-1;i>=0;i--){const e=queue[i].entry;if(frames.get(e.key)!==e||(e.observed&&!e.waiters.size)){queue.splice(i,1);if(frames.get(e.key)===e)frames.delete(e.key);}}}
function watch(entry,fn){if(!fn)return;const old=watching.get(fn);if(old&&old!==entry)old.waiters.delete(fn);watching.set(fn,entry);entry.waiters.add(fn);prune();}
function pump(){if(active||!queue.length)return;const job=queue.shift(),e=job.entry;if(frames.get(e.key)!==e||(e.observed&&!e.waiters.size)){if(frames.get(e.key)===e)frames.delete(e.key);setTimeout(pump,0);return;}active=1;job.run().finally(()=>{active=0;setTimeout(pump,0);});}
let sunPromise=null;
const sizeFor=n=>[32,40,64,128,256,512].find(s=>s>=n)||512;
const canvas=size=>{const c=document.createElement('canvas');c.width=c.height=size;return c;};
function fallback(c,body,state){
 const size=c.width,ctx=c.getContext('2d');
 if(body==='moon'){
  const base=new Uint8ClampedArray(size*size*4);
  for(let i=0;i<base.length;i+=4){base[i]=209;base[i+1]=208;base[i+2]=202;base[i+3]=255;}
  const image=ctx.createImageData(size,size);image.data.set(g.SoramiMoonPortrait.shade(base,size,state.illuminatedFraction,state.brightLimbZenithAngle));ctx.putImageData(image,0,0);
 }else{ctx.fillStyle='#ffcf5a';ctx.beginPath();ctx.arc(size/2,size/2,size/2,0,Math.PI*2);ctx.fill();}
}
function sun(){
 if(!sunPromise){const c=canvas(g.SoramiSunPortrait.SIZE);sunPromise=g.SoramiSunPortrait.draw(c,{detached:true}).then(result=>({canvas:c,...result})).catch(e=>{sunPromise=null;throw e;});}
 return sunPromise;
}
function request(body,state,pixels=64,onReady){
 if(body!=='moon'&&body!=='sun')return null;
 const size=sizeFor(Math.max(16,pixels)),key=body+':'+size+(body==='moon'?':'+[
  state.illuminatedFraction.toFixed(6),state.brightLimbZenithAngle.toFixed(2),
  state.parallacticAngle||0,state.librationLongitude||0,state.librationLatitude||0,state.axisPositionAngle||0
 ].join(','):'');
 let entry=frames.get(key);
 if(entry&&entry.status==='fallback'&&Date.now()>=entry.retryAt){frames.delete(key);entry=null;if(body==='sun')sunPromise=null;}
 if(entry){frames.delete(key);frames.set(key,entry);watch(entry,onReady);if(entry.status!=='loading'&&onReady)entry.waiters.delete(onReady);return entry;}
 entry={key,canvas:canvas(size),status:'loading',waiters:new Set(),observed:!!onReady};
 watch(entry,onReady);
 fallback(entry.canvas,body,state);frames.set(key,entry);while(frames.size>MAX)frames.delete(frames.keys().next().value);
 queue.push({entry,run:()=>{
 const work=canvas(size);
 const task=body==='moon'?g.SoramiMoonPortrait.draw(work,state,{size,detached:true}):sun().then(result=>{
  // Crop to the physical disc, removing the home illustration's decorative corona.
  const p=g.SoramiSunPortrait,edge=p.SIZE*(.5-p.DISC),diameter=p.SIZE*2*p.DISC;
  const ctx=work.getContext('2d');ctx.save();ctx.beginPath();ctx.arc(size/2,size/2,size/2,0,Math.PI*2);ctx.clip();
  ctx.drawImage(result.canvas,edge,edge,diameter,diameter,0,0,size,size);ctx.restore();return result;
 });
 return task.then(result=>{if(result.stale)throw Error('Stale portrait');const ctx=entry.canvas.getContext('2d');ctx.clearRect(0,0,size,size);ctx.drawImage(work,0,0);entry.status=result.texture?'texture':'fallback';entry.retryAt=Date.now()+15000;})
 .catch(()=>{entry.status='fallback';entry.retryAt=Date.now()+15000;})
 .finally(()=>{const waiting=[...entry.waiters];entry.waiters.clear();for(const f of waiting)if(watching.get(f)===entry)f();});
 }});prune();pump();
 return entry;
}
g.SoramiBodyPortrait={request,stats:()=>({entries:frames.size,loading:[...frames.values()].filter(x=>x.status==='loading').length,max:MAX,active,queued:queue.length})};
})(typeof globalThis==='undefined'?window:globalThis);
