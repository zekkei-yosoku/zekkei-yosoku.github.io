// CSP hashes must be regenerated after any inline script edit, before publishing.
import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const path=new URL('./index.html',import.meta.url);let html=readFileSync(path,'utf8');
const hashes=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(([,attrs,body])=>! /\bsrc\s*=/.test(attrs)&&body.trim()).map(([,attrs,body])=>`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
if(!hashes.length)throw Error('No inline script hashes found');
html=html.replace(/script-src[^;]+;/,`script-src 'self' blob: ${hashes.join(' ')};`);writeFileSync(path,html);console.log(`CSP: ${hashes.length} exact inline scripts; no unsafe-inline/eval`);
