// Real browser scheduling, with fixed TLE/place tables and no external I/O.
require('./explore-open-conditions.cjs'); // 2026-11-26 探すは地図の段で始まる。検索の段を確かめるため入口で撮影条件を開く
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=new URL(process.env.ISS_COOPERATIVE_BASE||'http://127.0.0.1:8987/');
assert(base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname),'local fixture only');
const read=name=>fs.readFileSync(new URL('../'+name,'file://'+__filename),'utf8');
const controller=read('src/features/satellites/controller.js');
const standCode=controller.slice(controller.indexOf('async function issStand('),controller.indexOf('\nfunction issRender('));
const fixture={tleText:read('fixtures/iss-20260929.tle'),index:JSON.parse(read('data/place-index.json')),points:JSON.parse(read('data/aim-viewpoints.json')).places,standCode};
(async()=>{
 for(const [name,type] of [['chrome',chromium],['webkit',webkit]]){
  const browser=await type.launch(name==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{
   const context=await browser.newContext(),page=await context.newPage(),errors=[];let external=0;
   page.on('pageerror',error=>errors.push(error.message));
   await context.route('**/*',route=>{
    const url=new URL(route.request().url());if(url.origin!==base.origin){external++;return route.abort();}
    if(url.pathname.endsWith('/iss-cooperative-fixture.html'))return route.fulfill({contentType:'text/html',body:'<!doctype html><title>ISS scheduling fixture</title>'});
    return route.continue();
   });
   await page.goto(new URL('iss-cooperative-fixture.html',base).href);
   for(const file of ['astronotes-astro.js','astronotes-iss.js'])await page.addScriptTag({url:new URL(file,base).href});
   const result=await page.evaluate(async({base,fixture})=>{
    const io=await import(new URL('vendor/satellite/io.js',base)),pr=await import(new URL('vendor/satellite/propagation.js',base)),tr=await import(new URL('vendor/satellite/transforms.js',base));
    const sat={twoline2satrec:io.twoline2satrec,propagate:pr.propagate,gstime:pr.gstime,eciToEcf:tr.eciToEcf,ecfToLookAngles:tr.ecfToLookAngles},I=AstroNotesISS;
    const tle=I.parseTle(fixture.tleText),center={latitude:35.71,longitude:139.81},fromMs=Date.parse('2026-09-30T00:00:00+09:00'),options={center,radiusKm:300,fromMs,hours:168};
    function exact(a,b){if(a&&b&&typeof a==='object'&&typeof b==='object'){const keys=Object.keys(a);if(JSON.stringify(keys)!==JSON.stringify(Object.keys(b)))throw Error('different fields');for(const key of keys)exact(a[key],b[key]);}else if(!Object.is(a,b))throw Error('different scalar');}
    async function measure(run){let ticks=0,start=performance.now(),chunk=start;const slices=[],timer=setInterval(()=>ticks++,0);
     const control={yieldTask:async()=>{slices.push(performance.now()-chunk);await new Promise(resolve=>setTimeout(resolve,0));chunk=performance.now();}};
     try{const value=await run(control);slices.push(performance.now()-chunk);return {value,ms:performance.now()-start,ticks,yields:slices.length-1,maxSliceMs:Math.max(...slices)};}finally{clearInterval(timer);}}
    const checks=[];let first;
    for(const body of ['moon','sun']){
     const start=performance.now(),expected=I.transits(sat,tle,{...options,body}),syncMs=performance.now()-start;
     const value=await measure(control=>I.transitsAsync(sat,tle,{...options,body},control));exact(value.value,expected);
     checks.push({operation:'transits',body,syncMs,ms:value.ms,ticks:value.ticks,yields:value.yields,maxSliceMs:value.maxSliceMs,events:expected.length,exact:true});
     if(body==='moon')first=expected[0];
    }
    const passOptions={observer:{...center,elevation:40},fromMs,hours:168},expected=I.passes(sat,tle,passOptions),passes=await measure(control=>I.passesAsync(sat,tle,passOptions,control));exact(passes.value,expected);
    checks.push({operation:'passes',ms:passes.ms,ticks:passes.ticks,yields:passes.yields,maxSliceMs:passes.maxSliceMs,events:expected.length,exact:true});
    let current=true,count=0;const instrumented={...sat,propagate(...args){count++;return sat.propagate(...args);}};
    setTimeout(()=>current=false,0);let cancelled=false;const began=performance.now();
    try{await I.transitsAsync(instrumented,tle,options,{isCurrent:()=>current});}catch(error){cancelled=error.name==='AbortError';}
    const cancelMs=performance.now()-began,stopped=count;await new Promise(resolve=>setTimeout(resolve,20));if(count!==stopped)throw Error('cancel continued');
    const nextOptions={...options,hours:24,body:'sun'};exact(await I.transitsAsync(sat,tle,nextOptions),I.transits(sat,tle,nextOptions));
    const deps={issFromPoint:()=>center,iss:{rangeKm:300},aimPlaces:async()=>fixture.points,placeIndex:async()=>fixture.index,AstroNotesTerrain:{distanceKm:I.distanceKm,waterAt:async p=>p.map(()=>false)}};
    const stand=Function('deps','const {issFromPoint,iss,aimPlaces,placeIndex,AstroNotesTerrain}=deps;'+fixture.standCode+';return issStand;')(deps);
    const land=await measure(control=>stand(first,control));if(!land.value)throw Error('fixture has no land candidate');
    checks.push({operation:'land-candidates',ms:land.ms,ticks:land.ticks,yields:land.yields,maxSliceMs:land.maxSliceMs,selected:land.value.name});
    return {checks,cancelled,cancelMs,stopped,nextEqual:true};
   },{base:base.href,fixture});
   assert.equal(external,0);assert.deepEqual(errors,[]);assert.equal(result.cancelled,true);assert(result.stopped>0);assert(result.cancelMs<500);
   for(const row of result.checks){assert(row.yields>0,row.operation+' yields');assert(row.ticks>0,row.operation+' allows timer tasks');assert(row.maxSliceMs<100,row.operation+' long blocking slice: '+row.maxSliceMs);}
   console.log(JSON.stringify({browser:name,external,pageErrors:errors,...result}));
  }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
