// ---------------------------------------------------------------- 画面の行き来
//
// 一覧（全現象×7日）と詳細（1現象・1日）の2画面。同じページにスクロールで
// 並べていたが、表と詳細が混ざって読みにくかった。
// 場所は URL のハッシュに持つので、ブラウザの戻るがそのまま効く。
//   #             → 一覧
//   #/sunset      → 夕焼けの直近の回
//   #/sunset/1756… → 夕焼けの特定の日
// Almanac uses the same upper-limb state and root solver as the existing Moon detail.
// Keep the civil-day interval half open so midnight belongs to exactly one day.
function almanacEvents(body, day, point) {
  const observer = { latitude: point.latitude, longitude: point.longitude, elevation: 0 };
  if (!Number.isFinite(observer.latitude) || Math.abs(observer.latitude)>90 || !Number.isFinite(observer.longitude) || Math.abs(observer.longitude)>180) throw Error('Invalid observer');
  const state = at => AstroNotesAstro[body](at, observer);
  const value = at => { const v=state(at).upperLimbAltitude; if(!Number.isFinite(v))throw Error('Unavailable state');return v; };
  const endDay=AstroNotesHomeTime.addDays(day,1),events=[]; let before=value(day);
  for(let end=day+60000;end<=endDay;end+=60000){
    const after=value(end);
    if((before<0&&after>=0)||(before>=0&&after<0)){
      const at=AstroNotesAstro.findCrossing(value,end-60000,end,{toleranceMs:100});
      if(at!==null&&at>=day&&at<endDay)events.push({at,kind:after>before?'rise':'set',azimuth:state(at).azimuth});
    }
    before=after;
  }
  return events;
}
function renderAlmanac() {
  const p=almanacPoint||place, input=$("almanacDate");
  const T=AstroNotesHomeTime,date=T.date,ruler=()=>T.toRuler(almanacDay);
  // 下のバーは「日付」と「時刻」を切り替える（2026-10-20 ユーザー「せっかく下に日付があるんだから時間に切り替えられるようにしたらいいじゃん」）。
  // 時刻のときは実時刻（ms）、日付のときは日付の目盛り（ruler）で動かす
  // 時刻で日をまたいで描き直す間は、バーを指で動かしている時刻のまま合わせる（描き直した日の同じ時刻へバーが飛ばないように）
  const D=()=>globalThis.AstroNotesAlmanacDashboard,barAt=()=>almanacScrub!=='date'?(almanacDragAt??D()?.at()??Date.now()):ruler();
  const syncClock=()=>{const clock=$("almanacTime"),at=D()?.at();if(clock&&Number.isFinite(at)&&document.activeElement!==clock)clock.value=T.time(at);};
  const lower=T.parse('2020-01-01'), upper=T.parse('2030-12-31');
  const outOfRange=almanacDay<lower||almanacDay>upper;
  almanacDay=Math.max(lower,Math.min(upper,almanacDay));
  $("almanacRangeNote").hidden=!outOfRange;
  $("almanacRangeNote").textContent=outOfRange?"対応期間は2020〜2030年です。範囲内の最も近い日を表示しました。":"";
  input.value=date(almanacDay);
  if(typeof ToolDateTimeBar!=='undefined'&&typeof AstroNotesScrollTimeline!=='undefined'){
    if(!almanacTimeline){
      const bar=ToolDateTimeBar.decorate({footer:$("almanacFooter"),row:$("almanacDateRow"),date:$("almanacCalendarOpen"),prev:$("almanacPrev"),next:$("almanacNext"),track:$("almanacTrack"),timeId:'almanacTime',moreId:'almanacTimeMore',now:()=>{D()?.today();almanacDay=T.start(Date.now());renderAlmanac();}});
      almanacPlayback=ToolDateTimeBar.playback({row:$("almanacDateRow"),footer:$("almanacFooter"),getAt:()=>D()?.at(),enabled:()=>atAlmanac, onStart:()=>{almanacTimeline?.stop();D()?.setAt(D()?.at());},onStop:()=>{if(atAlmanac){D()?.setAt(D()?.at());almanacTimeline?.sync(barAt(),almanacScrub);}},setAt:at=>{
        if(at<lower||at>=T.addDays(upper,1)){almanacPlayback.stop(false);return;}
        const day=T.start(at);if(day!==almanacDay){almanacDay=day;renderAlmanac();}D()?.setAt(at,true);syncClock();
        const rulerAt=almanacScrub==='date'?T.toRuler(day)+(at-day)/(T.addDays(day,1)-day)*86400000:at;
        almanacTimeline?.follow(rulerAt,almanacScrub);
      }});
      bar.time.onchange=()=>{const before=D()?.at(),at=T.withTime(before,bar.time.value);if(!Number.isFinite(at)){bar.time.value=Number.isFinite(before)?T.time(before):'';bar.time.setCustomValidity('この日のその時刻は存在しません。別の時刻を選んでください。');bar.time.reportValidity();return;}bar.time.setCustomValidity('');D()?.setAt(at);syncClock();};
      bar.time.addEventListener('input',()=>bar.time.setCustomValidity(''));bar.time.addEventListener('blur',syncClock);
      ToolDateTimeBar.details({button:bar.more,getText:()=>{const at=D()?.at();if(!Number.isFinite(at))return '日時を取得できませんでした。';const point=almanacPoint||place,body=$('almanacDashboard').dataset.body==='moon'?'moon':'sun',state=AstroNotesAstro[body](at,{latitude:point.latitude,longitude:point.longitude,elevation:0});return `${T.date(at).replaceAll('-','/')} ${T.time(at)} ${T.zoneLabel(at)}\n${T.zone()}\n${body==='moon'?'月':'太陽'} 高度 ${state.geometricAltitude.toFixed(1)}°・方位 ${state.azimuth.toFixed(1)}°`;}});
      const homeCalendar=ToolDateTimeBar.calendar({button:$("almanacCalendarOpen"),getAt:ruler,getNow:()=>T.toRuler(Date.now()),setDay:day=>{almanacDay=T.fromRuler(day);renderAlmanac();}});
      ToolDateTimeBar.editor({button:$("almanacCalendarOpen"),time:bar.time,dialog:homeCalendar,beforeOpen:()=>almanacTimeline?.stop()});
      ToolDateTimeBar.trackPointerFocus($("almanacFooter"));
      almanacTimeline=AstroNotesScrollTimeline.mount({root:$("almanacTimeline"),getAt:barAt,getMode:()=>almanacScrub,enabled:()=>atAlmanac,getObserver:()=>({latitude:(almanacPoint||place).latitude,longitude:(almanacPoint||place).longitude,elevation:0}),sun:(at,o)=>AstroNotesAstro.sun(at,o),onChange:at=>{if(almanacScrub!=='date'){const day=T.start(at);if(day<lower||day>upper)return;if(day!==almanacDay){almanacDay=day;almanacDragAt=at;try{renderAlmanac();}finally{almanacDragAt=null;}}D()?.setAt(at);syncClock();return;}const day=T.fromRuler(at);const clamped=Math.max(lower,Math.min(upper,day));if(clamped!==almanacDay){almanacDay=clamped;renderAlmanac();}},onSettle:()=>almanacTimeline.sync(barAt(),almanacScrub),format:(at,mode)=>mode!=='date'?T.time(at):new Date(at+32400000).toISOString().slice(5,10).replace('-','/'),describe:(at,mode)=>mode!=='date'?ToolDateTimeBar.label(T.toRuler(T.start(at)))+' '+T.time(at):ToolDateTimeBar.label(at)});
      $("almanacScrubMode").onclick=()=>{almanacTimeline.stop();almanacScrub=ToolDateTimeBar.nextMode(almanacScrub);renderAlmanac();};
    }
    ToolDateTimeBar.dateText($("almanacCalendarOpen"),ruler());
    $("almanacCalendarOpen").setAttribute('aria-label',ToolDateTimeBar.label(ruler()));
  }
  $("almanacPlace").textContent=`${p.name}　⌄`;
  $("almanacPlace").setAttribute("aria-label",`観測地点 ${p.name} を変更`);
  $("almanacDayLabel").textContent=typeof ToolDateTimeBar!=="undefined"?ToolDateTimeBar.label(ruler()):date(almanacDay);
  $("almanacPlace").onclick=()=>openPlaceSheet('almanac');
  $("almanacPrev").disabled=almanacDay<=lower;$("almanacNext").disabled=almanacDay>=upper;
  const move=days=>{almanacDay=T.addDays(almanacDay,days);renderAlmanac();};
  $("almanacPrev").onclick=()=>move(-1);$("almanacNext").onclick=()=>move(1);
  input.onchange=()=>{const n=T.parse(input.value);if(Number.isFinite(n)&&n>=lower&&n<=upper){almanacDay=n;renderAlmanac();}else{input.value=date(almanacDay);}};
  $("almanacMenu")?.setAttribute('aria-current','page');
  const out=$("almanacOutput");out.replaceChildren();
  out.hidden=!!globalThis.AstroNotesAlmanacDashboard;
  const syncBar=()=>{if(typeof almanacTimeline==='undefined'||!almanacTimeline)return;ToolDateTimeBar.modeButton($("almanacScrubMode"),almanacScrub);almanacTimeline.sync(barAt(),almanacScrub);syncClock();};
  if(globalThis.AstroNotesAlmanacDashboard){AstroNotesAlmanacDashboard.render($("almanacDashboard"),almanacDay,p,almanacEvents,AstroNotesAstro,{isActive:()=>atAlmanac,onLiveDay:()=>{almanacDay=AstroNotesHomeTime.start(Date.now());renderAlmanac();},onLive:at=>{syncClock();if(typeof almanacTimeline!=='undefined'&&almanacScrub!=='date')almanacTimeline?.sync(at,almanacScrub);}});AstroNotesAlmanacDashboard.setAt(AstroNotesAlmanacDashboard.at());syncBar();return;}
  syncBar();
  for(const [body,name] of [['sun','太陽'],['moon','月']]){
    const card=document.createElement('div');card.className='card';
    const heading=document.createElement('h2');heading.style.fontSize='1rem';heading.textContent=name;card.append(heading);
    try{
      const events=almanacEvents(body,almanacDay,p);
      for(const [kind,label] of [['rise',body==='sun'?'日の出':'月の出'],['set',body==='sun'?'日の入':'月の入']]){
        const hits=events.filter(e=>e.kind===kind),row=document.createElement('div');
        row.style.cssText='display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--line)';
        const title=document.createElement('strong');title.textContent=label;
        const result=document.createElement('span');result.style.fontVariantNumeric='tabular-nums';
        result.textContent=hits.length?hits.map(e=>{const t=T.time(e.at);return `${t} ・ 方位 ${e.azimuth.toFixed(1)}°`;}).join(' / '):'この日はありません';
        row.append(title,result);card.append(row);
      }
    }catch{
      const message=document.createElement('p');message.textContent='時刻を計算できませんでした。地点と日付を確認してください。';
      const retry=document.createElement('button');retry.type='button';retry.className='chip';retry.textContent='再計算';retry.onclick=renderAlmanac;card.append(message,retry);
    }
    out.append(card);
  }

}
if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(!document.hidden&&atAlmanac)globalThis.AstroNotesAlmanacDashboard?.refresh();});
function openSkyRating(){try{sessionStorage.setItem("astronotes.rating.return",location.pathname+location.hash.split("?")[0]);}catch{}location.href="sky-rating.html";}
document.querySelector("#skyRatingInvite a").onclick=e=>{e.preventDefault();openSkyRating();};
