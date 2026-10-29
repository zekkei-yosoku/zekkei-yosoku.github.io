// Exact inline hashes; the same pure transform is used by generated-source --check.
import {readFileSync,writeFileSync} from 'node:fs';
import {hashCsp} from './tools/release-html.mjs';
const path=new URL('./index.html',import.meta.url),{html,hashes}=hashCsp(readFileSync(path,'utf8'));
writeFileSync(path,html);console.log(`CSP: ${hashes.length} exact inline scripts; no unsafe-inline/eval`);
