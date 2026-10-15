/* Optional shape data: one request per asset, shared across screen generations. */
(function(global){
 'use strict';
 function createLoader({manifest,integrity={},document=global.document,setTimer=global.setTimeout,clearTimer=global.clearTimeout,timeout=60000,ready}={}){
  const pending=new Map();
  function load(name){
   if(ready(name))return Promise.resolve();
   if(pending.has(name))return pending.get(name);
   const src=manifest[name];
   if(typeof src!=='string'||!/^sorami-(city|tower)-models\.js\?v=\d+$/.test(src))return Promise.reject(Error('Unknown shape asset'));
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
 const ready=name=>name==='sorami-city-models.js'?!!global.SoramiCityModels:!!global.SoramiTowerModels;
 const manifest=global.document?Object.fromEntries(['city','tower'].map(kind=>['sorami-'+kind+'-models.js',global.document.querySelector('meta[name="shape-'+kind+'"]').content])):{};
 const integrity=global.document?Object.fromEntries(['city','tower'].map(kind=>['sorami-'+kind+'-models.js',global.document.querySelector('meta[name="shape-'+kind+'-integrity"]').content])):{};
 const loader=createLoader({manifest,integrity,ready});
 const names=['sorami-city-models.js','sorami-tower-models.js'];
 const api={createLoader,modelsReady:()=>names.every(ready),ensureModels:()=>Promise.all(names.map(loader.load))};
 global.SoramiAssets=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);
