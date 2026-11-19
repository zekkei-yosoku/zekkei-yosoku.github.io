// Real app display + actual GSI Hongo tile, with deterministic reverse responses.
// No account data or saved records are changed; the displayed event is a fixture.
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.PLACE_CONTEXT_BASE||'http://127.0.0.1:8996/trial/index.html',out=process.env.PLACE_CONTEXT_OUT||'/tmp/astro-place-context';
(async()=>{
 fs.mkdirSync(out,{recursive:true});const results=[];
 for(const [name,type]of[['chrome',chromium],['webkit',webkit]])for(const width of[320,390]){
  const browser=await type.launch(name==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{
   const page=await browser.newPage({viewport:{width,height:850},colorScheme:'dark'}),errors=[];let roads=0,delayFacilities=false,releaseFacilities;
   const facilityGate=new Promise(r=>releaseFacilities=r);
   await page.route('**/osm-places/*.json.gz?**',async r=>{if(delayFacilities)await Promise.race([facilityGate,new Promise(done=>setTimeout(done,5000))]);return r.continue();});
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
   delayFacilities=true;
   const reported=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/recorded-facilities.json'))).map(x=>x.place);
   const first=await page.evaluate(async places=>{
    const host=document.createElement('section');host.id='reportedFacilities';document.body.append(host);
    const {row,plan}=contextFixture;window.reportedRows=places.map(p=>({...row,place:{...p,elevation:p.groundM,eyeHeightAGL:p.eyeM},event:{...row.event},assumedObserver:{latitude:p.latitude,longitude:p.longitude,elevation:p.groundM,eyeM:p.eyeM}}));
    window.reportedOriginal=JSON.stringify(reportedRows);await AstroNotesCandidatePicker.renderRecorded(host,reportedRows,plan,{select:()=>{}});
    window.reportedButtons=[...host.querySelectorAll('button')];reportedButtons[0].focus();
    return [...host.querySelectorAll('[data-place-kind]')].map(n=>n.textContent);
   },reported);
   releaseFacilities();console.log('initial facilities',name,width,first);
   assert.equal(first.length,3,'all rows commit before facility meshes arrive');
   assert.equal(first[0],'種類未確認');assert.equal(first[1],'公園');assert.equal(first[2],'種類未確認');
   await page.waitForFunction(()=>[...document.querySelectorAll('#reportedFacilities [data-place-kind]')].every(n=>n.textContent==='公園')).catch(async e=>{console.error(await page.evaluate(()=>({text:document.getElementById('reportedFacilities').innerText,errors:JSON.parse(localStorage.getItem('astronotes.trial.errors')||'[]'),parser:typeof AstroNotesCandidateDiscovery.createPlaceProvider.parseElements})));throw e;});
   const reuse=await page.evaluate(async()=>{
    const host=document.getElementById('reportedFacilities');const same=reportedButtons.every((b,i)=>b===host.querySelectorAll('button')[i]),focused=document.activeElement===reportedButtons[0];
    const notes=document.createElement('section');notes.id='reportedFacilitiesNotes';document.body.append(notes);await AstroNotesCandidatePicker.renderRecorded(notes,reportedRows,contextFixture.plan,{select:()=>{},context:true,heading:()=> '11/20(金)'});
    return {same,focused,unmodified:JSON.stringify(reportedRows)===reportedOriginal,kinds:[...notes.querySelectorAll('[data-place-kind]')].map(n=>n.textContent)};
   });
   assert(reuse.same&&reuse.focused&&reuse.unmodified);assert.deepEqual(reuse.kinds,['公園','公園','公園']);assert.equal(roads,1,'known facilities do not request a road tile');
   await page.locator('#reportedFacilities').screenshot({path:path.join(out,name+'-'+width+'-facilities.png')});
   assert.deepEqual(errors,[]);results.push({name,width,version:initial.version,passage:initial.passage,roads,delayedKind:true,naming:true,reused:true,exactSelection:true,reportedFacilities:3,facilityKindsShared:true});console.log('PASS '+name+' '+width+' place context');
  }finally{await browser.close();}
 }
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
