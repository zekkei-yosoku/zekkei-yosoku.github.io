import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),L=require('./astronotes-library.js'),S=require('./astronotes-shooting.js');
const place={id:'p',name:'川沿い',latitude:35,longitude:139,elevation:12,eyeHeightAGL:1.5};
const line={type:'line',vertices:[{latitude:35,longitude:139},{latitude:35.001,longitude:139}]};
const target={key:'skytree',name:'東京スカイツリー',latitude:35.71,longitude:139.81};
const fullTarget={...target,id:target.key,groundM:10,parts:[{id:'tip',name:'先端',m:644}]};
function quick(extra={}){return L.prepareQuickRecord({owner:'owner',favorites:[],observations:[],shapes:{},observer:place,target:fullTarget,knownTargets:[fullTarget],currentTargets:()=>[],cleanShape:S.cleanShape,...extra});}
test('直接登録は地点・対象・高さを継承し実績や予定を作らず、同じ条件は書換不要',()=>{
 const p=quick();assert.equal(p.favorites.length,1);assert.equal(p.place.name,place.name);assert.equal(p.place.eyeHeightAGL,1.5);assert.equal(p.observations.length,1);assert(p.observations[0].registration);assert.equal(p.observations[0].date,'');
 const again=quick({favorites:p.favorites,observations:p.observations,currentTargets:()=>[target]});assert(again.already);assert.deepEqual(again.observations,p.observations);assert.deepEqual(again.favorites,p.favorites);
 const high=quick({favorites:p.favorites,observer:{...place,eyeHeightAGL:229}});assert.equal(high.favorites.length,2);assert.equal(high.place.eyeHeightAGL,229);assert.equal(high.favorites[0].eyeHeightAGL,1.5);
 const adjacent=quick({favorites:p.favorites,observer:{...place,latitude:place.latitude+.0001}});assert.equal(adjacent.favorites.length,2);assert.notEqual(adjacent.place.id,p.place.id);
});
test('直接登録は既存対象・形・名前を保持し、custom対象を近傍の既存地点へ吸収しない',()=>{
 const draft={...fullTarget,id:'custom',name:'自分の対象',groundM:12,parts:[{id:'tip',name:'先端',m:42}]},existing={...place,id:'neighbor',latitude:draft.latitude,longitude:draft.longitude,note:'保持'};
 const p=quick({favorites:[place,existing],shapes:{p:{latitude:35,longitude:139,shape:line}},target:draft,currentTargets:()=>[{...target,key:'fuji',name:'富士山'}]});
 assert.deepEqual(p.favorites.find(f=>f.id==='neighbor'),existing);assert.deepEqual(p.shapes.p.shape,line);assert.equal(p.observations.length,1);assert(p.observations[0].target.key.startsWith('fav:target-'));
 const again=quick({favorites:p.favorites,observations:p.observations,target:draft,currentTargets:()=>[p.observations[0].target]});assert(again.already);assert.equal(again.favorites.length,p.favorites.length);
 assert.throws(()=>quick({target:{...draft,parts:[...draft.parts,{id:'other',m:20}]}}),/形/);assert.throws(()=>quick({target:{...draft,widthM:10}}),/形/);
});
test('直接登録の保存失敗は地点と登録の両方を復元する',()=>{
 const p=quick();for(const failure of p.entries.map(([k])=>k)){const storage=disk();for(const[k]of p.entries)storage.setItem(k,'[]');const before=[...storage.values];storage.fail(failure);assert.throws(()=>L.transaction(storage,p.entries),/取り消しました/);assert.deepEqual([...storage.values],before);}
});
test('富士山は既知の形を保ち、自動標高の取得だけでは既存地点を増やさない',()=>{
 const fuji={id:'fuji',name:'富士山',latitude:35.36,longitude:138.73,parts:[{id:'tip',name:'山頂',m:3776}]};
 const f={...place,elevation:null},p=quick({favorites:[f],observer:{...place,groundManualM:null},target:{...fuji,groundM:3776},knownTargets:[fuji]});
 assert.equal(p.favorites.length,1);assert.equal(p.place.id,f.id);assert.equal(p.observations[0].target.key,'fuji');assert.deepEqual(p.favorites[0],f);
 const old={...target,name:'以前の名称',latitude:35.7},same=quick({favorites:[place],observations:L.registrationChanges(place,[],[old]),currentTargets:()=>[old]});
 assert(same.already);assert.equal(same.observations.length,1);assert.equal(same.observations[0].target.name,'以前の名称');
});
function disk(){const values=new Map(),calls=[];let fail=null;return {values,calls,fail:k=>fail=k,getItem:k=>values.get(k)??null,setItem(k,v){calls.push(k);if(k===fail){fail=null;throw Error('quota');}values.set(k,v);},removeItem:k=>values.delete(k)};}
function plan(extra={}){return L.prepareRecord({owner:'owner',favorites:[],observations:[],shapes:{},place,isNew:true,initialTargets:[],targets:[target],shape:line,cleanShape:S.cleanShape,...extra});}
test('対象作成は下書きだけを返し、お気に入りを変更しない。20m以内の同一地点はIDを使う',()=>{
 const favorites=[{...place,note:'メモ',phenomena:['moon']}];const d=L.targetDraft({...place,elevation:12},{name:'展望塔',heightM:30,favorites});
 assert.equal(favorites[0].name,'川沿い');assert.equal(d.entry.id,'p');assert.equal(d.entry.targetHeightM,30);assert.equal(d.entry.note,'メモ');assert.equal(L.targetFromFavorite(d.entry).parts[0].m,42);
 assert.throws(()=>L.targetDraft(place,{name:'',heightM:1}),/名前/);for(const h of [-1,1001,NaN])assert.throws(()=>L.targetDraft(place,{name:'塔',heightM:h}));
});
test('未保存の対象を再編集してもIDは増えない',()=>{
 const first=L.targetDraft({latitude:36,longitude:140},{name:'塔',heightM:10}),second=L.targetDraft(first.entry,{name:'塔2',heightM:20,id:first.entry.id});
 assert.equal(second.entry.id,first.entry.id);
});
test('別画面の対象編集・削除を下書きで上書きしない',()=>{
 const first=L.targetDraft(place,{name:'塔',heightM:1,favorites:[place]});
 assert.throws(()=>L.applyDrafts([{...place,name:'変更された地点'}],[first]),/別の画面/);assert.throws(()=>L.applyDrafts([],[first]),/別の画面/);
});
test('地点・形・選択した新規対象だけを最後に一括保存する',()=>{
 const d1=L.targetDraft({latitude:36,longitude:140},{name:'塔1'}),d2=L.targetDraft({latitude:37,longitude:141},{name:'塔2'}),t1=L.targetFromFavorite(d1.entry);
 const p=plan({targets:[target,t1],drafts:[d1,d2]});assert.equal(p.favorites.length,2);assert.equal(p.observations.length,2);assert(p.favorites.some(f=>f.id===d1.entry.id));assert(!p.favorites.some(f=>f.id===d2.entry.id));assert.equal(p.shapes.p.shape.type,'line');
 const storage=disk();L.transaction(storage,p.entries);assert.equal(JSON.parse(storage.getItem('sorami.favorites')).length,2);assert.equal(JSON.parse(storage.getItem(L.keys('owner').observations)).length,2);
});
test('未確定の下書きと取消は永続データを変更しない',()=>{
 const original=[{...place}],d=L.targetDraft({latitude:36,longitude:140},{name:'塔'});L.prepareRecord({owner:'owner',favorites:original,observations:[],shapes:{},place,isNew:false,initialTargets:[],targets:[L.targetFromFavorite(d.entry)],shape:null,drafts:[d]});assert.equal(original.length,1);assert.equal(original[0].name,'川沿い');
});
test('各保存段階で失敗したら全キーを元に戻し、成功として扱わない',()=>{
 for(const failure of plan().entries.map(([k])=>k)){
  const storage=disk();storage.setItem('sorami.favorites','[{"id":"old"}]');storage.setItem(L.keys('owner').observations,'[]');const before=[...storage.values];storage.fail(failure);assert.throws(()=>L.transaction(storage,plan().entries),/取り消しました/);assert.deepEqual([...storage.values],before);
 }
});
test('新規/既存は同じ保存計画を使い、未知地点・不正な形を拒否する',()=>{
 const p=plan({favorites:[place],isNew:false});assert.equal(p.favorites.length,1);assert.equal(p.observations[0].observer.elevation,12);
 assert.throws(()=>plan({isNew:false}),/登録から外/);assert.throws(()=>plan({shape:{type:'area',vertices:[]}}),/線・範囲/);
});
test('対象の改名は同じIDの最新登録を追記し、過去の記録を改変しない',()=>{
 const original=L.registrationChanges(place,[],[target],1),next=L.registrationChanges(place,[target],[{...target,name:'新しい名前'}],2);
 assert.equal(next.length,1);assert.equal(next[0].target.key,target.key);assert.equal(next[0].target.name,'新しい名前');assert.equal(original[0].target.name,'東京スカイツリー');assert.equal(next[0].date,'');
});
const cleaners={cleanFavorite:f=>L.point(f)&&f.id?f:null,cleanSighting:r=>r?.id?r:null,cleanShape:S.cleanShape};
test('v2の書き出し→読込で地点・対象との関係・折れ線・登録日を保持する',()=>{
 const p=plan(),data=L.backup({...p,sightings:[{id:'score'}],owner:'owner'}),restored=L.restore(data,{favorites:[],sightings:[],observations:[],shapes:{},...cleaners});
 assert.equal(data.schemaVersion,2);assert.equal(restored.favorites[0].name,place.name);assert.deepEqual(restored.shapes.p.shape,line);assert.equal(restored.observations[0].createdAt,p.observations[0].createdAt);assert.equal(restored.sightings[0].id,'score');assert.equal(restored.dropped,0);
});
test('旧配列/旧オブジェクトを読み込んでも現行の対象・形を消さない',()=>{
 const p=plan();for(const data of [[{id:'legacy'}],{favorites:[],sightings:[{id:'legacy'}]}]){
  const r=L.restore(data,{...p,sightings:[],...cleaners});assert.equal(r.shapes.p.shape.type,'line');assert.equal(r.observations.length,1);assert.equal(r.favorites.length,1);assert.equal(r.sightings[0].id,'legacy');
 }
});
test('不正な形・移動した代表点・孤立した対象・未対応schemaを無言で採用しない',()=>{
 const p=plan(),data=L.backup({...p,sightings:[],owner:'owner'});data.library.shapes.p.latitude=36;data.library.observations.push({...p.observations[0],id:'orphan',placeId:'unknown'});
 const r=L.restore(data,{favorites:[],sightings:[],observations:[],shapes:{},...cleaners});assert.equal(r.dropped,2);assert.equal(r.shapes.p,undefined);assert.equal(r.observations.length,1);assert.throws(()=>L.restore({...data,schemaVersion:99},{...p,sightings:[],...cleaners}),/対応/);
});
test('所有者の保存キーと非同期の世代を分離する',()=>{
 assert.notDeepEqual(L.keys('a'),L.keys('b'));const gate=L.gate(),a=gate.next(),b=gate.next();assert.equal(gate.current(a),false);assert.equal(gate.current(b),true);gate.cancel();assert.equal(gate.current(b),false);
});

const otherPlace={...place,id:'other',name:'別の地点',latitude:36};
function bulk(extra={}){const p=plan({favorites:[otherPlace]});return L.prepareNotebookBulk({owner:'owner',favorites:p.favorites,observations:p.observations,shapes:p.shapes,placeIds:['p'],mode:'delete',...extra});}
test('NOTEBOOK削除は選んだ地点の全記録と形だけ。お気に入り候補・他地点を保持',()=>{
 const rows=[...plan().observations,...L.registrationChanges(otherPlace,[],[target])],shapes={p:{shape:line},other:{shape:line}},favorites=[place,otherPlace];
 const p=bulk({favorites,observations:rows,shapes});assert.deepEqual(p.favorites,favorites);assert.equal(p.observations.length,1);assert.equal(p.observations[0].placeId,'other');assert.equal(p.shapes.p,undefined);assert.deepEqual(p.shapes.other,shapes.other);assert(!p.entries.some(([k])=>k==='sorami.favorites'));assert.equal(rows.length,2);
});
test('複数地点に複数対象を追加しても既存対象を残し同じIDを二重登録しない',()=>{
 const rows=[...L.registrationChanges(place,[],[target]),...L.registrationChanges(otherPlace,[],[target])],next={...target,key:'fuji',name:'富士山'};
 const p=bulk({favorites:[place,otherPlace],observations:rows,placeIds:['p','other','p'],mode:'add',targets:[target,next,next],currentTargets:()=>[target]});
 assert.equal(p.observations.length,4);assert.equal(p.observations.filter(r=>r.target.key==='fuji').length,2);assert.equal(p.observations.filter(r=>r.target.key==='skytree').length,2);assert.deepEqual(p.favorites,[place,otherPlace]);
});
test('一括追加で選択した新規対象だけを保存、未使用下書きは残さない',()=>{
 const draft=L.targetDraft({latitude:38,longitude:140},{name:'自作対象',heightM:10}),unused=L.targetDraft({latitude:39,longitude:141},{name:'未使用'});
 const p=bulk({mode:'add',targets:[L.targetFromFavorite(draft.entry)],drafts:[draft,unused],currentTargets:()=>[target]});assert(p.favorites.some(f=>f.id===draft.entry.id));assert(!p.favorites.some(f=>f.id===unused.entry.id));assert.equal(p.observations.length,2);
});
test('一括操作の保存失敗は全地点の記録と形を復元する',()=>{
 const p=bulk();for(const failure of p.entries.map(([k])=>k)){const storage=disk();for(const [k]of p.entries)storage.setItem(k,JSON.stringify(k.includes('Shapes')?{p:{shape:line}}:[{id:'before'}]));const before=[...storage.values];storage.fail(failure);assert.throws(()=>L.transaction(storage,p.entries),/取り消しました/);assert.deepEqual([...storage.values],before);}
});
test('一括操作は未選択・未登録・候補だけの地点を拒否する',()=>{
 assert.throws(()=>bulk({placeIds:[]}),/選んで/);assert.throws(()=>bulk({placeIds:['unknown']}),/変更/);assert.throws(()=>bulk({placeIds:['other']}),/変更/);assert.throws(()=>bulk({mode:'add',targets:[],currentTargets:()=>[]}),/対象/);
});
test('既存地点の名前だけの保存はID/座標/形/過去記録を保持して同期対象にする',()=>{
 const original={...place,note:'保持',targetHeightM:15},other={...place,id:'other',name:'別地点'};
 const observations=[{id:'past',placeId:place.id,note:'過去'}];
 const p=plan({favorites:[original,other],observations,place:{...original,name:'川沿い東側'},isNew:false,initialTargets:[target]});
 assert.equal(original.name,'川沿い');assert.deepEqual(p.favorites[0],{...original,name:'川沿い東側'});assert.deepEqual(p.favorites[1],other);
 assert.deepEqual(p.changedFavorites,['p']);assert.deepEqual(p.observations,observations);assert.deepEqual(p.shapes.p.shape,line);
 const unchanged=plan({favorites:[original],place:original,isNew:false});assert.deepEqual(unchanged.changedFavorites,[]);
 assert.throws(()=>plan({favorites:[original],place:{...original,name:'  '},isNew:false}),/情報/);
 const storage=disk();storage.setItem('sorami.favorites',JSON.stringify([original]));storage.fail(L.keys('owner').shapes);assert.throws(()=>L.transaction(storage,p.entries),/取り消しました/);assert.equal(JSON.parse(storage.getItem('sorami.favorites'))[0].name,'川沿い');
});
