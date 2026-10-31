const {chromium}=require('playwright'),assert=require('assert/strict'),fs=require('fs');
const base=process.env.CANDIDATE_BASE||'http://127.0.0.1:8885',out=process.env.CANDIDATE_OUT||require('os').tmpdir()+'/astronotes-candidate-calendar';fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});const results=[];
for(const width of [320,390,1280])for(const theme of ['light','dark']){
 const c=await browser.newContext({viewport:{width,height:900},colorScheme:theme}),tools=['records','tower','diamond','pearl','skymap'];
 await c.addInitScript(tools=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-calendar',loginId:'calendar-test',tools})),tools);
 await c.route(/(?:zekkei-api|localhost:8787)/,r=>r.fulfill({status:200,json:{allowed:true,tool:'skymap',loginId:'calendar-test',tools,credentials:[],hasPassword:true,recoveryCodes:10,favorites:[],sightings:[],rev:1}}));
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.waitForFunction(()=>{try{return typeof PAGE_DIALOGS==='object'}catch{return false}});
 await p.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>83;navigationHistory.pushRoute('#/explore');});
 await p.locator('#exploreConditions').waitFor();await p.evaluate(()=>{aimAirSettings.mode='standard';AstroNotesAtmosphere.configure('standard',aimAirSettings);SkyMapUI.setObserver({name:'Synthetic',latitude:35.583465,longitude:139.568839,groundManualM:83,standAglM:1.5});SkyMapUI.setTarget('skytree');const body=document.getElementById('skyMapBody');body.value='moon';body.onchange();SkyMapUI.setTime(Date.parse('2026-10-03T23:00:00+09:00'));});
 await p.locator('#skyMapCalendarOpen').click();const d=p.locator('dialog.tool-date-calendar:visible');await d.waitFor();
 await p.waitForFunction(()=>{const d=document.querySelector('dialog.tool-date-calendar[open]');return d&&d.querySelector('[data-grid]').getAttribute('aria-busy')==='false';},null,{timeout:60000});
 let data=await d.evaluate(el=>({text:el.textContent,days:el.querySelectorAll('[data-cal-day]').length,moon:el.querySelectorAll('canvas[data-cal-moon]').length,marks:el.querySelectorAll('.has-event').length,painted:[...el.querySelectorAll('canvas[data-cal-moon]')].filter(c=>c.getContext('2d').getImageData(0,0,40,40).data.some((v,i)=>i%4===3&&v)).length,overflow:el.scrollWidth>el.clientWidth,dayWidth:el.querySelector('[data-cal-day]').getBoundingClientRect().width}));
 assert.equal(data.days,31);assert.equal(data.moon,31);assert.equal(data.painted,31);assert(data.marks>0,JSON.stringify(data));assert(!data.overflow,JSON.stringify({width,data}));assert(!data.text.includes('計算できませんでした'),data.text);
 await p.screenshot({path:out+'/'+width+'-'+theme+'.png'});
 const oldLabel=await d.locator('[data-cal-day]').first().getAttribute('aria-label');assert(/月/.test(oldLabel));
 await d.locator('[data-next]').click();await d.locator('[data-prev]').click();await p.waitForFunction(()=>document.querySelector('dialog.tool-date-calendar[open] [data-grid]').getAttribute('aria-busy')==='false');
 await d.locator('[data-cal-day]').filter({hasText:/^5/}).first().click();assert.equal(await d.count(),0);assert.equal(await p.evaluate(()=>AstroNotesSkyMap.dayStart(SkyMapUI.snapshot().at)),Date.parse('2026-10-05T00:00:00+09:00'));
 assert.equal(await p.evaluate(()=>SkyMapUI.snapshot().at-AstroNotesSkyMap.dayStart(SkyMapUI.snapshot().at)),23*3600000);
 if(width===390&&theme==='dark'){
 const actual=await p.evaluate(async()=>{const f={name:'渋谷スカイ',latitude:35.65838,longitude:139.70222,groundManualM:19,standAglM:229,decks:[{name:'展望台',aglM:229,heightBasis:'published-viewpoint'}]},target=AstroNotesAlign.targetById('skytree'),day=Date.parse('2026-10-28T00:00:00+09:00'),out=[];
 for(const hour of [0,17,18.5,23+59/60]){const at=day+hour*3600000,plan={target,body:'moon',partId:'__whole',limb:'center',matchMode:'overlap',at};const rows=await AstroNotesShooting.candidates(plan,[{place:f}],{align:AstroNotesAlign,isMountain:aimIsMountain,observerAt:aimObserverAt,ensure:async()=>{},viewFor:obs=>aimShootingView(obs,target,'moon','__whole','overlap')});out.push({hour,candidates:rows.rows.map(r=>r.event.at),failed:rows.failed});}return out;});
 assert(actual[0].candidates.length>0,JSON.stringify(actual));for(const x of actual){assert.equal(x.failed,0);assert.deepEqual(x.candidates,actual[0].candidates);}fs.writeFileSync(out+'/shibuya-day.json',JSON.stringify(actual,null,2));
 }
 if(width===390&&theme==='dark'){
 await p.evaluate(()=>{const body=document.getElementById('skyMapBody');body.value='sun';body.onchange();});await p.locator('#skyMapCalendarOpen').click();await d.waitFor();await p.waitForFunction(()=>document.querySelector('dialog.tool-date-calendar[open] [data-grid]').getAttribute('aria-busy')==='false');assert.equal(await d.locator('canvas[data-cal-moon]').count(),0);assert.equal(await d.locator('[data-cal-day]').count(),31);await d.locator('[data-close]').click();
 }
 assert.deepEqual(errors,[]);results.push({width,theme,...data});await c.close();
}await browser.close();fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(({width,theme,days,moon,painted,marks,overflow})=>({width,theme,days,moon,painted,marks,overflow})),null,2));})().catch(e=>{console.error(e);process.exit(1)});
