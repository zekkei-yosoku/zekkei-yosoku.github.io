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
   const target=AstroNotesAlign.TARGETS.find(t=>t.id==='skytree');
   const make=(minute,kind,id,from,to,eye=1.5)=>{const observer={...base,elevation:base.elevation??20,sourcePlaceId:place.id,latitude:base.latitude+minute*.000001,eyeHeightAGL:eye,standAglM:eye};
    const azimuth=AstroNotesAlign.geometryFrom(observer,target,{partId:'tip'}).azimuth;
    return {place:observer,record,placeKind:'park',assumedObserver:{eyeM:eye},
    event:{at:start+minute*60000,radius:.25,altitude:7,targetAltitude:7,azimuth,targetAzimuth:azimuth,targetPosition:{x:.5,y:.5},side:'rise',partId:'__whole',limb:'center',matchMode:'overlap'},
    ...(kind?{shapeType:kind,spatialWindow:{id,kind,fromAt:start+from*60000,toAt:start+to*60000,count:2,basis:'sampled-positions'}}:{})};};
   return [make(60,'line','line-run',60,70),make(70,'line','line-run',60,70),make(120,'area','area-run',120,130),make(130,'area','area-run',120,130),make(180,null,null),make(240,'line','separate',240,245),make(245,'line','separate',240,245),make(60,'line','line-run',60,70,10)];
  };
  frame.AstroNotesShooting.candidates=async(plan,entries)=>{parityFixture.calls++;return {failed:0,rows:parityRows(plan.at,entries[0].place,entries[0].record)};};
 });
 try{
  await page.locator('#recordOpportunityDate').fill('2028-03-02');await ready(page);
  const firstDay=await page.locator('#recordOpportunityDate').inputValue(),clock=await page.locator('#recordOpportunityList [data-opportunity-id]').first().getAttribute('data-opportunity-id');
  const dayAt=JSON.parse(clock)[1],before=await page.evaluate(()=>parityFixture.calls);
  const read=selector=>page.locator(selector).evaluateAll(ns=>ns.map(n=>({...Object.fromEntries(['place','time','address','angle','passage','spatial'].map(k=>[k,n.querySelector('[data-candidate-'+k+']')?.textContent||''])),kind:n.querySelector('[data-place-kind]')?.textContent||'',angleGlyph:n.querySelector('[data-angle-icon] svg')?.dataset.pictogram||'',angleHidden:n.querySelector('[data-candidate-angle]')?.hidden})));
  // 2026-11-25 全地点の一覧では同じ時刻に別の地点の行も並ぶ。1地点の行で比べる
  const notes=(await read('#recordOpportunityList [data-opportunity-id]')).filter(r=>r.place==='鷺沼北公園').slice(0,5);
  assert.equal(notes.length,5);assert.deepEqual(notes.map(r=>r.time),['01:00〜01:10','01:00〜01:10','02:00〜02:10','03:00','04:00〜04:05']);
  assert(notes.some(r=>r.spatial.includes('線上で移動')));assert(notes.some(r=>r.spatial.includes('範囲内で移動')));assert(notes.every(r=>r.passage==='先端付近を通過'));
  assert(notes.every(r=>r.angleGlyph==='angle-up'&&!r.angleHidden));
  await page.screenshot({path:path+'-notes.png',fullPage:true});
  // Re-rendering a completed list retains the actual focused row and never solves again.
  const first=page.locator('#recordOpportunityList [data-opportunity-id]').first();await first.evaluate(n=>{window.parityButton=n;parityFixture.angleSvg=n.querySelector('[data-angle-icon] svg');parityFixture.angleText=n.querySelector('[data-angle-label]');n.focus();});
  await page.evaluate(()=>MyPlacesUI.opportunities.render());await ready(page);
  assert(await first.evaluate(n=>n===parityButton&&n===document.activeElement));assert.equal(await page.evaluate(()=>parityFixture.calls),before);
  assert(await first.evaluate(n=>n.querySelector('[data-angle-icon] svg')===parityFixture.angleSvg&&n.querySelector('[data-angle-label]')===parityFixture.angleText));
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
  // 2026-11-26 trial（段階③）: 探すの記録タブは廃止。記録の地点は重なる日（上の NOTES の行）だけで見るので、行の照合は記録タブがある版だけ。
  const {recordsTabRetired,assertOpportunityEntry}=require('./explore-records-tab.cjs');
  await require('./explore-open-conditions.cjs').openExploreSheet(page);
  let retired=false;
  if(await recordsTabRetired(page)){retired=true;await assertOpportunityEntry(page);}else{
  await page.locator('#exploreDiscovery-records').click();
  await page.waitForFunction(()=>document.getElementById('exploreRecordedPlaces').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#exploreRecordedResults .candidate-record-row').length===5);
  const explore=await read('#exploreRecordedResults .candidate-record-row');assert.deepEqual(explore,notes);
  assert.equal(await page.evaluate(()=>parityFixture.calls),before,'NOTES redraw and route restoration reuse its solved fixture rows');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path+'-explore.png',fullPage:true});}
  await page.evaluate(()=>navigationHistory.pushRoute('#/records'));await ready(page);
  assert(await page.locator('#recordOpportunityList [data-opportunity-id]').count()>0);
  return {exploreRecordsTab:retired?'retired':'parity',sharedFields:true,angleGlyphs:true,stableAngleDom:true,lineAndAreaRanges:true,separateRuns:true,separateHeights:true,point:true,notesPositionChoices:true,return:true,stableButton:true,noExtraSolve:true};
 }finally{await page.evaluate(()=>{parityFixture.frame.AstroNotesShooting.candidates=parityFixture.solver;MyPlacesUI.discoveryPoints=parityFixture.points;MyPlacesUI.discoverySearch=parityFixture.search;});}
};
