// Isolated real-browser presentation checks; map port is instrumented, no app/API traffic.
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 for(const [name,type]of [['chrome',chromium],['webkit',webkit]]){
  const browser=await type.launch(name==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{
   const page=await browser.newPage({viewport:{width:name==='chrome'?390:320,height:844},colorScheme:name==='chrome'?'light':'dark'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.setContent('<style>body{font:16px sans-serif}.mapzoom{position:absolute;right:5px;bottom:5px}button,select{box-sizing:border-box}dialog{width:calc(100% - 40px);max-height:90vh;overflow:auto}.list-item{width:100%}</style><dialog open id="placeSheet"><div id="recentCandidates" role="tabpanel"><div id="registered"></div><div id="additionalCandidateResults"></div></div></dialog>');
   await page.addScriptTag({path:path.resolve(__dirname,'../experiments/candidate-visibility/candidate-picker.js')});
   await page.evaluate(async()=>{
    window.live={registered:true,additional:true};window.picks=[];window.labelCalls=0;window.mapCalls={create:0,open:0};
    const start=Date.parse('2026-11-05T00:00:00+09:00');window.testPlan={body:'moon',target:{id:'custom',name:'任意の建物',latitude:35.72,longitude:139.78},at:start,owner:'fixture'};
    window.AstroNotesCandidateDiscovery={day:t=>Math.floor((t+32400000)/86400000)*86400000-32400000};
    window.AstroNotesBodies={ensure:async()=>{}};window.AstroNotesCandidateComposition={windowEvents:()=>[{at:start+12*3600000,kind:'rise'},{at:start+18*3600000,kind:'set'}]};
    const mapFactory=ids=>{mapCalls.create++;const cv=document.getElementById(ids.canvas);let overlay;const project=(lat,lon)=>[(lon-139.70)*2000+30,180-(lat-35.68)*2000];const api={setOverlay:f=>overlay=f,onPick:f=>window.mapPick=f,open:()=>{mapCalls.open++;api.redraw();},redraw:()=>{cv.width=cv.clientWidth;cv.height=cv.clientHeight;if(overlay)overlay(cv.getContext('2d'),{project,width:cv.clientWidth,height:cv.clientHeight});},project};return api;};
    AstroNotesCandidatePicker.configure(async()=>{labelCalls++;return {facilities:{features:[]}};});AstroNotesCandidatePicker.configure({createMapView:mapFactory});
    const row=(name,kind,photo,hour,lat,height=20,eye=2)=>({place:{name,id:name,latitude:lat,longitude:139.73,elevation:height,eyeHeightAGL:eye,decks:[]},placeKind:kind,quality:{photographyClass:photo},rank:kind==='park'?99:0,event:{at:start+hour*3600000},assumedObserver:{latitude:lat,longitude:139.73,elevation:height,eyeM:eye}});
    window.registeredRows=[row('登録歩道','road','normal',12.1,35.68),row('記録だけの公園','park','unknown',12.2,35.69)];window.additionalRows=[row('新規公園','park','normal',12.3,35.70,25,4),row('条件付き広場','plaza','conditional',18,35.71)];
    additionalRows[0].quality.visibility='unknown';additionalRows[0].frame={status:'unknown'};
    window.before=JSON.stringify([registeredRows,additionalRows]);
    const render=(id,rows)=>{const box=document.getElementById(id);for(const r of rows){const b=document.createElement('button');b.className='list-item';b.textContent=r.place.name;b.onclick=()=>{if(live[id==='registered'?'registered':'additional'])picks.push(structuredClone(r));};box.append(b);}return box;};
    // An immediate registered result may precede the adapter's frame-based mount.
    await AstroNotesCandidatePicker.registerRegistered(render('registered',registeredRows),registeredRows,testPlan,()=>live.registered);
    AstroNotesCandidatePicker.mount(document.getElementById('recentCandidates'),testPlan);
    await AstroNotesCandidatePicker.registerAdditional(render('additionalCandidateResults',additionalRows),additionalRows,testPlan,()=>live.additional);
   });
   const rows=page.locator('#candidateUnifiedResults .list-item:visible'),names=()=>rows.evaluateAll(ns=>ns.map(n=>n.children[0].textContent));
   // 2026-11-11 ユーザー「並びのデフォルトを時刻順で」「列を1つ足す」: the list opens in time order with an angle column; おすすめ順 is one tap away.
   assert.deepEqual(await names(),['登録歩道','記録だけの公園','新規公園','条件付き広場']);
   assert.deepEqual(await page.locator('[data-candidate-sort]').evaluateAll(ns=>ns.map(n=>n.dataset.label)),['地点','時刻','種類','角度']);
   assert.equal(await rows.filter({hasText:'新規公園'}).locator('[data-candidate-uncertainty]').innerText(),'見通し未確認 ・ 全体の画角未確認');assert.equal(await rows.filter({hasText:'登録歩道'}).locator('[data-candidate-uncertainty]').count(),0);
   await page.locator('[data-candidate-recommended]').click();assert.deepEqual(await names(),['新規公園','登録歩道','条件付き広場','記録だけの公園']);
   await page.locator('[data-candidate-sort=time]').click();assert.deepEqual(await names(),['登録歩道','記録だけの公園','新規公園','条件付き広場']);
   await page.locator('[data-candidate-sort=time]').click();assert.equal((await names())[0],'条件付き広場');
   await page.locator('[data-candidate-recommended]').click();assert.equal((await names())[0],'新規公園');
   await page.locator('#candidateKindFilter').selectOption('park');await page.waitForFunction(()=>document.querySelector('[data-filter-status]').textContent.startsWith('2 / 4'));assert.deepEqual(await names(),['新規公園','記録だけの公園']);
   await page.locator('#candidateKindFilter').selectOption('all');await page.waitForFunction(()=>document.querySelector('[data-filter-status]').textContent.startsWith('4 / 4'));
   const loadCount=await page.evaluate(()=>labelCalls);const scrollBefore=await page.evaluate(()=>{const panel=document.getElementById('recentCandidates');panel.style.maxHeight='400px';panel.style.overflowY='auto';panel.scrollTop=60;return panel.scrollTop;});await page.locator('#candidateMapToggle').click();assert.equal(await page.locator('#candidateMapPanel').isVisible(),true);assert.equal(await page.locator('#candidateUnifiedResults').isVisible(),false);
   assert.equal(await page.locator('#candidateMapChoice option').count(),4);assert((await page.locator('#candidateMapDetail').innerText()).includes('29.0m'));assert.equal(await page.evaluate(()=>picks.length),0);assert.equal(await page.evaluate(()=>labelCalls),loadCount);
   assert((await page.locator('#candidateMapDetail').innerText()).includes('見通し未確認 ・ 全体の画角未確認'));
   const expected=await page.evaluate(()=>additionalRows[0]);await page.locator('#candidateMapUse').click();assert.deepEqual(await page.evaluate(()=>picks[0]),expected);
   await page.locator('#candidateMapToggle').click();await page.waitForFunction(top=>document.getElementById('recentCandidates').scrollTop===top,scrollBefore);assert.deepEqual(await names(),['新規公園','登録歩道','条件付き広場','記録だけの公園']);
   await page.locator('#candidateMapToggle').click();assert.equal(await page.evaluate(()=>mapCalls.create),1);
   await page.evaluate(()=>live.additional=false);await page.locator('#candidateMapUse').click();assert.equal(await page.evaluate(()=>picks.length),1);assert((await page.locator('#candidateMapDetail').innerText()).includes('条件が変わりました'));
   await page.evaluate(()=>AstroNotesCandidatePicker.apply());await page.waitForFunction(()=>document.querySelector('[data-filter-status]').textContent.startsWith('2 / 2'));assert.equal(await page.locator('#candidateMapChoice option').count(),2);
   await page.locator('#candidateMapToggle').click();await page.locator('#candidateTimeFilter').selectOption('set');await page.waitForFunction(()=>document.querySelector('[data-filter-status]').textContent.startsWith('0 / 2'));assert.equal(await rows.count(),0);assert.equal(await page.locator('#candidateMapToggle').isDisabled(),true);
   await page.locator('#candidateTimeFilter').selectOption('all');await page.waitForFunction(()=>document.querySelector('[data-filter-status]').textContent.startsWith('2 / 2'));
   assert.equal(await page.evaluate(()=>JSON.stringify([registeredRows,additionalRows])===before),true);
   await page.evaluate(()=>AstroNotesCandidatePicker.unregister(document.getElementById('registered')));await page.waitForFunction(()=>document.querySelectorAll('#candidateUnifiedResults .list-item').length===0);assert.equal(await rows.count(),0);
   assert.deepEqual(errors,[]);console.log(name+': unified ranking, sort, filter, map, exact selection, stale generation, data immutability passed');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
