/* Native horizontal time ruler. The scale is fixed in pixels, independent of viewport width. */
(function(g){
'use strict';
const DAY=86400000,MINUTE=60000,OFFSET=32400000,EXTENT=4096;
const scale=mode=>mode==='date'?{step:DAY,pixels:24,labelEvery:2}:{step:MINUTE,pixels:4,labelEvery:15};
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
function mount({root,getAt,getMode,enabled=()=>true,onChange,onSettle=()=>{},onBlend=()=>{},format,describe=format,getObserver=()=>null,sun=()=>null}){
 const tape=document.createElement('div');tape.className='sky-timeline-tape';root.replaceChildren(tape);
 let blend=null,snapFrame=0,snapTarget=null,anchor=null,mode=null,lastAt=null,width=0,moving=false,pressed=false,touching=false,frame=0,timer=0,generation=0,blocked=true,mouse=null,context='',colorCache=new Map(),lastTouchMove=0,glideFrame=0,velocity=0,lastScroll=null,inputKind='';
 const label=at=>format(at,mode);
 const cachedColor=key=>{if(!colorCache.has(key)){if(colorCache.size>1600)colorCache.clear();colorCache.set(key,skyColor(key*300000,getObserver(),sun));}return colorCache.get(key);};
 const color=at=>{const key=Math.floor(at/300000),a=cachedColor(key),t=(at-key*300000)/300000;if(!a||!t)return a;const b=cachedColor(key+1);return b?a.map((v,i)=>Math.round(v+(b[i]-v)*t)):a;};
 // 分単位でも動かしている間は連続した時刻を渡す。4px=1分の段差で天体が跳ばないように（2026-10-14）
 // 日付モードの時刻は1日単位のまま。目盛りの間は前後の日の同じ時刻を結ぶ割合を onBlend で渡し、見た目だけつなぐ（2026-10-15 ユーザー採用）。
 // 本当の時刻で日と日の間を動かすと、天体が1日分まわってしまうため
 const sameBlend=(a,b)=>a===b||!!a&&!!b&&a.from===b.from&&a.to===b.to&&a.f===b.f;
 const setBlend=next=>{if(sameBlend(next,blend))return;blend=next;onBlend(next);};
 const emit=()=>{const offset=root.scrollLeft-EXTENT,s=scale(mode),units=offset/s.pixels,at=mode==='time'?Math.round(anchor+units*s.step):advance(anchor,offset,mode),changed=at!==lastAt;
  if(changed){lastAt=at;root.setAttribute('aria-valuetext',describe(at,mode));root.setAttribute('aria-valuenow',String(at));onChange(at);}
  if(mode==='date'){const k=Math.floor(units),f=Math.round((units-k)*1000)/1000;setBlend(f>0&&f<1?{from:anchor+k*s.step,to:anchor+(k+1)*s.step,f}:null);}
  return changed;};
 const flush=()=>{frame=0;if(!enabled()||!Number.isFinite(anchor))return;if(emit()&&Math.abs(root.scrollLeft-EXTENT)>=EXTENT/2)rebase();};
 function reset(at,nextMode){
  cancelGlide();cancelAnimationFrame(snapFrame);snapFrame=0;snapTarget=null;generation++;cancelAnimationFrame(frame);frame=0;clearTimeout(timer);timer=0;moving=false;blocked=true;anchor=lastAt=at;mode=nextMode;width=root.clientWidth;const nextContext=JSON.stringify(getObserver());if(context!==nextContext){colorCache.clear();context=nextContext;}
  const s=scale(mode),origin=EXTENT+width/2,ordinal=Math.floor((at+(mode==='date'?OFFSET:0))/s.step),nodes=[];
  tape.style.width=(EXTENT*2+width)+'px';tape.style.setProperty('--timeline-unit',s.pixels+'px');tape.style.backgroundPositionX=origin+'px';
  for(let u=-Math.ceil(EXTENT/s.pixels);u<=Math.ceil(EXTENT/s.pixels);u++)if(((ordinal+u)%s.labelEvery+s.labelEvery)%s.labelEvery===0){const tick=document.createElement('span');tick.className='sky-timeline-label';tick.style.left=(origin+u*s.pixels)+'px';tick.textContent=label(at+u*s.step);nodes.push(tick);}
  if(mode==='time'){
   const stops=[],tickTime=300000,toPixel=t=>origin+(t-at)/s.step*s.pixels,first=Math.floor((at-origin/s.pixels*s.step)/tickTime)*tickTime;for(let t=first;toPixel(t)<=EXTENT*2+width+tickTime/s.step*s.pixels;t+=tickTime){const rgb=color(t);if(rgb)stops.push('rgb('+rgb.join(',')+') '+toPixel(t)+'px');}
   tape.style.backgroundImage=stops.length?'repeating-linear-gradient(to right,rgba(0,0,0,.25) 0 1px,rgba(255,255,255,.28) 1px 2px,transparent 2px var(--timeline-unit)),linear-gradient(to right,'+stops.join(',')+')':'';
   tape.style.backgroundSize='var(--timeline-unit) 8px,100% 100%';tape.style.backgroundPosition=origin+'px 5px,0 0';
   for(const tick of nodes){const atTick=at+(parseFloat(tick.style.left)-origin)/s.pixels*s.step,rgb=color(atTick);if(rgb)tick.style.color=skyInk(rgb);}
  }else{tape.style.backgroundImage='';tape.style.backgroundSize='';tape.style.backgroundPosition=origin+'px 5px';}
  tape.replaceChildren(...nodes);root.dataset.mode=mode;root.setAttribute('aria-label',mode==='date'?'日付を横スクロールして調整':'時刻を横スクロールして調整');root.setAttribute('aria-valuetext',describe(at,mode));root.setAttribute('aria-valuenow',String(at));root.setAttribute('aria-valuemin',String(Date.UTC(100,0,1)-OFFSET));root.setAttribute('aria-valuemax',String(Date.UTC(10000,0,1)-OFFSET-1));root.scrollLeft=EXTENT;
 }
 const now=()=>typeof performance==='undefined'?Date.now():performance.now();
 function cancelGlide(){cancelAnimationFrame(glideFrame);glideFrame=0;}
 function glide(speed){
  cancelGlide();let previous=now();
  const step=()=>{glideFrame=0;if(!enabled()||pressed||blocked)return;const time=now(),dt=Math.max(1,Math.min(32,time-previous));previous=time;root.scrollLeft+=speed*dt;speed*=Math.exp(-dt/500);if(Math.abs(speed)>.015)glideFrame=requestAnimationFrame(step);};
  glideFrame=requestAnimationFrame(step);
 }
 function rebase(){
  const offset=root.scrollLeft-EXTENT,s=scale(mode),shift=Math.trunc(offset/s.pixels)*s.pixels;
  if(!shift)return;
  const carry=!pressed&&inputKind==='touch'?velocity:0,keep={moving,pressed,touching,blocked,mouse},at=anchor+shift/s.pixels*s.step,current=lastAt;
  reset(at,mode);lastAt=current;moving=keep.moving;pressed=keep.pressed;touching=keep.touching;blocked=keep.blocked;mouse=keep.mouse;if(mouse)mouse.left-=shift;
  if(Math.abs(carry)>.02){root.style.overflowX='hidden';void root.offsetWidth;root.style.overflowX='';}
  root.scrollLeft=EXTENT+offset-shift;lastScroll={left:root.scrollLeft,time:now()};const token=generation;timer=setTimeout(()=>settle(token),150);if(Math.abs(carry)>.02)glide(carry);
 }
 function settle(token){
  if(token!==generation)return;if(!enabled()){stop();return;}
  if(pressed){timer=setTimeout(()=>settle(token),120);return;}
  finish();
 }
 // 止めたら目盛り（1分・1日）へ寄せる。寄せる間も途中を渡し、指を離した瞬間に跳ばせない
 function done(target){setBlend(null);lastAt=target;onChange(target);reset(target,mode);onSettle(target);}
 function finish(){
  clearTimeout(timer);timer=0;flush();const s=scale(mode),target=advance(anchor,root.scrollLeft-EXTENT,mode),startLeft=root.scrollLeft,endLeft=EXTENT+(target-anchor)/s.step*s.pixels;
  if(!Number.isFinite(lastAt)||Math.abs(startLeft-endLeft)<.01){done(target);return;}
  const begin=now();blocked=true;moving=true;snapTarget=target;
  const step=()=>{snapFrame=0;if(!enabled()){stop();return;}const t=Math.min(1,(now()-begin)/160),e=1-(1-t)**3;if(t>=1){done(target);return;}root.scrollLeft=startLeft+(endLeft-startLeft)*e;emit();snapFrame=requestAnimationFrame(step);};
  snapFrame=requestAnimationFrame(step);
 }
 root.addEventListener('scroll',()=>{if(!enabled()){stop();return;}if(blocked||!enabled()||!Number.isFinite(anchor)||Math.abs(root.scrollLeft-EXTENT)<.1&&!moving)return;const time=now();if(lastScroll&&Math.abs(root.scrollLeft-lastScroll.left)>.1)velocity=(root.scrollLeft-lastScroll.left)/Math.max(1,time-lastScroll.time);lastScroll={left:root.scrollLeft,time};moving=true;if(!frame)frame=requestAnimationFrame(flush);clearTimeout(timer);const token=generation;timer=setTimeout(()=>settle(token),150);},{passive:true});
 function activate(kind){if(!enabled())return false;cancelGlide();if(snapFrame)done(snapTarget);velocity=0;inputKind=kind||inputKind;if(!Number.isFinite(anchor))reset(getAt(),getMode());else if(!moving&&Math.abs(root.scrollLeft-EXTENT)>=.1)reset(lastAt,mode);lastScroll={left:root.scrollLeft,time:now()};blocked=false;return true;}
 root.addEventListener('touchstart',e=>{if(!activate('touch'))return;touching=true;pressed=true;lastTouchMove=e?.timeStamp||0;},{passive:true});
 root.addEventListener('touchmove',e=>{lastTouchMove=e.timeStamp;},{passive:true});
 for(const event of ['touchend','touchcancel'])root.addEventListener(event,e=>{touching=false;pressed=false;if(!enabled()){stop();return;}if(moving&&enabled()&&(!e||event==='touchcancel'||e.timeStamp-lastTouchMove>=120)){root.style.overflowX='hidden';void root.offsetWidth;root.style.overflowX='';finish();}},{passive:true});
 root.addEventListener('pointerdown',e=>{if(!activate(e?.pointerType==='mouse'?'mouse':'touch'))return;pressed=true;if(e?.pointerType==='mouse'){mouse={x:e.clientX,left:root.scrollLeft};root.setPointerCapture?.(e.pointerId);e.preventDefault();}});
 root.addEventListener('pointermove',e=>{if(mouse&&enabled())root.scrollLeft=mouse.left+mouse.x-e.clientX;});
 root.addEventListener('wheel',e=>{if(!activate('wheel'))return;if(!e.deltaX&&e.deltaY){e.preventDefault();root.scrollLeft+=e.deltaY;}},{passive:false});
 for(const event of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(event,()=>{if(!touching)pressed=false;mouse=null;},{passive:true});
 root.addEventListener('keydown',e=>{const dir={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1,PageUp:-1,PageDown:1}[e.key];if(!dir||!enabled())return;e.preventDefault();const large=e.shiftKey||e.key.startsWith('Page'),delta=(mode==='date'?DAY:MINUTE)*(large?(mode==='date'?7:15):1),at=getAt()+dir*delta;stop();reset(at,mode);onChange(at);onSettle(at);});
 function stop(){setBlend(null);cancelGlide();cancelAnimationFrame(snapFrame);snapFrame=0;snapTarget=null;velocity=0;lastScroll=null;generation++;cancelAnimationFrame(frame);frame=0;clearTimeout(timer);timer=0;moving=false;pressed=false;touching=false;mouse=null;blocked=true;anchor=null;}
 const controller={sync(at,nextMode){if(!enabled()){stop();return;}if(!Number.isFinite(at))return;if((moving||pressed||touching)&&mode===nextMode&&at===lastAt&&width===root.clientWidth&&context===JSON.stringify(getObserver()))return;if(at===anchor&&nextMode===mode&&width===root.clientWidth&&Math.abs(root.scrollLeft-EXTENT)<.1&&context===JSON.stringify(getObserver()))return;stop();reset(at,nextMode);},stop};
 if(typeof ResizeObserver==='function')new ResizeObserver(()=>{if(enabled())controller.sync(getAt(),getMode());else stop();}).observe(root);
 return controller;
}
const api={scale,advance,mount,solarPhase,skyColor,skyInk};g.SoramiScrollTimeline=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
