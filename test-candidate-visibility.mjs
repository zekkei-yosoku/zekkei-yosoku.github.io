// E92: 欠測を見通せると扱わず、確認前に選べる候補を出さない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';
const require = createRequire(import.meta.url);
const AL = require('./sorami-align.js'), TR = require('./sorami-terrain.js');
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
function grab(name) {
  const i = html.indexOf(name); assert.ok(i >= 0);
  return html.slice(i, html.indexOf('\n}\n', i) + 2);
}
const observer = { latitude: 35.6, longitude: 139.6, elevation: 0 };
const endpoint = TR.destination(observer.latitude, observer.longitude, 90, 3);
const target = { ...endpoint, id: 'tower', parts: [{ id: 'tip', m: 100 }] };
test('標高の全部欠測・一部欠測・短い応答を clear にしない', async () => {
  for (const elevations of [async p => p.map(() => null), async p => p.map((_, i) => i === 2 ? null : 0), async p => p.slice(1).map(() => 0)]) {
    assert.equal(await AL.lineOfSight(observer, target, { partId: 'tip', elevations }), null);
  }
});
test('足元100mの土手と塔直前の丘を見落とさない', async () => {
  for (const [a, b, height] of [[0.09, 0.11, 20], [2.65, 2.8, 200]]) {
    const los = await AL.lineOfSight(observer, target, { partId: 'tip', elevations: async pts => pts.map(p => {
      const d = TR.distanceKm(observer.latitude, observer.longitude, p.latitude, p.longitude);
      return d > a && d < b ? height : 0;
    }) });
    assert.equal(los.clear, false);
  }
});
test('目標の先端は見えても、低く通る天体を丘が隠す場合は除外', async () => {
  const elevations = async pts => pts.map(p => {
    const d = TR.distanceKm(observer.latitude, observer.longitude, p.latitude, p.longitude);
    return d > 0.99 && d < 1.06 ? 10 : 0;
  });
  assert.equal((await AL.lineOfSight(observer, target, { partId: 'tip', elevations })).clear, true);
  assert.equal((await AL.lineOfSight(observer, target, { partId: 'tip', elevations, maxAngleDeg: 0.2 })).clear, false);
});
function candidate(id, lon = 139.6) {
  return { side: 'set', place: { id, kind: '展望地' }, stand: { latitude: 35.6, longitude: lon, elevationM: 0 },
    score: 1, distanceKm: 3, altitude: 1, targetAngle: 1, sunAltitude: -10 };
}
function harness(found, overrides = {}) {
  const aim = { candSeq: 0, lines: [{ side: 'set', points: [{ distanceKm: 3 }] }], body: 'sun', target,
    candPick: null, candSide: 'set', cands: [] };
  const els = {};
  const ctx = { aim, $: k => els[k] ||= { innerHTML: '', textContent: '' },
    aimRefreshSheetCands() {}, aimPlaces: async () => [], aimIsFuji: () => false, aimIsMountain: () => false,
    aimFujiPlaces: () => [], aimElevation() {}, aimCandScore: () => 1, aimCandidateSiteSupported: () => true,
    aimOnLand: async c => c, SoramiAlign: { candidates: async () => found, lineOfSight: async () => ({ clear: true }) },
    SoramiTerrain: TR, aimBuildingBlocks: async () => [false], AimMap: { redraw() {} }, aimUpdateLook() {},
    renders: [], aimRenderCands() { ctx.renders.push([...aim.cands]); }, ...overrides };
  ctx.find = runInNewContext(grab('async function aimFindCandidates') + ';aimFindCandidates', ctx);
  return ctx;
}
test('建物確認が終わるまで候補を公表せず busy を保つ', async () => {
  let release;
  const h = harness([candidate('a')], { aimBuildingBlocks: () => new Promise(r => release = r) });
  const pending = h.find();
  await setImmediate();
  assert.ok(release); assert.equal(h.aim.cands.length, 0); assert.equal(h.aim.candBusy, true);
  release([false]); await pending;
  assert.equal(h.aim.cands.length, 1); assert.equal(h.aim.candBusy, false);
  assert.equal(h.renders.length, 1);
});
test('先の候補が隠れていても近くの代替候補を事前に間引かない', async () => {
  const h = harness([candidate('blocked'), candidate('clear', 139.60001)], {
    aimBuildingBlocks: async ([c]) => [c.place.id === 'blocked'],
  });
  await h.find(); assert.deepEqual(Array.from(h.aim.cands, c => c.place.id), ['clear']);
});
test('地形欠測・建物取得不能・例外を見通せる候補として表示しない', async () => {
  for (const overrides of [
    { SoramiAlign: { candidates: async () => [candidate('a')], lineOfSight: async () => null } },
    { aimBuildingBlocks: async () => [null] },
    { aimBuildingBlocks: async () => { throw Error('offline'); } },
  ]) {
    const h = harness([candidate('a')], overrides); await h.find();
    assert.equal(h.aim.cands.length, 0); assert.equal(h.aim.candBusy, false);
    assert.deepEqual(Array.from(h.aim.candUnknownSides), ['set']);
  }
});
test('古い建物応答は新しい日付の一覧を上書きしない', async () => {
  let release;
  const h = harness([candidate('old')], { aimBuildingBlocks: () => new Promise(r => release = r) });
  const pending = h.find();
  await setImmediate();
  h.aim.candSeq++; h.aim.cands = [candidate('new')]; release([false]); await pending;
  assert.equal(h.aim.cands[0].place.id, 'new'); assert.equal(h.renders.length, 0);
});
test('水域取得不能は陸上と読み替えない', async () => {
  const ctx = { AIM_STAND_ON_WATER_OK: new Set(['橋', '桟橋']), SoramiTerrain: { waterAt: async () => [null] } };
  const onLand = runInNewContext(grab('async function aimOnLand') + ';aimOnLand', ctx);
  assert.equal(await onLand(candidate('a'), [], {}), null);
  assert.equal((await onLand({ ...candidate('bridge'), place: { kind: '橋' } }, [], {})).place.kind, '橋');
});
test('建物は種別下限で遮る場合に除外し、高さ不明だけで候補を全滅させない', async () => {
  const ctx = { aim: { target, partId: 'tip' }, aimIsFuji: () => true,
    aimNearBuildings: async () => [{ heightUnknown: true }], SoramiAlign: { buildingBlock: () => ({ by: null }) } };
  const blocks = runInNewContext(grab('async function aimBuildingBlocks') + ';aimBuildingBlocks', ctx);
  const c = { ...candidate('a'), targetAngle: 5, altitude: 1 };
  assert.equal((await blocks([c]))[0], false);
  ctx.SoramiAlign.buildingBlock = () => ({ by: { id: 'known-low-rise' }, marginDeg: 0 });
  assert.equal((await blocks([c]))[0], true);
  ctx.SoramiAlign.buildingBlock = () => ({ by: null });
  ctx.aimNearBuildings = async () => [];
  assert.equal((await blocks([c]))[0], false);
});
test('公園の名前や一般の山頂・峠だけで開けた撮影点とみなさない', () => {
  const supported = runInNewContext(grab('function aimCandidateSiteSupported') + ';aimCandidateSiteSupported');
  for (const kind of ['公園', '山頂', '峠', '桟橋', '川岸']) assert.equal(supported({kind, name:'富士見展望公園'}), false);
  for (const kind of ['展望地', '展望台', '定番', '橋', '海岸']) assert.equal(supported({kind}), true);
});
test('標高APIが応答しなくても打ち切り、後続地点で同じ失敗を繰り返さない', async () => {
  let calls = 0;
  const ctx = { module: {exports:{}}, SoramiAstro: require('./sorami-astro.js'), AbortSignal: { timeout: () => AbortSignal.timeout(5) },
    fetch: (_url, {signal}) => new Promise((_resolve, reject) => {
      calls++; signal.addEventListener('abort', () => reject(signal.reason));
    }) };
  runInNewContext(readFileSync(new URL('./sorami-terrain.js', import.meta.url), 'utf8'), ctx);
  const terrain = ctx.module.exports;
  // Nodeの短いタイマーの間もイベントループを保つ。
  const keepAlive = setInterval(()=>{},10);
  try {
    assert.equal(await terrain.groundElevation(35.6,139.6), null);
    assert.equal(await terrain.groundElevation(35.61,139.61), null);
    assert.equal(calls, 1);
  } finally { clearInterval(keepAlive); }
});
