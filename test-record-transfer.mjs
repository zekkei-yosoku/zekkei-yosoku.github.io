import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {createRecordTransfer} from './tools/record-transfer-policy.mjs';import {createRecordHeightPolicy} from './tools/record-height-policy.mjs';import {createRecordAlignmentPolicy} from './tools/record-alignment-policy.mjs';import {createRecordCsv} from './tools/record-transfer-csv.mjs';
const require=createRequire(import.meta.url),library=require('./astronotes-library.js');require('./astronotes-shooting.js');const shooting=globalThis.AstroNotesShooting;
const builtins=[{id:'skytree',name:'東京スカイツリー',latitude:35.71,longitude:139.81,parts:[{id:'tip',name:'先端',m:634}]}],bodies=['sun','moon','sirius'],alignment=createRecordAlignmentPolicy({isMountain:t=>t?.id==='fuji',limbs:[{id:'onTop'},{id:'center'},{id:'behind'}]});
const currentStatus=(p,key,rows)=>{const group=rows.filter(r=>r.placeId===p.id&&r.target.key===key).sort((a,b)=>Number(!!b.registration)-Number(!!a.registration)||(b.updatedAt-a.updatedAt));return group[0]?.removed?null:group[0]||null;};
const browserState=readFileSync('src/app/browser-state.js','utf8'),cleanStart=browserState.indexOf('function cleanFavorite(f) {'),cleanEnd=browserState.indexOf('\nconst DEFAULT_PLACE',cleanStart);
const actualCleanFavorite=vm.runInNewContext('('+browserState.slice(cleanStart,cleanEnd).trim()+')',{isText:v=>typeof v==='string'&&v.length<=2000,freshDecks:f=>f,AstroNotesTerrain:{locationScope:()=> 'point'},TERRAINS:[['plain'],['coast']],S:{PHENOMENA:{}}});
const cleanFromBrowser=f=>JSON.parse(JSON.stringify(actualCleanFavorite(f)));
function policy(extra={}){let id=0;return createRecordTransfer({library,cleanFavorite:f=>({...f,locationScope:'point'}),cleanShape:shooting.cleanShape,cleanAlignment:alignment.clean,rangeOf:createRecordHeightPolicy().range,bodyIds:bodies,builtins,currentStatus,makeId:prefix=>prefix+'new-'+(++id),now:()=>1794000000000,...extra});}
const favorite={id:'sender-place',name:'河川敷',subtitle:'市川市',latitude:35.73874,longitude:139.90204,elevation:5,groundManualM:6.2,eyeHeightAGL:20,eyeHeightRangeAGL:{min:20,max:150},planningBodies:['moon','sun'],note:'入口は北側'};
const custom={id:'sender-target',name:'独自の塔',latitude:35.75,longitude:139.92,elevation:8.2,groundManualM:9.1,eyeHeightAGL:1.5,targetHeightM:87,targetCategory:'目印'};
const record=(place,key,result='seen',id=key)=>({id,placeId:place.id,target:{key,name:key==='skytree'?'東京スカイツリー':custom.name,latitude:35.75,longitude:139.92},observer:place,result,registration:true,removed:false,createdAt:1,updatedAt:1});
function source(){const p=structuredClone(favorite);p.recordAlignments={'fav:sender-target':{partId:'tip',limb:'onTop',matchMode:'limb'}};return {favorites:[p,structuredClone(custom)],observations:[record(p,'skytree'),record(p,'fav:sender-target','partial')],shapes:{[p.id]:{latitude:p.latitude,longitude:p.longitude,shape:{type:'line',vertices:[{latitude:p.latitude,longitude:p.longitude},{latitude:p.latitude+.001,longitude:p.longitude}]}}},placeIds:[p.id]};}
const empty=()=>({favorites:[],observations:[],shapes:{},owner:'recipient'});
// Exercise the actual file-selection handler without a browser or persistence.
// The policy is real; these nodes supply only the preview DOM used by that handler.
async function importPreview(raw){
 const nodes=new Map();
 class Node{
  constructor(tag){this.tagName=tag;this.children=[];this.textContent='';}
  set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id;}
  append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;}
  setAttribute(name,value){this[name]=value;}
 }
 for(const id of ['recordTransferTitle','recordTransferContent']){const n=new Node('div');n.id=id;}
 let plan=null,modelLoads=0,writes=0;const actual=policy();
 const testPolicy={...actual,prepareImport:(...args)=>(plan=actual.prepareImport(...args))};
 const context=vm.createContext({document:{createElement:tag=>new Node(tag)},window:{addEventListener(){}},el:id=>nodes.get(id),
  testPolicy,auth:{loginId:'recipient'},accessState:{generation:0},favorites:[],load:()=>[],shapeData:()=>({}),
  AstroNotesAssets:{ensureModels:async()=>{modelLoads++;}},
  AstroNotesBodies:{definition:id=>({name:id})},
  AstroNotesLibrary:{...library,transaction:()=>{writes++;throw Error('preview must not write');}}});
 vm.runInContext(readFileSync('tools/record-transfer-runtime.js','utf8')+
  '\ntransferState={};transferDialog={open:true};transferCurrent=()=>true;transferPolicy=()=>testPolicy;transferImport();',context);
 const input=nodes.get('recordTransferFile');input.files=[{size:Buffer.byteLength(raw),text:async()=>raw}];
 await input.onchange();
 return {plan,modelLoads,writes,input,apply:nodes.get('recordTransferApply'),
  messages:nodes.get('recordTransferPreview').children.filter(n=>n.role==='status').map(n=>n.textContent)};
}
test('native JSON file handler accepts normal and BOM exports without writing during preview',async()=>{
 const data=policy().exportPlaces(source());
 for(const prefix of ['', '\uFEFF \r\n']){
  const result=await importPreview(prefix+JSON.stringify(data));
  assert.equal(result.input.accept,'.json,application/json');assert(result.apply,JSON.stringify(result.messages));assert.equal(result.modelLoads,1);assert.equal(result.writes,0);assert.deepEqual(result.messages,[]);
  const point=result.plan.favorites.find(f=>f.recordRegistered),again=policy().exportPlaces({...result.plan,placeIds:[point.id]});
  assert.deepEqual(JSON.parse(JSON.stringify(again)),data,'location, heights, shapes, bodies, target definitions and bindings survive');
 }
});
test('native JSON file handler rejects CSV and malformed or incompatible JSON without an apply action',async()=>{
 for(const raw of ['地点名,緯度,経度\n公園,35,139','\uFEFF地点名,緯度,経度\n公園,35,139','{bad','',JSON.stringify({format:'astronotes.places',version:9,places:[],targets:[]})]){
  const result=await importPreview(raw);assert.equal(result.apply,undefined);assert.equal(result.writes,0);assert(result.messages.length);
  if(!raw.startsWith('{"format"')){assert.equal(result.modelLoads,0);assert.match(result.messages[0],/JSONファイル/);}
 }
});
// Kept as offline legacy-parser coverage. The trial generator no longer bundles it.
const csv=createRecordCsv(),encodeCsv=rows=>'\uFEFF'+rows.map(row=>row.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
test('CSV RFC4180 quotes, commas and multiline notes survive preview/import/repeat',()=>{
 const raw=encodeCsv([['地点ID','地点名','緯度','経度','標高_m','目線_m','対象','天体','メモ','根拠URL'],['p1','公園,"西"',35,139,0,1.5,'スカイツリー','太陽|月','改行\nも保存','https://example.test/sky'],['p1','公園,"西"',35,139,0,1.5,'東京スカイツリー','太陽|月','改行\nも保存','https://example.test/other']]);
 const data=csv.parse(raw),first=policy().prepareImport(data,empty());assert(first.canImport);assert.equal(first.report.addedPlaces,1);assert.equal(first.report.addedBindings,1);assert.equal(data.targets.length,1);assert.equal(data.places[0].location.elevation,0);assert(data.places[0].location.note.includes('改行\nも保存'));assert(data.places[0].location.note.includes('https://example.test/other'));assert.equal(policy().prepareImport(data,{favorites:first.favorites,observations:first.observations,shapes:first.shapes,owner:'recipient'}).report.addedPlaces,0);
});
test('CSV blank optional heights remain unknown, zero stays zero and ranges survive',()=>{
 const data=csv.parse(encodeCsv([['地点名','緯度','経度','標高_m','目線_m','目線下限_m','目線上限_m'],['公園',35,139,'',0,20,150]])),p=policy().validate(data).places[0];assert.equal(p.location.elevation,null);assert.equal(p.location.eyeHeightAGL,0);assert.deepEqual(p.location.eyeHeightRangeAGL,{min:20,max:150});
});
test('CSV custom target is created with coordinates/elevation/height and linked to its place',()=>{
 const data=csv.parse(encodeCsv([['地点名','緯度','経度','対象','対象名','対象緯度','対象経度','対象標高_m','対象高_m','天体','重ねる位置','天体の縁'],['公園',35,139,'custom','独自の塔',35.1,139.1,8.2,87,'月','tip','下の縁']])),plan=policy().prepareImport(data,empty());assert(plan.canImport);assert.equal(plan.report.addedTargets,1);assert.equal(plan.report.addedBindings,1);const t=plan.favorites.find(f=>f.targetHeightM===87),p=plan.favorites.find(f=>f.recordRegistered);assert.equal(t.elevation,8.2);assert.equal(p.recordAlignments['fav:'+t.id].limb,'onTop');
});
test('CSV rejects inconsistent place settings and conflicting repeated bindings',()=>{
 assert.throws(()=>csv.parse('地点ID,地点名,緯度,経度,目線_m\na,公園,35,139,20\na,公園,35,139,50'),/一致/);
 assert.throws(()=>csv.parse('地点名,緯度,経度,対象,結果\n公園,35,139,skytree,seen\n公園,35,139,skytree,hidden'),/一致/);
});
test('CSV rejects malformed quoting, missing coordinates, unknown or duplicate columns and incomplete ranges',()=>{
 for(const raw of ['地点名,緯度,経度\n"閉じない,35,139','地点名,緯度,経度\n"公園"x,35,139','地点名,緯度,経度\n公園,,139','地点名,緯度,経度,注釈\n公園,35,139,x','地点名,緯度,緯度\n公園,35,35','地点名,緯度,経度,目線下限_m\n公園,35,139,20'])assert.throws(()=>csv.parse(raw),/CSV/);
});
test('CSV unknown bodies, unknown targets and invalid ranges go through existing strict validation',()=>{
 assert.throws(()=>policy().validate(csv.parse('地点名,緯度,経度,天体\n公園,35,139,bad')),/天体/);
 assert.throws(()=>policy().validate(csv.parse('地点名,緯度,経度,目線下限_m,目線上限_m\n公園,35,139,150,20')),/範囲/);
 assert.equal(policy().prepareImport(csv.parse('地点名,緯度,経度,対象\n公園,35,139,unknown'),empty()).canImport,false);
});
test('reordering evidence rows leaves the same place identity and CSV rejects orphan target data',()=>{
 const header=['地点名','緯度','経度','対象','根拠URL'],a=['公園',35,139,'skytree','https://example.test/z'],b=['公園',35,139,'東京スカイツリー','https://example.test/a'];assert.deepEqual(csv.parse(encodeCsv([header,a,b])).places,csv.parse(encodeCsv([header,b,a])).places);
 assert.throws(()=>csv.parse('地点名,緯度,経度,対象名\n公園,35,139,独自の塔'),/対象/);assert.throws(()=>csv.parse('地点名,緯度,経度,対象,対象高_m\n公園,35,139,skytree,100'),/custom/);
});
test('CSV trailing empty spreadsheet columns are tolerated without ignoring populated cells',()=>{
 assert.equal(csv.parse('地点名,緯度,経度,,\n公園,35,139,,\n').places.length,1);assert.throws(()=>csv.parse('地点名,緯度,経度,,\n公園,35,139,,lost\n'),/列数/);
});
test('resolved duplicate custom definitions cannot silently discard a conflicting binding',()=>{
 const data=policy().exportPlaces(source()),t=structuredClone(data.targets[1]);t.id='duplicate-target';data.targets.push(t);data.places[0].targets.push({...structuredClone(data.places[0].targets[1]),ref:t.id,result:'hidden'});assert.throws(()=>policy().prepareImport(data,empty()),/重複/);
});
for(const type of ['point','line','area'])test(type+' geometry and height range survive JSON export/import/re-export and CSV import',()=>{
 const p=policy(),s=source();s.favorites[0].recordAlignments={};const vertices=[{latitude:35.73874,longitude:139.90204},{latitude:35.73974,longitude:139.90204},{latitude:35.73974,longitude:139.90304}];s.shapes=type==='point'?{}:{[favorite.id]:{latitude:favorite.latitude,longitude:favorite.longitude,shape:{type,vertices:vertices.slice(0,type==='line'?2:3)}}};
 const json=p.exportPlaces(s),first=p.prepareImport(json,empty()),point=first.favorites.find(f=>f.recordRegistered),again=p.exportPlaces({favorites:first.favorites,observations:first.observations,shapes:first.shapes,placeIds:[point.id]});assert.deepEqual(again.places[0].shape,json.places[0].shape);assert.deepEqual(again.places[0].location.eyeHeightRangeAGL,{min:20,max:150});
 const raw=encodeCsv([['地点名','緯度','経度','標高_m','目線_m','目線下限_m','目線上限_m','形状','対象'],['CSV'+type,35.73874,139.90204,5,20,20,150,json.places[0].shape?JSON.stringify(json.places[0].shape):'','skytree']]),plan=p.prepareImport(csv.parse(raw),empty()),cp=plan.favorites.find(f=>f.recordRegistered);assert(plan.canImport);assert.deepEqual(cp.eyeHeightRangeAGL,{min:20,max:150});assert.deepEqual(plan.shapes[cp.id]?.shape??null,json.places[0].shape);assert.equal(p.prepareImport(csv.parse(raw),{favorites:plan.favorites,observations:plan.observations,shapes:plan.shapes,owner:'recipient'}).report.addedPlaces,0);
});
const state=plan=>({favorites:plan.favorites,observations:plan.observations,shapes:plan.shapes,owner:'recipient'});
test('portable export contains the selected place, both elevations, range, bodies and target definitions without account or history',()=>{
 const p=policy(),s=source();s.favorites.push({...favorite,id:'other-place',token:'never export'});s.observations.push({...record(favorite,'skytree'),id:'old',registration:false,note:'historic detail',date:'2025-01-01'});
 const data=p.exportPlaces(s);assert.equal(data.places.length,1);assert.equal(data.targets.length,2);assert.deepEqual(data.places[0].bodies,['sun','moon']);assert.equal(data.places[0].location.groundManualM,6.2);assert.deepEqual(data.places[0].location.eyeHeightRangeAGL,{min:20,max:150});
 const json=JSON.stringify(data);for(const forbidden of ['sender-place','sender-target','recipient','token','historic detail','owner','loginId'])assert(!json.includes(forbidden),forbidden);assert.equal(data.targets.find(t=>t.kind==='custom').heightM,87);
});
test('round trip creates custom target, remaps alignment and associations, preserves shape/height/body and negative visibility',()=>{
 const p=policy(),s=source(),data=p.exportPlaces(s);data.places[0].targets[0].result='hidden';const plan=p.prepareImport(data,empty());assert(plan.canImport);assert.equal(plan.report.addedPlaces,1);assert.equal(plan.report.addedTargets,1);assert.equal(plan.report.addedBindings,2);
 const place=plan.favorites.find(f=>f.recordRegistered),target=plan.favorites.find(f=>Number.isFinite(f.targetHeightM));assert.notEqual(place.id,favorite.id);assert.notEqual(target.id,custom.id);assert.equal(target.targetCategory,'目印');assert.deepEqual(place.planningBodies,['sun','moon']);assert.deepEqual(place.eyeHeightRangeAGL,favorite.eyeHeightRangeAGL);assert.deepEqual(place.recordAlignments['fav:'+target.id],{partId:'tip',limb:'onTop',matchMode:'limb'});assert.equal(plan.observations[0].result,'hidden');assert.equal(plan.shapes[place.id].shape.type,'line');
 const again=p.prepareImport(data,state(plan));assert.deepEqual(again.favorites,plan.favorites);assert.deepEqual(again.observations,plan.observations);assert.deepEqual(again.shapes,plan.shapes);assert.deepEqual(again.changedFavorites,[]);assert.equal(again.report.addedTargets+again.report.addedPlaces+again.report.addedBindings,0);
});
test('foreign IDs cannot overwrite recipient data and equivalent custom targets are reused',()=>{
 const p=policy(),data=p.exportPlaces(source()),local={...custom,id:'other-target'};const original={...favorite,id:'point-new-1',name:'既存の別地点',eyeHeightAGL:1.5};const before={...empty(),favorites:[original,local]},snapshot=structuredClone(before);const plan=p.prepareImport(data,before);assert.equal(plan.report.addedTargets,0);assert.equal(plan.report.reusedTargets,1);assert.deepEqual(before,snapshot);assert.deepEqual(plan.favorites.find(f=>f.id===original.id),original);assert(plan.observations.some(r=>r.target.key==='fav:other-target'));
});
test('different eye height, range, shape, body and alignment remain separate and reimport is stable',()=>{
 for(const change of [d=>d.places[0].location.eyeHeightAGL=30,d=>d.places[0].location.eyeHeightRangeAGL.max=160,d=>d.places[0].shape=null,d=>d.places[0].bodies=['sirius'],d=>d.places[0].targets[1].alignment.limb='behind']){
  const p=policy(),data=p.exportPlaces(source()),first=p.prepareImport(data,empty()),next=structuredClone(data);change(next);const snapshot=structuredClone(first.favorites),second=p.prepareImport(next,state(first));assert.equal(second.report.addedPlaces,1);for(const f of snapshot)assert.deepEqual(second.favorites.find(x=>x.id===f.id),f);const again=p.prepareImport(next,state(second));assert.equal(again.report.addedPlaces,0);assert.equal(again.report.addedBindings,0);
 }
});
test('missing associations are added to an otherwise identical place without rewriting existing settings',()=>{
 const p=policy(),data=p.exportPlaces(source()),one=structuredClone(data);one.places[0].targets.pop();const initial=p.prepareImport(one,empty()),plan=p.prepareImport(data,state(initial));assert.equal(plan.report.reusedPlaces,1);assert.equal(plan.report.addedPlaces,0);assert.equal(plan.report.addedBindings,1);assert.equal(plan.favorites.filter(f=>f.recordRegistered).length,1);
});
test('missing builtin or part prevents the whole import and exposes unresolved definitions',()=>{
 for(const mutate of [d=>d.targets[0].key='future-target',d=>d.places[0].targets[0].alignment={matchMode:'limb',partId:'removed-part',limb:'center'}]){
  const p=policy(),data=p.exportPlaces(source());mutate(data);const plan=p.prepareImport(data,empty());assert.equal(plan.canImport,false);assert(plan.unresolved.length);assert.equal(plan.entries,undefined);assert.deepEqual(plan.changedFavorites,[]);
 }
});
test('invalid graphs, numbers, shapes, bodies and versions are rejected before writing',()=>{
 const cases=[d=>d.version=9,d=>d.places[0].location.latitude=91,d=>d.places[0].location.eyeHeightAGL=701,d=>d.places[0].location.eyeHeightRangeAGL={min:100,max:20},d=>d.targets[1].heightM=1001,d=>d.places[0].bodies=['unknown'],d=>d.places[0].bodies=[],d=>d.places[0].targets[0].ref='missing',d=>d.targets.push(d.targets[0]),d=>d.places[0].targets.push(d.places[0].targets[0]),d=>d.places[0].shape.vertices=[],d=>d.targets[1].location.longitude='139'];
 for(const mutate of cases){const p=policy(),data=p.exportPlaces(source()),before=empty();mutate(data);assert.throws(()=>p.prepareImport(data,before));assert.deepEqual(before,empty());}
});
test('only current registrations are exported, removed associations do not revive and absent body preference stays absent',()=>{
 const p=policy(),s=source();delete s.favorites[0].planningBodies;s.observations.push({...record(s.favorites[0],'skytree'),id:'removed',removed:true,updatedAt:99});const data=p.exportPlaces(s);assert.equal(data.places[0].targets.length,1);assert.equal(data.places[0].bodies,null);assert.equal(p.prepareImport(data,empty()).observations.length,1);
});
test('an empty registered point remains in the notebook and existing bulk deletion clears its membership',()=>{
 const p=policy(),data={format:p.format,version:p.version,targets:[],places:[{id:'p',location:favorite,shape:null,bodies:null,targets:[]}]},plan=p.prepareImport(data,empty()),place=plan.favorites[0];assert(place.recordRegistered);assert.equal(plan.observations.length,0);assert.equal(p.prepareImport(data,state(plan)).report.addedPlaces,0);
 const context=vm.createContext({module:{exports:{}}});vm.runInContext((readFileSync('astronotes-library.js','utf8')),context);const removed=context.module.exports.prepareNotebookBulk({...state(plan),placeIds:[place.id],mode:'delete'});assert.equal(removed.favorites[0].recordRegistered,undefined);assert.equal(removed.changedFavorites[0],place.id);
});
test('source target metadata must exist; source IDs with prototype names remain ordinary references',()=>{
 const p=policy(),s=source();s.favorites.pop();assert.throws(()=>p.exportPlaces(s),/定義/);const data=p.exportPlaces(source());const old=data.targets[0].id;data.targets[0].id='__proto__';data.places[0].targets.find(t=>t.ref===old).ref='__proto__';assert(p.prepareImport(data,empty()).canImport);assert.equal({}.polluted,undefined);
});
test('unused custom definitions do not create unrelated favorites',()=>{
 const p=policy(),data=p.exportPlaces(source());data.places[0].targets.pop();const plan=p.prepareImport(data,empty());assert.equal(plan.report.addedTargets,0);
});
test('an unrelated invalid legacy favorite cannot block an additive import',()=>{
 const p=policy(),data=p.exportPlaces(source()),broken={id:'old',name:'',latitude:99,longitude:0,planningBodies:['unknown']},plan=p.prepareImport(data,{...empty(),favorites:[broken]});assert(plan.canImport);assert.deepEqual(plan.favorites[0],broken);assert.equal(plan.report.addedPlaces,1);
});
test('real cleanFavorite normalization cannot be bypassed by null fallback and category whitespace is idempotent',()=>{
 const p=policy({cleanFavorite:cleanFromBrowser}),data=p.exportPlaces(source());data.places[0].location.terrain={injected:'unvalidated'};data.targets[1].category=' 目印 ';const first=p.prepareImport(data,empty());assert.equal(first.favorites.find(f=>f.recordRegistered).terrain,null);assert.equal(first.favorites.find(f=>f.targetHeightM===87).targetCategory,'目印');const next=p.prepareImport(data,state(first));assert.equal(next.report.addedTargets,0);assert.equal(next.report.addedPlaces,0);assert(!JSON.stringify(first.favorites).includes('unvalidated'));
});
test('a fresh whole-target import removes a stale limb and remains idempotent after bulk deletion',()=>{
 const p=policy(),data=p.exportPlaces(source()),initial=p.prepareImport(data,empty()),point=initial.favorites.find(f=>f.recordRegistered),target=initial.favorites.find(f=>f.targetHeightM===87),stale={...state(initial),observations:[]};delete point.recordRegistered;data.places[0].targets[1].alignment={partId:'__whole',limb:'center',matchMode:'overlap'};
 const again=p.prepareImport(data,stale),actual=again.favorites.find(f=>f.id===point.id);assert.equal(actual.recordAlignments?.['fav:'+target.id],undefined);assert.equal(p.prepareImport(data,state(again)).report.addedPlaces,0);
 const context=vm.createContext({module:{exports:{}}});vm.runInContext((readFileSync('astronotes-library.js','utf8')),context);const removed=context.module.exports.prepareNotebookBulk({...state(again),placeIds:[point.id],mode:'delete'});assert.equal(removed.favorites.find(f=>f.id===point.id).recordAlignments,undefined);assert.equal(removed.favorites.find(f=>f.id===point.id).planningBodies,undefined);
});
test('invalid local body preference is absent on export while an invalid file preference is still rejected',()=>{
 const p=policy(),s=source();s.favorites[0].planningBodies=['unknown'];const data=p.exportPlaces(s);assert.equal(data.places[0].bodies,null);data.places[0].bodies=['unknown'];assert.throws(()=>p.prepareImport(data,empty()),/天体/);
});
test('file-internal duplicate places deduplicate and have a separate preview count',()=>{
 const p=policy(),data=p.exportPlaces(source());data.places.push({...structuredClone(data.places[0]),id:'duplicate'});const plan=p.prepareImport(data,empty());assert.equal(plan.report.addedPlaces,1);assert.equal(plan.report.reusedPlaces,0);assert.equal(plan.report.duplicatePlaces,1);assert.equal(plan.observations.length,2);
});
test('explicit re-registration follows even a recipient tombstone with a future timestamp',()=>{
 const p=policy(),data=p.exportPlaces(source()),first=p.prepareImport(data,empty()),point=first.favorites.find(f=>f.recordRegistered);first.observations.push({...first.observations[0],id:'future-removed',removed:true,createdAt:1999999999999,updatedAt:1999999999999});const next=p.prepareImport(data,state(first));const r=currentStatus(point,'skytree',next.observations);assert(r&&!r.removed);assert(r.createdAt>1999999999999);assert.equal(p.prepareImport(data,state(next)).report.addedBindings,0);
});
test('5000 places use indexed comparison and import without quadratic validation work',()=>{
 let cleans=0;const p=policy({cleanFavorite:f=>{cleans++;return {...f,locationScope:'point'};}}),location={...favorite};delete location.id;const data={format:p.format,version:p.version,targets:[{id:'t',kind:'builtin',key:'skytree',name:'東京スカイツリー'}],places:Array.from({length:5000},(_,i)=>({id:'p'+i,location:{...location,name:'地点'+i,latitude:35+i/100000},shape:null,bodies:null,targets:[{ref:'t',result:'seen',alignment:{partId:'__whole',limb:'center',matchMode:'overlap'}}]}))},start=performance.now(),first=p.prepareImport(data,empty()),next=p.prepareImport(data,state(first)),elapsed=performance.now()-start;assert.equal(first.report.addedPlaces,5000);assert.equal(next.report.addedPlaces,0);assert.equal(next.report.addedBindings,0);assert(cleans<30000,'normalization must remain linear');assert(elapsed<10000,'5000-place planning must remain bounded');console.log('5000-place initial + repeat:',Math.round(elapsed)+'ms',cleans+' clean calls');
});
test('quota failure rolls back every data bucket including the pending queue',()=>{
 const p=policy(),plan=p.prepareImport(p.exportPlaces(source()),empty()),entries=[...plan.entries,['sorami.queue',[{kind:'fav',id:plan.favorites[0].id}]]],map=new Map(entries.map(([k])=>[k,'original-'+k]));let writes=0;const storage={getItem:k=>map.get(k)??null,setItem(k,v){if(++writes===4)throw Error('quota');map.set(k,v);},removeItem:k=>map.delete(k)},before=new Map(map);assert.throws(()=>library.transaction(storage,entries),/取り消しました/);assert.deepEqual(map,before);
});
