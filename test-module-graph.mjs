import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {checkModuleGraph} from './tools/check-module-graph.mjs';import {stripModuleSyntax} from './tools/source-modules.mjs';
const manifest=JSON.parse(readFileSync(new URL('./src/source-manifest.json',import.meta.url)));
const read=n=>readFileSync(new URL(n,import.meta.url),'utf8');
const unit='src/features/account/status.js';
const withUnit=(edit,path=unit)=>n=>n===path?edit(read(n)):read(n);
test('source units match their declared imports and exports',()=>{assert.ok(checkModuleGraph(manifest,read).imports>0);});
test('a dependency without an import is rejected',()=>{assert.throws(()=>checkModuleGraph(manifest,withUnit(s=>s.replace(/^import \{\$\} from [^\n]*\n/m,''))),/Undeclared dependency \$/);});
test('an unused import is rejected',()=>{assert.throws(()=>checkModuleGraph(manifest,withUnit(s=>s.replace(/^import \{\$\} from /m,"import {esc,$} from "))),/esc/);});
test('a misspelled name is rejected as a new ambient name',()=>{assert.throws(()=>checkModuleGraph(manifest,withUnit(s=>s+'\nfunction broken(){return renderAuthButon();}\n')),/Ambient names changed: renderAuthButon/);});
test('a new write to another unit\'s variable is rejected',()=>{assert.throws(()=>checkModuleGraph(manifest,withUnit(s=>s+'\nfunction broken(){$=null;}\n')),/Cross-unit writes changed.*\$ in src\/features\/account\/status\.js/);});
test('a local variable that shadows a shared name is not a dependency',()=>{assert.ok(checkModuleGraph(manifest,withUnit(s=>s+'\nfunction fine(){const place=1;return place;}\n')));});
test('assembly removes exactly the import and export lines',()=>{
 for(const body of ['const a=1;\n','const a=1;','\n']){for(const tail of body.endsWith('\n')?['export {a};\n']:['\nexport {a};'])assert.equal(stripModuleSyntax("import {b} from './b.js';\nimport {c} from './c.js';\n"+body+tail),body);}
 const inside="const t=`\nexport {a};\nimport {b} from './b.js';\n`;\nconst u=1;\n";assert.equal(stripModuleSyntax(inside),inside);
});
