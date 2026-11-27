require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {fixture}=require('./candidate-date-fixture.cjs');
const base=process.env.MANAGE_BASE||'http://127.0.0.1:8992/trial/';
const out=process.env.MANAGE_OUT||'/tmp/astronotes-record-targets';
fs.mkdirSync(out,{recursive:true});
const widths=(process.env.MANAGE_WIDTHS||'320,390').split(',').map(Number);

(async()=>{
 for(const [engine,type] of [['chrome',chromium],['webkit',webkit]]){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome'}:{});
  try {
   for(const width of widths){
    const grants=width===320?['records','diamond']:['records','tower','diamond','pearl','skymap','multiscene'];
    const context=await browser.newContext({viewport:{width,height:width===320?568:844},locale:'ja-JP',timezoneId:'Asia/Tokyo',colorScheme:width===320?'dark':'light',reducedMotion:'reduce',isMobile:true,hasTouch:true});
    try {
     await context.addInitScript(fixture,grants);
     await context.route('**/*',route=>{
      const {origin}=new URL(route.request().url());
      if(origin===new URL(base).origin)return route.continue();
      if(/zekkei-api|localhost:8787/.test(origin))return route.fulfill({json:{allowed:true,tool:'records',loginId:'date-test',tools:grants,favorites:[],sightings:[],records:[],rev:1}});
      return route.abort();
     });
     const page=await context.newPage(),errors=[];
     page.on('pageerror',error=>errors.push(error.message));
     page.setDefaultTimeout(18000);
     await page.goto(base+'index.html?verify=target-management#/records');
     await page.waitForFunction(()=>{try{return typeof MyPlacesUI==='object'&&typeof startupSessionReady!=='undefined';}catch{return false;}}).catch(async e=>{console.error({errors,url:page.url(),body:(await page.locator('body').innerText()).slice(0,250)});throw e;});
     await page.evaluate(async()=>{
      await startupSessionReady;
      await AstroNotesAssets.ensureModels();
      groundAt=async()=>31;
      AstroNotesTerrain.groundElevation=async()=>31;
      RecordSync.kick=()=>{};
      RecordSync.touched=()=>{};
      accountSync().queuePush=()=>{};
      const point={id:'manage-observer',name:'記録地点',latitude:35.68,longitude:139.71,elevation:9,eyeHeightAGL:1.5,recordRegistered:true};
      favorites=[point];
      store.set('sorami.favorites',favorites);
      const observation=AstroNotesLibrary.cleanObservation({id:'management-observation',placeId:point.id,observer:point,target:{key:'fuji',name:'富士山',latitude:35.36,longitude:138.73},result:'seen',registration:true,createdAt:1,updatedAt:1});
      store.set(AstroNotesLibrary.keys(auth.loginId).observations,[observation]);
      MyPlacesUI.imported();
      aimFillSelects();document.getElementById('aimTarget').value=window.innerWidth===320?'':'fuji';
      navigationHistory.pushRoute('#/records');
     });
     const snapshot=()=>page.evaluate(()=>JSON.stringify({records:MyPlacesUI.load(),place:favorites.find(p=>p.id==='manage-observer'),plan:document.getElementById('aimTarget').value,map:document.getElementById('skyMapTarget').value}));
     const before=await snapshot();
     const tabs=page.getByRole('tablist',{name:'記録の表示'}),targetTab=tabs.getByRole('tab',{name:'対象',exact:true});
     assert.deepEqual(await tabs.getByRole('tab').allTextContents(),['撮影地点','対象','重なる日','予定']);
     assert(await page.getByRole('button',{name:'記録を追加',exact:true}).isVisible());
     assert(!(await page.getByRole('button',{name:'対象を管理',exact:true}).isVisible()));
     await tabs.getByRole('tab',{name:'撮影地点',exact:true}).press('ArrowRight');
     await page.waitForFunction(()=>document.activeElement.id==='notebookTargetsTab');
     const list=page.getByRole('tabpanel',{name:'対象',exact:true});
     await list.getByText('登録した対象はまだありません。',{exact:true}).waitFor();
     assert.equal(await list.locator('[data-target-key], [data-target-edit]').count(),0);
     assert(!(await list.getByRole('button',{name:'選択を適用',exact:true}).isVisible()));
     for(const name of ['重なる日','予定']){
      await tabs.getByRole('tab',{name,exact:true}).click();
      assert(await page.getByRole('tabpanel',{name,exact:true}).isVisible());
     }
     await targetTab.click();
     const add=list.getByRole('button',{name:'対象を登録',exact:true});
     const dialog=page.locator('#previewTargetDialog[open]');
     await add.click();
     await dialog.waitFor();
     const map=dialog.locator('.target-editor-map');
     assert(await map.isVisible());
     assert.equal(await map.locator('.sky-map-expand').count(),0);
     const controls=await map.evaluate(e=>{
      const r=e.getBoundingClientRect(),rect=s=>e.querySelector(s).getBoundingClientRect();
      return {inline:!e.classList.contains('sky-map-wide')&&r.height>=200&&r.height<=300&&r.left>0,
       visible:rect('.map-layers-btn').height>=44&&rect('.mapzoom').top>=rect('.map-layers-btn').bottom};
     });
     assert(controls.inline&&controls.visible,JSON.stringify(controls));
     await map.locator('canvas').tap({position:{x:75,y:65}});
     assert(await dialog.locator('#targetPlaceSearch').isVisible());
     assert(!await map.evaluate(e=>e.classList.contains('sky-map-wide')));
     await dialog.locator('#targetPlaceSearch').fill('35.65, 139.63');
     await dialog.locator('#targetPlaceSearchGo').click();
     const found=dialog.locator('#targetPlaceResults [data-sr]');
     if(await found.count())await found.first().click();
     await page.waitForFunction(()=>document.querySelector('[data-target-coordinate]').textContent.includes('35.65000'));
     const name=dialog.locator('[data-target-name]'),height=dialog.locator('[data-target-height]');
     await name.fill('記録で追加した対象');
     await height.fill('22');
     await dialog.locator('[data-target-add]').click();
     const edit=list.getByRole('button',{name:'記録で追加した対象を編集',exact:true});
     await edit.waitFor();
     await page.waitForFunction(()=>document.activeElement?.dataset.targetEdit?.startsWith('fav:'));
     const added=await page.evaluate(()=>favorites.find(f=>f.name==='記録で追加した対象'));
     assert(added.id.startsWith('target-'));
     assert.equal(added.targetHeightM,22);
     assert.equal(await snapshot(),before);
     await edit.click();
     await name.fill('取り消す名前');
     page.once('dialog',d=>d.accept());
     await dialog.getByRole('button',{name:'対象一覧に戻る',exact:true}).click();
     await edit.waitFor();
     assert.equal(await page.evaluate(id=>favorites.find(f=>f.id===id).name,added.id),added.name);
     await list.getByRole('button',{name:'カテゴリを編集',exact:true}).click();
     await dialog.locator('[data-target-cat-new]').fill('撮りたい橋');
     await dialog.locator('[data-target-cat-add]').click();
     await dialog.getByRole('button',{name:'完了',exact:true}).click();
     await edit.click();
     await name.fill('記録から編集した対象');
     await height.fill('28');
     await dialog.locator('[data-target-category]').selectOption('撮りたい橋');
     await dialog.getByRole('button',{name:'変更を保存',exact:true}).click();
     const changed=list.getByRole('button',{name:'記録から編集した対象を編集',exact:true});
     await changed.waitFor();
     const after=await page.evaluate(id=>({live:favorites.find(f=>f.id===id),stored:store.get('sorami.favorites',[]).find(f=>f.id===id)}),added.id);
     assert.equal(after.live.name,'記録から編集した対象');
     assert.equal(after.live.targetHeightM,28);
     assert.equal(after.live.targetCategory,'撮りたい橋');
     assert.deepEqual(after.live,after.stored);
     assert.equal(await snapshot(),before);
     const search=list.getByRole('searchbox',{name:'対象を検索'});
     await search.fill('対象なしxyz');
     await list.getByText('見つかりませんでした。',{exact:true}).waitFor();
     assert(await add.isVisible());
     await search.fill('');
     await list.getByRole('button',{name:'撮りたい橋',exact:true}).click();
     await changed.waitFor();
     await page.screenshot({path:out+'/management-'+engine+'-'+width+'.png'});
     await list.getByRole('searchbox',{name:'対象を検索'}).fill('');
     await targetTab.press('ArrowLeft');
     await page.waitForFunction(()=>document.activeElement.id==='notebookPointsTab');
     assert(await page.getByRole('tabpanel',{name:'撮影地点',exact:true}).isVisible());
     await targetTab.click();
     await changed.waitFor();
     await changed.click();
     await dialog.waitFor();
     await page.evaluate(()=>{auth={...auth,tools:[]};AstroTargetPicker.authChanged();MyPlacesUI.renderRecordsHub();});
     await dialog.waitFor({state:'hidden'});
     assert(!(await changed.isVisible()));
     if(width===390){
      await page.evaluate(grants=>{
       auth={...auth,tools:grants.filter(tool=>tool!=='skymap')};renderTools();navigationHistory.pushRoute('#/aim/tower');
      },grants);
      await page.locator('#previewTargetOpen').click();
      await dialog.locator('[data-target-key]').filter({hasText:'記録から編集した対象'}).waitFor();
      await dialog.getByRole('button',{name:'戻る',exact:true}).click();
     }
     assert.deepEqual(errors,[]);
     console.log(JSON.stringify({engine,width,recordManagement:true,empty:true,registration:true,editCancel:true,sameId:true,category:true,recordAndPlanUnchanged:true,focusRestored:true,permissionLoss:true,visibleInFramingPicker:width===390}));
    }finally{await context.close();}
   }
  }finally{await browser.close();}
 }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
