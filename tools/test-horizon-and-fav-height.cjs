require('./no-open-meteo.cjs');  // テストのブラウザから Open-Meteo へ出さない
require('./explore-open-conditions.cjs'); // 2026-11-26 探すは地図の段で始まる。検索の段を確かめるため入口で撮影条件を開く
// Tower previews keep their foot instead of a floating distant horizon; searches still respect the horizon, and favorites take typed heights.
const {chromium}=require('playwright'),assert=require('assert/strict');
const base=process.env.HORIZON_BASE||'http://127.0.0.1:8931/',tools=['records','tower','diamond','pearl','skymap'],shots=process.env.HORIZON_SHOTS;
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
const ready=()=>{try{return typeof PAGE_DIALOGS==='object';}catch{return false;}};
const EBISU={name:'恵比寿',latitude:35.6425,longitude:139.7135,groundManualM:30.2};
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const c=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,colorScheme:'dark'});
 await c.addInitScript(t=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-horizon',loginId:'horizon-test',tools:t})),tools);
 await c.route(/(?:zekkei-api|localhost:8787)/,r=>r.fulfill({status:200,headers,json:{allowed:true,tool:'skymap',loginId:'horizon-test',tools,credentials:[],hasPassword:true,recoveryCodes:10,favorites:[],items:[]}}));
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base);await p.waitForFunction(ready);
 await p.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>30.2;AstroNotesCandidatePicker.hiddenView=async()=>({read:true,note:null});navigationHistory.pushRoute('#/explore');});
 await p.locator('#exploreDatesToggle').waitFor({state:'attached'});
 const show=async(observer,target)=>{await p.evaluate(([o,t])=>{aimAirSettings.mode='standard';AstroNotesAtmosphere.configure('standard',aimAirSettings);SkyMapUI.setObserver(o);SkyMapUI.setTarget(t);const b=document.getElementById('skyMapBody');b.value='moon';b.onchange();SkyMapUI.setTime(Date.parse('2026-11-25T16:58:00+09:00'));},[observer,target]);await p.locator('#exploreShowResult').click();await p.waitForFunction(()=>{const h=document.getElementById('aimLook');return h&&!h.hidden&&h._lookLayers?.stats?.frames>0;});};
 const land=()=>p.evaluate(()=>{const h=document.getElementById('aimLook'),cv=h.querySelector('[data-look-canvas]'),l=h._lookLayers.buildings,x=l.getContext('2d'),col=Math.round(l.width*.12),rows=x.getImageData(col,0,1,l.height).data,alpha=[];for(let y=0;y<l.height;y++)alpha.push(rows[y*4+3]);const top=alpha.findIndex(a=>a>60),below=alpha.slice(top+6,top+40),dpr=l.width/cv.clientWidth;return {top:top/dpr,filled:below.length>=8&&below.every(a=>a>60),h:l.height/dpr};});
 const waitScene=()=>p.waitForFunction(()=>document.getElementById('aimLook')?._lookLayers?.stats?.buildings>0);
 await show({...EBISU,standAglM:1.5},'tokyotower');await waitScene();
 const low=await land();const lowText=await p.locator('[data-look-canvas]').first().getAttribute('aria-label');assert(lowText);
 await p.evaluate(()=>{const i=document.getElementById('skyMapStandHeight');i.value='160';i.dispatchEvent(new Event('change',{bubbles:true}));});
 await p.waitForFunction(()=>document.getElementById('aimLook')?._lookSpec?.eyeM===160,null,{timeout:30000});await p.waitForTimeout(800);
 // 2026-11-15: a tower preview shows its ground, without the separate distant-horizon line.
 // Keep this height-control smoke check small; obstruction contours and labels have their own browser test.
 const high=await land();for(const [name,ground] of [['low',low],['high',high]]){assert(ground.top>=0,`${name}: the ground is drawn`);assert(ground.filled,`${name}: ground fill begins at the line, without a floating horizon above it`);}
 const day=Date.parse('2026-11-25T00:00:00+09:00');
 const seen=at=>p.evaluate(ms=>{SkyMapUI.setTime(ms);},at).then(()=>p.waitForTimeout(700)).then(()=>p.evaluate(()=>{const h=document.getElementById('aimLook'),l=h._lookLayers.body,d=l.getContext('2d').getImageData(0,0,l.width,l.height).data;let open=0;for(let i=3;i<d.length;i+=4)if(d[i]>200)open++;return {open};}));
 const over=await seen(day+16*3600e3+58*60e3);assert(over.open>100,'the moon is drawn after changing observer height');
 if(shots)await p.screenshot({path:`${shots}/horizon.png`});
 const rows=await p.evaluate(()=>{const o={latitude:35.6425,longitude:139.7135,elevation:30.2},h=AstroNotesAstro.seaHorizonAngle(190.2);return {h,rows:AstroNotesAlign.upcoming(o,AstroNotesAlign.targetById('tokyotower'),'moon',{eyeM:160,from:Date.parse('2026-11-01T00:00:00+09:00'),days:365,limit:Infinity,groupDays:false,partId:'__whole'}).map(r=>r.altitude+r.radius)};});
 assert(rows.rows.length>0);assert(rows.rows.every(v=>v>=rows.h-.01),'no overlap is offered below the horizon');
 // A raised horizon must actually filter the search; real below-horizon overlaps are too rare to rely on.
 const limit=(Math.min(...rows.rows)+Math.max(...rows.rows))/2;
 const raised=await p.evaluate(limit=>{const A=AstroNotesAstro,sea=A.seaHorizonAngle;A.seaHorizonAngle=()=>limit;try{return AstroNotesAlign.upcoming({latitude:35.6425,longitude:139.7135,elevation:30.2},AstroNotesAlign.targetById('tokyotower'),'moon',{eyeM:160,from:Date.parse('2026-11-01T00:00:00+09:00'),days:365,limit:Infinity,groupDays:false,partId:'__whole'}).map(r=>r.altitude+r.radius);}finally{A.seaHorizonAngle=sea;}},limit);
 assert(raised.every(v=>v>=limit-.01),'the horizon limits overlaps');assert(raised.length<rows.rows.length,'some overlaps fall under a raised horizon');
 // favorites
 const sheet=p.locator('#favSheet');
 const open=async o=>{await p.evaluate(o=>openFavSheet(-1,{point:o}),o);await sheet.waitFor({state:'visible'});};
 const point={id:'map:test-horizon',name:'恵比寿ガーデンプレイス',subtitle:'',latitude:35.6425,longitude:139.7135,elevation:null,terrain:null,phenomena:[],eyeHeightAGL:1.5,locationScope:'point'};
 await p.evaluate(()=>{AstroNotesTerrain.groundElevation=async()=>30.2;});
 await open(point);await p.waitForFunction(()=>document.getElementById('favGroundHeight').value==='30.2');
 const type=async(id,v)=>{await p.fill(id,v);await p.locator(id).blur();};
 assert.equal(await p.inputValue('#favStandHeight'),'1.5');assert(await p.isDisabled('#favStandAuto'));assert(await p.isDisabled('#favGroundAuto'));assert.equal(await p.locator('#favEye').count(),0,'no select');
 await type('#favStandHeight','160');assert.match(await p.locator('#favEyeNote').innerText(),/190\.2m/);assert(await p.isEnabled('#favStandAuto'));
 await type('#favStandHeight','900');assert(await p.locator('#favHeightError').isVisible());assert.equal(await p.inputValue('#favStandHeight'),'160','a bad value keeps the last one');
 await type('#favStandHeight','160');assert(await p.locator('#favHeightError').isHidden());
 await p.locator('#favStandAuto').click();assert.equal(await p.inputValue('#favStandHeight'),'1.5');await type('#favStandHeight','160');
 await type('#favGroundHeight','35');assert(await p.isEnabled('#favGroundAuto'));assert.match(await p.locator('#favEyeNote').innerText(),/195m/);
 if(shots)await p.screenshot({path:`${shots}/fav.png`});
 await p.locator('#favGroundAuto').click();await p.waitForFunction(()=>document.getElementById('favGroundHeight').value==='30.2');assert(await p.isDisabled('#favGroundAuto'));
 await type('#favGroundHeight','35');
 await p.locator('#favSave').click();await sheet.waitFor({state:'hidden'});
 const saved=await p.evaluate(()=>favorites.find(f=>f.id==='map:test-horizon'));assert.equal(saved.eyeHeightAGL,160);assert.equal(saved.groundManualM,35);assert.equal(saved.elevation,35);
 assert.equal((await p.evaluate(()=>cleanFavorite(favorites.find(f=>f.id==='map:test-horizon')).groundManualM)),35,'the typed ground survives cleaning');
 const picked=await p.evaluate(()=>{placeSheetFor='skymap';try{choosePlace({...favorites.find(f=>f.id==='map:test-horizon')});return SkyMapUI.selectionState().observer;}finally{placeSheetFor=null;}});assert.equal(picked.groundManualM,35,'picking the favorite carries its ground');assert.equal(picked.standAglM,160,'picking the favorite carries its height');
 const from=await p.evaluate(()=>{const f=favorites.find(x=>x.id==='map:test-horizon');const s=aimSavedFrom({...f});return aimObserverAt(s,99);});assert.equal(from.eyeM,160);assert.equal(from.elevation,35,'the typed ground reaches the observer');
 await p.evaluate(()=>{const f=favorites.findIndex(x=>x.id==='map:test-horizon');openFavSheet(f);});await sheet.waitFor({state:'visible'});await p.focus('#favStandHeight');await p.keyboard.press('ControlOrMeta+a');await p.keyboard.type('123');await p.evaluate(()=>document.getElementById('favSave').click());assert.equal(await p.evaluate(()=>favorites.find(x=>x.id==='map:test-horizon').eyeHeightAGL),123,'saving while the field keeps focus (iPhone) keeps the typed height');
 await p.evaluate(()=>{const f=favorites.findIndex(x=>x.id==='map:test-horizon');openFavSheet(f);});await sheet.waitFor({state:'visible'});assert.equal(await p.inputValue('#favStandHeight'),'123','edit shows the saved height');
 await p.evaluate(()=>document.getElementById('favSheet').close());
 await open({...point,id:'map:test-tower',name:'東京タワー',latitude:35.6586,longitude:139.7454,elevation:18});
 const chips=p.locator('#favDecks .chip');assert((await chips.count())>=2,'published decks can be picked');await chips.first().click();assert.notEqual(await p.inputValue('#favStandHeight'),'1.5');
 assert.deepEqual(errors,[]);await browser.close();console.log('PASS horizon and favorite heights');
})().catch(e=>{console.error('FAIL horizon and favorite heights',e.message);process.exit(1);});
