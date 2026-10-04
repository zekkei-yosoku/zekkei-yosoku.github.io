/* Celestial body provider. Positions: north=0 clockwise, airless + one refraction. */
(function(global) {
  'use strict';
  const A = global.SoramiAstro || (typeof require === 'function' ? require('./sorami-astro.js') : null);
  const ATM=global.SoramiAtmosphere||(typeof require==='function'?require('./sorami-atmosphere.js'):null);
  const adjusted=(st,ms,o)=>ATM?ATM.apply(st,ms,o):st;
  const definitions = Object.freeze([
    {id:'sun',name:'太陽',group:'太陽・月',limbs:true},
    {id:'moon',name:'月',group:'太陽・月',limbs:true},
    {id:'sirius',name:'シリウス',group:'恒星',engine:'Star1',radiusKm:0},
    {id:'mercury',name:'水星',group:'惑星',engine:'Mercury',radiusKm:2439.4},
    {id:'venus',name:'金星',group:'惑星',engine:'Venus',radiusKm:6051.8},
    {id:'mars',name:'火星',group:'惑星',engine:'Mars',radiusKm:3389.5},
    {id:'jupiter',name:'木星',group:'惑星',engine:'Jupiter',radiusKm:69911},
    {id:'saturn',name:'土星',group:'惑星',engine:'Saturn',radiusKm:58232}
  ].map(Object.freeze));
  const definition = id => definitions.find(x=>x.id===id);
  let engine = global.Astronomy || null, pending = null;
  if (!engine && typeof require === 'function') engine = require('./vendor/astronomy-engine-2.1.19.min.js');
  function ensure(id) {
    if (!definition(id)) return Promise.reject(new Error('未知の天体'));
    if (definition(id).limbs || engine) return Promise.resolve();
    if (pending) return pending;
    pending = new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='vendor/astronomy-engine-2.1.19.min.js';
      script.onload=()=>{engine=global.Astronomy; if(engine) resolve(); else reject(new Error('天体計算を読み込めませんでした'));};
      script.onerror=()=>{script.remove();reject(new Error('天体計算を読み込めませんでした'));};
      document.head.append(script);
    }).catch(e=>{pending=null;throw e;});
    return pending;
  }
  // SIMBAD Sirius A ICRS J2000.0. Proper motion in fixed EQJ axes; no extra light-time backdating.
  function siriusCatalog(ms) {
    const r=(6+45/60+8.91728/3600)*Math.PI/12, d=-(16+42/60+58.0171/3600)*Math.PI/180;
    const dist=1000/379.21, years=(ms-Date.UTC(2000,0,1,12))/(365.25*86400000);
    const mas=Math.PI/(180*3600000), mr=-546.01*mas, md=-1223.07*mas;
    const radial=-5.50*365.25*86400/3.0856775814913673e13;
    const u=[Math.cos(d)*Math.cos(r),Math.cos(d)*Math.sin(r),Math.sin(d)];
    const er=[-Math.sin(r),Math.cos(r),0], ed=[-Math.sin(d)*Math.cos(r),-Math.sin(d)*Math.sin(r),Math.cos(d)];
    const v=u.map((x,i)=>dist*x+years*(dist*(mr*er[i]+md*ed[i])+radial*x));
    const length=Math.hypot(...v);
    return {ra:((Math.atan2(v[1],v[0])*12/Math.PI)%24+24)%24,dec:Math.asin(v[2]/length)*180/Math.PI,distanceLightYears:length*3.261563777};
  }
  const cache=new Map();
  function state(id,ms,observer) {
    const def=definition(id);
    if(!def) throw new Error('未知の天体: '+id);
    if(id==='sun') return adjusted(A.sun(ms,observer),ms,observer);
    if(id==='moon') return adjusted(A.moon(ms,observer),ms,observer);
    if(!engine) throw new Error('天体計算を読み込めませんでした');
    if(!Number.isFinite(ms)||!Number.isFinite(observer.latitude)||!Number.isFinite(observer.longitude)) throw new Error('観測日時・地点が不正です');
    const key=[id,ms,observer.latitude,observer.longitude,observer.elevation??0].join('/');
    if(cache.has(key)) return adjusted(cache.get(key),ms,observer);
    const time=new Date(ms), obs=new engine.Observer(observer.latitude,observer.longitude,observer.elevation??0);
    if(id==='sirius') {const c=siriusCatalog(ms);engine.DefineStar(engine.Body.Star1,c.ra,c.dec,c.distanceLightYears);}
    const eq=engine.Equator(engine.Body[def.engine],time,obs,true,true);
    const h=engine.Horizon(time,obs,eq.ra,eq.dec); // undefined refraction = airless.
    const result=Object.freeze({azimuth:h.azimuth,altitude:h.altitude,apparentAltitude:h.altitude+A.refraction(h.altitude),
      angularRadius:id==='sirius'?0:Math.asin(def.radiusKm/(eq.dist*149597870.7))*180/Math.PI,distanceAU:eq.dist});
    cache.set(key,result);if(cache.size>12000) cache.delete(cache.keys().next().value);
    return adjusted(result,ms,observer);
  }
  const sky = altitude => altitude < -18 ? '夜' : altitude < 0 ? '薄明' : '日中';
  const api=Object.freeze({definitions,definition,ensure,ready:()=>!!engine,state,siriusCatalog,sky,nearAngle:id=>definition(id)?.limbs?null:0.5});
  global.SoramiBodies=api;if(typeof module!=='undefined'&&module.exports) module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
