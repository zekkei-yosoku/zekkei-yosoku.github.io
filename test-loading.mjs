import {createRequire as __req} from 'node:module';const __L=__req(import.meta.url)('./astronotes-library.js'),__gate=(n=0)=>{const g=__L.gate();while(n-->0)g.cancel();return g;};
import {sourceHtml,sourceDeclaration} from './tools/test-source.mjs';
import {releaseProducts} from './tools/build-index.mjs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import './tools/test-owner-adapter.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFileSync,writeFileSync,mkdtempSync,cpSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url),{createLoader}=require('./astronotes-assets.js');
function fixture(){const nodes=[],timers=new Map(),loaded=new Set();let n=0;const loader=createLoader({manifest:{'astronotes-city-models.js':'astronotes-city-models.js?v=1'},ready:k=>loaded.has(k),document:{createElement:()=>({remove(){this.removed=true;}}),head:{append:x=>nodes.push(x)}},setTimer:fn=>{timers.set(++n,fn);return n;},clearTimer:id=>timers.delete(id)});return {loader,nodes,timers,loaded};}
test('shape requests share in-flight work and reuse successful data',async()=>{const f=fixture(),a=f.loader.load('astronotes-city-models.js'),b=f.loader.load('astronotes-city-models.js');assert.equal(a,b);assert.equal(f.nodes.length,1);f.loaded.add('astronotes-city-models.js');f.nodes[0].onload();await a;await f.loader.load('astronotes-city-models.js');assert.equal(f.nodes.length,1);assert.equal(f.timers.size,0);});
test('network failure, missing globals and timeout can all be retried',async()=>{for(const kind of ['network','missing','timeout']){const f=fixture(),a=f.loader.load('astronotes-city-models.js'),rejected=assert.rejects(a);if(kind==='network')f.nodes[0].onerror();else if(kind==='missing')f.nodes[0].onload();else [...f.timers.values()][0]();await rejected;assert.ok(f.nodes[0].removed);const retry=f.loader.load('astronotes-city-models.js');assert.equal(f.nodes.length,2);f.loaded.add('astronotes-city-models.js');f.nodes[1].onload();await retry;}await assert.rejects(fixture().loader.load('https://attacker.test/a.js'));});

function assetWorld({legacy=false,beforeLoad,source='./astronotes-assets.js'}={}){
 const nodes=[],timers=new Map();let id=0;
 const meta={'shape-city':'astronotes-city-models.js?v=11','shape-tower':'astronotes-tower-models.js?v=22',...(!legacy?{'shape-surface':'astronotes-scene-hulls.js?v=33','shape-surface-integrity':'sha256-fixture'}:{})};
 const c=vm.createContext({document:{querySelector:selector=>{const value=meta[selector.match(/name="([^"]+)"/)[1]];return value?{content:value}:null;},createElement:()=>({remove(){this.removed=true;}}),head:{append:node=>nodes.push(node)}},setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:key=>timers.delete(key)});
 beforeLoad?.(c);
 const loadSource=()=>vm.runInContext(readFileSync(new URL(source,import.meta.url),'utf8'),c);loadSource();
 return {c,nodes,timers,api:c.AstroNotesAssets,loadSource};
}
test('surface data is lazy, shares one flight, and modelsReady waits for all three assets',async()=>{
 const f=assetWorld();assert.equal(f.nodes.length,0);assert.equal(f.api.modelsReady(),false);
 const one=f.api.ensureModels(),two=f.api.ensureModels();assert.equal(f.nodes.length,3);
 const surface=f.nodes.find(n=>n.src.startsWith('astronotes-scene-hulls.js'));assert.equal(surface.integrity,'sha256-fixture');assert.equal(surface.crossOrigin,'anonymous');
 f.c.AstroNotesCityModels={};f.c.AstroNotesTowerModels={};for(const n of f.nodes.filter(n=>n!==surface))n.onload();
 assert.equal(f.api.modelsReady(),false);f.c.AstroNotesTrialSurfaceHulls={};surface.onload();await Promise.all([one,two]);
 assert.equal(f.api.modelsReady(),true);await f.api.ensureModels();assert.equal(f.nodes.length,3);assert.equal(f.timers.size,0);
});
test('trial delayed city catalogue loads alongside and preserves saved target shapes',async()=>{
 const saved={'fav:custom':{id:'saved-catalogue'}},f=assetWorld({
  source:'./experiments/moon-map/astronotes-assets.js',
  beforeLoad:c=>{c.AstroNotesCityModels=saved;c.AstroNotesTowerModels={};c.AstroNotesTrialSurfaceHulls={};}
 });
 assert.equal(f.api.modelsReady(),false);
 const first=f.api.ensureModels(),second=f.api.ensureModels();
 assert.equal(f.nodes.length,1);
 assert.match(f.nodes[0].src,/astronotes-city-models\.js/);
 const available={shibuya:{id:'bundled-catalogue'}};
 saved['fav:added-while-loading']={id:'late-shape'};
 f.c.AstroNotesCityModels=available;
 f.nodes[0].onload();await Promise.all([first,second]);
 assert.equal(f.api.modelsReady(),true);
 assert.equal(available['fav:custom'],saved['fav:custom']);
 assert.equal(available['fav:added-while-loading'],saved['fav:added-while-loading']);
 await f.api.ensureModels();assert.equal(f.nodes.length,1);
});
test('trial reuses identical GSI vector bytes for water and buildings and retries failed tiles',async()=>{
 const source=readFileSync(new URL('./experiments/moon-map/src/features/candidates/ui.js',import.meta.url),'utf8');
 const start=source.indexOf('function candidateVectorReader('),end=source.indexOf('const candidateFetch=',start);
 const create=vm.runInNewContext(source.slice(start,end)+'\ncandidateVectorReader',{Response});
 const base='https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/16/';
 const tile=base+'1/2.pbf',ocean=base+'1/3.pbf',temporary=base+'1/4.pbf',noStore=base+'1/5.pbf';
 const requests=[];
 const reader=create(async url=>{
  requests.push(url);
  if(url===temporary&&requests.filter(u=>u===url).length===1)return new Response(null,{status:503});
  if(url===ocean)return new Response(null,{status:404});
  return new Response(Uint8Array.of(5,7,9),{headers:url===noStore?{'Cache-Control':'no-store'}:{}});
 },{maxTiles:2,maxBytes:4});
 const first=new Uint8Array(await (await reader(tile)).arrayBuffer());first[0]=99;
 assert.deepEqual([...new Uint8Array(await (await reader(tile)).arrayBuffer())],[5,7,9]);
 assert.deepEqual(requests,[tile]);
 const controller=new AbortController();controller.abort();
 await assert.rejects(()=>reader(tile,{signal:controller.signal}),{name:'AbortError'});
 assert.deepEqual(requests,[tile]);
 assert.equal((await reader(ocean)).status,404);assert.equal((await reader(ocean)).status,404);
 assert.equal((await reader(temporary)).status,503);assert.equal((await reader(temporary)).status,200);
 await reader(tile);assert.deepEqual(requests,[tile,ocean,temporary,temporary,tile]);
 await reader(noStore);await reader(noStore);assert.equal(requests.filter(u=>u===noStore).length,2);
});
test('new loader works with cached HTML without surface meta and retries a missing surface',async()=>{
 const f=assetWorld({legacy:true});f.c.AstroNotesCityModels={};f.c.AstroNotesTowerModels={};
 const first=f.api.ensureModels(),rejected=assert.rejects(first,/missing/);assert.equal(f.nodes.length,1);
 assert.equal(f.nodes[0].src,'astronotes-scene-hulls.js?v=11');assert.equal(f.nodes[0].integrity,undefined);
 f.nodes[0].onload();await rejected;assert.equal(f.api.modelsReady(),false);
 const next=f.api.ensureModels();assert.equal(f.nodes.length,2);f.c.AstroNotesTrialSurfaceHulls={};f.nodes[1].onload();await next;assert.equal(f.api.modelsReady(),true);
});
test('candidate compatibility keeps the current loader API and pending requests',async()=>{
 const f=assetWorld(),api=f.api,first=api.ensureModels();f.loadSource();
 assert.equal(f.c.AstroNotesAssets,api);assert.equal(f.c.SoramiAssets,api);
 const second=f.c.AstroNotesAssets.ensureModels();assert.equal(f.nodes.length,3,'reintroducing the canonical loader does not start duplicate requests');
 f.c.AstroNotesCityModels={};f.c.AstroNotesTowerModels={};f.c.AstroNotesTrialSurfaceHulls={};
 for(const n of f.nodes)n.onload();await Promise.all([first,second]);assert.equal(api.modelsReady(),true);
});
test('candidate compatibility shares legacy city/tower work, retries its failure, and adds only surface',async()=>{
 let requests=0,pending=null,finish,fail;
 const legacy={ensureModels(){if(!pending){requests++;pending=new Promise((resolve,reject)=>{finish=resolve;fail=reject;}).finally(()=>pending=null);}return pending;},modelsReady:()=>true};
 const oldFlight=legacy.ensureModels(),oldRejected=assert.rejects(oldFlight,/old loader offline/);
 const f=assetWorld({legacy:true,beforeLoad:c=>c.AstroNotesAssets=legacy});
 const current=f.api.ensureModels(),rejected=assert.rejects(current,/old loader offline/);
 assert.equal(requests,1);assert.equal(f.nodes.length,1);assert.equal(f.nodes[0].src,'astronotes-scene-hulls.js?v=11');assert.equal(f.api.modelsReady(),false);
 f.c.AstroNotesTrialSurfaceHulls={};f.nodes[0].onload();fail(Error('old loader offline'));await Promise.all([oldRejected,rejected]);
 const retry=f.api.ensureModels(),joined=f.api.ensureModels();assert.equal(requests,2);assert.equal(f.nodes.length,1,'surface success survives a legacy city/tower failure');
 f.c.AstroNotesCityModels={};f.c.AstroNotesTowerModels={};finish();await Promise.all([retry,joined]);assert.equal(f.api.modelsReady(),true);
});
test('a cached candidate with embedded hulls needs no extra surface request, and Node needs no document',async()=>{
 const f=assetWorld({beforeLoad:c=>c.AstroNotesTrialSurfaceHulls={}}),pending=f.api.ensureModels();
 assert.equal(f.nodes.length,2);assert.ok(f.nodes.every(n=>!n.src.includes('scene-hulls')));
 f.c.AstroNotesCityModels={};f.c.AstroNotesTowerModels={};for(const n of f.nodes)n.onload();await pending;assert.equal(f.api.modelsReady(),true);
 const c=vm.createContext({module:{exports:{}}});vm.runInContext(readFileSync(new URL('./astronotes-assets.js',import.meta.url),'utf8'),c);
 assert.equal(c.module.exports,c.AstroNotesAssets);assert.equal(c.AstroNotesAssets.modelsReady(),false);
});
test('surface delivery preserves exact source data and removes it from startup scripts',()=>{
 const {products}=releaseProducts(),surface=products.get('astronotes-scene-hulls.js'),candidate=products.get('astronotes-candidate-search.js'),html=products.get('index.html');
 assert.equal(surface,readFileSync(new URL('./src/features/candidates/scene-hulls.js',import.meta.url),'utf8'));
 assert.ok(candidate.startsWith(readFileSync(new URL('./astronotes-assets.js',import.meta.url),'utf8')+'\n'),'compatibility loader is generated from its canonical source');
 assert.ok(candidate.length<600000,'candidate bundle no longer embeds roughly 1 MB of triangle data');
 assert.doesNotMatch(candidate,/g\.AstroNotesTrialSurfaceHulls=d/);
 assert.doesNotMatch(html,/<(?:script|link)\b[^>]+(?:src|href)="astronotes-scene-hulls\.js/,'surface is neither a startup script nor preloaded');
 const digest=createHash('sha256').update(surface).digest('base64');assert.ok(html.includes('name="shape-surface-integrity" content="sha256-'+digest+'"'));
 const version=BigInt('0x'+createHash('sha256').update(surface).digest('hex').slice(0,16)).toString();assert.ok(html.includes('name="shape-surface" content="astronotes-scene-hulls.js?v='+version+'"'));
});
test('unchanged assets retain ids across UI-only releases; changed data changes only its id',()=>{const root=new URL('./',import.meta.url),dir=mkdtempSync(join(tmpdir(),'astro-assets-'));let html=readFileSync(new URL('index.html',root),'utf8');for(const [,name]of html.matchAll(/([A-Za-z0-9_-]+\.(?:js|css))\?v=\d+/g))cpSync(new URL(name,root),join(dir,name));cpSync(new URL('update-assets.mjs',root),join(dir,'update-assets.mjs'));cpSync(new URL('tools/release-html.mjs',root),join(dir,'tools/release-html.mjs')); // copy the versioner dependency; assertions are unchanged
writeFileSync(join(dir,'index.html'),html);const run=()=>execFileSync(process.execPath,[join(dir,'update-assets.mjs')]);run();const one=readFileSync(join(dir,'index.html'),'utf8');run();assert.equal(readFileSync(join(dir,'index.html'),'utf8'),one);writeFileSync(join(dir,'index.html'),one.replace('</title>',' UI</title>'));run();const two=readFileSync(join(dir,'index.html'),'utf8');const id=s=>s.match(/name="app-version" content="(\d+)"/)[1];assert.notEqual(id(one),id(two));const versions=s=>[...s.matchAll(/([A-Za-z0-9_-]+\.(?:js|css)\?v=\d+)/g)].map(x=>x[1]);assert.deepEqual(versions(one),versions(two));writeFileSync(join(dir,'astronotes-city-models.js'),readFileSync(join(dir,'astronotes-city-models.js'),'utf8')+'\n');run();const three=readFileSync(join(dir,'index.html'),'utf8');assert.notEqual(two.match(/astronotes-city-models\.(?:js|css)\?v=\d+/)[0],three.match(/astronotes-city-models\.(?:js|css)\?v=\d+/)[0]);assert.equal(two.match(/astronotes-core\.(?:js|css)\?v=\d+/)[0],three.match(/astronotes-core\.(?:js|css)\?v=\d+/)[0]);writeFileSync(join(dir,'astronotes-datetime-ui.css'),readFileSync(join(dir,'astronotes-datetime-ui.css'),'utf8')+'\n');run();const four=readFileSync(join(dir,'index.html'),'utf8');assert.notEqual(three.match(/astronotes-datetime-ui\.css\?v=\d+/)[0],four.match(/astronotes-datetime-ui\.css\?v=\d+/)[0]);assert.equal(three.match(/astronotes-core\.js\?v=\d+/)[0],four.match(/astronotes-core\.js\?v=\d+/)[0]);});

test('validated access opens before sync; late sync refreshes favorites without a launch preset',async()=>{
 const vm=await import('node:vm'),html=sourceHtml(),start=html.indexOf('async function restoreSession('),end=html.indexOf('/// ログインできたとき',start);let release,access=0,targets=0;const opened=[];
 const c=vm.createContext({AstroNotesLibrary:__L,storedAuth:()=>({auth:{token:'test',loginId:'test-user'},remembered:false}),AbortController,setTimeout,clearTimeout,authGeneration:0,auth:null,lastLoginId:null,renderAuthButton(){},apiCall:async()=>({loginId:'test-user',tools:['tower']}),saveAuth(){},syncNow:()=>new Promise(r=>release=r),atAim:true,openAim:p=>opened.push(p),render(){},SkyMapUI:{refreshTargets:()=>targets++}});
 vm.runInContext(html.slice(start,end),c);const pending=c.restoreSession({onAccessReady:()=>access++});await new Promise(setImmediate);assert.equal(access,1);assert.deepEqual(opened,[null]);assert.equal(targets,0);release();await pending;assert.deepEqual(opened,[null,null]);assert.equal(targets,1);
});

test('forecast requests are demand-driven, shared, and discarded after an unseen place change',async()=>{
 const vm=await import('node:vm'),html=sourceHtml(),start=html.indexOf('let predictionDirty = true'),end=html.indexOf('// アメダス実況',start),calls=[];let route={skymap:true};const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,textContent:'',innerHTML:''});return nodes.get(id);};
 const c=vm.createContext({AstroNotesLibrary:__L,console,Date,JSON,place:{latitude:1,longitude:2},routeFromHash:()=>route,forecastSummary:null,extraSeq:__gate(),extrasRetry:{reset(){}},bundle:null,weeks:{},forecastDays:[],predictionPlace:null,predictionLoadSeq:0,S:{MODELS:[],setTimezoneOffset(){}},AstroNotesPrediction:{fetch:p=>new Promise(resolve=>calls.push({p,resolve}))},$:node,renderSkeleton:()=>'',keepRounds(){},applyRoute(){},ensureNowcast(){},navigator:{onLine:true}});
 vm.runInContext(sourceDeclaration('createForecastRetry')+'\n'+html.slice(start,end),c);await c.load(false);assert.equal(calls.length,0);route=null;const first=c.load(false);await c.load(false);assert.equal(calls.length,1);route={skymap:true};c.place={latitude:3,longitude:4};await c.load(true);calls[0].resolve({bundle:{utcOffsetSeconds:0},place:calls[0].p,weeks:{}});await first;assert.equal(c.bundle,null,'late result cannot relabel another location');route=null;const next=c.load(false);assert.equal(calls.length,2);calls[1].resolve({bundle:{utcOffsetSeconds:0},place:calls[1].p,weeks:{}});await next;assert.equal(c.predictionPlace.latitude,3);
});
