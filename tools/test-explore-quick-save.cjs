const {chromium}=require('playwright'),assert=require('assert/strict');
const base=process.env.QUICK_BASE||'http://127.0.0.1:8897/';
const sizes=process.env.QUICK_WIDTH?[+process.env.QUICK_WIDTH]:[320,390,1280];
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 for(const width of sizes)for(const theme of ['light','dark']){
  const c=await browser.newContext({viewport:{width,height:900},colorScheme:theme}),tools=['records','tower','diamond','pearl','skymap'];
  await c.addInitScript(tools=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-quick',loginId:'quick-test',tools})),tools);
  await c.route(/(?:zekkei-api|localhost:8787)/,r=>r.fulfill({status:200,json:{allowed:true,tool:'skymap',loginId:'quick-test',tools,credentials:[],hasPassword:true,recoveryCodes:10,favorites:[],sightings:[],rev:1}}));
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base);await p.waitForFunction(()=>{try{return typeof PAGE_DIALOGS==='object'}catch{return false}});
  await p.evaluate(async()=>{
   await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>83;
   pushRoute('#/explore');

  });
  await p.locator('#exploreConditions').waitFor();await p.evaluate(()=>{aimAirSettings.mode='standard';AstroNotesAtmosphere.configure('standard',aimAirSettings);SkyMapUI.setObserver({name:'Synthetic',latitude:35.583465,longitude:139.568839,groundManualM:83,standAglM:1.5});SkyMapUI.setTarget('skytree');document.getElementById('skyMapBody').value='moon';document.getElementById('skyMapBody').onchange();const at=AstroNotesAlign.dailyView({latitude:35.583465,longitude:139.568839,elevation:84.5},AstroNotesAlign.targetById('skytree'),'moon',Date.parse('2026-10-03T00:00:00+09:00'),{partId:'tip'})[0].at;SkyMapUI.setTime(at);});
  const point=p.locator('#aimView [data-quick-save=place]'),plan=p.locator('#aimView [data-quick-save=plan]');
  await point.waitFor();await p.waitForFunction(()=>{const b=document.querySelector('#aimView [data-quick-save=place]');return b&&!b.disabled;},{timeout:45000});
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
