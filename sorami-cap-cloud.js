/* 笠雲の気象条件。発生の採点・確率ではない。 */
(function(root){
 'use strict';
 const scriptURL=typeof document!=='undefined'?document.currentScript?.src:null;
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const finite=n=>typeof n==='number'&&Number.isFinite(n);
 const jst=t=>new Date(t+9*3600000);
 const key=t=>jst(t).toISOString().slice(0,10);
 const hm=t=>jst(t).toISOString().slice(11,16);
 let cache=null,inflight=null,failedUntil=0;
 function view(snapshot,dayMs,now=Date.now()){
  if(!finite(dayMs)||!finite(now))return {status:'unavailable',message:'日付を確認できません。'};
  if(!snapshot||!Number.isFinite(Date.parse(snapshot.capturedAt)))return {status:'unavailable',message:'気象データを取得できませんでした。時間をおいて開き直してください。'};
  const age=now-Date.parse(snapshot.capturedAt);
  if(age<0||age>3600000)return {status:'unavailable',message:'気象データが古くなりました。閉じて開き直してください。'};
  const rows=snapshot.rows.filter(r=>key(Date.parse(r.validAt))===key(dayMs)&&Date.parse(r.validAt)>now);
  if(!rows.length)return {status:'outside',message:'この日の残りの時刻は取得範囲にありません。今日から3日間の範囲で確認できます。'};
  return {status:'ready',capturedAt:snapshot.capturedAt,rows:rows.map(r=>({at:Date.parse(r.validAt),available:r.status==='ready'&&finite(r.upwind?.rh_summit)&&finite(r.upwind?.wind_speed),rh:r.upwind?.rh_summit,wind:r.upwind?.wind_speed,base:r.upwind?.moist_peak_base_m,top:r.upwind?.moist_peak_top_m})),probability:null};
 }
 function render(state){
  if(state.status!=='ready')return `<p class="muted" role="status">${esc(state.message)}</p>`;
  const valid=state.rows.filter(r=>r.available);
  if(!valid.length)return '<p class="muted" role="status">この日は山頂付近の気象条件を計算できません。</p>';
  const layer=r=>!finite(r.base)||!finite(r.top)?'—':Math.round(r.base/100)*100===Math.round(r.top/100)*100?`${(r.base/1000).toFixed(1)}km`:`${(r.base/1000).toFixed(1)}〜${(r.top/1000).toFixed(1)}km`;
  return `<p class="muted">風上から山頂に届く空気の湿り気と風を確認できます。湿度が高いだけでは笠雲ができるとは限りません。</p>
   <div style="overflow-x:auto"><table style="width:100%;font-variant-numeric:tabular-nums;text-align:right;border-collapse:collapse">
    <caption class="sr-only">笠雲の気象条件、時刻は日本時間</caption>
    <thead><tr><th scope="col" style="text-align:left">時刻</th><th scope="col">湿度</th><th scope="col">風速</th><th scope="col">湿った層</th></tr></thead>
    <tbody>${state.rows.map(r=>`<tr><th scope="row" style="padding:6px 0;text-align:left;font-weight:400">${hm(r.at)}</th><td>${r.available?Math.round(r.rh)+'%':'—'}</td><td>${r.available?r.wind.toFixed(1)+'m/s':'—'}</td><td>${r.available?layer(r):'—'}</td></tr>`).join('')}</tbody></table></div>
   <p class="tiny" style="margin-top:8px">湿度・風速は風上の山頂と同じ高さ。湿った層は観測対象の高度のうち湿度が最大となる高さ（海抜）です。幅の表示は雲の厚さを意味しません。富士山の山頂は海抜3.8kmです。</p>
   <p class="tiny" style="margin-top:6px">試験表示：笠雲の発生確率・発生時刻は未検証です。地形を細かく表せない約25km格子の予報を使っています。</p>
   <p class="tiny" style="margin-top:6px">取得 ${esc(key(Date.parse(state.capturedAt)))} ${hm(Date.parse(state.capturedAt))} 日本時間 · <a href="https://open-meteo.com/en/docs/gfs-api" target="_blank" rel="noopener">Open-Meteo / GFS</a></p>`;
 }
 async function getSnapshot(now=Date.now()){
  if(cache&&now-Date.parse(cache.capturedAt)>=0&&now-Date.parse(cache.capturedAt)<3600000)return cache;
  if(now<failedUntil)throw Error('少し待ってから再度お試しください');
  if(!inflight){
   inflight=(async()=>{const url=new URL('./cap-cloud/atmosphere.mjs',scriptURL);url.searchParams.set('v',new URL(scriptURL).searchParams.get('v')||'1');const m=await import(url.href);const r=await m.captureForecast();cache=r.snapshot;return cache;})().catch(e=>{failedUntil=Date.now()+60000;throw e;}).finally(()=>{inflight=null;});
  }
  return inflight;
 }
 async function loadPanel(panel){
  const target=panel.querySelector('[data-cap-content]');if(!target||panel.dataset.loading==='true')return;
  panel.dataset.loading='true';target.setAttribute('aria-busy','true');target.innerHTML='<p class="muted" role="status">気象条件を確認しています…</p>';
  try{const snapshot=await getSnapshot();if(target.isConnected)target.innerHTML=render(view(snapshot,Number(panel.dataset.day)));}
  catch{if(target.isConnected)target.innerHTML=render({status:'unavailable',message:'気象データを取得できませんでした。1分以上おいて開き直してください。'});}
  finally{panel.dataset.loading='false';target.removeAttribute('aria-busy');}
 }
 root.SoramiCapCloud={view,render,loadPanel};
 if(typeof document!=='undefined')document.addEventListener('toggle',e=>{if(e.target.matches?.('[data-cap-cloud]')&&e.target.open)loadPanel(e.target);},true);
})(typeof window!=='undefined'?window:globalThis);
