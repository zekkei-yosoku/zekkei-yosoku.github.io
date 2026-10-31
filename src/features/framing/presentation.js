import {$,S} from '../../app/presentation-helpers.js';
import {SkyMapUI,favorites,place,store} from '../../app/browser-state.js';
import {navigationHistory} from '../../app/navigation.js';
import {choosePlace,openFavSheet,placeSheetFor,requireLoginForFavorites} from '../places/controller.js';
import {MAP_ICON_LOCATE,createMapView} from '../../ui/map/picker.js';
import {AimMap,TARGET_FIXED_CATEGORIES,aim,aimElevation,aimFillSelects,aimFitLines,aimTargetList,editTargetCategory,persistTargetDraft,targetCategoryList,targetCategoryOf,targetLocationLabel} from './controller.js';
import {aimApply} from '../satellites/controller.js';
import {aimCal,aimCalMove,aimFromPoint,resetAimCalSwipe} from './observer.js';
import {aimSideName,aimUpdateLook} from './candidates.js';
import {aimLens,aimLookHMS} from '../../ui/scene/lens.js';
import {aimLookRender} from '../../ui/scene/render.js';
import {aimAirSettings,aimLookKey,openAim} from './reverse-and-entry.js';
import {nearName,openPlaceSheet,wireSearchBox} from '../../services/place-search.js';
import {auth} from '../account/session-and-access.js';
import {showSheet} from '../../app/overlays.js';
import {planSnapshot,restoreSharedPlan} from '../plans/controller.js';
import {UI_ICONS,uiVisualChoices} from '../../ui/visual-primitives.js';
(()=>{
 const el=id=>document.getElementById(id),root=el('aimView'),look=el('aimLook'),scene=el('previewScene'),places=el('previewPlaces'),tabs=[el('previewSceneTab'),el('previewPlacesTab')],wide=matchMedia('(min-width:960px)');
 const retired=document.createElement('div');retired.id='retiredShootingUI';retired.hidden=true;retired.inert=true;retired.append(places,tabs[1]);document.body.append(retired);
 let mode='scene',resultKey='';
 function show(which,focus=false){
  which='scene';mode=which;const both=false;
  scene.hidden=!both&&which!=='scene';places.hidden=!both&&which!=='places';
  tabs.forEach((t,i)=>{const on=(i===0)===(which==='scene');t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;if(focus&&on)t.focus();});
  requestAnimationFrame(()=>{if(!places.hidden){const key=`${aim.target?.id}|${aim.body}|${aim.dayMs}|${aim.partId}|${aim.limb}|${aim.lines?.length}`;if(aim.lines?.length&&places._lineFitKey!==key){places._lineFitKey=key;aimFitLines(aim.lines);}AimMap.redraw();}if(!scene.hidden&&look._lookSpec&&!look.hidden){const cv=look.querySelector('canvas');if(cv&&Math.round(cv.clientWidth)!==look._lookW)aimLookRender(look,look._lookSpec);}});
 }
 tabs.forEach((t,i)=>{t.onclick=()=>{show(i?'places':'scene');update();};t.onkeydown=e=>{let j;if(e.key==='ArrowRight'||e.key==='ArrowLeft')j=1-i;else if(e.key==='Home')j=0;else if(e.key==='End')j=1;else return;e.preventDefault();show(j?'places':'scene',true);};});
 wide.addEventListener('change',()=>show(mode));show('scene');
 const dateSection=root.querySelector('.aim-date-section'),dateTime=document.createElement('div');
 dateTime.className='preview-date-time';dateTime.innerHTML='<input id="previewTime" type="time" step="60" aria-label="撮影時刻を入力"><button type="button" class="chip" id="previewReference"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 8v4l3 2M2 12h4m-2-2 2 2-2 2"/></svg></button>';
 el('aimCalendarOpen').after(dateTime);
 const footer=document.createElement('footer');footer.className='preview-datetime-footer';footer.setAttribute('aria-label','撮影の日時');
 const dateRow=root.querySelector('.aim-date');footer.append(dateRow);root.append(footer);
 if(typeof ResizeObserver==='function')new ResizeObserver(()=>{if(footer.offsetHeight)document.documentElement.style.setProperty('--aim-footer-h',footer.offsetHeight+'px');}).observe(footer);
 const timeMore=document.createElement('button');timeMore.type='button';timeMore.className='preview-time-more';timeMore.textContent='⋯';timeMore.setAttribute('aria-label','時刻の操作設定');timeMore.setAttribute('aria-haspopup','dialog');dateRow.append(timeMore);
 // 指で選んで閉じたダイアログから焦点が戻っても青い選択枠を出さない。キーボード操作では枠を残す。
 // 下部欄だけでなく天体・目標・画角の選択ボタンも同じ（2026-10-05 iOS 27で天体の選択後に青枠を確認）。
 let keyNav=false;
 addEventListener('keydown',e=>{if(e.metaKey||e.ctrlKey)return;keyNav=true;document.activeElement?.removeAttribute?.('data-pointer-focus');},true);
 addEventListener('pointerdown',()=>{keyNav=false;},true);
 root.addEventListener('focusin',e=>e.target.toggleAttribute('data-pointer-focus',!keyNav));
 root.addEventListener('focusout',e=>e.target.removeAttribute('data-pointer-focus'));
 const footerRel=document.createElement('span');footerRel.className='preview-footer-rel';footerRel.setAttribute('aria-live','off');dateTime.append(footerRel);
 let scrubMode='time';
 const scrub=document.createElement('div');scrub.className='sky-map-scrub preview-footer-scrub';
 const scrubModes=document.createElement('div');scrubModes.className='sky-map-scrub-modes';scrubModes.setAttribute('role','group');scrubModes.setAttribute('aria-label','日時のスクロール単位');
 const scrubToggle=document.createElement('button');scrubToggle.type='button';scrubToggle.id='previewScrubMode';scrubToggle.onclick=()=>{const at=look._uiTime?.current;previewTimeline.stop();scrubMode=ToolDateTimeBar.nextMode(scrubMode);if(Number.isFinite(at))commitPreviewTime(at);update();};scrubModes.append(scrubToggle);
 const footerTrack=document.createElement('div');footerTrack.className='preview-footer-track';scrub.append(scrubModes,footerTrack);footer.append(scrub);
 const footerRange=document.createElement('input');footerRange.type='range';footerRange.step='any';footerRange.setAttribute('aria-label','撮影時刻を滑らかに調整');footerTrack.append(footerRange);
 footerRange.hidden=true;
 const footerTimeline=document.createElement('div');footerTimeline.className='sky-map-timeline';footerTimeline.tabIndex=0;footerTimeline.setAttribute('role','slider');footerTrack.append(footerTimeline);
 const center=document.createElement('span');center.className='sky-map-timeline-center';center.setAttribute('aria-hidden','true');footerTrack.append(center);
 function commitPreviewTime(at){const state=look._uiTime;if(!state)return;const day=S.JstCal.startOfDay(at);if(day!==aim.dayMs){look._uiRequestedTime={day,at,context:timeContext()};el('aimDate').value=new Date(day+32400000).toISOString().slice(0,10);aimApply({recenter:false});}}
 const previewTimeline=AstroNotesScrollTimeline.mount({root:footerTimeline,getAt:()=>look._uiTime?.current,getMode:()=>scrubMode,enabled:()=>!footerRange.disabled&&!root.hidden,getObserver:()=>look._lookSpec?.obs,sun:(at,o)=>AstroNotesAstro.sun(at,o),onChange:at=>{look._uiTime?.set(at);},onBlend:b=>look._uiTime?.blend(b),onSettle:at=>{commitPreviewTime(at);update();},format:(at,m)=>m==='date'?new Date(at+32400000).toISOString().slice(5,10).replace('-','/'):S.JstCal.hhmm(at).padStart(5,'0'),describe:at=>ToolDateTimeBar.label(at)+' '+S.JstCal.hhmm(at).padStart(5,'0')});
 ToolDateTimeBar.decorate({footer,row:dateRow,date:el('aimCalendarOpen'),time:el('previewTime'),prev:el('aimPrev'),next:el('aimNext'),more:timeMore,track:footerTrack,now:at=>{const state=look._uiTime;if(!state)return;if(S.JstCal.startOfDay(at)===state.day){look._uiAllDay=true;state.window();state.set(at);}else commitPreviewTime(at);update();}});
 const previewPlayback=ToolDateTimeBar.playback({row:dateRow,footer,getAt:()=>look._uiTime?.current,enabled:()=>!!look._uiTime&&!look.hidden&&footer.getClientRects().length>0&&!globalThis.TrialExplore?.active(),onStart:()=>{globalThis.AstroNotesCameraUI?.stop(look);previewTimeline.stop();},onStop:()=>{if(look._uiTime)update();},setAt:at=>{
  const state=look._uiTime;if(!state)return;
  if(S.JstCal.startOfDay(at)!==state.day){commitPreviewTime(at);return;}
  state.set(at);previewTimeline.follow(at,scrubMode);
 }});
 const timeDialog=document.createElement('dialog');timeDialog.className='sheet preview-body-dialog preview-time-dialog';timeDialog.tabIndex=-1;timeDialog.setAttribute('aria-label','時刻の操作設定');timeDialog.innerHTML='<div class="sheet-head"><strong>時刻の操作設定</strong><button type="button" data-time-close>閉じる</button></div><div class="sheet-body"></div>';root.append(timeDialog);
 const referenceControl=el('previewReference');timeDialog.querySelector('.sheet-body').append(referenceControl);timeMore.onclick=()=>showSheet(timeDialog);timeDialog.querySelector('[data-time-close]').onclick=()=>timeDialog.close();timeDialog.addEventListener('click',e=>{if(e.target!==timeDialog)return;const r=timeDialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)timeDialog.close();});
 const clock=el('previewTime'),reference=el('previewReference');
 clock.onchange=()=>{const m=/^(\d{2}):(\d{2})$/.exec(clock.value),state=look._uiTime;if(!m||!state||state.day!==aim.dayMs)return;const at=state.day+(+m[1]*60 + +m[2])*60000;if(at<state.day + +look.querySelector('[data-look-range]').min*1000||at>state.day + +look.querySelector('[data-look-range]').max*1000)look._uiAllDay=true;state.window();state.set(at);};
 reference.onclick=()=>{const state=look._uiTime;if(state){look._uiAllDay=false;state.window();state.set(state.reference);}if(timeDialog.open)timeDialog.close();};
 ToolDateTimeBar.mountCalendarDismiss(el("aimCalendar"));
 resetAimCalSwipe = ToolDateTimeBar.mountCalendarSwipe($("aimCalGrid"), offset => {
  $("aimCalGrid").dispatchEvent(new Event("change", { bubbles: true }));
  aimCalMove(offset);
}, () => $("aimCalendar").open);
 const calChoices=document.createElement('div');calChoices.className='preview-calendar-choices';calChoices.hidden=true;el('aimCalGrid').after(calChoices);
 const hideCalChoices=()=>{calChoices.hidden=true;calChoices.replaceChildren();};
 el('aimCalGrid').addEventListener('change',hideCalChoices);
 for(const id of ['aimCalPrev','aimCalNext','aimCalYear','aimCalMonth','aimCalToday'])el(id).addEventListener(id==='aimCalYear'||id==='aimCalMonth'?'change':'click',hideCalChoices);
 const timeContext=()=>`${aim.body}|${aim.target?.id}|${aim.partId}|${JSON.stringify(aimFromPoint())}`;
 el('aimCalendar').addEventListener('close',()=>{calChoices.hidden=true;calChoices.replaceChildren();});
 el('aimCalGrid').addEventListener('click',e=>{
  const button=e.target.closest('[data-cal-day]');if(!button)return;const day=+button.dataset.calDay,rows=aimCal.events.get(day)||[];
  look._uiRequestedTime=null;
  const select=event=>{aim.candSide=event.side;look._uiRequestedTime={day,at:event.at,context:timeContext()};button.onclick();};
  if(rows.length===1){e.stopImmediatePropagation();select(rows[0]);return;}
  if(rows.length>1){
   e.stopImmediatePropagation();calChoices.replaceChildren();const title=document.createElement('p');title.textContent=`${new Date(day+9*3600000).toISOString().slice(5,10).replace('-','/')} の時刻`;calChoices.append(title);
   for(const event of rows){const b=document.createElement('button');b.type='button';b.className='chip';b.textContent=`${S.JstCal.hhmm(event.at)} ${aimSideName(event.side)}`;b.onclick=()=>select(event);calChoices.append(b);}
   calChoices.hidden=false;calChoices.scrollIntoView({block:'nearest',behavior:'auto'});
  }
 },true);
 ToolDateTimeBar.editor({button:el('aimCalendarOpen'),time:clock,dialog:el('aimCalendar'),beforeOpen:()=>previewTimeline.stop()});
 const update=()=>{
  // 日付が入る前に作ると、未設定の日（1970/01/01）の曜日「(木)」だけが出る。
  const dateButton=el('aimCalendarOpen'),dateValue=el('aimDate').value;if(dateValue&&Number.isFinite(aim.dayMs))ToolDateTimeBar.dateText(dateButton,look._uiTime?.day===aim.dayMs?look._uiTime.current:aim.dayMs);

  const state=look._uiTime;
  const mapRange=el('previewMapTime'),mapOutput=el('previewMapTimeAt');
  if(mapRange&&mapOutput){
   mapRange.disabled=!state;const text=state?aimLookHMS(state.current):'—';if(mapOutput.textContent!==text)mapOutput.textContent=text;
   if(state){const scoped=(aim.lines||[]).filter(l=>!look._mapTimeSide||l.side===look._mapTimeSide).flatMap(l=>l.points.map(p=>p.at));
    const lo=scoped.length?Math.min(...scoped):state.day,hi=scoped.length?Math.max(...scoped):state.day+86400000;
    // 現在時刻も必ず範囲に含め、端へ寄せた表示と時刻値を矛盾させない。
    if(document.activeElement!==mapRange){mapRange.min=String((Math.min(lo,state.current)-state.day)/1000);mapRange.max=String((Math.max(hi,state.current)-state.day)/1000);mapRange.value=String((state.current-state.day)/1000);}
    mapRange.oninput=()=>look._uiTime?.set(state.day+(+mapRange.value)*1000);
    for(const button of places.querySelectorAll('[data-map-time-side]')){const line=(aim.lines||[]).find(l=>l.side===button.dataset.mapTimeSide);button.disabled=!line;button.onclick=()=>{look._mapTimeSide=button.dataset.mapTimeSide;aimFitLines([line]);const times=line.points.map(p=>p.at),min=Math.min(...times),max=Math.max(...times);state.set(Math.max(min,Math.min(max,state.current)));update();};}
   }
  }

  clock.disabled=reference.disabled=footerRange.disabled=!state||look.hidden||state.day!==aim.dayMs;
  scrubToggle.disabled=footerRange.disabled;ToolDateTimeBar.modeButton(scrubToggle,scrubMode);
  const refText=state?`${state.name} ${S.JstCal.hhmm(state.reference)}`:'時刻を計算中';const refLabel=state?`${refText}へ移動`:'時刻を計算中';if(reference.textContent!==refLabel)reference.textContent=refLabel;
  // 地図の範囲を決めた後に写す。見え方は図の時間幅、撮影地は出入線の時間幅。
  const source=mode==='places'?mapRange:look.querySelector('[data-look-range]');
  if(state&&source&&!look._footerFrame&&document.activeElement!==footerRange){ToolDateTimeBar.syncTimeRange(footerRange,{day:state.day,current:state.current,min:mode==='places'?Number(source.min):state.minSeconds,max:mode==='places'?Number(source.max):state.maxSeconds});}
  if(!globalThis.TrialExplore?.active()){if(state){footerRange.setAttribute('aria-valuetext',aimLookHMS(state.current));if(previewPlayback.running())previewTimeline.follow(state.current,scrubMode);else previewTimeline.sync(state.current,scrubMode);}else previewTimeline.stop();}
  const out=look.querySelector('[data-look-at]'),day=/^(前日|翌日) /.exec(out?.firstChild?.textContent||'')?.[1],rel=state&&!look.hidden?[day,out?.querySelector('.sub-line')?.textContent].filter(Boolean).join(' '):'';if(footerRel.textContent!==rel){footerRel.textContent=rel;footerRel.title=rel;}footerRel.hidden=!rel;
  if((!state||look.hidden)&&clock.value)clock.value='';
  if(state&&!clock.disabled){
   if(document.activeElement!==clock){const v=S.JstCal.hhmm(state.current).padStart(5,'0');if(clock.value!==v)clock.value=v;}
   const requested=look._uiRequestedTime;if(requested&&(requested.context!==timeContext()||requested.day!==aim.dayMs))look._uiRequestedTime=null;else if(requested&&requested.day===state.day){look._uiRequestedTime=null;state.window(requested.at);state.set(requested.at);}

  }
  const target=el('aimTarget'),goalLabel=el('aimTargetLabel');const goal=target.selectedOptions[0]?.textContent;if(goal&&goalLabel.textContent!==goal)goalLabel.textContent=goal;
  const lens=look.querySelector('.aim-lens');
  if(lens&&!look.querySelector('.preview-compose')){
   const time=look.querySelector('.aim-look-time');if(time)time.after(lens);
   const rows=lens.querySelectorAll('.aim-lens-row'),sensor=look.querySelector('[data-lens-sensor]'),portrait=look.querySelector('[data-lens-portrait]');
   const quick=document.createElement('div');quick.className='preview-quick';
   const settings=document.createElement('button');settings.type='button';settings.className='chip';settings.dataset.cameraSettings='';settings.className='aim-body-move preview-camera-open';settings.setAttribute('aria-label','画角設定');settings.title='画角設定';settings.setAttribute('aria-expanded','false');settings.setAttribute('aria-controls','previewCameraPanel');settings.innerHTML='<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 5.5 9.5 3.5h5l1.5 2h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z"/><path d="M10.88 9.79L10.93 8.63L13.07 8.63L13.12 9.79L14.22 10.43L15.25 9.89L16.32 11.74L15.34 12.36L15.34 13.64L16.32 14.26L15.25 16.11L14.22 15.57L13.12 16.21L13.07 17.37L10.93 17.37L10.88 16.21L9.78 15.57L8.75 16.11L7.68 14.26L8.66 13.64L8.66 12.36L7.68 11.74L8.75 9.89L9.78 10.43Z M12 11.1a1.9 1.9 0 1 0 0 3.8a1.9 1.9 0 1 0 0-3.8Z" fill="currentColor" fill-rule="evenodd" stroke="none"/></svg>';look.querySelector('.aim-look-figure').append(settings);
   const move=look.querySelector('[data-lens-move]'),center=look.querySelector('[data-lens-center]');
   const tools=document.createElement('div');tools.className='preview-figure-tools';tools.setAttribute('role','group');tools.setAttribute('aria-label','見え方の表示');look.querySelector('.aim-look-figure').append(tools);
   const dialog=document.createElement('dialog');dialog.className='sheet preview-camera-dialog';dialog.id='previewCameraPanel';dialog.dataset.cameraPanel='';dialog.setAttribute('aria-label','画角設定');
   dialog.innerHTML='<div class="sheet-head"><strong>画角設定</strong><button type="button" data-camera-close>閉じる</button></div><div class="sheet-body"><div class="aim-grid-control"><span>向き</span><select data-camera-orientation aria-label="画角の向き"><option value="landscape">横位置</option><option value="portrait">縦位置</option></select></div><label class="aim-grid-control">画角枠<select data-camera-frame aria-label="画角枠の表示"><option value="show">表示</option><option value="hide">非表示</option></select></label></div>';
   lens.append(dialog);const content=dialog.querySelector('.sheet-body');
   if(rows[1]){const label=document.createElement('label');label.className='preview-sensor-label';label.textContent='センサーサイズ';label.htmlFor='previewSensor';if(sensor){sensor.id='previewSensor';rows[1].prepend(label);}content.prepend(rows[1]);}if(portrait)portrait.hidden=true;
   const toggles=lens.querySelector('.aim-lens-toggles');if(toggles)content.append(toggles);const frame=look.querySelector('[data-lens-on]');if(frame)frame.hidden=true;
   if(move){move.hidden=true;quick.append(move);}
   const closeCamera=()=>dialog.close();settings.setAttribute('aria-haspopup','dialog');settings.onclick=()=>{if(dialog.open)closeCamera();else{globalThis.AstroNotesCameraUI?.stop(look);showSheet(dialog);settings.setAttribute('aria-expanded','true');}};dialog.querySelector('[data-camera-close]').onclick=closeCamera;dialog.addEventListener('close',()=>{settings.setAttribute('aria-expanded','false');dialog.dispatchEvent(new Event('camera-close'));});dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeCamera();});
   const focalTools=document.createElement('div');focalTools.className='preview-focal-tools';focalTools.innerHTML='<div class="preview-focal-scale"><span>広角</span><span>望遠</span></div><input type="range" min="0" max="1000" step="0.1" data-focal-range aria-label="焦点距離を滑らかに調整"><div class="preview-focal-presets" role="group" aria-label="焦点距離の代表値">'+[24,50,100,200,400,800].map(n=>'<button type="button" data-focal-preset="'+n+'">'+n+'</button>').join('')+'</div>';
   rows[0].after(focalTools);focalTools.after(quick);quick.hidden=true;const presets=focalTools.querySelector('.preview-focal-presets');const presetsLabel=document.createElement('div');presetsLabel.textContent='焦点距離（mm）';content.append(presetsLabel,presets);
   // 2026-10-20 ユーザー「バーが1番上がいい。バーの横に焦点距離を表示して。焦点距離ジャンプとかは画角調整ボタンの中」：
   // 図・共有のすぐ下に［バー｜焦点距離｜画角調整］の1行。数字の入力欄と画角の度数は画角調整の中へ
   const bar=document.createElement('div');bar.className='preview-focal-bar';const value=document.createElement('output');value.className='preview-focal-value';value.dataset.focalValue='';value.setAttribute('aria-live','off');
   bar.append(focalTools,value,settings);rows[0].after(bar);content.prepend(rows[0]);rows[0].classList.add("preview-focal-entry");
   // 共有は「画角内」の行の右端（2026-10-20 ユーザー「共有ボタンずらしたら?」）。共有だけの行をなくし、図のすぐ下を画角のバーにする
   const share=look.querySelector('.aim-figure-share'),frameInfo=look.querySelector('.aim-frame-info'),figure=look.querySelector('.aim-look-figure');
   if(figure)figure.after(lens);if(share&&frameInfo){frameInfo.append(share);frameInfo.classList.add('has-share');}
   const info=look.querySelector('[data-lens-info]');if(info)content.append(info);
   const compose=document.createElement('div');compose.className='preview-compose';compose.hidden=true;(figure||lens).append(compose);
   if(center){center.className='preview-center';center.hidden=false;center.setAttribute('aria-label','構図を中央に戻す');center.title='中央に戻す';center.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M12 7v10M7 12h10"/><circle cx="12" cy="12" r="3"/></svg>';tools.append(center);}
   // The figure pans directly; its sole icon returns the composition to the center.
   const apply=lens.querySelector('[data-lens-apply]');if(apply)apply.hidden=true;
   const reverse=document.createElement('section');reverse.className='preview-reverse';const title=document.createElement('h3');title.textContent='撮れる場所を逆算';reverse.append(title);look.append(reverse);
   for(const selector of['[data-look-found]']){const node=look.querySelector(selector);if(node)reverse.append(node);}
  }
  globalThis.AstroNotesCameraUI?.mount(look,{owner:auth?.loginId,token:auth?.token});
  const timeScope=el('previewTimeScope');if(timeScope){const scope=look._uiAllDay?'day':'fine';for(const button of timeScope.querySelectorAll('button')){const pressed=String(button.dataset.timeScope===scope);if(button.getAttribute('aria-pressed')!==pressed)button.setAttribute('aria-pressed',pressed);}}
  const focalInput=look.querySelector('[data-lens-focal]');if(focalInput){focalInput.onfocus=()=>{focalInput._uiFocusValue=focalInput.value;};focalInput.onblur=()=>{if(focalInput.value!==focalInput._uiFocusValue&&focalInput.checkValidity()&&focalInput.value.trim()&&(aimLens.mode!=='manual'||+focalInput.value!==aimLens.focal))focalInput.onchange();};}
  const orientation=look.querySelector('[data-camera-orientation]'),frameSelect=look.querySelector('[data-camera-frame]');
  if(orientation){orientation.value=aimLens.portrait?'portrait':'landscape';orientation.onchange=()=>{if((orientation.value==='portrait')!==aimLens.portrait)look.querySelector('[data-lens-portrait]').click();};}
  if(frameSelect){frameSelect.value=aimLens.on?'show':'hide';frameSelect.onchange=()=>{if((frameSelect.value==='show')!==aimLens.on)look.querySelector('[data-lens-on]').click();};}
  uiVisualChoices(orientation,'orientation');uiVisualChoices(look.querySelector('[data-lens-grid]'),'grid');
  const focalValue=look.querySelector('[data-focal-value]');if(focalValue&&focalInput){const t=`${aimLens.mode==='auto'?'約':''}${Math.round(+focalInput.value*10)/10}mm`;if(focalValue.textContent!==t)focalValue.textContent=t;}
  const focalRange=look.querySelector('[data-focal-range]');if(focalRange&&focalInput){if(document.activeElement!==focalRange)focalRange.value=String(1000*Math.log(Math.max(8,Math.min(2000,+focalInput.value))/8)/Math.log(250));focalRange.oninput=()=>{look._pendingFocal=+focalRange.value;if(look._focalRaf)return;look._focalRaf=requestAnimationFrame(()=>{look._focalRaf=null;focalInput.value=String(Math.round(8*Math.pow(250,look._pendingFocal/1000)*10)/10);focalInput.onchange();});};for(const button of look.querySelectorAll('[data-focal-preset]'))button.onclick=()=>{focalInput.value=button.dataset.focalPreset;focalInput.onchange();const sheet=button.closest('dialog');if(sheet?.open)sheet.close();};}
  const portraitButton=look.querySelector('[data-lens-portrait]');if(portraitButton){const text=portraitButton.getAttribute('aria-pressed')==='true'?'縦位置':'横位置';if(portraitButton.textContent!==text)portraitButton.textContent=text;}


  const note=look.querySelector('[data-look-note]'),outside=look.querySelector('[data-look-outside]');if(note&&outside&&note.previousElementSibling!==outside)outside.after(note);
  const selected=el('aimCandList').querySelector('[data-cand][aria-pressed="true"]');let back=look.querySelector('.preview-return');
  const caption=look.querySelector('.aim-look-cap');if(!back&&caption){back=document.createElement('button');back.type='button';back.className='tap preview-return';back.textContent='撮影地点の見え方に戻す';caption.after(back);back.onclick=()=>{const current=el('aimCandList').querySelector('[data-cand][aria-pressed="true"]');if(current)current.click();else aimUpdateLook();};}if(back)back.hidden=!selected;
  const result=look.querySelector('[data-found-map]'),found=look.querySelector('[data-look-found]');const reverse=look.querySelector('.preview-reverse');if(reverse && reverse.hidden !== !!found?.hidden)reverse.hidden=!!found?.hidden;const key=result?found.textContent.trim():'';if(key&&key!==resultKey){resultKey=key;requestAnimationFrame(()=>{if(!scene.hidden)found.scrollIntoView({block:'nearest',behavior:'auto'});});}else if(!key)resultKey='';
  for(const row of el('aimCandList').querySelectorAll('.cand-row.on'))if(!row.querySelector('.preview-show-scene')){const b=document.createElement('button');b.type='button';b.className='chip preview-show-scene';b.textContent='この場所の見え方';b.onclick=()=>{show('scene',true);if(!wide.matches)el('previewSceneTab').scrollIntoView({block:'start',behavior:'smooth'});};row.append(b);}
 };
 new MutationObserver(update).observe(root,{childList:true,subtree:true});update();
 // 既存の地図移動処理より先に表示する。計算や地点選択の処理は既存のまま。
 root.addEventListener('click',e=>{const b=e.target.closest('button');if(b&&(b.matches('[data-cand-map],[data-day],[data-found-map]')))show('places');},true);
})();

// 天体を選ぶ（対象と共通の全画面ページ）。構図と地図で同じ部品（2026-10-21 ユーザー「これ揃えてって言わなかった？」。
// 10-18 の入力欄の統一は閉じた見た目だけで、地図は開くと端末のプルダウンのままだった）
function mountBodyPicker(source, { pickerId, dialogId, titleId, wide, observe }) {
 const picker=document.createElement('button');picker.type='button';picker.id=pickerId;picker.className='condition-choice';if(wide)picker.classList.add("preview-body-open");picker.setAttribute('aria-haspopup','dialog');picker.setAttribute('aria-controls',dialogId);
 picker.innerHTML='<span data-body-label></span><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
 source.classList.add('preview-body-native');source.after(picker);
 const dialog=document.createElement('dialog');dialog.id=dialogId;dialog.className='sheet preview-body-dialog';dialog.setAttribute('aria-labelledby',titleId);
 dialog.innerHTML=`<div class="sheet-head"><strong id="${titleId}">天体を選ぶ</strong><button type="button" data-body-close>閉じる</button></div><div class="sheet-body"></div>`;
 const content=dialog.querySelector('.sheet-body');
 for(const group of source.querySelectorAll('optgroup')){
  const section=document.createElement('section'),title=document.createElement('h3'),list=document.createElement('div');section.className='preview-body-group';title.textContent=group.label;list.className='preview-body-list';section.append(title,list);
  for(const option of group.querySelectorAll('option')){
   const b=document.createElement('button');b.type='button';b.dataset.bodyValue=option.value;b.className='preview-body-choice';b.textContent=option.textContent;b.onclick=()=>{source.value=option.value;source.dispatchEvent(new Event('change',{bubbles:true}));dialog.close();};list.append(b);
  }
  content.append(section);
 }
 document.body.append(dialog);
 const sync=()=>{const name=source.selectedOptions[0]?.textContent||'天体';const label=picker.querySelector('[data-body-label]');if(label.textContent!==name)label.textContent=name;if(picker.disabled!==source.disabled)picker.disabled=source.disabled;picker.setAttribute('aria-label',`天体：${name}、選択を開く`);for(const b of dialog.querySelectorAll('[data-body-value]')){const o=Array.from(source.options).find(o=>o.value===b.dataset.bodyValue);b.disabled=!!o?.disabled;b.hidden=!!o?.hidden;b.setAttribute('aria-pressed',String(b.dataset.bodyValue===source.value));}for(const group of dialog.querySelectorAll('.preview-body-group'))group.hidden=!Array.from(group.querySelectorAll('[data-body-value]')).some(b=>!b.hidden);};
 picker.onclick=()=>{sync();showSheet(dialog);};dialog.querySelector('[data-body-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>picker.focus({preventScroll:true}));
 // 画面のコードが value を直接書き換える（地図は天体の切り替えや引き継ぎで change を出さない）ので、書き換えでも表示を合わせる
 const valueOf=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');
 Object.defineProperty(source,'value',{configurable:true,get(){return valueOf.get.call(this);},set(v){valueOf.set.call(this,v);sync();}});
 new MutationObserver(sync).observe(observe,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','disabled']});source.addEventListener('change',sync);sync();
 return sync;
}
mountBodyPicker(document.getElementById('aimBody'),{pickerId:'previewBodyOpen',dialogId:'previewBodyDialog',titleId:'previewBodyTitle',wide:true,observe:document.getElementById('aimView')});
mountBodyPicker(document.getElementById('skyMapBody'),{pickerId:'skyMapBodyOpen',dialogId:'skyMapBodyDialog',titleId:'skyMapBodyPickTitle',wide:false,observe:document.getElementById('skyMapBody')});
document.getElementById('skyMapBody').hidden=true;   // 地図の欄の CSS が display を上書きするので、対象（skyMapTarget）と同じく hidden で隠す

(()=>{
 const aimSource=$('aimTarget'),host=aimSource.closest('.aim-pick');
 const picker=document.createElement('button');picker.type='button';picker.id='previewTargetOpen';picker.className='preview-target-open';picker.setAttribute('aria-haspopup','dialog');picker.setAttribute('aria-controls','previewTargetDialog');host.append(picker);
 const select=(source,id)=>{source.value=id;source.dispatchEvent(new Event('change',{bubbles:true}));};
 window.AstroTargetPicker=AstroNotesTargetUI.mount({address:async p=>(await nearName(p.latitude,p.longitude)).area,categoryOf:targetCategoryOf,categoryList:targetCategoryList,isUserCategory:c=>!TARGET_FIXED_CATEGORIES.includes(c),editCategory:editTargetCategory,owner:()=>auth?.token,targets:aimTargetList,favorites:()=>favorites,favorite:id=>favorites.find(f=>f.id===id),describe:targetLocationLabel,createMap:createMapView,wireSearch:wireSearchBox,show:showSheet,elevation:aimElevation,persist:persistTargetDraft,
  refresh:()=>{aimFillSelects();SkyMapUI?.refreshTargets?.();},select,center:source=>source.id==='skyMapTarget'?SkyMapUI?.snapshot?.()?.target||place:aim.target||aimFromPoint()||place});
 const sync=()=>{picker.setAttribute('aria-label',`対象：${aimSource.selectedOptions[0]?.textContent||'読み込み中'}、選択を開く`);picker.disabled=aimSource.disabled||!aimSource.options.length;};
 picker.onclick=()=>AstroTargetPicker.open(aimSource,null,picker);
 const skySource=$('skyMapTarget'),skyButton=document.createElement('button');skyButton.type='button';skyButton.id='skyMapTargetOpen';skyButton.className='condition-choice';skyButton.innerHTML='<span data-target-label></span><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';skyButton.setAttribute('aria-haspopup','dialog');skyButton.setAttribute('aria-controls','previewTargetDialog');skySource.hidden=true;
 const syncSky=()=>{const label=skySource.selectedOptions[0]?.textContent||'対象を選ぶ';skyButton.querySelector('[data-target-label]').textContent=label;skyButton.setAttribute('aria-label',`対象：${label}、選択を開く`);};
 const skyValue=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');Object.defineProperty(skySource,'value',{configurable:true,get(){return skyValue.get.call(this);},set(v){skyValue.set.call(this,v);syncSky();}});
 new MutationObserver(syncSky).observe(skySource,{childList:true,subtree:true,attributes:true});skySource.addEventListener('change',syncSky);syncSky();skyButton.onclick=()=>AstroTargetPicker.open(skySource,null,skyButton);skySource.after(skyButton);
 aimSource.addEventListener('change',sync);new MutationObserver(sync).observe(aimSource,{childList:true,subtree:true,attributes:true});sync();
})();

// E171: these histories stay in this browser; favorites keep their existing account sync.
const recentHistory=(()=>{
 const history=AstroNotesHistory.create({read:store.get,write:store.set,scope:()=>auth?.loginId||'guest',validatePlan:p=>{try{return p?.kind==='aim'?AstroNotesPlan.decode(AstroNotesPlan.encode(p)):null;}catch{return null;}}});
 // 2026-10-21 ユーザー「お気に入り・履歴・候補地点はタブにして切り替え。現在地と地図は入力欄の中にGPSマークと地図マークのボタン」
 const sheet=$('placeSheet'),content=sheet.querySelector('.sheet-body'),nav=document.createElement('div');nav.className='forecast-tabs place-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','地点の選び方');
 const historyPanel=document.createElement('section'),favPanel=document.createElement('section'),candidatePanel=document.createElement('section');historyPanel.id='recentPanel';favPanel.id='recentFavorites';candidatePanel.id='recentCandidates';
 historyPanel.innerHTML='<div class="chips history-subnav" role="group" aria-label="履歴の種類"><button type="button" data-recent-kind="places">場所</button><button type="button" data-recent-kind="plans">重ねる条件</button></div><div class="history-heading"><p class="tiny">このブラウザの最近30件</p><button type="button" data-recent-clear>履歴を消す</button></div><p class="tiny" data-recent-note></p><input type="search" class="fav-in" data-recent-search aria-label="履歴を検索" placeholder="場所・対象・天体・日付で絞り込む"><div class="history-list"></div><div class="history-pages"><button type="button" class="chip" data-recent-prev>前の5件</button><span class="tiny" data-recent-count role="status"></span><button type="button" class="chip" data-recent-next>次の5件</button></div><button type="button" class="chip" data-recent-undo hidden>消した履歴を戻す</button>';
 const err=document.createElement('p');err.className='warn';err.setAttribute('role','status');err.hidden=true;err.textContent='履歴を保存できませんでした。ブラウザの保存設定や空き容量を確認してください。';
 const favoritesStart=$('placeFavoritesStart');let n=favoritesStart;while(n){const next=n.nextSibling;favPanel.append(n);n=next;}
 content.append(favPanel.querySelector('#favUndo'));
 candidatePanel.append($('sheetCands'));content.append(historyPanel,favPanel,candidatePanel,err);
 // 検索とは別の選択方法。文字付きで入力の直下へ（2026-10-21 採用）
 const actions=document.createElement('div');actions.className='place-search-actions';actions.setAttribute('role','group');actions.setAttribute('aria-label','地点の選び方');$('searchBox').closest('.search-row').after(actions);
 for(const id of ['geoButton','mapButton']){const b=$(id);b.classList.remove('list-item');b.type='button';const say=id==='geoButton'?'現在地':'地図で選ぶ';b.setAttribute('aria-label',say);b.title=say;b.innerHTML=(id==='geoButton'?MAP_ICON_LOCATE:UI_ICONS.map)+'<span>'+say+'</span>';actions.append(b);}
 actions.after($('geoStatus'));
 $('searchResults').after(nav);
 const panels={recent:historyPanel,favorites:favPanel,candidates:candidatePanel};let active='favorites',kind='places',page=0;
 const panelBox=document.createElement('div');panelBox.className='place-tab-panels';panelBox.append(...Object.values(panels));nav.after(panelBox);
 const searchTools=document.createElement('div');searchTools.className='place-search-tools';while(content.firstChild&&content.firstChild!==nav)searchTools.append(content.firstChild);content.prepend(searchTools);
 for(const [id,label] of [['favorites','お気に入り'],['recent','履歴'],['candidates','この日の候補']]){const b=document.createElement('button');b.type='button';b.setAttribute('role','tab');b.textContent=label;b.dataset.historyPanel=id;b.id='placeTab-'+id;b.setAttribute('aria-controls',panels[id].id);panels[id].setAttribute('role','tabpanel');panels[id].setAttribute('aria-labelledby',b.id);b.onclick=()=>{active=id;render();};
  b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...nav.children].filter(x=>!x.hidden),i=tabs.indexOf(b),next=e.key==='Home'?tabs[0]:e.key==='End'?tabs[tabs.length-1]:tabs[(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];active=next.dataset.historyPanel;render();next.focus();};nav.append(b);}
 const list=historyPanel.querySelector('.history-list'),note=historyPanel.querySelector('[data-recent-note]'),undo=historyPanel.querySelector('[data-recent-undo]');
 const okay=result=>{err.hidden=result;return result;};
 function render(){
  for(const [id,panel] of Object.entries(panels))panel.hidden=id!==active;
  for(const b of nav.children){b.hidden=b.dataset.historyPanel==='candidates'&&!['aim','skymap'].includes(placeSheetFor);}
  // 候補のタブが無い画面で候補を開いていたら、お気に入りへ
  if(active==='candidates'&&!['aim','skymap'].includes(placeSheetFor)){active='favorites';for(const [id,panel] of Object.entries(panels))panel.hidden=id!==active;}
  for(const b of nav.children){const on=b.dataset.historyPanel===active;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;}
  for(const b of historyPanel.querySelectorAll('[data-recent-kind]'))b.setAttribute('aria-pressed',String(b.dataset.recentKind===kind));
  note.textContent=kind==='places'?'選んだ場所をもう一度使う':'日時・画角も復元。☆は撮影地点を登録';historyPanel.querySelector('[data-recent-search]').placeholder=kind==='places'?'場所の名前で絞り込む':'場所・対象・天体・日付で絞り込む';
  const rows=history.list(kind),query=historyPanel.querySelector('[data-recent-search]').value.normalize('NFKC').toLocaleLowerCase().trim();
  const filtered=rows.map((row,i)=>({row,i})).filter(({row})=>{const v=row.value;return (kind==='places'?[v.name,v.subtitle]:[v.t.name,AstroNotesBodies.definition(v.body)?.name,v.o[0],AstroNotesPlan.dateTime(v.at)]).join(' ').normalize('NFKC').toLocaleLowerCase().includes(query);});
  page=Math.max(0,Math.min(page,Math.ceil(filtered.length/5)-1));const start=page*5;list.replaceChildren();
  if(!filtered.length){const p=document.createElement('p');p.className='tiny history-empty';p.textContent=query?'該当する履歴はありません。':kind==='places'?'場所を選ぶとここに残ります。':'対象・天体・撮影地点・日付を選び、見え方が表示されるとここに残ります。';list.append(p);}
  filtered.slice(start,start+5).forEach(({row,i})=>{const v=row.value,line=document.createElement('div');line.className='history-row';const b=document.createElement('button');b.type='button';b.className='list-item';const title=document.createElement('strong'),sub=document.createElement('span');sub.className='tiny sub-line';
   title.textContent=kind==='places'?v.name:`${v.t.name} × ${AstroNotesBodies.definition(v.body)?.name||v.body}`;
   sub.textContent=kind==='places'?v.subtitle||`緯度 ${v.latitude.toFixed(5)}・経度 ${v.longitude.toFixed(5)}`:`${v.o[0]} ・ ${AstroNotesPlan.dateTime(v.at)}`;
   b.append(title,sub);b.onclick=()=>{if(kind==='places')choosePlace(v);else{sheet.close();blocked=false;restoreSharedPlan(v);if(location.hash!=='#/aim')navigationHistory.pushRoute('#/aim');else openAim();}};
   const del=document.createElement('button');del.type='button';del.className='history-remove';del.textContent='×';del.setAttribute('aria-label',`${title.textContent}を履歴から消す`);del.onclick=()=>{okay(history.remove(kind,row));render();};const star=document.createElement('button');star.type='button';star.className='history-remove';
   const point=kind==='places'?{...v}:{...AstroNotesPlan.expandPoint(v.o),subtitle:'履歴の撮影地点'};
   const fav=favorites.findIndex(f=>AstroNotesTerrain.distanceKm(f.latitude,f.longitude,point.latitude,point.longitude)<0.02);star.textContent=fav>=0?'★':'☆';
   const label=kind==='places'?point.name:`${point.name}（撮影地点）`;star.setAttribute('aria-label',fav>=0?`${label}のお気に入りを編集`:`${label}をお気に入りに登録`);
   star.title=star.getAttribute('aria-label');star.onclick=()=>{if(!requireLoginForFavorites())return;const deck=point.decks?.find(d=>d.name===point.stand);const eye=Number.isFinite(point.standAglM)?point.standAglM:deck?deck.aglM+1.5:point.eyeHeightAGL;openFavSheet(favorites.findIndex(f=>AstroNotesTerrain.distanceKm(f.latitude,f.longitude,point.latitude,point.longitude)<0.02),{point:{...point,elevation:point.groundManualM??point.elevation,eyeHeightAGL:eye??1.5},target:point.targetHeightM??null,after:render});};
   line.append(b,star,del);list.append(line);
  });
  historyPanel.querySelector('[data-recent-clear]').disabled=!rows.length;undo.hidden=!history.canUndo();undo.textContent=history.undoKind()==='places'?'消した場所の履歴を戻す':'消した条件の履歴を戻す';
  historyPanel.querySelector('[data-recent-count]').textContent=filtered.length?`${start+1}–${Math.min(start+5,filtered.length)} / ${filtered.length}件`:'0件';
  historyPanel.querySelector('[data-recent-prev]').disabled=page===0;historyPanel.querySelector('[data-recent-next]').disabled=start+5>=filtered.length;
  $('sheetCands').hidden=true;if(active==='candidates')try{window.MyPlacesUI?.renderPickerPanel(candidatePanel);}catch{/* trial */}
 }
 for(const b of historyPanel.querySelectorAll('[data-recent-kind]'))b.onclick=()=>{kind=b.dataset.recentKind;page=0;historyPanel.querySelector('[data-recent-search]').value='';render();};
 historyPanel.querySelector('[data-recent-clear]').onclick=()=>{okay(history.clear(kind));render();};undo.onclick=()=>{const restored=history.undoKind();if(okay(history.restore())){kind=restored;page=0;historyPanel.querySelector('[data-recent-search]').value='';}render();};
 historyPanel.querySelector('[data-recent-search]').oninput=()=>{page=0;render();};historyPanel.querySelector('[data-recent-prev]').onclick=()=>{page--;render();};historyPanel.querySelector('[data-recent-next]').onclick=()=>{page++;render();};
 const trigger=document.createElement('button');trigger.type='button';trigger.className='chip';trigger.textContent='履歴';trigger.id='aimRecentOpen';trigger.setAttribute('aria-label','場所・重ねる条件の履歴');trigger.onclick=()=>{openPlaceSheet('aim');active='recent';kind='plans';render();};$('aimView').querySelector('.aim-titlebar').append(trigger);
 let timer=0,last='',owner=auth?.loginId||'guest',blocked=false;function schedule(){clearTimeout(timer);timer=setTimeout(()=>{
  if((auth?.loginId||'guest')!==owner){owner=auth?.loginId||'guest';blocked=true;last='';return;}
  if(blocked||$('aimView').hidden||sheet.open)return;
  const h=$('aimLook'),spec=h._lookSpec;if(h.hidden||!spec||h._planKey!==aimLookKey()||h._pick?.busy||h._pick?.ghost||h._lensGesture?.points.size)return;
  const key=JSON.stringify([aim.target,aim.body,aim.partId,aim.limb,aim.dayMs,spec.obs,spec.eyeM,h._lookAt,aimLens,h._lensOffset,aimAirSettings.mode]);if(key===last)return;
  try{const snap=planSnapshot({dataset:{planSource:'aim'}});if(okay(history.add('plans',snap.payload))){last=key;okay(history.add('places',{...AstroNotesPlan.expandPoint(snap.payload.o),subtitle:'最近使った撮影地点'},{derived:true}));}}catch{/* A pending calculation is not a completed history item. */}
 },1000);}
 new MutationObserver(schedule).observe($('aimLook'),{childList:true,subtree:true,characterData:true});$('aimView').addEventListener('change',schedule);$('aimView').addEventListener('click',schedule);sheet.addEventListener('close',schedule);schedule();
 window.addEventListener('storage',e=>{if(e.key?.startsWith('sorami.recent.v1:')&&sheet.open)render();});
 return {accountChanged(){const next=auth?.loginId||'guest';if(next!==owner){owner=next;blocked=true;clearTimeout(timer);last='';if(sheet.open)render();}},observerSelected(){blocked=false;},rememberPlace(p,{observer=false}={}){if(observer)blocked=false;okay(history.add('places',p));},candidates(){active='candidates';render();for(const b of nav.children)if(b.dataset.historyPanel==='candidates')b.focus();},open(){page=0;active='favorites';render();},places(mode){openPlaceSheet(mode,{focusSearch:false});active='recent';kind='places';render();},history};
})();
export {recentHistory};
