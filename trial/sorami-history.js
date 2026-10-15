/* Bounded, browser-local history. No network or account synchronization. */
const SoramiHistory = (() => {
 const safeText=(v,n=200)=>typeof v==='string'&&v.length<=n&&!/[\u0000-\u001f]/u.test(v);
 const coord=p=>p&&Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180;
 function place(p){
  if(!coord(p)||!safeText(p.name))return null;
  const out={id:safeText(p.id)?p.id:`recent:${p.latitude},${p.longitude}`,name:p.name,latitude:p.latitude,longitude:p.longitude};
  for(const k of ['subtitle','terrain','locationScope','structureFrom','wikidata','lookout','stand'])if(p[k]===null||safeText(p[k]))out[k]=p[k];
  for(const k of ['elevation','structureM','targetHeightM','groundManualM'])if(p[k]===null||Number.isFinite(p[k])&&p[k]>=-500&&p[k]<=10000)out[k]=p[k];
  for(const k of ['eyeHeightAGL','standAglM'])if(p[k]===null||Number.isFinite(p[k])&&p[k]>=0&&p[k]<=700)out[k]=p[k];
  if(out.terrain&&!['summit','basinRim','basinFloor','plain','coast'].includes(out.terrain))delete out.terrain;
  if(Array.isArray(p.decks))out.decks=p.decks.slice(0,16).filter(d=>d&&safeText(d.name)&&Number.isFinite(d.aglM)&&d.aglM>=0&&d.aglM<=700).map(d=>({name:d.name,aglM:d.aglM}));
  return out;
 }
 function create({read,write,validatePlan,now=Date.now,limit=30,scope=()=>'guest'}){
  const key=()=>`sorami.recent.v1:${encodeURIComponent(scope())}`;let state={places:[],plans:[]},undo=null;
  const clean=(kind,row)=>{if(!row||!Number.isFinite(row.usedAt))return null;const value=kind==='places'?place(row.value):validatePlan(row.value);return value?{value,usedAt:row.usedAt}:null;};
  function reload(){const s=read(key(),null);state={};for(const k of ['places','plans'])state[k]=(Array.isArray(s?.[k])?s[k]:[]).map(r=>clean(k,r)).filter(Boolean).sort((a,b)=>b.usedAt-a.usedAt).slice(0,limit);}
  reload();
  const identity=(kind,v)=>kind==='places'?`${v.latitude},${v.longitude}`:JSON.stringify([v.t,v.o,v.body,v.part,v.limb,Math.floor((v.at+32400000)/86400000)]);
  const save=next=>{if(!write(key(),next))return false;state=next;return true;};
  function add(kind,value,{derived=false}={}){value=kind==='places'?place(value):validatePlan(value);if(!value)return false;reload();const id=identity(kind,value);if(kind==='places'&&derived){const old=state.places.find(r=>identity(kind,r.value)===id);if(old)value={...value,...old.value};}return save({...state,[kind]:[{value,usedAt:now()},...state[kind].filter(r=>identity(kind,r.value)!==id)].slice(0,limit)});}
  function remove(kind,item){reload();const index=typeof item==='number'?item:state[kind]?.findIndex(r=>identity(kind,r.value)===identity(kind,item.value));if(!state[kind]?.[index])return true;const removed=state[kind][index],next={...state,[kind]:state[kind].filter((r,i)=>i!==index)};if(!save(next))return false;undo={kind,rows:[removed],scope:scope()};return true;}
  function clear(kind){reload();if(!['places','plans'].includes(kind))return false;const rows=state[kind];if(!save({...state,[kind]:[]}))return false;undo={kind,rows,scope:scope()};return true;}
  function restore(){if(!undo||undo.scope!==scope())return false;reload();const {kind,rows}=undo,ids=new Set(rows.map(r=>identity(kind,r.value)));const list=[...rows,...state[kind].filter(r=>!ids.has(identity(kind,r.value)))].sort((a,b)=>b.usedAt-a.usedAt).slice(0,limit);if(!save({...state,[kind]:list}))return false;undo=null;return true;}
  return {add,remove,clear,restore,list(kind){reload();return state[kind].map(r=>JSON.parse(JSON.stringify(r)));},canUndo:()=>!!undo&&undo.scope===scope(),undoKind:()=>undo?.scope===scope()?undo.kind:null};
 }
 return {create,place};
})();
if(typeof module!=='undefined')module.exports=SoramiHistory;
