// 見える場所の地図（2026-11-13 ユーザーの選択「対象ごとに作って保存」）。平らな地面に壁や木を置いた作り物で、
// 対象のどの高さまで見えるかを確かめる。
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),VM=require('./src/features/candidates/visibility-map.js'),G=require('./astronotes-terrain.js');
const target={id:'t',latitude:35,longitude:139,groundM:0,parts:[{id:'tip',name:'先端',m:300},{id:'deck',name:'展望台',m:200}]};
const dist=(lat,lon)=>G.inverse(target.latitude,target.longitude,lat,lon).km*1000;
const flat={peek:()=>0,at:async()=>{}};
// 方位0〜2度の間だけ、対象から500〜520mに高さ60mの壁
const wall={topNow:(lat,lon)=>{const d=dist(lat,lon),az=G.inverse(target.latitude,target.longitude,lat,lon).azimuth;return d>=500&&d<=520&&az<2?60:0;},loadAt:async()=>{}};
const none={canopyNow:()=>0,canopy:async()=>0};
const at=(az,m)=>G.destination(target.latitude,target.longitude,az,m/1000);

test('対象の名前のある部分と高さの5分の1ごとが、上から順に段になる',()=>{
 assert.deepEqual(VM.levelsFor(target).map(l=>[Math.round(l.m),l.name]),[[300,'先端'],[240,null],[200,'展望台'],[180,null],[120,null],[60,null]]);
 assert.deepEqual(VM.levelsFor({...target,parts:[]}),[]);
});
test('壁の後ろでは低い段から見えなくなり、壁のすぐ後ろ（30m以内）は壁を数えない',async()=>{
 const vm=VM.create({ground:flat,buildings:wall,trees:none,capM:3000,yieldTask:async()=>{}});
 const m=await vm.ensure(target,[0.5]);const look=(az,d)=>VM.lookup(m,target,at(az,d).latitude,at(az,d).longitude);
 // 2000m先: 壁の上を通る線は、60mの段だけ遮られる
 assert.deepEqual(look(1,2000),{known:true,count:5,lowestM:120});
 // 600m先: 壁が近く、どの段も見えない
 assert.equal(look(1,600).count,0);
 // 壁から10m後ろ（520mの壁のすぐ脇）: 30m以内の壁は数えないので全部見える
 assert.equal(look(1,535).count,6);
 // 壁の無い方位: 全部見える。計算していない方位は分からない
 assert.equal(look(359.5,1500).count,6);
 assert.deepEqual(look(90,1500),{known:false});
 assert.equal(VM.needFor(m),3,'2番目の名前の部分（展望台）まで見える必要');
});
test('木は立つ所から5km以内で、対象から300m以上離れたものだけ数える',async()=>{
 const grove=band=>({canopyNow:(lat,lon)=>{const d=dist(lat,lon);return d>=band[0]&&d<=band[1]?40:0;},canopy:async()=>0});
 const make=band=>VM.create({ground:flat,buildings:{topNow:()=>0,loadAt:async()=>{}},trees:grove(band),capM:8000,yieldTask:async()=>{}});
 const near=await make([200,260]).ensure(target,[10]);assert.equal(VM.lookup(near,target,at(10,1500).latitude,at(10,1500).longitude).count,6,'対象の足元300m以内の木は数えない');
 const mid=await make([1000,1040]).ensure(target,[10]);const p=at(10,2000),q=at(10,7500);
 assert(VM.lookup(mid,target,p.latitude,p.longitude).count<6,'1km先の木は、その後ろ1kmの地点から数える');
 assert.equal(VM.lookup(mid,target,q.latitude,q.longitude).count,6,'6.5km離れた木は数えない');
});
test('区画全体が見えない所だけを外し、計算していない所は残す',async()=>{
 // 方位0〜20度に壁。区画（約70m四方）は600m先で方位の幅が約7度になるので、その幅を計算しておく
 const wide={topNow:(lat,lon)=>{const d=dist(lat,lon),az=G.inverse(target.latitude,target.longitude,lat,lon).azimuth;return d>=500&&d<=520&&az<20?60:0;},loadAt:async()=>{}};
 const vm=VM.create({ground:flat,buildings:wide,trees:none,capM:3000,yieldTask:async()=>{}});const m=await vm.ensure(target,[2,4,6,8,10,12,14]);
 const box=(az,d)=>{const c=at(az,d),r=.0004;return [c.longitude-r,c.latitude-r,c.longitude+r,c.latitude+r];};
 assert.equal(VM.regionHidden(m,target,box(8,640),3),true,'壁の約100m後ろの区画は展望台が見えない（地図は隣の25mも見るので、壁から離れすぎない所）');
 assert.equal(VM.regionHidden(m,target,box(8,2500),3),false);
 assert.equal(VM.regionHidden(m,target,box(120,1500),3),false);
});
test('端末に保存した地図と同梱の地図は、同じ作り方の版のときだけ使う',async()=>{
 const saved=new Map(),store={get:async k=>saved.get(k),set:async(k,v)=>{saved.set(k,v);}};let walks=0;
 const counting={peek:p=>{walks++;return 0;},at:async()=>{}};
 const a=VM.create({ground:counting,buildings:wall,trees:none,store,capM:2000,yieldTask:async()=>{}});await a.ensure(target,[0.5]);const first=walks;
 const b=VM.create({ground:counting,buildings:wall,trees:none,store,capM:2000,yieldTask:async()=>{}});const m=await b.ensure(target,[0.5]);
 assert.equal(walks,first,'保存した地図を使えば歩き直さない');assert.equal(m.sectors.size,3);
 const old=[...saved.values()][0];saved.set([...saved.keys()][0],{...old,version:'old'});
 const c=VM.create({ground:counting,buildings:wall,trees:none,store,capM:2000,yieldTask:async()=>{}});await c.ensure(target,[0.5]);assert(walks>first,'版が違えば作り直す');
 const shipped={...old,key:VM.mapKey(target)};const d=VM.create({ground:{peek:()=>{throw Error('must not walk');},at:async()=>{}},builtIn:async()=>shipped,yieldTask:async()=>{}});
 assert.equal((await d.ensure(target,[0.5])).sectors.size,3,'同梱の地図があれば歩かない');
});
test('段の数の並びは同じ値の続きで詰めて保存し、元に戻せる',()=>{
 const counts=Uint8Array.from([0,0,0,6,6,255,255,1,...Array(300).fill(2)]);
 assert.deepEqual(Array.from(VM.decodeRay(VM.encodeRay(counts),counts.length)),Array.from(counts));
});
