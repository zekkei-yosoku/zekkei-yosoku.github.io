const assert=require('node:assert/strict');
const {openExploreSheet}=require('./explore-open-conditions.cjs');
async function recordsTabRetired(page){
 await page.waitForFunction(()=>!!document.getElementById('exploreDiscovery-new'));
 const state=await page.evaluate(()=>{const tab=document.getElementById('exploreDiscovery-records');return {retired:!tab||tab.hidden,trial:/\/trial\//.test(location.pathname)};});
 // trial は記録タブを廃止した版。誤って復活したら旧経路で黙って通らないようにする
 if(state.trial)assert(state.retired,'trial では記録タブを廃止している');
 return state.retired;
}
async function revealOpportunityEntry(page){
 const sheet=page.locator('#skyMapView[data-explore-sheet]');
 if(await sheet.isVisible())await page.locator('#exploreBackToMap').click();
 const toggle=page.locator('#mapWsCenterToggle');
 await toggle.waitFor({state:'visible'});
 if(await toggle.getAttribute('data-center')!=='target')await toggle.click();
 const entry=page.locator('#mapWsCardSecond[data-action="list"]');
 await entry.waitFor({state:'visible'});
 return entry;
}
async function assertOpportunityEntry(page){
 const sheet=await page.locator('#skyMapView[data-explore-sheet]').isVisible();
 const toggle=page.locator('#mapWsCenterToggle');
 const center=await toggle.getAttribute('data-center');
 const button=await revealOpportunityEntry(page);
 const entry=await button.evaluate(node=>({
  text:node.getAttribute('aria-label'), label:node.innerText, height:node.getBoundingClientRect().height
 }));
 assert(entry.height>=44&&entry.label==='重なる日'&&/記録の地点の重なる日/.test(entry.text),JSON.stringify(entry));
 if(center==='obs'&&await toggle.isEnabled())await toggle.click();
 if(sheet)await openExploreSheet(page);
 return entry;
}
module.exports={recordsTabRetired,assertOpportunityEntry,revealOpportunityEntry};
