/* Shared date/time bar presentation. Each tool retains its own time model. */
(function(g){
'use strict';
const DAY=86400000,OFFSET=32400000;
function decorate({footer,row,date,time,prev,next,more,track}){
 for(const [node,name] of [[footer,'tool-datetime-footer'],[row,'tool-datetime-row'],[date,'tool-datetime-date'],[time,'tool-datetime-time'],[prev,'tool-datetime-nav'],[next,'tool-datetime-nav'],[more,'tool-datetime-nav'],[track,'tool-datetime-track']])node?.classList.add(name);
 time?.parentElement?.classList.add('tool-datetime-clock');
}
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
function dateText(button,at){
 const d=new Date(at+OFFSET),iso=d.toISOString().slice(0,10);
 if(button.dataset.displayDate===iso&&button.querySelector('.preview-date-year'))return;
 button.dataset.displayDate=iso;button.replaceChildren();
 const main=document.createElement('span'),year=document.createElement('span'),slash=document.createElement('span'),month=document.createElement('span'),week=document.createElement('span');
 main.className='preview-date-label';year.className='preview-date-year';year.textContent=iso.slice(0,4);slash.className='preview-date-year-sep';slash.textContent='/';year.append(slash);month.className='preview-date-month';month.textContent=iso.slice(5).replace('-','/');main.append(year,month);
 week.className='preview-date-weekday';week.textContent='('+['日','月','火','水','木','金','土'][d.getUTCDay()]+')';button.append(main,week);
}
function calendar({button,getAt,setDay}){
 const dialog=document.createElement('dialog');dialog.className='sheet tool-date-calendar';dialog.tabIndex=-1;dialog.setAttribute('aria-label','日付を選ぶ');
 dialog.innerHTML='<div class="sheet-head"><strong>日付を選ぶ</strong><button type="button" data-close>閉じる</button></div><div class="sheet-body"><div class="aim-cal-nav"><button type="button" data-prev aria-label="前の月">‹</button><input type="month" class="fav-in" data-month aria-label="月"><button type="button" data-next aria-label="次の月">›</button></div><div class="aim-cal-week">'+['日','月','火','水','木','金','土'].map(x=>'<span>'+x+'</span>').join('')+'</div><div class="aim-cal-grid" data-grid></div><button type="button" class="chip" data-today>今日</button></div>';
 document.body.append(dialog);let year,month;
 const paint=()=>{const grid=dialog.querySelector('[data-grid]');grid.replaceChildren();dialog.querySelector('[data-month]').value=year+'-'+String(month+1).padStart(2,'0');const first=new Date(Date.UTC(year,month,1)),count=new Date(Date.UTC(year,month+1,0)).getUTCDate(),chosen=Math.floor((getAt()+OFFSET)/DAY),today=Math.floor((Date.now()+OFFSET)/DAY);for(let i=0;i<first.getUTCDay();i++)grid.append(document.createElement('span'));for(let n=1;n<=count;n++){const day=Date.UTC(year,month,n)-OFFSET,b=document.createElement('button');b.type='button';b.textContent=String(n);b.setAttribute('aria-label',`${year}年${month+1}月${n}日`);b.setAttribute('aria-pressed',String(Math.floor((day+OFFSET)/DAY)===chosen));if(Math.floor((day+OFFSET)/DAY)===today)b.setAttribute('aria-current','date');b.onclick=()=>{setDay(day);dialog.close();};grid.append(b);}};
 button.onclick=()=>{const d=new Date(getAt()+OFFSET);year=d.getUTCFullYear();month=d.getUTCMonth();paint();dialog.showModal();dialog.focus();};
 const shift=delta=>{const d=new Date(Date.UTC(year,month+delta,1));if(d.getUTCFullYear()<100||d.getUTCFullYear()>9999)return;year=d.getUTCFullYear();month=d.getUTCMonth();paint();};dialog.querySelector('[data-prev]').onclick=()=>shift(-1);dialog.querySelector('[data-next]').onclick=()=>shift(1);dialog.querySelector('[data-month]').onchange=e=>{if(!/^\d{4}-\d{2}$/.test(e.target.value))return;const [y,m]=e.target.value.split('-').map(Number);if(y<100||y>9999||m<1||m>12)return;year=y;month=m-1;paint();};dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.querySelector('[data-today]').onclick=()=>{setDay(Math.floor((Date.now()+OFFSET)/DAY)*DAY-OFFSET);dialog.close();};dialog.addEventListener('close',()=>button.focus({preventScroll:true}));return dialog;
}
g.ToolDateTimeBar={decorate,wireScrub,syncTimeRange,dateText,calendar};
})(typeof window==='undefined'?globalThis:window);
