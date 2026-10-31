// Test harness only. Tests that exercise app code read the assembled source here, so they do not depend on how the
// delivery HTML is packaged (versions, CSP, script format). Tests about the delivery itself keep reading index.html.
import {renderIndex} from './build-index.mjs';
let cached;
export function sourceHtml(){return cached??=renderIndex().html;}
