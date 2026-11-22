// Real trial UI; synthetic account, blocked external writes, stubbed device location.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.BASE||'http://127.0.0.1:8993/trial/index.html',out=process.env.OUT||'/tmp/astronotes-record-sort',grants=['records','tower','diamond','pearl','skymap','multiscene'];fs.mkdirSync(out,{recursive:true});
const places=[
 {id:'p1',name:'地点10',subtitle:'千葉県市川市',latitude:35.73,longitude:139.90},
 {id:'p2',name:'地点2',subtitle:'',latitude:35.70,longitude:139.80},
 {id:'p3',name:'河川敷',subtitle:'東京都江東区',latitude:35.66,longitude:139.82},
 {id:'p4',name:'座標なし',subtitle:'東京都墨田区',latitude:0,longitude:0},
 {id:'p5',name:'展望台',subtitle:'千葉県市川市',latitude:35.71,longitude:139.81}
].map(p=>({...p,elevation:5,eyeHeightAGL:1.5,recordRegistered:true}));
const here={latitude:35.702,longitude:139.802};
const hubOrder=page=>page.locator('#myRecordsHub [data-notebook-place]').evaluateAll(n=>n.map(x=>x.dataset.notebookPlace));
const pickerOrder=page=>page.locator('#recentRecordedPlaces [data-recorded-place]').evaluateAll(n=>n.map(x=>x.dataset.recordedPlace));
const state=page=>page.evaluate(()=>JSON.stringify({favorites,stored:localStorage.getItem('sorami.favorites'),records:MyPlacesUI.load(),shapes:MyPlacesUI.backupState().shapes,aimFrom:localStorage.getItem('sorami.aimFrom'),place:localStorage.getItem('sorami.place')}));
const geo=page=>page.evaluate(()=>window.__geo.calls);
async function selectWithInput(page,id,value,input){
 const select=page.locator('#'+id);
 await select.evaluate((node,input)=>{
  node.focus();
  if(input==='keyboard')node.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  else if(input)node.dispatchEvent(new PointerEvent('pointerdown',{pointerType:input,bubbles:true}));
  window.__sortFocus=[];
 },input);
 await select.selectOption(value);
 const focus=await page.evaluate(id=>({calls:window.__sortFocus.filter(x=>x===id).length,id:document.activeElement?.id,keyboard:document.getElementById(id)?._sortKeyboard}),id);
 if(input==='keyboard'){assert(focus.calls>=1,'keyboard changes restore focus');assert.equal(focus.id,id);assert.equal(focus.keyboard,true,'replacement inherits keyboard intent');}
 else {assert.equal(focus.calls,0,'pointer or unspecified changes never focus a replacement native select');assert.notEqual(focus.id,id);}
}
async function selectAfterTab(page,id,value){
 const select=page.locator('#'+id);
 await select.focus();await page.keyboard.press('Shift+Tab');
 assert.notEqual(await page.evaluate(()=>document.activeElement?.id),id,'Tab starts at the preceding control');
 await select.evaluate(node=>{node._sortKeyboard=false;});
 await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement?.id),id,'real Tab enters the select');
 assert.equal(await select.evaluate(node=>node._sortKeyboard),true,'Tab keyup marks keyboard intent at the destination');
 await page.evaluate(()=>{window.__sortFocus=[];});await select.selectOption(value);
 assert.equal(await page.evaluate(()=>document.activeElement?.id),id,'a change after Tab entry retains focus');
 assert.equal(await select.evaluate(node=>node._sortKeyboard),true,'the replacement retains Tab intent');
 assert.equal(await page.evaluate(id=>window.__sortFocus.filter(x=>x===id).length,id),1);
}
(async()=>{const results=[];for(const [engine,type]of [['chrome',chromium],['webkit',webkit]].filter(([e])=>(process.env.ENGINE||'chrome,webkit').split(',').includes(e))){const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});const width=390;
 const context=await browser.newContext({viewport:{width,height:900},locale:'ja-JP',timezoneId:'Asia/Tokyo',isMobile:true,hasTouch:true,reducedMotion:'reduce'});let writes=0;
 await context.addInitScript(([grants,here])=>{
  sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-sort',loginId:'sort-tester',tools:grants}));
  window.__sortFocus=[];const focus=HTMLElement.prototype.focus;HTMLElement.prototype.focus=function(...args){if(['recordPlaceSort','recordPickerSort'].includes(this.id))window.__sortFocus.push(this.id);return focus.apply(this,args);};
  const g=window.__geo={calls:0,mode:'ok'};const fake={getCurrentPosition(ok,fail){g.calls++;const finish=()=>g.mode==='ok'?ok({coords:{...here,accuracy:20},timestamp:Date.now()}):fail({code:1,message:'denied'});if(g.hold)g.finish=finish;else setTimeout(finish,30);},watchPosition(){g.calls++;return 0;},clearWatch(){}};
  Object.defineProperty(Navigator.prototype,'geolocation',{configurable:true,get:()=>fake});
 },[grants,here]);
 await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(base).origin)return r.continue();if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(r.request().method()))writes++;return r.fulfill({json:{allowed:true,tool:'skymap',loginId:'sort-tester',tools:grants,favorites:[],sightings:[],records:[],rev:1}});}return r.abort();});
 const page=await context.newPage(),errors=[],result={engine,width,base};page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 const ready=async()=>{await page.waitForFunction(()=>typeof MyPlacesUI==='object'&&typeof SkyMapUI==='object');await page.evaluate(async()=>{await startupSessionReady;RecordSync.kick=()=>{};RecordSync.touched=()=>{};const sync=accountSync();sync.syncNow=async()=>{};sync.queuePush=()=>{};});};
 try{
  await page.goto(base+'#/records');await ready();
  result.largeList=await page.evaluate(()=>{
   const n=500,keys=AstroNotesLibrary.keys(auth.loginId);
   favorites=Array.from({length:n},(_,i)=>({id:'perf-'+i,name:'合成地点 '+i,latitude:35.70+i/100000,longitude:139.80,elevation:5,eyeHeightAGL:1.5,recordRegistered:true}));
   const records=favorites.map((p,i)=>({id:'r'+i,placeId:p.id,target:{key:'skytree',name:'東京スカイツリー',latitude:35.7101,longitude:139.8107},result:'seen',createdAt:1,updatedAt:1}));
   localStorage.setItem(keys.observations,JSON.stringify(records));localStorage.setItem(keys.shapes,'{}');
   const get=store.get;let reads=0;store.get=(key,fallback)=>{if(key===keys.observations)reads++;return get(key,fallback);};
   const started=performance.now();
   try{MyPlacesUI.renderRecordsHub();return {n,reads,rows:document.querySelectorAll('#myRecordsHub [data-notebook-place]').length,ms:performance.now()-started};}
   finally{store.get=get;localStorage.setItem(keys.observations,'[]');}
  });
  assert.equal(result.largeList.rows,500,'all saved places remain visible');
  assert.equal(result.largeList.reads,1,'one render reads observations once, independent of the number of places');
  await page.evaluate(places=>{localStorage.removeItem('sorami.placeSort');favorites=structuredClone(places);store.set('sorami.favorites',favorites);MyPlacesUI.renderRecordsHub();},places);
  const sort=page.locator('#recordPlaceSort');await sort.waitFor({state:'visible'});
  assert.deepEqual(await sort.locator('option').allTextContents(),['名前順','住所順','近い順','追加順']);
  assert.equal(await sort.inputValue(),'added');assert.deepEqual(await hubOrder(page),['p5','p4','p3','p2','p1'],'default 追加順 newest first');
  assert(await sort.evaluate(n=>{const r=n.getBoundingClientRect();return r.height>=44&&r.left>=0&&r.right<=innerWidth;}),'44px select inside 390px');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
  assert.equal(await geo(page),0,'no geolocation on load');
  const baseline=await state(page);
  await selectWithInput(page,'recordPlaceSort','name',null);assert.deepEqual(await hubOrder(page),['p3','p4','p2','p1','p5']);assert.equal(await page.evaluate(()=>store.get('sorami.placeSort')),'name');
  await selectWithInput(page,'recordPlaceSort','address','touch');assert.deepEqual(await hubOrder(page),['p1','p5','p3','p4','p2'],'same address by name, blank last');
  await selectAfterTab(page,'recordPlaceSort','name');
  await selectWithInput(page,'recordPlaceSort','name','keyboard');await selectWithInput(page,'recordPlaceSort','address','keyboard');
  await selectWithInput(page,'recordPlaceSort','name','mouse');
  await page.evaluate(()=>navigationHistory.pushRoute('#/explore'));await page.evaluate(()=>navigationHistory.pushRoute('#/records'));await page.evaluate(()=>MyPlacesUI.renderRecordsHub());
  assert.equal(await page.locator('#recordPlaceSort').inputValue(),'name');assert.deepEqual(await hubOrder(page),['p3','p4','p2','p1','p5'],'choice survives navigation and re-render');
  assert.equal(await geo(page),0);
  await page.evaluate(()=>{window.__geo.mode='error';});await selectWithInput(page,'recordPlaceSort','near','touch');
  await page.locator('#recordPlaceSortStatus').filter({hasText:'現在地を取得できませんでした'}).waitFor();
  assert.deepEqual(await hubOrder(page),['p3','p4','p2','p1','p5'],'failure keeps previous order');assert.equal(await page.locator('#recordPlaceSort').inputValue(),'name');assert.equal(await page.evaluate(()=>store.get('sorami.placeSort')),'name');assert.equal(await geo(page),1);
  await page.screenshot({path:out+'/'+engine+'-error.png'});
  await page.evaluate(()=>{window.__geo.mode='ok';});await selectWithInput(page,'recordPlaceSort','near','keyboard');
  await page.waitForFunction(()=>store.get('sorami.placeSort')==='near');
  assert.deepEqual(await hubOrder(page),['p2','p5','p3','p1','p4'],'nearest first, zero coordinates last');assert.equal(await page.locator('#recordPlaceSortStatus').count(),0);assert.equal(await geo(page),2);
  assert.equal(await state(page),baseline,'sorting leaves favorites, records, shapes and observer untouched');
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'recordPlaceSort','keyboard focus survives the asynchronous location result');
  for(const action of ['move-away','pointer']){
   await selectWithInput(page,'recordPlaceSort','added','touch');
   await page.evaluate(()=>{window.__geo.hold=true;});await selectWithInput(page,'recordPlaceSort','near','keyboard');
   await page.evaluate(action=>{
    if(action==='move-away')document.getElementById('notebookEdit').focus();
    else document.getElementById('recordPlaceSort').dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch',bubbles:true}));
    window.__sortFocus=[];window.__geo.hold=false;window.__geo.finish();
   },action);
   await page.waitForFunction(()=>!document.getElementById('recordPlaceSortStatus'));
   assert.equal(await page.evaluate(()=>window.__sortFocus.length),0,'asynchronous refresh never restores pointer focus or steals another control focus');
   if(action==='move-away')assert.notEqual(await page.evaluate(()=>document.activeElement?.id),'recordPlaceSort','refresh does not steal focus back from another control');
  }
  await page.screenshot({path:out+'/'+engine+'-near.png'});
  await page.evaluate(()=>openPlaceSheet('aim'));await page.locator('#placeTab-records').click();
  const pick=page.locator('#recordPickerSort');await pick.waitFor({state:'visible'});assert.equal(await pick.inputValue(),'near');
  assert.deepEqual(await pickerOrder(page),['p2','p5','p3','p1','p4'],'picker shares the order, zero coordinates last');
  assert(await pick.evaluate(n=>{const r=n.getBoundingClientRect(),s=document.querySelector('#recentRecordedPlaces input[type=search]').getBoundingClientRect();return r.height>=44&&r.right<=innerWidth&&Math.abs(r.top-s.top)<4;}),'select beside search');
  await page.locator('#recentRecordedPlaces input[type=search]').fill('地点');assert.deepEqual(await pickerOrder(page),['p2','p1'],'search composes with near');
  await selectWithInput(page,'recordPickerSort','name','touch');assert.deepEqual(await pickerOrder(page),['p2','p1'],'search composes with name');assert.equal(await page.locator('#recentRecordedPlaces input[type=search]').inputValue(),'地点');
  await page.locator('#recentRecordedPlaces input[type=search]').fill('');await selectWithInput(page,'recordPickerSort','added','keyboard');await selectWithInput(page,'recordPickerSort','address','keyboard');assert.deepEqual(await pickerOrder(page),['p1','p5','p3','p4','p2']);
  await selectAfterTab(page,'recordPickerSort','name');
  await selectWithInput(page,'recordPickerSort','added','mouse');await selectWithInput(page,'recordPickerSort','address','touch');
  await page.screenshot({path:out+'/'+engine+'-picker.png'});
  await page.keyboard.press('Escape');await page.locator('#placeSheet').waitFor({state:'hidden'});await page.evaluate(()=>MyPlacesUI.renderRecordsHub());
  assert.equal(await page.locator('#recordPlaceSort').inputValue(),'address');assert.equal(await state(page),baseline);
  await page.evaluate(()=>store.set('sorami.placeSort','near'));await page.reload();await ready();await page.evaluate(()=>MyPlacesUI.renderRecordsHub());await page.locator('#recordPlaceSort').waitFor({state:'visible'});
  assert.equal(await geo(page),0,'saved near does not request location on load');assert.deepEqual(await hubOrder(page),['p5','p4','p3','p2','p1']);
  await page.locator('#recordPlaceSortLocate').click();await page.waitForFunction(()=>window.__geo.calls===1&&!document.getElementById('recordPlaceSortStatus'));
  assert.deepEqual(await hubOrder(page),['p2','p5','p3','p1','p4']);
  assert.deepEqual(errors,[]);result.writes=writes;assert.equal(writes,0);result.passed=true;
 }catch(error){result.passed=false;result.error=error.stack;await page.screenshot({path:out+'/'+engine+'-failure.png',fullPage:true}).catch(()=>{});process.exitCode=1;}finally{results.push(result);fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));await context.close();await browser.close();}
}console.log(JSON.stringify(results));})().catch(e=>{console.error(e);process.exitCode=1;});
