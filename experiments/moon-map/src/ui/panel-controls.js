
// 共通の戻る・閉じる操作。動的に開く画面も同じアイコンと表記を使う。
(() => {
 const paths={close:'M5 5 19 19M19 5 5 19',back:'m14 5-7 7 7 7'};
 function decorate(button,kind){
  if(button.dataset.uiControl===kind)return;
  button.dataset.uiControl=kind;
  if(kind==='close')button.classList.add('ui-icon-button');
  if(!button.getAttribute('aria-label'))button.setAttribute('aria-label',kind==='close'?'閉じる':'戻る');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('class','ui-control-icon');
  const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[kind]);svg.append(path);
  if(kind==='back'){
   const label=document.createElement('span');label.className='ui-back-label';label.textContent='戻る';
   button.replaceChildren(svg,label);
  }else button.replaceChildren(svg);
 }
 function scan(root){
  const buttons=[...(root.matches?.('button')?[root]:[]),...(root.querySelectorAll?.('button')||[])];
  for(const button of buttons){
   if(button.matches('.page-back,.panel-back,[data-back-control]'))decorate(button,'back');
   else if(button.id==='toolsClose'||button.getAttribute('aria-label')==='閉じる'||button.textContent.trim()==='閉じる')decorate(button,'close');
  }
 }
 scan(document);
 new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)scan(node);}).observe(document.body,{childList:true,subtree:true});
})();
