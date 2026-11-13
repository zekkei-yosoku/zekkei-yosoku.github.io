// 手前の地形で目標の下が隠れる文（2026-11-12 ユーザー「何割とかいらない。〇〇の〇〇から下が〇〇に隠れますとかでいい」
// 「何メートル先のとかいらない」「堤防なのか土手なのか建物なのかとかの方がいい」）
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {gzipSync} from 'node:zlib';
const require=createRequire(import.meta.url),A=require('./astronotes-align.js'),G=require('./astronotes-terrain.js'),T=require('./src/features/candidates/terrain-model.js');
const sky=A.targetById('skytree');
test('隠れる所は部分の名前で書き、距離も割合も書かない',()=>{
 assert.equal(A.hiddenBelowText(sky,372,'高台'),'東京スカイツリーの天望デッキから下が手前の高台に隠れます');
 assert.equal(A.hiddenBelowText(sky,500,'山'),'東京スカイツリーの天望回廊（第二展望台）から下が手前の山に隠れます');
 assert.equal(A.hiddenBelowText(sky,640,'堤防'),'東京スカイツリーは手前の堤防に隠れて見えません');
 assert.equal(A.hiddenBelowText(sky,33,'土手'),'東京スカイツリーの地上約30mから下が手前の土手に隠れます');
 assert.equal(A.hiddenBelowText(sky,14,'地球の丸み'),'東京スカイツリーの地上約10mから下は地球の丸みで隠れます');
 assert.equal(A.hiddenBelowText(sky,700,'地球の丸み'),'東京スカイツリーは地球の丸みで隠れて見えません');
 assert.equal(A.hiddenBelowText(sky,8,'高台'),'');
 assert.equal(A.hiddenBelowText(sky,372,null),'');
 assert.doesNotMatch(A.hiddenBelowText(sky,372,'高台'),/[0-9]+(m|km)先|割|%/);
});
test('上がって下がる細い高まりは堤防か土手、高い遠くの地形は山、目より高い地面は高台、それより低い地面は地球の丸み',async()=>{
 const obs={latitude:35.8,longitude:139.5},wet=async pts=>pts.map((_,i)=>i===3),dry=async pts=>pts.map(()=>false);
 // 河川敷から見る堤防：川は見る人の後ろ（高まりの手前）にある
 assert.equal(await G.obstacleKind(obs,234,{distanceM:15,terrainM:6.4,riseM:2.4,dropM:6.3},4.7,{waterAt:wet}),'堤防');
 assert.equal(await G.obstacleKind(obs,116,{distanceM:890,terrainM:23.5,riseM:5.7,dropM:5.7},24,{waterAt:dry}),'土手');
 // 台地の崖の縁は堤防にしない（里見公園から江戸川側：縁で約5m上がって約21m下がる）
 assert.equal(await G.obstacleKind(obs,243,{distanceM:110,terrainM:23.9,riseM:6.1,dropM:21.2},19.3,{waterAt:wet}),'崖の縁');
 // 台地の上の1m程度の凹凸は土手にしない（白井運動公園の例）
 assert.equal(await G.obstacleKind(obs,244,{distanceM:2960,terrainM:28.9,riseM:8.1,dropM:1.2},22.4,{waterAt:wet}),'高台');
 assert.equal(await G.obstacleKind(obs,116,{distanceM:950,terrainM:26.7,riseM:10,dropM:0.4},15.6,{waterAt:wet}),'高台');
 assert.equal(await G.obstacleKind(obs,116,{distanceM:9000,terrainM:420,riseM:30,dropM:0},15.6),'山');
 assert.equal(await G.obstacleKind(obs,116,{distanceM:15000,terrainM:3,riseM:0,dropM:0},15.6),'地球の丸み');
 assert.equal(await G.obstacleKind(obs,116,null,15.6),null);
 let asked=[];await G.obstacleKind(obs,90,{distanceM:100,terrainM:9,riseM:4,dropM:4},5,{waterAt:async pts=>{asked=pts;return pts.map(()=>false);}});
 assert.equal(asked.length,24);assert.ok(asked.some(p=>p.longitude<obs.longitude),'見る人の後ろの水域も見る');
});
test('地形の線は、一番高く見える地面と、その向こうで下がる高さを返す',async()=>{
 const observer={latitude:35,longitude:139,elevation:10,eyeM:1.5},zoom=15,world=256*2**zoom,x=Math.floor((observer.longitude+180)/360*2**zoom),y=Math.floor((1-Math.asinh(Math.tan(observer.latitude*Math.PI/180))/Math.PI)/2*2**zoom);
 const raw=Buffer.alloc(256*256*4),px=(observer.longitude+180)/360*world,col=(Math.floor(px)+3)%256;
 for(let row=0;row<256;row++)raw.writeInt32LE(1800,(row*256+col)*4);
 const raster=await T.decode({zoom,tiles:[{x,y,offset:0}],heightsGzipBase64:gzipSync(raw).toString('base64')});
 const r=raster.trace({...observer,longitude:(Math.floor(px)+.5)/world*360-180},{azimuth:90,altitude:60,maxM:200});
 assert.equal(r.hit,null);assert.equal(r.skyline.terrainM,18);assert.ok(r.skyline.distanceM>8&&r.skyline.distanceM<14,String(r.skyline.distanceM));
 assert.equal(r.skyline.dropM,18);assert.equal(r.skyline.riseM,18);assert.ok(r.skyline.toM>18,String(r.skyline.toM));
});
test('図の線は探索と同じ視線・同じ地形から：一覧の文と同じ数字と名前を返す',async()=>{
 const {createGeneric}=require('./src/features/candidates/generic-evaluator.js');
 const rays=[],terrain={trace:async(observer,ray)=>{rays.push({observer,ray});return {status:'model-clear',hit:null,skyline:{distanceM:950,terrainM:26.7,riseM:10,dropM:0.4,toM:375.3}};}};
 const geo={...G,obstacleKind:async()=> '高台'};
 const model=createGeneric({align:A,bodies:{},geo,terrain});
 const obs={latitude:35.8151902,longitude:139.5469209,elevation:14.14,eyeM:1.5};
 const r=await model.hiddenView(obs,sky,{partId:'__whole'});
 assert.equal(r.read,true);assert.equal(r.note.text,'東京スカイツリーの天望デッキから下が手前の高台に隠れます');assert.equal(r.note.label,'手前の高台');assert.equal(r.note.m,375.3);
 const g=A.geometryFrom(obs,sky,{eyeM:1.5});
 assert.equal(rays[0].ray.azimuth,g.azimuth);assert.equal(rays[0].ray.maxM,g.distanceKm*1000);assert.equal(rays[0].ray.endpoint.elevation,g.topM);
 const none=createGeneric({align:A,bodies:{},geo,terrain:{trace:async()=>({status:'unknown',reason:'terrain-budget'})}});
 assert.deepEqual(await none.hiddenView(obs,sky),{status:'unknown',read:false,note:null});
});
test('手前の建物が地形より高く隠すときは建物と書き、図の線もその高さにする',async()=>{
 const {createGeneric}=require('./src/features/candidates/generic-evaluator.js'),tower=A.targetById('tokyotower');
 const terrain={trace:async()=>({status:'model-clear',hit:null,skyline:{distanceM:600,terrainM:40,riseM:2,dropM:2,toM:60}})};
 const heights=toM=>({skyline:async(o,ray)=>{assert.equal(ray.targetKey,'tokyotower');return {status:'ok',toM,distanceM:3706,topM:257,complete:true};}});
 const obs={latitude:35.683518,longitude:139.7083195,elevation:34.34,eyeM:1.5};
 const r=await createGeneric({align:A,bodies:{},geo:{...G,obstacleKind:async()=> '高台'},terrain,heights:heights(296)}).hiddenView(obs,tower,{partId:'__whole'});
 assert.equal(r.note.text,'東京タワーのトップデッキの上端から下が手前の建物に隠れます');assert.equal(r.note.label,'手前の建物');assert.equal(r.note.m,296);
 const low=await createGeneric({align:A,bodies:{},geo:{...G,obstacleKind:async()=> '高台'},terrain,heights:heights(30)}).hiddenView(obs,tower,{partId:'__whole'});
 assert.equal(low.note.label,'手前の高台');assert.equal(low.note.m,60);
 // 地形が読めなくても、建物で隠れる所は出す
 const unread=await createGeneric({align:A,bodies:{},geo:G,terrain:{trace:async()=>({status:'unknown'})},heights:heights(296)}).hiddenView(obs,tower,{partId:'__whole'});
 assert.equal(unread.read,false);assert.equal(unread.note.label,'手前の建物');
});
test('手前の木が建物や地形より高く隠すときは木と書く',async()=>{
 const {createGeneric}=require('./src/features/candidates/generic-evaluator.js'),tower=A.targetById('tokyotower');
 const terrain={trace:async()=>({status:'model-clear',hit:null,skyline:{distanceM:600,terrainM:40,riseM:2,dropM:2,toM:60}})};
 const heights={skyline:async()=>({status:'ok',toM:200,complete:true})},seen=[];
 const trees={sight:async(o,ray)=>{seen.push(ray);return {status:'clear',skyline:{toM:300,distanceM:150,crownM:25}};}};
 const obs={latitude:35.683518,longitude:139.7083195,elevation:34.34,eyeM:1.5};
 const r=await createGeneric({align:A,bodies:{},geo:{...G,obstacleKind:async()=> '高台'},terrain,heights,trees}).hiddenView(obs,tower,{partId:'__whole'});
 assert.equal(r.note.text,'東京タワーのトップデッキの上端から下が手前の木に隠れます');assert.equal(r.note.label,'手前の木');
 assert.equal(seen[0].footM,18,'木は対象の足元までの線で見る');
});
