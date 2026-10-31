import {UI_ICONS} from './visual-primitives.js';
import {recentHistory} from '../features/framing/presentation.js';
(()=>{
 const el=id=>document.getElementById(id);
 const mark=(id,key)=>{const n=el(id)?.querySelector('.pin');if(n)n.innerHTML=UI_ICONS[key];};
 for(const id of ['aimFromButton','planeFromButton'])mark(id,'observer');
 for(const id of ['placeButton','aimTargetButton','issFromButton'])mark(id,'pin');
 const label=(id,key)=>{const b=el(id);if(!b)return;const text=b.textContent.trim();b.classList.add('ui-icon-label');b.innerHTML=UI_ICONS[key]+'<span>'+text+'</span>';};
 for(const id of ['aimPick','planePickHere'])label(id,'observer');label('aimPickTarget','pin');
 for(const id of ['mapSearchGo','searchBoxGo']){const b=el(id);b.setAttribute('aria-label','検索');b.title='検索';b.innerHTML=UI_ICONS.search;}
 el('skyMapRecentOpen').innerHTML=UI_ICONS.history;el('skyMapRecentOpen').onclick=()=>recentHistory.places('skymap');const recent=el('aimRecentOpen');if(recent){recent.innerHTML=UI_ICONS.history;recent.classList.add('preview-history-icon');recent.title='履歴';}label('photoPick','photo');label('exportBtn','download');label('importBtn','upload');
})();