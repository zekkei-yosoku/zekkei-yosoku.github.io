// Run with NODE_PATH pointing to an installed Playwright package.
// Uses only synthetic authentication and data; never calls the production API.
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const base=process.env.UI_AUDIT_URL||'http://127.0.0.1:8862';
const out=process.env.UI_AUDIT_OUTPUT||'/tmp/astronotes-ui-audit';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true}),snapshots=[],issues=[];
 const adminPath=process.env.UI_AUDIT_ADMIN_MODULE;
 const admin=adminPath?(await import('file://'+adminPath)).adminUi:null;
 const fixturePath=process.env.UI_AUDIT_FORECAST;
 const prediction=fixturePath?JSON.parse(fs.readFileSync(fixturePath)):null;
 const tools=['diamond','pearl','tower','skymap','plane','iss','records'];
 const users={allTools:tools,users:[{login_id:'owner-test',user_id:'o',ownerAdmin:true,tools,passkeys:2,codes:8,has_password:true},{login_id:'friend-test',user_id:'f',tools:['skymap'],passkeys:1,codes:0,has_password:true}],credentials:[],allowed:[]};
 for(const width of [320,390,1280])for(const theme of ['light','dark']){
  const c=await b.newContext({viewport:{width,height:900},colorScheme:theme});
  await c.addInitScript(tools=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-ui-audit',loginId:'owner-test',role:'user',ownerAdmin:true,tools})),tools);
  await c.route(/(?:localhost:8787|zekkei-api\.okayu-sorami\.workers\.dev)/,async r=>{
   const pathname=new URL(r.request().url()).pathname;
   if(pathname==='/prediction'&&prediction){const dto=structuredClone(prediction);dto.place=r.request().postDataJSON();dto.asOf=dto.bundle.fetchedAt=Date.now();return r.fulfill({json:dto});}
   const json=pathname==='/me'?{loginId:'owner-test',role:'user',ownerAdmin:true,tools,credentials:[],hasPassword:true,recoveryCodes:10}:pathname==='/admin/ui'&&admin?admin:pathname==='/admin/users'?users:pathname==='/admin/settings'?{openSignup:false}:pathname==='/admin/log'?{entries:[]}:pathname==='/sync'?{favorites:[],sightings:[],rev:0}:pathname.includes('/access')?{allowed:true,tools}:{};
   return r.fulfill({status:pathname.startsWith('/prediction')?503:200,json});
  });
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('requestfailed',r=>{if(new URL(r.url()).origin===new URL(base).origin)errors.push(r.url()+': '+r.failure()?.errorText);});await p.goto(base,{waitUntil:'load'});await p.waitForTimeout(600);
  async function capture(screen){
   await p.waitForTimeout(80);
   await p.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
   const data=await p.evaluate(()=>{
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&!e.closest('[hidden]');};
    const controls=[...document.querySelectorAll('button,input:not([type=hidden]),select,textarea,summary,a[href]')].filter(visible).map(e=>{
     const r=e.getBoundingClientRect(),s=getComputedStyle(e),before=getComputedStyle(e,'::before'),after=getComputedStyle(e,'::after');
     const extra=[before,after].map(x=>({height:x.content!=='none'&&x.content!=='normal'?parseFloat(x.height)||0:0,width:x.content!=='none'&&x.content!=='normal'?parseFloat(x.width)||0:0}));
     const label=e.getAttribute('aria-label')||[...(e.getAttribute('aria-labelledby')||'').split(/\s+/)].map(id=>document.getElementById(id)?.textContent||'').join(' ').trim()||e.textContent.trim()||[...(e.labels||[])].map(l=>l.textContent.trim()).join(' ')||e.title||e.getAttribute('placeholder')||'';
     return {id:e.id,tag:e.tagName,type:e.type||'',class:e.className,label:label.replace(/\s+/g,' ').slice(0,160),width:r.width,height:r.height,targetWidth:Math.max(r.width,...extra.map(x=>x.width)),targetHeight:Math.max(r.height,...extra.map(x=>x.height)),font:parseFloat(s.fontSize),weight:s.fontWeight,color:s.color,background:s.backgroundColor,radius:s.borderRadius,disabled:!!e.disabled,pressed:e.getAttribute('aria-pressed'),icon:e.dataset.uiControl||null,iconWidth:e.querySelector('.ui-control-icon')?getComputedStyle(e.querySelector('.ui-control-icon')).width:null,stroke:e.querySelector('.ui-control-icon')?getComputedStyle(e.querySelector('.ui-control-icon')).strokeWidth:null};
    });
    return {controls,overflow:document.documentElement.scrollWidth>innerWidth,headings:[...document.querySelectorAll('h1,h2,h3,.sheet-head strong')].filter(visible).map(e=>e.textContent.trim()),today:[...document.querySelectorAll('.dhead.today')].map(e=>({current:e.getAttribute('aria-current'),indicator:getComputedStyle(e.lastElementChild,'::after').content,outline:getComputedStyle(e.querySelector('.d')).boxShadow}))};
   });
   for(const e of data.controls){if(!e.label)issues.push({width,theme,screen,kind:'name',id:e.id,tag:e.tag});if(['INPUT','SELECT','TEXTAREA'].includes(e.tag)&&!['checkbox','radio','range','file','color'].includes(e.type)&&e.font<16)issues.push({width,theme,screen,kind:'input-font',id:e.id,font:e.font});if(e.tag==='BUTTON'&&!e.class.split(/\s+/).includes('cell')&&!e.disabled&&(e.targetWidth<43.9||e.targetHeight<31.9))issues.push({width,theme,screen,kind:'target',id:e.id,label:e.label,w:e.targetWidth,h:e.targetHeight});if(e.icon){assert(Math.abs(e.width-44)<0.1);assert(Math.abs(e.height-44)<0.1);assert.equal(e.iconWidth,'20px');assert.equal(e.stroke,'1.8px');}}
   if(data.overflow)issues.push({width,theme,screen,kind:'overflow'});
   snapshots.push({width,theme,screen,...data});
   if(width===390&&['forecast','settings','account','menu','admin','admin-permissions','admin-recovery'].includes(screen)){await p.evaluate(()=>window.scrollTo(0,0));await p.screenshot({path:path.join(out,`${theme}-${screen}.png`)});}
  }
  for(const [screen,hash] of [['forecast',''],['detail','#/sunset'],['framing','#/aim/tower'],['map','#/skymap'],['plane','#/plane'],['iss','#/iss'],['records','#/records'],['admin','#/admin']]){
   await p.evaluate(hash=>{history.replaceState(null,'',location.pathname+hash);applyRoute()},hash);await p.waitForTimeout(250);
   if(screen==='admin'&&admin){await p.evaluate(async({source,users})=>{clearAdminView();const module=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));const root=document.getElementById('adminView');root.hidden=false;module.mount(root,{apiCall:async(method,path)=>path==='/admin/users'?users:path==='/admin/settings'?{openSignup:false}:{entries:[]},onReauth(){},nextStep:()=>({level:'ok',message:''})});},{source:admin.module,users});await p.waitForTimeout(100);}
   await capture(screen);
   if(screen==='admin'&&admin){const permissions=p.getByRole('button',{name:/の権限$/}).first();if(await permissions.count()){await permissions.click();await capture('admin-permissions');await p.getByRole('button',{name:/利用者一覧/}).click();await p.getByRole('button',{name:/の復旧$/}).first().click();await capture('admin-recovery');}}
  }
  await p.evaluate(()=>{history.replaceState(null,'',location.pathname);applyRoute();});await p.locator('#authButton').click();await p.locator('#settingsScreen').click();await capture('settings');await p.locator('#settingsBack').click();await capture('settings-list');await p.locator('#settingsAccount').click();await capture('account');await p.locator('#accountBack').click();await p.locator('#appSettingsClose').click();
  await p.evaluate(()=>openTools());await capture('menu');await p.locator('#toolsClose').click();
  const dialogs=await p.locator('dialog').evaluateAll(ds=>ds.map((d,i)=>({id:d.id,index:i})));
  for(const d of dialogs){await p.evaluate(i=>{document.querySelectorAll('dialog[open]').forEach(x=>x.close());document.querySelectorAll('dialog')[i].showModal()},d.index);await capture('dialog:'+(d.id||d.index));await p.evaluate(i=>document.querySelectorAll('dialog')[i].close(),d.index);}
  assert.deepEqual(errors,[]);await c.close();
 }
 await b.close();fs.writeFileSync(path.join(out,'inventory.json'),JSON.stringify({snapshots,issues},null,2));console.log(JSON.stringify({snapshots:snapshots.length,controls:snapshots.reduce((n,s)=>n+s.controls.length,0),issues},null,2));assert.equal(issues.length,0,'UI audit findings must be resolved or explicitly classified before passing');
})().catch(e=>{console.error(e);process.exit(1)});
