
// Resolve the launch destination before exposing the default forecast markup.
(()=>{let preferred='home';try{const saved=localStorage.getItem('sorami.startupScreen');if(['home','forecast','framing','map'].includes(saved))preferred=saved;}catch{}
if(location.hash||location.search||preferred!=='forecast'){document.documentElement.setAttribute('data-startup-pending','');globalThis.AstroNotesStartupPaintTimer=setTimeout(()=>document.documentElement.removeAttribute('data-startup-pending'),15000);}})();
