// Extend the trial time-ruler implementation with numeric units; defaults stay unchanged.
const patch=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Numeric ruler boundary changed: '+a.slice(0,90));return s.replace(a,b);};
export function numericRulerTimeline(s){
 const begin=s.indexOf('function mount('),end=s.indexOf('\nconst api=',begin);if(begin<0||end<0)throw Error('Numeric ruler mount missing');
 let m=s.slice(begin,end).replaceAll('scale(', 'rulerScale(').replaceAll('advance(', 'rulerAdvance(');
 m=patch(m,'getObserver=()=>null,sun=()=>null}){',`getObserver=()=>null,sun=()=>null,numeric=null}){
 const clamp=v=>numeric?Math.max(numeric.min,Math.min(numeric.max,v)):v;
 const rounded=v=>numeric?Number((Math.round(clamp(v)/(numeric.precision||numeric.step))*(numeric.precision||numeric.step)).toFixed(6)):v;
 const ariaValue=v=>numeric?.ariaValue?numeric.ariaValue(v):v;
 const rulerScale=mode=>numeric?{step:numeric.step,pixels:numeric.pixels,labelEvery:numeric.labelEvery}:scale(mode);
 const rulerAdvance=(at,pixels,mode)=>numeric?numeric.snap?clamp(numeric.snap(at+pixels/numeric.pixels*numeric.step)):rounded(Math.round((at+pixels/numeric.pixels*numeric.step)/numeric.step)*numeric.step):advance(at,pixels,mode);`);
 m=patch(m,"at=mode!=='date'?Math.round(anchor+units*s.step):rulerAdvance(anchor,offset,mode)","at=numeric?rounded(anchor+units*s.step):mode!=='date'?Math.round(anchor+units*s.step):rulerAdvance(anchor,offset,mode)");
 m=patch(m,"const flush=()=>{frame=0;if(!enabled()||!Number.isFinite(anchor))return;if(emit()", "const flush=()=>{frame=0;if(!enabled()||!Number.isFinite(anchor))return;if(numeric){const s=rulerScale(mode),raw=anchor+(root.scrollLeft-EXTENT)/s.pixels*s.step,bounded=clamp(raw);if(raw!==bounded)root.scrollLeft=EXTENT+(bounded-anchor)/s.step*s.pixels;}if(emit()");
 m=patch(m,"if(((ordinal+u)%s.labelEvery+s.labelEvery)%s.labelEvery===0)","if(!numeric?.ticks&&((ordinal+u)%s.labelEvery+s.labelEvery)%s.labelEvery===0&&(!numeric||(at+(u-fraction)*s.step>=numeric.min-1e-8&&at+(u-fraction)*s.step<=numeric.max+1e-8)))");
 m=patch(m,"  if(mode!=='date'){", "  if(numeric?.ticks)for(const t of numeric.ticks){const x=origin+(t.value-at)/s.step*s.pixels;if(x<0||x>EXTENT*2+width)continue;const tick=document.createElement('span');tick.className='sky-timeline-label';tick.style.left=x+'px';tick.textContent=t.label;nodes.push(tick);}\n  if(mode!=='date'){");
 m=m.replaceAll("setAttribute('aria-valuenow',String(at))","setAttribute('aria-valuenow',String(ariaValue(at)))");
 m=patch(m,"root.setAttribute('aria-label',mode==='date'?", "root.setAttribute('aria-label',numeric?numeric.label:mode==='date'?");
 m=patch(m,"String(Date.UTC(100,0,1)-OFFSET)","String(numeric?ariaValue(numeric.min):Date.UTC(100,0,1)-OFFSET)");
 m=patch(m,"String(Date.UTC(10000,0,1)-OFFSET-1)","String(numeric?ariaValue(numeric.max):Date.UTC(10000,0,1)-OFFSET-1)");
 m=patch(m,"at===lastAt&&width===root.clientWidth", "(at===lastAt||numeric&&Math.abs(at-lastAt)<(numeric.syncTolerance||0))&&width===root.clientWidth");
 m=patch(m,"delta=(mode==='date'?DAY:mode==='hour'?3600000:MINUTE)*(large?(mode==='date'?7:mode==='hour'?6:15):1),at=getAt()+dir*delta", "delta=numeric?numeric.step*(large?10:1):(mode==='date'?DAY:mode==='hour'?3600000:MINUTE)*(large?(mode==='date'?7:mode==='hour'?6:15):1),at=rounded(getAt()+dir*delta)");
 m=patch(m,"if(typeof ResizeObserver==='function')new ResizeObserver(()=>{if(enabled())controller.sync(getAt(),getMode());else stop();}).observe(root);", "const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>{if(enabled())controller.sync(getAt(),getMode());else stop();}):null;observer?.observe(root);controller.destroy=()=>{stop();observer?.disconnect();};");
 s=s.slice(0,begin)+m+s.slice(end);
 return s+String.raw`
;(function(g){
 const api=g.AstroNotesScrollTimeline;
 api.mountNumeric=options=>api.mount({...options,getMode:()=> 'number'});
 api.mountFocal=(look,owner)=>{
  const input=look.querySelector('[data-lens-focal]'),range=look.querySelector('[data-focal-range]');if(!input||!range)return;
  let state=look._numericFocal;
  if(state&&(!state.root.isConnected||state.range!==range||state.owner!==owner())){look._numericFocalMoving=false;state.controller.destroy();state.root.parentElement?.remove();state=null;}
  if(!state){
   const wrap=document.createElement('div');wrap.className='numeric-ruler-track numeric-focal';const root=document.createElement('div');root.className='sky-map-timeline numeric-ruler';root.tabIndex=0;root.setAttribute('role','slider');const center=document.createElement('span');center.className='sky-map-timeline-center';center.setAttribute('aria-hidden','true');wrap.append(root,center);range.before(wrap);range.hidden=true;
   state={root,range,owner:owner(),controller:null};look._numericFocal=state;
   const current=()=>root.isConnected&&look._numericFocal===state&&owner()===state.owner&&!!look.getClientRects().length;
   const focal=v=>Math.round(Math.exp(v)*10)/10,ticks=[8,10,12,14,16,20,24,28,35,40,50,60,70,85,100,120,135,150,180,200,250,300,400,500,600,800,1000,1200,1600,2000].map(mm=>({value:Math.log(mm),label:String(mm)}));
   state.controller=api.mountNumeric({root,numeric:{min:Math.log(8),max:Math.log(2000),step:.01,precision:.0001,pixels:8,labelEvery:10,ticks,syncTolerance:.01,ariaValue:focal,snap:v=>Math.log(focal(v)),label:'焦点距離を横スクロールして調整'},getAt:()=>Math.log(Number(input.value)),enabled:current,format:v=>String(focal(v)),describe:v=>focal(v)+'mm',onChange:value=>{if(!current())return;look._numericFocalMoving=true;input.value=String(focal(value));input.onchange?.();},onSettle:()=>{look._numericFocalMoving=false;if(current())input.onchange?.();}});
  }
  range.hidden=true;state.controller.sync(Math.log(Number(input.value)),'number');
 };
})(typeof window==='undefined'?globalThis:window);
`;
}
export function numericRulerHtml(s){
 s=patch(s,'const saveLens = () => { try { localStorage.setItem("sorami.lens", JSON.stringify(aimLens)); } catch {} aimLookRender(host, spec); };','const saveLens = () => { if(!host._numericFocalMoving){try { localStorage.setItem("sorami.lens", JSON.stringify(aimLens)); } catch {}} aimLookRender(host, spec); };');
 return patch(s,"  const portraitButton=look.querySelector('[data-lens-portrait]');", "  globalThis.AstroNotesScrollTimeline?.mountFocal?.(look,()=>auth?.token);\n  const portraitButton=look.querySelector('[data-lens-portrait]');");
}
