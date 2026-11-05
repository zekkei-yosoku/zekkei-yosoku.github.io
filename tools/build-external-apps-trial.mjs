// Trial-only integration of the external-app owner into canonical products.
import {readFileSync} from 'node:fs';
import {patchPlanCalendarUI} from '../experiments/external-apps/plan-ui-patch.mjs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const patch=(source,from,to)=>{const i=source.indexOf(from);if(i<0||source.indexOf(from,i+from.length)>=0)throw Error('External apps trial boundary changed: '+from.slice(0,90));return source.slice(0,i)+to+source.slice(i+from.length);};
export function externalAppsPlan(){return patchPlanCalendarUI(read('astronotes-plan.js'))+'\n'+read('experiments/external-apps/external-apps.js');}
export function externalAppsHtml(html){
 const source=read('src/features/places/map-apps.js'),from=source.slice(source.indexOf('const IS_APPLE'),source.indexOf('function renderCoordRows'));
 html=patch(html,from,`AstroNotesPlan.externalApps=AstroNotesPlan.createExternalApps({storage:store,show:showSheet,onMapChange:()=>{renderCoordRows();aimRefreshSheetCands();}});
const MAP_APPS=AstroNotesPlan.externalApps.mapApps;
const coordText=c=>c.latitude.toFixed(5)+', '+c.longitude.toFixed(5);
const mapAppChoices=()=>AstroNotesPlan.externalApps.choices('map').map(x=>x.id);
const savedMapApp=()=>AstroNotesPlan.externalApps.get('map');
function openMapApp(app,t){AstroNotesPlan.externalApps.requestMap(t,{app});}
function openMapAppSheet(t){AstroNotesPlan.externalApps.requestMap(t,{forceChoose:true});}
`);
 const boundary=" const settingsHome=()=>{categories.hidden=false;row.hidden=true;back.hidden=true;document.getElementById('appSettingsTitle').textContent='設定';};";
 html=patch(html,boundary,` const externalSettings=AstroNotesPlan.externalApps.settings();externalSettings.hidden=true;settingsBody.append(externalSettings);
 const externalEntry=document.getElementById('settingsScreen').cloneNode(true);externalEntry.id='settingsExternalApps';externalEntry.querySelector('strong').textContent='カレンダー・地図';externalEntry.querySelector('.tiny').textContent='開くアプリ';externalEntry.querySelector('svg').innerHTML='<path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>';categories.append(externalEntry);
 const settingsHome=()=>{categories.hidden=false;row.hidden=true;externalSettings.hidden=true;back.hidden=true;document.getElementById('appSettingsTitle').textContent='設定';};
 externalEntry.onclick=()=>{externalSettings.refresh();categories.hidden=true;row.hidden=true;externalSettings.hidden=false;back.hidden=false;document.getElementById('appSettingsTitle').textContent='カレンダー・地図';settings.focus({preventScroll:true});};`);
 html=patch(html,"settingsHome();document.getElementById('settingsScreen').focus();","const focusId=externalSettings.hidden?'settingsScreen':'settingsExternalApps';settingsHome();document.getElementById(focusId).focus();");
 html=patch(html,"settings.addEventListener('close',()=>{scrollLock.off();settingsOpener.focus({preventScroll:true});});","settings.addEventListener('close',()=>{if(settings.open)return;scrollLock.off();settingsOpener.focus({preventScroll:true});});");
 return html;
}
