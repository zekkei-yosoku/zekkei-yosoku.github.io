import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {checkArchitecture} from './tools/check-architecture.mjs';
const manifest=JSON.parse(readFileSync(new URL('./src/source-manifest.json',import.meta.url))),read=n=>readFileSync(new URL(n,import.meta.url),'utf8');
test('every source has an execution layer, all accessor bridges have owner/references/retirement, dependencies are acyclic',()=>{const result=checkArchitecture(manifest,read);assert(result.units>=64);assert.equal(result.bridges,0);assert.equal(result.wrappers,1);});
test('unknown source, new provider reference, new bridge and dependency cycle fail generation',()=>{
 const a=structuredClone(manifest);a.architecture.units.pop();assert.throws(()=>checkArchitecture(a,read),/Unclassified/);
 const pure='src/domain/scene/appearance.js';assert.throws(()=>checkArchitecture(manifest,n=>read(n)+(n===pure?'\nAstroNotesStorage.create();':'')),/Undeclared/);
 assert.throws(()=>checkArchitecture(manifest,n=>read(n)+(n===pure?'\nunknown.defineLegacy("unlisted",false);':'')),/Unregistered/);
 const x=structuredClone(manifest),u=x.architecture.units.find(u=>u.path===pure);u.requires.push('AstroNotesStorage');const st=x.architecture.units.find(u=>u.path==='src/ports/storage.js');st.requires.push('AstroNotesSceneAppearance');assert.throws(()=>checkArchitecture(x,n=>read(n)+(n===pure?'\nAstroNotesStorage;':n===st.path?'\nAstroNotesSceneAppearance;':'')),/cycle/);
});
test('domain and injected ports cannot silently acquire ambient browser state',()=>{for(const extra of ['document.body.remove();','window.alert(1);','localStorage.clear();','auth.token;'])assert.throws(()=>checkArchitecture(manifest,n=>read(n)+(n==='src/domain/scene/appearance.js'?'\n'+extra:'')),/Ambient/);});

test('custom global object bridges cannot appear without owner and lifetime classification',()=>{assert.throws(()=>checkArchitecture(manifest,n=>read(n)+(n==='src/app/navigation.js'?'\nglobalThis.newUndeclaredBridge();':'')),/Unclassified global/);});

test('factory modules evaluate in an isolated VM without accessing ambient browser services',async()=>{const vm=await import('node:vm');for(const unit of manifest.architecture.units.filter(u=>u.scope==='factory')){const scope={};for(const name of ['document','window','localStorage','sessionStorage','fetch','history','location'])Object.defineProperty(scope,name,{get(){throw Error('ambient '+name+' in '+unit.path)}});vm.runInNewContext(read(unit.path),scope,{timeout:1000});}});

test('bridge reader lists, wrapper definitions, ambient policy and external namespaces are enforced',()=>{
 const stale=structuredClone(manifest);stale.architecture.compatibility[0].readers=[];assert.throws(()=>checkArchitecture(stale,read),/Stale compatibility entry/);
 assert.throws(()=>checkArchitecture(manifest,n=>read(n)+(n==='src/app/navigation.js'?'\nfunction saveAuth(a,r){return authStorage.save(a,r);}':'')),/Unclassified adapter wrapper/);
 const policy=structuredClone(manifest);policy.architecture.units.find(u=>u.path==='src/domain/scene/appearance.js').forbiddenAmbient=[];assert.throws(()=>checkArchitecture(policy,read),/Missing mandatory ambient policy/);
 const clash=structuredClone(manifest);clash.architecture.units.find(u=>u.path==='src/domain/navigation/routes.js').provides=['AstroNotesRoutes'];assert.throws(()=>checkArchitecture(clash,read),/External namespace collision AstroNotesRoutes/);
 for(const extra of ['const x = `${auth}`;','const x = flag ? auth : null;'])assert.throws(()=>checkArchitecture(manifest,n=>read(n)+(n==='src/domain/scene/appearance.js'?'\n'+extra:'')),/Ambient dependency auth/);
});

test('actual factory assignments and forwarded aliases must match their registries',()=>{
 const path='src/domain/navigation/routes.js';assert.throws(()=>checkArchitecture(manifest,n=>n===path?read(n).replace('global.AstroNotesNavigationRoutes =','global.AstroNotesRoutes ='):read(n)),/Factory provider declaration mismatch/);
 assert.throws(()=>checkArchitecture(manifest,n=>read(n)+(n==='src/ui/scene/render.js'?'\nconst {AIM_LOOK_SKY}=AstroNotesSceneAppearance;':'')),/Unclassified adapter alias AIM_LOOK_SKY/);
 for(const extra of ['const unlistedAlias=AstroNotesSceneAppearance.aimLookSky;','const unlistedArrow=(x)=>AstroNotesSceneAppearance.aimLookSky(x);'])assert.throws(()=>checkArchitecture(manifest,n=>read(n)+(n==='src/ui/scene/render.js'?'\n'+extra:'')),/Unclassified adapter alias/);
});
