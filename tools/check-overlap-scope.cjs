// 重ねる対象（個別/全て）の実画面検査。合成アカウント・API writeはstubし、本人データを使わない。
// UI_PREVIEW_PORT=8992 node tools/serve-ui-preview.cjs を別に起動して実行する。
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.OVERLAP_BASE||'http://127.0.0.1:8992/trial/index.html',out=process.env.OVERLAP_OUT||'/tmp/astronotes-overlap-scope',grants=['records','tower','diamond','pearl','skymap','multiscene'];
fs.mkdirSync(out,{recursive:true});
const stage=(p,v)=>p.waitForFunction(v=>document.getElementById('skyMapView').dataset.exploreStage===v,v);
async function pick(page,keys){
 await page.locator('#skyMapTargetOpen').click();const dialog=page.locator('#previewTargetDialog[open]');await dialog.waitFor();
 const on=await dialog.locator('[data-target-key][aria-checked="true"]').evaluateAll(ns=>ns.map(n=>n.dataset.targetKey));for(const k of on)if(!keys.includes(k))await dialog.locator(`[data-target-key="${k}"]`).click();for(const k of keys)if(!on.includes(k))await dialog.locator(`[data-target-key="${k}"]`).click();
 await dialog.getByRole('button',{name:'選択を適用'}).click();await dialog.waitFor({state:'detached'}).catch(()=>{});await page.waitForFunction(()=>!document.querySelector('#previewTargetDialog[open]'));
}
(async()=>{const results=[];
for(const [engine,type]of [['chrome',chromium],['webkit',webkit]].filter(([e])=>(process.env.OVERLAP_ENGINE||'chrome,webkit').split(',').includes(e))){
 const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
 try{for(const width of (process.env.OVERLAP_WIDTH||'390').split(',').map(Number))for(const theme of (process.env.OVERLAP_THEME||'light').split(',')){
  const c=await browser.newContext({viewport:{width,height:900},locale:'ja-JP',timezoneId:'Asia/Tokyo',colorScheme:theme,isMobile:width<960,hasTouch:true,reducedMotion:'reduce'});let writes=0;
  await c.addInitScript(g=>{sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-overlap',loginId:'overlap-test',tools:g}));Date.now=()=>Date.parse('2026-11-07T15:00:00+09:00');},grants);
  await c.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(base).origin)return r.continue();if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(r.request().method()))writes++;return r.fulfill({json:{allowed:true,tool:'skymap',loginId:'overlap-test',tools:grants,favorites:[],records:[],sightings:[],rev:1}});}return r.abort();});
  const page=await c.newPage(),errors=[],result={engine,width,theme};page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(60000);const shot=n=>page.screenshot({path:`${out}/${engine}-${width}-${theme}-${n}.png`,fullPage:true});
  try{
   await page.goto(base+'#/almanac');await page.waitForFunction(()=>globalThis.MyPlacesUI&&typeof SkyMapUI==='object'&&globalThis.TrialExplore&&globalThis.AstroNotesTrialOverlap);
   result.version=await page.locator('meta[name=app-version]').getAttribute('content');
   await page.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();RecordSync.touched=()=>{};RecordSync.kick=()=>{};accountSync().queuePush=()=>{};
    window.overlapCalls=[];const days=aimBuildingDays;aimBuildingDays=(obs,t,body,partId,seq,o)=>{overlapCalls.push([t.id,partId,o?.matchMode]);return days(obs,t,body,partId,seq,o);};
    navigationHistory.pushRoute('#/explore');await SkyMapUI.open();});
   await page.locator('#exploreShowResult').waitFor({state:'visible'});
   // 1件：自動。選択欄は出さない。
   await pick(page,['skytree']);assert.equal(await page.locator('#skyMapOverlapField').isHidden(),true,'one target hides the overlap choice');
   // 2件：個別名と「全て」。順序は 対象→重ねる対象→重ね方→撮影地点。
   await pick(page,['skytree','tokyotower']);const field=page.locator('#skyMapOverlapField');await field.waitFor({state:'visible'});
   assert.deepEqual(await page.locator('#skyMapOverlapTarget option').allTextContents(),['東京スカイツリー','東京タワー','全て']);
   const order=await page.evaluate(()=>['skyMapTargetOpen','skyMapOverlapTarget','skyMapAlignmentDetails','skyMapChoose'].map(id=>document.getElementById(id).getBoundingClientRect().top));
   assert(order.every((v,i)=>!i||v>order[i-1]),'target → overlap target → alignment → place');result.order=order.map(Math.round);
   const box=await page.locator('#skyMapOverlapTarget').boundingBox();assert(box.height>=44&&box.x+box.width<=width,'44px touch target within the viewport');
   // 個別：重ね先だけ切替。表示集合は保持し、部位は全体から。
   await page.locator('#skyMapAlignmentControls select').selectOption({index:1});assert.equal(await page.evaluate(()=>SkyMapUI.selectionState().matchMode),'limb');
   await page.locator('#skyMapOverlapTarget').selectOption('tokyotower');
   let s=await page.evaluate(()=>({id:SkyMapUI.selectionState().target.id,mode:SkyMapUI.selectionState().matchMode,part:SkyMapUI.selectionState().partId,extras:aimSceneExtraTargets(SkyMapUI.selectionState().target.id).map(t=>t.id),label:document.getElementById('skyMapTargetOpen').textContent}));
   assert.deepEqual([s.id,s.mode,s.part,s.extras.join()],['tokyotower','overlap','__whole','skytree'],'individual switch keeps the display set and resets the old part');assert.match(s.label,/東京タワー/);assert.match(s.label,/東京スカイツリー/);
   // 追加しても重ねる対象を保つ。外すと明示fallback。
   await pick(page,['skytree','tokyotower','tocho-building']);assert.equal(await page.evaluate(()=>SkyMapUI.selectionState().target.id),'tokyotower','adding keeps the chosen overlap target');
   await pick(page,['skytree','tocho-building']);s=await page.evaluate(()=>({id:SkyMapUI.selectionState().target.id,notice:document.getElementById('skyMapOverlapNotice').textContent}));
   assert.notEqual(s.id,'tokyotower');assert.match(s.notice,/重ねる対象を外したため/);result.fallback=s;
   await pick(page,['skytree','tokyotower']);await page.locator('#skyMapOverlapTarget').selectOption('skytree');
   // 全て：重ね方は合成輪郭の全体だけ。部位/縁は出さない。
   await page.locator('#skyMapOverlapTarget').selectOption('__all');
   s=await page.evaluate(()=>({all:AstroNotesTrialOverlap.isAll(),mode:SkyMapUI.selectionState().matchMode,align:document.querySelector('#skyMapAlignmentControls select')?.selectedOptions[0]?.textContent||document.getElementById('skyMapAlignmentControls').innerText,limbs:document.querySelectorAll('#skyMapAlignmentControls [data-alignment-limb]').length,detail:document.getElementById('exploreConditionDetail').textContent}));
   assert.equal(s.all,true);assert.equal(s.mode,'overlap');assert.match(s.align,/全体/);assert.equal(s.limbs,0);assert.match(s.detail,/全てに重なる/);
   // 両方が同じ方向に見える地点。候補日は各対象の全体走査の和。
   await page.evaluate(()=>{overlapCalls.length=0;SkyMapUI.setObserver({name:'重ね試験地点',latitude:35.80,longitude:139.86,elevation:5});});
   await page.waitForFunction(()=>SkyMapUI.selectionState().observer?.name==='重ね試験地点');await shot('search-all');
   await page.locator('#exploreShowResult').click();await stage(page,'preview');
   // 候補日（見え方の段階で計算する既存契約）：各対象の全体走査の和。
   await page.waitForFunction(()=>overlapCalls.some(c=>c[0]==='skytree')&&overlapCalls.some(c=>c[0]==='tokyotower'),null,{timeout:90000});
   const calls=await page.evaluate(()=>overlapCalls.slice());assert(calls.every(c=>c[2]==='overlap'),'candidate dates scan every member as 全体');result.dateCalls=calls.length;
   await page.waitForFunction(()=>!/計算中/.test(document.getElementById('skyMapDates').innerText),null,{timeout:120000});result.dates=(await page.locator('#skyMapDates').innerText()).replace(/\s+/g,' ').slice(0,160);
   await page.waitForFunction(()=>AstroNotesTrialOverlap.lastAccent?.mode==='all');await page.waitForTimeout(500);
   s=await page.evaluate(()=>({accent:AstroNotesTrialOverlap.lastAccent,composition:document.getElementById('trialCompositionToggle')?.hidden!==false,plan:AstroNotesTrialComposition.plan().composition}));
   assert.equal(s.accent.ids.length,2);assert(s.accent.drawn.length>=1);assert.equal(s.composition,true,'in-figure position editor is unavailable for 全て');assert.equal(s.plan,null);result.accent=s.accent;
   await shot('preview-all');
   // 予定・共有：全てを保持（v1 codecで無損失）。
   const saved=await page.evaluate(()=>{const b=[...document.querySelectorAll('[data-quick-save="plan"][data-plan-source="aim"]')][0];b.click();const row=schedule().list().at(-1);const back=AstroNotesPlan.decode(AstroNotesPlan.encode(row.value));return {ov:row.value.ov,back:back?.ov,title:row.title};});
   assert.equal(saved.ov?.members?.length,2);assert.deepEqual(saved.back,saved.ov);assert.match(saved.title,/全て/);
   // 撮影地点に保存：全員を同じ地点へ全体で登録。
   const rec=await page.evaluate(()=>{const before=MyPlacesUI.load().length;const b=[...document.querySelectorAll('[data-quick-save="place"][data-plan-source="aim"]')][0];b.click();const added=MyPlacesUI.load().slice(before);return {keys:added.map(r=>r.target.key),places:[...new Set(added.map(r=>r.placeId))].length,notice:document.getElementById('quickSaveNoticeText')?.textContent};});
   assert.deepEqual(rec.keys.sort(),['skytree','tokyotower']);assert.equal(rec.places,1);assert.match(rec.notice,/登録しました/);result.record=rec;
   // 個別へ戻すと他の対象は残して描画し、強調は重ねる対象だけ。
   await page.locator('#exploreBackToCandidates').click();await stage(page,'search');
   await page.locator('#skyMapOverlapTarget').selectOption('tokyotower');assert.equal(await page.evaluate(()=>AstroNotesTrialOverlap.isAll()),false);
   await page.locator('#exploreShowResult').click();await stage(page,'preview');await page.waitForFunction(()=>AstroNotesTrialOverlap.lastAccent?.mode==='one');
   s=await page.evaluate(()=>({accent:AstroNotesTrialOverlap.lastAccent,backdrop:aimSceneBackdrop().map(t=>t.id)}));assert.deepEqual(s.accent.ids,['tokyotower']);assert(s.backdrop.includes('skytree'),'other targets remain drawn');
   await shot('preview-one');
   // 共有の復元：拡張なし→個別、全て→表示集合と全て、受信側に無い対象→基準対象へ。
   const restored=await page.evaluate(()=>{const v=schedule().list().at(-1).value;restoreSharedPlan(structuredClone(v),{persist:false});const a=store.get('sorami.sceneOverlap:overlap-test').all;const plain=structuredClone(v);delete plain.ov;restoreSharedPlan(plain,{persist:false});const b=store.get('sorami.sceneOverlap:overlap-test').all;const bad=structuredClone(v);bad.ov.members[1].id='fav:missing';restoreSharedPlan(bad,{persist:false});return [a,b,store.get('sorami.sceneOverlap:overlap-test').all];});
   assert.deepEqual(restored,[true,false,false]);
   assert.equal(writes,0,'no API writes');assert.deepEqual(errors,[]);result.writes=writes;result.passed=true;
  }catch(e){result.error=String(e.stack||e);await shot('failure').catch(()=>{});}
  finally{result.errors=errors;results.push(result);await c.close();}
 }}finally{await browser.close();}
}
fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,1));console.log(JSON.stringify(results,null,1));if(results.some(r=>!r.passed))process.exit(1);})();
