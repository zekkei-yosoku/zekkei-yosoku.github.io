import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {captureForecast,VERSION} from './atmosphere.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
export async function collect(root,{capture=captureForecast,now=()=>Date.now()}={}){
 const base=resolve(root);await mkdir(base,{recursive:true});
 const runId=new Date(now()).toISOString().replace(/[:.]/g,'-')+'-'+process.pid;
 const dir=join(base,runId);await mkdir(dir); // 同名上書きを拒否
 const report={schemaVersion:1,runId,status:'running',startedAt:new Date(now()).toISOString(),uiEnabled:false};
 try{
  const result=await capture({onResponse:async response=>{
   await writeFile(join(dir,'response.txt'),response.body,{flag:'wx'});
   await writeFile(join(dir,'response-meta.json'),JSON.stringify({status:response.status,retryAfter:response.retryAfter,request:response.request},null,2),{flag:'wx'});
  }});
  const raw=JSON.stringify(result.raw),source=await readFile(new URL('./atmosphere.mjs',import.meta.url));
  await writeFile(join(dir,'raw.json'),raw,{flag:'wx'});
  await writeFile(join(dir,'request.json'),JSON.stringify(result.request,null,2),{flag:'wx'});
  const records=result.snapshot.rows.map((r,i)=>({...r,predictionId:`${runId}:${i}`}));
  const snapshot={...result.snapshot,runId,rawSha256:hash(raw),sourceSha256:hash(source),rows:records};
  await writeFile(join(dir,'snapshot.json'),JSON.stringify(snapshot,null,2),{flag:'wx'});
  Object.assign(report,{status:records.some(r=>r.status!=='ready')?'partial':'success',
   rawSha256:hash(raw),snapshotSha256:hash(JSON.stringify(snapshot,null,2)),sourceSha256:hash(source),featureVersion:VERSION,
   validRows:records.filter(r=>r.status==='ready').length,unavailableRows:records.filter(r=>r.status!=='ready').length,
   capturedAt:snapshot.capturedAt,forecastIssuedAt:null,forecastLeadHours:null,
   snapshotLeadRange:records.length?[records[0].snapshotLeadHours,records.at(-1).snapshotLeadHours]:null});
 }catch(e){report.status='failed';report.reason=e.message;}
 report.finishedAt=new Date(now()).toISOString();
 await writeFile(join(dir,'manifest.json'),JSON.stringify(report,null,2),{flag:'wx'});
 return {...report,directory:dir};
}
export async function health(root,{now=Date.now(),maxAgeHours=9}={}){
 const manifests=[],unreadableRuns=[];
 for(const entry of await readdir(root,{withFileTypes:true}))if(entry.isDirectory()){
  try{manifests.push({...JSON.parse(await readFile(join(root,entry.name,'manifest.json'),'utf8')),directory:join(root,entry.name)});}catch{unreadableRuns.push(entry.name);}
 }
 manifests.sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt));
 const last=manifests[0],lastGood=manifests.find(x=>x.status==='success'||x.status==='partial');
 const age=lastGood?(now-Date.parse(lastGood.capturedAt))/3600000:null;
 const integrity=[];
 if(lastGood){
  for(const [name,key] of [['raw.json','rawSha256'],['snapshot.json','snapshotSha256']]){
   try{if(hash(await readFile(join(lastGood.directory,name)))!==lastGood[key])integrity.push(name);}catch{integrity.push(name);}
  }
 }
 return {status:!lastGood||!Number.isFinite(age)||age<0||age>maxAgeHours||integrity.length||unreadableRuns.length?'attention':last?.status==='failed'||lastGood.status==='partial'?'warning':'healthy',
  lastRun:last?.status??'none',lastSuccessfulAt:lastGood?.capturedAt??null,ageHours:age,integrityErrors:integrity,unreadableRuns,uiEnabled:false,
  nextAction:unreadableRuns.length?'未完了または壊れた収集記録を確認する':!lastGood?'予報収集を実行する':integrity.length?'保存ファイルの変更・破損を調べる':age>maxAgeHours?'収集処理の停止を確認する':last?.status==='failed'?'直近の取得失敗を確認する':'観測結果を照合する'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [command,root]=process.argv.slice(2);
 if(!root||!['capture','health'].includes(command)){console.error('使い方: node cap-cloud/collect.mjs capture|health 保存ディレクトリ');process.exitCode=2;}
 else try{
  const result=command==='capture'?await collect(root):await health(root);
  console.log(JSON.stringify(result,null,2));
  if(['failed','attention'].includes(result.status))process.exitCode=1;
 }catch(e){console.error('処理できません: '+e.message);process.exitCode=1;}
}
