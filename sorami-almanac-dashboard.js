(function(g){
'use strict';
const T=g.SoramiHomeTime||(typeof require==='function'?require('./sorami-home-time.js'):null),NS='http://www.w3.org/2000/svg',view={body:'moon',minute:null,day:null,wallMinute:null,manual:false,live:true};
const AUTO_KEY='sorami.homeAutoBody';let timer=null,active=null;
function getAuto(){try{return g.localStorage?.getItem(AUTO_KEY)!=='false';}catch{return true;}}
function setAuto(value){try{g.localStorage.setItem(AUTO_KEY,String(!!value));}catch{return false;}view.manual=false;active?.render();return true;}
function stop(){if(timer!==null)clearInterval(timer);timer=null;active=null;}
function enter(){view.manual=false;if(view.live){view.day=null;view.minute=null;view.wallMinute=null;}return view.live;}
// 2026-10-20 ユーザー「月を見てて今日を押すと太陽に移る。月を見てるんだから月でしょ。ここまで自動化しないで」：今日は日時だけ戻し、見ている天体はそのまま（自動切替を止める）
function today(){view.manual=true;view.live=true;view.minute=null;view.day=null;view.wallMinute=null;}
function preferredBody(at,p,astro){try{const h=astro.sun(at,{latitude:p.latitude,longitude:p.longitude,elevation:0}).upperLimbAltitude;return Number.isFinite(h)?h>=0?'sun':'moon':null;}catch{return null;}}
const date=T.date,time=T.time,num=v=>Number.isFinite(v)?v.toFixed(1):'—';
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function svg(tag,attrs,parent){const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));if(parent)parent.append(e);return e;}
function text(s,x,y,t,attrs={}){const e=svg('text',{x,y,...attrs},s);e.textContent=t;return e;}
function panel(title,caption,en){const e=el('section','alm-panel');if(en)e.append(el('p','alm-panel-kicker',en));e.append(el('h2','',title));if(caption)e.append(el('p','alm-caption',caption));return e;}
function daylight(day,o,ev,astro){let above=astro.sun(day,o).upperLimbAltitude>=0,start=day,total=0;for(const e of ev){if(above)total+=e.at-start;start=e.at;above=e.kind==='rise';}if(above)total+=T.addDays(day,1)-start;return total;}
function data(day,p,events,astro){
 const observer={latitude:p.latitude,longitude:p.longitude,elevation:0},bodies={},end=T.addDays(day,1),span=end-day;
 for(const body of ['sun','moon']){try{const ev=events(body,day,p),points=[];for(let i=0;i<=96;i++){const at=day+i*span/96,s=astro[body](at,observer);if(!Number.isFinite(s.geometricAltitude))throw Error('Unavailable');points.push({at,alt:s.geometricAltitude,az:s.azimuth});}bodies[body]={events:ev,points,noon:astro[body](T.atHour(day,12),observer)};}catch{bodies[body]={error:true};}}
 return {day,end,observer,bodies,daylight:bodies.sun.error?null:daylight(day,observer,bodies.sun.events,astro)};
}
function phaseLabel(s){const f=s.illuminatedFraction;if(f<.005)return '新月に近い月';if(f>.995)return '満月に近い月';if(f>.45&&f<.55)return s.waxing?'上弦のころ':'下弦のころ';return s.waxing?'満ちていく月':'欠けていく月';}
const DIR16=['北','北北東','北東','東北東','東','東南東','南東','南南東','南','南南西','南西','西南西','西','西北西','北西','北北西'],dir16=az=>DIR16[Math.round(((az%360)+360)%360/22.5)%16];
function duration(ms){if(!Number.isFinite(ms))return '—';const n=Math.floor(ms/60000);return `${Math.floor(n/60)}時間${n%60}分`;}
// 2026-10-20 出入りの方向は天球図：中心が天頂、外周が地平線、北が上。地平線より上の道筋を描き、今の位置を点で示す
function compass(body,info){
 const C=150,R=112,s=svg('svg',{viewBox:'-44 0 388 300',class:'alm-compass',role:'img','aria-label':`${body==='sun'?'太陽':'月'}の空の道筋と出入りの方位図`}),color='var(--alm-active)';
 const pt=(alt,az)=>{const r=R*(90-Math.max(0,alt))/90,a=az*Math.PI/180;return[C+r*Math.sin(a),C-r*Math.cos(a)];};
 const defs=svg('defs',{},s),grad=svg('radialGradient',{id:'almDomeFill'},defs);svg('stop',{offset:'0%','stop-color':color,'stop-opacity':.1},grad);svg('stop',{offset:'100%','stop-color':color,'stop-opacity':0},grad);
 const glow=svg('filter',{id:'almDomeGlow',x:'-50%',y:'-50%',width:'200%',height:'200%'},defs);svg('feGaussianBlur',{stdDeviation:3.2},glow);
 svg('circle',{cx:C,cy:C,r:R,fill:'url(#almDomeFill)',stroke:'var(--alm-grid)','stroke-width':1.2},s);
 for(const alt of [30,60])svg('circle',{cx:C,cy:C,r:R*(90-alt)/90,fill:'none',stroke:'var(--alm-grid)','stroke-dasharray':'2 4'},s);
 for(let a=0;a<360;a+=15){const t=a*Math.PI/180,l=a%90?5:9;svg('line',{x1:C+R*Math.sin(t),y1:C-R*Math.cos(t),x2:C+(R+l)*Math.sin(t),y2:C-(R+l)*Math.cos(t),stroke:a%90?'var(--alm-grid)':'var(--secondary)'},s);}
 for(const[a,t]of [[0,'N'],[90,'E'],[180,'S'],[270,'W']]){const r=R+20,x=C+r*Math.sin(a*Math.PI/180),y=C-r*Math.cos(a*Math.PI/180)+4;text(s,x,y,t,{'text-anchor':'middle',fill:'var(--secondary)','font-size':11,'letter-spacing':'.1em'});}
 text(s,C+3,C-R*(60/90)+11,'30°',{fill:'var(--secondary)','font-size':8,opacity:.8});text(s,C+3,C-R*(30/90)+11,'60°',{fill:'var(--secondary)','font-size':8,opacity:.8});
 // 地平線より上の区間ごとに道筋を描く
 const runs=[];let run=null;for(const p of info.points||[]){if(p.alt>=0){if(!run)runs.push(run=[]);run.push(pt(p.alt,p.az));}else run=null;}
 for(const r of runs){if(r.length<2)continue;const d=r.map((q,i)=>(i?'L':'M')+q[0].toFixed(1)+','+q[1].toFixed(1)).join(' ');svg('path',{d,fill:'none',stroke:color,'stroke-width':5,opacity:.35,filter:'url(#almDomeGlow)'},s);svg('path',{d,fill:'none',stroke:color,'stroke-width':2,'stroke-linecap':'round'},s);}
 for(const e of info.events){const[x,y]=pt(0,e.azimuth),rise=e.kind==='rise',a=e.azimuth*Math.PI/180,lx=C+(R+34)*Math.sin(a),ly=C-(R+34)*Math.cos(a);
  svg('circle',{cx:x,cy:y,r:5,fill:'var(--bg)',stroke:color,'stroke-width':2},s);
  const label=text(s,lx,ly-3,`${rise?'↑':'↓'} ${time(e.at)}`,{'text-anchor':'middle',fill:color,'font-size':12,'font-weight':600});label.setAttribute('class','alm-dome-time');
  text(s,lx,ly+11,`${dir16(e.azimuth)} ${num(e.azimuth)}°`,{'text-anchor':'middle',fill:'var(--secondary)','font-size':10});}
 if(!info.events.length&&!runs.length)text(s,C,C+4,'この日は地平線の上に出ません',{'text-anchor':'middle',fill:'var(--secondary)','font-size':12});
 const halo=svg('circle',{r:11,fill:color,opacity:.25,filter:'url(#almDomeGlow)'},s),dot=svg('circle',{r:5,fill:color,stroke:'var(--bg)','stroke-width':1.5},s);
 s.place=(alt,az)=>{const up=Number.isFinite(alt)&&alt>=0,[x,y]=pt(up?alt:0,az);for(const e of [halo,dot]){e.setAttribute('cx',x);e.setAttribute('cy',y);e.setAttribute('opacity',up?e===halo?.25:1:0);}};
 return s;
}
function render(root,day,p,events,astro,options={}){
 stop();root.replaceChildren();const end=T.addDays(day,1),minutes=Math.round((end-day)/60000);
 if(view.day!==null&&view.day!==date(day)){view.live=false;if(view.wallMinute!==null)view.minute=(T.atHour(day,Math.floor(view.wallMinute/60))+view.wallMinute%60*60000-day)/60000;}
 if(date(day)!==date(Date.now()))view.live=false;
 if(view.minute===null||view.live)view.minute=date(Date.now())===date(day)?Math.floor((Date.now()-day)/60000):(T.atHour(day,12)-day)/60000;
 view.day=date(day);view.minute=Math.max(0,Math.min(minutes-1,view.minute));
 if(getAuto()&&!view.manual)view.body=preferredBody(day+view.minute*60000,p,astro)||view.body;
 const body=view.body,name=body==='moon'?'月':'太陽';root.dataset.body=body;
 const tabs=el('div','alm-switch');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','表示する天体');
 for(const[b,label,mark]of [['sun','太陽','☀'],['moon','月','☾']]){const button=el('button','',label);button.type='button';button.dataset.body=b;button.setAttribute('aria-pressed',String(b===body));const icon=el('span','',mark);icon.setAttribute('aria-hidden','true');button.prepend(icon);button.onclick=()=>{view.manual=true;if(view.body===b)return;view.body=b;render(root,day,p,events,astro,options);root.querySelector(`[data-body="${b}"]`)?.focus({preventScroll:true});};tabs.append(button);}
 tabs.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();tabs.querySelector(`[data-body="${e.key==='ArrowLeft'?'sun':'moon'}"]`).click();};root.append(tabs);
 let d;try{d=data(day,p,events,astro);}catch{d=null;}
 if(!d||d.bodies[body].error){const box=panel(`${name}の情報を取得できませんでした`,'地点・日付を確認して再計算してください。'),retry=el('button','chip','再計算');retry.type='button';retry.onclick=()=>render(root,day,p,events,astro,options);box.append(retry);root.append(box);return;}
 const at=()=>day+view.minute*60000,info=d.bodies[body];
 const hero=el('section','alm-hero'),visual=el('div','alm-orb-stage'),portrait=el('canvas','alm-portrait');portrait.setAttribute('role','img');
 // 2026-10-19 太陽の絵は高度・時刻に関係なく常に同じ（SoramiSunPortrait）。読めなければ従来の丸を使う
 const sunCanvas=g.SoramiSunPortrait?el('canvas','alm-portrait alm-sun-portrait'):null,sun=sunCanvas||el('div','alm-solar-orb');sun.setAttribute('role','img');sun.setAttribute('aria-label','太陽のイメージ');if(sunCanvas&&body!=='moon'){try{Promise.resolve(g.SoramiSunPortrait.draw(sunCanvas)).catch(()=>{});}catch{}}
 visual.append(body==='moon'?portrait:sun);const rim=el('div','alm-orbit-rim');rim.setAttribute('aria-hidden','true');visual.append(rim);
 const content=el('div','alm-hero-copy'),kicker=el('p','alm-eyebrow',body==='moon'?'LUNAR NOTES':'SOLAR NOTES'),title=el('h2','alm-hero-title'),moment=el('p','alm-moment');
 const english=el('p','alm-phase-english'),names=el('div','alm-moon-names');
 const nameRow=el('div','alm-name-row');nameRow.append(title,english);content.append(kicker,nameRow,names,moment);const metrics=el('div','alm-metrics'),metricValues=[];
 for(const label of body==='moon'?['月齢','照明率','地球からの距離']:['昼の長さ','高度','方位']){const item=el('div','alm-metric'),value=el('strong');item.append(el('span','',label),value);metrics.append(item);metricValues.push(value);}content.append(metrics);hero.append(visual,content);root.append(hero);
 const textureStatus=el('div','alm-texture-status');textureStatus.setAttribute('role','status');root.append(textureStatus);
 const times=el('div','alm-event-pair');
 for(const[kind,label]of [['rise',body==='moon'?'月の出':'日の出'],['set',body==='moon'?'月の入り':'日の入り']]){const item=el('div','alm-event'),hits=info.events.filter(e=>e.kind===kind);item.dataset.kind=kind;item.append(el('span','alm-event-label',`${kind==='rise'?'↑':'↓'} ${label}`),el('strong','alm-event-time',hits.length?hits.map(e=>time(e.at)).join(' / '):'なし'),el('span','alm-event-direction',hits.length?hits.map(e=>`${dir16(e.azimuth)} ${num(e.azimuth)}°`).join(' / '):'この日はありません'));times.append(item);}root.append(times);
 // 2026-10-20 ユーザー「ホームからの予測・構図・地図・記録への連携、リンクを置くだけならいらない」→「消そう」：道具へのボタンは置かない（移動はメニュー）
 const grid=el('div','alm-detail-grid'),chart=panel('空をたどる',`${name}の1日の高度。0°が水平な地平線です。帯は昼・薄明・夜。`,'SKY PATH');
 // 2026-10-20 高度グラフ：太陽の高度で昼・薄明・夜の帯を敷き、地平線より上の道筋を光らせ、出入りと最も高い時刻を書き込む
 const s=svg('svg',{viewBox:'0 0 720 320',class:'alm-chart',role:'img','aria-label':`${name}の0時から24時までの高度グラフ`}),x=t=>48+(t-day)/(d.end-day)*650,y=a=>238-a*2;
 const defs=svg('defs',{},s),clip=svg('clipPath',{id:'almChartClip'},defs);svg('rect',{x:48,y:40,width:650,height:228},clip);
 const up=svg('clipPath',{id:'almChartUp'},defs);svg('rect',{x:48,y:40,width:650,height:y(0)-40},up);const down=svg('clipPath',{id:'almChartDown'},defs);svg('rect',{x:48,y:y(0),width:650,height:268-y(0)},down);
 const area=svg('linearGradient',{id:'almChartArea',x1:0,y1:0,x2:0,y2:1},defs);svg('stop',{offset:'0%','stop-color':'var(--alm-active)','stop-opacity':.32},area);svg('stop',{offset:'100%','stop-color':'var(--alm-active)','stop-opacity':0},area);
 const glow=svg('filter',{id:'almChartGlow',x:'-20%',y:'-50%',width:'140%',height:'200%'},defs);svg('feGaussianBlur',{stdDeviation:4},glow);
 const sunPts=d.bodies.sun.error?null:d.bodies.sun.points;
 if(sunPts){const band=svg('linearGradient',{id:'almChartSky',x1:0,y1:0,x2:1,y2:0},defs);for(const q of sunPts){const h=q.alt,o=h>=0?.14:h>=-6?.09:h>=-18?.04:0;svg('stop',{offset:`${((q.at-day)/(d.end-day)*100).toFixed(2)}%`,'stop-color':h>=0?'var(--alm-sky-day)':'var(--alm-sky-twilight)','stop-opacity':o},band);}svg('rect',{x:48,y:52,width:650,height:216,fill:'url(#almChartSky)'},s);}
 for(const alt of [90,60,30,-15]){svg('line',{x1:48,y1:y(alt),x2:698,y2:y(alt),stroke:'var(--alm-grid)','stroke-dasharray':'2 5'},s);text(s,40,y(alt)+6,`${alt}°`,{'text-anchor':'end',fill:'var(--secondary)','font-size':19});}
 text(s,40,y(0)+6,'0°',{'text-anchor':'end',fill:'var(--secondary)','font-size':19});
 for(let hour=0;hour<=24;hour+=3){const hx=x(T.atHour(day,hour));svg('line',{x1:hx,y1:268,x2:hx,y2:hour%6?272:276,stroke:'var(--secondary)'},s);if(hour%6===0)text(s,hx,304,`${hour}時`,{'text-anchor':'middle',fill:'var(--secondary)','font-size':19});}
 const line=info.points.map((p,i)=>(i?'L':'M')+x(p.at).toFixed(1)+','+y(p.alt).toFixed(1)).join(' ');
 svg('path',{d:`${line} L${x(info.points.at(-1).at)},${y(0)} L${x(info.points[0].at)},${y(0)} Z`,fill:'url(#almChartArea)','clip-path':'url(#almChartUp)'},s);
 svg('path',{d:line,fill:'none',stroke:'var(--alm-active)','stroke-width':7,opacity:.4,filter:'url(#almChartGlow)','clip-path':'url(#almChartUp)'},s);
 svg('path',{d:line,fill:'none',stroke:'var(--alm-active)','stroke-width':3,'stroke-linecap':'round','clip-path':'url(#almChartUp)'},s);
 svg('path',{d:line,fill:'none',stroke:'var(--alm-active)','stroke-width':1.5,opacity:.45,'stroke-dasharray':'3 6','clip-path':'url(#almChartDown)'},s);
 svg('line',{x1:48,y1:y(0),x2:698,y2:y(0),stroke:'var(--secondary)','stroke-width':1.2},s);
 for(const e of info.events){const ex=x(e.at),rise=e.kind==='rise';svg('path',{d:rise?`M${ex-6},${y(0)+9}L${ex},${y(0)+1}L${ex+6},${y(0)+9}Z`:`M${ex-6},${y(0)+1}L${ex},${y(0)+9}L${ex+6},${y(0)+1}Z`,fill:'var(--alm-active)'},s);text(s,Math.max(78,Math.min(668,ex)),y(0)+31,time(e.at),{'text-anchor':'middle',fill:'var(--alm-active)','font-size':22,'font-weight':600});}
 const peak=info.points.reduce((a,b)=>b.alt>a.alt?b:a);if(peak.alt>0){const px=x(peak.at),py=y(peak.alt);svg('line',{x1:px,y1:py-6,x2:px,y2:py-20,stroke:'var(--alm-active)'},s);text(s,Math.max(130,Math.min(620,px)),Math.max(30,py-28),`最も高い ${time(peak.at)}  ${num(peak.alt)}°`,{'text-anchor':'middle',fill:'var(--text)','font-size':20});}
 const cursor=svg('line',{y1:52,y2:268,stroke:'var(--secondary)','stroke-dasharray':'3 5'},s),halo=svg('circle',{r:13,fill:'var(--alm-active)',opacity:.3,filter:'url(#almChartGlow)','clip-path':'url(#almChartClip)'},s),dot=svg('circle',{r:6,fill:'var(--alm-active)',stroke:'var(--bg)','stroke-width':2,'clip-path':'url(#almChartClip)'},s);chart.append(s);
 const readout=el('p','alm-readout'),range=el('input','alm-range');range.type='range';range.min='0';range.max=String(minutes-1);range.step='1';range.value=String(view.minute);range.setAttribute('aria-label',`${name}を見る時刻`);
 const direction=panel('出入りの方向','中心が天頂、外周が地平線。北を上にしています。','HORIZON'),dome=compass(body,info);
 let drawGeneration=0;
 const update=()=>{
  const state=astro[body](at(),d.observer),t=time(at());view.wallMinute=new Date(at()).getHours()*60+new Date(at()).getMinutes();cursor.setAttribute('x1',x(at()));cursor.setAttribute('x2',x(at()));for(const e of [dot,halo]){e.setAttribute('cx',x(at()));e.setAttribute('cy',y(state.geometricAltitude));}dome.place(state.geometricAltitude,state.azimuth);
  let lunar=null;if(body==='moon'){try{lunar=g.SoramiLunarNames?.describe(at(),state,astro);}catch{}if(!lunar)lunar={ja:phaseLabel(state),en:''};}
  let solar=null;if(body!=='moon'){try{solar=g.SoramiSolarTerms?.describe(at())||null;}catch{}}
  title.textContent=lunar?lunar.ja:solar?solar.sekki.ja:'この日の太陽';english.textContent=lunar?.en||solar?.sekki.en||'';names.replaceChildren();kicker.hidden=false;
  if(solar){const kou=el('p','alm-solar-kou',`${solar.kou.pos}　${solar.kou.kana}`),sub=el('p','alm-solar-kou-sub',solar.next?`次の節気 ${solar.next.ja} ${date(solar.next.at).slice(5).replace('-','/')}`:'');names.append(kou,sub);}
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
 };range.oninput=()=>{view.live=false;view.minute=Math.max(0,Math.min(minutes-1,Number(range.value)));const next=getAuto()&&!view.manual?preferredBody(at(),p,astro):body;if(next&&next!==body){render(root,day,p,events,astro,options);root.querySelector('.alm-range')?.focus({preventScroll:true});}else update();};chart.append(readout,range);
 direction.append(dome);grid.append(chart,direction);root.append(grid);
 const week=panel('これから7日間',`${name}の時刻を比較。${T.zone()} の時刻です。`,'NEXT 7 DAYS'),table=el('table','alm-table'),thead=el('thead'),tr=el('tr');
 for(const label of ['日付',body==='moon'?'月の出':'日の出',body==='moon'?'月の入り':'日の入り',body==='moon'?'照明率':'昼の長さ']){const th=el('th','',label);th.scope='col';tr.append(th);}thead.append(tr);table.append(thead);const tbody=el('tbody');
 for(let n=0;n<7;n++){const dayAt=T.addDays(day,n);if(date(dayAt)>'2030-12-31')break;const row=el('tr'),th=el('th','',date(dayAt).slice(5).replace('-','/'));th.scope='row';row.append(th);let ev=null;try{ev=events(body,dayAt,p);}catch{/* no events and unavailable remain distinct */}for(const kind of ['rise','set']){const hits=ev?.filter(e=>e.kind===kind);row.append(el('td','',ev===null?'取得不能':hits.length?hits.map(e=>time(e.at)).join(' / '):'なし'));}let extra='取得不能';try{extra=body==='moon'?`${(astro.moon(T.atHour(dayAt,12),d.observer).illuminatedFraction*100).toFixed(1)}%`:ev?duration(daylight(dayAt,d.observer,ev,astro)):'取得不能';}catch{}row.append(el('td','',extra));tbody.append(row);}table.append(tbody);week.append(table);if(body==='moon')week.append(el('p','alm-caption alm-week-note','表の照明率は各日の正午。上の月はスライダーの時刻を表します。'));root.append(week);
 const detail=el('details','alm-about');detail.append(el('summary','','表示について'));detail.append(el('p','alm-caption',body==='moon'?'月面の模様は提供写真から再構成した絵を、選択した日時の月の自転軸の向きと秤動（首振り）に合わせて球に貼り直して描いています。絵の向きは NASA 科学可視化スタジオの月の画像と照合して合わせています。三日月・十六夜などの日本の夜の呼び名は、日本時で新月を含む日を1日目として数えます。十三夜は月ごとの13日目の呼称で、旧暦9月のお月見行事の判定ではありません。満ち欠けの面積と光の向きは選択した地点・日時から計算。月食の影は再現していません。細かいクレーターは再構成のため写真どおりとは限りません。新月・上弦・満月・下弦の名前は、その瞬間を含む端末のタイムゾーンの日に表示。月の絵と照明率は選択時刻の値です。満月の愛称は北米・欧米の通称。ハーベストムーンは北半球の秋分に最も近い満月、ハンターズムーンはその次。ブルームーンは同月2回目（端末のタイムゾーン）、季節のブルームーンは二分二至で区切る季節に4回ある満月の3回目。スーパームーン／マイクロムーンは統一された定義がないため、当年の地心距離範囲の近い側／遠い側10％に入る満月を目安にしています。':'太陽の絵はイメージで、高度や時刻では変わりません。時刻・高度・方位は選択した地点と日付から計算しています。二十四節気・七十二候は太陽の視黄経から求め、候の名前とよみは国立天文台 暦Wiki「七十二候」の宝暦暦以降の表に、節気の日時は国立天文台の暦要項に合わせています（2020〜2030年）。英語名は一般的な英訳です。'));root.append(detail);update();
 const refresh=()=>{
  if(!view.live||root.isConnected===false||document.hidden||options.isActive&&!options.isActive())return;
  const now=Date.now();if(date(now)!==date(day)){view.day=null;view.minute=null;view.wallMinute=null;options.onLiveDay?.();return;}
  view.minute=Math.max(0,Math.min(minutes-1,Math.floor((now-day)/60000)));range.value=String(view.minute);
  const next=getAuto()&&!view.manual?preferredBody(now,p,astro):body;if(next&&next!==body)render(root,day,p,events,astro,options);else update();
 };
 active={render:()=>render(root,day,p,events,astro,options),refresh};
 if(typeof document.addEventListener==='function')timer=setInterval(refresh,15000);
}
const api={data,render,phaseLabel,getAuto,setAuto,preferredBody,stop,enter,today,refresh:()=>active?.refresh()};g.SoramiAlmanacDashboard=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);
