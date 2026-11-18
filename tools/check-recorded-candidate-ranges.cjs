const assert=require('node:assert/strict');
module.exports=async function checkRecordedRanges(page,path){
 await page.evaluate(()=>{
  window.rangeFixture={points:MyPlacesUI.discoveryPoints,solver:AstroNotesShooting.candidates,calls:0};
  const make=(source,kind,minute,id,from,to,offset=0)=>{
   const at=AstroNotesShooting.day(SkyMapUI.selectionState().at)+minute*60000,place={id:source,sourcePlaceId:source,name:source==='area'?'範囲の公園':'線の公園',subtitle:'東京都新宿区四谷本塩町',latitude:35.692+offset,longitude:139.732,elevation:25,groundManualM:25,eyeHeightAGL:1.5};
   return {place,record:{result:'seen'},assumedObserver:{...place,eyeM:1.5},placeKind:'park',event:{at,radius:.25,targetAltitude:6,altitude:6.2,azimuth:180,targetAzimuth:180,targetPosition:{x:.5,y:.8},side:'set'},
    ...(kind?{shapeType:kind,spatialWindow:{id,kind,fromAt:AstroNotesShooting.day(at)+from*60000,toAt:AstroNotesShooting.day(at)+to*60000,count:4,basis:'sampled-positions'}}:{})};
  };
  window.rangeRows=[make('line','line',13*60+17,'one',13*60+13,14*60+21),make('line','line',13*60+13,'one',13*60+13,14*60+21),make('line','line',14*60+21,'one',13*60+13,14*60+21),
   make('line','line',16*60,'two',16*60,16*60+4),make('line','line',16*60+4,'two',16*60,16*60+4),make('area','area',13*60,'area',13*60,13*60+15),make('area','area',13*60+15,'area',13*60,13*60+15),make('different',null,14*60,null,null,null,.02)];
  MyPlacesUI.discoveryPoints=()=>['line','area','different'].map(id=>({place:{id,name:id,latitude:35.692,longitude:139.732,elevation:25,eyeHeightAGL:1.5},record:{result:'seen'}}));
  AstroNotesShooting.candidates=async(plan,points)=>{rangeFixture.calls++;return {failed:0,rows:rangeRows.filter(row=>row.place.sourcePlaceId===points[0].place.id)};};
  MyPlacesUI.imported();
 });
 try{
  await page.locator('#exploreDiscovery-records').click();
  await page.waitForFunction(()=>document.getElementById('exploreRecordedPlaces').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#exploreRecordedResults>.list-item').length===4);
  assert.equal(await page.locator('#exploreDiscovery-records').innerText(),'記録');assert.equal(await page.locator('#exploreDiscovery-new').innerText(),'新規');
  assert.equal(await page.locator('#exploreDiscovery-records').getAttribute('aria-label'),'記録の撮影地点');
  const rows=page.locator('#exploreRecordedResults>.list-item'),times=await rows.locator('[data-candidate-time]').allTextContents();
  assert.deepEqual(times,['13:00〜13:15','13:13〜14:21','14:00','16:00〜16:04']);
  assert.equal(await rows.locator('[data-candidate-address]').count(),4);assert.equal(await rows.locator('[data-candidate-angle]').count(),4);assert.equal(await rows.locator('[data-candidate-passage]').count(),4);
  assert((await rows.nth(0).innerText()).includes('範囲内で移動'));assert((await rows.nth(1).innerText()).includes('線上で移動'));
  assert(!(await rows.nth(2).innerText()).includes('で移動'));assert.equal(await rows.nth(1).locator('[data-candidate-place]').innerText(),'線の公園');
  const layout=await rows.evaluateAll(ns=>({overflow:document.documentElement.scrollWidth>innerWidth+1,rows:ns.map(n=>({h:n.getBoundingClientRect().height,columns:getComputedStyle(n).gridTemplateColumns}))}));
  assert(!layout.overflow&&layout.rows.every(r=>r.h>=44),JSON.stringify(layout));
  await page.screenshot({path:path+'-recorded-ranges.png',fullPage:true});
  await page.locator('.candidate-record-heading').evaluate(n=>n.scrollIntoView({block:'start'}));await page.screenshot({path:path+'-recorded-ranges-viewport.png'});
  const clearance=await page.evaluate(()=>{scrollTo(0,document.scrollingElement.scrollHeight);const row=document.querySelector('#exploreRecordedResults>.list-item:last-child'),footer=document.querySelector('.sky-map-footer');return row.getBoundingClientRect().bottom<=footer.getBoundingClientRect().top+1;});assert(clearance,'the footer must not cover the last recorded candidate');
  const calls=await page.evaluate(()=>rangeFixture.calls),expected=await page.evaluate(()=>rangeRows[1]);
  await rows.nth(1).click();await page.waitForFunction(()=>document.getElementById('skyMapView').dataset.exploreStage==='preview');
  const selected=await page.evaluate(()=>{const s=SkyMapUI.selectionState();return {at:s.at,latitude:s.observer.latitude,eye:aimObserverAt(s.observer,SkyMapUI.workspaceHost().session.ground).eyeM};});
  assert.deepEqual(selected,{at:expected.event.at,latitude:expected.place.latitude,eye:1.5});
  await page.locator('#exploreBackToCandidates').click();await page.waitForFunction(()=>document.querySelectorAll('#exploreRecordedResults>.list-item').length===4);
  assert.equal(await page.evaluate(()=>rangeFixture.calls),calls,'returning reuses the result and does not solve the shape again');
  return {rows:4,lineRange:true,areaRange:true,disjointTimeKept:true,sameNameDistinctSourceKept:true,sharedFormat:true,realStartSelected:true,returnReused:true};
 }finally{await page.evaluate(()=>{MyPlacesUI.discoveryPoints=rangeFixture.points;AstroNotesShooting.candidates=rangeFixture.solver;MyPlacesUI.imported();});}
};
