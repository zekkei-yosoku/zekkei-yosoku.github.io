// This code runs inside the existing MyPlacesUI closure in the trial only.
const opportunityDateAt=at=>new Date(at+32400000).toISOString().slice(0,10);
const opportunityBounds=date=>{const [y,m,d]=date.split('-').map(Number),start=Date.UTC(y,m-1,d)-32400000;return [start,start+86400000];};
const opportunityPageRows=8;
const opportunityPageEnd=start=>Math.max(start,Math.min(aimCandidateSearchEnd(),start+7*DAY));
let opportunityDateChosen=false;
let opportunityOwner=null,opportunityOwnerId=null,opportunityEpoch=0,opportunityJob=null,opportunityHost=null,opportunityDom=null,opportunityReturn=null,opportunityOpenSeq=0,opportunityInputEpoch=0;
let opportunityPermittedBodies=[],opportunityPlaces=[],opportunityPicker=null,opportunityNotice='';
let opportunityFilters={date:opportunityDateAt(Date.now()),bodies:['sun','moon'],allBodies:false,places:[],allPlaces:true},opportunityRestore=null;
const opportunityCache=new Map();
let opportunityPairMemo=null;
const opportunityAirKey=()=>JSON.stringify([aimAirSettings,AstroNotesAtmosphere.dataKey()]);
const opportunityAllowed=()=>!!auth?.token&&toolAllowed('records');
const opportunityActive=()=>opportunityAllowed()&&!document.hidden&&!el('recordsView')?.hidden&&el('recordsView')?.dataset.tab==='opportunities';
function opportunityPairs(bodies){
 const {groups,shapes}=recordSearchIndex(),pairs=[],unavailable=[];
 for(const favorite of favorites){
  const targets=groups.get(favorite.id);if(!targets)continue;
  const shape=recordSearchShape(favorite,shapes),saved=shape?{...favorite,shape}:favorite;
  for(const [targetKey,source] of targets){
   const group=source.slice().sort((a,b)=>Number(!!b.registration)-Number(!!a.registration)||when(b)-when(a)||b.updatedAt-a.updatedAt);
   const best=statusOf(favorite.id,targetKey,source);if(!best||best.result==='hidden')continue;
   const target=resolveTarget(targetKey),seen=new Set(),heightRange=RecordHeight.range(favorite.eyeHeightRangeAGL);if(favorite.eyeHeightRangeAGL!=null&&!heightRange){unavailable.push({placeId:favorite.id,targetKey,reason:'height'});continue;}if(target&&!recordMatchOpts(target,favorite)){unavailable.push({placeId:favorite.id,targetKey,reason:'alignment'});continue;}
   const savedTarget=best.target,targetMoved=target&&finite(savedTarget.latitude)&&finite(savedTarget.longitude)&&AstroNotesTerrain.distanceKm(savedTarget.latitude,savedTarget.longitude,target.latitude,target.longitude)>=NEAR_KM;
   if(!planningPairs([best],bodies).length){unavailable.push({placeId:favorite.id,targetKey,reason:'access'});continue;}if(!target||targetMoved){unavailable.push({placeId:favorite.id,targetKey,reason:'target'});continue;}
   for(const record of heightRange?[best]:group){
    if(record.removed||record.result==='hidden')continue;
    const o=heightRange?favorite:record.observer||favorite;if(!shape&&AstroNotesTerrain.distanceKm(o.latitude,o.longitude,favorite.latitude,favorite.longitude)>=NEAR_KM){continue;}const place={...saved,latitude:o.latitude,longitude:o.longitude,elevation:o.elevation??favorite.elevation,groundManualM:o.elevation??favorite.groundManualM??favorite.elevation,eyeHeightAGL:o.eyeHeightAGL??favorite.eyeHeightAGL??1.5};
    place.standAglM=place.eyeHeightAGL;place.stand='ground';
    const observerKey=JSON.stringify([place.latitude,place.longitude,place.groundManualM,place.eyeHeightAGL,place.shape,heightRange]);
    if(seen.has(observerKey))continue;seen.add(observerKey);
    for(const {body}of planningPairs([record],bodies)){
     const opts=recordMatchOpts(target,favorite,body);if(!opts)continue;const id=JSON.stringify([favorite.id,targetKey,observerKey,body,opts]);pairs.push({id,sourcePlaceId:favorite.id,place,record,target,body,...opts});
    }
   }
  }
 }
 return {pairs,unavailable};
}
function opportunitySignature(){const {records,shapes}=recordSearchIndex();return JSON.stringify([auth?.loginId,accessState.generation,version,favorites,records,shapes,aimTargetList(),aimAirSettings,AstroNotesAtmosphere.dataKey(),auth?.tools]);}
function opportunityPairSet(signature,bodies){
 if(opportunityPairMemo?.signature!==signature)opportunityPairMemo={signature,sets:new Map()};
 return recordBounded(opportunityPairMemo.sets,JSON.stringify(bodies),()=>opportunityPairs(bodies),4);
}
function opportunityRemember(job){
 if(!job?.scan||job.signature!==opportunitySignature())return;
 const {state}=job.scan;
 opportunityCache.set(job.key,{...state,rows:state.rows.slice(),pending:state.pending.slice(),failures:state.failures.slice()});
 while(opportunityCache.size>4)opportunityCache.delete(opportunityCache.keys().next().value);
}
function opportunityCancel(clear=false){if(clear)opportunityClosePicker();if(!clear)opportunityRemember(opportunityJob);opportunityEpoch++;opportunityJob=null;if(clear){opportunityPairMemo=null;opportunityCache.clear();opportunityHost?.replaceChildren();opportunityDom=null;opportunityReturn=null;opportunityRestore=null;opportunityNotice='';}}
function opportunityCurrent(job){return opportunityActive()&&opportunityJob===job&&job.epoch===opportunityEpoch&&job.owner===auth?.token&&job.loginId===auth?.loginId&&job.generation===accessState.generation&&job.inputEpoch===opportunityInputEpoch&&job.revision===version&&job.air===opportunityAirKey();}
function opportunityNode(tag,attrs={},text=''){const n=document.createElement(tag);Object.assign(n,attrs);n.textContent=text;return n;}
function opportunityClosePicker(){const picker=opportunityPicker;if(!picker)return;opportunityPicker=null;if(picker.dialog.open)picker.dialog.close();picker.dialog.remove();picker.trigger.setAttribute('aria-expanded','false');if(picker.trigger.isConnected&&opportunityActive())picker.trigger.focus({preventScroll:true});}
function opportunityPickerOptions(kind){return kind==='bodies'?AstroNotesBodies.definitions.filter(b=>opportunityPermittedBodies.includes(b.id)).map(b=>[b.id,b.name]):opportunityPlaces;}
function opportunityFilterLabel(kind){
 const options=opportunityPickerOptions(kind),all=kind==='bodies'?opportunityFilters.allBodies:opportunityFilters.allPlaces,ids=kind==='bodies'?opportunityFilters.bodies:opportunityFilters.places,selected=options.filter(([id])=>ids.includes(id));
 if(all)return 'すべて';
 if(!selected.length)return '選び直してください';
 if(selected.length===1)return selected[0][1];
 return kind==='bodies'&&selected.length===2?selected[0][1]+'・'+selected[1][1]:selected.length+(kind==='bodies'?'天体':'地点');
}
function opportunityPickerKey(kind){return JSON.stringify([auth?.loginId,accessState.generation,version,favorites,load(),shapeData(),aimTargetList(),auth?.tools,opportunityPickerOptions(kind)]);}
function opportunityOpenPicker(kind,trigger){
 if(!opportunityActive())return;opportunityClosePicker();opportunityNotice='';if(opportunityJob)opportunityDraw(opportunityJob);const options=opportunityPickerOptions(kind),ids=kind==='bodies'?opportunityFilters.bodies:opportunityFilters.places,all=kind==='bodies'?opportunityFilters.allBodies:opportunityFilters.allPlaces;
 const draft=new Set(all?options.map(([id])=>id):ids.filter(id=>options.some(([key])=>key===id))),dialog=opportunityNode('dialog',{id:'recordOpportunityPicker',className:'record-opportunity-picker'}),heading=opportunityNode('h2',{id:'recordOpportunityPickerTitle'},kind==='bodies'?'天体':'撮影地点'),close=opportunityNode('button',{type:'button',className:'chip',id:'recordOpportunityPickerClose'},'取消'),header=opportunityNode('div',{className:'record-opportunity-picker-head'});dialog.setAttribute('aria-labelledby',heading.id);header.append(heading,close);
 const search=opportunityNode('input',{type:'search',id:'recordOpportunityPickerSearch',className:'fav-in',placeholder:'地点名で検索'});search.setAttribute('aria-label','撮影地点を名前で検索');search.hidden=kind!=='places';
 const tools=opportunityNode('div',{className:'record-opportunity-picker-tools'}),selectAll=opportunityNode('button',{type:'button',className:'chip',id:'recordOpportunitySelectAll'},'全選択'),clear=opportunityNode('button',{type:'button',className:'chip',id:'recordOpportunityClearAll'},'全解除');tools.append(selectAll,clear);
 const list=opportunityNode('div',{className:'record-opportunity-picker-list',id:'recordOpportunityPickerList'}),footer=opportunityNode('div',{className:'record-opportunity-picker-foot'}),count=opportunityNode('span',{className:'tiny',id:'recordOpportunityPickerCount'}),apply=opportunityNode('button',{type:'button',className:'chip',id:'recordOpportunityPickerApply'},'適用');count.setAttribute('role','status');footer.append(count,apply);
 const update=()=>{count.textContent=draft.size+' / '+options.length+'件を選択';apply.disabled=!draft.size;selectAll.disabled=!options.length||draft.size===options.length;clear.disabled=!draft.size;};
 const draw=()=>{list.replaceChildren();const query=search.value.trim().normalize('NFKC').toLocaleLowerCase('ja');for(const [id,name]of options){if(query&&!name.normalize('NFKC').toLocaleLowerCase('ja').includes(query))continue;const label=opportunityNode('label',{className:'record-opportunity-picker-item'}),input=opportunityNode('input',{type:'checkbox',value:id,checked:draft.has(id)});input.onchange=()=>{if(input.checked)draft.add(id);else draft.delete(id);update();};label.append(input,opportunityNode('span',{},name));list.append(label);}if(!list.firstChild)list.append(opportunityNode('p',{className:'tiny'},options.length?'該当する地点がありません':'選択できる項目がありません'));update();};
 selectAll.onclick=()=>{for(const [id]of options)draft.add(id);draw();};clear.onclick=()=>{draft.clear();draw();};search.oninput=draw;close.onclick=opportunityClosePicker;dialog.addEventListener('cancel',e=>{e.preventDefault();opportunityClosePicker();});
 apply.onclick=()=>{if(!opportunityPicker||opportunityPicker.signature!==opportunityPickerKey(opportunityPicker.kind)||!opportunityActive()){opportunityClosePicker();opportunityNotice='登録内容や利用条件が変わりました。選択を開き直してください。';renderOpportunities();return;}const chosen=options.map(([id])=>id).filter(id=>draft.has(id));if(!chosen.length)return;const patch=kind==='bodies'?{bodies:chosen,allBodies:chosen.length===options.length}:{places:chosen,allPlaces:chosen.length===options.length};opportunityClosePicker();if(Object.entries(patch).every(([key,value])=>JSON.stringify(opportunityFilters[key])===JSON.stringify(value)))return;opportunitySet(patch);};
 dialog.append(header,search,tools,list,footer);opportunityDom.host.append(dialog);opportunityPicker={dialog,trigger,kind,signature:opportunityPickerKey(kind)};trigger.setAttribute('aria-expanded','true');draw();dialog.showModal();
}
function opportunityBuild(){
 const host=el('recordOpportunities');if(!host)return false;opportunityHost=host;
 if(opportunityDom?.host===host&&host.firstChild)return true;
 host.replaceChildren();const controls=opportunityNode('div',{className:'record-opportunity-controls'}),period=opportunityNode('div',{className:'record-opportunity-period'});
 const prev=opportunityNode('button',{type:'button',className:'chip'},'‹'),date=opportunityNode('input',{type:'date',id:'recordOpportunityDate',className:'fav-in'}),next=opportunityNode('button',{type:'button',className:'chip'},'›'),today=opportunityNode('button',{type:'button',className:'chip'},'今日');
 prev.id='recordOpportunityPrev';next.id='recordOpportunityNext';today.id='recordOpportunityToday';prev.setAttribute('aria-label','前の日');next.setAttribute('aria-label','次の日');date.setAttribute('aria-label','重なる日を調べる日付');
 const change=delta=>{const [start]=opportunityBounds(opportunityFilters.date);opportunitySet({date:opportunityDateAt(start+delta*86400000)});};prev.onclick=()=>change(-1);next.onclick=()=>change(1);date.onchange=()=>opportunitySet({date:date.value});today.onclick=()=>opportunitySet({date:opportunityDateAt(Date.now())});const dateWrap=opportunityNode('label',{className:'record-opportunity-date'}),dateLabel=opportunityNode('span');dateLabel.setAttribute('aria-hidden','true');dateWrap.append(dateLabel,date);period.append(prev,dateWrap,next,today);
 const filters=opportunityNode('div',{className:'record-opportunity-filters'}),body=opportunityNode('button',{type:'button',id:'recordOpportunityBody',className:'fav-in record-opportunity-select'}),place=opportunityNode('button',{type:'button',id:'recordOpportunityPlace',className:'fav-in record-opportunity-select'});
 for(const [control,label,kind]of [[body,'天体','bodies'],[place,'撮影地点','places']]){const wrap=opportunityNode('div',{className:'record-opportunity-filter'}),caption=opportunityNode('span',{id:control.id+'Label'},label);control.setAttribute('aria-labelledby',caption.id+' '+control.id);control.setAttribute('aria-haspopup','dialog');control.setAttribute('aria-expanded','false');control.onclick=()=>opportunityOpenPicker(kind,control);wrap.append(caption,control);filters.append(wrap);}
 const notice=opportunityNode('p',{id:'recordOpportunityNotice',className:'tiny'});notice.setAttribute('role','status');
 const status=opportunityNode('div',{id:'recordOpportunityStatus',className:'tiny'});status.setAttribute('role','status');
 const list=opportunityNode('div',{id:'recordOpportunityList'}),actions=opportunityNode('div',{className:'record-opportunity-actions'});
 const through=opportunityNode('p',{id:'recordOpportunityThrough',className:'tiny record-opportunity-through'});
 const retry=opportunityNode('button',{type:'button',id:'recordOpportunityRetry',className:'chip',hidden:true},'再試行');
 const more=opportunityNode('button',{type:'button',id:'recordOpportunityMore',className:'chip',hidden:true},'さらに先を探す');
 retry.onclick=()=>{
  const job=opportunityJob;if(!job||!opportunityCurrent(job)||job.scan.state.running)return;
  opportunityNotice='';const end=job.scan.state.end;opportunityCancel();opportunityCache.delete(job.key);renderOpportunities(end);
 };
 more.onclick=()=>{
  const job=opportunityJob;if(!job||!opportunityCurrent(job))return;
  if(job.scan.extend(opportunityPageEnd(job.scan.state.through),opportunityPageRows))void opportunityAdvance(job);
 };
 actions.append(retry,more);controls.append(period,filters);host.append(controls,notice,status,list,through,actions);
 opportunityDom={host,prev,date,dateLabel,next,today,body,place,notice,status,list,through,retry,more,rendered:0,lastDay:null};return true;
}
function opportunitySet(patch){
 if(!opportunityAllowed())return;opportunityClosePicker();
 const date=patch.date??opportunityFilters.date;
 if(!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)||date<'1900-01-01'||date>'2100-12-31'||opportunityDateAt(opportunityBounds(date)[0])!==date){if(opportunityDom)opportunityDom.date.value=opportunityFilters.date;return;}
 opportunityDateChosen=true;opportunityOpenSeq++;opportunityNotice='';opportunityFilters={...opportunityFilters,...patch,date};opportunityCancel();renderOpportunities();
}
function opportunityDraw(job){
 if(!opportunityCurrent(job)||!opportunityDom)return;
 const d=opportunityDom,s=job.scan.state,rows=s.rows;
 d.host.setAttribute('aria-busy',String(s.running&&!s.done));
 if(d.rendered<0){d.list.replaceChildren();d.rendered=0;d.lastDay=null;}
 for(const row of s.rows.slice(d.rendered)){
  const date=opportunityDateAt(row.event.at);if(d.lastDay!==date){d.lastDay=date;d.list.append(opportunityNode('h3',{className:'record-opportunity-day'},dayText(row.event.at)));}
  const button=opportunityNode('button',{type:'button',className:'record-opportunity-row'}),time=opportunityNode('span',{className:'record-opportunity-time'},S.JstCal.hhmm(row.event.at)),name=opportunityNode('strong',{},row.place.name+' → '+row.target.name),body=opportunityNode('span',{className:'record-opportunity-body'},AstroNotesBodies.definition(row.body)?.name||row.body),arrow=opportunityNode('span',{className:'record-opportunity-arrow'},'›');arrow.setAttribute('aria-hidden','true');button.append(time,name,body,arrow);const details=[];if(!row.place.eyeHeightRangeAGL&&job.pairs.some(p=>p.sourcePlaceId===row.sourcePlaceId&&p.target.id===row.target.id&&p.place.eyeHeightAGL!==row.place.eyeHeightAGL))details.push('地上'+row.place.eyeHeightAGL+'m');if(row.event.matchMode==='limb')details.push(RecordAlignment.text(row.target,row.event));if(row.place.eyeHeightRangeAGL)details.push('地上'+row.place.eyeHeightAGL+'m');if(row.shapeType)details.push((row.shapeType==='line'?'線上':'範囲内')+' '+row.place.latitude.toFixed(5)+', '+row.place.longitude.toFixed(5));if(details.length){button.classList.add('has-height');button.append(opportunityNode('span',{className:'record-opportunity-height'},details.join(' ・ ')));}button.dataset.opportunityId=row.id;button.onclick=()=>openOpportunity(row,job);d.list.append(button);
 }d.rendered=s.rows.length;
 const failures=s.failures.length+job.unavailable;
 d.notice.textContent=opportunityNotice;
 if(!s.done&&job.pairs.length){
  if(job.progressUi?.node.parentNode!==d.status)job.progressUi=showRecordProgress(d.status,'確認中','組');
  job.progressUi.update(s.checked,s.total);
 }else{
  job.progressUi=null;d.status.textContent=!job.pairs.length?(!opportunityFilters.allPlaces&&!opportunityFilters.places.length?'撮影地点を選び直してください。':job.unavailable?(job.policyUnavailable?'撮影地点の高さや重ね方を確認してください。':job.accessUnavailable===job.unavailable?'現在の権限では、この組み合わせを確認できません':'対象の登録を確認してください。'):'この組み合わせで確認できる記録がありません'):failures?(s.failures.length?'確認できなかった組み合わせがあります':job.accessUnavailable===job.unavailable?'現在の権限では確認できない組み合わせがあります':'対象の登録を確認してください。'):rows.length?'':'確認した期間に重なる組み合わせはありません';
 }
 d.through.textContent=job.pairs.length&&s.through>job.start?opportunityDateAt(s.through-1).replaceAll('-','/')+(failures?'まで探索（未確認あり）':'まで確認'):'';
 d.retry.hidden=!s.done||!s.failures.length;
 d.more.hidden=!job.pairs.length||s.done&&s.through>=aimCandidateSearchEnd();
 d.more.disabled=!s.done||s.running;d.more.textContent=s.running?'計算中…':'さらに先を探す';
 if(opportunityRestore!==null&&(s.done||document.scrollingElement.scrollHeight-innerHeight>=opportunityRestore)){const top=opportunityRestore;opportunityRestore=null;requestAnimationFrame(()=>{if(opportunityActive())scrollTo(0,top);});}
}
async function opportunityAdvance(job){
 if(!job||!opportunityCurrent(job)||job.scan.state.running)return;
 await job.scan.advance();if(!opportunityCurrent(job)){if(opportunityJob===job&&opportunityActive()&&job.air!==opportunityAirKey()){opportunityCancel();renderOpportunities();}return;}
 if(job.scan.state.cancelled){opportunityCancel();renderOpportunities();return;}
 if(job.scan.state.done)opportunityRemember(job);
 opportunityDraw(job);
}
function renderOpportunities(retryEnd){
 recordSearchReset();
 const owner=auth?.token;
 if(opportunityOwner!==owner||opportunityOwnerId!==auth?.loginId){opportunityCancel(true);opportunityOwner=owner;opportunityOwnerId=auth?.loginId;opportunityDateChosen=false;opportunityFilters={date:opportunityDateAt(Date.now()),bodies:['sun','moon'],allBodies:false,places:[],allPlaces:true};}
 if(!opportunityActive()){opportunityClosePicker();if(opportunityJob)opportunityCancel();if(opportunityHost?.firstChild){opportunityHost.replaceChildren();opportunityDom=null;}return;}
 if(!opportunityDateChosen){const selected=typeof SkyMapUI!=='undefined'?SkyMapUI.selectionState?.():null;opportunityFilters.date=opportunityDateAt(Number.isFinite(selected?.at)?selected.at:Date.now());opportunityDateChosen=true;}
 if(!opportunityBuild())return;
 opportunityPermittedBodies=AstroNotesBodies.definitions.filter(b=>aimTargetList().some(t=>AstroNotesAccess.canFrame(toolAllowed,t.id,b.id))).map(b=>b.id);if(opportunityFilters.allBodies)opportunityFilters.bodies=opportunityPermittedBodies.slice();
 if(opportunityPicker&&opportunityPicker.signature!==opportunityPickerKey(opportunityPicker.kind)){opportunityClosePicker();opportunityNotice='登録内容や利用条件が変わりました。選択を開き直してください。';}
 const signature=opportunitySignature(),d=opportunityDom,{pairs:allPairs,unavailable}=opportunityPairSet(signature,opportunityFilters.bodies),available=opportunityPairSet(signature,opportunityPermittedBodies);
 opportunityPlaces=[...new Map([...available.pairs.map(p=>[p.sourcePlaceId,p.place.name]),...available.unavailable.map(p=>[p.placeId,placeOf(p.placeId)?.name||'撮影地点'])]).entries()];
 if(opportunityFilters.allPlaces)opportunityFilters.places=opportunityPlaces.map(([id])=>id);else opportunityFilters.places=opportunityFilters.places.filter(id=>opportunityPlaces.some(([key])=>key===id));
 d.body.textContent=opportunityFilterLabel('bodies');d.place.textContent=opportunityFilterLabel('places');d.body.dataset.values=JSON.stringify(opportunityFilters.bodies);d.place.dataset.values=JSON.stringify(opportunityFilters.places);d.body.disabled=!opportunityPermittedBodies.length;d.place.disabled=!opportunityPlaces.length;
 d.date.value=opportunityFilters.date;d.dateLabel.textContent=opportunityFilters.date.replaceAll('-','/');d.date.min='1900-01-01';d.date.max='2100-12-31';d.prev.disabled=opportunityFilters.date===d.date.min;d.next.disabled=opportunityFilters.date===d.date.max;
 const [start]=opportunityBounds(opportunityFilters.date),end=Number.isFinite(retryEnd)?retryEnd:opportunityPageEnd(start),key=JSON.stringify([signature,opportunityFilters,AstroNotesAtmosphere.dataKey(start)]);
 if(opportunityJob?.key===key&&opportunityCurrent(opportunityJob)){opportunityDraw(opportunityJob);return;}
 opportunityCancel();d.list.replaceChildren();d.rendered=-1;
 const includesPlace=p=>opportunityFilters.places.includes(p.sourcePlaceId??p.placeId),pairs=allPairs.filter(includesPlace),missing=unavailable.filter(includesPlace).length;
 const scanStart=start,job={key,signature,owner,loginId:auth?.loginId,generation:accessState.generation,epoch:opportunityEpoch,inputEpoch:opportunityInputEpoch,revision:version,air:opportunityAirKey(),pairs,unavailable:missing,accessUnavailable:unavailable.filter(p=>includesPlace(p)&&p.reason==='access').length,policyUnavailable:unavailable.filter(p=>includesPlace(p)&&['height','alignment'].includes(p.reason)).length,start:scanStart};opportunityJob=job;
 const solve=async(pair,day,isCurrent)=>recordEventOptions(await recordSearch({target:pair.target,body:pair.body,at:day,partId:pair.partId,limb:pair.limb,matchMode:pair.matchMode},[{place:pair.place,record:pair.record}],{isCurrent,variant:'opportunity'}),pair);
 job.scan=createOpportunityScan({pairs,start:scanStart,end,notBefore:start,pageRows:Number.isFinite(retryEnd)?Infinity:opportunityPageRows,solve,isCurrent:()=>opportunityCurrent(job),yieldTask:recordSearchYield,onStart:()=>opportunityDraw(job),onDay:()=>opportunityDraw(job),onProgress:s=>{if(opportunityCurrent(job))job.progressUi?.update(s.checked,s.total);}});
 const cached=opportunityCache.get(key);if(cached){opportunityCache.delete(key);Object.assign(job.scan.state,cached,{running:false,cancelled:false});opportunityDraw(job);if(!job.scan.state.done)void opportunityAdvance(job);}else void opportunityAdvance(job);
}
function openOpportunityList(placeId='',bodies=null){
 if(!opportunityAllowed())return;
 opportunityOpenSeq++;opportunityNotice='';opportunityFilters={...opportunityFilters,places:placeId?[placeId]:[],allPlaces:!placeId,...(bodies?.length?{bodies:bodies.filter(b=>AstroNotesBodies.definition(b)),allBodies:false}:{})};opportunityCancel();
 if(sheet?.open)sheet.close();setNotebookTab('opportunities');if(!viewState.records)navigationHistory.pushRoute('#/records');renderOpportunities();
 requestAnimationFrame(()=>{el('recordOpportunities')?.scrollIntoView({block:'start'});el('recordOpportunityPlace')?.focus({preventScroll:true});});
}
async function openOpportunity(row,job){
 if(!opportunityCurrent(job)){renderOpportunities();return;}if(!job.scan.state.rows.includes(row)||!AstroNotesAccess.canFrame(toolAllowed,row.target.id,row.body))return;
 opportunityNotice='';const ticket=++opportunityOpenSeq,owner=auth?.token,loginId=auth?.loginId,generation=accessState.generation,signature=job.signature,top=scrollY;
 try{
  await AstroNotesAssets.ensureModels();
  if(ticket!==opportunityOpenSeq||!opportunityCurrent(job))return;
  opportunityReturn={owner,loginId,generation,signature,top,ticket};navigationHistory.pushRoute('#/explore');await SkyMapUI.open();
  if(ticket!==opportunityOpenSeq||owner!==auth?.token||loginId!==auth?.loginId||!globalThis.TrialExplore?.active())return;if(generation!==accessState.generation||signature!==opportunitySignature())throw Error('conditions changed');
  SkyMapUI.setTarget(row.target.id);if(SkyMapUI.selectionState()?.target?.id!==row.target.id)throw Error('target unavailable');
  const body=el('skyMapBody');body.value=row.body;body.dispatchEvent(new Event('change',{bubbles:true}));SkyMapUI.setAlignment(row.event.partId??matchOpts(row.target).partId,row.event.limb||'center',row.event.matchMode||'overlap');SkyMapUI.setObserver(AstroNotesShooting.savedObserver(row.place));SkyMapUI.setTime(row.event.at);TrialExplore.render();el('exploreShowResult').click();
 }catch{if(ticket!==opportunityOpenSeq||owner!==auth?.token||loginId!==auth?.loginId)return;opportunityNotice='条件が変わったか、見え方を開けませんでした。もう一度お試しください。';if(opportunityReturn?.ticket===ticket){opportunityRestore=top;opportunityReturn=null;opportunityNotice='条件が変わったか、見え方を開けませんでした。もう一度お試しください。';if(globalThis.TrialExplore?.active())navigationHistory.goBack();}renderOpportunities();}
}
function opportunityHasReturn(){return !!opportunityReturn&&opportunityReturn.owner===auth?.token&&opportunityReturn.loginId===auth?.loginId&&opportunityReturn.generation===accessState.generation;}
function opportunityReturnFromPreview(){if(!opportunityHasReturn()||!globalThis.TrialExplore?.active())return false;opportunityRestore=opportunityReturn.top;opportunityReturn=null;navigationHistory.goBack();return true;}
for(const type of ['pointerdown','wheel'])el('recordOpportunities').addEventListener(type,()=>{opportunityRestore=null;},{passive:true});
const opportunityWatch=new MutationObserver(()=>{renderOpportunities();});opportunityWatch.observe(el('recordsView'),{attributes:true,attributeFilter:['hidden','data-tab']});
document.addEventListener('astronotes-records-change',()=>{opportunityInputEpoch++;if(opportunityActive())renderOpportunities();});document.addEventListener('visibilitychange',renderOpportunities);document.addEventListener('astronotes-opportunity-input',()=>{opportunityInputEpoch++;if(opportunityActive())renderOpportunities();});window.addEventListener('focus',renderOpportunities);
window.addEventListener('pagehide',()=>{if(opportunityJob)opportunityCancel();});window.addEventListener('pageshow',renderOpportunities);
window.addEventListener('hashchange',()=>{if(viewState.records&&opportunityHasReturn()){opportunityRestore=opportunityReturn.top;opportunityReturn=null;}else if(!viewState.records&&!globalThis.TrialExplore?.active())opportunityReturn=null;renderOpportunities();});
const opportunities={render:renderOpportunities,open:openOpportunityList,hasReturn:opportunityHasReturn,returnFromPreview:opportunityReturnFromPreview};
