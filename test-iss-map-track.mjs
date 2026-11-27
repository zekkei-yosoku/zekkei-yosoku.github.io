import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
const repo=fileURLToPath(new URL('.',import.meta.url)).replace(/\/$/,'');
const require=createRequire(repo+'/package.json');
const A=require('./astronotes-astro.js');
const before=require('./astronotes-iss.js');
const I=require('./experiments/moon-map/astronotes-iss.js');
const [io,pr,tr]=await Promise.all(['io','propagation','transforms'].map(k=>import(repo+'/vendor/satellite/'+k+'.js')));
const sat={twoline2satrec:io.twoline2satrec,propagate:pr.propagate,gstime:pr.gstime,eciToEcf:tr.eciToEcf,ecfToLookAngles:tr.ecfToLookAngles};
const tle=I.parseTle(readFileSync(repo+'/fixtures/iss-20260929.tle','utf8'));
const opts={center:{latitude:35.6812,longitude:139.7671},radiusKm:400,fromMs:Date.parse('2026-09-30T00:00:00+09:00'),hours:168};
const span=track=>track.slice(1).reduce((n,p,i)=>n+I.distanceKm(track[i].latitude,track[i].longitude,p.latitude,p.longitude),0);
for(const body of ['moon','sun'])test(body+' crossing extends only the rendered track and resolves the place time',async()=>{
 const old=before.transits(sat,tle,{...opts,body});
 const prediction=I.transits(sat,tle,{...opts,body});
 assert.deepEqual(prediction,old);
 for(const row of prediction){
  const expanded=await I.transitMapTrack(sat,tle,row);
  assert(span(expanded)>span(row.track));
  assert(expanded.every((p,i)=>p.at>(expanded[i-1]?.at??-Infinity)&&p.halfWidthKm>0&&Number.isFinite(p.halfWidthKm)));
  for(const q of [expanded[0],expanded.at(-1)]){
   const astro=(body==='moon'?A.moon:A.sun)(q.at,{...q,elevation:0});
   assert(astro.geometricAltitude>=4.95 && astro.geometricAltitude<7, `endpoint ${astro.geometricAltitude}`);
  }
  const q=row.track[Math.floor(row.track.length*0.65)];
  const actual=await I.transitTimeAt(sat,tle,body,q,q.at);
  assert(Math.abs(actual.at-q.at)<80);
  assert(actual.durationS>0);
 }
});
await assert.rejects(I.transitMapTrack(sat,tle,I.transits(sat,tle,{...opts,body:'moon'})[0],{isCurrent:()=>false}),{name:'AbortError'});
