/* Optical astronomical refraction. Local station pressure, not sea-level pressure.
 * Sæmundsson / Meeus Ch.16; weather: Open-Meteo hourly surface_pressure/temperature_2m.
 * 気象予報モードで目標が決まっているときは、観測点→目標→その先の視線上の気温の柱（地上2m＋気圧面、2026-10-05）で
 * 光線追跡し、天体と目標を同じ大気で解く（sorami-refraction.js）。柱が無い時刻・地点・方角は従来の式に戻る。 */
(function(global){
  'use strict';
  const A=global.SoramiAstro||(typeof require==='function'?require('./sorami-astro.js'):null);
  const RF=global.SoramiRefraction||(typeof require==='function'?require('./sorami-refraction.js'):null);
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
    // Open-Meteo accepts end_date up to UTC today+15. From 00:00 to 09:00 JST the JST date is one day ahead of UTC,
    // so JST today+15 was rejected with HTTP 400 and every forecast-mode request fell back to the standard atmosphere.
    // JST today+14 never exceeds that limit and still covers the whole JST day of the latest selectable date (+14).
    const rangeStart=historical?start:new Date(today-5*DAY+9*HOUR).toISOString().slice(0,10),rangeEnd=historical?end:new Date(today+14*DAY+9*HOUR).toISOString().slice(0,10);
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
  async function load(o,ms,{fetcher=global.fetch,now=Date.now(),target=null}={}){
    if(validTarget(target)){const [out]=await Promise.all([load(o,ms,{fetcher,now}),loadLine(o,target,ms,{fetcher,now})]);return out;}
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
  // ---- 視線上の気温の柱（気象予報モード）
  // 館野の高層観測との比較（2026-01〜10、535回）で、天体の式＋目標の係数の組み合わせは目標に重なる高さが0.3〜1.2′ずれ、
  // 柱で天体と目標を同じ大気で追うと0.02〜0.2′。視線の先の柱は観測点の柱だけの場合より0.1〜0.2′効く（study-refraction*.mjs）。
  // 400hPaより上は標準大気の形で足りる（館野で差0.01′、最大0.1′）。地上2mより下（海面・放射冷却）は一様とみなす。
  const LEVELS=[1000,975,950,925,900,850,800,700,600,500],BEYOND_KM=[10,25,50,100,200],RG=287.05/9.80665,EARTH_KM=6371.0088;
  const lines=new Map(),linePending=new Map(),R=Math.PI/180;
  function geo(o,t){
    const p1=o.latitude*R,p2=t.latitude*R,dl=(t.longitude-o.longitude)*R;
    const a=Math.sin((p2-p1)/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return {distanceKm:2*EARTH_KM*Math.asin(Math.min(1,Math.sqrt(a))),azimuth:(Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl))/R+360)%360};
  }
  function dest(o,az,km){
    const d=km/EARTH_KM,b=az*R,p1=o.latitude*R,l1=o.longitude*R;
    const p2=Math.asin(Math.sin(p1)*Math.cos(d)+Math.cos(p1)*Math.sin(d)*Math.cos(b));
    return {latitude:p2/R,longitude:(l1+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(p1),Math.cos(d)-Math.sin(p1)*Math.sin(p2)))/R};
  }
  const validTarget=t=>t&&Number.isFinite(t.latitude)&&Number.isFinite(t.longitude)&&Number.isFinite(t.topM);
  function lineEndpoint(o,t,ms,now=Date.now()){
    const base=endpoint(o,ms,now);
    if(!base||!validTarget(t))return null;
    const {distanceKm,azimuth}=geo(o,t);
    if(!(distanceKm>=0.2&&distanceKm<=600))return null;
    const ss=[...new Set([0,distanceKm>20?distanceKm/2:null,distanceKm,...BEYOND_KM.map(b=>distanceKm+b)].filter(x=>x!=null).map(x=>Math.round(x*1000)/1000))].sort((a,b)=>a-b);
    const pts=ss.map(s=>s?dest(o,azimuth,s):{latitude:o.latitude,longitude:o.longitude});
    const u=new URL(base.url),p=u.searchParams;
    p.set('latitude',pts.map(x=>x.latitude.toFixed(4)).join(','));p.set('longitude',pts.map(x=>x.longitude.toFixed(4)).join(','));
    p.delete('elevation');p.set('hourly',['temperature_2m','surface_pressure',...LEVELS.map(l=>`temperature_${l}hPa`)].join(','));
    return {url:u.toString(),source:base.source,ss,distanceKm,azimuth};
  }
  function parseLine(raw,o,t,ep){
    const W=Array.isArray(raw)?raw:[raw];
    if(W.length!==ep.ss.length)throw Error('視線上の気象の地点数が不正です');
    for(const w of W){
      const h=w?.hourly,u=w?.hourly_units;
      if(!h||!Array.isArray(h.time)||u?.temperature_2m!=='°C'||u?.surface_pressure!=='hPa'||LEVELS.some(l=>u?.[`temperature_${l}hPa`]!=='°C'))throw Error('視線上の気象データが不正です');
      if(h.time.length!==W[0].hourly.time.length||h.time.some((x,i)=>x!==W[0].hourly.time[i]))throw Error('視線上の気象の時刻が揃っていません');
    }
    const times=W[0].hourly.time.map(x=>typeof x==='number'?x*1000:Date.parse(x+'Z'));
    if(times.some((x,i)=>!Number.isFinite(x)||(i&&x<=times[i-1])))throw Error('視線上の気象の時刻が不正です');
    return {observer:{...o},target:{...t},distanceKm:ep.distanceKm,azimuth:ep.azimuth,ss:ep.ss,grounds:W.map(w=>Number.isFinite(w.elevation)?Math.max(0,w.elevation):0),
      hourly:W.map(w=>w.hourly),times,source:ep.source,loadedAt:Date.now(),tables:new Map()};
  }
  /// 時刻 i の柱の並び。地上の気温・気圧が無い点、地面より上の気圧面が足りない点があれば作らない（推測で埋めない）
  function columnsAt(rec,i){
    const cols=[];
    for(let j=0;j<rec.hourly.length;j++){
      const h=rec.hourly[j],t2=h.temperature_2m[i],ps=h.surface_pressure[i],g=rec.grounds[j];
      if(!valid(ps,t2))return null;
      const lv=[{p:ps,t:t2}];
      for(const l of LEVELS){const t=h[`temperature_${l}hPa`]?.[i];if(Number.isFinite(t)&&t>=-90&&t<=50&&l<ps-1)lv.push({p:l,t});}
      if(lv.length<3)return null;
      let z=g+2,prev=null;
      const points=lv.map(l=>{if(prev)z+=RG*((prev.t+l.t)/2+273.15)*Math.log(prev.p/l.p);prev=l;return {z,t:l.t};});
      cols.push({s:rec.ss[j]*1000,groundM:g,pressureHPa:ps*Math.exp(2/(RG*(t2+273.15))),points});
    }
    return cols;
  }
  /**
   * 時刻 i・目の高さ h0 で、目標の見かけの角 eT のまわりだけ光を追う（eT−0.6°〜eT+4°の6本）。
   * 重なりに効くのは目標の上下数度だけ。予報の全日・全時刻で地平線から20°までの表を作ると、画面が十数秒止まった（2026-10-05）。
   * 光の間は「標準の式に対する比」を真高度で補間する。地上の目標は画面・候補の計算どおり k=7/6 の角で描くので、
   * 天体の見かけの高さを「目標が k=7/6 の角に来る枠」へずらして返す。目標のてっぺんで天体と目標の上下は追跡どおりになる。
   */
  const NEAR=[-0.6,-0.25,0,0.5,1.5,4],SAE=t=>1.02/Math.tan((t+10.3/(t+5.11))*R)/60;
  function tableAt(rec,i,h0){
    const key=i*1e6+Math.round(h0*10);
    if(rec.tables.has(key))return rec.tables.get(key);
    let out=null;
    try{
      const cols=columnsAt(rec,i);
      if(cols){
        const F=RF.field(cols),eT=RF.targetElevation(F,h0,rec.distanceKm*1000,rec.target.topM,{stepScale:4});
        const eK=A.targetElevationAngle(rec.distanceKm,h0,rec.target.topM,{k:7/6});
        if(eT!=null&&Number.isFinite(eK)){
          const tru=[],rho=[];
          for(const x of NEAR){
            const r=RF.trace(F,h0,eT+x,{stepScale:4});
            if(r.hit||(tru.length&&r.trueAltitude<=tru[tru.length-1]))continue;
            tru.push(r.trueAltitude);rho.push((eT+x-r.trueAltitude)/SAE(r.trueAltitude));
          }
          const app=t=>{
            if(t<=tru[0])return t+SAE(t)*rho[0];
            let k=1;while(k<tru.length-1&&tru[k]<t)k++;
            if(t>=tru[k])return t+SAE(t)*rho[k];
            return t+SAE(t)*(rho[k-1]+(rho[k]-rho[k-1])*(t-tru[k-1])/(tru[k]-tru[k-1]));
          };
          if(tru.length>=2)out={offset:eK-eT,targetApparent:eT,lo:tru[0],hi:tru[tru.length-1],app};
        }
      }
    }catch{out=null;}
    rec.tables.set(key,out);
    while(rec.tables.size>200)rec.tables.delete(rec.tables.keys().next().value);
    return out;
  }
  const nearObserver=(p,o)=>{
    const dy=(o.latitude-p.latitude)*111.2,dx=(o.longitude-p.longitude)*111.2*Math.cos(p.latitude*R);
    return Math.hypot(dx,dy)<=2&&Math.abs((o.elevation??0)-(p.elevation??0))<=250;
  };
  /// 天体が視線から20°以内・目標の高さの近く（真高度で目標の角−3°〜＋6°）にいて、前後の毎時の柱がそろうときだけ使う。
  /// 天体の位置は1回の描き直しで数十万回求めるので、外れる条件を安い順に見る
  let lineList=[],lineListVersion=-1,lineVersion=0;
  function lineFor(ms,o,azimuth,trueAlt){
    if(mode!=='auto'||!RF||!lines.size)return null;
    if(lineListVersion!==lineVersion)lineList=[...lines.values()].reverse(),lineListVersion=lineVersion;
    const now=Date.now(),h0=o.elevation??0;
    for(const rec of lineList){
      if(!rec.times||now-rec.loadedAt>=HOUR)continue;
      if(Number.isFinite(azimuth)&&Math.abs((azimuth-rec.azimuth+540)%360-180)>20)continue;
      if(Number.isFinite(trueAlt)){
        const ek=rec.eK||(rec.eK=new Map()),hk=Math.round(h0*10);
        let eK=ek.get(hk);if(eK===undefined){eK=A.targetElevationAngle(rec.distanceKm,h0,rec.target.topM,{k:7/6});ek.set(hk,eK);}
        if(trueAlt<eK-3||trueAlt>eK+6)continue;
      }
      if(!nearObserver(rec.observer,o))continue;
      const t=rec.times;let k=Math.floor((ms-t[0])/HOUR);
      if(k<0||k+1>=t.length)continue;
      while(k>0&&t[k]>ms)k--;while(k+2<t.length&&t[k+1]<=ms)k++;
      if(t[k]>ms||t[k+1]<ms||t[k+1]-t[k]>HOUR*1.01)continue;
      const a=tableAt(rec,k,o.elevation??0),b=tableAt(rec,k+1,o.elevation??0);
      if(a&&b)return {rec,a,b,f:(ms-t[k])/(t[k+1]-t[k])};
    }
    return null;
  }
  async function loadLine(o,t,ms,{fetcher=global.fetch,now=Date.now()}={}){
    const ep=lineEndpoint(o,t,ms,now);
    if(!ep||!RF)return null;
    const key=`${ep.url}|${Math.round(o.elevation??0)}|${t.topM}`,old=lines.get(key);
    if(old&&now-old.loadedAt<(old.error?60000:HOUR))return old;
    if(linePending.has(key))return linePending.get(key);
    const task=(async()=>{
      const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),12000);
      try{const response=await fetcher(ep.url,{signal:ctl.signal});if(!response.ok)throw Error('気象取得失敗');const out=parseLine(await response.json(),o,t,ep);lines.delete(key);lines.set(key,out);return out;}
      catch{const out={error:'視線上の気象を取得できません',loadedAt:now};lines.delete(key);lines.set(key,out);return out;}
      finally{clearTimeout(timer);linePending.delete(key);while(lines.size>6)lines.delete(lines.keys().next().value);lineVersion++;}
    })();linePending.set(key,task);return task;
  }
  /// 画面の説明用。この時刻・地点・方角で視線上の柱を使えるか
  function lineInfo(ms,o,azimuth){
    const x=lineFor(ms,o,azimuth);
    if(!x)return null;
    return {distanceKm:x.rec.distanceKm,points:x.rec.ss.length,beyondKm:x.rec.ss[x.rec.ss.length-1]-x.rec.distanceKm,source:x.rec.source,
      targetApparent:x.a.targetApparent+(x.b.targetApparent-x.a.targetApparent)*x.f};
  }

  function at(ms,o){
    if(mode==='none')return {none:true,pressureHPa:0,temperatureC:10,source:'なし'};
    if(mode==='manual')return {...manual,source:'手入力'};
    if(mode==='auto'){
      for(const r of [...records.values()].reverse()){const value=Date.now()-r.loadedAt<HOUR?sample(r,ms,o):null;if(value)return value;}
      // 地上の取得だけ失敗したときは、視線上の取得の観測点の値を使う（表示と柱の計算が食い違わないように）
      for(const r of [...lines.values()].reverse()){
        if(!r.times||Date.now()-r.loadedAt>=HOUR)continue;
        r.surface||(r.surface={observer:{...r.observer,elevation:r.grounds[0]},source:r.source,rows:r.times.map((at,i)=>({at,pressureHPa:r.hourly[0].surface_pressure[i],temperatureC:r.hourly[0].temperature_2m[i]}))});
        const value=sample(r.surface,ms,o);if(value)return value;
      }
      const z=Math.max(-500,Math.min(10000,o.elevation??0)),temperatureC=15-.0065*z;
      return {pressureHPa:1013.25*Math.pow((temperatureC+273.15)/288.15,9.80665/(287.05*.0065)),temperatureC,source:'標準大気（標高補正・気象なし）',fallback:true};
    }
    return {pressureHPa:1010,temperatureC:10,source:'標準条件'};
  }
  function apply(state,ms,o){
    if(!enabled)return state;
    const air=at(ms,o),h=state.geometricAltitude??state.altitude,r=state.angularRadius;
    const line=lineFor(ms,o,state.azimuth,h);
    if(line){
      // 光を追った範囲の外は1.5°かけて従来の式へ戻す（軌跡に段を作らない）
      const {a,b,f}=line,lo=Math.min(a.lo,b.lo),hi=Math.max(a.hi,b.hi);
      const weight=x=>x<lo?Math.max(0,1-(lo-x)/1.5):x>hi?Math.max(0,1-(x-hi)/1.5):1;
      const app=x=>{const base=x+correction(x,air),w=weight(x);if(!w)return base;const p=a.app(x)+a.offset,q=b.app(x)+b.offset,v=p+(q-p)*f;return base+(v-base)*w;};
      const apparent=app(h),upper=app(h+r),lower=app(h-r);
      return {...state,apparentAltitude:apparent,refraction:apparent-h,upperAltitude:upper,lowerAltitude:lower,
        upperRadius:upper-apparent,lowerRadius:apparent-lower,atmosphere:weight(h)?{...air,traced:true}:air,lowAltitude:h<2};
    }
    const apparent=h+correction(h,air),upper=h+r+correction(h+r,air),lower=h-r+correction(h-r,air);
    return {...state,apparentAltitude:apparent,refraction:apparent-h,upperAltitude:upper,lowerAltitude:lower,
      upperRadius:upper-apparent,lowerRadius:apparent-lower,atmosphere:air,lowAltitude:h<2};
  }
  const limbAltitude=(s,sign)=>sign===1?(s.lowerAltitude??s.apparentAltitude-s.angularRadius):sign===-1?(s.upperAltitude??s.apparentAltitude+s.angularRadius):s.apparentAltitude;
  global.SoramiAtmosphere={configure,correction,unrefract,load,parse,sample,at,apply,limbAltitude,endpoint,lineEndpoint,parseLine,lineInfo,mode:()=>mode,enabled:()=>enabled,targetK:()=>enabled&&mode==='none'?1:7/6};
  if(typeof module!=='undefined'&&module.exports)module.exports=global.SoramiAtmosphere;
})(typeof window!=='undefined'?window:globalThis);
