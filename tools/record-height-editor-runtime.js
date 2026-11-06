// Inside MyPlacesUI. Only the record editor exposes this policy; Explore stays fixed-height.
let recordHeightRequestSeq=0;
function recordHeightInit(){
 const s=sheetState;if(!s||s.ctx!=='records')return;const location=JSON.stringify([s.place.latitude,s.place.longitude]);
 if(s.heightDraft&&s.heightLocation===location)return;
 s.heightLocation=location;s.heightBaseline=RecordHeight.key(placeOf(s.place.id)||s.place);s.heightDraft=RecordHeight.draft(s.place);s.heightFallback=s.place.eyeHeightAGL??1.5;s.heightInitialDraft=JSON.stringify(s.heightDraft);s.heightGroundAttempted=false;s.heightGroundError='';s.heightRequest=++recordHeightRequestSeq;
}
function recordHeightDirty(){return sheetState?.ctx==='records'&&!!sheetState?.heightDraft&&(JSON.stringify(sheetState.heightDraft)!==sheetState.heightInitialDraft||RecordHeight.key(sheetState.place)!==sheetState.heightBaseline);}
function applyRecordHeightDraft(show=false){
 if(sheetState?.ctx!=='records'||!sheetState.heightDraft)return true;
 try{const value=RecordHeight.parse(sheetState.heightDraft,sheetState.heightFallback),p=sheetState.place;p.eyeHeightAGL=value.eye;sheetState.heightFallback=value.eye;p.elevation=value.ground;if(value.range)p.eyeHeightRangeAGL=value.range;else delete p.eyeHeightRangeAGL;if(show)el('myHeightError').hidden=true;return true;}
 catch(error){if(show){el('myHeightError').textContent=error.message;el('myHeightError').hidden=false;}return false;}
}
function recordHeightGround(retry=false){
 const s=sheetState;if(!sheetOwnerMatches()||!draftPoint()||s.heightLoading||(!retry&&s.heightGroundAttempted))return;
 s.heightGroundAttempted=true;s.heightLoading=true;s.heightGroundError='';const request=++recordHeightRequestSeq;s.heightRequest=request;const lat=s.place.latitude,lon=s.place.longitude;
 if(retry){s.heightDraft.ground='';s.place.elevation=null;s.place.groundManualM=null;}
 renderRecordHeight(false);
 void candidateElevation(lat,lon).then(value=>{
  if(sheetState!==s||!sheetOwnerMatches()||!sheet.open||request!==s.heightRequest||lat!==s.place.latitude||lon!==s.place.longitude)return;
  s.heightLoading=false;if(Number.isFinite(value)){s.heightDraft.ground=String(Math.round(value*10)/10);s.place.elevation=Math.round(value*10)/10;s.place.groundManualM=null;}else s.heightGroundError='標高を取得できませんでした。再取得または入力してください。';
  renderSheet();
 });
}
function buildRecordHeight(){
 const box=document.createElement('fieldset');box.id='myRecordHeight';box.className='record-height-editor';box.innerHTML=`<legend>撮影する高さ</legend><label class="record-height-label" for="myHeightGround">地面の標高</label><div class="record-height-ground"><label class="record-height-number"><input id="myHeightGround" type="number" inputmode="decimal" min="-500" max="9000" step="any" aria-label="地面の標高（メートル）"><span>m</span></label><button type="button" class="chip" id="myHeightGroundRetry">再取得</button></div><p class="tiny" id="myHeightGroundError" role="status" hidden></p><div class="record-height-label">目線（地上から）</div><div class="record-height-modes" role="group" aria-label="目線の高さの指定方法"><button type="button" id="myHeightFixedMode">固定</button><button type="button" id="myHeightRangeMode">範囲</button></div><div id="myHeightFixedFields" class="record-height-values"><label class="record-height-number"><input id="myHeightFixed" type="number" inputmode="decimal" min="0" max="700" step="any" aria-label="目線の高さ（メートル）"><span>m</span></label></div><div id="myHeightRangeFields" class="record-height-values" hidden><label><span class="tiny">下限</span><span class="record-height-number"><input id="myHeightMin" type="number" inputmode="decimal" min="0" max="700" step="0.1" aria-label="目線の高さの下限（メートル）"><span>m</span></span></label><label><span class="tiny">上限</span><span class="record-height-number"><input id="myHeightMax" type="number" inputmode="decimal" min="0" max="700" step="0.1" aria-label="目線の高さの上限（メートル）"><span>m</span></span></label></div><p id="myHeightError" class="warn" role="status" hidden></p>`;
 el('myRecordPickTarget').closest('.my-input-field').before(box);
 for(const [id,key]of [['myHeightGround','ground'],['myHeightFixed','fixed'],['myHeightMin','min'],['myHeightMax','max']])el(id).oninput=()=>{if(!sheetOwnerMatches())return;recordHeightInit();sheetState.heightDraft[key]=el(id).value;if(key==='ground'){sheetState.heightRequest=++recordHeightRequestSeq;sheetState.heightLoading=false;sheetState.heightGroundAttempted=true;sheetState.heightGroundError='';const n=Number(el(id).value);sheetState.place.groundManualM=el(id).value.trim()&&Number.isFinite(n)?n:null;}applyRecordHeightDraft(true);renderRecordHeight(false);el('myRecordSave').disabled=!draftPoint()||!!sheetState.locationPending||!draftChanged()||!!sheetState.heightLoading||!applyRecordHeightDraft();el('myPlacePlanning').hidden=!sheetState.place.id||draftChanged();};
 for(const [id,mode]of [['myHeightFixedMode','fixed'],['myHeightRangeMode','range']])el(id).onclick=()=>{if(!sheetOwnerMatches())return;recordHeightInit();sheetState.heightDraft.mode=mode;applyRecordHeightDraft();renderSheet();};
 el('myHeightGroundRetry').onclick=()=>recordHeightGround(true);
}
function renderRecordHeight(loadGround=true){
 if(!el('myRecordHeight')||!sheetState)return;const s=sheetState;el('myRecordHeight').hidden=s.ctx!=='records'||!draftPoint();if(el('myRecordHeight').hidden)return;recordHeightInit();const d=s.heightDraft;
 for(const [id,key]of [['myHeightGround','ground'],['myHeightFixed','fixed'],['myHeightMin','min'],['myHeightMax','max']])if(document.activeElement!==el(id))el(id).value=d[key];
 el('myHeightGround').placeholder=s.heightLoading?'取得中…':'標高を入力';el('myHeightGroundRetry').disabled=!!s.heightLoading;el('myHeightGroundError').textContent=s.heightGroundError;el('myHeightGroundError').hidden=!s.heightGroundError;
 el('myHeightFixedMode').setAttribute('aria-pressed',String(d.mode==='fixed'));el('myHeightRangeMode').setAttribute('aria-pressed',String(d.mode==='range'));el('myHeightFixedFields').hidden=d.mode!=='fixed';el('myHeightRangeFields').hidden=d.mode!=='range';
 applyRecordHeightDraft();
 if(loadGround&&!d.ground.trim()&&!s.heightGroundAttempted)recordHeightGround();
}
function prepareHeightRecord(args){
 if(sheetState?.ctx!=='records')return AstroNotesLibrary.prepareRecord(args);
 const policy=RecordHeight.range(args.place.eyeHeightRangeAGL);if(args.place.eyeHeightRangeAGL&&!policy)throw Error('高さの範囲を確認してください');
 const before=args.favorites.find(f=>f.id===args.place.id),plan=AstroNotesLibrary.prepareRecord(args),next=plan.favorites.find(f=>f.id===args.place.id);if(!next)return plan;
 const changed=!before||RecordHeight.key(before)!==RecordHeight.key(args.place);
 if(changed){next.elevation=args.place.elevation??null;next.groundManualM=args.place.groundManualM??null;next.eyeHeightAGL=args.place.eyeHeightAGL??1.5;if(policy)next.eyeHeightRangeAGL=policy;else delete next.eyeHeightRangeAGL;if(!plan.changedFavorites.includes(next.id))plan.changedFavorites.push(next.id);
  if(before&&(before.eyeHeightAGL!==next.eyeHeightAGL||before.elevation!==next.elevation)){const old=new Set(args.initialTargets.map(t=>t.key||t.id));plan.observations.push(...AstroNotesLibrary.registrationChanges(next,[],args.targets.filter(t=>old.has(t.key||t.id))));}
 }
 return plan;
}

function recordHeightText(p){const r=RecordHeight.range(p?.eyeHeightRangeAGL);return r?'地上から '+r.min+'〜'+r.max+'m':'地上から '+(p?.eyeHeightAGL??1.5)+'m';}
