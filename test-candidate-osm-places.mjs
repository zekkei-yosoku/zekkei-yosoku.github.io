import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const O=require('./experiments/candidate-visibility/osm-places.js');
const E7=v=>Math.round(v*1e7);
// Lines are stored as the first pair and then differences (tools/build-osm-places.mjs).
const delta=g=>g.map((v,i)=>i<2?v:v-g[i-2]);
const line=pairs=>delta(pairs.flatMap(([a,o])=>[E7(a),E7(o)]));
function source(parts){
 const files={},index={format:'AstroNotes OSM places v2',parts:{}};
 for(const [code,rows] of Object.entries(parts)){const data=gzipSync(Buffer.from(JSON.stringify(rows)));files[code]=data;index.parts[code]=[createHash('sha256').update(data).digest('hex').slice(0,16),rows.length,data.length];}
 let fetched=0;
 const places=O.create({load:async()=>index,fetchImpl:async url=>{fetched++;const code=url.match(/(\d{6})\.json\.gz/)?.[1];return files[code]?new Response(files[code]):new Response('',{status:404});}});
 return {places,fetched:()=>fetched};
}
const lat=35.7101,lon=139.8107,code=O.mesh(lat,lon);
const park={t:'w',i:1,k:{leisure:'park',name:'隅田公園'},g:line([[lat,lon],[lat,lon+.002],[lat+.002,lon+.002],[lat+.002,lon],[lat,lon]])};

test('a part is the 2nd-order mesh of the point',()=>{assert.equal(code,'533946');assert(O.meshesIn([lon-.01,lat-.01,lon+.01,lat+.01]).includes(code));});

test('lines come back as absolute coordinates in the Overpass shape the provider reads',async()=>{
 const {places}=source({[code]:[park,{t:'n',i:2,k:{tourism:'viewpoint'},a:E7(lat+.001),o:E7(lon+.001)}]});
 const els=await places.elementsIn([lon-.001,lat-.001,lon+.003,lat+.003]);
 const way=els.find(e=>e.type==='way');assert.equal(way.tags.leisure,'park');
 const near=(p,q)=>Math.abs(p.lat-q.lat)<1e-9&&Math.abs(p.lon-q.lon)<1e-9;
 assert(near(way.geometry[2],{lat:lat+.002,lon:lon+.002}));assert.equal(way.geometry.length,5);
 const node=els.find(e=>e.type==='node');assert.equal(node.id,2);assert.equal(node.tags.tourism,'viewpoint');assert(near(node,{lat:lat+.001,lon:lon+.001}));
 assert.equal((await places.elementsIn([lon+.01,lat+.01,lon+.02,lat+.02])).length,0,'outside the box');
});

test('an item in two parts is returned once; stretches of one cut walk are each kept',async()=>{
 const other=O.mesh(lat+.09,lon),walk=s=>({t:'w',i:9,s,k:{highway:'footway'},g:line(s===0?[[lat,lon],[lat+.001,lon]]:[[lat+.0015,lon],[lat+.002,lon]])});
 const {places}=source({[code]:[park,walk(0),walk(1)],[other]:[park]});
 const els=await places.elementsIn([lon-.01,lat-.01,lon+.01,lat+.1]);
 assert.equal(els.filter(e=>e.id===1).length,1);assert.equal(els.filter(e=>e.id===9).length,2);
});

test('trees and bridges along a track are obstacles of their kind; other things are not',async()=>{
 const rows=[park,
  {t:'n',i:3,k:{natural:'tree'},a:E7(lat+.0005),o:E7(lon+.0005)},
  {t:'w',i:4,k:{railway:'rail',bridge:'yes'},g:line([[lat+.0004,lon],[lat+.0004,lon+.002]])},
  {t:'w',i:5,k:{highway:'primary',layer:'1'},g:line([[lat+.0008,lon],[lat+.0008,lon+.002]])},
  {t:'w',i:6,k:{natural:'wood'},g:line([[lat+.001,lon+.0004],[lat+.001,lon+.0008],[lat+.0012,lon+.0008],[lat+.001,lon+.0004]])},
  {t:'w',i:7,k:{highway:'footway'},g:line([[lat,lon+.0005],[lat+.002,lon+.0005]])}];
 const {places}=source({[code]:rows});
 const got=await places.obstaclesAlong({latitude:lat,longitude:lon+.0005},{latitude:lat+.002,longitude:lon+.0005});
 const by=Object.fromEntries(got.map(o=>[o.id,o]));
 assert.deepEqual(Object.keys(by).sort(),['node/3','way/4','way/5','way/6']);
 assert.equal(by['node/3'].kind,'tree');assert.equal(by['node/3'].capM,25);
 assert.equal(by['way/4'].kind,'railway');assert.equal(by['way/4'].halfWidthM,8);assert.equal(by['way/5'].kind,'road');
 assert(by['way/6'].rings,'a closed wood is an area');assert(Math.abs(by['way/4'].lines[0][1][1]-(lon+.002))<1e-9);
});

test('a part is read once and its hash is checked',async()=>{
 const {places,fetched}=source({[code]:[park]});
 await places.elementsIn([lon,lat,lon+.001,lat+.001]);await places.elementsIn([lon,lat,lon+.001,lat+.001]);assert.equal(fetched(),1);
 const bad=O.create({load:async()=>({parts:{[code]:['0000000000000000',1,1]}}),fetchImpl:async()=>new Response(gzipSync(Buffer.from('[]')))});
 await assert.rejects(bad.elementsIn([lon,lat,lon+.001,lat+.001]),/osm-part-version/);
});
