const {test}=require('node:test'),assert=require('node:assert/strict');
// 2026-11-12 candidate-picker.js は読み込み時に AstroNotesLibrary.gate() を使う（配信と同じく先に読む）。
globalThis.AstroNotesLibrary=require('../astronotes-library.js');
const labels=require('../src/features/candidates/place-labels.js');globalThis.AstroNotesCandidateLabels=labels;
const F=require('../src/features/candidates/candidate-picker.js');
test('inclusive hour, matching rise/set, invalid event and combined kind',()=>{
 const r={event:{at:3600000}},e=[{at:0,kind:'rise'}];
 assert(F.accepts(r,'rise','park',['park'],e));assert(!F.accepts({event:{at:3600001}},'rise','park',['park'],e));
 assert(!F.accepts(r,'set','park',['park'],e));assert(!F.accepts(r,'rise','road',['park'],e));
 assert(!F.accepts({event:{}},'rise','all',['unknown'],e));assert(F.accepts(r,'all','all',['unknown'],null));
});
test('classification uses matching areas, never names or nearest facilities',()=>{
 const data={version:1,kind:'osm-named-areas',coverageBboxes:[[0,0,2,2]],features:[{id:'p',name:'Park',bbox:[0,0,1,1],polygons:[[[[0,0],[1,0],[1,1],[0,1],[0,0]]]],tags:{leisure:'park'}}]};
 assert.deepEqual(F.kinds({place:{latitude:.5,longitude:.5}},data),['park']);
 assert.deepEqual(F.kinds({place:{name:'Park',latitude:1.5,longitude:1.5}},data),['unknown']);
 assert.deepEqual(F.kinds({place:{latitude:.5,longitude:0}},data),['unknown']);
 assert.deepEqual(F.kinds({place:{},assumedObserver:{sourceId:'walk'},modelEvidence:{kind:'terrain-and-building-model-los'}},null),['road']);
});
test('stable time/kind order does not mutate candidate evidence',()=>{
 const a={row:{event:{at:2}},types:['park'],index:0},b={row:{event:{at:1}},types:['road'],index:1},snapshot=JSON.stringify([a,b]);
 assert(F.compare(a,b,'time')>0);assert(F.compare(a,b,'kind')<0);assert.equal(JSON.stringify([a,b]),snapshot);
});

test('column headings support both directions, numeric Japanese names and stable ties',()=>{
 const a={row:{place:{name:'地点2'},event:{at:2}},types:['park'],index:0},b={row:{place:{name:'地点10'},event:{at:1}},types:['road'],index:1};
 assert(F.compare(a,b,'name')<0);assert(F.compare(a,b,'name-desc')>0);
 assert(F.compare(a,b,'time-desc')<0);assert(F.compare(a,b,'kind-desc')>0);
 const tied={...a,index:3};for(const sort of ['name','name-desc','time','time-desc','kind','kind-desc'])assert(F.compare(a,tied,sort)<0);
});

test('recommended order compares photography before place, and parks before exact roads across sources',()=>{
 const e=(kind,photo,at,rank=0)=>({row:{placeKind:kind,place:{latitude:35,longitude:139,elevation:20,eyeHeightAGL:2},quality:{photographyClass:photo},event:{at},rank},types:[kind],index:at});
 const park=e('park','normal',20,90),road=e('road','normal',10,0),conditional=e('viewpoint','conditional',0),unknown=e('plaza','unknown',1);
 park.row.relation={kind:'near'};road.row.relation={kind:'anchor-hit'};
 assert(F.compare(park,road,'recommended')<0);assert(F.compare(road,conditional,'recommended')<0);assert(F.compare(conditional,unknown,'recommended')<0);
 assert(F.compare(park,road,'time')>0);assert(F.compare(park,road,'time-desc')<0);
 for(const k of ['park','viewpoint','plaza','riverbank'])assert(F.compare(e(k,'normal',30),road,'recommended')<0);
});
test('explicit place kinds remain authoritative and missing quality is not promoted',()=>{
 const row={placeKind:'riverbank',assumedObserver:{sourceId:'surface'},modelEvidence:{kind:'terrain-and-building-model-los'}};
 assert.deepEqual(F.kinds(row,null),['riverbank']);assert.equal(row.quality,undefined);
 const a={row:{place:{name:'新規公園'},event:{at:1}},types:['park'],index:0},b={row:{place:{name:'条件付き歩道'},event:{at:2},quality:{photographyClass:'conditional'}},types:['road'],index:1};
 assert(F.compare(a,b,'recommended')>0);
});
test('identical candidates merge without mixing evidence, but time and deck remain independent',()=>{
 const base={place:{latitude:35,longitude:139,elevation:10,eyeHeightAGL:1.5},event:{at:100},quality:{photographyClass:'normal'}};
 const a={row:structuredClone(base),types:['road'],index:0},b={row:{...structuredClone(base),rank:0},types:['park'],index:1},deck={row:{...structuredClone(base),place:{...base.place,elevation:100}},types:['viewpoint'],index:2},later={row:{...structuredClone(base),event:{at:100+60000}},types:['park'],index:3};
 const before=JSON.stringify([a,b,deck,later]);const out=F.mergeEntries([a,b,deck,later],'recommended');
 assert.equal(out.length,3);assert(out.includes(b));assert(!out.includes(a));assert(out.includes(deck));assert(out.includes(later));assert.equal(JSON.stringify([a,b,deck,later]),before);
});
test('rank is ascending and never overrides the preferred place group',()=>{
 const a={row:{event:{at:3},quality:{photographyClass:'normal'},rank:[1,3]},types:['park'],index:0},b={row:{event:{at:1},quality:{photographyClass:'normal'},rank:[2,0]},types:['park'],index:1};
 assert(F.compare(a,b,'recommended')<0);assert(F.compare({...a,types:['road'],row:{...a.row,rank:-999}},b,'recommended')>0);
});

test('deduplication retains a source row that satisfies the selected kind filter',()=>{
 const row={place:{latitude:35,longitude:139,elevation:10,eyeHeightAGL:1.5},event:{at:100},quality:{photographyClass:'normal'}};
 const park={row,types:['park'],index:0,show:false},road={row,types:['road'],index:1,show:true};
 assert.deepEqual(F.mergeEntries([park,road],'recommended'),[road]);
 assert.deepEqual(F.mergeEntries([road,park],'recommended'),[road]);
});
test('look-alike rows (same name, kind and minute within 250 m) collapse to the best shown one',()=>{
 const at=Date.parse('2026-11-20T15:38:20+09:00'),row=(lat,extra={})=>({place:{name:'西ヶ原みんなの公園',latitude:lat,longitude:139.74,elevation:20},event:{at},quality:{photographyClass:'normal'},...extra});
 const a={row:row(35.7400,{rank:[5]}),types:['park'],index:0},b={row:row(35.7402,{rank:[3],event:{at:at+20000}}),types:['park'],index:1};
 const far={row:row(35.7450),types:['park'],index:2},next={row:row(35.7400,{event:{at:at+60000}}),types:['park'],index:3},deck={row:row(35.7400,{place:{name:'西ヶ原みんなの公園',latitude:35.74,longitude:139.74,elevation:40}}),types:['park'],index:4};
 const out=F.mergeEntries([a,b,far,next,deck],'time');
 assert(out.includes(b)&&!out.includes(a),'the better ranked of two look-alikes stays');assert(out.includes(far),'over 250 m stays');assert(out.includes(next),'another minute stays');assert(out.includes(deck),'another height stays');
 const hidden={...b,show:false},shown={...a,show:true};assert.deepEqual(F.mergeEntries([hidden,shown],'time'),[shown]);
});
