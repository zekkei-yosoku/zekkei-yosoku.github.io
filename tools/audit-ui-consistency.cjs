// Run with NODE_PATH pointing to an installed Playwright package.
// Uses only synthetic authentication and data; never calls the production API.
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const base=process.env.UI_AUDIT_URL||'http://127.0.0.1:8862';
const out=process.env.UI_AUDIT_OUTPUT||'/tmp/astronotes-ui-audit';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true}),snapshots=[],issues=[];
 const adminPath=process.env.UI_AUDIT_ADMIN_MODULE;
 const admin=adminPath?(await import('file://'+adminPath)).adminUi:null;
 const fixturePath=process.env.UI_AUDIT_FORECAST;
 const prediction=fixturePath?JSON.parse(fs.readFileSync(fixturePath)):null;
 const tools=['diamond','pearl','tower','skymap','plane','iss','records'];
 const users={allTools:tools,users:[{login_id:'owner-test',user_id:'o',ownerAdmin:true,tools,passkeys:2,codes:8,has_password:true},{login_id:'friend-test',user_id:'f',tools:['skymap'],passkeys:1,codes:0,has_password:true}],credentials:[],allowed:[]};
 for(const width of (process.env.UI_AUDIT_WIDTHS||"320,390,1280").split(",").map(Number))for(const theme of ['light','dark']){
  const c=await b.newContext({viewport:{width,height:900},colorScheme:theme});
  let accessFailure=false;
  await c.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
  await c.addInitScript(tools=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-ui-audit',loginId:'owner-test',role:'user',ownerAdmin:true,tools})),tools);
  await c.route(/(?:localhost:8787|zekkei-api\.okayu-sorami\.workers\.dev)/,async r=>{
   const pathname=new URL(r.request().url()).pathname;
   if(pathname==='/prediction'&&prediction){const dto=structuredClone(prediction);dto.place=r.request().postDataJSON();dto.asOf=dto.bundle.fetchedAt=Date.now();return r.fulfill({json:dto});}
   const json=pathname==='/me'?{loginId:'owner-test',role:'user',ownerAdmin:true,tools,credentials:[{id:'synthetic-passkey',name:'検査用の端末',createdAt:Date.now()}],hasPassword:true,recoveryCodes:8}:pathname==='/admin/ui'&&admin?admin:pathname==='/admin/users'?users:pathname==='/admin/settings'?{openSignup:false}:pathname==='/admin/log'?{entries:[]}:pathname==='/sync'?{favorites:[],sightings:[],rev:0}:pathname.includes('/access')?(accessFailure?{}:{allowed:true,tool:'skymap',tools}):{};
   return r.fulfill({status:pathname.startsWith('/prediction')?503:200,json});
  });
  const p=await c.newPage(),errors=[];p.setDefaultTimeout(5000);p.on('pageerror',e=>errors.push(e.message));p.on('requestfailed',r=>{if(new URL(r.url()).origin===new URL(base).origin)errors.push(r.url()+': '+r.failure()?.errorText);});await p.goto(base,{waitUntil:'load'});await p.waitForTimeout(600);
  async function capture(screen){
   await p.waitForTimeout(80);
   assert.equal(await p.locator('#aimForecastPlace,#skyForecastPlace,#favAdd,#skyMapUseDates,#skyMapUse,#skyMapUseBelow,#myPlaceUse,#myPlaceMap,#forecastPlanningActions').count(),0,'ambiguous or duplicate actions must not return');
   await p.evaluate(()=>document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).forEach(a=>{try{a.finish()}catch{}}));
   const data=await p.evaluate(()=>{
    const openDialogs=[...document.querySelectorAll('dialog[open]')],topDialog=openDialogs.find(d=>d.contains(document.activeElement))||openDialogs.at(-1);
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),hidden=e.closest('[hidden]'),fold=e.closest('details:not([open])');if(topDialog&&!topDialog.contains(e))return false;if(hidden&&(!topDialog||topDialog.contains(hidden)))return false;if(fold&&!fold.querySelector(':scope>summary')?.contains(e))return false;return r.width>0&&r.height>0&&s.visibility!=='hidden'&&(topDialog||e.checkVisibility({checkVisibilityCSS:true}));};
    const controls=[...document.querySelectorAll('button,input:not([type=hidden]),select,textarea,summary,a[href]')].filter(visible).map(e=>{
     const r=e.getBoundingClientRect(),s=getComputedStyle(e),before=getComputedStyle(e,'::before'),after=getComputedStyle(e,'::after');
     const extra=[before,after].map(x=>({height:x.content!=='none'&&x.content!=='normal'?parseFloat(x.height)||0:0,width:x.content!=='none'&&x.content!=='normal'?parseFloat(x.width)||0:0}));
     const label=e.getAttribute('aria-label')||[...(e.getAttribute('aria-labelledby')||'').split(/\s+/)].map(id=>document.getElementById(id)?.textContent||'').join(' ').trim()||e.textContent.trim()||[...(e.labels||[])].map(l=>l.textContent.trim()).join(' ')||e.title||e.getAttribute('placeholder')||'';
     return {id:e.id,tag:e.tagName,type:e.type||'',class:e.className,label:label.replace(/\s+/g,' ').slice(0,160),width:r.width,height:r.height,targetWidth:Math.max(r.width,...extra.map(x=>x.width)),targetHeight:Math.max(r.height,...extra.map(x=>x.height)),font:parseFloat(s.fontSize),weight:s.fontWeight,color:s.color,background:s.backgroundColor,radius:s.borderRadius,disabled:!!e.disabled,pressed:e.getAttribute('aria-pressed'),calendar:!!e.closest('.aim-cal-grid'),textOverflow:e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).whiteSpace==='nowrap'&&!e.closest('.chips,.iss-pick-groups'),icon:e.dataset.uiControl||null,iconWidth:e.querySelector('.ui-control-icon')?getComputedStyle(e.querySelector('.ui-control-icon')).width:null,stroke:e.querySelector('.ui-control-icon')?getComputedStyle(e.querySelector('.ui-control-icon')).strokeWidth:null};
    });
    const shortText=[...document.querySelectorAll('button.chip,.chips button,.forecast-tabs button,.preview-tabs button,.aim-side-seg button')].filter(e=>visible(e)&&e.childElementCount===0&&e.textContent.trim()&&['none','normal','""'].includes(getComputedStyle(e,'::after').content));
    const centered=shortText.map(e=>{const r=e.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(e);const t=range.getBoundingClientRect(),s=getComputedStyle(e);return {id:e.id,label:e.textContent,class:e.className,error:(t.left+t.right-r.left-r.right)/2,align:s.justifyContent,width:r.width,height:r.height};});
    const pageHeads=[...document.querySelectorAll('dialog.as-page[open]>.sheet-head')].filter(visible).map(h=>{const title=h.querySelector('strong'),r=h.getBoundingClientRect(),t=title?.getBoundingClientRect();return {id:h.parentElement.id,title:title?.textContent,error:t&&!title.classList.contains('sr-only')?(t.left+t.right-r.left-r.right)/2:0,height:r.height};});
    const cues=[...document.querySelectorAll('.chips button[aria-pressed],.target-cat-chips button[aria-pressed],.iss-pick-groups button[aria-pressed],#shapeLocationPanel [data-shape-source]')].filter(visible).map(e=>{const old=e.getAttribute('aria-pressed'),paint=()=>{const c=getComputedStyle(e),a=getComputedStyle(e,'::after');return [c.backgroundColor,c.color,c.borderColor,c.boxShadow,c.fontWeight,a.content,a.backgroundColor]};const wasOn=e.classList.contains('on');e.classList.remove('on');e.setAttribute('aria-pressed','false');const no=paint();e.setAttribute('aria-pressed','true');const yes=paint();e.setAttribute('aria-pressed',old);e.classList.toggle('on',wasOn);return {id:e.id,label:e.textContent,class:e.className,distinct:JSON.stringify(no)!==JSON.stringify(yes),yes,no};});
    const groupMetrics=[...document.querySelectorAll('.chips,.target-cat-chips,.iss-pick-groups,.history-subnav')].filter(visible).map(e=>({class:e.className,id:e.id,children:[...e.querySelectorAll('button')].filter(visible).map(b=>{const r=b.getBoundingClientRect(),c=getComputedStyle(b);return {label:b.textContent,height:r.height,font:c.fontSize,weight:c.fontWeight,radius:c.borderRadius,padding:c.padding};})}));
    return {centered,pageHeads,cues,groupMetrics,controls,overflow:document.documentElement.scrollWidth>innerWidth,headings:[...document.querySelectorAll('h1,h2,h3,.sheet-head strong')].filter(visible).map(e=>e.textContent.trim()),today:[...document.querySelectorAll('.dhead.today')].map(e=>({current:e.getAttribute('aria-current'),indicator:getComputedStyle(e.lastElementChild,'::after').content,outline:getComputedStyle(e.querySelector('.d')).boxShadow}))};
   });
   for(const e of data.controls){if(!e.label)issues.push({width,theme,screen,kind:'name',id:e.id,tag:e.tag});if(['INPUT','SELECT','TEXTAREA'].includes(e.tag)&&!['checkbox','radio','range','file','color'].includes(e.type)&&e.font<16)issues.push({width,theme,screen,kind:'input-font',id:e.id,font:e.font});if(e.tag==='BUTTON'&&!e.class.split(/\s+/).includes('cell')&&!e.disabled&&!e.calendar&&(e.targetWidth<43.9||e.targetHeight<31.9))issues.push({width,theme,screen,kind:'target',id:e.id,label:e.label,w:e.targetWidth,h:e.targetHeight});if(e.icon){assert(Math.abs(e.width-44)<0.1);assert(Math.abs(e.height-44)<0.1);assert.equal(e.iconWidth,'20px');assert.equal(e.stroke,'1.8px');}}
   if(data.overflow)issues.push({width,theme,screen,kind:'overflow'});
   for(const e of data.centered)if(Math.abs(e.error)>1)issues.push({width,theme,screen,kind:'text-center',...e});for(const e of data.pageHeads)if(Math.abs(e.error)>1)issues.push({width,theme,screen,kind:'page-title-center',...e});for(const e of data.cues)if(!e.distinct)issues.push({width,theme,screen,kind:'selection-cue',...e});for(const e of data.controls)if(e.textOverflow&&e.tag==='BUTTON')issues.push({width,theme,screen,kind:'button-text-overflow',id:e.id,label:e.label});snapshots.push({width,theme,screen,...data});fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({snapshots,issues}));console.log('CAPTURE',width,theme,screen);
   if(width===390&&!screen.startsWith('dialog:')){await p.evaluate(()=>window.scrollTo(0,0));await p.screenshot({path:path.join(out,`${theme}-${screen.replaceAll(/[^a-zA-Z0-9_\u3000-\u9fff-]/g,'_')}.png`),fullPage:screen.startsWith('flow:map-selected-')});}
  }
  for(const [screen,hash] of [['home','#/almanac'],['forecast','#/forecast'],['answers','#/forecast/results'],['detail','#/sunset'],['framing','#/aim/tower'],['map','#/skymap'],['plane','#/plane'],['iss','#/iss'],['records','#/records'],['admin','#/admin']]){
   await p.evaluate(hash=>{history.replaceState(null,'',location.pathname+hash);applyRoute()},hash);await p.waitForTimeout(250);
   if(screen==='admin'&&admin){await p.evaluate(async({source,users})=>{clearAdminView();const module=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));const root=document.getElementById('adminView');root.hidden=false;module.mount(root,{apiCall:async(method,path)=>path==='/admin/users'?users:path==='/admin/settings'?{openSignup:false}:{entries:[]},onReauth(){},nextStep:()=>({level:'ok',message:''})});},{source:admin.module,users});await p.waitForTimeout(100);}
   await capture(screen);
   if(screen==='map')assert(await p.locator('#skyMapContent').isVisible(),'normal map content must render');
   if(screen==='admin'&&admin){const permissions=p.getByRole('button',{name:/の権限$/}).first();if(await permissions.count()){await permissions.click();await capture('admin-permissions');await p.getByRole('button',{name:/利用者一覧/}).click();await p.getByRole('button',{name:/の復旧$/}).first().click();await capture('admin-recovery');}}
  }
  await p.evaluate(()=>{history.replaceState(null,'',location.pathname);applyRoute();});await p.locator('#authButton').click();await p.locator('#settingsScreen').click();await capture('settings');await p.locator('#settingsBack').click();await capture('settings-list');await p.locator('#settingsAccount').click();await capture('account');assert.equal(await p.locator('#disablePw').innerText(),'パスワードを無効にする');assert.equal(await p.locator('#newRecovery').innerText(),'回復コードを再発行');assert.equal(await p.locator('#logoutAll').innerText(),'ほかの端末をログアウト');await p.locator('#accountBack').click();await p.locator('#appSettingsClose').click();
  await p.evaluate(()=>openTools());await capture('menu');await p.locator('#toolsClose').click();

  async function closeAll(){await p.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close())});await p.waitForTimeout(90);}
  async function flow(name,run){try{await closeAll();await run();await capture('flow:'+name);}catch(e){issues.push({width,theme,screen:'flow:'+name,kind:'flow-failed',error:e.message});console.log('FLOW FAILED',name,e.message.slice(0,120));}}
  await p.evaluate(()=>{favorites=[{id:'test-p1',name:'山',latitude:35.68,longitude:139.76,elevation:40,eyeHeightAGL:1.5,phenomena:['sunrise','sunset','moon','rainbow']},{id:'test-p2',name:'長い名前の撮影地点を表示して折り返しを点検する場所',latitude:35.7,longitude:139.8,elevation:20,eyeHeightAGL:1.5,phenomena:['starrySky','fuji']}];place={...favorites[0]};store.set(SoramiLibrary.keys(auth.loginId).observations,[{id:'test-r1',placeId:'test-p1',target:{key:'fuji',name:'富士山',latitude:35.36,longitude:138.72},result:'seen',registration:true,date:'',note:'',createdAt:Date.now(),updatedAt:Date.now()}]);aimFillSelects();MyPlacesUI.imported();});
  await p.evaluate(()=>{history.replaceState(null,'',location.pathname+'#/skymap');applyRoute()});await p.waitForTimeout(200);await p.evaluate(()=>{SkyMapUI.setObserver({...favorites[0],groundManualM:40});SkyMapUI.setTarget('skytree');});
  for(const body of ['sun','moon','sirius']){await p.evaluate(body=>{$('skyMapBody').value=body;$('skyMapBody').dispatchEvent(new Event('change',{bubbles:true}));},body);await p.waitForFunction(()=>$('skyMapEvents').querySelector('button')&&!$('skyMapStatus').textContent.includes('計算しています'));assert.equal(await p.evaluate(()=>SkyMapUI.snapshot().target.id),'skytree');assert.match(await p.locator('#skyMapTargetOpen').innerText(),/東京スカイツリー/);const canvas=await p.locator('#skyMapCanvas').boundingBox();assert(canvas.width>100&&canvas.height>100);await capture('flow:map-selected-'+body);assert(await p.locator('#skyMapContent').isVisible());assert(await p.locator('#skyMapAlignmentDetails').isVisible());}
  const transfer=await p.evaluate(()=>SkyMapUI.snapshot());await p.evaluate(()=>openTools());await p.locator('#toolsMenu [data-tool="#/aim/tower"]').click();await p.waitForTimeout(150);assert.equal(await p.evaluate(()=>aim.plannerTransfer?.at),transfer.at);assert.equal(await p.evaluate(()=>aim.target.id),transfer.target.id);assert.equal(await p.evaluate(()=>aim.body),transfer.body);await capture('flow:menu-map-to-framing');
  await p.evaluate(()=>{history.replaceState(null,'',location.pathname+'#/skymap');applyRoute()});await p.waitForTimeout(200);await p.locator('#skyMapExpand').click();await capture('flow:map-fullscreen-actions');await p.locator('#skyMapExpand').click();
  for(const mode of [null,'aim','skymap','records','plane','iss','almanac']){
   await flow('place-'+(mode||'forecast')+'-favorites',()=>p.evaluate(m=>openPlaceSheet(m),mode));
   const favoriteFilter=await p.locator('#favChips').boundingBox(),placeTabs=await p.locator('.place-tabs').boundingBox();
   await p.locator('[data-history-panel=recent]').click();await p.locator('[data-recent-kind=places]').click();await capture('flow:place-'+(mode||'forecast')+'-history-places');
   const historyFilter=await p.locator('.history-subnav').boundingBox(),historyTabs=await p.locator('.place-tabs').boundingBox();
   if(Math.abs(favoriteFilter.y-historyFilter.y)>1||Math.abs(placeTabs.y-historyTabs.y)>1)issues.push({width,theme,screen:'place-'+(mode||'forecast'),kind:'picker-filter-shift',favoriteFilter,historyFilter,placeTabs,historyTabs});
   await p.locator('[data-recent-kind=plans]').click();await capture('flow:place-'+(mode||'forecast')+'-history-plans');
   if(['aim','skymap'].includes(mode)){await p.locator('[data-history-panel=candidates]').click();await capture('flow:place-'+mode+'-candidates');}
  }
  await flow('place-geo-denied',async()=>{await p.evaluate(()=>{openPlaceSheet('aim');navigator.geolocation.getCurrentPosition=(ok,fail)=>fail({code:1});$('geoButton').click()})});
  await flow('place-after-geo-error',()=>p.evaluate(()=>openPlaceSheet('iss')));
  await flow('target-all',()=>p.evaluate(()=>AstroTargetPicker.open($('aimTarget'),null,$('previewTargetOpen'))));
  for(const label of ['山','建物','すべて']){const b=p.locator('[data-target-cats]').getByRole('button',{name:label,exact:true});if(await b.count()){await b.click();await capture('flow:target-'+label);}}
  await p.locator('.target-search').fill('見つからない対象名');await capture('flow:target-empty');await p.locator('.target-search').fill('');
  await p.locator('[data-target-new]').click();await capture('flow:target-editor');
  await p.locator('[data-target-back]').click();await p.locator('.target-cat-edit').click();await capture('flow:target-categories');
  await flow('record-new',()=>p.evaluate(()=>MyPlacesUI.openPlace(null,'records')));
  await p.locator('#myPlaceName').click();await capture('flow:record-shape');await p.locator('#shapeSearch').click();await capture('flow:record-shape-location');
  await p.locator('[data-shape-source=recent]').click();await capture('flow:record-shape-history');
  for(const type of ['line','area','point']){await p.locator('#shapeTypeMenu').evaluate(e=>e.open=true);await p.locator('[data-shape-mode='+type+']').click();await capture('flow:record-shape-'+type);}
  assert(await p.locator('#myPlaceSheet.as-page[open]').count());assert(await p.locator('#myShapeSheet.as-page[open]').count());
  await p.locator('#shapeAddCenter').click();p.once('dialog',d=>d.dismiss());await p.locator('#myShapeSheet .page-back').click();assert(await p.locator('#myShapeSheet[open]').count());await capture('flow:shape-discard-rejected');
  p.once('dialog',d=>d.accept());await p.locator('#myShapeSheet .page-back').click();assert.equal(await p.locator('#myShapeSheet[open]').count(),0);assert(await p.locator('#myPlaceSheet[open]').count());await capture('flow:shape-discard-confirmed');
  await p.evaluate(()=>PLACE_PICKERS.records.set({name:'取消確認の撮影地点',latitude:35.8,longitude:139.9,elevation:10}));p.once('dialog',d=>d.dismiss());await p.locator('#myPlaceSheet .page-back').click();assert(await p.locator('#myPlaceSheet[open]').count());await capture('flow:record-discard-rejected');
  p.once('dialog',d=>d.accept());await p.locator('#myPlaceSheet .page-back').click();assert.equal(await p.locator('#myPlaceSheet[open]').count(),0);await capture('flow:record-discard-confirmed');
  await flow('record-planning-actions',async()=>{await p.evaluate(()=>MyPlacesUI.openPlace(favorites[0],'records'));await p.locator('#myPlacePlanning').evaluate(e=>e.open=true);assert.equal(await p.locator('#myPlaceUse,#myPlaceMap').count(),0);await p.locator('#myPlacePlanning').scrollIntoViewIfNeeded();});
  await flow('notebook-points',()=>p.evaluate(()=>{history.replaceState(null,'',location.pathname+'#/records');applyRoute();MyPlacesUI.renderRecordsHub();setNotebookTab('points')}));
  const notebookBefore=await p.locator('#notebookTabs').boundingBox();await p.locator('#notebookPlansTab').click();await capture('flow:notebook-plans');const notebookAfter=await p.locator('#notebookTabs').boundingBox();if(notebookBefore.y!==notebookAfter.y)issues.push({width,theme,screen:'notebook',kind:'tab-shift',before:notebookBefore,after:notebookAfter});
  await flow('map-picker',()=>p.evaluate(()=>{openPlaceSheet('aim');$('mapButton').click()}));
  await flow('satellite-picker',()=>p.evaluate(()=>{history.replaceState(null,'',location.pathname+'#/iss');applyRoute();issPickOpen()}));
  await flow('calendar',async()=>{await p.evaluate(()=>{history.replaceState(null,'',location.pathname+'#/almanac');applyRoute()});const dates=p.locator('#almanacView .tool-datetime-date');if(await dates.count())await dates.first().click();else throw Error('calendar button not found')});
  await flow('body-framing',()=>p.evaluate(()=>$('previewBodyOpen').click()));
  await flow('body-map',()=>p.evaluate(()=>$('skyMapBodyOpen').click()));
  await closeAll();

  await flow('favorite-editor',()=>p.evaluate(()=>openFavSheet(0)));
  await flow('photo-new',()=>p.evaluate(()=>openPhotoSheet(null)));
  await flow('framing-time-options',async()=>{await p.evaluate(()=>{history.replaceState(null,'',location.pathname+'#/aim/tower');applyRoute()});await p.evaluate(()=>document.querySelector('[aria-label="時刻の操作設定"]')?.click());const d=p.locator('dialog.preview-time-dialog');await d.first().evaluate(e=>showSheet(e));});
  await flow('framing-camera-options',async()=>{await p.evaluate(()=>{aim.target=aimWithHeights(SoramiAlign.targetById('skytree'));aim.from=aimSavedFrom(favorites[0]);aim.wantSpot=false;aimLookRender($('aimLook'),{obs:{latitude:35.68,longitude:139.76,elevation:40},eyeM:1.5,at:Date.now(),title:'検査用の地点',sub:''})});await p.waitForTimeout(500);await p.locator('dialog.preview-camera-dialog').first().evaluate(e=>showSheet(e));});
  await flow('map-time-options',()=>p.evaluate(()=>{const d=document.querySelector('.sky-map-time-dialog');showSheet(d)}));
  await flow('shooting-candidates',async()=>{await p.evaluate(()=>{history.replaceState(null,'',location.pathname+'#/skymap');applyRoute()});await p.waitForTimeout(150);const button=p.locator('#shootingCandidatesOpen');if(await button.count())await button.evaluate(e=>e.click());else {await p.evaluate(()=>{const t=aimWithHeights(SoramiAlign.targetById('skytree'));MyPlacesUI.skyRender({target:t,observer:{...favorites[0]},at:Date.now(),body:'sun',partId:'top',limb:'center',matchMode:'overlap'});$('shootingCandidatesOpen')?.click()});}});
  await flow('share-calendar',async()=>{await p.evaluate(async()=>{history.replaceState(null,'',location.pathname+'#/sunset');applyRoute();activePredictionKey=null;await load(true);const d=document.createElement('button');d.dataset.planAction='calendar';d.dataset.planSource='detail';d.dataset.planId='sunset';d.dataset.planDay=String(weeks.sunset?.[0]?.dayMs);d.hidden=true;document.body.append(d);d.click();d.remove()});await p.waitForTimeout(100)});
  if(await p.locator('#planSheet[open]').count()){await p.locator('#planImageTab').click();await capture('flow:share-image');await p.locator('#planCalendarTab').click();await capture('flow:share-calendar-return');}
  await flow('forecast-pending',async()=>{await p.evaluate(()=>{history.replaceState(null,'',location.pathname+'#/forecast');applyRoute();window.__originalPredictionFetch=SoramiPrediction.fetch;SoramiPrediction.fetch=()=>new Promise(()=>{});place={...place,latitude:35.681234};activePredictionKey=null;load(true)});await p.waitForTimeout(500);});
  await flow('forecast-failed',async()=>{await p.evaluate(()=>{SoramiPrediction.fetch=async()=>{throw Error('検査用の取得失敗')};activePredictionKey=null;load(true)});await p.waitForTimeout(150);});
  await p.evaluate(()=>{SoramiPrediction.fetch=window.__originalPredictionFetch;activePredictionKey=null;load(true)});await p.waitForTimeout(150);await capture('flow:forecast-retry');
  accessFailure=true;await flow('map-access-failed',async()=>{await p.evaluate(()=>{history.replaceState(null,'',location.pathname+'#/skymap');applyRoute();SkyMapUI.open(true)});await p.waitForTimeout(150);assert(await p.locator('#skyMapAccessRetry').isVisible());});accessFailure=false;
  await p.locator('#skyMapAccessRetry').click();await p.waitForTimeout(150);assert(await p.locator('#skyMapContent').isVisible());await capture('flow:map-access-retry');
  await flow('restricted-no-permission',()=>p.evaluate(()=>{auth={...auth,tools:[]};history.replaceState(null,'',location.pathname+'#/records');applyRoute()}));
  await flow('auth-login',()=>p.evaluate(()=>{auth=null;$('authButton').click()}));
  await p.locator('#goSignup').click();await capture('flow:auth-signup');await p.evaluate(()=>$('showSignupPw').click());await capture('flow:auth-signup-password');
  await p.evaluate(()=>showAuthPanel('recovery'));await capture('flow:auth-recovery');
  await closeAll();
  const dialogs=await p.locator('dialog').evaluateAll(ds=>ds.map((d,i)=>({id:d.id,index:i})));
  for(const d of dialogs){await p.evaluate(i=>{document.querySelectorAll('dialog[open]').forEach(x=>x.close());document.querySelectorAll('dialog')[i].showModal()},d.index);await capture('dialog:'+(d.id||d.index));await p.evaluate(i=>document.querySelectorAll('dialog')[i].close(),d.index);}
  for(const error of errors)issues.push({width,theme,kind:'pageerror',error});await c.close();
 }
 await b.close();fs.writeFileSync(path.join(out,'inventory.json'),JSON.stringify({snapshots,issues},null,2));console.log(JSON.stringify({snapshots:snapshots.length,controls:snapshots.reduce((n,s)=>n+s.controls.length,0),issues},null,2));console.log('Audit collection completed');if(issues.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
