import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),L=require('./src/features/candidates/place-labels.js'),T=require('./astronotes-terrain.js');
const p={latitude:35.70730860834253,longitude:139.75974230531398,eyeHeightAGL:1.5};
const bytes=fs.readFileSync(new URL('./tools/fixtures/gsi-road-hongo.pbf',import.meta.url));
const decodeAreas=T.decodeWaterLayer;
test('real Hongo road is bounded by road edges; tile and result are reused without astronomical work',async()=>{
 let calls=0;const context=L.createRoadContext({decodeAreas,fetchImpl:async()=>{calls++;return{ok:true,arrayBuffer:async()=>bytes};}});
 const before=structuredClone(p),[a,b]=await Promise.all([context.read(p),context.read(p)]);
 assert.equal(a.kind,'road');assert.equal(a.source,'gsi-road-edges');assert.equal(a,b);assert.equal(calls,1);assert.equal(context.peek(p),a);
 assert.equal(await context.read(p),a);assert.equal(calls,1);assert.deepEqual(p,before);
 const roadData=L.roadLines(bytes);
 assert.equal(roadData.RdCL.features.filter(f=>f.attrs.vt_code===2701&&f.attrs.vt_lvorder>0).length,0,'this real fixture has no elevated normal-code road');
 const building={...p,latitude:35.70714,longitude:139.7599};
 assert.equal(await context.read(building),null,'an actual neighbouring building location stays unclassified');
 assert.equal(calls,1,'the neighbouring location shares the decoded tile');
 for(const patch of [{eyeHeightAGL:20},{nonTerrainStructure:true}]){assert.equal(await context.read({...p,...patch}),null);assert.equal(context.peek({...p,...patch}),null);}
 assert.equal(calls,1,'a high floor is never classified from a ground tile');
});
test('road decoder rejects malformed input; missing tile never becomes road and retries are bounded',async()=>{
 assert.throws(()=>L.roadLines(new Uint8Array([26,255])));assert.throws(()=>L.roadLines(new Uint8Array([15])));
 let calls=0,now=10000;const context=L.createRoadContext({decodeAreas,now:()=>now,fetchImpl:async()=>{calls++;throw Error('offline');}});
 assert.equal(await context.read(p),null);assert.equal(context.peek(p),null);assert.equal(calls,1);
 assert.equal(await context.read(p),null);assert.equal(calls,1,'offline failures have a short cooldown');now+=6000;
 assert.equal(await context.read(p),null);assert.equal(calls,2);
 const empty=L.createRoadContext({decodeAreas:()=>({extent:4096,polys:[]}),fetchImpl:async()=>({ok:true,arrayBuffer:async()=>new Uint8Array()})});
 assert.equal(await empty.read(p),null);
});
test('roads use actual borders, exclude roofs, water, bridges and tunnels, and request neighbouring tiles at boundaries',async()=>{
 const x=(p.longitude+180)/360*65536,y=(1-Math.asinh(Math.tan(p.latitude*Math.PI/180))/Math.PI)/2*65536,k=Math.cos(p.latitude*Math.PI/180)*40075016.686/65536;
 const line=(a,b)=>[a,b].map(([a,b])=>[x%1+a/k,y%1+b/k]);
 const f=(points,code=2701,attrs={})=>({attrs:{vt_code:code,vt_width:999999,vt_rnkwidth:'5.5m-13m未満',...attrs},lines:[points]}),tile={x:Math.floor(x),y:Math.floor(y),roads:{RdCL:{features:[f(line([-30,0],[30,0]))]},RdEdg:{features:[f(line([-30,-5],[30,-5])),f(line([-30,5],[30,5]))]}}};
 assert.equal(L.roadMatch(p,[tile]).kind,'road');
 const off={...p,latitude:p.latitude+.0002};assert.equal(L.roadMatch(off,[tile]),null,'a giant drawing width is not physical road evidence');
 for(const vt_code of[2703,2711])assert.equal(L.roadMatch(p,[{...tile,roads:{...tile.roads,RdCL:{features:[f(line([-30,0],[30,0]),vt_code)]}}}]),null);
 const poly={extent:1,polys:[[[...line([-3,-3],[3,-3]),...line([3,3],[-3,3]),line([-3,-3],[-3,-3])[0]]]]};
 for(const key of['water','buildings'])assert.equal(L.roadMatch(p,[{...tile,[key]:poly}]),null);
 assert.equal(L.roadMatch(p,[tile,null]),null);
 for(const name of['RdCL','RdEdg'])assert.equal(L.roadMatch(p,[{...tile,roads:{...tile.roads,[name]:{features:tile.roads[name].features.map(f=>({...f,attrs:{...f.attrs,vt_lvorder:1}}))}}}]),null,'elevated lines and edges are rejected independently');
 const foreign={...tile,roads:{RdCL:{features:[f(line([-30,0],[30,0]),2701,{vt_rnkwidth:'3m-5.5m未満'})]},RdEdg:{features:[f(line([-30,-25],[30,-25])),f(line([-30,25],[30,25]))]}}};
 assert.equal(L.roadMatch(p,[foreign]),null,'a narrow road cannot borrow far-away parallel edges');
 assert.equal(L.roadMatch(p,[{...tile,roads:{...tile.roads,RdCL:{features:[f(line([5,0],[30,0]))]}}}]),null,'a road endpoint is not extended into a plaza');
 assert.equal(L.roadMatch(p,[{...tile,roads:{...tile.roads,RdEdg:{features:[f(line([-3,-10],[3,0])),f(line([-3,0],[3,10]))]}}}]),null,'crossing road edges are not parallel sides');
 let calls=0;const context=L.createRoadContext({decodeAreas:()=>({extent:4096,polys:[]}),fetchImpl:async()=>{calls++;return{ok:true,arrayBuffer:async()=>new Uint8Array()};}});
 await context.read({...p,longitude:Math.floor(x)/65536*360-180,latitude:Math.atan(Math.sinh(Math.PI*(1-2*Math.floor(y)/65536)))*180/Math.PI});
 assert.equal(calls,4);
});
test('common naming prefers a supplied street over town, preserves facility names and caches successful lookups',async()=>{
 const source=fs.readFileSync(new URL('./src/features/places/search.js',import.meta.url),'utf8'),body=source.slice(source.indexOf('const JP_PREFECTURES'),source.indexOf('/// 緯度経度の点を地点にする'));
 let calls=0,address={road:'春日通り',quarter:'本郷',neighbourhood:'本郷二丁目',city:'文京区','ISO3166-2-lvl4':'JP-13'};
 const c=vm.createContext({fetch:async()=>{calls++;return{ok:true,json:async()=>({address})};}});vm.runInContext(body+';globalThis.lookup=nearName;',c);
 const a=await c.lookup(p.latitude,p.longitude);assert.equal(a.name,'春日通り');assert.equal(a.road,'春日通り');assert.equal(a.area,'東京都文京区本郷二丁目');
 assert.equal((await c.lookup(p.latitude,p.longitude)).name,a.name);assert.equal(calls,1);
 address={...address,leisure:'公園'};assert.equal((await c.lookup(p.latitude+.001,p.longitude)).name,'公園');
 address={quarter:'本郷',city:'文京区'};const unnamed=await c.lookup(p.latitude+.002,p.longitude);assert.equal(unnamed.name,'文京区本郷');assert.equal(unnamed.road,'','an unnamed road never borrows the adjacent street name');
 assert.equal(unnamed.subtitle,'');address={hamlet:'字山田',village:'北村'};const hamlet=await c.lookup(p.latitude+.003,p.longitude);assert.equal(hamlet.name,'北村字山田');assert.equal(hamlet.area,'北村字山田');
 for(const [i,road]of['旧青梅街道','目白通り','国道254号','東京都道8号'].entries()){address={road,city:'練馬区',quarter:'石神井町'};assert.equal((await c.lookup(p.latitude+.01+i*.001,p.longitude)).name,road);}
 for(const [i,road]of['市川柏線','本郷区道第123号','路地'].entries()){address={road,city:'文京区',quarter:'本郷','ISO3166-2-lvl4':'JP-13'};assert.equal((await c.lookup(p.latitude+.02+i*.001,p.longitude)).name,'東京都文京区本郷');}
});
