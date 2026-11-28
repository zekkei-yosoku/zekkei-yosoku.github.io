/* Native horizontal time ruler. The scale is fixed in pixels, independent of viewport width. */
(function(g){
'use strict';
const DAY=86400000,MINUTE=60000,OFFSET=32400000,EXTENT=4096;
const scale=mode=>mode==='date'?{step:DAY,pixels:24,labelEvery:2}:mode==='hour'?(g.AstroNotesMapWorkspace?.hourPixels?.()?{step:3600000,pixels:g.AstroNotesMapWorkspace.hourPixels(),labelEvery:3}:{step:3600000,pixels:24,labelEvery:2}):{step:MINUTE,pixels:4,labelEvery:15};
const labelInset=root=>Number.parseFloat(g.getComputedStyle?.(root).getPropertyValue('--timeline-label-inset'))||0;
const advance=(at,pixels,mode)=>{const s=scale(mode),units=pixels/s.pixels;return at+Math.sign(units)*Math.round(Math.abs(units))*s.step;};
// Solar elevation drives a continuous sky palette, including blue and golden hours.
const skyStops=[[-18,[9,18,47]],[-12,[20,38,85]],[-6,[67,84,138]],[-3,[160,109,145]],[-.833,[237,151,110]],[2,[246,188,112]],[6,[223,214,172]],[12,[145,197,223]],[30,[100,171,214]],[60,[64,145,197]]];
function skyColor(at,observer,sun){
 if(!observer||typeof sun!=='function')return null;
 const h=sun(at,observer)?.geometricAltitude;if(!Number.isFinite(h))return null;
 for(let i=1;i<skyStops.length;i++){const a=skyStops[i-1],b=skyStops[i];if(h<=b[0]){const t=Math.max(0,Math.min(1,(h-a[0])/(b[0]-a[0])));return a[1].map((v,j)=>Math.round(v+(b[1][j]-v)*t));}}
 return skyStops[skyStops.length-1][1].slice();
}
function skyInk(rgb){const l=rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);return (1.05/(l+.05)>=(l+.05)/.05)?'#fff':'#000';}
function solarPhase(at,observer,sun){
 if(!observer||typeof sun!=='function')return null;
 const h=sun(at,observer)?.geometricAltitude;
 if(!Number.isFinite(h))return null;
 if(h < -6)return 'night';if(h >= 6)return 'day';
 return sun(at+60000,observer).geometricAltitude>=sun(at-60000,observer).geometricAltitude?'morning':'evening';
}
// The preview ruler paints a viewport, so its time axis has no native scroll extent.
function mountMinuteRuler({root,tape,enabled,onChange,onSettle,format,describe,getObserver,sun}){
 const perPixel=MINUTE/scale('time').pixels,labelEvery=scale('time').labelEvery,solarStep=5*MINUTE;
 const min=Date.UTC(100,0,1)-OFFSET,max=Date.UTC(10000,0,1)-OFFSET-1;
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
 if(!ctx)return null;
 canvas.className='sky-minute-ruler';canvas.hidden=true;canvas.setAttribute('aria-hidden','true');root.append(canvas);
 const reduced=g.matchMedia?.('(prefers-reduced-motion: reduce)');
 const clamp=at=>Math.max(min,Math.min(max,Math.round(at)));
 const palette=new Map();
 let active=false,width=0,height=0,dpr=0,font='',line='',text='',background='',observer,observerKey='';
 let at=null,phase=null,held=null,coast=null,pending=null,frame=0,wheelTimer=0,dirty=false,settleNext=false;
 function samples(t){
  if(!palette.has(t)){
   if(palette.size>=512)palette.delete(palette.keys().next().value);
   palette.set(t,skyColor(t,observer,sun));
  }
  return palette.get(t);
 }
 function colorAt(t){
  const a=Math.floor(t/solarStep)*solarStep,low=samples(a),high=samples(a+solarStep);
  if(!low||!high)return null;
  return low.map((v,i)=>Math.round(v+(high[i]-v)*(t-a)/solarStep));
 }
 function measure(){
  const w=root.clientWidth,h=root.clientHeight,ratio=g.devicePixelRatio||1;
  const style=g.getComputedStyle(root);
  const nextObserver=getObserver(),key=JSON.stringify(nextObserver);
  const nextFont=style.fontFamily,nextLine=style.getPropertyValue('--line').trim(),nextText=style.getPropertyValue('--secondary').trim(),nextBackground=style.getPropertyValue('--sunk').trim();
  const resized=w!==width||h!==height||ratio!==dpr;
  const changed=resized||key!==observerKey||nextFont!==font||nextLine!==line||nextText!==text||nextBackground!==background;
  if(!changed)return false;
  width=w;height=h;dpr=ratio;font=nextFont;line=nextLine;text=nextText;background=nextBackground;
  if(resized){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
  if(observerKey!==key){observer=nextObserver;observerKey=key;palette.clear();}
  return true;
 }
 function paint(value){
  if(!width||!height)return;
  const start=value-width/2*perPixel,end=start+width*perPixel;
  const position=time=>(time-start)/perPixel;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const first=Math.floor(start/solarStep)*solarStep,last=Math.ceil(end/solarStep)*solarStep;
  const hasSky=!!samples(first);
  if(hasSky){
   const gradient=ctx.createLinearGradient(position(first),0,position(last),0);
   for(let t=first;t<=last;t+=solarStep)gradient.addColorStop((t-first)/(last-first),`rgb(${samples(t)})`);
   ctx.fillStyle=gradient;
  }else ctx.fillStyle=background||'#1c2024';
  ctx.fillRect(0,0,width,height);
  const tick=Math.floor(start/MINUTE)*MINUTE,pixel=position(tick),step=MINUTE/perPixel;
  ctx.fillStyle=hasSky?'rgba(0,0,0,.25)':line||'#665e64';
  for(let x=pixel;x<=width;x+=step)ctx.fillRect(x,5,1,8);
  if(hasSky){
   ctx.fillStyle='rgba(255,255,255,.28)';
   for(let x=pixel+1;x<=width;x+=step)ctx.fillRect(x,5,1,8);
  }
  ctx.font='11px '+(font||'system-ui');ctx.textAlign='center';ctx.textBaseline='top';
  const spacing=labelEvery*MINUTE;
  for(let t=Math.floor(start/spacing)*spacing;t<=end+spacing;t+=spacing){
   const x=position(t);if(x<-24||x>width+24)continue;
   const rgb=colorAt(t);ctx.fillStyle=rgb?skyInk(rgb):text||'#ddd';
   ctx.fillText(format(t,'time'),x,21);
  }
 }
 function show(value,force=false){
  if(!force&&at===value)return;
  at=value;paint(at);
  root.setAttribute('aria-valuenow',String(at));root.setAttribute('aria-valuetext',describe(at,'time'));
 }
 function publish(value){
  const next=clamp(value);
  if(next===at)return;
  show(next);dirty=true;onChange(next);
 }
 function cancelMotion(){
  cancelAnimationFrame(frame);frame=0;clearTimeout(wheelTimer);wheelTimer=0;coast=null;pending=null;settleNext=false;
 }
 function release(){
  const pointer=held?.id;held=null;
  if(pointer!==undefined&&root.hasPointerCapture?.(pointer))root.releasePointerCapture(pointer);
 }
 function stop(){cancelMotion();release();dirty=false;}
 function snap(value){
  const step=(value-phase)/MINUTE;
  return phase+Math.sign(step)*Math.round(Math.abs(step))*MINUTE;
 }
 function settle(){
  settleNext=true;queue();
 }
 function queue(){
  if(!frame)frame=requestAnimationFrame(tick);
 }
 function tick(now){
  frame=0;
  if(!active||!enabled()){stop();return;}
  let value=pending??at;pending=null;
  if(coast){
   if(coast.last===null){coast.last=now;coast.value=value;}
   else{
    // Decay by real time. A blocked frame may skip inertia, rather than jump across it.
    const elapsed=Math.max(0,now-coast.last),dt=Math.min(elapsed,34),decay=320;
    coast.last=now;
    coast.value+=coast.speed*decay*(1-Math.exp(-dt/decay))*perPixel;
    coast.speed*=Math.exp(-elapsed/decay);
    value=coast.value;
    if(Math.abs(coast.speed)<=.045||value<=min||value>=max){coast=null;settleNext=true;}
   }
  }
  const finish=settleNext;settleNext=false;
  publish(finish&&(dirty||value!==at)?snap(value):value);
  if(finish&&dirty){dirty=false;onSettle(at);}
  if(coast)queue();
 }
 root.addEventListener('pointerdown',e=>{
  if(!active||!enabled()||e.isPrimary===false||e.button!==0||held)return;
  cancelMotion();
  held={id:e.pointerId,x:e.clientX,y:e.clientY,at,drag:false,samples:[[e.timeStamp,e.clientX]]};
  if(e.pointerType==='mouse')root.setPointerCapture?.(e.pointerId);
 });
 function move(e){
  if(!held||held.id!==e.pointerId||!enabled())return;
  const dx=held.x-e.clientX,dy=Math.abs(held.y-e.clientY);
  if(!held.drag){
   if(dy>6&&dy>Math.abs(dx)){release();settle();return;}
   if(Math.abs(dx)<5||Math.abs(dx)<dy*1.2)return;
   held.drag=true;root.setPointerCapture?.(e.pointerId);
  }
  held.samples.push([e.timeStamp,e.clientX]);
  while(held.samples.length>2&&e.timeStamp-held.samples[1][0]>=85)held.samples.shift();
  pending=held.at+dx*perPixel;
  queue();
 }
 root.addEventListener('pointermove',move);
 function end(e){
  if(!held||held.id!==e.pointerId)return;
  const normal=e.type==='pointerup';
  if(normal&&held.drag&&held.samples.at(-1)[1]!==e.clientX)move(e);
  const action=held;release();
  if(action.drag&&normal&&!reduced?.matches){
   const first=action.samples[0],last=action.samples.at(-1),age=e.timeStamp-last[0],elapsed=last[0]-first[0];
   if(age<=80&&elapsed>=12){
    const speed=Math.max(-4,Math.min(4,(first[1]-last[1])/elapsed));
    if(Math.abs(speed)>.12){
     coast={speed,last:null,value:null};
     queue();return;
    }
   }
  }
  settle();
 }
 for(const type of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(type,end);
 root.addEventListener('wheel',e=>{
  if(!active||!enabled()||held||e.ctrlKey||e.metaKey)return;
  const delta=e.deltaX||e.deltaY;
  if(!delta)return;
  e.preventDefault();coast=null;settleNext=false;
  pending=(pending??at)+delta*(e.deltaMode===1?16:e.deltaMode===2?width:1)*perPixel;queue();
  clearTimeout(wheelTimer);
  wheelTimer=setTimeout(()=>{
   if(!active||!enabled()){stop();return;}
   settle();
  },150);
 },{passive:false});
 root.addEventListener('keydown',e=>{
  if(!active||!enabled())return;
  const direction={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1,PageUp:-1,PageDown:1}[e.key];
  if(!direction)return;
  e.preventDefault();stop();
  publish(at+direction*MINUTE*(e.shiftKey||e.key.startsWith('Page')?15:1));
  if(dirty){dirty=false;onSettle(at);}
 });
 const visibility=()=>{
  if(!active||!document.hidden)return;
  cancelMotion();release();
  if(dirty){dirty=false;onSettle(at);}
 };
 document.addEventListener('visibilitychange',visibility);
 return {
  active:()=>active,
  enter(){
   active=true;tape.hidden=true;canvas.hidden=false;root.dataset.minutePointer='';root.dataset.mode='time';root.scrollLeft=0;
   root.setAttribute('aria-label','時刻を横スクロールして調整');root.setAttribute('aria-valuemin',String(min));root.setAttribute('aria-valuemax',String(max));
   measure();
  },
  leave(){if(!active)return;stop();active=false;at=phase=null;canvas.hidden=true;tape.hidden=false;delete root.dataset.minutePointer;},
  stop,
  destroy(){this.leave();document.removeEventListener('visibilitychange',visibility);},
  sync(value){
   const changed=measure();
   if(at!==value){stop();phase=value;show(value);}
   else if(changed)paint(at);
  },
  follow(value){stop();phase=value;show(value);},
 };
}
function feedbackEventsBetween(from,to,dayStart,events){
 const first=dayStart(Math.min(from,to)), last=dayStart(Math.max(from,to));
 if(first===last)return events(first).filter(Number.isFinite).sort((a,b)=>a-b);
 return [...events(first),...events(last)].filter(Number.isFinite).sort((a,b)=>a-b);
}
function mount({root,getAt,getMode,enabled:canUse=()=>true,onChange,onSettle=()=>{},onBlend=()=>{},format,describe=format,getObserver=()=>null,sun=()=>null,numeric=null,renderMinutes=()=>false,annotations=null,feedbackEvents=null}){
 let minutes=null,labelObserver=null,observedInset=0;
 const enabled=()=>canUse()&&!minutes?.active();
 const clamp=v=>numeric?Math.max(numeric.min,Math.min(numeric.max,v)):v;
 const rounded=v=>numeric?Number((Math.round(clamp(v)/(numeric.precision||numeric.step))*(numeric.precision||numeric.step)).toFixed(6)):v;
 const ariaValue=v=>numeric?.ariaValue?numeric.ariaValue(v):v;
 const rulerScale=mode=>numeric?{step:numeric.step,pixels:numeric.pixels,labelEvery:numeric.labelEvery}:scale(mode);
 const rulerAdvance=(at,pixels,mode)=>numeric?numeric.snap?clamp(numeric.snap(at+pixels/numeric.pixels*numeric.step)):rounded(Math.round((at+pixels/numeric.pixels*numeric.step)/numeric.step)*numeric.step):advance(at,pixels,mode);
 const tape=document.createElement('div');tape.className='sky-timeline-tape';root.replaceChildren(tape);
 let vibrationAt=-Infinity, lastEvent=null;
 function publish(at){
  const before=getAt();
  if(feedbackEvents&&getMode()!=="date"&&typeof g.navigator?.vibrate==="function"&&before!==at&&Number.isFinite(before)){
   const now=g.performance.now(), low=Math.min(before,at), high=Math.max(before,at);
   if(now-vibrationAt>=220){
    const candidates=feedbackEvents(before,at);
    const crossed=at>before?candidates.find(t=>t>low&&t<=high):[...candidates].reverse().find(t=>t>=low&&t<high);
    if(crossed!==undefined&&(lastEvent!==crossed||Math.abs(before-crossed)>60000)){
     if(g.navigator.vibrate(16)){vibrationAt=now;lastEvent=crossed;}
    }
   }
  }
  onChange(at);
 }
 const layer=annotations?document.createElement('canvas'):null;
 if(layer){layer.className='sky-timeline-annotations';layer.setAttribute('aria-hidden','true');layer.hidden=true;}
 let painted=null;
 let blend=null,snapFrame=0,snapTarget=null,anchor=null,mode=null,lastAt=null,width=0,moving=false,pressed=false,touching=false,frame=0,timer=0,generation=AstroNotesLibrary.gate(),blocked=true,mouse=null,context='',colorCache=new Map(),lastTouchMove=0,lastScroll=null,
 inputKind='';
 const label=at=>format(at,mode);
 const cachedColor=key=>{if(!colorCache.has(key)){if(colorCache.size>1600)colorCache.clear();colorCache.set(key,skyColor(key*300000,getObserver(),sun));}return colorCache.get(key);};
 const color=at=>{const key=Math.floor(at/300000),a=cachedColor(key),t=(at-key*300000)/300000;if(!a||!t)return a;const b=cachedColor(key+1);return b?a.map((v,i)=>Math.round(v+(b[i]-v)*t)):a;};
 // 分単位でも動かしている間は連続した時刻を渡す。4px=1分の段差で天体が跳ばないように（2026-10-14）
 // 日付モードの時刻は1日単位のまま。目盛りの間は前後の日の同じ時刻を結ぶ割合を onBlend で渡し、見た目だけつなぐ（2026-10-15 ユーザー採用）。
 // 本当の時刻で日と日の間を動かすと、天体が1日分まわってしまうため
 const sameBlend=(a,b)=>a===b||!!a&&!!b&&a.from===b.from&&a.to===b.to&&a.f===b.f;
 const setBlend=next=>{if(sameBlend(next,blend))return;blend=next;onBlend(next);};
 const offsetFromCenter=()=>Math.max(-EXTENT,Math.min(EXTENT,root.scrollLeft-EXTENT));
 // The marks belong to the moving tape. The extra width covers ordinary drags before repainting.
 function paintAnnotations(at){
  if(!layer||!width||!Number.isFinite(anchor)||!Number.isFinite(at))return;
  const source=annotations(mode);
  if(!source){layer.hidden=true;painted=null;return;}
  const {step,pixels}=rulerScale(mode),rate=pixels/step,ratio=Math.min(2,g.devicePixelRatio||1);
  const buffer=width/rate,zero=anchor-(EXTENT+width/2)/rate,tapeEnd=zero+(2*EXTENT+width)/rate;
  const neededStart=Math.max(zero,at-.75*buffer),neededEnd=Math.min(tapeEnd,at+.75*buffer);
  if(!painted||painted.key!==source.key||painted.rate!==rate||painted.ratio!==ratio||
    painted.start>neededStart||painted.end<neededEnd||painted.start<zero||painted.end>tapeEnd){
   const start=Math.max(zero,at-1.5*buffer),end=Math.min(tapeEnd,at+1.5*buffer);
   const drawWidth=(end-start)*rate,height=16,ctx=layer.getContext('2d');
   if(!ctx)return;
   layer.style.width=drawWidth+'px';
   const w=Math.max(1,Math.round(drawWidth*ratio)),h=Math.round(height*ratio);
   if(layer.width!==w)layer.width=w;
   if(layer.height!==h)layer.height=h;
   ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,drawWidth,height);
   try{source.paint(ctx,{start,end,width:drawWidth,height,pixelsPerMs:rate});}
   catch(error){layer.hidden=true;painted=null;g.AstroNotesErrors?.note('timeline.annotations',error);return;}
   painted={key:source.key,start,end,rate,ratio};
  }
  const left=(painted.start-zero)*rate+'px';
  if(layer.style.left!==left)layer.style.left=left;
  layer.hidden=false;
 }
 const emit=(offset=offsetFromCenter())=>{const s=rulerScale(mode),units=offset/s.pixels,at=numeric?rounded(anchor+units*s.step):mode!=='date'?Math.round(anchor+units*s.step):rulerAdvance(anchor,offset,mode),changed=at!==lastAt;
  if(changed){lastAt=at;root.setAttribute('aria-valuetext',describe(at,mode));root.setAttribute('aria-valuenow',String(ariaValue(at)));publish(at);}
  if(mode==='date'){const k=Math.floor(units),f=Math.round((units-k)*1000)/1000;setBlend(f>0&&f<1?{from:anchor+k*s.step,to:anchor+(k+1)*s.step,f}:null);}
  paintAnnotations(at);return changed;};
 const flush=()=>{frame=0;if(!enabled()||!Number.isFinite(anchor))return;if(numeric){const s=rulerScale(mode),raw=anchor+(root.scrollLeft-EXTENT)/s.pixels*s.step,bounded=clamp(raw);if(raw!==bounded)root.scrollLeft=EXTENT+(bounded-anchor)/s.step*s.pixels;
 }const offset=offsetFromCenter();if(emit(offset)&&(inputKind!=='touch'||touching)&&Math.abs(offset)>=EXTENT/2)rebase(offset);};
 // The sky fades under the scale control. Keep each time label whole as it crosses that edge.
 function observeLabels(nodes){
  labelObserver?.disconnect();
  const inset=labelInset(root);
  if(!inset||!g.IntersectionObserver)return;
  if(!labelObserver||inset!==observedInset){
   labelObserver=new g.IntersectionObserver(entries=>{
    for(const entry of entries)entry.target.style.visibility=entry.intersectionRatio>=.999?'visible':'hidden';
   },{root,rootMargin:`0px 0px 0px -${inset}px`,threshold:1});
   observedInset=inset;
  }
  const from=root.scrollLeft+inset,to=root.scrollLeft+root.clientWidth;
  const visible=nodes.map(tick=>{
   const x=Number.parseFloat(tick.style.left);
   if(x<from||x>to)return false;
   const half=tick.offsetWidth/2;
   return x-half>=from&&x+half<=to;
  });
  nodes.forEach((tick,index)=>{
   tick.style.visibility=visible[index]?'visible':'hidden';
   labelObserver.observe(tick);
  });
 }
 function reset(at,nextMode){
  cancelAnimationFrame(snapFrame);snapFrame=0;snapTarget=null;generation.cancel();cancelAnimationFrame(frame);frame=0;clearTimeout(timer);timer=0;moving=false;blocked=true;anchor=lastAt=at;mode=nextMode;width=root.clientWidth;const nextContext=JSON.stringify(getObserver());
  if(context!==nextContext){colorCache.clear();context=nextContext;}
  const s=rulerScale(mode),origin=EXTENT+width/2,ordinal=Math.floor((at+(mode==='date'?OFFSET:0))/s.step),fraction=mode!=='date'?at/s.step-Math.floor(at/s.step):0,tickOrigin=origin-fraction*s.pixels,nodes=[];
  tape.style.transform='';tape.style.width=(EXTENT*2+width)+'px';tape.style.setProperty('--timeline-unit',s.pixels+'px');tape.style.backgroundPositionX=tickOrigin+'px';
  const units=Math.ceil((EXTENT+(numeric?0:width/2))/s.pixels);
  for(let u=-units;u<=units;u++)if(!numeric?.ticks&&((ordinal+u)%s.labelEvery+s.labelEvery)%s.labelEvery===0&&(!numeric||(at+(u-fraction)*s.step>=numeric.min-1e-8&&at+(u-fraction)*s.step<=numeric.max+1e-8))){const tick=document.createElement('span');
  tick.className='sky-timeline-label';tick.style.left=(tickOrigin+u*s.pixels)+'px';tick.textContent=label(at+(u-fraction)*s.step);nodes.push(tick);}
  if(numeric?.ticks)for(const t of numeric.ticks){const x=origin+(t.value-at)/s.step*s.pixels;if(x<0||x>EXTENT*2+width)continue;const tick=document.createElement('span');tick.className='sky-timeline-label';tick.style.left=x+'px';tick.textContent=t.label;nodes.push(tick);}
  if(mode!=='date'){
   const stops=[],tickTime=mode==='hour'?1800000:300000,toPixel=t=>origin+(t-at)/s.step*s.pixels,first=Math.floor((at-origin/s.pixels*s.step)/tickTime)*tickTime;for(let t=first;toPixel(t)<=EXTENT*2+width+tickTime/s.step*s.pixels;t+=tickTime){const rgb=color(t);if(rgb)stops.push('rgb('+rgb.join(',')+') '+toPixel(t)+'px');}
   tape.style.backgroundImage=stops.length?'repeating-linear-gradient(to right,rgba(0,0,0,.25) 0 1px,rgba(255,255,255,.28) 1px 2px,transparent 2px var(--timeline-unit)),linear-gradient(to right,'+stops.join(',')+')':'';
   tape.style.backgroundSize='var(--timeline-unit) 8px,100% 100%';tape.style.backgroundPosition=tickOrigin+'px 5px,0 0';
   for(const tick of nodes){const atTick=at+(parseFloat(tick.style.left)-origin)/s.pixels*s.step,rgb=color(atTick);if(rgb)tick.style.color=skyInk(rgb);}
  }else{tape.style.backgroundImage='';tape.style.backgroundSize='';tape.style.backgroundPosition=origin+'px 5px';}
  tape.replaceChildren(...nodes);if(layer)tape.append(layer);root.dataset.mode=mode;root.setAttribute('aria-label',numeric?numeric.label:mode==='date'?'日付を横スクロールして調整':'時刻を横スクロールして調整');root.setAttribute('aria-valuetext',describe(at,mode));root.setAttribute('aria-valuenow',String(ariaValue(at)));
  root.setAttribute('aria-valuemin',String(numeric?ariaValue(numeric.min):Date.UTC(100,0,1)-OFFSET));root.setAttribute('aria-valuemax',String(numeric?ariaValue(numeric.max):Date.UTC(10000,0,1)-OFFSET-1));root.scrollLeft=EXTENT;
  observeLabels(nodes);paintAnnotations(at);
 }
 const now=()=>typeof performance==='undefined'?Date.now():performance.now();
 function rebase(offset){
  const s=rulerScale(mode),shift=Math.trunc(offset/s.pixels)*s.pixels;
  if(!shift)return;
  const keep={moving,pressed,touching,blocked,mouse},at=anchor+shift/s.pixels*s.step,current=lastAt;
  reset(at,mode);lastAt=current;moving=keep.moving;pressed=keep.pressed;touching=keep.touching;blocked=keep.blocked;mouse=keep.mouse;if(mouse)mouse.left-=shift;
  root.scrollLeft=EXTENT+offset-shift;lastScroll=root.scrollLeft;const token=generation.ticket();timer=setTimeout(()=>settle(token),150);
 }
 function settle(token){
  if(!generation.current(token))return;if(!enabled()){stop();return;}
  if(pressed){timer=setTimeout(()=>settle(token),120);return;}
  // Native scrolling can advance while the main thread delays its scroll event.
  // Publish that position and wait again rather than stopping a live fling.
  if(lastScroll!==null&&Math.abs(root.scrollLeft-lastScroll)>.1){lastScroll=root.scrollLeft;moving=true;cancelAnimationFrame(frame);flush();clearTimeout(timer);const next=generation.ticket();
  timer=setTimeout(()=>settle(next),150);return;}
  finish();
 }
 // 止めたら目盛り（1分・1日）へ寄せる。寄せる間も途中を渡し、指を離した瞬間に跳ばせない
 function done(target){setBlend(null);lastAt=target;publish(target);reset(target,mode);onSettle(target);}
 function finish(){
  clearTimeout(timer);timer=0;root.style.overflowX='hidden';void root.offsetWidth;root.style.overflowX='';flush();clearTimeout(timer);timer=0;
  const s=rulerScale(mode),target=rulerAdvance(anchor,offsetFromCenter(),mode),startLeft=root.scrollLeft,endLeft=EXTENT+(target-anchor)/s.step*s.pixels;
  if(!Number.isFinite(lastAt)||Math.abs(startLeft-endLeft)<.01){done(target);return;}
  const begin=now();blocked=true;moving=true;snapTarget=target;
  const step=()=>{snapFrame=0;if(!enabled()){stop();return;}const t=Math.min(1,(now()-begin)/160),e=1-(1-t)**3;if(t>=1){done(target);return;}root.scrollLeft=startLeft+(endLeft-startLeft)*e;emit();snapFrame=requestAnimationFrame(step);};
  snapFrame=requestAnimationFrame(step);
 }
 root.addEventListener('scroll',()=>{if(!enabled()){stop();return;}if(blocked||!Number.isFinite(anchor)||Math.abs(offsetFromCenter())<.1&&!moving)return;
 lastScroll=root.scrollLeft;moving=true;if(!frame)frame=requestAnimationFrame(flush);clearTimeout(timer);const token=generation.ticket();
 timer=setTimeout(()=>settle(token),150);},{passive:true});
 function activate(kind){
  if(!enabled())return false;
  if(tape.style.transform)reset(getAt(),getMode());
  if(snapFrame){cancelAnimationFrame(snapFrame);snapFrame=0;snapTarget=null;clearTimeout(timer);const token=generation.ticket();timer=setTimeout(()=>settle(token),150);}
  inputKind=kind;
  if(!Number.isFinite(anchor))reset(getAt(),getMode());
  else if(!moving&&Math.abs(offsetFromCenter())>=.1)reset(lastAt,mode);
  else if(kind==='touch'&&!touching&&!pressed&&Math.abs(offsetFromCenter())>=EXTENT/2){
   // WebKit still owns scrollLeft during its fling. Recenter between gestures, never while it is coasting.
   const offset=offsetFromCenter();emit(offset);halt();rebase(offset);
  }
  lastScroll=root.scrollLeft;blocked=false;return true;
 }
 root.addEventListener('touchstart',e=>{if(!activate('touch'))return;touching=true;pressed=true;lastTouchMove=e?.timeStamp||0;},{passive:true});
 root.addEventListener('touchmove',e=>{lastTouchMove=e.timeStamp;},{passive:true});
 for(const event of ['touchend','touchcancel'])root.addEventListener(event,e=>{touching=false;pressed=false;if(!enabled()){stop();return;}if(event==='touchcancel'&&moving){clearTimeout(timer);const token=generation.ticket();timer=setTimeout(()=>settle(token),150);return;
 }if(moving&&enabled()&&(!e||e.timeStamp-lastTouchMove>=120)){finish();}},{passive:true});
 root.addEventListener('pointerdown',e=>{if(e?.pointerType==='touch'||!activate(e?.pointerType==='mouse'?'mouse':'touch'))return;pressed=true;if(e?.pointerType==='mouse'){mouse={x:e.clientX,left:root.scrollLeft};root.setPointerCapture?.(e.pointerId);e.preventDefault();}});
 root.addEventListener('pointermove',e=>{if(mouse&&enabled())root.scrollLeft=mouse.left+mouse.x-e.clientX;});
 root.addEventListener('wheel',e=>{if(!activate('wheel'))return;if(!e.deltaX&&e.deltaY){e.preventDefault();root.scrollLeft+=e.deltaY;}},{passive:false});
 for(const event of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(event,()=>{if(!touching)pressed=false;mouse=null;},{passive:true});
 root.addEventListener('keydown',e=>{const dir={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1,PageUp:-1,PageDown:1}[e.key];if(!dir||!enabled())return;e.preventDefault();
 const large=e.shiftKey||e.key.startsWith('Page'),delta=numeric?numeric.step*(large?10:1):(mode==='date'?DAY:mode==='hour'?3600000:MINUTE)*(large?(mode==='date'?7:mode==='hour'?6:15):1),at=rounded(getAt()+dir*delta);stop();reset(at,mode);publish(at);onSettle(at);});
 function stop(){setBlend(null);cancelAnimationFrame(snapFrame);snapFrame=0;snapTarget=null;lastScroll=null;generation.cancel();cancelAnimationFrame(frame);frame=0;clearTimeout(timer);timer=0;moving=false;pressed=false;touching=false;mouse=null;blocked=true;anchor=null;}
 // 2026-10-20 ユーザー「日付をばーっと動かしてるときに今日を押しても止まらず動き続ける」：外から日時を替えるときは、指を離したあとの慣性スクロールも止める
 const halt=()=>{if(!(moving||Math.abs(offsetFromCenter())>=.1))return;root.style.overflowX='hidden';void root.offsetWidth;root.style.overflowX='';};
 const controller={follow(at,nextMode){
  if(!enabled()||!Number.isFinite(at))return;
  const changed=mode!==nextMode||width!==root.clientWidth||context!==JSON.stringify(getObserver());
  if(!Number.isFinite(anchor)||changed||moving||pressed||touching||Math.abs((at-anchor)/rulerScale(nextMode).step*rulerScale(nextMode).pixels)>512){halt();stop();reset(at,nextMode);}
  const offset=(at-anchor)/rulerScale(mode).step*rulerScale(mode).pixels;
  tape.style.transform='translateX('+(-offset)+'px)';lastAt=at;
  const text=describe(at,mode);if(root.getAttribute('aria-valuetext')!==text)root.setAttribute('aria-valuetext',text);root.setAttribute('aria-valuenow',String(ariaValue(at)));
 },sync(at,nextMode,force=false){if(!enabled()){stop();return;}if(!Number.isFinite(at))return;if(!force&&(moving||pressed||touching)&&mode===nextMode&&(at===lastAt||numeric&&Math.abs(at-lastAt)<(numeric.syncTolerance||0))&&width===root.clientWidth&&context===JSON.stringify(getObserver()))return;
 if(!force&&!tape.style.transform&&at===anchor&&nextMode===mode&&width===root.clientWidth&&Math.abs(root.scrollLeft-EXTENT)<.1&&context===JSON.stringify(getObserver()))return;halt();stop();reset(at,nextMode);},stop};
 const useMinutes=mode=>!numeric&&mode==='time'&&renderMinutes();
 const minuteRuler=nextMode=>{
  if(!canUse()||!useMinutes(nextMode)){minutes?.leave();return null;}
  if(!minutes)minutes=mountMinuteRuler({root,tape,enabled:()=>canUse()&&useMinutes(getMode()),onChange:publish,onSettle,format,describe,getObserver,sun});
  if(minutes&&!minutes.active()){halt();stop();minutes.enter();}
  return minutes;
 };
 const api={
  sync(at,nextMode,force=false){if(Number.isFinite(at)){const ruler=minuteRuler(nextMode);if(ruler)ruler.sync(at);else{controller.sync(at,nextMode,force);paintAnnotations(at);}}else this.stop();},
  follow(at,nextMode){if(Number.isFinite(at)){const ruler=minuteRuler(nextMode);if(ruler)ruler.follow(at);else{controller.follow(at,nextMode);paintAnnotations(at);}}},
  stop(){minutes?.stop();stop();},
 };
 const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>api.sync(getAt(),getMode())):null;
 observer?.observe(root);api.destroy=()=>{minutes?.destroy();stop();observer?.disconnect();labelObserver?.disconnect();};
 return api;
}
const api={scale,advance,mount,solarPhase,skyColor,skyInk,feedbackEventsBetween};g.AstroNotesScrollTimeline=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);

/* Legacy global names remain aliases for cached integrations. */
if(typeof AstroNotesScrollTimeline!=='undefined')globalThis.SoramiScrollTimeline=AstroNotesScrollTimeline;

;(function(g){
 const api=g.AstroNotesScrollTimeline;
 api.focusEnd=input=>{if(input._focusEndBound)return;input._focusEndBound=true;let fresh=false;const end=()=>{if(document.activeElement===input&&input.selectionStart===input.selectionEnd)input.setSelectionRange(input.value.length,input.value.length);};
 input.addEventListener('pointerdown',()=>{fresh=document.activeElement!==input;});input.addEventListener('focus',()=>{fresh=true;end();});input.addEventListener('click',()=>{if(fresh){fresh=false;end();}});input.addEventListener('blur',()=>fresh=false);};
 api.mountNumeric=options=>api.mount({...options,getMode:()=> 'number'});
 api.mountFocal=(look,owner)=>{
  const input=look.querySelector('[data-lens-focal]'),range=look.querySelector('[data-focal-range]');if(!input||!range)return;
  const entry=look.querySelector('[data-preview-focal-input]');if(entry&&!entry._focalBound){entry._focalBound=true;api.focusEnd(entry);const apply=()=>{const raw=entry.value.normalize('NFKC').trim(),v=Number(raw);
  if(!raw||!Number.isFinite(v)||v<8||v>2000){entry.setCustomValidity('8〜2000mmで入力してください');entry.reportValidity();return;}entry.setCustomValidity('');entry.value=String(Math.round(v*10)/10);input.value=entry.value;input.onchange?.();};entry.oninput=()=>entry.setCustomValidity('');
  entry.onchange=apply;entry.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();apply();}};}
  let state=look._numericFocal;
  if(state&&(!state.root.isConnected||state.range!==range||state.owner!==owner())){look._numericFocalMoving=false;state.controller.destroy();state.root.parentElement?.remove();state=null;}
  if(!state){
   const wrap=document.createElement('div');wrap.className='numeric-ruler-track numeric-focal';const root=document.createElement('div');root.className='sky-map-timeline numeric-ruler';root.tabIndex=0;root.setAttribute('role','slider');const center=document.createElement('span');
   center.className='sky-map-timeline-center';center.setAttribute('aria-hidden','true');wrap.append(root,center);range.before(wrap);range.hidden=true;
   state={root,range,owner:owner(),controller:null};look._numericFocal=state;
   const current=()=>root.isConnected&&look._numericFocal===state&&owner()===state.owner&&!!look.getClientRects().length;
   const focal=v=>Math.round(Math.exp(v)*10)/10,ticks=[8,10,12,14,16,20,24,28,35,40,50,60,70,85,100,120,135,150,180,200,250,300,400,500,600,800,1000,1200,1600,2000].map(mm=>({value:Math.log(mm),label:String(mm)}));
   state.controller=api.mountNumeric({root,numeric:{min:Math.log(8),max:Math.log(2000),step:.01,precision:.0001,pixels:8,labelEvery:10,ticks,syncTolerance:.01,ariaValue:focal,snap:v=>Math.log(focal(v)),label:'焦点距離を横スクロールして調整'},getAt:()=>Math.log(Number(input.value)),enabled:current,
   format:v=>String(focal(v)),describe:v=>focal(v)+'mm',onChange:value=>{if(!current())return;look._numericFocalMoving=true;input.value=String(focal(value));input.onchange?.();},onSettle:()=>{look._numericFocalMoving=false;if(current())input.onchange?.();}});
  }
  range.hidden=true;state.controller.sync(Math.log(Number(input.value)),'number');
 };
})(typeof window==='undefined'?globalThis:window);
