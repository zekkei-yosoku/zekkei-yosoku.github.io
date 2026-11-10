'use strict';
// Runs the server's geometric overlap engine in a same-origin frame. The
// frame has its own atmosphere/terrain globals, so switching it to the
// no-refraction model never changes what the app's own screens compute.
(()=>{
 const origin=location.origin,channel='astronotes-overlap';
 let tail=Promise.resolve();
 addEventListener('message',event=>{
  const message=event.data;
  if(event.origin!==origin||event.source!==parent||message?.type!==channel||!Number.isSafeInteger(message.id))return;
  tail=tail.then(async()=>{
   try{
    if(message.op!=='solve'&&message.op!=='discover')throw Error('unknown operation');
    const result=await globalThis.__overlap[message.op](message.input);
    parent.postMessage({type:channel,id:message.id,result},origin);
   }catch(error){parent.postMessage({type:channel,id:message.id,error:String(error?.message||error)},origin);}
  });
 });
 parent.postMessage({type:channel,ready:typeof globalThis.__overlap?.solve==='function',engine:document.documentElement.dataset.engine||null},origin);
})();
