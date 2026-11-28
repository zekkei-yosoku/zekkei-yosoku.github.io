// Functional Explore fixtures start with the candidate sheet on its real map.
// Reopening the map after a preview or after closing the sheet does not reopen it.
const playwright=require('playwright');
function openOnEntry(){
 let last=null,tries=0;
 const check=()=>{
  const view=document.getElementById('skyMapView'),stage=view?.dataset.exploreStage||null;
  if(stage===last)return;const entered=stage==='map'&&last===null;last=stage;
  if(!entered)return;tries=0;
  const open=()=>{
   const v=document.getElementById('skyMapView');
   if(v?.dataset.exploreStage!=='map'||v.hasAttribute('data-explore-dropdown')||tries++>40)return;
   document.dispatchEvent(new CustomEvent('astronotes-explore-open-sheet'));
   setTimeout(open,50);
  };
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
async function openExploreSheet(page,{timeout=15000}={}){
 await page.waitForFunction(()=>{
  const view=document.getElementById('skyMapView');
  return !view?.hidden&&view?.dataset.exploreStage;
 },null,{timeout});
 if(await page.evaluate(()=>document.getElementById('skyMapView').dataset.exploreStage)!=='map')return false;
 await page.evaluate(()=>document.dispatchEvent(new CustomEvent('astronotes-explore-open-sheet')));
 await page.locator('#skyMapView[data-explore-sheet]').waitFor({state:'visible',timeout});
 return true;
}

async function openExploreFields(page){
 const dropdown=page.locator('#skyMapView[data-explore-dropdown] #exploreConditions');
 if(!await dropdown.isVisible())await page.locator('#mapWsTitle').click();
 await dropdown.waitFor({state:'visible'});
}

// Functional checks can reach the shared result handler with the candidate sheet
// open. Map interaction and layout tests use the visible map buttons directly.
async function showExploreView(page){
 await page.locator('#exploreShowResult').evaluate(button=>button.click());
}

module.exports={openExploreSheet,openExploreFields,showExploreView};
