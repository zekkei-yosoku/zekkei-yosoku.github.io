// ネットワークを使わず、保存原応答を各版のdecode/scoreへ独立に通す。
// 実景ラベルがなければ得点差だけを報告し、精度や確率を作らない。
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
const hash=(x)=>createHash('sha256').update(x).digest('hex');
export function replay(manifest, sources) {
  if(manifest.schemaVersion!==1 || !Array.isArray(manifest.events) || !manifest.events.length) throw new Error('schemaVersion:1 と events が必要です');
  const ids=new Set();
  const variants=Object.entries(sources).map(([name,source])=>({name,source,sha256:hash(source)}));
  if(variants.length<2) throw new Error('比較する版を2つ以上指定してください');
  const rows=[];
  for(const event of manifest.events){
    if(!event.id || ids.has(event.id)) throw new Error('event idが空または重複しています');
    ids.add(event.id);
    if(!Number.isFinite(event.asOf) || !Number.isFinite(event.dayMs) || !Number.isFinite(event.utcOffsetSeconds) || !Number.isFinite(event.runtimeUtcOffsetSeconds)) throw new Error('asOf/dayMs/utcOffsetSeconds/runtimeUtcOffsetSecondsを数値で固定してください');
    if(!event.homeRaw || !event.place || !['sunrise','sunset','seaOfClouds','rainbow','starrySky'].includes(event.phenomenon)) throw new Error('現象・地点・保存原応答が必要です');
    if(!['forecast','reanalysis','synthetic'].includes(event.inputKind)) throw new Error('inputKindを明示してください');
    // 予報提供時刻は、後から確定した再解析を事前予測と取り違えないための必須記録。
    if(event.inputKind==='forecast' && (!Number.isFinite(event.fetchedAt) || event.fetchedAt>event.asOf)) throw new Error('asOf以前のfetchedAtが必要です');
    const predictions={};
    for(const {name,source} of variants){
      // 旧版がDate.nowを直接読んでいても再生時刻を固定する。外部API/requireは渡さない。
      class ReplayDate extends Date {
        constructor(...args){super(...(args.length?args:[event.asOf]));}
        static now(){return event.asOf;}
        getTimezoneOffset(){return -event.runtimeUtcOffsetSeconds/60;}
      }
      // 現行/旧coreのepochコンストラクタとlocal gettersを固定する。
      // 地点のCal時差と、旧版が参照する実行環境の時差を別々に保存する。
      for(const suffix of ['FullYear','Month','Date','Day','Hours','Minutes','Seconds','Milliseconds']) {
        ReplayDate.prototype['get'+suffix]=function(){return new Date(this.getTime()+event.runtimeUtcOffsetSeconds*1000)['getUTC'+suffix]();};
      }
      const box={module:{exports:{}},Date:ReplayDate};
      runInNewContext(source,box,{timeout:3000});
      const S=box.module.exports;
      S.setTimezoneOffset(event.utcOffsetSeconds);
      const offsets=(raw)=>raw ? Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,S.decodeLocation(structuredClone(v))])) : null;
      const bundle={home:S.decodeLocation(structuredClone(event.homeRaw)),sunriseOffsets:offsets(event.sunriseOffsetsRaw),sunsetOffsets:offsets(event.sunsetOffsetsRaw),air:event.air?new S.Series(event.air.times,event.air.columns):null};
      // バージョン間で前処理を共有しない。保存済みのENSだけ使い、欠けていれば取り直さない。
      if(event.ensemble) bundle.ensemble={members:event.ensemble.members.map(x=>new S.Series(x.times,x.columns))};
      const evaluation=structuredClone(S.evaluate(event.phenomenon,event.dayMs,bundle,structuredClone(event.place),{asOf:event.asOf}));
      predictions[name]=evaluation ? {score:evaluation.unavailable?null:evaluation.score,unavailable:evaluation.unavailable,window:evaluation.window,perModel:evaluation.perModel,models:evaluation.models,confidence:evaluation.confidence,daysAhead:evaluation.daysAhead,factors:evaluation.factors,uncertainty:evaluation.uncertainty} : {score:null,unavailable:{kind:'noWindow'},models:0};
    }
    rows.push({id:event.id,phenomenon:event.phenomenon,inputKind:event.inputKind,asOf:event.asOf,dayMs:event.dayMs,utcOffsetSeconds:event.utcOffsetSeconds,runtimeUtcOffsetSeconds:event.runtimeUtcOffsetSeconds,inputSha256:hash(JSON.stringify(event)),predictions});
  }
  const reference=variants[0].name;
  const comparisons=Object.fromEntries(variants.slice(1).map(({name})=>{
    let paired=0,changed=0,deltaSum=0,newlyUnavailable=0,newlyAvailable=0;
    for(const row of rows){const a=row.predictions[reference].score,b=row.predictions[name].score;
      if(a!==null&&b!==null){paired++;deltaSum+=b-a;if(Math.abs(b-a)>1e-8)changed++;}
      if(a!==null&&b===null)newlyUnavailable++;
      if(a===null&&b!==null)newlyAvailable++;
    }
    return [name,{reference,events:rows.length,paired,changed,meanScoreDelta:paired?deltaSum/paired:null,newlyUnavailable,newlyAvailable}];
  }));
  return {schemaVersion:1,kind:'offline-score-comparison',accuracyStatus:'not_evaluated',note:'得点差と出力率の比較。実景の的中率・改善率・発生確率ではありません。',versions:Object.fromEntries(variants.map(({name,sha256})=>[name,{sha256}])),comparisons,rows};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [manifestPath,outputPath]=process.argv.slice(2);
  if(!manifestPath||!outputPath)throw new Error('node replay-forecast.mjs manifest.json output.json');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8')),base=dirname(resolve(manifestPath));
  const sources=Object.fromEntries(Object.entries(manifest.sources||{}).map(([name,path])=>[name,readFileSync(resolve(base,path),'utf8')]));
  const report=replay(manifest,sources);
  writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({versions:report.versions,comparisons:report.comparisons,accuracyStatus:report.accuracyStatus},null,2));
}
