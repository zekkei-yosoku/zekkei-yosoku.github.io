// Choosing a candidate date must leave the dates under the finger and the page where the user put it.
const {chromium}=require('playwright'),assert=require('assert/strict');
const base=process.env.DATES_BAR_BASE||'http://127.0.0.1:8897/',tools=['records','tower','diamond','pearl','skymap'];
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
const ready=()=>{try{return typeof PAGE_DIALOGS==='object';}catch{return false;}};
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 for(const [width,height] of [[320,568],[390,844],[1280,800]]){
  const c=await browser.newContext({viewport:{width,height}});
  await c.addInitScript(t=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-dates',loginId:'dates-test',tools:t})),tools);
  await c.route(/(?:zekkei-api|localhost:8787)/,r=>r.fulfill({status:200,headers,json:{allowed:true,tool:'skymap',loginId:'dates-test',tools,credentials:[],hasPassword:true,recoveryCodes:10,favorites:[],sightings:[],rev:1}}));
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  const openExplore=async()=>{await p.waitForFunction(ready);await p.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>83;navigationHistory.pushRoute('#/explore');});await p.locator('#exploreDatesToggle').waitFor({state:'attached'});};
  await p.goto(base);await openExplore();
  await p.evaluate(()=>{aimAirSettings.mode='standard';AstroNotesAtmosphere.configure('standard',aimAirSettings);SkyMapUI.setObserver({name:'Synthetic',latitude:35.583465,longitude:139.568839,groundManualM:83,standAglM:1.5});SkyMapUI.setTarget('skytree');document.getElementById('skyMapBody').value='moon';document.getElementById('skyMapBody').onchange();});
  const chips=p.locator('#skyMapDates [data-from-day]');await chips.nth(2).waitFor({timeout:45000});
  const state=()=>p.evaluate(()=>{const f=document.querySelector('#skyMapView .sky-map-footer').getBoundingClientRect(),b=document.querySelector('#skyMapDates [data-from-day]')?.getBoundingClientRect();return {y:Math.round(scrollY),inFooter:!!document.querySelector('#skyMapView .sky-map-footer #skyMapDates'),footerTop:f.top,footerBottom:f.bottom,chipTop:b?.top,chipBottom:b?.bottom,open:document.getElementById('exploreConditions').open,sideways:document.documentElement.scrollWidth>innerWidth};});
  const first=await state();assert(first.inFooter);assert(first.chipTop>=first.footerTop&&first.chipBottom<=height);assert(!first.sideways);assert(first.open);
  await chips.nth(0).click();await p.waitForTimeout(500);const revealed=await state();assert.equal(revealed.open,false,'the first choice closes the conditions');
  await p.evaluate(()=>window.scrollTo(0,60));await p.waitForTimeout(100);const y=(await state()).y;
  const before=await p.evaluate(()=>SkyMapUI.snapshot().at);await chips.nth(1).click();await p.waitForTimeout(500);const after=await state();
  assert.equal(after.y,y,'a later choice does not scroll the page');assert.notEqual(await p.evaluate(()=>SkyMapUI.snapshot().at),before);assert.equal(after.chipTop,revealed.chipTop,'the dates stay put');
  await p.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await p.waitForTimeout(150);
  const covered=await p.evaluate(()=>{const f=document.querySelector('#skyMapView .sky-map-footer').getBoundingClientRect().top;const last=[...document.querySelectorAll('#skyMapContent details,#skyMapContent p')].filter(e=>e.offsetHeight&&!e.closest('.sky-map-footer')).pop();return last.getBoundingClientRect().bottom-f;});assert(covered<=1,'page end is hidden behind the bar: '+covered);
  const more=p.locator('#skyMapDates .strip [data-from-more]');const moreAtEnd=()=>p.evaluate(()=>{const s=document.querySelector('#skyMapDates .strip');return s.lastElementChild===s.querySelector('[data-from-more]');});
  assert(await moreAtEnd(),'the next search follows the last date');const count=await chips.count();await p.evaluate(()=>{const s=document.querySelector('#skyMapDates .strip');s.scrollLeft=s.scrollWidth;});const left=await p.evaluate(()=>document.querySelector('#skyMapDates .strip').scrollLeft);
  await more.click();await p.waitForFunction(n=>document.querySelectorAll('#skyMapDates [data-from-day]').length>n||document.querySelector('#skyMapDates .strip [data-from-more]:not(:disabled)'),count,{timeout:60000});await p.waitForTimeout(300);
  assert(await moreAtEnd()||!(await more.count()),'the next search stays last');assert.equal(await p.locator('#skyMapDates > [data-from-more]').count(),0,'no second button');assert.equal(await p.evaluate(()=>document.querySelector('#skyMapDates .strip').scrollLeft),left,'adding dates keeps the position');
  const toggle=p.locator('#exploreDatesToggle');await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert(await chips.first().isHidden());
  await p.reload();await openExplore();assert.equal(await p.locator('#exploreDatesToggle').getAttribute('aria-expanded'),'false','the choice is remembered');await toggle.click();
  await p.evaluate(()=>navigationHistory.pushRoute('#/records'));await p.locator('#exploreDatesToggle').waitFor({state:'detached'});assert(await p.evaluate(()=>{const d=document.querySelector('.sky-map-candidates');return d.nextElementSibling===document.querySelector('.sky-map-wrap')&&!d.classList.contains('dates-collapsed');}),'the home position is restored');
  assert.deepEqual(errors,[]);await c.close();console.log(width,'ok');
 }
 await browser.close();console.log('PASS explore dates bar');
})().catch(e=>{console.error('FAIL explore dates bar',e.message);process.exit(1);});
