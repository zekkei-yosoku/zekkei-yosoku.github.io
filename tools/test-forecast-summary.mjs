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
 assert(production.includes('const best = pickHighlight(weeks, now);'),'production recommendations remain unchanged');
 assert.equal((trial.match(/id !== "rainbow"/g)||[]).length,3,'trial filters only recommendation, matrix, and loading skeleton');
 assert.equal((trial.match(/id !== "capCloud"/g)||[]).length,3,'capCloud conditions replace an ordinary row without filtering the accepted forecast');
 assert.equal((trial.match(/function renderCapLine\(/g)||[]).length,1,'the existing Fuji supplement renderer is replaced, not duplicated');
 assert(!trial.includes('class="card cap-line" href="#/capCloud"'),'the new Fuji supplement never navigates to an undated capCloud page');
 assert(trial.includes('weeks = prediction.weeks;'),'the accepted forecast remains complete');
 assert(trial.includes('parseRoute(location.hash, () => S.PHENOMENA)'),'existing rainbow and capCloud detail routes remain valid');
 checkClassicScripts(trial,name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'));
});

test('changed or duplicated generator boundaries stop before producing a partial trial',()=>{
 const source=renderIndex().html;
 assert.throws(()=>forecastSummaryHtml(source.replace('let currentView = "list";','let currentView = null;')),/boundary changed/);
 assert.throws(()=>forecastSummaryHtml(source+'\nlet currentView = "list";'),/boundary changed/);
 assert.throws(()=>forecastSummaryHtml(source.replace('const best = pickHighlight(weeks, now);','const best = null;')),/boundary changed/);
 assert.throws(()=>forecastSummaryHtml(source.replace('function renderCapLine(dayMs) {','function renderCapLine(day) {')),/boundary changed/);
 assert.throws(()=>forecastSummaryHtml(source.replace('if (inDetail) return;','if (inDetail) { return; }')),/boundary changed/);
});

test('Fuji reference uses only its selected day and existing timing, never a score or peak fallback',()=>{
 const trial=forecastSummaryHtml(renderIndex().html);
 const start=trial.indexOf('function renderCapLine(dayMs) {'),end=trial.indexOf('\n// 笠雲の条件がいちばん整う時間帯。',start);
 assert(start>0&&end>start);
 const day=Date.UTC(2026,10,7,15),hour=3600000,rows=[],weeks={capCloud:rows};
 const S={JstCal:{sameDay:(a,b)=>a===b,hhmmRounded:at=>new Date(at+9*hour).toISOString().slice(11,16)}};
 const render=vm.runInNewContext(trial.slice(start,end)+';renderCapLine',{weeks,S,esc:String});
 const ev={score:99,rank:{key:'best'},peak:day+23*hour,timing:{from:day+6*hour,to:day+9*hour,spans:1}};
 rows.push({dayMs:day,evaluation:ev});
 let html=render(day);assert(html.includes('06:00–09:00'));assert(!/99|23:00|点|出やすい|href=|%/.test(html));
 ev.timing={...ev.timing,spans:2,openStart:true,openEnd:true};html=render(day);assert(html.includes('〜06:00–09:00〜')&&html.includes('ほかにも条件に届く時間帯')&&html.includes('前後の日へ'));
 ev.timing={allDay:true};html=render(day);assert(html.includes('条件が整う時間が広く')&&html.includes('時間帯を絞れません')&&!html.includes('23:00'));
 ev.timing=null;html=render(day);assert(html.includes('この日のデータでは時間帯を示せません')&&!html.includes('23:00'));
 ev.dataQuality={status:'partial'};html=render(day);assert(html.includes('判定材料が一部不足')&&!html.includes('条件が弱く'));
 ev.timing={from:day+6*hour,to:day+9*hour};html=render(day);assert(html.includes('06:00–09:00')&&html.includes('判定材料が一部不足'));
 ev.timing={allDay:true};html=render(day);assert(html.includes('条件が整う時間が広く')&&html.includes('判定材料が一部不足しています')&&!html.includes('一日を通して'));
 ev.unavailable={message:'データ不足'};html=render(day);assert(html.includes('判定できません')&&!html.includes('条件が弱く'));
 assert(render(day+86400000).includes('この日の条件データはありません'));
 delete weeks.capCloud;assert(render(day).includes('この日の条件データはありません'));
});

test('constructing the list owner does not read DOM, predictions, storage, or navigate',()=>{
 const create=vm.runInNewContext(readFileSync(new URL('../experiments/forecast-summary/controller.js',import.meta.url),'utf8'));
 const forbidden=()=>{throw Error('constructor performed a side effect');};
 const owner=create({document:new Proxy({},{get:forbidden}),host:forbidden,context:forbidden,presentation:new Proxy({},{get:forbidden}),openDetail:forbidden,announce:forbidden});
 assert.deepEqual(Object.keys(owner),['capture','restore','select','waiting']);
});
