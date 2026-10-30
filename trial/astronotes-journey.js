/* Trial: saved plans are immutable comparison anchors, never a second data store. */
(function(g){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
function create(){
 let saved=null;
 const forget=()=>{saved=null;};
 const remember=(row,owner)=>{if(!row?.id||!row.value||!owner?.loginId||!Number.isFinite(owner.generation)){forget();return false;}saved={row:clone(row),owner:{...owner},stamp:JSON.stringify(row)};return true;};
 const current=(owner,rows)=>{if(!saved)return null;if(!owner||owner.loginId!==saved.owner.loginId||owner.generation!==saved.owner.generation||!rows.some(r=>r.id===saved.row.id&&JSON.stringify(r)===saved.stamp)){forget();return null;}return clone(saved.row);};
 return {remember,current,forget};
}
function dayLabel(row,now=Date.now()){
 if(row.end<now)return '過ぎた予定';
 const day=ms=>Math.floor((ms+32400000)/86400000),d=day(row.start)-day(now);
 return row.start<=now?'撮影時間内':d===0?'今日':d===1?'明日':d<100?'あと'+d+'日':new Date(row.start+32400000).getUTCFullYear()+'年';
}
const api={create,dayLabel};g.AstroNotesJourney=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(typeof document==='undefined')return;
const state=create(),$=id=>document.getElementById(id);
const card=document.createElement('section');card.id='journeyPlan';card.className='journey-plan';card.hidden=true;card.setAttribute('aria-label','保存した撮影予定');
const head=document.createElement('div');head.className='journey-heading';
const label=document.createElement('span');label.className='tiny';
const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='journey-dismiss';dismiss.textContent='×';dismiss.setAttribute('aria-label','予定の比較を閉じる');head.append(label,dismiss);
const title=document.createElement('strong'),detail=document.createElement('p');detail.className='tiny journey-detail';
const actions=document.createElement('div');actions.className='journey-actions';
const resume=document.createElement('button');resume.type='button';resume.className='chip primary';
const list=document.createElement('button');list.type='button';list.className='chip';list.textContent='予定一覧';actions.append(resume,list);card.append(head,title,detail,actions);
let shown=null,cardKey='',dismissed='';
const owner=()=>auth?.token&&toolAllowed('records')?{loginId:auth.loginId,generation:accessState.generation}:null;
let cachedOwner='',cachedRaw=null,cachedRows=[];
const rows=()=>{const who=owner();if(!who){cachedOwner='';cachedRaw=null;cachedRows=[];return cachedRows;}const key=JSON.stringify(who);let raw;try{raw=localStorage.getItem(AstroNotesSchedule.KEY+encodeURIComponent(who.loginId));}catch{raw=null;}if(key!==cachedOwner||raw!==cachedRaw){cachedRows=schedule().list();cachedRaw=raw;cachedOwner=key;}return cachedRows;};
const notice=document.createElement('p');notice.id='journeyNotice';notice.className='warn';notice.hidden=true;notice.setAttribute('role','status');
api.notice=text=>{notice.textContent=text;notice.hidden=!text;const parent=$('exploreConditions');if(parent&&notice.nextSibling!==parent)parent.before(notice);};
api.forget=state.forget;

function render(){
 const who=owner(),plans=rows(),anchor=state.current(who,plans),active=globalThis.TrialExplore?.active();
 if(!who||!active){card.hidden=true;notice.hidden=true;notice.textContent='';shown=null;cardKey='';return;}
 const next=plans.find(r=>r.end>=Date.now()&&!notebookPlanIssue(r.value));
 const row=anchor||next;
 if(anchor&&notebookPlanIssue(anchor.value))state.forget();
 if(!row||notebookPlanIssue(row.value)||(!anchor&&dismissed===who.loginId)){card.hidden=true;shown=null;cardKey='';return;}
 const parent=$('exploreConditions');if(parent&&card.nextSibling!==(notice.parentNode?notice:parent))(notice.parentNode?notice:parent).before(card);
 const kind=anchor?'anchor':'next',key=JSON.stringify([who,row,kind,dayLabel(row)]);
 shown=row;card.hidden=false;if(key===cardKey)return;cardKey=key;
 label.textContent=anchor?'保存した予定と見比べる':dayLabel(row)+'の予定';
 title.textContent=row.title||row.value.t.name+' × '+(AstroNotesBodies.definition(row.value.body)?.name||row.value.body);
 detail.textContent=AstroNotesPlan.dateTime(row.value.at)+' ・ '+row.value.o[0]+(Math.abs(row.start-row.value.at)>1000?'\n予定の開始 '+AstroNotesPlan.dateTime(row.start):'');
 resume.textContent=anchor?'保存した構図へ戻る':'予定を開く';dismiss.hidden=false;
}
api.remember=(row,who)=>{dismissed='';return state.remember(row,who);};api.render=render;
api.current=()=>{const r=state.current(owner(),rows());if(r&&notebookPlanIssue(r.value)){state.forget();return null;}return r;};
resume.onclick=async()=>{const row=shown,who=owner();if(!row||!who)return;resume.disabled=true;try{await openNotebookPlan(row);}finally{resume.disabled=false;render();}};
list.onclick=()=>{if(owner())showNotebookPlans();};
dismiss.onclick=()=>{if(shown&&owner())dismissed=owner().loginId;state.forget();render();};
// Sync and account changes invalidate anchors before the next user action.
g.addEventListener('sorami:records-synced',render);
g.addEventListener('pageshow',render);
let queued=false;
new MutationObserver(records=>{if(records.every(r=>card.contains(r.target)||notice.contains(r.target)))return;if(queued)return;queued=true;queueMicrotask(()=>{queued=false;render();});}).observe($('skyMapView'),{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class']});
const style=document.createElement('style');style.textContent=`
.journey-plan{max-width:780px;border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin:0 0 12px;background:var(--card)}
.journey-plan[hidden]{display:none!important}.journey-plan>strong{display:block;font-size:15px;overflow-wrap:anywhere}.journey-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:24px;margin-bottom:4px;color:var(--secondary)}
.journey-dismiss{width:44px;height:44px;min-height:44px;padding:0;border:0;background:transparent;color:var(--secondary);font-size:22px;margin:-10px -10px -10px 0}.journey-detail{white-space:pre-line;overflow-wrap:anywhere;margin:6px 0 10px}.journey-actions{display:flex;flex-wrap:wrap;gap:8px}.journey-actions button{min-height:44px;flex:1 1 130px}
.journey-place-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;border-bottom:1px solid var(--line);padding:4px 0}.journey-place-row>.my-place-row{flex:1 1 170px;border-bottom:0;min-width:0}.journey-place-find{min-height:44px;margin:4px 0 8px auto;flex:0 0 auto}
#myPlaceSheet[data-planning-only=true] .sheet-body>:not(#myPlanningPlace):not(#myPlacePlanning):not(#myPlaceDetails):not(#myRecordError){display:none!important}
#myPlaceSheet[data-planning-only=true] #myPlacePlanning>summary{display:none}#myPlaceSheet[data-planning-only=true] #myPlacePlanning{border:0;margin:4px 0}#myPlaceSheet .journey-planning-place{font-weight:600;overflow-wrap:anywhere;margin:10px 0 18px}#myPlanningPlace[hidden]{display:none}
#planOpenNotebook{min-height:44px;margin-top:8px}#planOpenNotebook[hidden]{display:none}
@media(max-width:360px){.journey-place-row>.my-place-row{flex-basis:100%}.journey-actions{gap:6px}.journey-actions button{font-size:12px}}
`;
document.head.append(style);render();
})(typeof globalThis!=='undefined'?globalThis:window);
