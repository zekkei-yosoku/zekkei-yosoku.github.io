/*
 * アンサンブルが「何日先まで正しく散らばっているか」を見る。
 *
 * 第26節で、当日のアンサンブル由来の予測誤差 8.9点が実測 9.5点と 6% 以内で一致したので、
 * 日数ぶんの下駄をやめた。ただし**確かめたのは当日だけ**で、
 * 02_検証結果の未検証表にも「数日先でのアンサンブルの較正」が残っている。
 *
 * アンサンブルには過去アーカイブが無いので、過去実行との直接比較はできない。
 * ここでは「いまの実行で、リードタイム別に予測誤差の見積もりがどう広がるか」を出す。
 * これを study-leadtime.mjs の実測誤差と並べれば、
 * 見積もりが実測に追いついているかが読める。
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");

const SITES = [
  { name: "陸別", latitude: 43.46894, longitude: 143.74718, elevation: 212, terrain: null },
  { name: "野辺山高原", latitude: 35.9553, longitude: 138.47465, elevation: 1346, terrain: null },
  { name: "美星天文台", latitude: 34.67203, longitude: 133.54539, elevation: 421, terrain: null },
  { name: "東京", latitude: 35.6812, longitude: 139.7671, elevation: 10, terrain: null },
  { name: "札幌", latitude: 43.0621, longitude: 141.3544, elevation: 20, terrain: null },
  { name: "南阿蘇村", latitude: 32.84694, longitude: 131.03258, elevation: 441, terrain: null },
];
// 現象を絞る。study-leadtime.mjs で実測誤差を出せたのが星空だけなので、
// 並べて読めるのも星空だけ。
const PHENOMENA = ["starrySky"];
// 1プロセス1地点で回す。8日ぶんのアンサンブル（51メンバー）を複数地点ぶん抱えると
// 4GB でも足りずに落ちる（実測）。呼び出し側で地点を回す。
const ONLY = process.argv[2] ? Number(process.argv[2]) : null;

const byLead = {};   // [phenomenon][daysAhead] = [expectedError...]
for (const p of PHENOMENA) byLead[p] = {};

for (const [idx, site] of SITES.entries()) {
  if (ONLY !== null && idx !== ONLY) continue;
  let bundle;
  try {
    bundle = await S.fetchForecast(site.latitude, site.longitude, 8, site);
  } catch (e) { console.log(`${site.name}: 取得できず ${e.message}`); continue; }
  if (!bundle.ensemble) { console.log(`${site.name}: アンサンブルが取れなかった`); continue; }
  const now = Date.now();
  for (const p of PHENOMENA) {
    for (const entry of S.evaluateWeek(p, bundle, site, now, 8)) {
      const ev = entry.evaluation;
      if (ev.unavailable || !ev.uncertainty) continue;
      const d = ev.daysAhead;
      (byLead[p][d] = byLead[p][d] || []).push(ev.uncertainty.expectedError);
    }
  }
  process.stdout.write(`  ${site.name}\n`);
  await new Promise((r) => setTimeout(r, 1500));
}

const pad = (s, w) => String(s) + " ".repeat(Math.max(0, w -
  [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 0x1100 ? 2 : 1), 0)));
const median = (a) => S.Curve.median(a);

for (let d = 0; d <= 7; d++) {
  const a = byLead.starrySky[d];
  if (a && a.length) console.log(`DATA\t${d}\t${a.join(",")}`);
}
console.log(`\n括弧内は標本数（地点数）。`);
console.log(`study-leadtime.mjs の実測誤差と並べて読む。`);
console.log(`見積もりが実測より小さいままなら、先の日ほど信頼度を過大に出していることになる。`);
