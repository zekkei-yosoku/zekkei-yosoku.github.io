// 試用版は画面の異常の直近20件を端末の中だけに残す（tools/trial-error-log-runtime.js）。外へは送らない。
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.ERROR_LOG_BASE||'http://127.0.0.1:8992/trial/';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'ja-JP',timezoneId:'Asia/Tokyo'});
  const outside=[];
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===new URL(base).origin)return route.continue();outside.push(route.request().method()+' '+u.host);return route.abort();});
  const page=await context.newPage();page.setDefaultTimeout(30000);
  await page.goto(base+'index.html');await page.waitForLoadState('load');
  const before=outside.length;
  await page.evaluate(()=>{localStorage.removeItem('astronotes.trial.errors');
   for(let i=0;i<3;i++)setTimeout(()=>{throw Error('synthetic failure');},0);
   for(let i=0;i<25;i++)Promise.reject(Error('rejected '+i+' '+'x'.repeat(400)));
   Promise.reject(new DOMException('stopped','AbortError'));});
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('astronotes.trial.errors')||'[]').length===20);
  const list=await page.evaluate(()=>JSON.parse(localStorage.getItem('astronotes.trial.errors')));
  assert.ok(list.every(r=>r.message.length<=200&&!/[?#]/.test(r.source)&&r.at&&r.v),'bounded rows');
  assert.ok(!list.some(r=>/stopped/.test(r.message)),'a cancelled request is not an error');
  assert.match(list.at(-1).message,/rejected 24/);
  await page.evaluate(()=>{localStorage.removeItem('astronotes.trial.errors');for(let i=0;i<3;i++)setTimeout(()=>{throw Error('synthetic failure');},0);});
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('astronotes.trial.errors')||'[]')[0]?.count===3);
  await page.waitForTimeout(300);
  assert.deepEqual(outside.slice(before).filter(x=>x.startsWith('POST')),[],'nothing is sent anywhere');
  console.log(JSON.stringify({rows:list.length,last:list.at(-1).message.slice(0,20)}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
