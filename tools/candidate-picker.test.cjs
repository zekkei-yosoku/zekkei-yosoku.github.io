const {test}=require('node:test'),assert=require('node:assert/strict');
const labels=require('../experiments/candidate-visibility/place-labels.js');globalThis.AstroNotesCandidateLabels=labels;
const F=require('../experiments/candidate-visibility/candidate-picker.js');
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
