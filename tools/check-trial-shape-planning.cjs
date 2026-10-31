// Synthetic accounts and solver rows only; never reads or mutates user records.
const {chromium}=require('playwright'),fs=require('fs'),assert=require('assert/strict');
const base=process.env.SHAPE_BASE||'http://127.0.0.1:8863/trial/index.html',out=process.env.SHAPE_OUT||'/tmp/astronotes-trial-shapes';fs.mkdirSync(out,{recursive:true});let page;
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
for(const theme of ['light','dark'])for(const type of ['line','area']){
 const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:theme,timezoneId:'Asia/Tokyo'}),tools=['diamond','pearl','tower','skymap','plane','iss','records'];
 await c.addInitScript(({tools,theme})=>{sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-shape',loginId:'shape-test',role:'user',tools}));localStorage.setItem('sorami.owner','shape-test');localStorage.setItem('sorami.theme',theme);},{tools,theme});
 await c.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
 await c.route(/zekkei-api\.okayu-sorami\.workers\.dev|localhost:8787/,r=>{const path=new URL(r.request().url()).pathname;return r.fulfill({json:path==='/me'?{loginId:'shape-test',role:'user',tools}:path==='/sync'?{favorites:[],sightings:[],records:[],rev:0,more:false}:path.includes('/access')?{allowed:true,tool:'skymap',tools}:{}});});
 const p=await c.newPage();page=p;const errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(15000);await p.goto(base);await p.waitForFunction(()=>typeof AstroNotesShapePlanner!=='undefined'&&auth?.loginId==='shape-test');
 await p.evaluate(type=>{
  const f={id:'shape-fixture',name:'合成の線と枠',latitude:35.72,longitude:139.84,elevation:999,groundManualM:999},shape={type,vertices:type==='line'?[{latitude:35.721,longitude:139.841},{latitude:35.723,longitude:139.843}]:[{latitude:35.721,longitude:139.841},{latitude:35.723,longitude:139.841},{latitude:35.723,longitude:139.843},{latitude:35.721,longitude:139.843}]};
  favorites.push(f);store.set('sorami.favorites',favorites);const keys=AstroNotesLibrary.keys(auth.loginId);store.set(keys.shapes,{[f.id]:{latitude:f.latitude,longitude:f.longitude,shape}});store.set(keys.observations,AstroNotesLibrary.registrationChanges(f,[],[{key:'skytree',name:'東京スカイツリー'}]));
  window.__stored=JSON.stringify({favorites,shapes:store.get(keys.shapes),obs:store.get(keys.observations)});
  AstroNotesShooting.candidates=async(plan,entries,deps)=>{await deps.ensure(plan.body);const place={...entries[0].place,latitude:35.722,longitude:139.842,elevation:17,groundManualM:17};delete place.shape;return {rows:[{place,record:entries[0].record,event:{at:plan.at+17*3600000,side:'set',intersects:true,matchMode:'overlap',partId:'__whole'},shapeType:type}],checked:10,failed:window.__partial?1:0,issues:window.__partial?[{reason:'elevation'}]:[]};};
  MyPlacesUI.imported();navigationHistory.pushRoute('#/records');setNotebookTab('points');
 },type);
 await p.locator('[aria-label="合成の線と枠から次に重なる日を探す"]').click();const buttons=p.locator('[data-shape-candidate]');await buttons.first().waitFor();await p.waitForFunction(()=>[...document.querySelectorAll('.shape-next-group button.chip')].every(b=>!b.disabled));
 assert.equal(await buttons.count(),8);
 if(type==='line'&&theme==='light'){
  await p.evaluate(()=>window.__partial=true);await p.locator('.shape-next-group').first().getByRole('button',{name:'さらに先の候補を探す',exact:true}).click();await p.locator('.shape-next-group').first().getByRole('button',{name:'再試行',exact:true}).waitFor();
  assert.match(await p.locator('.shape-next-group').first().innerText(),/確認できていない位置/);
  await p.evaluate(()=>window.__partial=false);await p.locator('.shape-next-group').first().getByRole('button',{name:'この日を未確認のまま次の日から探す',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.shape-next-group [role=status]').textContent.includes('未確認日あり'));
 }
 const first=await buttons.first().evaluate(b=>({...b.dataset}));await p.screenshot({path:out+'/'+type+'-'+theme+'-candidates.png',fullPage:true});await buttons.first().click();
 await p.waitForFunction(at=>globalThis.TrialExplore?.active()&&Math.abs(SkyMapUI.snapshot()?.at-Number(at))<1,first.at);
 const snapshot=await p.evaluate(()=>({sky:SkyMapUI.snapshot(),map:$('exploreMapTab').getAttribute('aria-selected'),overflow:document.documentElement.scrollWidth>innerWidth+1}));
 assert.equal(snapshot.map,'true','shape opens map');assert.equal(snapshot.sky.observer.latitude,Number(first.latitude));assert.equal(snapshot.sky.observer.longitude,Number(first.longitude));assert.equal(snapshot.sky.observer.groundManualM,17);assert.equal(snapshot.overflow,false);
 assert.equal(await p.evaluate(()=>{const keys=AstroNotesLibrary.keys(auth.loginId);return JSON.stringify({favorites,shapes:store.get(keys.shapes),obs:store.get(keys.observations)})===window.__stored;}),true);
 assert.deepEqual(errors,[]);await p.screenshot({path:out+'/'+type+'-'+theme+'-map.png',fullPage:true});results.push({type,theme,at:first.at,latitude:first.latitude,longitude:first.longitude,map:true,unchanged:true,errors});console.log('PASS',type,theme);await c.close();
}
await browser.close();fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));})().catch(async e=>{console.error(e);if(page){console.log(await page.evaluate(()=>({hash:location.hash,text:document.body.innerText.slice(-1800),sky:globalThis.SkyMapUI?.snapshot()})));await page.screenshot({path:out+'/failure.png'});}process.exit(1);});
