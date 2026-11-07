// Trial-only display order for registered places. favorites/records stay in stored order.
const recordSort=createRecordSort({distanceKm:(a,b,c,d)=>AstroNotesTerrain.distanceKm(a,b,c,d)});
const RECORD_SORT_KEY='sorami.placeSort';
// The device location is session-only and separate from the observer.
const recordSortState={origin:null,shown:null,pending:false,request:0,status:''};
function recordSortChoice(){const v=store.get(RECORD_SORT_KEY,recordSort.DEFAULT);return recordSort.valid(v)?v:recordSort.DEFAULT;}
function recordSortShown(){
 const choice=recordSortChoice();
 if(choice==='near'&&!recordSortState.origin&&typeof myPos!=='undefined'&&recordSort.point(myPos)&&Date.now()-myPos.at<120000)recordSortState.origin={latitude:myPos.latitude,longitude:myPos.longitude};
 if(choice!=='near'||recordSortState.origin)return choice;
 return recordSortState.shown&&recordSortState.shown!=='near'?recordSortState.shown:recordSort.DEFAULT;
}
function sortRecordPlaces(places){const mode=recordSortShown();recordSortState.shown=mode;return recordSort.sort(places,mode,recordSortState.origin);}
function recordSortRefresh(id,rerender){const had=document.activeElement?.id===id;rerender();if(had)document.getElementById(id)?.focus({preventScroll:true});}
function chooseRecordSort(mode,id,rerender){
 const request=++recordSortState.request;recordSortState.status='';recordSortState.pending=false;
 if(!recordSort.valid(mode))mode=recordSort.DEFAULT;
 if(mode!=='near'){store.set(RECORD_SORT_KEY,mode);recordSortState.shown=mode;recordSortRefresh(id,rerender);return;}
 const fail=()=>{if(request!==recordSortState.request)return;recordSortState.pending=false;recordSortState.status='現在地を取得できませんでした';recordSortRefresh(id,rerender);};
 if(!navigator.geolocation||typeof locateMe!=='function'){fail();return;}
 recordSortState.pending=true;recordSortState.status='現在地を取得中…';recordSortRefresh(id,rerender);
 locateMe().then(pos=>{
  if(request!==recordSortState.request)return;
  if(!recordSort.point(pos)){fail();return;}
  recordSortState.origin={latitude:pos.latitude,longitude:pos.longitude};recordSortState.pending=false;recordSortState.status='';
  store.set(RECORD_SORT_KEY,'near');recordSortState.shown='near';recordSortRefresh(id,rerender);
 },fail);
}
function recordSortControl(id,rerender){
 const select=document.createElement('select');select.className='fav-in record-sort-select';select.id=id;select.setAttribute('aria-label','並び順');
 for(const o of recordSort.options)select.append(new Option(o.label,o.value));
 const choice=recordSortChoice(),shown=recordSortShown();
 select.value=recordSortState.pending?'near':recordSortState.status?shown:choice;
 select.onchange=()=>chooseRecordSort(select.value,id,rerender);
 const nodes=[select];
 if(choice==='near'&&shown!=='near'&&!recordSortState.pending&&!recordSortState.status){const locate=document.createElement('button');locate.type='button';locate.className='chip record-sort-locate';locate.id=id+'Locate';locate.textContent='現在地で並べる';locate.onclick=()=>chooseRecordSort('near',id,rerender);nodes.push(locate);}
 if(recordSortState.status){const status=document.createElement('p');status.className='tiny record-sort-status';status.id=id+'Status';status.setAttribute('role','status');status.textContent=recordSortState.status;nodes.push(status);}
 return nodes;
}
