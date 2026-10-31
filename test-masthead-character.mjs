import {sourceHtml} from './tools/test-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=sourceHtml();
test('header keeps its home control and logo without the permanent character or view-switching code',()=>{
 const header=html.slice(html.indexOf('<div class="masthead">'),html.indexOf('id="backBar"'));
 assert.match(header,/id="homeLink"/);assert.match(header,/id="mastheadAstroMark"/);
 assert.doesNotMatch(html,/mastheadCharacter|renderMastheadCharacter|masthead-character/);
});
test('waiting characters and cached legacy artwork remain available',()=>{
 assert.match(html,/class="note-wait-character"/);assert.match(html,/function candidateWaitMarkup/);
 assert.match(html,/astronotes-note-computing-branded-v2\.png/);
 for(const pose of ['forecast','framing','map','records'])assert(fs.existsSync(new URL(`astronotes-header-${pose}-v1.png`,import.meta.url)));
});
