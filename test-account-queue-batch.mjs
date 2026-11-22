import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url),AccountSync=require('./src/services/account-sync.js');
const tick=()=>new Promise(setImmediate);
function fixture(queue=[]){
 const state={pushQueue:queue,favorites:[],sightings:[],syncInfo:null,syncError:null},writes=[],pending=[];
 let auth={loginId:'owner'},generation=1,renders=0,scans=0;
 const api=AccountSync.create({state,session:{auth:()=>auth,generation:()=>generation},store:{set:(key,value)=>{writes.push([key,structuredClone(value)]);return true;}},
  apiCall:(method,path,body)=>method==='POST'?new Promise(resolve=>pending.push({body,resolve})):Promise.resolve({favorites:[],sightings:[],rev:1}),
  toItem:(row,deleted)=>({id:row.id,body:row,deleted}),cleanFavorite:x=>x,cleanSighting:x=>x,
  records:()=>({scan(){scans++;},items:()=>[],apply(){}}),refresh(){},render(){renders++;}});
 return {api,state,writes,pending,renders:()=>renders,scans:()=>scans,logout:()=>auth=null,switch:()=>{auth={loginId:'other'};generation++;}};
}
test('batch enqueue retains first positions and duplicate queue entries, with one save/render/start',()=>{
 const first={kind:'fav',id:'a'},duplicate={kind:'fav',id:'a'},sight={kind:'sight',id:'a'},untouched={kind:'fav',id:'b'};
 const f=fixture([first,duplicate,sight,untouched]),input=[{kind:'fav',id:'c'},{kind:'fav',id:'a'},{kind:'sight',id:'a'},{kind:'fav',id:'c'}];
 f.api.queuePushAll(input);
 assert.deepEqual(f.state.pushQueue,[{kind:'fav',id:'a'},duplicate,{kind:'sight',id:'a'},untouched,{kind:'fav',id:'c'}]);
 assert.notEqual(f.state.pushQueue[0],first);assert.equal(f.state.pushQueue[1],duplicate);assert.equal(f.state.pushQueue[3],untouched);
 assert.notEqual(f.state.pushQueue[4],input[3],'input objects are never used as acknowledgement identities');
 assert.equal(f.writes.length,1);assert.equal(f.renders(),1);assert.equal(f.scans(),1);assert.equal(f.pending.length,1);
});
test('empty batches and logged-out batches have no side effects',()=>{
 const f=fixture([{kind:'fav',id:'a'}]),original=f.state.pushQueue[0];f.api.queuePushAll([]);f.logout();f.api.queuePushAll([{kind:'fav',id:'a'}]);
 assert.equal(f.state.pushQueue[0],original);assert.equal(f.writes.length,0);assert.equal(f.renders(),0);assert.equal(f.scans(),0);assert.equal(f.pending.length,0);
});
test('pure queue preparation matches legacy ordering and preserves untouched identities without mutating its input',()=>{
 let seed=6471;const rand=n=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)%n),kinds=['fav','sight','rec'];
 for(let round=0;round<250;round++){
  const queue=Array.from({length:40},()=>({kind:kinds[rand(3)],id:'p'+rand(20)})),changes=Array.from({length:25},()=>({kind:kinds[rand(3)],id:'p'+rand(30)})),original=queue.slice(),expected=queue.slice();
  for(const {kind,id} of changes){const at=expected.findIndex(q=>q.kind===kind&&q.id===id),change={kind,id};if(at<0)expected.push(change);else expected[at]=change;}
  const actual=AccountSync.queueChanges(queue,changes);assert.deepEqual(actual,expected);assert.deepEqual(queue,original);assert(queue.every((q,i)=>q===original[i]));
  for(let i=0;i<queue.length;i++)if(expected[i]===queue[i])assert.equal(actual[i],queue[i]);else assert.notEqual(actual[i],queue[i]);
 }
});
test('a pending POST cannot acknowledge batch edits made after its snapshot',async()=>{
 const old={kind:'fav',id:'a'},f=fixture([old]);f.state.favorites=[{id:'a',name:'old'}];const running=f.api.syncNow();
 f.state.favorites=[{id:'a',name:'new'},{id:'b',name:'added'}];f.api.queuePushAll([{kind:'fav',id:'a'},{kind:'fav',id:'b'},{kind:'fav',id:'a'}]);
 assert.equal(f.pending.length,1);const latest=f.state.pushQueue[0];assert.notEqual(latest,old);
 f.pending[0].resolve({accepted:{favorites:['a'],sightings:[]}});await tick();
 assert.equal(f.pending.length,2);assert.equal(f.state.pushQueue[0],latest);assert.deepEqual(f.pending[1].body.favorites.map(x=>x.body.name),['new','added']);
 f.pending[1].resolve({accepted:{favorites:['a','b'],sightings:[]}});await running;assert.deepEqual(f.state.pushQueue,[]);
});
test('an old account response cannot acknowledge the replacement account queue',async()=>{
 const f=fixture();f.api.queuePushAll([{kind:'fav',id:'a'}]);f.switch();const other=[{kind:'fav',id:'a'}];f.state.pushQueue=other;
 const written=f.writes.length;f.pending[0].resolve({accepted:{favorites:['a'],sightings:[]}});await tick();assert.equal(f.state.pushQueue,other);assert.equal(f.writes.length,written);
});
test('large batches inspect an existing queue linearly and serialize it once',()=>{
 let reads=0;const n=2000,queue=Array.from({length:n},(_,i)=>({kind:'fav',get id(){reads++;return 'p'+i;}})),f=fixture(queue);
 f.api.queuePushAll(Array.from({length:n},(_,i)=>({kind:'fav',id:'p'+i})));
 assert(reads<=n*2,`existing queue accessed ${reads} times`);assert.equal(f.writes.length,1);assert.equal(f.writes[0][1].length,n);assert.equal(f.renders(),1);assert.equal(f.pending.length,1);
});
test('record batch adapter uses the current owner once and supports older cached HTML',()=>{
 const source=readFileSync(new URL('./astronotes-myplaces.js',import.meta.url),'utf8'),helper=source.slice(source.indexOf('function queueFavoriteChanges'),source.indexOf('function notebookCommit'));
 const batches=[],singles=[],sync={queuePushAll:items=>batches.push(items),queuePush:(...args)=>singles.push(args)},c=vm.createContext({accountSync:()=>sync});vm.runInContext(helper,c);
 c.queueFavoriteChanges([]);assert.equal(batches.length,0);c.queueFavoriteChanges(['a','b']);assert.deepEqual(JSON.parse(JSON.stringify(batches)),[[{kind:'fav',id:'a'},{kind:'fav',id:'b'}]]);assert.equal(singles.length,0);
 delete sync.queuePushAll;c.queueFavoriteChanges(['a','b']);assert.deepEqual(singles,[['fav','a'],['fav','b']]);
});
test('target category rename submits all changed favorites in one batch',()=>{
 const source=readFileSync(new URL('./src/features/framing/controller.js',import.meta.url),'utf8'),code=source.slice(source.indexOf('function editTargetCategory'),source.indexOf('function aimFavTarget'));
 const batches=[],writes=[],c=vm.createContext({favorites:[{id:'a',targetCategory:'old'},{id:'b',targetCategory:'old'},{id:'c',targetCategory:'keep'}],targetUserCategories:()=>['old','keep'],store:{set(){}},
  AstroNotesLibrary:{transaction:(s,entries)=>writes.push(entries)},localStorage:{},accountSync:()=>({queuePushAll:items=>batches.push(items)}),renderSheet(){}});vm.runInContext(code,c);c.editTargetCategory('rename','old','new');
 assert.equal(writes.length,1);assert.deepEqual(c.favorites.map(x=>x.targetCategory),['new','new','keep']);assert.deepEqual(JSON.parse(JSON.stringify(batches)),[[{kind:'fav',id:'a'},{kind:'fav',id:'b'}]]);
});
