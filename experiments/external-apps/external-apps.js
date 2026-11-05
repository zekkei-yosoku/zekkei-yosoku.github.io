// Trial external-app owner. Preferences are per device; launch ports are injectable.
(() => {
'use strict';
AstroNotesPlan.createExternalApps=function({storage,show,onMapChange=()=>{},doc=document,ua=navigator.userAgent,
 launchUrl=url=>{if(url.startsWith('geo:')){location.href=url;return;}const a=doc.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';doc.body.append(a);a.click();a.remove();},
 saveFile=file=>{const url=URL.createObjectURL(file),a=doc.createElement('a');a.href=url;a.download=file.name;doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);},
 canShareFile=file=>{try{return !!navigator.share&&!!navigator.canShare?.({files:[file]});}catch{return false;}},
 shareFile=file=>navigator.share({files:[file],title:'撮影予定'})}={}){
 const apple=/iPhone|iPad|iPod|Macintosh/i.test(ua),android=/Android/i.test(ua);
 const keys={map:'sorami.mapApp',calendar:'sorami.calendarApp'};
 const mapApps={
  device:{name:'端末の地図アプリ',chipLabel:'地図アプリ',url:t=>'geo:'+t.replaceAll(' ','')+'?q='+t.replaceAll(' ','')},
  google:{name:'Google マップ',chipLabel:'Google',url:t=>'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(t)},
  apple:{name:'Apple マップ',chipLabel:'Apple',url:t=>'https://maps.apple.com/?ll='+t.replaceAll(' ','')+'&q='+encodeURIComponent(t)}
 };
 const choices=kind=>kind==='map'?(android?['device','google','apple']:apple?['apple','google']:['google','apple']).map(id=>({id,label:mapApps[id].name})):
  kind==='calendar'?[{id:'google',label:'Google カレンダー'},{id:'device',label:'端末のカレンダー'}]:[];
 const accepted=(kind,id)=>choices(kind).some(x=>x.id===id);
 const get=kind=>{if(!keys[kind])return null;const id=storage.get(keys[kind],null);return accepted(kind,id)?id:null;};
 const listeners=new Set();
 const set=(kind,id)=>{if(!keys[kind]||(id!==null&&!accepted(kind,id)))return false;if(!storage.set(keys[kind],id))return false;for(const fn of listeners)fn();if(kind==='map')try{onMapChange();}catch{}return true;};
 const pending={map:null,calendar:null},sheets={};
 function coordinates(point){
  const parts=typeof point==='string'?point.split(',').map(s=>s.trim()):null;
  if(parts&&(parts.length!==2||parts.some(s=>!s)))throw Error('撮影地点を確認してください。');
  const lat=parts?Number(parts[0]):point?.latitude,lon=parts?Number(parts[1]):point?.longitude;
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw Error('撮影地点を確認してください。');
  return parts?parts.join(', '):lat.toFixed(7)+', '+lon.toFixed(7);
 }
 const notify=(r,message)=>{if(r&&current(r))r.onStatus?.(message);};
 const current=r=>pending[r.kind]===r&&(!r.parent||r.parent.open)&&r.isCurrent();
 function cancel(kind){const r=pending[kind];pending[kind]=null;r?.cleanup?.();if(sheets[kind]?.dialog.open)sheets[kind].dialog.close();}
 function sheet(kind){
  if(sheets[kind])return sheets[kind];const prefix=kind==='map'?'mapApp':'calendarApp';let dialog=doc.getElementById(prefix+'Sheet');
  if(!dialog){dialog=doc.createElement('dialog');dialog.id=prefix+'Sheet';dialog.className='sheet';dialog.tabIndex=-1;dialog.setAttribute('aria-labelledby',prefix+'Title');dialog.innerHTML='<div class="sheet-head"><strong id="'+prefix+'Title"></strong><button type="button" id="'+prefix+'Close" aria-label="閉じる">閉じる</button></div><div class="sheet-body"><p class="tiny" id="'+prefix+'Coord"></p><div class="map-app-list" id="'+prefix+'List"></div><label class="map-app-remember"><input type="checkbox" id="'+prefix+'Remember">次回からも使う</label></div>';doc.body.append(dialog);}
  dialog.querySelector('#'+prefix+'Title').textContent=kind==='map'?'地図アプリを選ぶ':'カレンダーを選ぶ';
  const close=dialog.querySelector('#'+prefix+'Close'),list=dialog.querySelector('#'+prefix+'List'),remember=dialog.querySelector('#'+prefix+'Remember'),note=dialog.querySelector('#'+prefix+'Coord');
  remember.parentElement.lastChild.textContent='次回からも使う';
  const status=doc.createElement('p');status.className='tiny';status.setAttribute('role','status');status.id=prefix+'Status';dialog.querySelector('.sheet-body').append(status);
  close.onclick=()=>cancel(kind);dialog.addEventListener('cancel',e=>{e.preventDefault();cancel(kind);});
  dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const b=dialog.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)cancel(kind);});
  dialog.addEventListener('close',()=>{if(dialog.open)return;const r=sheets[kind]?.active;if(r&&!r.launched&&pending[kind]===r){pending[kind]=null;r.cleanup?.();}if(r?.source?.isConnected&&(!r.parent||r.parent.open))r.source.focus({preventScroll:true});});
  return sheets[kind]={dialog,list,remember,note,status,prefix,active:null};
 }
 function createRequest(kind,value,options={}){
  const source=options.source||doc.activeElement,parent=source?.closest?.('dialog')||null;
  const r={kind,value,source,parent,onStatus:options.onStatus,isCurrent:options.isCurrent||(()=>!source||source===doc.body||source.isConnected),launched:false};
  if((parent&&!parent.open)||!r.isCurrent())return null;cancel(kind);
  if(parent){const close=()=>{if(!parent.open&&pending[kind]===r)cancel(kind);};parent.addEventListener('close',close);r.cleanup=()=>parent.removeEventListener('close',close);}
  pending[kind]=r;return r;
 }
 function showChoices(r,{recovery=false}={}){
  if(!current(r))return;const s=sheet(r.kind),version=(r.choiceVersion||0)+1;r.choiceVersion=version;s.active=r;r.launched=false;s.list.replaceChildren();s.dialog.querySelector('[data-open-once]')?.remove();s.status.textContent=recovery?'カレンダーへ渡せませんでした。別の方法を選ぶか、予定ファイルを保存してください。':'';
  s.note.textContent=r.kind==='map'?r.value:'端末のカレンダーはAppleカレンダー・Outlookなどの共有・読み込み画面へ進みます。';
  s.remember.checked=!!get(r.kind);s.remember.disabled=recovery;
  for(const {id,label}of choices(r.kind)){const b=doc.createElement('button');b.type='button';b.className='fav-btn';b.textContent=label;b.dataset.externalApp=id;b.style.minHeight='44px';b.onclick=()=>{
   if(!current(r)||r.launched||r.choiceVersion!==version)return;
   if(!recovery&&(s.remember.checked||get(r.kind)!==null)&&!set(r.kind,s.remember.checked?id:null)){s.status.textContent='設定を保存できませんでした。次回のアプリを覚えずに、今回だけ開けます。';addOnce(s,r,id,version);return;}
   r.launched=true;s.dialog.close();launch(r,id);
  };s.list.append(b);}
  if(recovery){const b=doc.createElement('button');b.type='button';b.className='fav-btn';b.id='calendarFileSave';b.textContent='予定ファイルを保存';b.style.minHeight='44px';b.onclick=()=>{if(!current(r)||r.launched||r.choiceVersion!==version)return;r.launched=true;s.dialog.close();launch(r,'file');};s.list.append(b);}
  if(!s.dialog.open)show(s.dialog);else s.dialog.focus({preventScroll:true});
 }
 function addOnce(s,r,id,version){
  let b=s.dialog.querySelector('[data-open-once]');if(!b){b=doc.createElement('button');b.type='button';b.className='fav-btn';b.dataset.openOnce='';b.style.minHeight='44px';s.status.after(b);}
  b.textContent='今回だけ開く';b.onclick=()=>{if(!current(r)||r.launched||r.choiceVersion!==version)return;r.launched=true;s.dialog.close();b.remove();launch(r,id);};
 }
 function launch(r,id){
  // Keep URL opening in the user's click task; no await precedes this call.
  try{
   if(r.kind==='map'){launchUrl(mapApps[id].url(r.value));return;}
   if(id==='google'){launchUrl(AstroNotesPlan.google(r.value));notify(r,'開いたカレンダーで登録を確定してください。');return;}
   const file=new File([AstroNotesPlan.ics(r.value)],'AstroNotes_撮影予定.ics',{type:'text/calendar;charset=utf-8'});
   if(id==='file'||!canShareFile(file)){saveFile(file);notify(r,'予定ファイルを開いて、カレンダーに追加してください。');return;}
   const result=shareFile(file);notify(r,'共有先でカレンダーを選んでください。');
   Promise.resolve(result).then(()=>notify(r,'カレンダー側で登録を確定してください。'),error=>{if(!current(r))return;if(error?.name==='AbortError'){notify(r,'カレンダーへの受け渡しを取り消しました。');return;}showChoices(r,{recovery:true});});
  }catch(error){if(r.kind==='calendar'&&current(r))showChoices(r,{recovery:true});else notify(r,'地図アプリを開けませんでした。もう一度お試しください。');}
 }
 function requestMap(point,options={}){const value=coordinates(point),r=createRequest('map',value,options),id=accepted('map',options.app)?options.app:get('map');if(!r||!current(r))return;if(id&&!options.forceChoose){r.launched=true;launch(r,id);}else showChoices(r);}
 function requestCalendar(event,options={}){
  if(!event||typeof event.title!=='string'||!event.title.trim()||!Number.isFinite(event.start)||!Number.isFinite(event.end)||event.end<=event.start)throw Error('件名と日時を確認してください。');
  const r=createRequest('calendar',structuredClone(event),options),id=get('calendar');if(!r||!current(r))return;if(id){r.launched=true;launch(r,id);}else showChoices(r);
 }
 function settings(){
  const box=doc.createElement('section');box.id='externalAppSettings';const status=doc.createElement('p');status.className='tiny';status.id='externalAppSettingsStatus';status.setAttribute('role','status');
  const controls=[];
  for(const [kind,title]of [['calendar','カレンダー'],['map','地図']]){const row=doc.createElement('div');row.style.cssText='padding:16px 0';const label=doc.createElement('label');label.htmlFor='externalDefault'+(kind==='map'?'Map':'Calendar');label.textContent=title;const select=doc.createElement('select');select.id=label.htmlFor;select.className='fav-in';select.style.cssText='display:block;width:100%;min-height:44px;font-size:16px;margin-top:8px';select.add(new Option('毎回選ぶ',''));for(const {id,label}of choices(kind))select.add(new Option(label,id));select.value=get(kind)||'';select.onchange=()=>{if(set(kind,select.value||null))status.textContent='保存しました。';else{select.value=get(kind)||'';status.textContent='設定を保存できませんでした。端末の保存設定を確認してください。';}};row.append(label,select);box.append(row);controls.push({kind,select});}
  const note=doc.createElement('p');note.className='tiny';note.textContent='この端末で使うアプリを選べます。';box.append(note,status);
  const refresh=()=>{for(const {kind,select}of controls)select.value=get(kind)||'';};listeners.add(refresh);box.refresh=()=>{refresh();status.textContent='';};
  return box;
 }
 // Leaving a route invalidates even a chooser opened from a non-dialog scene.
 doc.defaultView?.addEventListener('popstate',()=>{cancel('map');cancel('calendar');});
 return {mapApps,choices,get,set,requestMap,requestCalendar,cancelCalendar:()=>cancel('calendar'),cancelMap:()=>cancel('map'),settings};
};
})();
