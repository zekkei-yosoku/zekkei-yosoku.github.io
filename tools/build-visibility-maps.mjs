// 組み込みの対象（山を除く）の「見える場所の地図」を全方位で作り、data/visibility/<id>.json に書く（2026-11-13、
// ユーザーの選択「対象ごとに作って保存。組み込みの対象は前もって作って配る」）。アプリと同じ部品（visibility-map.js・
// height-grid.js・tree-heights.js・live-terrain.js）で計算する。建物は同梱の格子、地面は国土地理院のz14、木はMeta・WRIの
// 樹高地図。読み込んだタイルは CACHE_DIR に保存して使い回す（既定は OS の一時フォルダ）。
// 使い方: node tools/build-visibility-maps.mjs [対象のid ...]
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),W=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..')+'/';
const VM=require(W+'src/features/candidates/visibility-map.js'),H=require(W+'src/features/candidates/height-grid.js'),T=require(W+'src/features/candidates/tree-heights.js');
const G=require(W+'astronotes-terrain.js'),{createLive}=require(W+'src/features/candidates/live-terrain.js'),A=require(W+'astronotes-align.js');
const cacheDir=process.env.CACHE_DIR||path.join(os.tmpdir(),'astronotes-visibility-cache');fs.mkdirSync(cacheDir,{recursive:true});
let fetched=0,hits=0;
async function cachedFetch(url,options={}){
 const range=options.headers?.Range||'',file=path.join(cacheDir,crypto.createHash('sha1').update(url+'|'+range).digest('hex'));
 if(fs.existsSync(file)){hits++;const raw=fs.readFileSync(file),status=raw.readUInt16BE(0);return new Response(status===204||status===404?null:raw.subarray(2),{status});}
 for(let attempt=0;;attempt++){
  try{const r=await fetch(url,{headers:options.headers});fetched++;if(r.status===404){fs.writeFileSync(file,Buffer.from([1,148]));return new Response(null,{status:404});}
   if(!r.ok)throw Error('http '+r.status);const body=Buffer.from(await r.arrayBuffer()),head=Buffer.alloc(2);head.writeUInt16BE(r.status,0);fs.writeFileSync(file,Buffer.concat([head,body]));return new Response(body,{status:r.status});}
  catch(e){if(attempt>=4)throw e;await new Promise(x=>setTimeout(x,1000*(attempt+1)));}
 }
}
const local=async u=>new Response(fs.readFileSync(W+u.split('?')[0]));
const ground=createLive({geo:G,fetchImpl:cachedFetch,maxTiles:1e6,maxDurationMs:1e12,timeoutMs:30000,layers:[['dem',14]]});
const buildings=H.create({fetchImpl:local,base:'data/building-heights/'}),trees=T.create({fetchImpl:cachedFetch,maxBlocks:400});
const vm=VM.create({ground,buildings,trees,yieldTask:async()=>{}});
const ids=process.argv.slice(2).length?process.argv.slice(2):A.TARGETS.filter(t=>!t.rim).map(t=>t.id);
fs.mkdirSync(W+'data/visibility',{recursive:true});
for(const id of ids){
 const target=A.targetById(id),t0=Date.now();if(!target||target.rim){console.log('skip',id);continue;}
 const sectors={};let levels=null,maxM=null,steps=null;
 for(let i=0;i<360;i++){const s=await vm.sector(target,i);if(!s)break;levels=s.levels;maxM=s.maxM;steps=s.steps;sectors[i]=s.rays.map(r=>Buffer.from(VM.encodeRay(r)).toString('base64'));
  if(i%30===29)console.log(id,'sector',i+1,'/360',Math.round((Date.now()-t0)/1000)+'s','fetched',fetched,'cached',hits);}
 if(!levels){console.log('no levels',id);continue;}
 const out={v:1,version:VM.VERSION,key:VM.mapKey(target),levels,maxM,steps,sectors};
 fs.writeFileSync(W+'data/visibility/'+id+'.json',JSON.stringify(out));
 console.log('wrote',id,fs.statSync(W+'data/visibility/'+id+'.json').size,'bytes',Math.round((Date.now()-t0)/1000)+'s');
}
