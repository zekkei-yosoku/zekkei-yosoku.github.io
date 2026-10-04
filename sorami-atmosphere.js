/* Optical astronomical refraction. Local station pressure, not sea-level pressure.
 * Sæmundsson / Meeus Ch.16; weather: Open-Meteo hourly surface_pressure/temperature_2m.
 * Not a reconstruction of atmospheric inversions or terrestrial ray paths. */
(function(global){
  'use strict';
  const A=global.SoramiAstro||(typeof require==='function'?require('./sorami-astro.js'):null);
  let mode='standard',manual={pressureHPa:1010,temperatureC:10},enabled=false;
  const records=new Map(),pending=new Map(),HOUR=3600000,DAY=86400000;
  const valid=(p,t)=>Number.isFinite(p)&&p>=200&&p<=1100&&Number.isFinite(t)&&t>=-80&&t<=60;
  function configure(next,values=manual){
    if(!['auto','manual','standard','none'].includes(next))throw new RangeError('大気差のモードが不正です');
    if(next==='manual'&&!valid(values.pressureHPa,values.temperatureC))throw new RangeError('現地気圧・気温を確認してください');
    mode=next;manual={...values};enabled=true;
  }
  function correction(h,air={pressureHPa:1010,temperatureC:10}){
    if(!Number.isFinite(h))throw new RangeError('高度が不正です');
    if(air.none||h<=-2||h>=90)return 0;
    if(!Number.isFinite(h)||!valid(air.pressureHPa,air.temperatureC))throw new RangeError('大気差の入力が不正です');
    // Formula is reliable only above about -1 degree. A continuous below-horizon
    // continuation keeps sampling stable; it is never presented as accurate refraction.
    return Math.max(0,A.refraction(Math.max(-1,h),air))*Math.min(1,h+2);
  }
  function unrefract(apparent,air){
    let lo=-2,hi=90;
    if(!Number.isFinite(apparent)||apparent<lo||apparent>hi)throw new RangeError('高度の範囲が不正です');
    for(let i=0;i<55;i++){const mid=(lo+hi)/2;if(mid+correction(mid,air)<apparent)lo=mid;else hi=mid;}
    return (lo+hi)/2;
  }
  const dayOf=ms=>new Date(ms+9*HOUR).toISOString().slice(0,10);
  const keyOf=(o,ms)=>`${o.latitude.toFixed(5)},${o.longitude.toFixed(5)},${Math.round(o.elevation??0)}|${dayOf(ms)}`;
  function endpoint(o,ms,now=Date.now()){
    if(!Number.isFinite(ms)||!Number.isFinite(o.latitude)||Math.abs(o.latitude)>90||!Number.isFinite(o.longitude)||Math.abs(o.longitude)>180)return null;
    const day=dayOf(ms),today=Date.parse(dayOf(now)+'T00:00:00+09:00'),date=Date.parse(day+'T00:00:00+09:00'),delta=(date-today)/DAY;
    if(delta>14||day<'2022-01-01')return null;
    const start=new Date(date-DAY+9*HOUR).toISOString().slice(0,10),end=new Date(date+DAY+9*HOUR).toISOString().slice(0,10);
    const historical=delta<-4;
    const rangeStart=historical?start:new Date(today-5*DAY+9*HOUR).toISOString().slice(0,10),rangeEnd=historical?end:new Date(today+15*DAY+9*HOUR).toISOString().slice(0,10);
    const p=new URLSearchParams({latitude:String(o.latitude),longitude:String(o.longitude),elevation:String(o.elevation??0),hourly:'temperature_2m,surface_pressure',start_date:rangeStart,end_date:rangeEnd,timezone:'UTC',timeformat:'unixtime'});
    return {url:`https://${historical?'historical-forecast-api':'api'}.open-meteo.com/v1/forecast?${p}`,source:historical?'過去の気象モデル':'気象予報',historical};
  }
  function parse(raw,o,source){
    const h=raw?.hourly;
    if(!h||!Array.isArray(h.time)||!Array.isArray(h.surface_pressure)||!Array.isArray(h.temperature_2m))throw Error('気象データがありません');
    if(raw.hourly_units?.surface_pressure!=='hPa'||raw.hourly_units?.temperature_2m!=='°C')throw Error('気象データの単位が不正です');
    if(h.time.length!==h.surface_pressure.length||h.time.length!==h.temperature_2m.length)throw Error('気象データの長さが不正です');
    const rows=h.time.map((t,i)=>({at:typeof t==='number'?t*1000:Date.parse(t+'Z'),pressureHPa:h.surface_pressure[i],temperatureC:h.temperature_2m[i]}));
    if(rows.some((r,i)=>!Number.isFinite(r.at)||(i&&r.at<=rows[i-1].at)))throw Error('気象時刻が不正です');
    if(!rows.some(r=>valid(r.pressureHPa,r.temperatureC)))throw Error('現地気圧・気温がありません');
    return {observer:{...o},source,rows,loadedAt:Date.now()};
  }
  async function load(o,ms,{fetcher=global.fetch,now=Date.now()}={}){
    const key=keyOf(o,ms),old=records.get(key);
    if(old&&now-old.loadedAt<(old.error?60000:HOUR))return old;
    if(pending.has(key))return pending.get(key);
    for(const r of records.values())if(r.rows&&now-r.loadedAt<HOUR&&r.observer.latitude===o.latitude&&r.observer.longitude===o.longitude&&r.observer.elevation===o.elevation&&sample(r,ms,o)&&sample(r,ms+DAY,o))return r;
    const ep=endpoint(o,ms,now);
    if(!ep){const out={error:'予報期間外',loadedAt:now};records.set(key,out);return out;}
    const task=(async()=>{
      const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),8000);
      try{const response=await fetcher(ep.url,{signal:ctl.signal});if(!response.ok)throw Error('気象取得失敗');const out=parse(await response.json(),o,ep.source);records.set(key,out);return out;}
      catch{const out={error:'気象取得不可',loadedAt:now};records.set(key,out);return out;}
      finally{clearTimeout(timer);pending.delete(key);while(records.size>24)records.delete(records.keys().next().value);}
    })();pending.set(key,task);return task;
  }
  function sample(record,ms,o){
    if(!record?.rows)return null;
    const point=record.observer,dy=(o.latitude-point.latitude)*111.2,dx=(o.longitude-point.longitude)*111.2*Math.cos(point.latitude*Math.PI/180);
    if(Math.hypot(dx,dy)>2)return null;
    const dz=(o.elevation??0)-(point.elevation??0);if(Math.abs(dz)>250)return null;
    const rows=record.rows;let i=rows.findIndex(r=>r.at>=ms);if(i<0)return null;
    let p,t;if(rows[i].at===ms){p=rows[i].pressureHPa;t=rows[i].temperatureC;}
    else{if(!i)return null;const a=rows[i-1],b=rows[i];if(b.at-a.at>HOUR*1.01||!valid(a.pressureHPa,a.temperatureC)||!valid(b.pressureHPa,b.temperatureC))return null;const f=(ms-a.at)/(b.at-a.at);p=a.pressureHPa+(b.pressureHPa-a.pressureHPa)*f;t=a.temperatureC+(b.temperatureC-a.temperatureC)*f;}
    if(!valid(p,t))return null;
    // Same small weather cell: adjust station pressure to the actual eye height.
    p*=Math.exp(-9.80665*dz/(287.05*(t+273.15)));
    return valid(p,t)?{pressureHPa:p,temperatureC:t,source:record.source,at:ms}:null;
  }
  function at(ms,o){
    if(mode==='none')return {none:true,pressureHPa:0,temperatureC:10,source:'なし'};
    if(mode==='manual')return {...manual,source:'手入力'};
    if(mode==='auto'){
      for(const r of [...records.values()].reverse()){const value=Date.now()-r.loadedAt<HOUR?sample(r,ms,o):null;if(value)return value;}
      const z=Math.max(-500,Math.min(10000,o.elevation??0)),temperatureC=15-.0065*z;
      return {pressureHPa:1013.25*Math.pow((temperatureC+273.15)/288.15,9.80665/(287.05*.0065)),temperatureC,source:'標準大気（標高補正・気象なし）',fallback:true};
    }
    return {pressureHPa:1010,temperatureC:10,source:'標準条件'};
  }
  function apply(state,ms,o){
    if(!enabled)return state;
    const air=at(ms,o),h=state.geometricAltitude??state.altitude,r=state.angularRadius;
    const apparent=h+correction(h,air),upper=h+r+correction(h+r,air),lower=h-r+correction(h-r,air);
    return {...state,apparentAltitude:apparent,refraction:apparent-h,upperAltitude:upper,lowerAltitude:lower,
      upperRadius:upper-apparent,lowerRadius:apparent-lower,atmosphere:air,lowAltitude:h<2};
  }
  const limbAltitude=(s,sign)=>sign===1?(s.lowerAltitude??s.apparentAltitude-s.angularRadius):sign===-1?(s.upperAltitude??s.apparentAltitude+s.angularRadius):s.apparentAltitude;
  global.SoramiAtmosphere={configure,correction,unrefract,load,parse,sample,at,apply,limbAltitude,endpoint,mode:()=>mode,enabled:()=>enabled,targetK:()=>enabled&&mode==='none'?1:7/6};
  if(typeof module!=='undefined'&&module.exports)module.exports=global.SoramiAtmosphere;
})(typeof window!=='undefined'?window:globalThis);
