/* カメラの単時刻観測と現行雲海スコアの参考照合。日全体の的中率ではない。 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const S = createRequire(import.meta.url)('./sorami-core.js');
export const CAMERA_SITE = {
  id: 'chichibu-tabidachi', name: '秩父ミューズパーク 旅立ちの丘',
  latitude: 36.0034909, longitude: 139.0603548, elevation: 370, terrain: 'basinRim',
  coordinateSource: 'https://www.muse-park.com/guide/facility09',
  coordinateMap: 'https://www.google.com/maps/d/kml?mid=1oQwWoUy6MENCSbQSNMIRPv5Hlmc&forcekml=1',
  elevationSource: 'https://api.open-meteo.com/v1/elevation?latitude=36.0034909&longitude=139.0603548',
  elevationNote: '2026-09-06取得のDEM 370m。カメラ取付高は未確認。',
};
const hash = s => createHash('sha256').update(s).digest('hex');
const mean = xs => xs.length ? xs.reduce((a,b) => a+b,0)/xs.length : null;
export function summarize(rows) {
  const usable = rows.filter(r => Number.isFinite(r.score) && r.withinPredictionWindow && r.status === 'confirmed');
  return Object.fromEntries(['none','weak','strong'].map(quality => {
    const selected = usable.filter(r => r.observedQuality === quality);
    return [quality, {count:selected.length, meanScore:mean(selected.map(r=>r.score)),
      minScore:selected.length ? Math.min(...selected.map(r=>r.score)) : null,
      maxScore:selected.length ? Math.max(...selected.map(r=>r.score)) : null}];
  }));
}
export function compareCloudview(input, raw) {
  if (!Array.isArray(input.records) || !raw.hourly?.time) throw new Error('観測台帳または気象応答が不正');
  const windKeys = Object.keys(raw.hourly).filter(k=>k.startsWith('wind_speed_10m'));
  if (!windKeys.length || windKeys.some(k=>raw.hourly_units?.[k] !== 'm/s')) throw new Error('風速はm/sが必要');
  const home=S.decodeLocation(raw), seen=new Set();
  const bundle={home,sunsetOffsets:null,sunriseOffsets:null,air:null,ensemble:null};
  return input.records.map(r=>{
    if(seen.has(r.date)) throw new Error('同日重複を統合してください');
    seen.add(r.date);
    const observedAt=Date.parse(r.cameraTime.replaceAll('/','-').replace(' ','T')+':00+09:00');
    if(!Number.isFinite(observedAt) || r.cameraTime.slice(0,10).replaceAll('/','-')!==r.date) throw new Error('観測日時が不正');
    S.setTimezoneOffset(9*3600);
    const at=Date.parse(r.date+'T12:00:00+09:00');
    const row={date:r.date,observedAt:new Date(observedAt).toISOString(),status:r.status,
      observedQuality:r.observedQuality,reviewReason:r.reviewReason,source:r.source,imageUrl:r.imageUrl,
      externalForecastProbability:r.forecastProbability ?? null,
      externalForecastNote:'他者の秩父雲海予報。絶景予報の点数・観測結果ではない。',
      observationCoverage:'single-frame',forecastIssuedAt:null,
      comparisonMode:'historical-forecast-reconstruction',score:null};
    try {
      const ev=S.evaluate('seaOfClouds',at,bundle,CAMERA_SITE);
      if(!ev || ev.unavailable) throw new Error(ev?.unavailable?.message || '採点不能');
      for(const model of Object.keys(ev.perModel)) {
        for(const variable of ['temperature_2m','wind_speed_10m','relative_humidity_2m','precipitation','cloud_cover']) {
          if(home.byModel[model].mean(variable,...ev.window)===null) throw new Error(`欠測 ${model}/${variable}`);
        }
      }
      return {...row,score:ev.score,rank:ev.rank,rankLabel:S.phrasing('seaOfClouds',ev.rank).label,
        window:ev.window.map(t=>new Date(t).toISOString()),
        withinPredictionWindow:observedAt>=ev.window[0] && observedAt<=ev.window[1],
        models:Object.keys(ev.perModel),perModel:ev.perModel,factors:ev.factors};
    } catch(e) {return {...row,error:e.message,withinPredictionWindow:false};}
  });
}
async function main(){
  const [inputPath,outputPath]=process.argv.slice(2);
  if(!inputPath || !outputPath) throw new Error('入力観測JSON 出力JSON を指定');
  if(existsSync(outputPath)) throw new Error('出力済み。別の出力名を指定');
  const text=readFileSync(inputPath,'utf8'),input=JSON.parse(text);
  const dates=input.records.map(r=>r.date).sort();
  const start=new Date(Date.parse(dates[0]+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  const p=new URLSearchParams({latitude:String(CAMERA_SITE.latitude),longitude:String(CAMERA_SITE.longitude),
    elevation:String(CAMERA_SITE.elevation),start_date:start,end_date:dates.at(-1),
    hourly:[...S.HOME_VARS,...S.PROFILE_VARS].join(','),models:S.MODELS.join(','),
    timezone:'Asia/Tokyo',timeformat:'unixtime',wind_speed_unit:'ms'});
  const url='https://historical-forecast-api.open-meteo.com/v1/forecast?'+p;
  const rawPath=outputPath+'.weather.json';
  let capture;
  if(existsSync(rawPath)) {
    capture=JSON.parse(readFileSync(rawPath,'utf8'));
    if(capture.url!==url) throw new Error('保存済み応答の取得条件が違う');
  } else {
    const res=await fetch(url,{signal:AbortSignal.timeout(60000)});
    const raw=await res.json();
    if(!res.ok || raw.error) throw new Error(raw.reason || `HTTP ${res.status}`);
    capture={url,fetchedAt:new Date().toISOString(),raw};
    writeFileSync(rawPath,JSON.stringify(capture),{flag:'wx'});
  }
  const rows=compareCloudview(input,capture.raw);
  const report={schemaVersion:1,createdAt:new Date().toISOString(),site:CAMERA_SITE,
    coreSha256:hash(readFileSync(new URL('./sorami-core.js',import.meta.url))),
    observationSha256:hash(text),weatherPath:rawPath,weatherSha256:hash(JSON.stringify(capture.raw)),
    requestedModels:S.MODELS,summary:summarize(rows),dailyAccuracy:null,
    limitations:['単時刻画像なので朝全体の不発・見逃し率を確定しない。',
      'weakは雲海の発生と断定しない。濃霧による判別不能は陰性にしない。',
      '予報アーカイブの再計算であり、事前発表時刻を固定した予測ではない。',
      '1地点21日、予備的な目視評価。全現象の精度に一般化しない。'],rows};
  writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({outputPath,summary:report.summary,failed:rows.filter(r=>r.error).length},null,2));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(e=>{console.error(e.message);process.exitCode=1;});
