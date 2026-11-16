/* Trial-only composition draft. Canvas picks the visible surface of the existing approximate drawing model; not surveyed geometry. */
(()=>{
'use strict';const C=AstroNotesCandidateComposition,S=AstroNotesTrialSurface,states=new WeakMap();let ownerKey='',config={composition:null,timeWindow:{kind:'none'},compositionInvalid:false,invalidDraft:null},editing=null;
const current=()=>typeof SkyMapUI==='undefined'?null:SkyMapUI.selectionState(),owner=()=>typeof auth==='undefined'?'':auth?.loginId||'';
function syncContext(s=current()){const key=JSON.stringify([owner(),s?.target,s?.body,s?.partId,s?.limb,s?.matchMode,globalThis.AstroNotesTrialOverlap?.key?.(s)??null]);if(key!==ownerKey){ownerKey=key;config={composition:null,timeWindow:{kind:'none'},compositionInvalid:false,invalidDraft:null};
for(const st of statesList){st.invalid=false;st.dragging=false;st.active=false;st.error='';}if(editing){editing.active=false;editing=null;}}return s;}
function notify(){document.dispatchEvent(new Event('astronotes-composition-change'));for(const st of statesList)update(st);}
function pickHint(){return '重ねたい位置を選んでください';}
function selectedHeight(s,c){return `高さ ${(c.heightM-(s?.target?.groundM??0)).toFixed(1)} m`;}
function selectedLimb(s){if(typeof AstroNotesBodies==='undefined'||!AstroNotesBodies.definition(s?.body)?.limbs)return 'center';return s.limb==='onTop'?'lower':s.limb==='behind'?'upper':['lower','upper'].includes(s.limb)?s.limb:'center';}
// An explicit first arrow key selects an actual visible face, just like a tap.
function firstKeyboardPick(st,choose){
 const s=current(),v=st.host._trialCompositionView,m=S.model(AstroNotesAlign,s?.target);if(!m?.vertices?.length)return false;
 const center=points=>[0,1,2].map(k=>points.reduce((sum,p)=>sum+p[k],0)/points.length),points=[center(m.vertices),...m.surfaceTriangles.flat().map(ids=>center(ids.map(id=>m.vertices[id])))];
 const obs={...v.spec.obs,eyeM:v.spec.eyeM},project=AstroNotesAlign.viewProjector(v.win.az0,v.win.alt0),r=v.cv.getBoundingClientRect(),off=st.host._lensOffset||[0,0];
 for(const [eastM,northM,heightM]of points){const g=S.geometry(obs,s.target,{basis:'scene-surface',eastM,northM,heightM},AstroNotesAlign),xy=project(g.azimuth,g.angle);if(!xy)continue;
  const x=v.W/2+xy[0]*v.k+off[0]*v.W,y=v.H/2-xy[1]*v.k+off[1]*v.H;if(x<0||x>v.W||y<0||y>v.H)continue;
  if(choose({clientX:r.left+x*r.width/v.W,clientY:r.top+y*r.height/v.H}))return true;
 }return false;
}
function cancelEdit(st){config=structuredClone(st.beforeEdit||config);st.beforeEdit=null;st.active=st.dragging=false;st.invalid=false;st.error='';editing=null;notify();st.button.focus({preventScroll:true});}
const statesList=new Set();
function plan(s=current()){syncContext(s);return structuredClone(config);}
function label(s=current()){syncContext(s);const c=config.composition;return c?`${selectedHeight(s,c)}・${c.limb==='upper'?'天体の上の縁':c.limb==='lower'?'天体の下の縁':'天体の中心'}`:null;}
function clear(){syncContext();config={composition:null,timeWindow:{kind:'none'},compositionInvalid:false,invalidDraft:null};editing=null;
 for(const st of statesList){st.beforeEdit=null;st.active=st.dragging=st.invalid=false;st.error='';}notify();}
function capabilities(s,obs){
 const target=s?.target;let model=null,bounds=null;try{model=target&&S.model(AstroNotesAlign,target);bounds=model&&S.bounds({target,align:AstroNotesAlign,obs});}catch(e){globalThis.AstroNotesErrors?.note('composition.bounds',e);}
 const definition=typeof AstroNotesBodies==='undefined'?null:AstroNotesBodies.definition(s?.body),limbs=definition?.limbs===true;
 return {surface:!!model,bounds,limbs,limbOptions:limbs?[['center','中心'],['upper','上の縁'],['lower','下の縁']]:[['center','中心']]};
}
function syncToolbar(host){const st=states.get(host);if(!st)return;const toolbar=host.closest('#exploreScenePanel')&&host.querySelector('.trial-scene-toolbar');
 if(toolbar&&st.button.parentElement!==toolbar)toolbar.append(st.button);const hidden=!toolbar||!st.available;if(st.button.hidden!==hidden)st.button.hidden=hidden;
}
function update(st){
 const s=syncContext(),t=s?.target,cap=capabilities(s,st.host._trialCompositionView?.spec.obs);
 st.available=!!t&&!!st.host.closest('#exploreScenePanel')&&!globalThis.AstroNotesTrialOverlap?.isAll?.(s)&&cap.surface;
 if(!st.available){st.active=st.dragging=false;if(editing===st)editing=null;}
 syncToolbar(st.host);
 const unselected=st.active&&(!config.composition||config.compositionInvalid);
 st.button.disabled=!st.available||unselected;st.button.setAttribute('aria-description',!st.available?'この対象は図から位置を選べません。':unselected?pickHint():'');
 st.button.setAttribute('aria-label',st.active?'確定して撮影地点を探す':'重ねる位置を選ぶ');st.button.title=st.active?'確定して撮影地点を探す':'重ねる位置を選ぶ';st.button.setAttribute('aria-pressed',String(!!st.active));
 const buttonLabel=st.active?'確定':'位置を<wbr>選ぶ';if(st.buttonLabel.innerHTML!==buttonLabel)st.buttonLabel.innerHTML=buttonLabel;
 const glyph=st.active?'<path d="m5 12 4 4L19 6"/>':'<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>';
 if(st.glyph!==glyph){st.buttonIcon.innerHTML=icon(glyph);st.glyph=glyph;}
 const hint=st.error||(!config.composition||config.compositionInvalid?pickHint():selectedHeight(s,config.composition));
 if(st.noteText.textContent!==hint)st.noteText.textContent=hint;st.cancel.hidden=st.note.hidden=!st.active;redraw(st.host);
}
function dispose(st){for(const node of [st.button,st.cancel,st.overlay,st.note])node.remove();statesList.delete(st);states.delete(st.host);}
const icon=paths=>'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths+'</svg>';
function bind(host,view){host._trialCompositionView=view;let st=states.get(host);if(!host.closest('#exploreScenePanel')){
 if(st){st.available=false;st.active=st.dragging=false;syncToolbar(host);st.cancel.hidden=st.overlay.hidden=st.note.hidden=true;redraw(host);}return;}if(st&&(!st.button.isConnected||st.cv!==view.cv)){dispose(st);st=null;
}if(st){update(st);return;}
 const figure=host.querySelector('.aim-look-figure');
 const button=document.createElement('button');button.type='button';button.id='trialCompositionToggle';button.className='trial-composition-action';button.hidden=true;
 const buttonIcon=document.createElement('span');buttonIcon.style.display='contents';const buttonLabel=document.createElement('span');button.append(buttonIcon,buttonLabel);host.append(button);
 // Feedback never participates in the drawing's layout or intercepts a pick.
 const note=document.createElement('p');note.id='trialCompositionStatus';note.className='trial-composition-status';note.hidden=true;note.setAttribute('role','status');note.setAttribute('aria-live','polite');note.setAttribute('aria-atomic','true');
 const noteText=document.createElement('span'),cancel=document.createElement('button');cancel.id='trialCompositionCancel';cancel.type='button';cancel.className='chip';cancel.textContent='やめる';
 Object.assign(cancel.style,{position:'absolute',right:'10px',top:'118px',zIndex:'3',width:'44px',minHeight:'44px',padding:'0',fontSize:'12px',background:'var(--card)',color:'var(--text)'});note.append(noteText);
 Object.assign(note.style,{position:'absolute',left:'12px',right:'64px',top:'12px',zIndex:'3',margin:'0',padding:'8px 12px',border:'1px solid var(--line)',borderRadius:'10px',background:'var(--card)',color:'var(--text)',fontSize:'14px',lineHeight:'1.5',textAlign:'center',pointerEvents:'none'});
 const overlay=document.createElement('div');overlay.setAttribute('aria-hidden','true');Object.assign(overlay.style,{position:'absolute',inset:'0',pointerEvents:'none',overflow:'hidden'});const marker=document.createElement('span'),disc=document.createElement('span');
 Object.assign(marker.style,{position:'absolute',width:'12px',height:'12px',border:'2px solid var(--accent)',borderRadius:'50%',transform:'translate(-50%,-50%)'});
 Object.assign(disc.style,{position:'absolute',border:'2px dashed var(--accent)',borderRadius:'50%',transform:'translate(-50%,-50%)',background:'rgba(180,190,200,.12)'});overlay.append(disc,marker);figure.append(overlay,note,cancel);
 st={normalTouchAction:view.cv.style.touchAction,host,cv:view.cv,button,buttonIcon,buttonLabel,cancel,note,noteText,overlay,marker,disc,active:false,available:false};states.set(host,st);statesList.add(st);
 cancel.onclick=()=>cancelEdit(st);
 button.onclick=ev=>{st.dragging=false;if(!st.active){syncContext();st.beforeEdit=structuredClone(config);st.active=true;st.error='';editing=st;notify();cv.focus({preventScroll:true});return;}
 if(!config.composition||config.compositionInvalid){st.error=pickHint();notify();return;}
 st.active=false;st.error='';editing=null;notify();
 if(globalThis.TrialExplore?.searchCompositionPlaces?.()){st.beforeEdit=null;return;}st.active=true;editing=st;st.error='検索を開始できませんでした。もう一度押してください。';notify();};
 const cv=view.cv;
 function choose(ev){if(!st.active)return;
 const v=host._trialCompositionView,s=syncContext(),r=cv.getBoundingClientRect(),px=(ev.clientX-r.left)*v.W/r.width,py=(ev.clientY-r.top)*v.H/r.height,off=host._lensOffset||[0,0],angle=AstroNotesAlign.viewUnprojector(v.win.az0,v.win.alt0)((px-off[0]*v.W-v.W/2)/v.k,(v.H/2-py+off[1]*v.H)/v.k);
 if(!angle)return;const obs={...v.spec.obs,elevation:v.spec.obs.elevation??0,eyeM:v.spec.eyeM},c=S.pick({azimuth:angle[0],altitude:angle[1],obs,target:s.target,align:AstroNotesAlign,limb:selectedLimb(s)});if(c){config.composition=c;st.invalid=false;config.compositionInvalid=false;
 config.invalidDraft=null;st.error='';}else {
 // A miss does not replace the last exact surface point shown in the drawing.
 st.invalid=!config.composition||config.compositionInvalid;config.compositionInvalid=st.invalid;st.error=st.invalid?pickHint():'';
 }notify();return !!c;}
 for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])cv.addEventListener(type,ev=>{if(!st.active){if(type==='pointerdown')st.suppressClick=false;else if(st.suppressClick){ev.preventDefault();ev.stopImmediatePropagation();}return;}ev.preventDefault();
 ev.stopImmediatePropagation();if(type==='pointerdown'){st.dragging=true;st.pointerStart=[ev.clientX,ev.clientY];st.pointerMoved=false;try{cv.setPointerCapture(ev.pointerId);}catch{/* 既に離れた指は捕まえられないだけ */}}
 // A tap on a thin spire keeps its exact down-point when the finger lifts a few pixels away. Real drags still use exact surface picks.
 if(st.dragging&&st.pointerStart&&Math.hypot(ev.clientX-st.pointerStart[0],ev.clientY-st.pointerStart[1])>6)st.pointerMoved=true;
 if(type==='pointerdown'||st.dragging&&st.pointerMoved&&type!=='pointercancel')choose(ev);if(type==='pointerup'||type==='pointercancel')st.dragging=false;},true);
 cv.addEventListener('click',e=>{if(st.active||st.suppressClick){st.suppressClick=false;e.preventDefault();e.stopImmediatePropagation();}},true);
 cv.addEventListener('keydown',e=>{if(!st.active)return;const dirs={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(!dirs[e.key])return;e.preventDefault();e.stopImmediatePropagation();
 if(!config.composition){if(!firstKeyboardPick(st,choose)){st.error=pickHint();notify();}return;}
 const c=config.composition,v=host._trialCompositionView,s=syncContext(),g=C.geometry({...v.spec.obs,eyeM:v.spec.eyeM},s.target,c,AstroNotesAlign),xy=AstroNotesAlign.viewProjector(v.win.az0,v.win.alt0)(g.azimuth,g.angle),off=host._lensOffset||[0,0],r=cv.getBoundingClientRect(),step=e.shiftKey?10:1;
 choose({clientX:r.left+(v.W/2+xy[0]*v.k+off[0]*v.W+dirs[e.key][0]*step)*r.width/v.W,clientY:r.top+(v.H/2-xy[1]*v.k+off[1]*v.H+dirs[e.key][1]*step)*r.height/v.H});},true);
 update(st);
}
function redraw(host){const st=states.get(host),v=host._trialCompositionView,c=config.composition;if(!st||!v)return;if(st.active){if(!st.wasEditing)st.normalTouchAction=v.cv.style.touchAction;v.cv.style.touchAction='none';st.wasEditing=true;
}else if(st.wasEditing){v.cv.style.touchAction=st.normalTouchAction;st.wasEditing=false;}
st.overlay.hidden=!c||config.compositionInvalid||!st.available||!host.closest('#exploreScenePanel');if(st.overlay.hidden)return;if(!c)return;const s=current();if(!s?.target)return;
const g=C.geometry({...v.spec.obs,eyeM:v.spec.eyeM},s.target,c,AstroNotesAlign),xy=AstroNotesAlign.viewProjector(v.win.az0,v.win.alt0)(g.azimuth,g.angle);if(!xy){st.overlay.hidden=true;return;
}const r=v.cv.getBoundingClientRect(),off=host._lensOffset||[0,0],x=(v.W/2+xy[0]*v.k+off[0]*v.W)*r.width/v.W,y=(v.H/2-xy[1]*v.k+off[1]*v.H)*r.height/v.H,rad=Math.max(2,(host._bodyRadius||.25)*v.k*r.width/v.W);Object.assign(st.marker.style,{left:x+'px',top:y+'px'});
Object.assign(st.disc.style,{left:x+'px',top:(y+(c.limb==='upper'?rad:c.limb==='lower'?-rad:0))+'px',width:2*rad+'px',height:2*rad+'px'});st.disc.hidden=!st.active||!capabilities(s,v.spec.obs).limbs;}
document.addEventListener('keydown', event => {
 const st = editing;
 if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !st?.active) return;
 const scene = st.host.closest('#exploreScenePanel');
 if (!scene || scene.hidden || document.querySelector('dialog[open],#toolsMenu:not([hidden])')) return;
 event.preventDefault();
 event.stopPropagation();
 st.suppressClick = !!st.dragging;
 cancelEdit(st);
}, true);
document.addEventListener('astronotes-preview-leave',()=>{editing=null;for(const st of statesList){if(st.active&&st.beforeEdit)config=structuredClone(st.beforeEdit);
 st.beforeEdit=null;st.active=false;st.dragging=false;st.error='';update(st);}notify();});
globalThis.AstroNotesTrialComposition={bind,redraw,plan,label,clear,capabilities,syncToolbar};const host=document.getElementById('aimLook');if(host?._trialCompositionView)bind(host,host._trialCompositionView);
})();
