// 2026-11-26 trial 探すの全画面地図（段階①）: 探すは地図の段で始まり、撮影条件・撮影地点を探す・候補は
// 上部の条件帯から開くポップアップ（検索の段）にある。従来の検索の段を確かめる検査は先頭でこれを require する。
// 起動したブラウザの全コンテキストへ初期化スクリプトを足し、探すに入って地図の段で始まるたびに（離れると段が消える）
// 条件帯と同じ合図（astronotes-explore-open-conditions）を送る。ポップアップ→地図へ、見え方→地図へ戻る時は開かない。
// これは従来の「探すは検索の段で始まる」検査を保つためで、地図の段から始まる導線（重なる日・復元を含む）は
// tools/test-explore-map-stage.cjs が受け持つ。
// 地図の段そのものの受入は tools/test-explore-map-stage.cjs（これを読まない）が持つ。
const playwright=require('playwright');
function openOnEntry(){
 let last=null,tries=0;
 const check=()=>{
  const view=document.getElementById('skyMapView'),stage=view?.dataset.exploreStage||null;
  if(stage===last)return;const entered=stage==='map'&&last===null;last=stage;
  if(!entered)return;tries=0;
  const open=()=>{const v=document.getElementById('skyMapView');if(v?.dataset.exploreStage!=='map'||tries++>40)return;document.dispatchEvent(new Event('astronotes-explore-open-conditions'));setTimeout(open,50);};
  setTimeout(open,0);
 };
 const start=()=>{new MutationObserver(check).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['data-explore-stage']});check();};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
}
const add=async context=>{await context.addInitScript(openOnEntry);return context;};
const patchBrowser=browser=>{
 if(browser.__exploreConditions)return browser;
 const newContext=browser.newContext.bind(browser),newPage=browser.newPage.bind(browser);
 browser.newContext=async(...args)=>add(await newContext(...args));
 browser.newPage=async(...args)=>{const page=await newPage(...args);await page.addInitScript(openOnEntry);return page;};
 browser.__exploreConditions=true;return browser;
};
for(const type of [playwright.chromium,playwright.webkit]){
 if(!type||type.__exploreConditions)continue;
 const launch=type.launch.bind(type);type.launch=async(...args)=>patchBrowser(await launch(...args));
 const persistent=type.launchPersistentContext?.bind(type);if(persistent)type.launchPersistentContext=async(...args)=>add(await persistent(...args));
 type.__exploreConditions=true;
}
// 検査の途中で明示的に開きたいとき（地図の段へ戻した後など）。
async function openExploreConditions(page,{timeout=15000}={}){
 await page.waitForFunction(()=>{const v=document.getElementById('skyMapView');return !!v?.dataset.exploreStage&&!v.hidden;},null,{timeout});
 if(await page.evaluate(()=>document.getElementById('skyMapView').dataset.exploreStage)!=='map')return false;
 await page.evaluate(()=>document.dispatchEvent(new Event('astronotes-explore-open-conditions')));
 await page.waitForFunction(()=>document.getElementById('skyMapView').dataset.exploreStage==='search',null,{timeout});
 return true;
}
module.exports={openExploreConditions};
