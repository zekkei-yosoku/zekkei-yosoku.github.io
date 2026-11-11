import {patchAlignHeightGeometry,patchAtmosphereHeightBounds} from './build-record-height-geometry.mjs';
import {forecastSummaryHtml} from './build-forecast-summary.mjs';
import {patchExactEphemeris} from './build-exact-ephemeris.mjs';
import {patchExactPolygonDistance,patchPreparedOutlineRetention} from './build-exact-polygon-distance.mjs';
import {patchExactGeometry} from './build-exact-geometry.mjs';
import {patchExactTerrain} from './build-exact-terrain.mjs';
import {patchNativeGroundPoint} from './build-native-ground-point.mjs';
import {patchGsiBuildingsCache} from './build-gsi-buildings-cache.mjs';
import {patchExactRidgeTerrain,patchExactRidgeHtml} from './build-exact-ridge.mjs';
import {patchIndexedRidgeTerrain,patchIndexedRidgeHtml,patchIndexedRidgeRecordSearch} from './build-indexed-search-ridge.mjs';
import {numericRulerTimeline,numericRulerHtml} from './build-numeric-rulers.mjs';
import {previewPathLifecycleHtml} from './build-preview-path-lifecycle.mjs';
import {recordOpportunitiesMyplaces,recordOpportunitiesHtml} from './build-record-opportunities.mjs';
import {recordTransferMyplaces,recordTransferLibrary,recordTransferHtml} from './build-record-transfer.mjs';
import {registeredDiscoveryMethods} from './build-record-discovery.mjs';
import {recordSortMyplaces,recordSortHtml} from './build-record-sort.mjs';
// Derive a trial-only Explore from the same source; production bytes are untouched.
import {readFileSync} from 'node:fs';
import {externalAppsPlan,externalAppsHtml} from './build-external-apps-trial.mjs';
import {explorePlaceSource,explorePlaceHtml} from './build-explore-place-entry.mjs';
import {registeredMainSearch} from './build-explore-search-flow.mjs';
import {explorePreviewControlsHtml} from './build-explore-preview-controls.mjs';
import {exploreSwipeBackHtml} from './build-explore-swipe-back.mjs';
import {renderIndex} from './build-index.mjs';
import {versionAssets,hashCsp} from './release-html.mjs';
import {createHash} from 'node:crypto';
import {overlapCandidateSearch,overlapExploreController,overlapHtml,overlapMyplaces} from './build-overlap-scope.mjs';
import {patchSilhouetteOutline} from './build-overlap-silhouette.mjs';
import {patchVisibleBest} from './build-overlap-visible.mjs';
import {patchOutlineBounds,patchAtmosphereSources} from './build-overlap-bounds.mjs';
import {patchPlateauTargetUi} from './build-plateau-target-ui.mjs';
const patch=(s,from,to)=>{if(!s.includes(from))throw Error('Trial source boundary changed: '+from);return s.replace(from,to);};
const read=p=>{
 let s=explorePlaceSource(p,readFileSync(p,'utf8'));if(!p.endsWith('/features/explore/controller.js'))return s;
 s=patch(s,"(s?.target?' · '+alignment:'')","(s?.target?' · '+(s.candidateOpportunity?.at===s.at&&s.candidateOpportunity?.targetId===s.target?.id&&s.candidateOpportunity?.relation==='near'?'候補の時刻':globalThis.AstroNotesTrialComposition?.label?.(s)||alignment):'')");
 s=patch(s,"globalThis.TrialExplore={candidateWorkspace:","document.addEventListener('astronotes-composition-change',updateConditions);\n// 探すを開いた時点で塔の模型を読み始め、地点を選んだ後の待ちから外す。\nconst warmModels=()=>{if(/^#\\/explore/.test(location.hash)&&eligible())AstroNotesAssets.ensureModels().catch(()=>{});};addEventListener('hashchange',warmModels);setTimeout(warmModels,0);\nglobalThis.TrialExplore={candidateWorkspace:");
 s=patch(s," mode=next==='map'?'map':'scene';"," mode='scene';\n tabs.hidden=true;scene.setAttribute('aria-label','見え方');scene.removeAttribute('aria-labelledby');scene.tabIndex=-1;");
 s=patch(s,"if(on&&focus)tab.focus();","if(on&&focus)scene.focus({preventScroll:true});");
 s=patch(s,"const tab=mode==='map'?mapTab:sceneTab;tab.focus({preventScroll:true});tabs.style.scrollMarginTop=(layout.conditions.getBoundingClientRect().height+12)+'px';tabs.scrollIntoView({block:'start',behavior:'auto'});","scene.tabIndex=-1;scene.focus({preventScroll:true});scene.style.scrollMarginTop=(layout.conditions.getBoundingClientRect().height+12)+'px';scene.scrollIntoView({block:'start',behavior:'auto'});");
 // 2026-11-11 ユーザー「まだ計算が遅いよ」: 気象の取得を待たずに今の大気で先に描く。取得は模型の読み込みと並行し、
 // 届いたら大気のキーが変わって、絵を出したまま描き直される（baseStamp は大気を含まない）。
 s=patch(s,"  await AstroNotesAssets.ensureModels();await AstroNotesBodies.ensure(s.body);\n  if(!plan.current(run)||!resultActive()||mode!=='scene'||!plan.matches(key))return;\n  if(aimAirEnsure(aim.from,aim.dayMs))return;","  aimAirEnsure(aim.from,aim.dayMs);\n  await AstroNotesAssets.ensureModels();await AstroNotesBodies.ensure(s.body);\n  if(!plan.current(run)||!resultActive()||mode!=='scene'||!plan.matches(key))return;");
 return overlapExploreController(s);
};
const result=renderIndex({entry:'src/features/explore/entry.inc',read});
let trialShooting=patch(patch(readFileSync('astronotes-shooting.js','utf8'),'event:e,shapeType:s.type','event:e,assumedObserver:obs,shapeType:s.type'),'record:entry.record,event:e});','record:entry.record,event:e,assumedObserver:obs});');
trialShooting=trialShooting.replaceAll("&&(p.body!=='moon'||e.sunAltitude<0)",'').replace("||(p.body==='moon'&&!(e.sunAltitude<0))",'');
// Registered searches yield by elapsed work. Other callers retain the original timers.
trialShooting=patch(trialShooting,'elevationAt,viewFor,isCurrent=()=>true,onProgress=()=>{}}=deps','elevationAt,viewFor,yieldTask,isCurrent=()=>true,onProgress=()=>{}}=deps');
trialShooting=patch(trialShooting,'if(++steps%8===0){onProgress({checked:steps});await new Promise(r=>setTimeout(r,0));check();}','if(++steps%8===0||yieldTask){if(steps%8===0)onProgress({checked:steps});await (yieldTask?yieldTask():new Promise(r=>setTimeout(r,0)));check();}');
trialShooting=patch(trialShooting,'ensure,viewFor,isCurrent=()=>true,onProgress=()=>{}}={})','ensure,viewFor,yieldTask,isCurrent=()=>true,onProgress=()=>{}}={})');
trialShooting=patch(trialShooting,'await new Promise(resolve=>setTimeout(resolve,0));if(!isCurrent())','await (yieldTask?yieldTask():new Promise(resolve=>setTimeout(resolve,0)));if(!isCurrent())');
trialShooting=patch(trialShooting,'elevationAt,viewFor,isCurrent,onProgress});rows.push','elevationAt,viewFor,yieldTask,isCurrent,onProgress});rows.push');
let trialMyplaces=patch(patch(patch(readFileSync('astronotes-myplaces.js','utf8'),'この日に重なる撮影地点はありません。日付や対象を変えるか、記録に撮影地点と見えた対象を追加してください。','登録した地点に候補がありません。日付や対象を変えてください。'),'${result.rows.length}件','${result.rows.length}件（絞り込み前）'),'box.append(button);}'+'\n  if(result.failed)', 'box.append(button);}'+'\n  globalThis.AstroNotesCandidatePicker?.registerRegisteredFromSession(box,result.rows,plan,current);\n  if(result.failed)');
trialMyplaces=patch(trialMyplaces,'plan=AstroNotesShooting.conditions(state()),selectedShape','plan=globalThis.AstroNotesCandidatePicker?.registeredPlan?.(AstroNotesShooting.conditions(state()))||AstroNotesShooting.conditions(state()),selectedShape');
trialMyplaces=registeredMainSearch(trialMyplaces);
trialMyplaces=recordOpportunitiesMyplaces(trialMyplaces);
trialMyplaces=recordTransferMyplaces(trialMyplaces);
trialMyplaces=recordSortMyplaces(trialMyplaces);
trialMyplaces=patch(trialMyplaces,'window.MyPlacesUI = {',''+registeredDiscoveryMethods+'\nwindow.MyPlacesUI = { discoveryPoints,discoverySearch,discoveryRevision,');
trialMyplaces=patch(trialMyplaces,'function changed() {',"function changed() {\n document.dispatchEvent(new Event('astronotes-records-change'));");
const trialAlign=patchOutlineBounds(patchVisibleBest(patchSilhouetteOutline(patchPreparedOutlineRetention(patchAlignHeightGeometry(patchExactPolygonDistance(patchExactGeometry(patch(readFileSync('astronotes-align.js','utf8'),'rimOutline, judge','rimOutline, rimPoints, judge'))))))));const trialAtmosphere=patchAtmosphereSources(patchAtmosphereHeightBounds(readFileSync('astronotes-atmosphere.js','utf8')));
const files={
 'astronotes-terrain.js':patchGsiBuildingsCache(patchIndexedRidgeTerrain(patchNativeGroundPoint(patchExactRidgeTerrain(patchExactTerrain(readFileSync('astronotes-terrain.js','utf8')))))),
 'astronotes-astro.js':patchExactEphemeris(readFileSync('astronotes-astro.js','utf8')),
 'astronotes-library.js':recordTransferLibrary(readFileSync('astronotes-library.js','utf8')),
 'astronotes-scroll-timeline.js':numericRulerTimeline(readFileSync('astronotes-scroll-timeline.js','utf8')),
 // Common calendar geometry for every trial consumer; never a page-level override.
 'astronotes-datetime-ui.css':readFileSync(new URL('../astronotes-datetime-ui.css',import.meta.url),'utf8')+'\n.tool-date-calendar .aim-cal-nav select.fav-in{padding:0 24px 0 8px;background-position-x:calc(100% - 14px),calc(100% - 9px)}\n',
 'astronotes-plan.js':externalAppsPlan(),
 // 2026-11-11 ユーザー「線の長さをforecastと同じにして欲しい」「記録にじゃなくてnotesの方がいい？」: 探すと記録の帯を
 // FORECAST と同じ幅・同じ線の長さにする。記録の帯の英字は NOTES（メニューと保存の文言は「記録」のまま）。
 'astronotes-flair.css':readFileSync('astronotes-flair.css','utf8')+'\n:root #skyMapView.explore-mounted .sky-map-head::before,:root #recordsView .sky-map-head::before{grid-column:1/-1;--kw:6.2em}\n:root #recordsView .sky-map-head::before{content:"NOTES" / "";letter-spacing:.46em;padding-left:.46em;font-size:12px}\n',
 'astronotes-target-ui.js':patchPlateauTargetUi(readFileSync('astronotes-target-ui.js','utf8')),
 'astronotes-align.js':trialAlign,
 'astronotes-atmosphere.js':trialAtmosphere,
 'astronotes-shooting.js':trialShooting,
 'astronotes-myplaces.js':overlapMyplaces(patchIndexedRidgeRecordSearch(trialMyplaces)),
 'astronotes-explore-simple.js':result.html,
 'astronotes-candidate-search.js':readFileSync(new URL('../experiments/candidate-visibility/building-model.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/height-grid.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/plateau-buildings.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/osm-places.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/terrain-model.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/live-terrain.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/scene-hulls.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/scene-surface.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/composition.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/model-evaluator.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/search.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/place-provider.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/generic-evaluator.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/generic-search.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/composition-ui.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/place-labels.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/candidate-picker.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/ui.js',import.meta.url),'utf8').replace("dedicated?document.getElementById('candidateWorkspaceAction'):panel","dedicated?(mainWorkspace().newPlacesHost?.()||document.getElementById('candidateWorkspaceAction')):panel").replace('if(!repeat||!settled)return;','if(mainWorkspace()?.separateRecords||!repeat||!settled)return;'),
 'data/candidate-viewpoints.json':readFileSync(new URL('../data/aim-viewpoints.json',import.meta.url),'utf8'),
 'data/candidate-terrain.json':readFileSync(new URL('../experiments/candidate-visibility/terrain.json',import.meta.url),'utf8'),
 'data/candidate-buildings.json':readFileSync(new URL('../experiments/candidate-visibility/model-buildings.json',import.meta.url),'utf8'),
 // 2026-11-10 PLATEAUを整備した全国の都市の建物の上面の高さ（tools/build-plateau-heights.py が trial/data/building-heights/ へ直接作る）。
 // 地域ごとの一覧とメッシュのファイルはこの一覧のsha256でたどって確かめるので、ここでは一覧だけを版の対象にする。
 'data/building-heights/index.json':readFileSync(new URL('../trial/data/building-heights/index.json',import.meta.url),'utf8'),
 // 2026-11-10 ユーザーが対象に追加できるPLATEAUの建物の形（tools/build-plateau-models.py が trial/data/building-shapes/ へ作る）。
 'data/building-shapes/index.json':readFileSync(new URL('../trial/data/building-shapes/index.json',import.meta.url),'utf8'),
 // 2026-11-11 新しい地点の材料（OpenStreetMapの日本の抽出から tools/build-osm-places.mjs が trial/data/osm-places/ へ作る）。
 'data/osm-places/index.json':readFileSync(new URL('../trial/data/osm-places/index.json',import.meta.url),'utf8'),
 'data/candidate-surfaces.json':readFileSync(new URL('../experiments/candidate-visibility/surface-samples.json',import.meta.url),'utf8'),
 'data/candidate-sidewalks.json':readFileSync(new URL('../experiments/candidate-visibility/sidewalks.json',import.meta.url),'utf8'),
 'data/candidate-label-addresses.json':readFileSync(new URL('../experiments/candidate-visibility/label-addresses.json',import.meta.url),'utf8'),
 'data/candidate-label-facilities.json':readFileSync(new URL('../experiments/candidate-visibility/label-facilities.json',import.meta.url),'utf8')
};
// Trial factory additions are registered beside the production architecture.
const trialArchitecture=JSON.parse(readFileSync('src/source-manifest.json','utf8')).trialArchitecture;
if(!trialArchitecture?.productionUnchanged||trialArchitecture.newGlobals?.length)throw Error('Invalid trial architecture boundary');
const checkTrialUnits=includeHtml=>{for(const unit of trialArchitecture.units){if((unit.output==='index.html')!==includeHtml)continue;const source=readFileSync(unit.path,'utf8');if(!files[unit.output||'astronotes-candidate-search.js']?.includes(source))throw Error('Unbundled trial architecture unit: '+unit.path);}};
checkTrialUnits(false);
// Overlap-scope hooks are applied after the unit inventory check (tools/build-overlap-scope.mjs).
files['astronotes-candidate-search.js']=overlapCandidateSearch(files['astronotes-candidate-search.js']);
files['astronotes-candidate-search.js']=patch(files['astronotes-candidate-search.js'],'/* BUILD_DATA_HASHES */{}',JSON.stringify(Object.fromEntries(Object.entries(files).filter(([n])=>n.startsWith('data/')).map(([n,s])=>[n.slice(5),createHash('sha256').update(s).digest('hex')]))));
files['astronotes-candidate-search.js']+='\n// data-release '+createHash('sha256').update(Object.entries(files).filter(([name])=>name.startsWith('data/')).map(([,value])=>value).join('')).digest('hex')+'\n';
if(process.argv.includes('--html')){
 let html=numericRulerHtml(recordOpportunitiesHtml(previewPathLifecycleHtml(exploreSwipeBackHtml(explorePreviewControlsHtml(explorePlaceHtml(externalAppsHtml(readFileSync(0,'utf8'))))))));
 // Include daytime lunar overlaps in the shared observer calendar/date strip.
 for(const [start,end]of [['function aimCalRows(', 'function aimCalSolid('],['async function aimBuildingDays(', 'function aimDaysInputKey(']]){
  const a=html.indexOf(start),b=html.indexOf(end,a);if(a<0||b<0)throw Error('Daylight observer boundary changed');
  const part=html.slice(a,b).replaceAll('&&(body!=="moon"||e.sunAltitude<0)','').replaceAll('(body !== "moon" || e.sunAltitude < 0)','true');html=html.slice(0,a)+part+html.slice(b);
 }
 html=patch(html,'store.setWriteHook(key=>RecordSync.touched(key));','store.setWriteHook(key=>{RecordSync.touched(key);if(key==="sorami.favorites")document.dispatchEvent(new Event("astronotes-records-change"));});');
 html=patch(html,"${snap.body==='moon'?'（暗い空の時間）':''}",'');
 // 2026-11-11 ユーザー（ヒアリング）: a new place chosen in 探す opens with the whole target about 6/10 of the frame height and the
 // frame's lower edge on the ground line; 「天体に寄る」 aims at the body with its diameter about 1/4 of the frame height (the camera
 // stays aimed there, as on a tripod); 「全体を入れる」 returns. Each sets the 撮影設定 focal length.
 html=patch(html,'async function aimLookRender','// 天体に寄る is for a body on or near the target: within the height of the target plus 10 deg of its top.\nfunction aimComposeNear(st,az,topAngle,baseAngle){const R=Math.PI/180,d=Math.acos(Math.max(-1,Math.min(1,Math.sin(st.apparentAltitude*R)*Math.sin(topAngle*R)+Math.cos(st.apparentAltitude*R)*Math.cos(topAngle*R)*Math.cos((st.azimuth-az)*R))))/R;return d<=Math.max(15,topAngle-baseAngle+10);}\nasync function aimLookRender');
 html=patch(html,'const focal = aimLens.mode === "auto" ? autoFocal : aimLens.focal;','if(host._compose?.apply){const c=host._compose,groundAngle=mountain?0:(outline&&outline.hiddenAngle!==null?Math.max(outline.hiddenAngle,baseAngle):baseAngle),vfov=c.mode==="body"?8*Math.max(radius,.05):Math.max(.05,(topAngle-groundAngle)/0.6),f=sh/(2*Math.tan(vfov/2*Math.PI/180));aimLens.on=true;aimLens.mode="manual";aimLens.focal=Math.round(Math.max(8,Math.min(2000,f))*10)/10;try{localStorage.setItem("sorami.lens",JSON.stringify(aimLens));}catch{}}\n  const focal = aimLens.mode === "auto" ? autoFocal : aimLens.focal;');
 html=patch(html,'  host.querySelector("[data-lens-info]").textContent = ','  if(host._compose?.mode==="body"&&Number.isFinite(host._compose.at)){let aimed=false;try{const st=AstroNotesBodies.state(body,host._compose.at,eyeObs);if(st&&Number.isFinite(st.azimuth)&&Number.isFinite(st.apparentAltitude)&&aimComposeNear(st,win.az0,topAngle,baseAngle)){win.az0=st.azimuth;win.alt0=st.apparentAltitude;aimed=true;}}catch{}if(!aimed)host._compose=null;}\n  host.querySelector("[data-lens-info]").textContent = ');
 html=patch(html,'const pan = host._lensOffset || [0, 0], panX = pan[0] * W, panY = pan[1] * H;','if(host._compose?.apply){const c=host._compose;c.apply=false;if(c.mode==="body")host._lensOffset=[0,0];else{const bottom=frame?H/2+frame.halfH*k:H-12;host._lensOffset=[0,Math.max(-1,Math.min(1,(bottom-groundEdge)/H))];}host._lensSnap={ground:c.mode!=="body",center:c.mode!=="body"};}\n    const pan = host._lensOffset || [0, 0], panX = pan[0] * W, panY = pan[1] * H;');
 // ユーザー「右上のアイコンに並べる」: the switch sits with the figure's round icons (対象を中央に・画角設定).
 html=patch(html,'tools.append(center);}','tools.append(center);}const composeToggle=look.querySelector("[data-lens-compose]");if(composeToggle){composeToggle.className="preview-compose-toggle";composeToggle.hidden=false;(look.querySelector(".aim-look-figure")||tools).append(composeToggle);}');
 html=patch(html,'<button type="button" class="chip" data-lens-center>対象を中央に</button></div>','<button type="button" class="chip" data-lens-center>対象を中央に</button><button type="button" class="chip" data-lens-compose aria-pressed="false">天体に寄る</button></div>');
 html=patch(html,'center.onclick = () => { host._lensKeyOffset = null;','const composeButton=host.querySelector("[data-lens-compose]");if(composeButton){const near=host._compose?.mode==="body";let reach=near;if(!near){try{const st=AstroNotesBodies.state(body,host._lookAt??selectedAt,eyeObs);reach=!!st&&aimComposeNear(st,az,topAngle,baseAngle);}catch{}}composeButton.disabled=!reach;composeButton.setAttribute("aria-pressed",String(near));{const label=near?"全体を入れる":"天体に寄る";composeButton.setAttribute("aria-label",label);composeButton.title=label;composeButton.innerHTML=\'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21M7.5 10.5h6\'+(near?"":"M10.5 7.5v6")+\'"/></svg>\';}composeButton.onclick=()=>{host._compose={mode:near?"whole":"body",apply:true,at:host._lookAt??selectedAt};host._lensKeyOffset=null;aimLookRender(host,spec);};}\n  center.onclick = () => { host._lensKeyOffset = null;');
 // While the camera is on the body, 中央に戻す returns to the target first (the original handler stays as it is).
 html=patch(html,'draw(cur); };\n  if (!host._pick) { cv.onkeydown = null; cv.tabIndex = 0; }','draw(cur); };\n  {const centre=center.onclick;center.onclick=()=>{if(host._compose?.mode==="body"){host._compose=null;aimLookRender(host,spec);return;}centre();};}\n  if (!host._pick) { cv.onkeydown = null; cv.tabIndex = 0; }');
 // Map presentation and place-sheet ownership live in the inline document,
 // outside the Explore asset entry. Apply these contracts to that product.
 html=patch(html,'$("placeSheet").addEventListener("close", () => {','$("placeSheet").addEventListener("close", () => {\n  if ($("placeSheet").open) return;');
 html=patch(html,"observer:session.observer}),renderState:","observer:session.observer,candidateOpportunity:session.candidateOpportunity}),renderState:");
 html=patch(html,"skyPlayback.stop(false);\n  session.observer=aimSavedFrom","skyPlayback.stop(false);\n  session.candidateOpportunity={id:candidate.id,relation:candidate.event.relation,at:candidate.event.at,targetId:session.target?.id};\n  session.observer=aimSavedFrom");
 html=html.replace(/connect-src ([^;]+)/,(_,orig)=>'connect-src '+orig+' https://api.openstreetmap.org');
 html=patch(html,html.match(/<script src="astronotes-explore\.js\?v=\d+"><\/script>/)?.[0]||'missing-explore-script','<script src="astronotes-explore-simple.js?v=0"></script>');
 html=patch(html,'host._bodyRadius = p.radius;','host._bodyRadius = p.radius; globalThis.AstroNotesTrialComposition?.redraw(host);');
 html=patch(html,'host._redrawLook = () => { if (host._lookSeq === seq) draw(cur); };','host._redrawLook = () => { if (host._lookSeq === seq) draw(cur); };\n host._trialCompositionView={spec,cv,W,H,k,win}; globalThis.AstroNotesTrialComposition?.bind(host,host._trialCompositionView);');
 html=forecastSummaryHtml(patchIndexedRidgeHtml(patchExactRidgeHtml(recordSortHtml(recordTransferHtml(overlapHtml(html))))));
 // 2026-11-11 ユーザー「計算が遅いこと」: 見え方の「重なる日時」は計算本体のWorkerで並行して解く（record-opportunities-runtime.js
 // の aimDaysEngine）。使えないとき（山・ほかの重ね方・近くの気象・Workerなし）は今までどおりこの画面で解く。
 html=patch(html,"  if(saved&&start>=saved.from&&start<saved.until&&isCurrent()){onScanned(saved.scanned);return saved.rows.map(e=>({...e}));}\n","  if(saved&&start>=saved.from&&start<saved.until&&isCurrent()){onScanned(saved.scanned);return saved.rows.map(e=>({...e}));}\n  {const viaEngine=globalThis.AstroNotesDaysEngine?await globalThis.AstroNotesDaysEngine(obs,target,body,partId,{from:start,limb,matchMode,days,limit,isCurrent,onScanned}):null;\n   if(viaEngine){if(isCurrent()){const scannedTo=viaEngine.length>=limit?S.Cal.startOfDay(viaEngine[limit-1].at)+86400000:start+days*86400000;cache.delete(cacheKey);cache.set(cacheKey,{from:start,until:start+86400000,scanned:scannedTo,rows:viaEngine.map(e=>({...e}))});while(cache.size>8)cache.delete(cache.keys().next().value);onScanned(scannedTo);}return viaEngine;}}\n");
 // 2026-11-11 ユーザー「地平線が波打ってる」: 奥の地形を300km先まで5kmおきの61点で拾っていたため、山の頂を拾ったり外したりして
 // 隣の方位どうしで高さがばらついた。近くは細かく遠くは粗い240点（距離の比で等間隔）にし、方位も0.25°おきにする。
 html=patch(html,'const cols = span > AIM_FRONT_SPAN ? 120 : 80, n = 60, near = D + 0.3, far = Math.max(near + 1, AIM_BEYOND_MAX_KM), pts = [];','const cols = span > AIM_FRONT_SPAN ? 240 : 160, n = 240, near = D + 0.3, far = Math.max(near + 1, AIM_BEYOND_MAX_KM), pts = [];');
 html=patch(html,'for (let j = 0; j <= n; j++) { const d = near + (far - near) * j / n; pts.push({ ...AstroNotesTerrain.destination(obs.latitude, obs.longitude, az, d), az, d }); }','for (let j = 0; j <= n; j++) { const d = near * Math.pow(far / near, j / n); pts.push({ ...AstroNotesTerrain.destination(obs.latitude, obs.longitude, az, d), az, d }); }');
 html=patch(html,'</body>','<script src="astronotes-candidate-search.js?v=0"></script>\n</body>');
 const versioned=versionAssets(html,name=>Object.hasOwn(files,name)?files[name]:readFileSync(new URL('../'+name,import.meta.url)));
 files['index.html']=hashCsp(versioned.html).html;files['app-version.txt']=versioned.id+'\n';
 checkTrialUnits(true);
 const digest=v=>createHash('sha256').update(v).digest('hex');
 files['candidate-experiment.json']=JSON.stringify({name:'2026-11-05 全対象・全選択天体の撮影候補探索trial',productionHtmlSha256:digest(readFileSync(new URL('../index.html',import.meta.url))),visibilityCertified:false,productionAssetsSha256:Object.fromEntries(['astronotes-align.js','astronotes-shooting.js','astronotes-myplaces.js','astronotes-plan.js'].map(n=>[n,digest(readFileSync(new URL('../'+n,import.meta.url)))])),files:Object.fromEntries(Object.entries(files).map(([n,s])=>[n,digest(s)]))},null,2)+'\n';
}
process.stdout.write(JSON.stringify(files));
