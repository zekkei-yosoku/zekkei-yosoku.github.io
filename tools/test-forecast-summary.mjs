import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {renderIndex,checkClassicScripts} from './build-index.mjs';
import {forecastSummaryHtml} from './build-forecast-summary.mjs';

test('trial transformation preserves production source and existing comparison/navigation contracts',()=>{
 const production=renderIndex().html,trial=forecastSummaryHtml(production);
 assert(!production.includes('let forecastSummary ='));
 assert(trial.includes('let forecastSummary = null;'));
 assert(trial.includes('function render() {\n  forecastSummary ||='),'the owner is initialized only on rendering');
 assert(trial.includes('Math.round(ev.score)'));
 assert(trial.includes('renderBestNote(best, now)'));
 assert(trial.includes('pick(id, now, +d)'));
 assert(trial.includes('forecastSummary.select(id, +dayMs)'));
 assert(trial.includes('forecastSummary.capture()')&&trial.includes('forecastSummary.restore()'));
 assert.equal((trial.match(/function renderMatrix\(/g)||[]).length,1);
 assert.equal((trial.match(/function renderTwilight\(/g)||[]).length,1);
 checkClassicScripts(trial,name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'));
});

test('changed or duplicated generator boundaries stop before producing a partial trial',()=>{
 const source=renderIndex().html;
 assert.throws(()=>forecastSummaryHtml(source.replace('let currentView = "list";','let currentView = null;')),/boundary changed/);
 assert.throws(()=>forecastSummaryHtml(source+'\nlet currentView = "list";'),/boundary changed/);
});

test('constructing the list owner does not read DOM, predictions, storage, or navigate',()=>{
 const create=vm.runInNewContext(readFileSync(new URL('../experiments/forecast-summary/controller.js',import.meta.url),'utf8'));
 const forbidden=()=>{throw Error('constructor performed a side effect');};
 const owner=create({document:new Proxy({},{get:forbidden}),host:forbidden,context:forbidden,presentation:new Proxy({},{get:forbidden}),openDetail:forbidden,announce:forbidden});
 assert.deepEqual(Object.keys(owner),['capture','restore','select','waiting']);
});
