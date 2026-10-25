/* Trial: static capture range, never advances the selected date/time. */
(function(root){'use strict';
const states=new WeakMap(),T=()=>root.AstroNotesTimelapse;
const fmt=t=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(t);
function indices(count,max=61){if(!Number.isInteger(count)||count<2||count>10000||!Number.isInteger(max)||max<2||max>61)throw Error('invalid capture count');const n=Math.min(count,max);return Array.from({length:n},(_,i)=>Math.round(i*(count-1)/(n-1)));}
const fpsKey=o=>'astronotes.timelapse.fps:'+encodeURIComponent(o||'guest');
function loadFps(o){try{const f=Number(localStorage.getItem(fpsKey(o)));return [24,25,30,60].includes(f)?f:24;}catch{return 24;}}
function sync(s,at){
 for(const b of s.buttons){b.setAttribute('aria-checked',String(s.on));b.textContent=s.on?'ON':'OFF';}
 s.bar.dataset.on=String(s.on);s.bar.hidden=false;s.output.hidden=false;if(!s.on)s.output.textContent="撮影範囲 OFF";if(s.toggle)s.toggle.setAttribute('aria-checked',String(s.on));
 if(s.on&&T().settings(s.config)&&Number.isFinite(at)){const v=s.config,text=`${fmt(at)} → ${fmt(at+(v.count-1)*v.interval*1000)} ・ ${v.count}枚${v.count>61?'（位置は61点に間引き表示）':''}`;if(s.output.textContent!==text)s.output.textContent=text;}
}
function redraw(s){s.cache=null;sync(s,s.host._lookAt);s.host._redrawLook?.();}
function fill(s,v){s.box.querySelector('[name=interval]').value=v.interval;s.box.querySelector('[name=count]').value=v.count;s.box.querySelector('select').value=String(v.fps);}
function read(s){return {interval:Number(s.box.querySelector('[name=interval]').value),count:Number(s.box.querySelector('[name=count]').value),fps:Number(s.box.querySelector('select').value)};}
function changed(s,{activate=false}={}){try{const v=read(s),r=T().summary(v);s.config=v;s.host._timelapseConfig=v;if(activate)s.on=true;s.summary.textContent=`最初から最後まで ${Number(r.duration.toFixed(2))}秒 ・ 完成動画 ${Number(r.video.toFixed(2))}秒`;redraw(s);return true;}catch(e){s.on=false;s.config=null;s.host._timelapseConfig=null;s.summary.textContent=e.message;redraw(s);return false;}}
function sceneExpansion(host,figure){
 if(figure.querySelector('.trial-scene-expand'))return;
 const b=document.createElement('button');b.type='button';b.className='trial-scene-expand';b.innerHTML='<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M4 4l5 5M15 4h5v5m0-5-5 5M4 15v5h5m-5 0 5-5M15 20h5v-5m0 5-5-5"/></svg>';figure.append(b);
 const set=on=>{host._full=on;figure.classList.toggle('trial-scene-wide',on);host._fullH=on?Math.max(200,innerHeight-(document.querySelector('#skyMapView .sky-map-footer')?.offsetHeight||parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sky-footer-h'))||100)):null;b.querySelector('path').setAttribute('d',on?'M9 4v5H4m5 0L4 4m11 0v5h5m-5 0 5-5M4 15h5v5m0-5-5 5m16-5h-5v5m0-5 5 5':'M4 9V4h5M4 4l5 5M15 4h5v5m0-5-5 5M4 15v5h5m-5 0 5-5M15 20h5v-5m0 5-5-5');b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-label',on?'見え方の全画面表示を終了':'見え方を全画面表示');b.title=b.getAttribute('aria-label');if(host.isConnected&&!host.closest('[hidden]')&&host._lookSpec)root.aimLookRender(host,host._lookSpec);};
 b.onclick=()=>set(!host._full);b.setAttribute('aria-label','見え方を全画面表示');b.setAttribute('aria-pressed','false');
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&host._full&&!document.querySelector('dialog[open]')){e.preventDefault();set(false);}});
 root.addEventListener('resize',()=>{if(host._full)set(true);});root.addEventListener('hashchange',()=>{if(host._full)set(false);});
 document.querySelector('#exploreMapTab')?.addEventListener('click',()=>{if(host._full)set(false);});
 new MutationObserver(()=>{if(host._full&&(!figure.isConnected||host.closest('[hidden]')))set(false);}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
}
function mapToolbar(){const row=document.querySelector('#skyMapShareRow'),wrap=document.querySelector('#skyMapCanvas')?.closest('.mapwrap');if(row&&wrap&&row.nextElementSibling!==wrap)wrap.before(row);const keep=row?.querySelector('[data-plan-action=keep]'),send=row?.querySelector('[data-plan-action=share]');if(keep&&send&&keep.nextElementSibling!==send)row.insertBefore(keep,send);}
function arrange(host){
 const figure=host.querySelector('.aim-look-figure');if(!figure)return;sceneExpansion(host,figure);mapToolbar();let tools=host.querySelector('.trial-scene-toolbar');
 if(!tools){tools=document.createElement('div');tools.className='trial-scene-toolbar';tools.setAttribute('role','group');tools.setAttribute('aria-label','見え方の操作');figure.before(tools);}
 let slot=0;for(const sel of ['.trial-timelapse-toggle','[data-camera-settings]','.preview-center','.aim-figure-share']){const el=host.querySelector(sel);if(el){if(tools.children[slot]!==el)tools.insertBefore(el,tools.children[slot]||null);slot++;}}
 const share=tools.querySelector('.aim-figure-share'),keep=share?.querySelector('[data-plan-action=keep]'),send=share?.querySelector('[data-plan-action=share]');if(keep&&send&&keep.nextElementSibling!==send)share.insertBefore(keep,send);
 const bar=host.querySelector('.timelapse-mode-bar');if(bar&&tools.nextElementSibling!==bar)tools.after(bar);
}
function mount(host,{owner,token}){
 const camera=host.querySelector('[data-camera-panel]');if(!camera)return;
 arrange(host);
 let s=states.get(host);
 if(s){if(s.token!==token){s.token=token;s.owner=owner;s.on=false;s.config=null;host._timelapseConfig=null;fill(s,{interval:5,count:240,fps:loadFps(owner)});s.summary.textContent='撮影間隔と回数を設定してください。';redraw(s);}const saved=host._timelapseConfig;if(T().settings(saved)&&saved!==s.config){fill(s,saved);s.config=saved;s.on=true;changed(s);}else if(!T().settings(saved)&&s.config){s.config=null;s.on=false;fill(s,{interval:5,count:240,fps:loadFps(owner)});s.summary.textContent='撮影間隔と回数を設定してください。';redraw(s);}return;}
 const bar=document.createElement('div');bar.className='timelapse-mode-bar';bar.innerHTML='<button type="button" class="timelapse-range-open" aria-label="タイムラプス設定" aria-haspopup="dialog" aria-controls="trialTimelapsePanel"><output class="tiny" aria-live="polite"></output><span aria-hidden="true">⌄</span></button>';const rangeOpen=bar.firstElementChild,output=bar.querySelector('output');output.hidden=true;
 const settings=document.createElement('button');settings.type='button';settings.className='aim-body-move trial-timelapse-toggle';settings.setAttribute('role','switch');settings.setAttribute('aria-label','タイムラプス表示');settings.title='タイムラプス表示 ON/OFF';settings.innerHTML='<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 5.5 9.5 3.5h5l1.5 2h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4.5"/><path d="M12 10.5V13l2 1.2"/></svg>';
 const popup=document.createElement('dialog');popup.id='trialTimelapsePanel';popup.className='sheet preview-camera-dialog timelapse-dialog';popup.setAttribute('aria-label','タイムラプス設定');popup.innerHTML='<div class="sheet-head"><strong>タイムラプス</strong><button type="button" data-tl-close aria-label="閉じる">閉じる</button></div><div class="sheet-body"><div class="timelapse-mode-head"><span>撮影範囲を表示</span></div><section class="timelapse-settings"><label>撮影インターバル <span><input name="interval" type="number" min="0.1" max="3600" step="0.1" value="5" aria-label="撮影インターバル（秒）"> 秒</span></label><label>撮影回数 <span><input name="count" type="number" min="2" max="10000" step="1" value="240" aria-label="撮影回数（枚）"> 枚</span></label><label>再生フレームレート <select aria-label="再生フレームレート（fps）"><option value="24">24 fps</option><option value="25">25 fps</option><option value="30">30 fps</option><option value="60">60 fps</option></select></label><p class="tiny" data-tl-summary role="status"></p><p class="tiny muted">今の日時を開始として、最後の撮影までの位置を図に重ねます。間隔は撮影開始から次の開始までです。</p></section></div>';
 const box=popup.querySelector('.timelapse-settings');s={host,owner,token,bar,output,popup,box,buttons:[],summary:box.querySelector('[data-tl-summary]'),toggle:settings,on:false,config:null,cache:null};states.set(host,s);
 function switchButton(parent){const b=document.createElement('button');b.type='button';b.className='timelapse-switch';b.setAttribute('role','switch');b.setAttribute('aria-label','タイムラプス表示');b.onclick=()=>{if(s.on){s.on=false;redraw(s);}else changed(s,{activate:true});};s.buttons.push(b);parent.append(b);}
 switchButton(popup.querySelector('.timelapse-mode-head'));
 const figure=host.querySelector('.aim-look-figure');figure.before(bar);figure.append(settings);host.append(popup);arrange(host);
 settings.onclick=()=>{if(s.on){s.on=false;redraw(s);}else if(!changed(s,{activate:true})){rangeOpen.setAttribute('aria-expanded','true');showSheet(popup);}};rangeOpen.onclick=()=>{rangeOpen.setAttribute('aria-expanded','true');showSheet(popup);};popup.querySelector('[data-tl-close]').onclick=()=>popup.close();popup.addEventListener('close',()=>rangeOpen.setAttribute('aria-expanded','false'));popup.addEventListener('click',e=>{if(e.target!==popup)return;const r=popup.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)popup.close();});
 for(const input of box.querySelectorAll('input,select'))input.addEventListener('input',()=>changed(s));
 box.querySelector('select').addEventListener('change',()=>{try{localStorage.setItem(fpsKey(s.owner),box.querySelector('select').value);}catch{s.summary.textContent+='（fpsを記憶できませんでした）';}});
 const saved=host._timelapseConfig;if(T().settings(saved)){fill(s,saved);s.config=saved;s.on=true;changed(s);}else{fill(s,{interval:5,count:240,fps:loadFps(owner)});s.summary.textContent=`最初から最後まで1195秒 ・ 完成動画${240/loadFps(owner)}秒`;sync(s,host._lookAt);}
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
