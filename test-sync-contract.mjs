import {execFileSync} from 'node:child_process';
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const AccountSync=require('./src/services/account-sync.js');
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
// 比較元はWeb97356e2のaccount controller実ソース。無ければ失敗させる（skipで合格にしない）。
const OLD_CONTROLLER=process.env.ASTRONOTES_OLD_ACCOUNT_CONTROLLER??'/Users/okadayudai/Developer/AstroNotes/public-web/src/features/account/controller.js';
const oldController=execFileSync('git',['show','97356e2:src/features/account/controller.js'],{cwd:new URL('.',import.meta.url),encoding:'utf8'});
const oldSync=oldController.slice(oldController.indexOf('/// 送れなかったものを覚えておく。'),oldController.indexOf('// 「保持する」の希望。'));
const status=read('./src/features/account/status.js'),toItemSource=status.slice(status.indexOf('const toItem ='));
const recordSyncSource=read('./src/services/record-sync.js');
const newController=read('./src/features/account/sync-bridge.js'),newHead=newController;
const tick=()=>new Promise(setImmediate);
const strip=v=>v===undefined?v:JSON.parse(JSON.stringify(v,(k,x)=>k==='updated_at'?undefined:x));
const PLAN_KEY='sorami.schedule.v1:owner',plan=(id,title,savedAt=1)=>({id,title,start:1900000000000,end:1900000000100,savedAt,value:{}});

function connectAccountSync(c,ports={}){const lexical=name=>vm.runInContext(`typeof ${name}!=="undefined"?${name}:undefined`,c);const sync=AccountSync.create({state:c,session:{auth:()=>c.auth,generation:()=>c.authGeneration},apiCall:(...a)=>c.apiCall(...a),store:{set:(k,v)=>c.store.set(k,v)},toItem:(...a)=>lexical('toItem')(...a),cleanFavorite:x=>c.cleanFavorite(x),cleanSighting:x=>c.cleanSighting(x),records:()=>lexical('RecordSync'),refresh:()=>c.AstroTargetPicker?.refresh?.(),render:()=>c.renderAuthButton(),...ports});Object.assign(c,sync);return sync;}

// 旧sourceと新exportへ同じfixtureを与え、storage/fetch/queue/描画/記録同期の呼出し順を記録する。
function world(kind,server,{seed=[],state={},failKey=null,failLocal=null}={}){
  const disk=new Map(seed.map(([k,v])=>[k,JSON.stringify(v)])),trace=[];
  const c={AstroNotesLibrary:require('./astronotes-library.js'),AstroNotesShooting:require('./astronotes-shooting.js'),
    auth:{loginId:'owner',token:'synthetic'},authGeneration:1,favorites:[],sightings:[],pushQueue:[],syncInfo:null,syncError:null,
    localStorage:{getItem:k=>disk.get(k)??null,setItem(k,v){trace.push(['local',k,v]);if(failLocal?.(k))throw Error('quota');disk.set(k,v);},removeItem:k=>disk.delete(k)},
    window:{dispatchEvent:()=>trace.push(['event'])},CustomEvent:class{},setTimeout:()=>1,clearTimeout(){},
    renderAuthButton:()=>trace.push(['render',c.auth?.loginId,c.syncError,c.pushQueue.length]),
    cleanFavorite:x=>x?.id?x:null,cleanSighting:x=>x?.id?x:null,AstroTargetPicker:{refresh:()=>trace.push(['refresh'])},
    __trace:k=>trace.push(['rec',k]),
    apiCall:(m,p,body)=>{trace.push(['fetch',m,p,strip(body)]);return server.handle(m,p,body,c);}};
  c.store={get:(k,d)=>disk.has(k)?JSON.parse(disk.get(k)):d,set(k,v){trace.push(['store',k,JSON.stringify(strip(v))]);if(failKey===k)return false;disk.set(k,JSON.stringify(v));return true;}};
  Object.assign(c,state);
  vm.createContext(c);
  vm.runInContext(toItemSource+'\n'+recordSyncSource+'\nfor(const k of ["scan","item","accepted","apply"]){const f=RecordSync[k];RecordSync[k]=(...a)=>{__trace(k);return f(...a);};}',c);
  if(kind==='old')vm.runInContext(oldSync,c);else connectAccountSync(c);
  return {c,disk,trace,server};
}
async function same(makeServer,run,options){
  const out={};
  for(const kind of ['old','new']){
    const w=world(kind,makeServer(),typeof options==='function'?options():options);await run(w);await tick();
    out[kind]={trace:w.trace,state:strip({pushQueue:w.c.pushQueue,syncInfo:w.c.syncInfo,syncError:w.c.syncError,favorites:w.c.favorites,sightings:w.c.sightings}),disk:[...w.disk].map(([k,v])=>[k,JSON.stringify(strip(JSON.parse(v)))])};
  }
  assert.deepEqual(out.new,out.old);
  return out.new;
}
const acceptAll=body=>({accepted:{favorites:body.favorites.map(x=>x.id),sightings:body.sightings.map(x=>x.id),records:(body.records||[]).map(x=>x.id)}});
const deferredPosts=(get=since=>({favorites:[],sightings:[],rev:1}))=>{const pending=[];return {pending,handle:(m,p,body)=>m==='POST'?new Promise(resolve=>pending.push({body,resolve})):Promise.resolve(get(Number(p.split('=')[1])))};};
const posts=t=>t.filter(x=>x[0]==='fetch'&&x[1]==='POST'),gets=t=>t.filter(x=>x[0]==='fetch'&&x[1]==='GET');

test('POST→記録受理→GET複数頁→受信の順序・保存・文言が旧sourceと同じ',async()=>{
  const out=await same(()=>({handle:async(m,p,body)=>{
    if(m==='POST')return acceptAll(body);
    if(p==='/sync?since=0')return {favorites:[{id:'r1',body:JSON.stringify({name:'remote'})},{id:'bad',body:'{'}],sightings:[{id:'s1',deleted:true}],
      records:[{id:'rec:plan:q',body:JSON.stringify({kind:'plan',value:plan('q','remote',2)}),rev:2}],rev:3,more:true};
    return {favorites:[],sightings:[],rev:5,more:false};}}),
    async w=>{await w.c.syncNow();},
    {seed:[[PLAN_KEY,[plan('p','local')]]],state:{favorites:[{id:'f1',name:'a'}],sightings:[{id:'s1'}],pushQueue:[{kind:'fav',id:'f1'},{kind:'sight',id:'s1'},{kind:'fav',id:'gone'}]}});
  assert.deepEqual([...posts(out.trace),...gets(out.trace)].map(x=>x[2]),['/sync','/sync?since=0','/sync?since=3']);
  assert.deepEqual(posts(out.trace)[0][3].records.map(r=>r.id),['rec:plan:p']);
  assert.equal(posts(out.trace)[0][3].favorites[1].deleted,true);
  assert.deepEqual(out.trace.filter(x=>x[0]==='rec').map(x=>x[1]),['scan','item','accepted','apply','apply']);
  assert.deepEqual(out.state.syncInfo,{loginId:'owner',rev:5,records:1});
  assert.deepEqual(out.state.pushQueue,[]);assert.equal(out.state.syncError,null);
  assert.deepEqual(out.state.favorites.map(x=>x.id),['f1','r1']);assert.deepEqual(out.state.sightings,[]);
});

test('500件ごとの分割と40回上限、未送信の文言が旧sourceと同じ',async()=>{
  const ids=n=>Array.from({length:n},(_,i)=>({id:'f'+i}));
  const split=await same(()=>({handle:async(m,p,body)=>m==='POST'?acceptAll(body):{favorites:[],sightings:[],rev:1}}),async w=>{await w.c.syncNow();},
    ()=>({state:{favorites:ids(600),pushQueue:ids(600).map(x=>({kind:'fav',id:x.id}))}}));
  assert.deepEqual(posts(split.trace).map(x=>x[3].favorites.length),[500,100]);
  const capped=await same(()=>({handle:async(m,p,body)=>m==='POST'?{accepted:{favorites:[body.favorites[0].id],sightings:[]}}:{favorites:[],sightings:[],rev:1}}),async w=>{await w.c.syncNow();},
    ()=>({state:{favorites:ids(45),pushQueue:ids(45).map(x=>({kind:'fav',id:x.id}))}}));
  assert.equal(posts(capped.trace).length,40);assert.equal(gets(capped.trace).length,1);
  assert.equal(capped.state.syncError,'未送信の変更が5件あります。同期を再試行してください');
});

test('GETは20頁で止め、拒否された項目は再送し続けない',async()=>{
  const paged=await same(()=>({handle:async(m,p)=>({favorites:[],sightings:[],rev:Number(p.split('=')[1])+1,more:true})}),async w=>{await w.c.syncNow();});
  assert.equal(gets(paged.trace).length,20);assert.equal(paged.state.syncInfo.rev,20);
  const rejected=await same(()=>({handle:async m=>m==='POST'?{accepted:{favorites:[],sightings:[]}}:{favorites:[],sightings:[],rev:1}}),async w=>{await w.c.syncNow();},()=>({state:{pushQueue:[{kind:'fav',id:'f'}]}}));
  assert.equal(posts(rejected.trace).length,1);assert.match(rejected.state.syncError,/未送信の変更が1件/);
});

test('POST中の編集と同世代の並行呼出しは直列化し、完了順も旧sourceと同じ',async()=>{
  const out=await same(()=>deferredPosts(),async w=>{
    const {c,server,trace}=w;
    const first=c.syncNow(),second=c.syncNow();
    first.then(()=>trace.push(['done',1]));second.then(()=>trace.push(['done',2]));
    await tick();c.favorites=[{id:'f',name:'new'}];c.queuePush('fav','f');trace.push(['pending',server.pending.length]);
    server.pending[0].resolve({accepted:{favorites:['f'],sightings:[]}});await tick();trace.push(['pending',server.pending.length]);
    server.pending[1].resolve({accepted:{favorites:['f'],sightings:[]}});await Promise.all([first,second]);
  },()=>({state:{favorites:[{id:'f',name:'old'}],pushQueue:[{kind:'fav',id:'f'}]}}));
  assert.deepEqual(posts(out.trace).map(x=>x[3].favorites[0].body.name),['old','new']);
  assert.deepEqual(out.trace.filter(x=>x[0]==='pending').map(x=>x[1]),[1,2]);
  assert.deepEqual(out.state.pushQueue,[]);assert.equal(out.state.favorites[0].name,'new');
});

test('旧世代の応答は新アカウントのqueue・保存・描画へ触れず、新世代は別flightで送る',async()=>{
  let otherQueue;
  const out=await same(()=>deferredPosts(),async w=>{
    const {c,server,trace}=w;
    const oldRun=c.syncNow();await tick();
    c.authGeneration++;c.auth={loginId:'other',token:'t2'};otherQueue=[{kind:'fav',id:'f'}];c.pushQueue=otherQueue;trace.push(['switch']);
    const newRun=c.syncNow();await tick();trace.push(['pending',server.pending.length]);
    server.pending[0].resolve({accepted:{favorites:['f'],sightings:[]}});await oldRun;trace.push(['old-done']);
    assert.equal(c.pushQueue,otherQueue);
    server.pending[1].resolve({accepted:{favorites:['f'],sightings:[]}});await newRun;
  },()=>({state:{favorites:[{id:'f'}],pushQueue:[{kind:'fav',id:'f'}]}}));
  const between=out.trace.slice(out.trace.findIndex(x=>x[0]==='switch'),out.trace.findIndex(x=>x[0]==='old-done'));
  assert.deepEqual(between.filter(x=>x[0]==='store'||x[0]==='render'),[]);
  assert.deepEqual(out.trace.filter(x=>x[0]==='pending').map(x=>x[1]),[2]);
  assert.deepEqual(out.state.syncInfo,{loginId:'other',rev:1,records:1});
});

test('容量不足（queue保存失敗・記録snapshot例外）の続行と文言が旧sourceと同じ',async()=>{
  const server=()=>({handle:async(m,p,body)=>m==='POST'?acceptAll(body):{favorites:[],sightings:[],rev:1}});
  const queueFull=await same(server,async w=>{w.c.queuePush('fav','f');await tick();await w.c.syncNow();},()=>({state:{favorites:[{id:'f'}]},failKey:'sorami.queue'}));
  assert.equal(posts(queueFull.trace).length,1);
  const snapFull=await same(server,async w=>{await w.c.syncNow();},()=>({seed:[[PLAN_KEY,[plan('p','local')]]],failLocal:k=>k.startsWith('sorami.recordSync.v1:')}));
  assert.equal(snapFull.state.syncError,'記録を端末に保存できませんでした。空き容量や保存設定を確認して、同期を再試行してください。');
  assert.equal(posts(snapFull.trace).length,0);
});

test('applyIncomingは送信待ちを優先し、未ログインのqueuePushは何もしない',async()=>{
  const got={favorites:[{id:'f',body:JSON.stringify({name:'old'})},{id:'n',body:JSON.stringify({name:'n'})}],sightings:[{id:'s',deleted:true}]};
  const out=await same(()=>({handle:async()=>{throw Error('unused');}}),async w=>{w.c.applyIncoming(got);w.c.auth=null;w.c.queuePush('fav','x');await w.c.syncNow();},
    ()=>({state:{favorites:[{id:'f',name:'new'}],sightings:[{id:'s'}],pushQueue:[{kind:'fav',id:'f'},{kind:'sight',id:'s'}]}}));
  assert.deepEqual(out.state.favorites,[{id:'f',name:'new'},{id:'n',name:'n'}]);assert.deepEqual(out.state.sightings,[{id:'s'}]);
  assert.deepEqual(out.trace.map(x=>x[0]),['rec','store','store','refresh']);
});

test('constructorはstate/storage/fetch/callbackへ触れない',()=>{
  const touched=[];const spy=name=>new Proxy(()=>{},{get:(t,k)=>{touched.push([name,'get',String(k)]);return undefined;},set:(t,k)=>{touched.push([name,'set',String(k)]);return true;},apply:()=>{touched.push([name,'call']);}});
  const api=AccountSync.create({state:spy('state'),session:{auth:spy('auth'),generation:spy('generation')},apiCall:spy('apiCall'),store:spy('store'),toItem:spy('toItem'),cleanFavorite:spy('cleanFavorite'),cleanSighting:spy('cleanSighting'),records:spy('records'),refresh:spy('refresh'),render:spy('render')});
  assert.deepEqual(touched,[]);assert.deepEqual(Object.keys(api),['queuePush','syncNow','applyIncoming']);
  const other=AccountSync.create({state:spy('state'),session:{auth:()=>null,generation:()=>0},apiCall:spy('apiCall'),store:spy('store'),records:spy('records'),refresh:spy('refresh'),render:spy('render')});
  assert.notEqual(other.syncNow,api.syncNow);
});

test('controllerのwrapperは初回呼出しで1回だけ作り、同じPromiseを返し、状態portは現在の変数を読む',()=>{
  const created=[],hooks=[],result=Promise.resolve('same');
  const c={store:{setWriteHook:f=>hooks.push(f)},auth:{loginId:'a'},authGeneration:3,pushQueue:[],syncInfo:null,syncError:null,favorites:[],sightings:[],
    toItem(){},cleanFavorite(){},cleanSighting(){},renderAuthButton(){},apiCall(){},
    AstroNotesAccountSync:{create(deps){created.push(deps);return {queuePush:(k,i)=>['q',k,i],syncNow:()=>result,applyIncoming:g=>['a',g]};}}};
  vm.createContext(c);vm.runInContext(newHead,c);
  assert.equal(hooks.length,1);assert.equal(created.length,0);
  assert.equal(c.syncNow(),result);assert.equal(c.syncNow(),result);assert.deepEqual(c.queuePush('fav','x'),['q','fav','x']);
  assert.equal(created.length,1);
  const {state,session,records}=created[0],next=[{kind:'fav',id:'y'}];
  assert.equal(state.pushQueue,c.pushQueue);state.pushQueue=next;assert.equal(c.pushQueue,next);
  c.favorites=[{id:'z'}];assert.equal(state.favorites,c.favorites);
  state.syncError='e';assert.equal(c.syncError,'e');
  c.auth={loginId:'b'};c.authGeneration=4;assert.equal(session.auth(),c.auth);assert.equal(session.generation(),4);
  assert.equal(records(),undefined);
});
