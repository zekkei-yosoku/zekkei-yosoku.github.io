// Test harness only. Tests that exercise app code read the assembled source here, so they do not depend on how the
// delivery HTML is packaged (versions, CSP, script format). Tests about the delivery itself keep reading index.html.
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {renderIndex} from './build-index.mjs';
import {stripModuleSyntax} from './source-modules.mjs';
const {parse}=createRequire(import.meta.url)('./module-scan.cjs');
let cached;
export function sourceHtml(){return cached??=renderIndex().html;}
/// One source unit as delivery sees it, without its import/export lines. Use for tests that execute a unit directly.
export function sourceUnit(path){return stripModuleSyntax(readFileSync(new URL('../'+path.replace(/^\.\//,''),import.meta.url),'utf8'));}
/// A top-level declaration by name, wherever its unit lives. Survives reordering and neighbouring edits, unlike text markers.
const declarations=new Map();
export function sourceDeclaration(name){
 if(!declarations.size){const manifest=JSON.parse(readFileSync(new URL('../src/source-manifest.json',import.meta.url),'utf8'));
  for(const {path,scope} of manifest.architecture.units){if(scope!=='classic-composition'||!path.endsWith('.js'))continue;const code=sourceUnit(path);
   for(const st of parse(code,'script').body){if(st.type==='FunctionDeclaration'||st.type==='ClassDeclaration')declarations.set(st.id.name,code.slice(st.start,st.end));
    else if(st.type==='VariableDeclaration')for(const d of st.declarations)if(d.id.type==='Identifier')declarations.set(d.id.name,code.slice(st.start,st.end));}}}
 if(!declarations.has(name))throw Error('Unknown top-level declaration '+name);return declarations.get(name);
}
