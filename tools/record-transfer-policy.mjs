// Portable registrations, independent of account IDs, DOM, storage and sync.
export function createRecordTransfer({library,cleanFavorite,cleanShape,cleanAlignment,rangeOf,bodyIds,builtins,currentStatus,makeId,now=()=>Date.now()}){
 const FORMAT='astronotes.places',VERSION=1,LIMIT=5000;
 const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const text=(v,n=200)=>typeof v==='string'&&v.length<=n;
 const number=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
 const fail=message=>{throw Error(message);};
 const clone=v=>JSON.parse(JSON.stringify(v));
 const bodyValues=value=>value==null?null:Array.isArray(value)&&value.length>0&&value.length<=bodyIds.length&&value.every(x=>bodyIds.includes(x))?[...new Set(value)].sort((a,b)=>bodyIds.indexOf(a)-bodyIds.indexOf(b)):fail('天体の指定を確認してください');
 const savedBodyValues=value=>{try{return bodyValues(value);}catch{return null;}};
 function location(raw){
  if(!object(raw)||!library.point(raw)||!text(raw.name)||!raw.name.trim()||!text(raw.subtitle??'',2000)||!text(raw.note??'',2000))fail('撮影地点の名前・座標を確認してください');
  for(const key of ['elevation','groundManualM'])if(raw[key]!=null&&!number(raw[key],-500,9000))fail('地面の標高を確認してください');
  if(raw.eyeHeightAGL!=null&&!number(raw.eyeHeightAGL,0,700))fail('目線の高さを確認してください');
  const range=raw.eyeHeightRangeAGL==null?null:rangeOf(raw.eyeHeightRangeAGL);if(raw.eyeHeightRangeAGL!=null&&!range)fail('目線の高さの範囲を確認してください');
  const value={name:raw.name.trim(),subtitle:raw.subtitle??'',note:raw.note??'',latitude:raw.latitude,longitude:raw.longitude,elevation:raw.elevation??null,groundManualM:raw.groundManualM??null,eyeHeightAGL:raw.eyeHeightAGL??null,terrain:raw.terrain??null,phenomena:Array.isArray(raw.phenomena)?raw.phenomena:[],locationScope:raw.locationScope??'point',...(range?{eyeHeightRangeAGL:range}:{})};
  const cleaned=cleanFavorite({...value,id:'portable-validation'});if(!cleaned)fail('撮影地点の情報を確認してください');
  return Object.fromEntries(Object.keys(value).map(key=>[key,clone(Object.hasOwn(cleaned,key)?cleaned[key]:value[key])]));
 }
 function shapeValue(raw){if(raw==null)return null;const shape=cleanShape(raw);if(!shape)fail('線・範囲の形を確認してください');return shape;}
 function customDefinition(raw){
  if(!object(raw)||!number(raw.heightM,0,1000)||!text(raw.category??'',20))fail('独自対象の高さ・カテゴリを確認してください');
  return {location:location(raw.location),heightM:raw.heightM,category:raw.category??''};
 }
 const targetIdentity=entry=>JSON.stringify([entry.name,entry.latitude,entry.longitude,entry.elevation??null,entry.targetHeightM,entry.targetCategory??'']);
 const shapeAt=(place,shapes)=>{const row=shapes[place.id];return row&&row.latitude===place.latitude&&row.longitude===place.longitude?shapeValue(row.shape):null;};
 const baseIdentity=(place,shape)=>JSON.stringify([location(place),shape]);
 function validate(data){
  if(!object(data)||data.format!==FORMAT||data.version!==VERSION)fail('この撮影地点ファイルには対応していません');
  if(!Array.isArray(data.places)||!data.places.length||data.places.length>LIMIT||!Array.isArray(data.targets)||data.targets.length>LIMIT)fail('撮影地点ファイルの件数・形式を確認してください');
  const targets=new Map();for(const row of data.targets){
   if(!object(row)||!text(row.id)||!row.id||targets.has(row.id)||!text(row.name)||!row.name.trim())fail('対象の参照が重複・欠損しています');
   if(row.kind==='builtin'){if(!text(row.key)||!row.key)fail('対象の参照を確認してください');targets.set(row.id,{id:row.id,kind:'builtin',key:row.key,name:row.name});}
   else if(row.kind==='custom')targets.set(row.id,{id:row.id,kind:'custom',name:row.name,...customDefinition(row)});
   else fail('対象の種類を確認してください');
  }
  const ids=new Set(),places=data.places.map(row=>{
   if(!object(row)||!text(row.id)||!row.id||ids.has(row.id)||!Array.isArray(row.targets)||row.targets.length>500)fail('撮影地点の参照・対象を確認してください');ids.add(row.id);
   const refs=new Set(),bindings=row.targets.map(binding=>{
    if(!object(binding)||!targets.has(binding.ref)||refs.has(binding.ref)||!['seen','partial','hidden'].includes(binding.result))fail('撮影地点に結びつく対象を確認してください');refs.add(binding.ref);
    const a=binding.alignment;if(!object(a)||!['overlap','limb'].includes(a.matchMode)||!['onTop','center','behind'].includes(a.limb)||!(a.partId===null||text(a.partId)))fail('重ね方の指定を確認してください');
    return {ref:binding.ref,result:binding.result,alignment:{partId:a.partId,limb:a.limb,matchMode:a.matchMode}};
   });
   return {id:row.id,location:location(row.location),shape:shapeValue(row.shape),bodies:bodyValues(row.bodies),targets:bindings};
  });
  return {format:FORMAT,version:VERSION,places,targets:[...targets.values()]};
 }
 function exportPlaces({favorites,observations,shapes,placeIds}){
  const selected=new Set(placeIds),places=[],targets=[],refs=new Map();
  for(const favorite of favorites.filter(p=>selected.has(p.id))){
   const bindings=[];for(const key of new Set(observations.filter(r=>r.placeId===favorite.id).map(r=>r.target.key))){
    const record=currentStatus(favorite,key,observations);if(!record||record.removed)continue;
    let ref=refs.get(key);if(!ref){
     ref='t'+(targets.length+1);const builtin=builtins.find(t=>t.id===key);let definition;
     if(builtin)definition={id:ref,kind:'builtin',key,name:builtin.name};
     else {const f=key.startsWith('fav:')&&favorites.find(p=>p.id===key.slice(4));if(!f||!number(f.targetHeightM,0,1000))fail('対象「'+record.target.name+'」の定義がありません。対象を登録し直してください');definition={id:ref,kind:'custom',name:f.name,location:location(f),heightM:f.targetHeightM,category:f.targetCategory??''};}
     refs.set(key,ref);targets.push(definition);
    }
    const target=key.startsWith('fav:')?library.targetFromFavorite(favorites.find(p=>p.id===key.slice(4))):builtins.find(t=>t.id===key),alignment=cleanAlignment(target,favorite.recordAlignments?.[key]);
    if(!alignment)fail('「'+favorite.name+'」の重ね方を確認してください');bindings.push({ref,result:record.result,alignment});
   }
   places.push({id:'p'+(places.length+1),location:location(favorite),shape:shapeAt(favorite,shapes),bodies:savedBodyValues(favorite.planningBodies),targets:bindings});
  }
  if(!places.length)fail('撮影地点を選んでください');
  const data={format:FORMAT,version:VERSION,exportedAt:new Date(now()).toISOString(),places,targets};validate(data);return data;
 }
 function prepareImport(data,{favorites,observations,shapes,owner}){
  if(!owner)fail('記録を利用できるアカウントでログインしてください');
  data=validate(data);const nextFavorites=favorites.map(p=>clone(p)),nextObservations=observations.map(r=>clone(r)),nextShapes=Object.assign(Object.create(null),clone(shapes)),changed=new Set(),resolved=new Map(),unresolved=[],report={addedPlaces:0,reusedPlaces:0,duplicatePlaces:0,addedTargets:0,reusedTargets:0,addedBindings:0,variantPlaces:0};
  const used=new Set(data.places.flatMap(p=>p.targets.map(t=>t.ref))),ids=new Set([...favorites,...observations].map(x=>x.id));
  const uid=prefix=>{for(let i=0;i<20;i++){const id=makeId(prefix);if(text(id,80)&&id&&!ids.has(id)){ids.add(id);return id;}}return fail('新しい登録IDを作れませんでした');};
  const targetIndex=new Map();for(const p of nextFavorites)if(number(p.targetHeightM,0,1000)){const normalized=cleanFavorite(p);if(normalized&&!targetIndex.has(targetIdentity(normalized)))targetIndex.set(targetIdentity(normalized),p);}
  for(const definition of data.targets.filter(t=>used.has(t.id))){
   if(definition.kind==='builtin'){const target=builtins.find(t=>t.id===definition.key);if(!target){unresolved.push(definition.name);continue;}resolved.set(definition.id,target);}
   else {
    const f=cleanFavorite({...definition.location,id:'portable-validation',targetHeightM:definition.heightM,targetCategory:definition.category||null});if(!f)fail('独自対象の情報を確認してください');const same=targetIndex.get(targetIdentity(f));
    if(same){resolved.set(definition.id,library.targetFromFavorite(same));report.reusedTargets++;}
    else {f.id=uid('target-');nextFavorites.push(f);targetIndex.set(targetIdentity(f),f);changed.add(f.id);resolved.set(definition.id,library.targetFromFavorite(f));report.addedTargets++;}
   }
  }
  // A preview may explain missing definitions; it must never silently discard them.
  for(const place of data.places)for(const b of place.targets){const t=resolved.get(b.ref);if(t&&!cleanAlignment(t,b.alignment))unresolved.push(t.name+'：重ねる位置');}
  if(unresolved.length)return {canImport:false,unresolved:[...new Set(unresolved)],report,places:data.places,changedFavorites:[]};
  const placeIndex=new Map(),recordIndex=new Map(),statusCache=new Map(),originalPlaces=new Set(favorites.map(p=>p.id)),pairKey=(id,key)=>JSON.stringify([id,key]);
  for(const p of nextFavorites){try{const signature=baseIdentity(p,shapeAt(p,nextShapes));if(!placeIndex.has(signature))placeIndex.set(signature,[]);placeIndex.get(signature).push(p);}catch{/* Unrelated legacy data is retained, never used as an identity. */}}
  for(const r of nextObservations){const key=pairKey(r.placeId,r.target.key);if(!recordIndex.has(key))recordIndex.set(key,[]);recordIndex.get(key).push(r);}
  const status=(p,key)=>{const pair=pairKey(p.id,key);if(!statusCache.has(pair))statusCache.set(pair,currentStatus(p,key,recordIndex.get(pair)||[]));return statusCache.get(pair);};
  for(const input of data.places){
   const bindings=input.targets.map(b=>({...b,target:resolved.get(b.ref),alignment:cleanAlignment(resolved.get(b.ref),b.alignment)})),signature=baseIdentity(input.location,input.shape);
   const keys=bindings.map(b=>b.target.key||b.target.id);if(new Set(keys).size!==keys.length)fail('「'+input.location.name+'」の対象が重複しています');
   const sameBase=placeIndex.get(signature)||[];
   const matches=p=>{
    try{if(JSON.stringify(bodyValues(p.planningBodies))!==JSON.stringify(input.bodies))return false;}catch{return false;}
    return bindings.every(b=>{const key=b.target.key||b.target.id,r=status(p,key);return !r||(r.result===b.result&&JSON.stringify(cleanAlignment(b.target,p.recordAlignments?.[key]))===JSON.stringify(b.alignment));});
   };
   let place=sameBase.find(matches);
   if(place){if(originalPlaces.has(place.id))report.reusedPlaces++;else report.duplicatePlaces++;}
   else {place={...input.location,id:uid('point-'),recordRegistered:true,...(input.bodies?{planningBodies:input.bodies}:{})};nextFavorites.push(place);if(!placeIndex.has(signature))placeIndex.set(signature,[]);placeIndex.get(signature).push(place);changed.add(place.id);report.addedPlaces++;if(sameBase.length)report.variantPlaces++;if(input.shape)nextShapes[place.id]={latitude:place.latitude,longitude:place.longitude,shape:input.shape};}
   if(!place.recordRegistered){place.recordRegistered=true;changed.add(place.id);}
   const alignments={...(place.recordAlignments||{})};
   for(const binding of bindings){
    const t=binding.target,key=t.key||t.id;if(status(place,key))continue;
    if(binding.alignment.matchMode==='overlap'){if(Object.hasOwn(alignments,key)){delete alignments[key];changed.add(place.id);}}else {alignments[key]=binding.alignment;changed.add(place.id);}
    const pair=pairKey(place.id,key),previous=recordIndex.get(pair)||[],stamp=Math.max(now(),...previous.flatMap(r=>[r.createdAt||0,r.updatedAt||0]))+1,record=library.cleanObservation({id:uid('reg-'),placeId:place.id,target:{key,name:t.name,latitude:t.latitude,longitude:t.longitude},observer:place,registration:true,removed:false,result:binding.result,date:'',note:'',createdAt:stamp,updatedAt:stamp});if(!record)fail('対象の登録内容を確認してください');nextObservations.push(record);recordIndex.set(pair,[...previous,record]);statusCache.set(pair,record);report.addedBindings++;
   }
   if(Object.keys(alignments).length)place.recordAlignments=alignments;else delete place.recordAlignments;
   if(JSON.stringify(place).length>20000)fail('撮影地点の設定が多すぎて保存できません');
  }
  const k=library.keys(owner);return {canImport:true,unresolved:[],report,places:data.places,favorites:nextFavorites,observations:nextObservations,shapes:nextShapes,changedFavorites:[...changed],entries:[['sorami.favorites',nextFavorites],[k.observations,nextObservations],[k.shapes,nextShapes]]};
 }
 return {format:FORMAT,version:VERSION,maxBytes:5*1024*1024,bodyValues,savedBodyValues,validate,exportPlaces,prepareImport};
}
