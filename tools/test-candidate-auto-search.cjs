// Real Explore tabs and UI, with a controlled place provider and event solver.
require('./no-open-meteo.cjs');
require('./explore-open-conditions.cjs'); // 2026-11-26 探すは地図の段で始まる。検索の段を確かめるため入口で撮影条件を開く
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture}=require('./candidate-date-fixture.cjs');
const base=process.env.CANDIDATE_AUTO_BASE||'http://127.0.0.1:8996/trial/index.html',out=process.env.CANDIDATE_AUTO_OUT||'/tmp/astronotes-auto-candidate';fs.mkdirSync(out,{recursive:true});
const grants=['records','tower','diamond','pearl','skymap','multiscene'];
(async()=>{
 const results=[];
 for(const [engine,type,width,theme]of [['chrome',chromium,390,'light'],['webkit',webkit,320,'dark']]){
  if(process.env.CANDIDATE_AUTO_ENGINE&&engine!==process.env.CANDIDATE_AUTO_ENGINE)continue;
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{
   const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme,locale:'ja-JP',timezoneId:'Asia/Tokyo',reducedMotion:'reduce'});
   let writes=0;const errors=[];
   await context.addInitScript(fixture,grants);
   await context.route('**/*',r=>{const url=new URL(r.request().url());if(url.origin===new URL(base).origin)return r.continue();if(/zekkei-api|localhost:8787/.test(url.origin)){if(!['GET','OPTIONS'].includes(r.request().method()))writes++;return r.fulfill({json:{allowed:true,tool:'skymap',loginId:'date-test',tools:grants,favorites:[],records:[],sightings:[],rev:1}});}return r.abort();});
   const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(20000);
   await p.goto(base+'#/explore');await p.waitForFunction(()=>typeof AstroNotesCandidatePicker==='object');
   await p.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>25;aimBuildingDays=async()=>[];SkyMapUI.setTarget('skytree');const body=document.getElementById('skyMapBody');body.value='moon';body.onchange();SkyMapUI.setTime(Date.parse('2026-11-07T09:00:00+09:00'));dateFixture.autoPages=true;dateFixture.nextCursor=7;dateFixture.holdCursor=7;});
   await p.evaluate(()=>{dateFixture.demoAngles=true;});
   await p.locator('#exploreDiscovery-new').click();
   const button=p.locator('#candidateSearchAction'),feedback=p.locator('#candidateSearchFeedback [role=status]');
   const primary=p.locator('.candidate-search-primary'),working=p.locator('.candidate-search-primary[data-candidate-searching]');
   const progress=primary.locator('[role=progressbar]');
   const state=async text=>{await p.waitForFunction(t=>document.getElementById('candidateSearchAction')?.textContent===t,text);assert.equal(await button.innerText(),text);};
   async function activeProgress(){
    await state('キャンセル');
    assert.equal(await working.count(),1);
    assert(await working.locator('#candidateSearchAction').isVisible());
    assert(await working.getByRole('status').isVisible());
    assert(await working.getByRole('progressbar').isVisible());
    assert.equal(await working.locator('.note-wait-character:visible').count(),0);
   }
   const loads=()=>p.evaluate(()=>dateFixture.loads.map(r=>r.cursor));
   const waitHold=()=>p.waitForFunction(()=>dateFixture.holds.length===1);
   const release=()=>p.evaluate(()=>dateFixture.holds.shift().release());
   const shown=()=>p.evaluate(()=>AstroNotesCandidatePicker.visibleRows().map(r=>r.id));
   await state('候補を探す');assert.deepEqual(await loads(),[]);
   await button.click();await waitHold();assert.deepEqual(await loads(),[0,7]);await activeProgress();
   // The first page's rows stay usable during the next provider read. Its live
   // status keeps the same wording as the candidate evaluation.
   const partialStatus='新規2か所 ・ 撮影候補を確認しています…';
   assert.equal(await working.getByRole('status').innerText(),partialStatus);
   await p.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===2);await activeProgress();
   assert.equal(await working.getByRole('status').innerText(),partialStatus);
   await progress.scrollIntoViewIfNeeded();await p.screenshot({path:out+'/'+engine+'-auto-progress.png'});
   await release();await state('候補を探し直す');assert.equal(await progress.count(),0);assert.equal(await working.count(),0);const first=await shown();assert.equal(first.length,2);assert.equal(new Set(first).size,2);
   await p.evaluate(()=>dateFixture.repeatCursor=true);await button.click();await state('再試行');assert.match(await feedback.innerText(),/情報の取得が進まないため、ここで停止しました。$/);assert.deepEqual(await loads(),[0,7,0,7]);assert.deepEqual(await shown(),first);
   await p.evaluate(()=>dateFixture.repeatCursor=false);await button.click();await state('候補を探し直す');
   await p.evaluate(()=>dateFixture.holdCursor=7);await button.click();await waitHold();await activeProgress();
   await working.getByRole('button',{name:'キャンセル',exact:true}).click();await state('続きを探す');
   assert.equal(await working.count(),0);assert.equal(await progress.count(),0);
   assert.match(await feedback.innerText(),/キャンセルしました/);assert.deepEqual(await shown(),first);
   await release();
   await p.evaluate(()=>{
    dateFixture.holdCursor=7;dateFixture.extraOnCursor=7;
    dateFixture.resumeButtons=[...document.querySelectorAll('#candidateUnifiedResults > button')];
   });
   const beforeResume=(await loads()).length;
   await button.click();await waitHold();await activeProgress();
   assert.deepEqual(await shown(),first,'found places stay usable while waiting for the next page');
   await p.evaluate(()=>AstroNotesCandidatePicker.apply());
   assert(await p.evaluate(()=>dateFixture.resumeButtons.every(n=>n.parentElement?.id==='candidateUnifiedResults')));
   await p.locator('#candidateMapToggle').click();assert(await p.locator('#candidateMapPanel').isVisible());
   await release();await state('候補を探し直す');assert.equal((await loads()).length,beforeResume+1);assert.equal((await loads()).at(-1),7);
   assert(await p.locator('#candidateMapPanel').isVisible(),'publishing the next page preserves the map');
   await p.locator('#candidateMapToggle').click();
   await p.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===3);
   const appended=await shown();assert(first.every(id=>appended.includes(id)));assert.equal(new Set(appended).size,3);
   assert(await p.evaluate(()=>dateFixture.resumeButtons.every(n=>n.parentElement?.id==='candidateUnifiedResults')));
   const angleCells=p.locator('#candidateUnifiedResults [data-candidate-angle]');
   assert.deepEqual((await angleCells.allTextContents()).sort(),['仰角 6°','俯角 2°','水平 0°'].sort());
   assert.deepEqual((await angleCells.evaluateAll(cells=>cells.map(cell=>cell.getAttribute('aria-label')))).sort(),
    ['対象の仰角 6度、水平より上を見る角度','対象の俯角 2度、水平より下を見る角度','対象は水平、0度'].sort());
   assert.deepEqual((await angleCells.evaluateAll(cells=>cells.map(cell=>cell.querySelector('svg')?.dataset.pictogram))).sort(),
    ['angle-up','angle-down','angle-level'].sort());
   assert((await angleCells.first().ariaSnapshot()).includes('img "'+await angleCells.first().getAttribute('aria-label')+'"'));
   // The displayed rounded value owns the glyph, including negative zero.
   await p.evaluate(()=>{
    const button=document.querySelector('#candidateUnifiedResults > button');
    const row=AstroNotesCandidatePicker.visibleRows().find(r=>AstroNotesCandidatePicker.candidateKey(r)===button.dataset.candidateId);
    if(!row)throw Error('No source row for the displayed angle fixture');
    dateFixture.angleProbe={row,value:row.quality.targetAngleDeg,button,text:button.querySelector('[data-angle-label]')};button.focus();
   });
   for(const [value,text,direction]of [[6.1,'仰角 6°','up'],[6.2,'仰角 6°','up'],[.49,'水平 0°','level'],[-.49,'水平 0°','level'],[-.5,'水平 0°','level'],[.5,'仰角 1°','up'],[-.51,'俯角 1°','down'],[null,'—',null]]){
    const state=await p.evaluate(async({value,direction})=>{
     const a=dateFixture.angleProbe,old=a.button.querySelector('svg[data-pictogram^="angle-"]'),same=old?.dataset.pictogram==='angle-'+direction;
     a.row.quality.targetAngleDeg=value;await AstroNotesCandidatePicker.apply();
     const cell=a.button.querySelector('[data-candidate-angle]'),svg=cell.querySelector('svg');
     return {text:cell.textContent,glyph:svg?.dataset.pictogram||null,hidden:cell.hidden,stableButton:a.button.parentElement?.id==='candidateUnifiedResults',
      stableText:cell.querySelector('[data-angle-label]')===a.text,stableSvg:!same||svg===old,focused:a.button===document.activeElement,
      width:svg?.getBoundingClientRect().width??null,decorative:!svg||cell.querySelector('[data-angle-icon]').getAttribute('aria-hidden')==='true'};
    },{value,direction});
    assert.equal(state.text,text);assert.equal(state.glyph,direction?'angle-'+direction:null);assert.equal(state.hidden,direction===null);
    for(const k of ['stableButton','stableText','stableSvg','focused','decorative'])assert(state[k],k+' '+value);
    if(direction)assert.equal(state.width,24);
   }
   await p.evaluate(async()=>{const a=dateFixture.angleProbe;a.row.quality.targetAngleDeg=a.value;await AstroNotesCandidatePicker.apply();});
   // The existing four-column consumer keeps signed numbers and a dash for unknown.
   const table=await p.evaluate(async()=>{
    const host=document.createElement('div');host.style.width='280px';document.body.append(host);
    try{
     const base=dateFixture.angleProbe.row,rows=[6,-2,.49,null].map((angle,i)=>({...base,place:{...base.place,id:'angle-table-'+i},
      event:{...base.event,at:base.event.at+i*60000,targetAltitude:angle},quality:{...base.quality,targetAngleDeg:angle}}));
     await AstroNotesCandidatePicker.renderRecorded(host,rows,{}, {compact:false,aggregate:false,select(){}});
     return [...host.querySelectorAll('[data-candidate-angle]')].map(c=>({text:c.textContent,glyph:c.querySelector('svg')?.dataset.pictogram||null,hidden:c.hidden,overflow:c.closest('button').scrollWidth>c.closest('button').clientWidth+1}));
    }finally{host.remove();}
   });
   assert.deepEqual(table.map(r=>r.text),['6°','-2°','0°','—']);
   assert.deepEqual(table.map(r=>r.glyph),['angle-up','angle-down','angle-level',null]);assert(table.every(r=>!r.hidden&&!r.overflow));
   await angleCells.first().scrollIntoViewIfNeeded();await p.screenshot({path:out+'/'+engine+'-angle-glyphs.png'});
   await p.evaluate(()=>{dateFixture.extraOnCursor=null;});
   await p.evaluate(()=>dateFixture.holdCursor=7);await button.click();await waitHold();await p.locator('#skyMapNext').click();await state('候補を探す');
   await release();assert.equal(await progress.count(),0);assert.deepEqual(await shown(),[]);
   await button.click();await state('候補を探し直す');const next=await shown();assert(next.every(id=>id.startsWith('2026-11-08')));assert.equal(next.length,2);
   // The already visible buttons must also be selectable before the resumed batch can publish.
   await p.evaluate(()=>dateFixture.holdCursor=7);await button.click();await waitHold();
   await p.waitForFunction(()=>AstroNotesCandidatePicker.visibleRows().length===2);
   await button.click();await state('続きを探す');await release();
   await p.evaluate(()=>dateFixture.holdCursor=7);await button.click();await waitHold();
   const chosen=await p.evaluate(()=>{const r=AstroNotesCandidatePicker.visibleRows()[0];return {at:r.event.at,lat:r.place.latitude,lon:r.place.longitude};});
   await p.locator('#candidateUnifiedResults > button:visible').first().click();
   await p.waitForFunction(x=>{
    const s=SkyMapUI.selectionState();
    return document.getElementById('skyMapView').dataset.exploreStage==='preview'&&s.at===x.at&&s.observer.latitude===x.lat&&s.observer.longitude===x.lon;
   },chosen);
   await release();
   assert.equal(writes,0);assert.deepEqual(errors,[]);
   const version=await p.evaluate(()=>new URL([...document.scripts].find(s=>s.src.includes('astronotes-candidate-search.js')).src).searchParams.get('v'));
   results.push({engine,width,theme,version,passed:true,compactProgressAndCancel:true,autoPages:[0,7],stalledCursorReportsRetry:true,manualCancelAndResume:true,retainedRowsSelectable:true,angleLabels:true,angleGlyphs:true,roundedZeroAndUnknown:true,stableAngleDom:true,fourColumnGlyphs:true,lateOldDateIgnored:true,writes,errors});fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS',engine,width,'automatic candidate search');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
