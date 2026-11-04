// Trial adapter: one existing place picker, no new page, no saved-place writes.
(()=>{
'use strict';
let dataPromise=null,run=0,section=null,condition='',watch=null;
const dataTag=new URL(document.currentScript.src,location.href).searchParams.get('v')||'0';
const dataHashes=/* BUILD_DATA_HASHES */{};
const readData=async name=>{const r=await fetch('data/'+name+'?v='+dataTag);if(!r.ok)throw Error('data');const bytes=await r.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==dataHashes[name])throw Error('data-version');return JSON.parse(new TextDecoder().decode(bytes));};
const stopWatch=()=>{if(watch!==null){clearInterval(watch);watch=null;}};
const loadData=()=>dataPromise||(dataPromise=readData('candidate-sidewalks.json').catch(e=>{dataPromise=null;throw e;}));
let modelPromise=null;
const loadModel=()=>modelPromise||(modelPromise=Promise.all(['candidate-buildings.json','candidate-terrain.json'].map(readData)).then(async([packed,dem])=>AstroNotesCandidateModel.create({align:AstroNotesAlign,shooting:AstroNotesShooting,bodies:AstroNotesBodies,index:await AstroNotesCandidateBuildings.decode(packed),mode:'model-los',terrain:await AstroNotesCandidateTerrain.decode(dem),surfaceAt:()=>({})})).catch(e=>{modelPromise=null;throw e;}));
const engine=AstroNotesCandidateDiscovery.create({loadData,diagnoseUnknown:true,
 // Real candidate astronomy and LOD1/2 faces are diagnostic; missing evidence stays unknown.
 evaluate:async(plan,p)=>plan.target.id==='skytree'&&['moon','sun'].includes(plan.body)?(await loadModel())(plan,p):({status:'unknown',recommend:false,reason:'unsupported-pilot-condition'})});
const context=s=>JSON.stringify([s.body,s.target,s.partId,s.limb,AstroNotesCandidateDiscovery.day(s.at),s.matchMode||'limb']);
function snapshot(){
 if(typeof SkyMapUI==='undefined'||typeof auth==='undefined'||!auth||typeof screenAllowed!=='function'||!screenAllowed('skymap')||!screenAllowed('framing'))return null;
 const s=SkyMapUI.selectionState();if(!s?.target||!Number.isFinite(s.at))return null;
 return {...s,owner:auth.loginId,expected:context(s),atmosphere:air()};
}
const air=()=>JSON.stringify([typeof aimAirSettings==='undefined'?'standard':aimAirSettings,globalThis.AstroNotesAtmosphere?.dataKey?.()??null]);
const key=p=>p?JSON.stringify([p.owner,p.expected,p.atmosphere]):'';
function current(token,p,node){const now=snapshot();return token===run&&node.isConnected&&document.getElementById('placeSheet')?.open&&!document.getElementById('recentCandidates')?.hidden&&key(now)===key(p);}
function mapAnchor(point){
 const data=AstroNotesCandidateDiscovery.mapLink(point,navigator.userAgent,navigator.maxTouchPoints||0);if(!data)return null;
 const link=document.createElement('a');link.className='fav-btn tiny';link.textContent='地図アプリで開く';link.href=data.href;link.setAttribute('aria-label','撮影地点 '+point.latitude.toFixed(5)+', '+point.longitude.toFixed(5)+' を地図アプリで開く');
 if(!data.native){link.target='_blank';link.rel='noopener';}
 if(data.choose)link.onclick=e=>{if(typeof openMapAppSheet==='function'){e.preventDefault();openMapAppSheet(point.latitude.toFixed(7)+', '+point.longitude.toFixed(7));}};
 return link;
}
function syncObserverMap(){
 const previous=document.getElementById('exploreExternalMap'),point=snapshot()?.observer,anchor=document.getElementById('skyMapObserverSummary');
 if(!anchor||!point){previous?.remove();return;}const next=mapAnchor(point);if(!next){previous?.remove();return;}
 if(previous?.href===next.href)return;previous?.remove();next.id='exploreExternalMap';anchor.after(next);
}
function mount(){
 syncObserverMap();
 const panel=document.getElementById('recentCandidates'),sheet=document.getElementById('placeSheet');
 if(!panel||!sheet?.open||panel.hidden||typeof placeSheetFor==='undefined'||placeSheetFor!=='skymap'){
  if(section){stopWatch();run++;section.remove();section=null;condition='';}return;
 }
 const p=snapshot(),id=key(p);if(section?.isConnected&&condition===id)return;
 stopWatch();run++;section?.remove();condition=id;section=document.createElement('section');section.id='additionalCandidateSearch';section.setAttribute('aria-label','ほかの候補地点');
 const description=document.createElement('p');description.className='tiny';description.textContent='登録した撮影地点の候補は上に表示します。追加探索は月・太陽 × 東京スカイツリーに対応し、四ツ谷・スカイツリー周辺の一部歩道で試用しています。選んだ日の0〜24時（日本時間）を調べます。';
 const scope=document.createElement('p');scope.className='tiny';scope.textContent='地形・建物モデルに基づく候補です。樹木などは未考慮で、現地の見え方を保証するものではありません。';
 const status=document.createElement('div');status.className='tiny';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 let waitMessage=null;
 const setStatus=(message,waiting=false)=>{status.className=waiting?'note-wait candidate-wait':'tiny';status.replaceChildren();waitMessage=null;if(waiting){const character=document.createElement('span');character.className='note-wait-character';character.setAttribute('aria-hidden','true');waitMessage=document.createElement('span');waitMessage.className='note-wait-message';waitMessage.textContent=message;status.append(character,waitMessage);}else status.textContent=message;};
 const button=document.createElement('button');button.type='button';button.className='fav-btn';button.textContent='ほかの候補地点を探す';
 const cancel=document.createElement('button');cancel.type='button';cancel.className='fav-btn';cancel.textContent='探索を中止';cancel.hidden=true;
 const resultList=document.createElement('div');resultList.id='additionalCandidateResults';
 const evidence=document.createElement('details'),summary=document.createElement('summary'),source=document.createElement('p'),link=document.createElement('a');
 summary.textContent='探索範囲・出典';source.className='tiny';source.textContent='四ツ谷とスカイツリー周辺の歩道で試用しています。出典：PLATEAU 2025（17メッシュのLOD1/2建物と2メッシュの歩道を加工）。モデルの範囲や立つ高さが不明な地点は候補に含めません。 ';
 link.href='https://www.mlit.go.jp/plateau/site-policy/';link.target='_blank';link.rel='noopener';link.textContent='利用条件';source.append(link);const tokyo=document.createElement('a');tokyo.href='https://catalog.data.metro.tokyo.lg.jp/dataset/t000029d0000000024';tokyo.target='_blank';tokyo.rel='noopener';tokyo.textContent='東京都の出典';const license=document.createElement('a');license.href='https://creativecommons.org/licenses/by/4.0/deed.ja';license.target='_blank';license.rel='noopener';license.textContent='CC BY 4.0';const gsi=document.createElement('a');gsi.href='https://maps.gsi.go.jp/development/demtile.html';gsi.target='_blank';gsi.rel='noopener';gsi.textContent='国土地理院 標高タイル（加工）';source.append(' ／ ',tokyo,'・',license,' ／ ',gsi,'。地形は5m由来を優先し、欠測部は10m由来で代替しています。地面から1.5mを仮定し、撮影地点から対象までの天体中心・上下点を調べます。橋・高架など立面が不明な地点は出しません。樹木・建物以外の構造物・細い遮蔽物・対象より奥の遮蔽や現地の変化は未考慮です。');evidence.append(summary,source);
 section.append(description,scope,button,cancel,status,resultList,evidence);panel.append(section);
 const supported=p&&p.target.id==='skytree'&&['moon','sun'].includes(p.body);button.disabled=!supported;status.textContent=!p?'天体・対象・日付を選んでください。':!supported?'追加探索は月または太陽と東京スカイツリーの条件で試用できます。':'';
 cancel.onclick=()=>{stopWatch();run++;button.disabled=false;cancel.hidden=true;resultList.setAttribute('aria-busy','false');setStatus('探索を中止しました。');};
 button.onclick=async()=>{
  const selected=snapshot();if(!selected){mount();return;}
  if(condition!==key(selected)){mount();section?.querySelector('button')?.click();return;}
  const node=section,token=++run;stopWatch();watch=setInterval(()=>{if(!current(token,selected,node)){stopWatch();mount();}},250);button.disabled=true;cancel.hidden=false;resultList.replaceChildren();resultList.setAttribute('aria-busy','true');setStatus('ほかの候補地点を確認しています…',true);status.scrollIntoView({block:'nearest'});
  try{
   const result=await engine.search(selected,{isCurrent:()=>current(token,selected,node),onProgress:counts=>{if(current(token,selected,node))if(waitMessage)waitMessage.textContent='天体の重なりと見通しを確認しています… '+counts.checked+'地点を確認';},atmosphere:selected.atmosphere});
   if(!current(token,selected,node)||result.cancelled)return;
   for(const row of result.rows){
    const item=document.createElement('button');item.type='button';item.className='list-item';item.dataset.modelBasis=row.modelEvidence?.kind||'unknown';item.textContent=row.place.name+' '+new Date(row.event.at+32400000).toISOString().slice(11,16)+(row.event.at<Date.now()?'（過ぎた時刻）':'');
    item.onclick=()=>{if(current(token,selected,node)&&SkyMapUI.selectCandidate(row,selected.expected))sheet.close();};const rowBox=document.createElement('div');rowBox.append(item);const map=mapAnchor(row.place);if(map)rowBox.append(map);resultList.append(rowBox);
   }
   setStatus('');resultList.setAttribute('aria-busy','false');status.textContent=result.rows.length?result.rows.length+'件のモデル上の候補があります。':'この条件で、地形・建物モデル上の見通しを確認できた候補はありません。';
   if(result.counts.unknown)status.textContent+=' 範囲外や高さ不明など、判定できない地点は含めていません。';
   if(result.counts.deferred)status.textContent+=' 先絞りで詳細計算していない地点があります。';
   if(result.limited)status.textContent+=' 調べ切れていない範囲があります。';
  }catch{if(current(token,selected,node)){resultList.setAttribute('aria-busy','false');setStatus('候補の情報を読み込めませんでした。もう一度お試しください。');}}
  finally{if(token===run){stopWatch();if(!current(token,selected,node))mount();}if(current(token,selected,node)){button.disabled=false;cancel.hidden=true;}}
 };
}
// Observe only the picker so progress and map rendering cannot create a busy loop.
const picker=document.getElementById('placeSheet');if(picker){new MutationObserver(mount).observe(picker,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','aria-selected']});picker.addEventListener('close',()=>{stopWatch();run++;section?.remove();section=null;condition='';});}
mount();
})();
