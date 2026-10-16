/* 保存済みの事前予測。端末の予測とは別に保持し、近隣地点を同じ地点へ書き換えない。 */
(function(global){
 'use strict';
 const DAY=86400000,TTL=30*60000,IDS=['sunset','sunrise','starrySky','seaOfClouds','cityCloudSea','rainbow','rime','diamondDust'];
 const key=p=>JSON.stringify([p.latitude,p.longitude,p.elevation??null,p.eyeHeightAGL??1.5,p.terrain??null]);
 function distance(a,b){const r=Math.PI/180,h=Math.sin((b.latitude-a.latitude)*r/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin((b.longitude-a.longitude)*r/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(h)));}
 const point=p=>p&&Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180;
 function validate(dto,p,version,now){
  if(!dto||!Array.isArray(dto.rounds)||dto.rounds.length>300)throw Error('invalid rounds');
  if(dto.spot===null&&dto.rounds.length===0)return {rounds:[],reason:'近くに保存対象の地点がありません'};
  const s=dto.spot;
  if(!point(s)||typeof s.id!=='string'||typeof s.name!=='string'||s.name.length>200||distance(p,s)>2.001)throw Error('invalid spot');
  // 山頂と谷底・展望台の上下を距離だけで同一視しない。trialでは100mを上限にする。
  if(!Number.isFinite(p.elevation)||!Number.isFinite(s.elevation))return {rounds:[],reason:'標高が不明なため、近くの地点の予測を使えません'};
  if((Number.isFinite(p.elevation)&&Number.isFinite(s.elevation)&&Math.abs(p.elevation+(p.eyeHeightAGL??1.5)-s.elevation-1.5)>100)||
    (p.terrain&&s.terrain&&p.terrain!==s.terrain))return {rounds:[],reason:'近くの保存地点とは標高や地形の条件が異なります'};
  const rounds=dto.rounds.filter(r=>r&&IDS.includes(r.pid)&&r.spotId===s.id&&point(r)&&distance(r,s)<0.001&&
   r.algorithmVersion===version&&Number.isFinite(r.capturedAt)&&r.capturedAt<=now&&Array.isArray(r.window)&&r.window.length===2&&
   r.window.every(Number.isFinite)&&r.window[0]<r.window[1]&&r.capturedAt<r.window[0]&&Number.isFinite(r.peak)&&r.peak>=r.window[0]&&r.peak<=r.window[1]&&
   now-r.peak<8*DAY&&Number.isFinite(r.score)&&r.score>=0&&r.score<=100&&['spectacular','good','fair','poor'].includes(r.rank)&&
   ['high','medium','low'].includes(r.confidence)).map(r=>({...r,observations:null,predictionSource:{kind:'server',spotId:s.id,spotName:s.name,score:r.score,
    latitude:s.latitude,longitude:s.longitude,elevation:s.elevation??null,distanceKm:distance(p,s),capturedAt:r.capturedAt,algorithmVersion:r.algorithmVersion}}));
  // 保存JSONをそのまま同期へ流さず、評価の小さな既知項目だけを残す。
  for(const r of rounds){
   r.perModel=Object.fromEntries(Object.entries(r.perModel&&typeof r.perModel==='object'?r.perModel:{}).slice(0,16).filter(([k,v])=>k.length<=100&&Number.isFinite(v)&&v>=0&&v<=100));
   r.factors=(Array.isArray(r.factors)?r.factors:[]).slice(0,50).filter(f=>f&&typeof f.label==='string'&&f.label.length<=200&&Number.isFinite(f.c)).map(f=>({label:f.label,c:f.c,detail:typeof f.detail==='string'?f.detail.slice(0,2000):''}));
   r.specificTime=typeof r.specificTime==='boolean'?r.specificTime:null;
  }
  // 日本の組み込み地点。同日・同現象の応答が重複しても最新の事前保存だけを使う。
  const unique=new Map();for(const r of rounds){const k=r.pid+':'+Math.floor((r.peak+32400000)/DAY),old=unique.get(k);if(!old||old.capturedAt<r.capturedAt)unique.set(k,r);}
  return {rounds:[...unique.values()],reason:rounds.length?'':'この地点の開始前の予測はまだ保存されていません'};
 }
 function createClient({endpoint='https://zekkei-api.okayu-sorami.workers.dev/prediction/rounds',transport=global.fetch,now=Date.now,version=global.SoramiPrediction?.VERSION}={}){
  const entries=new Map();let activeKey=null;
  function state(p){return entries.get(key(p))??{status:'idle',rounds:[]};}
  function ensure(p,changed=()=>{},force=false){
   const k=key(p),old=entries.get(k);activeKey=k;
   if(old?.status==='loading')return old.promise;
   if(!force&&old&&now()-old.checkedAt<TTL)return Promise.resolve();
   const entry={status:'loading',rounds:old?.rounds??[],checkedAt:now()};entries.set(k,entry);
   const input={...p};
   entry.promise=(async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{const u=new URL(endpoint);u.searchParams.set('latitude',input.latitude);u.searchParams.set('longitude',input.longitude);
     const response=await transport(u.href,{signal:controller.signal,cache:'no-store'});if(!response.ok)throw Error(response.status===429?'しばらく待ってから再取得してください':'保存済みの予測を取得できませんでした');
     Object.assign(entry,validate(await response.json(),input,version,now()),{status:'ready',checkedAt:now()});
    }catch(e){Object.assign(entry,{status:'error',checkedAt:now(),reason:e.message==='invalid rounds'||e.message==='invalid spot'?'保存済みの予測の内容を確認できませんでした':e.message==='しばらく待ってから再取得してください'?e.message:'保存済みの予測を取得できませんでした'});}
    finally{clearTimeout(timer);changed();}
    // 進行中の要求は残す。地点を替えても応答はその座標の項目にだけ入る。
    for(const [id,e] of entries)if(entries.size>12&&id!==activeKey&&e.status!=='loading')entries.delete(id);
   })();return entry.promise;
  }
  return {state,ensure};
 }
 global.SoramiSavedRounds={createClient,validate};
 if(typeof module!=='undefined'&&module.exports)module.exports=global.SoramiSavedRounds;
})(globalThis);
