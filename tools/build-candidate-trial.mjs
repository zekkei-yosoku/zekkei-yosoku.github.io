// Derive a trial-only Explore from the same source; production bytes are untouched.
import {readFileSync} from 'node:fs';
import {renderIndex} from './build-index.mjs';
import {versionAssets,hashCsp} from './release-html.mjs';
import {createHash} from 'node:crypto';
const patch=(s,from,to)=>{if(!s.includes(from))throw Error('Trial source boundary changed: '+from);return s.replace(from,to);};
const read=p=>{
 let s=readFileSync(p,'utf8');if(!p.endsWith('/features/explore/controller.js'))return s;
 s=patch(s,"(s?.target?' · '+alignment:'')","(s?.target?' · '+(globalThis.AstroNotesTrialComposition?.label?.(s)||alignment):'')");
 s=patch(s,"globalThis.TrialExplore={active,","document.addEventListener('astronotes-composition-change',updateConditions);\nglobalThis.TrialExplore={active,");
 s=patch(s," mode=next==='map'?'map':'scene';"," mode='scene';\n tabs.hidden=true;scene.setAttribute('aria-label','見え方');scene.removeAttribute('aria-labelledby');scene.tabIndex=-1;");
 s=patch(s,"if(on&&focus)tab.focus();","if(on&&focus)scene.focus({preventScroll:true});");
 s=patch(s,"const tab=mode==='map'?mapTab:sceneTab;tab.focus({preventScroll:true});tabs.style.scrollMarginTop=(layout.conditions.getBoundingClientRect().height+12)+'px';tabs.scrollIntoView({block:'start',behavior:'auto'});","scene.tabIndex=-1;scene.focus({preventScroll:true});scene.style.scrollMarginTop=(layout.conditions.getBoundingClientRect().height+12)+'px';scene.scrollIntoView({block:'start',behavior:'auto'});");
 return s;
};
const result=renderIndex({entry:'src/features/explore/entry.inc',read});
const trialShooting=patch(patch(readFileSync('astronotes-shooting.js','utf8'),'event:e,shapeType:s.type','event:e,assumedObserver:obs,shapeType:s.type'),'record:entry.record,event:e});','record:entry.record,event:e,assumedObserver:obs});');
const trialMyplaces=patch(patch(readFileSync('astronotes-myplaces.js','utf8'),'${result.rows.length}件','${result.rows.length}件（絞り込み前）'),'box.append(button);}'+'\n  if(result.failed)', 'box.append(button);}'+'\n  globalThis.AstroNotesCandidatePicker?.registerRegistered(box,result.rows,plan,current);\n  if(result.failed)');
const files={
 'astronotes-shooting.js':trialShooting,
 'astronotes-myplaces.js':trialMyplaces,
 'astronotes-explore-simple.js':result.html,
 'astronotes-candidate-search.js':readFileSync(new URL('../experiments/candidate-visibility/building-model.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/terrain-model.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/scene-hulls.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/scene-surface.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/composition.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/model-evaluator.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/search.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/composition-ui.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/place-labels.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/candidate-picker.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/ui.js',import.meta.url),'utf8'),
 'data/candidate-terrain.json':readFileSync(new URL('../experiments/candidate-visibility/terrain.json',import.meta.url),'utf8'),
 'data/candidate-buildings.json':readFileSync(new URL('../experiments/candidate-visibility/model-buildings.json',import.meta.url),'utf8'),
 'data/candidate-surfaces.json':readFileSync(new URL('../experiments/candidate-visibility/surface-samples.json',import.meta.url),'utf8'),
 'data/candidate-sidewalks.json':readFileSync(new URL('../experiments/candidate-visibility/sidewalks.json',import.meta.url),'utf8'),
 'data/candidate-label-addresses.json':readFileSync(new URL('../experiments/candidate-visibility/label-addresses.json',import.meta.url),'utf8'),
 'data/candidate-label-facilities.json':readFileSync(new URL('../experiments/candidate-visibility/label-facilities.json',import.meta.url),'utf8')
};
files['astronotes-candidate-search.js']=patch(files['astronotes-candidate-search.js'],'/* BUILD_DATA_HASHES */{}',JSON.stringify(Object.fromEntries(Object.entries(files).filter(([n])=>n.startsWith('data/')).map(([n,s])=>[n.slice(5),createHash('sha256').update(s).digest('hex')]))));
files['astronotes-candidate-search.js']+='\n// data-release '+createHash('sha256').update(Object.entries(files).filter(([name])=>name.startsWith('data/')).map(([,value])=>value).join('')).digest('hex')+'\n';
if(process.argv.includes('--html')){
 let html=readFileSync(0,'utf8');
 html=patch(html,html.match(/<script src="astronotes-explore\.js\?v=\d+"><\/script>/)?.[0]||'missing-explore-script','<script src="astronotes-explore-simple.js?v=0"></script>');
 html=patch(html,'host._bodyRadius = p.radius;','host._bodyRadius = p.radius; globalThis.AstroNotesTrialComposition?.redraw(host);');
 html=patch(html,'host._redrawLook = () => { if (host._lookSeq === seq) draw(cur); };','host._redrawLook = () => { if (host._lookSeq === seq) draw(cur); };\n host._trialCompositionView={spec,cv,W,H,k,win}; globalThis.AstroNotesTrialComposition?.bind(host,host._trialCompositionView);');
 html=patch(html,'</body>','<script src="astronotes-candidate-search.js?v=0"></script>\n</body>');
 const versioned=versionAssets(html,name=>Object.hasOwn(files,name)?files[name]:readFileSync(new URL('../'+name,import.meta.url)));
 files['index.html']=hashCsp(versioned.html).html;files['app-version.txt']=versioned.id+'\n';
 const digest=v=>createHash('sha256').update(v).digest('hex');
 files['candidate-experiment.json']=JSON.stringify({name:'2026-11-04 見え方中心・撮影地点内の追加探索trial',productionHtmlSha256:digest(readFileSync(new URL('../index.html',import.meta.url))),visibilityCertified:false,productionAssetsSha256:Object.fromEntries(['astronotes-shooting.js','astronotes-myplaces.js'].map(n=>[n,digest(readFileSync(new URL('../'+n,import.meta.url)))])),files:Object.fromEntries(Object.entries(files).map(([n,s])=>[n,digest(s)]))},null,2)+'\n';
}
process.stdout.write(JSON.stringify(files));
