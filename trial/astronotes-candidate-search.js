/* Trial-only discovery. Existing registered-place search is not modified. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateDiscovery=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const day=at=>Math.floor((at+32400000)/86400000)*86400000-32400000;
const point=(latitude,longitude)=>({latitude,longitude});
function inside(ring,lat,lon){let on=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
 const a=ring[i],b=ring[j];if((a[1]>lat)!==(b[1]>lat)&&lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0])on=!on;
}return on;}
// Generate positions inside sidewalk geometry, not a list of named viewpoints.
// Heights of 0 in a 2D road model are deliberately not used as ground heights.
function sampleSidewalks(data,limit=600){
 const rows=[],seen=new Set();let limited=false;
 for(const feature of data.features||[]){
  if(!['2000','2010','2020'].includes(feature.function))continue;
  const ring=feature.coordinatesLonLatHeight;if(!Array.isArray(ring)||ring.length<4)continue;
  const valid=ring.every(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90);if(!valid)continue;
  const lo=Math.min(...ring.map(p=>p[0])),hi=Math.max(...ring.map(p=>p[0])),a=Math.min(...ring.map(p=>p[1])),b=Math.max(...ring.map(p=>p[1]));
  const dy=12.5/111195,dx=dy/Math.max(.1,Math.cos((a+b)*Math.PI/360));
  // Narrow sidewalks may fall between grid rows; edge midpoints remain inside
  // or on the source polygon and provide deterministic extra sampling positions.
  const candidates=[];
  for(let lat=a+dy/2;lat<b;lat+=dy)for(let lon=lo+dx/2;lon<hi;lon+=dx)if(inside(ring,lat,lon))candidates.push(point(lat,lon));
  for(let i=1;i<ring.length;i++)candidates.push(point((ring[i-1][1]+ring[i][1])/2,(ring[i-1][0]+ring[i][0])/2));
  for(const p of candidates){
   const key=p.latitude.toFixed(7)+','+p.longitude.toFixed(7);if(seen.has(key))continue;seen.add(key);
   if(rows.length>=limit){limited=true;break;}
   rows.push({...p,sourceId:feature.sourceId,polygonId:feature.polygonId,
    groundKnown:feature.groundKnown===true,standingSurfaceKnown:feature.standingSurfaceKnown===true,
    accessKnown:feature.accessKnown===true,groundM:feature.groundM??null});
  }
  if(limited)break;
 }
 return {rows,limited};
}
function keyFor(plan,version,atmosphere){return JSON.stringify([version,plan.owner,plan.body,plan.target,plan.partId,plan.limb,plan.matchMode,day(plan.at),atmosphere]);}
function create({loadData,evaluate,clock=()=>performance.now(),yieldTask=()=>new Promise(r=>setTimeout(r,0))}){
 const cache=new Map(),jobs=new Map();
 async function search(plan,{onProgress=()=>{},isCurrent=()=>true,atmosphere='standard'}={}){
  const data=await loadData();if(!isCurrent())return {cancelled:true};
  const key=keyFor(plan,data.version,atmosphere);if(cache.has(key))return {...cache.get(key),cached:true};
  if(jobs.has(key)){const result=await jobs.get(key);return !isCurrent()?{cancelled:true}:result.cancelled?search(plan,{onProgress,isCurrent,atmosphere}):{...result,cached:true};}
  const work=(async()=>{
   const start=clock(),generated=sampleSidewalks(data),counts={sampled:generated.rows.length,checked:0,aligned:0,blocked:0,unknown:0};const rows=[];
   for(const p of generated.rows){
    if(!isCurrent())return {cancelled:true};
    if(counts.checked%20===0)await yieldTask();if(!isCurrent())return {cancelled:true};
    counts.checked++;
    if(!p.groundKnown||!p.standingSurfaceKnown||!p.accessKnown){counts.unknown++;}
    else {
     const result=await evaluate(plan,p,data);if(!isCurrent())return {cancelled:true};
     if(result?.aligned)counts.aligned++;
     if(result?.status==='blocked')counts.blocked++;
     else if(result?.recommend===true&&result.status==='verified'&&data.visibilityCertified===true&&result.event&&Number.isFinite(result.event.at)&&day(result.event.at)===day(plan.at))rows.push(result);
     else counts.unknown++;
    }
    if(counts.checked%25===0)onProgress({...counts});
   }
   const result={rows,counts,limited:generated.limited,elapsedMs:clock()-start,cached:false,dataVersion:data.version};
   cache.set(key,result);while(cache.size>8)cache.delete(cache.keys().next().value);return result;
  })();
  jobs.set(key,work);try{return await work;}finally{if(jobs.get(key)===work)jobs.delete(key);}
 }
 return {search,clear:()=>cache.clear()};
}
return {create,sampleSidewalks,keyFor,day};
});

// Trial adapter: one existing place picker, no new page, no saved-place writes.
(()=>{
'use strict';
let dataPromise=null,run=0,section=null,condition='';
const loadData=()=>dataPromise||(dataPromise=fetch('data/candidate-sidewalks.json').then(r=>{if(!r.ok)throw Error('data');return r.json();}).catch(e=>{dataPromise=null;throw e;}));
const engine=AstroNotesCandidateDiscovery.create({loadData,
 // Current data cannot certify ground/standing surface/access/complete visibility.
 // No unverified row reaches selectCandidate or becomes a recommendation.
 evaluate:async()=>({status:'unknown',recommend:false})});
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
  if(section){run++;section.remove();section=null;condition='';}return;
 }
 const p=snapshot(),id=key(p);if(section?.isConnected&&condition===id)return;
 run++;section?.remove();condition=id;section=document.createElement('section');section.id='additionalCandidateSearch';section.setAttribute('aria-label','ほかの候補地点');
 const description=document.createElement('p');description.className='tiny';description.textContent='登録した撮影地点の候補は上に表示します。追加の自動探索は四ツ谷周辺の歩道を試用しています。';
 const status=document.createElement('p');status.className='tiny';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const button=document.createElement('button');button.type='button';button.className='fav-btn';button.textContent='ほかの候補地点を探す';
 const cancel=document.createElement('button');cancel.type='button';cancel.className='fav-btn';cancel.textContent='探索を中止';cancel.hidden=true;
 const resultList=document.createElement('div');resultList.id='additionalCandidateResults';
 const evidence=document.createElement('details'),summary=document.createElement('summary'),source=document.createElement('p'),link=document.createElement('a');
 summary.textContent='探索範囲・出典';source.className='tiny';source.textContent='四ツ谷周辺の歩道で試用しています。出典：PLATEAU 千代田区2025（歩道を抽出して加工）。現地の見通しや立てる高さを確かめられない場所は推薦しません。 ';
 link.href='https://www.mlit.go.jp/plateau/site-policy/';link.target='_blank';link.rel='noopener';link.textContent='利用条件';source.append(link);evidence.append(summary,source);
 section.append(description,button,cancel,status,resultList,evidence);panel.append(section);
 button.disabled=!p;status.textContent=p?'':'天体・対象・日付を選んでください。';
 cancel.onclick=()=>{run++;button.disabled=false;cancel.hidden=true;status.textContent='探索を中止しました。';};
 button.onclick=async()=>{
  const selected=snapshot();if(!selected)return;
  const node=section,token=++run;button.disabled=true;cancel.hidden=false;resultList.replaceChildren();status.textContent='ほかの候補地点を確認しています…';
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
  finally{if(current(token,selected,node)){button.disabled=false;cancel.hidden=true;}}
 };
}
// Observe only the picker so progress and map rendering cannot create a busy loop.
const picker=document.getElementById('placeSheet');if(picker){new MutationObserver(mount).observe(picker,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','aria-selected']});picker.addEventListener('close',()=>{run++;section?.remove();section=null;condition='';});}
mount();
})();
