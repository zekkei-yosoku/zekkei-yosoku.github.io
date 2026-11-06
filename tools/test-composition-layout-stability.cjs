// Real trial renderer and surface picking; synthetic account/terrain, no external writes.
require('./no-open-meteo.cjs');
const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.COMPOSITION_STABILITY_BASE||'http://127.0.0.1:8992/trial/index.html';
const out=process.env.COMPOSITION_STABILITY_OUT||'/tmp/astronotes-composition-layout-stability';
const values=(name,fallback)=>(process.env[name]||fallback).split(',');
const tools=['records','tower','diamond','pearl','skymap','multiscene'];
fs.mkdirSync(out,{recursive:true});
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function geometry(page,label){return page.evaluate(label=>{
 const rect=node=>{const r=node.getBoundingClientRect();return {top:r.top,left:r.left,width:r.width,height:r.height};};
 const host=document.getElementById('aimLook'),note=host.querySelector('.trial-composition-status')||document.querySelector('#trialComposition [role=status]');
 return {label,scrollY,canvas:rect(host.querySelector('[data-look-canvas]')),figure:rect(host.querySelector('.aim-look-figure')),panel:rect(document.getElementById('trialComposition')),tools:rect(host.querySelector('.preview-figure-tools')),plan:AstroNotesTrialComposition.plan(),note:{text:note?.textContent||'',visible:!!note&&!note.hidden&&note.getClientRects().length>0,inFigure:!!note?.closest('.aim-look-figure'),rect:note?rect(note):null}};
 },label);}
function shifts(reference,sample){const diffs=[];for(const key of ['canvas','figure','panel','tools'])for(const dimension of ['top','left','width','height'])if(Math.abs(reference[key][dimension]-sample[key][dimension])>.6)diffs.push(`${sample.label}:${key}.${dimension} ${reference[key][dimension]} -> ${sample[key][dimension]}`);if(Math.abs(reference.scrollY-sample.scrollY)>.6)diffs.push(`${sample.label}:scrollY ${reference.scrollY} -> ${sample.scrollY}`);return diffs;}
async function points(page){return page.evaluate(()=>{
 const h=document.getElementById('aimLook'),v=h._trialCompositionView,s=SkyMapUI.selectionState(),obs={...v.spec.obs,eyeM:v.spec.eyeM},r=v.cv.getBoundingClientRect(),off=h._lensOffset||[0,0];
 const screen=(x,y)=>({x:r.left+x*r.width/v.W,y:r.top+y*r.height/v.H});
 const pickAt=p=>{const x=(p.x-r.left)*v.W/r.width,y=(p.y-r.top)*v.H/r.height,a=AstroNotesAlign.viewUnprojector(v.win.az0,v.win.alt0)((x-off[0]*v.W-v.W/2)/v.k,(v.H/2-y+off[1]*v.H)/v.k);return a&&AstroNotesTrialSurface.pick({azimuth:a[0],altitude:a[1],obs,target:s.target,align:AstroNotesAlign,limb:'center'});};
 const g=AstroNotesCandidateComposition.geometry(obs,s.target,{heightM:452,xM:0,limb:'center'},AstroNotesAlign),xy=AstroNotesAlign.viewProjector(v.win.az0,v.win.alt0)(g.azimuth,g.angle),valid=screen(v.W/2+xy[0]*v.k+off[0]*v.W,v.H/2-xy[1]*v.k+off[1]*v.H);
 let invalid=null;for(const u of [.12,.88,.25,.75]){const candidate=screen(v.W*u,(valid.y-r.top)*v.H/r.height);if(!pickAt(candidate)){invalid=candidate;break;}}
 if(!pickAt(valid)||!invalid)throw Error('Fixture needs a visible surface and empty sky');
 return {valid,invalid,expected:pickAt(valid)};
 });}
async function boot(page,theme){
 await page.goto(base+'#/explore');await page.waitForFunction(()=>typeof SkyMapUI==='object'&&typeof AstroNotesTrialComposition==='object');
 await page.evaluate(async theme=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>1.01;aimBuildingDays=async()=>[];document.documentElement.dataset.theme=theme;navigationHistory.pushRoute('#/explore');SkyMapUI.setTarget('skytree');const input=document.getElementById('skyMapBody');input.value='moon';input.onchange();SkyMapUI.setTime(Date.parse('2026-11-29T12:00:00+09:00'));SkyMapUI.setObserver({id:'reference',name:'構図の参考位置',latitude:35.7119003406,longitude:139.8088988752,elevation:1.01,groundManualM:1.01,standAglM:1.5});},theme);
 await page.locator('#exploreShowResult').click();await page.locator('#trialComposition').waitFor({state:'visible'});
 await page.waitForFunction(()=>{const h=document.getElementById('aimLook'),s=SkyMapUI.selectionState();return !document.querySelector('#exploreScenePanel').hasAttribute('data-loading')&&!h.hidden&&h._trialCompositionView&&Math.abs(h._lookAt-s.at)<1000&&Math.abs(h._lookSpec.obs.latitude-s.observer.latitude)<1e-8;});
}
(async()=>{
 const results=[];
 for(const [engine,type] of [['chrome',chromium],['webkit',webkit]].filter(([name])=>values('COMPOSITION_STABILITY_ENGINE','chrome,webkit').includes(name))){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{for(const width of values('COMPOSITION_STABILITY_WIDTH','320,390').map(Number))for(const theme of values('COMPOSITION_STABILITY_THEME','light,dark')){
   const context=await browser.newContext({viewport:{width,height:844},colorScheme:theme,locale:'ja-JP',timezoneId:'Asia/Tokyo',reducedMotion:'reduce'});let writes=0;const errors=[],samples=[],result={engine,width,theme,base,samples};
   await context.addInitScript(tools=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-layout-stability',loginId:'layout-stability-test',tools})),tools);
   await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===new URL(base).origin)return route.continue();if(/zekkei-api|localhost:8787/.test(u.origin)){if(!['GET','OPTIONS'].includes(route.request().method()))writes++;return route.fulfill({json:{allowed:true,tool:'skymap',loginId:'layout-stability-test',tools,favorites:[],sightings:[],records:[],rev:1}});}return route.abort();});
   const page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));
   const name=`${engine}-${width}-${theme}`;
   try{
    await boot(page,theme);
    const saved=await page.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()}));
    const selection=await page.evaluate(()=>JSON.stringify(SkyMapUI.selectionState()));
    const edit=page.getByRole('button',{name:'重ねる位置を指定',exact:true}),canvas=page.locator('#aimLook [data-look-canvas]');
    await edit.click();await canvas.scrollIntoViewIfNeeded();await frames(page);const target=await points(page);result.target=target;
    await page.evaluate(()=>{window.compositionPointerTrace=[];window.traceCompositionPointer=event=>{if(!event.target.matches('[data-look-canvas]'))return;queueMicrotask(()=>{const plan=AstroNotesTrialComposition.plan();compositionPointerTrace.push({type:event.type,invalid:plan.compositionInvalid,composition:plan.composition});});};for(const type of ['pointerdown','pointermove','pointerup'])window.addEventListener(type,traceCompositionPointer,true);});
    await page.mouse.move(target.valid.x,target.valid.y);await page.mouse.down();await frames(page);samples.push(await geometry(page,'valid-start'));
    await page.screenshot({path:out+'/'+name+'-valid.png'});
    for(let i=0;i<4;i++){
     await page.mouse.move(target.invalid.x,target.invalid.y,{steps:8});await frames(page);samples.push(await geometry(page,'invalid-'+i));if(!i){await page.screenshot({path:out+'/'+name+'-invalid.png'});await page.evaluate(()=>{window.repeatedCompositionErrors=0;window.compositionErrorObserver=new MutationObserver(records=>repeatedCompositionErrors+=records.length);compositionErrorObserver.observe(document.querySelector('.trial-composition-status')||document.querySelector('#trialComposition [role=status]'),{childList:true,characterData:true,subtree:true});});await page.mouse.move(target.invalid.x+2,target.invalid.y);await page.mouse.move(target.invalid.x,target.invalid.y);await frames(page);result.repeatedErrorDomUpdates=await page.evaluate(()=>{compositionErrorObserver.disconnect();return repeatedCompositionErrors;});}
     await page.mouse.move(target.valid.x,target.valid.y,{steps:8});await frames(page);samples.push(await geometry(page,'valid-'+i));
    }
    await page.mouse.up();await frames(page);samples.push(await geometry(page,'pointer-up'));
    result.layoutChanges=samples.flatMap(sample=>shifts(samples[0],sample));
    result.samePoint=samples.filter(sample=>sample.label.startsWith('valid')||sample.label==='pointer-up').every(sample=>!sample.plan.compositionInvalid&&['heightM','eastM','northM'].every(k=>Math.abs(sample.plan.composition[k]-samples[0].plan.composition[k])<.02));
    result.pointerTrace=await page.evaluate(()=>{for(const type of ['pointerdown','pointermove','pointerup'])window.removeEventListener(type,traceCompositionPointer,true);return compositionPointerTrace;});
    let lastValid=null;result.invalidPreservesPoint=result.pointerTrace.every(sample=>{if(!sample.invalid){lastValid=JSON.stringify(sample.composition);return true;}return lastValid!==null&&JSON.stringify(sample.composition)===lastValid;});
    assert(samples.filter(sample=>sample.label.startsWith('invalid')).every(sample=>sample.plan.compositionInvalid&&sample.note.visible&&/面/.test(sample.note.text)),'empty sky has an identifiable invalid state');
    fs.writeFileSync(out+'/'+name+'-metrics.json',JSON.stringify(result,null,2));
    assert.deepEqual(result.layoutChanges,[],'surface/sky switching must not move diagram, panel, tools or page');assert(result.samePoint,'same screen position must select the same surface point');assert(result.invalidPreservesPoint,'empty sky is invalid and does not overwrite the last surface');
    assert.equal(result.repeatedErrorDomUpdates,0,'repeating the same error does not rewrite the live status');
    assert(samples.filter(sample=>sample.label.startsWith('invalid')).every(sample=>sample.note.inFigure&&sample.note.rect.left>=sample.figure.left-.6&&sample.note.rect.top>=sample.figure.top-.6&&sample.note.rect.left+sample.note.rect.width<=sample.figure.left+sample.figure.width+.6&&sample.note.rect.top+sample.note.rect.height<=sample.figure.top+sample.figure.height+.6),'errors stay inside the diagram');
    assert(samples.filter(sample=>sample.label.startsWith('invalid')).every(sample=>{const a=sample.note.rect,b=sample.tools;return a.left+a.width<=b.left+.6||b.left+b.width<=a.left+.6||a.top+a.height<=b.top+.6||b.top+b.height<=a.top+.6;}),'status does not cover the diagram tools');
    assert(!/指定位置：|図の形状には推定|この指定は追加/.test(await page.locator('#trialComposition').innerText()),'normal redundant explanations are absent');
    // Escape ends a held drag; later movement cannot mutate the retained point.
    await page.mouse.move(target.valid.x,target.valid.y);await page.mouse.down();await canvas.press('Escape');await page.mouse.up();await edit.click();await canvas.scrollIntoViewIfNeeded();await frames(page);
    const escaped=await page.evaluate(()=>JSON.stringify(AstroNotesTrialComposition.plan()));await page.mouse.move(target.invalid.x,target.invalid.y);await frames(page);assert.equal(await page.evaluate(()=>JSON.stringify(AstroNotesTrialComposition.plan())),escaped,'Escape clears the old drag');
    // Numeric invalidity remains identifiable; correcting the preset restores a valid surface.
    const details=page.locator('#trialComposition details');await details.locator('summary').click();const input=page.getByLabel('重ねる対象の高さ（地上からm）',{exact:true});
    await input.scrollIntoViewIfNeeded();await frames(page);const numericBefore=await geometry(page,'numeric-before');await input.fill('800');await input.dispatchEvent('change');await frames(page);const numericInvalid=await geometry(page,'numeric-invalid');
    assert(numericInvalid.plan.compositionInvalid);assert.equal(await input.inputValue(),'800');assert(numericInvalid.note.visible&&numericInvalid.note.inFigure);assert.deepEqual(shifts(numericBefore,numericInvalid),[],'numeric error must not insert layout content');
    for(const field of [input,page.getByLabel('対象の中心から左右の位置（m）',{exact:true})]){assert.equal(await field.getAttribute('aria-invalid'),'true');assert.equal(await field.getAttribute('aria-describedby'),'trialCompositionStatus');}
    await canvas.press('Escape');assert.equal(await page.evaluate(()=>AstroNotesTrialComposition.plan().compositionInvalid),true);assert(await page.locator('#trialCompositionStatus').isVisible(),'invalid error remains available after ending editing');await edit.click();await details.locator('summary').click();
    await page.getByRole('button',{name:'先端',exact:true}).click();await frames(page);assert.equal(await page.evaluate(()=>AstroNotesTrialComposition.plan().compositionInvalid),false);assert.equal(await input.getAttribute('aria-invalid'),'false');
    await page.getByLabel('天体の合わせる位置',{exact:true}).selectOption('lower');assert.equal(await page.evaluate(()=>AstroNotesTrialComposition.plan().composition.limb),'lower');
    await details.locator('summary').click();await page.getByRole('button',{name:'指定を終了',exact:true}).click();const retained=await page.evaluate(()=>JSON.stringify(AstroNotesTrialComposition.plan()));await edit.click();assert.equal(await page.evaluate(()=>JSON.stringify(AstroNotesTrialComposition.plan())),retained,'ending and reopening preserves the chosen surface');
    assert.equal(await page.evaluate(()=>JSON.stringify(SkyMapUI.selectionState())),selection);
    await page.getByRole('button',{name:'指定を終了',exact:true}).click();await page.locator('#exploreBackToCandidates').click();await page.locator('#exploreShowResult').click();await page.locator('#trialComposition').waitFor({state:'visible'});await frames(page);assert.equal(await page.locator('#aimLook .trial-composition-status').count(),1,'returning to the preview does not duplicate status');assert.equal(await page.evaluate(()=>JSON.stringify(AstroNotesTrialComposition.plan())),retained,'preview reentry preserves the selected surface');
    assert.equal(await page.evaluate(()=>JSON.stringify({favorites,records:MyPlacesUI.load(),schedule:schedule().list()})),saved);assert.equal(writes,0);assert.deepEqual(errors,[]);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await canvas.scrollIntoViewIfNeeded();await page.screenshot({path:out+'/'+name+'-final.png'});
    Object.assign(result,{passed:true,savedDataUnchanged:true,selectionUnchanged:true,escapeStopsDrag:true,numericInvalidAndPresetRecovery:true,reentryPreservesPoint:true,writes,errors});results.push(result);fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS',name);
   }catch(error){Object.assign(result,{passed:false,writes,errors,error:String(error)});fs.writeFileSync(out+'/'+name+'-failure.json',JSON.stringify(result,null,2));await page.screenshot({path:out+'/'+name+'-failure.png'}).catch(()=>{});throw error;}finally{await context.close();}
  }}finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exit(1);});
