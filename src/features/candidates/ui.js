// Trial adapter. Existing session owns selection; discovery owns search jobs.
(()=>{
'use strict';
let run=0,section=null,condition='',watch=null,controller=null,homeCondition='';
const mainWorkspace=()=>globalThis.TrialExplore?.candidateWorkspace?.();
const dateSelection=()=>{const s=SkyMapUI.selectionState();return Number.isFinite(s?.at)?s:SkyMapUI.workspaceHost()?.session;};
const contextActive=()=>{const main=mainWorkspace();return main?main.active():document.getElementById('placeSheet')?.open&&typeof placeSheetFor!=='undefined'&&placeSheetFor==='skymap'&&!document.getElementById('recentCandidates')?.hidden;};
let dateNavigation=null,dateCalendar=null,autoSearchTimer=null,dateRefreshPending=false,hasSearched=false,returnSearch=null;
let timeChoice='day',windowStart='00:00',windowEnd='23:59';
const dataTag=new URL(document.currentScript.src,location.href).searchParams.get('v')||'0';
const dataHashes=/* BUILD_DATA_HASHES */{};
// The trial keeps no copy of this data: its page points at the production folder (build-preview.py).
const dataBase=document.querySelector('meta[name="astronotes-data-base"]')?.content||'data/';
const readData=async(name,{signal}={})=>{const r=await fetch(dataBase+name+'?v='+dataTag,{signal});if(!r.ok)throw Error('data');const bytes=await r.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==dataHashes[name])throw Error('data-version');return JSON.parse(new TextDecoder().decode(bytes));};
const cachedData=new Map();
function loaded(name){if(!cachedData.has(name)){const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),10000);cachedData.set(name,readData(name,{signal:ctrl.signal}).catch(e=>{cachedData.delete(name);throw e;}).finally(()=>clearTimeout(timer)));}return cachedData.get(name);}
// Saved targets standing on a PLATEAU building take its shape on this page (見え方 and new places).
const plateauShapes=globalThis.AstroNotesPlateauBuildings?.create({load:loaded,base:dataBase+'building-shapes/'})||null;globalThis.AstroNotesPlateauShapes=plateauShapes;
// The targets the app lists carry their PLATEAU shape, so the overlap list and registered places (calculation
// workers) use it too; it is part of a pair's geometry key, so geometry made with the estimate is not reused.
if(typeof globalThis.aimTargetList==='function'&&!globalThis.aimTargetList.plateauShapes){
 const listed=globalThis.aimTargetList,withShape=function(){return listed.apply(this,arguments).map(t=>{const m=String(t?.id||'').startsWith('fav:')&&globalThis.AstroNotesCityModels?.[t.id];return m&&String(m.id).startsWith('plateau-')?{...t,cityModel:m}:t;});};
 withShape.plateauShapes=true;globalThis.aimTargetList=withShape;
}
async function refreshShapes(){
 if(!plateauShapes||typeof aimTargetList!=='function')return;
 try{const changed=await plateauShapes.prepare(aimTargetList());if(!changed.length)return;if(changed.includes(SkyMapUI?.selectionState?.()?.target?.id))SkyMapUI.render?.();document.dispatchEvent(new Event('astronotes-records-change'));}catch{/* Shapes are an enhancement; the outline estimate stays. */}
}
document.addEventListener('astronotes-records-change',refreshShapes);
(globalThis.startupSessionReady||Promise.resolve()).then(refreshShapes,()=>{});
const loadLabels=async()=>{const [addresses,facilities]=await Promise.all(['candidate-label-addresses.json','candidate-label-facilities.json'].map(n=>loaded(n).catch(()=>null)));return {addresses,facilities};};
const filterKey=p=>JSON.stringify([p.owner,p.body,p.target,p.partId,p.limb,p.matchMode]);
AstroNotesCandidatePicker.configure({loadLabels,createMapView,filterKey,getScroller:()=>mainWorkspace()?.scroller(),getReturnScroll:()=>mainWorkspace()?.returnScroll?.(),onRendered:count=>mainWorkspace()?.restoreScroll(count),requestKey:p=>AstroNotesCandidateDiscovery.requestKey(p)});
const live=AstroNotesCandidateTerrain.createLive({geo:AstroNotesTerrain,maxDurationMs:120000});
 // Ground under GSI footprints the height grid lacks: the 10 m DEM (a building's base, not a sight line) on its own
 // tile budget, so it never starves the sight-line terrain. A search step longer than 35 s no longer runs out of time.
 const footprintGround=AstroNotesCandidateTerrain.createLive({geo:AstroNotesTerrain,maxTiles:160,maxDurationMs:120000,layers:[['dem',14]]});
const groundPort={...AstroNotesTerrain,resetBudget:()=>live.resetBudget(),groundElevation:async(lat,lon,options={})=>{const r=await live.sample({latitude:lat,longitude:lon},options);return options.withSource?(Number.isFinite(r.height)?{elevation:r.height,source:r.layer}:null):r.height;}};
// Places, woods and bridges from the bundled OSM extract (Overpass only if it cannot be read).
 const osmPlaces=globalThis.AstroNotesOsmPlaces?.create({load:loaded,base:dataBase+'osm-places/'})||null;
 const provider=AstroNotesCandidateDiscovery.createPlaceProvider({terrain:groundPort,fetchImpl:fetch.bind(globalThis),loadViewpoints:()=>loaded('candidate-viewpoints.json'),places:osmPlaces});
let modelPromise=null;
async function loadModel(){
 // Buildings: PLATEAU top heights (every city PLATEAU covers) along each line, GSI footprints elsewhere; the 3D band model is no longer loaded.
 if(!modelPromise)modelPromise=(async()=>{await AstroNotesAssets.ensureModels();const dem=await loaded('candidate-terrain.json').catch(()=>null);
  const heights=AstroNotesCandidateHeights.create({base:dataBase+'building-heights/',loadIndex:()=>loaded('building-heights/index.json'),ownFootprint:key=>plateauShapes?.footprint(key)||null,obstacles:osmPlaces?(a,b)=>osmPlaces.obstaclesAlong(a,b):null,gsiAlong:(a,b)=>AstroNotesTerrain.gsiBuildingsAlong(a,b),groundAt:p=>footprintGround.sample(p).then(r=>r.height)});
  return AstroNotesCandidateModel.createGeneric({align:AstroNotesAlign,bodies:AstroNotesBodies,geo:AstroNotesTerrain,terrain:live,heights,staticTerrain:dem?await AstroNotesCandidateTerrain.decode(dem):null,sidewalks:await loaded('candidate-sidewalks.json').catch(()=>null)});})().catch(e=>{modelPromise=null;throw e;});
 return modelPromise;
}
let evaluationBudgetStarted=false;
const engine=AstroNotesCandidateDiscovery.createGenericSearch({provider,bodies:AstroNotesBodies,loadStatic:()=>loaded('candidate-sidewalks.json'),evaluate:async(p,point,data,options)=>{const model=await loadModel();if(plateauShapes&&String(p.target?.id||'').startsWith('fav:')&&!plateauShapes.attachedTo(p.target.id))await plateauShapes.prepare([p.target]).catch(()=>{});if(!options.isCurrent())throw Error('candidate-cancelled');if(!evaluationBudgetStarted){live.resetBudget();footprintGround.resetBudget();evaluationBudgetStarted=true;}return model.evaluate(p,point,data,options);}});
const stop=()=>{if(autoSearchTimer!==null)clearTimeout(autoSearchTimer);autoSearchTimer=null;if(watch!==null)clearInterval(watch);watch=null;controller?.abort();controller=null;};
// The refraction settings only: weather the view loads later for a chosen place (気象予報) must not discard the places
// already found when going back to the list (2026-11-11, seen on the iPhone). The evaluator keys its own caches by the data.
const air=()=>JSON.stringify([typeof aimAirSettings==='undefined'?'standard':aimAirSettings]);
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
 // The preview fills the same map-owned content width (max 780px); derive its dimensions without revealing or painting it.
 const W=mainWorkspace()?.previewWidth(),H=W?(host?._full&&host._fullH?Math.round(host._fullH):Math.round(Math.min(W>=640?620:440,W*(aimIsMountain(s.target)?.66:.9)))):null;
 const lens=typeof aimLens==='undefined'?null:{mode:aimLens.on&&aimLens.mode==='manual'?'evaluate':'unspecified',focal:aimLens.focal,sensorWidth:AIM_SENSOR[aimLens.sensor]?.[0],sensorHeight:AIM_SENSOR[aimLens.sensor]?.[1],portrait:aimLens.portrait,crop:1,viewModel:'scene',aspect:W&&H?W/H:view?.W&&view?.H?view.W/view.H:1,pan:[...(host?._lensOffset||[0,0])],targetExtent:s.partId==='__whole'?'overlap':'anchor'};
 const extraTargets=typeof aimSceneExtraTargets==='function'?aimSceneExtraTargets(s.target.id):[];
 // With one target overlapped as a whole, only the body and what it overlaps have to fit (2026-11-11 ユーザー「天体と重なる所
 // だけ確認」): no lens drops a place then, so the lens stays out of the search. Choosing a place sets the focal length and the
 // frame for its view; leaving the lens in the key would drop the found places on the way back.
 const searchLens=s.partId==='__whole'&&!extraTargets.length?{mode:'unspecified'}:lens;
 const selected={...s,authGeneration:mainWorkspace()?.epoch(),owner:auth.loginId,expected:context(s),atmosphere:air(),lens:searchLens,extraTargets,timeSpec:timeSpec(s.at),profile:typeof aimIsMountain==='function'&&aimIsMountain(s.target)?'summit-contact':'building-near',...(globalThis.AstroNotesTrialComposition?.plan(s)||{}),...(globalThis.AstroNotesTrialOverlap?.searchPlan?.(s)||{})};
 // A next-day event in an overnight window does not change the search day.
 if(returnSearch&&s.candidateOpportunity?.id===returnSearch.rowId&&s.at===returnSearch.viewAt){const restored={...selected,at:returnSearch.plan.at,timeSpec:returnSearch.plan.timeSpec};if(AstroNotesCandidateDiscovery.requestKey(restored)===returnSearch.key)return restored;}
 return selected;
}
const key=p=>p?AstroNotesCandidateDiscovery.requestKey(p):'';
const uiKey=p=>key(p)+'|'+(p?.authGeneration??'');
AstroNotesCandidatePicker.registeredPlan=fallback=>mainWorkspace()||typeof placeSheetFor!=='undefined'&&placeSheetFor==='skymap'?snapshot()||fallback:fallback;
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

function current(token,p,node){return token===run&&node.isConnected&&contextActive()&&p.authGeneration===mainWorkspace()?.epoch()&&key(snapshot())===key(p);}
function mapAnchor(point){
 const apps=AstroNotesPlan.externalApps;if(!apps||!point||!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude))return null;
 const link=document.createElement('a');link.className='fav-btn tiny';link.textContent='地図アプリで開く';link.href=apps.mapApps.google.url(point.latitude.toFixed(7)+', '+point.longitude.toFixed(7));link.target='_blank';link.rel='noopener';
 link.onclick=e=>{e.preventDefault();apps.requestMap(point,{source:link,isCurrent:()=>link.isConnected});};return link;
}
function syncRecordSave(host,toolbar){
 const share=toolbar.querySelector('.aim-figure-share');if(!share)return;
 const place=share.querySelector('[data-quick-save=place]'),plan=share.querySelector('[data-quick-save=plan]');if(!place||!plan)return;
 let dialog=share.querySelector('#trialRecordSaveSheet'),button=share.querySelector('#trialRecordSave');
 if(!dialog){
  button=document.createElement('button');button.id='trialRecordSave';button.type='button';button.className='trial-record-action';button.setAttribute('aria-label','記録に保存');button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','trialRecordSaveSheet');
  const svg=document.querySelector('#recordsMenu svg').cloneNode(true);svg.removeAttribute('class');svg.setAttribute('width','24');svg.setAttribute('height','24');
  const plus=document.createElementNS('http://www.w3.org/2000/svg','path');plus.setAttribute('d','M19 13v8m-4-4h8');plus.setAttribute('data-record-add','');
  const gap=document.createElementNS('http://www.w3.org/2000/svg','path');gap.setAttribute('d','M19 13v8m-4-4h8');gap.setAttribute('stroke','var(--card)');gap.setAttribute('stroke-width','5');svg.append(gap,plus);button.append(svg);const label=document.createElement('span');label.textContent='記録';button.append(label);
  dialog=document.createElement('dialog');dialog.id='trialRecordSaveSheet';dialog.className='sheet trial-record-dialog';dialog.setAttribute('aria-label','記録に保存');dialog.tabIndex=-1;
  const head=document.createElement('div');head.className='sheet-head';const title=document.createElement('strong');title.textContent='記録に保存';const close=document.createElement('button');close.type='button';close.textContent='閉じる';close.setAttribute('data-record-save-close','');head.append(title,close);
  const choices=document.createElement('div');choices.className='sheet-body';for(const [option,text] of [[place,'撮影地点に保存'],[plan,'予定に保存']]){const label=document.createElement('span');label.setAttribute('data-save-choice-label','');label.textContent=text;option.append(label);option.setAttribute('aria-label',text);option.title=text;choices.append(option);}
  dialog.append(head,choices);share.append(button,dialog);
  button.onclick=()=>{if(!host.closest('#exploreScenePanel')||host.closest('#exploreScenePanel').hidden)return;if(dialog.open&&dialog.matches(':modal'))return;if(dialog.open)dialog.close();dialog.restoreRecordFocus=true;button.setAttribute('aria-expanded','true');showSheet(dialog);};
  close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>{if(dialog.open)return;button.setAttribute('aria-expanded','false');if(dialog.restoreRecordFocus&&button.isConnected&&host.closest('#exploreScenePanel'))button.focus({preventScroll:true});});
  dialog.addEventListener('click',e=>{const choice=e.target.closest('[data-quick-save]');if(choice&&!choice.disabled){queueMicrotask(()=>{if(dialog.open)dialog.close();});return;}if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
 }
 const choices=dialog.querySelector('.sheet-body');
 for(const [option,text] of [[place,'撮影地点に保存'],[plan,'予定に保存']]){if(!option.querySelector('[data-save-choice-label]')){const label=document.createElement('span');label.setAttribute('data-save-choice-label','');label.textContent=text;option.append(label);option.setAttribute('aria-label',text);option.title=text;}if(option.parentElement!==choices)choices.append(option);}
 const hidden=!!host.closest('#exploreScenePanel')?.hidden;if(button.hidden!==hidden)button.hidden=hidden;button.disabled=place.disabled&&plan.disabled;
}
function syncObserverMap(){
 watchPreview();
 const old=document.getElementById('exploreExternalMap'),point=snapshot()?.observer,toolbar=document.querySelector('#exploreScenePanel #aimLook .trial-scene-toolbar');
 if(!toolbar||!point){old?.remove();return;}syncRecordSave(toolbar.closest('#aimLook'),toolbar);const next=mapAnchor(point);if(!next){old?.remove();return;}
 if(old?.href===next.href){if(old.parentElement!==toolbar)toolbar.append(old);return;}
 old?.remove();next.id='exploreExternalMap';next.className='trial-map-action';next.setAttribute('aria-label','撮影地点を地図アプリで開く');next.title='地図アプリで開く';next.innerHTML=UI_ICONS.map+'<span>地図</span>';toolbar.append(next);
}
const dateValue=at=>new Date(at+32400000).toISOString().slice(0,10);
function changeCandidateDay(value){
 const selected=snapshot()||dateSelection();if(!selected||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const start=Date.parse(value+'T00:00:00+09:00');if(!Number.isFinite(start)||dateValue(start)!==value)return false;
 const previous=AstroNotesCandidateDiscovery.day(selected.at);if(start===previous)return true;
 const repeat=hasSearched,family=filterKey(selected);returnSearch=null;stop();run++;
 SkyMapUI.setTime(start+(selected.at-previous));mount();
 if(repeat)autoSearchTimer=setTimeout(()=>{autoSearchTimer=null;const latest=snapshot();if(!latest||filterKey(latest)!==family||AstroNotesCandidateDiscovery.day(latest.at)!==start||!contextActive())return;const button=document.querySelector('#additionalCandidateSearch > button');if(button&&!button.disabled&&button.dataset.state!=='searching')button.click();},350);
 return true;
}
function syncCandidateDate(control,p){
 if(mainWorkspace())return;
 if(!dateNavigation){
  dateNavigation=document.createElement('div');dateNavigation.id='candidateDateNavigation';dateNavigation.setAttribute('role','group');dateNavigation.setAttribute('aria-label','候補を探す日');Object.assign(dateNavigation.style,{display:'grid',gridTemplateColumns:'44px minmax(0,1fr) 44px',gap:'8px',marginBottom:'14px',alignItems:'center'});
  const prev=document.createElement('button'),next=document.createElement('button'),input=document.createElement('button');
  for(const [b,id,label,text,step]of [[prev,'candidatePreviousDay','前日の候補','‹',-1],[next,'candidateNextDay','翌日の候補','›',1]]){b.type='button';b.className='chip';b.id=id;b.textContent=text;b.setAttribute('aria-label',label);Object.assign(b.style,{width:'44px',height:'44px',padding:'0',fontSize:'26px',lineHeight:'1'});b.onclick=()=>{const current=snapshot()||dateSelection();if(current)changeCandidateDay(dateValue(current.at+step*86400000));};}
  input.id='candidateDate';input.type='button';input.className='fav-btn';input.setAttribute('aria-label','カレンダーで候補日を選ぶ');input.setAttribute('aria-haspopup','dialog');Object.assign(input.style,{width:'100%',minWidth:'0',maxWidth:'100%',boxSizing:'border-box',height:'44px',minHeight:'44px',fontSize:'16px',textAlign:'center',padding:'8px'});dateCalendar=ToolDateTimeBar.calendar({button:input,getAt:()=>dateSelection()?.at??Date.now(),setDay:at=>changeCandidateDay(dateValue(at))});dateCalendar.id='candidateDateCalendar';

  dateNavigation.append(prev,input,next);
 }
 if(dateNavigation.parentNode!==control)control.prepend(dateNavigation);
 const input=dateNavigation.querySelector('#candidateDate');input.dataset.date=dateValue(p.at);ToolDateTimeBar.dateText(input,p.at);
}
function syncWorkspaceSection(panel){
 if(!section?.isConnected)return;
 const dedicated=!!mainWorkspace(),parent=dedicated?(mainWorkspace().newPlacesHost?.()||document.getElementById('candidateWorkspaceAction')):panel;
 if(parent&&section.parentNode!==parent){if(dedicated)parent.prepend(section);else parent.append(section);}
}
function mount(){
 syncObserverMap();const panel=document.getElementById('recentCandidates'),sheet=document.getElementById('placeSheet');
 if(!panel||!contextActive()){dateRefreshPending=false;if(section){stop();run++;hasSearched=false;AstroNotesCandidatePicker.suspend?.();if(dateCalendar?.open)dateCalendar.close();section.remove();section=null;condition='';}return;}
 const p=snapshot(),id=uiKey(p),main=mainWorkspace();if(main&&homeCondition&&homeCondition!==id)main.reset();homeCondition=id;if(p)syncCandidateDate(AstroNotesCandidatePicker.mount(panel,p),p);if(section?.isConnected&&condition===id){syncWorkspaceSection(panel);return;}
 const detailsOpen=!!section?.querySelector('details')?.open,editing=section?.contains(document.activeElement)?document.activeElement.id:null;
 stop();run++;section?.remove();condition=id;section=document.createElement('section');section.id='additionalCandidateSearch';section.setAttribute('aria-label','撮影候補地点の探索');
 const status=document.createElement('div');status.className='tiny';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 function setStatus(text){status.textContent=text;}
 const button=document.createElement('button');button.type='button';button.className='fav-btn';button.id='candidateSearchAction';button.setAttribute('aria-controls',main?'exploreSearchResults':'additionalCandidateResults');
 const resultList=document.createElement('div');resultList.id='additionalCandidateResults';
 const evidence=document.createElement('details');evidence.className='aim-disclosure';evidence.open=detailsOpen;const summary=document.createElement('summary');summary.textContent=main?'探索の詳細条件':'候補の条件・注意点・出典';evidence.append(summary);
 const description=document.createElement('p');description.className='tiny';description.textContent=(p?.overlapMembers?'全ての対象を合わせた輪郭に重なる地点を探します。':p?.extraTargets?.length?'重ねる対象で探します。ほかの対象は見え方で一緒に確認できます。 ':'')+'選択した天体と登録対象の位置・高さから撮影する地域を逆算し、展望台・公園・広場・河川敷を優先して探します。建物は近くを通る構図も含みます。見え方で確認できます。';evidence.append(description);
 const timeLabel=document.createElement('label');timeLabel.className='tiny';timeLabel.textContent='探索する日時 ';const mode=document.createElement('select');mode.id='candidateSearchMode';mode.setAttribute('aria-label','探索する日時');for(const [value,label]of [['day','この日全体'],['instant','選択した時刻'],['window','時間帯を指定']])mode.add(new Option(label,value));mode.value=timeChoice;timeLabel.append(mode);evidence.append(timeLabel);
 const times=document.createElement('div');times.hidden=timeChoice!=='window';for(const [label,id,value]of [['開始','candidateSearchStart',windowStart],['終了','candidateSearchEnd',windowEnd]]){const l=document.createElement('label');l.textContent=label+' ';const input=document.createElement('input');input.type='time';input.id=id;input.value=value;input.style.minHeight='44px';input.onchange=()=>{returnSearch=null;if(id.endsWith('Start'))windowStart=input.value;else windowEnd=input.value;mount();};l.append(input);times.append(l);}evidence.append(times);mode.onchange=()=>{returnSearch=null;timeChoice=mode.value;mount();};
 const notes=document.createElement('p');notes.className='tiny';notes.textContent='地形・建物の収録範囲や高さの精度に限界があります。未確認の見通しを撮影可能と保証しません。樹木・現地の変化・営業時間等は現地条件も確認してください。取得できない情報がある場合は、結果に表示します。';evidence.append(notes);
 const resultNotes=document.createElement('p');resultNotes.className='tiny';evidence.append(resultNotes);
 const credits=document.createElement('p');credits.className='tiny';for(const [label,url]of [['© OpenStreetMap contributors (ODbL)','https://www.openstreetmap.org/copyright'],['国土地理院 標高タイル','https://maps.gsi.go.jp/development/demtile.html'],['3D都市モデル（Project PLATEAU）全国の整備都市（2020〜2025年度・国土交通省）を加工して作成','https://www.mlit.go.jp/plateau/site-policy/'],['国土地理院 ベクトルタイル（建物）','https://maps.gsi.go.jp/development/vt.html'],['町丁目：CODH/e-Stat（2020）','https://geoshape.ex.nii.ac.jp/ka/resource/']]){const a=document.createElement('a');a.textContent=label;a.href=url;a.target='_blank';a.rel='noopener';credits.append(a,' ');}evidence.append(credits);
 const visibleCredits=document.createElement('p');visibleCredits.className='tiny';visibleCredits.hidden=true;const osm=document.createElement('a');osm.href='https://www.openstreetmap.org/copyright';osm.textContent='© OpenStreetMap contributors';osm.target='_blank';osm.rel='noopener';const plateau=document.createElement('a');plateau.href='https://www.mlit.go.jp/plateau/site-policy/';plateau.textContent='3D都市モデル（Project PLATEAU）国土交通省 を加工';plateau.target='_blank';plateau.rel='noopener';visibleCredits.append(osm,' ',plateau);
 if(main){section.append(evidence,button);document.getElementById('candidateSearchFeedback').replaceChildren(status,resultList);document.getElementById('candidateSearchCredits').replaceChildren(visibleCredits);}else section.append(button,status,visibleCredits,resultList,evidence);panel.append(section);syncWorkspaceSection(panel);
 if(editing&&['candidateSearchMode','candidateSearchStart','candidateSearchEnd'].includes(editing))section.querySelector('#'+editing)?.focus({preventScroll:true});
 const valid=p&&AstroNotesBodies.definition(p.body)&&!p.compositionInvalid&&AstroNotesCandidateComposition.timeRange(p);button.disabled=!valid;status.textContent=!p?'天体・対象・日付を選んでください。':!valid?'指定した日時と構図を確認してください。':'';
 let continuation=false,hasRun=false,searching=false,failed=false;
 function renderAction(){button.dataset.state=searching?'searching':'idle';button.textContent=searching?'キャンセル':failed?'再試行':continuation?'続きを探す':hasRun?(main?'候補を探し直す':'もう一度確認'):main?'候補を探す':'ほかの候補地点を探す';button.disabled=!valid;resultList.setAttribute('aria-busy',String(searching));}
 renderAction();
 // partial: rows found so far while the search goes on; the list is replaced, the progress and the action stay.
 async function present(result,selected,node,token,{cancelled=false,interrupted=false,partial=false}={}){
   const labels=result.rows.length?await loadLabels():{};if(!current(token,selected,node)||partial&&!searching)return;
   AstroNotesCandidatePicker.unregister?.(resultList);resultList.replaceChildren();const rows=[];
   for(const raw of result.rows){const row=AstroNotesCandidateLabels.enrich(raw,labels);if(raw.place.name&&!/^(?:撮影候補|モデル候補)/.test(raw.place.name))row.place.name=raw.place.name;rows.push(row);const item=document.createElement('button');item.type='button';item.className='list-item';item.dataset.modelBasis=row.modelEvidence?.kind||'unknown';item.dataset.candidateName=row.place.name;item.dataset.candidateId=row.id;item.textContent=row.place.name;
    item.onclick=()=>{if(mainWorkspace()&&!mainWorkspace().selectable()||!current(token,selected,node)||row.requestKey!==key(snapshot()))return;const event={...row.event};delete event.matchMode;const candidate={...row,event};const host=document.getElementById('aimLook'),previous=host?._compose;if(host)host._compose={mode:'whole',apply:true};if(SkyMapUI.selectCandidate(candidate,context(SkyMapUI.selectionState()))){returnSearch=selected.timeSpec?.kind==='window'&&AstroNotesCandidateDiscovery.day(row.event.at)!==AstroNotesCandidateDiscovery.day(selected.at)?{plan:selected,key:key(selected),rowId:row.id,viewAt:row.event.at}:null;sheet.close();}else if(host)host._compose=previous;};resultList.append(item);
   }
   AstroNotesCandidatePicker.registerAdditional(resultList,rows,selected,()=>current(token,selected,node));
   if(partial){visibleCredits.hidden=!rows.length;main?.reveal();return;}
   const incomplete=!!result.stalled||interrupted||result.coverage.loaded?.some(c=>c.failedRegions?.length||c.missing?.includes('time-budget'));
   continuation=cancelled||interrupted||!!result.canContinue;failed=!cancelled&&incomplete;
   renderAction();visibleCredits.hidden=!rows.length;
   const unknown=rows.some(r=>r.quality?.buildingHeights==='estimated'),unknownFrame=rows.some(r=>r.frame?.status==='unknown');
   setStatus(cancelled?'探索をキャンセルしました。続きから探せます。':(rows.length?`新たな地点で${rows.length}件の候補があります。${unknown?'建物の高さを推定した候補を含みます。':''}${unknownFrame?'全体の画角を確認できない候補を含みます。':''}`:incomplete?'確認できた範囲には候補がありません。':'今回確認した範囲では候補がありません。')+(incomplete?'取得できなかった範囲があります。':result.canContinue?'探索を再開できます。':''));
   const c=result.counts;resultNotes.textContent=`見通しを地形と建物で確かめられた地点だけを候補にしています。${c.checked}地点を確認：遮られる${c.blocked}、見通しを確かめられない${c.unverified||0}${c.nearBuilding||c.heightUnknown||c.obstacle?`（うち${[c.nearBuilding?`立つ点のすぐ脇に建物${c.nearBuilding}`:'',c.heightUnknown?`建物の高さが分からない${c.heightUnknown}`:'',c.obstacle?`木・橋・高架${c.obstacle}`:''].filter(Boolean).join('・')}）`:''}、構図に合わない${c.outsideFrame||0}、立つ高さが分からない${c.unknown}。建物の高さはPLATEAUを整備した都市はその高さ、ほかは国土地理院の建物の形と種類から見積もります。木・橋・高架はOpenStreetMapにあるものだけ、高さが分からないものとして判定します。探索地域 ${result.coverage.regions}区画。全地域・全時刻の網羅や実写成功は保証していません。`;
 }
 button.onclick=async()=>{
  const selected=snapshot();if(!selected)return;if(condition!==uiKey(selected)){mount();return;}
  if(!button.isConnected||!contextActive()||main&&!main.selectable())return;dateRefreshPending=false;main?.reveal();
  if(searching){stop();const token=++run;hasSearched=false;continuation=true;failed=false;searching=false;renderAction();setStatus('探索をキャンセルしました。続きから探せます。');const completed=engine.cached(selected);if(completed)present(completed,selected,section,token,{cancelled:true}).catch(()=>{});return;}
  if(hasRun&&!continuation&&!engine.restart(selected))return;AstroNotesCandidatePicker.unregister?.(resultList);resultList.replaceChildren();hasRun=true;hasSearched=true;const node=section,token=++run;stop();controller=new AbortController();const signal=controller.signal;live.resetBudget();footprintGround.resetBudget();evaluationBudgetStarted=false;watch=setInterval(()=>{if(!current(token,selected,node)){stop();mount();}},250);
  searching=true;failed=false;renderAction();
  const label='撮影できる地域を計算しています…',progress=globalThis.MyPlacesUI.recordProgress(status,label);
  progress.node.classList.add('candidate-wait');
  try{
   // The search asks this between every few calculations; rebuilding the page snapshot each time took about a quarter of
   // a phone's search time (2026-11-11). The run and the section are checked every time, the page conditions at most
   // every 250 ms (a change of conditions also restarts the search through mount()).
   let checkedAt=-Infinity,stillCurrent=true,shown=0;const searchCurrent=()=>{if(token!==run||!node.isConnected)return false;const now=performance.now();if(now-checkedAt>=250){checkedAt=now;stillCurrent=current(token,selected,node);}return stillCurrent;};
   const result=await engine.searchAll(selected,{more:continuation,signal,isCurrent:searchCurrent,onPage:page=>{if(page.rows?.length>shown&&searchCurrent()){shown=page.rows.length;present(page,selected,node,token,{partial:true}).catch(()=>{});}},onBatchStart:()=>{live.resetBudget();footprintGround.resetBudget();evaluationBudgetStarted=false;},onProgress:counts=>{if(!searchCurrent())return;const checked=counts.checked||0;const message=counts.stage==='inverse'?label:counts.stage==='evaluate'?'構図と見通しを確認中 ・ '+checked+'地点':'撮影場所の情報を取得中'+(checked?' ・ '+checked+'地点確認済み':'');progress.update(undefined,undefined,message);}});
   if(!current(token,selected,node))return;if(result.cancelled){failed=true;continuation=true;setStatus('候補の情報を取得できませんでした。');return;}
   await present(result,selected,node,token);
  }catch(e){if(current(token,selected,node)){const completed=engine.cached(selected);if(completed)await present(completed,selected,node,token,{interrupted:true});else{setStatus('候補の情報を取得できませんでした。');failed=true;continuation=true;}}}
  finally{if(token===run){stop();if(current(token,selected,node)){searching=false;renderAction();}else mount();}}
 };
 if(main?.visible())globalThis.MyPlacesUI?.renderPickerPanel(panel);
 // Returning from another page can build the section before its place is back on the page (seen on wide screens):
 // show the cached results once it is attached, or they would be dropped as stale.
 const cached=p&&engine.cached(p);if(cached){main?.reveal();hasRun=true;hasSearched=true;const token=++run,node=section;let frames=0;
  const show=()=>{if(token!==run||node!==section)return;if(node.isConnected)present(cached,p,node,token).catch(()=>{});else if(++frames<300)requestAnimationFrame(show);};show();}
}
let mountFrame=null;const scheduleMount=()=>{if(mountFrame===null)mountFrame=requestAnimationFrame(()=>{mountFrame=null;mount();});};
const picker=document.getElementById('placeSheet');if(picker){new MutationObserver(scheduleMount).observe(picker,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','aria-selected']});picker.addEventListener('close',()=>{if(picker.open)return;if(mainWorkspace()){scheduleMount();return;}stop();run++;hasSearched=false;if(dateCalendar?.open)dateCalendar.close();AstroNotesCandidatePicker.suspend?.();section?.remove();section=null;condition='';});}
let observedScene=null,previewObserver=null;
function watchPreview(){const scenePanel=document.getElementById('exploreScenePanel');if(!scenePanel||scenePanel===observedScene)return;previewObserver?.disconnect();observedScene=scenePanel;previewObserver=new MutationObserver(()=>{const host=scenePanel.querySelector('#aimLook');if((scenePanel.hidden||scenePanel.hasAttribute('data-loading')||host?.hidden)&&scenePanel.querySelector('#trialComposition[open],#trialRecordSaveSheet[open]'))document.dispatchEvent(new Event('astronotes-preview-leave'));syncObserverMap();scheduleMount();});previewObserver.observe(scenePanel,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','data-loading']});}
// The shared bar owns the selected instant. This adapter only owns cancellation
// and the pending search intent while its native ruler is moving.
document.addEventListener('astronotes-candidate-date-change',event=>{
 if(!mainWorkspace()?.active())return;
 const {changed,settled}=event.detail;
 if(!changed&&!dateRefreshPending)return;
 const repeat=hasSearched||dateRefreshPending;dateRefreshPending=repeat&&!settled;
 returnSearch=null;stop();run++;mount();
 if(mainWorkspace()?.separateRecords||!repeat||!settled)return;
 const selected=snapshot(),identity=uiKey(selected);
 autoSearchTimer=setTimeout(()=>{autoSearchTimer=null;const latest=snapshot();if(!selected||!contextActive()||uiKey(latest)!==identity||engine.cached(latest))return;const button=document.getElementById('candidateSearchAction');if(button&&!button.disabled&&button.dataset.state!=='searching')button.click();},350);
});
document.addEventListener('astronotes-preview-leave',()=>{const button=document.getElementById('trialRecordSave');if(button)button.hidden=true;const dialog=document.getElementById('trialRecordSaveSheet');if(dialog?.open){dialog.restoreRecordFocus=false;dialog.close();}});
document.addEventListener('astronotes-search-state',scheduleMount);document.addEventListener('astronotes-composition-change',mount);mount();
})();
