// Date navigation integration against the real trial UI and search job owner.
// Only inverse seeds, remote places and geometric evaluation use synthetic IO.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.CANDIDATE_DATE_BASE||'http://127.0.0.1:8986/trial/';
const out=process.env.CANDIDATE_DATE_OUT||'/tmp/astronotes-candidate-date';fs.mkdirSync(out,{recursive:true});
const granted=['records','tower','diamond','pearl','skymap','multiscene'];
const {fixture}=require('./candidate-date-fixture.cjs');

const day=at=>new Date(at+32400000).toISOString().slice(0,10),offset=at=>((at+32400000)%86400000+86400000)%86400000;
async function current(p){return p.evaluate(()=>({at:SkyMapUI.selectionState().at,input:document.getElementById('candidateDate')?.dataset.date,open:!!TrialExplore.candidateWorkspace()?.active(),focus:document.activeElement?.id,loads:dateFixture.loads.length}));}
async function open(p){if(await p.locator('#exploreBackToCandidates').isVisible())await p.locator('#exploreBackToCandidates').click();else if(!await p.locator('#candidateSearchAction').count())await p.evaluate(()=>navigationHistory.pushRoute('#/explore'));await p.locator('#candidateDate').waitFor({state:'visible'});}

async function setDate(p,value){
 const [year,month,date]=value.split('-').map(Number);await p.locator('#candidateDate').click();
 const calendar=p.locator('#candidateDateCalendar');await calendar.waitFor({state:'visible'});
 await calendar.locator('[data-year]').selectOption({value:String(year)});await calendar.locator('[data-month]').selectOption({value:String(month-1)});
 await calendar.getByRole('button',{name:`${year}年${month}月${date}日`,exact:true}).click();await calendar.waitFor({state:'hidden'});
}
async function appearance(p,row){
 await p.waitForFunction(()=>!document.getElementById('placeSheet').open);
 await p.waitForFunction(()=>{const h=document.getElementById('aimLook'),s=SkyMapUI.selectionState();return h?._lookSpec?.obs&&h._lookAt===s.at&&Math.abs(h._lookSpec.obs.latitude-s.observer.latitude)<1e-8;});
 const state=await p.evaluate(()=>{const s=SkyMapUI.selectionState(),h=document.getElementById('aimLook');return {at:s.at,latitude:s.observer.latitude,longitude:s.observer.longitude,elevation:h._lookSpec.obs.elevation,eyeM:h._lookSpec.eyeM};});
 assert.deepEqual(state,{at:row.event.at,latitude:row.place.latitude,longitude:row.place.longitude,elevation:row.assumedObserver.elevation,eyeM:row.assumedObserver.eyeM});
}
async function settled(p,value,count=1){await p.waitForFunction(({value,count})=>{const rows=AstroNotesCandidatePicker.visibleRows(),button=document.getElementById('candidateSearchAction');return rows.length===count&&rows.every(r=>new Date(r.event.at+32400000).toISOString().slice(0,10)===value)&&button?.dataset.state==='idle'&&!button.disabled&&document.getElementById('additionalCandidateResults')?.getAttribute('aria-busy')==='false';},{value,count});}
async function actionState(p,state,label){
 const action=p.locator('#candidateSearchAction');await p.waitForFunction(state=>document.getElementById('candidateSearchAction')?.dataset.state===state,state);
 assert.equal(await action.innerText(),label);assert(await action.isEnabled());assert.equal(await p.locator('#additionalCandidateSearch > button').count(),1);assert.equal(await p.locator('#additionalCandidateResults').getAttribute('aria-busy'),String(state==='searching'));
}
async function searchCancellation(p,{dayValue,initialAt,out,engine,width,theme}){
 const action=p.locator('#candidateSearchAction');await action.scrollIntoViewIfNeeded();
 const initial=await action.evaluate(node=>{window.originalSearchAction=node;const r=node.getBoundingClientRect();return {width:r.width,height:r.height};});
 assert(initial.height>=44);await actionState(p,'idle','候補を探す');
 await p.screenshot({path:out+'/'+engine+'-'+width+'-'+theme+'-search-idle.png'});
 const sameAction=async()=>{const actual=await action.evaluate(node=>{const r=node.getBoundingClientRect();return {same:node===window.originalSearchAction,width:r.width,height:r.height};});assert(actual.same);assert(Math.abs(actual.width-initial.width)<.1);assert(Math.abs(actual.height-initial.height)<.1);};
 await p.evaluate(()=>dateFixture.holdNext=true);await action.focus();await action.press('Enter');await p.waitForFunction(()=>dateFixture.holds.length===1);
 await actionState(p,'searching','キャンセル');await sameAction();assert.equal((await current(p)).focus,'candidateSearchAction');
 await p.screenshot({path:out+'/'+engine+'-'+width+'-'+theme+'-searching.png'});
 const aborted=await p.evaluate(()=>dateFixture.aborted.length);await action.press('Enter');await actionState(p,'idle','続きを探す');await sameAction();
 assert.equal(await p.evaluate(()=>dateFixture.aborted.length),aborted+1);assert.equal(await p.locator('.candidate-wait').count(),0);assert((await p.locator('#candidateSearchFeedback [role=status]').innerText()).includes('キャンセルしました'));
 // Restart before non-abortable IO settles. Its late result and finally must
 // leave the replacement's cancel action and waiting status untouched.
 await p.evaluate(()=>dateFixture.holdNext=true);await action.click();await p.waitForFunction(()=>dateFixture.holds.length===2);await actionState(p,'searching','キャンセル');
 await p.evaluate(()=>dateFixture.holds.shift().release());await p.waitForTimeout(100);await actionState(p,'searching','キャンセル');
 assert.equal(await p.evaluate(()=>AstroNotesCandidatePicker.visibleRows().filter(r=>r.id!=='registered').length),0);assert.equal(await p.locator('.candidate-wait').count(),1);
 await p.evaluate(()=>dateFixture.holds.shift().release());await settled(p,dayValue,3);await actionState(p,'idle','候補を探し直す');await sameAction();
 // A failed fresh query must expose the same retry action without losing the
 // selected day or leaving an unclickable cancel state.
 await p.evaluate(()=>dateFixture.failNext=true);await action.click();await p.waitForFunction(()=>document.querySelector('#candidateSearchFeedback [role=status]')?.textContent.includes('取得できませんでした'));
 await actionState(p,'idle','続きを探す');assert.equal(await p.locator('.candidate-wait').count(),0);assert.equal((await current(p)).input,dayValue);
 await action.click();await settled(p,dayValue,3);await actionState(p,'idle','候補を探し直す');
 // A fresh recheck clears the search engine's completed session. Cancelling it
 // must still preserve the previously displayed result across appearance/return.
 const fullRow=await p.evaluate(()=>structuredClone(AstroNotesCandidatePicker.visibleRows().find(r=>r.placeKind==='park')));
 await p.evaluate(()=>dateFixture.holdNext=true);await action.click();await p.waitForFunction(()=>dateFixture.holds.length===1);await actionState(p,'searching','キャンセル');
 await action.click();await actionState(p,'idle','続きを探す');await settled(p,dayValue,3);
 await p.locator('#candidateUnifiedResults .list-item').filter({hasText:fullRow.place.name}).click();await appearance(p,fullRow);
 await p.evaluate(()=>dateFixture.holds.shift().release());const cancelledRecheckLoads=(await current(p)).loads;
 await p.evaluate(at=>SkyMapUI.setTime(at),initialAt);await open(p);await settled(p,dayValue,3);
 assert.equal((await current(p)).loads,cancelledRecheckLoads,'returning after a cancelled fresh recheck restores rows without IO');await actionState(p,'idle','候補を探し直す');
 // This request mount is new, so compare subsequent toggles with its own node.
 await action.evaluate(node=>window.originalSearchAction=node);
 // Keep a completed provider page while its continuation is cancelled, then
 // select a retained row without having to reopen or re-run the search.
 await p.evaluate(()=>dateFixture.nextCursor=7);await action.click();await settled(p,dayValue,3);await actionState(p,'idle','続きを探す');
 await p.locator('#candidateKindFilter').selectOption('park');await p.locator('#candidateTimeFilter').selectOption('rise');await p.locator('[data-candidate-sort=time]').click();await settled(p,dayValue);
 const row=await p.evaluate(()=>structuredClone(AstroNotesCandidatePicker.visibleRows()[0]));
 await p.evaluate(()=>{dateFixture.nextCursor=null;dateFixture.holdNext=true;});await action.click();await p.waitForFunction(()=>dateFixture.holds.length===1);assert.equal(await p.evaluate(()=>dateFixture.loads.at(-1).cursor),7);
 await actionState(p,'searching','キャンセル');await action.click();await actionState(p,'idle','続きを探す');await settled(p,dayValue);await sameAction();
 assert.equal(await p.locator('#candidateKindFilter').inputValue(),'park');assert.equal(await p.locator('#candidateTimeFilter').inputValue(),'rise');assert.equal(await p.locator('[data-candidate-sort=time]').getAttribute('aria-pressed'),'true');
 await p.screenshot({path:out+'/'+engine+'-'+width+'-'+theme+'-search-cancelled.png'});
 await p.locator('#candidateUnifiedResults .list-item:not([hidden])').click();await appearance(p,row);await p.evaluate(()=>dateFixture.holds.shift().release());
 // Start a new search in the exact microtask gap before cached presentation
 // resumes. The old presentation must not reset the new action or publish rows.
 await p.evaluate(at=>{SkyMapUI.setTime(at);dateFixture.startDuringRestore=true;dateFixture.holdNext=true;},initialAt);await open(p);await p.waitForFunction(()=>dateFixture.holds.length===1);
 await actionState(p,'searching','キャンセル');await p.waitForTimeout(100);await actionState(p,'searching','キャンセル');assert.equal(await p.evaluate(()=>AstroNotesCandidatePicker.visibleRows().filter(r=>r.id!=='registered').length),0);
 await p.evaluate(()=>dateFixture.holds.shift().release());await settled(p,dayValue);await actionState(p,'idle','候補を探し直す');
}
(async()=>{
 const results=[];
 for(const [engine,type]of [['chrome',chromium],['webkit',webkit]].filter(([n])=>(process.env.CANDIDATE_DATE_ENGINES||'chrome,webkit').split(',').includes(n))){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{for(const width of(process.env.CANDIDATE_DATE_WIDTHS||'320,390,1280').split(',').map(Number)){
   const theme=engine==='chrome'?'light':'dark',context=await browser.newContext({viewport:{width,height:900},colorScheme:theme,locale:'ja-JP',timezoneId:width===390?'America/Los_Angeles':'Asia/Tokyo',reducedMotion:'reduce'});let writes=0;
   await context.addInitScript(fixture,granted);await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(base).origin)return r.continue();if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(r.request().method()))writes++;return r.fulfill({json:{allowed:true,tool:'skymap',loginId:'date-test',tools:granted,favorites:[],sightings:[],records:[],rev:1}});}return r.abort();});
   const p=await context.newPage(),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message);});p.setDefaultTimeout(15000);
   try{
    await p.goto(base+'#/explore');await p.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof AstroNotesCandidatePicker==='object');await p.evaluate(async theme=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>25;aimBuildingDays=async()=>[];document.documentElement.dataset.theme=theme;navigationHistory.pushRoute('#/explore');SkyMapUI.setTarget('skytree');const body=document.getElementById('skyMapBody');body.value='moon';body.onchange();SkyMapUI.setTime(Date.parse('2026-11-05T23:59:31.246+09:00'));AstroNotesShooting.candidates=async plan=>({failed:0,rows:[{id:'registered',record:{result:'seen'},placeKind:'road',quality:{photographyClass:'normal'},place:{name:'登録歩道',latitude:35.689,longitude:139.729,elevation:25,groundManualM:25,standAglM:4,decks:[]},assumedObserver:{latitude:35.689,longitude:139.729,elevation:25,eyeM:4},event:{at:AstroNotesCandidateDiscovery.day(plan.at)+13*3600000,side:'rise'}}]});},theme);
    const before=await p.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()}));await open(p);const start=await current(p),timeOfDay=offset(start.at);assert.equal(start.input,'2026-11-05');
    await p.evaluate(()=>{window.dateNodes={bar:document.getElementById('candidateDateNavigation'),input:document.getElementById('candidateDate'),next:document.getElementById('candidateNextDay')};});
    await p.locator('#candidateNextDay').focus();await p.locator('#candidateNextDay').press('Enter');assert.equal((await current(p)).input,'2026-11-06');assert.equal((await current(p)).focus,'candidateNextDay');assert.equal(offset((await current(p)).at),timeOfDay);
    await p.locator('#candidatePreviousDay').click();assert.equal((await current(p)).input,'2026-11-05');
    await setDate(p,'2026-12-31');assert.equal((await current(p)).focus,'candidateDate');await p.locator('#candidateNextDay').click();assert.equal(day((await current(p)).at),'2027-01-01');assert.equal((await current(p)).input,'2027-01-01','focused date input updates when the arrow changes the day');
    await setDate(p,'2028-02-28');await p.locator('#candidateNextDay').click();assert.equal((await current(p)).input,'2028-02-29');await p.locator('#candidateNextDay').click();assert.equal((await current(p)).input,'2028-03-01');assert.equal(offset((await current(p)).at),timeOfDay);
    await setDate(p,'2026-11-05');await p.waitForTimeout(450);assert.equal((await current(p)).loads,0,'opening or changing days before first search does not fetch places');assert(await p.evaluate(()=>dateNodes.bar===document.getElementById('candidateDateNavigation')&&dateNodes.input===document.getElementById('candidateDate')&&dateNodes.next===document.getElementById('candidateNextDay')));
    const previous=await current(p);await p.locator('#candidateDate').click();const calendar=p.locator('#candidateDateCalendar');await calendar.getByRole('button',{name:'次の月',exact:true}).click();await calendar.getByRole('button',{name:'前の月',exact:true}).click();await p.keyboard.press('Escape');await calendar.waitFor({state:'hidden'});assert.equal((await current(p)).at,previous.at);assert.equal((await current(p)).input,'2026-11-05');assert.equal((await current(p)).open,true);assert.equal((await current(p)).focus,'candidateDate');
    await p.locator('#candidateDate').click();await calendar.getByRole('button',{name:'次の月',exact:true}).click();await calendar.getByRole('button',{name:'閉じる',exact:true}).click();assert.equal((await current(p)).at,previous.at);assert.equal((await current(p)).loads,0);
    await searchCancellation(p,{dayValue:'2026-11-05',initialAt:start.at,out,engine,width,theme});
    await p.locator('#candidateKindFilter').selectOption('park');await p.locator('#candidateTimeFilter').selectOption('rise');await p.locator('[data-candidate-sort=time]').click();await settled(p,'2026-11-05');
    await p.evaluate(()=>window.oldCandidateClick=document.querySelector('#candidateUnifiedResults .list-item:not([hidden])').onclick);
    const calls=(await current(p)).loads;await p.locator('#candidateNextDay').focus();await p.locator('#candidateNextDay').press('Enter');const changed=await current(p);await p.evaluate(()=>oldCandidateClick());assert.equal((await current(p)).at,changed.at);assert.equal((await current(p)).open,true);await settled(p,'2026-11-06');assert.equal((await current(p)).loads,calls+1);
    assert.equal(await p.locator('#candidateKindFilter').inputValue(),'park');assert.equal(await p.locator('#candidateTimeFilter').inputValue(),'rise');assert.equal(await p.locator('[data-candidate-sort=time]').getAttribute('aria-pressed'),'true');assert.equal((await current(p)).focus,'candidateNextDay');
    const rapid=(await current(p)).loads;await p.evaluate(()=>{const next=document.getElementById('candidateNextDay');for(let i=0;i<5;i++)next.click();});await settled(p,'2026-11-11');assert.equal((await current(p)).loads,rapid+1,'rapid next-day clicks coalesce into one discovery job');
    // Old A remains blocked in IO while B→A causes a fresh A search.
    await p.evaluate(()=>dateFixture.holdNext=true);await p.locator('#candidateNextDay').click();await p.waitForFunction(()=>dateFixture.holds.length===1);assert.equal(day((await current(p)).at),'2026-11-12');
    await p.evaluate(()=>{document.getElementById('candidateNextDay').click();document.getElementById('candidatePreviousDay').click();});await settled(p,'2026-11-12');assert.equal(await p.locator('.candidate-wait').count(),0,'retired busy job must not leave a waiting character');
    await p.evaluate(()=>dateFixture.holds.shift().release());await p.waitForTimeout(100);await settled(p,'2026-11-12');assert.equal(offset((await current(p)).at),timeOfDay);
    // Current rows disappear from both list/map and cannot select the previous date.
    await p.locator('#candidateMapToggle').click();assert(await p.locator('#candidateMapPanel').isVisible());await p.locator('#candidateNextDay').click();assert(await p.locator('#candidateMapPanel').isHidden());await settled(p,'2026-11-13');
    const metrics=await p.locator('#candidateDateNavigation').evaluate(n=>({overflow:n.scrollWidth>n.clientWidth+1,bodyOverflow:document.documentElement.scrollWidth>innerWidth+1,count:document.querySelectorAll('#candidateDateNavigation').length}));assert(!metrics.overflow&&!metrics.bodyOverflow);assert.equal(metrics.count,1);await p.locator('#candidateDateNavigation').scrollIntoViewIfNeeded();await p.screenshot({path:out+'/'+engine+'-'+width+'-'+theme+'.png'});
    // Changing the calendar date preserves fixed-time and cross-midnight window intent.
    await p.locator('#candidateTimeFilter').selectOption('all');await p.evaluate(()=>{const m=document.getElementById('candidateSearchMode');m.value='instant';m.onchange();});await p.locator('#additionalCandidateSearch > button').first().click();await settled(p,'2026-11-13');
    await p.locator('#candidateNextDay').click();await settled(p,'2026-11-14');assert.equal(await p.evaluate(()=>AstroNotesCandidatePicker.visibleRows()[0].event.at),(await current(p)).at);
    await p.evaluate(()=>{const m=document.getElementById('candidateSearchMode');m.value='window';m.onchange();let s=document.getElementById('candidateSearchStart');s.value='22:00';s.onchange();let e=document.getElementById('candidateSearchEnd');e.value='02:00';e.onchange();});await p.locator('#additionalCandidateSearch > button').first().click();await settled(p,'2026-11-14');await p.locator('#candidateNextDay').click();await settled(p,'2026-11-15');
    const window=await p.evaluate(()=>dateFixture.loads.at(-1).timeSpec);assert.equal(window.kind,'window');assert.equal(window.start,Date.parse('2026-11-15T22:00:00+09:00'));assert.equal(window.end,Date.parse('2026-11-16T02:00:00+09:00'));assert.equal(offset((await current(p)).at),timeOfDay);
    // The actual appearance renderer changes time/observer; returning must restore
    // results and fresh selection handlers without another place-provider call.
    await p.evaluate(()=>{const m=document.getElementById('candidateSearchMode');m.value='day';m.onchange();});await p.locator('#additionalCandidateSearch > button').first().click();await settled(p,'2026-11-15');
    const retained=await p.evaluate(()=>structuredClone(AstroNotesCandidatePicker.visibleRows())),retainedLoads=(await current(p)).loads;
    await p.locator('#candidateUnifiedResults .list-item:not([hidden])').click();await appearance(p,retained[0]);await open(p);await settled(p,'2026-11-15');
    assert.deepEqual(await p.evaluate(()=>structuredClone(AstroNotesCandidatePicker.visibleRows())),retained);assert.equal((await current(p)).loads,retainedLoads);assert.equal(await p.locator('#candidateKindFilter').inputValue(),'park');assert.equal(await p.locator('#candidateTimeFilter').inputValue(),'all');assert.equal(await p.locator('[data-candidate-sort=time]').getAttribute('aria-pressed'),'true');
    await p.locator('#candidateMapToggle').click();await p.locator('#candidateMapUse').click();await appearance(p,retained[0]);await open(p);await settled(p,'2026-11-15');await p.locator('#candidateMapPanel').waitFor({state:'visible'});assert.equal((await current(p)).loads,retainedLoads);assert.equal(await p.locator('#candidateMapChoice').inputValue(),await p.locator('#candidateMapChoice option').first().getAttribute('value'));
    await p.locator('#candidateMapToggle').click();await p.locator('#candidateDateNavigation').scrollIntoViewIfNeeded();await p.screenshot({path:out+'/'+engine+'-'+width+'-'+theme+'-restored.png'});
    await p.evaluate(()=>navigationHistory.pushRoute('#/records'));await open(p);await settled(p,'2026-11-15');await p.waitForTimeout(50);assert.equal((await current(p)).open,true);assert.equal((await current(p)).loads,retainedLoads);
    await p.locator('#candidateDate').click();await calendar.getByRole('button',{name:'次の月',exact:true}).click();
    const calendarText=await calendar.locator('select').evaluateAll(ns=>ns.map(n=>{const cs=getComputedStyle(n),c=document.createElement('canvas').getContext('2d');c.font=cs.font||`${cs.fontSize} ${cs.fontFamily}`;return {text:n.selectedOptions[0].textContent,width:c.measureText(n.selectedOptions[0].textContent).width,available:n.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)};}));assert(calendarText.every(v=>v.width<=v.available+1),JSON.stringify(calendarText));
    await p.screenshot({path:out+'/'+engine+'-'+width+'-'+theme+'-calendar.png'});await calendar.getByRole('button',{name:'閉じる',exact:true}).click();assert.equal((await current(p)).loads,retainedLoads);
    // An overnight event belongs to the original search window even though the
    // appearance is on the next day. An explicit time-mode edit must release it.
    await p.evaluate(()=>{dateFixture.windowOffsetHours=3;const m=document.getElementById('candidateSearchMode');m.value='window';m.onchange();const s=document.getElementById('candidateSearchStart');s.value='21:30';s.onchange();});await p.locator('#additionalCandidateSearch > button').first().click();await settled(p,'2026-11-16');
    const overnight=await p.evaluate(()=>structuredClone(AstroNotesCandidatePicker.visibleRows()[0])),overnightLoads=(await current(p)).loads;
    await p.locator('#candidateUnifiedResults .list-item:not([hidden])').click();await appearance(p,overnight);await open(p);await settled(p,'2026-11-16');assert.equal((await current(p)).input,'2026-11-15');assert.equal((await current(p)).loads,overnightLoads);assert.equal(await p.locator('#candidateSearchMode').inputValue(),'window');assert.equal(await p.locator('#candidateSearchStart').inputValue(),'21:30');
    await p.evaluate(()=>{window.oldWindowClick=document.querySelector('#candidateUnifiedResults .list-item:not([hidden])').onclick;const m=document.getElementById('candidateSearchMode');m.value='instant';m.onchange();oldWindowClick();});assert.equal((await current(p)).open,true);await p.locator('#additionalCandidateSearch > button').first().click();await settled(p,'2026-11-15');assert.equal(await p.evaluate(()=>dateFixture.loads.at(-1).timeSpec.kind),'instant');assert.equal(await p.evaluate(()=>AstroNotesCandidatePicker.visibleRows()[0].event.at),(await current(p)).at);
    // Pending automatic search and active non-abortable search both stop on close.
    const closeCount=(await current(p)).loads;await p.locator('#candidateNextDay').click();await p.evaluate(()=>navigationHistory.pushRoute('#/records'));await p.waitForTimeout(450);assert.equal(await p.evaluate(()=>dateFixture.loads.length),closeCount);
    await open(p);await p.locator('#candidateNextDay').click();await p.waitForTimeout(450);assert.equal((await current(p)).loads,closeCount,'closing resets auto-search intent');
    await p.evaluate(()=>dateFixture.holdNext=true);await p.locator('#additionalCandidateSearch > button').first().click();await p.waitForFunction(()=>dateFixture.holds.length===1);await p.evaluate(()=>navigationHistory.pushRoute('#/records'));await p.evaluate(()=>dateFixture.holds.shift().release());await p.waitForTimeout(100);assert.equal(await p.locator('#candidateUnifiedResults').count(),0);assert.equal(await p.locator('#candidateDateNavigation').count(),0);
    await open(p);await p.locator('#candidateDate').click();await p.goBack();await p.waitForFunction(()=>!document.getElementById('placeSheet').open&&!document.getElementById('candidateDateCalendar')?.open);
    assert.equal(await p.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()})),before);assert.equal(writes,0);assert.deepEqual(errors,[]);results.push({engine,width,theme,singleSearchCancelAction:true,sameActionDimensions:true,cancelImmediateResume:true,lateResultAndFinallyRefused:true,failureRetry:true,cancelledRecheckRestored:true,cancelledRowsSelectable:true,cachedRestoreSearchRace:true,monthYearLeapBoundary:true,exactTimePreserved:true,instantWindowPreserved:true,overnightSearchRestored:true,debounced:true,staleAndBusyRefused:true,filterSortAndFocusPreserved:true,appearanceAndMapRestored:true,nestedCalendar:true,closeCancels:true,writes});fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(engine,width,'date navigation passed');
   }catch(e){await p.screenshot({path:out+'/'+engine+'-'+width+'-failure.png'}).catch(()=>{});console.error(engine,width,await p.evaluate(()=>{const s=SkyMapUI.selectionState(),plan=AstroNotesCandidatePicker.registeredPlan?.(s),old=dateFixture.lastPlan&&JSON.parse(AstroNotesCandidateDiscovery.requestKey(dateFixture.lastPlan)),fresh=plan&&JSON.parse(AstroNotesCandidateDiscovery.requestKey(plan));return {at:s?.at,input:document.getElementById('candidateDate')?.dataset.date,opportunity:s.candidateOpportunity,focus:document.activeElement?.id,status:document.querySelector('#candidateSearchFeedback [role=status]')?.textContent,loads:dateFixture.loads,keyDiff:old?.map((v,i)=>JSON.stringify(v)===JSON.stringify(fresh?.[i])?null:{index:i,old:v,fresh:fresh?.[i]}).filter(Boolean),rows:AstroNotesCandidatePicker.visibleRows().map(r=>({name:r.place.name,at:r.event.at}))};}).catch(()=>null));throw e;}finally{await context.close();}
  }}finally{await browser.close();}
 }
 fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
