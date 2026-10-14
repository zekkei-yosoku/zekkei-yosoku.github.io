/* Shared application shell. The existing auth/API remain the authority for protected tools. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const validPoint = p => p && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180;
  const validAt = at => Number.isFinite(at) && Number.isFinite(new Date(at).getTime());
  const ownerKey = () => auth?.loginId || 'guest';
  let knownDataOwner = dataOwner;
  let owner = ownerKey(), context = {point:clone(owner==='guest'&&knownDataOwner?DEFAULT_PLACE:place),at:Date.now(),timeZone:'Asia/Tokyo'};
  let memories = defaults(), toolKey = '', skyKey = '', observationKey = '', planDraft = null;
  let renderBusy = false, capturing = false, handledSharedFragment = null;
  function defaults(){return {astro:{hash:'#/astro',y:0},forecast:{hash:'#',y:0}};}
  function pointKey(p){return JSON.stringify([p?.latitude,p?.longitude,p?.elevation??p?.groundManualM,p?.eyeHeightAGL??p?.standAglM,p?.name]);}
  function forecastCurrent(){const key=p=>JSON.stringify([p?.latitude,p?.longitude,p?.elevation??null,p?.eyeHeightAGL??1.5,p?.terrain??null]);return !!predictionPlace&&key(predictionPlace)===key(place)&&key(place)===key({...context.point,elevation:context.point.elevation??context.point.groundManualM??null,eyeHeightAGL:context.point.eyeHeightAGL??context.point.standAglM??1.5});}
  function observerPoint(p){return aimSavedFrom({...p,groundManualM:Object.prototype.hasOwnProperty.call(p,'groundManualM')?p.groundManualM:p.elevation??null});}
  function contextKey(id){return 'sorami.platformContext.v1:'+encodeURIComponent(id);}
  function saveContext(){if(owner!=='guest'&&owner===ownerKey())store.set(contextKey(owner),{...context,owner});}
  function savedContext(id){const value=store.get(contextKey(id),null);return value?.owner===id&&validPoint(value.point)&&validAt(value.at)&&value.timeZone==='Asia/Tokyo'?{point:clone(value.point),at:value.at,timeZone:value.timeZone}:null;}
  function dateValue(at){return new Date(at+32400000).toISOString().slice(0,16);}
  function dateText(at){return new Intl.DateTimeFormat('ja-JP',{timeZone:context.timeZone,year:'numeric',month:'numeric',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(at);}
  function canRoute(r){
    if(r?.skymap)return !!auth?.token && toolAllowed('skymap');
    if(r?.aim)return !!auth?.token && ['diamond','pearl','tower'].some(toolAllowed);
    if(r?.plane)return !!auth?.token && toolAllowed('plane');
    if(r?.iss)return !!auth?.token && toolAllowed('iss');
    if(r?.records)return !!auth?.token && toolAllowed('records');
    return true;
  }
  function notify(text){el('platformNotice').textContent=text;el('platformNotice').hidden=!text;}
  function capture(){
    if(capturing || owner!==ownerKey())return;
    capturing=true;
    let value=null;
    if(atSkyMap)value=SkyMapUI?.context();
    else if(atAim && canRoute({aim:true})){
      const host=el('aimLook'),p=aimFromPoint();
      const at=!host.hidden&&host._planKey===aimLookKey()&&Number.isFinite(host._lookAt)?host._lookAt:Number.isFinite(aim.dayMs)?aim.dayMs+((context.at+32400000)%86400000):context.at;
      if(validPoint(p))value={point:{...p,elevation:Number.isFinite(p.groundManualM)?p.groundManualM:Number.isFinite(aim.fromGround)?aim.fromGround:null,eyeHeightAGL:aimObserverEye(p)},at};
    }else if(!atSkyMap&&!atAim&&!atPlane&&!atIss&&!atRecords&&!atAdmin){
      const r=routeFromHash();
      if(r?.id&&forecastCurrent()){const day=selectedDay[r.id]??r.dayMs,ev=weeks[r.id]?.find(e=>e.dayMs===day)?.evaluation;if(Number.isFinite(ev?.peak))value={point:place,at:ev.peak};}
    }
    if(value&&validPoint(value.point)&&validAt(value.at)){const before=JSON.stringify(context),same=value.point.latitude===context.point.latitude&&value.point.longitude===context.point.longitude;context={...context,point:clone(same?{...context.point,...value.point}:value.point),at:value.at};if(JSON.stringify(context)!==before)saveContext();}
    capturing=false;
  }
  function syncForecast(){
    const p=context.point;
    if(pointKey(place)!==pointKey(p)){
      const same=place.latitude===p.latitude&&place.longitude===p.longitude;
      place={...(same?place:{}),...p,elevation:p.elevation??p.groundManualM??null,eyeHeightAGL:p.eyeHeightAGL??p.standAglM??1.5};
      store.set('sorami.place',place);selectedDay={};load(true);
    }
  }
  function setContext(value){
    if(!validPoint(value.point)||!validAt(value.at))return false;
    context={...context,point:clone(value.point),at:value.at};saveContext();observationKey='';
    syncForecast();
    if(atSkyMap&&canRoute({skymap:true})){SkyMapUI.useContext(context);SkyMapUI.open(true);}
    if(atAim&&canRoute({aim:true})){aimSetFrom(observerPoint(context.point));el('aimDate').value=dateValue(context.at).slice(0,10);aim.plannerTransfer={at:context.at,body:aim.body,latitude:context.point.latitude,longitude:context.point.longitude,day:S.JstCal.startOfDay(context.at)};aimApply();}
    renderUI();return true;
  }
  function beforeRoute(next){
    const fragment=location.hash,token=new URLSearchParams(fragment.split('?')[1]||'').get('plan'),shared=fragment!==handledSharedFragment&&token?SoramiPlan.decode(token):null;handledSharedFragment=fragment;
    if(shared&&((next?.aim&&shared.kind==='aim')||(next?.id===shared.id&&shared.kind==='detail')))context={point:SoramiPlan.expandPoint(shared.o),at:shared.at,timeZone:context.timeZone};else capture();
    if(!next || next.id)syncForecast();
    if(next?.skymap && !atSkyMap && canRoute(next)){
      const key=JSON.stringify(context);
      if(key!==skyKey){SkyMapUI?.useContext(context);skyKey=key;}
    }
    if(next?.aim&&!atAim&&canRoute(next)&&!location.hash.includes('?plan=')){
      const p=context.point;aim.from=observerPoint(p);el('aimDate').value=dateValue(context.at).slice(0,10);aim.plannerTransfer={at:context.at,body:aim.body,latitude:p.latitude,longitude:p.longitude,day:S.JstCal.startOfDay(context.at)};
    }
  }
  function switchMode(mode){
    if(!['astro','forecast'].includes(mode)||mode===activeMode)return;
    capture();
    const r=routeFromHash();
    if(!r?.records&&!r?.plans&&!r?.admin)memories[activeMode]={hash:r?.aim?'#/aim':location.hash||'#',y:window.scrollY};
    activeMode=mode;
    const saved=memories[mode],hash=saved.hash;
    modeReturnY=saved.y;
    pushRoute(hash);
  }
  function openTool(hash){
    if(hash==='#/skymap'){SkyMapUI?.useContext(context);skyKey=JSON.stringify(context);}
    pushRoute(hash);
  }
  function authChanged(){
    const next=ownerKey();
    if(next!==owner){
      const old=owner;if(old!=='guest')store.set(contextKey(old),{...context,owner:old});owner=next;memories=defaults();planDraft=null;toolKey='';skyKey='';observationKey='';
      if(el('platformPlanSheet').open)el('platformPlanSheet').close();
      el('platformPlanName').value='';el('platformPlanMemo').value='';
      el('platformPlansList').replaceChildren();
      if(old!=='guest'||knownDataOwner&&knownDataOwner!==next){
        context=(next!=='guest'&&savedContext(next))||{point:clone(DEFAULT_PLACE),at:Date.now(),timeZone:'Asia/Tokyo'};
        syncForecast();
      }
      else if(next!=='guest'&&knownDataOwner===next){context=savedContext(next)||{point:clone(store.get('sorami.place',DEFAULT_PLACE)),at:context.at,timeZone:context.timeZone};syncForecast();}
      if(next!=='guest')knownDataOwner=next;
      if(atSkyMap&&canRoute({skymap:true})){SkyMapUI?.useContext(context);SkyMapUI?.open(true);}
    }
    renderUI();enforce();
  }
  const access=document.createElement('section');access.id='platformToolAccess';access.className='card';access.hidden=true;access.setAttribute('role','status');
  const accessText=document.createElement('p'),accessLogin=document.createElement('button');accessLogin.className='chip';accessLogin.textContent='アカウントを確認';accessLogin.onclick=()=>el('authButton').click();access.append(accessText,accessLogin);el('platformContext').after(access);
  function enforce(){
    const r=routeFromHash(),allowed=canRoute(r);access.hidden=allowed;
    if(!allowed){
      const id=r?.aim?'aimView':r?.plane?'planeView':r?.iss?'issView':r?.records?'recordsView':null;
      if(id)el(id).hidden=true;
      if(r?.skymap)access.hidden=true; // This tool has its own server-backed access panel.
      accessText.textContent=auth?'この機能の利用権限がありません。アカウントの利用権限を確認してください。':'この機能を使うにはログインしてください。';
    }
    const current=forecastCurrent();el('cards').hidden=!current;el('bestNote').hidden=!current;
    if(r?.id&&!current)el('detailView').hidden=true;
  }
  function renderToolsHome(){
    const source=[...el('astroToolsGroup').querySelectorAll('[data-tool]')].filter(b=>!b.hidden);
    const key=JSON.stringify([owner,source.map(b=>b.dataset.tool)]);
    if(key!==toolKey){toolKey=key;el('astroLaunchers').replaceChildren(...source.map(b=>{
      const button=document.createElement('button');button.type='button';button.innerHTML=UI_ICONS[b.dataset.tool==='#/skymap'?'map':'observer']+b.innerHTML;
      button.onclick=()=>openTool(b.dataset.tool);return button;
    }));}
    el('astroAccessMessage').hidden=source.length>0;
    el('astroAccessMessage').textContent=auth?'利用できる観測ツールがありません。アカウントの利用権限を確認してください。':'天体ツールを使うにはログインしてください。';
    el('astroLogin').hidden=!!auth||source.length>0;
  }
  function renderObservation(){
    const key=JSON.stringify(context);if(key===observationKey)return;observationKey=key;
    try{
      const obs={...context.point,elevation:context.point.elevation??0},moon=SoramiAstro.moon(context.at,obs),sun=SoramiAstro.sun(context.at,obs);
      const phase=SoramiMoon.phaseOf(moon),hhmm=at=>new Intl.DateTimeFormat('ja-JP',{timeZone:context.timeZone,hour:'2-digit',minute:'2-digit',hour12:false}).format(at);
      const day=Date.parse(dateValue(context.at).slice(0,10)+'T00:00:00+09:00');
      const events=SoramiAstro.moonEvents(day,day+86400000,obs,{}).astronomical;
      const rise=events.find(e=>e.kind==='rise'),set=events.find(e=>e.kind==='set');
      el('platformMoonPhase').textContent=phase.name;
      el('platformMoonPosition').textContent=`高度 ${moon.apparentAltitude.toFixed(1)}° · 方位 ${moon.azimuth.toFixed(1)}°`;
      el('platformMoonTimes').textContent=`月の出 ${rise?hhmm(rise.at):'この日はなし'} / 月の入 ${set?hhmm(set.at):'この日はなし'}`;
      el('platformSun').innerHTML=`<div class="platform-sun-grid"><div><span class="platform-label">太陽の高度</span><strong>${sun.apparentAltitude.toFixed(1)}°</strong></div><div><span class="platform-label">月の輝面率</span><strong>${Math.round(moon.illuminatedFraction*100)}%</strong></div></div><p class="tiny">${moon.apparentAltitude<0?'月は地平線の下です。':'月の見える方向をAstro Mapで確認できます。'} 天候や地形による遮りは別途確認してください。</p>`;
      drawMoon(moon);
    }catch{observationKey='';el('platformMoonPosition').textContent='天体情報を計算できません。地点と日時を確認してください。';el('platformMoonTimes').textContent='';el('platformSun').textContent='天体情報を取得できませんでした。';}
  }
  function drawMoon(moon){
    const c=el('platformMoonCanvas').getContext('2d'),image=c.createImageData(240,240),cos=2*moon.illuminatedFraction-1,sin=Math.sqrt(Math.max(0,1-cos*cos))*(moon.waxing?1:-1);
    for(let y=0;y<240;y++)for(let x=0;x<240;x++){
      const nx=(x-120)/101,ny=(y-120)/101,r=nx*nx+ny*ny;if(r>1)continue;
      const nz=Math.sqrt(1-r),light=Math.max(0,nx*sin+nz*cos),grain=1-.04*Math.sin(x*.22)*Math.sin(y*.18),v=(28+210*Math.sqrt(light))*grain,i=(y*240+x)*4;
      image.data[i]=v*.94;image.data[i+1]=v*.97;image.data[i+2]=v;image.data[i+3]=255;
    }
    c.putImageData(image,0,0);
  }
  function renderForecast(){
    if(activeMode!=='forecast'||routeFromHash())return;
    const host=el('platformForecastFocus'),day=S.Cal.startOfDay(context.at),rows=[];
    for(const [id,entries] of Object.entries(forecastCurrent()?weeks:{})){
      const entry=entries.find(e=>e.dayMs===day),ev=entry?.evaluation;if(!ev)continue;
      rows.push(`<div class="platform-forecast-row"><strong>${esc(S.longNameOf(id))}</strong><span>${ev.unavailable?esc(ev.unavailable.message):`${Math.round(ev.score)}点 · ${esc(S.phrasing(id,ev.rank).label)}`}</span></div>`);
    }
    host.innerHTML=`<p class="platform-label">${esc(dateValue(context.at).slice(0,10).replaceAll('-','/'))} の予測</p>`+(rows.length?rows.slice(0,6).join('')+'<p class="tiny">現象ごとの見頃を評価した点数です。選択した時刻の発生確率ではありません。根拠と詳しい時刻は下の一覧から確認できます。</p>':'<p class="tiny">この日の予測データはありません。取得中・予報期間外・取得不能の場合は点数を表示しません。</p>');
  }
  function planKey(){return 'sorami.platformPlans.v1:'+encodeURIComponent(ownerKey());}
  function readPlans(){
    if(!auth?.token)return [];
    const raw=store.get(planKey(),[]);return Array.isArray(raw)?raw.filter(p=>p?.v===1&&p.owner===ownerKey()&&typeof p.id==='string'&&typeof p.name==='string'&&validPoint(p.point)&&validAt(p.at)&&['astro','forecast'].includes(p.mode)).slice(0,200):[];
  }
  function openPlan(){
    if(!auth?.token){notify('計画を保存するにはログインしてください。');el('authButton').click();return;}
    capture();planDraft={owner,generation:authGeneration,context:clone(context),mode:activeMode};
    el('platformPlanName').value=`${context.point.name}で${activeMode==='astro'?'天体観測':'絶景撮影'}`;
    el('platformPlanMemo').value='';el('platformPlanError').hidden=true;el('platformPlanContext').textContent=`${context.point.name} · ${dateText(context.at)}`;
    showSheet(el('platformPlanSheet'));
  }
  function renderPlans(){
    if(!routeFromHash()?.plans)return;
    const host=el('platformPlansList');
    if(!auth?.token){host.innerHTML='<p class="card tiny">ログインすると、このアカウントの計画を確認できます。</p>';return;}
    const plans=readPlans();host.replaceChildren();
    if(!plans.length){host.innerHTML='<p class="card tiny">まだ計画がありません。地点と日時を選び「＋ 計画」から保存できます。</p>';return;}
    for(const p of plans){
      const card=document.createElement('article');card.className='platform-plan';
      const h=document.createElement('h3');h.textContent=p.name;
      const info=document.createElement('p');info.className='tiny';info.textContent=`${p.mode==='astro'?'AstroNotes':'絶景予測'} · ${p.point.name}\n${dateText(p.at)}`;
      const memo=document.createElement('p');memo.className='tiny';memo.textContent=typeof p.memo==='string'?p.memo:'';
      const actions=document.createElement('div');actions.className='platform-plan-actions';
      for(const [mode,label] of [['astro','天体を確認'],['forecast','予測を確認']]){
        const b=document.createElement('button');b.type='button';b.className='chip';b.textContent=label;
        b.onclick=()=>{if(owner!==ownerKey()||!auth?.token)return;setContext({point:p.point,at:p.at});activeMode=mode;pushRoute(mode==='astro'?'#/astro':'#');};actions.append(b);
      }
      card.append(h,info,memo,actions);host.append(card);
    }
  }
  function renderUI(){
    if(renderBusy)return;renderBusy=true;
    try{
      el('platformPlaceName').textContent=context.point.name||'選択地点';
      el('platformPlaceSub').textContent=Number.isFinite(context.point.elevation)?`標高 ${Math.round(context.point.elevation)}m`:'';
      el('platformDateText').textContent=dateText(context.at);
      el('platformContext').hidden=!!routeFromHash()?.admin;
      renderToolsHome();if(routeFromHash()?.astro)renderObservation();renderForecast();renderPlans();
      const isAstro=activeMode==='astro';
      el('platformLinkTitle').textContent=isAstro?'絶景予測と連携':'AstroNotesと連携';
      el('platformLinkText').textContent=isAstro?'同じ地点・日時で、気象条件と見通しを確認。':'同じ地点・日時で、天体の位置と観測条件を確認。';
      el('platformLink').hidden=!!(routeFromHash()?.admin||routeFromHash()?.plans||routeFromHash()?.records);
      const r=routeFromHash(),nav=r?.plans?'plans':r?.records?'records':r?.skymap?'map':'home';
      for(const b of document.querySelectorAll('[data-platform-nav]')){if(b.dataset.platformNav===nav)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
      enforce();
    }finally{renderBusy=false;}
  }
  PLACE_PICKERS.platform={title:'共通の観測地点',point:()=>context.point,custom:()=>context.point,set:p=>setContext({...context,point:p}),reset:()=>setContext({...context,point:clone(DEFAULT_PLACE)})};
  el('platformPlace').onclick=el('platformSearch').onclick=()=>openPlaceSheet('platform');
  el('platformSearch').innerHTML=UI_ICONS.search;
  el('platformSettings').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="var(--card)"/><circle cx="15" cy="12" r="2" fill="var(--card)"/><circle cx="9" cy="18" r="2" fill="var(--card)"/></svg>';
  el('platformSettings').onclick=()=>showSheet(el('platformSettingsSheet'));
  el('platformSettingsClose').onclick=()=>el('platformSettingsSheet').close();
  el('platformAccount').onclick=()=>{el('platformSettingsSheet').close();el('authButton').click();};
  el('platformFavorites').onclick=()=>{el('platformSettingsSheet').close();openPlaceSheet('platform');document.querySelector('[data-history-panel="favorites"]')?.click();};
  el('platformDate').onclick=()=>{capture();el('platformDateInput').value=dateValue(context.at);el('platformDateError').hidden=true;showSheet(el('platformDateSheet'));};
  el('platformDateClose').onclick=()=>el('platformDateSheet').close();
  el('platformDateNow').onclick=()=>{el('platformDateInput').value=dateValue(Date.now());};
  el('platformDateApply').onclick=()=>{const input=el('platformDateInput'),at=Date.parse(input.value+':00+09:00');if(!input.value||!input.checkValidity()||!Number.isFinite(at)){el('platformDateError').textContent='有効な日時を選んでください。';el('platformDateError').hidden=false;return;}setContext({...context,at});el('platformDateSheet').close();};
  el('platformObservePlan').onclick=el('platformForecastPlan').onclick=el('platformAddPlan').onclick=openPlan;
  el('platformPlanClose').onclick=()=>{planDraft=null;el('platformPlanSheet').close();};
  el('platformPlanSave').onclick=()=>{
    const name=el('platformPlanName').value.trim();
    if(!planDraft||!auth?.token||planDraft.owner!==ownerKey()||planDraft.generation!==authGeneration){planDraft=null;el('platformPlanSheet').close();notify('ログイン状態が変わりました。計画を開き直してください。');return;}
    if(!name){el('platformPlanError').textContent='計画名を入力してください。';el('platformPlanError').hidden=false;return;}
    const p={v:1,id:crypto.randomUUID(),owner,name:name.slice(0,120),memo:el('platformPlanMemo').value.slice(0,2000),point:planDraft.context.point,at:planDraft.context.at,timeZone:planDraft.context.timeZone,mode:planDraft.mode,createdAt:Date.now()};
    if(!store.set(planKey(),[p,...readPlans()].slice(0,200))){el('platformPlanError').textContent='保存できませんでした。ブラウザの保存設定や空き容量を確認してください。';el('platformPlanError').hidden=false;return;}
    planDraft=null;el('platformPlanSheet').close();notify('このブラウザに計画を保存しました。「計画」から確認できます。');renderPlans();
  };
  el('platformLinkGo').onclick=()=>switchMode(activeMode==='astro'?'forecast':'astro');
  const icons={home:'<path d="m3 11 9-8 9 8v10h-6v-7H9v7H3Z"/>',plan:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18"/>',record:'<path d="M5 3h14v18H5Z M8 8h8M8 12h8M8 16h5"/>'};
  for(const n of document.querySelectorAll('[data-nav-icon]'))n.innerHTML=n.dataset.navIcon==='map'?UI_ICONS.map:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true">${icons[n.dataset.navIcon]}</svg>`;
  for(const b of document.querySelectorAll('[data-platform-nav]'))b.onclick=()=>{
    const action=b.dataset.platformNav;
    if(action==='home')pushRoute(activeMode==='astro'?'#/astro':'#');
    if(action==='plans')pushRoute('#/plans');
    if(action==='records')pushRoute('#/records');
    if(action==='map'){if(activeMode==='astro')openTool('#/skymap');else{openPlaceSheet('platform');el('mapButton').click();}}
  };
  // Capture user edits at interaction boundaries, not on every animation frame.
  for(const event of ['change','pointerup'])document.addEventListener(event,e=>{if(e.target.closest('#skyMapView,#aimView'))requestAnimationFrame(()=>{capture();renderUI();});});
  for(const id of ['platformDateSheet','platformPlanSheet','platformSettingsSheet']){
    const d=el(id);new MutationObserver(()=>d.open?scrollLock.on():scrollLock.off()).observe(d,{attributes:true,attributeFilter:['open']});
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)authChanged();});
  window.addEventListener('storage',e=>{
    if(e.key===TOKEN_KEY){
      let value=null;try{value=JSON.parse(e.newValue);}catch{}
      if(auth&&value?.loginId===auth.loginId&&typeof value.token==='string'){
        capture();auth={...auth,token:value.token};try{sessionStorage.setItem(TOKEN_KEY,JSON.stringify(auth));}catch{}
        if(atSkyMap)SkyMapUI?.useContext(context);renderAuthButton();
      }else{
        // Never restore another tab's account over this tab's unsent private queue.
        authGeneration++;auth=null;clearAdminView();favorites=[];sightings=[];pushQueue=[];syncInfo=null;
        try{sessionStorage.removeItem(TOKEN_KEY);}catch{}
        renderAuthButton();render();notify('別のタブでログイン状態が変わりました。この画面を使うにはログインし直してください。');
      }
    }else if(e.key===planKey())renderPlans();
  });
  PlatformUI={render:renderUI,enforce,beforeRoute,switchMode,authChanged,afterRoute(){capture();renderUI();},context:()=>clone(context),setContext,forecastCurrent};
  if(owner!=='guest')context=savedContext(owner)||context;
  el('modeAstro').textContent='AstroNotes';
  beforeRoute(routeFromHash());
  renderModes();renderUI();
})();
