const {chromium}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.PLAN_BASE||'http://127.0.0.1:8897/';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 for(const theme of ['light','dark']){
  const c=await browser.newContext({viewport:{width:390,height:850},colorScheme:theme}),errors=[];
  const tools=['records','tower','diamond','pearl','skymap'];
  await c.addInitScript(tools=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-links',loginId:'link-test',tools})),tools);
  await c.route(/(?:zekkei-api|localhost:8787)/,r=>r.fulfill({status:200,json:{allowed:true,tool:'skymap',loginId:'link-test',tools,credentials:[],hasPassword:true,recoveryCodes:10,favorites:[],sightings:[],rev:1}}));
  const seed=await c.newPage();seed.on('pageerror',e=>errors.push(e.message));await seed.goto(base);await seed.waitForFunction(()=>{try{return typeof PAGE_DIALOGS==='object'&&typeof startupSessionReady!=='undefined'}catch{return false}});await seed.evaluate(()=>startupSessionReady);
  const cases=await seed.evaluate(()=>{
   const t=AstroNotesAlign.targetById('skytree'),target={id:t.id,name:t.name,latitude:t.latitude,longitude:t.longitude,groundM:t.groundM,parts:t.parts.map(p=>({id:p.id,name:p.name,m:p.m}))};
   const p={v:1,kind:'aim',body:'moon',t:target,o:['共有用の合成地点',35.583465,139.568839,83,1.5,null],at:1793358933842.3608,part:'__whole',limb:'center',matchMode:'overlap',air:'standard',l:{on:true,mode:'manual',focal:173.4,sensor:'full',portrait:false,grid:'thirds'},pan:[.01,-.02]};
   const custom={...p,t:{id:'未登録の塔',name:'合成の展望台🌸',latitude:35.710063,longitude:139.8107,groundM:2,kind:'tower',widthM:40,parts:[{id:'roof',name:'屋根の上',m:636,latitude:35.710064,longitude:139.810701}]},part:'roof',limb:'behind',matchMode:'limb',timelapse:{interval:5,count:100,fps:30}};
   const changed={...p,t:{...target,parts:target.parts.map((r,i)=>({...r,m:r.m+(i===0?1.25:0)}))}};
   const unusual={...custom,t:{...custom.t,future:{notForRendering:true},parts:[{...custom.t.parts[0],id:'roof"><img src=x>',future:{notForRendering:true}}]},part:'roof"><img src=x>'};
   return [p,custom,changed,unusual].flatMap((p,i)=>[{p,url:AstroNotesPlan.link(p),kind:'compact-'+i},...(i===0?[{p,url:'https://zekkei-yosoku.github.io/#/aim?plan='+AstroNotesPlan.encode(p),kind:'old-v1'},{p,url:AstroNotesPlan.link(p).replaceAll(',','%2C').replaceAll('/','%2F').replace('https:%2F%2F','https://').replace('github.io%2F','github.io/'),kind:'percent-encoded'}]:[]),...(i===1?[{p,url:AstroNotesPlan.link(p),kind:'background-to-visible',background:true}]:[])]);
  });
  for(const {p:expected,url,kind,background} of cases){
   const page=await c.newPage();page.on('pageerror',e=>errors.push(e.message));if(background)await page.addInitScript(()=>{globalThis.fixtureHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>fixtureHidden});});const dest=new URL(base);dest.hash=new URL(url).hash;await page.goto(dest.href);
   await page.waitForFunction(()=>{try{return typeof PAGE_DIALOGS==='object'&&typeof startupSessionReady!=='undefined'&&!!aim.sharedTarget}catch{return false}});
   await page.evaluate(()=>startupSessionReady);
   await page.waitForFunction(()=>{try{return aim.target?.id===aim.sharedTarget?.id&&!!aim.target?.parts?.length}catch{return false}});
   if(background){await page.waitForFunction(()=>TrialExplore.ownsScene());assert(await page.evaluate(()=>document.hidden&&!TrialExplore.active()));await page.evaluate(async()=>{aimApply();await aimRenderFrom();await aimUpdateLook();fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'));});}
   const actual=await page.evaluate(()=>({t:aim.sharedTarget,o:aim.from,l:aimLens,body:aim.body,part:aim.partId,mode:aim.matchMode,air:aimAirSettings.mode,stored:Object.keys(localStorage).filter(k=>/^sorami\.(favorites|observations|placeShapes|schedule)/.test(k)).map(k=>[k,localStorage.getItem(k)])}));
   for(const k of ['name','latitude','longitude','groundM','parts','kind','widthM'])if(expected.t[k]!==undefined)assert.deepEqual(actual.t[k],k==='parts'?expected.t.parts.map(({future,...rest})=>rest):expected.t[k],kind+' target '+k);
   assert.equal(actual.t.future,undefined);assert(actual.t.parts.every(p=>p.future===undefined));assert.equal(await page.locator('#aimPart img').count(),0);
   assert(await page.locator('#aimPart').evaluate((el,id)=>[...el.options].some(o=>o.value===id),expected.part));
   await page.waitForFunction(()=>{try{return !!planSnapshot({dataset:{planSource:'aim'}}).payload}catch{return false}},null,{timeout:45000}).catch(async error=>{console.error(await page.evaluate(()=>{let failure;try{planSnapshot({dataset:{planSource:'aim'}})}catch(e){failure=e.message}const h=document.getElementById('aimLook');return {failure,hidden:h.hidden,key:h._planKey,expected:aimLookKey(),at:h._lookAt,pending:aim.pendingPlan,status:document.getElementById('skyMapStatus').textContent,scene:document.getElementById('aimView').textContent.slice(-800),errors:[]};}));throw error;});
   const snapshot=await page.evaluate(()=>planSnapshot({dataset:{planSource:'aim'}}).payload);
   for(const key of ['o','at','part','limb','matchMode','air','pan','timelapse'])assert.deepEqual(snapshot[key],expected[key],kind+' scene '+key);
   for(const key of ['name','latitude','longitude','groundM','kind','widthM'])if(expected.t[key]!==undefined)assert.deepEqual(snapshot.t[key],expected.t[key],kind+' reshare '+key);
   assert.equal(actual.o.latitude,expected.o[1]);assert.equal(actual.o.longitude,expected.o[2]);assert.equal(actual.o.groundManualM,expected.o[3]);assert.equal(actual.o.standAglM,expected.o[4]);assert.equal(actual.body,expected.body);assert.equal(actual.part,expected.part,JSON.stringify({kind,actual,expected}));assert.equal(actual.mode,expected.matchMode);assert.equal(actual.air,expected.air);
   for(const k of ['on','focal','sensor','portrait','grid'])assert.deepEqual(actual.l[k],expected.l[k]);
   // Loading a received target must not register it in the recipient's library.
   assert(actual.stored.every(([k,v])=>!v.includes('合成の展望台')&&!v.includes('未登録の塔')),JSON.stringify(actual.stored));
   await page.close();console.log(theme,kind,'fresh tab restores target and conditions without registering custom targets');
  }
  assert.deepEqual(errors,[]);await c.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
