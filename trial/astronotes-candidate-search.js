/* Native GSI DEM samples: terrain diagnostics, never standing surface/visibility proof. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateTerrain=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const R=6371008.8,rad=Math.PI/180,MISSING=-2147483648;
async function decode(data){
 const packed=Uint8Array.from(atob(data.heightsGzipBase64),c=>c.charCodeAt(0)),stream=new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip')),buffer=await new Response(stream).arrayBuffer(),view=new DataView(buffer),tiles=new Map(data.tiles.map(t=>[t.x+','+t.y,t]));
 const world=256*2**data.zoom;
 function pixel(lat,lon){return [(lon+180)/360*world,(1-Math.asinh(Math.tan(lat*rad))/Math.PI)/2*world];}
 function atPixel(x,y){const px=Math.floor(x),py=Math.floor(y),tile=tiles.get(Math.floor(px/256)+','+Math.floor(py/256));if(!tile)return null;const i=tile.offset+(py%256+256)%256*256+(px%256+256)%256;if(!Number.isInteger(i)||i<0||i*4+4>buffer.byteLength)return null;const cm=view.getInt32(i*4,true);return cm===MISSING?null:cm/100;}
 function at(p){const xy=pixel(p.latitude,p.longitude);return atPixel(...xy);}
 function trace(observer,{azimuth,altitude,maxM}){
  if(!Number.isFinite(observer.elevation)||!Number.isFinite(azimuth)||!Number.isFinite(altitude)||Math.abs(altitude)>=89||!Number.isFinite(maxM)||maxM<=0||maxM>20000)return {status:'unknown',recommend:false,reason:'invalid-terrain-ray'};
  const end={latitude:observer.latitude+Math.cos(azimuth*rad)*maxM/111195,longitude:observer.longitude+Math.sin(azimuth*rad)*maxM/(111195*Math.cos(observer.latitude*rad))},start=pixel(observer.latitude,observer.longitude),finish=pixel(end.latitude,end.longitude),dx=finish[0]-start[0],dy=finish[1]-start[1];
  // Walk raster boundaries (not sparse profile samples); source holes stay missing.
  const crossings=[0,1];for(const [a,b] of [[start[0],finish[0]],[start[1],finish[1]]])if(a!==b)for(let n=Math.floor(Math.min(a,b))+1;n<Math.max(a,b);n++)crossings.push((n-a)/(b-a));crossings.sort((a,b)=>a-b);
  let checked=0,missing=0,ignoredCells=0,hit=null,minMarginM=Infinity;const eye=observer.elevation+(observer.eyeM??1.5);
  for(let i=1;i<crossings.length;i++){const lo=crossings[i-1],hi=crossings[i];if(hi-lo<1e-14)continue;const t=(lo+hi)/2,z=atPixel(start[0]+t*dx,start[1]+t*dy);checked++;if(z===null)missing++;if(hi*maxM<=5){ignoredCells++;continue;}if(z===null)continue;const a=Math.max(5,lo*maxM),b=hi*maxM,vertex=-R*Math.tan(altitude*rad),distances=[a,b];if(vertex>a&&vertex<b)distances.push(vertex);const heights=distances.map(d=>eye+d*Math.tan(altitude*rad)+d*d/(2*R)),ray=Math.min(...heights),d=distances[heights.indexOf(ray)],margin=ray-z;minMarginM=Math.min(minMarginM,margin);if(margin<=0&&!hit)hit={distanceM:d,terrainM:z,rayM:ray};}
  return {status:hit?'model-blocked':'unknown',recommend:false,checked,missing,ignoredNearObserverM:5,ignoredCells,hit,minMarginM:Number.isFinite(minMarginM)?minMarginM:null,reason:hit?'conditional-dem-intersection':'no-terrain-visibility-certification'};
 }
 return {at,trace,source:data.source};
}
return {decode};
});

/* Model diagnostics only. Missing survey/standing/access evidence NEVER becomes clear. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const R=6371008.8,rad=Math.PI/180;
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),sub=(a,b)=>a.map((x,i)=>x-b[i]);
function inside(r,p){let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>p[1])!==(r[j][1]>p[1])&&p[0]<(r[j][0]-r[i][0])*(p[1]-r[i][1])/(r[j][1]-r[i][1])+r[i][0])yes=!yes;return yes;}
function faceHit(rings,origin,direction,maxM){
 if(!rings.length||rings[0].length<3)return null;const ring=rings[0],normal=[0,0,0];
 for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];normal[0]+=(a[1]-b[1])*(a[2]+b[2]);normal[1]+=(a[2]-b[2])*(a[0]+b[0]);normal[2]+=(a[0]-b[0])*(a[1]+b[1]);}
 const den=dot(normal,direction);if(Math.abs(den)<1e-9)return null;const t=dot(normal,sub(ring[0],origin))/den;if(t<=.05||t>maxM)return null;
 const p=origin.map((x,i)=>x+t*direction[i]),axis=normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs))),project=q=>q.filter((_,i)=>i!==axis),pp=project(p);
 return inside(rings[0].map(project),pp)&&!rings.slice(1).some(r=>inside(r.map(project),pp))?{distanceM:t,point:p}:null;
}
function trace(index,observer,{azimuth,altitude,maxM=12000}){
 if(!Number.isFinite(observer.elevation)||!Number.isFinite(azimuth)||!Number.isFinite(altitude)||Math.abs(altitude)>=89||!Number.isFinite(maxM)||maxM<=0||maxM>20000)return {status:'unknown',recommend:false,reason:'invalid-height-or-ray'};
 const eye=observer.elevation+(observer.eyeM??1.5),lat=observer.latitude,lon=observer.longitude,scale=Math.cos(lat*rad),az=azimuth*rad,alt=altitude*rad;
 // Parameter t is horizontal metres, matching geometry distance and curvature.
 const direction=[Math.sin(az),Math.cos(az),Math.tan(alt)],end=[lon+direction[0]*maxM/(111195*scale),lat+direction[1]*maxM/111195];
 const ids=new Set();for(let x=Math.floor(Math.min(lon,end[0])*1000);x<=Math.floor(Math.max(lon,end[0])*1000);x++)for(let y=Math.floor(Math.min(lat,end[1])*1000);y<=Math.floor(Math.max(lat,end[1])*1000);y++)for(const id of index.grid[x+','+y]||[])ids.add(id);
 let hit=null,faces=0;for(const id of ids){const b=index.buildings[id];for(const poly of b.polygons){faces++;const rings=poly.rings.map(r=>r.map(p=>{const x=(p[0]-lon)*111195*scale,y=(p[1]-lat)*111195;return [x,y,p[2]-(x*x+y*y)/(2*R)];}));const h=faceHit(rings,[0,0,eye],direction,hit?.distanceM??maxM);if(h)hit={...h,buildingId:b.id,polygonId:poly.id,lod:b.lod};}}
 return {status:hit?'model-blocked':'unknown',recommend:false,hit,faces,buildingsChecked:ids.size,reason:hit?'conditional-model-intersection':'incomplete-coverage-or-uncertainty'};
}
function create({align,shooting,bodies,index,surfaceAt,terrain=null,prefilter=true,yieldTask=()=>new Promise(r=>setTimeout(r,0))}){
 const paths=new Map();
 return async function evaluate(plan,point){
  await yieldTask();const surface=surfaceAt(point);if(!surface||!Number.isFinite(surface.estimateM))return {status:'unknown',recommend:false,reason:'no-standing-height-estimate'};
  const obs={...point,elevation:surface.estimateM,eyeM:1.5};
  const start=Math.floor((plan.at+32400000)/86400000)*86400000-32400000;
  // Conservative pilot optimisation only: rejected positions remain UNKNOWN.
  // This is not a proof that no astronomical opportunity exists.
  const geometry=align.geometryFrom(obs,plan.target,{partId:plan.partId,eyeM:obs.eyeM});
  if(prefilter&&geometry&&['moon','sun'].includes(plan.body)){
   const key=plan.body+','+start+','+(plan.atmosphere||'standard');let path=paths.get(key);
   if(!path){path=[];const ref={latitude:35.68626,longitude:139.73068,elevation:30};for(let t=start;t<=start+86400000;t+=60000){const st=bodies.state(plan.body,t,ref);path.push([st.azimuth,st.apparentAltitude]);}paths.set(key,path);while(paths.size>4)paths.delete(paths.keys().next().value);}
   if(!path.some(([az,alt])=>Math.abs(((az-geometry.azimuth+540)%360)-180)<3&&alt>-3&&alt<geometry.angle+3))return {status:'unknown',recommend:false,deferred:true,assumedObserver:obs,surface,reason:'pilot-prefilter-deferred-not-certified-no-event'};
  }
  const events=shooting.eventsFor(plan,obs,start,{align,isMountain:()=>false}).filter(e=>shooting.matches(e,plan,()=>false)&&e.at>=start&&e.at<start+86400000&&(plan.body!=='moon'||e.sunAltitude<0));
  const distance=geometry?.distanceKm*1000;
  const targetRay=geometry&&events.length?trace(index,obs,{azimuth:geometry.azimuth,altitude:Math.atan2(geometry.topM-obs.elevation-obs.eyeM-distance*distance/(2*R),distance)/rad,maxM:distance}):null;
  const targetTerrain=geometry&&events.length&&terrain?terrain.trace(obs,{azimuth:geometry.azimuth,altitude:Math.atan2(geometry.topM-obs.elevation-obs.eyeM-distance*distance/(2*R),distance)/rad,maxM:distance}):null;
  const tested=[];for(const event of events){const st=bodies.state(plan.body,event.at,{...obs,elevation:obs.elevation+obs.eyeM});const rays=[0,-1,1].map(offset=>{const ray={azimuth:st.azimuth,altitude:(st.geometricAltitude??st.altitude??st.apparentAltitude)+offset*st.angularRadius,maxM:12000};return {...trace(index,obs,ray),terrain:terrain?.trace(obs,ray)??null};});tested.push({event,rays});}
  return {status:'unknown',recommend:false,aligned:events.length>0,events:tested,targetRay,targetTerrain,assumedObserver:obs,surface,reason:'estimated-surface-and-incomplete-3d-coverage'};
 };
}
return {faceHit,trace,create};
});

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
function create({loadData,evaluate,clock=()=>performance.now(),yieldTask=()=>new Promise(r=>setTimeout(r,0)),diagnoseUnknown=false}){
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
    if((!p.groundKnown||!p.standingSurfaceKnown)&&!diagnoseUnknown){counts.unknown++;}
    else {
     const result=await evaluate(plan,p,data);if(!isCurrent())return {cancelled:true};
     if(result?.aligned)counts.aligned++;
     if(result?.targetRay?.hit||result?.events?.some(e=>e.rays.some(r=>r.hit)))counts.modelBlocked=(counts.modelBlocked||0)+1;
     if(result?.status==='blocked')counts.blocked++;
     else if(result?.recommend===true&&result.status==='verified'&&p.groundKnown&&p.standingSurfaceKnown&&data.visibilityCertified===true&&result.event&&Number.isFinite(result.event.at)&&day(result.event.at)===day(plan.at))rows.push(result);
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
let dataPromise=null,run=0,section=null,condition='',watch=null;
const dataTag=new URL(document.currentScript.src,location.href).searchParams.get('v')||'0';
const dataHashes={"candidate-terrain.json":"6e9ec4e38293e15356b62578b60e762cda7c86f4db1e59fd426c330dad80dfcb","candidate-buildings.json":"6c3ca4d6bd7decf61b068fde6115b3895bb83ebf6d516d2cad464db34fc355f8","candidate-surfaces.json":"de16ae6e56aa05a1d4a7d6d0fa8974a4373183f35e8282f412f7fbd7c637751f","candidate-sidewalks.json":"95a7e907dd67360391ae8b3b082e93c750ba8b460fda5eabb20b0e698695beaa"};
const readData=async name=>{const r=await fetch('data/'+name+'?v='+dataTag);if(!r.ok)throw Error('data');const bytes=await r.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==dataHashes[name])throw Error('data-version');return JSON.parse(new TextDecoder().decode(bytes));};
const stopWatch=()=>{if(watch!==null){clearInterval(watch);watch=null;}};
const loadData=()=>dataPromise||(dataPromise=readData('candidate-sidewalks.json').catch(e=>{dataPromise=null;throw e;}));
let modelPromise=null;
const loadModel=()=>modelPromise||(modelPromise=Promise.all(['candidate-buildings.json','candidate-surfaces.json','candidate-terrain.json'].map(readData)).then(async([index,surface,dem])=>AstroNotesCandidateModel.create({align:AstroNotesAlign,shooting:AstroNotesShooting,bodies:AstroNotesBodies,index,terrain:await AstroNotesCandidateTerrain.decode(dem),surfaceAt:p=>surface.samples[p.latitude.toFixed(7)+','+p.longitude.toFixed(7)]})).catch(e=>{modelPromise=null;throw e;}));
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
 link.href='https://www.mlit.go.jp/plateau/site-policy/';link.target='_blank';link.rel='noopener';link.textContent='利用条件';source.append(link);const tokyo=document.createElement('a');tokyo.href='https://catalog.data.metro.tokyo.lg.jp/dataset/t000029d0000000024';tokyo.target='_blank';tokyo.rel='noopener';tokyo.textContent='東京都の出典';const license=document.createElement('a');license.href='https://creativecommons.org/licenses/by/4.0/deed.ja';license.target='_blank';license.rel='noopener';license.textContent='CC BY 4.0';const gsi=document.createElement('a');gsi.href='https://maps.gsi.go.jp/development/demtile.html';gsi.target='_blank';gsi.rel='noopener';gsi.textContent='国土地理院 標高タイル（加工）';source.append(' ／ ',tokyo,'・',license,' ／ ',gsi);evidence.append(summary,source);
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

// data-release 6d4584227e93148d383dc714438102d9e405e47d49403b4cd100469f1b145bfe
