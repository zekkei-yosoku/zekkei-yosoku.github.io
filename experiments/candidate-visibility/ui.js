// Trial adapter: one existing place picker, no new page, no saved-place writes.
(()=>{
'use strict';
let dataPromise=null,run=0,section=null,condition='',watch=null;
const dataTag=new URL(document.currentScript.src,location.href).searchParams.get('v')||'0';
const dataHashes=/* BUILD_DATA_HASHES */{};
const readData=async(name,{signal}={})=>{const r=await fetch('data/'+name+'?v='+dataTag,{signal});if(!r.ok)throw Error('data');const bytes=await r.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==dataHashes[name])throw Error('data-version');return JSON.parse(new TextDecoder().decode(bytes));};
const labelPromises={};
function loadLabel(name){if(!labelPromises[name]){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);labelPromises[name]=readData(name,{signal:controller.signal}).catch(()=>{delete labelPromises[name];return null;}).finally(()=>clearTimeout(timer));}return labelPromises[name];}
const loadLabels=async()=>{const [addresses,facilities]=await Promise.all(['candidate-label-addresses.json','candidate-label-facilities.json'].map(loadLabel));return {addresses,facilities};};
AstroNotesCandidatePicker.configure(loadLabels);
const stopWatch=()=>{if(watch!==null){clearInterval(watch);watch=null;}};
const loadData=()=>dataPromise||(dataPromise=readData('candidate-sidewalks.json').catch(e=>{dataPromise=null;throw e;}));
let modelPromise=null;
const loadModel=()=>modelPromise||(modelPromise=Promise.all(['candidate-buildings.json','candidate-terrain.json'].map(readData)).then(async([packed,dem])=>{await AstroNotesAssets.ensureModels();return AstroNotesCandidateModel.create({align:AstroNotesAlign,shooting:AstroNotesShooting,bodies:AstroNotesBodies,index:await AstroNotesCandidateBuildings.decode(packed),mode:'model-los',terrain:await AstroNotesCandidateTerrain.decode(dem),surfaceAt:()=>({}),sidewalks:await loadData()});}).catch(e=>{modelPromise=null;throw e;}));
const engine=AstroNotesCandidateDiscovery.create({loadData,diagnoseUnknown:true,
 // Real candidate astronomy and LOD1/2 faces are diagnostic; missing evidence stays unknown.
 evaluate:async(plan,p)=>plan.target.id==='skytree'&&['moon','sun'].includes(plan.body)?(await loadModel())(plan,p):({status:'unknown',recommend:false,reason:'unsupported-pilot-condition'})});
const context=s=>JSON.stringify([s.body,s.target,s.partId,s.limb,AstroNotesCandidateDiscovery.day(s.at),s.matchMode||'limb']);
function snapshot(){
 if(typeof SkyMapUI==='undefined'||typeof auth==='undefined'||!auth||typeof screenAllowed!=='function'||!screenAllowed('skymap')||!screenAllowed('framing'))return null;
 const s=SkyMapUI.selectionState();if(!s?.target||!Number.isFinite(s.at))return null;
 return {...s,owner:auth.loginId,expected:context(s),atmosphere:air(),...(globalThis.AstroNotesTrialComposition?.plan(s)||{})};
}
const air=()=>JSON.stringify([typeof aimAirSettings==='undefined'?'standard':aimAirSettings,globalThis.AstroNotesAtmosphere?.dataKey?.()??null]);
const key=p=>p?JSON.stringify([p.owner,p.expected,p.atmosphere,p.composition,p.timeWindow,p.compositionInvalid]):'';
function current(token,p,node){const now=snapshot();return token===run&&node.isConnected&&document.getElementById('placeSheet')?.open&&!document.getElementById('recentCandidates')?.hidden&&key(now)===key(p);}
function mapAnchor(point){
 const data=AstroNotesCandidateDiscovery.mapLink(point,navigator.userAgent,navigator.maxTouchPoints||0);if(!data)return null;
 const link=document.createElement('a');link.className='fav-btn tiny';link.textContent='地図アプリで開く';link.href=data.href;link.setAttribute('aria-label','撮影地点 '+point.latitude.toFixed(5)+', '+point.longitude.toFixed(5)+' を地図アプリで開く');
 if(!data.native){link.target='_blank';link.rel='noopener';}
 if(data.choose)link.onclick=e=>{if(typeof openMapAppSheet==='function'){e.preventDefault();openMapAppSheet(point.latitude.toFixed(7)+', '+point.longitude.toFixed(7));}};
 return link;
}
function syncObserverMap(){
 const previous=document.getElementById('exploreExternalMap'),point=snapshot()?.observer,anchor=document.querySelector('#exploreScenePanel #aimLook .aim-look-figure');
 if(!anchor||!point){previous?.remove();return;}const next=mapAnchor(point);if(!next){previous?.remove();return;}
 if(previous?.href===next.href)return;previous?.remove();next.id='exploreExternalMap';next.className='chip tiny';anchor.before(next);
}
function mount(){
 syncObserverMap();
 const panel=document.getElementById('recentCandidates'),sheet=document.getElementById('placeSheet');
 if(!panel||!sheet?.open||panel.hidden||typeof placeSheetFor==='undefined'||placeSheetFor!=='skymap'){
  if(section){stopWatch();run++;section.remove();section=null;condition='';}return;
 }
 const p=snapshot(),id=key(p);if(p)AstroNotesCandidatePicker.mount(panel,p);if(section?.isConnected&&condition===id)return;
 stopWatch();run++;section?.remove();condition=id;section=document.createElement('section');section.id='additionalCandidateSearch';section.setAttribute('aria-label','ほかの候補地点');
 const description=document.createElement('p');description.className='tiny';description.textContent='登録した撮影地点の候補は上に表示します。追加探索は月・太陽 × 東京スカイツリーに対応し、四ツ谷・スカイツリー周辺の一部歩道で試用しています。選んだ日の0〜24時（日本時間）を調べます。';
 const scope=document.createElement('p');scope.className='tiny';scope.textContent='追加探索は昼間の月も含みます。撮影地点から対象までの地形・建物モデルに基づく候補です。対象より遠方の遮蔽や樹木などは未判定です。現地の見え方を保証するものではありません。';
 const status=document.createElement('div');status.className='tiny';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 let waitMessage=null;
 const setStatus=(message,waiting=false)=>{status.className=waiting?'note-wait candidate-wait':'tiny';status.replaceChildren();waitMessage=null;if(waiting){const character=document.createElement('span');character.className='note-wait-character';character.setAttribute('aria-hidden','true');waitMessage=document.createElement('span');waitMessage.className='note-wait-message';waitMessage.textContent=message;status.append(character,waitMessage);}else status.textContent=message;};
 const button=document.createElement('button');button.type='button';button.className='fav-btn';button.textContent='ほかの候補地点を探す';
 const cancel=document.createElement('button');cancel.type='button';cancel.className='fav-btn';cancel.textContent='探索を中止';cancel.hidden=true;
 const resultList=document.createElement('div');resultList.id='additionalCandidateResults';
 const evidence=document.createElement('details'),summary=document.createElement('summary'),source=document.createElement('p'),link=document.createElement('a');
 summary.textContent='探索範囲・出典';source.className='tiny';source.textContent='四ツ谷とスカイツリー周辺の歩道で試用しています。出典：PLATEAU 2025（17メッシュのLOD1/2建物と2メッシュの歩道を加工）。モデルの範囲や立つ高さが不明な地点は候補に含めません。 ';
 link.href='https://www.mlit.go.jp/plateau/site-policy/';link.target='_blank';link.rel='noopener';link.textContent='利用条件';source.append(link);const tokyo=document.createElement('a');tokyo.href='https://catalog.data.metro.tokyo.lg.jp/dataset/t000029d0000000024';tokyo.target='_blank';tokyo.rel='noopener';tokyo.textContent='東京都の出典';const license=document.createElement('a');license.href='https://creativecommons.org/licenses/by/4.0/deed.ja';license.target='_blank';license.rel='noopener';license.textContent='CC BY 4.0';const gsi=document.createElement('a');gsi.href='https://maps.gsi.go.jp/development/demtile.html';gsi.target='_blank';gsi.rel='noopener';gsi.textContent='国土地理院 標高タイル（加工）';source.append(' ／ ',tokyo,'・',license,' ／ ',gsi,'。地形は5m由来を優先し、欠測部は10m由来で代替しています。地面から1.5mを仮定し、撮影地点から対象までの天体中心・上下点と、対象自身に天体全体が隠れないかを調べます。対象自身の形状は指定点より奥まで確認します。橋・高架など立面が不明な地点は出しません。樹木・建物以外の構造物・細い遮蔽物・対象より奥の遮蔽や現地の変化は未考慮です。');evidence.append(summary,source);
 const labelScope=document.createElement('p');labelScope.className='tiny';labelScope.textContent='住所は2020年国勢調査の町丁目境界による目安で、番地は含みません。施設名は地図の区域内と確認できたものを表示します。施設の利用可否はご自身で確認してください。';
 const labelCredits=document.createElement('p');labelCredits.className='tiny';labelCredits.append('地名出典：');
 for(const [title,url] of [['国勢調査町丁・字等別境界データセット（CODH作成、e-Stat加工・CC BY 4.0）','https://geoshape.ex.nii.ac.jp/ka/resource/'],['© OpenStreetMap contributors（ODbL）','https://www.openstreetmap.org/copyright'],['施設区域データ（ODbL）','data/candidate-label-facilities.json?v='+dataTag]]){const a=document.createElement('a');a.textContent=title;a.href=url;a.target='_blank';a.rel='noopener';labelCredits.append(a,' ');}evidence.append(labelScope,labelCredits);
 const visibleCredits=document.createElement('p');visibleCredits.className='tiny';visibleCredits.hidden=true;
 for(const [title,url] of [['町丁目：CODH/e-Stat（2020）','https://geoshape.ex.nii.ac.jp/ka/resource/'],['© OpenStreetMap contributors','https://www.openstreetmap.org/copyright']]){const a=document.createElement('a');a.textContent=title;a.href=url;a.target='_blank';a.rel='noopener';visibleCredits.append(a,' ');}
 section.append(description,scope,button,cancel,status,visibleCredits,resultList,evidence);panel.append(section);
 const configValid=p&&!p.compositionInvalid&&AstroNotesCandidateComposition.windowValid(p.timeWindow)&&(!p.composition||AstroNotesCandidateComposition.valid(p.composition,p.target));
 const supported=p&&p.target.id==='skytree'&&['moon','sun'].includes(p.body)&&configValid;button.disabled=!supported;status.textContent=!p?'天体・対象・日付を選んでください。':!configValid?'見え方で指定した位置と、出入りの前後時間を確認してください。':!supported?'追加探索は月または太陽と東京スカイツリーの条件で試用できます。':'';
 cancel.onclick=()=>{stopWatch();run++;button.disabled=false;cancel.hidden=true;visibleCredits.hidden=true;resultList.setAttribute('aria-busy','false');setStatus('探索を中止しました。');};
 button.onclick=async()=>{
  const selected=snapshot();if(!selected){mount();return;}
  if(condition!==key(selected)){mount();section?.querySelector('button')?.click();return;}
  const node=section,token=++run;stopWatch();watch=setInterval(()=>{if(!current(token,selected,node)){stopWatch();mount();}},250);button.disabled=true;cancel.hidden=false;visibleCredits.hidden=true;resultList.replaceChildren();resultList.setAttribute('aria-busy','true');setStatus('ほかの候補地点を確認しています…',true);status.scrollIntoView({block:'nearest'});
  try{
   const result=await engine.search(selected,{isCurrent:()=>current(token,selected,node),onProgress:counts=>{if(current(token,selected,node))if(waitMessage)waitMessage.textContent='天体の重なりと見通しを確認しています… '+counts.checked+'地点を確認';},atmosphere:selected.atmosphere});
   if(!current(token,selected,node)||result.cancelled)return;
   let labels={};if(result.rows.length){setStatus('候補地点の住所・施設名を確認しています…',true);labels=await loadLabels();if(!current(token,selected,node))return;const date=labels.facilities?.dataDate,credit=visibleCredits.querySelector('a[href="https://www.openstreetmap.org/copyright"]');if(credit&&typeof date==='string'&&/^\d{4}-\d{2}-\d{2}/.test(date))credit.textContent='© OpenStreetMap contributors（'+date.slice(0,10)+'）';}
   const pickerRows=[];for(const raw of result.rows){
    const row=AstroNotesCandidateLabels.enrich(raw,labels),item=document.createElement('button');pickerRows.push(row);item.type='button';item.className='list-item';item.dataset.modelBasis=row.modelEvidence?.kind||'unknown';item.dataset.candidateName=row.place.name;
    const content=document.createElement('span');Object.assign(content.style,{minWidth:'0',whiteSpace:'normal',overflowWrap:'anywhere'});const title=document.createElement('span');title.style.display='block';title.textContent=row.place.name;content.append(title);
    const details=document.createElement('span');details.className='tiny sub-line';details.style.display='block';const a=row.labels.address,f=row.labels.facility;item.dataset.labelAddressStatus=a.status;item.dataset.labelFacilityStatus=f.status;
    details.textContent=(a.status==='matched'?(f.status==='matched'?'町丁目の目安：'+a.names[0]:'町丁目までの目安・番地なし'):a.status==='boundary'?'住所は境界付近のため未確認':'住所を確認できません')+' ／ '+(f.status==='matched'?'地図上の施設区域内':'施設名を確認できません');
    const coords=document.createElement('span');coords.className='tiny sub-line';coords.style.display='block';coords.textContent=row.labels.coordinate+' · '+new Date(row.event.at+32400000).toISOString().slice(11,16)+(row.event.at<Date.now()?'（過ぎた時刻）':'');content.append(details,coords);item.append(content);
    item.onclick=()=>{if(current(token,selected,node)&&SkyMapUI.selectCandidate(row,selected.expected))sheet.close();};resultList.append(item);
   }
   AstroNotesCandidatePicker.registerAdditional(resultList,pickerRows,selected,()=>current(token,selected,node));
   setStatus('');visibleCredits.hidden=!result.rows.length;resultList.setAttribute('aria-busy','false');status.textContent=result.rows.length?result.rows.length+'件のモデル上の候補があります（絞り込み前）。':'この条件で、地形・建物モデル上の見通しを確認できた候補はありません。';
   if(result.counts.unknown)status.textContent+=' 範囲外や高さ不明など、判定できない地点は含めていません。';
   if(result.counts.deferred)status.textContent+=' 収束しない条件や先絞りなど、詳しく判定できていない範囲があります。';
   if(result.limited)status.textContent+=' 調べ切れていない範囲があります。';
   if(result.rows.length&&(!labels.addresses||!labels.facilities))status.textContent+=' 住所・施設名のデータを一部読み込めませんでした。もう一度探索するか、画面を再読み込みしてください。';
  }catch{if(current(token,selected,node)){resultList.setAttribute('aria-busy','false');setStatus('候補の情報を読み込めませんでした。もう一度お試しください。');}}
  finally{if(token===run){stopWatch();if(!current(token,selected,node))mount();}if(current(token,selected,node)){button.disabled=false;cancel.hidden=true;}}
 };
}
// Observe only the picker so progress and map rendering cannot create a busy loop.
let mountFrame=null;const scheduleMount=()=>{if(mountFrame===null)mountFrame=requestAnimationFrame(()=>{mountFrame=null;mount();});};
const picker=document.getElementById('placeSheet');if(picker){new MutationObserver(scheduleMount).observe(picker,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','aria-selected']});picker.addEventListener('close',()=>{stopWatch();run++;section?.remove();section=null;condition='';});}
const scenePanel=document.getElementById('exploreScenePanel');if(scenePanel)new MutationObserver(()=>{syncObserverMap();scheduleMount();}).observe(scenePanel,{childList:true,subtree:true});
document.addEventListener('astronotes-composition-change',mount);
mount();
})();
