/*
 * 公式カメラ「ベストショット」の日を正例にして、雲海スコアが実際に出た日を
 * 選び分けられているかを測る。
 *
 * 正例の出どころ: 秩父市・秩父観光なび「秩父雲海カメラ」ベストショット一覧
 *   https://navi.city.chichibu.lg.jp/cloudview/bestlist/
 *   画像のファイル名が撮影時刻（YYYYMMDDhhmmss）。2017-10〜2026-04 で 167日。
 *   撮影地点は秩父ミューズパーク 旅立ちの丘（36.0034909, 139.0603548, 370m）。
 *
 * **これは「出た日」の一覧であって、「出なかった日」の一覧ではない。**
 *   選ばれなかった日に雲海が無かったとは限らない（選者が撮っていないだけかもしれない）。
 *   したがって対照群には雲海の日が混ざる。混ざるぶん、下で測る分離は
 *   【本当の分離より低く出る】。つまり良い値が出れば信用してよく、
 *   悪い値が出たときは「対照群の汚染」も疑う必要がある。
 *
 * 真値は ERA5 再解析。**気圧面を持たないので逆転層（雲海の天井）の項は効かない。**
 *   ここで測っているのは地上の項（気温差・風速・湿度・前日の降水・夜間の雲量）だけ。
 *
 * 使い方: node study-bestshot.mjs [対照群の1日あたり本数=1]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");

const SPOT = { name: "旅立ちの丘", latitude: 36.0034909, longitude: 139.0603548,
               terrain: "basinRim", elevation: 370 };
const CACHE = new URL("./data/bestshot-cache/", import.meta.url).pathname;
mkdirSync(CACHE, { recursive: true });

// 正例の一覧は公開ページから毎回作り直す。手元のファイルを配らずに再現できるようにする。
const listPath = new URL("./data/chichibu-bestshots.json", import.meta.url).pathname;
let best;
if (existsSync(listPath)) best = JSON.parse(readFileSync(listPath, "utf8"));
else {
  const html = await (await fetch("https://navi.city.chichibu.lg.jp/cloudview/bestlist/")).text();
  // 画像のファイル名が撮影時刻（YYYYMMDDhhmmss）。日付だけを取る。
  const stamps = [...new Set([...html.matchAll(/\/cloudview\/best\/(\d{14})\.jpg/g)].map((m) => m[1]))].sort();
  best = { stamps, days: [...new Set(stamps.map((x) => `${x.slice(0,4)}-${x.slice(4,6)}-${x.slice(6,8)}`))].sort() };
  writeFileSync(listPath, JSON.stringify(best, null, 1));
  console.log(`ベストショット一覧を取得: ${best.stamps.length}枚 / ${best.days.length}日`);
}
// 夕方以降の撮影（雲海夜景）も、その日に雲海が出ていた証拠として同じに扱う。
const positives = new Set(best.days);

// ERA5 は当日までは埋まらない。余裕を持って手前で切る。
const START = "2017-10-01", END = "2023-03-31";
const VARS = ["temperature_2m", "relative_humidity_2m", "precipitation",
              "cloud_cover", "cloud_cover_low", "wind_speed_10m", "dew_point_2m"];

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({ error: true, reason: "JSONではない応答" }));
    if (res.ok && !body.error) return body;
    if (body.reason && /limit/i.test(body.reason)) {
      await new Promise((r) => setTimeout(r, 20000 * (i + 1))); continue;
    }
    throw new Error(body.reason || `HTTP ${res.status}`);
  }
  throw new Error("リトライ上限");
}

const cachePath = `${CACHE}era5_${START}_${END}.json`;
let raw;
if (existsSync(cachePath)) { raw = JSON.parse(readFileSync(cachePath, "utf8")); console.log("保存済みのERA5を使う"); }
else {
  const p = new URLSearchParams({
    latitude: String(SPOT.latitude), longitude: String(SPOT.longitude),
    start_date: START, end_date: END, hourly: VARS.join(","),
    timezone: "auto", timeformat: "unixtime",
    // 既定は km/h。m/s で読んでいるので必ず指定する（2026-09-06に踏んだ欠陥）
    wind_speed_unit: "ms", models: "era5",
  });
  raw = await getJSON(`https://archive-api.open-meteo.com/v1/archive?${p}`);
  writeFileSync(cachePath, JSON.stringify(raw));
  console.log("ERA5を取得して保存した");
}
S.setTimezoneOffset(raw.utc_offset_seconds);
const series = new S.Series(raw.hourly.time.map((t) => t * 1000),
  Object.fromEntries(VARS.map((v) => [v, raw.hourly[v]]).filter(([, c]) => c)));
console.log(`地点 ${SPOT.name}（ERA5格子標高 ${raw.elevation}m）／ ${START} 〜 ${END}`);

const input = { home: series, offsets: {}, lat: SPOT.latitude, lon: SPOT.longitude,
                terrain: SPOT.terrain, elevation: SPOT.elevation, lightPollution: null, air: null };

const rows = [];
const oneDay = 86400000;
for (let t = new Date(START + "T00:00:00Z").getTime() + 12 * 3600000;
     t <= new Date(END + "T00:00:00Z").getTime(); t += oneDay) {
  const w = S.SCORERS.seaOfClouds.window(t, input);
  if (!w) continue;
  const r = S.SCORERS.seaOfClouds.score(w, input);
  if (r.unavailable) continue;
  const d = new Date(t + raw.utc_offset_seconds * 1000).toISOString().slice(0, 10);
  rows.push({ date: d, month: +d.slice(5, 7), score: r.score, positive: positives.has(d),
              f: Object.fromEntries(r.factors.map((x) => [x.label.replace(/ .*/, ""), x.c])) });
}
const pos = rows.filter((r) => r.positive), neg = rows.filter((r) => !r.positive);
console.log(`\n採点できた日 ${rows.length}日 ／ ベストショットの日 ${pos.length}日 ／ それ以外 ${neg.length}日`);
if (pos.length < 20) { console.log("正例が少なすぎる"); process.exit(1); }

// 対照群は同じ月に限る。季節の違いを「当てている」と読み違えないため。
const months = new Set(pos.map((r) => r.month));
const control = neg.filter((r) => months.has(r.month));
console.log(`対照群は正例と同じ月（${[...months].sort((a, b) => a - b).join("/")}月）に限る → ${control.length}日`);

// AUC = 正例と対照を1つずつ引いたとき、正例のほうが高い確率。
// 0.5 は当てずっぽうと同じ。順位だけを見るので、点数の較正のずれに影響されない。
function auc(a, b, pick = (r) => r.score) {
  let win = 0, tie = 0;
  for (const p of a) for (const n of b) {
    const x = pick(p), y = pick(n);
    if (x > y) win++; else if (x === y) tie++;
  }
  return (win + tie / 2) / (a.length * b.length);
}
const q = (arr, p, pick = (r) => r.score) => {
  const v = arr.map(pick).sort((x, y) => x - y);
  return v[Math.round((v.length - 1) * p)];
};
const pad = (s, w) => String(s) + " ".repeat(Math.max(0, w -
  [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 0x1100 ? 2 : 1), 0)));

console.log(`\n${pad("", 14)}${pad("中央値", 9)}${pad("25%", 7)}${pad("75%", 7)}`);
console.log(`${pad("雲海が出た日", 14)}${pad(q(pos, .5).toFixed(0) + "点", 9)}${pad(q(pos, .25).toFixed(0), 7)}${pad(q(pos, .75).toFixed(0), 7)}`);
console.log(`${pad("それ以外", 14)}${pad(q(control, .5).toFixed(0) + "点", 9)}${pad(q(control, .25).toFixed(0), 7)}${pad(q(control, .75).toFixed(0), 7)}`);

const a = auc(pos, control);
// 標準誤差（Hanley–McNeil の近似）。標本が小さいので、差が偶然でないかを見る。
const n1 = pos.length, n2 = control.length;
const q1 = a / (2 - a), q2 = 2 * a * a / (1 + a);
const se = Math.sqrt((a * (1 - a) + (n1 - 1) * (q1 - a * a) + (n2 - 1) * (q2 - a * a)) / (n1 * n2));
const z = (a - 0.5) / se;
console.log(`\n【総合スコアの分離】AUC ${a.toFixed(3)}（z = ${z.toFixed(1)}、`
  + `${Math.abs(z) >= 2.58 ? "偶然とは考えにくい" : Math.abs(z) >= 1.96 ? "有意だが強くはない" : "偶然の範囲"}）`);
console.log(`  0.5 = 当てずっぽうと同じ。1.0 = 完全に選び分けられる。`);

console.log(`\n要素ごとの分離（どの項が効いているか）`);
const keys = [...new Set(rows.flatMap((r) => Object.keys(r.f)))];
const each = keys.map((k) => ({ k, a: auc(pos, control, (r) => r.f[k] ?? 0) }))
  .sort((x, y) => Math.abs(y.a - 0.5) - Math.abs(x.a - 0.5));
for (const e of each) console.log(`  ${pad(e.k, 16)} AUC ${e.a.toFixed(3)}`
  + (Math.abs(e.a - 0.5) < 0.03 ? "  ← ほぼ効いていない" : ""));

writeFileSync(new URL("./data/bestshot-result.json", import.meta.url).pathname,
  JSON.stringify({ spot: SPOT, start: START, end: END, auc: a, z,
    positives: pos.length, control: control.length, rows }, null, 1));
console.log(`\n内訳を data/bestshot-result.json に保存`);
console.log(`注意: 対照群には雲海の日が混ざりうる（選ばれなかっただけ）。分離は低めに出る。`);
console.log(`注意: ERA5は気圧面を持たないので、逆転層（天井）の項は入っていない。`);
