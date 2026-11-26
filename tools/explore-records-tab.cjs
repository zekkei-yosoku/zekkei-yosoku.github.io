// 2026-11-26 trial（段階③）: 探すの記録タブは廃止し、記録の地点は「重なる日」を今の条件で絞って開く。
// 記録タブを確かめる既存検査は、記録タブがある版（本番）では従来どおり、廃止した版（trial）では
// 代わりの入口「記録の地点の重なる日」が撮影地点を探すにあることを確かめる。どちらで通ったかは検査が出力する。
const assert=require('node:assert/strict');
async function recordsTabRetired(page){
 await page.waitForFunction(()=>!!document.getElementById('exploreDiscovery-new'));
 const state=await page.evaluate(()=>{const tab=document.getElementById('exploreDiscovery-records');return {retired:!tab||tab.hidden,trial:/\/trial\//.test(location.pathname)};});
 // trial は記録タブを廃止した版。誤って復活したら旧経路で黙って通らないようにする
 if(state.trial)assert(state.retired,'trial では記録タブを廃止している');
 return state.retired;
}
async function assertOpportunityEntry(page){
 const entry=await page.evaluate(()=>{const link=document.getElementById('exploreOpportunityLink'),r=link?.getBoundingClientRect();
  return {visible:!!link?.offsetParent,height:r?.height||0,text:link?.textContent||'',recordsPane:document.getElementById('exploreRecordedPlaces')?.hidden!==false,newSelected:document.getElementById('exploreDiscovery-new')?.getAttribute('aria-selected')};});
 assert(entry.visible&&entry.height>=44&&/記録の地点の重なる日/.test(entry.text)&&entry.recordsPane&&entry.newSelected==='true','記録タブの代わりに重なる日の入口がある '+JSON.stringify(entry));
 return entry;
}
module.exports={recordsTabRetired,assertOpportunityEntry};
