const OVERLAP_ENGINE='995697a055323df25c5ad943aaee95aa8d4ed046a4afe2bd82794007530a9bc3',OVERLAP_SOURCE='overlap-calculation-worker-engine.js?v=153181613a7f9425';
// Runs the same geometric overlap engine as overlap-calculation.html, but in a
// dedicated worker so several pairs are checked at once on separate cores.
// build-preview.py prepends OVERLAP_ENGINE (SHA-256) and OVERLAP_SOURCE.
(()=>{
 'use strict';
 const channel='astronotes-overlap',noop=()=>{};
 // The engine touches the DOM only to decode terrain tiles on a canvas and to
 // load the planet library. Both have worker equivalents. Its terrain sampler
 // also requires Image to exist before it reads tiles at all.
 if(typeof document==='undefined'){
  const canvas=()=>{
   const element=new OffscreenCanvas(1,1),context=element.getContext.bind(element);
   element.getContext=(type,options)=>{
    const ctx=context(type,options);
    if(ctx&&!ctx.__astronotesImage){const draw=ctx.drawImage.bind(ctx);ctx.drawImage=(image,...rest)=>draw(image?.__bitmap||image,...rest);ctx.__astronotesImage=true;}
    return ctx;
   };
   return element;
  };
  globalThis.document={
   hidden:false,visibilityState:'visible',
   documentElement:{dataset:{engine:OVERLAP_ENGINE}},
   head:{append(script){try{importScripts(script.src);script.onload?.();}catch(error){script.onerror?.(error);}}},
   createElement(tag){
    if(tag==='canvas')return canvas();
    if(tag==='script')return {src:'',onload:null,onerror:null,remove:noop};
    throw Error('unsupported element '+tag);
   },
   addEventListener:noop,removeEventListener:noop,
  };
 }
 if(typeof Image==='undefined'){
  globalThis.Image=class{
   constructor(){this.crossOrigin=null;this.onload=null;this.onerror=null;this.width=0;this.height=0;this.__bitmap=null;this.__src='';}
   get src(){return this.__src;}
   set src(url){
    this.__src=url;
    fetch(url,{mode:'cors'}).then(response=>{if(!response.ok)throw Error(String(response.status));return response.blob();}).then(blob=>createImageBitmap(blob))
     .then(bitmap=>{if(this.__src!==url){bitmap.close?.();return;}this.__bitmap=bitmap;this.width=bitmap.width;this.height=bitmap.height;this.onload?.();})
     .catch(()=>{if(this.__src===url)this.onerror?.();});
   }
  };
 }
 let ready=false;
 try{importScripts(OVERLAP_SOURCE);ready=typeof globalThis.__overlap?.solve==='function';}catch{ready=false;}
 let tail=Promise.resolve();
 addEventListener('message',event=>{
  const message=event.data;
  if(message?.type!==channel||!Number.isSafeInteger(message.id))return;
  tail=tail.then(async()=>{
   try{
    if(message.op!=='solve')throw Error('unknown operation');
    postMessage({type:channel,id:message.id,result:await globalThis.__overlap.solve(message.input)});
   }catch(error){postMessage({type:channel,id:message.id,error:String(error?.message||error)});}
  });
 });
 postMessage({type:channel,ready,engine:ready?OVERLAP_ENGINE:null});
})();
