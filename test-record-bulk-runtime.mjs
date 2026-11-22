import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),L=require('./astronotes-library.js'),G=require('./astronotes-terrain.js');
const source=readFileSync(new URL('./astronotes-myplaces.js',import.meta.url),'utf8');
const section=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to,source.indexOf(from)));
const target={key:'skytree',name:'東京スカイツリー',latitude:35.7101,longitude:139.8107},extra={...target,key:'fuji',name:'富士山'};
function fixture(n=4){
 const favorites=Array.from({length:n},(_,i)=>({id:'p'+i,name:'地点 '+i,latitude:35+i*.0001,longitude:139,elevation:5,eyeHeightAGL:1.5,recordRegistered:true}));
 const records=favorites.map((p,i)=>({id:'r'+i,placeId:p.id,target,observer:p,result:'seen',registration:true,createdAt:1,updatedAt:1})).map(L.cleanObservation);
 const keys=L.keys('owner'),values=new Map([[keys.observations,JSON.stringify(records)],[keys.shapes,'{}'],['sorami.favorites',JSON.stringify(favorites)]]);let reads=0,fail=null;
 const localStorage={getItem:k=>values.get(k)??null,setItem(k,v){if(k===fail){fail=null;throw Error('quota');}values.set(k,v);},removeItem:k=>values.delete(k)};
 const state={owner:'token'},c=vm.createContext({AstroNotesLibrary:L,AstroNotesTerrain:G,auth:{token:'token',loginId:'owner'},favorites,localStorage,
  store:{get:(k,d)=>{if(k===keys.observations)reads++;return values.has(k)?JSON.parse(values.get(k)):d;}},notebookEdit:state,notebookGeneration:{cancel(){}},viewState:{records:true},toolAllowed:()=>true,
  shapeData:()=>JSON.parse(values.get(keys.shapes)),RecordSync:{kick(){}},accountSync:()=>({queuePush(){}}),candidateCache:new Map(),changed(){},aimFillSelects(){},SkyMapUI:{refreshTargets(){}},renderRecordsHub(){}});
 vm.runInContext(section('const RESULTS','// 目標は構図')+'\n'+section('function notebookStamp','function notebookAddTargets')+'\n'+section('const targetData','const draftChanged'),c);
 return {c,state,keys,values,records,favorites,reads:()=>reads,reset:()=>reads=0,fail:k=>fail=k,stamp:ids=>c.notebookStamp(ids),commit:(ids,stamp)=>c.notebookCommit('add',state,ids,stamp,[extra]),replace:rows=>values.set(keys.observations,JSON.stringify(rows))};
}
test('bulk commit reads one fresh observation snapshot after its stale guard, independent of selected count',()=>{
 const f=fixture(500),ids=f.favorites.map(p=>p.id),stamp=f.stamp(ids);f.reset();
 assert.equal(f.commit(ids,stamp),true);assert.equal(f.reads(),2,'one stale check and one shared commit snapshot');
 const rows=JSON.parse(f.values.get(f.keys.observations));assert.equal(rows.length,1000);assert.deepEqual(rows.slice(500).map(r=>r.placeId),ids);
 assert.deepEqual(rows.slice(0,500),f.records,'existing history is retained unchanged');
});
test('bulk snapshot preserves target order, removed registrations, hidden results and observer height invalidation',()=>{
 const f=fixture(),rows=[...f.records,{...f.records[0],id:'other',target:extra},{...f.records[1],id:'removed',removed:true,createdAt:2},{...f.records[3],id:'hidden',result:'hidden',createdAt:2}];
 f.favorites[2].eyeHeightAGL=20;f.replace(rows);
 const ids=['p3','p2','p1','p0'],stamp=f.stamp(ids);assert.equal(f.c.notebookCommit('add',f.state,ids,stamp,[target,extra]),true);
 const added=JSON.parse(f.values.get(f.keys.observations)).slice(rows.length);
 assert.deepEqual(added.map(r=>[r.placeId,r.target.key]),ids.slice(0,3).flatMap(id=>[[id,'skytree'],[id,'fuji']]));
 assert(added.filter(r=>r.placeId==='p2').every(r=>r.observer.eyeHeightAGL===20));
});
test('bulk stale changes are rejected before writing and a failed transaction restores every bucket',()=>{
 const f=fixture(),ids=['p0','p1'],stamp=f.stamp(ids);f.replace([...f.records,{...f.records[0],id:'new',removed:true,createdAt:2}]);const stale=[...f.values];
 assert.equal(f.commit(ids,stamp),false);assert.match(f.state.error,/変更/);assert.deepEqual([...f.values],stale);
 for(const failure of [f.keys.observations,f.keys.shapes]){
  const g=fixture(),mark=g.stamp(ids),before=[...g.values];g.fail(failure);assert.equal(g.commit(ids,mark),false);assert.match(g.state.error,/取り消しました/);assert.deepEqual([...g.values],before);assert.equal(g.c.notebookEdit,g.state);
 }
});
