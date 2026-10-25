/* Camera settings: fixed-frame capture preview; no production API calls. */
(function(root){'use strict';
const states=new WeakMap(),T=()=>root.AstroNotesTimelapse;
const fmt=t=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(t);
const seconds=s=>`${Number(s.toFixed(2))}秒`;
function mount(host,{owner,token}){
 const panel=host.querySelector('[data-camera-panel]');if(!panel)return;
 let s=states.get(host);if(s){if(s.token!==token){stop(host);s.cancel++;s.owner=owner;s.token=token;s.config=null;host._timelapseConfig=null;s.rows=null;for(const field of s.box.querySelectorAll('input'))field.value=field.name==='interval'?'5':'240';s.box.querySelector('select').value=loadFps(owner);s.box.querySelector('[data-tl-summary]').textContent='撮影時間 1195秒 ・ 240枚 → 動画 '+(240/Number(loadFps(owner))).toFixed(2)+'秒';}const restored=host._timelapseConfig;if(T().settings(restored)&&restored!==s.config){s.config=restored;s.box.querySelector('[name=interval]').value=restored.interval;s.box.querySelector('[name=count]').value=restored.count;s.box.querySelector('select').value=restored.fps;const r=T().summary(restored);s.box.querySelector('[data-tl-summary]').textContent=`撮影時間 ${seconds(r.duration)} ・ ${r.count}枚 → 動画 ${seconds(r.video)}`;}return;}
 const box=document.createElement('section');box.className='timelapse-settings';box.innerHTML='<h3>タイムラプス</h3><label>撮影インターバル <span><input name="interval" type="number" min="0.1" max="3600" step="0.1" value="5" aria-label="撮影インターバル（秒）"> 秒</span></label><label>撮影回数 <span><input name="count" type="number" min="2" max="10000" step="1" value="240" aria-label="撮影回数（枚）"> 枚</span></label><label>再生フレームレート <select aria-label="再生フレームレート（fps）"><option value="24">24 fps</option><option value="25">25 fps</option><option value="30">30 fps</option><option value="60">60 fps</option></select></label><p class="tiny" data-tl-summary role="status"></p><button type="button" class="chip" data-tl-analyse>画角内の時間を計算</button><p class="tiny" data-tl-passages role="status">今の構図を固定して計算します。</p><button type="button" class="chip" data-tl-play>▶ プレビュー</button><p class="tiny muted">間隔は撮影開始から次の開始まで。露光と保存待ちは間隔内に収めてください。雲や露光ブレは再現しません。</p>';
 panel.querySelector('.sheet-body').append(box);
 const strip=document.createElement('div');strip.className='timelapse-preview';strip.hidden=true;strip.innerHTML='<button type="button" class="chip" data-tl-stop>停止して元の日時へ</button><output aria-live="off"></output>';host.querySelector('.aim-look-figure').after(strip);
 s={box,strip,host,owner,token,cancel:0,raf:0,config:null,rows:null,running:false,original:null};states.set(host,s);
 const summary=box.querySelector('[data-tl-summary]'),passes=box.querySelector('[data-tl-passages]'),play=box.querySelector('[data-tl-play]');
 function read(){return {interval:Number(box.querySelector('[name=interval]').value),count:Number(box.querySelector('[name=count]').value),fps:Number(box.querySelector('select').value)};}
 function changed(){stop(host);s.cancel++;s.rows=null;try{const v=read(),r=T().summary(v);host._timelapseConfig=s.config=v;summary.textContent=`撮影時間 ${seconds(r.duration)} ・ ${r.count}枚 → 動画 ${seconds(r.video)}`;play.disabled=false;passes.textContent='今の構図を固定して計算します。';}catch(e){host._timelapseConfig=s.config=null;summary.textContent=e.message;play.disabled=true;}}
 for(const input of box.querySelectorAll('input,select'))input.addEventListener('input',changed);
 box.querySelector('select').addEventListener('change',()=>{try{localStorage.setItem(fpsKey(s.owner),box.querySelector('select').value);}catch{summary.textContent+='（fpsを記憶できませんでした）';}});
 box.querySelector('select').value=loadFps(owner);
 const loaded=host._timelapseConfig;if(T().settings(loaded)){box.querySelector('[name=interval]').value=loaded.interval;box.querySelector('[name=count]').value=loaded.count;box.querySelector('select').value=loaded.fps;}
 // Do not attach defaults to a saved still-photo plan until the user actually chooses a setting or calculation.
 try{const r=T().summary(read());summary.textContent=`撮影時間 ${seconds(r.duration)} ・ ${r.count}枚 → 動画 ${seconds(r.video)}`;}catch{}
 function adapter(){const a=host._cameraPreview;if(!a?.current()||!a.frame)throw Error('対象・地点・日時を選び、画角枠を表示してから計算してください。');return a;}
 async function analyse(){stop(host);const ticket=++s.cancel,button=box.querySelector('[data-tl-analyse]');try{const v=read();T().summary(v);const a=adapter(),snapshot=a.snapshot();host._timelapseConfig=s.config=v;passes.textContent='画角内の時間を計算中…';button.disabled=true;const to=snapshot.start+Math.max(18*3600000,(v.count-1)*v.interval*1000),from=to-36*3600000;
 const rows=await T().passages(snapshot.margin,from,to,{current:()=>ticket===s.cancel&&a.current()&&a.key()===snapshot.key&&panel.getClientRects().length>0});
 if(ticket!==s.cancel)return;if(!rows){passes.textContent='構図または表示が変わりました。再計算してください。';return;}s.rows=rows;const relevant=rows.filter(r=>r.end>=snapshot.start),first=T().firstOutside(snapshot.start,v,rows),fit=rows.find(r=>r.start<=snapshot.start&&r.end>=snapshot.start),fitCount=fit?Math.floor((fit.end-snapshot.start)/(v.interval*1000))+1:0;
 passes.textContent=(relevant.length?relevant.slice(0,3).map(r=>`${r.openStart?'探索開始時から枠内':fmt(r.start)+'に入る'}〜${r.openEnd?'探索終了時も枠内':fmt(r.end)+'に外れる'}（${seconds((r.end-r.start)/1000)}）`).join(' / '):`${fmt(snapshot.start)}以降、${fmt(to)}までに天体全体が収まる区間は見つかりません。`)+(first?` ／ ${first}枚目は画角外です。`:' ／ 指定した撮影は全枚数が画角内です。')+(fitCount?` ／ ${v.interval}秒間隔なら${fit.openEnd?'探索範囲内で少なくとも':''}${fitCount}枚まで画角内。`:'')+'（天体全体・地平線より上・計算上の目安）';
 }catch(e){if(ticket===s.cancel)passes.textContent=e.message||'計算できませんでした。再試行してください。';}finally{if(ticket===s.cancel)button.disabled=false;}}
 box.querySelector('[data-tl-analyse]').onclick=analyse;
 play.onclick=()=>{stop(host);try{const v=read();T().summary(v);let a=adapter();a.pauseRealtime();a=adapter();const snap=a.snapshot();s.cancel++;s.previewClosing=true;panel.close();s.running=true;s.original={a,start:snap.start,key:snap.key};host._timelapseConfig=s.config=v;strip.hidden=false;host.querySelector('[data-camera-settings]').setAttribute('aria-expanded','false');host.querySelector('.aim-look-figure').scrollIntoView({block:'nearest'});
 const begin=performance.now();let previous=-1;const tick=now=>{if(!s.running)return;if(!a.current()||a.key()!==snap.key||document.hidden){stop(host);return;}const index=Math.min(v.count-1,Math.floor((now-begin)*v.fps/1000));if(index!==previous){const at=snap.start+index*v.interval*1000;a.draw(at);const outside=snap.margin(at)<0?' ・ 画角外':'';strip.querySelector('output').textContent=`${index+1} / ${v.count}枚 ・ ${fmt(at)}${outside}`;previous=index;}
 if(now-begin>=v.count/v.fps*1000){stop(host);return;}s.raf=requestAnimationFrame(tick);};s.raf=requestAnimationFrame(tick);
 }catch(e){summary.textContent=e.message;}};
 strip.querySelector('button').onclick=()=>stop(host);
 const cancel=()=>{s.cancel++;box.querySelector('[data-tl-analyse]').disabled=false;stop(host);};
 panel.addEventListener('camera-close',()=>{if(s.previewClosing){s.previewClosing=false;return;}cancel();});
 document.addEventListener('pointerdown',e=>{if(s.running&&!strip.contains(e.target))stop(host);},true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape')cancel();else if(s.running&&!strip.contains(e.target)&&!box.contains(e.target))stop(host);},true);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
 window.addEventListener('hashchange',cancel);
}
function fpsKey(owner){return 'astronotes.timelapse.fps:'+encodeURIComponent(owner||'guest');}
function loadFps(owner){try{const fps=Number(localStorage.getItem(fpsKey(owner)));return [24,25,30,60].includes(fps)?String(fps):'24';}catch{return '24';}}
function stop(host){const s=states.get(host);if(!s)return;s.cancel++;s.box.querySelector('[data-tl-analyse]').disabled=false;if(!s.running)return;s.running=false;cancelAnimationFrame(s.raf);s.strip.hidden=true;const original=s.original;s.original=null;if(original?.a.current())original.a.draw(original.start);}
function invalidate(host){stop(host);const s=states.get(host);if(s){s.cancel++;s.rows=null;s.box.querySelector('[data-tl-passages]').textContent='構図が変わりました。画角内の時間を再計算してください。';}}
root.AstroNotesCameraUI={mount,stop,invalidate};
})(globalThis);
