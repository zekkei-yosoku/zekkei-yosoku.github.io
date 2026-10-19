(function(g){
'use strict';
const T=g.SoramiHomeTime||(typeof require==='function'?require('./sorami-home-time.js'):null),NS='http://www.w3.org/2000/svg',view={body:'moon',minute:null,day:null,wallMinute:null};
const date=T.date,time=T.time,num=v=>Number.isFinite(v)?v.toFixed(1):'—';
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function svg(tag,attrs,parent){const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));if(parent)parent.append(e);return e;}
function text(s,x,y,t,attrs={}){const e=svg('text',{x,y,...attrs},s);e.textContent=t;return e;}
function panel(title,caption){const e=el('section','alm-panel');e.append(el('h2','',title));if(caption)e.append(el('p','alm-caption',caption));return e;}
function daylight(day,o,ev,astro){let above=astro.sun(day,o).upperLimbAltitude>=0,start=day,total=0;for(const e of ev){if(above)total+=e.at-start;start=e.at;above=e.kind==='rise';}if(above)total+=T.addDays(day,1)-start;return total;}
function data(day,p,events,astro){
 const observer={latitude:p.latitude,longitude:p.longitude,elevation:0},bodies={},end=T.addDays(day,1),span=end-day;
 for(const body of ['sun','moon']){try{const ev=events(body,day,p),points=[];for(let i=0;i<=96;i++){const at=day+i*span/96,s=astro[body](at,observer);if(!Number.isFinite(s.geometricAltitude))throw Error('Unavailable');points.push({at,alt:s.geometricAltitude,az:s.azimuth});}bodies[body]={events:ev,points,noon:astro[body](T.atHour(day,12),observer)};}catch{bodies[body]={error:true};}}
 return {day,end,observer,bodies,daylight:bodies.sun.error?null:daylight(day,observer,bodies.sun.events,astro)};
}
function phaseLabel(s){const f=s.illuminatedFraction;if(f<.005)return '新月に近い月';if(f>.995)return '満月に近い月';if(f>.45&&f<.55)return s.waxing?'上弦のころ':'下弦のころ';return s.waxing?'満ちていく月':'欠けていく月';}
function duration(ms){if(!Number.isFinite(ms))return '—';const n=Math.floor(ms/60000);return `${Math.floor(n/60)}時間${n%60}分`;}
function compass(body,info){
 const s=svg('svg',{viewBox:'0 0 280 250',class:'alm-compass',role:'img','aria-label':`${body==='sun'?'太陽':'月'}の出入りの方位図`}),color='var(--alm-active)';
 for(const r of [48,90])svg('circle',{cx:140,cy:120,r,fill:'none',stroke:'var(--alm-grid)'},s);svg('path',{d:'M50 120H230M140 30V210',stroke:'var(--alm-grid)'},s);
 for(const[x,y,t]of [[140,18,'北'],[250,124,'東'],[140,235,'南'],[29,124,'西']])text(s,x,y,t,{'text-anchor':'middle',fill:'var(--secondary)','font-size':15});
 for(const e of info.events){const a=e.azimuth*Math.PI/180,x=140+90*Math.sin(a),y=120-90*Math.cos(a);svg('line',{x1:140,y1:120,x2:x,y2:y,stroke:color,'stroke-width':1.5,'stroke-dasharray':e.kind==='set'?'4 5':'none'},s);svg('circle',{cx:x,cy:y,r:4,fill:color},s);text(s,x,y+(y<120?-13:22),`${e.kind==='rise'?'出':'入'} ${num(e.azimuth)}°`,{'text-anchor':'middle',fill:color,'font-size':14});}
 if(!info.events.length)text(s,140,125,'この日は出入りなし',{'text-anchor':'middle',fill:'var(--secondary)','font-size':14});return s;
}
function render(root,day,p,events,astro,options={}){
 root.replaceChildren();const body=view.body,name=body==='moon'?'月':'太陽';root.dataset.body=body;
 const tabs=el('div','alm-switch');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','表示する天体');
 for(const[b,label,mark]of [['sun','太陽','☀'],['moon','月','☾']]){const button=el('button','',label);button.type='button';button.dataset.body=b;button.setAttribute('aria-pressed',String(b===body));const icon=el('span','',mark);icon.setAttribute('aria-hidden','true');button.prepend(icon);button.onclick=()=>{if(view.body===b)return;view.body=b;render(root,day,p,events,astro,options);root.querySelector(`[data-body="${b}"]`)?.focus({preventScroll:true});};tabs.append(button);}
 tabs.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();tabs.querySelector(`[data-body="${e.key==='ArrowLeft'?'sun':'moon'}"]`).click();};root.append(tabs);
 let d;try{d=data(day,p,events,astro);}catch{d=null;}
 if(!d||d.bodies[body].error){const box=panel(`${name}の情報を取得できませんでした`,'地点・日付を確認して再計算してください。'),retry=el('button','chip','再計算');retry.type='button';retry.onclick=()=>render(root,day,p,events,astro,options);box.append(retry);root.append(box);return;}
 if(view.minute===null)view.minute=date(Date.now())===date(day)?Math.floor((Date.now()-day)/60000):720;
 if(view.day!==null&&view.day!==date(day)&&view.wallMinute!==null)view.minute=(T.atHour(day,Math.floor(view.wallMinute/60))+view.wallMinute%60*60000-day)/60000;
 view.day=date(day);const minutes=Math.round((d.end-day)/60000);view.minute=Math.max(0,Math.min(minutes-1,view.minute));
 const at=()=>day+view.minute*60000,info=d.bodies[body];
 const hero=el('section','alm-hero'),visual=el('div','alm-orb-stage'),portrait=el('canvas','alm-portrait');portrait.setAttribute('role','img');
 const sun=el('div','alm-solar-orb');sun.setAttribute('role','img');sun.setAttribute('aria-label','太陽のイメージ');
 visual.append(body==='moon'?portrait:sun);const rim=el('div','alm-orbit-rim');rim.setAttribute('aria-hidden','true');visual.append(rim);
 const content=el('div','alm-hero-copy'),kicker=el('p','alm-eyebrow',body==='moon'?'LUNAR NOTES':'SOLAR NOTES'),title=el('h2','alm-hero-title'),moment=el('p','alm-moment');
 const english=el('p','alm-phase-english'),names=el('div','alm-moon-names');
 const nameRow=el('div','alm-name-row');nameRow.append(title,english);content.append(kicker,nameRow,names,moment);const metrics=el('div','alm-metrics'),metricValues=[];
 for(const label of body==='moon'?['月齢','照明率','地球からの距離']:['昼の長さ','高度','方位']){const item=el('div','alm-metric'),value=el('strong');item.append(el('span','',label),value);metrics.append(item);metricValues.push(value);}content.append(metrics);hero.append(visual,content);root.append(hero);
 const textureStatus=el('div','alm-texture-status');textureStatus.setAttribute('role','status');root.append(textureStatus);
 const times=el('div','alm-event-pair');
 for(const[kind,label]of [['rise',body==='moon'?'月の出':'日の出'],['set',body==='moon'?'月の入り':'日の入り']]){const item=el('div','alm-event'),hits=info.events.filter(e=>e.kind===kind);item.append(el('span','alm-event-label',label),el('strong','alm-event-time',hits.length?hits.map(e=>time(e.at)).join(' / '):'なし'),el('span','alm-event-direction',hits.length?hits.map(e=>`方位 ${num(e.azimuth)}°`).join(' / '):'この日はありません'));times.append(item);}root.append(times);
 const actions=(options.actions||[]).filter(a=>a.available!==false);if(actions.length){const nav=el('nav','alm-actions');nav.setAttribute('aria-label','AstroNotesの道具');for(const a of actions){const button=el('button','',a.label);button.type='button';button.append(el('span','','↗'));button.onclick=a.open;nav.append(button);}root.append(nav);}
 const grid=el('div','alm-detail-grid'),chart=panel('空をたどる',`${name}の1日の高度。0°が水平な地平線です。`);
 const s=svg('svg',{viewBox:'0 0 720 300',class:'alm-chart',role:'img','aria-label':`${name}の0時から24時までの高度グラフ`}),x=t=>48+(t-day)/(d.end-day)*650,y=a=>238-a*2;
 svg('rect',{x:48,y:58,width:650,height:180,fill:'var(--alm-day)'},s);
 for(const alt of [90,60,30,0,-15]){svg('line',{x1:48,y1:y(alt),x2:698,y2:y(alt),stroke:alt===0?'var(--secondary)':'var(--alm-grid)','stroke-dasharray':alt===0?'none':'2 5'},s);text(s,37,y(alt)+5,`${alt}°`,{'text-anchor':'end',fill:'var(--secondary)','font-size':19});}
 for(const hour of [0,6,12,18,24])text(s,x(T.atHour(day,hour)),298,`${hour}時`,{'text-anchor':'middle',fill:'var(--secondary)','font-size':19});
 const defs=svg('defs',{},s),clip=svg('clipPath',{id:'almChartClip'},defs);svg('rect',{x:48,y:52,width:650,height:216},clip);
 svg('path',{d:info.points.map((p,i)=>(i?'L':'M')+x(p.at)+','+y(p.alt)).join(' '),fill:'none',stroke:'var(--alm-active)','stroke-width':2.5,'clip-path':'url(#almChartClip)'},s);
 const cursor=svg('line',{y1:52,y2:268,stroke:'var(--secondary)','stroke-dasharray':'3 5'},s),dot=svg('circle',{r:5,fill:'var(--alm-active)','clip-path':'url(#almChartClip)'},s);chart.append(s);
 const readout=el('p','alm-readout'),range=el('input','alm-range');range.type='range';range.min='0';range.max=String(minutes-1);range.step='1';range.value=String(view.minute);range.setAttribute('aria-label',`${name}を見る時刻`);
 let drawGeneration=0;
 const update=()=>{
  const state=astro[body](at(),d.observer),t=time(at());view.wallMinute=new Date(at()).getHours()*60+new Date(at()).getMinutes();cursor.setAttribute('x1',x(at()));cursor.setAttribute('x2',x(at()));dot.setAttribute('cx',x(at()));dot.setAttribute('cy',y(state.geometricAltitude));
  let lunar=null;if(body==='moon'){try{lunar=g.SoramiLunarNames?.describe(at(),state,astro);}catch{}if(!lunar)lunar={ja:phaseLabel(state),en:''};}
  title.textContent=lunar?lunar.ja:'この日の太陽';english.textContent=lunar?.en||'';names.replaceChildren();kicker.hidden=body==='moon';
  if(lunar?.event){const e=lunar.event;
   if(e.kind===2){english.textContent=e.name[1];
    if(e.tags.length){const tags=el('div','alm-moon-tags');for(const [,en]of e.tags)tags.append(el('span','',en));names.append(tags);}
   }
  }
  moment.textContent=`${t} ${T.zoneLabel(at())}`;
  if(lunar?.event){const e=lunar.event,zone=T.zoneLabel(e.at);moment.textContent+=` · ${['新月','上弦','満月','下弦'][e.kind]} ${time(e.at)}${zone===T.zoneLabel(at())?'':' '+zone}`;}
  if(state.geometricAltitude<0)moment.textContent+=' · 地平線の下';
  const values=body==='moon'?[num(lunar?.age??state.synodicAge),`${(state.illuminatedFraction*100).toFixed(1)}%`,`${Math.round(state.distanceKm/1000).toLocaleString('ja-JP')}万km`]:[duration(d.daylight),`${num(state.geometricAltitude)}°`,`${num(state.azimuth)}°`];
  if(body==='moon')values[2]=`${(state.distanceKm/10000).toFixed(1)}万km`;
  metricValues.forEach((e,i)=>e.textContent=values[i]);readout.textContent=`${t} ${T.zoneLabel(at())}　高度 ${num(state.geometricAltitude)}° ／ 方位 ${num(state.azimuth)}°`;range.setAttribute('aria-valuetext',readout.textContent);
  if(body==='moon'){
   const generation=++drawGeneration;
   if(!g.SoramiMoonPortrait){textureStatus.textContent='月の描画を読み込めませんでした。ページを再読み込みしてください。';return;}
   g.SoramiMoonPortrait.draw(portrait,state).then(result=>{if(generation!==drawGeneration||!root.contains(portrait))return;if(result.texture){textureStatus.replaceChildren();return;}textureStatus.textContent='月面画像を読み込めないため、満ち欠けの形だけを表示しています。';const retry=el('button','chip','画像を再試行');retry.type='button';retry.onclick=update;textureStatus.append(retry);}).catch(()=>{if(generation===drawGeneration)textureStatus.textContent='月の描画を更新できませんでした。時刻を動かして再試行してください。';});
  }
 };range.oninput=()=>{view.minute=Math.max(0,Math.min(minutes-1,Number(range.value)));update();};chart.append(readout,range);
 const direction=panel('出入りの方向','実線は出、破線は入り。北を上にしています。');direction.append(compass(body,info));grid.append(chart,direction);root.append(grid);
 const week=panel('これから7日間',`${name}の時刻を比較。${T.zone()} の時刻です。`),table=el('table','alm-table'),thead=el('thead'),tr=el('tr');
 for(const label of ['日付',body==='moon'?'月の出':'日の出',body==='moon'?'月の入り':'日の入り',body==='moon'?'照明率':'昼の長さ']){const th=el('th','',label);th.scope='col';tr.append(th);}thead.append(tr);table.append(thead);const tbody=el('tbody');
 for(let n=0;n<7;n++){const dayAt=T.addDays(day,n);if(date(dayAt)>'2030-12-31')break;const row=el('tr'),th=el('th','',date(dayAt).slice(5).replace('-','/'));th.scope='row';row.append(th);let ev=null;try{ev=events(body,dayAt,p);}catch{/* no events and unavailable remain distinct */}for(const kind of ['rise','set']){const hits=ev?.filter(e=>e.kind===kind);row.append(el('td','',ev===null?'取得不能':hits.length?hits.map(e=>time(e.at)).join(' / '):'なし'));}let extra='取得不能';try{extra=body==='moon'?`${(astro.moon(T.atHour(dayAt,12),d.observer).illuminatedFraction*100).toFixed(1)}%`:ev?duration(daylight(dayAt,d.observer,ev,astro)):'取得不能';}catch{}row.append(el('td','',extra));tbody.append(row);}table.append(tbody);week.append(table);if(body==='moon')week.append(el('p','alm-caption alm-week-note','表の照明率は各日の正午。上の月はスライダーの時刻を表します。'));root.append(week);
 const detail=el('details','alm-about');detail.append(el('summary','','表示について'));detail.append(el('p','alm-caption',body==='moon'?'月面の質感は提供写真を参考に再構成しています。三日月・十六夜などの日本の夜の呼び名は、日本時で新月を含む日を1日目として数えます。十三夜は月ごとの13日目の呼称で、旧暦9月のお月見行事の判定ではありません。満ち欠けの面積と光の向きは選択した地点・日時から計算。月面地形の正確な向きや秤動、月食の影は再現していません。新月・上弦・満月・下弦の名前は、その瞬間を含む端末のタイムゾーンの日に表示。月の絵と照明率は選択時刻の値です。満月の愛称は北米・欧米の通称。ハーベストムーンは北半球の秋分に最も近い満月、ハンターズムーンはその次。ブルームーンは同月2回目（端末のタイムゾーン）、季節のブルームーンは二分二至で区切る季節に4回ある満月の3回目。スーパームーン／マイクロムーンは統一された定義がないため、当年の地心距離範囲の近い側／遠い側10％に入る満月を目安にしています。':'太陽の絵はイメージです。時刻・高度・方位は選択した地点と日付から計算しています。'));root.append(detail);update();
}
const api={data,render,phaseLabel};g.SoramiAlmanacDashboard=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);
