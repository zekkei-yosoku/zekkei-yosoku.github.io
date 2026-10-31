// Tile timeouts on the first open must recover by themselves: the Fuji row appears and the moon row stops using a flat horizon.
// Serves this checkout at the production origin so the real API accepts the requests. Needs network access.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path');
const DIR=path.resolve(__dirname,'..'),ORIGIN='https://zekkei-yosoku.github.io';
const mime={'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png','.webp':'image/webp','.txt':'text/plain','.svg':'image/svg+xml'};
const failTilesFor=ms=>{const real=window.fetch;window.fetch=function(url){if(/\/xyz\/dem/.test(String(url))&&performance.now()<ms)return Promise.reject(new DOMException('signal timed out','TimeoutError'));return real.apply(this,arguments);};};
const ready=()=>{const t=document.body.innerText;return t.includes('富士山')&&!t.includes('予測中です');};
async function open(browser,failFor){
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.route(ORIGIN+'/**',route=>{const pathname=new URL(route.request().url()).pathname,name=pathname==='/'?'index.html':pathname.slice(1),file=path.join(DIR,name);
  if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
  return route.fulfill({status:200,contentType:mime[path.extname(name)]||'application/octet-stream',body:fs.readFileSync(file)});});
 const page=await context.newPage(),moon=[];if(failFor)await page.addInitScript(failTilesFor,failFor);
 page.on('request',request=>{if(!request.url().endsWith('/prediction/visibility')||request.method()!=='POST')return;const body=JSON.parse(request.postData());if(body.kind==='moon')moon.push(Boolean(body.terrain));});
 await page.goto(ORIGIN+'/#/');await page.waitForFunction(ready,null,{timeout:150000,polling:1000});await page.waitForTimeout(3000);
 const text=await page.evaluate(()=>document.body.innerText);await context.close();return {text,moon};
}
(async()=>{
 const browser=await chromium.launch({channel:'chrome'});
 try{
  const normal=await open(browser,0),recovered=await open(browser,15000);
  if(normal.text!==recovered.text)throw Error('recovered screen differs from the normal screen');
  if(recovered.moon[0]!==false)throw Error('the first moon request should have had no terrain: '+recovered.moon);
  if(recovered.moon.at(-1)!==true)throw Error('the moon row kept a flat horizon: '+recovered.moon);
  console.log('PASS tile recovery');
 }finally{await browser.close();}
})().catch(e=>{console.error('FAIL tile recovery',e.message);process.exit(1);});
