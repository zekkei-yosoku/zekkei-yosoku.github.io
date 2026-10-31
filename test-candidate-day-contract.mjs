import {sourceUnit} from './tools/test-source.mjs';
// 候補日はJST日単位（同じ日の0/17/18:30/23:59で同じ日集合）、cacheは日跨ぎで失効、ねらうの既定呼出は不変。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';

const root = new URL('.', import.meta.url);
const observerSrc = sourceUnit('src/features/framing/observer.js');
const mapSrc = sourceUnit('src/features/explore/map-presentation.js');

function extract(src, name) {
  const i = src.search(new RegExp(`(async )?function ${name}\\(`));
  assert.ok(i >= 0, name + ' not found');
  const lineEnd = src.indexOf('\n', i);
  if (src.slice(i, lineEnd).trimEnd().endsWith('}')) return src.slice(i, lineEnd);
  return src.slice(i, src.indexOf('\n}\n', i) + 2);
}

const DAY = 86400000, H = 3600000, OFF = 9 * H;
const startOfDay = t => Math.floor((t + OFF) / DAY) * DAY - OFF;
const D = Date.UTC(2026, 10, 5) - OFF;
const EV = D + 18 * H + 16 * 60000;
// vm の配列は別realm。比較前にこちらの配列へ移す
const ats = rows => Array.from(rows, e => e.at);

function context(extra = {}) {
  const ctx = vm.createContext({
    setTimeout, Date, JSON, Math, Map, Number, Array, String, Object, Infinity,
    S: { Cal: { startOfDay }, JstCal: { sameDay: (a, b) => startOfDay(a) === startOfDay(b), hhmm: t => new Date(t + OFF).toISOString().slice(11, 16) } },
    aim: { limb: 'center', matchMode: 'limb', partId: 'tip', body: 'sun', from: null },
    aimIsMountain: () => false,
    AstroNotesAtmosphere: { dataKey: () => 'atm' },
    ...extra,
  });
  for (const name of ['aimCandidateMatch', 'aimBuildingDays', 'aimCalMonthStart', 'aimCalSolid', 'aimCalGridHtml', 'aimCalRows'])
    vm.runInContext(extract(observerSrc, name), ctx);
  return ctx;
}

// --- 候補日集合は同じJST日なら時刻に依らない
{
  let calls = 0;
  const ctx = context({ AstroNotesAlign: { upcoming: (o, t, b, { from }) => { calls++; return from === D ? [{ at: EV, side: 'set', gap: 0, radius: .25 }] : []; } } });
  const run = now => ctx.aimBuildingDays({ eyeM: 1.5 }, { id: 't' }, 'sun', 'tip', null, { from: now, isCurrent: () => true, days: 3, limit: 4 });
  for (const now of [D, D + 17 * H, D + 18.5 * H, D + 23 * H + 59 * 60000]) {
    ctx.aimBuildingDays.cache = new Map();
    assert.deepEqual(ats(await run(now)), [EV], 'same day at ' + new Date(now + OFF).toISOString());
  }
  // 同日cache: 18:16 を過ぎても失効しない
  ctx.aimBuildingDays.cache = new Map(); calls = 0;
  await run(D + 17 * H); const first = calls;
  assert.deepEqual(ats(await run(D + 23 * H)), [EV]);
  assert.equal(calls, first, 'same-day cache must survive the event time');
  // 日跨ぎ: 翌日は再計算し、前日の候補は帯の起点から外れる
  assert.deepEqual(ats(await run(D + DAY + 60000)), []);
  assert.ok(calls > first, 'next JST day recomputes');
  // 未来日: 前日から見ても候補日は入る
  ctx.aimBuildingDays.cache = new Map();
  assert.deepEqual(ats(await run(D - DAY + 23 * H)), [EV]);
  // 過ぎた日: 起点（現在の日）より前は探さない
  ctx.aimBuildingDays.cache = new Map();
  assert.deepEqual(ats(await run(D + 2 * DAY)), []);
}

// --- moon: 暗い空の条件は維持
{
  const ctx = context({ AstroNotesAlign: { upcoming: (o, t, b, { from }) => from === D ? [{ at: D + 5 * H, side: 'set', gap: 0, radius: .25, sunAltitude: 5 }, { at: EV, side: 'set', gap: 0, radius: .25, sunAltitude: -10 }] : [] } });
  ctx.aimBuildingDays.cache = new Map();
  const rows = await ctx.aimBuildingDays({ eyeM: 1.5 }, { id: 't' }, 'moon', 'tip', null, { from: D + 23 * H, isCurrent: () => true, days: 1, limit: 4 });
  assert.deepEqual(ats(rows), [EV]);
}

// --- 帯/地図のcacheは候補時刻でなくJST日跨ぎで失効
assert.ok(!/e\.at >= from &&/.test(extract(observerSrc, 'aimBuildingDays')), 'aimBuildingDays must not drop earlier events of the day');
assert.match(extract(observerSrc, 'aimDaysFor'), /entry\.until = S\.Cal\.startOfDay\(now\) \+ 86400000;/);
assert.ok(!/until/.test(extract(observerSrc, 'aimAppendCandidatePage')), 'appending pages must not shorten until');
assert.match(mapSrc, /entry\.rows=rows;entry\.until=S\.Cal\.startOfDay\(now\)\+86400000;/);
assert.ok(!/entry\.until=Math\.min\(S\.Cal\.startOfDay\(now\)\+86400000,\.\.\.rows/.test(mapSrc));
// 帯の探索起点は現在の日のまま（選択日へ変えない）
assert.match(extract(observerSrc, 'aimDaysFor'), /\{ from: now, limb, matchMode/);
assert.match(mapSrc, /aimBuildingDays\(obs,snapshot\.target,snapshot\.body,snapshot\.partId,null,\{from:now,/);

// --- カレンダー描画: 既定呼出は従来と同じ、plan/observer注入で●○・月相canvas・labelが出る
{
  const ctx = context({
    esc: s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'),
    aimSideName: (side, body) => `${body ?? ctx.aim.body}:${side}`,
    AstroNotesMoon: { phaseOf: s => ({ name: '月相' + Math.floor(s.at / DAY) }) },
    AstroNotesBodies: { state: (b, at, o) => ({ at, o }), definition: b => ({ limbs: b === 'sun' || b === 'moon' }), sky: () => '夜' },
  });
  vm.runInContext('function aimFromPoint(){return aim.from||null;}', ctx);
  const y = 2026, m = 10, events = new Map([[D, [{ at: EV, side: 'set', selectedMatch: true }]], [D + DAY, [{ at: D + DAY + 6 * H, side: 'rise', selectedMatch: false }]]]);
  for (const body of ['sun', 'moon']) {
    ctx.aim.body = body; ctx.aim.from = { latitude: 35, longitude: 139 };
    assert.equal(ctx.aimCalGridHtml(y, m, events, D, D), ctx.aimCalGridHtml(y, m, events, D, D, ctx.aim, ctx.aimFromPoint()), 'legacy default ' + body);
  }
  const legacySource=execFileSync('git',['show','97356e2:src/features/framing/observer.js'],{cwd:root,encoding:'utf8'});
  vm.runInContext(extract(legacySource,'aimCalGridHtml').replace('function aimCalGridHtml(','function legacyGridHtml('),ctx);
  for(const body of ['sun','moon','venus'])for(const point of [null,{latitude:35,longitude:139}]){
    ctx.aim.body=body;ctx.aim.from=point;
    assert.equal(ctx.aimCalGridHtml(y,m,events,D,D),ctx.legacyGridHtml(y,m,events,D,D),'actual baseline grid '+body+'/'+!!point);
  }
  ctx.aim.body = 'sun'; ctx.aim.from = null;
  const html = ctx.aimCalGridHtml(y, m, events, D, D, { body: 'moon' }, { latitude: 35, longitude: 139 });
  assert.match(html, /<canvas class="aim-cal-moon" width="40" height="40" data-cal-moon="\d+">/);
  assert.match(html, new RegExp(`data-cal-day="${D}" class="has-event" aria-label="2026年11月5日、月相\\d+、重なる日、moon:set 18:16"`));
  assert.ok(html.includes('●') && html.includes('○'));
  assert.match(html, /<span class="aim-cal-time">18:16<\/span>/);
  assert.ok(!ctx.aimCalGridHtml(y, m, events, D, D, { body: 'sun' }, null).includes('canvas'), 'sun has no moon canvas');

  // aimCalRows: owner の matchMode/limb を使い、既定は aim
  const seen = [];
  ctx.AstroNotesShooting = { eventsFor: (plan, obs, day) => day === D ? [{ at: EV, nearTarget: true, sunAltitude: -5 }] : [], matches: (e, plan) => { seen.push(plan.limb); return true; } };
  ctx.AstroNotesAlign = { dailyView: () => [], upcoming: (o, t, b, opt) => { seen.push('upcoming:' + opt.limb); return []; } };
  ctx.aim.matchMode = 'overlap'; ctx.aim.limb = 'center';
  const legacy = ctx.aimCalRows({ eyeM: 1.5 }, { id: 't' }, 'sun', y, m, '__whole', null);
  assert.deepEqual(legacy, ctx.aimCalRows({ eyeM: 1.5 }, { id: 't' }, 'sun', y, m, '__whole', null, ctx.aim));
  assert.deepEqual(ats(legacy), [EV]);
  seen.length = 0;
  ctx.aimCalRows({ eyeM: 1.5 }, { id: 't' }, 'sun', y, m, 'tip', null, { matchMode: 'limb', limb: 'top' });
  assert.ok(seen.includes('upcoming:top'), 'owner limb is injected');
}
console.log('candidate day contract ok');
