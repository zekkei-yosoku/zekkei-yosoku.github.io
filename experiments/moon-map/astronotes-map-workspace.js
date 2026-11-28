/* 探すの地図の作業画面。
 * 計算と条件は既存の SkyMapUI のものを使い、ここは描き方と配置だけを持つ。
 * 2026-11-26 trial（段階①）: 探すを開くとこの全画面地図が既定。上部は条件帯（押すと撮影条件のポップアップ）、
 * 方位円の縁は対象の位置、軌道は出→最高点→入の3点を通る円弧で、条件の天体だけを同じ太さで描く。
 * カードに実際に重なる時間と見え方の入口を置く。ユーザー「一旦この方向でトライアル反映まで進めて」 */
(function(g){
'use strict';
const $=id=>document.getElementById(id),JST=32400000,HOUR=3600000,RAD=Math.PI/180,LOW_SKY=.6,PASS_STEP=300000,PASS_REACH=288,EYE_HEIGHT=1.5;
let keptView=null,overlapCache={key:'',windows:null,pending:'',ready:'',timer:0},active=false,wanted=false,selfClick=false,fittedKey=null,hits=[],built=false,scrubBefore=null,infoFrame=0,bearingCache=null,colours=null,hourPixels=16,passCache=new Map(),labels=[],sceneFull=false,sceneHidden=[],noticeTimer=0,lastBody=null;
const pad=n=>String(n).padStart(2,'0');
const hhmm=at=>{const d=new Date(at+JST);return pad(d.getUTCHours())+':'+pad(d.getUTCMinutes());};
const monthDay=at=>{const d=new Date(at+JST);return (d.getUTCMonth()+1)+'/'+d.getUTCDate();};
const degrees=v=>Number.isFinite(v)?v.toFixed(1)+'°':'—';
const signed=v=>Number.isFinite(v)?(v>=0?'+':'−')+Math.abs(v).toFixed(1)+'°':'—';
const host=()=>{try{return SkyMapUI?.workspaceHost?.()||null;}catch{return null;}};
const validPoint=p=>!!p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude);
// 方位は正確なまま低い空だけ広げる。等間隔では1°が2px足らずで、対象との重なりを見分けられない。
const radial=(altitude,r)=>r*(1-Math.pow(Math.max(0,Math.min(90,altitude))/90,LOW_SKY));
// 地図を回しても方位の線が地図と揃うよう、画面の角度へ直す。
const dir=azimuth=>(azimuth-(host()?.map.rotation()||0))*RAD;
const polar=(azimuth,altitude,x,y,r)=>{const k=radial(altitude,r);return [x+Math.sin(dir(azimuth))*k,y-Math.cos(dir(azimuth))*k];};
// 航空写真の上でも読めるよう、月は既定の濃い青より明るい色で描く。
const colour=body=>{if(body==='moon')return '#a9dcff';if(body==='sun')return '#ffd166';const css=typeof getComputedStyle==='function'?getComputedStyle(document.documentElement):null,name=body==='moon'?'--ray-moon':body==='sun'?'--ray-sun':'--ray-extra';
return css?.getPropertyValue(name).trim()||({sun:'#ff981f',moon:'#aad8ff'})[body]||'#8ce5b0';};
// 出は明るく入は濃く。線と縁の点と情報欄の上辺で同じ色を使い、どの線がどの数字か追えるようにする。
const RISE={sun:'#ff9b3d',moon:'#6fb8ff'},SET={sun:'#e5484d',moon:'#2f6fe0'};
function halo(ctx,text,x,y,fill,font){ctx.save();ctx.font=font;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=3.5;ctx.strokeStyle='rgba(0,0,0,.92)';ctx.strokeText(text,x,y);ctx.fillStyle=fill;ctx.fillText(text,x,y);ctx.restore();}
function targetGeometry(h){
 const s=h.session,t=s.target;if(!h.targetOn||!validPoint(t)||!s.eye)return null;
 const key=JSON.stringify([t.id,t.latitude,t.longitude,s.partId,s.eye,t.parts?.map(p=>p.m)]);if(bearingCache?.key===key)return bearingCache.value;
 let value=null;try{const geo=AstroNotesAlign.geometryFrom(s.eye,t,{partId:s.partId,eyeM:0});if(geo)value={azimuth:geo.azimuth,distanceKm:geo.distanceKm,elevation:AstroNotesAstro.targetElevationAngle(geo.distanceKm,s.eye.elevation,geo.topM,{k:1})};}catch{value=null;}
 bearingCache={key,value};return value;
}
// 選択の正本は撮影条件。地図の釦も既存selectの変更処理（権限・保存・再計算）を通す。
const mainBody=h=>h.session.body;
function chooseBody(body){
 const h=host(),select=$('skyMapBody'),option=select&&[...select.options].find(o=>o.value===body);if(!h||!option||option.disabled||option.hidden)return;
 if(h.session.body!==body){select.value=body;select.dispatchEvent(new Event('change',{bubbles:true}));}
 $('mapWsInfo').scrollLeft=0;schedule();
}
const pointBody=body=>!!AstroNotesBodies.definition(body)&&!AstroNotesBodies.definition(body).limbs;
const nightAllowed=(body,at,observer,angularMargin=0)=>AstroNotesShooting.nightAllowed(body,at,observer,AstroNotesBodies,angularMargin);
// 撮影地点が未選択の時だけ、天体情報と時刻バーの表示基準に対象付近を使う。
function targetSkyPoint(h=host()){
 if(!active||!h||validPoint(h.session.observer)||!targetReady(h))return null;
 const t=h.session.target;
 return {latitude:t.latitude,longitude:t.longitude,elevation:Number.isFinite(t.groundM)?t.groundM:0};
}
const useMapSky=h=>active&&!!h&&!h.pickMode&&!validPoint(h.session.observer)&&!targetReady(h);
let mapSkyEye=null,mapSkyTimer=0;
function resetMapSky(){
 clearTimeout(mapSkyTimer);mapSkyTimer=0;mapSkyEye=null;
}
function mapSkyPoint(h=host()){
 if(!useMapSky(h)){if(mapSkyEye)resetMapSky();return null;}
 const point=h.map.center();
 // Approximate height for the free map preview. Do not fetch terrain or set an observer.
 if(!mapSkyEye)mapSkyEye={...point,elevation:0};
 // The crosshair stays centered on every frame. Limit day calculations while panning.
 if(!mapSkyTimer&&(point.latitude!==mapSkyEye.latitude||point.longitude!==mapSkyEye.longitude)){
  mapSkyTimer=setTimeout(()=>{
   mapSkyTimer=0;
   const next=host();
   if(!useMapSky(next)){resetMapSky();return;}
   mapSkyEye={...next.map.center(),elevation:0};
   next.syncTimeline();next.redraw();
  },100);
 }
 return mapSkyEye;
}
function previewSkyPoint(h=host()){return mapSkyPoint(h)||targetSkyPoint(h);}
function dailyOf(h,body,eye=h.session.eye){
 const s=h.session;
 if(eye===s.eye){
  if(s.dailies?.[body])return s.dailies[body];
  if(s.timelinePending||body===s.body)return null;
 }
 if(!eye||pointBody(body)&&!AstroNotesBodies.ready())return null;
 try{return AstroNotesSkyMap.daily(body,AstroNotesSkyMap.dayStart(s.at),eye,h.skyState);}catch{return null;}
}
// 日付で切らず、地平線から地平線までの1回の通り道を返す。日をまたぐ月でも軌道が円の縁まで届く。
function passesOf(h,body,data,eye=h.session.eye){
 const day=data.points[0].at,key=[body,day,eye.latitude,eye.longitude,eye.elevation].join();let list=passCache.get(key);if(list)return list;
 const alt=at=>h.skyState(body,at,eye),row=at=>{const v=alt(at);return {at,azimuth:v.azimuth,altitude:v.altitude};};
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
function passAt(h,body,data,eye){const at=h.session.at,list=passesOf(h,body,data,eye);return list.find(p=>p.points[0].at<=at&&at<=p.points.at(-1).at)||list.find(p=>p.points[0].at>at)||list.at(-1)||null;}
function drawHorizonRays(ctx,body,pass,x,y,far,tint,main=true){
 ctx.save();ctx.lineCap='round';
 for(const [event,color,dash] of [[pass.rise,RISE[body]||tint,[]],[pass.set,SET[body]||tint,[9,6]]]){
  if(!event)continue;
  const angle=dir(event.azimuth);
  ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.sin(angle)*far,y-Math.cos(angle)*far);
  ctx.setLineDash(dash);ctx.strokeStyle='rgba(0,0,0,.85)';ctx.lineWidth=main?6:5;ctx.stroke();
  ctx.strokeStyle=color;ctx.lineWidth=main?3:2.5;ctx.stroke();
 }
 ctx.restore();
}
function rimDot(ctx,azimuth,x,y,r,fill,size=4.6,stroke='#000'){const a=dir(azimuth),px=x+Math.sin(a)*r,py=y-Math.cos(a)*r;ctx.beginPath();ctx.arc(px,py,size,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();ctx.lineWidth=1.6;ctx.strokeStyle=stroke;ctx.stroke();}
// 出→最高点→入の3点を通る円弧。投影上の最高点が弦に乗る冬の太陽でも、弦長の22%は最高点の方位側へ膨らませる（試作と同じ）。
function bulge(P0,P1,Pm,C,E){const mx=(P0[0]+P1[0])/2,my=(P0[1]+P1[1])/2,L=Math.hypot(P1[0]-P0[0],P1[1]-P0[1])||1;let nx=-(P1[1]-P0[1])/L,ny=(P1[0]-P0[0])/L;if(nx*(E[0]-C[0])+ny*(E[1]-C[1])<0){nx=-nx;ny=-ny;}
 const sag=(Pm[0]-mx)*nx+(Pm[1]-my)*ny,min=.22*L;return sag>=min?Pm:[mx+nx*min,my+ny*min];}
function arcOf(points,x,y,r){
 const f=points[0],l=points.at(-1),pk=points.reduce((m,p)=>p.altitude>m.altitude?p:m,f);
 const P0=polar(f.azimuth,f.altitude,x,y,r),P1=polar(l.azimuth,l.altitude,x,y,r),Pm=bulge(P0,P1,polar(pk.azimuth,pk.altitude,x,y,r),[x,y],polar(pk.azimuth,0,x,y,r)),t0=f.at,t1=l.at,tm=Math.min(Math.max(pk.at,t0+1),t1-1);
 const [ax,ay]=P0,[bx,by]=Pm,[cx,cy]=P1,d=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by));
 const frac=t=>t<=tm?(t-t0)/(tm-t0)*.5:.5+(t-tm)/(t1-tm)*.5;
 if(Math.abs(d)<1e-6||t1<=t0){const at=t=>{const k=Math.max(0,Math.min(1,(t-t0)/((t1-t0)||1)));return [ax+(cx-ax)*k,ay+(cy-ay)*k];};return {t0,t1,at,path:()=>[P0,P1]};}
 const ux=((ax*ax+ay*ay)*(by-cy)+(bx*bx+by*by)*(cy-ay)+(cx*cx+cy*cy)*(ay-by))/d,uy=((ax*ax+ay*ay)*(cx-bx)+(bx*bx+by*by)*(ax-cx)+(cx*cx+cy*cy)*(bx-ax))/d,R=Math.hypot(ax-ux,ay-uy);
 const ang=(px,py)=>Math.atan2(py-uy,px-ux),a0=ang(ax,ay),am=ang(bx,by),a1=ang(cx,cy),T=Math.PI*2,norm=v=>((v%T)+T)%T;
 let sm=norm(am-a0),s1=norm(a1-a0);if(sm>s1){sm-=T;s1-=T;}
 const pt=k=>{const a=k<=.5?a0+sm*(k/.5):a0+sm+(s1-sm)*((k-.5)/.5);return [ux+Math.cos(a)*R,uy+Math.sin(a)*R];};
 return {t0,t1,at:t=>pt(Math.max(0,Math.min(1,frac(t)))),path:()=>Array.from({length:61},(_,i)=>pt(i/60))};
}
// 全画面の探す地図以外（通常の地図）は本番と同じ描き方。
function drawBodyTrue(ctx,body,data,x,y,r,width,height){
 const h=host();if(!h)return;
 const main=(h.shownBodies().includes(mainBody(h))?mainBody(h):h.session.body)===body||h.shownBodies().length===1,tint=colours[body]||(colours[body]=colour(body)),far=Math.hypot(width,height);
 ctx.save();ctx.globalAlpha=main?1:.7;ctx.lineCap='round';
 const pass=passAt(h,body,data);
 if(pass){
  if(main){ctx.beginPath();pass.points.forEach((p,i)=>{const a=dir(p.azimuth),px=x+Math.sin(a)*r,py=y-Math.cos(a)*r;i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.strokeStyle='rgba(0,0,0,.8)';ctx.lineWidth=7;ctx.stroke();ctx.strokeStyle=tint;ctx.lineWidth=4;ctx.stroke();}
  drawHorizonRays(ctx,body,pass,x,y,far,tint,main);
  ctx.beginPath();pass.points.forEach((p,i)=>{const q=polar(p.azimuth,p.altitude,x,y,r);i?ctx.lineTo(...q):ctx.moveTo(...q);});ctx.strokeStyle='rgba(0,0,0,.72)';ctx.lineWidth=main?6.5:5;ctx.stroke();ctx.strokeStyle=tint;ctx.lineWidth=main?3.4:2.4;ctx.stroke();
  for(const p of pass.points){if((p.at+JST)%HOUR||p.altitude<1.5)continue;const q=polar(p.azimuth,p.altitude,x,y,r);ctx.beginPath();ctx.arc(q[0],q[1],main?4.2:3.2,0,Math.PI*2);ctx.fillStyle=tint;ctx.fill();ctx.lineWidth=1.2;ctx.strokeStyle='#000';ctx.stroke();hits.push({x:q[0],y:q[1],at:p.at});
  const d=Math.hypot(q[0]-x,q[1]-y)||1,lx=q[0]+(q[0]-x)/d*14,ly=q[1]+(q[1]-y)/d*14;if(d<22||labels.some(v=>Math.hypot(v[0]-lx,v[1]-ly)<17))continue;labels.push([lx,ly]);halo(ctx,String(new Date(p.at+JST).getUTCHours()),lx,ly,tint,'700 12px system-ui');}
  const geo=targetGeometry(h);
  if(geo)for(const point of AstroNotesSkyMap.passages(pass,geo.azimuth,body,h.session.eye,h.skyState)){const q=polar(geo.azimuth,point.altitude,x,y,r);ctx.save();ctx.translate(q[0],q[1]);ctx.rotate(Math.PI/4);ctx.fillStyle='#fff';ctx.strokeStyle='#000';ctx.lineWidth=1.5;ctx.fillRect(-4.5,-4.5,9,9);
  ctx.strokeRect(-4.5,-4.5,9,9);ctx.restore();hits.push({x:q[0],y:q[1],at:point.at});}
  if(pass.rise)rimDot(ctx,pass.rise.azimuth,x,y,r,RISE[body]||tint);if(pass.set)rimDot(ctx,pass.set.azimuth,x,y,r,SET[body]||tint);
 }
 // いまの方向は中心から縁まで伸ばし、縁に点を打つ。地平線の下なら縁の暗い点だけにする。
 const st=h.bodyState(body),p=polar(st.azimuth,st.altitude,x,y,r);
 if(st.altitude<0)rimDot(ctx,st.azimuth,x,y,r,'#111',main?5.4:4.4,tint);
 else{const a=dir(st.azimuth),rx=x+Math.sin(a)*r,ry=y-Math.cos(a)*r;ctx.globalAlpha=main?1:.8;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(rx,ry);ctx.strokeStyle='rgba(0,0,0,.75)';ctx.lineWidth=main?5.5:4;ctx.stroke();ctx.strokeStyle=tint;ctx.lineWidth=main?2.6:2;ctx.stroke();
 rimDot(ctx,st.azimuth,x,y,r,tint,main?5.4:4.4);AstroNotesSceneAppearance.aimLookDisc(ctx,p[0],p[1],main?13:9,body,{illuminated:st.illuminatedFraction,brightLimbZenithAngle:st.brightLimbZenithAngle});}
 ctx.restore();
}
// 目標方位を通過する印は、弧が撮影地点→対象の線と交わる所に置く（時刻は計算値のまま）。
function arcCross(arc,azimuth,x,y,r){const a=dir(azimuth),ux=Math.sin(a),uy=-Math.cos(a),pts=arc.path();let best=null;
 for(let i=1;i<pts.length;i++){const [p,q]=[pts[i-1],pts[i]],side=v=>(v[0]-x)*uy-(v[1]-y)*ux,sp=side(p),sq=side(q);if(sp*sq>0)continue;const k=sp===sq?0:sp/(sp-sq),c=[p[0]+(q[0]-p[0])*k,p[1]+(q[1]-p[1])*k];
 if((c[0]-x)*ux+(c[1]-y)*uy<0)continue;const d=Math.hypot(c[0]-x,c[1]-y);if(d<=r+1&&(!best||d>best.d))best={c,d};}return best?.c||null;}
function drawOrbitPath(ctx,arc,tint){
 ctx.save();ctx.lineCap='round';ctx.beginPath();
 arc.path().forEach((q,i)=>i?ctx.lineTo(...q):ctx.moveTo(...q));
 ctx.strokeStyle='rgba(0,0,0,.72)';ctx.lineWidth=6.5;ctx.stroke();
 ctx.strokeStyle=tint;ctx.lineWidth=3.4;ctx.stroke();ctx.restore();
}
function drawBody(ctx,body,data,x,y,r,width,height,centerEye){
 if(!active)return drawBodyTrue(ctx,body,data,x,y,r,width,height);
 const h=host();if(!h)return;
 // 地図の段では条件の天体だけを描く（上部の月/太陽と連動）。太陽と月は同じ太さ・濃さ。
 if(active&&body!==h.session.body)return;
 const tint=colours[body]||(colours[body]=colour(body)),far=Math.hypot(width,height);
 ctx.save();ctx.lineCap='round';
 const eye=centerEye||h.session.eye,pass=passAt(h,body,data,eye),arc=pass&&pass.points.length>1?arcOf(pass.points,x,y,r):null;
 if(pass){
  drawHorizonRays(ctx,body,pass,x,y,far,tint);
  if(arc&&orbitVisible[centerEye?'center':'obs']){drawOrbitPath(ctx,arc,tint);
  for(const p of pass.points){if((p.at+JST)%HOUR||p.altitude<1.5)continue;const q=arc.at(p.at);ctx.beginPath();ctx.arc(q[0],q[1],4.2,0,Math.PI*2);ctx.fillStyle=tint;ctx.fill();ctx.lineWidth=1.2;ctx.strokeStyle='#000';ctx.stroke();hits.push({x:q[0],y:q[1],at:p.at});
  const d=Math.hypot(q[0]-x,q[1]-y)||1,lx=q[0]+(q[0]-x)/d*14,ly=q[1]+(q[1]-y)/d*14;if(d<22||labels.some(v=>Math.hypot(v[0]-lx,v[1]-ly)<17))continue;labels.push([lx,ly]);halo(ctx,String(new Date(p.at+JST).getUTCHours()),lx,ly,tint,'700 12px system-ui');}
  const geo=targetGeometry(h);
  if(geo)for(const point of AstroNotesSkyMap.passages(pass,geo.azimuth,body,h.session.eye,h.skyState)){const q=arcCross(arc,geo.azimuth,x,y,r)||arc.at(point.at);ctx.save();ctx.translate(q[0],q[1]);ctx.rotate(Math.PI/4);ctx.fillStyle='#fff';ctx.strokeStyle='#000';ctx.lineWidth=1.5;ctx.fillRect(-4.5,-4.5,9,9);
  ctx.strokeRect(-4.5,-4.5,9,9);ctx.restore();hits.push({x:q[0],y:q[1],at:point.at});}}
  if(pass.rise)rimDot(ctx,pass.rise.azimuth,x,y,r,RISE[body]||tint);if(pass.set)rimDot(ctx,pass.set.azimuth,x,y,r,SET[body]||tint);
 }
 // いまの位置は弧の上（出〜最高点・最高点〜入で時刻を按分）。方向の線はその点を通って縁まで。地平線の下なら縁の暗い点だけにする。
 const st=h.bodyState(body,eye),now=h.session.at,onArc=arc&&st.altitude>=0&&now>=arc.t0&&now<=arc.t1;
 if(!onArc)rimDot(ctx,st.azimuth,x,y,r,'#111',5.4,tint);
 else{const p=arc.at(now),len=Math.hypot(p[0]-x,p[1]-y)||1,rx=x+(p[0]-x)/len*r,ry=y+(p[1]-y)/len*r;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(rx,ry);ctx.strokeStyle='rgba(0,0,0,.75)';ctx.lineWidth=5.5;ctx.stroke();ctx.strokeStyle=tint;ctx.lineWidth=2.6;ctx.stroke();
 ctx.beginPath();ctx.arc(rx,ry,5.4,0,Math.PI*2);ctx.fillStyle=tint;ctx.fill();ctx.lineWidth=1.6;ctx.strokeStyle='#000';ctx.stroke();
 AstroNotesSceneAppearance.aimLookDisc(ctx,p[0],p[1],13,body,{illuminated:st.illuminatedFraction,brightLimbZenithAngle:st.brightLimbZenithAngle});}
 ctx.restore();
}
// 軌道がこの丸を通れば、天体は対象に重なる。
// ピンの近くを押しても移動の操作に入らない。動かすのは右のボタンから。
function pinNear(pixel){const h=host();if(!h)return false;const near=p=>{const q=h.map.project(p.latitude,p.longitude);return Math.hypot(q[0]-pixel.x,q[1]-pixel.y)<20;};
return (validPoint(h.session.observer)&&near(h.session.observer))||(validPoint(h.session.target)&&near(AstroNotesAlign.partTarget(h.session.target,h.session.partId)));}
function drawOverlay(ctx,x,y,r){
 const h=host();if(!h)return;
 // 三脚とピンが置く先。地図が撮影地点から離れている間だけ出す。
 if(active){const w=ctx.canvas.clientWidth/2,c=ctx.canvas.clientHeight/2;if(!validPoint(h.session.observer)||Math.hypot(w-x,c-y)>8){ctx.save();ctx.lineCap='round';for(const [style,width] of [['rgba(0,0,0,.9)',4],['#fff',1.8]]){ctx.strokeStyle=style;ctx.lineWidth=width;ctx.beginPath();
 ctx.moveTo(w-11,c);ctx.lineTo(w+11,c);ctx.moveTo(w,c-11);ctx.lineTo(w,c+11);ctx.stroke();}ctx.restore();}}
 // 円弧の軌道では対象仰角の丸は意味を持たないので描かない（縁が対象の位置）。
 if(active)return;
 const geo=targetGeometry(h);if(!geo)return;
 const q=polar(geo.azimuth,Math.max(0,geo.elevation),x,y,r);ctx.save();ctx.beginPath();ctx.arc(q[0],q[1],7.5,0,Math.PI*2);ctx.fillStyle='rgba(200,118,255,.25)';ctx.fill();ctx.lineWidth=3;ctx.strokeStyle='#000';ctx.stroke();ctx.lineWidth=1.8;ctx.strokeStyle='#fff';ctx.stroke();ctx.restore();
}
const center=(ctx,x,y)=>{ctx.save();ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fillStyle='#3ddc6a';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#000';ctx.stroke();ctx.restore();};
function schedule(){if(infoFrame||!active)return;infoFrame=requestAnimationFrame(()=>{infoFrame=0;if(active)update();});}
const fitRadius=(width,height)=>active?Math.min(width-120,height-30)/2:Math.min(width,height)*.36;
// 方位円の縁は対象の位置（半径＝撮影地点から対象までの地図上の距離）。拡大・縮小しても縁に対象が乗る。
function radius(width,height){
 const h=host(),s=h?.session,o=s?.observer,t=s?.target;if(!active||!h||!validPoint(o)||!h.targetOn||!validPoint(t))return fitRadius(width,height);
 const m=AstroNotesAlign.partTarget(t,s.partId),a=h.map.project(o.latitude,o.longitude),b=h.map.project(m.latitude,m.longitude),d=Math.hypot(b[0]-a[0],b[1]-a[1]);
 return Number.isFinite(d)?Math.max(36,d):fitRadius(width,height);
}
// ---- 2026-11-26 trial（段階②）: 目標物が中心の表示 ----
// 目標物を中心に方位リング、重なる範囲（全体）の帯、天体の中心が先端に来る線と時刻、記録の地点の重なり、新しい地点のピンを描く。
// 線は構図の地図と同じ AstroNotesAlign.line、記録の重なりは段階①のカードと同じ prepareDailyView の外形判定。帯だけは幾何で広めに拾う。
let searchBandCache={key:'',band:null},viewMode='obs',targetSel=null,lineState={key:'',lines:null,busy:false},bandState={key:'',base:'',runs:[],pending:'',timer:0},recordState={key:'',rows:null,busy:false},targetFitKey='',placingName=null,tapHits=[];
const orbitVisible={obs:true,target:false,center:true};
const GOLD='#f2c35e',NEW_PIN='#5fd08f',RECORD_PIN='#9fb4d0';
const isTarget=()=>active&&viewMode==='target';
const fmtAt=at=>hhmm(at);
function targetReady(h){const s=h.session;return h.targetOn&&validPoint(s.target)&&Number.isFinite(s.at);}
function linePart(s){return s.partId==='__whole'||!s.partId?'__whole':s.partId;}
const LINE_AHEAD_DELAY=240,LINE_CACHE_LIMIT=7,LINE_CACHE_MS=600000;
const completedLines=new Map();
let aheadLine=null,aheadTimer=0,lineDirection=1;
function targetKey(h,day=AstroNotesSkyMap.dayStart(h.session.at)){
 const s=h.session,t=s.target;
 return JSON.stringify([s.body,day,t?.id,t?.latitude,t?.longitude,t?.parts?.map(p=>[p.id,p.m,p.latitude,p.longitude]),linePart(s),s.eyeM??EYE_HEIGHT]);
}
const lineAir=()=>AstroNotesAtmosphere?.dataKey?.()??'';
function lineCacheKey(key,air){return key+'|'+air;}
function savedLine(key,air){
 const entry=completedLines.get(lineCacheKey(key,air));
 return entry&&entry.expires>Date.now()?entry:null;
}
function stopLineAhead(){clearTimeout(aheadTimer);aheadLine=null;}
function stopTargetLine(){
 stopLineAhead();
 if(lineState.busy)lineState={key:'',lines:null,busy:false};
}
function makeLine(h,day,air){
 const s=h.session;
 return {key:targetKey(h,day),day,air,body:s.body,target:s.target,partId:linePart(s),eyeM:s.eyeM??EYE_HEIGHT,lines:null,busy:true};
}
function prepareLineAhead(){
 const h=host(),current=lineState;
 if(!isTarget()||!h||!targetReady(h)||current.key!==targetKey(h)||current.busy||current.error||candidateSheet())return;
 clearTimeout(aheadTimer);
 aheadTimer=setTimeout(()=>{
  const h=host();
  if(!isTarget()||!h||!targetReady(h)||lineState!==current||current.key!==targetKey(h)||current.air!==lineAir()||document.hidden||candidateSheet())return;
  const day=current.day+24*HOUR*lineDirection,key=targetKey(h,day);
  if(savedLine(key,current.air)||aheadLine?.key===key)return;
  aheadLine=makeLine(h,day,current.air);void solveLine(aheadLine);
 },LINE_AHEAD_DELAY);
}
// A cached terrain response resolves in a microtask. Give drawing and input a real turn.
function workCooperation(){
 let deadline=performance.now()+8,pending=null;
 return ()=>{
  if(pending||performance.now()<deadline)return pending;
  pending=new Promise(resolve=>setTimeout(()=>{deadline=performance.now()+8;pending=null;resolve();},0));
  return pending;
 };
}
async function solveLine(job){
 const {target,body,day,partId,eyeM}=job;
 const wanted=()=>isTarget()&&(lineState===job||aheadLine===job&&!document.hidden&&!candidateSheet());
 const elevationAt=typeof groundAt==='function'?(lat,lon)=>groundAt(lat,lon):null;
 try{
  await AstroNotesBodies.ensure(body);
  if(!wanted())return;
  const h=host();
  if(lineState===job&&pointBody(body)&&targetSkyPoint(h)){h?.syncTimeline();schedule();}
  const lines=await AstroNotesAlign.line(target,body,day,{partId,limb:'center',eyeM,elevationAt,isCurrent:wanted,cooperate:workCooperation()});
  if(!wanted()||job.air!==lineAir())return;
  const visible=[];
  for(const l of lines||[]){
   let run=null;
   for(const p of l.points){
    const observer={latitude:p.latitude,longitude:p.longitude,elevation:(p.elevationM??p.groundM??0)+eyeM};
    if(Number.isFinite(p.at)&&nightAllowed(body,p.at,observer))(run||(visible.push(run={side:l.side,points:[]}),run)).points.push(p);
    else run=null;
   }
  }
  job.lines=visible.filter(l=>l.points.length>1);job.busy=false;job.expires=Date.now()+LINE_CACHE_MS;
  const key=lineCacheKey(job.key,job.air);
  completedLines.delete(key);completedLines.set(key,job);
  if(completedLines.size>LINE_CACHE_LIMIT)completedLines.delete(completedLines.keys().next().value);
  if(lineState===job){host()?.redraw();schedule();prepareLineAhead();}
 }catch(e){
  if(lineState!==job)return;
  globalThis.AstroNotesErrors?.note('map.targetLine',e);job.lines=[];job.busy=false;job.error=true;host()?.redraw();schedule();
  document.dispatchEvent(new Event('astronotes-search-band-change'));
 }finally{
  if(aheadLine===job)aheadLine=null;
  if(lineState===job&&job.busy){lineState={key:'',lines:null,busy:false};host()?.redraw();schedule();}
 }
}
// 天体の中心が対象の先端に来る確定線。地形と計算法は既存の AstroNotesAlign.line を使う。
function lineFor(h){
 const day=AstroNotesSkyMap.dayStart(h.session.at),key=targetKey(h,day),air=lineAir();
 if(lineState.key===key&&lineState.air===air)return lineState.lines;
 const cached=savedLine(key,air),prepared=aheadLine?.key===key&&aheadLine.air===air?aheadLine:null;
 if(Number.isFinite(lineState.day)&&day!==lineState.day)lineDirection=Math.sign(day-lineState.day);
 stopLineAhead();
 clearTimeout(bandState.timer);bandState={key:'',base:'',runs:[],pending:'',timer:0};searchBandCache={key:'',band:null};
 lineState=cached||prepared||makeLine(h,day,air);
 if(cached)prepareLineAhead();
 else if(!prepared)void solveLine(lineState);
 return lineState.lines;
}
// 大気差の余裕（Bennett式。地平線付近で約0.5°、最大0.6°）。幾何で拾う時だけ広めに取るために使う。
const refraction=a=>{const h=Math.max(-1,a);return Math.min(.6,Math.max(0,1/Math.tan((h+7.31/(h+4.4))*RAD)/60));};
// 線の標高（ならした地面）を距離で引く。線が無い・届かない距離は0m。
function lineElevation(lines,bearing,distanceKm,target){
 let best=null;for(const l of lines||[]){const p=l.points[Math.floor(l.points.length/2)],b=AstroNotesTerrain.bearing(target.latitude,target.longitude,p.latitude,p.longitude),d=Math.abs(AstroNotesSkyMap.delta(b,bearing));if(!best||d<best.d)best={d,l};}
 if(!best||best.d>60)return 0;const pts=best.l.points;let lo=pts[0],hi=pts.at(-1);for(const p of pts){if(p.distanceKm<=distanceKm&&(!lo||p.distanceKm>=lo.distanceKm))lo=p;if(p.distanceKm>=distanceKm&&(!hi||p.distanceKm<=hi.distanceKm))hi=p;}
 const e=p=>Number.isFinite(p?.groundM)?p.groundM:Number.isFinite(p?.elevationM)?p.elevationM:0;if(!lo||!hi||hi.distanceKm===lo.distanceKm)return e(lo||hi);return e(lo)+(e(hi)-e(lo))*(distanceKm-lo.distanceKm)/(hi.distanceKm-lo.distanceKm);
}
// 重なる範囲（全体）: 1分ごとに、目標物の所での天体の幾何高度・方位・視半径から、反対方位の線上で
// 「目の高さ＋その距離の地面」から見た対象の上端の仰角 ≧ 天体の下端−大気差の余裕 となる距離までを扇形にし、
// ±(視半径＋余裕＋対象の横幅の見かけ)で和集合する。方位は子午線の収束を直す（撮影地点から見た対象の方位＝天体の方位）。
// 計算は日が止まってから1回（1日で数十〜百ms）。その間は同じ対象・日の前の帯を出す。
function bandTopM(s){const t=s.target;if(linePart(s)==='__whole'){const v=(t.parts||[]).map(p=>p.m).filter(Number.isFinite);if(v.length)return Math.max(...v);}
 try{return AstroNotesAlign.geometryFrom({latitude:t.latitude+.01,longitude:t.longitude,elevation:0},t,{partId:linePart(s),eyeM:0})?.topM;}catch{return null;}}
function bandHalfWidthKm(s,topM){
 const t=s.target;if(typeof aimIsMountain==='function'&&aimIsMountain(t))return .5;
 try{const sample=AstroNotesTerrain.destination(t.latitude,t.longitude,180,10),v=AstroNotesAlign.heightVertices?.({...sample,elevation:0},t,{partId:linePart(s),eyeM:EYE_HEIGHT})?.vertices||[];
  const az=v.map(q=>q[0]).filter(Number.isFinite);if(az.length>1){const spread=Math.max(...az.map(a=>Math.abs(AstroNotesSkyMap.delta(a,az[0]))))*2;return Math.max(pointBody(s.body)?0:.02,Math.tan(spread/2*RAD)*10);}}catch{/* 外形の無い対象は細い柱として扱う */}
 return .03;
}
// 探索用の帯は広めに保ち、表示だけを各地点・時刻の薄明境界で切る。
// 1分の隣接扇形を小さな面に分けるので、対象が昼でも遠方の夜部分は残せる。
function nightBandShape(body,target,raw,L,R,eyeM){
 const vertex=(p,at)=>({latitude:p.latitude,longitude:p.longitude,at,elevation:eyeM}),inside=p=>nightAllowed(body,p.at,p);
 const centers=raw.map(x=>vertex(target,x.at)),left=L.map((p,i)=>vertex(p,raw[i].at)),right=R.map((p,i)=>vertex(p,raw[i].at));
 const states=new Map(),allowed=p=>{if(!states.has(p))states.set(p,inside(p));return states.get(p);};
 const crossing=(a,b)=>{let yes=allowed(a)?a:b,no=allowed(a)?b:a;for(let k=0;k<20;k++){const longitude=yes.longitude+((no.longitude-yes.longitude+540)%360-180)/2,mid={latitude:(yes.latitude+no.latitude)/2,longitude:(longitude+540)%360-180,at:(yes.at+no.at)/2,elevation:eyeM};if(inside(mid))yes=mid;else no=mid;}return yes;};
 const clip=points=>{const out=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],aa=allowed(a),bb=allowed(b);if(aa)out.push(a);if(aa!==bb)out.push(crossing(a,b));}return out.length>=3?out:[];};
 const polygons=[],outlines=[];
 for(let i=1;i<raw.length;i++)for(const points of [[centers[i-1],left[i-1],left[i],centers[i]],[centers[i-1],right[i-1],right[i],centers[i]],[left[i-1],left[i],right[i],right[i-1]]]){const p=clip(points);if(p.length)polygons.push(p);}
 const edge=[...left,...right.slice().reverse()];for(let i=0;i<edge.length;i++){const a=edge[i],b=edge[(i+1)%edge.length],aa=allowed(a),bb=allowed(b);if(aa||bb)outlines.push([aa?a:crossing(a,b),bb?b:crossing(a,b)]);}
 return {polygons,outlines};
}
async function computeBand(h,{cooperate,isCurrent}={}){
 const s={...h.session},t=s.target,day=AstroNotesSkyMap.dayStart(s.at),eyeM=Number.isFinite(s.eyeM)?s.eyeM:EYE_HEIGHT,lines=lineState.key===targetKey(h)?lineState.lines:null,runs=[],topM=bandTopM(s);
 if(!Number.isFinite(topM))return [];
 const hw=bandHalfWidthKm(s,topM),maxKm=Math.min(150,AstroNotesAlign.lineRange?AstroNotesAlign.lineRange(topM).maxKm*1.4:150),here={latitude:t.latitude,longitude:t.longitude,elevation:topM};
 const tipAt=(bearing,d)=>AstroNotesAstro.targetElevationAngle(d,lineElevation(lines,bearing,d,t)+eyeM,topM,{k:1});let run=null;
 // 撮影地点から見た対象の方位が az になる、目標物からの方位（行きと帰りの方位は経度差×sin緯度ずれる）
 const back=(az,d)=>{let b=(az+180)%360;for(let k=0;k<3;k++){const p=AstroNotesTerrain.destination(t.latitude,t.longitude,b,d),seen=AstroNotesTerrain.bearing(p.latitude,p.longitude,t.latitude,t.longitude),miss=AstroNotesSkyMap.delta(az,seen);if(Math.abs(miss)<1e-4)break;b=(b+miss+360)%360;}return b;};
 for(let m=0;m<=1440;m+=1){
  const pause=m%8===0&&cooperate?.();
  if(pause){await pause;if(!isCurrent())return [];}
  const at=day+m*60000;let st;try{st=h.skyState(s.body,at,here);}catch{run=null;continue;}
  // 探索の種は最大距離ぶんの太陽高度差を許して拾う。実際の地点・時刻の最終判定はnightAllowed。
  if(!nightAllowed(s.body,at,here,maxKm/6371/RAD)){run=null;continue;}
  const a=st.altitude,r=pointBody(s.body)?0:Number.isFinite(st.angularRadius)?st.angularRadius:0,margin=refraction(a),need=a-r-margin;let bearing=(st.azimuth+180)%360,d=null;
  if(a+r+margin>=-.3&&tipAt(bearing,.3)>=need){if(tipAt(bearing,maxKm)>=need)d=maxKm;else{let lo=.3,hi=maxKm;for(let i=0;i<28;i++){const mid=(lo+hi)/2;if(tipAt(bearing,mid)>=need)lo=mid;else hi=mid;}d=lo;}}
  if(d){bearing=back(st.azimuth,d);(run||(runs.push(run=[]),run)).push({at,bearing,d,w:pointBody(s.body)?0:r+margin*.2+.03,hw});}else run=null;
 }
 const dest=(b,d)=>AstroNotesTerrain.destination(t.latitude,t.longitude,b,d),wAt=(x,d)=>x.w+Math.atan(x.hw/Math.max(d,.05))/RAD;
 return runs.filter(q=>q.length>1).map(q=>{const L=q.map(x=>dest(x.bearing-wAt(x,x.d),x.d)),R=q.map(x=>dest(x.bearing+wAt(x,x.d),x.d));return {t0:q[0].at,t1:q.at(-1).at,L,R,raw:q,...(pointBody(s.body)?nightBandShape(s.body,t,q,L,R,eyeM):{})};});
}
function bandFor(h){
 if(lineState.key!==targetKey(h)||lineState.busy||lineState.error)return [];
 const base=targetKey(h),key=base+'|'+(lineState.key===base&&lineState.lines?'line':'flat');if(bandState.key===key)return bandState.runs;
 if(bandState.pending!==key){
  clearTimeout(bandState.timer);
  const entry=bandState;entry.pending=key;
  entry.timer=setTimeout(async()=>{
   const isCurrent=()=>{const hh=host();return isTarget()&&!!hh&&bandState===entry&&entry.pending===key&&targetKey(hh)===base;};
   try{
    if(!isCurrent())return;
    let runs=[],error=false;
    try{runs=await computeBand(host(),{cooperate:workCooperation(),isCurrent});}catch(e){error=true;globalThis.AstroNotesErrors?.note('map.band',e);}
    if(!isCurrent())return;
    bandState={key,base,runs,error,pending:'',timer:0};host()?.redraw();schedule();
    document.dispatchEvent(new Event('astronotes-search-band-change'));
   }finally{if(bandState===entry&&entry.pending===key){entry.pending='';entry.timer=0;}}
  },160);
 }
 return bandState.base===base?bandState.runs:[];
}
// 点が帯の中か（同じ分の扇形のどれかに入るか）。新しい地点の結果を帯と照合するのに使う。
function inBand(h,p){const t=h.session.target;const d=AstroNotesTerrain.distanceKm(t.latitude,t.longitude,p.latitude,p.longitude),b=AstroNotesTerrain.bearing(t.latitude,t.longitude,p.latitude,p.longitude);
 for(const run of bandFor(h))for(const x of run.raw)if(d<=x.d*1.02&&Math.abs(AstroNotesSkyMap.delta(b,x.bearing))<=x.w+Math.atan(x.hw/Math.max(d,.05))/RAD+.02)return true;return false;}
// 記録の地点＝探すの記録タブと同じ（観測記録のある撮影地点、記録した位置と高さ）。形の地点は代表の位置で描く。
let recordPlacesCache={revision:null,list:[]};
function recordPlaces(){
 const revision=JSON.stringify([globalThis.MyPlacesUI?.discoveryRevision?.(),globalThis.MyPlacesUI?.discoveryPoints]);if(recordPlacesCache.revision===revision)return recordPlacesCache.list;
 let entries=[];try{entries=globalThis.MyPlacesUI?.discoveryPoints?.()||[];}catch{entries=[];}
 const seen=new Set(),out=[];
 for(const {place:p} of entries){if(!validPoint(p))continue;const id=p.discoveryKey||p.id||p.latitude+','+p.longitude;if(seen.has(id))continue;seen.add(id);
  out.push({latitude:p.latitude,longitude:p.longitude,elevation:p.elevation,groundManualM:p.groundManualM,eyeHeightAGL:p.eyeHeightAGL,name:p.name||'記録の地点',id,source:p});}
 recordPlacesCache={revision,list:out};return out;
}
// 丸めた分が薄明境界を越える短い通過は、確認済み区間の中点を保持する。
function displayWindow(w,body,observer){
 const from=Math.ceil(w.from/60000)*60000,to=Math.floor(w.to/60000)*60000;if(from<=to)return {from,to};
 const mid=(w.from+w.to)/2,rounded=Math.round(mid/60000)*60000,at=nightAllowed(body,rounded,observer)?rounded:mid;return {from:at,to:at,brief:true};
}
// その地点・その日に天体の円盤が対象の本体に掛かる時間（段階①のカードと同じ判定）。
function windowsAt(h,place,demGround=null){
 const s=h.session,t=s.target,body=s.body,day=AstroNotesSkyMap.dayStart(s.at);
 const ground=Number.isFinite(place.groundManualM)?place.groundManualM:Number.isFinite(place.elevation)?place.elevation:Number.isFinite(demGround)?demGround:0,eye=Number.isFinite(place.eyeHeightAGL)?place.eyeHeightAGL:EYE_HEIGHT,o={latitude:place.latitude,longitude:place.longitude,elevation:ground+eye};
 const view=AstroNotesAlign.prepareDailyView(o,t,body,{partId:'__whole',eyeM:0}),geo=AstroNotesAlign.geometryFrom(o,t,{partId:s.partId,eyeM:0});if(!geo)return [];
 const data=AstroNotesSkyMap.daily(body,day,o,h.skyState),hit=at=>nightAllowed(body,at,o)&&!!view(at,at)[0]?.intersects,windows=[];
 for(const point of AstroNotesSkyMap.passages(data,geo.azimuth,body,o,h.skyState)){const found=[];let cur=null;for(let at=point.at-2400000;at<=point.at+2400000;at+=20000){if(hit(at)){if(!cur)cur={from:at,to:at};cur.to=at;}else if(cur){found.push(cur);cur=null;}}if(cur)found.push(cur);
  // 段階①のカードと同じく、走査の端でもまだ重なっていれば外へ延ばす（幅の広い対象、最大±6時間）
  for(const w of found){if(w.from<=point.at-2400000)for(let at=w.from-20000;at>=point.at-21600000&&hit(at);at-=20000)w.from=at;if(w.to>=point.at+2400000)for(let at=w.to+20000;at<=point.at+21600000&&hit(at);at+=20000)w.to=at;}windows.push(...found);}
 windows.sort((a,b)=>a.from-b.from);const merged=[];for(const w of windows){const last=merged.at(-1);if(last&&w.from<=last.to+20000)last.to=Math.max(last.to,w.to);else merged.push({...w});}
 return merged.filter(w=>w.to>=day&&w.from<day+86400000).map(w=>displayWindow(w,body,o));
}
// 記録の地点は地点ごとに処理を譲って数える（日・天体・対象・地点の一覧で保存）。
const recordPlaceKey=p=>JSON.stringify([p.id,p.latitude,p.longitude,p.groundManualM,p.elevation,p.eyeHeightAGL]);
const recordConditionKey=h=>targetKey(h)+'|'+JSON.stringify(globalThis.AstroNotesAtmosphere?.dataKey?.()??null);
function recordsFor(h){
 const places=recordPlaces(),base=recordConditionKey(h),key=base+'|'+JSON.stringify(places.map(recordPlaceKey));if(recordState.key===key)return recordState.rows;
 const body=h.session.body,job={key,body,rows:null,busy:true};recordState=job;const rows=[];
 // keyだけでなくjobそのものを所有者にする。同じ条件へ戻る間に新jobが始まっても、古いjobは結果や状態を上書きしない。
 const current=()=>{const hh=host();return hh&&targetReady(hh)&&recordState===job&&recordConditionKey(hh)===base?hh:null;};
 (async()=>{try{await new Promise(r=>setTimeout(r,300));// 日を送り続けている間は始めない
  if(!current())return;
  try{await AstroNotesBodies.ensure(body);}catch(e){if(recordState===job){recordState={key,body,rows:null,busy:false,error:true};globalThis.AstroNotesErrors?.note('map.recordBody',e);host()?.redraw();schedule();}return;}
  if(!current())return;
  for(const place of places){if(!current())return;await new Promise(r=>setTimeout(r,0));const hh=current();if(!hh)return;
  // 標高の無い記録は段階①と同じく地形の標高で数える
  let dem=null;if(!Number.isFinite(place.groundManualM)&&!Number.isFinite(place.elevation)&&typeof groundAt==='function'){try{dem=await groundAt(place.latitude,place.longitude);}catch{dem=null;}if(!current())return;}
  let windows=null;try{windows=windowsAt(hh,place,dem);}catch(e){globalThis.AstroNotesErrors?.note('map.recordWindows',e);}rows.push({place,windows});}
  if(!current())return;recordState={key,body,rows,busy:false};host()?.redraw();schedule();
 }finally{
  // 画面を離れた・条件が失効した途中結果をpendingのキャッシュにしない。同条件へ戻れば再計算できる。
  if(recordState===job)recordState={key:'',rows:null,busy:false};
 }})().catch(e=>globalThis.AstroNotesErrors?.note('map.recordWindows',e));
 return null;
}
// 絞り込み済みの候補一覧を、結果が更新されるたびに地図へ渡す。
const candidateSheet=()=>$('skyMapView').hasAttribute('data-explore-sheet');
let candidateHits=[],fittedCandidateScope=null,candidateFrame=0,selectedCandidate=null,selectedCandidateRow=null,displayedCandidates=null;
function newCandidates(){
 const picker=globalThis.AstroNotesCandidatePicker;
 return (picker?.visibleRows?.()||[]).flatMap((row,index)=>!row||row.recorded||row.inRecords||!validPoint(row.place)?[]:[{
  row,id:picker.candidateKey(row),number:index+1,latitude:row.place.latitude,longitude:row.place.longitude,
  name:row.place.name||row.place.label||'新しい地点',at:row.event?.at,
 }]);
}
function clearCandidatePins(){
 if(candidateFrame)cancelAnimationFrame(candidateFrame);
 candidateFrame=0;candidateHits=[];fittedCandidateScope=null;selectedCandidate=null;
 markCandidateRow(null);
}
function candidateRow(id){
 if(!id)return null;
 return [...document.querySelectorAll('#candidateUnifiedResults .list-item:not([hidden])')]
  .find(item=>item.dataset.candidateId===id)??null;
}
function markCandidateRow(row){
 if(selectedCandidateRow===row)return;
 selectedCandidateRow?.removeAttribute('data-map-candidate-selected');
 selectedCandidateRow=row;
 row?.setAttribute('data-map-candidate-selected','');
}
function fitCandidates(h,pins,{manual=false}={}){
 const canvas=$('skyMapCanvas'),width=canvas.clientWidth,height=canvas.clientHeight;
 if(!pins.length||width<110||height<80)return;
 const points=pins.map(p=>h.map.project(p.latitude,p.longitude));
 const {target}=h.session;
 const nearTarget=validPoint(target)?h.map.project(target.latitude,target.longitude):null;
 const crowded=nearTarget&&points.some(([x,y])=>Math.hypot(x-nearTarget[0],y-nearTarget[1])<24);
 if(!manual&&!crowded&&points.every(([x,y])=>x>=24&&x<=width-70&&y>=24&&y<=height-24))return;
 if(!manual&&crowded)points.push(nearTarget);
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
 const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
 const center=h.map.coordinateAt((left+right)/2,(top+bottom)/2);
 const zoom=h.map.zoom(),scale=Math.min((width-108)/Math.max(1,right-left),(height-48)/Math.max(1,bottom-top));
 h.map.setView(center.latitude,center.longitude,Math.min(manual?17:crowded?Math.max(zoom,15):zoom,zoom+Math.log2(scale)));
}
const candidateTimingKey=h=>globalThis.AstroNotesCandidatePicker?.mapPinTimeKey?.(h.session)??'day';
function candidateSnapshot(h){
 const saved=displayedCandidates;
 return saved?.session===h.session&&saved.key===targetKey(h)&&saved.timing===candidateTimingKey(h)?saved:null;
}
function targetSelectionCurrent(h){
 return !!targetSel&&targetSel.key===targetKey(h)&&(targetSel.kind!=='new'||targetSel.timing===candidateTimingKey(h));
}
function invalidateCandidatePins(){
 displayedCandidates=null;clearCandidatePins();host()?.redraw();
}
function refreshCandidatePins(committed=false){
 if(committed){
  const h=host();
  displayedCandidates=h&&targetReady(h)?{session:h.session,key:targetKey(h),timing:candidateTimingKey(h),pins:newCandidates()}:null;
  if(!candidateSheet()){h?.redraw();return;}
 }
 if(!candidateSheet()||candidateFrame)return;
 candidateFrame=requestAnimationFrame(()=>{
  candidateFrame=0;
  const h=host();if(!active||!candidateSheet()||!h||!targetReady(h))return;
  const shown=candidateSnapshot(h),pins=shown?.pins||[];
  if(!pins.some(p=>p.id===selectedCandidate))selectedCandidate=null;
  markCandidateRow(candidateRow(selectedCandidate));
  if(pins.length&&(shown.key!==fittedCandidateScope?.key||shown.timing!==fittedCandidateScope?.timing)){
   fitCandidates(h,pins);
   fittedCandidateScope={key:shown.key,timing:shown.timing};
  }else if(!pins.length)fittedCandidateScope=null;
  h.redraw();
 });
}
function drawCandidatePins(ctx,{project,width,height},inTarget=false){
 candidateHits=[];
 const h=host();if(!active||!h||h.pickMode||!targetReady(h))return;
 const inSheet=candidateSheet(),shown=inSheet||inTarget?candidateSnapshot(h):null,pins=shown?.pins||[];
 const ordered=inSheet&&selectedCandidate?[
  ...pins.filter(p=>p.id!==selectedCandidate),...pins.filter(p=>p.id===selectedCandidate),
 ]:pins;
 for(const candidate of ordered){
  const [x,y]=project(candidate.latitude,candidate.longitude);
  if(x<0||y<0||x>width||y>height)continue;
  const selected=inSheet&&selectedCandidate===candidate.id;
  pinAt(ctx,x,y,selected?'#235c89':NEW_PIN,inSheet?11:6);
  if(inSheet)labelAt(ctx,String(candidate.number),x,y,'#fff','center',11);
  candidateHits.push({kind:'new',x,y,candidate,scope:shown});
 }
}
function focusCandidateInSheet(pixel){
 const h=host(),scope=h&&candidateSnapshot(h),distance=hit=>Math.hypot(hit.x-pixel.x,hit.y-pixel.y);
 const hits=candidateHits.filter(hit=>hit.scope===scope&&distance(hit)<22).sort((a,b)=>distance(a)-distance(b));
 if(!hits.length)return true;
 const nearest=hits[0],cluster=hits.filter(hit=>Math.hypot(hit.x-nearest.x,hit.y-nearest.y)<12)
  .sort((a,b)=>a.candidate.number-b.candidate.number);
 const next=cluster[(cluster.findIndex(hit=>hit.candidate.id===selectedCandidate)+1)%cluster.length];
 const row=candidateRow(next.candidate.id);
 if(row){
  selectedCandidate=next.candidate.id;markCandidateRow(row);host()?.redraw();
  row.scrollIntoView({block:'nearest'});row.focus({preventScroll:true});
 }
 return true;
}
function lineRanges(h){
 const name=h.session.body==='moon'?'月':h.session.body==='sun'?'日':(AstroNotesBodies.definitions.find(d=>d.id===h.session.body)?.name||'天体')+'の';
 return (lineState.lines||[]).map(l=>{const ts=l.points.map(p=>p.at);return (h.session.body==='moon'||h.session.body==='sun'?name+(l.side==='rise'?'の出側 ':'の入側 '):name+(l.side==='rise'?'昇る側 ':'沈む側 '))+fmtAt(Math.min(...ts))+'〜'+fmtAt(Math.max(...ts));});
}
// 線の上で今の時刻に当たる点。
function lineCursor(line,at){const p=line.points;for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i];if((at-a.at)*(at-b.at)<=0&&a.at!==b.at){const f=(at-a.at)/(b.at-a.at);return {latitude:a.latitude+(b.latitude-a.latitude)*f,longitude:a.longitude+(b.longitude-a.longitude)*f};}}return null;}
function ringPixels(width,height){return fitRadius(width,height);}
// 目標物を中心に、線の届く範囲がリングに収まる縮尺へ合わせる（条件や日が変わった時も合わせ直す）。
function fitTargetView(h){
 const s=h.session,t=s.target,canvas=$('skyMapCanvas'),w=canvas.clientWidth,ht=canvas.clientHeight;if(!w||!ht||!validPoint(t))return;
 const key=JSON.stringify([t.id,t.latitude,t.longitude,linePart(s)]);if(key===targetFitKey)return;targetFitKey=key;
 const topM=bandTopM(s),km=Number.isFinite(topM)&&AstroNotesAlign.lineRange?Math.min(60,AstroNotesAlign.lineRange(topM).maxKm):28;
 const ring=ringPixels(w,ht),zoom=Math.log2(156543.03*Math.cos(t.latitude*RAD)/(km*1100/ring));h.map.setView(t.latitude,t.longitude,Math.max(8,Math.min(16,zoom)));
}
function pinAt(ctx,x,y,fill,r=6){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();}
function labelAt(ctx,text,x,y,fill,align='center',size=12){ctx.save();ctx.font='700 '+size+'px system-ui';ctx.textAlign=align;ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=3.5;ctx.strokeStyle='rgba(0,0,0,.92)';ctx.strokeText(text,x,y);ctx.fillStyle=fill;ctx.fillText(text,x,y);ctx.restore();}
function drawTarget(ctx,{project,width,height}){
 const h=host();tapHits=[];if(!h||!targetReady(h))return;const s=h.session,t=s.target,[tx,ty]=project(t.latitude,t.longitude),lines=lineFor(h)||[],runs=bandFor(h);
 fitTargetView(h);
 // 重なる範囲（全体）
 ctx.save();for(const run of runs){
  if(run.polygons){ctx.beginPath();for(const polygon of run.polygons){const pts=polygon.map(p=>project(p.latitude,p.longitude));let area=0;for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];area+=a[0]*b[1]-b[0]*a[1];}if(area<0)pts.reverse();pts.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();}ctx.fillStyle='rgba(242,195,94,.28)';ctx.fill();
   ctx.beginPath();for(const edge of run.outlines){ctx.moveTo(...project(edge[0].latitude,edge[0].longitude));ctx.lineTo(...project(edge[1].latitude,edge[1].longitude));}ctx.setLineDash([4,3]);ctx.lineWidth=1.2;ctx.strokeStyle='rgba(242,195,94,.9)';ctx.stroke();ctx.setLineDash([]);continue;}
  const L=run.L.map(p=>project(p.latitude,p.longitude)),R=run.R.map(p=>project(p.latitude,p.longitude));
  ctx.fillStyle='rgba(242,195,94,.28)';for(const edge of [L,R]){ctx.beginPath();ctx.moveTo(tx,ty);edge.forEach(q=>ctx.lineTo(...q));ctx.closePath();ctx.fill();}
  ctx.beginPath();[...L,...R.slice().reverse()].forEach((q,i)=>i?ctx.lineTo(...q):ctx.moveTo(...q));ctx.closePath();ctx.fill();ctx.setLineDash([4,3]);ctx.lineWidth=1.2;ctx.strokeStyle='rgba(242,195,94,.9)';ctx.stroke();ctx.setLineDash([]);}
 ctx.restore();
 // 情報欄の出・入と同じ天体・時刻・地点の方位線と軌道。
 const ring=ringPixels(width,height),eye=targetSkyPoint(h)||s.eye;
 const daily=dailyOf(h,s.body,eye),pass=daily&&passAt(h,s.body,daily,eye);
 if(pass){
  const [x,y]=project(eye.latitude,eye.longitude),far=Math.hypot(Math.max(Math.abs(x),Math.abs(width-x)),Math.max(Math.abs(y),Math.abs(height-y)));
  const tint=colours[s.body]||(colours[s.body]=colour(s.body));
  drawHorizonRays(ctx,s.body,pass,x,y,far,tint);
  if(orbitVisible.target&&pass.points.length>1)drawOrbitPath(ctx,arcOf(pass.points,x,y,ring),tint);
 }
 // 天体の中心が先端に来る線と時刻
 for(const l of lines){const pts=l.points.map(p=>project(p.latitude,p.longitude));ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();pts.forEach((q,i)=>i?ctx.lineTo(...q):ctx.moveTo(...q));ctx.strokeStyle='rgba(0,0,0,.6)';ctx.lineWidth=6;ctx.stroke();ctx.strokeStyle=GOLD;ctx.lineWidth=3;ctx.stroke();ctx.restore();
  let last=null;l.points.forEach((p,i)=>{if(i%4!==2)return;const [x,y]=pts[i];if(last&&Math.hypot(x-last[0],y-last[1])<64)return;last=[x,y];labelAt(ctx,fmtAt(p.at),x+7,y-10,GOLD,'left',11);});
  for(let i=1;i<pts.length;i++)tapHits.push({kind:'segment',a:pts[i-1],b:pts[i],pa:l.points[i-1],pb:l.points[i],side:l.side});
  const cur=lineCursor(l,s.at);if(cur){const [x,y]=project(cur.latitude,cur.longitude);ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.fillStyle='rgba(242,195,94,.3)';ctx.fill();pinAt(ctx,x,y,GOLD,5);labelAt(ctx,'今の時刻ならここ',x,y+18,GOLD,'center',11);}}
 // 記録の地点: その日に実際に重なる地点は金の縁と最初の時刻
 const records=recordsFor(h);
 for(const p of recordPlaces()){const [x,y]=project(p.latitude,p.longitude);if(x<-20||y<-20||x>width+20||y>height+20)continue;const row=records?.find(r=>r.place.id===p.id),on=!!row?.windows?.length;
  // 2026-11-26 ユーザー「ラインに重なるところだけ出して欲しい」: その日重なる地点と、いま選んでいる地点だけ描く
  if(!on&&!(targetSel?.kind==='record'&&targetSel.place?.id===p.id))continue;
  if(on){ctx.beginPath();ctx.arc(x,y,11,0,Math.PI*2);ctx.strokeStyle=GOLD;ctx.lineWidth=2.5;ctx.stroke();labelAt(ctx,fmtAt(row.windows[0].from),x+14,y+1,GOLD,'left',11);}
  pinAt(ctx,x,y,RECORD_PIN,5.5);tapHits.push({kind:'record',x,y,place:p,row});}
 if(!candidateSheet()){drawCandidatePins(ctx,{project,width,height},true);tapHits.push(...candidateHits);}
 // 目標物の方位リング
 ctx.save();ctx.beginPath();ctx.arc(tx,ty,ring,0,Math.PI*2);ctx.lineWidth=4;ctx.strokeStyle='rgba(0,0,0,.6)';ctx.stroke();ctx.lineWidth=1.5;ctx.strokeStyle='rgba(255,255,255,.88)';ctx.stroke();ctx.restore();
 for(const [n,az] of [['北',0],['東',90],['南',180],['西',270]]){const a=dir(az);labelAt(ctx,n,tx+Math.sin(a)*(ring+13),ty-Math.cos(a)*(ring+13),'#fff','center',13);}
 pinAt(ctx,tx,ty,'#c876ff',8);labelAt(ctx,t.name||'対象',tx,ty-18,'#fff','center',12);
 if(candidateSheet())drawCandidatePins(ctx,{project,width,height},true);
 // 撮影地点（あれば小さく）と選んだ点
 const o=s.observer;if(validPoint(o)){const [ox,oy]=project(o.latitude,o.longitude);ctx.save();ctx.lineWidth=3;ctx.strokeStyle='#111';ctx.beginPath();ctx.moveTo(ox-7,oy);ctx.lineTo(ox+7,oy);ctx.moveTo(ox,oy-7);ctx.lineTo(ox,oy+7);ctx.stroke();ctx.lineWidth=1.3;ctx.strokeStyle='#fff';ctx.stroke();ctx.restore();}
 if(targetSel&&!targetSelectionCurrent(h))targetSel=null;
 if(targetSel&&validPoint(targetSel)){const [x,y]=project(targetSel.latitude,targetSel.longitude);ctx.beginPath();ctx.arc(x,y,13,0,Math.PI*2);ctx.lineWidth=3;ctx.strokeStyle='#fff';ctx.stroke();ctx.lineWidth=1.5;ctx.strokeStyle='#000';ctx.stroke();}
}
// 2026-11-26 採用: 撮影地点中心では、時刻バーの前後1時間に重なる記録を随時表示。
// 重なり区間まで50分は通常、50〜60分で薄くする。同じ地点の描画状態を保ち、
// 速い操作にも現在の濃度から120ms以内で追従する（停止待ち・フェードの待ち行列は持たない）。
// 日・対象・天体等の計算条件が同じなら recordsFor の結果を共有し、時刻では再計算しない。
const OBS_RECORD_FULL=3000000,OBS_RECORD_SPAN=3600000,OBS_RECORD_FOLLOW=120;
let obsRecordHits=[],obsFades=new Map(),obsDrawKey='',obsFrame=0,obsRecordsPending=false;
const obsKey=h=>{const s=h.session,o=s.observer;return recordConditionKey(h)+'|'+JSON.stringify([o?.latitude,o?.longitude,o?.elevation,o?.groundManualM,o?.eyeHeightAGL,o?.standAglM,s.ground,s.limb,s.matchMode]);};
function resetObsRecords(){if(obsFrame)cancelAnimationFrame(obsFrame);obsFrame=0;obsRecordHits=[];obsFades.clear();obsDrawKey='';obsRecordsPending=false;}
function nearestObsWindow(windows,at){
 let window=null,distance=Infinity;
 for(const w of windows||[]){if(!Number.isFinite(w.from)||!Number.isFinite(w.to)||w.from>w.to)continue;const d=Math.max(w.from-at,at-w.to,0);if(d<distance){distance=d;window=w;}}
 return {window,distance};
}
function obsAlpha(distance){const t=Math.max(0,Math.min(1,(distance-OBS_RECORD_FULL)/(OBS_RECORD_SPAN-OBS_RECORD_FULL)));return 1-t*t*(3-2*t);}
function clearStaleObsSelection(h){
 if(!targetSel?.obs)return false;
 if(!targetReady(h)||targetSel.obs!==obsKey(h)||!recordPlaces().some(p=>recordPlaceKey(p)===recordPlaceKey(targetSel.place))){targetSel=null;schedule();return true;}
 return false;
}
function drawObsRecords(ctx,{project,width,height}){
 const h=host();if(!active||viewMode!=='obs'||!h||h.pickMode||!targetReady(h)||!validPoint(h.session.observer)){resetObsRecords();return;}
 clearStaleObsSelection(h);const key=obsKey(h);if(obsDrawKey!==key){resetObsRecords();obsDrawKey=key;}
 obsRecordHits=[];const records=recordsFor(h),now=performance.now();obsRecordsPending=records===null;
 // 同条件の記録一覧更新中は、位置・高さが変わっていない既知の結果を維持する。
 // 別日・別条件は上で破棄。null（計算中）を []（計算済み0件）として扱わない。
 const places=new Map(recordPlaces().map(p=>[p.id,p]));
 for(const [id,f] of obsFades)if(!places.has(id)||recordPlaceKey(places.get(id))!==recordPlaceKey(f.row.place))obsFades.delete(id);
 if(records!==null){const ids=new Set(records.map(r=>r.place.id));for(const id of obsFades.keys())if(!ids.has(id))obsFades.delete(id);
  for(const row of records){let f=obsFades.get(row.place.id);if(!f){f={row,alpha:0,targetAlpha:0,at:now,window:null,selected:false};obsFades.set(row.place.id,f);}else f.row=row;}}
 const s=h.session,o=s.observer,[ox,oy]=project(o.latitude,o.longitude),tg=AstroNotesAlign.partTarget(s.target,s.partId),[tx,ty]=project(tg.latitude,tg.longitude);let moving=false;
 for(const f of obsFades.values()){
  const row=f.row,p=places.get(row.place.id)||row.place,selected=targetSel?.obs===key&&targetSel.place.id===p.id,near=nearestObsWindow(row.windows,s.at),target=selected?1:obsAlpha(near.distance);
  // 描画が止まっていた時間を、新しく変わった濃度への経過時間にしない。
  // 進行中に目標が逆転した場合は現濃度からそのまま逆向きに進める。
  const step=target!==f.targetAlpha&&f.alpha===f.targetAlpha?0:Math.max(0,now-f.at)/OBS_RECORD_FOLLOW;f.at=now;f.targetAlpha=target;f.selected=!!selected;
  f.alpha=target>f.alpha?Math.min(target,f.alpha+step):Math.max(target,f.alpha-step);
  const w=selected?targetSel.window:near.window;if(w)f.window=w;
  if(f.alpha!==target)moving=true;
  if(!f.alpha||!f.window||AstroNotesTerrain.distanceKm(o.latitude,o.longitude,p.latitude,p.longitude)<.05)continue;
  const [x,y]=project(p.latitude,p.longitude);if(x<-20||y<-20||x>width+20||y>height+20)continue;
  // 撮影地点・対象のピンの上には出さない（そのピンを掴めなくしない）
  if(Math.hypot(x-ox,y-oy)<22||Math.hypot(x-tx,y-ty)<22)continue;
  ctx.save();ctx.globalAlpha=f.alpha;ctx.beginPath();ctx.arc(x,y,11,0,Math.PI*2);ctx.strokeStyle=GOLD;ctx.lineWidth=2.5;ctx.stroke();labelAt(ctx,fmtAt(f.window.from),x+14,y+1,GOLD,'left',11);pinAt(ctx,x,y,RECORD_PIN,5.5);
  if(selected){ctx.beginPath();ctx.arc(x,y,13,0,Math.PI*2);ctx.lineWidth=3;ctx.strokeStyle='#fff';ctx.stroke();ctx.lineWidth=1.5;ctx.strokeStyle='#000';ctx.stroke();}ctx.restore();
  obsRecordHits.push({x,y,place:p,row,window:f.window});}
 if(moving&&!obsFrame)obsFrame=requestAnimationFrame(()=>{obsFrame=0;const hh=host();if(active&&viewMode==='obs'&&hh&&targetReady(hh)&&obsKey(hh)===key)hh.redraw();});
}
function tapObsRecord(pixel){
 const h=host();if(!h)return false;clearStaleObsSelection(h);if(!targetReady(h)||obsDrawKey!==obsKey(h))return false;
 let best=null,dist=22;for(const hit of obsRecordHits){const d=Math.hypot(hit.x-pixel.x,hit.y-pixel.y);if(d<dist){dist=d;best=hit;}}
 if(!best)return false;
 const p=best.place;targetSel={kind:'record',key:targetKey(h),obs:obsKey(h),latitude:p.latitude,longitude:p.longitude,name:p.name,place:p,window:{...best.window},windows:best.row.windows?.map(w=>({...w}))||[]};h.redraw();schedule();return true;
}
// 目標物が中心の時のタップ: 地点のピン→その地点、線の近く（26px）→線上の点に吸着、それ以外→選択を外す。
function tapTarget(pixel){
 const h=host();if(!h)return false;
 const scope=candidateSnapshot(h);
 let best=null,dist=22;for(const hit of tapHits)if(hit.kind!=='segment'&&(hit.kind!=='new'||hit.scope===scope)){const d=Math.hypot(hit.x-pixel.x,hit.y-pixel.y);if(d<dist){dist=d;best=hit;}}
 const selKey=targetKey(h);
 if(best?.kind==='record'){const p=best.place;targetSel={kind:'record',key:selKey,latitude:p.latitude,longitude:p.longitude,name:p.name,place:p};}
 else if(best?.kind==='new'){const c=best.candidate;targetSel={kind:'new',key:selKey,timing:best.scope.timing,latitude:c.latitude,longitude:c.longitude,name:c.name,at:c.at,row:c.row};}
 else{let snap=null,sd=26;for(const hit of tapHits){if(hit.kind!=='segment')continue;const [ax,ay]=hit.a,[bx,by]=hit.b,dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy,f=l2?Math.max(0,Math.min(1,((pixel.x-ax)*dx+(pixel.y-ay)*dy)/l2)):0,d=Math.hypot(ax+dx*f-pixel.x,ay+dy*f-pixel.y);
  if(d<sd){sd=d;snap={kind:'line',key:selKey,latitude:hit.pa.latitude+(hit.pb.latitude-hit.pa.latitude)*f,longitude:hit.pa.longitude+(hit.pb.longitude-hit.pa.longitude)*f,at:hit.pa.at+(hit.pb.at-hit.pa.at)*f,side:hit.side,name:'線上の地点'};}}
  targetSel=snap;}
 host()?.redraw();schedule();return true;
}
// 選んだ点を撮影地点にして、撮影地点が中心へ切り替える。
function useSelectionAsObserver(){
 const h=host();if(!h)return;clearStaleObsSelection(h);if(!targetSelectionCurrent(h))return;const sel=targetSel;
 if(sel.kind==='record'&&sel.place?.source&&globalThis.AstroNotesShooting?.savedObserver){const o=AstroNotesShooting.savedObserver(sel.place.source);h.restoreObserver(o,Number.isFinite(sel.place.groundManualM)?sel.place.groundManualM:null);}
 else{placingName=sel.kind==='line'?'線上の地点':sel.name||PLACED;h.placePoint('observer',{latitude:sel.latitude,longitude:sel.longitude});placingName=null;}
 // 点天体は数十秒の丸めでも対象から外れるため、解いた時刻をそのまま渡す。
 if(sel.kind==='line'&&Number.isFinite(sel.at))h.setTime(pointBody(h.session.body)?sel.at:Math.round(sel.at/60000)*60000);
 targetSel=null;setViewMode('obs');h.redraw();schedule();
}
function setViewMode(mode){
 if(mode===viewMode)return;
 const h=host();
 if(mode==='obs'&&!validPoint(h?.session.observer)){syncMapTools();return;}
 viewMode=mode;targetSel=null;targetFitKey='';fittedKey=null;resetObsRecords();
 if(mode==='obs')stopTargetLine();else prepareLineAhead();
 syncMapTools();
 $('skyMapView')?.setAttribute('data-map-center',mode);
 if(h){if(mode==='obs')fitTarget(h);h.redraw();}schedule();
}
function updateTargetCard(h){
 const s=h.session,place=$('mapWsCardPlace'),meta=$('mapWsCardMeta'),overlap=$('mapWsCardOverlap'),view=$('mapWsCardView'),second=$('mapWsCardSecond');
 const set=(n,v)=>{if(n.textContent!==v)n.textContent=v;},bodyName=AstroNotesBodies.definitions.find(d=>d.id===s.body)?.name||'天体';
 if(!targetReady(h)){stopTargetLine();set(place,'対象を選んでください');set(meta,'上の条件から対象を選ぶと、重なる範囲と線が出ます');overlap.hidden=true;view.firstElementChild.textContent='条件';view.dataset.action='conditions';view.disabled=false;view.setAttribute('aria-label','撮影条件を開く');second.hidden=true;return;}
 if(targetSel&&!targetSelectionCurrent(h))targetSel=null;
 const sel=targetSel;second.hidden=false;
 if(sel){
  set(place,sel.kind==='line'?'線上の地点':sel.name);
  if(sel.kind==='line'){set(meta,bodyName+'の中心が先端に来るのは '+fmtAt(sel.at));overlap.hidden=true;}
  else if(sel.kind==='record'){set(meta,'記録の地点');const w=sel.obs?sel.windows:recordState.key.startsWith(targetKey(h))?recordState.rows?.find(r=>r.place.id===sel.place.id)?.windows:undefined;overlap.hidden=false;set(overlap,w===null||w===undefined?'重なる時間を調べています…':w.length?'重なる '+w.map(x=>x.brief?fmtAt(x.from)+'頃':fmtAt(x.from)+'〜'+fmtAt(x.to)).join('・'):'この日は'+bodyName+'が対象に重ならない');overlap.dataset.at=w?.length?String(sel.window?.from??w[0].from):'';overlap.disabled=!w?.length;overlap.classList.toggle('map-ws-card-hit',!!w?.length);}
  else{set(meta,'新しい地点（新規探索）'+(Number.isFinite(sel.at)?' ・ '+fmtAt(sel.at):''));overlap.hidden=true;}
  view.firstElementChild.textContent=sel.kind==='new'?'見え方':'ここを撮影地点にする';view.dataset.action=sel.kind==='new'?'candidate':'use';view.disabled=false;view.setAttribute('aria-label',sel.kind==='new'?'この新しい地点の見え方を開く':'この地点を撮影地点にして、地図の中心を撮影地点に切り替える');second.firstElementChild.textContent='戻す';second.dataset.action='clear';second.disabled=false;second.setAttribute('aria-label','選んだ地点を外す');
  return;
 }
 set(place,(s.target.name||'対象')+'を中心に（'+bodyName+'）');
 const lines=lineFor(h);if(recordState.key===''||!recordState.key.startsWith(targetKey(h)))recordsFor(h);
 set(meta,lineState.busy&&!lines?'中心が先端に来る線を計算しています…':lines?.length?'中心が先端に来る線: '+lineRanges(h).join(' ・ '):lineState.error?'線を計算できませんでした':'この日は中心が先端に来る線がありません');
 const records=recordState.key&&recordState.rows,on=(records||[]).filter(r=>r.windows?.length).sort((a,b)=>a.windows[0].from-b.windows[0].from);
 overlap.hidden=!recordPlaces().length;overlap.disabled=!on.length;overlap.classList.toggle('map-ws-card-hit',!!on.length);overlap.dataset.at=on.length?String(on[0].windows[0].from):'';
 set(overlap,!records?'記録の地点を調べています…':on.length?'この日重なる記録の地点 '+on.length+'件（'+on.slice(0,2).map(r=>r.place.name+' '+fmtAt(r.windows[0].from)).join('・')+(on.length>2?' ほか':'')+'）':'記録の地点はこの日重ならない');
 view.disabled=false;view.firstElementChild.textContent='新しい地点を探す';view.dataset.action='search';
 view.setAttribute('aria-label','新しい撮影地点を探す');
 second.firstElementChild.textContent='重なる日';second.dataset.action='list';second.disabled=!globalThis.MyPlacesUI?.opportunities?.covers?.(s.target.id,s.body);second.setAttribute('aria-label','記録の地点の重なる日を今の条件で開く');
}
const api={
 hourPixels:()=>active?hourPixels:0,
 feedbackEvents(day){
  const h=host(), s=h?.session;
  if(!active||!s||isTarget()||AstroNotesSkyMap.dayStart(s.at)!==day)return [];
  const windows=overlapWindows(h);
  return Array.isArray(windows)?windows.flatMap(w=>[w.from,w.to]):[];
 },
 targetSkyPoint:()=>targetSkyPoint(),
 previewSkyPoint:()=>previewSkyPoint(),
 annotations(mode){
  const h=host(),s=h?.session,eye=previewSkyPoint(h)||s?.eye;
  if(!active||mode!=='hour'||!eye||pointBody(s.body)&&!AstroNotesBodies.ready())return null;
  const geo=targetGeometry(h);
  return {key:JSON.stringify([s.body,eye,geo?.azimuth]),paint:(ctx,range)=>drawBand(h,ctx,range,eye,geo)};
 },
 // 描画のたびに呼ばれる。ページ内の地図も同じ描き方にする。
 drawing(){if(!active)queueMicrotask(evaluate);else{queueMicrotask(keepWide);schedule();}renderTargetHeight();hits=[];labels=[];colours={};return {radius,body:drawBody,overlay:drawOverlay,center,mapSkyPoint};},
 hits:()=>hits,
 onlyBody(){const h=host();return active&&h?h.session.body:null;},
 targetMode:()=>isTarget()&&!!host(),
 drawTarget,
 drawObsRecords,drawCandidatePins,refreshCandidatePins,invalidateCandidatePins,
 centerMode:()=>viewMode,
 // 目標物が中心の時、点が重なる範囲（帯）の中か。新しい地点の探索範囲と帯の照合に使う。
 inBand(p){const h=host();return h&&isTarget()&&validPoint(p)?inBand(h,p):null;},
 // 対象中心で帯に絞る場合の範囲。計算が揃った帯を対象・日ごとに固定する。
 searchBand(s){const h=host();if(viewMode!=='target')return null;
  if(!h||!targetReady(h)||s?.body!==h.session.body||s?.target?.id!==h.session.target.id||AstroNotesSkyMap.dayStart(s.at)!==AstroNotesSkyMap.dayStart(h.session.at))return {status:'pending',key:'pending-condition',body:s?.body,target:s?.target,samples:[]};
  const base=targetKey(h),status=(lineState.key===base&&lineState.error||bandState.key===base+'|line'&&bandState.error)?'error':lineState.key===base&&!lineState.busy&&bandState.key===base+'|line'?'ready':'pending',key=base+'|'+status;
  if(searchBandCache.key===key)return searchBandCache.band;
  const t=h.session.target,band={status,key,body:s.body,target:{latitude:t.latitude,longitude:t.longitude},samples:status==='ready'?bandState.runs.flatMap(r=>r.raw.map(q=>[+q.bearing.toFixed(3),+q.d.toFixed(3),+q.w.toFixed(3),+q.hw.toFixed(3)])):[]};if(status==='ready')searchBandCache={key,band};return band;},
 targetState(){return {body:host()?.session.body,lineBody:lineState.body,recordBody:recordState.body,recordsPending:recordState.busy,recordsError:!!recordState.error,lineError:!!lineState.error,line:lineState.lines?lineState.lines.map(l=>({side:l.side,n:l.points.length,from:l.points[0]?.at,to:l.points.at(-1)?.at})):null,band:bandState.runs.length,records:recordState.rows?recordState.rows.map(r=>({name:r.place.name,windows:r.windows})):null,selection:targetSel&&{kind:targetSel.kind,at:targetSel.at,name:targetSel.name,latitude:targetSel.latitude,longitude:targetSel.longitude},newPins:candidateHits.length,obsRecords:obsRecordHits.map(x=>x.place.name),obsRecordFades:[...obsFades.values()].map(f=>({id:f.row.place.id,name:f.row.place.name,alpha:f.alpha,targetAlpha:f.targetAlpha,at:f.window?.from??null,selected:f.selected})),obsRecordsPending,lineBusy:lineState.busy};},
 tap(pixel){if(!active)return false;if(candidateSheet())return focusCandidateInSheet(pixel);if(viewMode==='target'&&!useMapSky(host()))return tapTarget(pixel);
  // 主ピンを保護し、その次は上に描いた記録ピンを優先。記録ピンの下の時刻点へタップを流さない。
  if(pinNear(pixel)||tapObsRecord(pixel))return true;
  let best=null,distance=22;for(const hit of hits){const d=Math.hypot(hit.x-pixel.x,hit.y-pixel.y);if(d<distance){distance=d;best=hit;}}if(best){host()?.setTime(best.at);return true;}
  // 主ピン・記録ピン・時刻点のどれでもない余白だけ、選択を外す。
  if(targetSel){targetSel=null;host()?.redraw();schedule();}return false;},
 // 動かしていなければ名前も地点もそのまま残す。
 // 全画面のピンは聞き返さず目の高さで置く。置いた対象を動かすときは決めた高さを保つ。
 targetHeight(){const s=host()?.session;return active?(s?.target?.id==='custom'&&Number.isFinite(s.custom?.heightM)?s.custom.heightM:EYE_HEIGHT):undefined;},
 observerName(point){const h=host();if(!active||!h)return undefined;const o=h.session.observer;return validPoint(o)&&Math.abs(o.latitude-point.latitude)<1e-7&&Math.abs(o.longitude-point.longitude)<1e-7?false:placingName||PLACED;},
};
g.AstroNotesMapWorkspace=api;

const ICON={menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',back:'<path d="M15 5l-7 7 7 7"/>',share:'<path d="M12 15V4m0 0L8 8m4-4l4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/>'};
const svg=d=>`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const cell=(id,label,accent,button)=>`<${button?'button type="button"':'div'} class="map-ws-cell" id="${id}" style="--ws-c:${accent}"><small>${label}</small><b></b><i></i><i></i></${button?'button':'div'}>`;
// 条件帯の展開は撮影条件ページと同じ1行ずつの並びにする。並べ方の正本は撮影条件ページ（検索の段）の指定なので、
// 条件欄に関わる指定だけを展開の印へ写す（地図や候補を隠す指定は写さない）。
const FORM_PARTS=['#exploreConditions','.condition-field','.explore-condition-fields','#skyMapAlignment','.sky-map-controls','.place-row','.explore-place-tools','#skyMapObserver','.aim-observer-card','#exploreHeightFields','.record-alignment','.explore-height-value','.condition-label','.condition-choice','.place-pick'];
const FORM_SKIP=/#exploreScenePanel|#exploreMapPanel|#exploreSkyInfo|sky-map-candidates|#skyMapShareRow|#candidate|#exploreSearchResults|#exploreShowResult|#exploreDiscovery|explore-discovery|#recentCandidates/;
function cloneFormStyles(){
 const out=[],head=/^\s*#skyMapView\[data-explore-stage=(?:"search"|search)\](?=[\s>])/;
 const keep=part=>head.test(part)&&!FORM_SKIP.test(part)&&FORM_PARTS.some(k=>part.includes(k))&&!/#exploreConditions\s*$/.test(part);
 const walk=rules=>{for(const rule of rules){
  if(rule.cssRules&&!rule.selectorText){const at=rule.media?'@media '+rule.media.mediaText:rule.conditionText&&rule.constructor?.name==='CSSSupportsRule'?'@supports '+rule.conditionText:null;if(!at)continue;const before=out.length;out.push(at+'{');walk(rule.cssRules);if(out.length===before+1)out.pop();else out.push('}');continue;}
  const sel=rule.selectorText;if(!sel||!sel.includes('data-explore-stage'))continue;
  // 選択子は最上位のカンマで分ける（括弧の中のカンマは分けない）
  const parts=[];let depth=0,cur='';for(const ch of sel){if(ch==='('||ch==='[')depth++;else if(ch===')'||ch===']')depth--;if(ch===','&&!depth){parts.push(cur);cur='';}else cur+=ch;}parts.push(cur);
  const kept=parts.filter(keep);if(kept.length)out.push(kept.map(part=>part.replace(head,'#skyMapView[data-explore-dropdown].map-ws')).join(',')+'{'+rule.style.cssText+'}');}};
 for(const sheet of document.styleSheets){if(sheet.ownerNode?.id==='mapWsFormStyles')continue;try{walk(sheet.cssRules);}catch{/* 別オリジンの指定は読まない */}}
 let style=$('mapWsFormStyles');if(!style){style=document.createElement('style');style.id='mapWsFormStyles';document.head.append(style);}const text=out.join('\n');if(style.textContent!==text)style.textContent=text;
}
function createMapTools(){
 const group=document.createElement('div');group.id='mapWsMode';group.className='sky-map-point-tools';
 group.setAttribute('role','group');group.setAttribute('aria-label','地図の表示');
 const centerButton=document.createElement('button');
 centerButton.type='button';centerButton.id='mapWsCenterToggle';centerButton.className='map-ctl';
 for(const [mode,source] of [['obs','skyMapObserverTool'],['target','skyMapTargetTool']]){
  const icon=$(source).querySelector('svg').cloneNode(true);
  icon.dataset.centerIcon=mode;icon.setAttribute('aria-hidden','true');centerButton.append(icon);
 }
 centerButton.onclick=()=>setViewMode(viewMode==='obs'?'target':'obs');

 const orbitButton=document.createElement('button');
 orbitButton.type='button';orbitButton.id='mapWsOrbitToggle';orbitButton.className='map-ctl';
 orbitButton.setAttribute('aria-label','天体の軌道');orbitButton.title='天体の軌道';
 orbitButton.innerHTML='<svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true"><g stroke="currentColor" stroke-width="1.65"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.6"/></g><g fill="currentColor"><circle cx="12" cy="12" r="1.45"/><circle cx="18" cy="6" r="2.35"/></g></svg>';
 orbitButton.onclick=()=>{
  const h=host(),mode=useMapSky(h)?'center':viewMode;
  orbitVisible[mode]=!orbitVisible[mode];
  syncMapTools();h?.redraw();
 };
 group.append(centerButton,orbitButton);return group;
}
function syncMapTools(){
 const centerButton=$('mapWsCenterToggle'),orbitButton=$('mapWsOrbitToggle');
 if(!centerButton||!orbitButton)return;
 const h=host(),hasObserver=validPoint(h?.session.observer),hasTarget=!!h&&targetReady(h);
 const onTarget=viewMode==='target',atCenter=useMapSky(h);
 if(centerButton.dataset.center!==viewMode){
  const current=onTarget?'対象':'撮影地点',next=onTarget?'撮影地点':'対象';
  centerButton.dataset.center=viewMode;
  centerButton.setAttribute('aria-label','地図の中心は'+current+'。'+next+'に切り替える');
  centerButton.title=next+'に切り替える';
 }
 const centerDisabled=onTarget?!hasObserver:!hasTarget,orbitDisabled=!atCenter&&(onTarget?!hasTarget:!hasObserver);
 if(centerButton.disabled!==centerDisabled)centerButton.disabled=centerDisabled;
 if(orbitButton.disabled!==orbitDisabled)orbitButton.disabled=orbitDisabled;
 const pressed=String(orbitVisible[atCenter?'center':viewMode]&&!orbitDisabled);
 if(orbitButton.getAttribute('aria-pressed')!==pressed)orbitButton.setAttribute('aria-pressed',pressed);
}
function openMapBodyPicker(opener,event){
 const picker=$('skyMapBodyOpen'),dialog=$('skyMapBodyDialog');
 if(!picker||picker.disabled||!dialog||dialog.open)return;
 // WebKit can retain :focus-visible when a dialog returns focus after a tap.
 let pointer=event.detail>0;
 const setPointer=value=>{pointer=value;opener.toggleAttribute('data-pointer-focus',value);};
 setPointer(pointer);
 picker.click();
 if(!dialog.open)return;
 const input=new AbortController(),options={capture:true,signal:input.signal};
 dialog.addEventListener('pointerdown',()=>setPointer(true),options);
 dialog.addEventListener('keydown',e=>{if(!e.metaKey&&!e.ctrlKey)setPointer(false);},options);
 dialog.addEventListener('close',()=>{
  input.abort();
  requestAnimationFrame(()=>{
   if(!active||dialog.open||!opener.getClientRects().length||document.querySelector('dialog[open]'))return;
   setPointer(pointer);
   opener.focus({preventScroll:true});
  });
 },{once:true});
}
function build(){
 if(built)return;built=true;const view=$('skyMapView'),footer=view.querySelector('.sky-map-footer'),wrap=view.querySelector('.sky-map-wrap');
 const top=document.createElement('header');top.id='mapWsTop';top.className='map-ws-top';
 top.innerHTML=`<button type="button" id="mapWsMenuButton" aria-label="メニュー">${svg(ICON.menu)}</button><div class="map-ws-band-conditions"><button type="button" id="mapWsTitle" class="map-ws-title" aria-label="撮影条件を開く" aria-controls="exploreConditions" aria-expanded="false"><strong class="map-ws-chip-place" data-chip="observer"></strong><span class="map-ws-band-sub"><span class="map-ws-chip" data-chip="body"></span><span class="map-ws-chip" data-chip="target"></span><span class="map-ws-chip" data-chip="alignment"></span></span></button></div><button type="button" id="mapWsShare" aria-label="保存と共有" aria-haspopup="menu">${svg(ICON.share)}</button>`;
 view.append(top);
 const menu=document.createElement('div');menu.id='mapWsMenu';menu.className='map-ws-menu';menu.setAttribute('role','menu');menu.hidden=true;view.append(menu);
 const bodyButton=document.createElement('button');bodyButton.type='button';bodyButton.id='mapWsBodyPicker';
 bodyButton.setAttribute('aria-haspopup','dialog');bodyButton.setAttribute('aria-controls','skyMapBodyDialog');
 bodyButton.innerHTML='<span></span><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
 bodyButton.onclick=event=>openMapBodyPicker(bodyButton,event);
 bodyButton.addEventListener('keydown',e=>{if(!e.metaKey&&!e.ctrlKey)bodyButton.removeAttribute('data-pointer-focus');});
 bodyButton.addEventListener('blur',()=>{if(!$('skyMapBodyDialog')?.open)bodyButton.removeAttribute('data-pointer-focus');});
 top.querySelector('.map-ws-band-conditions').append(bodyButton);
 const retry=document.createElement('button');retry.type='button';retry.id='mapWsBodyRetry';retry.className='map-ws-body-retry';retry.hidden=true;retry.textContent='天体の計算を再試行';retry.onclick=()=>$('skyMapRetry').click();footer.prepend(retry);
 $('skyMapRetry').addEventListener('click',resetBodyCalculations,true);
 const pick=document.createElement('div');pick.id='mapWsPick';pick.className='map-ws-pick';pick.hidden=true;pick.innerHTML='<span role="status"></span><button type="button" id="mapWsUndo" hidden>元に戻す</button>';wrap.append(pick);
 const placement=document.createElement('details');placement.id='mapWsPlacement';
 placement.innerHTML='<summary>地図の中心に置く</summary><div><button type="button" class="chip" id="mapWsPlaceObserver">撮影地点にする</button><button type="button" class="chip" id="mapWsPlaceTarget">対象にする</button></div>';
 view.querySelector('.explore-place-tools').after(placement);
 for(const [id,mode] of [['mapWsPlaceObserver','observer'],['mapWsPlaceTarget','target']])$(id).onclick=()=>{
  document.dispatchEvent(new CustomEvent('astronotes-explore-toggle-conditions',{detail:{open:false}}));
  placeAtCenter(mode);
 };
 document.addEventListener('astronotes-explore-dropdown',e=>{if(!e.detail.open)placement.open=false;});
 const north=document.createElement('button');north.type='button';north.id='mapWsNorth';north.className='map-ctl map-ws-north';north.setAttribute('aria-label','北を上に戻す');
 north.innerHTML='<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 3l4 9h-8z" fill="#e5484d"/><path d="M12 21l-4-9h8z" fill="currentColor" opacity=".7"/></svg>';north.onclick=()=>host()?.map.setRotation(0);wrap.append(north);
 wrap.append(createMapTools());syncMapTools();
 // 2026-11-26: 新しい地点は地図のボタンから（撮影地点が中心の時。目標物が中心ではカードの「新しい地点を探す」）
 const findNew=document.createElement('button');findNew.type='button';findNew.id='mapWsNewPlaces';findNew.className='map-ws-new';findNew.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><span>新しい地点を探す</span>';
 findNew.setAttribute('aria-label','新しい撮影地点を探す');findNew.onclick=()=>{
  const h=host();
  if(!h||!targetReady(h)){document.dispatchEvent(new CustomEvent('astronotes-explore-toggle-conditions',{detail:{open:true}}));return;}
  document.dispatchEvent(new CustomEvent('astronotes-explore-open-sheet',{detail:{tab:'new',search:true}}));
 };wrap.append(findNew);
 const home=document.createElement('button');home.type='button';home.id='mapWsHome';home.className='map-ws-home';home.hidden=true;home.textContent='撮影地点へ戻る';home.onclick=()=>{const h=host(),o=h?.session.observer;if(validPoint(o))h.map.setCenter(o.latitude,o.longitude);};wrap.append(home);

 const info=document.createElement('div');info.id='mapWsInfo';info.className='map-ws-info';info.tabIndex=0;info.setAttribute('aria-label','天体と対象の情報。横にスワイプ');
 const page=(body,cells)=>`<div class="map-ws-page"${body?` data-body="${body}"`:''}>${cells.join('')}</div>`;
 info.innerHTML=page('moon',[cell('wsBody','月',colour('moon')),cell('wsBodyRise','月の出',RISE.moon,1),cell('wsBodySet','月の入',SET.moon,1)])
  +page(null,[cell('wsTarget','対象','#c876ff'),cell('wsGap','ずれ（方位）','#c876ff'),cell('wsPass','対象の通過','#c876ff',1)])
  +page(null,[cell('wsDawn','朝の薄明','#7d8fe6',1),cell('wsGolden','夕方の低い光','var(--ray-sun)',1),cell('wsDusk','夕方の薄明','#7d8fe6',1)]);
 info.firstElementChild.id='mapWsSelectedBodyPage';
 info.children[1].id='mapWsGeometryPage';
 const dots=document.createElement('div');dots.id='mapWsDots';dots.className='map-ws-dots';dots.setAttribute('aria-hidden','true');dots.innerHTML='<span></span>'.repeat(3);
 const card=document.createElement('section');card.id='mapWsCard';card.className='map-ws-card';card.setAttribute('aria-label','撮影地点と対象');
 card.innerHTML='<div class="map-ws-card-text"><b id="mapWsCardPlace"></b><span id="mapWsCardMeta"></span><button type="button" id="mapWsCardOverlap" class="map-ws-card-overlap"></button></div><div class="map-ws-card-actions"><button type="button" id="mapWsCardView" class="map-ws-card-view"><span>見え方</span><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg></button><button type="button" id="mapWsCardSecond" class="map-ws-card-second" hidden><span></span></button></div>';
 footer.prepend(card,info,dots);placeInfo();
 // 条件帯を押すと探すの撮影条件（ポップアップ）を開く。段の持ち主は探すのcontroller。
 // 2026-11-26: 条件帯はその場で展開する（段の持ち主は探すのcontroller）。シート中は全画面の撮影条件へ。
 $('mapWsTitle').onclick=()=>document.dispatchEvent(new Event('astronotes-explore-toggle-conditions'));
 $('mapWsTitle').setAttribute('aria-expanded','false');document.addEventListener('astronotes-records-change',()=>queueMicrotask(schedule));document.addEventListener('astronotes-explore-dropdown',e=>{if(e.detail?.open)cloneFormStyles();$('mapWsTitle')?.setAttribute('aria-expanded',String(!!e.detail?.open));const h=host();if(h)setTitle(h);h?.redraw();});
 $('mapWsMenuButton').onclick=()=>{const tools=$('toolsButton');(tools&&!tools.hidden?tools:$('homeLink'))?.click();};
 $('mapWsCardView').onclick=()=>{const h=host(),action=viewMode==='target'||targetSel?.kind==='record'?$('mapWsCardView').dataset.action:'view';
  if(action==='conditions'||h&&action==='view'&&(!validPoint(h.session.observer)||!h.session.target)){document.dispatchEvent(new CustomEvent('astronotes-explore-toggle-conditions',{detail:{open:true}}));return;}
  if(action==='use'){useSelectionAsObserver();return;}
  if(action==='search'){document.dispatchEvent(new CustomEvent('astronotes-explore-open-sheet',{detail:{tab:'new',search:true}}));return;}
  if(action==='candidate'){if(!h||!targetSelectionCurrent(h))return;const id=targetSel.row.id;targetSel=null;document.dispatchEvent(new CustomEvent('astronotes-explore-open-sheet',{detail:{tab:'new',search:false,candidateId:id}}));return;}
  document.dispatchEvent(new Event('astronotes-explore-open-view'));};
 $('mapWsCardSecond').onclick=()=>{const action=$('mapWsCardSecond').dataset.action;if(action==='clear'){targetSel=null;host()?.redraw();schedule();return;}
  // 段階③: 記録の地点の一覧は「重なる日」（今の条件で絞る）
  if(action==='list')document.dispatchEvent(new Event('astronotes-explore-open-opportunities'));};
 $('mapWsCardOverlap').onclick=e=>{const at=+e.currentTarget.dataset.at;if(Number.isFinite(at)&&at)host()?.setTime(at);};
 $('mapWsShare').onclick=e=>{e.stopPropagation();const row=$('skyMapShareRow');openMenu(e.currentTarget,[...row.querySelectorAll('button')].filter(b=>!b.hidden));};
 document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!e.target.closest('#mapWsMenu,#mapWsShare'))menu.hidden=true;});
 info.addEventListener('scroll',updateInfoDots,{passive:true});
 info.addEventListener('click',e=>{if(e.target.closest('button'))return;const body=e.target.closest('[data-body]')?.dataset.body;if(body)chooseBody(body);});
 dots.firstElementChild.classList.add('on');
 for(const button of info.querySelectorAll('button.map-ws-cell:not([data-orbit])'))button.addEventListener('click',()=>{const at=+button.dataset.at;if(Number.isFinite(at)&&at)host()?.setTime(at);});
 if(typeof ResizeObserver==='function')new ResizeObserver(()=>{if(!footer.offsetHeight)return;view.style.setProperty('--ws-footer-h',footer.offsetHeight+'px');if(active){const h=host();if(h&&measureHours()&&h.session.scrubMode==='hour')h.syncTimeline(true);h?.redraw();}}).observe(footer);
}
// 既存の釦を動かさず、押した結果だけ渡す。状態と権限の判定を2か所に持たない。
function openMenu(anchor,buttons){
 const menu=$('mapWsMenu');menu.replaceChildren();
 for(const source of buttons){if(!source)continue;const item=document.createElement('button');item.type='button';item.setAttribute('role','menuitem');item.disabled=!!source.disabled;item.textContent=source.getAttribute('aria-label')||source.textContent.trim();
 const pressed=source.getAttribute('aria-pressed');if(pressed!==null){item.setAttribute('role','menuitemcheckbox');item.setAttribute('aria-checked',pressed);}item.onclick=()=>{menu.hidden=true;source.click();};menu.append(item);}
 const r=anchor.getBoundingClientRect();menu.style.top=Math.round(r.bottom+4)+'px';menu.hidden=false;menu.style.right=Math.max(8,Math.round(innerWidth-r.left+6-(anchor.id==='mapWsShare'?r.width+6:0)))+'px';
}
function setCell(id,main,sub,sub2,at){const c=$(id);if(!c)return;const [b,i1,i2]=[c.querySelector('b'),...c.querySelectorAll('i')];if(b.textContent!==main)b.textContent=main;if(i1.textContent!==(sub||''))i1.textContent=sub||'';if(i2.textContent!==(sub2||''))i2.textContent=sub2||'';
if(c.tagName==='BUTTON'&&!c.dataset.orbit){c.dataset.at=Number.isFinite(at)?String(at):'';c.disabled=!Number.isFinite(at);}}
function crossing(points,level,rising){for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];if((a.altitude<level)===rising&&(b.altitude<level)!==rising)return a.at+(level-a.altitude)/(b.altitude-a.altitude)*(b.at-a.at);}return null;}
function updateInfoDots(){
 const info=$('mapWsInfo'),pages=[...info.children],visible=pages.filter(page=>!page.hidden),i=Math.round(info.scrollLeft/(info.clientWidth||1));
 [...$('mapWsDots').children].forEach((dot,k)=>{dot.hidden=pages[k].hidden;dot.classList.toggle('on',pages[k]===visible[i]);});
}
const lightCache=new Map();
function updateSelectedBody(h){
 const s=h.session,body=s.body,name=AstroNotesBodies.definition(body)?.name||'天体',targetPoint=targetSkyPoint(h),centerPoint=mapSkyPoint(h),eye=centerPoint||targetPoint||s.eye;
 const data=dailyOf(h,body,eye),page=$('mapWsSelectedBodyPage'),prefix='wsBody';
 page.dataset.body=body;page.classList.add('map-ws-current');page.style.setProperty('--ws-c',colour(body));
 let st=null;if(data&&eye)try{st=h.skyState(body,s.at,eye);}catch{/* 読込・計算の欠測は—にする */}
 let light='';if(st){if(body==='sun')light=st.altitude>.5?'影 '+(1/Math.tan(st.altitude*RAD)).toFixed(1)+'倍':'影 —';
  else if(body==='moon')light=Number.isFinite(st.illuminatedFraction)?'輝面 '+Math.round(st.illuminatedFraction*100)+'%':'輝面 —';
  // Sirius V magnitude: SIMBAD https://simbad.cds.unistra.fr/simbad/sim-id?Ident=Sirius
  else if(body==='sirius')light='明るさ −1.46等';
  else{const key=body+'|'+Math.floor(s.at/60000);let value=lightCache.get(key);if(value===undefined){try{const magnitude=AstroNotesBodies.light(body,s.at).magnitude;value=Number.isFinite(magnitude)?magnitude:null;}catch{value=null;}lightCache.set(key,value);if(lightCache.size>32)lightCache.delete(lightCache.keys().next().value);}light=value===null?'明るさ —':'明るさ '+value.toFixed(1)+'等';}}
 const heading=$('wsBody').querySelector('small'),label=name+(centerPoint?' · 地図中央':targetPoint?' · 対象付近':'');
 if(heading.textContent!==label)heading.textContent=label;
 const failed=!!s.passError||targetReady(h)&&(recordState.key.startsWith(recordConditionKey(h))&&!!recordState.error||lineState.key===targetKey(h)&&!!lineState.error);
 setCell(prefix,st?degrees(st.azimuth):'—',st?'高度 '+signed(st.altitude):failed?'計算できません':!eye?'撮影地点を選ぶ':'計算中…',light);
 const pass=data?passAt(h,body,data,eye):null;
 for(const [side,id] of [['rise',prefix+'Rise'],['set',prefix+'Set']]){const e=pass?.[side];$(id).querySelector('small').textContent=body==='sun'?(side==='rise'?'日の出':'日の入'):name+'の'+(side==='rise'?'出':'入');$(id).style.setProperty('--ws-c',(side==='rise'?RISE:SET)[body]||colour(body));setCell(id,e?hhmm(e.at):'—',e?degrees(e.azimuth):data?'この日は出入りなし':'',e&&AstroNotesSkyMap.dayStart(e.at)!==AstroNotesSkyMap.dayStart(s.at)?monthDay(e.at):'',e?.at);}
 $('mapWsBodyPicker').setAttribute('aria-busy',String(!!(s.observer||targetPoint||centerPoint)&&!data&&!failed));$('mapWsBodyRetry').hidden=!failed;
 const geometryPage=$('mapWsGeometryPage');
 const skyOnly=!!(targetPoint||centerPoint);
 if(geometryPage.hidden!==skyOnly){
  geometryPage.hidden=skyOnly;$('mapWsInfo').scrollLeft=0;updateInfoDots();
 }
}
function resetBodyCalculations(){
 stopLineAhead();completedLines.clear();
 clearTimeout(bandState.timer);clearTimeout(overlapCache.timer);lineState={key:'',lines:null,busy:false};recordState={key:'',rows:null,busy:false};bandState={key:'',base:'',runs:[],pending:'',timer:0};searchBandCache={key:'',band:null};overlapCache={key:'',windows:null,pending:'',ready:'',timer:0};passCache.clear();lightCache.clear();resetObsRecords();targetSel=null;schedule();
}
// 上部の地点名を押すと、今の条件欄がそのまま地図の上に開く。検索の入口を1か所にする。
const PLACED='地図で置いた地点';
function conditionsOpen(){return $('skyMapView').classList.contains('map-ws-conditions');}
function openPanel(){const c=$('exploreConditions');if(!c)return;$('skyMapView').classList.add('map-ws-conditions');c.open=true;c.scrollTop=0;}
function closePanel(){$('skyMapView').classList.remove('map-ws-conditions');}
// 三脚とピンは、画面中央をその地点として置くだけ。
function notice(text,undo){const bar=$('mapWsPick');clearTimeout(noticeTimer);bar.querySelector('span').textContent=text;const button=$('mapWsUndo');button.hidden=!undo;button.onclick=undo||null;bar.hidden=false;noticeTimer=setTimeout(()=>{bar.hidden=true;},undo?7000:3500);host()?.redraw();}
function placeAtCenter(mode){
 const h=host();if(!h)return;const s=h.session,c=h.map.center(),o=s.observer,near=validPoint(o)&&Math.abs(c.latitude-o.latitude)<1e-6&&Math.abs(c.longitude-o.longitude)<1e-6,label=mode==='observer'?'撮影地点':'対象';
 if(near){notice('地図を動かして、中央の十字を'+label+'にしたい場所へ合わせてください');return;}
 if(mode==='target'){
  $('mapWsPick').hidden=true;const before={target:s.target,custom:s.custom,customTarget:s.customTarget,partId:s.partId,matchMode:s.matchMode,limb:s.limb};
  Promise.resolve(h.placePoint('target',c)).then(placed=>{if(placed===true)notice('ここを対象にしました',()=>{$('mapWsPick').hidden=true;host()?.restoreTarget(before);});else if(placed===false)notice('標高を取得できず置けませんでした。もう一度押してください');});return;
 }
 const before=o;h.placePoint('observer',c);notice('ここを撮影地点にしました',()=>{$('mapWsPick').hidden=true;host()?.restoreObserver(before);});
}
// 地図で置いた対象の高さ。撮影地点の高さと同じ形で、条件欄の対象の下に出す。
function renderTargetHeight(){
 let row=$('mapWsTargetHeight');const field=$('skyMapTarget')?.closest('.condition-field'),s=host()?.session;if(!field||!s)return;
 if(!row){
  row=document.createElement('details');row.id='mapWsTargetHeight';row.className='alignment-details map-ws-target-height';row.hidden=true;
  row.innerHTML=('<summary></summary><div class="map-ws-target-fields"><label for="mapWsTargetM">地上から</label><div class="explore-height-value"><input id="mapWsTargetM" type="number" inputmode="decimal" min="0" max="1000" step="any" aria-label="対象の地上からの高さ（メートル）"><span>m</span></div></div>'+
  '<p class="tiny" id="mapWsTargetError" role="status" hidden></p>');
  field.after(row);
  $('mapWsTargetM').onchange=e=>{const input=e.target,value=input.valueAsNumber,error=$('mapWsTargetError'),ok=input.value.trim()&&value>=0&&value<=1000&&host()?.setTargetHeight(value);error.hidden=!!ok;if(!ok)error.textContent='地上からの高さを0〜1000mで入力してください';};
 }
 const custom=s.target?.id==='custom'&&Number.isFinite(s.custom?.heightM);row.hidden=!custom;if(!custom)return;
 const text='対象の高さ：地上から '+s.custom.heightM+'m',summary=row.firstElementChild,input=$('mapWsTargetM');if(summary.textContent!==text)summary.textContent=text;if(document.activeElement!==input&&input.valueAsNumber!==s.custom.heightM)input.value=String(s.custom.heightM);
}
function updateHome(h){const canvas=$('skyMapCanvas'),o=h.session.observer,q=validPoint(o)?h.map.project(o.latitude,o.longitude):null;
$('mapWsHome').hidden=viewMode==='target'||!$('mapWsPick').hidden||!q||Math.hypot(q[0]-canvas.clientWidth/2,q[1]-canvas.clientHeight/2)<=Math.min(canvas.clientWidth,canvas.clientHeight)*.2;}
function drawBand(h,ctx,{start,end,width,height,pixelsPerMs},eye,geo){
 const s=h.session,body=s.body,point=pointBody(body);ctx.fillStyle=colour(body);
 for(let x=0;x<width;x+=4){
  const at=start+x/pixelsPerMs;
  if(h.skyState(body,at,eye).altitude>0&&(!point||nightAllowed(body,at,eye)))ctx.fillRect(x,height-5,4,5);
 }
 if(!geo)return;
 const dayMs=24*HOUR;
 for(let day=AstroNotesSkyMap.dayStart(start);day<end;day+=dayMs){
  const daily=AstroNotesSkyMap.daily(body,day,eye,h.skyState);
  for(const route of passesOf(h,body,daily,eye))for(const pass of AstroNotesSkyMap.passages(route,geo.azimuth,body,eye,h.skyState)){
   if(pass.at<day||pass.at>=day+dayMs||pass.at<start||pass.at>end)continue;
   const x=(pass.at-start)*pixelsPerMs;
   ctx.save();ctx.translate(x,height-11);ctx.rotate(Math.PI/4);ctx.fillStyle='#c876ff';ctx.strokeStyle='#000';ctx.fillRect(-3,-3,6,6);ctx.strokeRect(-3,-3,6,6);ctx.restore();
  }
 }
}
function update(){
 const h=host();if(!h){evaluate();return;}const s=h.session,mainId=mainBody(h),body=AstroNotesBodies.definitions.find(d=>d.id===mainId)?.name||'天体';
 if(viewMode==='obs'&&!validPoint(s.observer)&&targetReady(h))setViewMode('target');
 else if(viewMode==='target'&&!targetReady(h)&&validPoint(s.observer))setViewMode('obs');
 if(viewMode==='obs'&&clearStaleObsSelection(h))h.redraw();
 syncMapTools();setTitle(h);if(viewMode==='target'||targetSel?.kind==='record')updateTargetCard(h);else{updateCard(h);const second=$('mapWsCardSecond');if(second)second.hidden=true;}
 updateSelectedBody(h);
 const geo=targetGeometry(h);setCell('wsTarget',geo?degrees(geo.azimuth):'—',geo?'仰角 '+geo.elevation.toFixed(2)+'°':'対象を選ぶと出ます',geo?(geo.distanceKm<1?Math.round(geo.distanceKm*1000)+'m':geo.distanceKm.toFixed(2)+'km'):'');
 $('wsTarget').querySelector('small').textContent=s.target?.name||'対象';
 const main=s.eye?(()=>{try{return h.skyState(mainId,s.at,s.eye);}catch{return null;}})():null;
 setCell('wsGap',geo&&main?signed(AstroNotesSkyMap.delta(main.azimuth,geo.azimuth)):'—',geo&&main?'高度 '+signed(main.altitude-geo.elevation):'',body);
 const data=dailyOf(h,mainId),route=data?passAt(h,mainId,data):null,pass=geo&&route?AstroNotesSkyMap.passages(route,geo.azimuth,mainId,s.eye,h.skyState)[0]:null;setCell('wsPass',pass?hhmm(pass.at):geo&&data?'なし':'—',pass?'高度 '+pass.altitude.toFixed(1)+'°':'','',pass?.at);
 const sun=dailyOf(h,'sun',previewSkyPoint(h)||s.eye);
 for(const [id,level,rising] of [['wsDawn',-6,true],['wsGolden',6,false],['wsDusk',-6,false]]){
  const at=sun?crossing(sun.points,level,rising):null;
  setCell(id,at?hhmm(at):'—',at?level<0?'太陽 高度−6°':'太陽 高度6°':'','',at);
 }
 $('mapWsNorth').firstElementChild.style.transform='rotate('+(-h.map.rotation())+'deg)';if(s.body!==lastBody){lastBody=s.body;$('mapWsInfo').scrollLeft=0;}
 fitTarget(h);updateHome(h);
}
// 見え方も同じ上部バーの全画面にして、切替ボタンの位置を地図と揃える。条件を開いたままだと絵が画面の外へ出る。
// 上部の条件帯: 天体・対象・重ね方・撮影地点名。
function setTitle(h){
 const s=h.session,title=$('mapWsTitle'),body=AstroNotesBodies.definitions.find(d=>d.id===s.body)?.name||'天体',extras=h.extraCount?.()||0,
 select=$('skyMapAlignmentControls')?.querySelector('select'),alignment=s.target?(select?.selectedOptions?.[0]?.textContent?.trim()||'重ね方'):'重ね方',
 place=!validPoint(s.observer)?'撮影地点を選ぶ':(/^-?[\d.]+, -?[\d.]+$/.test(s.observer.name||'')?'撮影地点':s.observer.name||'撮影地点');
 const bodyButton=$('mapWsBodyPicker');
 if(bodyButton.firstElementChild.textContent!==body){bodyButton.firstElementChild.textContent=body;bodyButton.setAttribute('aria-label',`天体を選ぶ（現在：${body}）`);}
 bodyButton.disabled=!!$('skyMapBody').disabled;
 const values={body,target:s.target?.name?s.target.name+(extras?'ほか'+extras+'件':''):'対象を選ぶ',alignment,observer:place};
 for(const chip of title.querySelectorAll('[data-chip]')){const v=values[chip.dataset.chip];if(chip.textContent!==v)chip.textContent=v;}
 const view=$('skyMapView'),showBodyInTitle=!view.classList.contains('map-ws')||view.hasAttribute('data-explore-sheet');
 const label=(title.getAttribute('aria-expanded')==='true'?'撮影条件を閉じる：':'撮影条件を開く：')+[place,...(showBodyInTitle?[body]:[]),values.target,alignment].join('、');if(title.getAttribute('aria-label')!==label)title.setAttribute('aria-label',label);
}
const pad2=n=>String(n).padStart(2,'0');
// 撮影条件や見え方から地図へ戻った時、同じ撮影地点と対象なら利用者が動かした位置と縮尺を保つ。
const viewKey=h=>{const s=h.session;return JSON.stringify([s.observer?.latitude,s.observer?.longitude,s.target?.id,s.target?.latitude,s.target?.longitude,s.partId]);};
// その日に天体の円盤が対象の本体に掛かる時間。目標方位の通過の前後だけを、見え方と同じ外形と見かけの高度で調べる。
function overlapWindows(h){
 const s=h.session,t=s.target,o=s.eye,body=s.body;if(!validPoint(s.observer)||!h.targetOn||!validPoint(t))return null;
 // 撮影地点を変えた直後は目の位置（標高）がまだ前の地点のまま。前の地点の時間を出さない。
 if(!o||s.timelinePending||Math.abs(o.latitude-s.observer.latitude)>1e-9||Math.abs(o.longitude-s.observer.longitude)>1e-9)return undefined;
 if(!s.dailies?.[body])return s.passError?null:undefined;
 const day=AstroNotesSkyMap.dayStart(s.at),key=JSON.stringify([body,day,o.latitude,o.longitude,o.elevation,t.id,t.latitude,t.longitude,t.parts?.map(p=>p.m),s.custom?.heightM,globalThis.AstroNotesAtmosphere?.dataKey?.()]);
 if(overlapCache.key===key)return overlapCache.windows;
 // 日を送り続けている間は数えず、止まってから1回だけ数える（1日で数十ms掛かる）。
 if(overlapCache.pending!==key){clearTimeout(overlapCache.timer);overlapCache.pending=key;overlapCache.timer=setTimeout(()=>{overlapCache.ready=key;schedule();},160);}
 if(overlapCache.ready!==key)return undefined;
 let windows=[];
 try{
  const view=AstroNotesAlign.prepareDailyView(o,t,body,{partId:'__whole',eyeM:0}),geo=targetGeometry(h),data=dailyOf(h,body);
  if(geo&&data){
   const seen=new Set();
   for(const pass of passesOf(h,body,data))for(const point of AstroNotesSkyMap.passages(pass,geo.azimuth,body,o,h.skyState)){
    const hit=at=>nightAllowed(body,at,o)&&!!view(at,at)[0]?.intersects;let cur=null;
    for(let at=point.at-2400000;at<=point.at+2400000;at+=20000){if(hit(at)){if(!cur)cur={from:at,to:at};cur.to=at;}else if(cur){windows.push(cur);cur=null;}}if(cur)windows.push(cur);
    // 走査の端でもまだ重なっていれば、重ならなくなるまで外へ（幅の広い対象、最大±6時間）。
    for(const w of windows){if(w.from<=point.at-2400000)for(let at=w.from-20000;at>=point.at-21600000&&hit(at);at-=20000)w.from=at;if(w.to>=point.at+2400000)for(let at=w.to+20000;at<=point.at+21600000&&hit(at);at+=20000)w.to=at;}
   }
   // 表示と時刻送りは、確かに重なっている分の範囲（始まりは分を切り上げ、終わりは切り捨て）。
   // 重なり合う区間は1つにまとめる。表示は確かに重なっている分（始まりは分の切り上げ、終わりは切り捨て）、1分に満たなければその分。
   windows.sort((a,b)=>a.from-b.from);const merged=[];for(const w of windows){const last=merged.at(-1);if(last&&w.from<=last.to+20000)last.to=Math.max(last.to,w.to);else merged.push({...w});}
   windows=merged.filter(w=>w.to>=day&&w.from<day+86400000).map(w=>displayWindow(w,body,o));void seen;
  }
 }catch(e){globalThis.AstroNotesErrors?.note('map.overlapWindows',e);windows=null;}
 overlapCache={key,windows,pending:key,ready:key,timer:0};return windows;
}
function updateCard(h){
 const s=h.session,geo=targetGeometry(h),place=$('mapWsCardPlace'),meta=$('mapWsCardMeta'),overlap=$('mapWsCardOverlap'),view=$('mapWsCardView');if(!place)return;
 const ready=validPoint(s.observer)&&!!s.target;
 const name=!validPoint(s.observer)?'撮影地点を選んでください':(/^-?[\d.]+, -?[\d.]+$/.test(s.observer.name||'')?'撮影地点':s.observer.name||'撮影地点')+(s.target?' → '+s.target.name:'');
 const km=geo?(geo.distanceKm<1?Math.round(geo.distanceKm*1000)+'m':geo.distanceKm.toFixed(1)+'km'):'';
 const text=geo?'対象まで '+km+' ・ 方位 '+geo.azimuth.toFixed(1)+'°':ready?'':'上の条件から撮影地点と対象を選ぶと、重なる時間が出ます';
 if(place.textContent!==name)place.textContent=name;if(meta.textContent!==text)meta.textContent=text;
 const windows=ready?overlapWindows(h):null,bodyName=AstroNotesBodies.definitions.find(d=>d.id===s.body)?.name||'天体';
 const fmt=at=>{const d=new Date(at+JST);return pad2(d.getUTCHours())+':'+pad2(d.getUTCMinutes());};
 const label=!ready||!geo?'':windows===undefined?'重なる時間を調べています…':windows===null?'重なる時間を計算できません':windows.length?'重なる '+windows.map(w=>w.brief?fmt(w.from)+'頃（1分未満）':fmt(w.from)+'〜'+fmt(w.to)).join('・'):'この日は'+bodyName+'が対象に重ならない';
 if(overlap.textContent!==label)overlap.textContent=label;overlap.hidden=!label;overlap.dataset.at=windows?.length?String(windows[0].from):'';overlap.disabled=!windows?.length;
 overlap.classList.toggle('map-ws-card-hit',!!windows?.length);
 view.disabled=false;const viewLabel=ready?'見え方を開く':'撮影条件を開く';if(view.getAttribute('aria-label')!==viewLabel)view.setAttribute('aria-label',viewLabel);view.firstElementChild.textContent=ready?'見え方':'条件';
}
function showScene(){
 const view=$('skyMapView'),h=host();build();if(!h)return;view.classList.add('map-ws-scene');setTitle(h);
 for(let node=view;node&&node!==document.body;node=node.parentElement)for(let sibling=node.previousElementSibling;sibling;sibling=sibling.previousElementSibling){sibling.classList.add('map-ws-hide');sceneHidden.push(sibling);}
 scrollTo(0,0);requestAnimationFrame(()=>{if(sceneFull)scrollTo(0,0);});
}
function leaveScene(){sceneFull=false;closePanel();$('skyMapView').classList.remove('map-ws-scene');for(const node of sceneHidden)node.classList.remove('map-ws-hide');sceneHidden=[];}
// 対象があるときは、対象がちょうど円の縁に来る縮尺で開く。条件を変えたときも合わせ直す。
function fitTarget(h){
 if(viewMode==='target')return;
 const s=h.session,o=s.observer,t=s.target;if(!validPoint(o)||!h.targetOn||!validPoint(t))return;
 const key=[o.latitude,o.longitude,t.id,t.latitude,t.longitude,s.partId,active].join();if(key===fittedKey)return;
 const canvas=$('skyMapCanvas'),w=canvas.clientWidth,ht=canvas.clientHeight;if(!w||!ht)return;
 const m=AstroNotesAlign.partTarget(t,s.partId),a=h.map.project(o.latitude,o.longitude),b=h.map.project(m.latitude,m.longitude),distance=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!(distance>=1))return;
 fittedKey=key;h.map.setView(o.latitude,o.longitude,h.map.zoom()+Math.log2(fitRadius(w,ht)/distance));
}
// 別のアプリから戻ると地図の処理が作り直され、全画面と地図の種類が解けて作業画面の部品が残る。描き直しの合図で元に戻す。
function keepWide(){if(!active)return;if(!$('skyMapView').querySelector('.sky-map-wrap').classList.contains('sky-map-wide')){selfClick=true;$('skyMapExpand').click();selfClick=false;}}
// 別のアプリから戻る間は地図の処理が作り直されて権限確認を待つ。ここで閉じると開き直しで位置と縮尺が初期に戻る。
const resuming=()=>{try{return !!SkyMapUI?.resuming?.();}catch{return false;}};
function shouldShow(){const view=$('skyMapView');return !!view&&(view.dataset.exploreStage==='map'||view.dataset.exploreStage==='search'&&view.hasAttribute('data-explore-sheet'))&&!view.hidden&&view.classList.contains('explore-mounted')&&view.dataset.exploreMode==='map'&&!$('skyMapContent')?.hidden&&!!host();}
function evaluate(){
 const view=$('skyMapView');if(view.hidden){wanted=false;if(sceneFull)leaveScene();if(viewMode!=='obs'){viewMode='obs';targetSel=null;targetFitKey='';syncMapTools();view.setAttribute('data-map-center','obs');}}const show=shouldShow();if(show&&!active)enter();else if(!show&&active&&(view.hidden||!resuming()))exit();
 if(view.dataset.exploreMode!=='map'){fittedKey=null;return;}
 const h=host();if(h&&!view.hidden&&view.classList.contains('explore-mounted')&&!$('skyMapContent')?.hidden)fitTarget(h);
}
// 帯の幅がちょうど24時間になる縮尺
function measureHours(){const width=$('skyMapTrack')?.clientWidth||0,next=width?Math.max(12,width/24):hourPixels;if(Math.abs(next-hourPixels)<.01)return false;hourPixels=next;return true;}
// 下の欄は上から、重なる日時、情報欄、日付、時間バー。
function placeInfo(){const footer=$('skyMapView').querySelector('.sky-map-footer'),dates=footer?.querySelector(':scope>.sky-map-candidates');if(dates&&dates.nextElementSibling!==$('mapWsInfo'))dates.after($('mapWsInfo'),$('mapWsDots'));}
function enter(){
 const h=host();if(!h)return;build();placeInfo();if(sceneFull)leaveScene();active=true;h.map.allowRotate?.(true);const view=$('skyMapView');view.classList.add('map-ws');
 if(!view.querySelector('.sky-map-wrap').classList.contains('sky-map-wide')){selfClick=true;$('skyMapExpand').click();selfClick=false;}
 scrubBefore=h.session.scrubMode;measureHours();h.setScrubMode('hour');
 // 撮影地点の周りを見る画面なので、遠くを見ていた続きで開いても円が地図に合う縮尺へ戻す。
 const o=h.session.observer,same=keptView&&keptView.key===viewKey(h);if(validPoint(o)&&!same){if(h.map.zoom()<12)h.map.setView(o.latitude,o.longitude,14);else h.map.setCenter(o.latitude,o.longitude);}
 view.style.setProperty('--ws-footer-h',view.querySelector('.sky-map-footer').offsetHeight+'px');
 // 条件の天体の欄から始める
 const info=$('mapWsInfo');info.scrollLeft=0;updateSelectedBody(h);
 if(same){fittedKey=keptView.fitted;}else{fittedKey=null;fitTarget(h);}h.redraw();schedule();prepareLineAhead();
}
function exit(){
 {const h=host();keptView=h?{key:viewKey(h),fitted:fittedKey}:null;}
 active=false;resetMapSky();stopTargetLine();resetObsRecords();lastBody=null;closePanel();if($('mapWsPick'))$('mapWsPick').hidden=true;host()?.map.allowRotate?.(false);const view=$('skyMapView');view.classList.remove('map-ws');$('mapWsMenu').hidden=true;
 const h=host();if(view.querySelector('.sky-map-wrap')?.classList.contains('sky-map-wide')&&h){selfClick=true;$('skyMapExpand').click();selfClick=false;}fittedKey=null;
 if(h&&scrubBefore&&scrubBefore!==h.session.scrubMode)h.setScrubMode(scrubBefore);else if(h)h.syncTimeline(true);
 scrubBefore=null;h?.redraw();if(sceneFull)showScene();
}
function init(){
 const view=$('skyMapView');if(!view)return;
 document.addEventListener('astronotes-search-state',()=>{if(candidateSheet())refreshCandidatePins();else clearCandidatePins();});
 // The candidate toolbar uses the already visible map while the search sheet is open.
 $('skyMapView').addEventListener('click',e=>{
  if(!candidateSheet()||!e.target.closest('#candidateMapToggle'))return;
  e.preventDefault();e.stopImmediatePropagation();
  const h=host();if(h)fitCandidates(h,candidateSnapshot(h)?.pins||[],{manual:true});
 },true);
 new MutationObserver(evaluate).observe(view,{attributes:true,attributeFilter:['hidden','class','data-explore-mode','data-explore-stage','data-explore-sheet']});
 if($('skyMapContent'))new MutationObserver(evaluate).observe($('skyMapContent'),{attributes:true,attributeFilter:['hidden']});
 // 地図タブでは大きくしない。全画面に入るのは地図の中の拡大ボタンだけ。撮影地点が無くても同じ画面のまま。
 view.querySelector('.sky-map-wrap')?.addEventListener('click',e=>{if(selfClick||!e.target.closest('#skyMapExpand')||!view.classList.contains('explore-mounted')||!host())return;if(!active&&e.currentTarget.classList.contains('sky-map-wide')){wanted=false;return;}e.stopPropagation();
 if(active)return;wanted=true;evaluate();},true);
 document.addEventListener('click',e=>{if(e.target.closest?.('#exploreShowResult'))setTimeout(()=>{if(sceneFull)scrollTo(0,0);const h=host();if(active&&h&&validPoint(h.session.observer)&&!$('exploreConditions').open)h.map.setCenter(h.session.observer.latitude,h.session.observer.longitude);},0);
 },true);
 evaluate();
}
init();
})(typeof globalThis!=='undefined'?globalThis:this);
