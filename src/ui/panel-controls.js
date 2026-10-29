
// 共通パネル操作。文字の×/✕と個別SVGを混在させず、動的生成にも適用する。
(() => {
 const paths={close:'M5 5 19 19M19 5 5 19',back:'m14 5-7 7 7 7'};
 function decorate(button,kind){
  if(button.dataset.uiControl===kind)return;
  button.dataset.uiControl=kind;button.classList.add('ui-icon-button');
  if(!button.getAttribute('aria-label'))button.setAttribute('aria-label',kind==='close'?'閉じる':'戻る');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('class','ui-control-icon');
  const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[kind]);svg.append(path);button.replaceChildren(svg);
 }
 function scan(root){
  const buttons=[...(root.matches?.('button')?[root]:[]),...(root.querySelectorAll?.('button')||[])];
  for(const b of buttons){if(b.id==='settingsBack'||b.id==='accountBack'){decorate(b,'back');continue;}if(b.id==='toolsClose'||b.getAttribute('aria-label')==='閉じる'||b.textContent.trim()==='閉じる')decorate(b,'close');}
 }
 scan(document);
 new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)scan(node);}).observe(document.body,{childList:true,subtree:true});
})();
