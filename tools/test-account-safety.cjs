// Whose data is whose. Drives the real login and logout screens and observes only storage and requests, so it stays
// valid whatever the script packaging is. Passwords are synthetic and all API traffic is local.
const {chromium}=require('playwright'),assert=require('assert/strict');
const base=process.env.ACCOUNT_SAFETY_BASE||'http://127.0.0.1:8897/index.html';
const tools=['records','tower','diamond','pearl','skymap'];
const fav=(id,name)=>({id,name,subtitle:'',latitude:35.5,longitude:139.5,elevation:10,terrain:null,phenomena:[],note:'メモ '+id});
const sight=id=>({id,phenomenon:'sunset',peak:1790000000000,placeName:'地点 '+id,outcome:'good',actualScore:80,score:70});
const plan=(id,title)=>({id,title,start:1900000000000,end:1900000000100,savedAt:1,value:{}});
const obs=id=>({id,placeId:'place-1',target:{key:'t',name:'対象'},result:'seen'});
const scheduleKey=id=>'sorami.schedule.v1:'+id,obsKey=id=>'sorami.observations.v1:'+id,shapeKey=id=>'sorami.placeShapes.v1:'+id;
async function scene(browser,{session=null,storage={},server:init={}}){
 const c=await browser.newContext({viewport:{width:390,height:900}});
 const server={favorites:[],sightings:[],records:[],rev:5,posts:[],gets:0,refuse:false,...init};
 await c.addInitScript(({session,storage,tools})=>{
  if(localStorage.getItem('safety.seeded'))return;localStorage.setItem('safety.seeded','1');
  if(session)sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-'+session,loginId:session,tools}));
  for(const [k,v] of Object.entries(storage))localStorage.setItem(k,JSON.stringify(v));
 },{session,storage,tools});
 await c.route(/(?:zekkei-api|localhost:8787)/,async r=>{
  const u=new URL(r.request().url()),m=r.request().method(),P=u.pathname,token=(r.request().headers().authorization||'').replace(/^Bearer /,''),who=token.replace(/^synthetic-/,'');
  if(P==='/sync'&&m==='GET'){server.gets++;const since=+u.searchParams.get('since')||0;return r.fulfill({json:since<server.rev?{favorites:server.favorites,sightings:server.sightings,records:server.records,rev:server.rev,more:false}:{favorites:[],sightings:[],records:[],rev:server.rev,more:false}});}
  if(P==='/sync'&&m==='POST'){const body=r.request().postDataJSON();server.posts.push({who,body});if(server.refuse)return r.fulfill({json:{accepted:{},rev:server.rev}});return r.fulfill({json:{accepted:{favorites:(body.favorites||[]).map(x=>x.id),sightings:(body.sightings||[]).map(x=>x.id),records:(body.records||[]).map(x=>x.id)},rev:++server.rev}});}
  if(P.startsWith('/prediction'))return r.fulfill({status:503,json:{}});
  if(m==='POST'&&/login/.test(P)){const b=r.request().postDataJSON();const id=b.loginId||b.id||b.login_id;return r.fulfill({json:{token:'synthetic-'+id,loginId:id,tools}});}
  return r.fulfill({json:{loginId:who,role:'user',tools,allowed:true,tool:'skymap',credentials:[],hasPassword:true,recoveryCodes:10}});
 });
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const stored=k=>p.evaluate(k=>JSON.parse(localStorage.getItem(k)),k);
 const ids=async k=>((await stored(k))||[]).map(x=>x.id).sort();
 const settled=async n=>{await p.waitForFunction(()=>document.readyState==='complete');const start=Date.now();while(server.gets<n&&Date.now()-start<15000)await p.waitForTimeout(100);await p.waitForTimeout(700);};
 const login=async id=>{const gets=server.gets;await p.locator('#authButton').click();await p.locator('#authSheet[open]').waitFor();await p.locator('#authId').fill(id);await p.locator('#authPw').fill('synthetic-Passw0rd!');await p.locator('#pwLogin').click();await settled(gets+1);};
 const posted=()=>JSON.stringify(server.posts);
 return {c,p,server,stored,ids,settled,login,posted,errors};
}
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const alice={'sorami.owner':'alice','sorami.favorites':[fav('alice-fav','アリスの地点')],'sorami.sightings':[sight('alice-sight')],'sorami.queue':[{kind:'fav',id:'alice-fav'}],'sorami.sync':{loginId:'alice',rev:5,records:1},[scheduleKey('alice')]:[plan('alice-plan','アリスの予定')]};

 { // Another person logs in: nothing of the previous person is shown, kept in the shared lists, or uploaded.
  const s=await scene(browser,{storage:alice,server:{favorites:[{id:'bob-fav',body:JSON.stringify(fav('bob-fav','ボブの地点')),updated_at:1,deleted:false,rev:6}],rev:6}});
  await s.p.goto(base+'#/');await s.p.waitForTimeout(1500);await s.login('bob');
  assert.deepEqual(await s.ids('sorami.favorites'),['bob-fav'],'other person: favorites replaced');
  assert.deepEqual(await s.ids('sorami.sightings'),[],'other person: sightings cleared');
  assert.deepEqual(await s.stored('sorami.queue'),[],'other person: queue cleared');
  assert.equal(await s.stored('sorami.owner'),'bob','other person: owner updated');
  assert.ok(!/alice/.test(s.posted()),'other person: nothing of alice uploaded');
  assert.deepEqual(await s.ids(scheduleKey('alice')),['alice-plan'],'other person: per-account plans stay under their owner');
  assert.deepEqual(s.errors,[]);await s.c.close();
 }
 { // A device nobody has logged in on: local data moves into the first account, with its content.
  const s=await scene(browser,{storage:{'sorami.favorites':[fav('local-fav','手元の地点')],'sorami.sightings':[sight('local-sight')]}});
  await s.p.goto(base+'#/');await s.p.waitForTimeout(1500);await s.login('bob');
  const sent=s.server.posts.flatMap(x=>x.body.favorites||[]).find(x=>x.id==='local-fav');assert.ok(sent,'first login: local favorite uploaded');
  assert.equal((typeof sent.body==='string'?JSON.parse(sent.body):sent.body).name,'手元の地点');
  assert.ok(s.server.posts.flatMap(x=>x.body.sightings||[]).some(x=>x.id==='local-sight'),'first login: local sighting uploaded');
  assert.deepEqual(await s.ids('sorami.favorites'),['local-fav'],'first login: local data kept');
  assert.equal(await s.stored('sorami.owner'),'bob');assert.deepEqual(s.errors,[]);await s.c.close();
 }
 { // The same person logs in again: data stays, even when the ID differs only in case.
  const s=await scene(browser,{storage:{'sorami.owner':'bob','sorami.favorites':[fav('bob-fav','ボブの地点')],'sorami.sightings':[sight('bob-sight')],'sorami.sync':{loginId:'bob',rev:5,records:1}}});
  await s.p.goto(base+'#/');await s.p.waitForTimeout(1500);await s.login('BOB');
  assert.deepEqual(await s.ids('sorami.favorites'),['bob-fav'],'same person: favorites kept');
  assert.deepEqual(await s.ids('sorami.sightings'),['bob-sight'],'same person: sightings kept');
  assert.deepEqual(s.errors,[]);await s.c.close();
 }
 { // Logout: declining the warning loses nothing; confirming clears the shared lists and the session.
  const s=await scene(browser,{session:'bob',storage:{'sorami.owner':'bob','sorami.favorites':[fav('bob-fav','ボブの地点')],'sorami.sightings':[sight('bob-sight')],'sorami.sync':{loginId:'bob',rev:5,records:1},[scheduleKey('bob')]:[plan('bob-plan','ボブの予定')]}});
  await s.p.goto(base+'#/');await s.settled(1);
  s.server.refuse=true;
  await s.p.locator('#favToggle').click();await s.p.locator('#favSheet[open]').waitFor();await s.p.locator('#favName').fill('未送信の地点');await s.p.locator('#favSave').click();await s.p.waitForFunction(()=>!document.getElementById('favSheet').open);await s.p.waitForTimeout(800);
  const pending=(await s.stored('sorami.queue')).length;assert.ok(pending>0,'logout: an unsent change is queued');
  await s.p.locator('#authButton').click();await s.p.locator('#settingsAccount').click();await s.p.locator('#accountSheet[open]').waitFor();await s.p.locator('#logout').waitFor();
  let asked='';s.p.once('dialog',d=>{asked=d.message();d.dismiss();});await s.p.locator('#logout').click();await s.p.waitForTimeout(300);
  assert.match(asked,/送っていない変更/,'logout: warns about unsent changes');
  assert.ok((await s.ids('sorami.favorites')).includes('bob-fav'),'logout declined: data kept');assert.equal((await s.stored('sorami.queue')).length,pending,'logout declined: queue kept');
  s.p.once('dialog',d=>d.accept());await s.p.locator('#logout').click();await s.p.waitForTimeout(300);
  assert.deepEqual(await s.stored('sorami.favorites'),[],'logout: favorites cleared');assert.deepEqual(await s.stored('sorami.sightings'),[],'logout: sightings cleared');assert.deepEqual(await s.stored('sorami.queue'),[],'logout: queue cleared');
  assert.equal(await s.stored('sorami.owner'),null,'logout: owner cleared');assert.equal(await s.p.evaluate(()=>sessionStorage.getItem('sorami.token')),null,'logout: token cleared');
  assert.equal(await s.p.locator('#authButton').textContent(),'ログイン');
  const posts=s.server.posts.length;await s.p.reload();await s.p.waitForTimeout(1500);assert.equal(s.server.posts.length,posts,'logout: nothing sent afterwards');
  assert.deepEqual(s.errors,[]);await s.c.close();
 }
 { // Plans, observations and shooting places: uploaded with content, not resent, merged, deleted, and pending edits win.
  const shape={latitude:35.5,longitude:139.5,shape:null};
  const s=await scene(browser,{session:'bob',storage:{'sorami.owner':'bob','sorami.sync':{loginId:'bob',rev:5,records:1},[scheduleKey('bob')]:[plan('p1','予定1'),plan('p2','消される予定')],[obsKey('bob')]:[obs('o1')],[shapeKey('bob')]:{'place-1':shape}}});
  await s.p.goto(base+'#/');await s.settled(1);
  const rec=()=>s.server.posts.flatMap(x=>x.body.records||[]),byId=id=>rec().find(x=>x.id===id);
  const sentPlan=byId('rec:plan:p1');assert.ok(sentPlan,'records: plan uploaded');assert.equal(sentPlan.deleted,false);assert.equal(sentPlan.body.value.title,'予定1','records: plan content');
  assert.equal(byId('rec:obs:o1')?.body.value.result,'seen','records: observation content');assert.equal(byId('rec:shape:place-1')?.body.value.latitude,35.5,'records: shooting place content');
  const row=(id,kind,value)=>({id,body:JSON.stringify({kind,value}),updated_at:2,deleted:false,rev:s.server.rev+1});
  s.server.posts.length=0;s.server.rev+=2;s.server.records=[row('rec:plan:p3','plan',plan('p3','別端末の予定')),row('rec:obs:o2','obs',obs('o2')),{id:'rec:plan:p2',body:'{}',updated_at:2,deleted:true,rev:s.server.rev}];
  let gets=s.server.gets;await s.p.reload();await s.settled(gets+1);
  assert.deepEqual(await s.ids(scheduleKey('bob')),['p1','p3'],'records: incoming plan added and deleted');assert.deepEqual(await s.ids(obsKey('bob')),['o1','o2'],'records: incoming observation added');
  assert.equal(s.server.posts.length,0,'records: unchanged and received records are not sent back');
  s.server.records=[];
  // A local edit waits unsent; a stale server copy does not overwrite it.
  s.server.refuse=true;await s.p.evaluate(k=>{const v=JSON.parse(localStorage.getItem(k));v.find(x=>x.id==='p1').title='送信待ちの予定';localStorage.setItem(k,JSON.stringify(v));},scheduleKey('bob'));
  s.server.rev+=1;s.server.records=[row('rec:plan:p1','plan',plan('p1','古いサーバーの予定'))];gets=s.server.gets;await s.p.reload();await s.settled(gets+1);
  assert.equal((await s.stored(scheduleKey('bob'))).find(x=>x.id==='p1').title,'送信待ちの予定','records: pending edit wins');
  s.server.refuse=false;s.server.records=[];s.server.posts.length=0;gets=s.server.gets;await s.p.reload();await s.settled(gets+1);
  assert.equal(byId('rec:plan:p1')?.body.value.title,'送信待ちの予定','records: pending edit sent');
  // A local edit with nothing incoming is still detected and sent.
  s.server.posts.length=0;await s.p.evaluate(k=>{const v=JSON.parse(localStorage.getItem(k));v.find(x=>x.id==='p1').title='手元だけの編集';localStorage.setItem(k,JSON.stringify(v));},scheduleKey('bob'));gets=s.server.gets;await s.p.reload();await s.settled(gets+1);
  assert.equal(byId('rec:plan:p1')?.body.value.title,'手元だけの編集','records: local edit sent');
  // A local deletion reaches the server as a deletion.
  s.server.posts.length=0;await s.p.evaluate(k=>localStorage.setItem(k,JSON.stringify(JSON.parse(localStorage.getItem(k)).filter(x=>x.id!=='p3'))),scheduleKey('bob'));gets=s.server.gets;await s.p.reload();await s.settled(gets+1);
  assert.equal(byId('rec:plan:p3')?.deleted,true,'records: local deletion sent');assert.deepEqual(await s.ids(scheduleKey('bob')),['p1'],'records: deletion stays');
  assert.deepEqual(s.errors,[]);await s.c.close();
 }
 await browser.close();console.log('PASS account safety');
})().catch(e=>{console.error(e);process.exit(1);});
