/* 事後再計算と分けて、取得時点の7現象の予測を上書きせず保存する。 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { VALIDATION_SITES } from './validation-sites.mjs';
import { CAMERA_SITE } from './study-cloudview-accuracy.mjs';
const require=createRequire(import.meta.url), S=require('./sorami-core.js');
require('./spots.js');
const catalog=globalThis.SORAMI_SPOTS.spots;
export const VALIDATION_TARGETS=[
 ...VALIDATION_SITES.map(s=>({...s,targets:s.id==='kasai-rinkai' ? [s.phenomenon,'rainbow'] : [s.phenomenon]})),
 {...CAMERA_SITE,targets:['seaOfClouds']},
 ...['nobeyama','zao-jizo','asahikawa'].map(id=>{
   const s=catalog.find(s=>s.id===id);return {...s,targets:s.phenomena};
 }),
];
export function freezeEvaluations(site,bundle,capturedAt,days=7){
 S.setTimezoneOffset(bundle.utcOffsetSeconds ?? 32400);
 const start=S.Cal.startOfDay(capturedAt),rows=[];
 for(let day=0;day<days;day++) for(const phenomenon of site.targets){
   const evaluation=S.evaluate(phenomenon,start+day*86400000,bundle,site);
   if(!evaluation || evaluation.window[0]<=capturedAt) continue;
   rows.push({siteId:site.id,phenomenon,
     date:new Date(start+day*86400000+32400000).toISOString().slice(0,10),
     predictionCapturedAt:new Date(capturedAt).toISOString(),
     leadHours:(evaluation.window[0]-capturedAt)/3600000,
     forecastIssuedAt:null, // APIのモデル初期時刻ではなく、取得時点を固定する。
     mode:'prospective-snapshot',predictionStatus:evaluation.unavailable ? 'unavailable' : 'scored',
     observationStatus:'pending',observedQuality:null,
     evaluation});
 }
 return rows;
}
async function main(){
 const dir=process.argv[2];if(!dir)throw new Error('未使用の出力ディレクトリを指定');
 mkdirSync(dir); // 既存ディレクトリなら失敗。記録の上書きを防ぐ。
 const coreSha256=createHash('sha256').update(readFileSync(new URL('./sorami-core.js',import.meta.url))).digest('hex');
 const report={schemaVersion:1,startedAt:new Date().toISOString(),coreSha256,
   purpose:'7現象を結果が出る前に保存。精度の検証結果ではなく照合待ち。',sites:[],records:[]};
 const original=globalThis.fetch;
 for(const target of VALIDATION_TARGETS){
   const captures=[];
   globalThis.fetch=async(url,options)=>{
     const res=await original(url,{...options,signal:AbortSignal.timeout(45000)});
     if(String(url).includes('open-meteo.com/')) {
       const raw=await res.clone().json();captures.push({url:String(url),receivedAt:new Date().toISOString(),status:res.status,raw});
     }
     return res;
   };
   const site={...target};
   try{
     if(site.targets.includes('starrySky')) site.lightPollution=await S.LightPollution.lookup(site.latitude,site.longitude);
     const bundle=await S.fetchForecast(site.latitude,site.longitude,8,site);
     const capturedAt=Date.now(),rows=freezeEvaluations(site,bundle,capturedAt);
     report.sites.push({site,status:'captured',capturedAt:new Date(capturedAt).toISOString(),
       air:!!bundle.air,ensemble:!!bundle.ensemble,rawPath:`${site.id}.weather.json`});
     report.records.push(...rows);
     console.log(`${site.name}: ${rows.length}件を事前保存`);
   }catch(e){report.sites.push({site,status:'failed',reason:e.message});console.log(`${site.name}: 取得失敗 ${e.message}`);}
   finally{globalThis.fetch=original;writeFileSync(`${dir}/${site.id}.weather.json`,JSON.stringify(captures),{flag:'wx'});}
   writeFileSync(`${dir}/manifest.json`,JSON.stringify(report,null,2)+'\n');
 }
 report.finishedAt=new Date().toISOString();
 writeFileSync(`${dir}/manifest.json`,JSON.stringify(report,null,2)+'\n');
 console.log(`合計${report.records.length}件。結果の照合は未完了。`);
 if(report.sites.some(s=>s.status==='failed'))process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
