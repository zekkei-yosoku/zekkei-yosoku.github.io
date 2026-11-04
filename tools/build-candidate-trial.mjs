// Derive a trial-only Explore from the same source; production bytes are untouched.
import {readFileSync} from 'node:fs';
import {renderIndex} from './build-index.mjs';
import {versionAssets,hashCsp} from './release-html.mjs';
import {createHash} from 'node:crypto';
const patch=(s,from,to)=>{if(!s.includes(from))throw Error('Trial source boundary changed: '+from);return s.replace(from,to);};
const read=p=>{
 let s=readFileSync(p,'utf8');if(!p.endsWith('/features/explore/controller.js'))return s;
 s=patch(s," mode=next==='map'?'map':'scene';"," mode='scene';\n tabs.hidden=true;scene.setAttribute('aria-label','見え方');scene.removeAttribute('aria-labelledby');scene.tabIndex=-1;");
 s=patch(s,"if(on&&focus)tab.focus();","if(on&&focus)scene.focus({preventScroll:true});");
 s=patch(s,"const tab=mode==='map'?mapTab:sceneTab;tab.focus({preventScroll:true});tabs.style.scrollMarginTop=(layout.conditions.getBoundingClientRect().height+12)+'px';tabs.scrollIntoView({block:'start',behavior:'auto'});","scene.tabIndex=-1;scene.focus({preventScroll:true});scene.style.scrollMarginTop=(layout.conditions.getBoundingClientRect().height+12)+'px';scene.scrollIntoView({block:'start',behavior:'auto'});");
 return s;
};
const result=renderIndex({entry:'src/features/explore/entry.inc',read});
const files={
 'astronotes-explore-simple.js':result.html,
 'astronotes-candidate-search.js':readFileSync(new URL('../experiments/candidate-visibility/search.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../experiments/candidate-visibility/ui.js',import.meta.url),'utf8'),
 'data/candidate-sidewalks.json':readFileSync(new URL('../experiments/candidate-visibility/sidewalks.json',import.meta.url),'utf8')
};
if(process.argv.includes('--html')){
 let html=readFileSync(0,'utf8');
 html=patch(html,html.match(/<script src="astronotes-explore\.js\?v=\d+"><\/script>/)?.[0]||'missing-explore-script','<script src="astronotes-explore-simple.js?v=0"></script>');
 html=patch(html,'</body>','<script src="astronotes-candidate-search.js?v=0"></script>\n</body>');
 const versioned=versionAssets(html,name=>Object.hasOwn(files,name)?files[name]:readFileSync(new URL('../'+name,import.meta.url)));
 files['index.html']=hashCsp(versioned.html).html;files['app-version.txt']=versioned.id+'\n';
 const digest=v=>createHash('sha256').update(v).digest('hex');
 files['candidate-experiment.json']=JSON.stringify({name:'2026-11-04 見え方中心・撮影地点内の追加探索trial',productionHtmlSha256:digest(readFileSync(new URL('../index.html',import.meta.url))),visibilityCertified:false,files:Object.fromEntries(Object.entries(files).map(([n,s])=>[n,digest(s)]))},null,2)+'\n';
}
process.stdout.write(JSON.stringify(files));
