// Isolated dialog lifecycle fixtures; no account or API writes.
const {chromium}=require('playwright'),fs=require('fs'),assert=require('assert/strict');
const base=process.env.PLAN_BASE||'http://127.0.0.1:8897/';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 for(const engine of(process.env.PLAN_ENGINES||'chromium').split(',')){
  // Chrome is the installed desktop browser; WebKit may be supplied by the runtime.
  const b=engine==='chromium'?browser:await require('playwright')[engine].launch({headless:true});
  const p=await b.newPage({viewport:{width:390,height:850}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/__plan_fixture__.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ja"><body></body></html>'}));await p.goto(base+'__plan_fixture__.html');
  await p.addScriptTag(process.env.PLAN_SCRIPT?{content:fs.readFileSync(process.env.PLAN_SCRIPT,'utf8')}:{url:base+'astronotes-plan.js'});
  await p.evaluate(()=>{
   window.sourceButton=document.createElement('button');document.body.append(sourceButton);
   window.captureCount=0;window.captureMode='valid';
   window.shareFixture=AstroNotesPlan.mount({show:d=>d.showModal(),snapshot:()=>{
    captureCount++;if(captureMode==='throw')throw Error('撮影条件を取得できませんでした。再試行してください。');if(captureMode==='null')return null;if(captureMode==='invalid')return {};
    const data={title:'月 × テスト対象',observer:{name:'テスト地点',latitude:35,longitude:139},payload:{kind:'aim'},start:Date.parse('2026-10-28T08:42:00Z'),end:Date.parse('2026-10-28T09:36:00Z'),rows:[],url:'https://example.test/plan',mapUrl:'https://example.test/map'};
    if(captureMode==='wait')return new Promise(resolve=>{window.releaseCapture=()=>resolve({...data,title:'stale capture'});});
    return data;
   }});
  });
  await p.evaluate(()=>shareFixture.open('export',sourceButton));
  if(!process.env.PLAN_LEGACY){assert.equal(await p.locator('#planReminder').count(),0);assert(!(await p.locator('#planCalendar').innerText()).includes('通知'));}
  const original=await p.locator('#planStart').inputValue();await p.locator('#planEventTitle').fill('編集した件名');
  await p.locator('#planImageTab').click();await p.locator('#planCopy:not(:disabled)').waitFor();await p.locator('#planCalendarTab').click();assert.equal(await p.locator('#planEventTitle').inputValue(),'編集した件名');assert.equal(await p.locator('#planStart').inputValue(),original);
  const href=new URL(await p.locator('#planGoogle').getAttribute('href'));assert.equal(href.searchParams.get('text'),'編集した件名');assert.equal(href.searchParams.get('dates'),'20261028T084200Z/20261028T093600Z');
  const downloadPromise=p.waitForEvent('download');await p.locator('#planIcs').click();const download=await downloadPromise,ics=fs.readFileSync(await download.path(),'utf8');assert(!ics.includes('VALARM'));assert(ics.includes('DTSTART:20261028T084200Z'));assert(ics.includes('DTEND:20261028T093600Z'));
  // Native close notification is queued: close and reopen in the same task.
  await p.evaluate(()=>{document.getElementById('planSheet').close();void shareFixture.open('export',sourceButton);});
  await p.waitForTimeout(60);await p.locator('#planImageTab').click();await p.waitForTimeout(30);assert(!/payload|null|Cannot read/.test(await p.locator('#planStatus').innerText()));await p.locator('#planCopy:not(:disabled)').waitFor();await p.locator('#planCalendarTab').click();assert.equal(await p.locator('#planStart').inputValue(),original);assert(!(await p.locator('#planStatus').innerText()).includes('payload'));
  for(const mode of ['throw','null','invalid']){
   await p.evaluate(mode=>{captureMode=mode;return shareFixture.open('share',sourceButton);},mode);
   assert(!(await p.locator('#planStatus').innerText()).includes('payload'));assert(await p.locator('#planCalendar').isHidden());assert(await p.locator('#planRetry').isVisible());
   await p.evaluate(()=>captureMode='valid');await p.locator(mode==='throw'?'#planRetry':'#planCalendarTab').click();if(mode==='throw'){await p.locator('#planCopy:not(:disabled)').waitFor();await p.locator('#planCalendarTab').click();}await p.locator('#planEventTitle').waitFor();assert(await p.locator('#planCalendar').isVisible());assert.equal(await p.locator('#planStart').inputValue(),original);
  }
  await p.evaluate(()=>{captureMode='wait';window.pendingCapture=shareFixture.open('share',sourceButton);});assert(await p.locator('#planWaiting').isVisible());assert.equal(await p.locator('#planWaiting .note-wait-character').count(),1);
  await p.evaluate(async()=>{document.getElementById('planSheet').close();captureMode='valid';await shareFixture.open('export',sourceButton);releaseCapture();await pendingCapture;});await p.waitForTimeout(60);assert.equal(await p.locator('#planEventTitle').inputValue(),'月 × テスト対象');assert(await p.locator('#planWaiting').isHidden());
  // Switch before PNG generation completes, and preserve the same snapshot.
  const before=await p.evaluate(()=>captureCount);await p.evaluate(()=>{document.getElementById('planImageTab').click();document.getElementById('planCalendarTab').click();});await p.waitForTimeout(60);assert(await p.locator('#planCalendar').isVisible());assert.equal(await p.evaluate(()=>captureCount),before);assert.equal(await p.locator('#planKeep').isVisible(),false);
  assert.deepEqual(errors,[]);await p.close();if(b!==browser)await b.close();console.log(engine,'no reminder/VALARM, fields retained, queued close, failed capture recovery, pending PNG tab switch');
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
