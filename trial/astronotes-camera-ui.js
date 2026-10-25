/* Trial: static capture range, never advances the selected date/time. */
(function(root){'use strict';
const states=new WeakMap(),T=()=>root.AstroNotesTimelapse;
function indices(count,max=61){if(!Number.isInteger(count)||count<2||count>10000||!Number.isInteger(max)||max<2||max>61)throw Error('invalid capture count');const n=Math.min(count,max);return Array.from({length:n},(_,i)=>Math.round(i*(count-1)/(n-1)));}
const fpsKey=o=>'astronotes.timelapse.fps:'+encodeURIComponent(o||'guest');
function loadFps(o){try{const f=Number(localStorage.getItem(fpsKey(o)));return [24,25,30,60].includes(f)?f:24;}catch{return 24;}}
function sync(s,at){
 for(const b of s.buttons){b.setAttribute('aria-checked',String(s.on));b.textContent=s.on?'ON':'OFF';}
 if(s.toggle)s.toggle.dataset.enabled=String(s.on);
}
function redraw(s){s.cache=null;sync(s,s.host._lookAt);s.host._redrawLook?.();}
function fill(s,v){s.box.querySelector('[name=interval]').value=v.interval;s.box.querySelector('[name=count]').value=v.count;s.box.querySelector('select').value=String(v.fps);}
function read(s){return {interval:Number(s.box.querySelector('[name=interval]').value),count:Number(s.box.querySelector('[name=count]').value),fps:Number(s.box.querySelector('select').value)};}
function durationText(seconds){const value=Math.round(seconds*100)/100,h=Math.floor(value/3600),m=Math.floor(value%3600/60),sec=Number((value%60).toFixed(2));return (h?h+'時間':'')+(m?m+'分':'')+(sec||(!h&&!m)?sec+'秒':'');}
function summaryText(v){const r=T().summary(v);return `最終撮影まで ${durationText(r.duration)} ・ 動画 ${durationText(r.video)}`+(v.count>61?'（図は61点に間引き表示）':'');}
function changed(s,{activate=false}={}){try{const v=read(s);T().summary(v);s.config=v;s.host._timelapseConfig=v;if(activate)s.on=true;s.summary.textContent=summaryText(v);redraw(s);return true;}catch(e){s.on=false;s.config=null;s.host._timelapseConfig=null;const v=read(s);s.summary.textContent=!Number.isFinite(v.interval)||v.interval<.1||v.interval>3600?'撮影間隔は0.1〜3600秒で入力してください。':!Number.isInteger(v.count)||v.count<2||v.count>10000?'撮影枚数は2〜10000枚で入力してください。':(v.count-1)*v.interval>129600?'撮影時間が36時間以内になるよう、間隔か枚数を減らしてください。':'動画のフレームレートを選び直してください。';redraw(s);return false;}}
function mapToolbar(){const row=document.querySelector('#skyMapShareRow'),wrap=document.querySelector('#skyMapCanvas')?.closest('.mapwrap');if(row&&wrap&&row.nextElementSibling!==wrap)wrap.before(row);const keep=row?.querySelector('[data-plan-action=keep]'),send=row?.querySelector('[data-plan-action=share]');if(keep&&send&&keep.nextElementSibling!==send)row.insertBefore(keep,send);}
function arrange(host){
 const figure=host.querySelector('.aim-look-figure');if(!figure)return;const center=host.querySelector('.preview-center');if(center){center.classList.add('trial-scene-center');if(center.parentElement!==figure)figure.append(center);}mapToolbar();let tools=host.querySelector('.trial-scene-toolbar');
 if(!tools){tools=document.createElement('div');tools.className='trial-scene-toolbar';tools.setAttribute('role','group');tools.setAttribute('aria-label','見え方の操作');figure.before(tools);}
 let slot=0;for(const sel of ['.trial-timelapse-toggle','[data-camera-settings]','.aim-figure-share']){const el=host.querySelector(sel);if(el){if(tools.children[slot]!==el)tools.insertBefore(el,tools.children[slot]||null);slot++;}}
 const share=tools.querySelector('.aim-figure-share'),keep=share?.querySelector('[data-plan-action=keep]'),send=share?.querySelector('[data-plan-action=share]');if(keep&&send&&keep.nextElementSibling!==send)share.insertBefore(keep,send);
}
function mount(host,{owner,token}){
 const camera=host.querySelector('[data-camera-panel]');if(!camera)return;
 arrange(host);
 let s=states.get(host);
 if(s){if(s.token!==token){s.token=token;s.owner=owner;s.on=false;s.config=null;host._timelapseConfig=null;fill(s,{interval:5,count:240,fps:loadFps(owner)});s.summary.textContent='撮影間隔と枚数を設定してください。';redraw(s);}const saved=host._timelapseConfig;if(T().settings(saved)&&saved!==s.config){fill(s,saved);s.config=saved;s.on=true;changed(s);}else if(!T().settings(saved)&&s.config){s.config=null;s.on=false;fill(s,{interval:5,count:240,fps:loadFps(owner)});s.summary.textContent='撮影間隔と枚数を設定してください。';redraw(s);}return;}
 const settings=document.createElement('button');settings.type='button';settings.className='aim-body-move trial-timelapse-toggle';settings.setAttribute('aria-label','タイムラプス設定');settings.title='タイムラプス設定';settings.setAttribute('aria-haspopup','dialog');settings.setAttribute('aria-controls','trialTimelapsePanel');settings.setAttribute('aria-expanded','false');settings.innerHTML='<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 5.5 9.5 3.5h5l1.5 2h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4.5"/><path d="M12 10.5V13l2 1.2"/></svg>';
 const popup=document.createElement('dialog');popup.id='trialTimelapsePanel';popup.className='sheet preview-camera-dialog timelapse-dialog';popup.setAttribute('aria-label','タイムラプス設定');popup.innerHTML='<div class="sheet-head"><strong>タイムラプス</strong><button type="button" data-tl-close aria-label="閉じる">閉じる</button></div><div class="sheet-body"><div class="timelapse-mode-head"><span>天体の位置を図に表示</span></div><section class="timelapse-settings"><label>撮影間隔 <span><input name="interval" type="number" min="0.1" max="3600" step="0.1" value="5" aria-label="撮影間隔（秒）" title="撮影開始から次の開始まで"> 秒</span></label><label>撮影枚数 <span><input name="count" type="number" min="2" max="10000" step="1" value="240" aria-label="撮影枚数（枚）"> 枚</span></label><label>動画のフレームレート <select aria-label="動画のフレームレート（fps）"><option value="24">24 fps</option><option value="25">25 fps</option><option value="30">30 fps</option><option value="60">60 fps</option></select></label><p class="tiny" data-tl-summary role="status"></p><p class="tiny muted">選択中の日時から撮影開始。間隔は開始から次の開始まで。</p></section></div>';
 const box=popup.querySelector('.timelapse-settings');s={host,owner,token,popup,box,buttons:[],summary:box.querySelector('[data-tl-summary]'),toggle:settings,on:false,config:null,cache:null};states.set(host,s);
 function switchButton(parent){const b=document.createElement('button');b.type='button';b.className='timelapse-switch';b.setAttribute('role','switch');b.setAttribute('aria-label','タイムラプス表示');b.onclick=()=>{if(s.on){s.on=false;redraw(s);}else changed(s,{activate:true});};s.buttons.push(b);parent.append(b);}
 switchButton(popup.querySelector('.timelapse-mode-head'));
 const figure=host.querySelector('.aim-look-figure');figure.append(settings);host.append(popup);arrange(host);
 settings.onclick=()=>{settings.setAttribute('aria-expanded','true');showSheet(popup);};popup.querySelector('[data-tl-close]').onclick=()=>popup.close();popup.addEventListener('close',()=>settings.setAttribute('aria-expanded','false'));popup.addEventListener('click',e=>{if(e.target!==popup)return;const r=popup.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)popup.close();});
 for(const input of box.querySelectorAll('input,select'))input.addEventListener('input',()=>changed(s));
 box.querySelector('select').addEventListener('change',()=>{try{localStorage.setItem(fpsKey(s.owner),box.querySelector('select').value);}catch{s.summary.textContent+='（fpsを記憶できませんでした）';}});
 const saved=host._timelapseConfig;if(T().settings(saved)){fill(s,saved);s.config=saved;s.on=true;changed(s);}else{fill(s,{interval:5,count:240,fps:loadFps(owner)});s.summary.textContent=summaryText({interval:5,count:240,fps:loadFps(owner)});sync(s,host._lookAt);}
}
function drawRange(host,ctx,{at,seq,k,toPx,pack,disc}){
 const s=states.get(host);if(!s||!s.on||!T().settings(s.config)){if(host.dataset.timelapseDrawn!=='0')host.dataset.timelapseDrawn='0';return;}sync(s,at);
 const v=s.config,key=JSON.stringify([seq,at,v.interval,v.count]);
 if(s.cache?.key!==key)s.cache={key,points:indices(v.count).map(i=>({i,p:pack(at+i*v.interval*1000)}))};
 const points=s.cache.points;ctx.save();ctx.lineWidth=1.4;ctx.strokeStyle='#9ebed5';ctx.setLineDash([4,3]);ctx.globalAlpha=.8;ctx.beginPath();let pen=false;
 for(const {p}of points){const xy=p.x===null?null:toPx([p.x,p.y]);if(!xy){pen=false;continue;}if(pen)ctx.lineTo(...xy);else ctx.moveTo(...xy);pen=true;}ctx.stroke();ctx.setLineDash([]);
 for(const {i,p}of points){const xy=p.x===null?null:toPx([p.x,p.y]);if(!xy)continue;const r=Math.max(1.5,p.radius*k);if(i!==0){ctx.globalAlpha=i===v.count-1 ? .9 : .45;const upper=Math.max(1,(p.upperRadius??p.radius)*k),lower=Math.max(1,(p.lowerRadius??p.radius)*k);ctx.save();ctx.translate(xy[0],xy[1]+(lower-upper)/2);ctx.scale(1,(upper+lower)/(2*r));disc(0,0,r,p);ctx.restore();}if(i===0||i===v.count-1){ctx.globalAlpha=1;ctx.strokeStyle=i===0?'#9fe1aa':'#ffd28a';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(...xy,r+3,0,Math.PI*2);ctx.stroke();}}
 ctx.restore();host.dataset.timelapseDrawn=String(points.length);
}
function stop(){} // Static overlay has no playback clock to stop.
function invalidate(host){const s=states.get(host);if(s)s.cache=null;}
const api={mount,drawRange,mapToolbar,stop,invalidate,indices};root.AstroNotesCameraUI=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
