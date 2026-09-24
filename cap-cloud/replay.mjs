/** 保存予報の入力・取得時刻を固定し、新しい特徴量コードで再計算する。事前予報を上書きしない。 */
import{readFile,writeFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import{join}from'node:path';
import{deriveSnapshot}from'./atmosphere.mjs';
const [directory,output]=process.argv.slice(2);
try{
 if(!output)throw Error('保存runディレクトリと未使用の出力名が必要です');
 const rawText=await readFile(join(directory,'raw.json'),'utf8'),request=JSON.parse(await readFile(join(directory,'request.json'),'utf8'));
 const parent=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
 const hash=createHash('sha256').update(rawText).digest('hex');
 if(hash!==parent.rawSha256)throw Error('原応答のhashが一致しません');
 const result=deriveSnapshot(JSON.parse(rawText),request.points,Date.parse(request.receivedAt));
 result.runId=parent.runId;result.rawSha256=hash;
 result.sourceSha256=createHash('sha256').update(await readFile(new URL('./atmosphere.mjs',import.meta.url))).digest('hex');
 result.derivation='replayed_features_not_new_forecast';
 result.rows=result.rows.map((r,i)=>({...r,predictionId:`${parent.runId}:${i}`}));
 await writeFile(output,JSON.stringify(result,null,2),{flag:'wx'});
 console.log(JSON.stringify({status:'replayed',rows:result.rows.length,ready:result.rows.filter(x=>x.status==='ready').length,warnings:result.rows.filter(x=>x.featureWarnings.length).length,featureVersion:result.featureVersion,forecastIssuedAt:null},null,2));
}catch(e){console.error('再計算できません: '+e.message);process.exitCode=2;}
