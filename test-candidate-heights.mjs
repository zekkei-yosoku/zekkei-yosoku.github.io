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
function world({buildings=[],target=[],gsi=[]}={}){
 const grid=new Uint16Array(ROWS*COLS),put=(list,into)=>{for(const {north,top,width=2,depth=3} of list){const [r,c]=cell(observer.latitude+north/110540,observer.longitude);for(let y=r;y<r+depth;y++)for(let x=c-width;x<=c+width;x++)into(y*COLS+x,top+20);}};
 put(buildings,(i,v)=>{grid[i]=Math.max(grid[i],v);});
 const own=[];put(target,(i,v)=>own.push([i,v]));
 const body=pack(grid),sha=createHash('sha256').update(body).digest('hex'),top=Math.max(0,...buildings.map(b=>b.top));
 // Layout v2: <first 4 digits>/index.json lists the part's meshes; the main index lists parts by the SHA-256 of that list.
 const part=Buffer.from(JSON.stringify({meshes:{[CODE]:[sha.slice(0,16),top]}})),partSha=createHash('sha256').update(part).digest('hex');
 const index={grid:{offsetM:20},parts:{[CODE.slice(0,4)]:[partSha.slice(0,16),1,top]},targets:own.length?{tower:{[CODE]:{cells:own,topM:Math.max(...target.map(t=>t.top))}}}:{}};
 const fetchImpl=async url=>url.includes(CODE.slice(0,4)+'/'+CODE+'.bin')?new Response(body):url.includes(CODE.slice(0,4)+'/index.json')?new Response(part):new Response('missing',{status:404});
 return H.create({fetchImpl,loadIndex:async()=>index,gsiAlong:async()=>gsi,groundAt:async()=>5});
}
const north=altitude=>({azimuth:0,altitude,maxM:1500,refractionK:7/6});

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
