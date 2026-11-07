// Execute the real generated trial with synthetic predictions and all external IO blocked.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=process.env.OUT||'/tmp/astronotes-forecast-summary';
const widths=(process.env.WIDTHS||'320,390,1280').split(',').map(Number),themes=(process.env.THEMES||'light,dark').split(','),engines=(process.env.ENGINES||'chrome').split(',');
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};

async function seed(page){
 await page.evaluate(async()=>{
  await startupSessionReady;
  load=async()=>{};kickExtras=()=>{};loadPhotos=async()=>{};
  predictionDirty=false;
  place={id:'forecast-fixture',name:'東京',latitude:35.68,longitude:139.76,elevation:10,eyeHeightAGL:1.5};
  S.setTimezoneOffset(32400);
  const day=S.Cal.startOfDay(Date.now()),hour=3600000;
  const make=(id,index)=>{
   const dayMs=day+index*86400000,peak=dayMs+(id==='sunrise'?6:id==='sunset'?16:20)*hour,score=['rainbow','capCloud'].includes(id)?99:index===0?0:Math.min(99,35+index*4);
   const ev={phenomenon:id,score,base:score,rank:S.rankOf(score),confidence:{key:index>5?'medium':'high'},models:8,perModel:{ecmwf_ifs025:score},spread:[score,score],factors:[],peak,window:[peak-hour,peak+hour],specificTime:true,daysAhead:index,source:'合成予測',uncertainty:{basis:'single',expectedError:5}};
   if(id==='sunrise'||id==='sunset')ev.twilight={phases:[{id:'before',label:'前',window:[peak-hour,peak],score},{id:'after',label:'後',window:[peak,peak+hour],score:Math.max(0,score-10)}]};
   if(id==='moon')ev.timeBands={phases:[{id:'rise',label:'月の出のころ',window:[peak-hour,peak],score},{id:'high',label:'高く昇ったころ',window:[peak,peak+hour],score}]};
   if(id==='capCloud'){
    ev.specificTime=false;ev.timing={from:dayMs+6*hour,to:dayMs+9*hour,peakAt:dayMs+7*hour,peakScore:99,thresholdScore:85,rankLabel:ev.rank.key,hours:3,spans:1};
    if(index===2||index===9)ev.timing.allDay=true;
    if(index===3||index===5)ev.timing=null;
    if(index===4)ev.unavailable={message:'条件データ不足'};
    if(index===5||index===6||index===9)ev.dataQuality={status:'partial',reasons:['判定材料が一部不足']};
    if(index===7)Object.assign(ev.timing,{spans:2,openStart:true,openEnd:true});
   }
   return {dayMs,evaluation:ev};
  };
  window.forecastTest={make,day,allIds:Object.keys(S.PHENOMENA)};
  weeks=Object.fromEntries(forecastTest.allIds.filter(id=>!['moon','fuji'].includes(id)).map(id=>[id,Array.from({length:14},(_,i)=>make(id,i))]));
  forecastDays=Array.from({length:14},(_,i)=>day+i*86400000);
  bundle={fetchedAt:Date.now(),utcOffsetSeconds:32400,home:{grid:{elevation:10},byModel:{}}};
  acceptedPrediction={place,bundle};
  history.replaceState(history.state,'','#/');applyRoute();
 });
}
async function verifyFujiReference(page,day,tag){
 const first=day+86400000;
 await page.evaluate(first=>{
  weeks.fuji=Array.from({length:14},(_,i)=>forecastTest.make('fuji',i));
  history.replaceState(history.state,'','#/fuji/'+first);applyRoute();
 },first);
 const reference=page.locator('#dayDetail .cap-reference');
 await reference.waitFor({state:'visible'});
 assert.equal(await reference.count(),1,'Fuji has one inline supplement');
 assert.equal(await reference.getAttribute('data-day'),String(first),'Fuji reference uses the selected day');
 assert((await reference.innerText()).includes('06:00–09:00'),'reference shows the supplied timing');
 assert(!/99|点|%|出やすい/.test(await reference.innerText()),'reference does not present score as likelihood');
 assert.equal(await reference.locator('a').count(),0,'the supplement stays inside Fuji');
 const originalFuji=await page.evaluate(()=>JSON.stringify(weeks.fuji));
 for(const [index,expected] of [[2,'条件が整う時間が広く'],[3,'この日のデータでは時間帯を示せません'],[4,'判定できません'],[5,'判定材料が一部不足しており'],[6,'判定材料が一部不足しています'],[7,'ほかにも条件に届く時間帯'],[9,'条件が整う時間が広く']]){
  const selected=day+index*86400000;
  await page.locator(`#detailWeek [data-day="${selected}"]`).click();
  assert.equal(await reference.getAttribute('data-day'),String(selected),'day selector updates the supplement');
  const text=await reference.innerText();assert(text.includes(expected),`capCloud state ${index} is explicit`);
  assert(!/NaN|Invalid|99|\d+\s*点|%|出やすい|条件が弱く/.test(text),'reference avoids invalid or overconfident values');
  if(index===6)assert(text.includes('06:00–09:00'),'partial data retains the known time interval');
  if(index===7)assert(text.includes('〜06:00–09:00〜')&&text.includes('前後の日へ'),'open interval boundaries remain visible');
  if(index===9)assert(text.includes('判定材料が一部不足しています')&&!text.includes('一日を通して'),'all-day timing with partial input does not imply complete coverage');
 }
 await page.evaluate(()=>{weeks.capCloud=weeks.capCloud.filter(row=>row.dayMs!==forecastTest.day+8*86400000);});
 await page.locator(`#detailWeek [data-day="${day+8*86400000}"]`).click();
 assert((await reference.innerText()).includes('この日の条件データはありません'),'missing selected date never uses another date');
 assert.equal(await page.evaluate(()=>JSON.stringify(weeks.fuji)),originalFuji,'capCloud presentation never changes the Fuji evaluations');
 await page.locator(`#detailWeek [data-day="${first}"]`).click();
 await page.screenshot({path:path.join(out,tag+'-fuji-reference.png'),fullPage:true});
 // Exercise the actual loadExtras -> visibility -> rerenderList path with delayed capCloud data.
 await page.evaluate(()=>{
  delete weeks.capCloud;redrawDayDetail();
  measureGroundHere=async()=>{};
  const obs=observerHere();extraKey=`${AstroNotesTerrain.urbanCacheKey(obs)}:${obs.locationScope}`;
  moonTerrainProfile={synthetic:true};moonUrbanTried=true;cachedUrbanHorizon=()=>null;
  updateMoonPrediction=async()=>{};loadFujiGrid=async()=>({synthetic:true});
  fujiGeom={available:true,classification:'FULL'};startFujiAlign=()=>{};
  AstroNotesPrediction.visibility=async input=>{
   if(input.kind!=='fuji')throw Error('unexpected visibility fixture kind');
   forecastTest.visibilityStarted=true;
   return new Promise(resolve=>{forecastTest.releaseVisibility=()=>resolve({weeks:{fuji:weeks.fuji,capCloud:Array.from({length:14},(_,i)=>forecastTest.make('capCloud',i))}});});
  };
  forecastTest.extrasPromise=loadExtras();
 });
 await page.waitForFunction(()=>forecastTest.visibilityStarted);
 assert((await reference.innerText()).includes('この日の条件データはありません'),'pending capCloud remains explicit');
 const during=day+2*86400000;
 await page.locator(`#detailWeek [data-day="${during}"]`).click();
 const before=await page.evaluate(()=>{
  forecastTest.highlightBefore=document.querySelector('#dayDetail .highlight');
  scrollTo(0,Math.min(160,document.documentElement.scrollHeight-innerHeight));
  return {scroll:scrollY,hash:location.hash,fuji:JSON.stringify(weeks.fuji)};
 });
 await page.evaluate(async()=>{forecastTest.releaseVisibility();await forecastTest.extrasPromise;});
 const after=await page.evaluate(()=>({scroll:scrollY,hash:location.hash,fuji:JSON.stringify(weeks.fuji),sameHighlight:forecastTest.highlightBefore===document.querySelector('#dayDetail .highlight')}));
 assert(after.sameHighlight,'late capCloud replaces only the supplement');
 assert(Math.abs(after.scroll-before.scroll)<1,'late capCloud preserves the reading position');
 assert.equal(after.hash,before.hash,'late capCloud preserves the selected detail route');
 assert.equal(after.fuji,before.fuji,'late reference never changes the Fuji forecast');
 assert.equal(await reference.getAttribute('data-day'),String(during),'late arrival follows the day chosen while pending');
 assert((await reference.innerText()).includes('条件が整う時間が広く'),'real loadExtras completion updates the selected reference');
}

(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const {renderIndex}=await import('./build-index.mjs');
 const files=JSON.parse(execFileSync(process.execPath,['tools/build-candidate-trial.mjs','--html'],{cwd:root,input:renderIndex().html,encoding:'utf8',maxBuffer:32*1024*1024}));
 const server=http.createServer((request,response)=>{
  let name=decodeURIComponent(new URL(request.url,'http://local').pathname).replace(/^\/+/, '').replace(/^trial\//,'')||'index.html';
  if(name.endsWith('/'))name+='index.html';
  const file=path.resolve(root,name);
  if(!file.startsWith(root+path.sep)){response.writeHead(403).end();return;}
  try{const data=Object.hasOwn(files,name)?files[name]:fs.readFileSync(file);response.writeHead(200,{'content-type':mime[path.extname(name)]||'application/octet-stream'});response.end(data);}catch{response.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port+'/trial/';const results=[];
 try{for(const [engine,type]of [['chrome',chromium],['webkit',webkit]].filter(([name])=>engines.includes(name))){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{for(const width of widths)for(const theme of themes){
   const context=await browser.newContext({viewport:{width,height:width<640?844:900},colorScheme:theme,locale:'ja-JP',timezoneId:'Asia/Tokyo',reducedMotion:'reduce'});let externalWrites=0;
   await context.route('**/*',route=>{const request=route.request();if(new URL(request.url()).origin===new URL(base).origin)return route.continue();if(!['GET','OPTIONS'].includes(request.method()))externalWrites++;return route.abort();});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);const tag=engine+'-'+width+'-'+theme;
   try{
    await page.goto(base+'#/almanac');await page.waitForFunction(()=>typeof render==='function'&&typeof startupSessionReady!=='undefined');await seed(page);
    const phenomena=await page.evaluate(()=>forecastTest.allIds.length-2),count=await page.locator('#cards .cell[data-cell]').count();assert.equal(count,(phenomena-2)*14,'all offered ordinary phenomena and all 14 days');
    assert.equal(await page.locator('#cards [data-cell^="rainbow|"]').count(),0,'rainbow is absent from the trial comparison');
    assert.equal(await page.locator('#bestNote [data-cell^="rainbow|"]').count(),0,'even the highest rainbow score is not recommended');
    assert.equal(await page.locator('#cards [data-cell^="capCloud|"]').count(),0,'capCloud is a Fuji supplement, not a second ordinary row');
    assert.equal(await page.locator('#bestNote [data-cell^="capCloud|"]').count(),0,'a high capCloud score remains excluded from recommendations');
    assert.equal(await page.evaluate(()=>pickHighlight(weeks,Date.now()).id),'rainbow','fixture would recommend rainbow without the presentation filter');
    assert(await page.evaluate(()=>!!S.PHENOMENA.rainbow&&AstroNotesPrediction.IDS.includes('rainbow')&&weeks.rainbow.length===14),'metadata and accepted rainbow forecast remain complete');
    assert(await page.evaluate(()=>!!S.PHENOMENA.capCloud&&weeks.capCloud.length===14),'capCloud metadata and accepted forecast remain complete');
    assert.equal(await page.locator('#forecastSelection').count(),0,'no second prediction until a cell is selected');
    const day=await page.evaluate(()=>forecastTest.day),target=day+10*86400000,selector=`#cards .cell[data-cell="sunset|${target}"]`;
    await page.locator(selector).focus();const vertical=await page.evaluate(()=>scrollY);await page.locator(selector).press('Enter');assert.equal(await page.evaluate(()=>location.hash),'#/','keyboard selection stays on the matrix');
    assert.equal(await page.evaluate(()=>scrollY),vertical,'selection does not scroll the comparison table');
    if(width<640)assert(await page.locator('#forecastSelection').evaluate(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.height<=innerHeight*.35;}),'mobile preview is immediately visible and compact');
    assert.equal(await page.locator(selector).getAttribute('aria-pressed'),'true');
    assert((await page.locator('#forecastSelection').innerText()).includes('夕焼け'));
    assert.equal(await page.locator('#forecastSelection .tw-row').count(),2,'existing time-band rows reused');
    assert.equal(await page.locator('#forecastSelection .card').count(),0,'no nested card chrome');
    const horizontal=await page.locator('#cards .mxscroll').evaluate(n=>{n.scrollLeft=Math.min(320,n.scrollWidth-n.clientWidth);return n.scrollLeft;});
    if(width<500)assert(horizontal>0,'mobile preservation uses a nonzero horizontal position');
    await page.evaluate(()=>{weeks.moon=Array.from({length:14},(_,i)=>forecastTest.make('moon',i));weeks.fuji=Array.from({length:14},(_,i)=>forecastTest.make('fuji',i));render();});
    assert.equal(await page.locator('#cards .cell[data-cell]').count(),phenomena*14,'late moon and Fuji are retained');
    assert.equal(phenomena,9,'the other nine phenomena remain available');
    assert.equal(await page.locator('#cards [data-cell^="rainbow|"]').count(),0,'late arrivals do not revive the rainbow row');
    assert.equal(await page.locator('#cards [data-cell^="capCloud|"]').count(),0,'late arrivals do not revive the capCloud row');
    assert.equal(await page.locator(selector).getAttribute('aria-pressed'),'true');assert(Math.abs(await page.locator('#cards .mxscroll').evaluate(n=>n.scrollLeft)-horizontal)<1,'late arrivals preserve horizontal position');
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.cell),'sunset|'+target,'late arrivals preserve keyboard focus');
    await page.locator('#sortSelect').selectOption('score');
    assert.equal(await page.locator(selector).getAttribute('aria-pressed'),'true');assert(Math.abs(await page.locator('#cards .mxscroll').evaluate(n=>n.scrollLeft)-horizontal)<1,'sort preserves horizontal position');
    await page.locator('#forecastSelection .forecast-selection-open').click();await page.locator('#detailView').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>picked),'sunset');
    await page.locator('#backLink').click();await page.locator('#listView').waitFor({state:'visible'});
    assert.equal(await page.locator(selector).getAttribute('aria-pressed'),'true');assert(Math.abs(await page.locator('#cards .mxscroll').evaluate(n=>n.scrollLeft)-horizontal)<1,'detail return preserves horizontal position');
    await page.locator('#resultsTab').click();await page.locator('#answersView').waitFor({state:'visible'});await page.locator('#forecastTab').click();await page.locator('#listView').waitFor({state:'visible'});assert.equal(await page.locator(selector).getAttribute('aria-pressed'),'true');
    assert(Math.abs(await page.locator('#cards .mxscroll').evaluate(n=>n.scrollLeft)-horizontal)<1,'tab return preserves horizontal position');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page does not overflow');
    assert(await page.locator('#forecastSelection').evaluate(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),'summary fits');
    await page.screenshot({path:path.join(out,tag+'-summary.png'),fullPage:true});
    await page.screenshot({path:path.join(out,tag+'-viewport.png')});
    await page.locator('#forecastSelection .forecast-selection-close').click();assert.equal(await page.locator('#forecastSelection').count(),0,'preview can be closed');assert.equal(await page.locator(selector).getAttribute('aria-pressed'),'false');
    await page.locator(selector).press('Enter');assert.equal(await page.locator(selector).getAttribute('aria-pressed'),'true','keyboard can reopen the preview');
    await page.evaluate(()=>{bundle=null;render();});assert.equal(await page.locator('#forecastSelection').count(),0,'waiting hides the old summary');
    assert.equal(await page.locator('#cards .mxrow').count(),phenomena,'loading skeleton uses the same nine phenomena');
    assert(!(await page.locator('#cards').innerText()).includes('虹'),'rainbow is absent while loading');
    assert(!(await page.locator('#cards').innerText()).includes('笠雲'),'capCloud is absent while loading');
    await seed(page);assert.equal(await page.locator(selector).getAttribute('aria-pressed'),'true','same-place prediction restores selection');
    assert(Math.abs(await page.locator('#cards .mxscroll').evaluate(n=>n.scrollLeft)-horizontal)<1,'same-place prediction restores horizontal position');
    await page.locator(`#cards .cell[data-cell="starrySky|${day}"]`).click();assert((await page.locator('#forecastSelection').innerText()).includes('0'),'low scores remain selectable');
    await page.evaluate(day=>{weeks.starrySky.find(x=>x.dayMs===day).evaluation.unavailable={message:'データ不足'};render();},day);assert((await page.locator('#forecastSelection').innerText()).includes('データ不足'),'selected missing data is explicit');
    await page.evaluate(day=>{weeks.starrySky=weeks.starrySky.filter(x=>x.dayMs!==day);render();},day);assert.equal(await page.locator('#forecastSelection').count(),0,'expired selection is discarded');
    await page.locator(selector).click();await page.evaluate(()=>{place={...place,latitude:35.7};bundle=null;weeks={};render();});assert.equal(await page.locator('#forecastSelection').count(),0,'new location waiting clears selection');
    assert.equal(await page.locator('#cards .skel').count()>0,true,'loading matrix retained');
    await seed(page);await page.locator(selector).click();await page.evaluate(()=>{for(const rows of Object.values(weeks))for(const row of rows)row.evaluation.unavailable={message:'データ不足'};render();});
    assert((await page.locator('#forecastSelection').innerText()).includes('データ不足'),'all unavailable updates the selected summary');
    assert.equal(await page.locator('#forecastSelection .forecast-selection-score').count(),0,'all unavailable never displays the previous score');
    await seed(page);await verifyFujiReference(page,day,tag);
    await seed(page);await page.evaluate(target=>{history.replaceState(history.state,'','#/rainbow/'+target);applyRoute();},target);
    await page.locator('#detailView').waitFor({state:'visible'});assert((await page.locator('#detailView').innerText()).includes('虹'),'existing direct rainbow detail remains readable');
    await page.evaluate(target=>{history.replaceState(history.state,'','#/capCloud/'+target);applyRoute();},target);
    assert((await page.locator('#detailView').innerText()).includes('笠雲'),'existing direct capCloud detail remains readable');
    const saved=await page.evaluate(day=>{
     auth={token:'synthetic-rainbow',loginId:'rainbow-fixture',tools:['records']};savedRoundClient.ensure=async()=>{};
     sightings=['rainbow','capCloud'].map(phenomenon=>({id:'legacy-'+phenomenon,phenomenon,placeName:'東京',peak:day-86400000,score:65,actualScore:40,confidence:'high',outcome:'some'}));
     store.set('sorami.sightings',sightings);const before=JSON.stringify(store.get('sorami.sightings',[]));
     history.replaceState(history.state,'','#/forecast/results');applyRoute();return before;
    },day);
    await page.locator('#answerHistory > summary').click();await page.locator('#recList').waitFor({state:'visible'});
    assert((await page.locator('#recList').innerText()).includes('虹'),'existing rainbow result remains visible');
    assert((await page.locator('#recList').innerText()).includes('笠雲'),'existing capCloud result remains visible');
    assert.equal(await page.evaluate(()=>JSON.stringify(store.get('sorami.sightings',[]))),saved,'showing results preserves the stored rainbow record');
    assert.deepEqual(errors,[]);assert.equal(externalWrites,0);results.push({engine,width,theme,passed:true,phenomena,days:14,externalWrites});console.log(tag+' forecast summary passed');
   }catch(error){console.error(tag,errors,await page.evaluate(()=>({hash:location.hash,picked,currentView})).catch(()=>null));await page.screenshot({path:path.join(out,tag+'-failure.png'),fullPage:true}).catch(()=>{});throw error;}finally{await context.close();}
  }}finally{await browser.close();}
 }}finally{await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
