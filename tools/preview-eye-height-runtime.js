// Temporary preview height. The registered height range remains a search condition.
let previewEyePending=null,previewEyeFrame=0,previewEyeRuler=null,previewEyeAdjustmentStamp=null;
function previewEyeStamp(s=SkyMapUI.selectionState()){return !s?.observer||!globalThis.TrialExplore?.active()||el('skyMapView').dataset.exploreStage!=='preview'||el('aimLook').hidden||!el('aimLook').querySelector('[data-look-canvas]')?null:JSON.stringify([auth?.token,auth?.loginId,accessState.generation,s.observer.latitude,s.observer.longitude,s.target?.id,s.body,s.partId,s.limb,s.matchMode]);}
function eyeAdjustmentFor(s){return !!previewEyeAdjustmentStamp&&previewEyeAdjustmentStamp===previewEyeStamp(s);}
function previewEyeValue(){const s=SkyMapUI.selectionState(),ground=SkyMapUI.workspaceHost()?.session.ground;return s?.observer?aimObserverAt(s.observer,ground).eyeM:NaN;}
function applyPreviewEyeHeight(value){
 value=String(value).normalize('NFKC').trim();
 const stamp=previewEyeStamp();if(!stamp)return;
 if(String(value).trim()===''||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>700){el('previewEyeError').textContent='0〜700mで入力してください';el('previewEyeError').hidden=false;return;}
 const height=Math.round(Number(value)*10)/10;el('previewEyeError').hidden=true;previewEyePending={height,stamp};el('previewEyeValue').value=String(height);
 if(previewEyeFrame)cancelAnimationFrame(previewEyeFrame);
 previewEyeFrame=requestAnimationFrame(()=>{previewEyeFrame=0;const next=previewEyePending;previewEyePending=null;if(next&&next.stamp===previewEyeStamp()){previewEyeAdjustmentStamp=next.stamp;SkyMapUI.setEyeHeight(next.height);}});
}
function renderPreviewEyeHeight(){
 const look=el('aimLook'),scene=el('exploreScenePanel');if(!look||!scene)return;
 let box=el('previewEyeHeightControls');
 if(!box){
  previewEyeRuler?.destroy();
  box=document.createElement('section');box.id='previewEyeHeightControls';box.setAttribute('aria-label','目線の高さ');
  box.innerHTML='<div class="preview-eye-row"><div class="preview-eye-tools"><label class="preview-eye-scale" for="previewEyeValue">目線（地上から）</label><div class="numeric-ruler-track"><div id="previewEyeRuler" class="sky-map-timeline numeric-ruler" role="slider" tabindex="0" aria-label="目線の高さを横スクロールして調整"></div><span class="sky-map-timeline-center" aria-hidden="true"></span></div></div><label class="preview-eye-value"><input type="text" id="previewEyeValue" inputmode="decimal" min="0" max="700" step="0.1" aria-label="目線の高さ（地上からメートル）"><span>m</span></label></div><p id="previewEyeError" class="tiny" role="status" hidden></p>';
  AstroNotesScrollTimeline.focusEnd(box.querySelector('#previewEyeValue'));
  look.after(box);el('previewEyeValue').onchange=()=>applyPreviewEyeHeight(el('previewEyeValue').value);el('previewEyeValue').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();applyPreviewEyeHeight(el('previewEyeValue').value);}};

  const rulerRoot=el('previewEyeRuler');previewEyeRuler=AstroNotesScrollTimeline.mountNumeric({root:rulerRoot,numeric:{min:0,max:700,step:.1,precision:.1,pixels:4,labelEvery:10,label:'目線の高さを横スクロールして調整'},getAt:()=>previewEyePending?.height??previewEyeValue(),getObserver:previewEyeStamp,enabled:()=>rulerRoot.isConnected&&el('previewEyeRuler')===rulerRoot&&!!previewEyeStamp(),format:v=>String(Math.round(v*10)/10),describe:v=>v+'m',onChange:applyPreviewEyeHeight});
 }
 const stamp=previewEyeStamp();box.hidden=!stamp;
 if(previewEyePending&&previewEyePending.stamp!==stamp){if(previewEyeFrame)cancelAnimationFrame(previewEyeFrame);previewEyeFrame=0;previewEyePending=null;previewEyeRuler?.stop();}
 if(!stamp){if(previewEyeFrame)cancelAnimationFrame(previewEyeFrame);previewEyeFrame=0;previewEyePending=null;previewEyeRuler?.stop();previewEyeAdjustmentStamp=null;return;}
 const anchor=look.querySelector('.aim-lens')||look;if(box.previousElementSibling!==anchor)anchor.after(box);
 const height=previewEyePending?.height??previewEyeValue();if(Number.isFinite(height)){
  if(document.activeElement!==el('previewEyeValue'))el('previewEyeValue').value=String(Math.round(height*10)/10);
  previewEyeRuler?.sync(height,'number');
 }
}
document.addEventListener('astronotes-search-state',renderPreviewEyeHeight);
document.addEventListener('astronotes-preview-leave',()=>{if(previewEyeFrame)cancelAnimationFrame(previewEyeFrame);previewEyeFrame=0;previewEyePending=null;previewEyeAdjustmentStamp=null;previewEyeRuler?.stop();if(el('previewEyeHeightControls'))el('previewEyeHeightControls').hidden=true;});
