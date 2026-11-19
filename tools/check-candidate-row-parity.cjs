// One solved input through both real UI entries. No storage writes, extra ephemeris
// calls, or assumed equality between geometric and refracted calculations.
const assert=require('node:assert/strict');
module.exports=async function checkParity(page,ready,path){
 const choose=require('./choose-record-opportunity-filter.cjs');
 await choose(page,'Target','skytree');await ready(page);await choose(page,'Body','moon');await ready(page);
 await page.evaluate(()=>{
  const frame=document.querySelector('iframe[src^="overlap-calculation.html"]').contentWindow;
  window.parityFixture={frame,solver:frame.AstroNotesShooting.candidates,points:MyPlacesUI.discoveryPoints,search:MyPlacesUI.discoverySearch,calls:0};
  window.parityRows=(at,place,record)=>{
   const start=AstroNotesShooting.day(at),base={...place,name:place.name,subtitle:'東京都文京区本郷一丁目',latitude:35.70725,longitude:139.75701,eyeHeightAGL:1.5,standAglM:1.5};
   const make=(minute,kind,id,from,to,eye=1.5)=>({place:{...base,sourcePlaceId:place.id,latitude:base.latitude+minute*.000001,eyeHeightAGL:eye,standAglM:eye},record,placeKind:'park',assumedObserver:{eyeM:eye},
    event:{at:start+minute*60000,radius:.25,altitude:7,targetAltitude:7,azimuth:100,targetAzimuth:100,targetPosition:{x:.5,y:.5},side:'rise',partId:'__whole',limb:'center',matchMode:'overlap'},
    ...(kind?{shapeType:kind,spatialWindow:{id,kind,fromAt:start+from*60000,toAt:start+to*60000,count:2,basis:'sampled-positions'}}:{})});
   return [make(60,'line','line-run',60,70),make(70,'line','line-run',60,70),make(120,'area','area-run',120,130),make(130,'area','area-run',120,130),make(180,null,null),make(240,'line','separate',240,245),make(245,'line','separate',240,245),make(60,'line','line-run',60,70,10)];
  };
  frame.AstroNotesShooting.candidates=async(plan,entries)=>{parityFixture.calls++;return {failed:0,rows:parityRows(plan.at,entries[0].place,entries[0].record)};};
 });
 try{
  await page.locator('#recordOpportunityDate').fill('2028-03-02');await ready(page);
  const firstDay=await page.locator('#recordOpportunityDate').inputValue(),clock=await page.locator('#recordOpportunityList [data-opportunity-id]').first().getAttribute('data-opportunity-id');
  const dayAt=JSON.parse(clock)[1],before=await page.evaluate(()=>parityFixture.calls);
  const read=selector=>page.locator(selector).evaluateAll(ns=>ns.map(n=>Object.fromEntries(['place','time','address','angle','passage','spatial'].map(k=>[k,n.querySelector('[data-candidate-'+k+']')?.textContent||'']))));
  const notes=(await read('#recordOpportunityList [data-opportunity-id]')).slice(0,5);
  assert.equal(notes.length,5);assert.deepEqual(notes.map(r=>r.time),['01:00〜01:10','01:00〜01:10','02:00〜02:10','03:00','04:00〜04:05']);
  assert(notes.some(r=>r.spatial.includes('線上で移動')));assert(notes.some(r=>r.spatial.includes('範囲内で移動')));assert(notes.every(r=>r.passage==='全体の中央付近を通過'));
  await page.screenshot({path:path+'-notes.png',fullPage:true});
  // Re-rendering a completed list retains the actual focused row and never solves again.
  const first=page.locator('#recordOpportunityList [data-opportunity-id]').first();await first.evaluate(n=>{window.parityButton=n;n.focus();});
  await page.evaluate(()=>MyPlacesUI.opportunities.render());await ready(page);
  assert(await first.evaluate(n=>n===parityButton&&n===document.activeElement));assert.equal(await page.evaluate(()=>parityFixture.calls),before);
  await first.click();await page.waitForFunction(()=>document.getElementById('skyMapView').dataset.exploreStage==='preview');
  await page.locator('#exploreCandidatePositions').waitFor({state:'visible'});
  assert.equal(await page.locator('#exploreCandidatePosition optgroup[label="すべての撮影位置"] option').count(),2);
  await page.locator('#exploreBackToCandidates').click();await ready(page);assert.equal(await page.locator('#recordOpportunityDate').inputValue(),firstDay);
  // The Explore entry consumes the exact same solved rows, including separate heights/runs.
  await page.evaluate(at=>{
   const f=favorites.find(f=>f.id==='p1'),record=MyPlacesUI.load().find(r=>r.placeId===f.id&&r.target.key==='skytree');
   parityFixture.rows=parityRows(at,f,record);
   MyPlacesUI.discoveryPoints=()=>[{place:f,record}];MyPlacesUI.discoverySearch=async()=>({failed:0,rows:parityFixture.rows});
   navigationHistory.pushRoute('#/explore');
  },dayAt);
  await page.waitForFunction(()=>globalThis.TrialExplore?.active());
  await page.evaluate(at=>{SkyMapUI.setTarget('skytree');const b=document.getElementById('skyMapBody');b.value='moon';b.dispatchEvent(new Event('change',{bubbles:true}));SkyMapUI.setAlignment('__whole','center','overlap');SkyMapUI.setTime(at);TrialExplore.render();},dayAt);
  await page.locator('#exploreDiscovery-records').click();
  await page.waitForFunction(()=>document.getElementById('exploreRecordedPlaces').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#exploreRecordedResults .candidate-record-row').length===5);
  const explore=await read('#exploreRecordedResults .candidate-record-row');assert.deepEqual(explore,notes);
  assert.equal(await page.evaluate(()=>parityFixture.calls),before,'NOTES redraw and route restoration reuse its solved fixture rows');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path+'-explore.png',fullPage:true});
  await page.evaluate(()=>navigationHistory.pushRoute('#/records'));await ready(page);
  assert(await page.locator('#recordOpportunityList [data-opportunity-id]').count()>0);
  return {sharedFields:true,lineAndAreaRanges:true,separateRuns:true,separateHeights:true,point:true,notesPositionChoices:true,return:true,stableButton:true,noExtraSolve:true};
 }finally{await page.evaluate(()=>{parityFixture.frame.AstroNotesShooting.candidates=parityFixture.solver;MyPlacesUI.discoveryPoints=parityFixture.points;MyPlacesUI.discoverySearch=parityFixture.search;});}
};
