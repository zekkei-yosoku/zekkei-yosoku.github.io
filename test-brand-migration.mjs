import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
test('cached HTML legacy assets retain their original bytes and canonical assets exist in root and trial',()=>{
 const {sha256}=JSON.parse(read('legacy-assets.json'));
 const experiments=JSON.parse(read('trial/ui-experiment.json')).files;
 const allowed=new Set(['astronotes-explore.js','astronotes-myplaces.js','astronotes-plan.js','astronotes-camera-ui.js','astronotes-flair.css']);
 const digest=value=>createHash('sha256').update(value).digest('hex');
 for(const [old,hash] of Object.entries(sha256)){
  const name=old.replace(/^sorami-/,'astronotes-');
  for(const prefix of ['','trial/'])assert.equal(createHash('sha256').update(readFileSync(new URL(prefix+old,import.meta.url))).digest('hex'),hash,prefix+old);
  if(experiments[name]){assert.equal(digest(read(name)),experiments[name].root,name+' base');assert.equal(digest(read('trial/'+name)),experiments[name].trial,name+' trial');}
  else assert.equal(read(name),read('trial/'+name),name);
 }
 for(const name of Object.keys(experiments)){assert.ok(allowed.has(name),name+' is approved for this trial');assert.ok(sha256[name.replace(/^astronotes-/,'sorami-')]||name==='astronotes-camera-ui.js',name+' is a canonical legacy successor or the approved camera trial');assert.equal(digest(read(name)),experiments[name].root,name+' base');assert.equal(digest(read('trial/'+name)),experiments[name].trial,name+' trial');}
 const experiment=JSON.parse(read('trial/ui-experiment.json'));if(experiment.rootHtmlSha256){assert.equal(digest(read('index.html')),experiment.rootHtmlSha256);assert.equal(digest(read('trial/index.html')),experiment.trialHtmlSha256);}
 const trialOnly=experiment.trialOnlyFiles||{};for(const [name,hash]of Object.entries(trialOnly)){assert.ok(['astronotes-journey.js','astronotes-shape-planner.js','sky-rating.html','sky-rating.css','sky-rating.js','sky-rating-theme.js','data/sky-rating-v1/catalog.json',...Array.from({length:18},(_,i)=>`data/sky-rating-v1/sky-${String(i+1).padStart(2,'0')}.jpg`)].includes(name),'only reviewed independent trial assets may be trial-only');assert.equal(existsSync(new URL(name,import.meta.url)),false,'trial-only module is not promoted');assert.equal(createHash('sha256').update(readFileSync(new URL('trial/'+name,import.meta.url))).digest('hex'),hash,name+' trial-only bytes');}
 const html=read('index.html');assert.doesNotMatch(html,/(?:src|href)="sorami-[^"]+\.(?:js|css)/);
});
test('canonical globals publish legacy aliases with the same value',()=>{
 for(const [name,current,legacy] of [['core','AstroNotes','Sorami'],['astro','AstroNotesAstro','SoramiAstro'],['library','AstroNotesLibrary','SoramiLibrary']]){
  const api=require('./astronotes-'+name+'.js');assert.equal(globalThis[current],api);assert.equal(globalThis[legacy],api);
 }
});
test('brand migration retains existing persistence and protocol identifiers',()=>{
 const {sha256}=JSON.parse(read('legacy-assets.json'));
 const identifiers=s=>[...s.matchAll(/["'`](sorami[.:][A-Za-z0-9_.:-]*|sorami-(?:open-meteo|dem|predictions)[A-Za-z0-9_.:-]*|x-sorami-[A-Za-z0-9-]+)["'`]/g)].map(m=>m[1]).sort();
 for(const old of Object.keys(sha256).filter(n=>n.endsWith('.js')))assert.deepEqual(identifiers(read(old.replace(/^sorami-/,'astronotes-'))),identifiers(read(old)),old);
});
