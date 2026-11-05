// Real trial UI, with only outbound launch/file/share ports captured. No OS app
// launch, calendar registration, personal records, or forecast requests occur.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.EXTERNAL_APPS_BASE||'http://127.0.0.1:8997/trial/';
const out=process.env.EXTERNAL_APPS_OUT||'/tmp/astronotes-external-apps';fs.mkdirSync(out,{recursive:true});
const grants=['records','tower','diamond','pearl','skymap','multiscene'];
function installFixture(grants){
 sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-external',loginId:'external-test',tools:grants}));
 const f=window.externalFixture={events:[],deferred:[],shareMode:'resolve',canShare:true,blockStorage:false,storageAttempts:[],instances:0};
 const set=Storage.prototype.setItem;
 Storage.prototype.setItem=function(k,v){if(/^sorami\.(calendarApp|mapApp)$/.test(k)){f.storageAttempts.push(k);if(f.blockStorage)throw new DOMException('synthetic quota','QuotaExceededError');}return set.call(this,k,v);};
 const capture=(kind,file)=>{const e={kind,name:file.name,type:file.type,size:file.size,text:null};f.events.push(e);file.text().then(text=>e.text=text);return e;};
 // The canonical asset publishes this legacy alias immediately before the
 // appended factory definition. Intercept that definition without editing it.
 let alias;
 Object.defineProperty(window,'SoramiPlan',{configurable:true,get:()=>alias,set:api=>{
  alias=api;Object.defineProperty(api,'createExternalApps',{configurable:true,set:factory=>{
   Object.defineProperty(api,'createExternalApps',{configurable:true,writable:true,value:options=>{
    f.instances++;return factory({...options,
     launchUrl:url=>{f.events.push({kind:'url',url});},
     saveFile:file=>{capture('file',file);},
     canShareFile:()=>f.canShare,
     shareFile:file=>{capture('share',file);if(f.shareMode==='wait')return new Promise((resolve,reject)=>f.deferred.push({resolve,reject}));if(f.shareMode==='abort')return Promise.reject(new DOMException('synthetic cancellation','AbortError'));if(f.shareMode==='reject')return Promise.reject(new DOMException('synthetic failure','NotAllowedError'));return Promise.resolve();}
    });
   }});
  }});
 }});
}
const events=p=>p.evaluate(()=>structuredClone(externalFixture.events));
const stored=p=>p.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()}));
const state=p=>p.evaluate(()=>{const s=SkyMapUI.selectionState();return {at:s.at,body:s.body,target:s.target.id,observer:s.observer,partId:s.partId,limb:s.limb,matchMode:s.matchMode};});
async function closePlan(p){if(await p.locator('#planSheet').evaluate(n=>n.open)){await p.locator('#planSheet .page-back').click();await p.waitForFunction(()=>pagePop.n===0);}}
async function settings(p){await closePlan(p);await p.locator('#authButton').click();await p.locator('#appSettings[open]').waitFor();await p.locator('#settingsExternalApps').click();await p.locator('#externalDefaultCalendar').waitFor();}
async function closeSettings(p){await p.locator('#appSettingsClose').click();await p.locator('#appSettings').waitFor({state:'hidden'});}
async function calendar(p){
 if(!await p.locator('#planSheet').evaluate(n=>n.open)){await p.locator('#aimView [data-plan-action=share]').click();await p.locator('#planCalendarTab').click();}
 await p.locator('#planCalendarAdd').waitFor();
}
async function fillEvent(p){
 await p.locator('#planEventTitle').fill('月, 星; テスト\\🌙');
 await p.locator('#planStart').fill('2026-11-05T23:58:01');await p.locator('#planEnd').fill('2026-11-06T00:28:04');
}
async function choose(p,kind,app,remember=false){const prefix=kind==='calendar'?'calendarApp':'mapApp';await p.locator('#'+prefix+'Remember').setChecked(remember);await p.locator('#'+prefix+'Sheet [data-external-app='+app+']').click();}
async function oneMore(p,before,kind){await p.waitForFunction(n=>externalFixture.events.length===n,before+1);const e=(await events(p)).at(-1);assert.equal(e.kind,kind);return e;}
function googleEvent(url){const u=new URL(url);assert.equal(u.hostname,'calendar.google.com');assert.equal(u.searchParams.get('action'),'TEMPLATE');assert.equal(u.searchParams.get('text'),'月, 星; テスト\\🌙');assert.equal(u.searchParams.get('dates'),'20261105T145801Z/20261105T152804Z');assert.equal(u.searchParams.get('ctz'),'Asia/Tokyo');assert(u.searchParams.get('location').includes('35.583465, 139.568839'));return u;}
async function icsEvent(p,index){await p.waitForFunction(i=>typeof externalFixture.events[i]?.text==='string',index);const e=(await events(p))[index],text=e.text.replace(/\r\n /g,'');assert.equal(e.name,'AstroNotes_撮影予定.ics');assert(e.type.startsWith('text/calendar'));assert(text.includes('DTSTART:20261105T145801Z'));assert(text.includes('DTEND:20261105T152804Z'));assert(text.includes('SUMMARY:月\\, 星\\; テスト\\\\🌙'));assert(text.includes('35.583465\\, 139.568839'));assert(!text.includes('VALARM'));return e;}
async function checkLayout(p,id){
 const result=await p.locator(id).evaluate(n=>({overflow:n.scrollWidth>n.clientWidth+1,bodyOverflow:document.documentElement.scrollWidth>innerWidth+1,inputs:[...n.querySelectorAll('select,input:not([type=checkbox])')].filter(n=>n.getClientRects().length).map(n=>parseFloat(getComputedStyle(n).fontSize)),close:[...n.querySelectorAll(':scope > .sheet-head > button')].filter(n=>n.getClientRects().length).map(n=>{const r=n.getBoundingClientRect();return {w:r.width,h:r.height,label:n.getAttribute('aria-label')||n.textContent.trim()};})}));
 assert(!result.overflow&&!result.bodyOverflow,JSON.stringify(result));assert(result.inputs.every(v=>Math.abs(v-16)<.1),JSON.stringify(result));assert(result.close.every(v=>v.w>=43.9&&v.h>=43.9&&v.label),JSON.stringify(result));
}
(async()=>{
 const results=[];
 for(const [engine,type]of [['chrome',chromium],['webkit',webkit]].filter(([n])=>(process.env.EXTERNAL_APPS_ENGINES||'chrome,webkit').split(',').includes(n))){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{for(const width of (process.env.EXTERNAL_APPS_WIDTHS||'320,390,1280').split(',').map(Number))for(const theme of (process.env.EXTERNAL_APPS_THEMES||'light,dark').split(',')){
   const userAgent=width===320?(engine==='chrome'?'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/26.2 Mobile/15E148 Safari/604.1'):(width===1280&&engine==='chrome'?'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36':undefined);
   const context=await browser.newContext({viewport:{width,height:900},locale:'ja-JP',timezoneId:width===390?'America/Los_Angeles':'Asia/Tokyo',colorScheme:theme,reducedMotion:'reduce',...(userAgent?{userAgent}:{})});let writes=0,external=0;
   await context.addInitScript(installFixture,grants);
   await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(base).origin)return r.continue();if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(r.request().method()))writes++;return r.fulfill({json:{allowed:true,tool:'skymap',loginId:'external-test',tools:grants,credentials:[],hasPassword:true,recoveryCodes:10,favorites:[],sightings:[],records:[],rev:1}});}external++;return r.abort();});
   const p=await context.newPage(),errors=[];p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
   try{
    await p.goto(base+'#/explore');await p.waitForFunction(()=>typeof SkyMapUI==='object'&&!!AstroNotesPlan.externalApps);
    await p.evaluate(async theme=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>83;aimBuildingDays=async()=>[];document.documentElement.dataset.theme=theme;aimAirSettings.mode='standard';AstroNotesAtmosphere.configure('standard',aimAirSettings);SkyMapUI.setObserver({name:'外部連携テスト地点',latitude:35.583465,longitude:139.568839,groundManualM:83,standAglM:4});SkyMapUI.setTarget('skytree');const b=document.getElementById('skyMapBody');b.value='moon';b.onchange();SkyMapUI.setTime(Date.parse('2026-11-05T12:34:56+09:00'));},theme);
    await p.waitForFunction(()=>{try{TrialExplore.assertScene();return !!planSnapshot({dataset:{planSource:'aim'}}).payload;}catch{return false;}},null,{timeout:45000});
    assert.equal(await p.evaluate(()=>externalFixture.instances),1);const initialState=await state(p),personal=await stored(p);
    await calendar(p);await fillEvent(p);assert.equal(await p.locator('#planGoogle,#planIcs').count(),0);assert.equal(await p.locator('#planCalendarAdd').count(),1);assert(!(await p.locator('#planCalendar').innerText()).includes('予定ファイルは'));
    const originalFields=await p.locator('#planEventTitle,#planStart,#planEnd').evaluateAll(ns=>ns.map(n=>n.value));await checkLayout(p,'#planSheet');await p.screenshot({path:`${out}/${engine}-${width}-${theme}-calendar.png`});
    await p.locator('#planCalendarAdd').click();await p.locator('#calendarAppSheet[open]').waitFor();assert.equal(await p.locator('#calendarAppRemember').isChecked(),false);assert.equal(await p.locator('#calendarAppSheet [data-external-app]').count(),2);await checkLayout(p,'#calendarAppSheet');await p.screenshot({path:`${out}/${engine}-${width}-${theme}-calendar-choice.png`});
    await p.keyboard.press('Escape');await p.locator('#calendarAppSheet').waitFor({state:'hidden'});assert.equal((await events(p)).length,0);assert.equal(await p.evaluate(()=>document.activeElement.id),'planCalendarAdd');assert.deepEqual(await p.locator('#planEventTitle,#planStart,#planEnd').evaluateAll(ns=>ns.map(n=>n.value)),originalFields);
    await p.locator('#planCalendarAdd').click();await choose(p,'calendar','google');googleEvent((await oneMore(p,0,'url')).url);assert.equal(await p.evaluate(()=>AstroNotesPlan.externalApps.get('calendar')),null);assert.equal(await p.evaluate(()=>externalFixture.storageAttempts.length),0);
    await p.locator('#planCalendarAdd').click();await choose(p,'calendar','google',true);googleEvent((await oneMore(p,1,'url')).url);assert.equal(await p.evaluate(()=>AstroNotesPlan.externalApps.get('calendar')),'google');await p.locator('#planCalendarAdd').click();googleEvent((await oneMore(p,2,'url')).url);assert(!await p.locator('#calendarAppSheet').isVisible());
    await p.locator('#planEventTitle').fill('');assert(await p.locator('#planCalendarAdd').isDisabled());await p.locator('#planEventTitle').fill(originalFields[0]);await p.locator('#planImageTab').click();await p.locator('#planCalendarTab').click();assert.deepEqual(await p.locator('#planEventTitle,#planStart,#planEnd').evaluateAll(ns=>ns.map(n=>n.value)),originalFields);
    const beforeSettings=(await events(p)).length;await settings(p);await checkLayout(p,'#appSettings');assert.equal(await p.locator('#externalDefaultCalendar').inputValue(),'google');await p.locator('#externalDefaultCalendar').selectOption({value:'device'});await p.locator('#externalDefaultMap').selectOption({value:'google'});await p.screenshot({path:`${out}/${engine}-${width}-${theme}-settings.png`});await p.locator('#settingsBack').click();assert.equal(await p.evaluate(()=>document.activeElement.id),'settingsExternalApps');assert(await p.locator('#settingsAccount').isVisible());assert(await p.locator('#settingsScreen').isVisible());await p.screenshot({path:`${out}/${engine}-${width}-${theme}-settings-list.png`});await closeSettings(p);assert.equal((await events(p)).length,beforeSettings,'changing preferences does not launch an app');
    await calendar(p);await fillEvent(p);let n=(await events(p)).length;await p.locator('#planCalendarAdd').click();await oneMore(p,n,'share');await icsEvent(p,n);assert((await p.locator('#planStatus').innerText()).includes('登録を確定'));
    await p.evaluate(()=>externalFixture.shareMode='abort');n=(await events(p)).length;await p.locator('#planCalendarAdd').click();await oneMore(p,n,'share');await p.waitForFunction(()=>document.getElementById('planStatus').textContent.includes('取り消しました'));assert(!await p.locator('#calendarAppSheet').isVisible());assert.equal((await events(p)).filter(e=>e.kind==='file').length,0);
    await p.evaluate(()=>externalFixture.shareMode='reject');n=(await events(p)).length;await p.locator('#planCalendarAdd').click();await oneMore(p,n,'share');await p.locator('#calendarAppSheet[open]').waitFor();assert(await p.locator('#calendarAppRemember').isDisabled());assert(await p.locator('#calendarFileSave').isVisible());await p.screenshot({path:`${out}/${engine}-${width}-${theme}-recovery.png`});await p.locator('#calendarFileSave').click();await oneMore(p,n+1,'file');await icsEvent(p,n+1);assert.equal(await p.evaluate(()=>AstroNotesPlan.externalApps.get('calendar')),'device');
    await p.evaluate(()=>externalFixture.canShare=false);n=(await events(p)).length;await p.locator('#planCalendarAdd').click();await oneMore(p,n,'file');await icsEvent(p,n);assert(!await p.locator('#calendarAppSheet').isVisible());
    // Failure from a share whose parent was closed must not reopen its chooser.
    await p.evaluate(()=>{externalFixture.canShare=true;externalFixture.shareMode='wait';});await p.locator('#planCalendarAdd').click();await p.waitForFunction(()=>externalFixture.deferred.length===1);await closePlan(p);await p.evaluate(()=>externalFixture.deferred.shift().reject(new DOMException('late failure','NotAllowedError')));await p.waitForTimeout(50);assert(!await p.locator('#calendarAppSheet').isVisible());
    // Storage failure is explicit, and a one-time launch never falsely saves.
    await settings(p);await p.locator('#externalDefaultCalendar').selectOption({value:''});await closeSettings(p);await calendar(p);await fillEvent(p);await p.evaluate(()=>externalFixture.blockStorage=true);
    n=(await events(p)).length;const attempts=await p.evaluate(()=>externalFixture.storageAttempts.length);await p.locator('#planCalendarAdd').click();await choose(p,'calendar','google');await oneMore(p,n,'url');assert.equal(await p.evaluate(()=>externalFixture.storageAttempts.length),attempts);
    n=(await events(p)).length;await p.locator('#planCalendarAdd').click();await choose(p,'calendar','google',true);assert(await p.locator('#calendarAppSheet').isVisible());assert.equal((await events(p)).length,n);assert((await p.locator('#calendarAppStatus').innerText()).includes('保存できません'));await p.screenshot({path:`${out}/${engine}-${width}-${theme}-storage-failure.png`});await p.locator('#calendarAppSheet [data-open-once]').click();await oneMore(p,n,'url');assert.equal(await p.evaluate(()=>AstroNotesPlan.externalApps.get('calendar')),null);
    await settings(p);await p.locator('#externalDefaultCalendar').selectOption({value:'device'});assert.equal(await p.locator('#externalDefaultCalendar').inputValue(),'');assert((await p.locator('#externalAppSettingsStatus').innerText()).includes('保存できません'));await p.locator('#externalDefaultMap').selectOption({value:'apple'});assert.equal(await p.locator('#externalDefaultMap').inputValue(),'google');await p.evaluate(()=>externalFixture.blockStorage=false);await p.locator('#externalDefaultMap').selectOption({value:''});await closeSettings(p);
    // Actual appearance-side map entry uses the selected candidate coordinates.
    const map=p.locator('#exploreExternalMap');await map.waitFor();n=(await events(p)).length;await map.click();await p.locator('#mapAppSheet[open]').waitFor();assert.equal(await p.locator('#mapAppCoord').innerText(),'35.5834650, 139.5688390');await checkLayout(p,'#mapAppSheet');await p.screenshot({path:`${out}/${engine}-${width}-${theme}-map-choice.png`});await p.locator('#mapAppClose').click();assert.equal((await events(p)).length,n);assert.equal(await p.evaluate(()=>AstroNotesPlan.externalApps.get('map')),null);
    await map.click();await choose(p,'map','google',true);const mapUrl=new URL((await oneMore(p,n,'url')).url);assert.equal(mapUrl.searchParams.get('query'),'35.5834650, 139.5688390');n++;await map.click();assert.equal((await oneMore(p,n,'url')).url,mapUrl.href);assert(!await p.locator('#mapAppSheet').isVisible());
    // Retained legacy map functions share the same preference and launch owner.
    n=(await events(p)).length;await p.evaluate(()=>openMapApp('apple','35.12345, 139.76543'));const apple=new URL((await oneMore(p,n,'url')).url);assert.equal(apple.hostname,'maps.apple.com');assert.equal(apple.searchParams.get('ll'),'35.12345,139.76543');
    await p.evaluate(()=>openMapAppSheet('35.1234567, 139.7654321'));await p.locator('#mapAppSheet[open]').waitFor();await choose(p,'map','google',false);assert.equal(await p.evaluate(()=>AstroNotesPlan.externalApps.get('map')),null);
    if(width===320&&engine==='chrome'){n=(await events(p)).length;await map.click();await choose(p,'map','device');assert.equal((await oneMore(p,n,'url')).url,'geo:35.5834650,139.5688390?q=35.5834650,139.5688390');}
    // Replacing a chooser invalidates detached choice handlers.
    n=(await events(p)).length;await p.evaluate(()=>{const options={source:document.getElementById('exploreExternalMap'),forceChoose:true};AstroNotesPlan.externalApps.requestMap('35.1, 139.1',options);window.oldMapChoice=document.querySelector('#mapAppSheet [data-external-app=google]').onclick;AstroNotesPlan.externalApps.requestMap('35.2, 139.2',options);oldMapChoice();window.lastMapChoice=document.querySelector('#mapAppSheet [data-external-app=google]').onclick;});assert.equal((await events(p)).length,n);await choose(p,'map','google');assert.equal(new URL((await oneMore(p,n,'url')).url).searchParams.get('query'),'35.2, 139.2');await p.evaluate(()=>lastMapChoice());assert.equal((await events(p)).length,n+1,'a repeated choice callback launches only once');
    n=(await events(p)).length;await p.evaluate(()=>history.pushState({...history.state,externalFixtureBack:true},'',location.href));await map.click();await p.locator('#mapAppSheet[open]').waitFor();await p.goBack();await p.locator('#mapAppSheet').waitFor({state:'hidden'});assert.equal((await events(p)).length,n,'browser Back cancels a chooser opened outside a dialog');
    // Unknown persisted identifiers are ignored. Reload proves device preferences.
    await settings(p);await p.locator('#externalDefaultCalendar').selectOption({value:'google'});await p.locator('#externalDefaultMap').selectOption({value:'apple'});await closeSettings(p);assert.deepEqual(await state(p),initialState);assert.equal(await stored(p),personal);assert.equal(writes,0);assert.deepEqual(errors,[]);
    await p.reload();await p.waitForFunction(()=>!!AstroNotesPlan.externalApps&&typeof startupSessionReady!=='undefined');await p.evaluate(()=>startupSessionReady);assert.equal(await p.evaluate(()=>AstroNotesPlan.externalApps.get('calendar')),'google');assert.equal(await p.evaluate(()=>AstroNotesPlan.externalApps.get('map')),'apple');await p.evaluate(()=>localStorage.setItem('sorami.calendarApp',JSON.stringify('unknown-future-app')));assert.equal(await p.evaluate(()=>AstroNotesPlan.externalApps.get('calendar')),null);assert.equal(writes,0);assert.deepEqual(errors,[]);
    results.push({engine,width,theme,calendarSingleEntry:true,firstDefaultChangeCancel:true,settings:true,storageFailure:true,googleIcsInvariant:true,parentCloseStaleRefused:true,mapEntrypoints:true,sessionUnchanged:true,writes,externalBlocked:external});fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(engine,width,theme,'external apps passed');
   }catch(e){await p.screenshot({path:`${out}/${engine}-${width}-${theme}-failure.png`}).catch(()=>{});console.error(engine,width,theme,errors,await p.evaluate(()=>({dialogs:[...document.querySelectorAll('dialog[open]')].map(n=>n.id),status:document.getElementById('planStatus')?.textContent,events:externalFixture.events.map(({kind,url})=>({kind,url:url?.split('?')[0]})),calendar:AstroNotesPlan.externalApps?.get('calendar'),map:AstroNotesPlan.externalApps?.get('map')})).catch(()=>null));throw e;}finally{await context.close();}
  }}finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
