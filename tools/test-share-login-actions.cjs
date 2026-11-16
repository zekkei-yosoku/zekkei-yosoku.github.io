require('./no-open-meteo.cjs');  // テストのブラウザから Open-Meteo へ出さない
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const base=process.env.LOGIN_ACTION_BASE||'http://127.0.0.1:8897/';
(async()=>{
 const context=vm.createContext({TextEncoder,TextDecoder,btoa,atob,Uint8Array,URL,URLSearchParams,Date});vm.runInContext(fs.readFileSync('astronotes-plan.js','utf8')+';globalThis.P=AstroNotesPlan',context);
 const payload=JSON.parse(fs.readFileSync('test-fixtures/plan-links-v3.json'))[1].payload;payload.o=['Synthetic shared observer',35.583465,139.568839,83,1.5,null];payload.air='standard';payload.matchMode='overlap';payload.l.focal=173.4;payload.pan=[.0625,-.125];payload.timelapse={interval:5,count:100,fps:30};
 const hash=new URL(context.P.link(payload)).hash,browser=await chromium.launch({channel:'chrome',headless:true});
 for(const theme of ['light','dark'])for(const lateTools of [false,true,'remembered-refresh','rotated-during-handoff']){
  const c=await browser.newContext({viewport:{width:390,height:900},colorScheme:theme}),tools=['records','tower','diamond','pearl','skymap'],errors=[];
  const rotateDuringHandoff=lateTools==='rotated-during-handoff';
  const accessOrder=[];
  let oldAccessSeenResolve,newAccessSeenResolve;
  const oldAccessSeen=new Promise(resolve=>{oldAccessSeenResolve=resolve;});
  const newAccessSeen=new Promise(resolve=>{newAccessSeenResolve=resolve;});
  let releaseModels=false;const heldModels=[];
  if(rotateDuringHandoff)await c.addInitScript(tools=>localStorage.setItem('sorami.token',JSON.stringify({
   token:'synthetic-before',loginId:'login-actions',tools,role:'user'
  })),tools);
  if(lateTools==='remembered-refresh'){
   await c.addInitScript(()=>localStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-remembered',loginId:'login-actions',tools:['tower'],role:'user'})));
   await c.route(/astronotes-(?:city|tower)-models\.js/,r=>{if(releaseModels)return r.continue();heldModels.push(r);});
  }
  await c.route(/(?:zekkei-api|localhost:8787)/,async r=>{
   const path=new URL(r.request().url()).pathname;
   if(path==='/login')return r.fulfill({json:{token:'synthetic-login-actions',loginId:'login-actions',role:'user',...(lateTools?{}:{tools})}});
   if(path==='/me')return r.fulfill({json:{loginId:'login-actions',role:'user',tools,credentials:[],hasPassword:true,recoveryCodes:10}});
   if(path==='/session/refresh'){
    // Force the token change between starting and accepting the map handoff.
    if(rotateDuringHandoff){await oldAccessSeen;accessOrder.push('refresh');}
    return r.fulfill({json:{token:'synthetic-rotated',loginId:'login-actions'}});
   }
   if(path.includes('/access')){
    if(rotateDuringHandoff&&path==='/tools/skymap/access'){
     const header=r.request().headers().authorization||'';
     if(header.endsWith('synthetic-before')){accessOrder.push('old access');oldAccessSeenResolve();await newAccessSeen;}
     if(header.endsWith('synthetic-rotated')){accessOrder.push('new access');newAccessSeenResolve();}
    }
    return r.fulfill({json:{allowed:true,loginId:'login-actions',tool:'skymap',tools}});
   }
   return r.fulfill({json:{favorites:[],sightings:[],records:[],rev:1}});
  });
  const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));let navigations=0;p.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===p.mainFrame())navigations++;});
  await p.goto(base+hash,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>{try{return typeof PAGE_DIALOGS==='object'&&typeof startupSessionReady!=='undefined'}catch{return false}});await p.evaluate(()=>startupSessionReady);
  const before=navigations;
  if(lateTools==='remembered-refresh'){await p.waitForFunction(()=>auth?.token==='synthetic-rotated');releaseModels=true;for(const route of heldModels)await route.continue();}
  else if(rotateDuringHandoff)await p.waitForFunction(()=>auth?.token==='synthetic-rotated');
  else{assert.equal(await p.evaluate(()=>auth),null);await p.locator('#authButton').click();await p.locator('#authId').fill('login-actions');await p.locator('#authPw').fill('Synthetic-password-only');await p.locator('#pwLogin').click();await p.waitForFunction(()=>{try{return auth?.loginId==='login-actions'&&!loginSettling}catch{return false}});}
  await p.waitForFunction(()=>{try{return !!planSnapshot({dataset:{planSource:'aim'}}).payload}catch{return false}},null,{timeout:45000});
  if(rotateDuringHandoff)assert.deepEqual([...new Set(accessOrder)],['old access','refresh','new access']);
  assert(await p.locator('#skyMapView').evaluate(e=>e.classList.contains('explore-mounted')));
  const restored=await p.evaluate(()=>planSnapshot({dataset:{planSource:'aim'}}).payload);for(const key of ['o','at','body','part','limb','matchMode','air','l','pan','timelapse'])assert.deepEqual(restored[key],payload[key],key+' preserved through login');
  const toolbar=p.locator('#aimView .trial-scene-toolbar'),record=toolbar.locator('#trialRecordSave');
  const dialog=p.locator('#trialRecordSaveSheet'),place=dialog.getByRole('button',{name:'撮影地点に保存'}),plan=dialog.getByRole('button',{name:'予定に保存'});
  assert(await record.isVisible(),'record menu after login without reload');
  assert.equal(await record.count(),1);assert.equal(navigations,before);
  assert.equal(await dialog.locator('[data-quick-save=place] [data-place-add]').count(),1);
  await toolbar.scrollIntoViewIfNeeded();await toolbar.screenshot({path:'/tmp/af-toolbar-'+theme+'-'+lateTools+'.png'});
  await record.click();await place.click();
  await p.waitForFunction(()=>document.getElementById('quickSaveNoticeText')?.textContent==='撮影地点に登録しました');
  await dialog.waitFor({state:'hidden'});await record.click();await plan.click();
  await p.waitForFunction(()=>document.getElementById('quickSaveNoticeText')?.textContent==='予定に保存しました');
  await dialog.waitFor({state:'hidden'});
  await p.evaluate(()=>{renderAuthButton();renderAuthButton();});
  assert.equal(await record.count(),1);assert.equal(await dialog.locator('[data-quick-save=place]').count(),1);assert.equal(await dialog.locator('[data-quick-save=plan]').count(),1);
  console.log(theme,typeof lateTools==='string'?lateTools:lateTools?'late-tools':'login-tools','shared preview and both saves passed');
  await p.screenshot({path:'/tmp/af-login-actions-'+theme+'-'+lateTools+'.png'});assert.deepEqual(errors,[]);await c.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
