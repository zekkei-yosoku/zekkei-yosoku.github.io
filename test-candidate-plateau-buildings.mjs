import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const P=require('./src/features/candidates/plateau-buildings.js');
const lat=35.6895,lon=139.6917;
// A 40 x 30 m tower of 240 m on a 70 x 50 m podium of 30 m (dm east/north of the aim point).
const tower=['bldg_tower','都庁のような塔',lat,lon,36,240,2,[[2400,[-200,-150,200,-150,200,150,-200,150]],[300,[-350,-250,350,-250,350,250,-350,250]]]];
const low=['bldg_low',null,lat+.002,lon,20,45,1,[[450,[-100,-100,100,-100,100,100,-100,100]]]];
function source(rows){
 const part=gzipSync(Buffer.from(JSON.stringify({buildings:rows}))),sha=createHash('sha256').update(part).digest('hex').slice(0,16);
 const index={parts:{[P.part(lat,lon)]:[sha,rows.length,part.length]}};
 return P.create({load:async()=>index,fetchImpl:async url=>url.includes('.json.gz')?new Response(part):new Response('',{status:404})});
}
const fav=(dLat,height,extra={})=>({id:'fav:1',name:'登録した塔',latitude:lat+dLat,longitude:lon,groundM:36,parts:[{id:'tip',m:36+height}],...extra});

test('part of a point is its 2nd-order mesh (6 digits)',()=>{assert.equal(P.part(35.7101,139.8107),'533946');assert.equal(P.part(34.7,135.5),'523504');});

test('the shape becomes the app city model: one face per column, absolute positions, roof heights',()=>{
 const m=P.cityModel(P.shape(tower));
 assert.equal(m.id,'plateau-bldg_tower');assert.equal(m.heightM,240);assert.equal(m.faces.length,2);assert.equal(m.vertices.length,16);assert.equal(m.geoVertices.length,16);
 assert.deepEqual(m.vertices[4],[-20,-15,240]);assert.equal(m.vertices[12][2],30);
 // 20 m east of the aim point is about 0.00022 deg of longitude here.
 assert(Math.abs(m.geoVertices[5][1]-(lon+20/(111320*Math.cos(lat*Math.PI/180))))<1e-9);
});

test('near lists buildings around a point, a point on a footprint first',async()=>{
 const s=source([tower,low]);
 const here=await s.near(lat+.0001,lon,{radiusM:300});assert.deepEqual(here.map(b=>[b.id,b.distanceM]),[['bldg_tower',0],['bldg_low',200]]);
 assert.equal(here[0].name,'都庁のような塔');assert.equal(here[0].heightM,240);
 assert.equal((await s.near(lat+.0001,lon,{radiusM:50})).length,1);
});

test('a saved target on a building of about its height takes the shape; others keep the estimate',async()=>{
 const s=source([tower,low]);
 globalThis.AstroNotesCityModels={};
 assert.deepEqual(await s.prepare([fav(.0001,238)]),['fav:1']);assert.equal(globalThis.AstroNotesCityModels['fav:1'].buildingId,'bldg_tower');
 assert.equal(s.footprint('fav:1').length,2);assert(s.footprint('fav:1')[0].every(p=>Math.abs(p[0]-lat)<.001));
 // Height far off (a 60 m sign on the roof would not be this building), or off the footprint: no shape.
 assert.deepEqual(await s.prepare([fav(.0001,120)]),['fav:1']);assert.equal(globalThis.AstroNotesCityModels['fav:1'],undefined);
 assert.deepEqual(await s.prepare([fav(.0009,240)]),[]);
 // Built-in targets are never touched.
 assert.deepEqual(await s.prepare([{...fav(.0001,240),id:'skytree'}]),[]);
});

test('a part file that does not match its index is not used',async()=>{
 const part=gzipSync(Buffer.from(JSON.stringify({buildings:[tower]})));
 const s=P.create({load:async()=>({parts:{[P.part(lat,lon)]:['0000000000000000',1,part.length]}}),fetchImpl:async()=>new Response(part)});
 await assert.rejects(s.near(lat,lon));
});

test('twin towers of one height: the aim point is the middle of the tower with the highest roof, not the gap',async()=>{
 // Two 20 x 20 m towers 60 m apart (north 243 m, south 242.5 m) on a 100 x 40 m podium; the packed aim point is the gap.
 const twin=['bldg_twin','双子の塔',lat,lon,36,243,2,[[2430,[-100,200,100,200,100,400,-100,400]],[2425,[-100,-400,100,-400,100,-200,-100,-200]],[300,[-500,-200,500,-200,500,200,-500,200]]]];
 const b=P.shape(twin);
 assert(Math.abs((b.latitude-lat)*110540-30)<.01,'north tower centre');assert(Math.abs(b.longitude-lon)<1e-9);
 assert.equal(b.originLatitude,lat);assert.deepEqual(P.cityModel(b).vertices[4],[-10,20,243]);
 assert.equal(P.shape(tower).latitude,lat,'one tower keeps the packed point');
 const s=source([twin]);const [row]=await s.near(lat+30/110540,lon,{radiusM:10});
 assert.equal(row.distanceM,0);assert(Math.abs((row.latitude-lat)*110540-30)<.01);
});
