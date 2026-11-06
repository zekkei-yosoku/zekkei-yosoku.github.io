// Temporary preview height. The registered height range remains a search condition.
let previewEyePending=null,previewEyeFrame=0,previewEyeRuler=null,previewEyeAdjustmentStamp=null;
function previewEyeStamp(s=SkyMapUI.selectionState()){return !s?.observer||!globalThis.TrialExplore?.active()||el('skyMapView').dataset.exploreStage!=='preview'||el('aimLook').hidden||!el('aimLook').querySelector('[data-look-canvas]')?null:JSON.stringify([auth?.token,auth?.loginId,accessState.generation,s.observer.latitude,s.observer.longitude,s.target?.id,s.body,s.partId,s.limb,s.matchMode]);}
function eyeAdjustmentFor(s){return !!previewEyeAdjustmentStamp&&previewEyeAdjustmentStamp===previewEyeStamp(s);}
function previewEyeValue(){const s=SkyMapUI.selectionState(),ground=SkyMapUI.workspaceHost()?.session.ground;return s?.observer?aimObserverAt(s.observer,ground).eyeM:NaN;}
function applyPreviewEyeHeight(value){
 const stamp=previewEyeStamp();if(!stamp)return;
 if(value===''||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>700){el('previewEyeError').textContent='0〜700mで入力してください';el('previewEyeError').hidden=false;return;}
 const height=Number(value);el('previewEyeError').hidden=true;previewEyePending={height,stamp};el('previewEyeValue').value=String(height);
 if(previewEyeFrame)cancelAnimationFrame(previewEyeFrame);
 previewEyeFrame=requestAnimationFrame(()=>{previewEyeFrame=0;const next=previewEyePending;previewEyePending=null;if(next&&next.stamp===previewEyeStamp()){previewEyeAdjustmentStamp=next.stamp;SkyMapUI.setEyeHeight(next.height);}});
}
function renderPreviewEyeHeight(){
 const look=el('aimLook'),scene=el('exploreScenePanel');if(!look||!scene)return;
 let box=el('previewEyeHeightControls');
 if(!box){
  previewEyeRuler?.destroy();
  box=document.createElement('section');box.id='previewEyeHeightControls';box.setAttribute('aria-label','目線の高さ');
  box.innerHTML='<div class="preview-eye-row"><label for="previewEyeValue">目線<span>地上から</span></label><div class="preview-eye-value"><button type="button" id="previewEyeMinus" aria-label="目線を0.1m下げる">−</button><label><input type="number" id="previewEyeValue" inputmode="decimal" min="0" max="700" step="any" aria-label="目線の高さ（地上からメートル）"><span>m</span></label><button type="button" id="previewEyePlus" aria-label="目線を0.1m上げる">＋</button></div></div><div class="numeric-ruler-track"><div id="previewEyeRuler" class="sky-map-timeline numeric-ruler" role="slider" tabindex="0" aria-label="目線の高さを横スクロールして調整"></div><span class="sky-map-timeline-center" aria-hidden="true"></span></div><p id="previewEyeError" class="tiny" role="status" hidden></p>';
  look.after(box);el('previewEyeValue').onchange=()=>applyPreviewEyeHeight(el('previewEyeValue').value);el('previewEyeValue').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();applyPreviewEyeHeight(el('previewEyeValue').value);}};
  for(const [id,delta]of [['previewEyeMinus',-.1],['previewEyePlus',.1]])el(id).onclick=()=>{const h=previewEyePending?.height??previewEyeValue();applyPreviewEyeHeight(Math.min(700,Math.max(0,Math.round((h+delta)*10)/10)));};
  const rulerRoot=el('previewEyeRuler');previewEyeRuler=AstroNotesScrollTimeline.mountNumeric({root:rulerRoot,numeric:{min:0,max:700,step:.1,precision:.001,pixels:4,labelEvery:10,label:'目線の高さを横スクロールして調整'},getAt:()=>previewEyePending?.height??previewEyeValue(),getObserver:previewEyeStamp,enabled:()=>rulerRoot.isConnected&&el('previewEyeRuler')===rulerRoot&&!!previewEyeStamp(),format:v=>String(Math.round(v*10)/10),describe:v=>v+'m',onChange:applyPreviewEyeHeight});
 }
 const stamp=previewEyeStamp();box.hidden=!stamp;
 if(previewEyePending&&previewEyePending.stamp!==stamp){if(previewEyeFrame)cancelAnimationFrame(previewEyeFrame);previewEyeFrame=0;previewEyePending=null;previewEyeRuler?.stop();}
 if(!stamp){if(previewEyeFrame)cancelAnimationFrame(previewEyeFrame);previewEyeFrame=0;previewEyePending=null;previewEyeRuler?.stop();previewEyeAdjustmentStamp=null;return;}
 const anchor=look.querySelector('.aim-lens')||look;if(box.previousElementSibling!==anchor)anchor.after(box);
 const height=previewEyePending?.height??previewEyeValue();if(Number.isFinite(height)){
  if(document.activeElement!==el('previewEyeValue'))el('previewEyeValue').value=String(Math.round(height*1000)/1000);
  el('previewEyeMinus').disabled=height<=0;el('previewEyePlus').disabled=height>=700;previewEyeRuler?.sync(height,'number');
 }
}
document.addEventListener('astronotes-search-state',renderPreviewEyeHeight);
document.addEventListener('astronotes-preview-leave',()=>{if(previewEyeFrame)cancelAnimationFrame(previewEyeFrame);previewEyeFrame=0;previewEyePending=null;previewEyeAdjustmentStamp=null;previewEyeRuler?.stop();if(el('previewEyeHeightControls'))el('previewEyeHeightControls').hidden=true;});
