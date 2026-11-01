// 試用版の探す→地図: 作業画面の配置、軌道、情報欄、戻る操作。本体には作業画面が出ないことも確かめる。
const {chromium,webkit}=require('playwright'),assert=require('assert/strict');
const base=process.env.MAP_WORKSPACE_BASE||'http://127.0.0.1:8897/',out=process.env.MAP_WORKSPACE_OUT||null,tools=['records','tower','diamond','pearl','skymap','framing'];
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
const ready=()=>{try{return typeof PAGE_DIALOGS==='object';}catch{return false;}};
async function open(browser,url,width,height,scheme='dark'){
 const c=await browser.newContext({viewport:{width,height},colorScheme:scheme});
 await c.addInitScript(t=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-ws',loginId:'ws-test',tools:t})),tools);
 await c.route(/(?:zekkei-api|localhost:8787)/,r=>r.fulfill({status:200,headers,json:{allowed:true,tool:'skymap',loginId:'ws-test',tools,credentials:[],hasPassword:true,recoveryCodes:10,favorites:[],sightings:[],rev:1}}));
 const p=await c.newPage();p.errors=[];p.on('pageerror',e=>p.errors.push(e.message));
 await p.goto(url);await p.waitForFunction(ready);
 await p.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>63;navigationHistory.pushRoute('#/explore');});
 await p.locator('#exploreMapTab').waitFor({state:'attached'});
 await p.evaluate(()=>{SkyMapUI.setObserver({name:'菅生ケ丘',latitude:35.5895,longitude:139.561,groundManualM:63,standAglM:1.5});SkyMapUI.setTarget('skytree');});
 await p.waitForFunction(()=>{try{return !!SkyMapUI.selectionState()?.observer;}catch{return false;}});
 return p;
}
const rect=(p,s)=>p.evaluate(s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,w:r.width,h:r.height,hidden:getComputedStyle(e).display==='none'};},s);
(async()=>{
 const chrome=await chromium.launch({channel:'chrome',headless:true}),wk=await webkit.launch({headless:true});
 // 本体: 作業画面の部品を持たない（試用版だけの確認時は MAP_WORKSPACE_ROOT を外す）
 if(process.env.MAP_WORKSPACE_ROOT){const p=await open(chrome,process.env.MAP_WORKSPACE_ROOT,390,844);await p.locator('#exploreMapTab').click();await p.waitForTimeout(800);assert.equal(await p.evaluate(()=>typeof globalThis.AstroNotesMapWorkspace),'undefined');assert.equal(await p.locator('#mapWsTop').count(),0);assert.equal(await p.evaluate(()=>document.querySelector('.sky-map-wrap').classList.contains('sky-map-wide')),false);assert.deepEqual(p.errors,[]);await p.context().close();}
 for(const [browser,name] of [[chrome,'chrome'],[wk,'webkit']])for(const [w,h,scheme] of [[390,844,'dark'],[320,568,'dark'],[390,844,'light'],[844,390,'dark'],[1280,800,'dark']]){
  const p=await open(browser,base,w,h,scheme),tag=`${name} ${w}x${h} ${scheme}`;
  await p.locator('#exploreMapTab').click();await p.locator('#mapWsTop').waitFor();await p.waitForTimeout(900);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,tag+' 横はみ出し');
  const top=await rect(p,'#mapWsTop'),wrap=await rect(p,'.sky-map-wrap'),footer=await rect(p,'.sky-map-footer');
  assert.ok(Math.abs(wrap.top-top.bottom)<2,tag+' 上部バーと地図');
  if(w<900&&h>500){assert.ok(Math.abs(wrap.bottom-footer.top)<2,tag+' 地図と下部');assert.ok(wrap.h>=(h>=800?480:250),tag+' 地図の高さ '+wrap.h);}
  else assert.ok(wrap.right<=footer.left+2,tag+' 右の列');
  assert.ok(footer.bottom<=h+1,tag+' 下部が画面内');
  // 縦ボタンは地図内で重ならず、すべて押せる大きさ
  const rail=await p.evaluate(()=>[...document.querySelectorAll('.sky-map-wrap .map-locate,#skyMapIn,#skyMapOut,.sky-map-wrap .map-layers-btn,#mapWsBodies,#skyMapObserverTool,#skyMapTargetTool')].filter(e=>getComputedStyle(e).display!=='none').map(e=>{const r=e.getBoundingClientRect();return {id:e.id||e.className,top:r.top,bottom:r.bottom,w:r.width,h:r.height,right:r.right};}));
  rail.sort((a,b)=>a.top-b.top);for(let i=0;i<rail.length;i++){assert.ok(rail[i].w>=44&&rail[i].h>=44,tag+' ボタン寸法 '+rail[i].id);assert.ok(rail[i].bottom<=wrap.bottom+1,tag+' ボタンが地図の外 '+rail[i].id);if(i)assert.ok(rail[i].top>=rail[i-1].bottom-.5,tag+' ボタンの重なり '+rail[i].id);}
  // 情報欄: 時刻が読め、日の出の欄を押すとその時刻になる
  assert.match(await p.locator('#wsSun b').innerText(),/°/);const riseText=await p.locator('#wsSunRise b').innerText();assert.match(riseText,/^\d\d:\d\d$/);
  await p.locator('#wsSunRise').click();await p.waitForTimeout(200);assert.equal(await p.evaluate(()=>document.getElementById('skyMapTime').value),riseText);
  assert.match(await p.locator('#wsTarget b').innerText(),/°/);
  if(w<900){await p.evaluate(()=>{const i=document.getElementById('mapWsInfo');i.scrollLeft=i.clientWidth*4;});await p.waitForTimeout(250);assert.equal(await p.evaluate(()=>[...document.querySelectorAll('#mapWsDots span')].findIndex(d=>d.classList.contains('on'))),4,tag+' ページの丸');await p.evaluate(()=>{document.getElementById('mapWsInfo').scrollLeft=0;});}
  // 太陽と月は情報欄で切り替える。条件の天体は変えず、数字と見出しが主役に揃う。隠していた天体も出す
  const pick=async i=>{if(w<900)await p.evaluate(i=>{const n=document.getElementById('mapWsInfo');n.scrollLeft=n.clientWidth*i;},i);else await p.locator('#mapWsInfo [data-body]').nth(i).locator('.map-ws-cell').first().click();await p.waitForTimeout(250);};
  const condition=await p.evaluate(()=>SkyMapUI.selectionState().body);
  await pick(1);assert.match(await p.locator('#mapWsTitle span').innerText(),/^月 ×/,tag+' 月へ切替');assert.match(await p.locator('#wsGap').innerText(),/月/,tag);assert.equal(await p.evaluate(()=>SkyMapUI.selectionState().body),condition,tag+' 条件は変えない');
  await pick(0);assert.match(await p.locator('#mapWsTitle span').innerText(),/^太陽 ×/,tag+' 太陽へ切替');
  await p.locator('#mapWsBodies').click();await p.locator('#mapWsMenu button').nth(1).click();await p.waitForTimeout(150);assert.equal(await p.locator('#skyMapShowMoon').getAttribute('aria-pressed'),'false',tag);
  await pick(1);assert.equal(await p.locator('#skyMapShowMoon').getAttribute('aria-pressed'),'true',tag+' 隠した月を出す');await pick(0);
  // 帯は24時間の縮尺で、ボタンで切り替えられる
  assert.equal(await p.locator('#skyMapScrubMode').getAttribute('data-mode'),'hour',tag);
  // 軌道: 毎時の目盛りを押すと時刻が移る
  const hit=await p.evaluate(()=>{const c=document.getElementById('skyMapCanvas').getBoundingClientRect(),h=AstroNotesMapWorkspace.hits().find(v=>{const x=c.left+v.x,y=c.top+v.y;return x>20&&x<c.right-70&&y>c.top+20&&y<c.bottom-20;});return h&&{x:c.left+h.x,y:c.top+h.y,at:h.at};});assert.ok(hit,tag+' 目盛り');await p.mouse.click(hit.x,hit.y);await p.waitForTimeout(350);assert.equal(await p.evaluate(()=>SkyMapUI.selectionState().at??document.getElementById('skyMapTime').value)!==undefined,true);assert.equal(await p.evaluate(()=>document.getElementById('skyMapTime').value),await p.evaluate(at=>S.JstCal.hhmm(at),hit.at),tag+' 目盛りを押した時刻');
  // 日をまたぐ月: 前日に昇った月でも出の時刻が出て、押すとその時刻へ移る
  const crossing=await p.evaluate(()=>{const h=SkyMapUI.workspaceHost(),d=86400000,day=AstroNotesSkyMap.dayStart(h.session.at);for(let i=0;i<40;i++){const start=day+i*d;if(h.skyState('moon',start,h.session.eye).altitude>10&&h.skyState('moon',start+3600000,h.session.eye).altitude>10){h.setTime(start+3600000);return start;}}return null;});assert.ok(crossing,tag+' 日をまたぐ月');await p.waitForTimeout(500);await pick(1);
  assert.match(await p.locator('#wsMoonRise b').innerText(),/^\d\d:\d\d$/,tag+' 前日の月の出');assert.match(await p.locator('#wsMoonRise').innerText(),/\d+\/\d+/,tag+' 月の出の日付');await p.locator('#wsMoonRise').click();await p.waitForTimeout(500);assert.ok(Math.abs(await p.evaluate(()=>{const h=SkyMapUI.workspaceHost();return h.skyState('moon',h.session.at,h.session.eye).altitude;}))<.3,tag+' 月の出の高度');assert.ok(await p.evaluate(()=>SkyMapUI.workspaceHost().session.at)<crossing,tag+' 前日へ移動');await pick(0);
  // Sun Surveyorの三脚と的: 既定は撮影地点も対象も固定で、地図は自由に動く。拡大縮小しても地点は変わらない
  const state=()=>p.evaluate(()=>{const h=SkyMapUI.workspaceHost(),o=h.session.observer,c=h.map.center(),r=document.getElementById('skyMapCanvas').getBoundingClientRect();return {lat:o.latitude,lon:o.longitude,name:o.name,clat:c.latitude,clon:c.longitude,zoom:h.map.zoom(),target:h.session.target?.id,mid:[r.left+r.width/2-20,r.top+r.height/2+10]};});
  const drag=async(dx,dy)=>{const s=await state();await p.mouse.move(...s.mid);await p.mouse.down();await p.mouse.move(s.mid[0]+dx,s.mid[1]+dy,{steps:4});await p.mouse.up();await p.waitForTimeout(500);};
  const close=(a,b,text)=>assert.ok(Math.abs(a-b)<1e-6,tag+' '+text);
  let s0=await state(),s1;assert.equal(await p.locator('#mapWsHome').isVisible(),false,tag+' 中央では戻るを出さない');await drag(60,-40);await drag(60,-40);await drag(60,-40);s1=await state();assert.notEqual(s1.clon,s0.clon,tag+' 固定中も地図は動く');assert.equal(s1.lat,s0.lat,tag+' 固定中は撮影地点が動かない');assert.equal(s1.target,s0.target,tag);
  if(h>640||w>=900){const c=s1;await p.locator('#skyMapIn').click();await p.waitForTimeout(300);s1=await state();assert.ok(s1.zoom>c.zoom,tag+' 拡大できる');assert.equal(s1.lat,s0.lat,tag+' 拡大しても地点は同じ');await p.locator('#skyMapOut').click();await p.waitForTimeout(300);}
  assert.equal(await p.locator('#mapWsHome').isVisible(),true,tag+' 戻るの表示');await p.locator('#mapWsHome').click();await p.waitForTimeout(300);s1=await state();close(s1.clat,s0.lat,'撮影地点へ戻る');assert.equal(await p.locator('#mapWsHome').isVisible(),false,tag+' 戻った後は隠す');
  // 三脚とピンは画面中央をその地点に置くだけ。動かさずに押すと案内だけ出る
  const saved=()=>p.evaluate(()=>store.get('sorami.skyMap:'+encodeURIComponent('ws-test'),null)?.observer);
  await p.locator('#skyMapObserverTool').click();await p.waitForTimeout(150);s1=await state();assert.equal(s1.lat,s0.lat,tag+' 中央が同じなら置かない');assert.equal(s1.name,s0.name,tag+' 名前も変えない');assert.match(await p.locator('#mapWsPick').innerText(),/十字/,tag+' 案内');
  await drag(60,-40);const moved=await state();assert.equal(moved.lat,s0.lat,tag);await p.locator('#skyMapObserverTool').click();await p.waitForTimeout(600);s1=await state();close(s1.lat,moved.clat,'中央が撮影地点になる');assert.equal(s1.name,'地図で置いた地点',tag+' 座標を名前にしない');assert.equal(s1.target,s0.target,tag+' 選んだ対象は残る');close((await saved())?.latitude,s1.lat,'置くと保存');assert.equal(await p.locator('[aria-pressed]#skyMapObserverTool').getAttribute('aria-pressed'),'false',tag+' 押したままにしない');
  await p.locator('#mapWsUndo').click();await p.waitForTimeout(600);s1=await state();assert.equal(s1.lat,s0.lat,tag+' 元に戻す');assert.equal(s1.name,s0.name,tag+' 名前も戻る');close(s1.clat,s0.lat,'元の地点が中央');
  await drag(60,-40);await p.locator('#skyMapTargetTool').click();await p.waitForTimeout(300);assert.equal(await p.locator('#skyMapTargetSheet').evaluate(e=>e.open),true,tag+' 対象の高さを聞く');s1=await state();assert.equal(s1.lat,s0.lat,tag+' 対象を置いても撮影地点は動かない');await p.locator('#skyMapTargetSheet').evaluate(e=>e.close());await p.waitForTimeout(200);assert.equal((await state()).target,s0.target,tag+' 高さを入れなければ対象は変わらない');await p.evaluate(()=>{const h=SkyMapUI.workspaceHost(),o=h.session.observer;h.map.setCenter(o.latitude,o.longitude);});await p.waitForTimeout(200);
  // 回転: 方位の線と地図が揃ったまま回り、座標の変換も往復で合う。方位磁針で北へ戻る。本体の既定は回らない
  const turned=await p.evaluate(async()=>{const h=SkyMapUI.workspaceHost(),o=h.session.observer;h.map.setCenter(o.latitude,o.longitude);h.map.setRotation(90);await new Promise(r=>setTimeout(r,120));const c=h.map.project(o.latitude,o.longitude),n=h.map.project(o.latitude+.01,o.longitude),back=h.map.coordinateAt(n[0],n[1]);return {left:n[0]<c[0]-5,level:Math.abs(n[1]-c[1])<1,lat:back.latitude-(o.latitude+.01),lon:back.longitude-o.longitude,rotation:h.map.rotation()};});assert.ok(turned.left&&turned.level,tag+' 東が上なら北は左');assert.ok(Math.abs(turned.lat)<1e-6&&Math.abs(turned.lon)<1e-6,tag+' 座標の往復');
  if(out&&name==='chrome'&&w===390&&scheme==='dark')await p.screenshot({path:`${out}/ws-rotated.png`});
  let beforeDrag=await state();await drag(0,-50);let afterDrag=await state();assert.ok(afterDrag.clon<beforeDrag.clon-1e-6,tag+' 回転中は指の向きに地図が動く');
  await p.locator('#mapWsNorth').click();await p.waitForTimeout(150);assert.equal(await p.evaluate(()=>SkyMapUI.workspaceHost().map.rotation()),0,tag+' 北へ戻す');
  // 上部の地点名を押すと今の条件欄が地図の上に開く。地点シートから戻っても開いたまま
  const panelOn=()=>p.evaluate(()=>{const c=document.getElementById('exploreConditions'),r=c.getBoundingClientRect();return document.getElementById('skyMapView').classList.contains('map-ws-conditions')&&c.contains(document.elementFromPoint(r.left+r.width/2,Math.min(r.top+40,innerHeight-5)));});await p.locator('#mapWsTitle').click();await p.waitForTimeout(200);assert.equal(await panelOn(),true,tag+' 地点名で条件欄が前面に出る');assert.equal(await p.locator('#mapWsTop').isVisible(),true,tag);const panelBox=await rect(p,'#exploreConditions');assert.ok(Math.abs(panelBox.top-top.bottom)<12,tag+' 地点名のすぐ下 '+panelBox.top);assert.ok(panelBox.left>=0&&panelBox.right<=w&&panelBox.bottom<=h+1,tag+' 条件欄が画面内');for(const id of ['skyMapChoose'])assert.equal(await p.locator('#'+id).isVisible(),true,tag+' '+id);assert.equal(await p.locator('#exploreShowResult').isVisible(),false,tag+' 結果を確認は出さない');
  if(out&&name==='chrome')await p.screenshot({path:`${out}/ws-conditions-${w}x${h}-${scheme}.png`});
  await p.locator('#skyMapChoose').click();await p.waitForTimeout(250);assert.equal(await p.evaluate(()=>document.getElementById('placeSheet').open),true,tag+' 地点の検索');await p.evaluate(()=>document.getElementById('placeSheet').close());await p.waitForTimeout(150);assert.equal(await panelOn(),true,tag+' 検索から戻っても開いたまま');
  await p.locator('#mapWsTitle').click();await p.waitForTimeout(150);assert.equal(await panelOn(),false,tag+' もう一度押すと閉じる');await p.locator('#mapWsTitle').click();await p.waitForTimeout(150);if(panelBox.bottom<h-10){await p.mouse.click(w-10,h-6);await p.waitForTimeout(150);assert.equal(await panelOn(),false,tag+' 外を押すと閉じる');}else{await p.locator('#mapWsTitle').click();await p.waitForTimeout(150);}
  // メニュー: 実際の釦へ渡す
  await p.locator('#mapWsShare').click();assert.ok(await p.locator('#mapWsMenu button').count()>=3,tag+' 保存と共有');const menu=await rect(p,'#mapWsMenu');assert.ok(menu.left>=0&&menu.right<=w,tag+' メニューが画面内');await p.mouse.click(10,top.bottom+40);assert.equal(await p.locator('#mapWsMenu').isVisible(),false);
  await p.locator('#mapWsBodies').click();assert.equal(await p.locator('#mapWsMenu button').count(),3,tag+' 天体');await p.locator('#mapWsMenu button').first().click();await p.waitForTimeout(150);assert.equal(await p.evaluate(()=>document.getElementById('skyMapShowSun').getAttribute('aria-pressed')),'false');await p.locator('#mapWsBodies').click();await p.locator('#mapWsMenu button').first().click();
  if(out&&name==='chrome')await p.screenshot({path:`${out}/ws-${w}x${h}-${scheme}.png`});
  // 見え方へ切り替えると作業画面が閉じ、地図タブで戻る
  const segBefore=await rect(p,'#mapWsScene');await p.locator('#mapWsScene').click();await p.waitForTimeout(500);assert.equal(await p.locator('#mapWsTop').isVisible(),true,tag+' 見え方でも上部バー');const segScene=await rect(p,'#mapWsScene');assert.ok(Math.abs(segScene.left-segBefore.left)<1&&Math.abs(segScene.top-segBefore.top)<1,tag+' 切替ボタンの位置が同じ');assert.equal(await p.locator('#mapWsScene').getAttribute('aria-pressed'),'true',tag);assert.equal(await p.evaluate(()=>document.querySelector('.sky-map-wrap').classList.contains('sky-map-wide')),false);assert.equal(await p.locator('#exploreConditions').isVisible(),false,tag+' 条件は隠す');assert.equal(await p.evaluate(()=>scrollY),0,tag);const panel=await rect(p,'#exploreScenePanel');assert.ok(panel.top<=top.bottom+40,tag+' 見え方が上部バーのすぐ下 '+panel.top);assert.ok(panel.left>=0,tag);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,tag+' 見え方の横はみ出し');
  if(out&&name==='chrome')await p.screenshot({path:`${out}/ws-scene-${w}x${h}-${scheme}.png`});
  await p.locator('#mapWsTitle').click();await p.waitForTimeout(200);assert.equal(await p.locator('#exploreConditions').isVisible(),true,tag+' 見え方でも地点名で条件欄');await p.locator('#mapWsTitle').click();await p.waitForTimeout(150);
  await p.locator('#mapWsMap').click();await p.waitForTimeout(400);assert.equal(await p.locator('#mapWsInfo').isVisible(),true,tag+' 再表示');const segMap=await rect(p,'#mapWsScene');assert.ok(Math.abs(segMap.left-segBefore.left)<1&&Math.abs(segMap.top-segBefore.top)<1,tag+' 地図へ戻っても同じ位置');assert.equal(await p.locator('.map-ws-hide').count(),0,tag+' 隠した部品を戻す');
  // 見え方から戻るで条件へ。結果を確認からも同じ全画面に入る
  await p.locator('#mapWsScene').click();await p.waitForTimeout(400);await p.locator('#mapWsBack').click();await p.waitForTimeout(450);assert.equal(await p.locator('#mapWsTop').isVisible(),false,tag+' 見え方から戻る');assert.equal(await p.locator('#exploreConditions').evaluate(e=>e.open),true,tag);assert.equal(await p.locator('.map-ws-hide').count(),0,tag);
  await p.locator('#exploreShowResult').click();await p.waitForTimeout(450);assert.equal(await p.locator('#mapWsTop').isVisible(),true,tag+' 結果を確認で全画面');await p.locator('#mapWsMap').click();await p.waitForTimeout(400);assert.equal(await p.locator('#mapWsInfo').isVisible(),true,tag+' 結果から地図へ');
  // 端末の戻るで条件へ、もう一度の地図タブで再表示
  await p.goBack();await p.waitForTimeout(450);assert.equal(await p.locator('#mapWsTop').isVisible(),false,tag+' 戻る');assert.match(p.url(),/#\/explore/,tag);assert.equal(await p.locator('#exploreConditions').evaluate(e=>e.open),true);
  await p.locator('#exploreMapTab').click();await p.waitForTimeout(350);assert.equal(await p.locator('#mapWsTop').isVisible(),true);
  await p.locator('#mapWsBack').click();await p.waitForTimeout(350);assert.equal(await p.locator('#mapWsTop').isVisible(),false,tag+' 戻るボタン');assert.match(p.url(),/#\/explore/);assert.notEqual(await p.locator('#skyMapScrubMode').getAttribute('data-mode'),'hour',tag+' 帯の縮尺を戻す');
  assert.deepEqual(p.errors,[],tag);await p.context().close();
 }
 await chrome.close();await wk.close();console.log('PASS map workspace');
})().catch(e=>{console.error(e);process.exit(1);});
