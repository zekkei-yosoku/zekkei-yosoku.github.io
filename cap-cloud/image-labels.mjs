/** 単画像の仮ラベルと事前保存予報の照合可否。精度指標や学習ラベルを捏造しない。 */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const time=s=>typeof s==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s));
export function compareImages(snapshot,dataset,asOf){
 if(!time(asOf)||!time(snapshot.capturedAt)||Date.parse(snapshot.capturedAt)>Date.parse(asOf))throw Error('照合基準時刻が不正です');
 if(dataset.synthetic!==false||dataset.purpose!=='provisional_image_labels_not_ground_truth')throw Error('実画像の仮ラベル集合が必要です');
 const ids=new Set();
 for(const r of dataset.rows){
  if(ids.has(r.imageId))throw Error('画像ID重複');ids.add(r.imageId);
  if(!time(r.nominalAt)||!['ai','human'].includes(r.reviewMethod)||!time(r.reviewedAt))throw Error('ラベルの時刻・確認方法が不正です');
  if(Date.parse(r.nominalAt)>Date.parse(r.reviewedAt)||Date.parse(r.reviewedAt)>Date.parse(asOf))throw Error('未到来の観測・レビューです');
  if(!['NO_VISIBLE_CAP','VISIBLE_CAP','UNKNOWN','MOUNTAIN_OBSCURED'].includes(r.label))throw Error('画像ラベルが不正です');
  if(r.reviewMethod==='ai'&&r.humanVerified!==false)throw Error('AI判定を人手確認済みにできません');
  if(r.capPresent!==null||dataset.trainingEligible!==false)throw Error('単画像から発生の正解へ昇格できません');
 }
 const elapsed=snapshot.rows.filter(r=>Date.parse(r.validAt)<=Date.parse(asOf));
 const times=new Set(snapshot.rows.map(r=>Date.parse(r.validAt)));
 const overlap=dataset.rows.filter(r=>times.has(Date.parse(r.nominalAt)));
 return {schemaVersion:1,status:'not_evaluable',asOf,forecastCapturedAt:snapshot.capturedAt,
  imageCount:dataset.rows.length,aiReviewed:dataset.rows.filter(r=>r.reviewMethod==='ai').length,humanReviewed:dataset.rows.filter(r=>r.reviewMethod==='human'&&r.humanVerified===true).length,
  absentCandidates:dataset.rows.filter(r=>r.label==='NO_VISIBLE_CAP').length,presentCandidates:dataset.rows.filter(r=>r.label==='VISIBLE_CAP').length,
  unknownOrObscured:dataset.rows.filter(r=>['UNKNOWN','MOUNTAIN_OBSCURED'].includes(r.label)).length,
  forecastRows:snapshot.rows.length,elapsedForecastRows:elapsed.length,pendingForecastRows:snapshot.rows.length-elapsed.length,
  nominalTimeOverlap:overlap.length,exactTimeOverlap:overlap.filter(r=>r.timePrecision==='exact'&&r.exactCapturedAt===r.nominalAt).length,
  verifiedGroundTruthPairs:0,accuracy:null,brier:null,
  reasons:[...(!overlap.length?['画像時刻と保存予報の対象時刻が重ならない']:[]),'単一画角の仮ラベルは笠雲発生の確定正解ではない','公称の毎時頃という時刻を正確な撮影時刻と扱わない','保存済みデータは気象特徴量のみで、評価する確率予測がまだない'],
  nextAction:'未来の対象時刻が過ぎてから対応画像を確認し、正確な時刻・複数方向・人手監査を整備する',uiEnabled:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [snapshotPath,labelsPath,output,asOf=new Date().toISOString()]=process.argv.slice(2);
  if(!output)throw Error('予報.json 仮ラベル.json 未使用の出力.json [照合時刻] を指定してください');
  const raw=await readFile(snapshotPath,'utf8'),labels=await readFile(labelsPath,'utf8'),d=JSON.parse(labels);
  for(const r of d.rows){const bytes=await readFile(resolve(dirname(labelsPath),r.evidence.uri));if(createHash('sha256').update(bytes).digest('hex')!==r.evidence.sha256)throw Error('証拠画像のハッシュ不一致: '+r.imageId);}
  const result=compareImages(JSON.parse(raw),d,asOf);
  result.inputHashes={snapshot:createHash('sha256').update(raw).digest('hex'),labels:createHash('sha256').update(labels).digest('hex')};
  await writeFile(output,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result,null,2));
 }catch(e){console.error('照合不能: '+e.message);process.exitCode=2;}
}
