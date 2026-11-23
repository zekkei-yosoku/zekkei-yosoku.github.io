import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const H=require('./src/features/candidates/height-grid.js');
const ROWS=185,COLS=225,CODE='53394654',MY=4285,MX=11184;

// The file format written by tools/build-plateau-heights.py: gzip of the low then high bytes of row-wise differences.
function pack(grid){
 const n=ROWS*COLS,out=new Uint8Array(2*n);
 for(let r=0;r<ROWS;r++){let prev=0;for(let c=0;c<COLS;c++){const i=r*COLS+c,d=(grid[i]-prev)&65535;prev=grid[i];out[i]=d&255;out[n+i]=d>>8;}}
 return gzipSync(out);
}
const cell=(lat,lon)=>[Math.floor(lat*22200)-MY*ROWS,Math.floor(lon*18000)-MX*COLS];
const observer={latitude:35.71,longitude:139.805,elevation:5,eyeM:1.5};
function world({buildings=[],target=[],gsi=[],ownFootprint,ownFootprintVersion,obstacles=async()=>[],structureModels}={}){
 const grid=new Uint16Array(ROWS*COLS),put=(list,into)=>{for(const {north,top,width=2,depth=3} of list){const [r,c]=cell(observer.latitude+north/110540,observer.longitude);for(let y=r;y<r+depth;y++)for(let x=c-width;x<=c+width;x++)into(y*COLS+x,top+20);}};
 put(buildings,(i,v)=>{grid[i]=Math.max(grid[i],v);});
 const own=[];put(target,(i,v)=>own.push([i,v]));
 const body=pack(grid),sha=createHash('sha256').update(body).digest('hex'),top=Math.max(0,...buildings.map(b=>b.top));
 // Layout v2: <first 4 digits>/index.json lists the part's meshes; the main index lists parts by the SHA-256 of that list.
 const part=Buffer.from(JSON.stringify({meshes:{[CODE]:[sha.slice(0,16),top]}})),partSha=createHash('sha256').update(part).digest('hex');
 const index={grid:{offsetM:20},parts:{[CODE.slice(0,4)]:[partSha.slice(0,16),1,top]},targets:own.length?{tower:{[CODE]:{cells:own,topM:Math.max(...target.map(t=>t.top))}}}:{}};
 if(structureModels)index.structureModels=structureModels;
 const fetchImpl=async url=>url.includes(CODE.slice(0,4)+'/'+CODE+'.bin')?new Response(body):url.includes(CODE.slice(0,4)+'/index.json')?new Response(part):new Response('missing',{status:404});
 return H.create({fetchImpl,loadIndex:async()=>index,gsiAlong:async()=>gsi,groundAt:async()=>5,ownFootprint,ownFootprintVersion,obstacles});
}
const north=altitude=>({azimuth:0,altitude,maxM:1500,refractionK:7/6});

test('upper tower patch covers interior cells and never estimates missing height coverage',async()=>{
 const patch={west:observer.longitude-.0002,east:observer.longitude+.0002,south:observer.latitude+80/110540,north:observer.latitude+130/110540,lowM:20};
 assert.equal((await world({buildings:[{north:100,top:30,width:0}]}).upperPatch(patch,'tower')).status,'blocked');
 assert.equal((await world({buildings:[{north:100,top:10,width:0}]}).upperPatch(patch,'tower')).status,'clear');
 const absent=H.create({loadIndex:async()=>({grid:{offsetM:20},parts:{},targets:{}}),gsiAlong:async()=>[{code:3101}]});
 assert.equal((await absent.upperPatch({...patch,lowM:1000},'tower')).status,'unknown','22 m class percentile is not used');
 await assert.rejects(world().upperPatch(patch,'tower',{isCurrent:()=>false}),/candidate-cancelled/);
 const attached=[[[patch.south,patch.west],[patch.north,patch.west],[patch.north,patch.east],[patch.south,patch.east]]];
 assert.equal((await world({buildings:[{north:100,top:30}],ownFootprint:()=>attached}).upperPatch(patch,'tower')).status,'blocked','padded arbitrary footprint does not erase neighbours');
 assert.equal((await world({target:[{north:100,top:600}]}).upperPatch(patch,'tower')).status,'clear','separate target overlay does not obstruct itself');
 const bridge={kind:'road',halfWidthM:5,lines:[[[patch.south,patch.west],[patch.north,patch.east]]],capM:20};
 assert.equal((await world({obstacles:async()=>[bridge]}).upperPatch({...patch,lowM:1000},'tower')).reason,'upper-structure-height-unknown','an estimated 20 m cap cannot prove this wider corridor clear');
});

test('an indoor road exclusion leaves neighbouring building heights and missing coverage effective',async()=>{
 const O=require('./src/features/candidates/osm-places.js');
 const patch={west:observer.longitude-.0002,east:observer.longitude+.0002,south:observer.latitude+80/110540,north:observer.latitude+130/110540,lowM:20};
 const rows=[{k:{building:'yes',highway:'elevator',layer:'14'}},{k:{highway:'footway',indoor:'yes',layer:'1'}}];
 const obstacles=async()=>rows.map(O.obstacle).filter(Boolean);
 assert.equal((await world({buildings:[{north:100,top:30}],obstacles}).upperPatch(patch,'tower')).status,'blocked');
 const missing=H.create({loadIndex:async()=>({grid:{offsetM:20},parts:{},targets:{}}),obstacles});
 assert.equal((await missing.upperPatch(patch,'tower')).status,'unknown','an indoor tag cannot replace missing building data');
});

test('an actual out-of-range railway contact does not stop the upper corridor at its broad rectangle',async()=>{
 const Q=require('./src/features/candidates/tower-quality.js'),A=require('./astronotes-align.js');
 const eye={latitude:35.71211,longitude:139.803558,elevation:.8,eyeM:1.5},target=A.targetById('skytree');
 const shape=Q.corridor(eye,target,require('./astronotes-tower-models.js').skytree,7/6);
 const patch=[...shape.patches()].find(p=>p.fromM===600);
 // Actual intersecting segment of bundled OSM way/54680184; its 8 m half
 // width touches the broad rectangle but lies before its 600–625 m range.
 const railway={kind:'railway',id:'way/54680184',halfWidthM:8,lines:[[[35.7104871,139.8096546],[35.7103581,139.809182]]]};
 const h=world({obstacles:async()=>[railway]});
 assert.equal((await h.upperPatch({...patch,lowAt:undefined},'skytree')).reason,'upper-structure-height-unknown','the old rectangle-only test really intersects');
 assert.equal((await h.upperPatch(patch,'skytree')).status,'clear');
});

test('upper structure exclusion requires exact positive infinity, keeps width and never replaces missing coverage',async()=>{
 const middle=observer.longitude,patch={west:middle-.0002,east:middle+.0002,south:observer.latitude,north:observer.latitude+.0002,lowM:1000};
 const p=[observer.latitude+.0001,middle+.00003],line={kind:'road',lines:[[p,[p[0]+.00005,p[1]]]],halfWidthM:0};
 for(const value of [undefined,null,NaN,-Infinity,0,10000]){
  assert.equal((await world({obstacles:async()=>[line]}).upperPatch({...patch,lowAt:()=>value},'tower')).reason,'upper-structure-height-unknown');
 }
 const outside=b=>b.west>middle?Infinity:1000,fan={...patch,lowAt:outside};
 assert.equal((await world({obstacles:async()=>[line]}).upperPatch(fan,'tower')).status,'clear');
 assert.equal((await world({obstacles:async()=>[{...line,halfWidthM:8}]}).upperPatch(fan,'tower')).reason,'upper-structure-height-unknown','full width reaches the fan');
 for(const halfWidthM of [NaN,Infinity,-1])assert.equal((await world({obstacles:async()=>[{...line,halfWidthM}]}).upperPatch({...patch,lowAt:()=>{throw Error('invalid width must not request a certificate');}},'tower')).reason,'upper-structure-height-unknown');
 const touching={kind:'road',points:[[p[0],middle]],halfWidthM:0};
 assert.equal((await world({obstacles:async()=>[touching]}).upperPatch(fan,'tower')).reason,'upper-structure-height-unknown','an exact boundary contact is retained');
 assert.equal((await world({obstacles:async()=>[{...touching,points:[p]}]}).upperPatch(fan,'tower')).status,'clear');
 const missing=H.create({loadIndex:async()=>({grid:{offsetM:20},parts:{},targets:{}}),obstacles:async()=>[line]});
 assert.equal((await missing.upperPatch(fan,'tower')).reason,'height-coverage-unavailable');
 await assert.rejects(world({obstacles:async()=>[line]}).upperPatch(fan,'tower',{isCurrent:()=>false}),/candidate-cancelled/);
});

test('filled obstacle rings keep their edge and interior coverage when line fan pruning is available',async()=>{
 const patch={west:139.8048,east:139.8052,south:35.71,north:35.7102,lowM:1000,lowAt:()=>Infinity};
 const rings=[[[35.7099,139.8047],[35.7103,139.8047],[35.7103,139.8053],[35.7099,139.8053]],
  [[35.7099,139.8047],[35.7099,139.8053],[35.7103,139.8053]]];
 for(const ring of rings)assert.equal((await world({obstacles:async()=>[{kind:'bridge',rings:[ring]}]}).upperPatch(patch,'tower')).reason,'upper-structure-height-unknown','filled interiors/implicit closing edges are not erased by edge-only pruning');
});

test('upper structure contacts on fan edges, wrapped bearings and the observer remain unknown',async()=>{
 const Q=require('./src/features/candidates/tower-quality.js'),rad=Math.PI/180,R=6371008.8;
 const at=(p,az,d)=>{const a=p.latitude*rad,t=az*rad,s=d/R,b=Math.asin(Math.sin(a)*Math.cos(s)+Math.cos(a)*Math.sin(s)*Math.cos(t));
  return {latitude:b/rad,longitude:p.longitude+Math.atan2(Math.sin(t)*Math.sin(s)*Math.cos(a),Math.cos(s)-Math.sin(a)*Math.sin(b))/rad};};
 for(const latitude of [-59,0,35,59])for(const az of [-180,-179.99,-90,0,90,179.99]){
  const eye={latitude,longitude:179.999,elevation:5,eyeM:1.5},target={id:'skytree',...at(eye,az,600),parts:[{id:'deck',m:352}]};
  const shape=Q.corridor(eye,target,{vertices:[[-30,-30,0],[30,30,634]]},7/6),patches=[...shape.patches()];
  for(const index of [0,1,12])for(const fraction of [-1,0,1]){
   const patch=patches[index],p=index===0?eye:at(eye,shape.az+shape.half*fraction,(patch.fromM+patch.toM)/2);
   const h=H.create({loadIndex:async()=>({grid:{offsetM:20},parts:{}}),obstacles:async()=>[{kind:'railway',points:[[p.latitude,p.longitude]],halfWidthM:0}]});
   assert.equal((await h.upperPatch(patch,'skytree')).reason,'upper-structure-height-unknown',`${latitude}/${az}/${index}/${fraction}`);
  }
 }
});

function associatedBridge(){
 const lat=observer.latitude,lon=observer.longitude,line=[[lat+.0008,lon],[lat+.0012,lon]];
 const obstacle={id:'way/fixture-bridge',kind:'road',halfWidthM:12,lines:[line]};
 const entry={geometry:{kind:'road',halfWidthM:12,lines:[line],rings:[],points:[]},topM:28,
  source:{url:'https://example.test/source.gml',sha256:'a'.repeat(64),buildingId:'bldg-fixture',surfaces:['roof','wall-left','wall-right'],topRangeM:[27.7,27.72],lod:'2.1',surveyYear:2021},
  coverage:{basis:'explicit roof and side walls',polygons:[{outer:[[lat+.0007,lon-.0001],[lat+.0013,lon-.0001],[lat+.0013,lon+.0001],[lat+.0007,lon+.0001],[lat+.0007,lon-.0001]],holes:[]}]}};
 return {obstacle,entry,patch:{west:lon-.0002,east:lon+.0002,south:lat+.0008,north:lat+.0012,lowM:1000,lowAt:()=>1000}};
}

test('a complete associated bridge model uses its measured top and existing margin for every observer and target',async()=>{
 const {obstacle,entry,patch}=associatedBridge(),h=world({obstacles:async()=>[obstacle],structureModels:{[obstacle.id]:entry}});
 for(const targetKey of ['tower','another-target',null])assert.equal((await h.upperPatch(patch,targetKey)).status,'clear');
 for(const low of [28,29,NaN,null,-Infinity])assert.equal((await h.upperPatch({...patch,lowAt:()=>low},'tower')).reason,'upper-structure-height-unknown');
 assert.equal((await h.upperPatch({...patch,lowAt:()=>29.01},'tower')).status,'clear');
 assert.equal((await h.upperPatch({...patch,lowAt:undefined,lowM:29.01},'tower')).status,'clear','the whole-patch lower bound is conservative too');
 const blocked=world({buildings:[{north:100,top:40}],obstacles:async()=>[obstacle],structureModels:{[obstacle.id]:entry}});
 assert.equal((await blocked.upperPatch({...patch,lowAt:()=>35},'tower')).reason,'upper-building','associated bridge coverage does not erase a different building');
});

test('an associated model refuses changed geometry, incomplete coverage and missing or invalid provenance',async()=>{
 const {obstacle,entry,patch}=associatedBridge();
 const changes=[m=>delete m.source,m=>delete m.coverage,m=>m.topM=NaN,m=>m.topM=27,m=>m.source.url='',m=>m.source.url='https://',m=>m.source.sha256='bad',
  m=>m.source.surfaces.pop(),m=>m.source.buildingId='',m=>m.geometry.kind='railway',m=>m.geometry.halfWidthM=11,
  m=>m.geometry.lines[0][0][0]+=1e-10,m=>m.geometry.lines[0].reverse(),m=>m.geometry.points=[[35,139]],m=>m.coverage.polygons=[],
  m=>m.coverage.polygons[0].outer[1][0]=NaN,m=>m.coverage.polygons[0].outer.pop(),m=>m.coverage.polygons[0].outer.forEach(p=>p[1]+=.001)];
 for(const change of changes){
  const model=structuredClone(entry);change(model);
  const h=world({obstacles:async()=>[obstacle],structureModels:{[obstacle.id]:model}});
  assert.equal((await h.upperPatch(patch,'tower')).reason,'upper-structure-height-unknown');
 }
 const hole=structuredClone(entry),lat=observer.latitude,lon=observer.longitude;
 hole.coverage.polygons[0].holes=[[[lat+.00095,lon-.00005],[lat+.00105,lon-.00005],[lat+.00105,lon+.00005],[lat+.00095,lon+.00005],[lat+.00095,lon-.00005]]];
 assert.equal((await world({obstacles:async()=>[obstacle],structureModels:{[obstacle.id]:hole}}).upperPatch(patch,'tower')).reason,'upper-structure-height-unknown','the gap between covered endpoints is not skipped');
 assert.equal((await world({obstacles:async()=>[obstacle]}).upperPatch(patch,'tower')).reason,'upper-structure-height-unknown','old indexes have no exemption');
});

test('associated structures retain the entire OSM width, other structures, missing cells and cancellation',async()=>{
 const {obstacle,entry,patch}=associatedBridge(),models={[obstacle.id]:entry};let widest=0;
 const widthPatch={...patch,lowAt:b=>{widest=Math.max(widest,b.east-b.west);return b.east>observer.longitude+.00008?20:1000;}};
 assert.equal((await world({obstacles:async()=>[obstacle],structureModels:models}).upperPatch(widthPatch,'tower')).reason,'upper-structure-height-unknown');
 assert(widest>24/111320,'the measured narrow roof never shrinks the conservative 12 m half-width');
 const other={...obstacle,id:'way/unknown'};
 assert.equal((await world({obstacles:async()=>[obstacle,other],structureModels:models}).upperPatch(patch,'tower')).obstacleId,other.id);
 const missing=H.create({loadIndex:async()=>({grid:{offsetM:20},parts:{},structureModels:models}),obstacles:async()=>[obstacle]});
 assert.equal((await missing.upperPatch(patch,'tower')).reason,'height-coverage-unavailable');
 let release,current=true;
 const delayed=H.create({loadIndex:()=>new Promise(r=>{release=r;}),obstacles:async()=>[obstacle]});
 const pending=delayed.upperPatch(patch,'tower',{isCurrent:()=>current});
 await new Promise(r=>setImmediate(r));current=false;release({grid:{offsetM:20},parts:{},structureModels:models});
 await assert.rejects(pending,/candidate-cancelled/);
});

test('mesh codes and cells follow the 3rd-order mesh grid the builder writes',()=>{
 assert.equal(H.meshCode(MY,MX),CODE);
 const grid=new Uint16Array(ROWS*COLS);grid[5]=40;grid[6]=7;grid[ROWS*COLS-1]=600;
 const bytes=require('node:zlib').gunzipSync(pack(grid));assert.deepEqual(Array.from(H.decode(new Uint8Array(bytes))).filter(Boolean),[40,7,600]);
 const seen=[];H.cells({latitude:35.71,longitude:139.805},{latitude:35.71+1/22200*3.5,longitude:139.805},0,17.5,(x,y,a,z)=>{seen.push([y,a,z]);});
 assert.equal(seen.length,4);assert(seen.every(([,a,z],i)=>i===0||a===seen[i-1][2]));
 // Exactly through a corner, both side cells touch the line.
 const corner=[];H.cells({latitude:(792760+.5)/22200,longitude:(2516490+.5)/18000},{latitude:(792762+.5)/22200,longitude:(2516492+.5)/18000},0,14,(x,y)=>{corner.push(x+','+y);});
 assert(corner.includes('2516491,792760')&&corner.includes('2516490,792761'));
});

test('a building above the line blocks it; a line over every top with a margin is clear',async()=>{
 const h=world({buildings:[{north:100,top:30}]});
 const low=await h.trace(observer,north(5));assert.equal(low.status,'blocked');assert(Math.abs(low.hit.distanceM-100)<6);assert.equal(low.hit.topM,30);
 const high=await h.trace(observer,north(20));assert.equal(high.status,'clear');assert.equal(high.heights,'plateau');
 // Within a metre of the top is not clear either.
 const graze=await h.trace(observer,north(Math.atan((30.5-6.5)/105)*180/Math.PI));assert.notEqual(graze.status,'clear');
});

test('fixed endpoint reuse keeps exact PLATEAU evidence and respects footprint, endpoint and cancellation changes',async()=>{
 const {latitude:lat,longitude:lon}=observer;
 const ray={...north(5),maxM:180,endpoint:{latitude:lat+180/110540,longitude:lon,elevation:15},targetKey:'fav:tower'};
 const rings=[[[lat+50/110540,lon-.001],[lat+85/110540,lon-.001],[lat+85/110540,lon+.001],[lat+50/110540,lon+.001]]];
 let attached=null,checks=0;
 const worldOptions={buildings:[{north:60,top:45}],ownFootprint:()=>attached,ownFootprintVersion:()=>attached};
 const heights=world(worldOptions),current={isCurrent:()=>{checks++;return true;}};
 const first=await heights.trace(observer,ray,current),initialChecks=checks;
 assert.equal(first.status,'blocked');
 assert.equal(first.source,'plateau-grid');
 assert(first.cellsChecked>0);
 const evidence=structuredClone(first);
 first.hit.topM=0;
 checks=0;
 assert.deepEqual(await heights.trace({...observer,at:86400000},ray,current),evidence);
 assert(checks<initialChecks,'reuse skips the ordered cell traversal');
 await assert.rejects(heights.trace(observer,ray,{isCurrent:()=>false}),/candidate-cancelled/);
 assert.equal((await heights.trace(observer,{...ray,endpoint:{...ray.endpoint,elevation:140}})).status,'clear');
 attached=rings;
 assert.equal((await heights.trace(observer,ray)).status,'clear');
 attached=null;
 assert.deepEqual(await heights.trace(observer,ray),evidence);
 assert.equal((await world({...worldOptions,buildings:[]}).trace(observer,ray)).status,'clear');

 let gsiReads=0;
 const missing=H.create({loadIndex:async()=>({grid:{offsetM:20},parts:{},targets:{}}),gsiAlong:async()=>{gsiReads++;return null;}});
 for(let i=0;i<2;i++)assert.equal((await missing.trace(observer,ray)).reason,'footprints-unavailable');
 assert.equal(gsiReads,2);
});

test('a building right beside the stand point is not called blocked, only unconfirmed',async()=>{
 const r=await world({buildings:[{north:8,top:40}]}).trace(observer,north(5));assert.equal(r.status,'unknown');
});

test('the aimed target is not its own obstacle, but blocks lines aimed at other targets',async()=>{
 const h=world({target:[{north:300,top:600}]});
 assert.equal((await h.trace(observer,{...north(5),targetKey:'tower'})).status,'clear');
 assert.equal((await h.trace(observer,{...north(5),targetKey:'other'})).status,'blocked');
});

test('a GSI footprint without a PLATEAU height is clear only above the tallest of its type',async()=>{
 const ring=(d,w=10)=>[[observer.latitude+d/110540,observer.longitude-w/90000],[observer.latitude+d/110540,observer.longitude+w/90000],[observer.latitude+(d+20)/110540,observer.longitude+w/90000],[observer.latitude+(d+20)/110540,observer.longitude-w/90000],[observer.latitude+d/110540,observer.longitude-w/90000]];
 const house={code:3101,ring:ring(200),entryM:200};
 const unknown=await world({gsi:[house]}).trace(observer,north(4));assert.equal(unknown.status,'unknown');assert.equal(unknown.reason,'building-height-unknown');
 const over=await world({gsi:[house]}).trace(observer,north(9));assert.equal(over.status,'clear');assert.equal(over.heights,'estimated');
 // The same footprint is not counted twice when PLATEAU holds it.
 // (Kept inside the one mesh: beyond it, low lines over ground without PLATEAU data are only estimated.)
 const held=await world({buildings:[{north:198,top:8,depth:6}],gsi:[house]}).trace(observer,{...north(4),maxM:600});assert.equal(held.status,'clear');assert.equal(held.heights,'plateau');
 assert.equal((await H.create({loadIndex:async()=>({grid:{offsetM:20},parts:{},targets:{}}),gsiAlong:async()=>null}).trace(observer,north(4))).status,'unknown');
});

test('trees and elevated structures of unknown height: the line must clear the tallest of their kind',async()=>{
 const at=(d,dx=0)=>[observer.latitude+d/110540,observer.longitude+dx/90000];
 const wood=[at(100,-30),at(100,30),at(140,30),at(140,-30),at(100,-30)],rail=[at(300,-200),at(300,200)];
 const h=list=>H.create({fetchImpl:async()=>new Response('',{status:404}),loadIndex:async()=>({grid:{offsetM:20},parts:{},targets:{}}),gsiAlong:async()=>[],groundAt:async()=>5,obstacles:async()=>{if(list instanceof Error)throw list;return list;}});
 const low=await h([{kind:'tree',capM:25,rings:[wood]}]).trace(observer,{...north(6),maxM:600});assert.equal(low.status,'unknown');assert.equal(low.reason,'trees');assert(Math.abs(low.hit.distanceM-100)<2);
 assert.equal((await h([{kind:'tree',capM:25,rings:[wood]}]).trace(observer,{...north(25),maxM:600})).status,'clear');
 const viaduct=await h([{kind:'railway',capM:15,lines:[rail],halfWidthM:8}]).trace(observer,{...north(2),maxM:600});assert.equal(viaduct.reason,'elevated-structure');
 assert.equal((await h([{kind:'railway',capM:15,lines:[rail],halfWidthM:8}]).trace(observer,{...north(5),maxM:600})).status,'clear');
 // Standing inside a wood: every line starts among the trees.
 assert.equal((await h([{kind:'tree',capM:25,rings:[[at(-20,-20),at(-20,20),at(20,20),at(20,-20),at(-20,-20)]]}]).trace(observer,{...north(30),maxM:600})).reason,'trees');
 assert.equal((await h(Error('unavailable')).trace(observer,{...north(6),maxM:600})).reason,'obstacles-unavailable');
});

test('a part list or mesh file that does not match its index is not used',async()=>{
 const part=Buffer.from(JSON.stringify({meshes:{[CODE]:['0000000000000000',10]}})),partSha=createHash('sha256').update(part).digest('hex').slice(0,16);
 const serve=list=>async url=>url.endsWith('.bin')||url.includes('.bin?')?new Response(pack(new Uint16Array(ROWS*COLS))):new Response(list);
 const badMesh=H.create({fetchImpl:serve(part),loadIndex:async()=>({grid:{offsetM:20},parts:{[CODE.slice(0,4)]:[partSha,1,10]},targets:{}}),gsiAlong:async()=>[]});
 const r=await badMesh.trace(observer,north(5));assert.equal(r.status,'unknown');assert.equal(r.reason,'height-data-unavailable');
 const badPart=H.create({fetchImpl:serve(part),loadIndex:async()=>({grid:{offsetM:20},parts:{[CODE.slice(0,4)]:['ffffffffffffffff',1,10]},targets:{}}),gsiAlong:async()=>[]});
 assert.equal((await badPart.trace(observer,north(5))).reason,'height-data-unavailable');
});

test('the skyline says how high up the target the building tops along the whole line hide it',async()=>{
 const h=world({buildings:[{north:100,top:30},{north:400,top:20},{north:10,top:90}],target:[{north:560,top:600}]});
 const end={latitude:observer.latitude+600/110540,longitude:observer.longitude,elevation:600},c=1/(2*6371008.8*7/6),eye=6.5;
 const ray={azimuth:0,altitude:0,maxM:600,endpoint:end,targetKey:'tower',refractionK:7/6};
 const s=await h.skyline(observer,ray);assert.equal(s.status,'ok');assert.equal(s.complete,true);assert.equal(s.topM,30);
 // The nearest building, 100 m away and 30 m high, hides the most: eye + (30 - eye) * 600 / 100, and the earth's curve.
 const at=s.distanceM,expect=eye+(30-eye-c*at*at)/at*600+c*600*600;assert(Math.abs(s.toM-expect)<1e-6);assert(s.toM>130&&s.toM<160,String(s.toM));
 // The building right beside the stand point (10 m) and the aimed target's own cells are not counted.
 assert(Math.abs(at-100)<6);
 assert.equal((await h.skyline(observer,{...north(5)})).status,'unknown');
});

function previewWorld({meshCount=1,columns=1,failedMesh=-1,pause=false,beforeMesh=null}={}){
 const empty=pack(new Uint16Array(ROWS*COLS));
 const packedRoof=pack(new Uint16Array(ROWS*COLS).fill(50));
 const digest=bytes=>createHash('sha256').update(bytes).digest('hex').slice(0,16);
 const hashes=[digest(packedRoof),digest(empty)],entries=new Map(),partIndexes=new Map(),bodies=new Map();
 for(let i=0;i<meshCount;i++){
  const code=H.meshCode(MY+Math.floor(i/columns),MX+i%columns),p4=code.slice(0,4),meshes=partIndexes.get(p4)||{};
  meshes[code]=[hashes[i===0?0:1],i===0?30:0];partIndexes.set(p4,meshes);entries.set(code,i);
 }
 const parts={};
 for(const [p4,meshes] of partIndexes){
  const body=Buffer.from(JSON.stringify({meshes}));
  parts[p4]=[digest(body),Object.keys(meshes).length,30];bodies.set(p4,body);
 }
 let active=0,maxActive=0;const requests=new Map();
 const heights=H.create({loadIndex:async()=>({grid:{offsetM:20},parts}),async fetchImpl(url){
  const code=url.match(/(\d+)\.bin\?/u)?.[1],p4=url.match(/(\d+)\/index\.json\?/u)?.[1];
  requests.set(code||p4,(requests.get(code||p4)||0)+1);
  active++;maxActive=Math.max(maxActive,active);
  if(pause)await new Promise(resolve=>setTimeout(resolve,1));
  if(code&&beforeMesh)await beforeMesh(code);
  active--;
  if(p4&&bodies.has(p4))return new Response(bodies.get(p4));
  const i=entries.get(code);
  if(i===undefined||i===failedMesh)return new Response('missing',{status:404});
  return new Response(i===0?packedRoof:empty);
 }});
 return {heights,requests,maxActive:()=>maxActive};
}

test('preview frontage separates recorded empty space, unknown space, and known roofs with missing data',async()=>{
 const clear=world(),separate=previewWorld({meshCount:2,failedMesh:1});
 assert.deepEqual(await clear.angles(observer,[0],120),[-Infinity]);
 assert.deepEqual(await clear.frontage(observer,[0],120),[{angle:-Infinity,complete:true}]);
 assert.deepEqual(await clear.frontage(observer,[0],30),[{angle:-Infinity,complete:false}]);
 assert.deepEqual(await clear.frontage(observer,[180],1400),[{angle:-Infinity,complete:false}]);
 assert.deepEqual(await clear.frontage(observer,[0],159000),[{angle:-Infinity,complete:false}]);
 const [north]=await separate.heights.frontage(observer,[0],1700);
 assert.equal(north.complete,false);assert(north.angle>20,'a roof in the loaded part remains visible');
 const target=world({target:[{north:60,top:50}]});
 assert.equal((await target.frontage(observer,[0],120,{targetKey:'tower'}))[0].angle,-Infinity);
 assert((await target.frontage(observer,[0],120))[0].angle>10);
 const [known,invalid]=await clear.frontage(observer,[0,NaN],120);
 assert.equal(known.complete,true);assert.deepEqual(invalid,{angle:-Infinity,complete:false});
});

test('preview frontage retains early roofs beyond the 160-grid cache with bounded unique reads',async()=>{
 const f=previewWorld({meshCount:400,columns:20,pause:true});
 const [result]=await f.heights.frontage(observer,Array.from({length:81},(_,i)=>i),17000);
 assert(result.angle>20,'the first mesh roof still contributes after reading more than 160 meshes');
 assert.equal(result.complete,true);
 assert.equal(f.maxActive(),5);
 assert([...f.requests.keys()].filter(key=>key.length===8).length>160);
 assert([...f.requests.values()].every(n=>n===1),'each mesh and part is read only once per sweep');
});

test('preview shares the tile concurrency cap and does not start more reads after an abandoned view',async()=>{
 const f=previewWorld({meshCount:30,pause:true});
 let active=true;
 const cancelled=f.heights.frontage(observer,[0],26000,{isCurrent:()=>active});
 const waiting=assert.rejects(cancelled,/candidate-cancelled/u);
 while(![...f.requests.keys()].some(key=>key.length===8))await new Promise(resolve=>setTimeout(resolve,0));
 active=false;const requested=f.requests.size;
 await waiting;
 await new Promise(resolve=>setTimeout(resolve,8));
 assert.equal(f.requests.size,requested);
 const used=previewWorld({meshCount:8,pause:true});
 await Promise.all([used.heights.frontage(observer,[0],7000),used.heights.frontage(observer,[0],7000)]);
 assert.equal(used.maxActive(),5);
 assert([...used.requests.values()].every(n=>n===1));
});

test('the central preview can start its own mesh while all five frontage slots are occupied', {timeout:5000},async()=>{
 let release,notify;
 const held=new Promise(resolve=>{release=resolve;});
 const fiveStarted=new Promise(resolve=>{notify=resolve;});
 let started=0;
 const central=H.meshCode(MY,MX+1);
 const f=previewWorld({meshCount:400,columns:20,beforeMesh:async code=>{
  if(code===central||code===CODE)return;
  if(++started===5)notify();
  await held;
 }});
 const frontage=f.heights.frontage(observer,[0],20000);
 try{
  await fiveStarted;
  const endpoint={latitude:observer.latitude,longitude:observer.longitude+0.015,elevation:70};
  const center=f.heights.skyline(observer,{endpoint,maxM:1350},{preview:true});
  await center;
  assert(f.requests.has(central),'the central mesh starts before a frontage tile releases its slot');
  assert.equal(f.maxActive(),6);
 }finally{release();await frontage;}
});

test('the opt-in central preview reads the same measured skyline as the sequential path',async()=>{
 const props={buildings:[{north:85,top:22},{north:120,top:29}],target:[{north:185,top:50}]};
 const ray={...north(5),maxM:280,endpoint:{latitude:observer.latitude+280/110540,longitude:observer.longitude,elevation:30},targetKey:'tower'};
 assert.deepEqual(await world(props).skyline(observer,ray,{preview:true}),await world(props).skyline(observer,ray));
});


test('the preview refreshes its own-target exclusion after the footprint is attached or removed',async()=>{
 const {latitude:lat,longitude:lon}=observer;
 const rings=[[[lat+50/110540,lon-.001],[lat+80/110540,lon-.001],[lat+80/110540,lon+.001],[lat+50/110540,lon+.001]]];
 let attached=null,lookups=0;
 const heights=world({buildings:[{north:60,top:50}],ownFootprint:()=>{lookups++;return attached;},ownFootprintVersion:()=>attached});
 const run=async()=>(await heights.frontage(observer,[0],120,{targetKey:'fav:tower'}))[0].angle;
 assert(await run()>10);
 attached=rings;assert.equal(await run(),-Infinity);assert.equal(await run(),-Infinity);
 attached=null;assert(await run()>10);
 assert.equal(lookups,3);
});
