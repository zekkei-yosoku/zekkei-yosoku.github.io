function planSnapshot(button) {
  globalThis.AstroNotesCameraUI?.stop($('aimLook'));
  const kind=button.dataset.planSource || 'aim',created=Date.now();let payload,s;
  if(kind==='detail') {
    const id=button.dataset.planId,day=+button.dataset.planDay;
    const e=(weeks[id]||[]).find(e=>e.dayMs===day),ev=e?.evaluation;
    if(!bundle||!ev||ev.unavailable)throw new Error('この日の予測を取得してから開き直してください。');
    const observer={...place,elevation:place.elevation ?? bundle.home.grid.elevation ?? null};
    payload={v:1,kind:'detail',id,day,at:ev.peak,o:AstroNotesPlan.compactPoint(observer,place.eyeHeightAGL ?? 1.5)};
    const r=S.readingAt(bundle,id,ev.peak),fmt=(v,u)=>Number.isFinite(v)?`${Math.round(v*10)/10}${u}`:'未取得';
    const start=ev.window[0],end=ev.window[1];
    s={title:S.longNameOf(id),at:ev.peak,observer,start,end:end>start?end:start+1800000,created,
      rows:[['見頃',ev.specificTime===false?'時刻は未確定（予定の日時は編集できます）':`${AstroNotesPlan.dateTime(start)} 〜 ${AstroNotesPlan.dateTime(end)}（日本時間）`],
        ['予測',`${Math.round(ev.score)}点 / ${S.phrasing(id,ev.rank).label}`],['確からしさ',confidenceText(ev)],
        ['撮影地点',`${observer.name} / 緯度 ${observer.latitude.toFixed(6)}・経度 ${observer.longitude.toFixed(6)}`],
        ['気象条件',`気温 ${fmt(r.temperature,'℃')} / 湿度 ${fmt(r.humidity,'%')} / 降水 ${fmt(r.precipitation,'mm')}`],
        ['雲量',`低層 ${fmt(r.cloudLow,'%')} / 中層 ${fmt(r.cloudMid,'%')} / 高層 ${fmt(r.cloudHigh,'%')}`],
        ['予報取得',`${AstroNotesPlan.dateTime(bundle.fetchedAt)}（日本時間）`]],
      note:'点数は見える確率ではありません。天気や現地の条件で変わるため、出発前に最新の予測を確認してください。'};
    if (['sunset','sunrise','moon'].includes(id)) {
      const sky = id === 'moon' ? AstroNotesAstro.moon(ev.peak,observer) : AstroNotesAstro.sun(ev.peak,observer);
      s.rows.splice(3,0,['見る方向',`${id==='moon'?'月':'太陽'}の方位 ${sky.azimuth.toFixed(1)}°（真北0°・東90°）`]);
    }
  } else if(kind==='skymap') {
    const p=SkyMapUI.shareState(),t=p.target,at=p.at,observer={...p.observer,elevation:p.observer.groundManualM??p.ground??0},eyeM=p.eyeM;
    const target={id:t.id,name:t.name,latitude:t.latitude,longitude:t.longitude,groundM:t.groundM??(t.id==='fuji'?3776:0),parts:t.parts.map(x=>({id:x.id,name:x.name,m:x.m,...(Number.isFinite(x.latitude)&&Number.isFinite(x.longitude)?{latitude:x.latitude,longitude:x.longitude}:{})}))};if(t.kind)target.kind=t.kind;if(Number.isFinite(t.widthM))target.widthM=t.widthM;
    payload={v:1,kind:'aim',o:AstroNotesPlan.compactPoint(observer,eyeM),at,t:target,body:p.body,part:p.partId??t.parts[0].id,limb:p.limb,matchMode:p.matchMode||'overlap',air:aimAirSettings.mode,l:globalThis.TrialExplore?.active()?globalThis.TrialExplore.camera().l:{on:true,mode:'manual',focal:50,sensor:'full',portrait:false,grid:'none'},pan:globalThis.TrialExplore?.active()?globalThis.TrialExplore.camera().pan:[0,0]};
    const camera=globalThis.TrialExplore?.active()?globalThis.TrialExplore.camera():null;if(camera?.timelapse)payload.timelapse={...camera.timelapse};
    const source=$('skyMapCanvas'),scene=document.createElement('canvas');scene.width=source.width;scene.height=source.height;scene.getContext('2d').drawImage(source,0,0);
    const st=AstroNotesBodies.state(p.body,at,{...observer,elevation:observer.elevation+eyeM});
    s={title:`${AstroNotesBodies.definition(p.body).name} × ${t.name}`,at,observer,target:t,start:at-900000,end:at+900000,created,scene,rows:[['撮影日時',AstroNotesPlan.dateTime(at)+'（日本時間）'],['撮影地点',`${observer.name} / 緯度 ${observer.latitude.toFixed(6)}・経度 ${observer.longitude.toFixed(6)}`],['高さ',`標高 ${aimM(observer.elevation)}m / 地上から ${aimM(eyeM)}m`],['重ね方',p.matchMode==='overlap'?'全体に重なる':AstroNotesAlign.limbById(p.limb).name],['見る方向',`方位 ${st.azimuth.toFixed(1)}° / 高度 ${st.apparentAltitude.toFixed(2)}°`]],note:'地図：国土地理院。位置と時刻の計算です。共有リンクでは同じ条件の構図を確認できます。'};
  } else {
    const host=$('aimLook'),spec=host._lookSpec,cv=host.querySelector('[data-look-canvas]');
    if(globalThis.TrialExplore?.active())globalThis.TrialExplore.assertScene();
    if(host.hidden||!cv||!spec||!host._uiTime||host._planKey!==aimLookKey()||!Number.isFinite(host._lookAt))throw new Error('対象・撮影地点・日付を選び、見え方の計算が終わってから開いてください。');
    globalThis.AstroNotesCameraUI?.stop(host);
    if(host._pick?.busy||host._pick?.ghost||host._lensGesture?.points.size)throw new Error('図から指を離してから開いてください。');
    const t=aim.target,at=host._lookAt,observer={...(globalThis.TrialExplore?.active()?SkyMapUI.selectionState()?.observer:aimFromPoint()),...spec.obs,name:host._planObserverName || aimFromPoint()?.name || '撮影地点'};
    const part=AstroNotesAlign.partOf(t,aim.partId),focal=+host.querySelector('[data-lens-focal]').value;
    const target={id:t.id,name:t.name,latitude:t.latitude,longitude:t.longitude,groundM:t.groundM ?? (t.id==='fuji'?3776:0),parts:t.parts.map(p=>({id:p.id,name:p.name,m:p.m,...(Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)?{latitude:p.latitude,longitude:p.longitude}:{})}))};
    if(t.kind)target.kind=t.kind;if(Number.isFinite(t.widthM))target.widthM=t.widthM;
    payload={v:1,kind:'aim',o:AstroNotesPlan.compactPoint(observer,spec.eyeM),at,t:target,body:aim.body,part:globalThis.TrialExplore?.active()?(aim.partId??t.parts[0].id):aim.partId,limb:aim.limb,matchMode:aim.matchMode||'limb',
      air:aimAirSettings.mode,l:{...aimLens,focal},pan:[...(host._lensOffset || [0,0])],...(AstroNotesTimelapse.settings(host._timelapseConfig)?{timelapse:{...host._timelapseConfig}}:{})};
    const scene=document.createElement('canvas');scene.width=cv.width;scene.height=cv.height;scene.getContext('2d').drawImage(cv,0,0);
    const st=AstroNotesBodies.state(aim.body,at,{...observer,elevation:(observer.elevation||0)+spec.eyeM});
    const spans=host._uiTime.frameSpans || [],span=spans.find(p=>p.start<=at&&p.end>=at);
    const start=span?.start ?? at-900000,end=span?.end ?? at+900000;
    const name=AstroNotesBodies.definition(aim.body).name;
    const warns=[host.querySelector('[data-look-extra]')?.textContent,host.querySelector('[data-look-note]')?.textContent,host.querySelector('[data-look-outside]')?.hidden?'':host.querySelector('[data-look-outside]')?.textContent].filter(Boolean);
    s={title:`${name} × ${t.name}`,at,observer,target:t,start,end,created,scene,fullFrameMm:focal*Math.hypot(36,24)/Math.hypot(...AIM_SENSOR[aimLens.sensor]),
      rows:[['撮影地点',`${observer.name} / 緯度 ${observer.latitude.toFixed(6)}・経度 ${observer.longitude.toFixed(6)}`],
        ['高さ',`地面の標高 ${aimM(observer.elevation)}m / 地上から ${aimM(spec.eyeM)}m`],
        ['対象・重ね方',`${t.name} / ${part?.name || '全体'} / ${aim.matchMode==='overlap'?'全体に重なる':AstroNotesAlign.LIMBS.find(l=>l.id===aim.limb)?.name || '真ん中'}`],
        ['見る方向',`天体の方位 ${st.azimuth.toFixed(1)}° / 高度 ${st.apparentAltitude.toFixed(2)}°（真北0°・東90°）`],
        ['重なる・最接近の基準時刻',`${AstroNotesPlan.dateTime(spec.at)}（日本時間）`],
        ...(payload.timelapse?[['タイムラプス',`${payload.timelapse.interval}秒間隔 / ${payload.timelapse.count}枚 / ${payload.timelapse.fps}fps / 動画 ${(payload.timelapse.count/payload.timelapse.fps).toFixed(2)}秒`]]:[]),
        ['撮影条件',`${host.querySelector('[data-lens-sensor]').selectedOptions[0].textContent} / ${host.querySelector('[data-lens-info]').textContent} / ${aimLens.portrait?'縦位置':'横位置'}`],
        ['大気差',`${{standard:'標準',auto:'気象予報',none:'なし'}[aimAirSettings.mode]} / ${$('aimAirSummary').textContent}`],
        ['気象・見通し','位置と時刻の計算です。雲・樹木・現地の立入条件は別途確認してください。'],
        ...(warns.length?[['図の注意',warns.join(' / ')]]:[]),['作成日時',`${AstroNotesPlan.dateTime(created)}（日本時間）`]],
      note:'図は計算上の目安です。見えることを保証するものではありません。共有リンクは最新データで再計算されます。'};
  }
  if(payload.timelapse){s.start=payload.at;s.end=payload.at+Math.max(1000,Math.ceil((payload.timelapse.count-1)*payload.timelapse.interval)*1000);}
  if(payload.timelapse&&!s.rows.some(r=>r[0]==='タイムラプス')){const q=payload.timelapse;s.rows.push(['タイムラプス',`${q.interval}秒間隔 / ${q.count}枚 / ${q.fps}fps / 動画 ${(q.count/q.fps).toFixed(2)}秒`]);}
  s.url=AstroNotesPlan.link(payload);s.mapUrl=AstroNotesPlan.mapLink(s.observer);s.payload=payload;
  return s;
}
let planRestoredFragment=null;
function restoreSharedPlan(recent = null, options = {}) {
  if(!globalThis.AstroNotesPlanUI)return; // Initial routing can precede the sharing module; initPlanSharing retries below.
  if(!recent) {
  routeFromHash();
  if(planRestoredFragment===location.hash)return;
  planRestoredFragment=location.hash;
  const token=new URLSearchParams(location.hash.split('?')[1]||'').get('plan');if(!token)return;
  recent=AstroNotesPlan.decode(token);
  }
  const p=recent;
  if(!p || p.kind==='detail'&&!S.PHENOMENA[p.id] || p.kind==='aim'&&!AstroNotesBodies.definition(p.body))return;
  const route=location.hash.split('?')[0];
  if(arguments.length===0&&route!==(p.kind==='aim'?'#/aim':`#/${p.id}/${p.day}`))return;
  if(p.kind==='detail'){const changed=place.latitude!==p.o[1]||place.longitude!==p.o[2];place=AstroNotesPlan.expandPoint(p.o);return changed && bundle ? 'reload' : undefined;}
  const builtin=AstroNotesAlign.targetById(p.t.id);
  // Keep the sender's chosen heights, without modifying saved favorites or custom targets.
  const retainedId=p.t.id==='cocoon-tower'?p.t.id:null;
  // Only known fields reach rendering; keep unknown protocol extensions in storage/codec for compatibility.
  const t=p.t,shared={id:t.id,name:t.name,latitude:t.latitude,longitude:t.longitude,groundM:t.groundM,parts:t.parts.map(q=>({id:q.id,name:q.name,m:q.m,...(q.latitude!==undefined?{latitude:q.latitude,longitude:q.longitude}:{})})),...(t.kind?{kind:t.kind}:{}),...(t.widthM!==undefined?{widthM:t.widthM}:{})};
  aim.sharedTarget={...(builtin || {}),...shared,id:builtin?.id || retainedId || 'shared'};
  aim.candPick=null;aim.spot=null;aim.wantSpot=null;aim.wantKey=null;aim.candKey=null;aim.centerKey=null;aim.reverse=null;aimAirCompare=null;
  $('aimLimb').innerHTML='';
  aim.matchMode=p.matchMode||'limb';aim.body=p.body;aim.limb=p.limb;aim.partId=p.part;aim.limbsByBody[p.body]=p.limb;
  aim.from={...aimSavedFrom(AstroNotesPlan.expandPoint(p.o)),...(arguments.length?{subtitle:'履歴の撮影地点'}:{}),groundManualM:p.o[3],standAglM:p.o[4]};
  aimLens.on=p.l.on;aimLens.mode='manual';aimLens.focal=p.l.focal;aimLens.sensor=p.l.sensor;aimLens.portrait=p.l.portrait;aimLens.grid=p.l.grid;
  aimAirSettings.mode=p.air;aimAirSeq++;aimAirLoadKey='';aimCal.seq++;aimCal.cache.clear();aim.spotCache=null;aimRidgeCache.clear();
  AstroNotesAtmosphere.configure(p.air,aimAirSettings);if(options.persist!==false)store.set('sorami.aimAir',aimAirSettings);aimAirSync();
  if(arguments.length&&options.persist!==false){store.set('sorami.aimFrom',aim.from);store.set('sorami.lens',aimLens);}
  $('aimDate').value=new Date(p.at+32400000).toISOString().slice(0,10);
  aim.pendingPlan=p;
}
// NOTEBOOK の予定（2026-10-20）。値は履歴の「重ねる条件」と同じ形。アカウントごとに分けて保存し、ログイン中は RecordSync でサーバーと同期する
let scheduleStore=null,notebookTab='points';
const schedule=()=>scheduleStore||(scheduleStore=AstroNotesSchedule.create({read:store.get,write:store.set,scope:()=>auth?.loginId||'guest',validate:p=>{try{return p?.kind==='aim'?AstroNotesPlan.decode(AstroNotesPlan.encode(p)):null;}catch{return null;}}}));
function setNotebookTab(tab,focus=false){
  notebookTab=tab==='plans'?'plans':'points';
  $('recordsView').dataset.tab=notebookTab;
  for(const [id,t] of [['notebookPointsTab','points'],['notebookPlansTab','plans']]){const b=$(id);b.setAttribute('aria-selected',String(t===notebookTab));b.tabIndex=t===notebookTab?0:-1;if(focus&&t===notebookTab)b.focus();}
  $('myRecordsHub').hidden=notebookTab!=='points';$('scheduleHub').hidden=notebookTab!=='plans';
  renderNotebook();
}
globalThis.addEventListener?.("sorami:records-synced",()=>{if(!$("recordsView")?.hidden)renderNotebook();});
function renderNotebook(){
  const host=$('scheduleHub');if(!host)return;host.replaceChildren();
  if(!auth?.token||!toolAllowed('records'))return;
  const now=Date.now(),rows=schedule().list(),soon=rows.filter(r=>r.end>=now-86400000),past=rows.filter(r=>r.end<now-86400000).reverse();
  const day=ms=>Math.floor((ms+32400000)/86400000);
  const row=(r,isPast)=>{
    const v=r.value,line=document.createElement('div');line.className='history-row schedule-row';
    const b=document.createElement('button');b.type='button';b.className='list-item';
    const when=document.createElement('span');when.className='schedule-when';const d=day(r.start)-day(now);
    when.textContent=globalThis.AstroNotesJourney?AstroNotesJourney.dayLabel(r,now):isPast?'済':d<=0?'今日':d===1?'明日':d<100?`あと${d}日`:`${new Date(r.start+32400000).getUTCFullYear()}年`;
    const title=document.createElement('strong');title.textContent=r.title||`${v.t.name} × ${AstroNotesBodies.definition(v.body)?.name||v.body}`;
    const sub=document.createElement('span');sub.className='tiny sub-line';sub.textContent=`${AstroNotesPlan.dateTime(r.start)} ・ ${AstroNotesPlan.expandPoint(v.o).name}`;
    const text=document.createElement('span');text.className='schedule-text';text.append(title,sub);b.append(when,text);
    b.setAttribute('aria-label',`${title.textContent}、${sub.textContent}。構図で開く`);
    b.onclick=()=>{const issue=notebookPlanIssue(v);if(issue){notebookPlanNotice(issue);return;}void openNotebookPlan(r);};
    const del=document.createElement('button');del.type='button';del.className='history-remove';del.textContent='×';del.setAttribute('aria-label',`${title.textContent}の予定を消す`);
    del.onclick=()=>{if(!confirm(`「${title.textContent}」の予定を消しますか？`))return;if(!schedule().remove(r.id))alert('予定を消せませんでした。');renderNotebook();};
    line.append(b,del);return line;
  };
  // 2026-10-20 使い方の説明は予定が1件も無いときだけ（ユーザー「出し方を変えた方がいいのも最適化して」）
  if(!soon.length){const p=document.createElement('p');p.className='tiny history-empty';p.textContent=rows.length?'これからの予定はありません。':'予定はまだありません。';host.append(p);}
  if(!rows.length){const how=document.createElement('p');how.className='tiny';how.textContent='探すで見つけた日時と構図を残せます。保存した予定はログイン中に同期します。';host.append(how);const find=document.createElement('button');find.type='button';find.className='chip';find.textContent='撮影機会を探す';find.onclick=openNotebookExplore;find.hidden=!screenAllowed('framing')||!screenAllowed('skymap');host.append(find);}
  for(const r of soon)host.append(row(r,false));
  if(past.length){const det=document.createElement('details');det.className='schedule-past';const sum=document.createElement('summary');sum.textContent=`過ぎた予定 ${past.length}件`;det.append(sum);for(const r of past)det.append(row(r,true));host.append(det);}
}
function keepNotebookPlan(cur,e) {
  if(!auth?.token||!toolAllowed('records')||cur.saveOwner?.generation!==authGeneration||cur.saveOwner?.loginId!==auth.loginId)return {ok:false,error:'アカウントまたは利用権限が変わりました。撮影条件を確認して開き直してください。'};
  const r=schedule().add({value:cur.payload,title:e.title,start:e.start,end:e.end,preserveExisting:cur.direct===true});renderNotebook();return {...r,saveOwner:cur.saveOwner};
}
let quickSaveNoticeTimer=0;
function quickSaveNotice(text,error=false){
 let host=$('quickSaveNotice');
 if(!host){host=document.createElement('div');host.id='quickSaveNotice';host.hidden=true;const message=document.createElement('span');message.id='quickSaveNoticeText';message.setAttribute('role','status');message.setAttribute('aria-live','polite');const close=document.createElement('button');close.type='button';close.className='chip';close.textContent='閉じる';close.onclick=()=>{host.hidden=true;clearTimeout(quickSaveNoticeTimer);};host.append(message,close);document.body.append(host);}
 clearTimeout(quickSaveNoticeTimer);$('quickSaveNoticeText').textContent=text;host.dataset.error=String(error);host.querySelector('button').hidden=!error;host.hidden=false;
 if(!error)quickSaveNoticeTimer=setTimeout(()=>{host.hidden=true;},3500);
}
function quickSaveExplore(kind,source){
 try{
  if(!auth?.token||!toolAllowed('records'))throw Error('保存するには、記録を利用できるアカウントでログインしてください');
  const cur={...planSnapshot(source),saveOwner:{generation:authGeneration,loginId:auth.loginId},direct:true};
  if(cur.payload?.kind!=='aim')throw Error('撮影地点と対象を選んでください');
  let result;
  if(kind==='place')result=MyPlacesUI.quickRecord({...SkyMapUI.selectionState()?.observer,...cur.observer,elevation:cur.payload.o[3],eyeHeightAGL:cur.payload.o[4]},cur.target);
  else if(kind==='plan'){const existing=schedule().find(cur.payload);result=existing?{ok:true,already:true}:keepNotebookPlan(cur,{title:cur.title,start:cur.start,end:cur.end});}
  else throw Error('保存先を確認してください');
  if(!result?.ok)throw Error(result?.error||'保存できませんでした。端末の保存設定や空き容量を確認してください');
  quickSaveNotice(result.already?'すでに登録されています':kind==='place'?'撮影地点に登録しました':'予定に保存しました');
 }catch(e){quickSaveNotice(e.message||'保存できませんでした',true);}
}
function notebookPlanIssue(p){
  if(!auth?.token||!toolAllowed('records'))return 'アカウントまたは利用権限が変わりました。予定を開き直してください。';
  if(!AstroNotesPlan.valid(p)||p.kind!=='aim'||!AstroNotesBodies.definition(p.body))return 'この予定の撮影条件を確認できません。';
  if(!screenAllowed('framing')||!screenAllowed('skymap')||!AstroNotesAccess.canFrame(toolAllowed,p.t.id,p.body))return 'この予定の天体・対象を開く権限がありません。';
  return '';
}
function notebookPlanNotice(text){if(globalThis.TrialExplore?.active()&&globalThis.AstroNotesJourney?.notice){AstroNotesJourney.notice(text);return;}let p=$('notebookPlanNotice');if(!p){p=document.createElement('p');p.id='notebookPlanNotice';p.className='warn';p.setAttribute('role','status');$('scheduleHub').prepend(p);}p.textContent=text;}
function notebookSavedCurrent(saved){return !!saved?.ok&&saved.saveOwner?.generation===authGeneration&&saved.saveOwner?.loginId===auth?.loginId&&!!auth?.token&&toolAllowed('records')&&schedule().list().some(r=>r.id===saved.row?.id&&JSON.stringify(r)===JSON.stringify(saved.row));}
function openNotebookExplore(){if(!screenAllowed('framing')||!screenAllowed('skymap'))return;pushRoute('#/explore');}
function showNotebookPlans(){if(!auth?.token||!toolAllowed('records'))return;setNotebookTab('plans');pushRoute('#/records');}
let notebookOpening=false;
async function openNotebookPlan(row){
  if(notebookOpening)return false;globalThis.AstroNotesJourney?.notice('');const issue=notebookPlanIssue(row?.value);if(issue){notebookPlanNotice(issue);return false;}
  const owner={loginId:auth.loginId,generation:authGeneration},stamp=JSON.stringify(row);notebookOpening=true;
  try{
    await AstroNotesAssets.ensureModels();
    if(owner.loginId!==auth?.loginId||owner.generation!==authGeneration||notebookPlanIssue(row.value)||!schedule().list().some(r=>r.id===row.id&&JSON.stringify(r)===stamp)){notebookPlanNotice('予定または利用権限が変わりました。予定一覧から開き直してください。');return false;}
    restoreSharedPlan(structuredClone(row.value),{persist:false});aim.from={...aim.from,subtitle:'予定の撮影地点'};
    if(location.hash!=='#/aim')pushRoute('#/aim');else if(globalThis.TrialExplore)globalThis.TrialExplore.routeChanged();else openAim();
    globalThis.AstroNotesJourney?.remember(row,owner);globalThis.AstroNotesJourney?.render();return true;
  }catch{globalThis.AstroNotesJourney?.forget();notebookPlanNotice('予定を開けませんでした。通信状態を確認してもう一度お試しください。');return false;}
  finally{notebookOpening=false;}
}
async function preparePlanShare(button,{current=()=>true}={}){
 const owner={token:auth?.token,generation:authGeneration,loginId:auth?.loginId},source=button?.dataset?.planSource||'aim',started=Date.now();
 if(source!=='detail')for(const b of document.querySelectorAll('.tool-datetime-play[data-playing="true"]'))b.click();
 for(;;){
  if(!current())throw Error('共有の準備を取り消しました。');
  if(owner.token!==auth?.token||owner.generation!==authGeneration||owner.loginId!==auth?.loginId)throw Error('アカウントが変わりました。共有画面を開き直してください。');
  try{return {...planSnapshot(button),saveOwner:{generation:owner.generation,loginId:owner.loginId}};}
  catch(e){
   const selection=SkyMapUI?.selectionState?.();
   if(source==='detail'||!selection?.observer||!selection?.target||!/(見え方の更新|計算が終わってから)/.test(e.message||''))throw e;
   if(Date.now()-started>=8000)throw Error('共有の準備に時間がかかっています。「再試行」を押してください。');
   if(source==='aim')globalThis.TrialExplore?.sync();
   await new Promise(resolve=>setTimeout(resolve,50));
  }
 }
}
function initPlanSharing() {
  for(const [id,t] of [['notebookPointsTab','points'],['notebookPlansTab','plans']]){$(id).onclick=()=>setNotebookTab(t);$(id).onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();setNotebookTab(e.key==='Home'?'points':e.key==='End'?'plans':notebookTab==='points'?'plans':'points',true);}};}
  globalThis.AstroNotesPlanUI=AstroNotesPlan.mount({snapshot:preparePlanShare,show:showSheet,keep:keepNotebookPlan,canKeep:()=>!!auth?.token&&toolAllowed('records'),quickSave:quickSaveExplore,openNotebook:saved=>{if(!notebookSavedCurrent(saved))return false;afterPagePop(()=>{if(notebookSavedCurrent(saved))showNotebookPlans();});return true;}});
}

initPlanSharing();
restoreSharedPlan();

const scrollLock = (() => {
  let y = 0, depth = 0;
  const props = ["position", "top", "left", "right", "width", "overflow"];
  return {
    on() {
      if (depth++) return;                       // 入れ子で開いても1回だけ
      y = window.scrollY;
      // iOS は body の overflow:hidden だけでは止まらないので位置を固定する。
      // その分ページが先頭へ飛ぶので、top で元の位置に見せておく。
      Object.assign(document.body.style, {
        position: "fixed", top: `${-y}px`, left: "0", right: "0", width: "100%", overflow: "hidden",
      });
    },
    off() {
      if (depth > 0 && --depth) return;
      depth = 0;
      for (const k of props) document.body.style.removeProperty(k);
      window.scrollTo(0, y);                     // 見ていた位置へ戻す
    },
  };
})();
// Dynamic dialogs (including shooting-point records) participate in the same lock.
const syncDialogScrollLock = (() => {
  let locked = false;
  return () => {
    const open = !!document.querySelector('dialog[open]');
    if (open === locked) return;
    locked = open;
    if (open) scrollLock.on(); else scrollLock.off();
  };
})();
new MutationObserver(syncDialogScrollLock).observe(document.body, {
  childList: true, subtree: true, attributes: true, attributeFilter: ['open'],
});
syncDialogScrollLock();

renderAuthButton();
let resolveStartupAccess;
const startupSessionReady = new Promise(resolve => { resolveStartupAccess = resolve; });
restoreSession({onAccessReady: resolveStartupAccess}).finally(resolveStartupAccess);
checkForUpdate();
