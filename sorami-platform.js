/* App navigation only. Existing tools own their inputs, data, calculation and auth. */
(() => {
 'use strict';
 const el=id=>document.getElementById(id);
 const fresh=()=>({astro:{hash:'#/astro',y:0},forecast:{hash:'#',y:0}});
 let memory=fresh(),owner=auth?.loginId||null,rights=allowedTools().join(','),mode='forecast';
 const isAstro=r=>!!(r?.astro||r?.aim||r?.skymap||r?.plane||r?.iss);
 function permitted(hash){
  if(!auth?.token)return false;
  if(hash==='#/skymap')return toolAllowed('skymap');
  if(hash.startsWith('#/aim'))return ['diamond','pearl','tower'].some(toolAllowed);
  return hash==='#/plane'?toolAllowed('plane'):hash==='#/iss'?toolAllowed('iss'):hash==='#/astro';
 }
 function firstTool(){return ['#/skymap','#/aim','#/plane','#/iss'].find(permitted)||'#/astro';}
 function render(){
  const r=routeFromHash();
  if(isAstro(r))mode='astro';else if(!r||r.id)mode='forecast';
  el('appAstro').setAttribute('aria-pressed',String(mode==='astro'));
  el('appForecast').setAttribute('aria-pressed',String(mode==='forecast'));
  el('appBrand').textContent=mode==='astro'?'AstroNotes':'絶景予測';
  el('homeLink').querySelector('img').hidden=mode==='astro';
  el('astroAccessText').textContent=auth?'利用できる天体ツールがありません。アカウントの利用権限を確認してください。':'ログインすると、利用できる天体ツールを開けます。';
  el('astroAccessLogin').hidden=!!auth;
 }
 function accountChanged(){
  const next=auth?.loginId||null;
  const nextRights=allowedTools().join(','),changed=next!==owner||nextRights!==rights;rights=nextRights;
  if(next!==owner){owner=next;memory=fresh();}
  const r=routeFromHash();
  if(r?.astro&&firstTool()!=='#/astro')pushRoute(firstTool());
  else if(changed&&isAstro(r)&&!r.astro&&!permitted(location.hash.split('?')[0]))pushRoute('#/astro');
  render();
 }
 function switchApp(next){
  if(next===mode)return;
  const r=routeFromHash();
  if(isAstro(r)||!r||r.id)memory[mode]={hash:r?.aim?'#/aim':location.hash.split('?')[0]||'#',y:window.scrollY};
  mode=next;
  let target=memory[next];
  if(next==='astro'&&(target.hash==='#/astro'||!permitted(target.hash)))target={hash:firstTool(),y:0};
  appReturnScroll=target.y;pushRoute(target.hash);render();
 }
 el('appAstro').onclick=()=>switchApp('astro');
 el('appForecast').onclick=()=>switchApp('forecast');
 el('astroAccessLogin').onclick=()=>el('authButton').click();
 AppSwitchUI={render,accountChanged,isAstro:()=>mode==='astro',home(){pushRoute(firstTool());}};
 render();accountChanged();
})();
