import {sourceHtml} from './tools/test-source.mjs';
// Negative invariants must cover the actual delivered dependency graph, not just inline HTML.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const html=sourceHtml();
const scripts=[...html.matchAll(/<script\b[^>]*src="([^"?]+)(?:\?[^\"]*)?"/g)].map(m=>m[1]);
const delivered=html+'\n'+scripts.map(name=>{assert(!/^[a-z]+:|^\/\//i.test(name));return readFileSync(new URL(name,import.meta.url),'utf8');}).join('\n');
test('no client-side user grants table or removed independent sky screen is hidden in an extracted asset',()=>{
 for(const forbidden of ['TOOLS_FOR','ALWAYS_TOOLS','RESTRICTED_TOOL_LABELS','function renderPhenomenonCards','id="skyView"','data-tool="#/sky"'])assert(!delivered.includes(forbidden),forbidden);
 assert(!/script-src[^;]*unsafe-eval/.test(html));assert(!/script-src[^;]*unsafe-inline/.test(html));
});
test('old cached HTML needs no new script: factory and view share the existing synchronous asset',()=>{
 assert(!scripts.includes('astronotes-planning-session.js'));
 const explore=readFileSync(new URL('./astronotes-explore.js',import.meta.url),'utf8');
 assert(explore.indexOf('global.AstroNotesPlanningSession = api')<explore.indexOf('const plan=AstroNotesPlanningSession.create('));
 assert(!/<script[^>]*(?:\basync|\bdefer|type="module")[^>]*src="astronotes-explore/.test(html));
 assert.equal(scripts.filter(x=>x==='astronotes-explore.js').length,1);
});
