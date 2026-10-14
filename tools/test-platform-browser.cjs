const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict'),fs=require('fs');
const output=process.env.PLATFORM_TEST_OUTPUT||'/tmp/astro-platform-browser';fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const ctx=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark'});
 const tools=['skymap','tower','diamond','pearl','plane','iss','records'];
 let user='layout-user-A',grants=[...tools],accessCalls=0,syncCalls=0,delay=null;
 await ctx.route(/https?:\/\/(localhost:8787|zekkei-api\.okayu-sorami\.workers\.dev)\//,async r=>{
  const path=new URL(r.request().url()).pathname;let data={ok:true};
  if(path==='/me')data={loginId:user,role:'user',tools:grants};
  if(path==='/tools/skymap/access'){accessCalls++;if(delay)await delay;data={allowed:grants.includes('skymap'),tool:'skymap',loginId:user,role:'user',tools:grants};}
  if(path==='/sync'){syncCalls++;data={favorites:[],sightings:[],rev:0};}
  await r.fulfill({status:path.startsWith('/prediction')?503:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type'},body:JSON.stringify(data)});
 });
 await ctx.addInitScript(tools=>{sessionStorage.setItem('sorami.token',JSON.stringify({token:'disposable-layout-A',loginId:'layout-user-A',role:'user',tools}));localStorage.setItem('sorami.owner',JSON.stringify('layout-user-A'));},tools);
 const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(process.argv[2]||'http://127.0.0.1:8795/');
 await p.waitForFunction(()=>!!PlatformUI&&auth?.loginId==='layout-user-A');
 assert.equal(await p.locator('#modeAstro').innerText(),'AstroNotes');
 await p.locator('#modeAstro').click();await p.locator('#astroHomeView').waitFor({state:'visible'});
 assert.equal(await p.locator('#astroLaunchers button').count(),4);
 await p.locator('#platformDate').click();await p.locator('#platformDateInput').fill('2027-02-03T04:05');await p.locator('#platformDateApply').click();
 assert.equal(await p.evaluate(()=>PlatformUI.context().at),Date.parse('2027-02-03T04:05:00+09:00'));
 const target={point:{id:'test-place-id',terrain:'summit',name:'検証用の地点A',latitude:35.658,longitude:139.7016,elevation:15,eyeHeightAGL:350},at:Date.parse('2028-11-05T16:04:00+09:00')};
 await p.evaluate(v=>PlatformUI.setContext(v),target);
 await p.locator('#modeForecast').click();assert.equal(await p.locator('#platformPlaceName').innerText(),target.point.name);
 assert.equal(await p.evaluate(()=>PlatformUI.context().at),target.at);
 await p.locator('#modeAstro').click();assert.equal(await p.evaluate(()=>PlatformUI.context().at),target.at);
 assert.ok(!(await p.locator('#platformMoonPosition').innerText()).includes('計算できません'));
 await p.evaluate(()=>{pushRoute('#/aim');aim.from={...aim.from,groundManualM:null,standAglM:350};aim.fromGround=27;PlatformUI.afterRoute();});
 assert.equal(await p.evaluate(()=>PlatformUI.context().point.elevation),27);
 assert.equal(await p.evaluate(()=>PlatformUI.context().point.terrain),'summit');
 assert.equal(await p.evaluate(()=>PlatformUI.context().point.id),'test-place-id');
 await p.locator('[data-platform-nav="home"]').click();
 for(const [name,hash,view] of [['月丼','#/plane','#planeView'],['ISSの月面通過','#/iss','#issView']]){
   await p.locator('#astroLaunchers').getByRole('button',{name,exact:false}).click();await p.waitForFunction(hash=>location.hash===hash,hash);assert.equal(await p.locator(view).isVisible(),true);await p.locator('[data-platform-nav="home"]').click();
 }
 await p.locator('[data-platform-nav="records"]').click();assert.equal(await p.locator('#recordsView').isVisible(),true);await p.locator('[data-platform-nav="home"]').click();
 await p.locator('#platformSettings').click();await p.locator('#platformFavorites').click();assert.equal(await p.locator('#placeSheet').isVisible(),true);await p.locator('#placeClose').click();
 await p.evaluate(v=>{pushRoute('#/astro');PlatformUI.setContext(v);},target);
 // Same-user refresh in a second tab keeps a live plan draft and selected conditions.
 await p.locator('#platformObservePlan').click();
 const generation=await p.evaluate(()=>authGeneration);
 await p.evaluate(()=>dispatchEvent(new StorageEvent('storage',{key:TOKEN_KEY,newValue:JSON.stringify({...auth,token:'disposable-layout-A-refreshed'})})));
 assert.equal(await p.evaluate(()=>authGeneration),generation);assert.equal(await p.locator('#platformPlanSheet').isVisible(),true);
 assert.equal(await p.evaluate(()=>PlatformUI.context().point.name),target.point.name);
 await p.locator('#platformPlanClose').click();
 await p.locator('#platformObservePlan').click();await p.locator('#platformPlanName').fill('Aの非公開計画');await p.locator('#platformPlanSave').click();
 await p.locator('[data-platform-nav="plans"]').click();await p.locator('#platformPlansList').getByText('Aの非公開計画').waitFor();
 await p.locator('#platformPlansList').getByRole('button',{name:'予測を確認'}).click();assert.equal(await p.evaluate(()=>PlatformUI.context().at),target.at);
 await p.locator('#modeAstro').click();
 for(const width of [320,390,1280]){
  await p.setViewportSize({width,height:844});await p.waitForTimeout(100);
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width}`);
  await p.screenshot({path:`${output}/astro-${width}.png`,fullPage:true});
  await p.locator('#modeForecast').click();await p.screenshot({path:`${output}/forecast-${width}.png`,fullPage:true});await p.locator('#modeAstro').click();
 }
 await p.setViewportSize({width:390,height:844});
 await p.locator('[data-platform-nav="map"]').click();await p.locator('#skyMapContent').waitFor({state:'visible'});
 assert.equal(await p.evaluate(()=>SkyMapUI.context().at),target.at);
 assert.equal(await p.evaluate(()=>SkyMapUI.context().point.eyeHeightAGL),350);
 assert.equal(await p.evaluate(()=>SkyMapUI.context().point.elevation),15);
 await p.locator('#skyMapExpand').click();
 const rects=await p.evaluate(()=>{const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};};return {modes:document.querySelector('.app-modes').getBoundingClientRect().bottom,map:document.querySelector('.sky-map-wide').getBoundingClientRect().top,footer:document.querySelector('#skyMapView .tool-datetime-footer').getBoundingClientRect().bottom,nav:rect('platformNav').top};});
 assert.ok(rects.map>=rects.modes-1,JSON.stringify(rects));assert.ok(rects.footer<=rects.nav+1,JSON.stringify(rects));
 await p.screenshot({path:`${output}/map-fullscreen.png`});
 await p.setViewportSize({width:667,height:375});await p.waitForTimeout(100);assert.ok(await p.locator('#modeForecast').isVisible());
 await p.screenshot({path:`${output}/map-landscape.png`});await p.setViewportSize({width:390,height:844});
 await p.locator('#modeForecast').click();await p.locator('#modeAstro').click();await p.locator('#skyMapContent').waitFor({state:'visible'});
 assert.equal(await p.evaluate(()=>SkyMapUI.context().at),target.at);
 assert.equal(await p.evaluate(()=>PlatformUI.context().point.terrain),'summit');
 assert.equal(await p.evaluate(()=>PlatformUI.context().point.id),'test-place-id');
 // Same account loses every tool. Direct routes must also hide the old private view.
 grants=[];await p.evaluate(()=>{auth={...auth,tools:[]};renderAuthButton();});
 await p.evaluate(()=>pushRoute('#/records'));assert.equal(await p.locator('#recordsView').isVisible(),false);assert.equal(await p.locator('#platformToolAccess').isVisible(),true);
 await p.evaluate(()=>pushRoute('#/aim'));assert.equal(await p.locator('#aimView').isVisible(),false);
 // Account switch must discard common context, route memories, drafts and visible plans.
 user='layout-user-B';await p.evaluate(()=>{authGeneration++;auth={token:'disposable-layout-B',loginId:'layout-user-B',role:'user',tools:[]};renderAuthButton();pushRoute('#/plans');});
 assert.equal(await p.locator('#platformPlansList').getByText('Aの非公開計画').count(),0);
 assert.notEqual(await p.evaluate(()=>PlatformUI.context().point.name),target.point.name);
 const beforeSync=syncCalls;
 await p.evaluate(()=>{
   favorites=[{id:'old-private-item'}];pushQueue=[{kind:'fav',id:'old-private-item'}];
   localStorage.setItem('sorami.favorites',JSON.stringify([{id:'new-tab-item'}]));
   dispatchEvent(new StorageEvent('storage',{key:TOKEN_KEY,newValue:JSON.stringify({token:'disposable-C',loginId:'layout-user-C',tools:[]})}));
 });
 await p.waitForTimeout(100);assert.equal(syncCalls,beforeSync);assert.equal(await p.evaluate(()=>auth),null);
 assert.equal(await p.evaluate(()=>pushQueue.length),0);
 assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('sorami.favorites'))[0].id),'new-tab-item');
 await p.evaluate(()=>{clearAuth();renderAuthButton();pushRoute('#/astro');});assert.equal(await p.locator('#astroLaunchers button').count(),0);
 // Old forecast data must not be presented under a newly selected point.
 await p.locator('#modeForecast').click();
 await p.evaluate(()=>{predictionPlace={...place};document.getElementById('platformForecastFocus').textContent='古い地点の80点';});
 await p.evaluate(v=>PlatformUI.setContext({...v,point:{...v.point,name:'別の地点',latitude:36}}),target);
 assert.equal(await p.evaluate(()=>PlatformUI.forecastCurrent()),false);
 assert.equal(await p.locator('#cards').isVisible(),false);
 assert.ok(!(await p.locator('#platformForecastFocus').innerText()).includes('80点'));
 await p.locator('#modeAstro').click();await p.emulateMedia({colorScheme:'light'});await p.waitForTimeout(100);
 await p.screenshot({path:`${output}/astro-light.png`,fullPage:true});
 assert.deepEqual(errors,[]);
 fs.writeFileSync(`${output}/browser-results.json`,JSON.stringify({pass:true,widths:[320,390,1280],contextRoundTrip:true,plansOwnerIsolation:true,permissionRevocation:true,fullscreen:rects,accessCalls,errors},null,2));
 console.log('Platform browser checks passed');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
