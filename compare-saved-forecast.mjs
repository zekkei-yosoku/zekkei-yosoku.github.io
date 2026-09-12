// 保存済み国内runの実装差分検査。朝夕方位は保存要求座標から判別、未来の原応答を再取得しない。
// 実行環境時差はAsia/Tokyo相当(+9h)に固定。実景評価ではない。
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {replay} from './replay-forecast.mjs';
const [manifestPath,baselinePath,candidatePath,outputPath]=process.argv.slice(2);
if(!outputPath)throw new Error('node compare-saved-forecast.mjs capture-manifest.json baseline.js candidate.js report.json');
const dir=dirname(resolve(manifestPath))+'/';
const manifest=JSON.parse(readFileSync(manifestPath));
const sources={baseline:readFileSync(baselinePath,'utf8'),candidate:readFileSync(candidatePath,'utf8')};
const events=[];
for(const capture of manifest.sites){
 if(capture.status!=='captured')continue;
 const targets=capture.site.targets.filter(x=>['sunrise','sunset','seaOfClouds','rainbow','starrySky'].includes(x));if(!targets.length)continue;
 const entries=JSON.parse(readFileSync(dir+capture.rawPath));
 if(entries.some(x=>x.status!==200 || !Number.isFinite(Date.parse(x.receivedAt)) || Date.parse(x.receivedAt)>Date.parse(capture.capturedAt)))throw new Error('保存応答の取得状態/時刻を確認してください');
 const home=entries.find(x=>new URL(x.url).hostname==='api.open-meteo.com'&&!Array.isArray(x.raw));
 const rawOffsets=entries.filter(x=>new URL(x.url).hostname==='api.open-meteo.com'&&Array.isArray(x.raw));
 const offset={};
 for(const entry of rawOffsets){
  const lons=new URL(entry.url).searchParams.get('longitude').split(',').map(Number);
  // 国内の保存run。取得座標が全て東側/西側であることを確認して分類。
  const kind=lons.every(x=>x>capture.site.longitude)?'sunrise':lons.every(x=>x<capture.site.longitude)?'sunset':null;
  if(!kind||offset[kind])throw new Error('Cannot identify offset direction');
  offset[kind]=Object.fromEntries(['low','mid','high'].map((k,i)=>[k,entry.raw[i]]));
 }
 const air=entries.find(x=>new URL(x.url).hostname==='air-quality-api.open-meteo.com')?.raw;
 const ens=entries.find(x=>new URL(x.url).hostname==='ensemble-api.open-meteo.com')?.raw;
 let ensemble=null;
 if(ens){const members=[];for(let i=0;i<51;i++){const suffix=i?`_member${String(i).padStart(2,'0')}`:'';const columns={};for(const v of ['cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high','precipitation','temperature_2m','relative_humidity_2m','wind_speed_10m','direct_radiation']){const c=ens.hourly[v+suffix];if(c?.some(x=>x!==null))columns[v]=c;}if(Object.keys(columns).length)members.push({times:ens.hourly.time.map(x=>x*1000),columns});}ensemble={members};}
 const asOf=Date.parse(capture.capturedAt),offsetSeconds=home.raw.utc_offset_seconds;
 const midnight=Math.floor((asOf+offsetSeconds*1000)/86400000)*86400000-offsetSeconds*1000;
 for(const phenomenon of targets)for(let d=1;d<=7;d++)events.push({id:`${capture.site.id}:${phenomenon}:${d}`,phenomenon,inputKind:'forecast',asOf,fetchedAt:asOf,dayMs:midnight+d*86400000,utcOffsetSeconds:offsetSeconds,runtimeUtcOffsetSeconds:32400,place:capture.site,homeRaw:home.raw,sunriseOffsetsRaw:offset.sunrise,sunsetOffsetsRaw:offset.sunset,ensemble,air:air?{times:air.hourly.time.map(x=>x*1000),columns:{aerosol_optical_depth:air.hourly.aerosol_optical_depth,dust:air.hourly.dust}}:null});
}
const report=replay({schemaVersion:1,events},sources);
const byPhenomenon={};for(const p of new Set(events.map(e=>e.phenomenon))){const rows=report.rows.filter(r=>r.phenomenon===p);byPhenomenon[p]={events:rows.length,paired:rows.filter(r=>r.predictions.baseline.score!==null&&r.predictions.candidate.score!==null).length,changedScore:rows.filter(r=>r.predictions.baseline.score!==r.predictions.candidate.score).length,changedConfidence:rows.filter(r=>r.predictions.baseline.confidence?.key!==r.predictions.candidate.confidence?.key).length,newlyUnavailable:rows.filter(r=>r.predictions.baseline.score!==null&&r.predictions.candidate.score===null).length};}
report.captureManifest=manifestPath;report.byPhenomenon=byPhenomenon;
writeFileSync(outputPath,JSON.stringify(report,null,2));
console.log(JSON.stringify({versions:report.versions,comparisons:report.comparisons,byPhenomenon},null,2));
