// Runs inside the isolated calculation page. No account credential is available here.
let contextKey=null;
const decode=value=>typeof value==='string'?JSON.parse(value):value;
function configure(input){
 const prefs=input.preferences?.settings||input.preferences||{};
 if((input.calcModel??prefs.model)==='geometric-candidate-v1'&&(prefs.model!=='geometric-candidate-v1'||prefs.mode!=='none'||prefs.refractionCoefficient!==0||prefs.effectiveEarthRadiusFactor!==1))throw Error('invalid calculation input');
 auth.tools=Array.isArray(input.tools)?input.tools.slice():[];
 if(!auth.tools.includes('records'))throw Error('records permission');
 const key=JSON.stringify([input.generation,prefs,auth.tools]);
 if(key!==contextKey){version++;accessState.generation++;recordSearchSession=null;recordIndexMemo=null;contextKey=key;}
 aimAirSettings={...prefs,mode:['auto','none','standard','manual'].includes(prefs.mode)?prefs.mode:'auto'};
 AstroNotesAtmosphere.configure(aimAirSettings.mode,aimAirSettings);
 if(prefs.model==='geometric-candidate-v1'&&AstroNotesAtmosphere.targetK()!==1)throw Error('invalid geometric radius model');
 values['sorami.aimHeights']=prefs.targetHeights||{};
 globalThis.__overlapNow=Number.isFinite(input.evaluationNow)?input.evaluationNow:Date.now();
}
function normalize(snapshot){
 configure(snapshot);
 const records=[],shapes=Object.create(null),invalid=[];
 favorites=[];
 for(const row of snapshot.favorites||[]){if(row.deleted)continue;let body;try{body=decode(row.body??row);}catch{}const favorite=cleanFavorite(body);if(favorite)favorites.push(favorite);else invalid.push({placeId:row.id||body?.id||'unknown',targetKey:'unknown',reason:'favorite-invalid'});}
 for(const row of snapshot.records||[]){
  if(row.deleted)continue;
  const match=/^rec:(obs|shape|plan):(.+)$/.exec(row.id||'');if(!match)continue;
  let body;try{body=decode(row.body);}catch{invalid.push({placeId:'unknown',targetKey:'unknown',reason:'record-invalid'});continue;}
  if(body?.kind!==match[1]){invalid.push({placeId:body?.value?.placeId||match[2],targetKey:body?.value?.target?.key||'unknown',reason:'record-invalid'});continue;}
  if(match[1]==='obs'){const r=AstroNotesLibrary.cleanObservation(body.value);if(r&&r.id===match[2])records.push(r);else invalid.push({placeId:body?.value?.placeId||match[2],targetKey:body?.value?.target?.key||'unknown',reason:'record-invalid'});}
  if(match[1]==='shape'){const r=body.value,s=AstroNotesShooting.cleanShape(r?.shape);if(s&&Number.isFinite(r.latitude)&&Number.isFinite(r.longitude))shapes[match[2]]={latitude:r.latitude,longitude:r.longitude,shape:s};else invalid.push({placeId:match[2],targetKey:'unknown',reason:'shape-invalid'});}
 }
 const keys=AstroNotesLibrary.keys(auth.loginId);values[keys.observations]=records;values[keys.shapes]=shapes;recordIndexMemo=null;
 const result={pairs:[],unavailable:[]};for(const {id:body} of AstroNotesBodies.definitions){const found=opportunityPairs([body]);result.pairs.push(...found.pairs);result.unavailable.push(...found.unavailable.map(item=>({...item,body})));}const blocked=new Set(invalid.filter(x=>x.reason==='shape-invalid'||x.reason==='favorite-invalid').map(x=>x.placeId));result.pairs=result.pairs.filter(p=>!blocked.has(p.sourcePlaceId));result.unavailable.push(...invalid);return result;
}
const geometryPoints=(list,min)=>Array.isArray(list)&&list.length>=min&&list.length<=20000&&list.every(p=>Array.isArray(p)&&p.length===2&&Number.isFinite(p[0])&&Number.isFinite(p[1]));
function geometryValid(key,value){
 if(key.startsWith('sil:'))return value===null||!!value&&Number.isFinite(value.viewBaseAngle)&&Number.isFinite(value.topAngle)&&geometryPoints(value.polygon,3);
 if(key.startsWith('cap:'))return !!value&&Number.isFinite(value.base)&&geometryPoints(value.ridge,2);
 return false;
}
async function solve(input){
 configure(input);const pair=input.input,day=Date.parse(input.day+'T00:00:00+09:00');
 // Date-independent geometry the caller already holds (synced with the records). What this
 // check used and was not given is returned so the caller can keep and sync it.
 const given=new Set();if(recordGeometry.known.size>5000)recordGeometry.known.clear();
 if(input.geometry&&typeof input.geometry==='object')for(const [key,value] of Object.entries(input.geometry))if(geometryValid(key,value)){recordGeometry.known.set(key,value);given.add(key);}
 recordGeometry.used=new Map();recordGeometry.collect=true;
 if(!pair||!Number.isFinite(day)||!AstroNotesShooting.point(pair.place)||!AstroNotesShooting.point(pair.target)||!AstroNotesBodies.definition(pair.body)||!AstroNotesAccess.canFrame(toolAllowed,pair.target.id,pair.body))throw Error('invalid calculation input');
 // Category checks for saved mountain targets need the original favorite metadata.
 favorites=pair.contextFavorites||[];AstroNotesAtmosphere.resetSnapshot();
 const record=pair.record||{},place=pair.place;
 let refreshAt=Infinity,atmosphereResolution={requested:aimAirSettings.mode};
 if(aimAirSettings.mode==='auto'){
  const ground=Number.isFinite(place.groundManualM)?place.groundManualM:Number.isFinite(place.elevation)?place.elevation:await candidateElevation(place.latitude,place.longitude);
  if(!Number.isFinite(ground))return {rows:[],issues:[{reason:'elevation-unknown'}],status:'partial',checked:0,expiresAt:globalThis.__overlapNow+60000,calculationMs:0,atmosphereResolution:{requested:'auto',fallback:true,reason:'observer-ground-unknown'}};
  {
   const observer=aimObserverAt(aimSavedFrom(place),ground);
   const weather=await AstroNotesAtmosphere.load({...observer,elevation:observer.elevation+observer.eyeM},day,{target:pair.target,now:globalThis.__overlapNow});
   refreshAt=weather?.refreshAt??weather?.loadedAt+3600000;atmosphereResolution={requested:aimAirSettings.mode,source:weather?.source||null,fallback:!!weather?.error,reason:weather?.error||null};
  }
 }
 const plan={target:pair.target,body:pair.body,at:day,partId:pair.partId,limb:pair.limb,matchMode:pair.matchMode};
 const started=performance.now();
 const result=recordEventOptions(await recordSearch(plan,[{place,record}],{isCurrent:()=>true,variant:input.variant||'opportunity'}),pair);
 const rows=(result.rows||[]).map(row=>({...row,pairId:input.pairId,body:pair.body,target:pair.target,sourcePlaceId:pair.sourcePlaceId||place.id}));
 const geometry={};for(const [key,value] of recordGeometry.used)if(!given.has(key))geometry[key]=value;recordGeometry.used=new Map();
 return {geometry,rows,issues:result.issues||[],status:result.failed||result.cancelled||result.issues?.length?'partial':'complete',checked:result.checked||0,stepM:result.stepM,expiresAt:Number.isFinite(refreshAt)?refreshAt:null,calculationMs:performance.now()-started,atmosphereResolution,atmosphereKey:AstroNotesAtmosphere.dataKey()};
}
// Private fixture verification only; the daemon never dispatches this operation.
async function reference(input){
 configure(input);favorites=[];
 const target=typeof input.plan.target==='string'?AstroNotesAlign.targetById(input.plan.target):input.plan.target;
 if(!target||!Array.isArray(input.entries)||input.entries.length>2000)throw Error('invalid reference fixture');
 const start=performance.now();
 const value=await recordSearch({...input.plan,target},input.entries,{isCurrent:()=>true,variant:input.variant||'discovery'});
 return {value,ms:performance.now()-start};
}
globalThis.__overlap={normalize,solve,reference};
