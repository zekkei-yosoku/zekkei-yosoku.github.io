/* Account-local shooting library. UI-independent contracts, existing v1 storage keys. */
(function(root){
'use strict';
const point=p=>p&&Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180;
const nameKey=v=>String(v||'').normalize('NFKC').toLocaleLowerCase().replace(/[\s　]+/g,'');
const height=v=>Number.isFinite(v)&&v>=0&&v<=1000;
const distance=(a,b)=>Math.hypot((a.latitude-b.latitude)*111195,(a.longitude-b.longitude)*111195*Math.cos((a.latitude+b.latitude)*Math.PI/360));
const nearby=(rows,p)=>point(p)?rows.find(t=>point(t)&&distance(t,p)<20):null;
const matchingNames=(rows,name,exclude)=>{const key=nameKey(name);return key?rows.filter(t=>t.id!=='custom'&&t.id!==exclude&&nameKey(t.name)===key):[];};
const keys=owner=>({observations:'sorami.observations.v1:'+encodeURIComponent(owner||'guest'),shapes:'sorami.placeShapes.v1:'+encodeURIComponent(owner||'guest')});
function gate(){let generation=0;return {next:()=>++generation,current:ticket=>ticket===generation,cancel:()=>{generation++;}};}
function transaction(storage,entries){
 const before=new Map(entries.map(([k])=>[k,storage.getItem(k)])),written=[];
 try{for(const [k,v]of entries){storage.setItem(k,JSON.stringify(v));written.push(k);}}
 catch{
  let restored=true;for(const k of written.reverse())try{const v=before.get(k);if(v===null)storage.removeItem(k);else storage.setItem(k,v);}catch{restored=false;}
  throw Error(restored?'保存できませんでした。変更は取り消しました。入力は残しています':'保存と復元に失敗しました。バックアップを保管し、端末の保存設定を確認してください');
 }
}
function targetFromFavorite(f){const ground=Number.isFinite(f.elevation)?f.elevation:0;return {id:'fav:'+f.id,key:'fav:'+f.id,favId:f.id,name:f.name,latitude:f.latitude,longitude:f.longitude,groundM:ground,parts:[{id:'tip',name:'てっぺん',m:ground+f.targetHeightM}]};}
function targetDraft(p,{name,heightM=0,favorites=[],id}={}){
 if(!point(p)||typeof name!=='string'||!name.trim()||name.length>200||!height(heightM))throw Error('対象の名前・位置・高さを確認してください（地上から0〜1000m）');
 const previous=id?favorites.find(f=>f.id===id):nearby(favorites,p);
 const entry={...(previous||{}),id:previous?.id||id||'target-'+(root.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2)),name:name.trim(),latitude:p.latitude,longitude:p.longitude,subtitle:p.subtitle||previous?.subtitle||'',elevation:Number.isFinite(p.elevation)?p.elevation:null,eyeHeightAGL:previous?.eyeHeightAGL??1.5,locationScope:'point',targetHeightM:heightM,terrain:previous?.terrain??null,phenomena:previous?.phenomena||[],note:previous?.note||''};
 return {entry,baseline:previous?JSON.stringify(previous):null};
}
function applyDrafts(favorites,drafts){
 const next=favorites.map(f=>({...f}));
 for(const draft of drafts){
  const {entry,baseline}=draft,at=next.findIndex(f=>f.id===entry.id),current=at<0?null:next[at];
  if((current?JSON.stringify(current):null)!==baseline)throw Error('対象が別の画面で変更されました。開き直してください');
  if(!point(entry)||!height(entry.targetHeightM)||!entry.name?.trim())throw Error('対象の情報を確認してください');
  if(at>=0)next[at]={...entry};else next.push({...entry});
 }
 return next;
}
function cleanObservation(r){
 const text=(v,max=2000)=>typeof v==='string'&&v.length<=max,t=r?.target;
 if(!r||!text(r.id,80)||!r.id||!text(r.placeId,200)||!r.placeId||!t||!text(t.key,200)||!t.key||!text(t.name,200)||!['seen','partial','hidden'].includes(r.result))return null;
 return {id:r.id,placeId:r.placeId,target:{key:t.key,name:t.name||'対象',latitude:Number.isFinite(t.latitude)?t.latitude:null,longitude:Number.isFinite(t.longitude)?t.longitude:null},observer:point(r.observer)?{latitude:r.observer.latitude,longitude:r.observer.longitude,elevation:Number.isFinite(r.observer.elevation)?r.observer.elevation:null,eyeHeightAGL:Number.isFinite(r.observer.eyeHeightAGL)?r.observer.eyeHeightAGL:1.5}:null,result:r.result,date:text(r.date,10)&&/^\d{4}-\d{2}-\d{2}$/.test(r.date)?r.date:'',note:text(r.note,500)?r.note:'',...(r.registration===true?{registration:true,removed:r.removed===true}:{}),createdAt:Number.isFinite(r.createdAt)?r.createdAt:0,updatedAt:Number.isFinite(r.updatedAt)?r.updatedAt:0};
}
function registrationChanges(place,before,after,now=Date.now()){
 const old=new Set(before.map(t=>t.key||t.id)),next=new Set(after.map(t=>t.key||t.id)),out=[];
 for(const [targets,removed]of [[before,true],[after,false]])for(const t of targets){
  const key=t.key||t.id;
  if(removed?next.has(key):old.has(key)&&before.some(b=>(b.key||b.id)===key&&b.name===t.name&&b.latitude===t.latitude&&b.longitude===t.longitude))continue;
  out.push(cleanObservation({id:'reg-'+now.toString(36)+Math.random().toString(36).slice(2,8),placeId:place.id,target:{...t,key},registration:true,removed,result:'seen',date:'',note:'',observer:place,createdAt:now,updatedAt:now}));
 }
 return out;
}
function prepareRecord({owner,favorites,observations,shapes,place,isNew,initialTargets,targets,shape,drafts=[],cleanShape}){
 if(shape&&(!cleanShape||!cleanShape(shape)))throw Error('線・範囲の形を確認してください');
 if(!point(place)||!place.id||!place.name?.trim())throw Error('撮影地点の情報を確認してください');
 const chosen=new Set(targets.map(t=>t.key||t.id)),used=drafts.filter(x=>chosen.has('fav:'+x.entry.id));
 const nextFavorites=applyDrafts(favorites,used),at=nextFavorites.findIndex(f=>f.id===place.id);
 if(isNew){if(at>=0)throw Error('同じ地点が登録されています');nextFavorites.push({...place});}
 else if(at<0)throw Error('この撮影地点は登録から外されています');
 const changes=registrationChanges(place,initialTargets,targets);if(changes.some(r=>!r))throw Error('対象の情報を確認してください');
 const nextShapes=Object.assign(Object.create(null),shapes);if(shape)nextShapes[place.id]={latitude:place.latitude,longitude:place.longitude,shape};else delete nextShapes[place.id];
 const k=keys(owner),nextObservations=[...observations,...changes];
 return {favorites:nextFavorites,observations:nextObservations,shapes:nextShapes,changedFavorites:[...new Set([...(isNew?[place.id]:[]),...used.map(x=>x.entry.id)])],entries:[[k.observations,nextObservations],[k.shapes,nextShapes],['sorami.favorites',nextFavorites]]};
}
const merge=(a,b)=>[...new Map([...a,...b].map(x=>[x.id,x])).values()];
function backup({favorites,sightings,observations,shapes,owner}){return {schemaVersion:2,exportedAt:new Date().toISOString(),owner:owner||'guest',favorites,sightings,library:{observations,shapes},scope:'撮影地点・対象・線/範囲・予測の結果（写真ファイルを除く）'};}
function restore(data,{favorites,sightings,observations,shapes,cleanFavorite,cleanSighting,cleanShape}){
 if(data?.schemaVersion!==undefined&&![1,2].includes(data.schemaVersion))throw Error('このバックアップの版には対応していません');
 const incoming=Array.isArray(data)?data:data?.sightings;
 if(!Array.isArray(incoming))throw Error('形式が違います');
 const incomingFav=Array.isArray(data?.favorites)?data.favorites:[],rawObs=data?.library?.observations??[],rawShapes=data?.library?.shapes??{};
 if(!Array.isArray(rawObs)||!rawShapes||typeof rawShapes!=='object'||Array.isArray(rawShapes))throw Error('撮影地点のデータ形式を確認してください');
 const goodRecs=incoming.map(cleanSighting).filter(Boolean),goodFavs=incomingFav.map(cleanFavorite).filter(Boolean),nextFavorites=merge(favorites,goodFavs),ids=new Set(nextFavorites.map(f=>f.id));
 let shapeCount=0;
 const goodObs=rawObs.map(cleanObservation).filter(r=>r&&ids.has(r.placeId)),nextShapes=Object.assign(Object.create(null),shapes);let dropped=incoming.length-goodRecs.length+incomingFav.length-goodFavs.length+rawObs.length-goodObs.length;
 for(const [id,row]of Object.entries(rawShapes)){
  const f=nextFavorites.find(f=>f.id===id),s=cleanShape(row?.shape);
  if(!f||!s||row.latitude!==f.latitude||row.longitude!==f.longitude){dropped++;continue;}
  nextShapes[id]={latitude:f.latitude,longitude:f.longitude,shape:s};shapeCount++;
 }
 return {favorites:nextFavorites,sightings:merge(sightings,goodRecs),observations:merge(observations,goodObs),shapes:nextShapes,goodRecs,goodFavs,observationCount:goodObs.length,shapeCount,dropped};
}
const api={point,nameKey,height,distance,nearby,matchingNames,keys,gate,transaction,targetFromFavorite,targetDraft,applyDrafts,cleanObservation,registrationChanges,prepareRecord,backup,restore,merge};
if(typeof module==='object'&&module.exports)module.exports=api;root.SoramiLibrary=api;
})(typeof globalThis!=='undefined'?globalThis:this);
