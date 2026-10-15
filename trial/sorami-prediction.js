/* Private forecast evaluations; local astronomical drawing stays synchronous. */
(function(global){
 'use strict';
 const IDS=['sunset','sunrise','starrySky','seaOfClouds','cityCloudSea','rainbow','rime','diamondDust'];
 const BASE='https://zekkei-api.okayu-sorami.workers.dev/prediction';
 const VERSION='e189-core-8e6930c-v4';
 const TTL=30*60*1000,CACHE='sorami-predictions-v1';
 const conditions=p=>({latitude:p.latitude,longitude:p.longitude,elevation:p.elevation??null,eyeHeightAGL:p.eyeHeightAGL??1.5,terrain:p.terrain??null});
 const key=p=>JSON.stringify(conditions(p));
 const day=(ms,offset)=>Math.floor((ms+offset*1000)/86400000)*86400000-offset*1000;
 function validate(dto,place){
  if(!dto||dto.schemaVersion!==1||dto.algorithmVersion!==VERSION||!dto.place||key(dto.place)!==key(place)||!Number.isFinite(dto.asOf)||!Number.isFinite(dto.bundle?.fetchedAt)||!Number.isFinite(dto.bundle?.utcOffsetSeconds)||Math.abs(dto.bundle.utcOffsetSeconds)>86400||!dto.bundle.home?.byModel||!dto.weeks)throw Error('予測データを確認できません');
  for(const id of IDS){const rows=dto.weeks[id];if(!Array.isArray(rows)||rows.length>14)throw Error('予測データを確認できません');for(const row of rows){const e=row?.evaluation;if(!Number.isFinite(row?.dayMs)||!e||!Number.isFinite(e.score)||e.score<0||e.score>100||(e.unavailable?typeof e.unavailable.kind!=='string':(!e.rank||!['spectacular','good','fair','poor'].includes(e.rank.key)))||!Array.isArray(e.factors)||e.factors.length>50)throw Error('予測データを確認できません');}}
  return dto;
 }
 function fresh(dto,place,now){try{validate(dto,place);return now>=dto.asOf&&now-dto.asOf<TTL&&now>=dto.bundle.fetchedAt&&now-dto.bundle.fetchedAt<TTL&&day(now,dto.bundle.utcOffsetSeconds)===day(dto.asOf,dto.bundle.utcOffsetSeconds);}catch{return false;}}
 function restore(value,S){
  if(!value||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(x=>restore(x,S));
  if(Array.isArray(value.times)&&value.columns&&typeof value.columns==='object')return new S.Series(value.times,value.columns);
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,restore(v,S)]));
 }
 function createClient({endpoint=BASE,transport=global.fetch,cacheStorage=global.caches,now=Date.now,makeInput=conditions,verify=validate,identityOf=key,cacheName=CACHE+'-main',maxEntries=4}={}){
  const pending=new Map(),completed=new Map();
  async function request(place){
   const input=makeInput(place),identity=await identityOf(input),hit=completed.get(identity);
   const isFresh=async dto=>{try{await verify(dto,input);return now()>=dto.asOf&&now()-dto.asOf<TTL&&now()>=dto.bundle.fetchedAt&&now()-dto.bundle.fetchedAt<TTL&&day(now(),dto.bundle.utcOffsetSeconds)===day(dto.asOf,dto.bundle.utcOffsetSeconds)&&(!dto.retryAt||now()<dto.retryAt);}catch{return false;}};
   if(hit&&await isFresh(hit)){completed.delete(identity);completed.set(identity,hit);return hit;}
   if(pending.has(identity))return pending.get(identity);
   const job=(async()=>{
    let cache;const cacheURL=endpoint+'?conditions='+encodeURIComponent(identity);
    try{cache=await cacheStorage?.open(cacheName);const saved=await cache?.match(cacheURL);if(saved){const dto=await saved.json();if(await isFresh(dto)){completed.set(identity,dto);while(completed.size>maxEntries)completed.delete(completed.keys().next().value);return dto;}}}catch{cache=null;}
    let dto; const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
    try {
     const response=await transport(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:controller.signal});
     if(!response.ok)throw Error('予測を取得できませんでした');
     dto=await verify(await response.json(),input);
    } finally { clearTimeout(timer); }
    completed.set(identity,dto);
    while(completed.size>maxEntries)completed.delete(completed.keys().next().value);
    if(cache)try{await cache.put(cacheURL,new Response(JSON.stringify(dto),{headers:{'content-type':'application/json'}}));
     const keys=await cache.keys();for(const req of keys.slice(0,Math.max(0,keys.length-maxEntries)))await cache.delete(req);
    }catch{/* Cache availability never blocks this result. */}
    return dto;
   })();pending.set(identity,job);
   try{return await job;}finally{if(pending.get(identity)===job)pending.delete(identity);}
  }
  return {request};
 }
 const slimProfile=p=>p?.map(x=>({azimuth:x.azimuth,horizonAngleDeg:x.horizonAngleDeg}))??null;
 function visibilityInput({kind,place,observer,terrain,urban,geometry,dayMs}){
  const o=observer,g=geometry;
  return {kind,place:conditions(place),observer:{latitude:o.latitude,longitude:o.longitude,groundM:o.groundM,eyeHeightAGL:o.eyeHeightAGL,locationScope:o.locationScope,elevation:o.groundM+o.eyeHeightAGL},terrain:kind.startsWith('moon')?slimProfile(terrain):null,urban:kind.startsWith('moon')?slimProfile(urban):null,geometry:kind==='fuji'?{available:g.available,classification:g.classification,fraction:g.fraction,distanceKm:g.distanceKm,apparentSize:g.apparentSize?{widthDeg:g.apparentSize.widthDeg,heightDeg:g.apparentSize.heightDeg,deg:g.apparentSize.deg,moonDiameters:g.apparentSize.moonDiameters,key:g.apparentSize.key,label:g.apparentSize.label}:null}:null,dayMs:kind==='moonDetail'?dayMs:null};
 }
 const hashVisibility=async input=>'visibility:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input))))).map(n=>n.toString(16).padStart(2,'0')).join('');
 async function validateVisibility(dto,input){
  if(!dto||dto.schemaVersion!==1||dto.algorithmVersion!==VERSION||key(dto.place)!==key(input.place)||!Number.isFinite(dto.asOf)||!Number.isFinite(dto.bundle?.fetchedAt)||!Number.isFinite(dto.bundle?.utcOffsetSeconds)||!dto.weeks||!Array.isArray(dto.days)||dto.days.length>14||typeof dto.visibilityKey!=='string')throw Error('可視予測を確認できません');
  const ids=input.kind==='moon'?['moon']:input.kind==='moonDetail'?[]:['fuji',...(dto.weeks.capCloud?['capCloud']:[])];
  for(const id of ids){const rows=dto.weeks[id];if(!Array.isArray(rows)||rows.length>14)throw Error('可視予測を確認できません');for(const row of rows){const e=row?.evaluation;if(!Number.isFinite(row?.dayMs)||!e||!Number.isFinite(e.score)||e.score<0||e.score>100||!Array.isArray(e.factors))throw Error('可視予測を確認できません');}}
  if(dto.visibilityKey!==await hashVisibility(input))throw Error('観測条件が一致しません');
  if(input.kind==='moonDetail'&&(!Array.isArray(dto.moonVisibility)||dto.moonVisibility.length!==1||dto.moonVisibility[0].dayMs!==input.dayMs))throw Error('月の可視予測を確認できません');
  return dto;
 }
 const client=createClient();
 const visibilityClient=createClient({endpoint:BASE+'/visibility',makeInput:visibilityInput,identityOf:hashVisibility,verify:validateVisibility,cacheName:CACHE+'-visibility',maxEntries:64});
 const API={IDS,VERSION,createClient,validate,fresh,restore,visibilityInput,hashVisibility,validateVisibility,async visibility(input){const normalized=visibilityInput(input),dto=await visibilityClient.request(input);if(dto.visibilityKey!==await hashVisibility(normalized))throw Error('観測条件が一致しません');return dto;},async fetch(place,S=global.Sorami){const dto=await client.request(place);return {...dto,bundle:restore(dto.bundle,S)};}};
 global.SoramiPrediction=API;
 if(typeof module!=='undefined'&&module.exports)module.exports=API;
})(typeof globalThis!=='undefined'?globalThis:window);
