/** 富士山専用・研究入力。確率/参考点を作らない。UIから未参照。
 * 気象学的根拠: https://doi.org/10.1002/wea.7774
 * データ契約: https://open-meteo.com/en/docs/gfs-api
 */
export const VERSION='fuji-cap-features-v2';
export const SOURCE='open-meteo:gfs_global';
export const FUJI=Object.freeze({latitude:35.360555,longitude:138.727363,summitM:3776});
export const LEVELS=Object.freeze([850,800,700,600,500,400]);
export const VARIABLES=Object.freeze(LEVELS.flatMap(p=>['geopotential_height','temperature','relative_humidity','wind_speed','wind_direction'].map(v=>`${v}_${p}hPa`)));
const DEG=Math.PI/180, HOUR=3600000;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function destination(lat,lon,bearing,km){
 const d=km/6371.0088,b=bearing*DEG,p=lat*DEG,l=lon*DEG;
 const q=Math.asin(Math.sin(p)*Math.cos(d)+Math.cos(p)*Math.sin(d)*Math.cos(b));
 return {latitude:q/DEG,longitude:(l+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(p),Math.cos(d)-Math.sin(p)*Math.sin(q)))/DEG};
}
export function samplePoints(){
 // GFS気圧面は約25km。細かな地形を解像できるという意味ではない。
 return [{id:'summit',...FUJI},...Array.from({length:8},(_,i)=>({id:`ring-${i*45}`,bearing:i*45,distanceKm:30,...destination(FUJI.latitude,FUJI.longitude,i*45,30)}))];
}
export function buildURL(points=samplePoints(),days=3){
 if(!Number.isInteger(days)||days<1||days>3)throw Error('研究取得は1〜3日です');
 const u=new URL('https://api.open-meteo.com/v1/gfs');
 u.search=new URLSearchParams({latitude:points.map(p=>p.latitude.toFixed(6)).join(','),longitude:points.map(p=>p.longitude.toFixed(6)).join(','),models:'gfs_global',hourly:VARIABLES.join(','),forecast_days:String(days),wind_speed_unit:'ms',temperature_unit:'celsius',timezone:'Asia/Tokyo',timeformat:'unixtime',elevation:points.map(()=> 'nan').join(','),cell_selection:'nearest'});
 return u.toString();
}
export function validateLocation(raw){
 if(!raw||raw.error||!finite(raw.latitude)||!finite(raw.longitude)||!raw.hourly||!raw.hourly_units)throw Error('地点応答が不正です');
 const h=raw.hourly,units=raw.hourly_units;
 if(units.time!=='unixtime'||!Array.isArray(h.time)||!h.time.length)throw Error('時刻の単位が不正です');
 if(h.time.some((t,i)=>!finite(t)||(i>0&&t<=h.time[i-1])))throw Error('時刻は重複なしの昇順が必要です');
 const expected={geopotential_height:'m',temperature:'°C',relative_humidity:'%',wind_speed:'m/s',wind_direction:'°'};
 for(const key of VARIABLES){
  const base=key.replace(/_\d+hPa$/,'');
  if(units[key]!==expected[base]||!Array.isArray(h[key])||h[key].length!==h.time.length)throw Error(`単位または配列不整合: ${key}`);
 }
 return raw;
}
export function profileAt(raw,index){
 return LEVELS.map(p=>{
  const val=k=>raw.hourly[`${k}_${p}hPa`]?.[index];
  const speed=val('wind_speed'),direction=val('wind_direction');
  if(!finite(speed)||speed<0||!finite(direction)||direction<0||direction>360)throw Error('風データが欠測または不正です');
  return {z_m:val('geopotential_height'),pressure_hpa:p,temperature_c:val('temperature'),rh_pct:val('relative_humidity'),u_ms:-speed*Math.sin(direction*DEG),v_ms:-speed*Math.cos(direction*DEG)};
 });
}
export function interpolate(levels,z,key){
 if(z<levels[0].z_m||z>levels.at(-1).z_m)throw Error('山頂高度の外挿は禁止です');
 const exact=levels.find(l=>l.z_m===z);if(exact)return exact[key];
 const i=levels.findIndex(l=>l.z_m>z),a=levels[i-1],b=levels[i];
 return a[key]+(b[key]-a[key])*(z-a.z_m)/(b.z_m-a.z_m);
}
export function physicalFeatures(input,validMs){
 const levels=input.map(l=>({...l})).sort((a,b)=>a.z_m-b.z_m);
 if(levels.length<3||!finite(validMs))throw Error('時刻と3層以上が必要です');
 for(let i=0;i<levels.length;i++){
  const l=levels[i];
  if(!['z_m','pressure_hpa','temperature_c','rh_pct','u_ms','v_ms'].every(k=>finite(l[k])))throw Error('鉛直データが欠測です');
  if(l.pressure_hpa<=0||l.temperature_c<=-100||l.temperature_c>60||l.rh_pct<=0||l.rh_pct>100)throw Error('気象値の範囲が不正です');
  if(i&&(l.z_m<=levels[i-1].z_m||l.pressure_hpa>=levels[i-1].pressure_hpa))throw Error('高度・気圧の順序が不正です');
  l.theta=(l.temperature_c+273.15)*(1000/l.pressure_hpa)**(287.05/1004);
 }
 for(let i=0;i<levels.length;i++){
  const a=levels[Math.max(0,i-1)],b=levels[Math.min(levels.length-1,i+1)];
  let derivative=(b.theta-a.theta)/(b.z_m-a.z_m);
  if(i>0&&i<levels.length-1){
   const h1=levels[i].z_m-a.z_m,h2=b.z_m-levels[i].z_m;
   derivative=-h2/(h1*(h1+h2))*a.theta+(h2-h1)/(h1*h2)*levels[i].theta+h1/(h2*(h1+h2))*b.theta;
  }
  levels[i].n2=9.80665/levels[i].theta*derivative;
 }
 const at=k=>interpolate(levels,FUJI.summitM,k),t=at('temperature_c'),rh=at('rh_pct'),u=at('u_ms'),v=at('v_ms');
 const g=Math.log(rh/100)+17.625*t/(243.04+t),td=243.04*g/(17.625-g);
 const peak=Math.max(...levels.map(l=>l.rh_pct)),peaks=levels.filter(l=>l.rh_pct===peak);
 const direction=Math.hypot(u,v)>1e-8?(Math.atan2(-u,-v)/DEG+360)%360:null;
 const date=new Date(validMs+9*HOUR),month=date.getUTCMonth(),hour=date.getUTCHours();
 const lo=levels.find(l=>l.pressure_hpa===700),hi=levels.find(l=>l.pressure_hpa===500);
 return {rh_summit:rh,temperature_summit_c:t,pressure_summit_hpa:at('pressure_hpa'),
  rh_max:peak,z_rhmax_minus_summit:peaks.length===1?peaks[0].z_m-FUJI.summitM:null,
  moist_peak_ambiguous:peaks.length>1,moist_peak_base_m:Math.min(...peaks.map(l=>l.z_m)),moist_peak_top_m:Math.max(...peaks.map(l=>l.z_m)),dewpoint_depression:t-td,
  wind_u:u,wind_v:v,u_cross:(u+v)/Math.sqrt(2),wind_speed:Math.hypot(u,v),wind_direction_deg:direction,
  wind_direction_sin:direction===null?null:Math.sin(direction*DEG),wind_direction_cos:direction===null?null:Math.cos(direction*DEG),
  n2:at('n2'),vertical_shear_700_500:lo&&hi?Math.hypot(hi.u_ms-lo.u_ms,hi.v_ms-lo.v_ms)/(hi.z_m-lo.z_m):null,
  month_sin:Math.sin(2*Math.PI*month/12),month_cos:Math.cos(2*Math.PI*month/12),
  hour_sin:Math.sin(2*Math.PI*hour/24),hour_cos:Math.cos(2*Math.PI*hour/24)};
}
export function deriveSnapshot(captures,requestedPoints,capturedAtMs){
 if(!finite(capturedAtMs)||captures.length!==requestedPoints.length)throw Error('取得時刻または地点数の不整合です');
 captures.forEach(validateLocation);
 const center=captures[0],rows=[];
 const gridKeys=captures.map(x=>`${x.latitude},${x.longitude}`);
 for(let i=0;i<center.hourly.time.length;i++){
  const validMs=center.hourly.time[i]*1000;
  if(validMs<=capturedAtMs)continue; // 当日0時から返る事後値を事前予報へ混ぜない。
  let local=null,upwind=null,status='ready',reason=null,index=null;
  try{
   local=physicalFeatures(profileAt(center,i),validMs);
   if(local.wind_direction_deg===null)throw Error('静穏のため風上方向を定義できません');
   index=1+Math.round(local.wind_direction_deg/45)%8;
   const windward=captures[index];
   if(!windward)throw Error('風上の地点がありません');
   const j=windward.hourly.time.indexOf(validMs/1000);
   if(j<0)throw Error('風上と山頂の時刻が一致しません');
   upwind=physicalFeatures(profileAt(windward,j),validMs);
   if(gridKeys[0]===gridKeys[index])throw Error('風上が山頂と同じ格子です');
   // RHが飽和して平坦でも有効な大気状態。極大高度だけ欠測＋指示変数で学習する。
  }catch(e){status='unavailable';reason=e.message;}
  rows.push({validAt:new Date(validMs).toISOString(),snapshotLeadHours:(validMs-capturedAtMs)/HOUR,
   forecastIssuedAt:null,forecastLeadHours:null,referenceKind:'prospective-snapshot',status,reason,
   featureWarnings:upwind?.moist_peak_ambiguous?['moist_peak_is_interval']:[],summit:local,upwind,upwindPoint:index===null?null:requestedPoints[index],
   upwindGrid:index===null?null:{latitude:captures[index]?.latitude,longitude:captures[index]?.longitude},
   probability:null,confidence:'UNAVAILABLE'});
 }
 return {schemaVersion:1,featureVersion:VERSION,source:SOURCE,capturedAt:new Date(capturedAtMs).toISOString(),
  modelIssuedAt:null,modelNativeVersion:null,modelVersionStatus:'provider_does_not_expose_native_version',
  resolutionKm:25,gridKeys,uniqueGridCount:new Set(gridKeys).size,
  spatialMethod:'30km-eight-sector-upwind-proxy',mode:'shadow',uiEnabled:false,rows};
}
export async function captureForecast({fetchImpl=fetch,now=()=>Date.now(),days=3,onResponse=async()=>{}}={}){
 const points=samplePoints(),url=buildURL(points,days);
 const startedAt=now();
 const r=await fetchImpl(url,{signal:AbortSignal.timeout(30000)});
 const body=await r.text(),receivedAt=now();
 await onResponse({body,status:r.status,retryAfter:r.headers?.get('retry-after')??null,
   request:{url,startedAt:new Date(startedAt).toISOString(),receivedAt:new Date(receivedAt).toISOString(),points}});
 if(!r.ok)throw Error(`気象取得失敗 HTTP ${r.status}（自動再試行なし）`);
 const raw=JSON.parse(body);
 if(!Array.isArray(raw)||raw.length!==points.length)throw Error('9地点の応答が必要です');
 const snapshot=deriveSnapshot(raw,points,receivedAt);
 if(!snapshot.rows.some(r=>r.status==='ready'))throw Error('利用可能な未来の気象特徴量がありません');
 return {request:{url,startedAt:new Date(startedAt).toISOString(),receivedAt:new Date(receivedAt).toISOString(),points},raw,snapshot};
}
