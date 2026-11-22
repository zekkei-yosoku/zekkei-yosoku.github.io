/* Optional shape data: one request per asset, shared across screen generations. */
(function(global){
 'use strict';
 // A cached candidate may reintroduce this canonical loader. Keep current flights
 // and the same API when this page already understands the split surface asset.
 const previous=global.AstroNotesAssets;
 if(previous?.supportsSurfaceHulls){if(typeof module!=='undefined'&&module.exports)module.exports=previous;return;}
 function createLoader({manifest,integrity={},document=global.document,setTimer=global.setTimeout,clearTimer=global.clearTimeout,timeout=60000,ready}={}){
  const pending=new Map();
  function load(name){
   if(ready(name))return Promise.resolve();
   if(pending.has(name))return pending.get(name);
   const src=manifest[name];
   if(typeof src!=='string'||!/^astronotes-(?:(?:city|tower)-models|scene-hulls)\.js\?v=\d+$/.test(src))return Promise.reject(Error('Unknown shape asset'));
   let script,timer;
   const job=new Promise((resolve,reject)=>{
    script=document.createElement('script');let done=false;
    const finish=error=>{if(done)return;done=true;clearTimer(timer);script.onload=script.onerror=null;if(error){script.remove();reject(error);}else resolve();};
    script.src=src;script.async=true;
    if(integrity[name]){script.integrity=integrity[name];script.crossOrigin="anonymous";}
    script.onload=()=>finish(ready(name)?null:Error('Shape asset missing'));
    script.onerror=()=>finish(Error('Shape asset unavailable'));
    timer=setTimer(()=>finish(Error('Shape asset timeout')),timeout);
    document.head.append(script);
   }).finally(()=>{if(pending.get(name)===job)pending.delete(name);});
   pending.set(name,job);return job;
  }
  return {load};
 }
 const assets=[['city','astronotes-city-models.js'],['tower','astronotes-tower-models.js'],['surface','astronotes-scene-hulls.js']];
 const ready=name=>name==='astronotes-city-models.js'?!!global.AstroNotesCityModels:name==='astronotes-tower-models.js'?!!global.AstroNotesTowerModels:name==='astronotes-scene-hulls.js'?!!global.AstroNotesTrialSurfaceHulls:false;
 const meta=kind=>global.document?.querySelector('meta[name="shape-'+kind+'"]')?.content;
 // Cached HTML predates the surface meta. Its existing content version is a
 // safe cache key for the newly split asset until the HTML update arrives.
 const previousVersion=(meta('city')||meta('tower')||'').match(/\?v=(\d+)$/)?.[1];
 const manifest=Object.fromEntries(assets.map(([kind,name])=>[name,meta(kind)||(kind==='surface'&&previousVersion?name+'?v='+previousVersion:undefined)]));
 const integrity=Object.fromEntries(assets.map(([kind,name])=>[name,meta(kind+'-integrity')||'']));
 const loader=createLoader({manifest,integrity,ready});
 const names=assets.map(([,name])=>name);
 // An older loader can already be fetching city/tower data. Delegate those two
 // to it, retaining its shared flights and retry behavior, and add only surface.
 const legacyModels=typeof previous?.ensureModels==='function'?previous.ensureModels.bind(previous):null;
 const api={createLoader,supportsSurfaceHulls:true,modelsReady:()=>names.every(ready),ensureModels:()=>legacyModels?Promise.all([legacyModels(),loader.load('astronotes-scene-hulls.js')]):Promise.all(names.map(loader.load))};
 global.AstroNotesAssets=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);

/* Legacy global names remain aliases for cached integrations. */
if(typeof AstroNotesAssets!=='undefined')globalThis.SoramiAssets=AstroNotesAssets;if(typeof AstroNotesCityModels!=='undefined')globalThis.SoramiCityModels=AstroNotesCityModels;if(typeof AstroNotesTowerModels!=='undefined')globalThis.SoramiTowerModels=AstroNotesTowerModels;
