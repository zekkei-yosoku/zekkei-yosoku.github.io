
// A local device preference; explicit links always take precedence.
(() => {
 const initialHash=location.hash, initialSearch=location.search;
 let startupInteracted=false;
 for(const event of ['pointerdown','keydown','wheel','touchstart'])document.addEventListener(event,()=>{startupInteracted=true;},{once:true,passive:true,capture:true});
 const key='sorami.startupScreen';
 const choices=[['home','ホーム'],['forecast','予測'],['framing','構図'],['map','地図']];
 const permitted=id=>id==='home'||id==='forecast'||(id==='map'?screenAllowed('skymap'):id==='framing'&&screenAllowed('framing'));
 const get=()=>{try{const v=localStorage.getItem(key);return choices.some(([id])=>id===v)?v:'home';}catch{return 'home';}};
 const row=document.createElement('div');row.className='startup-setting';
 row.style.cssText='padding:12px 0';
 const label=document.createElement('label');label.htmlFor='startupScreen';label.textContent='起動画面';
 const select=document.createElement('select');select.id='startupScreen';select.style.cssText='display:block;width:100%;min-height:44px;margin-top:6px;font-size:16px';
 for(const [id,name] of choices)select.add(new Option(name,id));
 select.value=get();
 const note=document.createElement('p');note.className='tiny';note.textContent='この端末で最初に開く画面。リンクから開く場合はリンク先を優先します。';
 const status=document.createElement('p');status.className='tiny';status.setAttribute('role','status');
 select.onchange=()=>{try{localStorage.setItem(key,select.value);status.textContent='保存しました。次回の起動から適用します。';}catch{select.value=get();status.textContent='保存できませんでした。端末の保存設定を確認してください。';}};
 const themeRow=document.createElement('div');themeRow.style.cssText='padding-bottom:20px;margin-bottom:16px;border-bottom:1px solid var(--line)';
 const themeLabel=document.createElement('div');themeLabel.id='themeModeLabel';themeLabel.textContent='表示モード';
 const themeButtons=document.createElement('div');themeButtons.id='themeMode';themeButtons.setAttribute('role','group');themeButtons.setAttribute('aria-labelledby','themeModeLabel');themeButtons.style.cssText='display:flex;gap:6px;margin-top:8px';
 const themeStatus=document.createElement('p');themeStatus.className='tiny';themeStatus.setAttribute('role','status');
 const updateTheme=()=>{for(const button of themeButtons.children){const selected=button.dataset.mode===getThemePreference();button.setAttribute('aria-pressed',String(selected));button.style.background=selected?'var(--accent)':'var(--sunk)';button.style.color=selected?'var(--on-accent)':'var(--text)';}};
 for(const [mode,name] of [['auto','自動'],['light','ライト'],['dark','ダーク']]){
  const button=document.createElement('button');button.type='button';button.dataset.mode=mode;button.textContent=name;button.style.cssText='flex:1;min-height:44px;border-radius:9px;font-size:16px';
  button.onclick=()=>{const saved=setThemePreference(mode);updateTheme();themeStatus.textContent=saved?'保存しました。':'保存できませんでした。端末の保存設定を確認してください。';};themeButtons.append(button);
 }
 const themeNote=document.createElement('p');themeNote.className='tiny';themeNote.textContent='自動は端末の設定に合わせます。この端末に保存されます。';
 themeRow.append(themeLabel,themeButtons,themeNote,themeStatus);updateTheme();
 const autoRow=document.createElement('div');autoRow.style.cssText='padding:16px 0;border-top:1px solid var(--line);margin-top:18px';
 const autoLabel=document.createElement('label');autoLabel.style.cssText='display:flex;align-items:center;gap:12px;min-height:44px';
 const autoInput=document.createElement('input');autoInput.type='checkbox';autoInput.id='homeAutoBody';autoInput.style.cssText='width:20px;height:20px;accent-color:var(--accent)';
 const autoText=document.createElement('span');autoText.textContent='昼夜で太陽・月を自動切替';autoLabel.append(autoInput,autoText);
 const autoStatus=document.createElement('p');autoStatus.className='tiny';autoStatus.setAttribute('role','status');
 const updateAuto=()=>{autoInput.disabled=!globalThis.AstroNotesAlmanacDashboard;autoInput.checked=globalThis.AstroNotesAlmanacDashboard?.getAuto()??true;};updateAuto();
 autoInput.onchange=()=>{const saved=globalThis.AstroNotesAlmanacDashboard?.setAuto(autoInput.checked);updateAuto();autoStatus.textContent=saved?'保存しました。':'保存できませんでした。端末の保存設定を確認してください。';};
 autoRow.append(autoLabel,autoStatus);row.append(themeRow,label,select,note,status,autoRow);
 const settings=document.createElement('dialog');settings.id='appSettings';settings.className='sheet';settings.tabIndex=-1;settings.setAttribute('aria-labelledby','appSettingsTitle');
 settings.innerHTML='<div class="sheet-head"><strong id="appSettingsTitle">設定</strong><button type="button" id="appSettingsClose" aria-label="閉じる" title="閉じる"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><div class="sheet-body"></div>';
 const settingsBody=settings.querySelector('.sheet-body');
 const categories=document.createElement('div');categories.id='settingsCategories';
 categories.innerHTML='<button type="button" class="list-item" id="settingsAccount" style="width:100%;display:flex;align-items:center;gap:14px;text-align:left;min-height:88px;padding:16px 4px"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2Z"/></svg><span style="flex:1"><strong>アカウント・ログイン</strong><span class="tiny" style="display:block;margin-top:4px">パスワード・パスキーなど</span></span><span aria-hidden="true">›</span></button><button type="button" class="list-item" id="settingsScreen" style="width:100%;display:flex;align-items:center;gap:14px;text-align:left;min-height:88px;padding:16px 4px"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></svg><span style="flex:1"><strong>画面</strong><span class="tiny" style="display:block;margin-top:4px">表示モード・起動画面</span></span><span aria-hidden="true">›</span></button>';
 const back=document.createElement('button');back.type='button';back.id='settingsBack';back.className='panel-back';back.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg>';back.setAttribute('aria-label','戻る');back.hidden=false;
 row.hidden=true;settings.querySelector('.sheet-head').prepend(back);settingsBody.append(categories,row);document.body.append(settings);
 const originalAccountOpen=document.getElementById('authButton').onclick;
 let settingsOpener=document.getElementById('toolsButton');
 const settingsHome=()=>{categories.hidden=false;row.hidden=true;back.hidden=true;document.getElementById('appSettingsTitle').textContent='設定';};
 const ownerEntry=document.createElement('div');ownerEntry.id='settingsPrivateEntry';categories.append(ownerEntry);
 const openSettings=opener=>{settingsOpener=opener;update();settingsHome();closeTools();showSheet(settings);scrollLock.on();renderPrivateEntry();};
 back.onclick=()=>{if(!categories.hidden){settings.close();return;}settingsHome();document.getElementById('settingsScreen').focus();};
 document.getElementById('settingsScreen').onclick=()=>{update();categories.hidden=true;row.hidden=false;back.hidden=false;document.getElementById('appSettingsTitle').textContent='画面';settings.focus({preventScroll:true});};
 document.getElementById('settingsAccount').onclick=()=>{settings.close();originalAccountOpen();};
 // The account page returns to the settings list the same way the screen page does.
 document.getElementById('accountBack').onclick=()=>{if(document.getElementById('accountSheet').dataset.accountView!=='overview'){showAccountView('overview',true);return;}document.getElementById('accountSheet').close();openSettings(document.getElementById('authButton'));};
 document.getElementById('authButton').onclick=()=>{if(auth)openSettings(document.getElementById('authButton'));else originalAccountOpen();};
 settings.querySelector('#appSettingsClose').onclick=()=>settings.close();
 settings.addEventListener('close',()=>{scrollLock.off();settingsOpener.focus({preventScroll:true});});

 // A rightward swipe may dismiss an already-open panel. No swipe-to-open handler.
 for(const panel of [settings,document.getElementById('accountSheet')]){
  let start=null;
  panel.addEventListener('touchstart',event=>{start=null;if(!panel.open||event.touches.length!==1||event.target.closest('button,input,select,textarea,a,[contenteditable]'))return;const t=event.touches[0];start={id:t.identifier,x:t.clientX,y:t.clientY};},{passive:true});
  panel.addEventListener('touchcancel',()=>{start=null;},{passive:true});
  panel.addEventListener('touchend',event=>{const from=start;start=null;if(!from||!panel.open)return;const t=Array.from(event.changedTouches).find(t=>t.identifier===from.id);if(!t)return;const dx=t.clientX-from.x,dy=t.clientY-from.y;if(dx>70&&Math.abs(dy)<dx*.5 && (panel.id!=='accountSheet'||leaveAccountCodes()))panel.close();},{passive:true});
 }
 const update=()=>{updateTheme();updateAuto();select.value=get();for(const o of select.options)o.disabled=!permitted(o.value);status.textContent=!permitted(get())?'選択した画面は現在利用できないため、起動時はホームを開きます。':'';};
 // Refresh against live grants whenever settings is opened, including after a drawer swipe.
 new MutationObserver(()=>{if(settings.open)update();}).observe(document.getElementById('authButton'),{childList:true,subtree:true,characterData:true});
 const openStartup = async()=>{
  const preferred=get();
  if(initialHash||initialSearch||preferred==='forecast') { applyRoute(); return; }
  if(preferred==='home'){history.replaceState(history.state,'','#/almanac');applyRoute();return;}
  $("startupMessage").textContent="ログイン状態を確認しています…";
  // A deliberate route change already has its own access checks. Do not keep
  // that screen hidden behind the old launch request; keep waiting otherwise.
  await new Promise((resolve,reject)=>{
   let frame=0,settled=false,forecastChosen=false;
   const forecast=$("toolsHome"),chooseForecast=()=>{forecastChosen=true;startupInteracted=true;};
   const finish=(failed=false,error)=>{if(settled)return;settled=true;cancelAnimationFrame(frame);forecast.removeEventListener('click',chooseForecast,true);if(failed)reject(error);else resolve();};
   const check=()=>{if(settled)return;if(forecastChosen||location.hash!==initialHash||location.search!==initialSearch)finish();else frame=requestAnimationFrame(check);};
   forecast.addEventListener('click',chooseForecast,true);
   startupSessionReady.then(()=>finish(),error=>finish(true,error));check();
  });
  update();
  // Hash routes, shared-plan query parameters and navigation during login are not replaced.
  if(startupInteracted||initialHash||initialSearch||location.hash!==initialHash||location.search!==initialSearch){applyRoute();return;}
  const selected=get();if(!permitted(selected)){history.replaceState(history.state,'','#/almanac');applyRoute();return;}
  const route=selected==='home'?'#/almanac':selected==='framing'?'#/aim/tower':selected==='map'?'#/skymap':null;
  if(route)history.replaceState(history.state,'',route);
  applyRoute();
 };
 document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&predictionNeeded()){
   if(predictionDirty||!AstroNotesPrediction.fresh(acceptedPrediction,place,Date.now()))void load(false);
  }
 });
 void openStartup().finally(()=>{clearTimeout(globalThis.AstroNotesStartupPaintTimer);document.documentElement.removeAttribute('data-startup-pending');resumeRatingLogin();});
})();
