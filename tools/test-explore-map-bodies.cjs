// trial 段階④: 8天体の選択・両中心・条件との同期・単一天体の描画と初回engineの復帰。
// 外部APIは合成認証/記録のみ。天体の位置・出入り・明るさは実際の同梱計算を使う。
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.MAP_BODIES_BASE||'http://127.0.0.1:8992/trial/';
const out=process.env.MAP_BODIES_OUT||'/tmp/astronotes-map-bodies';
const realTiles=process.env.MAP_BODIES_REAL_TILES==='1';
const engines=(process.env.MAP_BODIES_ENGINES||'chrome,webkit').split(',');
const widths=(process.env.MAP_BODIES_WIDTHS||'320,390').split(',').map(Number);
const themes=(process.env.MAP_BODIES_THEMES||'light,dark').split(',');
const checks=(process.env.MAP_BODIES_CHECKS||'matrix,engine,night,line,card,terrain,vicinity,date-lines,projection').split(',');
const tools=['records','tower','diamond','pearl','skymap','multiscene'];
const bodies=['moon','sun','sirius','venus','mercury','mars','jupiter','saturn'];
const names={moon:'月',sun:'太陽',sirius:'シリウス',venus:'金星',mercury:'水星',mars:'火星',jupiter:'木星',saturn:'土星'};
const at=Date.parse('2026-12-24T20:00:00+09:00');
const observer={latitude:35.5869,longitude:139.5744,elevation:30,groundManualM:30,eyeHeightAGL:1.5,name:'天体確認地点'};

async function open(browser,width,theme,{engineRoute}={}){
 const context=await browser.newContext({viewport:{width,height:width===320?568:844},locale:'ja-JP',timezoneId:'Asia/Tokyo',colorScheme:theme,reducedMotion:'reduce'});
 await context.addInitScript(tools=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-ui',loginId:'map-bodies',tools})),tools);
 await context.route('**/*',route=>{const u=new URL(route.request().url());
  if(engineRoute&&/\/vendor\/astronomy-engine-[^/]+\.js$/.test(u.pathname))return engineRoute(route);
  if(/zekkei-api|localhost:8787/.test(u.origin))return route.fulfill({json:{allowed:true,tool:'skymap',loginId:'map-bodies',tools,favorites:[],sightings:[],records:[],rev:1}});
  // 公開後の目視だけ国土地理院の画像GETを許可。APIの合成応答と他の外部通信遮断は維持する。
  if(realTiles&&route.request().method()==='GET'&&u.origin==='https://cyberjapandata.gsi.go.jp'&&/^\/xyz\/(?:pale|seamlessphoto|hillshademap)\/\d+\/\d+\/\d+\.(?:png|jpg)$/.test(u.pathname))return route.continue();
  if(u.origin===new URL(base).origin)return route.continue();return route.abort();});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
 await page.goto(base+'index.html#/explore');
 await page.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof startupSessionReady!=='undefined');
 await page.evaluate(async({observer,at})=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>30;aimBuildingDays=async()=>[];navigationHistory.pushRoute('#/explore');
  for(let i=0;i<100&&!SkyMapUI.workspaceHost();i++)await new Promise(r=>setTimeout(r,50));
  const t=aimTargetList().find(t=>t.id==='skytree'),h=SkyMapUI.workspaceHost();h.restoreTarget({target:structuredClone(t),custom:false});h.restoreObserver(observer);
  const b=document.getElementById('skyMapBody');b.value='moon';b.dispatchEvent(new Event('change',{bubbles:true}));SkyMapUI.setTime(at);
  MyPlacesUI.discoveryPoints=()=>[];MyPlacesUI.imported();
 },{observer,at});
 await page.waitForFunction(()=>document.getElementById('skyMapView').dataset.exploreStage==='map'&&!!document.getElementById('mapWsBodyPicker'));
 return {context,page,errors};
}

async function selectFromConditions(page,body){
 await page.locator('#mapWsTitle').click();
 await page.locator('#skyMapBodyOpen').click();
 await page.locator(`#skyMapBodyDialog [data-body-value="${body}"]`).click();
 await page.locator('#mapWsTitle').click();
}
async function selectMap(page,body){
 await page.locator('#mapWsBodyPicker').click();
 await page.locator(`#skyMapBodyDialog [data-body-value="${body}"]`).click();
}
async function ready(page,body){
 await page.waitForFunction(body=>{const h=SkyMapUI.workspaceHost(),p=document.getElementById('mapWsSelectedBodyPage');return h?.session.body===body&&h.session.dailies?.[body]&&!h.session.timelinePending&&p?.dataset.body===body&&document.getElementById('mapWsBodyPicker').getAttribute('aria-busy')==='false'&&document.querySelector('#wsBody b').textContent!=='—';},body);
}
async function pickerLayout(page){
 return page.evaluate(()=>{const nodes=[...document.querySelectorAll('#mapWsBodyPicker')].filter(n=>n.getClientRects().length),view=document.getElementById('skyMapView');
  const box=n=>{const r=n.getBoundingClientRect(),points=[[.5,.5],[.5,.1],[.5,.9],[.1,.5],[.9,.5]],hit=points.every(([x,y])=>{const found=document.elementFromPoint(r.left+r.width*x,r.top+r.height*y);return found===n||n.contains(found);});return {id:n.id||n.value,width:r.width,height:r.height,top:r.top,bottom:r.bottom,visible:!!n.offsetParent&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,hit};};
  const center=view.dataset.mapCenter||'obs',map=document.getElementById('skyMapCanvas').getBoundingClientRect(),home=document.getElementById('mapWsHome');return {controls:nodes.map(box),placement:['skyMapObserverTool','skyMapTargetTool',center==='target'?'mapWsCardView':'mapWsNewPlaces'].map(id=>box(document.getElementById(id))),home:home?.offsetParent&&!home.hidden?box(home):null,mapHeight:map.height,mapTop:map.top,mapBottom:map.bottom,overflow:document.documentElement.scrollWidth>innerWidth+1,center};});
}
async function captureMatrix(page,path,mode){
 if(realTiles){
  await page.waitForFunction(mode=>{const h=SkyMapUI.workspaceHost(),s=AstroNotesMapWorkspace.targetState();
   const texts=['mapWsCardOverlap','mapWsCardMeta','mapWsSelectedBodyPage'].map(id=>document.getElementById(id)?.textContent||'').join(' ');
   return !h.session.timelinePending&&!s.recordsPending&&!s.lineBusy&&!/調べています|計算中|計算しています|準備中/.test(texts)&&(mode!=='target'||AstroNotesMapWorkspace.searchBand(h.session)?.status==='ready');
  },mode,{timeout:20000});
  await page.waitForLoadState('networkidle',{timeout:10000});
 }
 await page.screenshot({path});
}
async function verifySelection(page,body,mode,label){
 label+=' '+mode+' '+body;
 await ready(page,body);
 if(mode==='target')await page.waitForFunction(body=>{const s=AstroNotesMapWorkspace.targetState();return s.body===body&&s.lineBody===body&&!s.lineBusy&&!s.lineError;},body);
 const value=await page.evaluate(body=>{const h=SkyMapUI.workspaceHost(),s=h.session,p=document.getElementById('mapWsSelectedBodyPage'),st=h.bodyState(body),daily=s.dailies[body];
  return {condition:document.getElementById('skyMapBody').value,conditionLabel:document.getElementById('skyMapBodyOpen').textContent,only:AstroNotesMapWorkspace.onlyBody(),shown:h.shownBodies(),body:p.dataset.body,text:p.textContent,
   bodyText:document.getElementById('wsBody').textContent,angle:document.querySelector('#wsBody b').textContent,altText:document.querySelector('#wsBody i').textContent,rise:document.getElementById('wsBodyRise').textContent,set:document.getElementById('wsBodySet').textContent,
   summaryHasBody:document.querySelector('#mapWsTitle [data-chip=body]').getClientRects().length>0,
   currentLabel:document.getElementById('mapWsBodyPicker').textContent,
   altitude:st.altitude,azimuth:st.azimuth,magnitude:['mercury','venus','mars','jupiter','saturn'].includes(body)?AstroNotesBodies.light(body,s.at).magnitude:null,events:daily.events.length,finite:daily.points.every(p=>Number.isFinite(p.altitude)&&Number.isFinite(p.azimuth)),targetCard:document.getElementById('mapWsCardPlace').textContent};
 },body);
 assert.equal(value.condition,body,label);assert(value.conditionLabel.includes(names[body]),label+': 条件の天体名');
 assert.equal(value.only,body);assert.deepEqual(value.shown,[body]);assert.equal(value.body,body);assert(value.finite&&Number.isFinite(value.altitude)&&Number.isFinite(value.azimuth));
 assert.equal(value.angle,value.azimuth.toFixed(1)+'°',label+': 方位は選択天体の実計算');assert(Math.abs(Number.parseFloat(value.altText.replace('高度 ','').replace('−','-'))-value.altitude)<.051,label+': 高度は選択天体の実計算');
 assert(value.rise.includes(body==='sun'?'日の出':names[body]+'の出'));assert(value.set.includes(body==='sun'?'日の入':names[body]+'の入'));
 assert(value.bodyText.includes('高度'),label+': 選択天体の高度 '+value.bodyText);
 if(body==='moon')assert.match(value.bodyText,/輝面|照ら/);else assert.doesNotMatch(value.bodyText,/輝面.*NaN|輝面.*0%/);
 if(body==='sirius')assert.match(value.bodyText,/[−-]1\.46/);
 if(value.magnitude!==null)assert(value.bodyText.includes(value.magnitude.toFixed(1)+'等'),label+': 明るさは選択惑星の実計算');
 assert(!value.summaryHasBody&&value.currentLabel===names[body],label+': 天体名は条件帯の右に1か所');
 if(mode==='target')assert(value.targetCard.includes('（'+names[body]+'）'),label+': 目標物中心card '+value.targetCard);
 // 実map redrawが呼ぶbody描画を観測。描画APIを偽の結果にせず元のCanvas処理へ委譲する。
 const drawn=await page.evaluate(async()=>{const api=AstroNotesMapWorkspace,original=api.drawing,calls=[];api.drawing=function(...args){const draw=original.apply(this,args),body=draw.body;return {...draw,body(...args){calls.push(args[1]);return body.apply(this,args);}};};
  try{SkyMapUI.workspaceHost().redraw();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return [...new Set(calls)];}finally{api.drawing=original;}});
 // 目標物中心は帯/線の表示。撮影地点中心でのみ天体の弧を描く。
 if(mode==='obs')assert.deepEqual(drawn,[body],label+': 実描画は選択した1天体だけ');else assert(drawn.every(x=>x===body),label+': 別天体を描かない');
 return {body,mode,events:value.events,altitude:value.altitude,drawn};
}

async function screenMatrix(browser,engine,width,theme){
 const label=`${engine}-${width}-${theme}`,f=await open(browser,width,theme),checks=[];
 try{
  const ids=await f.page.locator('#skyMapBody option').evaluateAll(ns=>ns.filter(n=>!n.disabled&&!n.hidden).map(n=>n.value));assert.deepEqual(new Set(ids),new Set(bodies),label+': 全8天体が利用可能');
  for(const mode of ['obs','target']){
   await f.page.locator(`#mapWsMode input[value="${mode}"]`).click();
   for(const body of bodies){await selectMap(f.page,body);checks.push(await verifySelection(f.page,body,mode,label));
    if(width===390&&theme==='dark'&&['sirius','venus'].includes(body))await captureMatrix(f.page,`${out}/${label}-${mode}-${body}.png`,mode);
   }
   const layout=await pickerLayout(f.page);assert(!layout.overflow&&layout.mapHeight>=150&&layout.controls.length===1&&[...layout.controls,...layout.placement].every(c=>c.visible&&c.hit&&c.height>=40&&c.width>=40),label+': '+JSON.stringify(layout));
   await captureMatrix(f.page,`${out}/${label}-${mode}.png`,mode);
  }
  // 条件側の実pickerから変更し、地図列への逆方向同期も全8天体で確かめる。
  for(const body of bodies){
   await selectFromConditions(f.page,body);await ready(f.page,body);
   assert.equal(await f.page.locator('#mapWsBodyPicker').innerText(),names[body],label+': 条件→地図 '+body);
  }
  assert.deepEqual(f.errors,[],label);return {label,checks};
 }catch(e){await f.page.screenshot({path:`${out}/${label}-failure.png`});throw e;}finally{await f.context.close();}
}

async function engineLifecycle(browser,engine){
 let requests=0,held=[];
 const f=await open(browser,390,'dark',{engineRoute:route=>{requests++;held.push(route);}});
 try{
  assert.equal(requests,0,'月は追加engineを先読みしない');
  await selectMap(f.page,'sirius');await f.page.waitForFunction(()=>!AstroNotesBodies.ready()&&SkyMapUI.selectionState().body==='sirius');
  await f.page.waitForTimeout(350);assert.equal(requests,1,'同じengine読込を共有');
  const pending=await f.page.locator('#mapWsSelectedBodyPage').textContent();assert.match(pending,/準備|読込|読み込|計算/);assert.doesNotMatch(pending,/この日は.*重ならない/);
  for(const route of held.splice(0))await route.abort();
  await f.page.waitForFunction(()=>!document.getElementById('mapWsBodyRetry').hidden);assert(await f.page.locator('#mapWsBodyRetry').isVisible());
  await f.page.locator('#mapWsBodyRetry').click();await f.page.waitForTimeout(100);assert.equal(requests,2,'明示再試行は新規request');
  // 読込が遅い間に選択を往復。古いシリウスの完了で最後の金星を戻さない。
  await selectMap(f.page,'moon');await ready(f.page,'moon');await selectMap(f.page,'sirius');await selectMap(f.page,'venus');
  for(const route of held.splice(0))await route.continue();await ready(f.page,'venus');
  await f.page.waitForFunction(()=>{const s=AstroNotesMapWorkspace.targetState();return s.recordBody==='venus'&&!s.recordsPending;});assert.equal(await f.page.locator('#skyMapBody').inputValue(),'venus');
  const s=await f.page.evaluate(()=>AstroNotesMapWorkspace.targetState());assert.equal(s.body,'venus');assert(!s.recordsError&&!s.lineError);assert.deepEqual(f.errors,[]);
  return {label:engine+'-engine-lifecycle',requests,body:s.body};
 }finally{for(const route of held.splice(0))await route.abort().catch(()=>{});await f.context.close();}
}

// 独立した生の幾何判定でも重なる4地点。同じ日には昼負例の別の夜間重なりが無い。
const nightFixtures=[
 {body:'sirius',night:{latitude:35.74450397726105,longitude:139.70855846899983,at:1795694814927},day:{latitude:35.74450389752619,longitude:139.9128415713853,at:1795644366813}},
 {body:'venus',night:{latitude:35.7302637068377,longitude:139.7029915667039,at:1795631698332},day:{latitude:35.730266012482176,longitude:139.91840778456188,at:1795670306160}}
];
async function realNightCases(browser,engine){
 const f=await open(browser,390,'dark'),result=[];
 try{for(const fixture of nightFixtures){
  const places=['night','day'].map(kind=>({...fixture[kind],id:kind,name:kind==='night'?'夜に重なる地点':'昼に重なる地点',elevation:30,groundManualM:30,eyeHeightAGL:1.5}));
  await f.page.evaluate(({places,at})=>{MyPlacesUI.discoveryPoints=()=>places.map(place=>({place:{...place,discoveryKey:place.id},record:{result:'seen'}}));MyPlacesUI.imported();SkyMapUI.setTime(at);SkyMapUI.setAlignment('__whole','center','overlap');}, {places,at:fixture.night.at});
  await selectMap(f.page,fixture.body);await ready(f.page,fixture.body);
  const oracle=await f.page.evaluate(({body,places})=>{const target=SkyMapUI.selectionState().target;return places.map(p=>{const eye={...p,elevation:31.5},raw=AstroNotesAlign.prepareDailyView(eye,target,body,{partId:'__whole',eyeM:0})(p.at,p.at)[0];return {id:p.id,intersects:raw?.intersects,sun:AstroNotesBodies.state('sun',p.at,eye,{refraction:false}).altitude};});},{body:fixture.body,places});
  assert(oracle.every(x=>x.intersects),fixture.body+': 生の幾何は昼夜とも重なる '+JSON.stringify(oracle));assert(oracle[0].sun<-6&&oracle[1].sun>-6);
  await f.page.locator('#mapWsMode input[value="target"]').click();
  await f.page.waitForFunction(()=>{const s=AstroNotesMapWorkspace.targetState();return s.records?.length===2&&!s.recordsPending&&!s.lineBusy;});
  const records=await f.page.evaluate(()=>AstroNotesMapWorkspace.targetState().records);
  assert(records.find(r=>r.name==='夜に重なる地点').windows.length>0,fixture.body+': 夜の実記録を残す');assert.equal(records.find(r=>r.name==='昼に重なる地点').windows.length,0,fixture.body+': 幾何は重なっても昼の記録を除く');
  const bounds=await f.page.evaluate(({body,places})=>AstroNotesMapWorkspace.targetState().records.flatMap(r=>r.windows.flatMap(w=>[w.from,w.to].map(at=>({at,sun:AstroNotesBodies.state('sun',at,{...places.find(p=>p.name===r.name),elevation:31.5},{refraction:false}).altitude})))),{body:fixture.body,places});assert(bounds.every(x=>x.sun<=-6));
  await f.page.locator('#mapWsMode input[value="obs"]').click();
  for(const p of places){
   await f.page.evaluate(p=>{SkyMapUI.workspaceHost().restoreObserver(p);SkyMapUI.setTime(p.at);},p);
   await f.page.waitForFunction(name=>document.getElementById('mapWsCardPlace').textContent.startsWith(name+' → ')&&!/調べ|計算|準備/.test(document.getElementById('mapWsCardOverlap').textContent),p.name);
   const card=await f.page.locator('#mapWsCardOverlap').textContent();if(p.id==='night')assert.match(card,/^重なる \d/);else assert.match(card,/この日は.*重ならない/);
  }
  result.push({body:fixture.body,oracle,records,bounds});
 }
 assert.deepEqual(f.errors,[]);return {label:engine+'-night-record-current-card',checks:result};
 }catch(e){console.error('night state',JSON.stringify(await f.page.evaluate(()=>({state:AstroNotesMapWorkspace.targetState(),selection:SkyMapUI.selectionState(),place:document.getElementById('mapWsCardPlace').textContent,overlap:document.getElementById('mapWsCardOverlap').textContent}))));await f.page.screenshot({path:`${out}/${engine}-night-failure.png`});throw e;}finally{await f.context.close();}
}

const lineFixtures=[
 {body:'sirius',latitude:35.7337084678101,longitude:139.74897832279038,at:1795695875975},
 {body:'venus',latitude:35.71980020385362,longitude:139.77695833717107,at:1795634256595}
];
async function lineSelection(browser,engine){
 const f=await open(browser,390,'dark'),results=[];
 try{
  // line計算と実際の移動後で同じ合成地面30mを使う。天体・重なりは同梱の実計算。
  await f.page.evaluate(()=>{AstroNotesTerrain.groundElevation=async()=>30;});
  for(const fixture of lineFixtures){
   await f.page.evaluate(at=>{SkyMapUI.setTime(at);SkyMapUI.setAlignment('__whole','center','overlap');},fixture.at);
   await selectMap(f.page,fixture.body);await ready(f.page,fixture.body);await f.page.locator('#mapWsMode input[value="target"]').click();
   await f.page.waitForFunction(body=>{const s=AstroNotesMapWorkspace.targetState();return s.lineBody===body&&!s.lineBusy&&s.line?.length;},fixture.body);
   // 同梱モデル読込後のsolverでfixture付近の点を取得し、Node/browserの微小な数値差を固定座標へ押し付けない。
   const point=await f.page.evaluate(async fixture=>{const h=SkyMapUI.workspaceHost(),s=h.session,lines=await AstroNotesAlign.line(s.target,s.body,AstroNotesSkyMap.dayStart(s.at),{partId:'__whole',limb:'center',eyeM:s.eyeM??1.5,elevationAt:async()=>30});
    const ps=lines.flatMap(l=>l.points).filter(p=>p.distanceKm>3).sort((a,b)=>Math.abs(a.at-fixture.at)-Math.abs(b.at-fixture.at));
    for(const p of ps){const o={latitude:p.latitude,longitude:p.longitude,elevation:31.5},v=AstroNotesAlign.prepareDailyView(o,s.target,s.body,{partId:'__whole',eyeM:0}),rounded=Math.round(p.at/60000)*60000;
     if(v(p.at,p.at)[0]?.intersects&&!v(rounded,rounded)[0]?.intersects&&AstroNotesBodies.state('sun',p.at,o,{refraction:false}).altitude<=-6)return {...p,body:s.body};}
    return null;
   },fixture);assert(point,fixture.body+': 分丸めで外れる実線上fixture');
   const pixel=await f.page.evaluate(async p=>{const h=SkyMapUI.workspaceHost(),c=document.getElementById('skyMapCanvas'),r=c.getBoundingClientRect(),w=c.clientWidth,ht=c.clientHeight;
    // 線上の実地点を整数pixelの露出部へpanして、DOMの操作部を押さずに実tapする。
    const free=[];for(let y=80;y<ht-30;y+=20)for(let x=60;x<w-70;x+=20)if([[0,0],[-10,0],[10,0],[0,-10],[0,10]].every(([dx,dy])=>document.elementFromPoint(r.left+x+dx,r.top+y+dy)===c))free.push({x,y});
    if(!free.length)throw Error('線を押せる地図の空きがない');const q=free[Math.floor(free.length/2)];h.map.setView(p.latitude,p.longitude,17);const center=h.map.coordinateAt(w-q.x,ht-q.y);h.map.setCenter(center.latitude,center.longitude);h.redraw();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const [x,y]=h.map.project(p.latitude,p.longitude);return {x:r.left+x,y:r.top+y};
   },point);
   await f.page.waitForTimeout(520);assert.equal(await f.page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.id,pixel),'skyMapCanvas');await f.page.mouse.click(Math.round(pixel.x),Math.round(pixel.y));
   await f.page.waitForFunction(()=>AstroNotesMapWorkspace.targetState().selection?.kind==='line');
   const selected=await f.page.evaluate(()=>AstroNotesMapWorkspace.targetState().selection);assert(Math.abs(selected.at-point.at)<200,point.body+': 求めた線上の点を実tap '+JSON.stringify({selected,point,pixel}));assert.notEqual(selected.at%60000,0);
   const before=await f.page.evaluate(sel=>{const s=SkyMapUI.selectionState(),o={latitude:sel.latitude,longitude:sel.longitude,elevation:31.5},v=AstroNotesAlign.prepareDailyView(o,s.target,s.body,{partId:'__whole',eyeM:0}),rounded=Math.round(sel.at/60000)*60000;return {intersects:v(sel.at,sel.at)[0]?.intersects,rounded:v(rounded,rounded)[0]?.intersects,sun:AstroNotesBodies.state('sun',sel.at,o,{refraction:false}).altitude};},selected);
   assert(before.intersects&&!before.rounded&&before.sun<=-6,point.body+': 丸めると外れる実夜間fixture '+JSON.stringify(before));
   assert.equal((await f.page.locator('#mapWsCardView').innerText()).trim(),'ここを撮影地点にする');await f.page.locator('#mapWsCardView').click();
   await f.page.waitForFunction(()=>{const h=SkyMapUI.workspaceHost(),s=h.session;return document.getElementById('skyMapView').dataset.mapCenter==='obs'&&s.observer?.name==='線上の地点'&&s.eye&&Math.abs(s.eye.latitude-s.observer.latitude)<1e-9&&Math.abs(s.eye.longitude-s.observer.longitude)<1e-9&&s.dailies?.[s.body];});
   const after=await f.page.evaluate(()=>{const h=SkyMapUI.workspaceHost(),s=h.session;return {at:s.at,observer:s.observer,eye:s.eye,intersects:AstroNotesAlign.prepareDailyView(s.eye,s.target,s.body,{partId:'__whole',eyeM:0})(s.at,s.at)[0]?.intersects,sun:AstroNotesBodies.state('sun',s.at,s.eye,{refraction:false}).altitude};});
   assert.equal(after.at,selected.at,point.body+': CTAで秒未満も保持');assert.equal(after.observer.latitude,selected.latitude);assert.equal(after.observer.longitude,selected.longitude);assert(after.intersects&&after.sun<=-6,point.body+': CTA後も幾何重なりと夜間が成立 '+JSON.stringify(after));
   results.push({body:point.body,selected,before,after});
  }
  assert.deepEqual(f.errors,[]);return {label:engine+'-line-exact-time',checks:results};
 }catch(e){await f.page.screenshot({path:`${out}/${engine}-line-failure.png`});throw e;}finally{await f.context.close();}
}

async function cardEdges(browser,engine){
 const f=await open(browser,390,'dark');
 try{
  await f.page.evaluate(()=>{SkyMapUI.workspaceHost().restoreObserver({latitude:78,longitude:15,elevation:0,groundManualM:0,eyeHeightAGL:1.5,name:'白夜確認地点'});SkyMapUI.setTime(Date.parse('2026-06-21T12:00:00Z'));});
  await selectMap(f.page,'sun');await ready(f.page,'sun');
  const polar=await f.page.evaluate(()=>({events:SkyMapUI.workspaceHost().session.dailies.sun.events,altitude:SkyMapUI.workspaceHost().bodyState('sun').altitude,text:document.getElementById('mapWsSelectedBodyPage').textContent,rise:document.getElementById('wsBodyRise').textContent,set:document.getElementById('wsBodySet').textContent}));
  assert.equal(polar.events.length,0);assert(Number.isFinite(polar.altitude)&&polar.altitude>0);assert.match(polar.rise,/この日は出入りなし/);assert.match(polar.set,/この日は出入りなし/);assert.doesNotMatch(polar.text,/NaN|undefined/);
  await f.page.evaluate(()=>{window.__cardEdgeBodies=AstroNotesBodies;globalThis.AstroNotesBodies={...AstroNotesBodies,light(){throw Error('synthetic brightness unavailable');}};});
  try{await selectMap(f.page,'venus');await ready(f.page,'venus');const text=await f.page.locator('#mapWsSelectedBodyPage').textContent();assert.match(text,/明るさ —/);assert.doesNotMatch(text,/NaN|undefined/);}
  finally{await f.page.evaluate(()=>{globalThis.AstroNotesBodies=window.__cardEdgeBodies;delete window.__cardEdgeBodies;});}
  assert.deepEqual(f.errors,[]);return {label:engine+'-card-edges',polar,missingBrightness:true};
 }catch(e){await f.page.screenshot({path:`${out}/${engine}-card-failure.png`});throw e;}finally{await f.context.close();}
}

async function targetVicinity(browser,engine){
 const f=await open(browser,390,'dark');
 try{
  const p=f.page,initial=Date.parse('2026-11-27T19:46:00+09:00');
  await p.evaluate(initial=>{SkyMapUI.workspaceHost().restoreObserver(null);SkyMapUI.setTime(initial);},initial);
  await p.waitForFunction(()=>document.querySelector('#skyMapView').dataset.mapCenter==='target'&&document.querySelector('#wsBody small').textContent.includes('対象付近'));
  const value=await p.evaluate(()=>{
   const h=SkyMapUI.workspaceHost(),s=h.session,t=s.target,eye={latitude:t.latitude,longitude:t.longitude,elevation:Number.isFinite(t.groundM)?t.groundM:0};
   const st=h.skyState('moon',s.at,eye),day=AstroNotesSkyMap.dayStart(s.at);
   const days=[-1,0,1].flatMap(i=>AstroNotesSkyMap.daily('moon',day+i*86400000,eye,h.skyState).events);
   const rise=+document.querySelector('#wsBodyRise').dataset.at,set=+document.querySelector('#wsBodySet').dataset.at,events=[['rise',rise],['set',set]];
   const canvas=document.querySelector('#skyMapTimeline .sky-timeline-annotations'),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
   const tape=document.querySelector('#skyMapTimeline .sky-timeline-tape');
   return {angle:document.querySelector('#wsBody b').textContent,alt:document.querySelector('#wsBody i').textContent,expected:st,
    dayChange:AstroNotesSkyMap.dayStart(set)!==day,hasTicks:events.every(([side,at])=>days.some(e=>e.side===side&&Math.abs(e.at-at)<500)),
    band:!canvas.hidden&&pixels.some((v,i)=>i%4===3&&v>0),daylight:tape?.style.backgroundImage.includes('linear-gradient')===true,
    hiddenGeometry:getComputedStyle(document.getElementById('mapWsGeometryPage')).display==='none',dots:document.querySelectorAll('#mapWsDots span:not([hidden])').length,
    observer:s.observer,dawn:document.querySelector('#wsDawn b').textContent};
  });
  assert.equal(value.observer,null);assert.equal(value.angle,value.expected.azimuth.toFixed(1)+'°');
  assert(Math.abs(Number.parseFloat(value.alt.replace('高度 ','').replace('−','-'))-value.expected.altitude)<.051);
  assert(value.dayChange&&value.hasTicks&&value.band&&value.daylight&&value.hiddenGeometry&&value.dots===2&&/^\d\d:\d\d$/.test(value.dawn),JSON.stringify(value));
  await captureMatrix(p,`${out}/${engine}-target-vicinity.png`,'target');
  await p.locator('#mapWsInfo').evaluate(info=>{info.scrollLeft=info.clientWidth;});
  await p.waitForFunction(()=>document.querySelector('#mapWsDots span:last-child').classList.contains('on'));
  await p.locator('#mapWsInfo').evaluate(info=>{info.scrollLeft=0;});
  const set=await p.locator('#wsBodySet').getAttribute('data-at');
  await p.locator('#wsBodySet').click();
  await p.waitForFunction(at=>SkyMapUI.workspaceHost().session.at===at,+set);
  await selectMap(p,'sun');
  await p.waitForFunction(()=>document.querySelector('#wsBody small').textContent==='太陽 · 対象付近'&&!document.querySelector('#wsBodyRise').disabled);
  await selectMap(p,'sirius');
  await p.waitForFunction(()=>document.querySelector('#wsBody small').textContent==='シリウス · 対象付近'&&document.querySelector('#wsBody b').textContent!=='—');
  await p.evaluate(()=>SkyMapUI.setTarget('fuji'));
  await p.waitForFunction(()=>{
   const h=SkyMapUI.workspaceHost(),s=h.session,t=s.target;
   return t?.id==='fuji'&&document.querySelector('#wsBody b').textContent===h.skyState('sirius',s.at,{latitude:t.latitude,longitude:t.longitude,elevation:t.groundM??0}).azimuth.toFixed(1)+'°';
  });
  await p.evaluate(observer=>SkyMapUI.workspaceHost().restoreObserver(observer),observer);
  await ready(p,'sirius');
  await p.waitForFunction(()=>!document.querySelector('#mapWsGeometryPage').hidden&&document.querySelectorAll('#mapWsDots span:not([hidden])').length===3&&!document.querySelector('#wsBody small').textContent.includes('対象付近'));
  await p.evaluate(()=>SkyMapUI.workspaceHost().restoreObserver(null));
  await p.waitForFunction(()=>document.querySelector('#mapWsGeometryPage').hidden&&document.querySelector('#wsBody small').textContent.includes('対象付近'));
  assert.deepEqual(f.errors,[]);
  return {label:engine+'-target-vicinity',aboveGround:value.alt,riseSetVerified:value.hasTicks,band:value.band,basisChanged:true};
 }finally{await f.context.close();}
}

async function dateLineReuse(browser,engine){
 const f=await open(browser,390,'dark');
 const p=f.page,day=Date.parse('2026-11-27T00:00:00+09:00'),offset=19*3600000,oneDay=86400000;
 try{
  await p.evaluate(({day,offset,oneDay})=>{
   const original=AstroNotesAlign.line;
   window.dateLines={calls:[],held:new Set([day+oneDay,day+2*oneDay,day+3*oneDay]),release:new Map()};
   const state=window.dateLines;
   AstroNotesAlign.line=async(target,body,day,options)=>{
    const call={day,body,cancelled:false};state.calls.push(call);
    if(state.held.has(day))await new Promise(resolve=>state.release.set(day,resolve));
    if(!options.isCurrent()){call.cancelled=true;return [];}
    return original(target,body,day,options);
   };
   SkyMapUI.setTime(day+offset);
  },{day,offset,oneDay});
  await p.locator('#mapWsMode input[value=target]').click();
  const ready=expected=>p.waitForFunction(day=>{
   const s=AstroNotesMapWorkspace.targetState();
   return s.line?.length>0&&!s.lineBusy&&s.line.every(x=>x.from>=day&&x.from<day+86400000);
  },expected);
  const hold=day=>p.waitForFunction(day=>window.dateLines.release.has(day),day);
  const release=day=>p.evaluate(day=>{const s=window.dateLines;s.held.delete(day);const resume=s.release.get(day);s.release.delete(day);resume();},day);
  const next=p.locator('#skyMapNext'),prev=p.locator('#skyMapPrev');
  const calls=(day,body='moon')=>p.evaluate(({day,body})=>dateLines.calls.filter(c=>c.day===day&&c.body===body),{day,body});
  const first=day+oneDay,second=day+2*oneDay,third=day+3*oneDay;
  await ready(day);await hold(first);
  await next.click();
  await p.waitForFunction(day=>{
   const s=AstroNotesMapWorkspace.targetState();
   return AstroNotesSkyMap.dayStart(SkyMapUI.selectionState().at)===day&&s.lineBusy&&!s.line;
  },first);
  assert.equal((await calls(first)).length,1,'先読み途中の同じ日の計算を引き継ぐ');
  await release(first);await ready(first);
  await prev.click();await ready(day);
  assert.equal((await calls(day)).length,1,'表示済みの日の線を再利用する');
  await next.click();await ready(first);
  assert.equal((await calls(first)).length,1);
  await next.click();await hold(second);
  await next.click();await hold(third);
  await release(second);
  await p.waitForFunction(day=>dateLines.calls.some(c=>c.day===day&&c.cancelled),second);
  assert(await p.evaluate(()=>AstroNotesMapWorkspace.targetState().lineBusy),'途中の日から遅れて届いた線を表示しない');
  await release(third);await ready(third);
  const last=await p.evaluate(()=>AstroNotesMapWorkspace.targetState().line);
  await selectMap(p,'sun');await ready(third);
  assert.equal((await calls(third,'sun')).length,1,'別の天体を選ぶとその条件で解く');
  await selectMap(p,'moon');await ready(third);
  assert.deepEqual(await p.evaluate(()=>AstroNotesMapWorkspace.targetState().line),last,'確定線と時刻はそのまま再利用する');
  assert.equal((await calls(third)).length,1);
  assert.deepEqual(f.errors,[]);
  return {label:engine+'-date-lines',reused:true,promoted:true,staleDiscarded:true};
 }finally{await f.context.close();}
}

async function mapProjection(browser,engine){
 const f=await open(browser,390,'dark'),p=f.page;
 try{
  await ready(p,'moon');
  await p.locator('#skyMapTimeMore').click();
  await p.waitForFunction(()=>document.querySelector('#skyMapAngles').closest('dialog').open);
  const before=await p.locator('#skyMapAngles').innerText();
  assert.match(before,/月.*方位.*高度/);
  await p.evaluate(()=>SkyMapUI.setTime(SkyMapUI.selectionState().at+15*60000));
  await p.waitForFunction(old=>document.querySelector('#skyMapAngles').innerText!==old,before);
  await p.locator('dialog[open]').getByRole('button',{name:'閉じる',exact:true}).click();
  await p.locator('#mapWsMode input[value=target]').click();
  await p.waitForFunction(()=>AstroNotesMapWorkspace.targetState().band>0);
  const points=await p.evaluate(async()=>{
   const h=SkyMapUI.workspaceHost(),original=AstroNotesMapWorkspace.drawTarget,results=[];
   const points=[[35.7,139.7],[35.6,139.5],[35.75,139.9]];
   AstroNotesMapWorkspace.drawTarget=(ctx,args)=>{
    results.push(points.map(([lat,lon])=>{const a=args.project(lat,lon),b=h.map.project(lat,lon);return Math.hypot(a[0]-b[0],a[1]-b[1]);}));
    return original(ctx,args);
   };
   const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   try{
    for(const [lat,lon,zoom,angle] of [[35.7,139.7,12,0],[35.65,139.6,11.5,42],[35.8,139.75,13.7,275]]){
     h.map.setView(lat,lon,zoom);h.map.setRotation(angle);await frame();
    }
    return results;
   }finally{AstroNotesMapWorkspace.drawTarget=original;}
  });
  assert(points.length>=3&&points.flat().every(distance=>distance<1e-7),JSON.stringify(points));
  assert.deepEqual(f.errors,[]);
  return {label:engine+'-projection',dialogRefreshed:true,matchingCoordinates:points.length};
 }finally{await f.context.close();}
}

async function terrainErrorLayout(browser,engine,theme){
 const f=await open(browser,320,theme),results=[];
 try{
  // ネットワーク失敗をDOMの直接書換えで代用せず、通常refreshの標高失敗表示を通す。
  await f.page.evaluate(()=>{AstroNotesTerrain.groundElevation=async()=>{throw Error('synthetic terrain unavailable');};SkyMapUI.workspaceHost().restoreObserver({latitude:35.5869,longitude:139.5744,eyeHeightAGL:1.5,name:'標高取得失敗の確認地点'});});
  await f.page.waitForFunction(()=>document.getElementById('skyMapStatus').textContent.includes('標高を取得できません')&&!document.getElementById('skyMapRetry').hidden);
  assert(await f.page.locator('#skyMapRetry').isVisible(),'標高失敗の再試行行が実表示される');
  for(const mode of ['obs','target']){
   await f.page.locator(`#mapWsMode input[value="${mode}"]`).click();await ready(f.page,'moon');
   if(mode==='target')await f.page.waitForFunction(()=>!AstroNotesMapWorkspace.targetState().lineBusy&&AstroNotesMapWorkspace.searchBand(SkyMapUI.workspaceHost().session)?.status==='ready');
   await f.page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const layout=await pickerLayout(f.page),placement=layout.placement.filter(b=>['skyMapObserverTool','skyMapTargetTool'].includes(b.id));
   assert(layout.mapHeight>=150&&!layout.overflow,engine+' '+theme+' '+mode+': エラー行があっても地図150px以上');
   assert(placement.length===2&&placement.every(b=>b.visible&&b.hit&&b.width>=44&&b.height>=44&&b.top>=layout.mapTop&&b.bottom<=layout.mapBottom),engine+' '+theme+' '+mode+': 配置ボタン全44px/5点hit '+JSON.stringify(layout));
   assert(layout.placement.every(b=>b.visible&&b.hit)&&(!layout.home||layout.home.visible&&layout.home.hit),engine+' '+theme+' '+mode+': 新規探索/戻るボタンを遮らない');
   assert(layout.controls.every(b=>b.visible&&b.hit),engine+' '+theme+' '+mode+': 天体列も操作可能');
   await f.page.screenshot({path:`${out}/${engine}-320-${theme}-terrain-error-${mode}.png`});results.push(layout);
  }
  assert.deepEqual(f.errors,[]);return {label:engine+'-320-'+theme+'-terrain-error',checks:results};
 }catch(e){await f.page.screenshot({path:`${out}/${engine}-320-${theme}-terrain-error-failure.png`});throw e;}finally{await f.context.close();}
}

(async()=>{
 fs.mkdirSync(out,{recursive:true});const results=[];
 for(const [engine,type] of [['chrome',chromium],['webkit',webkit]].filter(([id])=>engines.includes(id))){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{
   if(checks.includes('matrix'))for(const width of widths)for(const theme of themes){const result=await screenMatrix(browser,engine,width,theme);results.push(result);console.log('PASS '+result.label);}
   if(checks.includes('engine'))results.push(await engineLifecycle(browser,engine));
   if(checks.includes('night')&&engine===engines[0])results.push(await realNightCases(browser,engine));
   if(checks.includes('line'))results.push(await lineSelection(browser,engine));
   if(checks.includes('card'))results.push(await cardEdges(browser,engine));
   if(checks.includes('vicinity'))results.push(await targetVicinity(browser,engine));
   if(checks.includes('date-lines'))results.push(await dateLineReuse(browser,engine));
   if(checks.includes('projection'))results.push(await mapProjection(browser,engine));
   if(checks.includes('terrain'))for(const theme of themes)results.push(await terrainErrorLayout(browser,engine,theme));
  }finally{await browser.close();}
 }
 fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exit(1);});
