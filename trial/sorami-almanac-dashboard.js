(function(g){
'use strict';
const DAY=86400000, NS='http://www.w3.org/2000/svg';
const date=t=>new Date(t+32400000).toISOString().slice(0,10);
const time=t=>new Date(t+32400000).toISOString().slice(11,16);
const number=v=>Number.isFinite(v)?v.toFixed(1):'—';
function element(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function svg(tag,attrs,parent){const e=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,String(v));if(parent)parent.append(e);return e;}
function textSVG(parent,x,y,label,attrs={}){const e=svg('text',{x,y,...attrs},parent);e.textContent=label;return e;}
function panel(title,caption){const e=element('section','alm-panel'),h=element('h2','',title);e.append(h);if(caption)e.append(element('p','alm-caption',caption));return e;}
function phaseGraphic(m){
 const s=svg('svg',{viewBox:'0 0 120 120',class:'alm-phase',role:'img','aria-label':`月の照らされている割合 ${Math.round(m.illuminatedFraction*100)}%`});
 svg('circle',{cx:60,cy:60,r:48,fill:'var(--alm-moon-dark)',stroke:'var(--alm-moon)'},s);
 const edge=[],terminator=[],f=m.illuminatedFraction;
 for(let i=0;i<=100;i++){const y=-1+2*i/100,x=Math.sqrt(Math.max(0,1-y*y));edge.push([60+(m.waxing?x:-x)*48,60+y*48]);terminator.push([60+(m.waxing?1:-1)*(1-2*f)*x*48,60+y*48]);}
 svg('path',{d:'M'+[...edge,...terminator.reverse()].map(p=>p.join(',')).join('L')+'Z',fill:'var(--alm-moon)'},s);return s;
}
function data(day,p,events,astro){
 const o={latitude:p.latitude,longitude:p.longitude,elevation:0};
 const bodies={};
 for(const body of ['sun','moon']){
  const ev=events(body,day,p),points=[];
  for(let i=0;i<=96;i++){const at=day+i*DAY/96,s=astro[body](at,o);if(!Number.isFinite(s.geometricAltitude))throw Error('Unavailable trajectory');points.push({at,alt:s.geometricAltitude,az:s.azimuth});}
  const noon=astro[body](day+DAY/2,o);bodies[body]={events:ev,points,noon};
 }
 let start=day,duration=0,above=astro.sun(day,o).upperLimbAltitude>=0;
 for(const e of bodies.sun.events){if(above)duration+=e.at-start;start=e.at;above=e.kind==='rise';}if(above)duration+=day+DAY-start;
 return {day,observer:o,bodies,daylight:duration};
}
function compass(body,info){
 const root=element('div','alm-compass-item'),title=element('h3','',body==='sun'?'太陽の出入りの方向':'月の出入りの方向');root.append(title);
 const s=svg('svg',{viewBox:'0 0 280 250',role:'img','aria-label':title.textContent});
 const color=body==='sun'?'var(--alm-sun)':'var(--alm-moon)';
 for(const r of [48,90])svg('circle',{cx:140,cy:120,r,fill:'none',stroke:'var(--alm-grid)'},s);
 svg('path',{d:'M50 120H230M140 30V210',stroke:'var(--alm-grid)'},s);
 for(const [x,y,t]of [[140,18,'北 0°'],[249,124,'東'],[140,232,'南 180°'],[28,124,'西']])textSVG(s,x,y,t,{'text-anchor':'middle',fill:'var(--secondary)','font-size':18});
 for(const e of info.events){const a=e.azimuth*Math.PI/180,x=140+90*Math.sin(a),y=120-90*Math.cos(a);svg('line',{x1:140,y1:120,x2:x,y2:y,stroke:color,'stroke-width':2,'stroke-dasharray':e.kind==='set'?'4 4':'none'},s);svg('circle',{cx:x,cy:y,r:5,fill:color},s);textSVG(s,x,y+(y<120?-12:21),`${e.kind==='rise'?'出':'入'} ${number(e.azimuth)}°`,{'text-anchor':'middle',fill:color,'font-size':18});}
 if(!info.events.length)textSVG(s,140,124,'この日は出入りなし',{'text-anchor':'middle',fill:'var(--secondary)','font-size':18});
 root.append(s);return root;
}
function render(root,day,p,events,astro){
 root.replaceChildren();let d;
 try{d=data(day,p,events,astro);}catch{root.append(element('p','alm-panel','詳しい図を計算できませんでした。地点や日付を確認して、再計算してください。'));return;}
 const summary=element('div','alm-summary');
 const duration=d.daylight/60000,hours=Math.floor(duration/60),mins=Math.floor(duration%60);
 const m=d.bodies.moon.noon;
 const items=[['昼の長さ',`${hours}時間 ${mins}分`,'太陽の上端が地平線より上にある時間'],['月齢',number(m.synodicAge),m.waxing?'満ちていく月':'欠けていく月'],['月の明るい部分',`${Math.round(m.illuminatedFraction*100)}%`,'選択日の正午の月相']];
 for(const [label,value,note]of items){const e=element('div','alm-stat');e.append(element('span','alm-caption',label),element('strong','',value),element('span','alm-caption',note));summary.append(e);}root.append(summary);
 const chart=panel('1日の高度','太陽は実線、月は破線。0°の線が水平な地平線です。');
 const legend=element('div','alm-legend');legend.append(element('span','alm-sun','— 太陽'),element('span','alm-moon','┄ 月'));chart.append(legend);
 const s=svg('svg',{viewBox:'0 0 720 280',class:'alm-chart',role:'img','aria-label':'0時から24時までの太陽と月の高度グラフ'}),x=t=>48+(t-day)/DAY*650,y=a=>232-a*2;
 svg('rect',{x:48,y:52,width:650,height:180,fill:'var(--alm-day)'},s);
 for(const alt of [90,60,30,0,-15]){const yy=y(alt);svg('line',{x1:48,y1:yy,x2:698,y2:yy,stroke:alt===0?'var(--secondary)':'var(--alm-grid)','stroke-dasharray':alt===0?'none':'3 4'},s);textSVG(s,38,yy+4,`${alt}°`,{'text-anchor':'end',fill:'var(--secondary)','font-size':20});}
 for(const hour of [0,6,12,18,24]){const xx=48+hour/24*650;textSVG(s,xx,279,`${hour}時`,{'text-anchor':'middle',fill:'var(--secondary)','font-size':20});}
 // Clip below -15° while retaining horizon crossings; a clipped path never implies it stays at the border.
 const defs=svg('defs',{},s),clip=svg('clipPath',{id:'almChartClip'},defs);svg('rect',{x:48,y:46,width:650,height:216},clip);
 for(const body of ['sun','moon']){const color=body==='sun'?'var(--alm-sun)':'var(--alm-moon)';svg('path',{d:d.bodies[body].points.map((p,i)=>(i?'L':'M')+x(p.at)+','+y(p.alt)).join(' '),fill:'none',stroke:color,'stroke-width':2.5,'stroke-dasharray':body==='moon'?'7 5':'none','clip-path':'url(#almChartClip)'},s);}
 const cursor=svg('line',{x1:0,y1:46,x2:0,y2:262,stroke:'var(--secondary)','stroke-dasharray':'3 4'},s);chart.append(s);
 const readout=element('div','alm-readout'),range=element('input','alm-range');range.type='range';range.min='0';range.max='1439';range.step='1';range.value=date(Date.now())===date(day)?String(Math.floor((Date.now()-day)/60000)):'720';range.setAttribute('aria-label','図で確認する時刻');
 const update=()=>{const at=day+Number(range.value)*60000;cursor.setAttribute('x1',x(at));cursor.setAttribute('x2',x(at));const sun=astro.sun(at,d.observer),moon=astro.moon(at,d.observer);readout.textContent=`${time(at)}　太陽 ${number(sun.geometricAltitude)}° ／ 月 ${number(moon.geometricAltitude)}°`;range.setAttribute('aria-valuetext',readout.textContent);};range.oninput=update;update();chart.append(readout,range);root.append(chart);
 const split=element('div','alm-two'),direction=panel('出入りの方位','実線は出、破線は入り。北を上にした方向図です。'),compasses=element('div','alm-compasses');
 compasses.append(compass('sun',d.bodies.sun),compass('moon',d.bodies.moon));direction.append(compasses);
 const phase=panel('この日の月','正午の月相。明るい部分の形を模式的に示しています。');phase.append(phaseGraphic(m),element('p','alm-phase-note',`月齢 ${number(m.synodicAge)} ・ 照明率 ${Math.round(m.illuminatedFraction*100)}%`));split.append(direction,phase);root.append(split);
 const week=panel('これから7日間','選択した地点での時刻を比較できます。すべて日本標準時です。');
 const wrap=element('div','alm-table-wrap'),table=element('table','alm-table'),head=element('thead'),hr=element('tr');
 for(const label of ['日付','日の出','日の入り','月の出','月の入り']){const th=element('th','',label);th.scope='col';hr.append(th);}head.append(hr);table.append(head);const tbody=element('tbody');
 for(let n=0;n<7;n++){const at=day+n*DAY;if(date(at)>'2030-12-31')break;const tr=element('tr');const th=element('th','',date(at).slice(5).replace('-','/'));th.scope='row';tr.append(th);for(const body of ['sun','moon']){let ev;try{ev=events(body,at,p);}catch{ev=null;}for(const kind of ['rise','set']){const hits=ev?.filter(e=>e.kind===kind);tr.append(element('td','',ev===null?'取得不能':hits.length?hits.map(e=>time(e.at)).join(' / '):'なし'));}}tbody.append(tr);}table.append(tbody);wrap.append(table);week.append(wrap);root.append(week);
}
const api={data,render};g.SoramiAlmanacDashboard=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);
