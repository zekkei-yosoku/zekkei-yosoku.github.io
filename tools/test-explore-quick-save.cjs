require('./no-open-meteo.cjs');  // テストのブラウザから Open-Meteo へ出さない
const {chromium,webkit}=require('playwright'),assert=require('assert/strict'),fs=require('node:fs');
const base=process.env.QUICK_BASE||'http://127.0.0.1:8897/';
const sizes=process.env.QUICK_WIDTH?process.env.QUICK_WIDTH.split(',').map(Number):[320,390,1280];
const engine=process.env.QUICK_ENGINE||'chrome',out=process.env.QUICK_OUT||'/tmp/astronotes-explore-record-save';fs.mkdirSync(out,{recursive:true});
async function verifyRecordChooser(p,width,theme){
 const trigger=p.locator('#trialRecordSave'),sheet=p.locator('#trialRecordSaveSheet'),point=sheet.locator('[data-quick-save=place]'),plan=sheet.locator('[data-quick-save=plan]');
 const saved=()=>p.evaluate(()=>JSON.stringify({favorites,rows:MyPlacesUI.load(),plans:schedule().list()}));
 const calls=()=>p.evaluate(()=>quickSaveFixture.calls.length);
 const open=async()=>{await trigger.click();await sheet.waitFor({state:'visible'});assert(await point.isVisible());assert(await plan.isVisible());};
 const choose=async(button,kind)=>{const before=await calls();await open();await button.click();await sheet.waitFor({state:'hidden'});assert.equal(await calls(),before+1,'one choice invokes the existing save handler once');assert.equal(await p.evaluate(()=>quickSaveFixture.calls.at(-1).kind),kind);assert.equal(await p.evaluate(()=>document.activeElement.id),'trialRecordSave');};
 await trigger.waitFor({state:'visible'});await p.waitForFunction(()=>{try{planSnapshot({dataset:{planSource:'aim'}});return true}catch{return false}});
 assert.equal(await p.locator('#aimLook .trial-scene-toolbar [data-quick-save]:visible').count(),0);
 const initial=await saved();assert.equal(await calls(),0);
 await open();assert.equal(await saved(),initial);assert.equal(await calls(),0);await sheet.getByRole('button',{name:'閉じる',exact:true}).click();await sheet.waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>document.activeElement.id),'trialRecordSave');
 await open();await p.keyboard.press('Escape');await sheet.waitFor({state:'hidden'});assert.equal(await saved(),initial);assert.equal(await calls(),0,'all dismiss paths leave the save handler untouched');
 await open();await p.evaluate(()=>navigationHistory.pushRoute('#/almanac'));await p.waitForFunction(()=>!document.getElementById('trialRecordSaveSheet')?.open);assert.equal(await saved(),initial);
 await p.evaluate(()=>navigationHistory.pushRoute('#/explore'));await p.locator('#exploreShowResult').click();await trigger.waitFor({state:'visible'});
 assert.equal(await p.locator('#trialRecordSaveSheet').count(),1);await open();assert(await sheet.evaluate(n=>n.matches(':modal')),'returning after a route change opens a real modal again');await p.keyboard.press('Escape');await sheet.waitFor({state:'hidden'});assert.equal(await calls(),0);
 // Existing transaction failure must roll back, with the chooser merely selecting its destination.
 await p.evaluate(()=>{window.quickOriginalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('sorami.observations.v1:'))throw new DOMException('synthetic quota','QuotaExceededError');return quickOriginalSet.call(this,k,v);};});
 await choose(point,'place');assert((await p.locator('#quickSaveNoticeText').textContent()).includes('取り消しました'));assert.equal(await saved(),initial);
 await p.evaluate(()=>{Storage.prototype.setItem=quickOriginalSet;delete window.quickOriginalSet;});
 await choose(point,'place');assert.equal(await p.locator('#quickSaveNoticeText').textContent(),'撮影地点に登録しました');
 const registered=await p.evaluate(()=>({favorites,rows:MyPlacesUI.load(),stored:localStorage.getItem('sorami.observations.v1:quick-test')}));assert.equal(registered.rows.length,1);assert(registered.rows[0].registration);assert.equal(registered.rows[0].date,'');assert.equal(registered.favorites[0].eyeHeightAGL,1.5);
 await choose(point,'place');assert.equal(await p.locator('#quickSaveNoticeText').textContent(),'すでに登録されています');assert.equal(await p.evaluate(()=>localStorage.getItem('sorami.observations.v1:quick-test')),registered.stored);
 await choose(plan,'plan');assert.equal(await p.locator('#quickSaveNoticeText').textContent(),'予定に保存しました');assert(await p.locator('#planSheet').isHidden());
 assert(await p.evaluate(()=>{const cur=planSnapshot({dataset:{planSource:'aim'}}),r=schedule().list()[0];return r.start===cur.start&&r.end===cur.end;}));
 const scheduleBefore=await p.evaluate(()=>localStorage.getItem('sorami.schedule.v1:quick-test'));assert.equal(JSON.parse(scheduleBefore).length,1);
 await choose(plan,'plan');assert.equal(await p.locator('#quickSaveNoticeText').textContent(),'すでに登録されています');assert.equal(await p.evaluate(()=>localStorage.getItem('sorami.schedule.v1:quick-test')),scheduleBefore);
 // Revocation between opening the chooser and choosing a destination must refuse a stale action.
 const beforeRevocation=await saved(),beforeCalls=await calls();await open();await p.evaluate(()=>{auth={...auth,tools:auth.tools.filter(t=>t!=='records')};});await point.click();await sheet.waitFor({state:'hidden'});assert.equal(await saved(),beforeRevocation);assert.equal(await calls(),beforeCalls+1);assert((await p.locator('#quickSaveNoticeText').textContent()).includes('ログイン'));
 const toolbar=await p.locator('#aimLook .trial-scene-toolbar').evaluate(row=>[...row.querySelectorAll('button,a')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return {w:r.width,h:r.height,right:r.right};}));assert.equal(toolbar.length,4);assert(toolbar.every(r=>r.w>=43.9&&r.h>=43.9&&r.right<=width+.6));
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:out+'/'+engine+'-'+width+'-'+theme+'.png'});
 const result={engine,width,theme,openAndCancelSaveNothing:true,routeExitClosesAndReentryIsModal:true,selectedHandlerOnce:true,failedTransactionRollsBack:true,duplicatePointAndPlanUnchanged:true,revokedPermissionRefusesSave:true,calls:await p.evaluate(()=>quickSaveFixture.calls)};fs.writeFileSync(out+'/'+engine+'-'+width+'-'+theme+'.json',JSON.stringify(result,null,2));
}
(async()=>{
 const browser=await (engine==='webkit'?webkit:chromium).launch(engine==='webkit'?{headless:true}:{channel:'chrome',headless:true});
 for(const width of sizes)for(const theme of ['light','dark']){
  const c=await browser.newContext({viewport:{width,height:900},colorScheme:theme}),tools=['records','tower','diamond','pearl','skymap'];
  await c.addInitScript(tools=>{sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-quick',loginId:'quick-test',tools}));window.quickSaveFixture={calls:[]};let alias;Object.defineProperty(window,'SoramiPlan',{configurable:true,get:()=>alias,set:api=>{alias=api;const mount=api.mount;api.mount=options=>mount({...options,quickSave:(kind,source)=>{quickSaveFixture.calls.push({kind,source:source?.dataset.planSource});return options.quickSave?.(kind,source);}});}});},tools);
  await c.route(/(?:zekkei-api|localhost:8787)/,r=>r.fulfill({status:200,json:{allowed:true,tool:'skymap',loginId:'quick-test',tools,credentials:[],hasPassword:true,recoveryCodes:10,favorites:[],sightings:[],rev:1}}));
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base);await p.waitForFunction(()=>{try{return typeof PAGE_DIALOGS==='object'}catch{return false}});
  await p.evaluate(async()=>{
   await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>83;
   navigationHistory.pushRoute('#/explore');

  });
  await p.locator('#exploreConditions').waitFor();await p.evaluate(()=>{aimAirSettings.mode='standard';AstroNotesAtmosphere.configure('standard',aimAirSettings);SkyMapUI.setObserver({name:'Synthetic',latitude:35.583465,longitude:139.568839,groundManualM:83,standAglM:1.5});SkyMapUI.setTarget('skytree');document.getElementById('skyMapBody').value='moon';document.getElementById('skyMapBody').onchange();const at=AstroNotesAlign.dailyView({latitude:35.583465,longitude:139.568839,elevation:84.5},AstroNotesAlign.targetById('skytree'),'moon',Date.parse('2026-10-03T00:00:00+09:00'),{partId:'tip'})[0].at;SkyMapUI.setTime(at);});
  if(await p.locator('#candidateSearchAction').count()){
   await p.locator('#exploreShowResult').click();await p.locator('#aimLook').waitFor({state:'visible'});
   await p.locator('#trialRecordSave').waitFor({state:'visible'});
   try{await verifyRecordChooser(p,width,theme);assert.deepEqual(errors,[]);}catch(error){await p.screenshot({path:out+'/'+engine+'-'+width+'-'+theme+'-failure.png'}).catch(()=>{});throw error;}finally{await c.close();}
   console.log(engine,width,theme,'record chooser, cancel, one save, duplicate, denied passed');continue;
  }
  const point=p.locator('#aimView [data-quick-save=place]'),plan=p.locator('#aimView [data-quick-save=plan]');
  await point.waitFor();await p.waitForFunction(()=>{const b=document.querySelector('#aimView [data-quick-save=place]');return b&&!b.disabled;},{timeout:45000});
  // Editing a sticky collapsed card must reveal its fields, including keyboard use.
  await p.evaluate(()=>{document.getElementById('exploreConditions').open=false;window.scrollTo(0,600);});
  const summary=p.locator('#exploreConditions > summary');
  await summary.click();await p.waitForFunction(()=>document.getElementById('exploreConditions').open&&Math.abs(document.getElementById('skyMapView').getBoundingClientRect().top)<2);
  assert(await p.locator('#exploreShowResult').isVisible());
  await p.evaluate(()=>window.scrollTo(0,40));const closeY=await p.evaluate(()=>scrollY);
  await summary.click();await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>scrollY),closeY);
  await p.evaluate(()=>window.scrollTo(0,600));await summary.focus();await p.keyboard.press('Enter');
  await p.waitForFunction(()=>document.getElementById('exploreConditions').open&&Math.abs(document.getElementById('skyMapView').getBoundingClientRect().top)<2);
  await point.scrollIntoViewIfNeeded();await p.waitForFunction(()=>{try{TrialExplore.assertScene();return true}catch{return false}});
  const snap=await p.evaluate(async()=>{
   const h=document.getElementById('aimLook');aimLens.mode='manual';aimLens.focal=200;await aimLookRender(h,h._lookSpec);h.querySelector('[data-lens-center]').click();
   const y=h._lensOffset[1],at=h._lookAt,spans=h._uiTime.frameSpans;
   h._lensOffset=[.08,y+.08];await aimLookRender(h,h._lookSpec);
   const cv=h.querySelector('[data-look-canvas]'),r=cv.getBoundingClientRect(),x=r.left+r.width/2,cy=r.top+r.height/2,dx=-.08*r.width+5,dy=-.08*r.height+5;
   cv.onpointerdown({pointerId:21,pointerType:'touch',clientX:x-30,clientY:cy});cv.onpointerdown({pointerId:22,pointerType:'touch',clientX:x+30,clientY:cy});
   cv.onpointermove({pointerId:21,pointerType:'touch',clientX:x-30+dx,clientY:cy+dy});cv.onpointermove({pointerId:22,pointerType:'touch',clientX:x+30+dx,clientY:cy+dy});
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const offset=[...h._lensOffset],flags={...h._lensSnap};cv.onpointerup({pointerId:22});cv.onpointerup({pointerId:21});
   return {offset,y,flags,at,current:h._lookAt,spans:Array.isArray(spans)&&spans.length>0,spanContains:spans.some(r=>r.start<=at&&r.end>=at),text:h.querySelector('[data-look-frame-times]').textContent};
  });
  assert(snap.spans&&snap.spanContains&&snap.text.includes('画角内'));assert(snap.flags.ground&&snap.flags.center,JSON.stringify(snap));assert(Math.abs(snap.offset[0])<1e-8&&Math.abs(snap.offset[1]-snap.y)<1e-8);assert.equal(snap.current,snap.at);
  await p.waitForFunction(()=>{try{planSnapshot({dataset:{planSource:'aim'}});return true}catch{return false}});
  await p.evaluate(()=>{window.quickOriginalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('sorami.observations.v1:'))throw new DOMException('synthetic quota','QuotaExceededError');return window.quickOriginalSet.call(this,k,v);};});
  await point.click();assert((await p.locator('#quickSaveNoticeText').textContent()).includes('取り消しました'));assert.equal(await p.evaluate(()=>MyPlacesUI.load().length),0);assert.equal(await p.evaluate(()=>favorites.length),0);
  await p.evaluate(()=>{Storage.prototype.setItem=window.quickOriginalSet;delete window.quickOriginalSet;});
  await point.click();assert.equal(await p.locator('#quickSaveNoticeText').textContent(),'撮影地点に登録しました');assert.equal(await p.locator('dialog[open]').count(),0);
  const state=await p.evaluate(()=>({favorites,rows:MyPlacesUI.load(),stored:localStorage.getItem('sorami.observations.v1:quick-test')}));assert.equal(state.rows.length,1);assert(state.rows[0].registration);assert.equal(state.rows[0].date,'');assert.equal(state.favorites[0].eyeHeightAGL,1.5);
  await point.click();assert.equal(await p.locator('#quickSaveNoticeText').textContent(),'すでに登録されています');assert.equal(await p.evaluate(()=>localStorage.getItem('sorami.observations.v1:quick-test')),state.stored);
  await plan.click();assert.equal(await p.locator('#quickSaveNoticeText').textContent(),'予定に保存しました');assert.equal(await p.locator('#planSheet').isVisible(),false);
  assert(await p.evaluate(()=>{const cur=planSnapshot({dataset:{planSource:'aim'}}),r=schedule().list()[0];return r.start===cur.start&&r.end===cur.end&&document.getElementById('aimLook')._uiTime.frameSpans.some(s=>s.start===r.start&&s.end===r.end);}));
  const toolbar=await p.locator('#aimView .trial-scene-toolbar button').evaluateAll(list=>list.filter(e=>e.getClientRects().length).map(e=>({w:e.clientWidth,h:e.clientHeight})));assert.equal(toolbar.length,4);assert(toolbar.every(r=>r.w>=44&&r.h>=44));
  const before=await p.evaluate(()=>localStorage.getItem('sorami.schedule.v1:quick-test'));assert.equal(JSON.parse(before).length,1);
  await plan.click();assert.equal(await p.locator('#quickSaveNoticeText').textContent(),'すでに登録されています');assert.equal(await p.evaluate(()=>localStorage.getItem('sorami.schedule.v1:quick-test')),before);
  await p.waitForTimeout(3700);assert(await p.locator('#quickSaveNotice').isHidden());await p.locator('#aimView .trial-scene-toolbar').screenshot({path:'/tmp/explore-actions-final-'+width+'-'+theme+'.png'});
  if(width===390){
   await p.evaluate(()=>{window.savedShareAssertion=TrialExplore.assertScene;window.shareReadyAt=Date.now()+1200;TrialExplore.assertScene=()=>{if(Date.now()<shareReadyAt)throw Error('見え方の更新が終わってから共有してください');return savedShareAssertion();};});
   await p.locator('#aimView [data-plan-action=share]').click();assert((await p.locator('#planWaitingMessage').innerText()).includes('準備'));assert(await p.locator('#planWaiting .note-wait-character').isVisible());await p.screenshot({path:'/tmp/ad-astro-wait-'+theme+'.png'});await p.locator('#planCopy:not(:disabled)').waitFor();assert(await p.locator('#planImage').isVisible());
   await p.evaluate(()=>TrialExplore.assertScene=savedShareAssertion);await p.locator('#planSheet .page-back').click();await p.waitForFunction(()=>pagePop.n===0);
   // The old native close event must not erase the reopened snapshot or pageStack entry.
   await p.evaluate(async()=>{const b=document.querySelector('#aimView [data-plan-action=share]');await AstroNotesPlanUI.open('export',b);document.getElementById('planSheet').close();await AstroNotesPlanUI.open('export',b);});
   await p.waitForTimeout(80);assert(await p.evaluate(()=>pageStack.includes(document.getElementById('planSheet'))));await p.locator('#planImageTab').click();await p.locator('#planCopy:not(:disabled)').waitFor();assert(!(await p.locator('#planStatus').innerText()).includes('payload'));await p.locator('#planSheet .page-back').click();await p.waitForFunction(()=>pagePop.n===0);
  }
  await p.locator('#aimView [data-plan-action=share]').click();await p.locator('#planImageTab').waitFor();
  await p.locator('#planCalendarTab').click();await p.locator('#planEventTitle').waitFor();assert(await p.locator('#planCalendar').isVisible());assert(await p.locator('#planKeep').isHidden());assert.equal(await p.locator('#planReminder').count(),0);assert(!(await p.locator('#planCalendar').innerText()).includes('通知'));assert(await p.locator('#planGoogle').getAttribute('href'));const start=await p.locator('#planStart').inputValue();
  await p.locator('#planImageTab').click();await p.locator('#planCalendarTab').click();assert.equal(await p.locator('#planStart').inputValue(),start);
  if(width===390){
   await p.locator('#planImageTab').click();await p.locator('#planCopy:not(:disabled)').waitFor();await p.evaluate(()=>{navigator.clipboard.writeText=async text=>{window.fixtureCopiedLink=text;};});await p.locator('#planCopy').click();const copied=await p.evaluate(()=>fixtureCopiedLink),url=new URL(copied);assert.equal(url.search,'');assert(url.hash.startsWith('#p='));assert(!/\s/.test(copied));
   const expected=await p.evaluate(text=>AstroNotesPlan.decode(new URL(text).hash.slice(3)),copied),destination=new URL(base);destination.hash=url.hash;
   const q=await c.newPage();q.on('pageerror',e=>errors.push(e.message));await q.goto(destination.href);await q.waitForFunction(()=>{try{return typeof PAGE_DIALOGS==='object'}catch{return false}});await q.waitForFunction(()=>{try{return !!planSnapshot({dataset:{planSource:'aim'}}).payload}catch{return false}},{},{timeout:45000});
   const restored=await q.evaluate(()=>planSnapshot({dataset:{planSource:'aim'}}).payload);for(const key of ['o','at','body','part','limb','matchMode','air','l','pan'])assert.deepEqual(restored[key],expected[key],key+' from short link');assert.equal(restored.t.id,expected.t.id);assert.deepEqual(restored.t.parts,expected.t.parts);await q.close();await p.bringToFront();await p.locator('#planCalendarTab').click();
  }
  await p.locator('#planSheet .page-back').click();await p.waitForFunction(()=>pagePop.n===0);
  await p.locator('#exploreMapTab').click();await p.locator('#skyMapShareRow [data-quick-save=place]').click();assert.equal(await p.locator('#quickSaveNoticeText').textContent(),'すでに登録されています');
  await p.locator('#skyMapShareRow [data-quick-save=plan]').click();const count=await p.evaluate(()=>schedule().list().length);assert.equal(count,1);
  const layout=await p.evaluate(()=>[...document.querySelectorAll('#skyMapShareRow [data-quick-save],#skyMapShareRow [data-plan-action=share]')].filter(e=>e.getClientRects().length).map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height,right:e.getBoundingClientRect().right})));assert(layout.every(e=>e.w>=43.9&&e.h>=43.9&&e.right<=width),JSON.stringify(layout));
  await p.evaluate(()=>{auth={...auth,tools:auth.tools.filter(t=>t!=='records')};});await p.locator('#skyMapShareRow [data-quick-save=place]').click();assert((await p.locator('#quickSaveNoticeText').textContent()).includes('ログイン'));await p.waitForTimeout(3700);assert(await p.locator('#quickSaveNotice').isVisible());await p.locator('#quickSaveNotice button').click();assert(await p.locator('#quickSaveNotice').isHidden());
  assert.deepEqual(errors,[]);await p.screenshot({path:'/tmp/explore-quick-save-'+width+'-'+theme+'.png'});await c.close();console.log(width,theme,'point/plan direct, duplicate unchanged, transient success, calendar tabs, map, denied');
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
