// 2026-11-11 ユーザー「まだ計算が遅いよ」「戻るボタンがなんかダサい」「てかこの重ね方って何」:
// the view is drawn before the weather answers and stays on screen when it arrives; the back control is a bare
// chevron; the 重ね方 heading icon keeps its small size in the preview too.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.VIEW_FIRST_BASE||'http://127.0.0.1:8992/trial/',tools=['records','tower','diamond','pearl','skymap','multiscene'];
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'ja-JP',timezoneId:'Asia/Tokyo',reducedMotion:'reduce'});
  await context.addInitScript(t=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-ui',loginId:'view-first',tools:t})),tools);
  let weatherDone=false,releaseWeather,markRequested;
  const holdWeather=new Promise(resolve=>{releaseWeather=resolve;});
  const requested=new Promise(resolve=>{markRequested=resolve;});
  const atSelectedPlace=u=>Number(u.searchParams.get('latitude'))===35.66965&&Number(u.searchParams.get('longitude'))===139.76405;
  await context.route('**/*',async route=>{const u=new URL(route.request().url());
   if(/zekkei-api|localhost:8787/.test(u.origin))return route.fulfill({json:{allowed:true,tool:'skymap',loginId:'view-first',tools,favorites:[],sightings:[],records:[],rev:1}});
   if(/open-meteo/.test(u.host)){
    if(atSelectedPlace(u)){markRequested();await holdWeather;weatherDone=true;}
    return route.abort();
   }
   if(/cyberjapandata|overpass|openstreetmap|wikidata/.test(u.host))return route.abort();
   return route.continue();});
  const page=await context.newPage();page.setDefaultTimeout(30000);
  await page.goto(base+'index.html#/explore');
  await page.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof aimTargetList==='function'&&typeof AstroNotesAssets==='object'&&AstroNotesAssets.modelsReady());
  await page.evaluate(async()=>{await startupSessionReady;
   const t=aimTargetList().find(x=>x.name==='東京タワー');SkyMapUI.workspaceHost().restoreTarget({target:structuredClone(t),custom:false});
   SkyMapUI.workspaceHost().restoreObserver({latitude:35.66965,longitude:139.76405,elevation:4.3,name:'確認地点',eyeHeightAGL:1.5});
   const body=document.getElementById('skyMapBody');body.value='moon';body.dispatchEvent(new Event('change',{bubbles:true}));SkyMapUI.setTime(Date.UTC(2026,10,11,8,20));
   await new Promise(r=>setTimeout(r,400));
   const l=document.getElementById('aimLook'),H=globalThis.__hidden=[];new MutationObserver(()=>H.push(l.hidden)).observe(l,{attributes:true,attributeFilter:['hidden']});});
  const t0=Date.now();
  await page.locator('#exploreShowResult').click();
  await page.waitForFunction(()=>{const l=document.getElementById('aimLook');return l&&!l.hidden&&l._lookLayers?.stats?.frames>0;},null,{timeout:3500});
  const drawn=Date.now()-t0;
  assert.equal(weatherDone,false,'the view is on screen before the weather answers ('+drawn+' ms)');
  let timer;
  try{
   await Promise.race([requested,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Error('the selected place weather was never requested')),3500);
   })]);
  }finally{clearTimeout(timer);releaseWeather();}
  await page.waitForTimeout(1500);
  const state=await page.evaluate(()=>({hidden:globalThis.__hidden,now:document.getElementById('aimLook').hidden,status:document.getElementById('exploreSceneStatus')?.textContent||''}));
  assert.ok(weatherDone,'the selected place weather answered during the check');
  assert.equal(state.now,false,'the view stays after the weather answers');
  assert.ok(state.hidden.filter(h=>h===true).length<=1,'the view is not blanked again when the weather arrives: '+JSON.stringify(state.hidden));
  assert.ok(!/計算中|できませんでした/.test(state.status),'no waiting or failure message is left: '+state.status);
  // 2026-11-15 ユーザー「地図を押せば地図に飛ぶから現地写真ってボタンいらなくね」:
  // 地図の既存導線を残し、同じ目的の現地写真ボタンだけを取り除く。
  assert.equal(await page.locator('#exploreStreetPhoto').count(),0,'現地写真の重複ボタンはない');
  const map=await page.evaluate(()=>{const a=document.getElementById('exploreExternalMap');if(!a)return null;const u=new URL(a.href),r=a.getBoundingClientRect();return {href:a.href,params:Object.fromEntries(u.searchParams),host:u.host,target:a.target,rel:a.rel,label:a.textContent,w:r.width,h:r.height};});
  assert.ok(map,'既存の地図ボタンがある');assert.equal(map.host,'www.google.com');assert.equal(map.params.query,'35.6696500, 139.7640500');assert.equal(map.target,'_blank');assert.match(map.rel,/noopener/);assert.equal(map.label,'地図');
  assert.ok(map.w>=44&&map.h>=44,'地図のタッチ領域: '+map.w+'x'+map.h);
  await page.evaluate(()=>AstroNotesPlan.externalApps.set('map','google'));
  await context.route('https://www.google.com/maps/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic map destination</title>'}));
  const opened=page.waitForEvent('popup');await page.locator('#exploreExternalMap').click();const destination=await opened;await destination.waitForURL(map.href);assert.equal(destination.url(),map.href,'地図を押すと撮影地点の地図へ移る');await destination.close();
  const back=await page.evaluate(()=>{const b=document.getElementById('exploreBackToCandidates'),c=getComputedStyle(b),r=b.getBoundingClientRect();return {hidden:b.hidden,border:c.borderTopWidth,background:c.backgroundColor,radius:c.borderRadius,w:r.width,h:r.height,label:b.getAttribute('aria-label')};});
  assert.equal(back.hidden,false);assert.equal(back.border,'0px','no ring around the back chevron');
  assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(back.background),'no filled disc behind the back chevron: '+back.background);
  assert.ok(back.h>=44&&back.w>=28,'the chevron keeps a touch target: '+JSON.stringify(back));assert.ok(back.label,'the chevron is named for assistive tech');
  await page.locator('#exploreConditions > summary .explore-condition-edit').click().catch(()=>page.locator('#exploreConditions > summary').click());
  await page.waitForFunction(()=>document.getElementById('exploreConditions').open);
  const icon=await page.evaluate(()=>{const s=document.querySelector('#skyMapAlignmentSummary svg');if(!s||!s.getClientRects().length)return null;const r=s.getBoundingClientRect();return [r.width,r.height];});
  if(icon)assert.ok(icon[0]<=24&&icon[1]<=24,'the 重ね方 heading icon is small in the preview: '+icon);
  const big=await page.evaluate(()=>[...document.querySelectorAll('#exploreConditions svg')].map(s=>s.getBoundingClientRect()).filter(r=>r.width>64||r.height>64).length);
  assert.equal(big,0,'no oversized icon in the opened conditions');
  console.log(JSON.stringify({drawnMs:drawn,icon,back,map}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
