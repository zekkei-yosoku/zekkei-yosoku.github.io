// テストのブラウザから Open-Meteo へ出さない（2026-11-03）。
// 画面は採点と同じ形で /v1/forecast を8モデル・最大8地点まとめて取り、Open-Meteo は地点数や変数の数で重く数える。
// 作業画面テストを1日に24回流して自宅回線の1日の上限を使い切り、Pi5 の予報記録が0件になった。
// 各テストの先頭で読み込む。起動したブラウザの全コンテキストで要求を止め、止めた数を終わりに stderr へ出す。
const playwright=require('playwright');
let blocked=0;
const block=async context=>{await context.route(/open-meteo\.com/,route=>{blocked++;return route.abort();});return context;};
const patchBrowser=browser=>{
 if(browser.__noOpenMeteo)return browser;
 const newContext=browser.newContext.bind(browser),newPage=browser.newPage.bind(browser);
 browser.newContext=async(...args)=>block(await newContext(...args));
 browser.newPage=async(...args)=>{const page=await newPage(...args);await block(page.context());return page;};
 browser.__noOpenMeteo=true;
 return browser;
};
for(const type of [playwright.chromium,playwright.webkit,playwright.firefox]){
 if(!type||type.__noOpenMeteo)continue;
 const launch=type.launch.bind(type);
 type.launch=async(...args)=>patchBrowser(await launch(...args));
 const persistent=type.launchPersistentContext?.bind(type);
 if(persistent)type.launchPersistentContext=async(...args)=>block(await persistent(...args));
 type.__noOpenMeteo=true;
}
process.on('exit',()=>{if(blocked)process.stderr.write(`open-meteo-blocked ${blocked}\n`);});
module.exports={blockedCount:()=>blocked};
