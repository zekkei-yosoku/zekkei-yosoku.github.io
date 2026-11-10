const OVERLAP_ENGINE='362cd222d31a8795a1a34ab89568c19fbe91b3c4c29e5be81dfca04b16913cad',OVERLAP_SOURCE='overlap-calculation-worker-engine.js?v=3eec2cacd0ef2072';
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
    if(message.op!=='solve'&&message.op!=='discover'&&message.op!=='days')throw Error('unknown operation');
   // A saved target can carry its PLATEAU shape (cityModel); the engine reads models by target id.
   (function register(x,depth,seen){if(!x||typeof x!=='object'||depth>5||seen.has(x))return;seen.add(x);if(typeof x.id==='string'&&x.cityModel&&String(x.cityModel.id||'').startsWith('plateau-'))(globalThis.AstroNotesCityModels||(globalThis.AstroNotesCityModels={}))[x.id]=x.cityModel;for(const k in x)register(x[k],depth+1,seen);})(message.input,0,new Set());
    postMessage({type:channel,id:message.id,result:await globalThis.__overlap[message.op](message.input)});
   }catch(error){postMessage({type:channel,id:message.id,error:String(error?.message||error)});}
  });
 });
 postMessage({type:channel,ready,engine:ready?OVERLAP_ENGINE:null});
})();
