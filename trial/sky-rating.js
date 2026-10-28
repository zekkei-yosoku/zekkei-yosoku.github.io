/* Sky colour rating: the server assigns 10 photos; answers are sent only by the signed-in owner pressing submit. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const API=location.hostname==='localhost'||location.hostname==='127.0.0.1'?'http://localhost:8787':'https://zekkei-api.okayu-sorami.workers.dev';
const TOKEN_KEY='sorami.token',LOGIN_KEY='astronotes.rating.login',RETURN_KEY='astronotes.rating.return',LEGACY_KEY='astronotes.trial.sky-ratings.v1';
const DRAFT_PREFIX='astronotes.sky-ratings.v2:',VERSION='sky-rating/2',SET='sky-rating-v1',SCALE='sky-colour-strength/1',CATALOG='sky-rating-ui/1';
let catalog=null,account=null,draft=null,server=null,serverState='idle',orphan=false,unreadable=false,sending=false;
let index=0,locked=false,imageReady=false,imageEpoch=0,loadFailed=false,readyAfter=0;

const draftKey=()=>DRAFT_PREFIX+encodeURIComponent(account.loginId);
const answered=d=>d.order.filter(id=>Object.hasOwn(d.answers,id)).length;
const setStatus=(id,message,error=false)=>{$(id).textContent=message;$(id).dataset.error=String(error);};
// The wire form and its fingerprint match the server's canonical answers (same order, 0-4 or a skip reason).
const wire=d=>Object.fromEntries(d.order.map(id=>{const a=d.answers[id];return[id,a.value==='skip'?(a.reason==='image_unavailable'?'image_unavailable':'unsure'):a.value];}));
const fingerprint=(order,answers)=>JSON.stringify(order.map(id=>answers[id]));
const sent=()=>!!(draft&&server?.submission&&server.assignment?.id===draft.assignmentId&&answered(draft)===10&&fingerprint(draft.order,server.submission.answers)===fingerprint(draft.order,wire(draft)));

// Same storage order as the main page: a remembered login first, then this tab's login.
function storedAuth(){for(const box of['localStorage','sessionStorage']){try{const raw=window[box].getItem(TOKEN_KEY);if(!raw)continue;const a=JSON.parse(raw);if(a&&typeof a.token==='string'&&typeof a.loginId==='string'&&a.loginId)return{token:a.token,loginId:a.loginId};}catch{}}return null;}
async function api(method,path,body){
 const token=account?.token;let res;
 try{res=await fetch(API+path,{method,headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}
 catch{const e=Error('通信できませんでした。電波の状態を確かめて、もう一度お試しください。');e.network=true;throw e;}
 let data=null;try{data=await res.json();}catch{}
 if(!res.ok){const e=Error(data?.error||`通信できませんでした（${res.status}）`);e.status=res.status;e.code=data?.code;throw e;}
 if(account?.token!==token)throw Error('アカウントが変更されました。ページを読み込み直してください。');
 return data;
}

function persist(next){
 try{localStorage.setItem(draftKey(),JSON.stringify(next));draft=next;return true;}
 catch{setStatus('saveStatus','端末に保存できませんでした。回答は進めていません。空き容量やブラウザの設定を確認して、もう一度お試しください。',true);setStatus('introStatus','この端末に保存できません。ブラウザの設定や空き容量を確認してください。',true);return false;}
}
function valid(d){return d&&d.version===VERSION&&d.set===SET&&d.scale===SCALE&&d.owner===account.loginId&&typeof d.assignmentId==='string'&&d.assignmentId&&Array.isArray(d.order)&&d.order.length===10&&new Set(d.order).size===10&&d.order.every(id=>catalog.items.some(p=>p.id===id))&&d.answers&&typeof d.answers==='object'&&!Array.isArray(d.answers)&&Object.entries(d.answers).every(([id,a])=>d.order.includes(id)&&a&&[0,1,2,3,4,'skip'].includes(a.value)&&Number.isFinite(a.at))&&Number.isInteger(d.cursor)&&d.cursor>=0&&d.cursor<=10;}
function fromServer(view){
 const answers={};
 for(const [id,v]of Object.entries(view.submission?.answers||{}))answers[id]=typeof v==='number'?{value:v,at:view.submission.updatedAt}:{value:'skip',at:view.submission.updatedAt,...(v==='image_unavailable'?{reason:v}:{})};
 const order=view.assignment.items;
 return{version:VERSION,set:SET,scale:SCALE,owner:account.loginId,assignmentId:view.assignment.id,order,answers,cursor:Object.keys(answers).length===10?10:0};
}
function panels(which){for(const id of['intro','review','finish'])$(id).hidden=id!==which;}

function syncIntro(){
 $('loadRetry').hidden=!(serverState==='error'||!catalog);
 if(!catalog||unreadable){$('start').disabled=true;return;}
 if(!account){$('accountLine').textContent='評価を始めるには、ログインが必要です。回答はログインしたアカウントで送信します。';$('start').disabled=false;$('start').textContent='ログインして始める';return;}
 $('accountLine').textContent=`ログイン中：${account.loginId}`;
 if(serverState==='loading'){$('start').disabled=true;$('start').textContent='回答の状態を確認しています…';return;}
 const n=draft&&!orphan?answered(draft):0;
 if(serverState==='error'&&(!draft||orphan)){$('start').disabled=true;$('start').textContent='評価を始められません';return;}
 $('start').disabled=false;
 $('start').textContent=n===10?(sent()?'送信した回答を見る':'回答を確認して送信する'):n?'続きから評価する':'10枚の評価を始める';
 if(orphan)setStatus('introStatus','この端末の回答は、取り下げなどにより送信できなくなりました。始めると新しい10枚になります。');
 else if(draft&&n)setStatus('introStatus',n===10?(sent()?'10枚の回答を送信済みです。':'10枚の回答はまだ送信していません。'):`${n} / 10枚を確認済みです（未送信）。`);
}
function syncManage(){
 const has=!!server?.assignment;
 $('reviewBox').hidden=!account||!draft||orphan||unreadable||serverState==='loading'||!answered(draft);
 $('sentText').textContent=!account?'ログインすると、送信した回答を確認・取り下げできます。':serverState==='error'?'送信した回答の状態を確認できませんでした。':server?.submission?`送信した回答：${new Date(server.submission.updatedAt).toLocaleString('ja-JP')}に受け付け済み。`:has?'送信した回答はまだありません（写真10枚の割当だけがあります）。':'送信した回答はありません。';
 $('withdrawOpen').hidden=!account||!has;
 $('draftBox').hidden=!account;
 let legacy=false;try{legacy=!!localStorage.getItem(LEGACY_KEY);}catch{}
 $('legacyBox').hidden=!legacy;$('legacyNote').hidden=!legacy;
}
const resend=()=>!!(server?.submission&&server.assignment?.id===draft.assignmentId);
// Buttons follow the state; the message is only replaced on success so a failure reason stays visible.
function syncFinish(){
 const n=Object.values(draft.answers).filter(a=>a.value!=='skip').length,done=sent();
 $('finishCounts').textContent=`評価した写真 ${n}枚 · スキップ ${10-n}枚`;
 $('submit').hidden=done;$('submit').disabled=sending;
 $('submit').textContent=sending?'送信しています…':resend()?'変更を送信する':'回答を送信する';
 $('finishBack').classList.toggle('primary',done);
 if(done)setStatus('sendState',`送信しました（${new Date(server.submission.updatedAt).toLocaleString('ja-JP')}に受け付け）。`);
}
function render(){syncIntro();syncManage();}

async function load(){
 setStatus('introStatus','');$('start').disabled=true;
 try{
  const res=await fetch('data/sky-rating-v1/catalog.json',{cache:'no-cache'});if(!res.ok)throw Error('catalog');
  catalog=await res.json();
  if(catalog.version!==CATALOG||!Array.isArray(catalog.items)||catalog.items.length<11||!['sky-01','sky-02','sky-18'].every(id=>catalog.items.some(p=>p.id===id))||new Set(catalog.items.map(p=>p.id)).size!==catalog.items.length||!catalog.items.every(p=>/^sky-\d{2}$/.test(p.id)&&p.src===`data/sky-rating-v1/${p.id}.jpg`&&/^https:\/\/www\.sizenken\.biodic\.go\.jp\/view_hour\.php\?no=\d+$/.test(p.source)))throw Error('catalog');
 }catch{catalog=null;$('start').textContent='写真を準備できませんでした';setStatus('introStatus','写真一覧を読み込めませんでした。接続を確認して、もう一度お試しください。',true);render();return;}
 await refreshAccount();
}
// Reads this account's draft and reconciles it with the server; never sends anything by itself.
async function refreshAccount(){
 imageEpoch++;account=storedAuth();draft=null;server=null;orphan=false;unreadable=false;serverState='idle';
 if(!account){render();return;}
 try{const raw=localStorage.getItem(draftKey());if(raw){const parsed=JSON.parse(raw);if(!valid(parsed))throw Error('saved');draft=parsed;}}
 catch{unreadable=true;setStatus('introStatus','この端末の保存領域を読み込めません。「回答の管理」から控えを保存するか、この端末の回答を消して始め直してください。',true);render();return;}
 serverState='loading';render();
 const loginId=account.loginId;
 try{
  const view=await api('GET','/ratings/sky');if(account?.loginId!==loginId)return;
  if(view.setVersion!==SET||view.scale!==SCALE)throw Error('この画面は古い版です。ページを読み込み直してください。');
  server=view;serverState='ready';
  if(view.assignment&&!view.assignment.items.every(id=>catalog.items.some(p=>p.id===id)))throw Error('写真の一覧が古い版です。ページを読み込み直してください。');
  if(draft&&draft.assignmentId!==view.assignment?.id)orphan=true;
  else if(!draft&&view.assignment&&!persist(fromServer(view)))return;
  setStatus('introStatus','');
 }catch(e){
  if(account?.loginId!==loginId)return;
  serverState='error';
  if(e.status===401){account=null;setStatus('introStatus','ログインの有効期限が切れました。ログインし直すと、この端末の回答から続けられます。',true);}
  else setStatus('introStatus',(e.network?'通信できませんでした。':e.message+' ')+(draft?'保存済みの回答で評価は続けられます。送信は通信が戻ってから行えます。':'接続を確認して、もう一度お試しください。'),true);
 }
 render();
}

function showPhoto(focusChoices=false){
 panels('review');locked=true;imageReady=false;loadFailed=false;readyAfter=performance.now()+250;
 const epoch=++imageEpoch,entry=catalog.items.find(p=>p.id===draft.order[index]),a=draft.answers[entry.id];
 $('progressText').textContent=`${index+1} / 10枚 · 確認済み ${answered(draft)}枚`;$('progress').value=answered(draft);
 $('previous').disabled=index===0;$('nextExisting').hidden=!a;
 $('skip').textContent=a&&a.value!=='skip'?'判断できないに変更':'判断できない・スキップ';
 $('photoState').hidden=false;$('photoState').textContent='写真を読み込んでいます…';
 $('choices').disabled=true;$('enlarge').disabled=true;$('imageRetry').hidden=true;setStatus('saveStatus','');
 $('photoSource').href=entry.source;
 for(const b of document.querySelectorAll('[data-value]'))b.setAttribute('aria-pressed',String(a?.value===Number(b.dataset.value)));
 const fresh=$('photo').cloneNode(false);fresh.removeAttribute('src');$('photo').replaceWith(fresh);
 $('photo').onload=()=>{if(epoch!==imageEpoch)return;imageReady=true;loadFailed=false;readyAfter=performance.now()+250;$('photoState').hidden=true;$('enlarge').disabled=false;
  setTimeout(()=>{if(epoch===imageEpoch){locked=false;$('choices').disabled=false;if(focusChoices)$('choices').querySelector('button').focus();}},250);};
 $('photo').onerror=()=>{if(epoch!==imageEpoch)return;locked=false;loadFailed=true;$('photoState').textContent='写真を読み込めませんでした。再読み込みするか、スキップできます。';$('imageRetry').hidden=false;};
 $('photo').src=entry.src;$('skip').disabled=true;
 setTimeout(()=>{if(epoch===imageEpoch){locked=false;$('skip').disabled=false;}},250);
 setTimeout(()=>{if(epoch!==imageEpoch||imageReady||loadFailed)return;locked=false;loadFailed=true;$('photoState').textContent='写真の読み込みに時間がかかっています。再読み込みするか、スキップできます。';$('imageRetry').hidden=false;},12000);
}
function complete(){imageEpoch++;panels('finish');$('loginAgain').hidden=true;
 setStatus('sendState',resend()?'送信済みの回答から変更があります。まだ送信していません。':'まだ送信していません。回答はこの端末に保存されています。');
 syncFinish();$('finishTitle').focus();}
function nextOrComplete(focus){
 if(index===9){if(answered(draft)===10)complete();else{index=draft.order.findIndex(id=>!Object.hasOwn(draft.answers,id));showPhoto();}}
 else{index++;showPhoto(focus);}
}
function answer(value,keyboard=false){
 if(locked||performance.now()<readyAfter||(!imageReady&&value!=='skip'))return;
 const id=draft.order[index],next=structuredClone(draft);
 next.answers[id]={value,at:Date.now(),...(value==='skip'&&loadFailed?{reason:'image_unavailable'}:{})};
 next.cursor=index+1;
 if(!persist(next))return;
 locked=true;nextOrComplete(keyboard);
}
function goLogin(){try{sessionStorage.setItem(LOGIN_KEY,'1');}catch{}location.href='./';}

async function submit(){
 if(sending||!draft||answered(draft)!==10)return;
 const current=storedAuth();
 if(!current||!account){$('loginAgain').hidden=false;setStatus('sendState','ログインが切れています。ログインし直してから送信してください。回答はこの端末に残っています。',true);return;}
 if(current.loginId!==draft.owner||current.loginId!==account.loginId){setStatus('sendState',`この回答は ${draft.owner} の回答です。いまは別のアカウントでログインしているため送信しません。`,true);return;}
 const payload=wire(draft),payloadPrint=fingerprint(draft.order,payload),assignmentId=draft.assignmentId;
 sending=true;setStatus('sendState','送信しています…');syncFinish();
 try{
  const res=await api('POST','/ratings/sky/submit',{assignmentId,answers:payload});
  if(res.assignment?.id!==assignmentId||!res.submission||fingerprint(draft.order,res.submission.answers)!==payloadPrint)throw Error('送信した内容を確認できませんでした。もう一度送信してください。');
  server={...server,assignment:res.assignment,submission:res.submission};serverState='ready';
  if(fingerprint(draft.order,wire(draft))!==payloadPrint)setStatus('sendState','送信中に回答が変わりました。変更を送信してください。',true);
 }catch(e){
  const tail='回答は未送信のまま、この端末に残っています。';
  if(e.status===401){account=null;$('loginAgain').hidden=false;setStatus('sendState','ログインの有効期限が切れました。ログインし直してから送信してください。'+tail,true);}
  else if(e.code==='assignment_missing'){orphan=true;setStatus('sendState','この回答の割当が見つかりません（取り下げ済みなど）。この回答は送信できません。',true);}
  else setStatus('sendState',(e.network?'通信できませんでした。':e.message+' ')+tail+(e.network||e.status>=500||e.status===429?'もう一度送信してください。':''),true);
 }finally{sending=false;syncFinish();render();}
}

$('start').onclick=async()=>{
 if(!catalog||unreadable)return;
 if(!account){goLogin();return;}
 if(!draft||orphan){
  $('start').disabled=true;$('start').textContent='写真を割り当てています…';
  try{const view=await api('POST','/ratings/sky/assignment');server=view;serverState='ready';orphan=false;if(!persist(fromServer(view))){render();return;}}
  catch(e){if(e.status===401)account=null;setStatus('introStatus',e.status===401?'ログインの有効期限が切れました。ログインし直してください。':e.message,true);render();return;}
 }
 if(answered(draft)===10){complete();return;}
 index=Math.min(draft.cursor,9);
 if(Object.hasOwn(draft.answers,draft.order[index]))index=draft.order.findIndex(id=>!Object.hasOwn(draft.answers,id));
 showPhoto();$('reviewTitle').focus();
};
for(const b of document.querySelectorAll('[data-value]'))b.onclick=e=>answer(Number(b.dataset.value),e.detail===0);
$('skip').onclick=e=>{if(!locked)answer('skip',e.detail===0);};
$('nextExisting').onclick=e=>{if(Object.hasOwn(draft.answers,draft.order[index]))nextOrComplete(e.detail===0);};
$('previous').onclick=()=>{if(index===0)return;index--;showPhoto();$('reviewTitle').focus();};
$('pause').onclick=()=>{imageEpoch++;panels('intro');render();if(answered(draft)<10)setStatus('introStatus',`${answered(draft)} / 10枚をこの端末に保存しました（未送信）。いつでも再開できます。`);$('start').focus();};
// Corrections after the finish screen start from the first photo of this account's own answers.
$('reviewOpen').onclick=()=>{if(sending||!account||!draft||orphan||unreadable||!answered(draft))return;$('manage').open=false;index=0;showPhoto();$('reviewTitle').focus();};
$('submit').onclick=()=>submit();
$('loginAgain').onclick=()=>goLogin();
$('imageRetry').onclick=()=>showPhoto();
$('loadRetry').onclick=()=>catalog?refreshAccount():load();
$('enlarge').onclick=()=>{if(!imageReady)return;$('zoomPhoto').src=$('photo').src;$('zoom').showModal();};
$('zoomClose').onclick=()=>$('zoom').close();

function download(raw,name){const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('download').onclick=()=>{try{const raw=account&&localStorage.getItem(draftKey());if(!raw){setStatus('dataStatus','保存した回答はまだありません。');return;}download(raw,'AstroNotes-写真評価の控え.json');setStatus('dataStatus','回答の控えのダウンロードを開始しました。');}catch{setStatus('dataStatus','回答の控えを保存できませんでした。',true);}};
const confirmPair=(open,box,cancel)=>{$(open).onclick=()=>{$(box).hidden=false;$(cancel).focus();};$(cancel).onclick=()=>{$(box).hidden=true;$(open).focus();};};
confirmPair('clearOpen','clearConfirm','clearCancel');confirmPair('withdrawOpen','withdrawConfirm','withdrawCancel');confirmPair('legacyClearOpen','legacyConfirm','legacyCancel');
$('clear').onclick=async()=>{try{localStorage.removeItem(draftKey());}catch{setStatus('dataStatus','回答を消せませんでした。ブラウザの設定を確認してください。',true);return;}
 $('clearConfirm').hidden=true;panels('intro');await refreshAccount();setStatus('dataStatus','この端末の回答を消しました。');$('start').focus();};
$('withdraw').onclick=async()=>{
 const button=$('withdraw');if(button.disabled)return;button.disabled=true;setStatus('dataStatus','取り下げています…');
 try{await api('DELETE','/ratings/sky');}
 catch(e){button.disabled=false;if(e.status===401)account=null;setStatus('dataStatus',(e.status===401?'ログインし直してから取り下げてください。':e.message)+' 送信した回答はまだ残っています。',true);render();return;}
 button.disabled=false;$('withdrawConfirm').hidden=true;
 try{localStorage.removeItem(draftKey());}catch{}
 panels('intro');await refreshAccount();setStatus('dataStatus','送信した回答を取り下げました。');$('start').focus();
};
$('legacyDownload').onclick=()=>{try{const raw=localStorage.getItem(LEGACY_KEY);if(raw){download(raw,'AstroNotes-写真評価の控え_以前の試用版.json');setStatus('dataStatus','以前の回答の控えのダウンロードを開始しました。');}}catch{setStatus('dataStatus','控えを保存できませんでした。',true);}};
$('legacyClear').onclick=()=>{try{localStorage.removeItem(LEGACY_KEY);}catch{setStatus('dataStatus','以前の回答を消せませんでした。',true);return;}$('legacyConfirm').hidden=true;syncManage();setStatus('dataStatus','以前の試用版の回答を消しました。');};

// Back returns to the page in this app that opened the rating (root or trial), never elsewhere.
const base=location.pathname.replace(/[^/]*$/,'');
try{const previous=sessionStorage.getItem(RETURN_KEY);if(previous&&previous.startsWith(base)&&/^(?:index\.html)?(?:#\/[A-Za-z0-9/_-]*)?$/.test(previous.slice(base.length))){$('back').href=previous;$('finishBack').href=previous;}}catch{}
$('back').onclick=e=>{try{const r=new URL(document.referrer);if(r.origin===location.origin&&(r.pathname===base||r.pathname===base+'index.html')&&history.length>1){e.preventDefault();history.back();}}catch{}};

document.addEventListener('touchstart',e=>{if(e.touches.length>1)e.preventDefault();},{passive:false});
document.addEventListener('gesturestart',e=>e.preventDefault(),{passive:false});
window.addEventListener('storage',e=>{
 if(e.key===TOKEN_KEY||e.key===null){if(storedAuth()?.loginId!==account?.loginId||!storedAuth()){panels('intro');setStatus('introStatus','');void refreshAccount();}return;}
 if(!account||e.key!==draftKey())return;
 imageEpoch++;draft=null;unreadable=true;panels('intro');$('start').disabled=true;syncManage();
 setStatus('introStatus','別のタブで回答が変更されました。上書きを防ぐため、このページを再読み込みしてください。',true);
});
document.addEventListener('keydown',e=>{if(e.repeat&&['Enter',' '].includes(e.key)&&e.target.closest('button'))e.preventDefault();});
load();
})();
