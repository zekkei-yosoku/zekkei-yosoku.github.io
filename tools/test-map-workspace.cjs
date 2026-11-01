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
  // 帯は24時間の縮尺で、ボタンで切り替えられる
  assert.equal(await p.locator('#skyMapScrubMode').getAttribute('data-mode'),'hour',tag);
  // 軌道: 毎時の目盛りを押すと時刻が移る
  const hit=await p.evaluate(()=>{const c=document.getElementById('skyMapCanvas').getBoundingClientRect(),h=AstroNotesMapWorkspace.hits().find(v=>{const x=c.left+v.x,y=c.top+v.y;return x>20&&x<c.right-70&&y>c.top+20&&y<c.bottom-20;});return h&&{x:c.left+h.x,y:c.top+h.y,at:h.at};});assert.ok(hit,tag+' 目盛り');await p.mouse.click(hit.x,hit.y);await p.waitForTimeout(350);assert.equal(await p.evaluate(()=>SkyMapUI.selectionState().at??document.getElementById('skyMapTime').value)!==undefined,true);assert.equal(await p.evaluate(()=>document.getElementById('skyMapTime').value),await p.evaluate(at=>S.JstCal.hhmm(at),hit.at),tag+' 目盛りを押した時刻');
  // メニュー: 実際の釦へ渡す
  await p.locator('#mapWsShare').click();assert.ok(await p.locator('#mapWsMenu button').count()>=3,tag+' 保存と共有');const menu=await rect(p,'#mapWsMenu');assert.ok(menu.left>=0&&menu.right<=w,tag+' メニューが画面内');await p.mouse.click(10,top.bottom+40);assert.equal(await p.locator('#mapWsMenu').isVisible(),false);
  await p.locator('#mapWsBodies').click();assert.equal(await p.locator('#mapWsMenu button').count(),3,tag+' 天体');await p.locator('#mapWsMenu button').first().click();await p.waitForTimeout(150);assert.equal(await p.evaluate(()=>document.getElementById('skyMapShowSun').getAttribute('aria-pressed')),'false');await p.locator('#mapWsBodies').click();await p.locator('#mapWsMenu button').first().click();
  if(out&&name==='chrome')await p.screenshot({path:`${out}/ws-${w}x${h}-${scheme}.png`});
  // 見え方へ切り替えると作業画面が閉じ、地図タブで戻る
  await p.locator('#mapWsScene').click();await p.waitForTimeout(350);assert.equal(await p.locator('#mapWsTop').isVisible(),false,tag+' 見え方');assert.equal(await p.evaluate(()=>document.querySelector('.sky-map-wrap').classList.contains('sky-map-wide')),false);
  await p.locator('#exploreMapTab').click();await p.waitForTimeout(350);assert.equal(await p.locator('#mapWsTop').isVisible(),true,tag+' 再表示');
  // 端末の戻るで条件へ、もう一度の地図タブで再表示
  await p.goBack();await p.waitForTimeout(450);assert.equal(await p.locator('#mapWsTop').isVisible(),false,tag+' 戻る');assert.match(p.url(),/#\/explore/,tag);assert.equal(await p.locator('#exploreConditions').evaluate(e=>e.open),true);
  await p.locator('#exploreMapTab').click();await p.waitForTimeout(350);assert.equal(await p.locator('#mapWsTop').isVisible(),true);
  await p.locator('#mapWsBack').click();await p.waitForTimeout(350);assert.equal(await p.locator('#mapWsTop').isVisible(),false,tag+' 戻るボタン');assert.match(p.url(),/#\/explore/);assert.notEqual(await p.locator('#skyMapScrubMode').getAttribute('data-mode'),'hour',tag+' 帯の縮尺を戻す');
  assert.deepEqual(p.errors,[],tag);await p.context().close();
 }
 await chrome.close();await wk.close();console.log('PASS map workspace');
})().catch(e=>{console.error(e);process.exit(1);});
