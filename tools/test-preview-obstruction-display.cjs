// R02: public observer/time geometry with synthetic obstruction fixtures, not surveyed visibility evidence.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.OBSTRUCTION_BASE||'http://127.0.0.1:8992/trial/index.html';
const out=process.env.OBSTRUCTION_OUT||'/tmp/astronotes-preview-obstruction';
const grants=['records','tower','diamond','pearl','skymap','multiscene'];
const east={id:'east-high',latitude:35.70995,longitude:139.81275,elevation:1.6,eyeM:150,at:'2026-11-25T03:09:00+09:00',target:'skytree'};
const sag={id:'saginuma',latitude:35.58386,longitude:139.56853,elevation:87.2,eyeM:1.5,at:'2026-11-25T16:52:00+09:00',target:'skytree'};

function installTrace(){
 const p=CanvasRenderingContext2D.prototype;
 for(const name of ['setTransform','beginPath','moveTo','lineTo','rect','clip','fill','stroke','fillText','strokeText']){
  const old=p[name];p[name]=function(...a){
   if(name==='setTransform'){this.canvas.__ops=[];this.canvas.__texts=[];}
   if(name==='beginPath')this.__path=[];
   if(['moveTo','lineTo','rect'].includes(name))(this.__path||=[]).push([name,...a]);
   if(['clip','fill','stroke'].includes(name)){
    const ops=this.canvas.__ops||=[];
    ops.push({kind:name,path:(this.__path||[]).map(p=>p.slice()),fill:String(this.fillStyle),stroke:String(this.strokeStyle),alpha:this.globalAlpha,dash:this.getLineDash()});
    if(ops.length>800)ops.shift();
   }
   if(name==='fillText'||name==='strokeText')(this.canvas.__texts||=[]).push(String(a[0]));
   return old.apply(this,a);
  };
 }
}

async function prepare(page,s,mode){
 await page.evaluate(async({s,mode})=>{
  await startupSessionReady;await AstroNotesAssets.ensureModels();
  const t=aimTargetList().find(t=>t.id===s.target);if(!t)throw Error('target missing: '+s.target);
  const eye=s.elevation+s.eyeM,ms=Date.parse(s.at),D=AstroNotesTerrain.distanceKm(s.latitude,s.longitude,t.latitude,t.longitude);
  const az=AstroNotesTerrain.bearing(s.latitude,s.longitude,t.latitude,t.longitude),moon=AstroNotesBodies.state('moon',ms,{...s,elevation:eye});
  // Inverse of the real angle calculation: this synthetic town bisects the real Moon at the public time.
  let low=-1000,high=5000;for(let i=0;i<50;i++){const m=(low+high)/2;if(aimAirAngle(D,eye,m)<moon.apparentAltitude)low=m;else high=m;}
  const m=(low+high)/2;
  window.__obstruction={mode,beyondCalls:0,frontCalls:0,ridgeCalls:0,hiddenCalls:0,townCalls:0,syntheticHeightM:m};
  if(mode==='below-sea'){
   // Synthetic body position isolates clipping: above this high observer's target foot, below the sea horizon.
   // It does not claim that the Moon is observable at this bearing/time in reality.
   const realState=AstroNotesBodies.state;globalThis.AstroNotesBodies={...AstroNotesBodies,state(body,at,obs){const st=realState.call(this,body,at,obs);return body==='moon'&&at===ms?{...st,azimuth:az,apparentAltitude:-1,geometricAltitude:-1}:st;}};
  }
  groundAt=async()=>s.elevation;aimBuildingDays=async()=>[];
  // These are deterministic render inputs. No DEM, PLATEAU or visibility claims are made by this test.
  aimTerrainBeyond=async()=>{__obstruction.beyondCalls++;return Array.from({length:181},(_,i)=>[az-45+i/2,10]);};
  aimTerrainFront=async()=>{__obstruction.frontCalls++;return {ridge:Array.from({length:181},(_,i)=>[az-45+i/2,-.5]),block:null};};
  aimLookRidge=async()=>{__obstruction.ridgeCalls++;return Array.from({length:121},(_,i)=>[az-8+i*16/120,Math.max(0,2.2-Math.abs(i-60)/30)]);};
  AstroNotesCandidatePicker.hiddenView=async()=>{__obstruction.hiddenCalls++;return mode==='missing'?{read:false,note:null}:mode==='town'?{read:true,note:{m,label:'手前の街並み',text:'手前の街並みで、塔の250mから上が見えます。250mより下は隠れます。'}}:{read:true,note:null};};
  AstroNotesCandidatePicker.skylineView=async(_o,_t,azimuths)=>{__obstruction.townCalls++;return azimuths.map((_,i)=>moon.apparentAltitude+Math.sin(i*1.3)*.09);};
  SkyMapUI.workspaceHost().restoreTarget({target:structuredClone(t),custom:false});
  SkyMapUI.workspaceHost().restoreObserver({latitude:s.latitude,longitude:s.longitude,elevation:s.elevation,groundManualM:s.elevation,name:'公開座標・合成遮蔽の検証',eyeHeightAGL:s.eyeM,standAglM:s.eyeM});
  const b=document.getElementById('skyMapBody');b.value='moon';b.dispatchEvent(new Event('change',{bubbles:true}));
  SkyMapUI.setTime(ms);
 },{s,mode});
 await page.locator('#exploreShowResult').click();
 await page.waitForFunction(({s,mode})=>{const h=document.getElementById('aimLook');return h&&!h.hidden&&h._lookLayers?.stats?.frames>0&&h._trialCompositionView&&Math.abs(h._lookAt-Date.parse(s.at))<1000&&h._lookSpec.eyeM===s.eyeM&&(mode==='mountain'?__obstruction.ridgeCalls>0:__obstruction.hiddenCalls>0)&&(mode!=='town'||__obstruction.townCalls>0);},{s,mode});
 if(mode==='mountain'){
  // The trial camera sheet owns the visible lens controls; use the renderer's existing change handler
  // to set this fixture's wide frame, keeping camera-sheet interaction outside this drawing regression.
  await page.evaluate(()=>{const input=document.querySelector('#aimLook [data-lens-focal]');input.value='35';input.onchange();});
 }
 await page.waitForTimeout(250);
}

async function measure(page){return page.evaluate(()=>{
 const h=document.getElementById('aimLook'),v=h._trialCompositionView,cv=h.querySelector('[data-look-canvas]'),layers=h._lookLayers,spec=h._lookSpec;
 const state=AstroNotesBodies.state('moon',h._lookAt,{...spec.obs,elevation:spec.obs.elevation+spec.eyeM});
 const xy=AstroNotesAlign.viewProjector(v.win.az0,v.win.alt0)(state.azimuth,state.apparentAltitude),off=h._lensOffset||[0,0];
 const moon=xy?{x:v.W/2+xy[0]*v.k+off[0]*v.W,y:v.H/2-xy[1]*v.k+off[1]*v.H,r:state.angularRadius*v.k}:null;
 const data=layers.body.getContext('2d').getImageData(0,0,layers.body.width,layers.body.height).data,dpr=layers.body.width/v.W;
 let moonOpaque=0,bodyOpaque=0;for(let y=0;y<layers.body.height;y++)for(let x=0;x<layers.body.width;x++){if(data[(y*layers.body.width+x)*4+3]>200){bodyOpaque++;if(moon&&Math.hypot(x/dpr-moon.x,y/dpr-moon.y)<moon.r+1)moonOpaque++;}}
 const buildingOps=layers.buildings.__ops||[],bodyOps=layers.body.__ops||[];
 const shadow=buildingOps.find(o=>o.kind==='fill'&&/rgba\(4,\s*6,\s*12,\s*0\.62\)/.test(o.fill));
 const townClip=bodyOps.find(o=>o.kind==='clip'&&o.path.length>20);
 const groundStrokes=buildingOps.filter(o=>o.kind==='stroke'&&o.stroke==='#b8c8dd');
 return {fixture:{...__obstruction},spec:{latitude:spec.obs.latitude,longitude:spec.obs.longitude,elevation:spec.obs.elevation,eyeM:spec.eyeM},at:h._lookAt,moon,moonAltitude:state.apparentAltitude,seaAngle:AstroNotesAstro.seaHorizonAngle(spec.obs.elevation+spec.eyeM,{k:AstroNotesAtmosphere.targetK()}),moonOpaque,bodyOpaque,shadow,townClip,groundStrokes,canvasTexts:[...new Set(cv.__texts||[])],aria:cv.getAttribute('aria-label'),note:h.querySelector('[data-look-note]').textContent,sceneBottom:h._lookSceneBottom,frameTimes:h.querySelector('[data-look-frame-times]').textContent,version:document.querySelector('meta[name=app-version]')?.content};
});}

function checkCommon(r,s){
 assert.deepEqual(r.spec,{latitude:s.latitude,longitude:s.longitude,elevation:s.elevation,eyeM:s.eyeM});
 assert.equal(r.at,Date.parse(s.at));
 assert(!r.canvasTexts.some(t=>/手前の街並み|から上が見えます|より下は隠れます|水平線|遠くの山並み/.test(t)),'normal obstruction/horizon explanations are absent from the drawing: '+r.canvasTexts);
}

(async()=>{
 fs.mkdirSync(out,{recursive:true});const results=[];
 for(const [engine,type] of [['chrome',chromium],['webkit',webkit]].filter(([e])=>(process.env.OBSTRUCTION_ENGINE||'chrome,webkit').split(',').includes(e))){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{
   for(const [s,mode] of [[east,'clear'],[{...east,id:'east-synthetic-below-sea'},'below-sea'],[sag,'clear'],[{...sag,id:'saginuma-town'},'town'],[{...east,id:'missing'},'missing'],[{...sag,id:'mountain',target:'fuji'},'mountain']]){
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,locale:'ja-JP',timezoneId:'Asia/Tokyo',reducedMotion:'reduce',colorScheme:'dark'});
    await context.addInitScript(t=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-ui',loginId:'obstruction-display',tools:t})),grants);
    await context.addInitScript(installTrace);
    let writesBlocked=0,externalBlocked=0;
    await context.route('**/*',r=>{const u=new URL(r.request().url());if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(r.request().method()))writesBlocked++;return r.fulfill({json:{allowed:true,tool:'skymap',loginId:'obstruction-display',tools:grants,favorites:[],sightings:[],records:[],rev:1}});}if(u.origin===new URL(base).origin)return r.continue();externalBlocked++;return r.abort();});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);
    const row={engine,id:s.id,mode,base,fixtureNotice:'Public observer/time geometry; synthetic obstruction and terrain, not measured visibility.'};
    try{
     await page.goto(base+'#/explore');await page.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof aimTargetList==='function'&&typeof AstroNotesAssets==='object'&&AstroNotesAssets.modelsReady());
     await prepare(page,s,mode);Object.assign(row,await measure(page),{writesBlocked,externalBlocked,errors});
     await page.locator('#aimLook').screenshot({path:out+'/'+engine+'-'+s.id+'.png'});
     const canvasPng=await page.locator('#aimLook [data-look-canvas]').evaluate(c=>c.toDataURL('image/png').split(',')[1]);fs.writeFileSync(out+'/'+engine+'-'+s.id+'-canvas.png',Buffer.from(canvasPng,'base64'));
     assert.equal(await page.locator('#exploreStreetPhoto').count(),0,'redundant street photo action is removed');
     const map=page.locator('#exploreExternalMap');await map.waitFor({state:'visible'});
     row.map={href:await map.getAttribute('href'),target:await map.getAttribute('target'),label:await map.getAttribute('aria-label')};
     assert.match(row.map.href,new RegExp(s.latitude.toFixed(7)));assert.match(row.map.href,new RegExp(s.longitude.toFixed(7)));assert.equal(row.map.target,'_blank');
     checkCommon(row,s);
     if(mode!=='mountain')assert.equal(row.fixture.beyondCalls,0,'building previews do not fetch the synthetic high far horizon');
     if(mode==='clear')assert(row.moonOpaque>4,'the real Moon remains visible, including its minimum-size disc in the wide near-tower view: '+JSON.stringify(row.moon));
     if(s.id==='east-high')assert.equal(row.groundStrokes.length,0,'the high observer diagram has no added horizontal horizon line');
     if(mode==='below-sea'){assert(row.moonAltitude<row.seaAngle,'synthetic Moon is below the sea horizon');assert(row.moonOpaque>4,'tower diagram does not clip the synthetic Moon at the far sea horizon');}
     if(mode==='town'){
      assert(row.shadow,'semi-transparent town shadow is drawn');assert(row.townClip,'the stepped town contour clips the body layer');
      assert.equal(row.groundStrokes.length,0,'town edge is not covered by a straight ground/horizon line');
      assert.deepEqual(row.shadow.path.slice(1,-1),row.townClip.path.slice(1,-1),'shadow and body clipping use exactly the same town edge');
      assert(new Set(row.shadow.path.filter(p=>p[0]==='lineTo').map(p=>p[2].toFixed(3))).size>5,'town edge keeps its uneven heights');
      const clear=results.find(r=>r.engine===engine&&r.id==='saginuma');
      assert(row.moonOpaque>20&&row.moonOpaque<clear.moonOpaque*.9,'town hides part of the Moon, preserving the visible part: '+row.moonOpaque+'/'+clear.moonOpaque);
      assert.match(row.aria,/手前の街並み.*から上が見えます.*より下は隠れます/,'the omitted diagram explanation remains accessible');
     }
     if(mode==='missing')assert(row.canvasTexts.includes('手前の地形は未確認'),'failed obstruction read remains visible');
     if(mode==='mountain'){assert(row.canvasTexts.includes('水平（0°）'),'mountain keeps its horizontal reference');assert(row.groundStrokes.some(o=>o.dash.join(',')==='5,4'),'the mountain reference remains dashed');}
     assert.deepEqual(errors,[]);assert.equal(writesBlocked,0,'viewing does not attempt to write user data');
     row.passed=true;results.push(row);fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS',engine,s.id,'moon',row.moonOpaque,'texts',JSON.stringify(row.canvasTexts));
    }catch(e){row.error=String(e);row.errors=errors;fs.writeFileSync(out+'/'+engine+'-'+s.id+'-failure.json',JSON.stringify(row,null,2));await page.screenshot({path:out+'/'+engine+'-'+s.id+'-failure.png',fullPage:true}).catch(()=>{});throw e;}
    finally{await context.close();}
   }
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
