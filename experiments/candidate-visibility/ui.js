// Trial adapter. Existing session owns selection; discovery owns search jobs.
(()=>{
'use strict';
let run=0,section=null,condition='',watch=null,controller=null;
let timeChoice='day',windowStart='00:00',windowEnd='23:59';
const dataTag=new URL(document.currentScript.src,location.href).searchParams.get('v')||'0';
const dataHashes=/* BUILD_DATA_HASHES */{};
const readData=async(name,{signal}={})=>{const r=await fetch('data/'+name+'?v='+dataTag,{signal});if(!r.ok)throw Error('data');const bytes=await r.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==dataHashes[name])throw Error('data-version');return JSON.parse(new TextDecoder().decode(bytes));};
const cachedData=new Map();
function loaded(name){if(!cachedData.has(name)){const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),10000);cachedData.set(name,readData(name,{signal:ctrl.signal}).catch(e=>{cachedData.delete(name);throw e;}).finally(()=>clearTimeout(timer)));}return cachedData.get(name);}
const loadLabels=async()=>{const [addresses,facilities]=await Promise.all(['candidate-label-addresses.json','candidate-label-facilities.json'].map(n=>loaded(n).catch(()=>null)));return {addresses,facilities};};
AstroNotesCandidatePicker.configure({loadLabels,createMapView,requestKey:p=>AstroNotesCandidateDiscovery.requestKey(p)});
const live=AstroNotesCandidateTerrain.createLive({geo:AstroNotesTerrain});
const groundPort={...AstroNotesTerrain,resetBudget:()=>live.resetBudget(),groundElevation:async(lat,lon,options={})=>{const r=await live.sample({latitude:lat,longitude:lon},options);return options.withSource?(Number.isFinite(r.height)?{elevation:r.height,source:r.layer}:null):r.height;}};
const provider=AstroNotesCandidateDiscovery.createPlaceProvider({terrain:groundPort,fetchImpl:fetch.bind(globalThis),loadViewpoints:()=>loaded('candidate-viewpoints.json')});
let modelPromise=null;
async function loadModel(){
 if(!modelPromise)modelPromise=(async()=>{await AstroNotesAssets.ensureModels();const [packed,dem]=await Promise.all(['candidate-buildings.json','candidate-terrain.json'].map(n=>loaded(n).catch(()=>null)));return AstroNotesCandidateModel.createGeneric({align:AstroNotesAlign,bodies:AstroNotesBodies,geo:AstroNotesTerrain,terrain:live,index:packed?await AstroNotesCandidateBuildings.decode(packed):null,staticTerrain:dem?await AstroNotesCandidateTerrain.decode(dem):null,sidewalks:await loaded('candidate-sidewalks.json').catch(()=>null)});})().catch(e=>{modelPromise=null;throw e;});
 return modelPromise;
}
let evaluationBudgetStarted=false;
const engine=AstroNotesCandidateDiscovery.createGenericSearch({provider,bodies:AstroNotesBodies,loadStatic:()=>loaded('candidate-sidewalks.json'),evaluate:async(p,point,data,options)=>{const model=await loadModel();if(!evaluationBudgetStarted){live.resetBudget();evaluationBudgetStarted=true;}return model.evaluate(p,point,data,options);}});
const stop=()=>{if(watch!==null)clearInterval(watch);watch=null;controller?.abort();controller=null;};
const air=()=>JSON.stringify([typeof aimAirSettings==='undefined'?'standard':aimAirSettings,AstroNotesAtmosphere?.dataKey?.()??null]);
const context=s=>JSON.stringify([s.body,s.target,s.partId,s.limb,AstroNotesCandidateDiscovery.day(s.at),s.matchMode||'limb']);
function timeSpec(at){
 if(timeChoice==='instant')return {kind:'instant',at};
 if(timeChoice==='window'){const start=AstroNotesCandidateDiscovery.day(at),ms=x=>{const [h,m]=x.split(':').map(Number);return (h*60+m)*60000;},a=ms(windowStart),b=ms(windowEnd);return {kind:'window',start:start+a,end:start+b+(b<a?86400000:0)};}
 return {kind:'day',at:AstroNotesCandidateDiscovery.day(at),timezone:'Asia/Tokyo'};
}
function snapshot(){
 if(typeof SkyMapUI==='undefined'||typeof auth==='undefined'||!auth||typeof screenAllowed!=='function'||!screenAllowed('skymap')||!screenAllowed('framing'))return null;
 const s=SkyMapUI.selectionState();if(!s?.target||!Number.isFinite(s.at))return null;
 const host=document.querySelector('#exploreScenePanel #aimLook'),view=host?._trialCompositionView;
 const lens=typeof aimLens==='undefined'?null:{mode:aimLens.on&&aimLens.mode==='manual'?'evaluate':'unspecified',focal:aimLens.focal,sensorWidth:AIM_SENSOR[aimLens.sensor]?.[0],sensorHeight:AIM_SENSOR[aimLens.sensor]?.[1],portrait:aimLens.portrait,crop:1,viewModel:'scene',aspect:view?.W&&view?.H?view.W/view.H:1,pan:[...(host?._lensOffset||[0,0])],targetExtent:s.partId==='__whole'?'whole':'anchor'};
 const extraTargets=typeof aimSceneExtraTargets==='function'?aimSceneExtraTargets(s.target.id):[];
 return {...s,owner:auth.loginId,expected:context(s),atmosphere:air(),lens,extraTargets,timeSpec:timeSpec(s.at),profile:typeof aimIsMountain==='function'&&aimIsMountain(s.target)?'summit-contact':'building-near',...(globalThis.AstroNotesTrialComposition?.plan(s)||{})};
}
const key=p=>p?AstroNotesCandidateDiscovery.requestKey(p):'';
// Registered rows keep their original selection action, but use the same full
// request identity and explicit time/lens eligibility as generated rows.
AstroNotesCandidatePicker.registerRegisteredFromSession=(box,rows,legacyPlan,legacyCurrent)=>{
 const selected=snapshot();if(!selected)return;
 const identity=key(selected),eligible=()=>legacyCurrent()&&key(snapshot())===identity;
 const range=AstroNotesCandidateComposition.timeRange(selected),nodes=[...box.children].filter(n=>n.tagName==='BUTTON'&&n.classList.contains('list-item')),kept=[];
 for(let i=0;i<rows.length;i++){
  const row=rows[i],node=nodes[i];if(!node)continue;let allowed=range&&row.event?.at>=range.start&&row.event.at<=range.end;
  if(allowed&&selected.lens&&selected.lens.mode!=='unspecified')try{
   const obs=row.assumedObserver,g=obs&&AstroNotesAlign.geometryFrom(obs,selected.target,{partId:selected.partId==='__whole'?null:selected.partId,eyeM:obs.eyeM});
   const st=g&&AstroNotesBodies.state(selected.body,row.event.at,{...obs,elevation:obs.elevation+obs.eyeM});allowed=!!g&&AstroNotesCandidateModel.lensCheck(selected,obs,st,g,AstroNotesAlign).fits;
  }catch{allowed=false;}
  if(!allowed){node.remove();continue;}const click=node.onclick;node.onclick=event=>{if(eligible())click?.call(node,event);};kept.push(row);
 }
 AstroNotesCandidatePicker.registerRegistered(box,kept,selected,eligible);
};

function current(token,p,node){return token===run&&node.isConnected&&document.getElementById('placeSheet')?.open&&!document.getElementById('recentCandidates')?.hidden&&key(snapshot())===key(p);}
function mapAnchor(point){
 const data=AstroNotesCandidateDiscovery.mapLink(point,navigator.userAgent,navigator.maxTouchPoints||0);if(!data)return null;
 const link=document.createElement('a');link.className='fav-btn tiny';link.textContent='地図アプリで開く';link.href=data.href;
 if(!data.native){link.target='_blank';link.rel='noopener';}
 if(data.choose)link.onclick=e=>{if(typeof openMapAppSheet==='function'){e.preventDefault();openMapAppSheet(point.latitude.toFixed(7)+', '+point.longitude.toFixed(7));}};
 return link;
}
function syncObserverMap(){const old=document.getElementById('exploreExternalMap'),point=snapshot()?.observer,anchor=document.querySelector('#exploreScenePanel #aimLook .aim-look-figure');if(!anchor||!point){old?.remove();return;}const next=mapAnchor(point);if(!next){old?.remove();return;}if(old?.href===next.href)return;old?.remove();next.id='exploreExternalMap';next.className='chip tiny';anchor.before(next);}
function mount(){
 syncObserverMap();const panel=document.getElementById('recentCandidates'),sheet=document.getElementById('placeSheet');
 if(!panel||!sheet?.open||panel.hidden||typeof placeSheetFor==='undefined'||placeSheetFor!=='skymap'){if(section){stop();run++;AstroNotesCandidatePicker.reset?.();section.remove();section=null;condition='';}return;}
 const p=snapshot(),id=key(p);if(p)AstroNotesCandidatePicker.mount(panel,p);if(section?.isConnected&&condition===id)return;
 stop();run++;section?.remove();condition=id;section=document.createElement('section');section.id='additionalCandidateSearch';section.setAttribute('aria-label','撮影候補地点の探索');
 const status=document.createElement('div');status.className='tiny';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 function setStatus(text,waiting=false){status.className=waiting?'note-wait candidate-wait':'tiny';status.replaceChildren();if(waiting){const c=document.createElement('span');c.className='note-wait-character';c.setAttribute('aria-hidden','true');const message=document.createElement('span');message.className='note-wait-message';message.textContent=text;status.append(c,message);}else status.textContent=text;}
 const button=document.createElement('button');button.type='button';button.className='fav-btn';button.textContent='ほかの候補地点を探す';
 const cancel=document.createElement('button');cancel.type='button';cancel.className='fav-btn';cancel.textContent='探索を中止';cancel.hidden=true;
 const resultList=document.createElement('div');resultList.id='additionalCandidateResults';
 const evidence=document.createElement('details');evidence.className='aim-disclosure';const summary=document.createElement('summary');summary.textContent='候補の条件・注意点・出典';evidence.append(summary);
 const description=document.createElement('p');description.className='tiny';description.textContent=(p?.extraTargets?.length?'複数対象では先頭の対象を主に探します。ほかの対象は見え方で一緒に確認できます。 ':'')+'選択した天体と登録対象の位置・高さから撮影する地域を逆算し、展望台・公園・広場・河川敷を優先して探します。建物は近くを通る構図も含みます。見え方で確認できます。';evidence.append(description);
 const timeLabel=document.createElement('label');timeLabel.className='tiny';timeLabel.textContent='探索する日時 ';const mode=document.createElement('select');mode.id='candidateSearchMode';mode.setAttribute('aria-label','探索する日時');for(const [value,label]of [['day','この日全体'],['instant','選択した時刻'],['window','時間帯を指定']])mode.add(new Option(label,value));mode.value=timeChoice;timeLabel.append(mode);evidence.append(timeLabel);
 const times=document.createElement('div');times.hidden=timeChoice!=='window';for(const [label,id,value]of [['開始','candidateSearchStart',windowStart],['終了','candidateSearchEnd',windowEnd]]){const l=document.createElement('label');l.textContent=label+' ';const input=document.createElement('input');input.type='time';input.id=id;input.value=value;input.style.minHeight='44px';input.onchange=()=>{if(id.endsWith('Start'))windowStart=input.value;else windowEnd=input.value;mount();};l.append(input);times.append(l);}evidence.append(times);mode.onchange=()=>{timeChoice=mode.value;mount();};
 const notes=document.createElement('p');notes.className='tiny';notes.textContent='地形・建物の収録範囲や高さの精度に限界があります。未確認の見通しを撮影可能と保証しません。樹木・現地の変化・営業時間等は現地条件も確認してください。探索は段階的に進み、未探索の範囲を残す場合があります。';evidence.append(notes);
 const resultNotes=document.createElement('p');resultNotes.className='tiny';evidence.append(resultNotes);
 const credits=document.createElement('p');credits.className='tiny';for(const [label,url]of [['© OpenStreetMap contributors (ODbL)','https://www.openstreetmap.org/copyright'],['国土地理院 標高タイル','https://maps.gsi.go.jp/development/demtile.html'],['PLATEAU 利用条件','https://www.mlit.go.jp/plateau/site-policy/'],['町丁目：CODH/e-Stat（2020）','https://geoshape.ex.nii.ac.jp/ka/resource/']]){const a=document.createElement('a');a.textContent=label;a.href=url;a.target='_blank';a.rel='noopener';credits.append(a,' ');}evidence.append(credits);
 const visibleCredits=document.createElement('p');visibleCredits.className='tiny';visibleCredits.hidden=true;const osm=document.createElement('a');osm.href='https://www.openstreetmap.org/copyright';osm.textContent='© OpenStreetMap contributors';osm.target='_blank';osm.rel='noopener';visibleCredits.append(osm);
 section.append(button,cancel,status,visibleCredits,resultList,evidence);panel.append(section);
 const valid=p&&AstroNotesBodies.definition(p.body)&&!p.compositionInvalid&&AstroNotesCandidateComposition.timeRange(p);button.disabled=!valid;status.textContent=!p?'天体・対象・日付を選んでください。':!valid?'指定した日時と構図を確認してください。':'';
 let continuation=false,hasRun=false;
 cancel.onclick=()=>{stop();run++;continuation=true;button.disabled=false;cancel.hidden=true;resultList.setAttribute('aria-busy','false');setStatus('探索を中止しました。続きはもう一度探索できます。');};
 button.onclick=async()=>{
  const selected=snapshot();if(!selected)return;if(condition!==key(selected)){mount();return;}
  if(hasRun&&!continuation)engine.clear();hasRun=true;const node=section,token=++run;stop();controller=new AbortController();const signal=controller.signal;live.resetBudget();evaluationBudgetStarted=false;watch=setInterval(()=>{if(!current(token,selected,node)){stop();mount();}},250);
  button.disabled=true;cancel.hidden=false;resultList.setAttribute('aria-busy','true');setStatus('撮影できる地域を計算しています…',true);
  try{
   const result=await engine.search(selected,{more:continuation,signal,isCurrent:()=>current(token,selected,node),onProgress:counts=>{if(!current(token,selected,node))return;const message=status.querySelector('.note-wait-message');if(message)message.textContent=counts.stage==='inverse'?'撮影できる地域を計算しています…':counts.stage==='evaluate'?'構図と見通しを確認しています… '+(counts.checked||0)+'地点':'撮影場所の情報を取得しています…';}});
   if(result.cancelled||!current(token,selected,node))return;
   const labels=result.rows.length?await loadLabels():{};if(!current(token,selected,node))return;
   AstroNotesCandidatePicker.unregister?.(resultList);resultList.replaceChildren();const rows=[];
   for(const raw of result.rows){const row=AstroNotesCandidateLabels.enrich(raw,labels);if(raw.place.name&&!/^(?:撮影候補|モデル候補)/.test(raw.place.name))row.place.name=raw.place.name;rows.push(row);const item=document.createElement('button');item.type='button';item.className='list-item';item.dataset.modelBasis=row.modelEvidence?.kind||'unknown';item.dataset.candidateName=row.place.name;item.dataset.candidateId=row.id;item.textContent=row.place.name;
    item.onclick=()=>{if(!current(token,selected,node)||row.requestKey!==key(snapshot()))return;const event={...row.event};delete event.matchMode;const candidate={...row,event};if(SkyMapUI.selectCandidate(candidate,context(SkyMapUI.selectionState())))sheet.close();};resultList.append(item);
   }
   AstroNotesCandidatePicker.registerAdditional(resultList,rows,selected,()=>current(token,selected,node));
   continuation=!!result.canContinue;button.textContent=continuation?'続きを探す':'もう一度確認';visibleCredits.hidden=!rows.length;
   const unknown=rows.filter(r=>r.quality?.visibility!=='model-clear').length,unknownFrame=rows.some(r=>r.frame?.status==='unknown');
   setStatus(rows.length?`${rows.length}件の候補があります。${unknown?'見通し未確認の候補を含みます。':''}${unknownFrame?'全体の画角を確認できない候補を含みます。':''}${continuation?'続きの地域・地点も探せます。':''}`:continuation?'今回確認した範囲では候補がありません。続きを探せます。':'今回確認した範囲では候補がありません。未取得・未判定の範囲があります。');
   resultNotes.textContent=`${result.counts.checked}地点を確認。${result.counts.blocked}地点は遮蔽、${result.counts.unknown}地点は高さ等を確認できませんでした。探索地域 ${result.coverage.regions}区画。全地域・全時刻の網羅や実写成功は保証していません。`;
  }catch(e){if(current(token,selected,node)){setStatus(e.message==='candidate-cancelled'?'探索を中止しました。':'候補の情報を取得できませんでした。もう一度お試しください。');continuation=true;}}
  finally{if(token===run){stop();if(current(token,selected,node)){button.disabled=false;cancel.hidden=true;resultList.setAttribute('aria-busy','false');}else mount();}}
 };
}
let mountFrame=null;const scheduleMount=()=>{if(mountFrame===null)mountFrame=requestAnimationFrame(()=>{mountFrame=null;mount();});};
const picker=document.getElementById('placeSheet');if(picker){new MutationObserver(scheduleMount).observe(picker,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','aria-selected']});picker.addEventListener('close',()=>{stop();run++;AstroNotesCandidatePicker.reset?.();section?.remove();section=null;condition='';});}
const scenePanel=document.getElementById('exploreScenePanel');if(scenePanel)new MutationObserver(()=>{syncObserverMap();scheduleMount();}).observe(scenePanel,{childList:true,subtree:true});
document.addEventListener('astronotes-composition-change',mount);mount();
})();
