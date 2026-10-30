// Synthetic search only. At the strip's right end, x proximity snap must not re-snap after appended candidates.
const{chromium,webkit}=require('playwright'),fs=require('fs'),assert=require('assert/strict');
const base=process.env.CANDIDATE_BASE||'http://127.0.0.1:8891/index.html',out=process.env.CANDIDATE_OUT||'/tmp/astronotes-candidate-scroll-end';fs.mkdirSync(out,{recursive:true});
(async()=>{const results=[];
for(const engine of(process.env.CANDIDATE_ENGINES||'chromium,webkit').split(',')){const b=await(engine==='webkit'?webkit.launch():chromium.launch({channel:'chrome',headless:true}));
try{for(const width of(process.env.CANDIDATE_WIDTHS||'1280,390').split(',').map(Number))for(const theme of['light','dark']){const tools=['diamond','pearl','tower','skymap','records'],c=await b.newContext({viewport:{width,height:900},colorScheme:theme,timezoneId:'Asia/Tokyo'});
await c.addInitScript(tools=>{localStorage.setItem('sorami.startupScreen','forecast');sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-scroll-end',loginId:'scroll-end-test',tools}));},tools);
await c.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
await c.route(/zekkei-api\.okayu-sorami\.workers\.dev|localhost:8787/,r=>r.fulfill({status:new URL(r.request().url()).pathname.startsWith('/prediction')?503:200,json:{loginId:'scroll-end-test',tools,allowed:true,tool:'skymap',favorites:[],sightings:[],rev:0}}));
const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(12000);await p.goto(base);await p.waitForFunction(()=>auth?.loginId==='scroll-end-test');
await p.evaluate(()=>{window.__initial=true;window.__release=null;aimBuildingDays=async(o,t,b,part,seq,opt)=>{const initial=window.__initial;if(!initial)await new Promise(r=>window.__release=r);const count=initial?12:4;opt.onScanned(opt.from+count*86400000);return Array.from({length:count},(_,i)=>({at:opt.from+(i+.5)*86400000,side:'set',intersects:true,sunAltitude:-10,illuminated:.8}));};aimAirSettings.mode='standard';AstroNotesAtmosphere.configure('standard',aimAirSettings);pushRoute('#/explore');});
await p.locator('#skyMapContent').waitFor({state:'visible'});await p.evaluate(()=>{SkyMapUI.setObserver({name:'右端保持の合成地点',latitude:35.72,longitude:139.84,groundManualM:31,standAglM:1.5});SkyMapUI.setTarget('skytree');});
await p.waitForFunction(()=>document.querySelectorAll('#skyMapDates [data-from-day]').length===12);await p.locator('#skyMapDates [data-from-day]').nth(3).click();
const toEnd=()=>p.evaluate(()=>{const s=document.querySelector('#skyMapDates .strip');s.scrollLeft=s.scrollWidth;return s.scrollLeft;});
const state=()=>p.evaluate(()=>{const s=document.querySelector('#skyMapDates .strip'),buttons=[...s.querySelectorAll('[data-from-day]')];return{left:s.scrollLeft,max:s.scrollWidth-s.clientWidth,sameStrip:s===window.__strip,sameButtons:window.__buttons.every((x,i)=>x===buttons[i]),count:buttons.length,snap:getComputedStyle(s).scrollSnapType,at:SkyMapUI.snapshot().at};});
const before=await toEnd();await p.evaluate(()=>{window.__initial=false;const s=document.querySelector('#skyMapDates .strip');window.__strip=s;window.__buttons=[...s.querySelectorAll('[data-from-day]')];});const at=await p.evaluate(()=>SkyMapUI.snapshot().at);
assert(before>0,'strip overflows so the right end is a clamped scroll position');
await p.locator('#skyMapDates [data-from-more]').click();await p.waitForFunction(()=>typeof window.__release==='function');
const latest=await toEnd();await p.evaluate(()=>{const r=window.__release;window.__release=null;r();});await p.waitForFunction(()=>!document.querySelector('#skyMapDates [data-from-more]').disabled);
// Re-snap after a content change runs after layout, so check again after frames have passed.
await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,300)))));const after=await state();
assert.equal(after.count,16);assert(after.sameStrip&&after.sameButtons,'same strip and buttons');assert(Math.abs(after.left-latest)<1,'right end stays put '+JSON.stringify({engine,width,theme,latest,after}));assert(after.max>after.left,'appended chips are reachable to the right');assert.equal(after.at,at);
// The user's own next scroll ends with snap restored; programmatic scrolls above did not restore it.
await p.locator('#skyMapDates .strip').hover();await p.mouse.wheel(-120,0);await p.waitForFunction(()=>getComputedStyle(document.querySelector('#skyMapDates .strip')).scrollSnapType.includes('x'));
const resumed=await state();assert(resumed.left<after.left,'user scroll moved the strip');assert(resumed.sameStrip&&resumed.sameButtons);
assert.deepEqual(errors,[]);await p.screenshot({path:`${out}/${engine}-${width}-${theme}.png`,fullPage:true});results.push({engine,width,theme,before,latest,after,resumed});console.log('PASS candidate scroll end',engine,width,theme,latest,'->',after.left);await c.close();}}
finally{await b.close();}}
fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exit(1)});
