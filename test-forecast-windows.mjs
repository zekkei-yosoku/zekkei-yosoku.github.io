// 固定日時・人工気象による仕様の回帰。実景の的中率検証とは区別する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('./sorami-core.js');
const H = 3600000;

test('期間量は直前1時間、瞬時値は従来どおり。境界を二重計上しない', () => {
  const s = new S.Series([0, H, 2*H, 3*H], { precipitation:[1,2,4,8], showers:[1,2,4,8], direct_radiation:[10,20,40,80], cloud_cover:[1,2,4,8] });
  assert.deepEqual(s.values('precipitation',0,H), [2]);
  assert.deepEqual(s.values('showers',0,H), [2]);
  assert.equal(s.mean('direct_radiation',0,H),20);
  assert.deepEqual(s.values('cloud_cover',0,H),[1]);
  assert.equal(s.sum('precipitation',0,2*H),6);
  assert.deepEqual(s.values('precipitation',H,H),[]);
  assert.deepEqual(s.values('precipitation',H,0),[]);
  // 重なったサンプルを等しく集計する既存式を保持。部分按分の導入ではない。
  assert.equal(s.sum('precipitation',H/2,1.5*H),6);
  assert.equal(s.mean('direct_radiation',H/2,1.5*H),30);
});
test('時刻列に穴があっても期間量の長さは1時間。欠測を乾燥とみなさない', () => {
  const s = new S.Series([0,2*H,3*H], {precipitation:[1,4,null]});
  assert.deepEqual(s.intervalAt('precipitation',1),[H,2*H]);
  assert.equal(s.sum('precipitation',0,H),null);
  assert.equal(s.covers('precipitation',0,2*H),false);
  assert.equal(s.covers('precipitation',H,2*H),true);
  assert.equal(s.covers('precipitation',2*H,3*H),false);
});
test('虹は09時の雨と日射を08–09時・08:30の太陽で評価する', () => {
  const day = Date.UTC(2026,8,9)-9*H;
  const input={lat:35.6812,lon:139.7671,home:new S.Series([day+9*H],{precipitation:[1.5],showers:[0.2],direct_radiation:[400]})};
  assert.ok(S.Sun.position(day+8.5*H,input.lat,input.lon).elevation < 42);
  assert.ok(S.Sun.position(day+9.5*H,input.lat,input.lon).elevation > 42);
  const r=S.SCORERS.rainbow.score(S.SCORERS.rainbow.window(day,input),input);
  assert.equal(r.unavailable,null);
  assert.ok(r.score>0);
  assert.deepEqual(r.refinedWindow,[day+8*H,day+9*H]);
});
