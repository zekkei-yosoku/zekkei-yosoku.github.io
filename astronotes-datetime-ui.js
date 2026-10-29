/* Shared date/time bar presentation. Each tool retains its own time model. */
(function(g){
'use strict';
const DAY=86400000,OFFSET=32400000;
const preparedTimes=new WeakSet();
function decorate({footer,row,date,time,prev,next,more,track,now,timeId,moreId}){
 if(!time&&timeId)time=document.getElementById(timeId);
 if(!more&&moreId)more=document.getElementById(moreId);
 if(!more)more=row.querySelector('[data-datetime-slot=more]');
 if(!time&&timeId){time=document.createElement('input');time.type='time';time.step='60';time.id=timeId;time.setAttribute('aria-label','時刻を編集');const clock=document.createElement('div');clock.append(time);row.append(clock);}
 if(!more){more=document.createElement('button');more.type='button';more.id=moreId||'';more.textContent='⋯';more.setAttribute('aria-label','日時の詳細');more.setAttribute('aria-haspopup','dialog');}
 for(const [node,name] of [[footer,'tool-datetime-footer'],[row,'tool-datetime-row'],[date,'tool-datetime-date'],[time,'tool-datetime-time'],[prev,'tool-datetime-nav'],[next,'tool-datetime-nav'],[more,'tool-datetime-nav'],[track,'tool-datetime-track']])node?.classList.add(name);
 time?.parentElement?.classList.add('tool-datetime-clock');
 if(time&&!preparedTimes.has(time)){keepTime(time);timeFace(time);preparedTimes.add(time);}
 const current=row.querySelector('.tool-datetime-now')||nowButton(now||(()=>{}));current.onclick=()=>now?.(Date.now());
 for(const [node,slot] of [[prev,'previous'],[date,'date'],[next,'next'],[time?.parentElement,'clock'],[current,'now'],[more,'more']]){if(!node)continue;node.dataset.datetimeSlot=slot;row.append(node);}
 for(const [node,direction] of [[prev,-1],[next,1]])node.innerHTML='<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(direction<0?'m15 5-7 7 7 7':'m9 5 7 7-7 7')+'"/></svg>';
 footer.dataset.datetimeComponent='shared';
 return {time,more,now:current};
}
// One elapsed-time clock per mounted bar. Rendering can sleep without losing elapsed time.
function createClock({getAt,setAt,enabled=()=>true,visible=()=>!document.hidden,now=()=>performance.now(),request=fn=>requestAnimationFrame(fn),cancel=id=>cancelAnimationFrame(id),onState=()=>{},onStop=()=>{}}){
 let running=false,base=0,started=0,frame=0,last=-Infinity;
 const value=()=>base+Math.max(0,now()-started);
 const publish=()=>{if(!running)return;setAt(value());};
 const schedule=()=>{if(running&&visible()&&!frame)frame=request(tick);};
 function tick(t){frame=0;if(!running)return;if(!enabled()){stop(false);return;}if(!visible())return;publish();schedule();}
 function start(at=getAt()){if(running||!enabled())return;if(!Number.isFinite(at))return;base=at;started=now();last=-Infinity;running=true;onState(true);schedule();}
 function stop(commit=true){if(!running)return;if(commit&&enabled())publish();running=false;cancel(frame);frame=0;onState(false);onStop();}
 function rebase(at){if(!Number.isFinite(at))return;base=at;started=now();}
 function visibility(){cancel(frame);frame=0;if(running&&!enabled()){stop(false);return;}if(running&&visible()){publish();last=-Infinity;schedule();}}
 return {start,stop,rebase,visibility,running:()=>running,at:()=>running?value():getAt()};
}
const playbackBars=new WeakMap();
function playback({row,footer,getAt,setAt,enabled=()=>true,onStart=()=>{},onStop=()=>{}}){
 if(playbackBars.has(row))return playbackBars.get(row);
 const button=document.createElement('button');button.type='button';button.className='tool-datetime-nav tool-datetime-play';button.dataset.datetimeSlot='play';row.insertBefore(button,row.querySelector('[data-datetime-slot=more]'));
 const icon=playing=>'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(playing?'<path d="M9 6v12M15 6v12"/>':'<path d="m9 6 9 6-9 6Z" fill="currentColor" stroke="none"/>')+'</svg>';
 const state=playing=>{button.innerHTML=icon(playing);button.dataset.playing=String(playing);button.setAttribute('aria-label',playing?'時間の進行を一時停止':'時間を進める');button.title=playing?'時間の進行を一時停止':'時間を進める';};
 const clock=createClock({getAt,setAt,enabled,onState:state,onStop});
 button.onclick=()=>{if(clock.running())clock.stop();else{onStart();current.click();clock.start(Date.now());}};
 const manual=e=>{if(e.target.closest?.('.tool-datetime-now,.tool-datetime-play,[data-datetime-slot=more]'))return;clock.stop();};
 for(const type of ['pointerdown','touchstart','wheel','keydown','change'])footer.addEventListener(type,manual,{capture:true,passive:true});
 // Date/time clicks can be synthetic or keyboard-driven, without a pointerdown.
 footer.addEventListener('click',manual,true);
 const current=row.querySelector('.tool-datetime-now'),move=current.onclick;current.onclick=e=>{move?.call(current,e);clock.rebase(getAt());};
 document.addEventListener('visibilitychange',()=>clock.visibility());
 const api={...clock,button};state(false);playbackBars.set(row,api);return api;
}
function details({button,getText,title='日時の詳細'}){
 const dialog=document.createElement('dialog');dialog.className='sheet tool-date-calendar';dialog.tabIndex=-1;dialog.setAttribute('aria-label',title);
 const head=document.createElement('div');head.className='sheet-head';const label=document.createElement('strong');label.textContent=title;
 const close=document.createElement('button');close.type='button';close.dataset.close='';close.textContent='閉じる';close.onclick=()=>dialog.close();head.append(label,close);
 const body=document.createElement('div');body.className='sheet-body';const text=document.createElement('p');text.style.whiteSpace='pre-line';body.append(text);dialog.append(head,body);document.body.append(dialog);
 button.onclick=()=>{text.textContent=getText();dialog.showModal();dialog.focus();};mountCalendarDismiss(dialog);dialog.addEventListener('close',()=>button.focus({preventScroll:true}));trackPointerFocus(dialog,button);return dialog;
}
// iPhone の時刻入力の「リセット」は欄を空にする。空の時刻は無いので、開く前の時刻へ戻す（2026-10-22 ユーザー「リセットの動きは適切ではない」）
function keepTime(time){
 let before='';
 time.addEventListener('focus',()=>{before=time.value;});
 time.addEventListener('change',e=>{if(time.value)return;e.stopImmediatePropagation();time.value=before;},true);
}
// iPhone の時刻欄は中の数字を独自の字体で描き、日付と字体・高さがそろわない。欄は押して選ぶためだけに残し（文字は透明）、
// 見える数字は日付と同じ字体の文字で重ねる（2026-10-22 ユーザー「時間のフォントを日付と合わせてほしい」）
function timeFace(time){
 const clock=time.parentElement;if(!clock||clock.querySelector('.tool-datetime-face'))return;
 const face=document.createElement('span');face.className='tool-datetime-face';face.setAttribute('aria-hidden','true');clock.append(face);
 const own=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
 const show=()=>{const v=own.get.call(time);if(face.textContent!==(v||'--:--'))face.textContent=v||'--:--';};
 Object.defineProperty(time,'value',{configurable:true,get(){return own.get.call(time);},set(v){own.set.call(time,v);show();}});
 for(const type of ['input','change','blur'])time.addEventListener(type,show);
 show();
}
// 日付と時刻をまとめて今へ。時刻の横に時計の絵で置く（2026-10-22 ユーザー「ここに現在時刻に飛ぶボタンがあるといい」）
function nowButton(onNow){
 const b=document.createElement('button');b.type='button';b.className='tool-datetime-nav tool-datetime-now';
 b.setAttribute('aria-label','現在の日時へ');b.title='現在の日時へ';
 b.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.6 9.2A8 8 0 1 1 4 12"/><path d="M4.4 4.8v4.6H9"/><path d="M12 7.5V12l3 2"/></svg>';
 b.onclick=()=>onNow(Date.now());
 return b;
}
// Date opens its calendar; time remains a directly editable native time field.
function editor({button,time,dialog,beforeOpen=()=>{}}){
 const row=button.closest('.tool-datetime-row'),open=button.onclick;
 row.classList.add('tool-datetime-direct');
 button.setAttribute('aria-haspopup','dialog');button.title='日付を選ぶ';
 delete dialog.dataset.datetimeEditor;
 dialog.setAttribute('aria-label','日付を選ぶ');dialog.querySelector('.sheet-head strong').textContent='日付を選ぶ';
 button.onclick=e=>{beforeOpen();open?.call(button,e);};
 if(time){
  time.title='時刻を編集';time.setAttribute('aria-label','時刻を編集');
  // Stop a running ruler before the native picker captures the current value.
  time.addEventListener('pointerdown',beforeOpen);time.addEventListener('focus',beforeOpen);
 }
 trackPointerFocus(dialog,button,time);
 return {display:button,trigger:button};
}
const MODES=['date','hour','time'];
const modeLabel=mode=>({date:'日',hour:'時',time:'分'})[mode]||'分';
function nextMode(mode){return MODES[(MODES.indexOf(mode)+1)%MODES.length];}
function modeButton(button,mode){const text=modeLabel(mode),next=modeLabel(nextMode(mode));if(button.textContent!==text)button.textContent=text;button.dataset.mode=mode;button.setAttribute('aria-label',text+'送り、'+next+'送りに切り替え');button.title=text+'送り（押すと'+next+'送り）';}
function wireScrub({track,range,enabled=()=>true}){
 let pointer=null,grab=0;
 const geometry=()=>{const r=range.getBoundingClientRect(),pad=Math.min(12,r.width/4);return {left:r.left+pad,width:Math.max(1,r.width-pad*2),min:Number(range.min),max:Number(range.max)};};
 const thumb=()=>{const g=geometry();return g.left+g.width*(Number(range.value)-g.min)/((g.max-g.min)||1);};
 const move=x=>{const g=geometry(),f=Math.max(0,Math.min(1,(x-g.left)/g.width));range.value=String(g.min+(g.max-g.min)*f);range.oninput?.();};
 track.addEventListener('pointerdown',e=>{if(!enabled()||range.disabled||e.button>0)return;e.preventDefault();pointer=e.pointerId;track.setPointerCapture(pointer);if(Math.abs(e.clientX-thumb())>22)move(e.clientX);grab=e.clientX-thumb();});
 track.addEventListener('pointermove',e=>{if(pointer===e.pointerId&&enabled())move(e.clientX-grab);});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])track.addEventListener(type,e=>{if(pointer!==e.pointerId)return;pointer=null;if(enabled())range.onchange?.();});
 return ()=>{pointer=null;};
}
function syncTimeRange(range,{day,current,min,max}){
 const value=(current-day)/1000;
 if(![day,current,value,min,max].every(Number.isFinite)||max<min)return false;
 range.min=String(Math.min(min,value));range.max=String(Math.max(max,value));range.value=String(value);return true;
}
const WEEK=['日','月','火','水','木','金','土'];
// 読み上げ・値の文も画面と同じ 2026/10/13(火)。ISOの 2026-10-13 を読ませない
function label(at){const d=new Date(at+OFFSET);return d.toISOString().slice(0,10).replaceAll('-','/')+'('+WEEK[d.getUTCDay()]+')';}
function dateText(button,at){
 const d=new Date(at+OFFSET),iso=d.toISOString().slice(0,10);
 if(button.dataset.displayDate===iso&&button.querySelector('.preview-date-year'))return;
 button.dataset.displayDate=iso;button.replaceChildren();
 const main=document.createElement('span'),year=document.createElement('span'),slash=document.createElement('span'),month=document.createElement('span'),week=document.createElement('span');
 main.className='preview-date-label';year.className='preview-date-year';year.textContent=iso.slice(0,4);slash.className='preview-date-year-sep';slash.textContent='/';year.append(slash);month.className='preview-date-month';month.textContent=iso.slice(5).replace('-','/');main.append(year,month);
 week.className='preview-date-weekday';week.textContent='('+WEEK[d.getUTCDay()]+')';button.append(main,week);
}
// Only the date grid handles month/year swipes; controls and the left-edge back gesture keep their existing behavior.
function mountCalendarSwipe(grid, move, isOpen, now = () => Date.now()) {
  grid.style.touchAction = "none";
  let gesture = null, suppressUntil = 0, canceled = false;
  const reset = () => { gesture = null; suppressUntil = 0; canceled = false; };
  grid.addEventListener("touchstart", e => {
    if (!isOpen() || e.touches.length !== 1) { canceled = true; suppressUntil = now() + 500; gesture = null; return; }
    const t = e.touches[0];
    if (t.clientX <= 28) { gesture = null; return; }
    suppressUntil = 0; canceled = false;
    gesture = { id: t.identifier, x: t.clientX, y: t.clientY, axis: null };
  }, { passive: true });
  grid.addEventListener("touchmove", e => {
    if (!gesture) return;
    if (!isOpen() || e.touches.length !== 1) { suppressUntil = now() + 500; canceled = true; gesture = null; return; }
    const t = Array.from(e.touches).find(t => t.identifier === gesture.id);
    if (!t) { gesture = null; return; }
    const dx = Math.abs(t.clientX - gesture.x), dy = Math.abs(t.clientY - gesture.y);
    if (!gesture.axis && Math.max(dx, dy) >= 12) {
      if (dx >= dy * 1.35) gesture.axis = "x";
      else if (dy >= dx * 1.35) gesture.axis = "y";
      else { suppressUntil = now() + 500; canceled = true; gesture = null; return; }
    }
    if (gesture.axis && e.cancelable) e.preventDefault();
  }, { passive: false });
  grid.addEventListener("touchend", e => {
    const g = gesture; gesture = null;
    if (!g || !isOpen()) { if (canceled) suppressUntil = now() + 500; return; }
    const t = Array.from(e.changedTouches).find(t => t.identifier === g.id);
    if (!t || e.touches.length) return;
    const dx = t.clientX - g.x, dy = t.clientY - g.y;
    if (!g.axis) return;
    suppressUntil = now() + 500;
    if (e.cancelable) e.preventDefault();
    const along = g.axis === "x" ? dx : dy, across = g.axis === "x" ? dy : dx;
    if (Math.abs(along) < 40 || Math.abs(along) < Math.abs(across) * 1.35) return;
    move((along < 0 ? 1 : -1) * (g.axis === "x" ? 1 : 12));
  }, { passive: false });
  grid.addEventListener("touchcancel", () => { if (gesture || canceled) suppressUntil = now() + 500; gesture = null; canceled = true; }, { passive: true });
  grid.addEventListener("click", e => {
    if (now() < suppressUntil) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  return reset;
}

// Close only a deliberate tap on the backdrop, never an in-dialog drag.
function mountCalendarDismiss(dialog) {
 let start=null;
 const outside=e=>{const r=dialog.getBoundingClientRect();return e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom);};
 const reset=()=>{start=null;};
 dialog.addEventListener('pointerdown',e=>{start=e.button<=0&&outside(e)?{x:e.clientX,y:e.clientY,id:e.pointerId}:null;});
 dialog.addEventListener('pointermove',e=>{if(start&&(e.pointerId!==start.id||Math.hypot(e.clientX-start.x,e.clientY-start.y)>=10))reset();});
 dialog.addEventListener('pointercancel',reset);
 dialog.addEventListener('click',e=>{const p=start;reset();if(p&&outside(e)&&Math.hypot(e.clientX-p.x,e.clientY-p.y)<10){e.preventDefault();e.stopPropagation();dialog.close();}});
 dialog.addEventListener('close',reset);
 return reset;
}
// renderMonth があれば日の格子だけ任せる（探すの重なる日の印）。年月・前後・スワイプ・今日・閉じるは共通のまま。
function calendar({button,getAt,setDay,getNow=()=>Date.now(),renderMonth=null}){
 const dialog=document.createElement('dialog');dialog.className='sheet tool-date-calendar';dialog.tabIndex=-1;dialog.setAttribute('aria-label','日付を選ぶ');
 dialog.innerHTML='<div class="sheet-head"><strong>日付を選ぶ</strong><button type="button" data-close>閉じる</button></div><div class="sheet-body"><div class="aim-cal-nav"><button type="button" class="fav-btn" data-prev aria-label="前の月">←</button><select class="fav-in" data-year aria-label="カレンダーの年"></select><span class="aim-cal-separator" aria-hidden="true">/</span><select class="fav-in" data-month aria-label="カレンダーの月"></select><button type="button" class="fav-btn" data-next aria-label="次の月">→</button></div><div class="aim-cal-week">'+WEEK.map(x=>'<span>'+x+'</span>').join('')+'</div><div class="aim-cal-grid" data-grid></div><button type="button" class="chip" data-today>今日</button></div>';
 document.body.append(dialog);mountCalendarDismiss(dialog);let year,month,monthSeq=0,status=null;
 // 重なる日の待機・件数・失敗は、ねらうのカレンダーと同じ小さな状態文
 if(renderMonth){status=document.createElement('p');status.className='tiny';status.setAttribute('role','status');dialog.querySelector('[data-grid]').after(status);}
 const pickDay=day=>{setDay(day);if(!dialog.dataset?.datetimeEditor)dialog.close();else paint();};
 // 年月は重なる日カレンダーと同じ「年 / 月」の選択欄（数字と/）
 const paint=()=>{const grid=dialog.querySelector('[data-grid]');grid.replaceChildren();const base=new Date(getNow()+OFFSET).getUTCFullYear(),from=Math.min(base-2,year),to=Math.max(base+10,year+2),ys=dialog.querySelector('[data-year]'),ms=dialog.querySelector('[data-month]');ys.innerHTML=Array.from({length:to-from+1},(_,i)=>`<option value="${from+i}">${from+i}</option>`).join('');ys.value=String(year);ms.innerHTML=Array.from({length:12},(_,i)=>`<option value="${i}">${i+1}</option>`).join('');ms.value=String(month);const token=++monthSeq;if(renderMonth){renderMonth({year,month,selected:getAt(),today:getNow(),grid,dialog,status,pickDay,isCurrent:()=>token===monthSeq&&dialog.open});return;}const first=new Date(Date.UTC(year,month,1)),count=new Date(Date.UTC(year,month+1,0)).getUTCDate(),chosen=Math.floor((getAt()+OFFSET)/DAY),today=Math.floor((getNow()+OFFSET)/DAY);for(let i=0;i<first.getUTCDay();i++)grid.append(document.createElement('span'));for(let n=1;n<=count;n++){const day=Date.UTC(year,month,n)-OFFSET,b=document.createElement('button');b.type='button';b.textContent=String(n);b.setAttribute('aria-label',`${year}年${month+1}月${n}日`);b.setAttribute('aria-pressed',String(Math.floor((day+OFFSET)/DAY)===chosen));if(Math.floor((day+OFFSET)/DAY)===today)b.setAttribute('aria-current','date');b.onclick=()=>{setDay(day);if(!dialog.dataset?.datetimeEditor)dialog.close();else paint();};grid.append(b);}};
 // renderMonth の月計算と月相は開いた後でないと捨てられるので、開いてから描く
 button.onclick=()=>{const d=new Date(getAt()+OFFSET);year=d.getUTCFullYear();month=d.getUTCMonth();if(renderMonth){dialog.showModal();paint();}else{paint();dialog.showModal();}dialog.focus();};
 const shift=delta=>{const d=new Date(Date.UTC(year,month+delta,1));if(d.getUTCFullYear()<100||d.getUTCFullYear()>9999)return;year=d.getUTCFullYear();month=d.getUTCMonth();paint();};dialog.querySelector('[data-prev]').onclick=()=>shift(-1);dialog.querySelector('[data-next]').onclick=()=>shift(1);for(const key of ['[data-year]','[data-month]'])dialog.querySelector(key).onchange=()=>{const y=Number(dialog.querySelector('[data-year]').value),m=Number(dialog.querySelector('[data-month]').value);if(!Number.isInteger(y)||!Number.isInteger(m)||m<0||m>11)return;year=y;month=m;paint();};dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.querySelector('[data-today]').onclick=()=>{const at=getNow(),d=new Date(at+OFFSET);year=d.getUTCFullYear();month=d.getUTCMonth();setDay(Math.floor((at+OFFSET)/DAY)*DAY-OFFSET);if(!dialog.dataset?.datetimeEditor)dialog.close();else paint();};const resetSwipe=mountCalendarSwipe(dialog.querySelector('[data-grid]'),shift,()=>dialog.open);dialog.addEventListener('close',()=>{monthSeq++;resetSwipe();button.focus({preventScroll:true});});return dialog;
}
// 入力方法を記録してダイアログ終了時の焦点を戻す。枠の表示は共通UIのCSSで制御する。
let keyNav=false,listening=false;
function trackPointerFocus(...roots){
 if(!listening&&typeof g.addEventListener==='function'){listening=true;g.addEventListener('keydown',e=>{if(e.metaKey||e.ctrlKey)return;keyNav=true;document.activeElement?.removeAttribute?.('data-pointer-focus');},true);g.addEventListener('pointerdown',()=>{keyNav=false;},true);}
 for(const root of roots){if(!root?.addEventListener)continue;root.addEventListener('focusin',e=>e.target.toggleAttribute?.('data-pointer-focus',!keyNav));root.addEventListener('focusout',e=>e.target.removeAttribute?.('data-pointer-focus'));}
}
g.ToolDateTimeBar={createClock,playback,decorate,details,editor,nextMode,modeButton,modeLabel,wireScrub,syncTimeRange,label,dateText,calendar,mountCalendarSwipe,mountCalendarDismiss,trackPointerFocus};
})(typeof window==='undefined'?globalThis:window);
