// Trial-only list operations. These never generate or promote a candidate.
(()=>{
'use strict';
const names={park:'公園',garden:'庭園',viewpoint:'展望地点',road:'道路・歩道',facility:'その他の施設',unknown:'種類未確認'};
function kinds(row,facilities){
 const result=new Set(),ids=row.labels?.facility?.status==='matched'?row.labels.facility.sourceIds:globalThis.AstroNotesCandidateLabels?.resolve(facilities,row.place,'osm-named-areas')?.sourceIds;
 for(const f of facilities?.features||[]){if(!ids?.includes(f.id))continue;const t=f.tags||{};result.add(t.leisure==='park'?'park':t.leisure==='garden'?'garden':t.tourism==='viewpoint'?'viewpoint':'facility');}
 if(row.assumedObserver?.sourceId&&row.modelEvidence?.kind==='terrain-and-building-model-los')result.add('road');
 return result.size?[...result]:['unknown'];
}
function accepts(row,time,kind,types,events){return (kind==='all'||types.includes(kind))&&(time==='all'||Number.isFinite(row.event?.at)&&!!events?.some(e=>e.kind===time&&Math.abs(row.event.at-e.at)<=3600000));}
function compare(a,b,sort){
 const key=sort.replace(/-desc$/,''),direction=sort.endsWith('-desc')?-1:1;
 const primary=key==='name'?String(a.row.place?.name||'').localeCompare(String(b.row.place?.name||''),'ja',{numeric:true}):key==='kind'?Object.keys(names).indexOf(a.types[0])-Object.keys(names).indexOf(b.types[0]):a.row.event.at-b.row.event.at;
 return direction*primary||(a.row.event.at-b.row.event.at)||a.index-b.index;
}
const columns='minmax(0,1fr) 56px 76px';
function formatRow(node,row,types){
 if(!node.hasAttribute('data-candidate-columns')){
  // Preserve the renderer's supplementary information and its click handler.
  const notes=[...node.querySelectorAll('.sub-line')].filter(n=>!n.hasAttribute('data-place-kind')).map(n=>n.textContent.replace(/^\d{2}:\d{2}・/,'').replace(/ · \d{2}:\d{2}/,''));
  node.replaceChildren();node.dataset.candidateColumns='';
  Object.assign(node.style,{display:'grid',gridTemplateColumns:columns,columnGap:'8px',rowGap:'4px',alignItems:'start',textAlign:'left',padding:'12px 0',minHeight:'44px'});
  const title=document.createElement('span');title.textContent=row.place.name;Object.assign(title.style,{minWidth:'0',overflowWrap:'anywhere',fontSize:'14px',fontWeight:'600'});
  const clock=document.createElement('span');clock.textContent=new Date(row.event.at+32400000).toISOString().slice(11,16);Object.assign(clock.style,{fontSize:'14px',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'});
  const kind=document.createElement('span');kind.dataset.placeKind='';Object.assign(kind.style,{fontSize:'14px',minWidth:'0',overflowWrap:'anywhere'});node.append(title,clock,kind);
  if(notes.length){const detail=document.createElement('span');detail.className='tiny sub-line';detail.textContent=notes.join(' · ');Object.assign(detail.style,{gridColumn:'1 / -1',whiteSpace:'normal',overflowWrap:'anywhere'});node.append(detail);}
 }
 node.querySelector('[data-place-kind]').textContent=types.map(t=>names[t]).join('・');
}
function updateHeaders(){
 const key=sort.replace(/-desc$/,''),descending=sort.endsWith('-desc');
 for(const button of control?.querySelectorAll('[data-candidate-sort]')||[]){const active=button.dataset.candidateSort===key;button.textContent=button.dataset.label+(active?(descending?' ↓':' ↑'):' ↕');button.setAttribute('aria-label',button.dataset.label+(active?'、現在は'+(descending?'降順':'昇順')+'。':'。')+(active&&!descending?'降順':'昇順')+'に並べ替え');button.setAttribute('aria-pressed',String(active));button.style.color=active?'var(--accent)':'var(--secondary)';}
}

const groups=new Map(),windows=new Map();let control=null,scope='',revision=0,loadLabels=async()=>({}),time='all',kind='all',sort='time';
function mount(panel,plan){
 const next=JSON.stringify([plan.owner,plan.body,plan.target,plan.partId,plan.limb,plan.matchMode,plan.composition,plan.compositionInvalid,globalThis.AstroNotesCandidateDiscovery.day(plan.at),plan.atmosphere]);
 if(next!==scope){const previous=scope;for(const [box,g]of groups)for(const node of g.nodes)node.remove();scope=next;time=kind='all';sort='time';groups.clear();windows.clear();revision++;control?.remove();control=null;if(previous)queueMicrotask(()=>{if(scope===next&&panel.isConnected)globalThis.MyPlacesUI?.renderPickerPanel(panel);});}
 if(!control?.isConnected){control=document.createElement('section');control.id='candidateListControls';control.className='aim-disclosure';Object.assign(control.style,{padding:'12px 0',marginTop:'12px'});control.setAttribute('aria-label','この日の候補の絞り込みと並び順');
  const add=(label,id,options,value,change)=>{const l=document.createElement('label');l.className='tiny';Object.assign(l.style,{display:'grid',gridTemplateColumns:'76px minmax(0,1fr)',alignItems:'center',gap:'12px',margin:'0 0 8px',fontSize:'14px'});l.textContent=label;const s=document.createElement('select');s.id=id;s.setAttribute('aria-label',label);Object.assign(s.style,{width:'100%',minWidth:'0',maxWidth:'100%',minHeight:'44px',margin:'0',fontSize:'16px'});for(const [v,n]of options)s.add(new Option(n,v));s.value=value;s.onchange=()=>{change(s.value);apply();};l.append(s);control.append(l);};
  add('時間帯','candidateTimeFilter',[['all','すべての時間'],['rise','出の前後1時間'],['set','入の前後1時間']],time,v=>time=v);
  add('場所の種類','candidateKindFilter',[['all','すべての種類'],...Object.entries(names)],kind,v=>kind=v);
  const status=document.createElement('p');status.className='tiny';status.dataset.filterStatus='';status.setAttribute('role','status');status.style.margin='12px 0 0';control.append(status);
  const header=document.createElement('div');header.dataset.candidateHeaders='';header.setAttribute('role','group');header.setAttribute('aria-label','候補の並べ替え');Object.assign(header.style,{display:'grid',gridTemplateColumns:columns,gap:'8px',borderBottom:'1px solid var(--line)',marginTop:'8px'});
  for(const [key,label]of [['name','地点'],['time','時刻'],['kind','種類']]){const button=document.createElement('button');button.type='button';button.dataset.candidateSort=key;button.dataset.label=label;Object.assign(button.style,{minWidth:'0',minHeight:'44px',padding:'8px 0',border:'0',borderRadius:'0',background:'transparent',boxShadow:'none',textAlign:'left',fontSize:'14px',fontWeight:'600',whiteSpace:'nowrap'});button.onclick=()=>{sort=sort===key?key+'-desc':key;updateHeaders();apply();};header.append(button);}
  control.append(header);updateHeaders();
 }
 if(panel.firstElementChild!==control)panel.prepend(control);
}
async function apply(){
 const token=++revision,selection={time,kind,sort},status=control?.querySelector('[data-filter-status]');if(!status)return;
 status.hidden=false;status.textContent='候補の絞り込みを確認しています…';
 const labels=[...groups.values()].some(g=>g.rows.length)?await loadLabels():{};if(token!==revision||!control?.isConnected)return;
 let total=0,visible=0,unknownTime=0;
 for(const [box,g]of groups){if(!box.isConnected||!g.current()){for(const node of g.nodes)node.remove();groups.delete(box);continue;}
  const entries=[];for(let i=0;i<g.rows.length;i++){
   const row=g.rows[i],node=g.nodes[i];if(!node||!box.contains(node))continue;
   const types=kinds(row,labels.facilities);let events=null;
   if(selection.time!=='all'){
    const obs=row.assumedObserver,key=JSON.stringify([g.plan.body,globalThis.AstroNotesCandidateDiscovery.day(g.plan.at),obs,g.plan.atmosphere]);
    if(obs&&[obs.latitude,obs.longitude,obs.elevation].every(Number.isFinite)){
     if(!windows.has(key)){try{await AstroNotesBodies.ensure(g.plan.body);if(token!==revision||!g.current())return;windows.set(key,AstroNotesCandidateComposition.windowEvents({...g.plan,timeWindow:{kind:'both',beforeMin:60,afterMin:60}},obs,AstroNotesBodies));}catch{windows.set(key,null);}}
     events=windows.get(key);
    }
    if(!events)unknownTime++;
   }
   formatRow(node,row,types);const show=accepts(row,selection.time,selection.kind,types,events);node.hidden=!show;node.style.display=show?'grid':'none';node.dataset.candidateKinds=types.join(',');
   entries.push({row,node,types,index:i});total++;if(show)visible++;
   if(i%12===11){await new Promise(r=>setTimeout(r,0));if(token!==revision||!g.current())return;}
  }
  entries.sort((a,b)=>compare(a,b,selection.sort));for(const e of entries)box.append(e.node);
 }
 if(token===revision){status.hidden=!total;status.textContent=`${visible} / ${total}件を表示`+(unknownTime?`。出入り時刻を確認できない${unknownTime}件は時間帯の絞り込みから除外しています。`:'')+(total&&!labels.facilities?'。種類データを読み込めない地点は種類未確認です。':'');}
}
function register(box,rows,plan,current){groups.set(box,{rows,plan,current,nodes:[...box.children].filter(n=>n.tagName==='BUTTON'&&n.classList.contains('list-item'))});apply();}
globalThis.AstroNotesCandidatePicker={mount,configure:f=>loadLabels=f,registerRegistered:register,registerAdditional:register,apply,kinds,accepts,compare};
if(typeof module!=='undefined')module.exports={kinds,accepts,compare};
})();
