/* 探すの地図の作業画面。build-preview.py が試用版にだけ読み込ませる（本体は hook が空のまま動く）。
 * 計算と条件は既存の SkyMapUI のものを使い、ここは描き方と配置だけを持つ。 */
(function(g){
'use strict';
const $=id=>document.getElementById(id),JST=32400000,HOUR=3600000,RAD=Math.PI/180,LOW_SKY=.6,PASS_STEP=300000,PASS_REACH=72;
let active=false,dismissed=false,emphasis=null,hits=[],built=false,scrubBefore=null,infoFrame=0,candidateKey=null,datesOpen=false,bearingCache=null,colours=null,hourPixels=16,passCache=new Map(),labels=[],lastPick=null,pickStart=null,pointers=new Set();
const pad=n=>String(n).padStart(2,'0');
const hhmm=at=>{const d=new Date(at+JST);return pad(d.getUTCHours())+':'+pad(d.getUTCMinutes());};
const monthDay=at=>{const d=new Date(at+JST);return (d.getUTCMonth()+1)+'/'+d.getUTCDate();};
const degrees=v=>Number.isFinite(v)?v.toFixed(1)+'°':'—';
const signed=v=>Number.isFinite(v)?(v>=0?'+':'−')+Math.abs(v).toFixed(1)+'°':'—';
const host=()=>{try{return SkyMapUI?.workspaceHost?.()||null;}catch{return null;}};
const validPoint=p=>!!p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude);
// 方位は正確なまま低い空だけ広げる。等間隔では1°が2px足らずで、対象との重なりを見分けられない。
const radial=(altitude,r)=>r*(1-Math.pow(Math.max(0,Math.min(90,altitude))/90,LOW_SKY));
const polar=(azimuth,altitude,x,y,r)=>{const k=radial(altitude,r);return [x+Math.sin(azimuth*RAD)*k,y-Math.cos(azimuth*RAD)*k];};
// 航空写真の上でも読めるよう、月は既定の濃い青より明るい色で描く。
const colour=body=>{if(body==='moon')return '#a9dcff';if(body==='sun')return '#ffd166';const css=typeof getComputedStyle==='function'?getComputedStyle(document.documentElement):null,name=body==='moon'?'--ray-moon':body==='sun'?'--ray-sun':'--ray-extra';return css?.getPropertyValue(name).trim()||({sun:'#ff981f',moon:'#aad8ff'})[body]||'#8ce5b0';};
// 出は明るく入は濃く。線と縁の点と情報欄の上辺で同じ色を使い、どの線がどの数字か追えるようにする。
const RISE={sun:'#ff9b3d',moon:'#6fb8ff'},SET={sun:'#e5484d',moon:'#2f6fe0'};
function halo(ctx,text,x,y,fill,font){ctx.save();ctx.font=font;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=3.5;ctx.strokeStyle='rgba(0,0,0,.92)';ctx.strokeText(text,x,y);ctx.fillStyle=fill;ctx.fillText(text,x,y);ctx.restore();}
function targetGeometry(h){
 const s=h.session,t=s.target;if(!h.targetOn||!validPoint(t)||!s.eye)return null;
 const key=JSON.stringify([t.id,t.latitude,t.longitude,s.partId,s.eye]);if(bearingCache?.key===key)return bearingCache.value;
 let value=null;try{const geo=AstroNotesAlign.geometryFrom(s.eye,t,{partId:s.partId,eyeM:0});if(geo)value={azimuth:geo.azimuth,distanceKm:geo.distanceKm,elevation:AstroNotesAstro.targetElevationAngle(geo.distanceKm,s.eye.elevation,geo.topM,{k:1})};}catch{value=null;}
 bearingCache={key,value};return value;
}
// 地図と情報欄の主役。探す条件の天体は変えない（変えると重なる日時の計算をやり直すことになる）。
const mainBody=h=>emphasis||h.session.body;
function chooseBody(body){
 const h=host();if(!h||body===mainBody(h))return;emphasis=body;
 const toggle=$(body==='sun'?'skyMapShowSun':'skyMapShowMoon');if(toggle?.getAttribute('aria-pressed')==='false')toggle.click();
 for(const page of $('mapWsInfo').children)page.classList.toggle('map-ws-current',page.dataset.body===body);
 h.redraw();schedule();
}
function dailyOf(h,body){const s=h.session;if(s.dailies?.[body])return s.dailies[body];if(!s.eye||s.timelinePending)return null;try{return AstroNotesSkyMap.daily(body,AstroNotesSkyMap.dayStart(s.at),s.eye,h.skyState);}catch{return null;}}
// 日付で切らず、地平線から地平線までの1回の通り道を返す。日をまたぐ月でも軌道が円の縁まで届く。
function passesOf(h,body,data){
 const s=h.session,day=data.points[0].at,key=[body,day,s.eye.latitude,s.eye.longitude,s.eye.elevation].join();let list=passCache.get(key);if(list)return list;
 const alt=at=>h.skyState(body,at,s.eye),row=at=>{const v=alt(at);return {at,azimuth:v.azimuth,altitude:v.altitude};};
 const edge=(lo,hi)=>{const rising=alt(hi).altitude>=0;for(let n=0;n<14;n++){const mid=(lo+hi)/2;if((alt(mid).altitude>=0)===rising)hi=mid;else lo=mid;}const at=(lo+hi)/2;return {at,azimuth:alt(at).azimuth,altitude:0};};
 const runs=[];let run=null;for(const p of data.points){if(p.altitude>=0)(run||(runs.push(run=[]),run)).push(p);else run=null;}
 list=runs.map(points=>{
  const out=[...points];let rise=null,set=null;
  const first=out[0],last=out.at(-1),start=data.points[0],end=data.points.at(-1);
  if(first===start){let at=first.at,n=0;for(;n<PASS_REACH;n++){const p=row(at-PASS_STEP);if(p.altitude<0){rise=edge(p.at,at);break;}out.unshift(p);at=p.at;}}
  else{const i=data.points.indexOf(first);rise=edge(data.points[i-1].at,first.at);}
  if(last===end){let at=last.at,n=0;for(;n<PASS_REACH;n++){const p=row(at+PASS_STEP);if(p.altitude<0){set=edge(p.at,at);break;}out.push(p);at=p.at;}}
  else{const i=data.points.indexOf(last);set=edge(data.points[i+1].at,last.at);}
  if(rise)out.unshift(rise);if(set)out.push(set);
  return {points:out,rise,set,events:[]};
 });
 passCache.set(key,list);if(passCache.size>8)passCache.delete(passCache.keys().next().value);return list;
}
function passAt(h,body,data){const at=h.session.at,list=passesOf(h,body,data);return list.find(p=>p.points[0].at<=at&&at<=p.points.at(-1).at)||list.find(p=>p.points[0].at>at)||list.at(-1)||null;}
function rimDot(ctx,azimuth,x,y,r,fill,size=4.6,stroke='#000'){const a=azimuth*RAD,px=x+Math.sin(a)*r,py=y-Math.cos(a)*r;ctx.beginPath();ctx.arc(px,py,size,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();ctx.lineWidth=1.6;ctx.strokeStyle=stroke;ctx.stroke();}
function drawBody(ctx,body,data,x,y,r,width,height){
 const h=host();if(!h)return;
 const main=(h.shownBodies().includes(mainBody(h))?mainBody(h):h.session.body)===body||h.shownBodies().length===1,tint=colours[body]||(colours[body]=colour(body)),far=Math.hypot(width,height);
 ctx.save();ctx.globalAlpha=main?1:.7;ctx.lineCap='round';
 const pass=passAt(h,body,data);
 if(pass){
  if(main){ctx.beginPath();pass.points.forEach((p,i)=>{const a=p.azimuth*RAD,px=x+Math.sin(a)*r,py=y-Math.cos(a)*r;i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.strokeStyle='rgba(0,0,0,.8)';ctx.lineWidth=7;ctx.stroke();ctx.strokeStyle=tint;ctx.lineWidth=4;ctx.stroke();}
  for(const [event,lineTint,dash] of [[pass.rise,RISE[body]||tint,[]],[pass.set,SET[body]||tint,[9,6]]]){if(!event)continue;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.sin(event.azimuth*RAD)*far,y-Math.cos(event.azimuth*RAD)*far);ctx.setLineDash(dash);ctx.strokeStyle='rgba(0,0,0,.85)';ctx.lineWidth=main?6:5;ctx.stroke();ctx.strokeStyle=lineTint;ctx.lineWidth=main?3:2.5;ctx.stroke();ctx.setLineDash([]);}
  ctx.beginPath();pass.points.forEach((p,i)=>{const q=polar(p.azimuth,p.altitude,x,y,r);i?ctx.lineTo(...q):ctx.moveTo(...q);});ctx.strokeStyle='rgba(0,0,0,.72)';ctx.lineWidth=main?6.5:5;ctx.stroke();ctx.strokeStyle=tint;ctx.lineWidth=main?3.4:2.4;ctx.stroke();
  for(const p of pass.points){if((p.at+JST)%HOUR||p.altitude<1.5)continue;const q=polar(p.azimuth,p.altitude,x,y,r);ctx.beginPath();ctx.arc(q[0],q[1],main?4.2:3.2,0,Math.PI*2);ctx.fillStyle=tint;ctx.fill();ctx.lineWidth=1.2;ctx.strokeStyle='#000';ctx.stroke();hits.push({x:q[0],y:q[1],at:p.at});const d=Math.hypot(q[0]-x,q[1]-y)||1,lx=q[0]+(q[0]-x)/d*14,ly=q[1]+(q[1]-y)/d*14;if(d<22||labels.some(v=>Math.hypot(v[0]-lx,v[1]-ly)<17))continue;labels.push([lx,ly]);halo(ctx,String(new Date(p.at+JST).getUTCHours()),lx,ly,tint,'700 12px system-ui');}
  const geo=targetGeometry(h);
  if(geo)for(const point of AstroNotesSkyMap.passages(pass,geo.azimuth,body,h.session.eye,h.skyState)){const q=polar(geo.azimuth,point.altitude,x,y,r);ctx.save();ctx.translate(q[0],q[1]);ctx.rotate(Math.PI/4);ctx.fillStyle='#fff';ctx.strokeStyle='#000';ctx.lineWidth=1.5;ctx.fillRect(-4.5,-4.5,9,9);ctx.strokeRect(-4.5,-4.5,9,9);ctx.restore();hits.push({x:q[0],y:q[1],at:point.at});}
  if(pass.rise)rimDot(ctx,pass.rise.azimuth,x,y,r,RISE[body]||tint);if(pass.set)rimDot(ctx,pass.set.azimuth,x,y,r,SET[body]||tint);
 }
 // いまの方向は中心から縁まで伸ばし、縁に点を打つ。地平線の下なら縁の暗い点だけにする。
 const st=h.bodyState(body),p=polar(st.azimuth,st.altitude,x,y,r);
 if(st.altitude<0)rimDot(ctx,st.azimuth,x,y,r,'#111',main?5.4:4.4,tint);
 else{const a=st.azimuth*RAD,rx=x+Math.sin(a)*r,ry=y-Math.cos(a)*r;ctx.globalAlpha=main?1:.8;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(rx,ry);ctx.strokeStyle='rgba(0,0,0,.75)';ctx.lineWidth=main?5.5:4;ctx.stroke();ctx.strokeStyle=tint;ctx.lineWidth=main?2.6:2;ctx.stroke();rimDot(ctx,st.azimuth,x,y,r,tint,main?5.4:4.4);AstroNotesSceneAppearance.aimLookDisc(ctx,p[0],p[1],main?13:9,body,{illuminated:st.illuminatedFraction,brightLimbZenithAngle:st.brightLimbZenithAngle});}
 ctx.restore();
}
// 軌道がこの丸を通れば、天体は対象に重なる。
// 撮影地点を固定している間は地図を動かさない。つまんでも指の中点でずれないよう中心へ戻す。
function holdCenter(){const h=host();if(!h||h.pickMode||!validPoint(h.session.observer))return;const o=h.session.observer,c=h.map.center();if(Math.abs(c.latitude-o.latitude)>1e-9||Math.abs(c.longitude-o.longitude)>1e-9)h.map.setCenter(o.latitude,o.longitude);}
// ピンの近くを押しても移動の操作に入らない。動かすのは右のボタンから。
function pinNear(pixel){const h=host();if(!h)return false;const near=p=>{const q=h.map.project(p.latitude,p.longitude);return Math.hypot(q[0]-pixel.x,q[1]-pixel.y)<20;};return near(h.session.observer)||(validPoint(h.session.target)&&near(AstroNotesAlign.partTarget(h.session.target,h.session.partId)));}
function drawOverlay(ctx,x,y,r){
 const h=host();if(!h)return;
 if(h.pickMode==='target'){const w=ctx.canvas.clientWidth/2,c=ctx.canvas.clientHeight/2;ctx.save();ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(w,c);ctx.setLineDash([9,6]);ctx.lineWidth=5;ctx.strokeStyle='rgba(0,0,0,.85)';ctx.stroke();ctx.lineWidth=2.6;ctx.strokeStyle='#c876ff';ctx.stroke();ctx.restore();return;}
 const geo=targetGeometry(h);if(!geo)return;
 const q=polar(geo.azimuth,Math.max(0,geo.elevation),x,y,r);ctx.save();ctx.beginPath();ctx.arc(q[0],q[1],7.5,0,Math.PI*2);ctx.fillStyle='rgba(200,118,255,.25)';ctx.fill();ctx.lineWidth=3;ctx.strokeStyle='#000';ctx.stroke();ctx.lineWidth=1.8;ctx.strokeStyle='#fff';ctx.stroke();ctx.restore();
}
const center=(ctx,x,y)=>{ctx.save();ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fillStyle='#3ddc6a';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#000';ctx.stroke();ctx.restore();};
function schedule(){if(infoFrame||!active)return;infoFrame=requestAnimationFrame(()=>{infoFrame=0;if(active)update();});}
const api={
 hourPixels:()=>active?hourPixels:0,
 // 描画のたびに呼ばれる。作業画面でないときは null を返し、既存の描き方に任せる。
 drawing(){if(!active){if(!dismissed)queueMicrotask(evaluate);return null;}holdCenter();hits=[];labels=[];colours={};schedule();return {radius:(width,height)=>Math.min(width-120,height-30)/2,body:drawBody,overlay:drawOverlay,center};},
 hits:()=>hits,
 tap(pixel){if(!active)return false;let best=null,distance=22;for(const hit of hits){const d=Math.hypot(hit.x-pixel.x,hit.y-pixel.y);if(d<distance){distance=d;best=hit;}}if(best){host()?.setTime(best.at);return true;}return pinNear(pixel);},
};
g.AstroNotesMapWorkspace=api;

const ICON={back:'<path d="M15 5l-7 7 7 7"/>',share:'<path d="M12 15V4m0 0L8 8m4-4l4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/>'};
const svg=d=>`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const cell=(id,label,accent,button)=>`<${button?'button type="button"':'div'} class="map-ws-cell" id="${id}" style="--ws-c:${accent}"><small>${label}</small><b></b><i></i><i></i></${button?'button':'div'}>`;
function build(){
 if(built)return;built=true;const view=$('skyMapView'),footer=view.querySelector('.sky-map-footer'),wrap=view.querySelector('.sky-map-wrap');
 const top=document.createElement('header');top.id='mapWsTop';top.className='map-ws-top';
 top.innerHTML=`<button type="button" id="mapWsBack" aria-label="条件へ戻る">${svg(ICON.back)}</button><button type="button" id="mapWsTitle" class="map-ws-title" aria-label="条件を変更"><strong></strong><span></span></button><div class="map-ws-seg" role="group" aria-label="結果の表示"><button type="button" id="mapWsScene" aria-pressed="false">見え方</button><button type="button" aria-pressed="true">地図</button></div><button type="button" id="mapWsShare" aria-label="保存と共有" aria-haspopup="menu">${svg(ICON.share)}</button>`;
 view.append(top);
 const menu=document.createElement('div');menu.id='mapWsMenu';menu.className='map-ws-menu';menu.setAttribute('role','menu');menu.hidden=true;view.append(menu);
 const bodies=document.createElement('button');bodies.type='button';bodies.id='mapWsBodies';bodies.className='map-ctl map-ws-bodies';bodies.textContent='天体';bodies.setAttribute('aria-label','表示する天体を選ぶ');bodies.setAttribute('aria-haspopup','menu');wrap.append(bodies);
 const pick=document.createElement('div');pick.id='mapWsPick';pick.className='map-ws-pick';pick.hidden=true;pick.innerHTML='<span role="status"><span></span><span></span></span><button type="button" id="mapWsPickCancel">取消</button><button type="button" id="mapWsPickDone">ここに置く</button>';wrap.append(pick);
 $('mapWsPickCancel').onclick=()=>{const h=host();if(!h)return;const before=h.pickMode==='observer'?pickStart:null;h.cancelPick();if(before&&before!==h.session.observer){h.restoreObserver(before);h.map.setCenter(before.latitude,before.longitude);}};$('mapWsPickDone').onclick=()=>{const mode=host()?.pickMode;if(mode)$(mode==='observer'?'skyMapObserverTool':'skyMapTargetTool').click();};
 bindGestures(wrap);
 // 現在地へ飛ぶのは撮影地点を動かす操作。固定のままだと中心へ戻される。
 wrap.querySelector('.map-locate')?.addEventListener('click',()=>{if(active&&!host()?.pickMode)$('skyMapObserverTool').click();},true);
 const info=document.createElement('div');info.id='mapWsInfo';info.className='map-ws-info';info.tabIndex=0;info.setAttribute('aria-label','天体と対象の情報。横にスワイプ');
 const page=(body,cells)=>`<div class="map-ws-page"${body?` data-body="${body}"`:''}>${cells.join('')}</div>`;
 info.innerHTML=page('sun',[cell('wsSun','太陽',colour('sun')),cell('wsSunRise','日の出',RISE.sun,1),cell('wsSunSet','日の入',SET.sun,1)])
  +page('moon',[cell('wsMoon','月',colour('moon')),cell('wsMoonRise','月の出',RISE.moon,1),cell('wsMoonSet','月の入',SET.moon,1)])
  +page(null,[cell('wsTarget','対象','#c876ff'),cell('wsGap','ずれ（方位）','#c876ff'),cell('wsPass','対象の通過','#c876ff',1)])
  +page(null,[cell('wsDawn','朝の薄明','#7d8fe6',1),cell('wsGolden','夕方の低い光','var(--ray-sun)',1),cell('wsDusk','夕方の薄明','#7d8fe6',1)])
  +'<div class="map-ws-page" id="wsDates"></div>';
 const dots=document.createElement('div');dots.id='mapWsDots';dots.className='map-ws-dots';dots.setAttribute('aria-hidden','true');dots.innerHTML='<span></span>'.repeat(5);
 footer.prepend(info,dots);
 const band=document.createElement('canvas');band.id='mapWsBand';band.className='map-ws-band';band.setAttribute('aria-hidden','true');$('skyMapTrack').append(band);
 $('mapWsBack').onclick=$('mapWsTitle').onclick=()=>{dismissed=true;const viaHistory=history.state?.mapWs;exit();if(viaHistory)history.back();openConditions();};
 $('mapWsScene').onclick=()=>$('exploreSceneTab')?.click();
 $('mapWsShare').onclick=e=>{e.stopPropagation();const row=$('skyMapShareRow');openMenu(e.currentTarget,[...row.querySelectorAll('button')].filter(b=>!b.hidden));};
 bodies.onclick=e=>{e.stopPropagation();openMenu(e.currentTarget,[$('skyMapShowSun'),$('skyMapShowMoon'),$('skyMapMoreBodies')]);};
 document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!e.target.closest('#mapWsMenu,#mapWsShare,#mapWsBodies'))menu.hidden=true;});
 info.addEventListener('scroll',()=>{const pages=info.children,i=Math.round(info.scrollLeft/(info.clientWidth||1));[...dots.children].forEach((d,k)=>d.classList.toggle('on',k===i));if(pages[i]?.dataset.body)chooseBody(pages[i].dataset.body);},{passive:true});
 info.addEventListener('click',e=>{if(e.target.closest('button'))return;const body=e.target.closest('[data-body]')?.dataset.body;if(body)chooseBody(body);});
 dots.firstElementChild.classList.add('on');
 for(const button of info.querySelectorAll('button.map-ws-cell'))button.addEventListener('click',()=>{const at=+button.dataset.at;if(Number.isFinite(at)&&at)host()?.setTime(at);});
 if(typeof ResizeObserver==='function')new ResizeObserver(()=>{if(!footer.offsetHeight)return;view.style.setProperty('--ws-footer-h',footer.offsetHeight+'px');if(active){const h=host();if(h&&measureHours()&&h.session.scrubMode==='hour')rebuildTimeline(h,'hour');h?.redraw();}}).observe(footer);
}
// 既存の釦を動かさず、押した結果だけ渡す。状態と権限の判定を2か所に持たない。
function openMenu(anchor,buttons){
 const menu=$('mapWsMenu');menu.replaceChildren();
 for(const source of buttons){if(!source)continue;const item=document.createElement('button');item.type='button';item.setAttribute('role','menuitem');item.disabled=!!source.disabled;item.textContent=source.getAttribute('aria-label')||source.textContent.trim();const pressed=source.getAttribute('aria-pressed');if(pressed!==null){item.setAttribute('role','menuitemcheckbox');item.setAttribute('aria-checked',pressed);}item.onclick=()=>{menu.hidden=true;source.click();};menu.append(item);}
 const r=anchor.getBoundingClientRect();menu.style.top=Math.round(r.bottom+4)+'px';menu.hidden=false;menu.style.right=Math.max(8,Math.round(innerWidth-r.left+6-(anchor.id==='mapWsShare'?r.width+6:0)))+'px';
}
function openConditions(){const c=$('exploreConditions');if(c)c.open=true;scrollTo(0,0);}
function setCell(id,main,sub,sub2,at){const c=$(id);if(!c)return;const [b,i1,i2]=[c.querySelector('b'),...c.querySelectorAll('i')];if(b.textContent!==main)b.textContent=main;if(i1.textContent!==(sub||''))i1.textContent=sub||'';if(i2.textContent!==(sub2||''))i2.textContent=sub2||'';if(c.tagName==='BUTTON'){c.dataset.at=Number.isFinite(at)?String(at):'';c.disabled=!Number.isFinite(at);}}
function crossing(points,level,rising){for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];if((a.altitude<level)===rising&&(b.altitude<level)!==rising)return a.at+(level-a.altitude)/(b.altitude-a.altitude)*(b.at-a.at);}return null;}
function updateBody(h,body,prefix){
 const s=h.session,data=dailyOf(h,body),st=s.eye?h.skyState(body,s.at,s.eye):null;
 setCell(prefix,st?degrees(st.azimuth):'—',st?'高度 '+signed(st.altitude):'',body==='sun'?(st&&st.altitude>.5?'影 '+(1/Math.tan(st.altitude*RAD)).toFixed(1)+'倍':'影 —'):(st?'輝面 '+Math.round(st.illuminatedFraction*100)+'%':''));
 const pass=data?passAt(h,body,data):null;for(const [side,id] of [['rise',prefix+'Rise'],['set',prefix+'Set']]){const e=pass?.[side];setCell(id,e?hhmm(e.at):'—',e?degrees(e.azimuth):'',e&&AstroNotesSkyMap.dayStart(e.at)!==AstroNotesSkyMap.dayStart(s.at)?monthDay(e.at):'',e?.at);}
}
function bearingText(from,to){if(!validPoint(from)||!validPoint(to))return '';const a=from.latitude*RAD,b=to.latitude*RAD,d=(to.longitude-from.longitude)*RAD,bearing=(Math.atan2(Math.sin(d)*Math.cos(b),Math.cos(a)*Math.sin(b)-Math.sin(a)*Math.cos(b)*Math.cos(d))/RAD+360)%360,km=AstroNotesTerrain.distanceKm(from.latitude,from.longitude,to.latitude,to.longitude);return (km<1?Math.round(km*1000)+'m':km.toFixed(2)+'km')+' ・ '+bearing.toFixed(1)+'°';}
function updatePick(h){
 const bar=$('mapWsPick'),mode=h.pickMode||null,s=h.session;
 if(mode!==lastPick){pickStart=mode==='observer'?s.observer:null;lastPick=mode;}
 bar.hidden=!mode;if(!mode)return;
 const center=h.map.center(),mark=validPoint(s.target)?AstroNotesAlign.partTarget(s.target,s.partId):null;
 const text=mode==='observer'?['地図を動かすと撮影地点が動きます',h.targetOn&&mark?bearingText(center,mark):'']:['地図を動かして対象を合わせる',bearingText(s.observer,center)];
 const [a,b]=bar.querySelectorAll('span span');if(a.textContent!==text[0])a.textContent=text[0];if(b.textContent!==text[1])b.textContent=text[1];
 $('mapWsPickDone').textContent=mode==='observer'?'固定':'ここに置く';
}
// 撮影地点を動かしている間は、指を離すたびにその場所で計算し直す。対象はそのまま残る。
function bindGestures(wrap){
 const canvas=$('skyMapCanvas');
 wrap.addEventListener('pointerdown',e=>{if(e.target===canvas)pointers.add(e.pointerId);},true);
 const end=e=>{if(!pointers.delete(e.pointerId)||pointers.size||!active)return;setTimeout(()=>{const h=host();if(!h||h.pickMode!=='observer')return;const c=h.map.center(),o=h.session.observer;if(Math.abs(c.latitude-o.latitude)>1e-7||Math.abs(c.longitude-o.longitude)>1e-7)h.placePoint('observer',c);},0);};
 wrap.addEventListener('pointerup',end,true);wrap.addEventListener('pointercancel',end,true);
}
function updateDates(){
 const box=$('skyMapDates'),buttons=[...box.querySelectorAll('[data-from-at]')],more=box.querySelector('[data-from-more]'),note=box.querySelector('.tiny,[role=status],.candidate-empty')?.textContent?.trim()||(box.textContent.trim()?'':'計算しています'),key=JSON.stringify([buttons.map(b=>b.dataset.fromAt),!!more,more?.disabled,note,datesOpen]);
 if(key===candidateKey)return;candidateKey=key;const page=$('wsDates');page.replaceChildren();
 const add=(label,main,sub,click,accent='#c876ff')=>{const c=document.createElement(click?'button':'div');if(click){c.type='button';c.onclick=click;}c.className='map-ws-cell';c.style.setProperty('--ws-c',accent);for(const [tag,text] of [['small',label],['b',main],['i',sub]]){const n=document.createElement(tag);n.textContent=text||'';c.append(n);}page.append(c);};
 for(const b of buttons.slice(0,2)){const at=+b.dataset.fromAt;add('重なる日時',monthDay(at),hhmm(at),()=>host()?.setTime(at));}
 if(!buttons.length)add('重なる日時',more?'候補なし':'—',note?note.slice(0,24):'');
 if(!buttons.length&&more)add('探す期間','先を探す','',()=>more.click());
 add('一覧',datesOpen?'閉じる':'開く',buttons.length?buttons.length+'件':'',()=>{datesOpen=!datesOpen;$('skyMapView').classList.toggle('map-ws-dates-open',datesOpen);updateDates();});
}
function drawBand(h){
 const c=$('mapWsBand'),s=h.session;if(s.scrubMode!=='hour'||!s.eye){c.hidden=true;return;}c.hidden=false;
 const width=c.clientWidth,height=c.clientHeight,ratio=Math.min(2,devicePixelRatio||1);if(!width)return;if(c.width!==Math.round(width*ratio)){c.width=Math.round(width*ratio);c.height=Math.round(height*ratio);}
 const ctx=c.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);const per=hourPixels/HOUR,start=s.at-width/2/per,tint=colour('moon');
 for(let x=0;x<width;x+=4){const at=start+x/per;let up=false;try{up=h.skyState('moon',at,s.eye).altitude>0;}catch{}if(up){ctx.fillStyle=tint;ctx.fillRect(x,height-5,4,5);}}
 const geo=targetGeometry(h);if(geo){for(const body of h.shownBodies()){const data=dailyOf(h,body),route=data?passAt(h,body,data):null;if(!route)continue;for(const pass of AstroNotesSkyMap.passages(route,geo.azimuth,body,s.eye,h.skyState)){const x=(pass.at-start)*per;if(x<0||x>width)continue;ctx.save();ctx.translate(x,height-11);ctx.rotate(Math.PI/4);ctx.fillStyle='#c876ff';ctx.strokeStyle='#000';ctx.fillRect(-3,-3,6,6);ctx.strokeRect(-3,-3,6,6);ctx.restore();}}}
}
function update(){
 const h=host();if(!h){evaluate();return;}const s=h.session,mainId=mainBody(h),body=AstroNotesBodies.definitions.find(d=>d.id===mainId)?.name||'天体',title=$('mapWsTitle');
 const name=(/^-?[\d.]+, -?[\d.]+$/.test(s.observer?.name||'')?'撮影地点':s.observer?.name||'撮影地点')+(Number.isFinite(s.ground)?' ・ '+Math.round(s.ground)+'m':''),sub=body+' × '+(s.target?.name||'対象なし');
 if(title.firstChild.textContent!==name)title.firstChild.textContent=name;if(title.lastChild.textContent!==sub)title.lastChild.textContent=sub;
 updateBody(h,'sun','wsSun');updateBody(h,'moon','wsMoon');
 const geo=targetGeometry(h);setCell('wsTarget',geo?degrees(geo.azimuth):'—',geo?'仰角 '+geo.elevation.toFixed(2)+'°':'対象を選ぶと出ます',geo?(geo.distanceKm<1?Math.round(geo.distanceKm*1000)+'m':geo.distanceKm.toFixed(2)+'km'):'');
 $('wsTarget').querySelector('small').textContent=s.target?.name||'対象';
 const main=s.eye?(()=>{try{return h.skyState(mainId,s.at,s.eye);}catch{return null;}})():null;
 setCell('wsGap',geo&&main?signed(AstroNotesSkyMap.delta(main.azimuth,geo.azimuth)):'—',geo&&main?'高度 '+signed(main.altitude-geo.elevation):'',body);
 const data=dailyOf(h,mainId),route=data?passAt(h,mainId,data):null,pass=geo&&route?AstroNotesSkyMap.passages(route,geo.azimuth,mainId,s.eye,h.skyState)[0]:null;setCell('wsPass',pass?hhmm(pass.at):geo&&data?'なし':'—',pass?'高度 '+pass.altitude.toFixed(1)+'°':'','',pass?.at);
 const sun=dailyOf(h,'sun');if(sun){const dawn=crossing(sun.points,-6,true),golden=crossing(sun.points,6,false),dusk=crossing(sun.points,-6,false);setCell('wsDawn',dawn?hhmm(dawn):'—','太陽 高度−6°','',dawn);setCell('wsGolden',golden?hhmm(golden):'—','太陽 高度6°','',golden);setCell('wsDusk',dusk?hhmm(dusk):'—','太陽 高度−6°','',dusk);}
 updatePick(h);updateDates();drawBand(h);
}
function shouldShow(){const view=$('skyMapView');return !dismissed&&!!view&&!view.hidden&&view.classList.contains('explore-mounted')&&view.dataset.exploreMode==='map'&&!$('skyMapContent')?.hidden&&validPoint(host()?.session?.observer);}
function evaluate(){const show=shouldShow();if(show&&!active)enter();else if(!show&&active)exit();}
// 帯の幅がちょうど24時間になる縮尺
function measureHours(){const width=$('skyMapTrack')?.clientWidth||0,next=width?Math.max(12,width/24):hourPixels;if(Math.abs(next-hourPixels)<.01)return false;hourPixels=next;return true;}
function rebuildTimeline(h,mode){const other=mode==='time'?'hour':'time';h.setScrubMode(other);h.setScrubMode(mode);}
function enter(){
 const h=host();if(!h)return;build();active=true;candidateKey=null;const view=$('skyMapView');view.classList.add('map-ws');
 if(!view.querySelector('.sky-map-wrap').classList.contains('sky-map-wide'))$('skyMapExpand').click();
 scrubBefore=h.session.scrubMode;measureHours();rebuildTimeline(h,'hour');
 try{if(store.get('sorami.mapLayer',null)===null)h.map.setLayer?.('photo',false);}catch{}
 // 撮影地点の周りを見る画面なので、遠くを見ていた続きで開いても円が地図に合う縮尺へ戻す。
 const o=h.session.observer;if(h.map.zoom()<12)h.map.setView(o.latitude,o.longitude,14);else h.map.setCenter(o.latitude,o.longitude);
 if(!history.state?.mapWs)history.pushState({...(history.state||{}),mapWs:1},'',location.href);
 view.style.setProperty('--ws-footer-h',view.querySelector('.sky-map-footer').offsetHeight+'px');
 // 条件の天体の欄から始める
 const info=$('mapWsInfo'),first=h.session.body==='moon'?1:0;emphasis=['sun','moon'].includes(h.session.body)?h.session.body:null;info.scrollLeft=info.clientWidth*first;for(const page of info.children)page.classList.toggle('map-ws-current',page.dataset.body===emphasis);
 h.redraw();schedule();
}
function exit(){
 active=false;datesOpen=false;emphasis=null;lastPick=null;pickStart=null;pointers.clear();if(host()?.pickMode)host().cancelPick();const view=$('skyMapView');view.classList.remove('map-ws','map-ws-dates-open');$('mapWsMenu').hidden=true;candidateKey=null;
 const h=host();if(view.querySelector('.sky-map-wrap')?.classList.contains('sky-map-wide')&&h)$('skyMapExpand').click();
 if(h&&scrubBefore&&scrubBefore!==h.session.scrubMode)h.setScrubMode(scrubBefore);else if(h)rebuildTimeline(h,h.session.scrubMode);
 scrubBefore=null;h?.redraw();
}
function init(){
 const view=$('skyMapView');if(!view)return;
 new MutationObserver(evaluate).observe(view,{attributes:true,attributeFilter:['hidden','class','data-explore-mode']});
 document.addEventListener('click',e=>{if(e.target.closest?.('#exploreMapTab,#exploreShowResult')){dismissed=false;queueMicrotask(evaluate);}},true);
 addEventListener('popstate',()=>{if(active&&!history.state?.mapWs){dismissed=true;exit();openConditions();}else if(!active&&history.state?.mapWs){dismissed=false;evaluate();}});
 evaluate();
}
init();
})(typeof globalThis!=='undefined'?globalThis:this);
