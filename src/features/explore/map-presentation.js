import {S} from '../../app/presentation-helpers.js';
import {place,setSkyMapUI,store} from '../../app/browser-state.js';
import {blendBodyState,moonGlyphAt} from '../forecast/view.js';
import {applyRoute,navigationHistory,routeFromHash} from '../../app/navigation.js';
import {PLACE_PICKERS,favForPoint,renderPointCard} from '../places/controller.js';
import {createMapView} from '../../ui/map/picker.js';
import {aim,aimElevCache,aimFavTarget,aimFavTargets,aimFillSelects,aimIsMountain,aimLimbValue,aimMapLabel,aimWithHeights} from '../framing/controller.js';
import {aimAppendCandidatePage,aimBuildingDays,aimCalGridHtml,aimCalRows,aimCalSolid,aimCandidatePageEnd,aimCandidateSearchEnd,aimDaysInputKey,aimFromPoint,aimObserverAt,aimObserverEye,aimSavedFrom,aimShootingView,candidateDatesAppend,candidateDatesMarkup,candidateWaitMarkup} from '../framing/observer.js';
import {aimLookKey} from '../framing/reverse-and-entry.js';
import {openPlaceSheet} from '../../services/place-search.js';
import {allowedTools,apiTransport,auth,renderTools,screenAllowed,toolAllowed} from '../account/session-and-access.js';
import {showSheet} from '../../app/overlays.js';
import {UI_ICONS} from '../../ui/visual-primitives.js';

(()=>{
 document.addEventListener("click",e=>{if(e.target.closest("#aimView [data-cand],#aimView [data-day],#aimView [data-from-day],#aimCalendar [data-cal-day],#aimView [data-limb],#aimHeightSet,#aimCustomSet,#aimPrev,#aimNext"))aim.plannerTransfer=null;},true);
 const el=id=>document.getElementById(id),view=el('skyMapView');
 let pending=null,suspended=null;const active=()=>!view.hidden;
 const mapLabel=(ctx,x,y,text,colour,width,height,place)=>{ctx.save();ctx.translate(52,0);aimMapLabel(ctx,x-52,y,text,colour,Math.max(100,width-112),height,place);ctx.restore();};
 const map=createMapView({canvas:'skyMapCanvas',zoomIn:'skyMapIn',zoomOut:'skyMapOut'});
 let session=null,seq=0,frame=0,targetOn=true,pickMode=null,targetSeq=0,mapWide=false,timelineMoving=false;
 const targetSheet=el("skyMapTargetSheet");
 // 太陽は日の出・日の入（アプリ全体の言い方）。ほかの天体は「月の出」「金星の入」
 const riseSetName=(body,side)=>body==='sun'?(side==='rise'?'日の出':'日の入'):`${bodyName(body)}の${side==='rise'?'出':'入'}`;
 let accessToken=null,accessTools=[],accessSeq=0,accessPromise=null,checkingToken=null,lastAuthKey='';
 const skyStoreKey=()=> 'sorami.skyMap:'+encodeURIComponent(auth?.loginId||'guest');
 const authKey=()=>JSON.stringify([auth?.token,auth?.loginId,allowedTools()]);
 const hasAccess=()=>!!auth?.token&&accessToken===auth.token&&toolAllowed('skymap');
 const canTransfer=()=>!!session?.target&&AstroNotesAccess.canFrame(toolAllowed,session.target.id,session.body);
 const mapTargets=()=>[...AstroNotesAlign.TARGETS.map(t=>aimWithHeights(t)),...aimFavTargets().map(aimFavTarget),...(session?.customTarget?[session.customTarget]:[])].filter(t=>!session?.sharedTarget||t.id!==session.sharedTarget.id).concat(session?.sharedTarget?[session.sharedTarget]:[]).filter(validPoint);
 const showAccess=(message,retry=false)=>{el('skyMapContent').hidden=true;el('skyMapAccess').hidden=false;el('skyMapAccessMessage').textContent=message;el('skyMapAccessRetry').hidden=!retry;el('skyMapAccessLogin').hidden=!!auth?.token;};
 function authChanged(){const key=authKey();if(key===lastAuthKey)return;lastAuthKey=key;if(!active())return;if(!auth?.token||(session&&!toolAllowed('skymap'))){leave(false);showAccess(auth?'地図の利用が許可されていません':'ログインすると利用権限を確認できます');}else open(true);}
 function open(force=false){
  if(!active())return;
  if(session&&hasAccess()&&!pending&&!force){map.redraw();return;}
  if(accessPromise&&checkingToken===auth?.token&&!force)return accessPromise;
  leave(false,false,true);lastAuthKey=authKey();
  if(!auth?.token){showAccess('ログインすると利用権限を確認できます');return;}
  const token=auth.token,request=++accessSeq;checkingToken=token;showAccess('利用権限を確認しています…');
  accessPromise=(async()=>{try{
   const result=await apiTransport('GET','/tools/skymap/access');
   if(request!==accessSeq||token!==auth?.token||!active())return;
   if(result?.allowed!==true||result.tool!=='skymap'||!Array.isArray(result.tools)||!result.tools.includes('skymap'))throw Error('利用権限を確認できません。再試行してください');
   auth={...auth,loginId:result.loginId||auth.loginId,role:result.role||auth.role,tools:result.tools};accessToken=token;accessTools=result.tools;lastAuthKey=authKey();renderTools();
   el('skyMapContent').hidden=false;el('skyMapAccess').hidden=true;start();
  }catch(e){if(request===accessSeq&&token===auth?.token&&active()){leave(false,false);showAccess(/[ぁ-んァ-ヶ一-龠]/.test(e?.message||'')?e.message:'利用権限を確認できません。再試行してください',true);}}finally{if(request===accessSeq){accessPromise=null;checkingToken=null;}}})();return accessPromise;
 }
 el('skyMapAccessRetry').onclick=()=>open(true);el('skyMapAccessLogin').onclick=()=>el('authButton').click();
 const allowed=()=>hasAccess();
 function syncBodies(){for(const o of el('skyMapBody').options)o.hidden=o.disabled=!allowed(o.value);if(!allowed(session.body))session.body=AstroNotesBodies.definitions.find(d=>allowed(d.id))?.id||'sun';el('skyMapBody').value=session.body;}
 const textAt=at=>S.JstCal.hhmm(at);
 const dateAt=at=>new Date(at+32400000).toISOString().slice(0,10);
 const validPoint=p=>!!p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude);
 const pointKey=o=>o?JSON.stringify([o.latitude,o.longitude,o.groundManualM??o.elevation,aimObserverEye(o)]):'';
 function skyState(body,at,o){const s=body==='sun'?AstroNotesAstro.sun(at,o):body==='moon'?AstroNotesAstro.moon(at,o):AstroNotesBodies.state(body,at,o,{refraction:false});return {...s,altitude:s.geometricAltitude??s.altitude};}
 const currentState=()=>session.dailies?.[session.body]?skyState(session.body,session.at,session.eye):null;
 function save(){if(!hasAccess()||timelineMoving)return;store.set(skyStoreKey(),{body:session.body,at:session.at,observer:session.observer,sharedTarget:session.sharedTarget||null,targetId:session.target?.id||'',partId:session.partId,limb:session.limb,matchMode:session.matchMode,showSun:session.showSun,showMoon:session.showMoon,extraBody:session.extraBody,primaryBody:session.primaryBody,scrubMode:session.scrubMode,custom:session.custom||null,mapCenter:map.center(),zoom:map.zoom()});}
 const COLOURS={sun:'#ff981f',moon:'#aad8ff',extra:'#8ce5b0'};
 const extraIds=['sirius','mercury','venus','mars','jupiter','saturn'].filter(id=>AstroNotesBodies.definitions.some(d=>d.id===id));
 const bodiesSheet=el('skyMapBodiesSheet');
 const shownBodies=()=>{const visible=[...(session.showSun?['sun']:[]),...(session.showMoon?['moon']:[]),...(session.extraBody?[session.extraBody]:[])];return [...new Set([...(visible.includes(session.body)?[session.body]:[]),...visible])];};
 function drawBody(ctx,body,data,x,y,r,width,height){
  const xy=az=>[x+Math.sin(az*Math.PI/180)*r,y-Math.cos(az*Math.PI/180)*r];
  const main=body===session.body||shownBodies().length===1,colour=(typeof getComputedStyle==='function'?getComputedStyle(document.documentElement).getPropertyValue(body==='moon'?'--ray-moon':body==='sun'?'--ray-sun':'--ray-extra').trim():'')||COLOURS[body]||COLOURS.extra;
  ctx.globalAlpha=main?1:.6;ctx.strokeStyle=colour;ctx.lineWidth=main?3:2;
  // Each segment uses the short azimuth arc; there is no fictitious ground trajectory.
  for(let i=1;i<data.points.length;i++){const a=data.points[i-1],b=data.points[i];if(Math.abs(AstroNotesSkyMap.delta(b.azimuth,a.azimuth))>20)continue;if(a.altitude<0&&b.altitude<0)continue;ctx.beginPath();const p=xy(a.azimuth),q=xy(b.azimuth);ctx.moveTo(...p);ctx.lineTo(...q);ctx.stroke();}
  // Rise/set directions run past the ring so the landmarks along them can be read on the map.
  const far=Math.hypot(width,height),ray=(az,k)=>[x+Math.sin(az*Math.PI/180)*k,y-Math.cos(az*Math.PI/180)*k];
  for(const event of data.events){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(...ray(event.azimuth,far));ctx.globalAlpha=1;ctx.setLineDash(event.side==='rise'?[]:[9,6]);ctx.strokeStyle='rgba(0,0,0,.85)';ctx.lineWidth=main?6:5;ctx.stroke();ctx.strokeStyle=colour;ctx.lineWidth=main?3:2.5;ctx.stroke();ctx.setLineDash([]);}
  const b=session.blend,st=b?blendBodyState(skyState(body,b.from,session.eye),skyState(body,b.to,session.eye),b.f):skyState(body,session.at,session.eye),p=xy(st.azimuth);ctx.lineWidth=main?3:2;ctx.setLineDash(st.altitude<0?[5,4]:[]);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(...p);ctx.stroke();ctx.setLineDash([]);AstroNotesSceneAppearance.aimLookDisc(ctx,p[0],p[1],main?9:7,body,{illuminated:st.illuminatedFraction,brightLimbZenithAngle:st.brightLimbZenithAngle});
  ctx.globalAlpha=1;
 }
 const bodyName=id=>(AstroNotesBodies.definitions.find(d=>d.id===id)||{}).name||(id==='sun'?'太陽':id==='moon'?'月':id);
 function drawPin(ctx,x,y,colour){ctx.save();ctx.fillStyle=colour;ctx.strokeStyle="#222";ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y-8,7,Math.PI,0);ctx.lineTo(x,y+6);ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(x,y-8,2,0,Math.PI*2);ctx.fill();ctx.restore();}
 function draw(ctx,{project,width,height}){
  if(!hasAccess()||!session)return;
  try{window.MyPlacesUI?.skyDraw(ctx,{project,width,height},session,pickMode);}catch{/* trial */}
  if(!validPoint(session.observer)&&!pickMode){if(targetOn&&validPoint(session.target)){const mark=AstroNotesAlign.partTarget(session.target,session.partId),q=project(mark.latitude,mark.longitude);drawPin(ctx,...q,'#c876ff');mapLabel(ctx,q[0],q[1]-25,session.target.name,'#fff',width,height,'center');}return;}
  const [x,y]=pickMode?[width/2,height/2]:project(session.observer.latitude,session.observer.longitude),r=Math.min(width,height)*.36;
  ctx.save();ctx.font='12px system-ui';ctx.textAlign='left';ctx.lineWidth=1;ctx.strokeStyle='rgba(0,0,0,.45)';ctx.fillStyle='#fff';
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.strokeStyle='rgba(0,0,0,.85)';ctx.lineWidth=4;ctx.stroke();ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=1.8;ctx.stroke();
ctx.lineWidth=1;
  for(const az of [0,90,180,270]){const a=az*Math.PI/180;ctx.beginPath();ctx.moveTo(x+Math.sin(a)*(r-4),y-Math.cos(a)*(r-4));ctx.lineTo(x+Math.sin(a)*(r+4),y-Math.cos(a)*(r+4));ctx.stroke();}
  if(!pickMode&&session.eye&&session.eye.latitude===session.observer.latitude&&session.eye.longitude===session.observer.longitude)for(const body of shownBodies().reverse())if(session.dailies?.[body]||body==='sun'||body==='moon'||AstroNotesBodies.ready())drawBody(ctx,body,session.dailies?.[body]||AstroNotesSkyMap.daily(body,AstroNotesSkyMap.dayStart(session.at),session.eye,skyState),x,y,r,width,height);
  if(pickMode==='target')for(const candidate of mapTargets().filter(validPoint)){const q=project(candidate.latitude,candidate.longitude);if(q[0]<0||q[0]>width||q[1]<0||q[1]>height||candidate.id===session.target?.id)continue;drawPin(ctx,...q,'#c876ff');mapLabel(ctx,q[0],q[1]-24,candidate.name,'#fff',width,height,'center');}
  const t=session.target;
  if(!pickMode&&targetOn&&validPoint(t)){
   const mark=AstroNotesAlign.partTarget(t,session.partId),q=project(mark.latitude,mark.longitude);ctx.strokeStyle='rgba(0,0,0,.9)';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(...q);ctx.stroke();ctx.strokeStyle='#c876ff';ctx.lineWidth=4;ctx.stroke();drawPin(ctx,...q,'#c876ff');mapLabel(ctx,q[0],q[1]-25,t.name,'#fff',width,height,'center');
  }
  ctx.lineWidth=3;ctx.strokeStyle='#111';ctx.beginPath();ctx.moveTo(x-8,y);ctx.lineTo(x-2,y);ctx.moveTo(x+2,y);ctx.lineTo(x+8,y);ctx.moveTo(x,y-8);ctx.lineTo(x,y-2);ctx.moveTo(x,y+2);ctx.lineTo(x,y+8);ctx.stroke();ctx.lineWidth=1;ctx.strokeStyle='#fff';ctx.stroke();ctx.beginPath();ctx.arc(x,y,1,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();mapLabel(ctx,x,y+20,pickMode==='target'?'対象':'撮影地点','#fff',width,height,'center');  for(const [name,az] of [['北',0],['東',90],['南',180],['西',270]]){const a=az*Math.PI/180,tx=x+Math.sin(a)*(r+10),ty=y-Math.cos(a)*(r+10);ctx.save();ctx.font='bold 14px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.strokeStyle='rgba(0,0,0,.95)';ctx.lineWidth=4;ctx.strokeText(name,tx,ty);ctx.fillStyle='#fff';ctx.fillText(name,tx,ty);ctx.restore();}ctx.restore();
 }
 // Sync may finish after the map is already usable. Refresh choices, not the observer or date.
 function refreshTargets(){
  if(!session||!hasAccess())return;
  const targets=mapTargets(),select=el('skyMapTarget'),id=session.target?.id;
  select.replaceChildren(new Option('対象を選ぶ',''));
  for(const t of targets)select.add(new Option(t.name,t.id));
  if(id){session.target=targets.find(t=>t.id===id)||null;targetOn=!!session.target;}
  select.value=session.target?.id||'';render();
 }
 function renderPassages(){
  const row=el('skyMapPassages'),t=session?.target,bodies=shownBodies(),top=validPoint(t)?AstroNotesAlign.partOf(t,session.partId)?.m:null,key=JSON.stringify([top,AstroNotesSkyMap.dayStart(session.at),session.eye,session.observer?.latitude,session.observer?.longitude,t?.id,t?.latitude,t?.longitude,session.partId,targetOn,bodies,!!session.daily,!!session.passError]);if(row._passageKey===key)return;row._passageKey=key;row.replaceChildren();
  if(!targetOn||!validPoint(t)||!validPoint(session.observer))return;
  const head=document.createElement('div');head.className='sky-map-passages-head';const label=document.createElement('span');label.className='sky-map-passages-label';label.textContent=bodies.length?'対象の方位を通過':'対象';head.append(label);const angle=document.createElement('span');angle.className='sky-map-target-angle';const geo=session.daily&&session.eye?AstroNotesAlign.geometryFrom(session.eye,t,{partId:session.partId,eyeM:0}):null;angle.textContent=geo?`対象の仰角 ${AstroNotesAstro.targetElevationAngle(geo.distanceKm,session.eye.elevation,geo.topM,{k:1}).toFixed(2)}°`:'対象の仰角 —';head.append(angle);row.append(head);if(!bodies.length)return;
  if(!session.daily||!session.eye){const wait=document.createElement('span');wait.className='tiny';wait.textContent=session.passError?'計算できません':'計算中…';row.append(wait);return;}
  const mark=AstroNotesAlign.partTarget(t,session.partId);const distance=AstroNotesTerrain.distanceKm(session.observer.latitude,session.observer.longitude,mark.latitude,mark.longitude);
  if(distance<.001){const none=document.createElement('span');none.className='tiny';none.textContent='撮影地点と対象が同じ位置';row.append(none);return;}
  const values=document.createElement('div');values.className='sky-map-passages-values';row.append(values);const prefix=document.createElement('span');prefix.className='sky-map-passage-prefix';prefix.textContent='通過';values.append(prefix);const bearing=geo?.azimuth??AstroNotesTerrain.bearing(session.observer.latitude,session.observer.longitude,mark.latitude,mark.longitude);
  for(const body of bodies){if(!session.dailies?.[body]){const unavailable=document.createElement('span');unavailable.className='tiny';unavailable.textContent=`${bodyName(body)} 計算できません`;values.append(unavailable);continue;}const icon=body==='sun'?'☀':body==='moon'?'月':bodyName(body),passes=AstroNotesSkyMap.passages(session.dailies?.[body],bearing,body,session.eye,skyState);
   if(!passes.length){const none=document.createElement('span');none.className='tiny';none.textContent=`${icon} 通過なし`;values.append(none);continue;}
   for(const pass of passes){const b=document.createElement('button');b.type='button';b.className='chip';b.textContent=`${body==='moon'?'':icon} ${textAt(pass.at)}・${pass.altitude.toFixed(1)}°`;if(body==='moon')b.insertAdjacentHTML('afterbegin',moonGlyphAt(pass.at,session.eye));b.setAttribute('aria-label',`${bodyName(body)}が対象の方位を通過 ${textAt(pass.at)}、高度 ${pass.altitude.toFixed(1)}度`);b.onclick=()=>{if(!hasAccess()||!session?.dailies?.[body])return;session.body=body;if(['sun','moon'].includes(body))session.primaryBody=body;el('skyMapBody').value=body;session.daily=session.dailies[body];setTime(pass.at);};values.append(b);}
  }
 }
 let dateEntry=null;
 function renderCandidateDates(){
  const box=el('skyMapDates'),plan=session;
  if(!plan||!hasAccess()||!active())return;
  const f=plan.observer;
  const ready=validPoint(f)&&!!(plan.target?.parts||[]).length;box.closest('.sky-map-candidates').hidden=!ready;
  if(!ready){dateEntry=null;box.replaceChildren();return;}
  const inputKey=aimDaysInputKey(f,Date.now(),plan),key=JSON.stringify([inputKey,plan.ground]);
  if(!dateEntry||dateEntry.key!==key||Date.now()>=dateEntry.until){
   dateEntry=null;box.innerHTML=candidateWaitMarkup();
   if(!plan.dailies?.[plan.body]||!plan.eye){if(plan.passError)box.innerHTML='<p class="tiny" role="status">候補日時を計算できません。下の再試行からやり直してください。</p>';return;}
   const now=Date.now(),obs=aimObserverAt(f,plan.ground),snapshot={target:plan.target,body:plan.body,partId:plan.partId,limb:plan.limb,matchMode:plan.matchMode};
   const entry={key,inputKey,origin:now,until:Infinity,searchedUntil:S.Cal.startOfDay(now),rows:null,morePromise:null,error:false,obs,snapshot};dateEntry=entry;
   const current=()=>session===plan&&hasAccess()&&active()&&dateEntry===entry&&Date.now()<entry.until&&entry.inputKey===aimDaysInputKey(session.observer,Date.now(),session);
   entry.current=current;
   entry.promise=aimBuildingDays(obs,snapshot.target,snapshot.body,snapshot.partId,null,{from:now,limb:snapshot.limb,matchMode:snapshot.matchMode,isCurrent:current,onScanned:end=>{entry.searchedUntil=end;}}).then(rows=>{
    if(!current())return;entry.rows=rows;entry.until=S.Cal.startOfDay(now)+86400000;renderCandidateDates();
   }).catch(()=>{if(current()){entry.error=true;renderCandidateDates();}});
   return;
  }
  const entry=dateEntry;
  if(entry.error){box.innerHTML='<p class="tiny" role="status">候補日時を計算できませんでした。</p><button type="button" class="fav-btn" data-dates-retry>再試行</button>';box.querySelector('[data-dates-retry]').onclick=()=>{dateEntry=null;renderCandidateDates();};return;}
  if(!entry.rows)return;
  // Timeline movement only updates selection; it does not replace buttons under a finger.
  // A continuation of the same entry appends to the strip and keeps its scroll position.
  if(box._dateEntry!==entry||box._dateRows!==entry.rows||box._dateMore!==entry.morePromise){
   const left=box._dateEntry===entry?box.querySelector('.aim-days.strip')?.scrollLeft:null;
   if(box._dateEntry!==entry||!candidateDatesAppend(box,entry.rows,entry,plan,plan.at))box.innerHTML=candidateDatesMarkup(entry.rows,entry,plan,plan.at);box._dateEntry=entry;box._dateRows=entry.rows;box._dateMore=entry.morePromise;
   const more=box.querySelector('[data-from-more]');if(more)more.onclick=moreCandidateDates;
   // In the time bar the next search sits after the last date: it is reached by scrolling to the end.
   const strip=box.querySelector('.aim-days.strip');
   if(more&&strip&&box.closest('.tool-datetime-footer')){strip.append(more);if(Number.isFinite(left))strip.scrollLeft=left;}
   for(const button of box.querySelectorAll('[data-from-day]'))button.onclick=()=>{if(entry.current())setTime(+button.dataset.fromAt);};
  }
  for(const button of box.querySelectorAll('[data-from-day]'))button.setAttribute('aria-pressed',String(S.JstCal.sameDay(+button.dataset.fromDay,plan.at)));
 }
 async function moreCandidateDates(){
  const entry=dateEntry;if(!entry?.rows||entry.morePromise||!entry.current()||Date.now()>=entry.until)return renderCandidateDates();
  const from=entry.searchedUntil,end=aimCandidatePageEnd(from);if(from>=end)return;
  const p=entry.snapshot;entry.error=false;let scanned=from;
  entry.morePromise=aimBuildingDays(entry.obs,p.target,p.body,p.partId,null,{from,days:Math.ceil((end-from)/86400000),limit:4,limb:p.limb,matchMode:p.matchMode,isCurrent:entry.current,onScanned:value=>{scanned=value;}});
  renderCandidateDates();
  try{const rows=await entry.morePromise;if(entry.current()){aimAppendCandidatePage(entry,rows,scanned);}}
  catch{if(entry.current())entry.moreError=true;}
  finally{entry.morePromise=null;if(entry.current()){renderCandidateDates();if(entry.moreError){const b=el('skyMapDates').querySelector('[data-from-more]');if(b)b.textContent='計算できませんでした。再試行';entry.moreError=false;}}}
 }
 function renderObserverHeight(){
  const o=session?.observer,details=el('skyMapObserverDetails');details.hidden=!validPoint(o);
  if(details._observer!==o){details._observer=o;el('skyMapHeightError').hidden=true;}
  if(!validPoint(o))return;
  const ground=o.groundManualM??session.ground,eye=aimObserverAt(o,ground).eyeM;
  {const values=document.createElement('span');values.className='height-summary-values';values.textContent='：標高 '+(Number.isFinite(ground)?ground.toFixed(1)+'m':'未取得')+'・地上から '+eye+'m';el('skyMapObserverSummary').replaceChildren('高さ',values);}
  for(const [id,value] of [['skyMapGroundHeight',ground],['skyMapStandHeight',eye]]){const input=el(id);input.disabled=false;input.placeholder=id==='skyMapGroundHeight'?'標高を入力':'地上からを入力';if(document.activeElement!==input)input.value=Number.isFinite(value)?String(value):'';}
  el('skyMapGroundAuto').disabled=!Number.isFinite(o.groundManualM);el('skyMapStandAuto').disabled=!Number.isFinite(o.standAglM)&&!Number.isFinite(o.observationElevationM);
 }
 function normalizeWholeAlignment(){
  if(!session)return;
  // Explicit shared/history/manual alignment must survive map refresh and scene projection.
  if(session.matchMode==='limb'&&(session.partId==='__whole'||session.target?.parts?.some(p=>p.id===session.partId))){if(session.partId==='__whole')session.limb='center';return;}
  session.matchMode='overlap';session.partId=aimIsMountain(session.target)?null:'__whole';session.limb='center';
 }
 function render(){
  normalizeWholeAlignment();
  queueMicrotask(()=>globalThis.TrialExplore?.sync());
  renderObserverHeight();
  if(!hasAccess()||!session||!active())return;
  renderCandidateDates();
  const observer=session.observer;el('skyMapObserverClear').hidden=!validPoint(observer);
  renderPointCard('skyMapObserver',validPoint(observer)?observer:null,session.ground,{ids:{name:'skyMapObserver',sub:'skyMapObserverSub',fav:'skyMapObserverFav'}});
  el('skyMapObserverFav').hidden=!validPoint(observer);
  el('skyMapShowSun').setAttribute('aria-pressed',String(session.showSun));el('skyMapShowMoon').setAttribute('aria-pressed',String(session.showMoon));
  el('skyMapClearExtra').hidden=!session.extraBody;el('skyMapMoreBodies').setAttribute('data-active',String(!!session.extraBody));el('skyMapExtraName').textContent=session.extraBody?bodyName(session.extraBody):'';el('skyMapMoreBodies').setAttribute('aria-label',session.extraBody?`その他の天体を選ぶ、${bodyName(session.extraBody)}を表示中`:'その他の天体を選ぶ');
  for(const id of [...extraIds,'none'])el('skyMapExtra-'+id).setAttribute('aria-pressed',String(id===(session.extraBody||'none')));
  el('skyMapDate').value=dateAt(session.at);el('skyMapTime').value=textAt(session.at);syncScrubRange();
  ToolDateTimeBar.dateText(el('skyMapCalendarOpen'),session.at);el('skyMapCalendarOpen').setAttribute('aria-label',ToolDateTimeBar.label(session.at));renderPassages();try{globalThis.MyPlacesUI?.skyRender(session);}catch(e){const box=el('mySkyPlaces');if(box)box.textContent='撮影地点を確認できません。地図を開き直して再試行してください';}if(!session.daily||!session.eye){el('skyMapAngles').replaceChildren();el('skyMapDetailInfo').textContent=validPoint(observer)?session.timelinePending?'日時を調整しています':'':'撮影地点を選ぶと天体の方向と見え方を確認できます';if(!validPoint(observer))el('skyMapTargetInfo').textContent='';map.redraw();save();return;}const st=currentState();
  el('skyMapRange').setAttribute('aria-valuetext',session.scrubMode==='date'?ToolDateTimeBar.label(session.at):textAt(session.at));
  el('skyMapAngles').replaceChildren(...shownBodies().filter(body=>session.dailies[body]).map(body=>{const v=body===session.body?st:skyState(body,session.at,session.eye),d=document.createElement('div');const alt=v.altitude.toFixed(2).replace(/^-(0\.00)$/,'$1');d.textContent=`${bodyName(body)}　方位 ${v.azimuth.toFixed(1)}° ・ 高度 ${alt}°${body==='moon'?' ・ 輝面 '+Math.round(v.illuminatedFraction*100)+'%':''}${+alt<0?' ・ 地平線の下':''}`;if(body==='moon')d.insertAdjacentHTML('afterbegin',moonGlyphAt(session.at,session.eye)+' ');if(body!==session.body&&shownBodies().length>1)d.className='tiny';return d;}));
  const t=session.target;
  if(validPoint(t)&&targetOn){const geo=AstroNotesAlign.geometryFrom(session.eye,t,{partId:session.partId,eyeM:0});const bearing=geo?.azimuth??AstroNotesTerrain.bearing(session.observer.latitude,session.observer.longitude,t.latitude,t.longitude);el('skyMapTargetInfo').textContent=`${t.name}：方位 ${bearing.toFixed(1)}° ・ ${geo?'仰角 '+AstroNotesAstro.targetElevationAngle(geo.distanceKm,session.eye.elevation,geo.topM,{k:1}).toFixed(2)+'°':'高さ未設定'}${geo?' ・ 距離 '+(geo.distanceKm<1?Math.round(geo.distanceKm*1000)+'m':geo.distanceKm.toFixed(2)+'km')+' ・ 対象の標高 '+geo.topM.toFixed(1)+'m（目から '+(geo.topM-session.eye.elevation).toFixed(1)+'m）':''}${st?' ・ 天体との方位差 '+AstroNotesSkyMap.delta(st.azimuth,bearing).toFixed(1)+'°':' ・ 選択天体は計算できません'}`;}
  else el('skyMapTargetInfo').textContent='対象なしでも天体の方向を確認できます';
  el('skyMapDetailInfo').textContent=el('skyMapTargetInfo').textContent+'\n'+Array.from(el('skyMapEvents').children).map(e=>e.textContent).join(' ・ ');map.redraw();save();
 }
 function setTime(at,preservePlayback=false){if(!hasAccess()||!session||!Number.isFinite(at))return;if(!preservePlayback)skyPlayback?.stop(false);else skyPlayback?.rebase(at);const changed=AstroNotesSkyMap.dayStart(at)!==AstroNotesSkyMap.dayStart(session.at);session.at=at;timelineMoving=false;if(changed||session.timelinePending)refresh();render();}
 async function refresh(){
  if(!hasAccess()||!session)return;
  normalizeWholeAlignment();
  if(!validPoint(session.observer)){seq++;session.eye=null;session.daily=null;session.dailies=null;session.ground=null;session.timelinePending=false;session.passError=false;el('skyMapEvents').replaceChildren();el('skyMapStatus').textContent='';el('skyMapRetry').hidden=true;render();return;}
  const request=++seq;session.timelinePending=false;session.passError=false;session.daily=null;session.dailies=null;for(const button of el('skyMapEvents').children)if(button.type==='button')button.disabled=true;el('skyMapStatus').textContent='天体の位置を計算しています…';el('skyMapRetry').hidden=true;render();
  try{
   const requestedBodies=[...new Set([session.body,...shownBodies()])],loaded=await Promise.allSettled(requestedBodies.map(body=>AstroNotesBodies.ensure(body)));if(request!==seq||!hasAccess()||!active())return;
   const readyBodies=requestedBodies.filter((_,i)=>loaded[i].status==='fulfilled'),failedBodies=requestedBodies.filter((_,i)=>loaded[i].status==='rejected');if(!readyBodies.length)throw Error('body load failed');
   const o=session.observer;let ground=o.groundManualM??session.ground;
   if(!Number.isFinite(ground)){try{ground=await AstroNotesTerrain.groundElevation(o.latitude,o.longitude);}catch{ground=null;}}
   if(request!==seq||!hasAccess()||!active())return;
   session.ground=ground;if(Number.isFinite(ground)&&!Number.isFinite(o.groundManualM))aimElevCache.set(`${o.latitude.toFixed(6)},${o.longitude.toFixed(6)}`,ground);const obs=aimObserverAt(o,ground);session.eye={latitude:obs.latitude,longitude:obs.longitude,elevation:obs.elevation+obs.eyeM};
   const day=AstroNotesSkyMap.dayStart(session.at);session.dailies=Object.fromEntries(readyBodies.map(body=>[body,AstroNotesSkyMap.daily(body,day,session.eye,skyState)]));session.daily=session.dailies[session.body]||Object.values(session.dailies)[0];
   const coords=`${o.latitude.toFixed(5)}, ${o.longitude.toFixed(5)}`;el('skyMapObserver').textContent=o.name&&o.name!==coords?o.name:'撮影地点';el('skyMapObserverSub').textContent=coords;
   el('skyMapEvents').replaceChildren();for(const body of shownBodies()){if(!session.dailies[body])continue;const events=session.dailies[body].events;if(!events.length){const n=document.createElement('span');n.className='tiny';n.textContent=`${bodyName(body)}：この日は出入りなし`;el('skyMapEvents').append(n);continue;}for(const event of events){const b=document.createElement('button');b.className='chip';b.type='button';b.textContent=`${body==='sun'?'☀':body==='moon'?'月':bodyName(body)}${event.side==='rise'?'出':'入'} ${textAt(event.at)}`;if(body==='moon'){b.textContent=`${event.side==='rise'?'出':'入'} ${textAt(event.at)}`;b.insertAdjacentHTML('afterbegin',moonGlyphAt(event.at,session.eye));}b.setAttribute('aria-label',`${riseSetName(body,event.side)} ${textAt(event.at)}・方位 ${event.azimuth.toFixed(1)}度`);b.onclick=()=>setTime(event.at);el('skyMapEvents').append(b);}}
   el('skyMapStatus').textContent=[failedBodies.length?`${failedBodies.map(bodyName).join('・')}の計算を読み込めませんでした。再試行してください`:'',!Number.isFinite(ground)?'標高を取得できません。標高0mとして計算しています':''].filter(Boolean).join(' ');el('skyMapRetry').hidden=Number.isFinite(ground)&&!failedBodies.length;render();
  }catch{if(request===seq){session.passError=true;renderPassages();el('skyMapStatus').textContent='天体の計算を読み込めませんでした。再試行してください';el('skyMapRetry').hidden=false;}}
 }
 function enter(fromAim=false,exactAt=null){
  const look=el('aimLook'),spec=look._lookSpec,from=aimFromPoint();
  const transfer=aim.plannerTransfer;
  const transferredAt=fromAim&&from&&transfer?.body===aim.body&&transfer.day===AstroNotesSkyMap.dayStart(aim.dayMs)&&Math.abs(transfer.latitude-from.latitude)<1e-7&&Math.abs(transfer.longitude-from.longitude)<1e-7?transfer.at:null;
  const live=fromAim&&!!from&&!look.hidden&&look._planKey===aimLookKey()&&spec&&Number.isFinite(look._lookAt);
  pending=fromAim?{ownerToken:auth?.token,sharedTarget:aim.sharedTarget?structuredClone(aim.sharedTarget):null,custom:aim.target?.id==='custom'?store.get('sorami.aimCustom',null):null,observer:live?{...from,latitude:spec.obs.latitude,longitude:spec.obs.longitude,groundManualM:from.groundManualM??null,standAglM:spec.eyeM===aimObserverEye(from)?from.standAglM??null:spec.eyeM,name:spec.observerName||from.name}:from,body:aim.body,showSun:aim.body==='sun',showMoon:aim.body==='moon',at:Number.isFinite(exactAt)?exactAt:Number.isFinite(aim.pendingPlan?.at)?aim.pendingPlan.at:live?look._lookAt:Number.isFinite(transferredAt)?transferredAt:Number.isFinite(aim.dayMs)?aim.dayMs+43200000:Date.now(),targetId:aim.target?.id||'',partId:aim.partId,limb:aim.partId==='__whole'?'center':aim.limb,matchMode:aim.matchMode||'limb',ground:live?spec.obs.elevation:null}:null;
  navigationHistory.pushRoute(globalThis.TrialExplore&&screenAllowed('skymap')&&screenAllowed('framing')?'#/explore':'#/skymap');
 }
 function start(){
  if(session&&active()&&!pending){map.redraw();return;}
  const resume=suspended?.token===auth?.token&&suspended?.loginId===auth?.loginId?suspended:null;suspended=null;
  const saved=store.get(skyStoreKey(),null)||(store.get('sorami.owner',null)===auth?.loginId?store.get('sorami.skyMap',null):null),draft=(pending&&pending.ownerToken===auth?.token?pending:null)||saved;pending=null;
  const sharedTarget=validPoint(draft?.sharedTarget)&&draft.sharedTarget.parts?.length?draft.sharedTarget:null;
  const list=mapTargets().filter(t=>!sharedTarget||t.id!==sharedTarget.id).concat(sharedTarget?[sharedTarget]:[]).filter(validPoint);
  const custom=draft?.custom||null,customTarget=custom?{id:'custom',name:custom.name,...custom,parts:[{id:'tip',name:'てっぺん',m:custom.topM}]}:null;
  const target=customTarget&&draft?.targetId==='custom'?customTarget:list.find(t=>t.id===draft?.targetId)||null;
  session={sharedTarget,scrubMode:['date','hour','time'].includes(saved?.scrubMode)?saved.scrubMode:'time',dayAnchor:AstroNotesSkyMap.dayStart(Number.isFinite(draft?.at)?draft.at:Date.now()),showSun:typeof draft?.showSun==='boolean'?draft.showSun:saved?.showSun!==false,showMoon:typeof draft?.showMoon==='boolean'?draft.showMoon:saved?.showMoon!==false,observer:validPoint(draft?.observer)?{...draft.observer}:null,body:draft?.body||'sun',at:Number.isFinite(draft?.at)?draft.at:Date.now(),ground:Number.isFinite(draft?.ground)?draft.ground:null,target,partId:draft?.partId??null,limb:draft?.limb||'center',matchMode:draft?.matchMode==='limb'||(!draft?.matchMode&&(['onTop','behind'].includes(draft?.limb)||(draft?.partId&&draft.partId!=='__whole')))?'limb':'overlap',custom,customTarget,daily:null};
  if(resume){session.at=resume.at+(resume.playing?Math.max(0,Date.now()-resume.wall):0);session.at=Math.max(Date.UTC(2020,0,1)-32400000,Math.min(aimCandidateSearchEnd()-1,session.at));session.dayAnchor=AstroNotesSkyMap.dayStart(session.at);}
  if(session.matchMode==='overlap'){session.partId=aimIsMountain(session.target)?null:'__whole';session.limb='center';}
  syncBodies();session.primaryBody=['sun','moon'].includes(draft?.primaryBody)?draft.primaryBody:['sun','moon'].includes(session.body)?session.body:session.showMoon&&!session.showSun?'moon':'sun';session.extraBody=extraIds.includes(draft?.extraBody)?draft.extraBody:draft?.extraBody===null?null:extraIds.includes(session.body)?session.body:null;if(extraIds.includes(session.body)&&!session.extraBody)session.body=session.primaryBody;el('skyMapBody').value=session.body;setPickMode(null);
  const targetSelect=el('skyMapTarget');targetSelect.replaceChildren(new Option('対象を選ぶ',''));
  for(const t of list)targetSelect.add(new Option(t.name,t.id));
  if(customTarget&&!list.some(t=>t.id==='custom'))targetSelect.add(new Option(custom.name,'custom'));
  targetSelect.value=session.target?.id||'';targetOn=validPoint(session.target);el('skyMapCustom').hidden=false;
  map.setOverlay(draw);map.open(validPoint(draft?.mapCenter)?draft.mapCenter:session.observer||session.target||{latitude:36,longitude:138},Number.isFinite(draft?.zoom)?draft.zoom:session.observer?13:session.target?10:5);refresh();if(resume?.playing)skyPlayback.start();
 }
 function suspend(){if(!session){leave(true,true,true);return;}const resume=session&&active()?{at:skyPlayback.at(),playing:skyPlayback.running(),wall:Date.now(),token:auth?.token,loginId:auth?.loginId}:null;leave(true,true,true);suspended=resume;}
 function leave(persist=true,invalidate=true,preserveResume=false){if(!preserveResume)suspended=null;skyPlayback.stop(false);dateEntry=null;globalThis.MyPlacesUI?.leaveSky?.();stopSkyScrub();if(skyCalendar?.open)skyCalendar.close();if(skyTimeDialog?.open)skyTimeDialog.close();if(invalidate){accessSeq++;accessPromise=null;checkingToken=null;}if(targetSheet.open)targetSheet.close();if(bodiesSheet.open)bodiesSheet.close();pickMode=null;mapWide=false;targetSeq++;if(session&&persist&&hasAccess())save();seq++;cancelAnimationFrame(frame);frame=0;session=null;accessToken=null;accessTools=[];el('skyMapContent').hidden=true;el('skyMapCanvas').closest('.mapwrap').classList.remove('sky-map-wide');el('skyMapExpand').setAttribute('aria-pressed','false');el('skyMapExpand').setAttribute('aria-label','地図を全画面表示');el('skyMapExpand').title='地図を全画面表示';}
 function changeObserverHeight(change){
  const o=session.observer,legacy=Number.isFinite(o.observationElevationM)&&!Number.isFinite(o.standAglM)&&!Number.isFinite(o.groundManualM);
  const migrated=legacy?{standAglM:Math.round(aimObserverAt(o,session.ground).eyeM*10)/10}:{};
  session.observer={...o,...migrated,observationElevationM:null,...change};
  if(Object.hasOwn(change,'groundManualM'))session.ground=null;
  el('skyMapHeightError').hidden=true;refresh();
 }
 for(const [id,field,min,max,reset] of [['skyMapGroundHeight','groundManualM',-500,9000,'skyMapGroundAuto'],['skyMapStandHeight','standAglM',0,700,'skyMapStandAuto']]){
  el(id).onchange=()=>{if(!hasAccess()||!session?.observer||!active())return;const input=el(id),value=Number(input.value);if(!input.value.trim()||!Number.isFinite(value)||value<min||value>max){el('skyMapHeightError').textContent='高さの範囲を確認してください';el('skyMapHeightError').hidden=false;return;}changeObserverHeight({[field]:value});};
  el(reset).onclick=()=>{if(!hasAccess()||!session?.observer||!active())return;changeObserverHeight({[field]:null});};
 }
 PLACE_PICKERS.skymap={title:'撮影地点',custom:()=>session?.observer,point:()=>session?.observer||place,set:p=>{if(!hasAccess()||!session||!active())return;session.observer=aimSavedFrom(p);session.ground=null;map.setCenter(p.latitude,p.longitude);refresh();},resetLabel:'撮影地点の選択を解除',reset:()=>{if(!hasAccess()||!session||!active())return;session.observer=null;session.ground=null;setPickMode(null);refresh();}};
 globalThis.AstroNotesCameraUI?.mapToolbar?.();
 el('skyMapExpand').onclick=()=>{const wide=el('skyMapCanvas').closest('.mapwrap').classList.toggle('sky-map-wide');mapWide=wide;el('skyMapExpand').setAttribute('aria-pressed',String(wide));el('skyMapExpand').setAttribute('aria-label',wide?'全画面表示を終了':'地図を全画面表示');el('skyMapExpand').title=wide?'全画面表示を終了':'地図を全画面表示';if(!wide){if(bodiesSheet.open)bodiesSheet.close();setPickMode(null);const wrap=el('skyMapCanvas').closest('.mapwrap'),menu=wrap.querySelector('.map-layer-menu:not([data-shape-menu])'),button=wrap.querySelector('.map-layers-btn');if(menu)menu.hidden=true;if(button)button.setAttribute('aria-expanded','false');}map.redraw();};
 const skyFooter=el('skyMapTimeMore').closest('footer');
 ToolDateTimeBar.decorate({footer:skyFooter,row:el('skyMapPrev').parentElement,date:el('skyMapCalendarOpen'),time:el('skyMapTime'),prev:el('skyMapPrev'),next:el('skyMapNext'),more:el('skyMapTimeMore'),track:el('skyMapTrack'),now:at=>setTime(at,true)});
 const skyTimeline=AstroNotesScrollTimeline.mount({root:el('skyMapTimeline'),getAt:()=>session?.at,getMode:()=>session?.scrubMode,enabled:()=>hasAccess()&&!!session&&active(),onChange:at=>{if(!hasAccess()||!session||!active())return;timelineMoving=true;const changed=AstroNotesSkyMap.dayStart(at)!==AstroNotesSkyMap.dayStart(session.at);session.at=at;if(changed){seq++;session.timelinePending=true;session.daily=null;session.dailies=null;el('skyMapEvents').replaceChildren();el('skyMapStatus').textContent='';el('skyMapRetry').hidden=true;map.redraw();}render();},onBlend:b=>{if(!session)return;session.blend=b;map.redraw();},onSettle:()=>{timelineMoving=false;if(!hasAccess()||!session||!active())return;if(session.timelinePending)refresh();else render();},format:(at,mode)=>mode==='date'?dateAt(at).slice(5).replace('-','/'):textAt(at),getObserver:()=>session?.observer,sun:(at,o)=>AstroNotesAstro.sun(at,o),describe:(at,mode)=>ToolDateTimeBar.label(at)+(mode!=='date'?' '+textAt(at):'')});
 let lastPlaybackDetail=0;
 const skyPlayback=ToolDateTimeBar.playback({row:el('skyMapPrev').parentElement,footer:skyFooter,getAt:()=>session?.at,enabled:()=>hasAccess()&&!!session&&active(),onStart:()=>{globalThis.AstroNotesCameraUI?.stop(el('aimLook'));stopSkyScrub();if(session)session.blend=null;},onStop:()=>{if(hasAccess()&&session&&active())render();},setAt:at=>{
  if(!hasAccess()||!session||!active())return;
  if(at<Date.UTC(2020,0,1)-32400000||at>=aimCandidateSearchEnd()){skyPlayback.stop(false);return;}
  const changed=AstroNotesSkyMap.dayStart(at)!==AstroNotesSkyMap.dayStart(session.at);session.at=at;session.blend=null;
  if(changed){refresh();return;}
  const text=textAt(at);if(document.activeElement!==el('skyMapTime')&&el('skyMapTime').value!==text)el('skyMapTime').value=text;
  skyTimeline.follow(at,session.scrubMode);
  if(globalThis.TrialExplore?.active()&&el('skyMapView').dataset.exploreMode==='scene')globalThis.TrialExplore.sync();else if(session.eye&&session.dailies)map.redraw();
  if(skyTimeDialog.open&&at-lastPlaybackDetail>=1000){lastPlaybackDetail=at;const state=currentState();if(state)el('skyMapAngles').textContent=`${bodyName(session.body)} 方位 ${state.azimuth.toFixed(1)}°・高度 ${state.altitude.toFixed(2)}°`;}
 }});
 const stopSkyScrub=()=>{skyTimeline.stop();timelineMoving=false;};
 // 日付カレンダーはねらうと同じ重なる日●・近接○・時刻・月相の描画（aimCalRows/aimCalGridHtml）。月全体を計算し、帯の候補では埋めない。
 const calendarCache=new Map();
 function calendarMonth(args){
  const {year,month,selected,today,grid,dialog,status,pickDay,isCurrent}=args;
  const plan=session,f=validPoint(plan?.observer)?plan.observer:null;
  const snap=plan?{target:plan.target,body:plan.body,partId:plan.partId,limb:plan.limb,matchMode:plan.matchMode}:{body:null};
  const owner=auth?.token,condition=()=>JSON.stringify([auth?.token,session?.observer,session?.ground,session?.target,session?.body,session?.partId,session?.limb,session?.matchMode,AstroNotesAtmosphere.dataKey()]),started=condition();
  const valid=()=>isCurrent()&&session===plan&&hasAccess()&&active()&&condition()===started;
  // 条件が替わった応答は捨てる。開いている同じ月なら新しい条件で解き直し、待機のまま残さない
  const stale=()=>{if(valid())return false;if(isCurrent()){if(session&&hasAccess()&&active())calendarMonth(args);else{status.textContent='';grid.setAttribute('aria-busy','false');}}return true;};
  const draw=events=>{
   grid.innerHTML=aimCalGridHtml(year,month,events,selected,today,snap,f);
   if(snap.body==='moon'&&f)for(const canvas of grid.querySelectorAll('[data-cal-moon]')){
    const state=AstroNotesBodies.state('moon',+canvas.dataset.calMoon,{...f,elevation:0});
    const paint=()=>{if(canvas.isConnected&&dialog.open&&valid()){const image=AstroNotesCalendarMoon.request(state,paint);canvas.getContext('2d').drawImage(image.canvas,0,0,40,40);canvas.dataset.portraitStatus=image.status;}};
    paint();
   }
   for(const button of grid.querySelectorAll('[data-cal-day]'))button.onclick=()=>pickDay(+button.dataset.calDay);
  };
  draw(new Map());
  if(!plan||!hasAccess()){status.textContent='';grid.setAttribute('aria-busy','false');return;}
  if(!f||!(snap.target?.parts||[]).length){status.textContent='撮影地点と対象を選んでください';grid.setAttribute('aria-busy','false');return;}
  grid.setAttribute('aria-busy','true');status.innerHTML=candidateWaitMarkup('重なる日を計算中…');
  (async()=>{
   let ground=Number.isFinite(f.groundManualM)?f.groundManualM:plan.ground;
   if(!Number.isFinite(ground)){ground=await AstroNotesTerrain.groundElevation(f.latitude,f.longitude);if(stale())return;if(!Number.isFinite(ground))throw Error('ground unavailable');}
   const obs=aimObserverAt(f,ground),key=JSON.stringify([owner,obs,snap.target,snap.body,snap.partId,snap.limb,snap.matchMode,year,month,AstroNotesAtmosphere.dataKey()]);
   let rows=calendarCache.get(key);
   if(!rows){
    await new Promise(resolve=>setTimeout(resolve,0));if(stale())return;
    const view=await aimShootingView(obs,snap.target,snap.body,snap.partId,snap.matchMode);if(stale())return;
    rows=aimCalRows(obs,snap.target,snap.body,year,month,snap.partId,view,snap);
    calendarCache.set(key,rows);if(calendarCache.size>24)calendarCache.delete(calendarCache.keys().next().value);
   }
   if(stale())return;
   const events=new Map();for(const row of rows){const day=S.Cal.startOfDay(row.at);if(!events.has(day))events.set(day,[]);events.get(day).push(row);}
   draw(events);
   const solidDays=[...events.values()].filter(rows=>rows.some(aimCalSolid)).length,nearDays=events.size-solidDays;
   status.textContent=events.size?`重なる日 ${solidDays}日${nearDays?` ・ 近くを通る日 ${nearDays}日`:''}${snap.body==='moon'?'（暗い空の時間）':''}`:'この月は候補日がありません';
   grid.setAttribute('aria-busy','false');
  })().catch(()=>{if(stale())return;status.textContent='計算できませんでした。月を選び直して再試行してください';grid.setAttribute('aria-busy','false');});
 }
 const skyCalendar=ToolDateTimeBar.calendar({button:el('skyMapCalendarOpen'),getAt:()=>session?.at??Date.now(),setDay:day=>{if(session)setTime(day+(session.at-AstroNotesSkyMap.dayStart(session.at)));},renderMonth:calendarMonth});
 ToolDateTimeBar.editor({button:el('skyMapCalendarOpen'),time:el('skyMapTime'),dialog:skyCalendar,beforeOpen:stopSkyScrub});
 const skyTimeDialog=document.createElement('dialog');skyTimeDialog.className='sheet preview-time-dialog sky-map-time-dialog';skyTimeDialog.tabIndex=-1;skyTimeDialog.setAttribute('aria-label','天体の位置と時刻');skyTimeDialog.innerHTML='<div class="sheet-head"><strong>天体の位置と時刻</strong><button type="button" data-close>閉じる</button></div><div id="skyMapAngles" class="sky-map-angles"></div><p id="skyMapDetailInfo" class="sky-map-angles tiny"></p><div class="sheet-body sky-map-time-actions"><button type="button" id="skyMapEarlier">−1分</button><button type="button" id="skyMapNow">今</button><button type="button" id="skyMapLater">+1分</button></div>';document.body.append(skyTimeDialog);
 ToolDateTimeBar.trackPointerFocus(el('skyMapView'),skyTimeDialog,skyCalendar,targetSheet,bodiesSheet);
 skyTimeDialog.querySelector('[data-close]').onclick=()=>skyTimeDialog.close();el('skyMapTimeMore').onclick=()=>showSheet(skyTimeDialog);
 if(typeof ResizeObserver==='function')new ResizeObserver(()=>{if(skyFooter.offsetHeight)document.documentElement.style.setProperty('--sky-footer-h',skyFooter.offsetHeight+'px');}).observe(skyFooter);
 el('skyMapChoose').querySelector('.pin').innerHTML=UI_ICONS.observer;el('skyMapChoose').querySelector('.chev').innerHTML=UI_ICONS.search;
 el('skyMapChoose').onclick=()=>openPlaceSheet('skymap');
 el('skyMapObserverFav').onclick=()=>{
  if(!hasAccess()||!session||!active()||!validPoint(session.observer))return;
  const current=session,owner=auth?.token,point=session.observer;
  return favForPoint({...point,elevation:Number.isFinite(point.groundManualM)?point.groundManualM:session.ground},entry=>{
   if(session!==current||session.observer!==point||auth?.token!==owner||!hasAccess()||!active())return;
   if(entry&&validPoint(session.observer)&&AstroNotesTerrain.distanceKm(entry.latitude,entry.longitude,session.observer.latitude,session.observer.longitude)<.02){
    session.observer=aimSavedFrom({...entry,name:entry.name});session.ground=null;refresh();
   }else render();
  });
 };
 el('skyMapObserverClear').onclick=()=>{PLACE_PICKERS.skymap.reset();el('skyMapChoose').focus();};
 el('skyMapOpen').onclick=()=>enter(true);
 el('skyMapNow').onclick=()=>setTime(Date.now(),true);el('skyMapEarlier').onclick=()=>setTime(session.at-60000);el('skyMapLater').onclick=()=>setTime(session.at+60000);
 el('skyMapRetry').onclick=refresh;
 el('skyMapBody').onchange=()=>{if(!session||!hasAccess()||!active())return;const body=el('skyMapBody').value;if(!AstroNotesBodies.definitions.some(d=>d.id===body))return;session.matchMode='overlap';session.body=body;if(!extraIds.includes(body)){session.showSun=body==='sun';session.showMoon=body==='moon';session.primaryBody=body;}session.extraBody=extraIds.includes(body)?body:null;refresh();};
 el('skyMapTime').onchange=()=>{const at=Date.parse(el('skyMapDate').value+'T'+el('skyMapTime').value+':00+09:00');setTime(at);};
 function syncScrubRange(){
  const range=el('skyMapRange'),dateMode=session.scrubMode==='date';
  if(!Number.isFinite(session.dayAnchor)||Math.abs(AstroNotesSkyMap.dayStart(session.at)-session.dayAnchor)>7*86400000)session.dayAnchor=AstroNotesSkyMap.dayStart(session.at);
  range.min=dateMode?-7:0;range.max=dateMode?7:86399;range.step=1;range.value=dateMode?(AstroNotesSkyMap.dayStart(session.at)-session.dayAnchor)/86400000:(session.at-AstroNotesSkyMap.dayStart(session.at))/1000;
  skyTimeline.sync(session.at,session.scrubMode);
  range.setAttribute('aria-label',dateMode?'撮影日を滑らかに調整':'撮影時刻を滑らかに調整');
  ToolDateTimeBar.modeButton(el('skyMapScrubMode'),session.scrubMode);
 }
 function setScrubMode(mode){if(!hasAccess()||!session)return;stopSkyScrub();cancelAnimationFrame(frame);frame=0;session.scrubMode=mode;session.dayAnchor=AstroNotesSkyMap.dayStart(session.at);if(session.timelinePending)refresh();render();}
 el('skyMapScrubMode').onclick=()=>setScrubMode(ToolDateTimeBar.nextMode(session?.scrubMode));
 function applySkyScrub(){const v=Number(el('skyMapRange').value);if(!session||!Number.isFinite(v))return;setTime(session.scrubMode==='date'?session.dayAnchor+Math.round(v)*86400000+(session.at-AstroNotesSkyMap.dayStart(session.at)):AstroNotesSkyMap.dayStart(session.at)+v*1000);}
 el('skyMapRange').onkeydown=e=>{const dir={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1,PageDown:1,PageUp:-1}[e.key];if(!dir||!session||!hasAccess())return;e.preventDefault();const large=e.shiftKey||e.key.startsWith('Page'),day=AstroNotesSkyMap.dayStart(session.at),next=session.at+dir*(session.scrubMode==='date'?(large?7:1)*86400000:(session.scrubMode==='hour'?(large?21600000:3600000):(large?600000:60000)));setTime(session.scrubMode==='date'?next:Math.max(day,Math.min(day+86399000,next)));};
 el('skyMapRange').oninput=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;applySkyScrub();});};
 el('skyMapRange').onchange=()=>{cancelAnimationFrame(frame);frame=0;applySkyScrub();};
 el('skyMapPrev').onclick=()=>{if(session)setTime(session.at-86400000);};el('skyMapNext').onclick=()=>{if(session)setTime(session.at+86400000);};
 for(const [id,key] of [['skyMapShowSun','showSun'],['skyMapShowMoon','showMoon']])el(id).onclick=()=>{if(!hasAccess()||!session)return;session[key]=!session[key];refresh();};
 function selectExtra(body){if(!hasAccess()||!session||!active()||(body!==null&&!extraIds.includes(body)))return;if(body&&['sun','moon'].includes(session.body))session.primaryBody=session.body;session.extraBody=body;if(body)session.body=body;else if(extraIds.includes(session.body))session.body=shownBodies().includes(session.primaryBody)?session.primaryBody:session.showSun?'sun':session.showMoon?'moon':session.primaryBody;el('skyMapBody').value=session.body;if(bodiesSheet.open)bodiesSheet.close();refresh();}
 el('skyMapMoreBodies').onclick=()=>{if(hasAccess()&&session&&active())showSheet(bodiesSheet);};el('skyMapBodiesClose').onclick=()=>bodiesSheet.close();
 for(const id of extraIds)el('skyMapExtra-'+id).onclick=()=>selectExtra(id);
 el('skyMapExtra-none').onclick=()=>selectExtra(null);el('skyMapClearExtra').onclick=()=>selectExtra(null);

 el('skyMapTarget').onchange=()=>{session.target=el('skyMapTarget').value==='custom'&&session.customTarget?session.customTarget:mapTargets().find(t=>t.id===el('skyMapTarget').value)||null;session.partId=aimIsMountain(session.target)?null:'__whole';session.limb='center';session.matchMode='overlap';targetOn=validPoint(session.target);syncBodies();refresh();};
 async function placeTarget(point,height,name='地図で置いた対象',fromSheet=false){
  if(!hasAccess()){(fromSheet?el('skyMapPickError'):el('skyMapStatus')).textContent='この対象は現在使えません';return false;}
  if(!Number.isFinite(height)||height<0||!AstroNotesLibrary.height(height))return false;
  // 日時/表示の再計算は配置要求を取り消さない。セッション/目標の変更は失効。
  const request=session,target=session.target,token=++targetSeq;let ground;
  try{ground=await AstroNotesTerrain.groundElevation(point.latitude,point.longitude);}catch{ground=null;}
  if(request!==session||target!==session.target||token!==targetSeq||!hasAccess()||!active()||(fromSheet&&!targetSheet.open))return false;
  if(!hasAccess()){(fromSheet?el('skyMapPickError'):el('skyMapStatus')).textContent='この対象は現在使えません';return false;}
  if(!Number.isFinite(ground)){(fromSheet?el('skyMapPickError'):el('skyMapStatus')).textContent='標高を取得できません。再試行してください';return false;}
  session.custom={...point,name:name.trim()||'地図で置いた対象',heightM:height,groundM:ground,topM:ground+height,heightAuto:false};session.target={id:'custom',name:session.custom.name,...point,groundM:ground,parts:[{id:'tip',name:'てっぺん',m:ground+height}]};session.customTarget=session.target;session.partId='tip';targetOn=true;
  const sel=el('skyMapTarget');if(!Array.from(sel.options).some(o=>o.value==='custom'))sel.add(new Option(session.target.name,'custom'));else sel.options[Array.from(sel.options).findIndex(o=>o.value==='custom')].textContent=session.target.name;sel.value='custom';refresh();return true;
 }
 el('skyMapPlaceTarget').onclick=async()=>{const height=el('skyMapHeight').valueAsNumber;if(!Number.isFinite(height)||height<0||!AstroNotesLibrary.height(height)){el('skyMapStatus').textContent='対象の地上からの高さを0〜1000mで入力してください';return;}el('skyMapPlaceTarget').disabled=true;try{await placeTarget(map.center(),height);}finally{el('skyMapPlaceTarget').disabled=false;}};
 function setPickMode(mode){
  if(mode&&!hasAccess())return;pickMode=mode;
  for(const [id,role,name] of [['skyMapObserverTool','observer','撮影地点'],['skyMapTargetTool','target','対象']]){
   const button=el(id),on=mode===role;button.setAttribute('aria-pressed',String(on));button.setAttribute('aria-label',on?`${name}の移動を完了`:`${name}を地図で変更`);button.title=on?`${name}の移動を完了`:name;
  }
  const wrap=el('skyMapCanvas').closest('.mapwrap');
  if(mode){wrap.dataset.pickMode=mode;if(mode==='observer'&&validPoint(session.observer))map.setCenter(session.observer.latitude,session.observer.longitude);else if(mode==='target'&&validPoint(session.target)){const t=AstroNotesAlign.partTarget(session.target,session.partId);map.setCenter(t.latitude,t.longitude);}wrap.scrollIntoView?.({block:'center',behavior:'auto'});}else delete wrap.dataset.pickMode;
  map.redraw();
 }
 function togglePickMode(mode){if(pickMode===mode)finishPick();else setPickMode(mode);}
 map.onDoubleTap(()=>setPickMode(null));
 el('skyMapObserverTool').onclick=()=>togglePickMode('observer');el('skyMapTargetTool').onclick=()=>togglePickMode('target');
 map.onPick((point,pixel)=>{if(!hasAccess()||!session||!active()||pickMode)return;const near=p=>{const q=map.project(p.latitude,p.longitude);return Math.hypot(q[0]-pixel.x,q[1]-pixel.y);};if(mapWide&&validPoint(session.observer)&&near(session.observer)<20){setPickMode('observer');return;}if(mapWide&&validPoint(session.target)&&near(AstroNotesAlign.partTarget(session.target,session.partId))<20){setPickMode('target');return;}try{window.MyPlacesUI?.pickSky(pixel,map.project);}catch{/* trial */}});
 function finishPick(){
  if(!hasAccess()||!session||!pickMode)return;const mode=pickMode,point=map.center();setPickMode(null);
  if(mode==='observer'){session.observer=aimSavedFrom({...point,name:`${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`});session.ground=null;refresh();return;}
  const candidates=[session.target,...mapTargets().filter(t=>t.id!==session.target?.id)].filter(validPoint).map(t=>({t,distance:(()=>{const mark=t.id===session.target?.id?AstroNotesAlign.partTarget(t,session.partId):t;return AstroNotesTerrain.distanceKm(point.latitude,point.longitude,mark.latitude,mark.longitude);})()})).filter(v=>v.distance<.001).sort((a,b)=>a.distance-b.distance);
  if(candidates.length){if(session.target?.id!==candidates[0].t.id)session.partId=null;session.target=candidates[0].t;targetOn=true;el('skyMapTarget').value=session.target.id;syncBodies();refresh();return;}
  session.pendingTarget=point;targetSeq++;el('skyMapPickLatitude').value=String(point.latitude);el('skyMapPickLongitude').value=String(point.longitude);el('skyMapTargetCoord').textContent=`${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;el('skyMapPickName').value='地図で置いた対象';el('skyMapPickHeight').value='';el('skyMapPickError').textContent='';showSheet(targetSheet);el('skyMapPickHeight').focus();
 }
 el('skyMapTargetClose').onclick=()=>targetSheet.close();targetSheet.addEventListener('close',()=>{targetSeq++;if(session)session.pendingTarget=null;});
 el('skyMapPickSave').onclick=async()=>{const height=el('skyMapPickHeight').valueAsNumber;if(!Number.isFinite(height)||height<0||!AstroNotesLibrary.height(height)){el('skyMapPickError').textContent='地上からの高さを0〜1000mで入力してください';el('skyMapPickHeight').focus();return;}if(!session?.pendingTarget)return;const la=el('skyMapPickLatitude').value.trim(),lo=el('skyMapPickLongitude').value.trim(),point={latitude:Number(la),longitude:Number(lo)};if(!la||!lo||!validPoint(point)||Math.abs(point.latitude)>90||Math.abs(point.longitude)>180){el('skyMapPickError').textContent='緯度・経度を確認してください';return;}el('skyMapPickSave').disabled=true;try{if(await placeTarget(point,height,el('skyMapPickName').value,true))targetSheet.close();}finally{el('skyMapPickSave').disabled=false;}};
 function prepareFraming(){
  if(!hasAccess()||!session)return false;
  const hasObserver=validPoint(session.observer);
  if(hasObserver&&(!session.dailies?.[session.body]||!session.eye))return false;
  if(!validPoint(session.target)){el('skyMapStatus').textContent='対象を選んでください';el('skyMapTarget').focus();return;}
  if(!canTransfer()||!allowed(session.body)){el('skyMapStatus').textContent='この条件は現在使えません。天体・対象を選び直してください';return;}
  if(session.custom&&session.target.id==='custom')store.set('sorami.aimCustom',session.custom);
  aimFillSelects();const targetChanged=el('aimTarget').value!==session.target.id;el('aimTarget').value=session.target.id;store.set('sorami.aimTarget',el('aimTarget').value);if(targetChanged){aim.partId=null;aim.partsTargetKey=null;el('aimPart').value='';}
  aim.matchMode=session.matchMode;aim.partId=session.partId;el('aimPart').value=session.partId||'';aim.candPick=null;aim.limbsByBody[aim.body]=aimLimbValue()||aim.limb;el('aimLimb').innerHTML='';
  const p=hasObserver?{...session.observer}:null;
  aim.from=aimSavedFrom(p);store.set('sorami.aimFrom',aim.from);aim.candPick=null;
  aim.body=session.body;aim.limb=session.partId==='__whole'?'center':session.limb||'center';aim.limbsByBody[aim.body]=aim.limb;store.set('sorami.aimBody',aim.body);el('aimBody').value=aim.body;el('aimDate').value=dateAt(session.at);
  if(p){const obs=aimObserverAt(p,session.ground);aim.plannerTransfer={at:session.at,body:session.body,latitude:obs.latitude,longitude:obs.longitude,day:AstroNotesSkyMap.dayStart(session.at)};}
  else{aim.plannerTransfer=null;aim.candPick=null;aim.spot=null;aim.wantSpot=null;aim.wantKey=null;}
  save();return true;
 }
 setSkyMapUI({selectionState:()=>session&&({...AstroNotesShooting.conditions(session),body:session.body,target:session.target,observer:session.observer}),renderState:()=>{if(!hasAccess()||!active()||!session?.observer||!session?.target?.parts?.length||!session?.eye||pickMode)throw Error('見え方の条件を準備中');return {...AstroNotesShooting.conditions(session),ground:session.ground,eyeM:aimObserverAt(session.observer,session.ground).eyeM};},shareState:()=>{if(!hasAccess()||!active()||!session?.observer||!session?.target||!session?.target?.parts?.length||!session?.daily||!session?.eye||timelineMoving||session.timelinePending||pickMode)throw Error("撮影地点・対象・日時を選び、計算が終わってから開いてください。");return {...AstroNotesShooting.conditions(session),ground:session.ground,eyeM:aimObserverAt(session.observer,session.ground).eyeM};},snapshot:()=>session&&AstroNotesShooting.conditions(session),selectCandidate:(candidate,expected)=>{
  if(!hasAccess()||!session||!active()||!candidate?.event||!AstroNotesShooting.point(candidate.place))return false;
  const current=JSON.stringify([session.body,session.target,session.partId,session.limb,AstroNotesShooting.day(session.at),session.matchMode||'limb']);
  if(current!==expected)return false;
  skyPlayback.stop(false);
  session.observer=aimSavedFrom(AstroNotesShooting.savedObserver(candidate.place));session.ground=Number.isFinite(candidate.place.elevation)?candidate.place.elevation:null;if(candidate.event.matchMode){session.matchMode=candidate.event.matchMode;session.partId=candidate.event.partId;session.limb='center';}session.at=candidate.event.at;session.dayAnchor=AstroNotesShooting.day(session.at);map.setCenter(candidate.place.latitude,candidate.place.longitude);refresh();return true;
 },setAlignment:(partId,limb,matchMode='limb')=>{if(!hasAccess()||!session||!active())return;if(partId&&partId!=='__whole'&&!(session.target?.parts||[]).some(p=>p.id===partId))return;if(!AstroNotesAlign.LIMBS.some(x=>x.id===limb))return;session.matchMode=matchMode==='overlap'?'overlap':'limb';session.partId=session.matchMode==='overlap'?(aimIsMountain(session.target)?null:'__whole'):partId;session.limb=session.matchMode==='overlap'||partId==='__whole'?'center':limb;refresh();},open,leave,suspend,authChanged,prepareFraming,enter,refreshTargets,render,redraw:()=>map.redraw(),fitPoints:pts=>{const cv=el('skyMapCanvas'),la=pts.map(q=>q.latitude),lo=pts.map(q=>q.longitude),lat0=Math.min(...la),lat1=Math.max(...la),lon0=Math.min(...lo),lon1=Math.max(...lo),lat=(lat0+lat1)/2,lon=(lon0+lon1)/2,dx=Math.max(.00001,(lon1-lon0)/360),dy=Math.max(.00001,(lat1-lat0)/(360*Math.cos(lat*Math.PI/180)));map.setView(lat,lon,Math.min(Math.log2(Math.max(160,cv.clientWidth)*.8/(256*dx)),Math.log2(Math.max(200,cv.clientHeight)*.8/(256*dy))));},setTime:at=>setTime(at),setObserver:p=>PLACE_PICKERS.skymap.set(p),setTarget:id=>{if(!session||!hasAccess())return;const t=mapTargets().find(x=>x.id===id);if(!t)return;session.target=t;session.partId=null;targetOn=true;el('skyMapTarget').value=t.id;session.partId=aimIsMountain(t)?null:'__whole';session.limb='center';session.matchMode='overlap';syncBodies();refresh();}});if(routeFromHash()?.skymap)applyRoute();
})();
