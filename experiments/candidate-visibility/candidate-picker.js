// Trial-only candidate presentation. A row keeps its evidence and selection handler.
(()=>{
'use strict';
const names={viewpoint:'展望地点',park:'公園',plaza:'広場',riverbank:'河川敷',garden:'庭園',facility:'その他の施設',road:'道路・歩道',unknown:'種類未確認'};
const photoOrder={normal:0,conditional:1,unfavorable:2,unknown:3};
const preferred=new Set(['viewpoint','park','plaza','riverbank']);
function kinds(row,facilities){
 const result=new Set(),declared=Array.isArray(row.placeKind)?row.placeKind:[row.placeKind];
 for(const type of declared)if(Object.hasOwn(names,type)&&type!=='unknown')result.add(type);
 const ids=row.labels?.facility?.status==='matched'?row.labels.facility.sourceIds:globalThis.AstroNotesCandidateLabels?.resolve(facilities,row.place,'osm-named-areas')?.sourceIds;
 for(const f of facilities?.features||[]){if(!ids?.includes(f.id))continue;const t=f.tags||{};
  result.add(t.tourism==='viewpoint'?'viewpoint':t.leisure==='park'?'park':t.place==='square'?'plaza':t.leisure==='garden'?'garden':'facility');
 }
 // A source ID alone is not proof that a newly generated park is a road.
 if(!result.size&&row.assumedObserver?.sourceId&&row.modelEvidence?.kind==='terrain-and-building-model-los')result.add('road');
 return result.size?[...result].sort((a,b)=>Object.keys(names).indexOf(a)-Object.keys(names).indexOf(b)):['unknown'];
}
function accepts(row,time,kind,types,events){return (kind==='all'||types.includes(kind))&&(time==='all'||Number.isFinite(row.event?.at)&&!!events?.some(e=>e.kind===time&&Math.abs(row.event.at-e.at)<=3600000));}
const placePriority=types=>types.some(t=>preferred.has(t))?0:types.some(t=>t==='garden'||t==='facility')?1:types.includes('road')?2:3;
function rankCompare(a,b){
 const ranks=r=>Array.isArray(r.rank)?r.rank:[r.rank],aa=ranks(a),bb=ranks(b);
 for(let i=0;i<Math.max(aa.length,bb.length);i++){const x=Number.isFinite(aa[i])?aa[i]:Infinity,y=Number.isFinite(bb[i])?bb[i]:Infinity;if(x!==y)return x<y?-1:1;}return 0;
}
function candidateKey(row){
 const p=row.place||{},o=row.assumedObserver||{};
 // Preserve height and exact time: different decks or different opportunities do not merge.
 return JSON.stringify([p.latitude,p.longitude,p.surfaceId??row.surfaceId??null,p.groundManualM??p.elevation??o.elevation??null,p.standAglM??p.eyeHeightAGL??o.eyeM??null,p.stand??null,row.event?.at,row.event?.partId??null,row.event?.matchMode??null]);
}
function compare(a,b,sort='recommended'){
 let primary=0;
 if(sort==='recommended'){
  primary=(photoOrder[a.row.quality?.photographyClass]??3)-(photoOrder[b.row.quality?.photographyClass]??3)
   ||placePriority(a.types)-placePriority(b.types)||rankCompare(a.row,b.row);
 }else{
  const key=sort.replace(/-desc$/,''),direction=sort.endsWith('-desc')?-1:1;
  primary=direction*(key==='name'?String(a.row.place?.name||'').localeCompare(String(b.row.place?.name||''),'ja',{numeric:true}):key==='kind'?Object.keys(names).indexOf(a.types[0])-Object.keys(names).indexOf(b.types[0]):a.row.event.at-b.row.event.at);
 }
 return primary||(a.row.event.at-b.row.event.at)||String(a.id||'').localeCompare(String(b.id||''))||a.index-b.index;
}
function mergeEntries(entries,sort){
 const unique=new Map();
 for(const e of entries){const key=candidateKey(e.row),previous=unique.get(key);
  // Merge only identical (p,t,h). Use one existing row; never combine evidence into a stronger claim.
  if(!previous||(previous.show===false&&e.show!==false)||(previous.show===false)===(e.show===false)&&compare(e,previous,'recommended')<0)unique.set(key,e);
 }
 return [...unique.values()].sort((a,b)=>compare(a,b,sort));
}
const groups=new Map(),windows=new Map(),boundNodes=new WeakSet();
let control=null,list=null,scope='',filterScope='',revision=0,loadLabels=async()=>({}),ports={},time='all',kind='all',sort='recommended';
let visibleEntries=[],selectedId=null,mapPanel=null,mapInstance=null,mapMode=false,mapHits=[],mapScroll=null,mapFitPending=false,suspendedView=null;
const columns='minmax(0,1fr) 56px 76px';
const day=at=>globalThis.AstroNotesCandidateDiscovery?.day(at)??Math.floor((at+32400000)/86400000)*86400000-32400000;
const clockText=at=>Number.isFinite(at)?new Date(at+32400000).toISOString().slice(11,16):'時刻未確認';
const uncertainty=row=>[row.quality?.visibility==='unknown'?'見通し未確認':'',row.frame?.status==='unknown'?'全体の画角未確認':''].filter(Boolean);
function configure(value){if(typeof value==='function')loadLabels=value;else if(value){ports={...ports,...value};if(typeof value.loadLabels==='function')loadLabels=value.loadLabels;}}
function planKey(plan){return typeof ports.requestKey==='function'?ports.requestKey(plan):JSON.stringify([plan.requestKey,plan.owner,plan.body,plan.target,plan.partId,plan.limb,plan.matchMode,plan.composition,plan.compositionInvalid,plan.timeSpec||null,day(plan.at),plan.atmosphere,plan.cameraHeight]);}
function formatRow(node,row,types){
 if(!node.hasAttribute('data-candidate-columns')){
  const notes=[...node.querySelectorAll('.sub-line')].filter(n=>!n.hasAttribute('data-place-kind')).map(n=>n.textContent.replace(/^\d{2}:\d{2}・/,'').replace(/ · \d{2}:\d{2}/,''));
  node.replaceChildren();node.dataset.candidateColumns='';
  Object.assign(node.style,{display:'grid',gridTemplateColumns:columns,columnGap:'8px',rowGap:'4px',alignItems:'start',textAlign:'left',padding:'12px 0',minHeight:'44px'});
  const title=document.createElement('span');title.textContent=row.place.name;Object.assign(title.style,{minWidth:'0',overflowWrap:'anywhere',fontSize:'14px',fontWeight:'600'});
  const clock=document.createElement('span');clock.dataset.candidateTime='';clock.textContent=clockText(row.event?.at);Object.assign(clock.style,{fontSize:'14px',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'});
  const kind=document.createElement('span');kind.dataset.placeKind='';Object.assign(kind.style,{fontSize:'14px',minWidth:'0',overflowWrap:'anywhere'});node.append(title,clock,kind);
  if(notes.length){const detail=document.createElement('span');detail.className='tiny sub-line';detail.textContent=notes.join(' · ');Object.assign(detail.style,{gridColumn:'1 / -1',whiteSpace:'normal',overflowWrap:'anywhere'});node.append(detail);}
 }
 node.querySelector('[data-place-kind]').textContent=types.map(t=>names[t]).join('・');
 node.querySelector('[data-candidate-time]').textContent=clockText(row.event?.at);
 const unconfirmed=uncertainty(row);let note=node.querySelector('[data-candidate-uncertainty]');
 if(unconfirmed.length){if(!note){note=document.createElement('span');note.dataset.candidateUncertainty='';note.className='tiny sub-line';Object.assign(note.style,{gridColumn:'1 / -1',whiteSpace:'normal',overflowWrap:'anywhere'});node.append(note);}note.textContent=unconfirmed.join(' ・ ');}else note?.remove();
}
function createHeader(){
 const header=document.createElement('div');header.dataset.candidateHeaders='';header.setAttribute('role','group');header.setAttribute('aria-label','候補の並べ替え');Object.assign(header.style,{display:'grid',gridTemplateColumns:columns,gap:'8px',borderBottom:'1px solid var(--line)',marginTop:'8px'});
 for(const [key,label]of [['name','地点'],['time','時刻'],['kind','種類']]){const button=document.createElement('button');button.type='button';button.dataset.candidateSort=key;button.dataset.label=label;Object.assign(button.style,{minWidth:'0',minHeight:'44px',padding:'8px 0',border:'0',borderRadius:'0',background:'transparent',boxShadow:'none',textAlign:'left',fontSize:'14px',fontWeight:'600',whiteSpace:'nowrap'});button.onclick=()=>{sort=sort===key?key+'-desc':key;updateHeaders();apply();};header.append(button);}return header;
}
function updateHeaders(){
 if(!control)return;const key=sort.replace(/-desc$/,''),descending=sort.endsWith('-desc');
 for(const button of control.querySelectorAll('[data-candidate-sort]')){const active=button.dataset.candidateSort===key;button.textContent=button.dataset.label+(active?(descending?' ↓':' ↑'):' ↕');button.setAttribute('aria-label',button.dataset.label+(active?'、現在は'+(descending?'降順':'昇順')+'。':'。')+(active&&!descending?'降順':'昇順')+'に並べ替え');button.setAttribute('aria-pressed',String(active));button.style.color=active?'var(--accent)':'var(--secondary)';}
 const reset=control.querySelector('[data-candidate-recommended]');if(reset)reset.hidden=sort==='recommended';
}
function button(label,handler){const b=document.createElement('button');b.type='button';b.className='fav-btn';b.textContent=label;b.style.minHeight='44px';b.onclick=handler;return b;}
function mount(panel,plan){
 const next=planKey(plan),nextFilters=typeof ports.filterKey==='function'?ports.filterKey(plan):next;
 if(next!==scope){
  const previous=scope,keepFilters=nextFilters===filterScope;
  if(mapPanel)mapPanel.querySelector('.mapwrap')?._mapShell?.setWide(false);
  for(const g of groups.values())for(const node of g.nodes)node.remove();
  scope=next;filterScope=nextFilters;groups.clear();windows.clear();visibleEntries=[];selectedId=null;revision++;mapMode=false;mapHits=[];
  if(!keepFilters){time=kind='all';sort='recommended';control?.remove();control=null;list=null;}
  else if(control){list?.replaceChildren();const toggle=control.querySelector('#candidateMapToggle');toggle.textContent='地図で見る';toggle.setAttribute('aria-expanded','false');toggle.disabled=true;const status=control.querySelector('[data-filter-status]');status.textContent='';status.hidden=true;control.querySelector('[data-candidate-headers]').hidden=false;if(list)list.hidden=false;}
  if(mapPanel)mapPanel.hidden=true;
  if(previous)queueMicrotask(()=>{if(scope===next&&panel.isConnected)globalThis.MyPlacesUI?.renderPickerPanel(panel);});
 }
 if(!control?.isConnected){
  control=document.createElement('section');control.id='candidateListControls';control.className='aim-disclosure';Object.assign(control.style,{padding:'12px 0',marginTop:'12px'});control.setAttribute('aria-label','この日の候補の絞り込みと並び順');
  const add=(label,id,options,value,change)=>{const l=document.createElement('label');l.className='tiny';Object.assign(l.style,{display:'grid',gridTemplateColumns:'76px minmax(0,1fr)',alignItems:'center',gap:'12px',margin:'0 0 8px',fontSize:'14px'});l.textContent=label;const s=document.createElement('select');s.id=id;s.setAttribute('aria-label',label);Object.assign(s.style,{width:'100%',minWidth:'0',maxWidth:'100%',minHeight:'44px',margin:'0',fontSize:'16px'});for(const [v,n]of options)s.add(new Option(n,v));s.value=value;s.onchange=()=>{change(s.value);apply();};l.append(s);control.append(l);};
  add('時間帯','candidateTimeFilter',[['all','すべての時間'],['rise','出の前後1時間'],['set','入の前後1時間']],time,v=>time=v);
  add('場所の種類','candidateKindFilter',[['all','すべての種類'],...Object.entries(names)],kind,v=>kind=v);
  const actions=document.createElement('div');Object.assign(actions.style,{display:'flex',gap:'8px',flexWrap:'wrap'});
  const reset=button('おすすめ順に戻す',()=>{sort='recommended';updateHeaders();apply();});reset.dataset.candidateRecommended='';
  const toggle=button('地図で見る',()=>showMap(!mapMode));toggle.id='candidateMapToggle';toggle.disabled=true;actions.append(toggle,reset);control.append(actions);
  const status=document.createElement('p');status.className='tiny';status.dataset.filterStatus='';status.setAttribute('role','status');status.style.margin='12px 0 0';control.append(status);
  control.append(createHeader());list=document.createElement('div');list.id='candidateUnifiedResults';control.append(list);
  if(mapPanel)control.append(mapPanel);updateHeaders();
 }
 if(panel.firstElementChild!==control)panel.prepend(control);return control;
}
function currentEntry(e){return !!e&&e.group===groups.get(e.box)&&e.box.isConnected&&e.group.current()&&control?.isConnected;}
async function apply(){
 const token=++revision,selection={time,kind,sort},status=control?.querySelector('[data-filter-status]');if(!status||!list)return;
 status.hidden=false;status.textContent='候補の絞り込みを確認しています…';
 let labels={};try{if([...groups.values()].some(g=>g.rows.length))labels=await loadLabels()||{};}catch{}
 if(token!==revision||!control?.isConnected)return;
 const entries=[];let unknownTime=0,index=0;
 for(const [box,g]of groups){
  if(!box.isConnected||!g.current()){for(const node of g.nodes)node.remove();groups.delete(box);continue;}
  for(let i=0;i<g.rows.length;i++){
   const row=g.rows[i],node=g.nodes[i];if(!node)continue;const types=kinds(row,labels.facilities);let events=null;
   if(selection.time!=='all'){
    const obs=row.assumedObserver,key=JSON.stringify([g.plan.body,day(g.plan.at),obs,g.plan.atmosphere]);
    if(obs&&[obs.latitude,obs.longitude,obs.elevation].every(Number.isFinite)){
     if(!windows.has(key)){try{await AstroNotesBodies.ensure(g.plan.body);if(token!==revision||!g.current())return;windows.set(key,AstroNotesCandidateComposition.windowEvents({...g.plan,timeWindow:{kind:'both',beforeMin:60,afterMin:60}},obs,AstroNotesBodies));}catch{windows.set(key,null);}}
     events=windows.get(key);
    }
    if(!events)unknownTime++;
   }
   const id=candidateKey(row);formatRow(node,row,types);node.dataset.candidateKinds=types.join(',');node.dataset.candidateId=id;
   if(!boundNodes.has(node)){boundNodes.add(node);node.addEventListener('click',()=>{selectedId=node.dataset.candidateId;},true);}
   entries.push({row,node,types,index:index++,id,box,group:g,show:accepts(row,selection.time,selection.kind,types,events)});
   if(i%12===11){await new Promise(r=>setTimeout(r,0));if(token!==revision||!g.current())return;}
  }
 }
 if(token!==revision)return;
 const merged=mergeEntries(entries,selection.sort),chosen=new Set(merged.map(e=>e.node));
 for(const e of entries)if(!chosen.has(e.node))e.node.remove();
 for(const e of merged){e.node.hidden=!e.show;e.node.style.display=e.show?'grid':'none';list.append(e.node);}
 // Remove orphaned nodes left by a source re-render or cancelled job.
 for(const node of [...list.children])if(!chosen.has(node))node.remove();
 visibleEntries=merged.filter(e=>e.show);visibleEntries.forEach((e,i)=>e.node.dataset.candidateNumber=String(i+1));
 if(!visibleEntries.some(e=>e.id===selectedId))selectedId=null;
 status.hidden=!merged.length;status.textContent=`${visibleEntries.length} / ${merged.length}件を表示`+(unknownTime?`。出入り時刻を確認できない${unknownTime}件は時間帯の絞り込みから除外しています。`:'')+(merged.length&&!labels.facilities?'。種類データを読み込めない地点は種類未確認です。':'');
 const toggle=control.querySelector('#candidateMapToggle');toggle.disabled=!visibleEntries.length||typeof ports.createMapView!=='function';
 if(mapMode){if(!visibleEntries.length)showMap(false);else refreshMap();}updateHeaders();
 if(suspendedView?.scope===scope&&visibleEntries.length&&(!suspendedView.selectedId||visibleEntries.some(e=>e.id===suspendedView.selectedId))){const saved=suspendedView;suspendedView=null;selectedId=saved.selectedId;if(saved.mapMode)showMap(true);else requestAnimationFrame(()=>{if(scope===saved.scope&&control?.isConnected){const scroller=ports.getScroller?.()||control.closest('.sheet-body')||control.closest('[role=tabpanel]');if(scroller)scroller.scrollTop=saved.scrollTop;}});}
 ports.onRendered?.(visibleEntries.length);return visibleEntries.map(e=>e.row);
}
function unregister(box){const g=groups.get(box);if(g){for(const node of g.nodes)node.remove();groups.delete(box);}return apply();}
function register(box,rows,plan,current){
 // Registered results can resolve before the adapter's animation-frame mount.
 // Establish the same scope first so that the later mount cannot discard them.
 const panel=box.closest('#recentCandidates')||box.closest('[role=tabpanel]');if(panel&&box.isConnected)mount(panel,plan);
 const previous=groups.get(box);if(previous)for(const node of previous.nodes)if(!box.contains(node))node.remove();
 groups.set(box,{rows,plan,current:typeof current==='function'?current:()=>true,nodes:[...box.children].filter(n=>n.tagName==='BUTTON'&&n.classList.contains('list-item'))});
 box.querySelector('[data-candidate-headers]')?.remove();return apply();
}
function mapSelection(){return visibleEntries.find(e=>e.id===selectedId)||null;}
function chooseMap(id){if(!visibleEntries.some(e=>e.id===id&&currentEntry(e)))return;selectedId=id;refreshMap();}
function ensureMap(){
 if(!mapPanel){
  mapPanel=document.createElement('section');mapPanel.id='candidateMapPanel';mapPanel.hidden=true;mapPanel.setAttribute('aria-label','この日の候補地図');
  const note=document.createElement('p');note.className='tiny';note.textContent='各ピンは、それぞれの時刻の候補です。';mapPanel.append(note);
  const wrap=document.createElement('div');wrap.className='mapwrap';Object.assign(wrap.style,{position:'relative',height:'min(55vh,480px)',minHeight:'280px',overflow:'hidden',borderRadius:'12px'});
  const canvas=document.createElement('canvas');canvas.id='candidateMapCanvas';canvas.setAttribute('aria-label','候補の位置。下の候補選択欄でも選べます。');Object.assign(canvas.style,{width:'100%',height:'100%',display:'block',touchAction:'none'});wrap.append(canvas);
  const zoom=document.createElement('div');zoom.className='mapzoom';const plus=button('＋',()=>{}),minus=button('−',()=>{});plus.id='candidateMapZoomIn';minus.id='candidateMapZoomOut';plus.setAttribute('aria-label','地図を拡大');minus.setAttribute('aria-label','地図を縮小');zoom.append(plus,minus);wrap.append(zoom);mapPanel.append(wrap);
  const card=document.createElement('div');card.id='candidateMapCard';mapPanel.append(card);
  const select=document.createElement('select');select.id='candidateMapChoice';select.setAttribute('aria-label','地図の候補');Object.assign(select.style,{width:'100%',fontSize:'16px',minHeight:'44px',marginTop:'12px'});select.onchange=()=>chooseMap(select.value);card.append(select);
  const detail=document.createElement('p');detail.id='candidateMapDetail';detail.className='tiny';detail.setAttribute('role','status');card.append(detail);
  const use=button('見え方を確認',()=>{const e=mapSelection();if(!currentEntry(e)){detail.textContent='条件が変わりました。一覧に戻って候補を確認してください。';return;}e.node.click();});use.id='candidateMapUse';card.append(use);
  const back=button('一覧に戻る',()=>{wrap._mapShell?.setWide(false);showMap(false);});back.hidden=true;card.append(back);
  new MutationObserver(()=>{const wide=wrap.classList.contains('sky-map-wide'),footer=wrap.querySelector('.shared-map-footer');back.hidden=!wide;if(wide&&footer){footer.hidden=false;if(card.parentNode!==footer)footer.append(card);}else if(card.parentNode!==mapPanel)mapPanel.append(card);}).observe(wrap,{attributes:true,attributeFilter:['class']});
 }
 if(mapPanel.parentNode!==control)control.append(mapPanel);
 if(!mapInstance){mapInstance=ports.createMapView({canvas:'candidateMapCanvas',zoomIn:'candidateMapZoomIn',zoomOut:'candidateMapZoomOut'});mapInstance.setOverlay(drawMap);mapInstance.onPick((_point,pixel)=>{
  const hits=visibleEntries.filter(currentEntry).map(e=>{const q=mapInstance.project(e.row.place.latitude,e.row.place.longitude);return {x:q[0],y:q[1],id:e.id};}).filter(h=>Math.hypot(h.x-pixel.x,h.y-pixel.y)<=24).sort((a,b)=>Math.hypot(a.x-pixel.x,a.y-pixel.y)-Math.hypot(b.x-pixel.x,b.y-pixel.y));
  if(!hits.length)return;const nearest=hits[0],cluster=hits.filter(h=>Math.hypot(h.x-nearest.x,h.y-nearest.y)<3),at=cluster.findIndex(h=>h.id===selectedId);chooseMap(cluster[(at+1)%cluster.length].id);
 });}
}
function showMap(on){
 if(!control)return false;if(on&&(!visibleEntries.length||typeof ports.createMapView!=='function'))return false;
 const scrollHost=ports.getScroller?.()||control.closest('[role=tabpanel]')||control.closest('dialog'),toggle=control.querySelector('#candidateMapToggle');
 if(on){mapScroll={node:scrollHost,top:scrollHost?.scrollTop||0};ensureMap();mapMode=true;mapPanel.hidden=false;list.hidden=true;control.querySelector('[data-candidate-headers]').hidden=true;toggle.textContent='一覧に戻る';toggle.setAttribute('aria-expanded','true');mapFitPending=true;refreshMap();mapPanel.scrollIntoView?.({block:'nearest'});}
 else{mapMode=false;if(mapPanel){mapPanel.querySelector('.mapwrap')?._mapShell?.setWide(false);mapPanel.hidden=true;}if(list)list.hidden=false;control.querySelector('[data-candidate-headers]').hidden=false;toggle.textContent='地図で見る';toggle.setAttribute('aria-expanded','false');const saved=mapScroll,expected=scope;if(saved?.node)requestAnimationFrame(()=>{if(!mapMode&&scope===expected&&saved.node.isConnected)saved.node.scrollTop=saved.top;});}
 return true;
}
function refreshMap(){
 if(!mapMode||!mapInstance)return;
 if(!mapSelection())selectedId=visibleEntries[0]?.id??null;
 const select=mapPanel.querySelector('#candidateMapChoice'),signature=JSON.stringify(visibleEntries.map(e=>[e.id,e.row.place.name,e.row.event?.at]));
 if(select.dataset.signature!==signature){select.replaceChildren();visibleEntries.forEach((e,i)=>select.add(new Option(`${i+1}. ${e.row.place.name} ・ ${clockText(e.row.event?.at)}`,e.id)));select.dataset.signature=signature;}
 select.value=selectedId||'';const e=mapSelection();
 const detail=mapPanel.querySelector('#candidateMapDetail');if(e){const obs=e.row.assumedObserver,p=e.row.place,base=Number.isFinite(obs?.elevation)?obs.elevation:p.groundManualM??p.elevation,eye=Number.isFinite(obs?.eyeM)?obs.eyeM:p.standAglM??p.eyeHeightAGL;detail.textContent=e.types.map(t=>names[t]).join('・')+' ・ '+clockText(e.row.event?.at)+(Number.isFinite(base)&&Number.isFinite(eye)?' ・ 撮影位置の標高 '+(base+eye).toFixed(1)+'m':' ・ 高さ未確認')+uncertainty(e.row).map(s=>' ・ '+s).join('');}
 mapPanel.querySelector('#candidateMapUse').disabled=!currentEntry(e);
 if(mapFitPending){mapFitPending=false;const ps=visibleEntries.map(e=>e.row.place).filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));if(ps.length){const lat0=Math.min(...ps.map(p=>p.latitude)),lat1=Math.max(...ps.map(p=>p.latitude)),lon0=Math.min(...ps.map(p=>p.longitude)),lon1=Math.max(...ps.map(p=>p.longitude)),lat=(lat0+lat1)/2,lon=(lon0+lon1)/2,cv=mapPanel.querySelector('canvas'),dx=Math.max(.00001,(lon1-lon0)/360),dy=Math.max(.00001,(lat1-lat0)/(360*Math.cos(lat*Math.PI/180))),z=Math.min(17,Math.log2(Math.max(160,cv.clientWidth)*.7/(256*dx)),Math.log2(Math.max(200,cv.clientHeight)*.7/(256*dy)));mapInstance.open({latitude:lat,longitude:lon},z);}}
 mapInstance.redraw();
}
function drawMap(ctx,{project,width,height}){
 mapHits=[];if(!mapMode)return;const selected=mapSelection();
 ctx.save();ctx.font='600 13px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
 if(selected&&currentEntry(selected)){
  const p=selected.row.place,t=selected.group.plan.target;
  if(t&&Number.isFinite(t.latitude)&&Number.isFinite(t.longitude)){const a=project(p.latitude,p.longitude),b=project(t.latitude,t.longitude);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.strokeStyle='#f4bb44';ctx.lineWidth=3;ctx.stroke();
   const top=64,off=b[0]<24||b[0]>width-24||b[1]<top||b[1]>height-24,origin=a[0]>=24&&a[0]<=width-24&&a[1]>=top&&a[1]<=height-24?a:[width/2,height/2],dx=b[0]-origin[0],dy=b[1]-origin[1],scale=off?Math.min(1,dx>0?(width-24-origin[0])/dx:dx<0?(24-origin[0])/dx:Infinity,dy>0?(height-24-origin[1])/dy:dy<0?(top-origin[1])/dy:Infinity):1,tx=off?origin[0]+dx*scale:b[0],ty=off?origin[1]+dy*scale:b[1];ctx.beginPath();ctx.arc(tx,ty,7,0,Math.PI*2);ctx.fillStyle='#bc7cff';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#fff';ctx.strokeStyle='#222';ctx.lineWidth=4;let label=(off?'対象方向：':'')+(t.name||'対象');const maxLabelWidth=Math.max(20,width-20);if(ctx.measureText(label).width>maxLabelWidth){while(label.length&&ctx.measureText(label+'…').width>maxLabelWidth)label=label.slice(0,-1);label+='…';}const half=ctx.measureText(label).width/2+5,labelX=Math.max(half,Math.min(width-half,tx)),labelY=Math.max(14,Math.min(height-14,ty+(ty<84||ty>=a[1]?20:-20)));ctx.strokeText(label,labelX,labelY);ctx.fillText(label,labelX,labelY);
  }
 }
 visibleEntries.map((e,i)=>({e,i})).sort((a,b)=>Number(a.e.id===selectedId)-Number(b.e.id===selectedId)).forEach(({e,i})=>{if(!currentEntry(e))return;const p=e.row.place;if(!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude))return;const [x,y]=project(p.latitude,p.longitude);if(x<-24||x>width+24||y<-24||y>height+24)return;mapHits.push({x,y,id:e.id});ctx.beginPath();ctx.arc(x,y,e.id===selectedId?16:13,0,Math.PI*2);ctx.fillStyle=e.id===selectedId?'#176cc5':'#273b52';ctx.fill();ctx.lineWidth=e.id===selectedId?3:2;ctx.strokeStyle='#fff';ctx.stroke();ctx.fillStyle='#fff';ctx.fillText(String(i+1),x,y);});ctx.restore();
}
// Keep UI preferences and a valid return position, never old executable rows.
function suspend(){
 if(!control?.isConnected)return;
 const scroller=ports.getScroller?.()||control.closest('.sheet-body')||control.closest('[role=tabpanel]');
 suspendedView={scope,selectedId,mapMode,scrollTop:scroller?.scrollTop||0};
 if(mapPanel)mapPanel.querySelector('.mapwrap')?._mapShell?.setWide(false);
 revision++;for(const g of groups.values())for(const node of g.nodes)node.remove();groups.clear();visibleEntries=[];mapHits=[];mapMode=false;if(mapPanel)mapPanel.hidden=true;control.remove();
}
function reset(){if(mapPanel)mapPanel.querySelector('.mapwrap')?._mapShell?.setWide(false);revision++;groups.clear();windows.clear();visibleEntries=[];selectedId=null;mapHits=[];mapMode=false;if(mapPanel)mapPanel.hidden=true;control?.remove();control=null;list=null;scope='';filterScope='';mapScroll=null;suspendedView=null;}
const api={mount,configure,registerRegistered:register,registerAdditional:register,unregister,apply,kinds,accepts,compare,showMap,suspend,reset,visibleRows:()=>visibleEntries.filter(currentEntry).map(e=>e.row)};
globalThis.AstroNotesCandidatePicker=api;
if(typeof module!=='undefined')module.exports={kinds,accepts,compare,candidateKey,mergeEntries,placePriority};
})();
