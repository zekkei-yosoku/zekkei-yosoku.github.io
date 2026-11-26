// 2026-11-26 trial（段階③b）: 重なる日の2段の計算。軌道で拾った行を、表示前に大気込みの判定（discoverySearch）でその日を
// 確かめる。確かめる前は「（確認中）」、重なれば確定、外れたら消す。軌道の行の前後の日も同じ判定で確かめて足す。
// 実際の判定（大気込みでは11/26の月×スカイツリーは重ならない。見え方の重なる日時も11/25だけ）と、判定を差し替えた
// 決定的な場合（確認中→確定、外れて消える、前後の日の追加）を確かめる。終わったら絞り込みを元に戻す。
const assert=require('node:assert/strict'),choose=require('./choose-record-opportunity-filter.cjs');
const DAY=86400000,dayOf=id=>new Date(JSON.parse(id)[1]+32400000).toISOString().slice(0,10);
module.exports=async(page,ready,path)=>{
 const filter=async kind=>{const n=page.locator('#recordOpportunity'+kind);return (await n.innerText())==='すべて'?'all':JSON.parse(await n.getAttribute('data-values'));};
 const before={body:await filter('Body'),target:await filter('Target'),date:await page.locator('#recordOpportunityDate').inputValue()};
 const ids=()=>page.locator('[data-opportunity-id]').evaluateAll(ns=>ns.map(n=>n.dataset.opportunityId));
 const text=()=>page.locator('#recordOpportunityList').innerText();
 const settled=async()=>{await ready(page);await page.waitForFunction(()=>!/（確認中）/.test(document.getElementById('recordOpportunityList')?.innerText||'')&&document.getElementById('recordOpportunities').getAttribute('aria-busy')==='false',null,{timeout:120000});};
 const rerun=async()=>{await page.evaluate(()=>MyPlacesUI.imported());await settled();};
 await choose(page,'Body','moon');await ready(page);await choose(page,'Target','skytree');await ready(page);
 if(before.date!=='2026-11-25'){await page.locator('#recordOpportunityDate').fill('2026-11-25');await ready(page);}
 assert.match(await page.locator('#recordOpportunityModelNotice').innerText(),/大気差込みで確かめてから確定/);
 const geometric=await ids(),geoDays=[...new Set(geometric.map(dayOf))];
 assert(geoDays.includes('2026-11-25')&&geoDays.includes('2026-11-26'),'軌道の行（11/25・11/26） '+JSON.stringify(geoDays));
 // 実際の判定
 await page.evaluate(()=>{globalThis.AstroNotesOpportunityAir='on';});await rerun();
 const real=await ids(),realDays=new Set(real.map(dayOf));
 assert(realDays.has('2026-11-25'),'大気込みでも重なる11/25は残る');assert(!realDays.has('2026-11-26'),'大気込みで外れる11/26は消える');
 await page.screenshot({path:path+'-air-real.png',fullPage:true});
 // 判定を差し替える: 11/25は遅らせて確定、11/26は外れ、11/27は11/25の結果を2日ずらして重なる（前後の日の追加）、他の日は重ならない
 await page.evaluate(()=>{const original=MyPlacesUI.discoverySearch;window.__airOriginal=original;let open;window.__airGate=new Promise(r=>{open=r;});window.__airOpen=open;window.__airCalls=[];
  const day=s=>Date.parse(s+'T00:00:00+09:00');
  MyPlacesUI.discoverySearch=async(plan,points,current)=>{window.__airCalls.push(new Date(plan.at+32400000).toISOString().slice(0,10));await window.__airGate;
   if(plan.at===day('2026-11-25'))return original(plan,points,current);
   if(plan.at===day('2026-11-27')){const r=await original({...plan,at:day('2026-11-25')},points,current);const move=x=>Number.isFinite(x)?x+2*86400000:x;
    return {...r,rows:r.rows.map(row=>({...row,event:{...row.event,at:move(row.event.at)},spatialWindow:row.spatialWindow&&{...row.spatialWindow,fromAt:move(row.spatialWindow.fromAt),toAt:move(row.spatialWindow.toAt)}}))};}
   return {rows:[],failed:0};};});
 await page.evaluate(()=>MyPlacesUI.imported());
 await page.waitForFunction(()=>/（確認中）/.test(document.getElementById('recordOpportunityList')?.innerText||''),null,{timeout:60000});
 const checking=await text();assert.match(checking,/11\/25\([^)]+\)（確認中）/,'確かめる前は確認中 '+checking.slice(0,200));
 await page.evaluate(()=>window.__airOpen());await settled();
 const stub=await ids(),stubDays=stub.map(dayOf),list=await text(),calls=await page.evaluate(()=>window.__airCalls);
 assert(stubDays.includes('2026-11-25'),'確定した行は残る '+JSON.stringify(stubDays));assert(!stubDays.includes('2026-11-26'),'外れた行は消える');
 assert(stub.some(id=>dayOf(id)==='2026-11-27'&&JSON.parse(id)[2]==='air'),'前後の日で大気込みなら足す '+JSON.stringify(stub));
 assert(calls.includes('2026-11-27')&&calls.includes('2026-11-28'),'足した行からさらに外の日も確かめる '+JSON.stringify(calls));
 assert(!/（確認中）|（大気差未確認）/.test(list),'確定後は確認中の印が無い');
 await page.screenshot({path:path+'-air-stub.png',fullPage:true});
 // 判定に失敗した日は消さずに「（大気差未確認）」
 await page.evaluate(()=>{const original=window.__airOriginal,fail=Date.parse('2026-11-25T00:00:00+09:00');MyPlacesUI.discoverySearch=async(plan,points,current)=>plan.at===fail?{rows:[],failed:1}:original(plan,points,current);MyPlacesUI.imported();});
 await page.waitForFunction(()=>/（大気差未確認）/.test(document.getElementById('recordOpportunityList')?.innerText||''),null,{timeout:120000});
 assert.match(await text(),/11\/25\([^)]+\)（大気差未確認）/,'判定に失敗した行は残して未確認');
 // 元に戻す
 await page.evaluate(()=>{MyPlacesUI.discoverySearch=window.__airOriginal;globalThis.AstroNotesOpportunityAir='off';MyPlacesUI.imported();});await ready(page);
 await choose(page,'Body',before.body);await ready(page);await choose(page,'Target',before.target);await ready(page);
 if(before.date!=='2026-11-25'){await page.locator('#recordOpportunityDate').fill(before.date);await ready(page);}
 return {geometric:geoDays,real:[...realDays],stub:stubDays,calls:[...new Set(calls)]};
};
