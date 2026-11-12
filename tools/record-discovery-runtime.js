
function discoveryPoints(){
 if(!auth?.token||!toolAllowed('records'))return [];
 const {groups,shapes}=recordSearchIndex(),out=[],seen=new Map();
 for(const f of favorites){
  const shape=recordSearchShape(f,shapes),saved=shape?{...f,shape}:f;
  const live=[...(groups.get(f.id)?.values()||[])].flatMap(source=>{const group=source.slice().sort((a,b)=>Number(!!b.registration)-Number(!!a.registration)||when(b)-when(a)||b.updatedAt-a.updatedAt);return group[0]?.removed?[]:group.filter(r=>!r.removed);});
  for(const r of (f.eyeHeightRangeAGL!=null?live.slice(0,1):live)){
   const o=f.eyeHeightRangeAGL!=null?f:r.observer||f,p={...saved,latitude:o.latitude,longitude:o.longitude,elevation:o.elevation??f.elevation,groundManualM:o.elevation??f.groundManualM??f.elevation,eyeHeightAGL:o.eyeHeightAGL??f.eyeHeightAGL};
   // Keep the actual recorded eye height, even if the current picker uses another floor.
   if(Number.isFinite(o.eyeHeightAGL)){p.standAglM=o.eyeHeightAGL;p.stand='ground';}
   const key=p.shape?JSON.stringify([f.id,p.eyeHeightAGL,p.eyeHeightRangeAGL,p.shape]):JSON.stringify([p.latitude,p.longitude,p.groundManualM,p.eyeHeightAGL,p.eyeHeightRangeAGL]);if(seen.has(key)){seen.get(key).place.discoveryRecordIds.push(r.id);continue;}p.discoveryKey=key;
   p.discoveryRecordIds=[r.id];const entry={place:p,record:r};seen.set(key,entry);out.push(entry);
  }
  if(shape&&!live.length){const p={...saved},key=JSON.stringify([p.latitude,p.longitude,p.elevation,p.eyeHeightAGL,p.shape]);if(!seen.has(key)){p.discoveryKey=key;p.discoveryRecordIds=[];const entry={place:p,record:{result:'seen'}};seen.set(key,entry);out.push(entry);}}
 }
 return out;
}
function discoveryRevision(){return version;}
async function discoverySearch(plan,points,isCurrent,terrainCache,onProgress){
 if(!terrainCache){const value=await recordEngineDiscover(plan,points,isCurrent,onProgress);if(value)return value;}
 return recordSearch(plan,points,{isCurrent,terrainCache,onProgress});
}
