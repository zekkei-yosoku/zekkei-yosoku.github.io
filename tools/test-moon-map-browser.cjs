// Local-only synthetic access/weather/terrain; never submits to the production API.
const {chromium,webkit}=require('playwright'),fs=require('fs'),assert=require('node:assert/strict');
const base=process.env.MOON_MAP_BASE||'http://127.0.0.1:8997/trial/',out=process.env.MOON_MAP_OUT||'../verification/browser';fs.mkdirSync(out,{recursive:true});
const at=Date.parse('2026-11-24T18:00:00+09:00'),day=Date.parse('2026-11-24T00:00:00+09:00'),tools=['plane','diamond','pearl','tower','skymap','iss','records'];
(async()=>{const results=[];
for(const engine of (process.env.MOON_MAP_ENGINES||'chromium,webkit').split(',')){
 const browser=await ({chromium,webkit}[engine]).launch(engine==='chromium'?{channel:'chrome',headless:true}:{headless:true});
 for(const width of(process.env.MOON_MAP_WIDTHS||'320,390,1280').split(',').map(Number))for(const theme of(process.env.MOON_MAP_THEMES||'light,dark').split(',')){
 const context=await browser.newContext({viewport:{width,height:900},isMobile:width<500,hasTouch:width<500,colorScheme:theme,timezoneId:'Asia/Tokyo'});
 await context.addInitScript(({tools,theme})=>{sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-moon-map',loginId:'moon-map-test',role:'user',tools}));localStorage.setItem('sorami.owner','moon-map-test');localStorage.setItem('sorami.theme',theme);},{tools,theme});
 await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 await context.route(/zekkei-api\.okayu-sorami\.workers\.dev|localhost:8787/,r=>{const path=new URL(r.request().url()).pathname;return r.fulfill({json:path==='/me'?{loginId:'moon-map-test',role:'user',tools,credentials:[],hasPassword:true,recoveryCodes:10}:path==='/sync'?{favorites:[],sightings:[],records:[],rev:0,more:false}:path.includes('/access')?{allowed:true,tools}:path==='/aviation/haneda-ops'?{history:[
  {at:Date.parse('2026-11-24T12:00:00+09:00'),code:'dnfi1',approach:'ILS X RWY34L',landing:['34L'],takeoff:['05']},
  {at:Date.parse('2026-11-24T12:30:00+09:00'),code:'dnfo1',approach:'ILS Z RWY34L/ILS Z RWY34R',landing:['34L','34R'],takeoff:['05','34R']}],source:'出典：国土交通省 羽田空港飛行コースホームページ'}:{} });});
 await context.route('https://api.open-meteo.com/v1/forecast?**',r=>r.fulfill({json:{hourly:{time:Array.from({length:120},(_,i)=>(day-86400000)/1000+i*3600),wind_direction_10m:Array(120).fill(340),wind_speed_10m:Array(120).fill(4)}}}));
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(30000);
 await p.goto(base);await p.waitForFunction(()=>typeof AstroNotesPlane!=='undefined'&&typeof plane!=='undefined'&&auth?.loginId==='moon-map-test');
 await p.evaluate(async({at})=>{
  await startupSessionReady;
  AstroNotesTerrain.groundElevation=async()=>20;AstroNotesTerrain.elevations=async points=>points.map(()=>20);
  const paths=AstroNotesPlane.pathsFor('dnfi1',{landing:true,takeoff:true});
  const seeds=AstroNotesPlane.groundRibbonSeedsAt(at,paths,{groundM:20,eyeHeightAGL:1.5,stepKm:2,minPlaneKm:2,maxPlaneKm:20});
  const point=seeds.seeds.find(s=>s.edge==='center'&&s.status==='ready');if(!point)throw Error('no real-Moon inverse fixture');
  plane.at=at;plane.dayMs=S.Cal.startOfDay(at);plane.from={name:'検証用の撮影地点',latitude:point.latitude,longitude:point.longitude,groundManualM:20,standAglM:1.5};
  navigationHistory.pushRoute('#/plane');
 },{at});
 await p.waitForFunction(()=>plane.map&&!plane.map.pending,{},{timeout:60000});
 const state=await p.evaluate(()=>({polygons:plane.map.polygons.length,segments:plane.map.overlap.overlaps.length,status:plane.map.overlap.status,at:plane.map.at,ground:plane.observer.groundM,eye:plane.observer.eyeHeightAGL,unknown:plane.map.missing,text:$('planeMapStatus').textContent}));
 assert(state.polygons>0,'ground layer exists: '+JSON.stringify(state));assert(state.segments>0,'observer route highlight exists');assert.equal(state.status,'ready');assert.equal(state.at,at);assert.match(state.text,/方位.+高さ/);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'page fits');
 // 状況の文は短い行だけ（時刻・地点・海の注記なし）
 {const lines=await p.evaluate(()=>$('planeMapStatus').textContent.split('\n'));assert(lines.length<=3&&/^月 方位/.test(lines[0])&&!lines.join('').includes('海の上')&&!lines.join('').includes('から ／'),JSON.stringify(lines));}
 // 重なる目安の時刻：今重なっている18:00を含む区間が出る
 await p.waitForFunction(()=>/重なる目安 /.test($('planeMapStatus').textContent));assert.equal(await p.evaluate(at=>plane.windows.list.some(([a,b])=>a<=at&&at<=b),at),true);
 const layout=await p.evaluate(()=>{const m=$('planeCanvas').getBoundingClientRect(),f=$('planeTimeFooter').getBoundingClientRect(),h=document.querySelector('main>.masthead').getBoundingClientRect();return {mapTop:m.top,mapBottom:m.bottom,mapWidth:m.width,footTop:f.top,headBottom:h.bottom,sheet:$('planeSheet').hidden};});
 assert(Math.abs(layout.mapWidth-width)<=1&&Math.abs(layout.mapBottom-layout.footTop)<=2&&Math.abs(layout.mapTop-layout.headBottom)<=2&&layout.sheet,'map fills between masthead and time bar: '+JSON.stringify(layout));
await p.screenshot({path:`${out}/${engine}-${width}-${theme}-map.png`,fullPage:true});
 if(width===390&&theme==='light'&&engine==='chromium'){
  await p.locator('.plane-btn[data-plane-pane=place]').click();await p.locator('.plane-height summary').click();await p.locator('#planeEye').fill('45');await p.locator('#planeEye').dispatchEvent('change');
  await p.waitForFunction(()=>plane.map&&!plane.map.pending&&plane.observer.eyeHeightAGL===45);assert.equal(await p.evaluate(()=>plane.map.overlap.observer.observerElevationM??plane.map.overlap.observer.elevation),65);
  await p.locator('#planeHeightAuto').click();await p.waitForFunction(()=>plane.map&&!plane.map.pending&&plane.observer.eyeHeightAGL===1.5);
  await p.locator('#planeSheetClose').click();assert.equal(await p.locator('#planeSheet').isVisible(),false);
  // 凡例・出典は状況の文をタップして開く（専用ボタンは置かない）
  assert.equal(await p.locator('.plane-info').count(),0);await p.locator('#planeMapStatus').click();assert.equal(await p.locator('#planeSheet').isVisible(),true);assert.equal(await p.locator('#planeRouteDetails').isVisible(),true);
  await p.locator('#planeSheetClose').click();await p.locator('#planeTime').fill('18:10');await p.locator('#planeTime').dispatchEvent('change');
  // 時刻を動かしても、新しい線ができるまで前の線と立ち位置の帯を残す（消えたり出たりしない）
  assert.equal(await p.evaluate(()=>!!plane.map&&plane.map.polygons.length>0&&plane.map.paths.length>0),true,'previous lines stay while the new time is computed');
  await p.waitForFunction(()=>plane.map&&!plane.map.pending&&S.JstCal.hhmm(plane.map.at)==='18:10');
  await p.locator('#planeNext').click();await p.waitForFunction(()=>plane.map&&!plane.map.pending&&plane.dayMs===Date.parse('2026-11-25T00:00:00+09:00'));assert.equal(await p.locator('#planeTime').inputValue(),'18:10');
  // 探すと同じ時間バー：分→日→時の順に切り替え、どの単位でもスクロールで動く
  assert.equal(await p.locator('#planeScrubMode').textContent(),'分');
  const wheel=async px=>{const t=p.locator('#planeTimeline');await t.hover();await p.mouse.wheel(px,0);};
  let before=await p.evaluate(()=>plane.at);await wheel(40);await p.waitForFunction(b=>plane.map&&!plane.map.pending&&plane.at===b+600000,before);
  await p.locator('#planeScrubMode').click();assert.equal(await p.locator('#planeScrubMode').textContent(),'日');
  before=await p.evaluate(()=>plane.at);await wheel(24);await p.waitForFunction(b=>plane.map&&!plane.map.pending&&plane.at===b+86400000,before);
  await p.locator('#planeScrubMode').click();assert.equal(await p.locator('#planeScrubMode').textContent(),'時');
  before=await p.evaluate(()=>plane.at);await wheel(-48);await p.waitForFunction(b=>plane.map&&!plane.map.pending&&plane.at===b-7200000,before);
  await p.locator('#planeScrubMode').click();
  await p.locator('#planePrev').click();await p.waitForFunction(()=>plane.map&&!plane.map.pending&&plane.dayMs===Date.parse('2026-11-25T00:00:00+09:00'));
  // 23:00 is the night sea route: 34L or 34R landing / 05 takeoff in a north wind.
  await p.locator('#planeTime').fill('23:00');await p.locator('#planeTime').dispatchEvent('change');
  await p.waitForFunction(()=>plane.map&&!plane.map.pending&&S.JstCal.hhmm(plane.map.at)==='23:00');
  assert.deepEqual(await p.evaluate(()=>plane.map.paths.map(x=>x.id).sort()),['05 離陸（深夜）','34L 着陸（深夜）','34R 着陸（深夜）']);
  // 国交省の実際の運用（72時間）がある時刻はそれで引く：12:10 は ILS X 34L だけ、12:40 は好天時以外の ILS Z。表示は「実際」
  await p.evaluate(()=>planeSetAt(Date.parse('2026-11-24T12:10:00+09:00')));await p.waitForFunction(()=>plane.map&&!plane.map.pending&&S.JstCal.hhmm(plane.map.at)==='12:10');
  assert.deepEqual(await p.evaluate(()=>plane.map.paths.map(x=>x.id).sort()),['05 離陸','34L 着陸']);assert.equal(await p.locator('#planeOpMode').textContent(),'実際');
  assert.match(await p.locator('#planeOpChip').textContent(),/^羽田・北風・好天$/);assert.match(await p.evaluate(()=>plane.map.paths.find(x=>x.kind==='landing').source),/ILS X RWY34L/);
  await p.evaluate(()=>planeSetAt(Date.parse('2026-11-24T12:40:00+09:00')));await p.waitForFunction(()=>plane.map&&!plane.map.pending&&S.JstCal.hhmm(plane.map.at)==='12:40');
  assert.match(await p.locator('#planeOpChip').textContent(),/^羽田・北風・悪天$/);assert.match(await p.evaluate(()=>plane.map.paths.find(x=>x.id==='34L 着陸').source),/ILS Z RWY34L/);
  await p.evaluate(()=>planeSetAt(Date.parse('2026-11-25T23:00:00+09:00')));await p.waitForFunction(()=>plane.map&&!plane.map.pending&&S.JstCal.hhmm(plane.map.at)==='23:00');
  assert.equal(await p.locator('#planeOpMode').textContent(),'予報','beyond the reported hours the forecast decides');
  await p.locator('.plane-btn[data-plane-pane=op]').click();await p.locator('#planeOp').selectOption('dnfi1');await p.waitForFunction(()=>plane.map&&!plane.map.pending&&plane.map.paths.every(x=>x.night));
  await p.evaluate(()=>{plane.wind={id:AstroNotesRoutes.AIRPORT.id,at:Date.now(),times:[],dir:[],speed:[]};plane.op=null;$('planeOp').value='';planeSetAt(Date.parse('2026-11-24T18:00:00+09:00'));});
  await p.waitForFunction(()=>!plane.map&&$('planeMapStatus').textContent.includes('風予報がない'));
  await p.locator('#planeOp').selectOption('dnfi1');await p.waitForFunction(()=>plane.map&&!plane.map.pending);
  // The nearest airport follows the shooting point: Itami from the Senri river bank, back to Haneda after.
  await p.evaluate(()=>planeSetFrom({name:'千里川の土手',latitude:34.7739,longitude:135.4458}));
  await p.waitForFunction(()=>AstroNotesRoutes.AIRPORT.id==='RJOO'&&plane.map&&!plane.map.pending&&plane.map.paths.every(x=>x.airportId==='RJOO'));
  assert.match(await p.locator('#planeOpChip').textContent(),/^伊丹・/);
  await p.evaluate(()=>planeSetFrom({name:'検証用の撮影地点',latitude:35.6,longitude:139.8}));await p.waitForFunction(()=>AstroNotesRoutes.AIRPORT.id==='RJTT'&&plane.map&&!plane.map.pending);
  // Airport search: by IATA, by Japanese name, then back to automatic.
  await p.evaluate(()=>{if($('planeSheet').hidden||$('planeSheet').dataset.pane!=='op')document.querySelector('.plane-btn[data-plane-pane=op]').click();});await p.locator('#planeAirportSearch').fill('HND');
  assert.match(await p.locator('#planeAirportResults button').first().textContent(),/羽田.*RJTT/);
  await p.locator('#planeAirportSearch').fill('釧路');await p.locator('#planeAirportResults button').first().click();
  await p.waitForFunction(()=>AstroNotesRoutes.AIRPORT.id==='RJCK'&&plane.map&&!plane.map.pending);assert.match(await p.locator('#planeOpChip').textContent(),/^釧路・/);
  await p.locator('#planeAirportAuto').click();await p.waitForFunction(()=>AstroNotesRoutes.AIRPORT.id==='RJTT'&&plane.map&&!plane.map.pending);
  await p.locator('#planeOp').selectOption('dnfi1');await p.waitForFunction(()=>plane.map&&!plane.map.pending);
  await p.evaluate(()=>{AstroNotesTerrain.groundElevation=()=>new Promise(resolve=>{window.__resolveMoonGround=resolve;});planeSetFrom({name:'変更後の地点',latitude:35.6,longitude:139.8});planeSetAt(plane.at+60000);});
  assert.equal(await p.evaluate(()=>plane.map),null,'old observer must be invalidated while elevation pending');
  await p.evaluate(()=>{window.__resolveMoonGround(30);AstroNotesTerrain.groundElevation=async()=>20;});await p.waitForFunction(()=>plane.map&&!plane.map.pending&&plane.observer.groundM===30);
  await p.evaluate(()=>{AstroNotesTerrain.groundElevation=async()=>null;AstroNotesTerrain.elevations=async points=>points.map(()=>null);planeSetFrom({name:'標高不明',latitude:35.6,longitude:139.8});});
  await p.waitForFunction(()=>plane.map&&!plane.map.pending);assert.equal(await p.evaluate(()=>plane.map.overlap.status),'missing-elevation');assert.equal(await p.evaluate(()=>plane.map.polygons.length),0);
  // 引き継いだ「現在地」は開くたびに今の位置へ取り直す（前に押した時の位置のままにしない）
  await context.grantPermissions(['geolocation'],{origin:new URL(base).origin});await context.setGeolocation({latitude:35.6586,longitude:139.7454});
  await p.evaluate(()=>{AstroNotesTerrain.groundElevation=async()=>20;AstroNotesTerrain.elevations=async points=>points.map(()=>20);Object.assign(place,{id:'geo:35.6812,139.7671',name:'現在地',latitude:35.6812,longitude:139.7671});plane.from=null;openPlane();});
  await p.waitForFunction(()=>plane.from?.here&&Math.abs(plane.from.latitude-35.6586)<1e-4);
  await p.evaluate(()=>{auth={...auth,tools:[]};renderAuthButton();});await p.waitForFunction(()=>$('planeAccess').hidden===false);assert.equal(await p.locator('#planeTime').isVisible(),false,'revocation hides gated controls');
 }
 assert.deepEqual(errors,[]);results.push({engine,width,theme,...state,errors});console.log('PASS',engine,width,theme,JSON.stringify(state));await context.close();
 }
 await browser.close();
}
fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exit(1)});
