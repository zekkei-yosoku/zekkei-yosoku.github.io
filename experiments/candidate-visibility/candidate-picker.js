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
function compare(a,b,sort){return (sort==='kind'?Object.keys(names).indexOf(a.types[0])-Object.keys(names).indexOf(b.types[0]):0)||(a.row.event.at-b.row.event.at)||a.index-b.index;}
const groups=new Map(),windows=new Map();let control=null,scope='',revision=0,loadLabels=async()=>({}),time='all',kind='all',sort='time';
function mount(panel,plan){
 const next=JSON.stringify([plan.owner,plan.body,plan.target,plan.partId,plan.limb,plan.matchMode,plan.composition,plan.compositionInvalid,globalThis.AstroNotesCandidateDiscovery.day(plan.at),plan.atmosphere]);
 if(next!==scope){const previous=scope;for(const [box,g]of groups)for(const node of g.nodes)node.remove();scope=next;time=kind='all';sort='time';groups.clear();windows.clear();revision++;control?.remove();control=null;if(previous)queueMicrotask(()=>{if(scope===next&&panel.isConnected)globalThis.MyPlacesUI?.renderPickerPanel(panel);});}
 if(!control?.isConnected){control=document.createElement('section');control.id='candidateListControls';control.className='aim-disclosure';control.setAttribute('aria-label','この日の候補の絞り込みと並び順');
  const title=document.createElement('strong');title.textContent='この日の候補を絞り込む';control.append(title);
  const add=(label,id,options,value,change)=>{const l=document.createElement('label');l.className='tiny';l.style.display='block';l.textContent=label+' ';const s=document.createElement('select');s.id=id;s.setAttribute('aria-label',label);Object.assign(s.style,{maxWidth:'100%',minHeight:'44px'});for(const [v,n]of options)s.add(new Option(n,v));s.value=value;s.onchange=()=>{change(s.value);apply();};l.append(s);control.append(l);};
  add('時間帯','candidateTimeFilter',[['all','すべての時間'],['rise','出の前後1時間'],['set','入の前後1時間']],time,v=>time=v);
  add('場所の種類','candidateKindFilter',[['all','すべての種類'],...Object.entries(names)],kind,v=>kind=v);
  add('並び順','candidateListSort',[['time','時刻順'],['kind','種類順']],sort,v=>sort=v);
  const help=document.createElement('p');help.className='tiny';help.textContent='一覧の候補を絞ります。探索はやり直しません。出・入は各候補地点の平らな地平線での時刻です。種類は地図データにある区域に基づき、利用可否は保証しません。種類未確認も選べます。';const credit=document.createElement('a');credit.href='https://www.openstreetmap.org/copyright';credit.target='_blank';credit.rel='noopener';credit.textContent=' © OpenStreetMap contributors';help.append(credit);control.append(help);
  const status=document.createElement('p');status.className='tiny';status.dataset.filterStatus='';status.setAttribute('role','status');control.append(status);
 }
 if(panel.firstElementChild!==control)panel.prepend(control);
}
async function apply(){
 const token=++revision,selection={time,kind,sort},status=control?.querySelector('[data-filter-status]');if(!status)return;
 status.textContent='候補の絞り込みを確認しています…';
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
   const show=accepts(row,selection.time,selection.kind,types,events);node.hidden=!show;node.style.display=show?'':'none';node.dataset.candidateKinds=types.join(',');
   let tag=node.querySelector('[data-place-kind]');if(!tag){tag=document.createElement('span');tag.className='tiny sub-line';tag.dataset.placeKind='';node.append(tag);}tag.textContent=types.map(t=>names[t]).join('・');
   entries.push({row,node,types,index:i});total++;if(show)visible++;
   if(i%12===11){await new Promise(r=>setTimeout(r,0));if(token!==revision||!g.current())return;}
  }
  entries.sort((a,b)=>compare(a,b,selection.sort));for(const e of entries)box.append(e.node);
 }
 if(token===revision)status.textContent=`${visible} / ${total}件を表示`+(unknownTime?`。出入り時刻を確認できない${unknownTime}件は時間帯の絞り込みから除外しています。`:'')+(!labels.facilities?'。種類データを読み込めない地点は種類未確認です。':'');
}
function register(box,rows,plan,current){groups.set(box,{rows,plan,current,nodes:[...box.children].filter(n=>n.tagName==='BUTTON'&&n.classList.contains('list-item'))});apply();}
globalThis.AstroNotesCandidatePicker={mount,configure:f=>loadLabels=f,registerRegistered:register,registerAdditional:register,apply,kinds,accepts,compare};
if(typeof module!=='undefined')module.exports={kinds,accepts,compare};
})();
