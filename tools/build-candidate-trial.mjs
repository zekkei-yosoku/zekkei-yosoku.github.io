import {patchAlignHeightGeometry,patchAtmosphereHeightBounds} from './build-record-height-geometry.mjs';
import {numericRulerTimeline,numericRulerHtml} from './build-numeric-rulers.mjs';
import {previewPathLifecycleHtml} from './build-preview-path-lifecycle.mjs';
import {recordOpportunitiesMyplaces,recordOpportunitiesHtml} from './build-record-opportunities.mjs';
import {registeredDiscoveryMethods} from './build-record-discovery.mjs';
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
import {overlapCandidateSearch,overlapExploreController,overlapHtml} from './build-overlap-scope.mjs';
const patch=(s,from,to)=>{if(!s.includes(from))throw Error('Trial source boundary changed: '+from);return s.replace(from,to);};
const read=p=>{
 let s=explorePlaceSource(p,readFileSync(p,'utf8'));if(!p.endsWith('/features/explore/controller.js'))return s;
 s=patch(s,"(s?.target?' · '+alignment:'')","(s?.target?' · '+(s.candidateOpportunity?.at===s.at&&s.candidateOpportunity?.targetId===s.target?.id&&s.candidateOpportunity?.relation==='near'?'候補の時刻':globalThis.AstroNotesTrialComposition?.label?.(s)||alignment):'')");
 s=patch(s,"globalThis.TrialExplore={candidateWorkspace:","document.addEventListener('astronotes-composition-change',updateConditions);\nglobalThis.TrialExplore={candidateWorkspace:");
 s=patch(s," mode=next==='map'?'map':'scene';"," mode='scene';\n tabs.hidden=true;scene.setAttribute('aria-label','見え方');scene.removeAttribute('aria-labelledby');scene.tabIndex=-1;");
 s=patch(s,"if(on&&focus)tab.focus();","if(on&&focus)scene.focus({preventScroll:true});");
 s=patch(s,"const tab=mode==='map'?mapTab:sceneTab;tab.focus({preventScroll:true});tabs.style.scrollMarginTop=(layout.conditions.getBoundingClientRect().height+12)+'px';tabs.scrollIntoView({block:'start',behavior:'auto'});","scene.tabIndex=-1;scene.focus({preventScroll:true});scene.style.scrollMarginTop=(layout.conditions.getBoundingClientRect().height+12)+'px';scene.scrollIntoView({block:'start',behavior:'auto'});");
 return overlapExploreController(s);
};
const result=renderIndex({entry:'src/features/explore/entry.inc',read});
let trialShooting=patch(patch(readFileSync('astronotes-shooting.js','utf8'),'event:e,shapeType:s.type','event:e,assumedObserver:obs,shapeType:s.type'),'record:entry.record,event:e});','record:entry.record,event:e,assumedObserver:obs});');
trialShooting=trialShooting.replaceAll("&&(p.body!=='moon'||e.sunAltitude<0)",'').replace("||(p.body==='moon'&&!(e.sunAltitude<0))",'');
let trialMyplaces=patch(patch(patch(readFileSync('astronotes-myplaces.js','utf8'),'この日に重なる撮影地点はありません。日付や対象を変えるか、記録に撮影地点と見えた対象を追加してください。','登録した地点に候補がありません。日付や対象を変えてください。'),'${result.rows.length}件','${result.rows.length}件（絞り込み前）'),'box.append(button);}'+'\n  if(result.failed)', 'box.append(button);}'+'\n  globalThis.AstroNotesCandidatePicker?.registerRegisteredFromSession(box,result.rows,plan,current);\n  if(result.failed)');
trialMyplaces=patch(trialMyplaces,'plan=AstroNotesShooting.conditions(state()),selectedShape','plan=globalThis.AstroNotesCandidatePicker?.registeredPlan?.(AstroNotesShooting.conditions(state()))||AstroNotesShooting.conditions(state()),selectedShape');
trialMyplaces=registeredMainSearch(trialMyplaces);
trialMyplaces=recordOpportunitiesMyplaces(trialMyplaces);
trialMyplaces=patch(trialMyplaces,'window.MyPlacesUI = {',''+registeredDiscoveryMethods+'\nwindow.MyPlacesUI = { discoveryPoints,discoverySearch,discoveryRevision,');
trialMyplaces=patch(trialMyplaces,'function changed() {',"function changed() {\n document.dispatchEvent(new Event('astronotes-records-change'));");
const trialAlign=patchAlignHeightGeometry(patch(readFileSync('astronotes-align.js','utf8'),'rimOutline, judge','rimOutline, rimPoints, judge'));const trialAtmosphere=patchAtmosphereHeightBounds(readFileSync('astronotes-atmosphere.js','utf8'));
const files={
 'astronotes-scroll-timeline.js':numericRulerTimeline(readFileSync('astronotes-scroll-timeline.js','utf8')),
 // Common calendar geometry for every trial consumer; never a page-level override.
 'astronotes-datetime-ui.css':readFileSync(new URL('../astronotes-datetime-ui.css',import.meta.url),'utf8')+'\n.tool-date-calendar .aim-cal-nav select.fav-in{padding:0 24px 0 8px;background-position-x:calc(100% - 14px),calc(100% - 9px)}\n',
 'astronotes-plan.js':externalAppsPlan(),
 'astronotes-align.js':trialAlign,
 'astronotes-atmosphere.js':trialAtmosphere,
 'astronotes-shooting.js':trialShooting,
 'astronotes-myplaces.js':trialMyplaces,
 'astronotes-explore-simple.js':result.html,
 'astronotes-candidate-search.js':readFileSync(new URL('../experiments/candidate-visibility/building-model.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/terrain-model.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/live-terrain.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/scene-hulls.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/scene-surface.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/composition.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/model-evaluator.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/search.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/place-provider.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/generic-evaluator.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/generic-search.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/composition-ui.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/place-labels.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/candidate-picker.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/ui.js',import.meta.url),'utf8').replace("dedicated?document.getElementById('candidateWorkspaceAction'):panel","dedicated?(mainWorkspace().newPlacesHost?.()||document.getElementById('candidateWorkspaceAction')):panel").replace('if(!repeat||!settled)return;','if(mainWorkspace()?.separateRecords||!repeat||!settled)return;'),
 'data/candidate-viewpoints.json':readFileSync(new URL('../data/aim-viewpoints.json',import.meta.url),'utf8'),
 'data/candidate-terrain.json':readFileSync(new URL('../experiments/candidate-visibility/terrain.json',import.meta.url),'utf8'),
 'data/candidate-buildings.json':readFileSync(new URL('../experiments/candidate-visibility/model-buildings.json',import.meta.url),'utf8'),
 'data/candidate-surfaces.json':readFileSync(new URL('../experiments/candidate-visibility/surface-samples.json',import.meta.url),'utf8'),
 'data/candidate-sidewalks.json':readFileSync(new URL('../experiments/candidate-visibility/sidewalks.json',import.meta.url),'utf8'),
 'data/candidate-label-addresses.json':readFileSync(new URL('../experiments/candidate-visibility/label-addresses.json',import.meta.url),'utf8'),
 'data/candidate-label-facilities.json':readFileSync(new URL('../experiments/candidate-visibility/label-facilities.json',import.meta.url),'utf8')
};
// Trial factory additions are registered beside the production architecture.
const trialArchitecture=JSON.parse(readFileSync('src/source-manifest.json','utf8')).trialArchitecture;
if(!trialArchitecture?.productionUnchanged||trialArchitecture.newGlobals?.length)throw Error('Invalid trial architecture boundary');
for(const unit of trialArchitecture.units){const source=readFileSync(unit.path,'utf8');if(!files[unit.output||'astronotes-candidate-search.js']?.includes(source))throw Error('Unbundled trial architecture unit: '+unit.path);}
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
 // Map presentation and place-sheet ownership live in the inline document,
 // outside the Explore asset entry. Apply these contracts to that product.
 html=patch(html,'$("placeSheet").addEventListener("close", () => {','$("placeSheet").addEventListener("close", () => {\n  if ($("placeSheet").open) return;');
 html=patch(html,"observer:session.observer}),renderState:","observer:session.observer,candidateOpportunity:session.candidateOpportunity}),renderState:");
 html=patch(html,"skyPlayback.stop(false);\n  session.observer=aimSavedFrom","skyPlayback.stop(false);\n  session.candidateOpportunity={id:candidate.id,relation:candidate.event.relation,at:candidate.event.at,targetId:session.target?.id};\n  session.observer=aimSavedFrom");
 html=html.replace(/connect-src ([^;]+)/,(_,orig)=>'connect-src '+orig+' https://api.openstreetmap.org');
 html=patch(html,html.match(/<script src="astronotes-explore\.js\?v=\d+"><\/script>/)?.[0]||'missing-explore-script','<script src="astronotes-explore-simple.js?v=0"></script>');
 html=patch(html,'host._bodyRadius = p.radius;','host._bodyRadius = p.radius; globalThis.AstroNotesTrialComposition?.redraw(host);');
 html=patch(html,'host._redrawLook = () => { if (host._lookSeq === seq) draw(cur); };','host._redrawLook = () => { if (host._lookSeq === seq) draw(cur); };\n host._trialCompositionView={spec,cv,W,H,k,win}; globalThis.AstroNotesTrialComposition?.bind(host,host._trialCompositionView);');
 html=overlapHtml(html);
 html=patch(html,'</body>','<script src="astronotes-candidate-search.js?v=0"></script>\n</body>');
 const versioned=versionAssets(html,name=>Object.hasOwn(files,name)?files[name]:readFileSync(new URL('../'+name,import.meta.url)));
 files['index.html']=hashCsp(versioned.html).html;files['app-version.txt']=versioned.id+'\n';
 const digest=v=>createHash('sha256').update(v).digest('hex');
 files['candidate-experiment.json']=JSON.stringify({name:'2026-11-05 全対象・全選択天体の撮影候補探索trial',productionHtmlSha256:digest(readFileSync(new URL('../index.html',import.meta.url))),visibilityCertified:false,productionAssetsSha256:Object.fromEntries(['astronotes-align.js','astronotes-shooting.js','astronotes-myplaces.js','astronotes-plan.js'].map(n=>[n,digest(readFileSync(new URL('../'+n,import.meta.url)))])),files:Object.fromEntries(Object.entries(files).map(([n,s])=>[n,digest(s)]))},null,2)+'\n';
}
process.stdout.write(JSON.stringify(files));
