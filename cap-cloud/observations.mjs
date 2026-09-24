import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const LABELS=['CAP_SUMMIT_COVERING','CAP_DETACHED','NO_CAP','TSURUSHI','HATA','OTHER_CLOUD','MOUNTAIN_OBSCURED','UNKNOWN'];
const iso=s=>typeof s==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s));
export function validateObservation(o){
 for(const k of ['observationId','eventId','weatherEpisodeId','cameraEra'])if(typeof o[k]!=='string'||!o[k].trim())throw Error(`必須: ${k}`);
 if(!['human','ai'].includes(o.reviewMethod))throw Error('確認方法human/aiが必要です');
 if(o.reviewMethod==='ai'&&o.quality!=='UNKNOWN')throw Error('AI仮判定は人手確認までUNKNOWNです');
 if(!LABELS.includes(o.label)||!['GOLD','SILVER','BRONZE','UNKNOWN'].includes(o.quality))throw Error('ラベル・品質が不正です');
 for(const k of ['validFrom','validTo','reviewedAt'])if(!iso(o[k]))throw Error(`タイムゾーン付き時刻が必要: ${k}`);
 if(Date.parse(o.validFrom)>Date.parse(o.validTo)||Date.parse(o.reviewedAt)<Date.parse(o.validTo))throw Error('観測・レビュー時刻の順序が不正です');
 if(!Array.isArray(o.cameraIds)||!o.cameraIds.length||new Set(o.cameraIds).size!==o.cameraIds.length||!o.cameraIds.every(x=>typeof x==='string'&&x))throw Error('カメラIDが不正です');
 if(!Array.isArray(o.reviewerIds)||!o.reviewerIds.length)throw Error('人手確認者が必要です');
 if(!Array.isArray(o.evidence)||!o.evidence.length||o.evidence.some(e=>typeof e.uri!=='string'||!/^[a-f0-9]{64}$/.test(e.sha256)))throw Error('証拠の場所とSHA256が必要です');
 if(![true,false,null].includes(o.capPresent)||![true,false,null].includes(o.daylight))throw Error('有無と昼夜の三値が必要です');
 if(['MOUNTAIN_OBSCURED','UNKNOWN'].includes(o.label)&&o.capPresent!==null)throw Error('不可視・不明を陰性化できません');
 if(o.label.startsWith('CAP_')&&o.capPresent!==true)throw Error('笠雲ラベルと有無が不整合です');
 if(o.label==='NO_CAP'&&o.capPresent!==false)throw Error('陰性ラベルと有無が不整合です');
 // 吊るし雲は笠雲と併存する。TSURUSHIという文字からcap=falseを推測しない。
 if(o.quality==='GOLD'&&o.capPresent!==null){
  if(o.cameraIds.length<2||!(o.maxFrameGapSeconds>0&&o.maxFrameGapSeconds<=60))throw Error('GOLDには複数方向と高頻度の証拠が必要です');
  if((Date.parse(o.validTo)-Date.parse(o.validFrom))/60000<=5)throw Error('GOLDには5分超の連続観測区間が必要です');
 }
 return o;
}
export function joinObservations(snapshot,observations){
 if(snapshot.mode!=='shadow'||snapshot.schemaVersion!==1||!iso(snapshot.capturedAt))throw Error('取得時点を固定したshadow予報が必要です');
 const seen=new Set();for(const o of observations){if(o.synthetic===true)throw Error('合成の観測例は実予報と照合できません');validateObservation(o);if(seen.has(o.observationId))throw Error('観測ID重複');seen.add(o.observationId);}
 const coverage={predictions:snapshot.rows.length,matched:0,unknown:0,unmatched:0,conflict:0,featureUnavailable:0};
 const rows=[];
 for(const r of snapshot.rows){
  if(!iso(r.validAt)||Date.parse(r.validAt)<=Date.parse(snapshot.capturedAt))throw Error('事後値が予報へ混入しています');
  if(r.status!=='ready'){coverage.featureUnavailable++;continue;}
  const candidates=observations.filter(o=>Date.parse(o.validFrom)<=Date.parse(r.validAt)&&Date.parse(r.validAt)<=Date.parse(o.validTo));
  if(!candidates.length){coverage.unmatched++;continue;}
  if(candidates.length>1){coverage.conflict++;continue;} // 競合を都合よく選ばない。統合レビューを要求。
  const o=candidates[0];coverage.matched++;
  if(o.capPresent===null||o.daylight!==true||o.quality==='UNKNOWN'){coverage.unknown++;continue;}
  rows.push({sample_id:r.predictionId,event_id:o.eventId,weather_episode_id:o.weatherEpisodeId,
   valid_at:r.validAt,issued_at:null,available_at:snapshot.capturedAt,prediction_captured_at:snapshot.capturedAt,
   forecast_reference_kind:'snapshot',data_kind:'forecast',model_source:snapshot.source,
   met_dataset_version:snapshot.featureVersion+':provider-native-version-unknown',
   model_native_version:null,camera_era:o.cameraEra,label:o.capPresent?(o.label.startsWith('CAP_')?o.label:'CAP'):'NO_CAP',
   original_label:o.label,cap_present:o.capPresent,quality:o.quality,daylight:o.daylight,
   label_source:o.reviewMethod==='human'?'human_reviewed':'ai_reviewed',duration_minutes:(Date.parse(o.validTo)-Date.parse(o.validFrom))/60000,
   max_frame_gap_seconds:o.maxFrameGapSeconds,camera_count:o.cameraIds.length,
   label_reviewed_at:o.reviewedAt,synthetic:false,features:r.upwind,
   provenance:{observationId:o.observationId,rawSha256:snapshot.rawSha256,sourceSha256:snapshot.sourceSha256,evidence:o.evidence}});
 }
 return {schemaVersion:1,accuracyStatus:'not_evaluated',target:'cap_presence_when_observable',coverage,rows};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [snapshotPath,observationsPath,output]=process.argv.slice(2);
 try{
  if(!output)throw Error('snapshot.json 観測.json 未使用の出力.json を指定してください');
  const s=await readFile(snapshotPath,'utf8'),o=await readFile(observationsPath,'utf8');
  const result=joinObservations(JSON.parse(s),JSON.parse(o));
  result.inputHashes={snapshot:createHash('sha256').update(s).digest('hex'),observations:createHash('sha256').update(o).digest('hex')};
  await writeFile(output,JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify({status:'prepared',coverage:result.coverage,trainingRows:result.rows.length,accuracyStatus:result.accuracyStatus},null,2));
 }catch(e){console.error('照合できません: '+e.message);process.exitCode=2;}
}
