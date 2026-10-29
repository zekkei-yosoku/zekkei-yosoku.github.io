const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const base=process.env.LOGIN_ACTION_BASE||'http://127.0.0.1:8897/';
(async()=>{
 const context=vm.createContext({TextEncoder,TextDecoder,btoa,atob,Uint8Array,URL,URLSearchParams,Date});vm.runInContext(fs.readFileSync('astronotes-plan.js','utf8')+';globalThis.P=AstroNotesPlan',context);
 const payload=JSON.parse(fs.readFileSync('test-fixtures/plan-links-v3.json'))[1].payload;payload.o=['Synthetic shared observer',35.583465,139.568839,83,1.5,null];payload.air='standard';payload.matchMode='overlap';payload.l.focal=173.4;payload.pan=[.0625,-.125];payload.timelapse={interval:5,count:100,fps:30};
 const hash=new URL(context.P.link(payload)).hash,browser=await chromium.launch({channel:'chrome',headless:true});
 for(const theme of ['light','dark'])for(const lateTools of [false,true,'remembered-refresh']){
  const c=await browser.newContext({viewport:{width:390,height:900},colorScheme:theme}),tools=['records','tower','diamond','pearl','skymap'],errors=[];
  let releaseModels=false;const heldModels=[];
  if(lateTools==='remembered-refresh'){
   await c.addInitScript(()=>localStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-remembered',loginId:'login-actions',tools:['tower'],role:'user'})));
   await c.route(/astronotes-(?:city|tower)-models\.js/,r=>{if(releaseModels)return r.continue();heldModels.push(r);});
  }
  await c.route(/(?:zekkei-api|localhost:8787)/,async r=>{
   const path=new URL(r.request().url()).pathname;
   if(path==='/login')return r.fulfill({json:{token:'synthetic-login-actions',loginId:'login-actions',role:'user',...(lateTools?{}:{tools})}});
   if(path==='/me')return r.fulfill({json:{loginId:'login-actions',role:'user',tools,credentials:[],hasPassword:true,recoveryCodes:10}});
   if(path==='/session/refresh')return r.fulfill({json:{token:'synthetic-rotated',loginId:'login-actions'}});
   if(path.includes('/access'))return r.fulfill({json:{allowed:true,loginId:'login-actions',tool:'skymap',tools}});
   return r.fulfill({json:{favorites:[],sightings:[],records:[],rev:1}});
  });
  const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));let navigations=0;p.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===p.mainFrame())navigations++;});
  await p.goto(base+hash,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>{try{return typeof PAGE_DIALOGS==='object'&&typeof startupSessionReady!=='undefined'}catch{return false}});await p.evaluate(()=>startupSessionReady);
  const before=navigations;
  if(lateTools==='remembered-refresh'){await p.waitForFunction(()=>auth?.token==='synthetic-rotated');releaseModels=true;for(const route of heldModels)await route.continue();}
  else{assert.equal(await p.evaluate(()=>auth),null);await p.locator('#authButton').click();await p.locator('#authId').fill('login-actions');await p.locator('#authPw').fill('Synthetic-password-only');await p.locator('#pwLogin').click();await p.waitForFunction(()=>{try{return auth?.loginId==='login-actions'&&!loginSettling}catch{return false}});}
  await p.waitForFunction(()=>{try{return !!planSnapshot({dataset:{planSource:'aim'}}).payload}catch{return false}},null,{timeout:45000});
  assert(await p.locator('#skyMapView').evaluate(e=>e.classList.contains('explore-mounted')));
  const restored=await p.evaluate(()=>planSnapshot({dataset:{planSource:'aim'}}).payload);for(const key of ['o','at','body','part','limb','matchMode','air','l','pan','timelapse'])assert.deepEqual(restored[key],payload[key],key+' preserved through login');
  const visible=await p.locator('#aimView .trial-scene-toolbar button').evaluateAll(list=>list.filter(e=>e.getClientRects().length).map(e=>({action:e.dataset.quickSave||e.dataset.planAction||'camera',hidden:e.hidden,w:e.clientWidth,h:e.clientHeight})));
  console.log(theme,lateTools==='remembered-refresh'?'remembered-refresh':lateTools?'late-tools':'login-tools',JSON.stringify(visible));assert.equal(visible.filter(x=>x.action==='place').length,1,'place save after login without reload');assert.equal(visible.filter(x=>x.action==='plan').length,1,'plan save after login without reload');assert.equal(visible.length,4);assert.equal(navigations,before);assert.equal(await p.locator('#aimView [data-quick-save=place] [data-place-add]').count(),1);
  await p.locator('#aimView .trial-scene-toolbar').evaluate(e=>e.scrollIntoView({block:'center'}));await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await p.locator('#aimView .trial-scene-toolbar').screenshot({path:'/tmp/af-toolbar-'+theme+'-'+lateTools+'.png'});
  await p.locator('#aimView [data-quick-save=place]').click();assert.equal(await p.locator('#quickSaveNoticeText').textContent(),'撮影地点に登録しました');await p.locator('#aimView [data-quick-save=plan]').click();assert.equal(await p.locator('#quickSaveNoticeText').textContent(),'予定に保存しました');
  await p.evaluate(()=>{renderAuthButton();renderAuthButton();});assert.equal(await p.locator('#aimView [data-quick-save=place]').count(),1);assert.equal(await p.locator('#aimView [data-quick-save=plan]').count(),1);
  await p.screenshot({path:'/tmp/af-login-actions-'+theme+'-'+lateTools+'.png'});assert.deepEqual(errors,[]);await c.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
