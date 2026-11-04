// Trial adapter: one existing place picker, no new page, no saved-place writes.
(()=>{
'use strict';
let dataPromise=null,run=0,section=null,condition='',watch=null;
const dataTag=new URL(document.currentScript.src,location.href).searchParams.get('v')||'0';
const stopWatch=()=>{if(watch!==null){clearInterval(watch);watch=null;}};
const loadData=()=>dataPromise||(dataPromise=fetch('data/candidate-sidewalks.json?v='+dataTag).then(r=>{if(!r.ok)throw Error('data');return r.json();}).catch(e=>{dataPromise=null;throw e;}));
let modelPromise=null;
const loadModel=()=>modelPromise||(modelPromise=Promise.all(['candidate-buildings.json','candidate-surfaces.json'].map(n=>fetch('data/'+n+'?v='+dataTag).then(r=>{if(!r.ok)throw Error('model');return r.json();}))).then(([index,surface])=>AstroNotesCandidateModel.create({align:AstroNotesAlign,shooting:AstroNotesShooting,bodies:AstroNotesBodies,index,surfaceAt:p=>surface.samples[p.latitude.toFixed(7)+','+p.longitude.toFixed(7)]})).catch(e=>{modelPromise=null;throw e;}));
const engine=AstroNotesCandidateDiscovery.create({loadData,diagnoseUnknown:true,
 // Real candidate astronomy and LOD1/2 faces are diagnostic; missing evidence stays unknown.
 evaluate:async(plan,p)=>plan.target.id==='skytree'&&['moon','sun'].includes(plan.body)?(await loadModel())(plan,p):({status:'unknown',recommend:false,reason:'unsupported-pilot-condition'})});
const context=s=>JSON.stringify([s.body,s.target,s.partId,s.limb,AstroNotesCandidateDiscovery.day(s.at),s.matchMode||'limb']);
function snapshot(){
 if(typeof SkyMapUI==='undefined'||typeof auth==='undefined'||!auth||typeof screenAllowed!=='function'||!screenAllowed('skymap')||!screenAllowed('framing'))return null;
 const s=SkyMapUI.selectionState();if(!s?.target||!Number.isFinite(s.at))return null;
 return {...s,owner:auth.loginId,expected:context(s),atmosphere:air()};
}
const air=()=>typeof aimAirSettings==='undefined'?'standard':JSON.stringify(aimAirSettings);
const key=p=>p?JSON.stringify([p.owner,p.expected,p.atmosphere]):'';
function current(token,p,node){const now=snapshot();return token===run&&node.isConnected&&document.getElementById('placeSheet')?.open&&!document.getElementById('recentCandidates')?.hidden&&key(now)===key(p);}
function mount(){
 const panel=document.getElementById('recentCandidates'),sheet=document.getElementById('placeSheet');
 if(!panel||!sheet?.open||panel.hidden||typeof placeSheetFor==='undefined'||placeSheetFor!=='skymap'){
  if(section){stopWatch();run++;section.remove();section=null;condition='';}return;
 }
 const p=snapshot(),id=key(p);if(section?.isConnected&&condition===id)return;
 stopWatch();run++;section?.remove();condition=id;section=document.createElement('section');section.id='additionalCandidateSearch';section.setAttribute('aria-label','ほかの候補地点');
 const description=document.createElement('p');description.className='tiny';description.textContent='登録した撮影地点の候補は上に表示します。追加の自動探索は四ツ谷周辺の歩道・月と太陽・スカイツリーで試用しています。確認に数十秒かかる場合があります。';
 const status=document.createElement('p');status.className='tiny';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const button=document.createElement('button');button.type='button';button.className='fav-btn';button.textContent='ほかの候補地点を探す';
 const cancel=document.createElement('button');cancel.type='button';cancel.className='fav-btn';cancel.textContent='探索を中止';cancel.hidden=true;
 const resultList=document.createElement('div');resultList.id='additionalCandidateResults';
 const evidence=document.createElement('details'),summary=document.createElement('summary'),source=document.createElement('p'),link=document.createElement('a');
 summary.textContent='探索範囲・出典';source.className='tiny';source.textContent='四ツ谷周辺の歩道で試用しています。出典：PLATEAU 千代田区2025（歩道・LOD1/2建物を抽出して加工）、東京都デジタルサービス局 高密度点群データ（CC BY 4.0・地面高さ中央値を抽出して加工）。現地の見通しや立てる高さを確かめられない場所は推薦しません。 ';
 link.href='https://www.mlit.go.jp/plateau/site-policy/';link.target='_blank';link.rel='noopener';link.textContent='利用条件';source.append(link);const tokyo=document.createElement('a');tokyo.href='https://catalog.data.metro.tokyo.lg.jp/dataset/t000029d0000000024';tokyo.target='_blank';tokyo.rel='noopener';tokyo.textContent='東京都の出典';const license=document.createElement('a');license.href='https://creativecommons.org/licenses/by/4.0/deed.ja';license.target='_blank';license.rel='noopener';license.textContent='CC BY 4.0';source.append(' ／ ',tokyo,'・',license);evidence.append(summary,source);
 section.append(description,button,cancel,status,resultList,evidence);panel.append(section);
 button.disabled=!p;status.textContent=p?'':'天体・対象・日付を選んでください。';
 cancel.onclick=()=>{stopWatch();run++;button.disabled=false;cancel.hidden=true;status.textContent='探索を中止しました。';};
 button.onclick=async()=>{
  const selected=snapshot();if(!selected){mount();return;}
  if(condition!==key(selected)){mount();section?.querySelector('button')?.click();return;}
  const node=section,token=++run;stopWatch();watch=setInterval(()=>{if(!current(token,selected,node)){stopWatch();mount();}},250);button.disabled=true;cancel.hidden=false;resultList.replaceChildren();status.textContent='ほかの候補地点を確認しています…';
  try{
   const result=await engine.search(selected,{isCurrent:()=>current(token,selected,node),onProgress:counts=>{if(current(token,selected,node))status.textContent='候補地点のデータを確認しています… '+counts.checked+'地点';},atmosphere:selected.atmosphere});
   if(!current(token,selected,node)||result.cancelled)return;
   for(const row of result.rows){
    const item=document.createElement('button');item.type='button';item.className='list-item';item.textContent=row.place.name+' '+new Date(row.event.at+32400000).toISOString().slice(11,16);
    item.onclick=()=>{if(current(token,selected,node)&&SkyMapUI.selectCandidate(row,selected.expected))sheet.close();};resultList.append(item);
   }
   status.textContent=result.rows.length?result.rows.length+'件の候補があります。':result.counts.unknown?'見通しを確かめられる候補がありません。高さや周囲の遮蔽物、立てる場所を確認できない地点は、候補に出していません。':'調べた範囲では、この日の条件に合う候補がありません。';
   if(result.limited)status.textContent+=' 調べ切れていない範囲があります。';
  }catch{if(current(token,selected,node))status.textContent='候補の情報を読み込めませんでした。もう一度お試しください。';}
  finally{if(token===run){stopWatch();if(!current(token,selected,node))mount();}if(current(token,selected,node)){button.disabled=false;cancel.hidden=true;}}
 };
}
// Observe only the picker so progress and map rendering cannot create a busy loop.
const picker=document.getElementById('placeSheet');if(picker){new MutationObserver(mount).observe(picker,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','aria-selected']});picker.addEventListener('close',()=>{stopWatch();run++;section?.remove();section=null;condition='';});}
mount();
})();
