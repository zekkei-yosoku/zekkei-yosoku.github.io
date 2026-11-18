const {test}=require('node:test'),assert=require('node:assert/strict');
// 2026-11-12 candidate-picker.js は読み込み時に AstroNotesLibrary.gate() を使う（配信と同じく先に読む）。
globalThis.AstroNotesLibrary=require('../astronotes-library.js');globalThis.AstroNotesShooting=require('../astronotes-shooting.js');
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
 const a={row:structuredClone(base),types:['road'],index:0},b={row:{...structuredClone(base),rank:0},types:['park'],index:1},deck={row:{...structuredClone(base),place:{...base.place,elevation:100}},types:['viewpoint'],index:2},later={row:{...structuredClone(base),event:{at:100+90*60000}},types:['park'],index:3};
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
test('rows of one area (a shared kind, within 300 m and 10 m, times that follow on within an hour) collapse to the best shown one',()=>{
 const at=Date.parse('2026-11-20T15:38:20+09:00'),row=(lat,extra={})=>({place:{name:'西ヶ原みんなの公園',latitude:lat,longitude:139.74,elevation:20},event:{at},quality:{photographyClass:'normal'},...extra});
 const a={row:row(35.7400,{rank:[5]}),types:['park'],index:0},b={row:row(35.7402,{rank:[3],event:{at:at+20000}}),types:['park'],index:1};
 const far={row:row(35.7450),types:['park'],index:2},next={row:row(35.7400,{rank:[6],event:{at:at+4*60000}}),types:['park'],index:3};
 const evening={row:row(35.7400,{event:{at:at+90*60000}}),types:['park'],index:4};
 const deck={row:row(35.7400,{place:{name:'西ヶ原みんなの公園',latitude:35.74,longitude:139.74,elevation:40}}),types:['park'],index:5};
 const other={row:row(35.7400,{place:{name:'河川沿いの歩道',latitude:35.74005,longitude:139.74,elevation:20}}),types:['park','riverbank'],index:6},road={row:row(35.74006),types:['road'],index:7};
 const all=[a,b,far,next,evening,deck,other,road],before=JSON.stringify(all),out=F.mergeEntries(all,'time');
 assert(out.includes(b)&&!out.includes(a),'the better ranked of the area stays');assert(!out.includes(next),'a few minutes later in the same area is the same area');
 assert(out.includes(far),'over 300 m stays');assert(out.includes(evening),'over an hour from the area\'s times stays');assert(out.includes(deck),'another height stays');
 assert(!out.includes(other),'another name on the same ground is the same area');assert(out.includes(road),'another kind stays');assert.equal(JSON.stringify(all),before,'entries are not changed');
 assert.deepEqual(F.areaOf(b),{count:3,fromAt:at,toAt:at+4*60000},'places are counted once, whatever their number of times');assert.equal(F.areaText(F.areaOf(b)),'この付近3地点 ・ 15:38〜15:42');
 // Times that follow on from place to place make one area, however long the walk takes; the best ranked stands for it.
 const walk=[0,50,100,150].map((m,i)=>({row:row(35.7400+i*.0002,{rank:[[0,2,3,1][i]],event:{at:at+m*60000}}),types:['park'],index:i})),joined=F.mergeEntries([walk[0],walk[3],walk[1],walk[2]],'time');
 assert.deepEqual(joined,[walk[0]]);assert.deepEqual(F.areaOf(walk[0]),{count:4,fromAt:at,toAt:at+150*60000});
 const slope={row:row(35.7401,{rank:[9],place:{name:'西ヶ原みんなの公園',latitude:35.7401,longitude:139.74,elevation:26}}),types:['park'],index:8};
 assert(!F.mergeEntries([a,slope],'time').includes(slope),'6 m up the same slope is the same area');
 const floor={row:row(35.7400,{place:{name:'西ヶ原みんなの公園',latitude:35.74,longitude:139.74,elevation:20,eyeHeightAGL:60}}),types:['park'],index:9};
 assert(F.mergeEntries([a,floor],'time').includes(floor),'a floor high above the same ground is another area');
 assert.equal(F.areaText({count:1,fromAt:at,toAt:at+4*60000}),'15:38〜15:42','one place with several times says its times');
 assert.equal(F.areaOf(far).count,1);assert.equal(F.areaText(F.areaOf(far)),'');assert.equal(F.areaText({count:2,fromAt:at,toAt:at+20000}),'この付近2地点');
 // 土手の下（おすすめ順は上、対象の290mから下が隠れる）と土手の上（60mから下が隠れる）: 上を出す。差が10m未満ならおすすめ順のまま。
 const below={row:row(35.7400,{rank:[1],quality:{photographyClass:'normal',hiddenBelow:{m:290}}}),types:['riverbank'],index:0},top={row:row(35.7403,{rank:[2],place:{name:'河川沿いの歩道',latitude:35.7403,longitude:139.74,elevation:27},quality:{photographyClass:'normal',hiddenBelow:{m:60}}}),types:['riverbank'],index:1};
 assert.deepEqual(F.mergeEntries([below,top],'time'),[top],'the place that sees further down the target stands for the area');assert.equal(F.areaOf(top).count,2);
 const alike={...top,row:{...top.row,quality:{photographyClass:'normal',hiddenBelow:{m:285}}}};assert.deepEqual(F.mergeEntries([below,alike],'time'),[below]);
 const hidden={...b,show:false},shown={...a,show:true};assert.deepEqual(F.mergeEntries([hidden,shown],'time'),[shown]);
 assert.equal(F.areaOf(shown).count,1,'a row the filters hide is not counted in the shown area');
});

// 2026-11-14 ユーザー「重複しないような何かを考えて」: 新しい撮影地点には自分の記録に無い場所だけ、調査済みの地点は同じ場所の代表。
test('a place already among the saved shooting places is left to the records side: within 100 m and 10 m of standing height',()=>{
 const row=(lat,ground,up)=>({place:{latitude:lat,longitude:139.74,elevation:ground,groundManualM:ground,standAglM:up,eyeHeightAGL:up}}),saved=[{latitude:35.7400,longitude:139.74,elevation:20,groundManualM:20,eyeHeightAGL:1.5}];
 assert(F.inRecords(row(35.7400,20,1.5),saved));assert(F.inRecords(row(35.7408,24,1.5),saved),'90 m away and 4 m higher is the same place');
 assert(!F.inRecords(row(35.7410,20,1.5),saved),'110 m away is another place');assert(!F.inRecords(row(35.7400,20,60),saved),'a floor 60 m above the saved ground is another place');
 assert(!F.inRecords(row(35.7400,20,1.5),[]));assert(!F.inRecords(row(35.7400,20,1.5),null));
 assert(F.inRecords(row(35.7400,20,1.5),[{latitude:35.7400,longitude:139.74,eyeHeightAGL:1.5}]),'a saved place without its ground compares the height above ground');
 assert(!F.inRecords(row(35.7400,20,202),[{latitude:35.7400,longitude:139.74,eyeHeightAGL:1.5}]));
});
test('a surveyed place stands for its area, whatever the kind and rank of the found rows around it',()=>{
 const at=Date.parse('2026-11-20T15:38:20+09:00'),row=(lat,extra={})=>({place:{name:'公園の園路',latitude:lat,longitude:139.74,elevation:20},event:{at},quality:{photographyClass:'normal'},...extra});
 const found={row:row(35.7400,{rank:[1]}),types:['park'],index:0},known={row:row(35.7403,{rank:[9],place:{name:'調べた展望地',latitude:35.7403,longitude:139.74,elevation:21},quality:{photographyClass:'normal',surveyed:true}}),types:['viewpoint'],index:1};
 assert.deepEqual(F.mergeEntries([found,known],'time'),[known]);assert.equal(F.areaOf(known).count,2);
 const good={row:row(35.7500,{quality:{photographyClass:'normal',composition:{visibleFraction:1,heightGainM:20,cleanSky:1}}}),types:['park'],index:5},far={...known,row:{...known.row,place:{...known.row.place,latitude:35.76}}};
 assert(F.compare(far,good,'recommended')<=0,'a surveyed place is not ranked under a found one with the best score');assert(F.compare(far,found,'recommended')<0,'and comes before a found place without a score');
 const room={row:row(35.7403,{place:{name:'調べた展望室',latitude:35.7403,longitude:139.74,elevation:20,eyeHeightAGL:150},quality:{photographyClass:'normal',surveyed:true}}),types:['viewpoint'],index:2};
 assert.equal(F.mergeEntries([found,room],'time').length,2,'a surveyed room high above the found ground is its own row');
});


test('recorded lines/areas group by source, height and connected window, preserve real start and disjoint runs',()=>{
 const make=(id,eye,run,at)=>({place:{id,sourcePlaceId:id,name:'同じ名前',latitude:35,longitude:139,eyeHeightAGL:eye},assumedObserver:{eyeM:eye},event:{at},spatialWindow:{id:run,kind:'line',fromAt:0,toAt:600000,count:3}});
 const a=make('a',1.5,'first',120000),b=make('a',1.5,'first',0),other=make('b',1.5,'first',0),height=make('a',10,'first',0),gap=make('a',1.5,'second',3600000);
 const input=[a,b,other,height,gap],before=JSON.stringify(input),rows=F.recordedEntries(input);
 assert.equal(rows.length,4);assert(rows.includes(b));assert(!rows.includes(a));assert(rows.includes(other)&&rows.includes(height)&&rows.includes(gap));assert.equal(JSON.stringify(input),before);
 assert.equal(F.candidateTimeText(b),'09:00〜09:10');
 assert.equal(F.candidateTimeText({...b,spatialWindow:{...b.spatialWindow,toAt:500}}),'09:00');
 assert.equal(F.candidateTimeText({...b,spatialWindow:undefined}),'09:00');
});


test('shared grouping never reconnects recorded spatial runs separated by a missing segment',()=>{
 const entry=(window,at,eye=1.5)=>({row:{place:{id:'source',sourcePlaceId:'source',latitude:35,longitude:139,elevation:10,eyeHeightAGL:eye},assumedObserver:{eyeM:eye},event:{at},spatialWindow:{id:window}},types:['park'],index:at});
 assert.equal(F.mergeEntries([entry('a',1000),entry('b',2000)],'time').length,2);
 assert.equal(F.mergeEntries([entry('a',1000),entry('a',2000,3)],'time').length,2);
 assert.equal(F.mergeEntries([entry('a',1000),entry('a',2000)],'time').length,1);
});

test('area grouping retains every eligible member without mutating or mixing a hidden member',()=>{
 const row=(at,lat)=>({place:{latitude:lat,longitude:139,elevation:10,eyeHeightAGL:1.5},event:{at}});
 const a={row:row(0,35),types:['park'],index:0,show:true},b={row:row(60000,35.0001),types:['park'],index:1,show:true},hidden={row:row(120000,35.0002),types:['park'],index:2,show:false};
 const before=JSON.stringify([a,b,hidden]),out=F.mergeEntries([a,b,hidden],'time');
 assert.equal(out.length,1);assert.deepEqual(new Set(F.membersOf(out[0])),new Set([a,b]));assert.equal(JSON.stringify([a,b,hidden]),before);
});
test('position choices offer actual solved tip and deck candidates using only target geometry',()=>{
 const plan={body:'moon',partId:'__whole',target:{id:'tower',parts:[{id:'tip',name:'先端',m:600},{id:'deck',name:'展望台',m:300}]}};
 const row=(id,at,alt)=>({id,place:{latitude:35,longitude:139,elevation:10,eyeHeightAGL:1.5},event:{at,azimuth:180,altitude:alt,radius:.25,matchMode:'overlap',partId:'__whole'},assumedObserver:{latitude:35,longitude:139,elevation:10,eyeM:1.5}});
 const tip=row('tip',1000,6),deck=row('deck',2000,3),unknown=row('unknown',3000,12),input=[unknown,deck,tip],before=JSON.stringify(input);let calls=0;
 const {choices,shortcuts}=F.positionChoices(input,plan,(_o,_t,{partId})=>{calls++;return {azimuth:180,angle:partId==='tip'?6:3};});
 assert.equal(calls,6);assert.equal(choices.length,3);assert.equal(choices[0].row,tip);assert.equal(choices[1].row,deck);
 assert(shortcuts.some(s=>s.row===tip&&s.label==='先端付近'));assert(shortcuts.some(s=>s.row===deck&&s.label==='展望台付近'));
 assert(!shortcuts.some(s=>s.row===unknown));assert.equal(JSON.stringify(input),before);
 assert.deepEqual(F.positionChoices(input,plan,null).shortcuts,[],'missing geometry never fabricates a part');
});


test('areas and exact deduplication use solved coordinates and height instead of a shared saved anchor',()=>{
 const make=(latitude,eye)=>({row:{place:{latitude:35,longitude:139,elevation:10,eyeHeightAGL:1.5},assumedObserver:{latitude,longitude:139,elevation:10,eyeM:eye},event:{at:1000}},types:['park'],index:eye});
 const a=make(35,1.5),far=make(35.01,1.5),floor=make(35,50),near=make(35.0001,1.5);
 const out=F.mergeEntries([a,far,floor,near],'time');assert.equal(out.length,3);assert(out.includes(far)&&out.includes(floor));
 const home=out.find(e=>e!==far&&e!==floor);assert.equal(F.areaOf(home).count,2);assert.equal(F.membersOf(home).length,2);
});
