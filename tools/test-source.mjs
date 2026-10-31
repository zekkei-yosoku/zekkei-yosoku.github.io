// Test harness only. Tests that exercise app code read the assembled source here, so they do not depend on how the
// delivery HTML is packaged (versions, CSP, script format). Tests about the delivery itself keep reading index.html.
import {readFileSync} from 'node:fs';
import {renderIndex} from './build-index.mjs';
import {stripModuleSyntax} from './source-modules.mjs';
let cached;
export function sourceHtml(){return cached??=renderIndex().html;}
/// One source unit as delivery sees it, without its import/export lines. Use for tests that execute a unit directly.
export function sourceUnit(path){return stripModuleSyntax(readFileSync(new URL('../'+path.replace(/^\.\//,''),import.meta.url),'utf8'));}
