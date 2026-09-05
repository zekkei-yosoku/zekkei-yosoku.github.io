/*
 * 星空の採点の回帰テスト。
 *
 * 直したこと（2026-09-06）:
 *   1. 夜通しの平均で採点していた。「前半だけ快晴」と「一晩じゅう半分曇り」が同点になり、
 *      見に行くかの判断に使えなかった。最も条件の良い連続3時間で採点する
 *   2. 雲と月を単純に足していたため、全天曇りでも月が無ければ 40点（「そこそこ」）が付いた。
 *      塞がった空の下で月の有無は関係ない
 *   3. 全天曇りの上限が無かった。雲は減点ではなく上限として効かせる
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? "  " + detail : ""}`); }
};

const lat = 43.4689, lon = 143.7472;          // 陸別（光害の少ない地点）
const HOUR = 3600000;
// 新月と満月の夜を選ぶ。月の計算は本物を使い、雲だけこちらで置く。
const findMoon = (want) => {
  let bestT = null, bestD = Infinity;
  for (let d = 0; d < 40; d++) {
    const t = Date.UTC(2026, 0, 1) + d * 86400000;
    const f = S.Moon.state(t, lat, lon).illuminatedFraction;
    if (Math.abs(f - want) < bestD) { bestD = Math.abs(f - want); bestT = t; }
  }
  return bestT;
};
const NEW_MOON = findMoon(0), FULL_MOON = findMoon(1);

// 指定した雲量の並びを持つ1晩を作る。
function night(dayMs, clouds, opts = {}) {
  const win = S.SCORERS.starrySky.window(dayMs, { lat, lon });
  if (!win) throw new Error("夜が取れない");
  const [ws, we] = win;
  const times = [], cloud = [], precip = [], rh = [];
  const n = Math.max(clouds.length, Math.ceil((we - ws) / HOUR));
  for (let i = 0; i < n + 2; i++) {
    times.push(ws - HOUR + i * HOUR);
    cloud.push(clouds[Math.min(i, clouds.length - 1)]);
    precip.push(opts.precip ?? 0);
    rh.push(opts.rh ?? 60);
  }
  const series = new S.Series(times, {
    cloud_cover: cloud, precipitation: precip, relative_humidity_2m: rh,
  });
  const input = { home: series, offsets: {}, lat, lon, terrain: null,
                  elevation: opts.elevation ?? 200,
                  lightPollution: opts.lightPollution ?? null, air: null };
  return { win, input };
}
const scoreOf = (dayMs, clouds, opts) => {
  const { win, input } = night(dayMs, clouds, opts);
  return S.SCORERS.starrySky.score(win, input);
};
const flat = (v) => Array(24).fill(v);

console.log("== 全天曇りは星が見えない ==");
const overcastNew = scoreOf(NEW_MOON, flat(100));
const overcastFull = scoreOf(FULL_MOON, flat(100));
ok(overcastNew.score <= 5, "曇天100%・新月は 5点以下", overcastNew.score.toFixed(1));
ok(overcastFull.score <= 5, "曇天100%・満月も 5点以下", overcastFull.score.toFixed(1));
// ここが今回の本丸。以前は月が無いほうが 40点、あるほうが 1点で 39点も違った。
ok(Math.abs(overcastNew.score - overcastFull.score) < 1,
  "曇天では月の有無で点数が変わらない",
  `新月 ${overcastNew.score.toFixed(1)} / 満月 ${overcastFull.score.toFixed(1)}`);

console.log("== 晴れていれば月が効く ==");
const clearNew = scoreOf(NEW_MOON, flat(0));
const clearFull = scoreOf(FULL_MOON, flat(0));
ok(clearNew.score >= 90, "快晴・新月は 90点以上", clearNew.score.toFixed(1));
ok(clearNew.score > clearFull.score + 5, "快晴なら満月のほうが低い",
  `新月 ${clearNew.score.toFixed(1)} / 満月 ${clearFull.score.toFixed(1)}`);

console.log("== 一部だけ晴れる夜を拾う ==");
// 前半が曇り、後半が快晴。夜通しの平均だと中間の点数になってしまう。
const halfClouds = [100, 100, 100, 100, 100, 0, 0, 0, 0, 0, 0, 0];
const half = scoreOf(NEW_MOON, halfClouds);
const uniform = scoreOf(NEW_MOON, flat(50));
ok(half.score > uniform.score + 20, "「後半だけ快晴」は「ずっと半分曇り」より高い",
  `半分晴れ ${half.score.toFixed(1)} / 一様50% ${uniform.score.toFixed(1)}`);
ok(Array.isArray(half.refinedWindow), "採点した時間帯を返す");
ok(half.refinedWindow && half.refinedWindow[1] - half.refinedWindow[0] === 3 * HOUR,
  "時間帯の長さは3時間");
ok(!scoreOf(NEW_MOON, flat(0)).refinedWindow,
  "夜通し同じ条件なら時間帯を絞らない");

console.log("== 上限と重みの境目 ==");
const at = (c) => scoreOf(NEW_MOON, flat(c)).score;
ok(at(80) > at(90) && at(90) > at(100), "雲量80→90→100 で単調に下がる",
  `${at(80).toFixed(1)} / ${at(90).toFixed(1)} / ${at(100).toFixed(1)}`);
ok(at(70) >= 55, "雲量70%ではまだ切り捨てない（晴れ間から見える）", at(70).toFixed(1));

console.log("== 雨は雲とは別に効く ==");
const rainy = scoreOf(NEW_MOON, flat(100), { precip: 2 });
ok(rainy.score <= 5, "雨の夜も 5点以下", rainy.score.toFixed(1));

console.log("== 光害はその地点の素質 ==");
const city = scoreOf(NEW_MOON, flat(0), { lightPollution: { mpsas: 17.5 } });
ok(city.score < clearNew.score - 20, "都心の快晴・新月は暗い空より大きく下がる",
  `都心 ${city.score.toFixed(1)} / 暗い空 ${clearNew.score.toFixed(1)}`);

console.log("== 内訳の合計が点数と一致する ==");
for (const [name, r] of [["快晴・新月", clearNew], ["曇天", overcastNew], ["半分晴れ", half]]) {
  const sum = r.base + r.factors.reduce((s, f) => s + f.c, 0);
  ok(Math.abs(sum - r.score) < 0.001, `${name}: 内訳の合計 = 点数`,
    `${sum.toFixed(3)} vs ${r.score.toFixed(3)}`);
}

console.log(`\n${fail === 0 ? "STARRY OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
