// Synthetic UI checks. Production API/storage never receives requests.
const {chromium}=require('playwright'),fs=require('fs'),assert=require('assert/strict');
const base=process.env.PLUS_CODE_CHECK_BASE||'http://127.0.0.1:8863/';
const out=process.env.PLUS_CODE_CHECK_OUT||'/tmp/astronotes-plus-code/ui';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true}),checks=[];
 for(const width of (process.env.PLUS_CODE_CHECK_WIDTHS||'320,390,1280').split(',').map(Number))for(const theme of ['light','dark']){
  const tools=['diamond','pearl','tower','skymap','plane','iss','records'];
  const ctx=await browser.newContext({viewport:{width,height:900},isMobile:width<500,hasTouch:width<500,colorScheme:theme});let fail=false,geo=[];
  await ctx.addInitScript(({tools,theme})=>{sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-ui-audit',loginId:'owner-test',role:'user',ownerAdmin:true,tools}));localStorage.setItem('sorami.theme',theme);},{tools,theme});
  await ctx.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
  await ctx.route(/zekkei-api\.okayu-sorami\.workers\.dev|localhost:8787/,r=>{const path=new URL(r.request().url()).pathname;return r.fulfill({status:path.startsWith('/prediction')?503:200,json:path==='/me'?{loginId:'owner-test',role:'user',ownerAdmin:true,tools}:path==='/sync'?{favorites:[],sightings:[],rev:0}:path.includes('/access')?{allowed:true,tools}:{}});});
  await ctx.route(/msearch\.gsi\.go\.jp|nominatim\.openstreetmap\.org/,r=>{geo.push(r.request().url());if(fail===true||fail==='osm'&&r.request().url().includes('nominatim'))return r.abort();return r.fulfill({json:r.request().url().includes('msearch')?[]:[{name:'横浜市',lat:'35.4437',lon:'139.638',display_name:'横浜市, 神奈川県, 日本',type:'city',addresstype:'city'},{name:'横浜市',lat:'37.4',lon:'-122.1',display_name:'同名の別地域, USA',type:'city',addresstype:'city'}]});});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);await page.goto(base);await page.waitForTimeout(400);
  const search=async(text,field='searchBox',host='searchResults')=>{await page.locator('#'+field).fill(text);await page.locator('#'+field+'Go').click();await page.waitForFunction(id=>!document.getElementById(id).hasAttribute('aria-busy'),host);};
  const capture=async(name)=>{await page.screenshot({path:out+'/'+width+'-'+theme+'-'+name+'.png'});const overflow=await page.evaluate(()=>[...document.querySelectorAll('dialog[open]')].some(e=>e.scrollWidth>e.clientWidth+2));assert.equal(overflow,false,name+' overflow');};
  await page.evaluate(()=>openPlaceSheet('almanac'));
  await search('８４９ｖｃｗｃ８＋ｒ９');assert.equal(geo.length,0);assert.match(await page.locator('#searchResults').innerText(),/849VCWC8\+R9/);assert.match(await page.locator('#searchResults').innerText(),/区画の中心/);await capture('full');
  const expected=await page.evaluate(()=>OpenLocationCode.decode('849VCWC8+R9'));await page.locator('#searchResults [data-sr]').click();await page.waitForFunction(()=>!document.getElementById('placeSheet').open);const selected=await page.evaluate(()=>({latitude:almanacPoint.latitude,longitude:almanacPoint.longitude}));assert.equal(selected.latitude,expected.latitudeCenter);assert.equal(selected.longitude,expected.longitudeCenter);
  await page.evaluate(()=>openPlaceSheet('almanac'));await search('CWC8+R9');assert.match(await page.locator('#searchResults').innerText(),/地域名が必要/);assert.equal(geo.length,0);await capture('short-without-locality');
  await search('849VCWC8+I9');assert.match(await page.locator('#searchResults').innerText(),/読めません/);assert.equal(geo.length,0);
  await page.locator('#searchBox').fill('CWC8+R9 横浜市');await page.waitForTimeout(250);assert.equal(geo.length,0);await page.locator('#searchBoxGo').click();await page.waitForFunction(()=>document.querySelectorAll('#searchResults [data-sr]').length===2);assert.ok(geo.every(u=>!u.includes('CWC8')&&!u.includes('countrycodes')));assert.match(await page.locator('#searchResults').innerText(),/基準の地名：横浜市/);await capture('short-with-locality');
  await page.locator('#searchBox').fill('');assert.equal(await page.locator('#searchResults').innerText(),'');
  fail='osm';await search('CWC8+R9 接続失敗テスト');assert.match(await page.locator('#searchResults').innerText(),/接続できません/);await capture('lookup-failed');fail=false;
  await page.locator('#mapButton').click();await search('849VCWC8+R9','mapSearch','mapSearchResults');await page.locator('#mapSearchResults [data-sr]').click();const center=await page.evaluate(()=>MapPick.center());assert.ok(Math.abs(center.latitude-expected.latitudeCenter)<1e-8);assert.ok(Math.abs(center.longitude-expected.longitudeCenter)<1e-8);await capture('map-adjustment');
  await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
  await page.evaluate(()=>AstroTargetPicker.open($('aimTarget'),null,$('previewTargetOpen')));await page.locator('[data-target-new]').click();await search('849VCWC8+R9','targetPlaceSearch','targetPlaceResults');await page.locator('#targetPlaceResults [data-sr]').click();assert.match(await page.locator('[data-target-name]').inputValue(),/849VCWC8\+R9/);await capture('target');
  await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
  await page.evaluate(()=>MyPlacesUI.openPlace(null,'records'));await page.locator('#myPlaceName').click();await search('849VCWC8+R9','shapePlaceSearch','shapePlaceResults');await page.locator('#shapePlaceResults [data-sr]').click();await capture('shape');
  await search('BOOK+CAFE','shapePlaceSearch','shapePlaceResults');assert.ok(geo.some(u=>new URL(u).searchParams.get('q')==='BOOK+CAFE'));assert.doesNotMatch(await page.locator('#shapePlaceResults').innerText(),/Plus Codeを読めません/);
  assert.deepEqual(errors,[]);checks.push({width,theme,selection:selected,geoRequests:geo.length,errors});console.log('PASS',width,theme);await ctx.close();
 }
 await browser.close();fs.writeFileSync(out+'/results.json',JSON.stringify(checks,null,2));
})().catch(e=>{console.error(e);process.exit(1)});
