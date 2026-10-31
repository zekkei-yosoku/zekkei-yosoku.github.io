// User data must survive every structural change. Drives the real page and observes only storage, requests and the
// download, never app internals, so the same test stays valid whatever the script packaging is. All API traffic is local.
const {chromium}=require('playwright'),assert=require('assert/strict');
const base=process.env.DATA_SAFETY_BASE||'http://127.0.0.1:8897/index.html';
const login='safety-test',tools=['records','tower','diamond','pearl','skymap'];
const fav=(id,name,latitude)=>({id,name,subtitle:'',latitude,longitude:139,elevation:10,terrain:null,phenomena:[],note:'メモ '+id});
const sight=(id,peak)=>({id,phenomenon:'sunset',peak,placeName:'地点 '+id,outcome:'good',actualScore:80,score:70});
const A=fav('fav-a','残す地点',35.1),B=fav('fav-b','別端末で消す地点',35.2),C=fav('fav-c','別端末で増えた地点',35.3),S1=sight('sight-1',1790000000000),S2=sight('sight-2',1790000100000);
const row=(o,rev)=>({id:o.id,body:JSON.stringify(o),updated_at:1,deleted:false,rev});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const c=await browser.newContext({viewport:{width:390,height:900},acceptDownloads:true});
 const server={favorites:[],sightings:[],rev:5,posts:[],gets:0,failPost:false,refuse:false};
 await c.addInitScript(({login,tools,A,B,S1})=>{
  sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-safety',loginId:login,tools}));
  if(localStorage.getItem('safety.seeded'))return;
  localStorage.setItem('safety.seeded','1');
  localStorage.setItem('sorami.owner',JSON.stringify(login));
  localStorage.setItem('sorami.favorites',JSON.stringify([A,B]));
  localStorage.setItem('sorami.sightings',JSON.stringify([S1]));
  localStorage.setItem('sorami.sync',JSON.stringify({loginId:login,rev:5,records:1}));
 },{login,tools,A,B,S1});
 await c.route(/(?:zekkei-api|localhost:8787)/,async r=>{
  const u=new URL(r.request().url()),m=r.request().method();
  if(u.pathname==='/sync'&&m==='GET'){server.gets++;const since=+u.searchParams.get('since')||0;return r.fulfill({json:since<server.rev?{favorites:server.favorites,sightings:server.sightings,records:[],rev:server.rev,more:false}:{favorites:[],sightings:[],records:[],rev:server.rev,more:false}});}
  if(u.pathname==='/sync'&&m==='POST'){const body=r.request().postDataJSON();server.posts.push(body);if(server.failPost)return r.fulfill({status:500,json:{error:'synthetic'}});if(server.refuse)return r.fulfill({json:{accepted:{},rev:server.rev}});return r.fulfill({json:{accepted:{favorites:(body.favorites||[]).map(x=>x.id),sightings:(body.sightings||[]).map(x=>x.id),records:(body.records||[]).map(x=>x.id)},rev:++server.rev}});}
  if(u.pathname.startsWith('/prediction'))return r.fulfill({status:503,json:{}});
  return r.fulfill({json:{loginId:login,role:'user',tools,allowed:true,tool:'skymap',credentials:[],hasPassword:true,recoveryCodes:10}});
 });
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const stored=k=>p.evaluate(k=>JSON.parse(localStorage.getItem(k)),k);
 const ids=async k=>(await stored(k)).map(x=>x.id).sort();
 const settled=async n=>{await p.waitForFunction(()=>document.readyState==='complete');const start=Date.now();while(server.gets<n&&Date.now()-start<15000)await p.waitForTimeout(100);await p.waitForTimeout(600);};

 // 1. Opening the app changes nothing and sends nothing.
 await p.goto(base+'#/');await settled(1);
 assert.deepEqual(await ids('sorami.favorites'),['fav-a','fav-b'],'open: favorites kept');
 assert.deepEqual(await ids('sorami.sightings'),['sight-1'],'open: sightings kept');
 const kept=(await stored('sorami.favorites')).find(x=>x.id==='fav-a');assert.equal(kept.name,A.name);assert.equal(kept.note,A.note);assert.equal(kept.latitude,A.latitude);
 assert.equal((await stored('sorami.sightings'))[0].placeName,S1.placeName,'open: sighting content kept');
 assert.equal(server.posts.length,0,'open: nothing uploaded');

 // 2. Another device added and deleted: applied locally, survives reload, and is not echoed back.
 server.favorites=[row(C,6),{id:B.id,body:'{}',updated_at:2,deleted:true,rev:7}];server.sightings=[row(S2,8)];server.rev=8;
 let gets=server.gets;await p.reload();await settled(gets+1);
 assert.deepEqual(await ids('sorami.favorites'),['fav-a','fav-c'],'incoming: add and delete applied');
 assert.deepEqual(await ids('sorami.sightings'),['sight-1','sight-2'],'incoming: sighting merged');
 assert.equal(server.posts.length,0,'incoming: not echoed');
 server.favorites=[];server.sightings=[];
 gets=server.gets;await p.reload();await settled(gets+1);
 assert.deepEqual(await ids('sorami.favorites'),['fav-a','fav-c'],'reload: merged state persisted');

 // 3. A favorite registered on screen reaches storage first; a failed upload loses nothing and is resent after restart.
 server.failPost=true;
 await p.locator('#favToggle').click();await p.locator('#favSheet[open]').waitFor();
 await p.locator('#favName').fill('画面で登録した地点');await p.locator('#favNote').evaluate(n=>{n.closest('details')&&(n.closest('details').open=true);});await p.locator('#favNote').fill('登録メモ');
 await p.locator('#favSave').click();await p.locator('#favSheet[open]').waitFor({state:'detached'}).catch(()=>{});await p.waitForFunction(()=>!document.getElementById('favSheet').open);
 const deadline=Date.now()+8000;while(!server.posts.length&&Date.now()<deadline)await p.waitForTimeout(100);
 const local=(await stored('sorami.favorites')).find(x=>x.name==='画面で登録した地点');assert.ok(local,'save: written to storage');assert.equal(local.note,'登録メモ');
 assert.ok(server.posts.length,'save: upload attempted');
 assert.ok((await stored('sorami.queue')).some(q=>q.kind==='fav'&&q.id===local.id),'failed upload stays queued');
 server.failPost=false;server.posts.length=0;gets=server.gets;await p.reload();await settled(gets+1);
 const sent=server.posts.flatMap(x=>x.favorites||[]).find(x=>x.id===local.id);assert.ok(sent,'restart: queued favorite resent');
 const body=typeof sent.body==='string'?JSON.parse(sent.body):sent.body;assert.equal(body.name,'画面で登録した地点');assert.equal(body.note,'登録メモ');assert.equal(body.latitude,local.latitude);assert.equal(sent.deleted,false);
 assert.deepEqual(await stored('sorami.queue'),[],'accepted upload leaves the queue');
 assert.ok((await ids('sorami.favorites')).includes('fav-a'),'older favorites untouched');

 // 4. The backup contains what the user has.
 const [download]=await Promise.all([p.waitForEvent('download'),p.evaluate(()=>document.getElementById('exportBtn').click())]);
 const chunks=[];for await(const x of await download.createReadStream())chunks.push(x);const backup=JSON.parse(Buffer.concat(chunks).toString());
 const text=JSON.stringify(backup);for(const want of ['fav-a','fav-c','sight-1','sight-2','画面で登録した地点','残す地点'])assert.ok(text.includes(want),'backup contains '+want);
 // 5. A stale server copy never overwrites an edit still waiting to be sent.
 server.refuse=true;
 await p.locator('#favToggle').click();await p.locator('#favSheet[open]').waitFor();
 await p.locator('#favName').fill('送信待ちの編集');await p.locator('#favSave').click();await p.waitForFunction(()=>!document.getElementById('favSheet').open);
 server.favorites=[{...row({...local,name:'古いサーバーの値'},server.rev+1)}];server.rev+=1;
 gets=server.gets;await p.reload();await settled(gets+1);
 assert.equal((await stored('sorami.favorites')).find(x=>x.id===local.id).name,'送信待ちの編集','pending edit wins over stale server value');
 server.favorites=[];server.refuse=false;gets=server.gets;await p.reload();await settled(gets+1);
 assert.deepEqual(await stored('sorami.queue'),[],'edit eventually sent');

 // 6. Deleting on screen removes locally and tells the server it was deleted.
 p.on('dialog',d=>d.accept());server.posts.length=0;
 await p.locator('#favToggle').click();await p.locator('#favSheet[open]').waitFor();await p.locator('#favDelete').click();await p.waitForFunction(()=>!document.getElementById('favSheet').open);
 const until=Date.now()+8000;while(!server.posts.some(x=>(x.favorites||[]).length)&&Date.now()<until)await p.waitForTimeout(100);
 assert.ok(!(await ids('sorami.favorites')).includes(local.id),'delete: removed locally');
 const gone=server.posts.flatMap(x=>x.favorites||[]).find(x=>x.id===local.id);assert.ok(gone,'delete: sent');assert.equal(gone.deleted,true,'delete: sent as deleted');
 assert.ok((await ids('sorami.favorites')).includes('fav-a'),'delete: other favorites untouched');
 assert.deepEqual(errors,[],'no page errors');
 await browser.close();console.log('PASS data safety');
})().catch(e=>{console.error(e);process.exit(1);});
