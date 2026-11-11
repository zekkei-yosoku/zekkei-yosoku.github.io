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
    if(message.op!=='solve'&&message.op!=='discover'&&message.op!=='days')throw Error('unknown operation');
   // A saved target can carry its PLATEAU shape (cityModel); the engine reads models by target id.
   (function register(x,depth,seen){if(!x||typeof x!=='object'||depth>5||seen.has(x))return;seen.add(x);if(typeof x.id==='string'&&x.cityModel&&String(x.cityModel.id||'').startsWith('plateau-'))(globalThis.AstroNotesCityModels||(globalThis.AstroNotesCityModels={}))[x.id]=x.cityModel;for(const k in x)register(x[k],depth+1,seen);})(message.input,0,new Set());
    const result=await globalThis.__overlap[message.op](message.input);
    parent.postMessage({type:channel,id:message.id,result},origin);
   }catch(error){parent.postMessage({type:channel,id:message.id,error:String(error?.message||error)},origin);}
  });
 });
 parent.postMessage({type:channel,ready:typeof globalThis.__overlap?.solve==='function',engine:document.documentElement.dataset.engine||null},origin);
})();
