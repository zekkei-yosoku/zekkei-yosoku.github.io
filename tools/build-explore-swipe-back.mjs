// Reuse the app's edge gesture recognizer; only the trial preview's destination differs.
const patch=(html,from,to)=>{if(html.split(from).length!==2)throw Error('Explore swipe boundary changed: '+from);return html.replace(from,to);};
export function exploreSwipeBackHtml(html){
 // Touch hit adjustment can target the nearby canvas even when the finger
 // starts outside its actual bounds. Reserve that gutter before canvas picking.
 const edge='const SWIPE_EDGE_PX = 28;';
 html=patch(html,edge,edge+`
const previewEdgeCanvas=(target,x)=>{const canvas=target.closest?.('#exploreScenePanel canvas[data-look-canvas]');return canvas&&x<=SWIPE_EDGE_PX&&x<canvas.getBoundingClientRect().left;};
document.addEventListener('pointerdown',e=>{
 if(e.pointerType==='touch'&&e.isPrimary&&previewEdgeCanvas(e.target,e.clientX)&&!document.querySelector('dialog[open]')&&!(!$("toolsMenu").hidden&&$("toolsMenu").classList.contains('on'))&&globalThis.TrialExplore?.candidateWorkspace?.()?.beginBack?.())e.stopPropagation();
},true);`);
 const open='  const open = !$("toolsMenu").hidden && $("toolsMenu").classList.contains("on");';
 html=patch(html,open,open+'\n  const previewBack = !open && globalThis.TrialExplore?.candidateWorkspace?.()?.beginBack?.();');
 html=patch(html,'(isMenuPage() && $("toolsButton").hidden)','(!previewBack && isMenuPage() && $("toolsButton").hidden)');
 html=patch(html,'e.target.closest(".mapwrap, canvas, input, select:not(#sortSelect), textarea, .preview-footer-track"))',
  '(e.target.closest(".mapwrap, canvas, input, select:not(#sortSelect), textarea, .preview-footer-track") && !(previewBack && previewEdgeCanvas(e.target, t.clientX))))');
 html=patch(html,'if (!open && currentView === "list" && t.clientX <= 8 && e.cancelable)',
  'if (!open && ((previewBack && t.clientX <= SWIPE_EDGE_PX) || (currentView === "list" && t.clientX <= 8)) && e.cancelable)');
 html=patch(html,'back: !open && !isMenuPage(),','back: previewBack || (!open && !isMenuPage()),');
 html=patch(html,'swipeEndedAt = performance.now(); navigationHistory.goBack();',
  'swipeEndedAt = performance.now(); if (typeof back === "function") back(); else navigationHistory.goBack();');
 return html;
}
