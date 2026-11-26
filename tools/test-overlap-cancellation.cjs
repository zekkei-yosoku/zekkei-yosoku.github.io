// Exercise the generated engines, offline, in real browser workers and frames.
require('./no-open-meteo.cjs');
require('./explore-open-conditions.cjs'); // 2026-11-26 探すは地図の段で始まる。検索の段を確かめるため入口で撮影条件を開く
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.OVERLAP_CANCEL_BASE||'http://127.0.0.1:8992/trial/';
const target=require('../astronotes-align.js').targetById('skytree');
(async()=>{
 for(const [name,type] of [['chrome',chromium],['webkit',webkit]]){
  const browser=await type.launch(name==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{
   const c=await browser.newContext(),page=await c.newPage();let external=0;
   const origin=new URL(base).origin;
   await c.route('**/*',r=>{
    const url=new URL(r.request().url());
    if(url.origin!==origin){external++;return r.abort();}
    if(url.pathname.endsWith('/cancel-test.html'))return r.fulfill({contentType:'text/html',body:'<!doctype html><title>Calculation cancellation fixture</title>'});
    return r.continue();
   });
   await page.goto(new URL('cancel-test.html',base).href);
   const result=await page.evaluate(async({base,target})=>{
    const channel='astronotes-overlap';
    async function open(mode){
     const transport=mode==='worker'?new Worker(new URL('overlap-calculation-worker.js',base)):document.createElement('iframe'),calls=new Map();
     let release,fail;const ready=new Promise((resolve,reject)=>{release=resolve;fail=reject;});
     const timer=setTimeout(()=>fail(Error('engine startup timeout')),30000);
     const receive=event=>{
      if(mode==='frame'&&(event.source!==transport.contentWindow||event.origin!==location.origin))return;
      const m=event.data;if(m?.type!==channel)return;
      if('ready'in m){clearTimeout(timer);if(!m.ready||!m.cancellation)fail(Error('engine not cancellation ready'));else release();return;}
      const done=calls.get(m.id);if(done){calls.delete(m.id);done(m);}
     };
     if(mode==='worker')transport.onmessage=receive;else{addEventListener('message',receive);transport.src=new URL('overlap-calculation.html',base);document.body.append(transport);}
     await ready;
     const send=m=>mode==='worker'?transport.postMessage(m):transport.contentWindow.postMessage(m,location.origin);
     return {call:(id,input)=>new Promise(resolve=>{calls.set(id,resolve);send({type:channel,id,op:'days',input});}),cancel:id=>send({type:channel,id,op:'cancel'}),close:()=>{if(mode==='worker')transport.terminate();else{removeEventListener('message',receive);transport.remove();}}};
    }
    const input={tools:['records','tower','pearl'],generation:1,preferences:{mode:'none'},obs:{latitude:35.70730860834253,longitude:139.75974230531398,elevation:21.8,eyeM:1.5},target,body:'moon',partId:'__whole',limb:'center',start:Date.parse('2026-12-01T00:00:00+09:00'),from:0,count:120,limit:999};
    const result=[];
    for(const mode of ['worker','frame']){
     const engine=await open(mode),began=performance.now(),first=engine.call(1,input),nextInput={...input,count:2};
     const second=engine.call(2,nextInput);setTimeout(()=>engine.cancel(1),0);
     const cancelled=await first,ms=performance.now()-began,after=await second,alone=await engine.call(3,nextInput);
     result.push({mode,cancelled:cancelled.error,ms,after:after.result?.rows,alone:alone.result?.rows,error:after.error||alone.error});engine.close();
    }
    return result;
   },{base:new URL(base).href,target});
   for(const row of result){assert.equal(row.cancelled,'calculation-cancelled');assert(!row.error,row.error);assert(row.ms<5000,'cancel promptly');assert(row.alone.length>0,'fixture contains a real overlap');assert.deepEqual(row.after,row.alone,'next calculation equals standalone calculation');}
   assert.equal(external,0,'offline fixture must not request external data');
   console.log(JSON.stringify({browser:name,result}));
  }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exit(1);});
