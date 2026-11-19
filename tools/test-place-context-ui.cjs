// Real app display + actual GSI Hongo tile, with deterministic reverse responses.
// No account data or saved records are changed; the displayed event is a fixture.
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.PLACE_CONTEXT_BASE||'http://127.0.0.1:8996/trial/index.html',out=process.env.PLACE_CONTEXT_OUT||'/tmp/astro-place-context';
(async()=>{
 fs.mkdirSync(out,{recursive:true});const results=[];
 for(const [name,type]of[['chrome',chromium],['webkit',webkit]])for(const width of[320,390]){
  const browser=await type.launch(name==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{
   const page=await browser.newPage({viewport:{width,height:850},colorScheme:'dark'}),errors=[];let roads=0;
   page.on('pageerror',e=>errors.push(e.message));
   await page.route(/(?:zekkei-api|localhost:8787)/,r=>r.fulfill({status:503,json:{}}));
   await page.route('https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/16/**',r=>{roads++;return r.fulfill({body:fs.readFileSync(path.join(__dirname,'fixtures/gsi-road-hongo.pbf')),contentType:'application/x-protobuf'});});
   await page.route('https://nominatim.openstreetmap.org/reverse?**',r=>{
    const u=new URL(r.request().url()),street=Number(u.searchParams.get('lat'))>35.708;
    return r.fulfill({json:{address:{road:street?'目白通り':'本郷区道第123号',neighbourhood:'本郷二丁目',city:'文京区','ISO3166-2-lvl4':'JP-13'}}});
   });
   await page.goto(base);await page.waitForFunction(()=>globalThis.AstroNotesCandidatePicker?.renderRecorded&&globalThis.AstroNotesAlign?.geometryFrom);
   const initial=await page.evaluate(async()=>{
    const p={id:'hongo-fixture',name:'本郷',subtitle:'東京都文京区本郷二丁目',latitude:35.70730860834253,longitude:139.75974230531398,elevation:21.8,eyeHeightAGL:1.5};
    const t=AstroNotesAlign.TARGETS.find(t=>t.id==='skytree'),g=id=>AstroNotesAlign.geometryFrom(p,t,{partId:id}),tip=g('tip'),deck=g('deck');
    const row={place:p,record:{},event:{at:1798462978473.7598,altitude:deck.angle,azimuth:deck.azimuth,targetAltitude:tip.angle,radius:.25,partId:'__whole',matchMode:'overlap'},body:'moon',target:t};
    const host=document.createElement('section');host.id='placeContextFixture';host.style.cssText='position:fixed;top:80px;left:12px;right:12px;z-index:99999;padding:12px;background:var(--card)';
    document.body.append(host);window.contextFixture={host,row,plan:{target:t,body:'moon',partId:'__whole',matchMode:'overlap'},selected:null};
    await AstroNotesCandidatePicker.renderRecorded(host,[row],contextFixture.plan,{select:r=>contextFixture.selected=r});
    return {kind:host.querySelector('[data-place-kind]').textContent,passage:host.querySelector('[data-candidate-passage]').textContent,version:document.querySelector('meta[name="app-version"]').content};
   });
   assert.equal(initial.kind,'種類未確認','the list commits before background road context');assert.equal(initial.passage,'天望デッキ付近を通過');
   await page.waitForFunction(()=>document.querySelector('#placeContextFixture [data-place-kind]')?.textContent==='道路・歩道');
   const naming=await page.evaluate(async()=>{
    const plain=await nearName(35.707309,139.759742),street=await nearName(35.709,139.759742);
    const {host,row,plan}=contextFixture;window.contextButton=host.querySelector('button');contextButton.focus();
    await AstroNotesCandidatePicker.renderRecorded(host,[row],plan,{select:r=>contextFixture.selected=r});
    return {plain,street,sameButton:host.querySelector('button')===contextButton,focus:document.activeElement===contextButton};
   });
   assert.equal(naming.plain.name,'東京都文京区本郷二丁目');assert.equal(naming.plain.subtitle,'');assert.equal(naming.street.name,'目白通り');assert.equal(naming.street.subtitle,'東京都文京区本郷二丁目');
   assert(naming.sameButton&&naming.focus);assert.equal(roads,1);
   await page.locator('#placeContextFixture button').click();assert(await page.evaluate(()=>contextFixture.selected===contextFixture.row));
   await page.locator('#placeContextFixture').screenshot({path:path.join(out,name+'-'+width+'.png')});
   assert.deepEqual(errors,[]);results.push({name,width,version:initial.version,passage:initial.passage,roads,delayedKind:true,naming:true,reused:true,exactSelection:true});console.log('PASS '+name+' '+width+' place context');
  }finally{await browser.close();}
 }
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
