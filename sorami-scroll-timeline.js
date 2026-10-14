/* Native horizontal time ruler. The scale is fixed in pixels, independent of viewport width. */
(function(g){
'use strict';
const DAY=86400000,MINUTE=60000,OFFSET=32400000,EXTENT=4096;
const scale=mode=>mode==='date'?{step:DAY,pixels:24,labelEvery:2}:{step:MINUTE,pixels:4,labelEvery:15};
const advance=(at,pixels,mode)=>{const s=scale(mode),units=pixels/s.pixels;return at+Math.sign(units)*Math.round(Math.abs(units))*s.step;};
const phaseNames={morning:'朝焼け',day:'日中',evening:'夕焼け',night:'夜'};
function solarPhase(at,observer,sun){
 if(!observer||typeof sun!=='function')return null;
 const h=sun(at,observer)?.geometricAltitude;
 if(!Number.isFinite(h))return null;
 if(h < -6)return 'night';if(h >= 6)return 'day';
 return sun(at+60000,observer).geometricAltitude>=sun(at-60000,observer).geometricAltitude?'morning':'evening';
}
function mount({root,getAt,getMode,enabled=()=>true,onChange,onSettle=()=>{},format,describe=format,getObserver=()=>null,sun=()=>null}){
 const tape=document.createElement('div');tape.className='sky-timeline-tape';root.replaceChildren(tape);
 let anchor=null,mode=null,lastAt=null,width=0,moving=false,pressed=false,touching=false,frame=0,timer=0,generation=0,blocked=true,mouse=null,context='',phaseCache=new Map(),lastTouchMove=0;
 const caption=document.createElement('span');caption.className='timeline-current-phase';caption.setAttribute('aria-hidden','true');root.insertAdjacentElement?.('afterend',caption);
 const label=at=>format(at,mode);
 const phase=at=>{const key=Math.floor(at/300000);if(!phaseCache.has(key)){if(phaseCache.size>1600)phaseCache.clear();phaseCache.set(key,solarPhase(key*300000,getObserver(),sun));}return phaseCache.get(key);};
 const flush=()=>{frame=0;if(!enabled()||!Number.isFinite(anchor))return;const at=advance(anchor,root.scrollLeft-EXTENT,mode);if(at===lastAt)return;lastAt=at;root.setAttribute('aria-valuetext',describe(at,mode));root.setAttribute('aria-valuenow',String(at));caption.textContent=mode==='time'?(phaseNames[phase(at)]||''):'';onChange(at);};
 function reset(at,nextMode){
  generation++;cancelAnimationFrame(frame);frame=0;clearTimeout(timer);timer=0;moving=false;blocked=true;anchor=lastAt=at;mode=nextMode;width=root.clientWidth;const nextContext=JSON.stringify(getObserver());if(context!==nextContext){phaseCache.clear();context=nextContext;}
  const s=scale(mode),origin=EXTENT+width/2,ordinal=Math.floor((at+(mode==='date'?OFFSET:0))/s.step),nodes=[];
  tape.style.width=(EXTENT*2+width)+'px';tape.style.setProperty('--timeline-unit',s.pixels+'px');tape.style.backgroundPositionX=origin+'px';
  for(let u=-Math.ceil(EXTENT/s.pixels);u<=Math.ceil(EXTENT/s.pixels);u++)if(((ordinal+u)%s.labelEvery+s.labelEvery)%s.labelEvery===0){const tick=document.createElement('span');tick.className='sky-timeline-label';tick.style.left=(origin+u*s.pixels)+'px';tick.textContent=label(at+u*s.step);nodes.push(tick);}
  if(mode==='time'){
   const bands=[];let previous=null,start=0;
   for(let x=0;x<=EXTENT*2+width+20;x+=20){const edge=Math.min(x,EXTENT*2+width),kind=x<EXTENT*2+width?phase(at+(x-origin)/s.pixels*s.step):null;
    if(kind!==previous){if(previous){const band=document.createElement('span');band.className='timeline-phase timeline-phase-'+previous;band.style.left=start+'px';band.style.width=(edge-start)+'px';band.setAttribute('aria-hidden','true');bands.push(band);}start=edge;previous=kind;}
   }nodes.unshift(...bands);
  }
  tape.replaceChildren(...nodes);caption.textContent=mode==='time'?(phaseNames[phase(at)]||''):'';root.dataset.mode=mode;root.setAttribute('aria-label',mode==='date'?'日付を横スクロールして調整':'時刻を横スクロールして調整');root.setAttribute('aria-valuetext',describe(at,mode));root.setAttribute('aria-valuenow',String(at));root.setAttribute('aria-valuemin',String(Date.UTC(100,0,1)-OFFSET));root.setAttribute('aria-valuemax',String(Date.UTC(10000,0,1)-OFFSET-1));root.scrollLeft=EXTENT;
 }
 function settle(token){
  if(token!==generation)return;if(!enabled()){stop();return;}
  if(pressed){timer=setTimeout(()=>settle(token),120);return;}
  flush();const at=lastAt;reset(at,mode);onSettle(at);
 }
 root.addEventListener('scroll',()=>{if(!enabled()){stop();return;}if(blocked||!enabled()||!Number.isFinite(anchor)||Math.abs(root.scrollLeft-EXTENT)<.1&&!moving)return;moving=true;if(!frame)frame=requestAnimationFrame(flush);clearTimeout(timer);const token=generation;timer=setTimeout(()=>settle(token),150);},{passive:true});
 function activate(){if(!enabled())return false;if(!Number.isFinite(anchor))reset(getAt(),getMode());else if(!moving&&Math.abs(root.scrollLeft-EXTENT)>=.1)reset(lastAt,mode);blocked=false;return true;}
 root.addEventListener('touchstart',e=>{if(!activate())return;touching=true;pressed=true;lastTouchMove=e?.timeStamp||0;},{passive:true});
 root.addEventListener('touchmove',e=>{lastTouchMove=e.timeStamp;},{passive:true});
 for(const event of ['touchend','touchcancel'])root.addEventListener(event,e=>{touching=false;pressed=false;if(!enabled()){stop();return;}if(moving&&enabled()&&(!e||event==='touchcancel'||e.timeStamp-lastTouchMove>=120)){flush();const at=lastAt;root.style.overflowX='hidden';void root.offsetWidth;root.style.overflowX='';reset(at,mode);onSettle(at);}},{passive:true});
 root.addEventListener('pointerdown',e=>{if(!activate())return;pressed=true;if(e?.pointerType==='mouse'){mouse={x:e.clientX,left:root.scrollLeft};root.setPointerCapture?.(e.pointerId);e.preventDefault();}});
 root.addEventListener('pointermove',e=>{if(mouse&&enabled())root.scrollLeft=mouse.left+mouse.x-e.clientX;});
 root.addEventListener('wheel',e=>{if(!activate())return;if(!e.deltaX&&e.deltaY){e.preventDefault();root.scrollLeft+=e.deltaY;}},{passive:false});
 for(const event of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(event,()=>{if(!touching)pressed=false;mouse=null;},{passive:true});
 root.addEventListener('keydown',e=>{const dir={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1,PageUp:-1,PageDown:1}[e.key];if(!dir||!enabled())return;e.preventDefault();const large=e.shiftKey||e.key.startsWith('Page'),delta=(mode==='date'?DAY:MINUTE)*(large?(mode==='date'?7:15):1),at=getAt()+dir*delta;stop();reset(at,mode);onChange(at);onSettle(at);});
 function stop(){generation++;cancelAnimationFrame(frame);frame=0;clearTimeout(timer);timer=0;moving=false;pressed=false;touching=false;mouse=null;blocked=true;anchor=null;}
 const controller={sync(at,nextMode){if(!enabled()){stop();return;}if(!Number.isFinite(at))return;if((moving||pressed||touching)&&mode===nextMode&&at===lastAt&&width===root.clientWidth&&context===JSON.stringify(getObserver()))return;if(at===anchor&&nextMode===mode&&width===root.clientWidth&&Math.abs(root.scrollLeft-EXTENT)<.1&&context===JSON.stringify(getObserver()))return;stop();reset(at,nextMode);},stop};
 if(typeof ResizeObserver==='function')new ResizeObserver(()=>{if(enabled())controller.sync(getAt(),getMode());else stop();}).observe(root);
 return controller;
}
const api={scale,advance,mount,solarPhase,phaseNames};g.SoramiScrollTimeline=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
