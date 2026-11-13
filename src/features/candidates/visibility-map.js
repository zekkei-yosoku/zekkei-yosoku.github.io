/* 見える場所の地図 (2026-11-13, user's choice "対象ごとに作って保存"): instead of drawing each place's line to the target one
   by one (on 月×東京タワー 68% of 15,499 places were blocked), rays go out from the target every 0.05 degrees. Along each
   ray the highest obstacle seen from each level of the target (ground, PLATEAU building tops, tree crowns) is carried
   outward, so one walk tells every ground cell on the ray how many levels of the target, from the top, it sees: the lines
   from all those places converge on the target. Obstacles within 30 m of a place are left out, as in the place's own
   check (building-grid near zone; trees within 30 m are stepped around). The map is a coarse pre-filter: a place it keeps
   is still checked exactly on its own line. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesVisibilityMap=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const R=6371008.8,RAD=Math.PI/180,REFRACTION_K=7/6,STEP_DEG=.05,STEP_M=5,START_M=20,SECTOR_DEG=1,NEAR_M=30,EYE_M=1.5,CROWN_MIN_M=3,CROWN_ADD_M=2;
const MAX_M=50000,UNKNOWN=255,RAYS=Math.round(SECTOR_DEG/STEP_DEG),BIN=5;
// Trees count as the place's own check counts them (tree-heights.js): from 30 m to 5 km in front of the place, and not
// within 300 m of the target.
const TREE_RANGE_M=5000,TREE_END_M=300;
// A saved or shipped map is used only with the same reading of the data; bump when the walk or its rules change.
const VERSION='vm2-near30-crown2-tree5k-bin25-sea0';
function destination(lat,lon,az,m){const d=m/R,a=lat*RAD,t=az*RAD,b=Math.asin(Math.sin(a)*Math.cos(d)+Math.cos(a)*Math.sin(d)*Math.cos(t));
 return {latitude:b/RAD,longitude:lon+Math.atan2(Math.sin(t)*Math.sin(d)*Math.cos(a),Math.cos(d)-Math.sin(a)*Math.sin(b))/RAD};}
function bearingM(a,b){const p=a.latitude*RAD,q=b.latitude*RAD,dl=(b.longitude-a.longitude)*RAD;
 const az=(Math.atan2(Math.sin(dl)*Math.cos(q),Math.cos(p)*Math.sin(q)-Math.sin(p)*Math.cos(q)*Math.cos(dl))/RAD+360)%360;
 const h=Math.sin((q-p)/2)**2+Math.cos(p)*Math.cos(q)*Math.sin(dl/2)**2;return {azimuth:az,m:2*R*Math.asin(Math.min(1,Math.sqrt(h)))};}
// The levels tested, top first: the target's named parts and every fifth of its height above its ground.
function levelsFor(target){
 const ground=Number.isFinite(target?.groundM)?target.groundM:0,named=(target?.parts||[]).filter(p=>Number.isFinite(p.m)&&p.m>ground+5).map(p=>({m:p.m,name:p.name||p.id||null}));
 if(!named.length)return [];
 const top=Math.max(...named.map(p=>p.m)),out=named.slice();
 for(const f of [.8,.6,.4,.2]){const m=ground+(top-ground)*f;if(!out.some(l=>Math.abs(l.m-m)<3))out.push({m,name:null});}
 return out.sort((a,b)=>b.m-a.m);
}
// As far as a body half a degree up can stand behind the top (at least 2 km, at most 50 km).
const reach=(target,levels)=>Math.min(MAX_M,Math.max(2000,(levels[0].m-(Number.isFinite(target.groundM)?target.groundM:0))/Math.tan(.5*RAD)));
const mapKey=target=>JSON.stringify([target.id,target.latitude,target.longitude,target.groundM??null,(target.parts||[]).map(p=>[p.id,p.m])]);
// A ray's counts as runs: value byte, run length as a varint.
function encodeRay(counts){const out=[];for(let i=0;i<counts.length;){let j=i;while(j<counts.length&&counts[j]===counts[i])j++;out.push(counts[i]);let n=j-i;while(n>=128){out.push(n&127|128);n>>>=7;}out.push(n);i=j;}return Uint8Array.from(out);}
function decodeRay(bytes,n){const out=new Uint8Array(n);let i=0,k=0;while(k<bytes.length&&i<n){const v=bytes[k++];let len=0,s=0,b;do{b=bytes[k++];len|=(b&127)<<s;s+=7;}while(b&128);out.fill(v,i,Math.min(n,i+len));i+=len;}return out;}
const b64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);};
const unb64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
function create({ground,buildings=null,trees=null,store=null,builtIn=null,capM=Infinity,yieldTask=typeof AstroNotesLibrary==='object'&&AstroNotesLibrary.pause||(()=>new Promise(r=>setTimeout(r,0)))}={}){
 const maps=new Map();
 // Everything a sector's rays will read, in parallel before the walk (its two edges and middle every 250 m), so the walk
 // waits on no tile.
 async function prefetch(target,index,maxM,key){
  const jobs=[];for(const f of [0,.5,1])for(let u=START_M;u<=maxM;u+=250){const p=destination(target.latitude,target.longitude,(index+f)*SECTOR_DEG,u);
   jobs.push(()=>ground.at(p),()=>buildings?buildings.loadAt(p.latitude,p.longitude):null,()=>trees?trees.canopy(p.latitude,p.longitude):null);}
  let next=0;const worker=async()=>{while(next<jobs.length){const job=jobs[next++];try{await job();}catch(e){if(e?.message==='candidate-cancelled')throw e;}}};
  await Promise.all(Array.from({length:8},worker));
 }
 // One sector (1 degree, 20 rays) of the map. Ground that cannot be read ends the ray as unknown; a missing building mesh
 // or crown counts as nothing there, so the map never rules out a place its own check could keep.
 async function sector(target,index,{isCurrent=()=>true}={}){
  const levels=levelsFor(target);if(!levels.length)return null;
  const maxM=Math.min(capM,reach(target,levels)),N=Math.floor((maxM-START_M)/STEP_M)+1,K=levels.length,delay=Math.ceil(NEAR_M/STEP_M),window=Math.floor(TREE_RANGE_M/STEP_M),c=1/(2*R*REFRACTION_K),key=target.id;
  await prefetch(target,index,maxM,key);if(!isCurrent())throw Error('candidate-cancelled');
  const solid=Array.from({length:K},()=>new Float64Array(N)),tree=Array.from({length:K},()=>new Float64Array(N)),running=new Float64Array(K),rays=[];
  const queue=Array.from({length:K},()=>new Int32Array(N));
  for(let r=0;r<RAYS;r++){
   const az=(index*SECTOR_DEG+(r+.5)*STEP_DEG)%360,out=new Uint8Array(N),head=new Int32Array(K),tail=new Int32Array(K);running.fill(-Infinity);
   for(let i=0;i<N;i++){
    if(i%400===0&&!isCurrent())throw Error('candidate-cancelled');
    const u=START_M+i*STEP_M,p=destination(target.latitude,target.longitude,az,u),drop=c*u*u;
    let g=ground.peek(p,{seaAsZero:true});if(g===undefined){await ground.at(p);g=ground.peek(p,{seaAsZero:true});}
    if(!Number.isFinite(g)){out.fill(UNKNOWN,i);break;}
    let b=buildings?buildings.topNow(p.latitude,p.longitude,key):null;if(b===undefined){await buildings.loadAt(p.latitude,p.longitude).catch(()=>{});b=buildings.topNow(p.latitude,p.longitude,key);}
    let t=trees?trees.canopyNow(p.latitude,p.longitude):0;if(t===undefined)t=await trees.canopy(p.latitude,p.longitude).catch(()=>0);
    const top=Math.max(g,Number.isFinite(b)?b:g),crown=t>=CROWN_MIN_M&&u>=TREE_END_M?g+t+CROWN_ADD_M:-Infinity,eye=g+EYE_M,j=i-delay;let n=0;
    for(let k=0;k<K;k++){
     running[k]=Math.max(running[k],(top-levels[k].m-drop)/u);solid[k][i]=running[k];tree[k][i]=crown>-Infinity?(crown-levels[k].m-drop)/u:-Infinity;
     // Crowns within the place's 5 km: a sliding maximum (monotonic queue of indices) over [j-window, j].
     if(j>=0){const q=queue[k];while(tail[k]>head[k]&&tree[k][q[tail[k]-1]]<=tree[k][j])tail[k]--;q[tail[k]++]=j;while(q[head[k]]<j-window)head[k]++;}
    }
    for(let k=0;k<K;k++){const blocked=j>=0?Math.max(solid[k][j],tree[k][queue[k][head[k]]]):-Infinity;if((eye-levels[k].m-drop)/u<blocked)break;n++;}
    out[i]=n;
   }
   // Stored in 25 m bins, each the most levels any of its steps sees (a generous reading, as the lookup is).
   const bins=new Uint8Array(Math.ceil(N/BIN));for(let b=0;b<bins.length;b++){let v=0,unknown=false;for(let x=b*BIN;x<Math.min(N,b*BIN+BIN);x++){if(out[x]===UNKNOWN)unknown=true;else v=Math.max(v,out[x]);}bins[b]=unknown&&!v?UNKNOWN:v;}
   rays.push(bins);await yieldTask();
  }
  return {index,levels,maxM,steps:Math.ceil(N/BIN),rays};
 }
 const decode=saved=>({levels:saved.levels,maxM:saved.maxM,steps:saved.steps,sectors:new Map(Object.entries(saved.sectors).map(([i,rays])=>[+i,rays.map(r=>decodeRay(unb64(r),saved.steps))]))});
 // A shipped map of a built-in target (tools/build-visibility-maps.mjs), when it was made for this target and this walk.
 async function shipped(target,key){if(!builtIn)return null;try{const saved=await builtIn(target);return saved?.v===1&&saved.version===VERSION&&saved.key===key?decode(saved):null;}
  catch(e){globalThis.AstroNotesErrors?.note('visibility-map.builtIn',e);return null;}}
 async function restore(key){if(!store)return null;try{const saved=await store.get(key);if(!saved||saved.v!==1||saved.version!==VERSION)return null;
  return {levels:saved.levels,maxM:saved.maxM,steps:saved.steps,sectors:new Map(Object.entries(saved.sectors).map(([i,rays])=>[+i,rays.map(r=>decodeRay(unb64(r),saved.steps))]))};}
  catch(e){globalThis.AstroNotesErrors?.note('visibility-map.restore',e);return null;}}
 async function save(key,m){if(!store)return;try{await store.set(key,{v:1,version:VERSION,levels:m.levels,maxM:m.maxM,steps:m.steps,sectors:Object.fromEntries([...m.sectors].map(([i,rays])=>[i,rays.map(r=>b64(encodeRay(r)))]))});}
  catch(e){globalThis.AstroNotesErrors?.note('visibility-map.save',e);}}
 // The sectors holding these bearings from the target (and their neighbours), in the order given, computed once and kept
 // for the target. Past the deadline no more sectors are computed this time (a later search adds them).
 async function ensure(target,bearings,{isCurrent=()=>true,deadline=Infinity}={}){
  const key=mapKey(target);let m=maps.get(key);
  if(!m){m=await shipped(target,key)||await restore(key)||{levels:levelsFor(target),maxM:null,steps:null,sectors:new Map()};maps.set(key,m);while(maps.size>8)maps.delete(maps.keys().next().value);}
  if(!m.levels.length)return m;
  const want=new Set();for(const a of bearings)if(Number.isFinite(a)){const i=Math.floor(((a%360)+360)%360/SECTOR_DEG);for(const d of [0,-1,1])want.add((i+d+360)%360);}
  let added=0;for(const i of want){if(m.sectors.has(i))continue;if(Date.now()>deadline)break;const s=await sector(target,i,{isCurrent});if(!s)continue;m.sectors.set(i,s.rays);m.maxM=s.maxM;m.steps=s.steps;added++;}
  if(added)await save(key,m);
  return m;
 }
 return {sector,ensure,maps};
}
// What a place at (lat,lon) sees on the map: the most levels any of the 3x3 nearest ray steps around it sees (a coarse,
// generous reading), or known:false outside the computed sectors and range.
function lookup(m,target,lat,lon){
 if(!m?.levels?.length||!m.sectors?.size||!Number.isFinite(m.steps))return {known:false};
 const {azimuth,m:d}=bearingM(target,{latitude:lat,longitude:lon});if(d<START_M||d>m.maxM)return {known:false};
 const ray=Math.floor(azimuth/STEP_DEG),i=Math.floor((d-START_M)/(STEP_M*BIN));let best=-1;
 for(const dr of [-1,0,1]){const g=(ray+dr+360/STEP_DEG)%(360/STEP_DEG),rays=m.sectors.get(Math.floor(g/RAYS));if(!rays)return {known:false};const counts=rays[g%RAYS];
  for(const di of [-1,0,1]){const v=counts[i+di];if(v===undefined)continue;if(v===UNKNOWN)return {known:false};best=Math.max(best,v);}}
 return best<0?{known:false}:{known:true,count:best,lowestM:best>0?m.levels[best-1].m:null};
}
// How many levels from the top a place must see to keep it: down to the second named part (the user's choice of
// 2026-11-13, generic-evaluator.js partsHidden), or the top alone for a target named by its tip only.
function needFor(m){const named=(m?.levels||[]).map((l,i)=>({...l,i})).filter(l=>l.name);return named.length>1?named[1].i+1:1;}
// A region (lon/lat box) the map shows seeing too little everywhere it was computed; unknown anywhere keeps it.
function regionHidden(m,target,bbox,need){
 for(let a=0;a<6;a++)for(let b=0;b<6;b++){const r=lookup(m,target,bbox[1]+(bbox[3]-bbox[1])*(b+.5)/6,bbox[0]+(bbox[2]-bbox[0])*(a+.5)/6);if(!r.known||r.count>=need)return false;}
 return true;
}
return {create,lookup,needFor,regionHidden,levelsFor,encodeRay,decodeRay,mapKey,VERSION,STEP_DEG,STEP_M,START_M,SECTOR_DEG,BIN,UNKNOWN};
});
