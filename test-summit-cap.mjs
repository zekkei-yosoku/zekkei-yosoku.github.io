// 「指定なし」の山の候補を山頂付近だけで判定する（2026-10-20）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const src = html.slice(html.indexOf('const AIM_SUMMIT_CAP_M'), html.indexOf('async function aimShootingView'));

function load(angle) {
  const c = { SoramiTerrain: { distanceKm: () => 100 }, aimAirAngle: angle, Math };
  vm.createContext(c); vm.runInContext(src + ';globalThis.cap=aimSummitCap;globalThis.M=AIM_SUMMIT_CAP_M;', c); return c;
}
// 見かけの角度を標高に比例させた単純な換算（100km 先で 1000m ≒ 0.573°）
const angle = (d, eye, h) => Math.atan2(h - eye, d * 1000) * 180 / Math.PI;
const target = { latitude: 0, longitude: 0, parts: [{ id: 'top', m: 3776 }] };

test('山頂から標高差300mより上の部分だけを切り出し、境目は基準の高さで切る', () => {
  const c = load(angle);
  assert.equal(c.M, 300);
  // 左右に裾が広がる山。頂は 3776m
  const ridge = [[-3, angle(100, 0, 1000)], [-2, angle(100, 0, 2500)], [-1, angle(100, 0, 3400)], [0, angle(100, 0, 3776)], [1, angle(100, 0, 3300)], [2, angle(100, 0, 2000)]];
  const out = c.cap(ridge, { latitude: 0, longitude: 0 }, 0, target), base = angle(100, 0, 3476);
  assert.ok(Math.abs(out.base - base) < 1e-9);
  assert.equal(out.ridge[0][1], base); assert.equal(out.ridge.at(-1)[1], base);
  assert.ok(out.ridge.every(([, a]) => a >= base - 1e-9), '山頂付近より低い稜線を含まない');
  assert.ok(out.ridge[0][0] > -1 && out.ridge[0][0] < 0, '左の境目は -1〜0 の間（-1 の 3400m も基準より低い）');
  assert.ok(out.ridge.at(-1)[0] > 0 && out.ridge.at(-1)[0] < 1, '右の境目は 0〜1 の間');
  assert.ok(out.ridge.some(([a, h]) => a === 0 && Math.abs(h - angle(100, 0, 3776)) < 1e-9), '山頂を含む');
});

test('稜線が無い・頂が基準より低いときは切らない（全体のまま）', () => {
  const c = load(angle);
  assert.equal(c.cap(null, {}, 0, target), null);
  assert.equal(c.cap([[0, 0.1], [1, 0.2]], { latitude: 0, longitude: 0 }, 0, target), null);
});

test('山の候補の判定は下端の高さを使い、塔や既定の判定は地平線のまま', () => {
  const align = require('./sorami-align.js'), s = fs.readFileSync(new URL('./sorami-align.js', import.meta.url), 'utf8');
  assert.match(s, /const ridgeBase=Number\.isFinite\(opts\.ridgeBase\)\?opts\.ridgeBase:0;/);
  assert.match(html, /ridge:cap\.ridge,ridgeBase:cap\.base/);
  assert.equal(typeof align.prepareDailyView, 'function');
});
