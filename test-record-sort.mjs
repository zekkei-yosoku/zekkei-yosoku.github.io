import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createRecordSort} from './tools/record-sort-policy.mjs';
const km=(a,b,c,d)=>Math.hypot(a-c,b-d)*111;
const policy=createRecordSort({distanceKm:km});
const ids=rows=>rows.map(p=>p.id);
const places=()=>[
 {id:'a',name:'地点10',subtitle:'千葉県市川市',latitude:35.73,longitude:139.90},
 {id:'b',name:'地点2',subtitle:'',latitude:35.70,longitude:139.80},
 {id:'c',name:'ちてん',subtitle:'東京都江東区',latitude:NaN,longitude:139.8},
 {id:'d',name:'地点2',subtitle:'千葉県市川市',latitude:0,longitude:0},
 {id:'e',name:'Ａ地点',subtitle:'東京都墨田区',latitude:35.71,longitude:139.81}
];
test('modes, labels and default',()=>{
 assert.deepEqual(policy.options.map(o=>o.label),['名前順','住所順','近い順','追加順']);
 assert.equal(policy.DEFAULT,'added');assert.equal(policy.valid('latitude'),false);assert.equal(policy.valid('longitude'),false);
});
test('追加順 is newest registration first; unknown mode falls back to it',()=>{
 assert.deepEqual(ids(policy.sort(places(),'added')),['e','d','c','b','a']);
 assert.deepEqual(ids(policy.sort(places(),'bogus')),['e','d','c','b','a']);
});
test('名前順 uses natural Japanese collation with deterministic ties',()=>{
 const sorted=ids(policy.sort(places(),'name'));
 assert(sorted.indexOf('b')<sorted.indexOf('a'),'地点2 before 地点10');
 assert(sorted.indexOf('d')<sorted.indexOf('b'),'equal names: newer registration first');
 assert.deepEqual(ids(policy.sort(places(),'name')),sorted);
 assert.deepEqual(ids(policy.sort([{id:'x',name:''},{id:'y',name:'あ'}],'name')),['y','x'],'blank names last');
});
test('住所順 puts blank addresses last and breaks ties by name',()=>{
 const sorted=ids(policy.sort(places(),'address'));
 assert.equal(sorted.at(-1),'b');
 assert.deepEqual(sorted.slice(0,2),['d','a'],'same address: 地点2 before 地点10');
});
test('近い順 orders by distance; invalid and zero coordinates last',()=>{
 const sorted=ids(policy.sort(places(),'near',{latitude:35.705,longitude:139.805}));
 assert.deepEqual(sorted.slice(0,3),['b','e','a']);assert.deepEqual(new Set(sorted.slice(3)),new Set(['c','d']));
 assert.deepEqual(ids(policy.sort(places(),'near',{latitude:0,longitude:0})),ids(policy.sort(places(),'name')),'no valid origin: no distance ranking');
 assert.equal(policy.point({latitude:91,longitude:0}),false);assert.equal(policy.point({latitude:0,longitude:0}),false);
});
test('sorting never mutates input arrays or entries',()=>{
 const input=places(),before=JSON.stringify(input),refs=[...input];
 for(const mode of policy.modes)policy.sort(input,mode,{latitude:35.7,longitude:139.8});
 assert.equal(JSON.stringify(input),before);input.forEach((p,i)=>assert.equal(p,refs[i]));
});
test('the registered places list and the picker use the sort control',()=>{
 const myplaces=readFileSync('astronotes-myplaces.js','utf8');
 assert.match(myplaces,/sortRecordPlaces\(recordedPlaces\)/);assert.match(myplaces,/recordSortControl\('recordPlaceSort'/);
 assert.doesNotMatch(myplaces,/latitude順|経度順|緯度順/);
 assert.match(readFileSync('index.html','utf8'),/recordSortControl\('recordPickerSort'/);
});
