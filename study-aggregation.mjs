/*
 * 中央値をどこで取るかを検証する。
 *
 *   A（現行）: モデルごとに採点し、点数の中央値を取る
 *   B        : 変数ごとに中央値を取り、その1組で1回採点する
 *
 * 採点は非線形（三角カーブ・上限・見え率の掛け算）なので、この2つは一致しない。
 * 一般論としては A が良いとされる。B は「上層雲は晴れているモデル」と
 * 「下層雲が厚いモデル」の値を混ぜて、どのモデルも予想していない空を作りうるため。
 * ただし本アプリでそれが実際に効いているかは測っていなかった。
 *
 * 真値: ERA5 再解析から同じ式で出した点数
 * 対象: 星空（総雲量・降水・湿度だけで採点でき、ERA5 側にも全部ある）
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");
require("./spots.js");

const VARS = ["cloud_cover", "precipitation", "relative_humidity_2m"];
const SITES = [
  ...globalThis.SORAMI_SPOTS.spots.filter((x) => x.phenomena.includes("starrySky"))
    .map((x) => ({ name: x.name, lat: x.latitude, lon: x.longitude, elevation: x.elevation })),
  { name: "東京", lat: 35.6812, lon: 139.7671, elevation: 10 },
  { name: "札幌", lat: 43.0621, lon: 141.3544, elevation: 20 },
  { name: "福岡", lat: 33.5904, lon: 130.4017, elevation: 10 },
];
const DAYS = Number(process.argv[2] || 90);
const end = new Date(Date.now() - 3 * 86400000);
const start = new Date(end.getTime() - DAYS * 86400000);
const iso = (d) => d.toISOString().slice(0, 10);

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
const asList = (raw) => (Array.isArray(raw) ? raw : [raw]);
const params = (extra) => new URLSearchParams({
  latitude: SITES.map((s) => s.lat).join(","), longitude: SITES.map((s) => s.lon).join(","),
  start_date: iso(start), end_date: iso(end),
  hourly: VARS.join(","), timezone: "auto", timeformat: "unixtime", ...extra,
});
const toSeries = (p, suffix = "") => new S.Series(p.hourly.time.map((t) => t * 1000),
  Object.fromEntries(VARS.map((v) => [v, p.hourly[`${v}_${suffix}`] ?? p.hourly[v]])
    .filter(([, c]) => c)));

console.log(`期間 ${iso(start)} 〜 ${iso(end)}（${DAYS}日）／ ${SITES.length}地点`);
const truth = asList(await getJSON(
  `https://archive-api.open-meteo.com/v1/archive?${params({ models: "era5" })}`)).map((p) => toSeries(p));

const forecast = {};
for (const m of S.MODELS) {
  try {
    forecast[m] = asList(await getJSON(
      `https://historical-forecast-api.open-meteo.com/v1/forecast?${params({ models: m })}`))
      .map((p) => toSeries(p, m));
    process.stdout.write(`  ${S.MODEL_NAMES[m]}\n`);
  } catch (e) { process.stdout.write(`  ${S.MODEL_NAMES[m]} 取得できず（${e.message}）\n`); }
  await new Promise((r) => setTimeout(r, 1500));
}
const MODELS = S.MODELS.filter((m) => forecast[m]);

const scoreOf = (series, site, dayMs) => {
  const input = { home: series, offsets: {}, lat: site.lat, lon: site.lon, terrain: null,
                  elevation: site.elevation, lightPollution: null, air: null };
  const win = S.SCORERS.starrySky.window(dayMs, input);
  if (!win) return null;
  const r = S.SCORERS.starrySky.score(win, input);
  return r.unavailable ? null : r.score;
};

// B のための「変数ごとの中央値シリーズ」。時刻の並びはモデル間で同じ前提。
function medianSeries(seriesList) {
  const base = seriesList[0];
  const columns = {};
  for (const v of VARS) {
    const cols = seriesList.map((s) => s.columns[v]).filter(Boolean);
    if (cols.length !== seriesList.length) continue;
    columns[v] = base.times.map((_, i) => {
      const vals = cols.map((c) => c[i]).filter((x) => x !== null && x !== undefined);
      return vals.length ? S.Curve.median(vals) : null;
    });
  }
  return new S.Series(base.times, columns);
}

const rows = [];
for (let si = 0; si < SITES.length; si++) {
  const list = MODELS.map((m) => forecast[m][si]).filter(Boolean);
  if (list.length !== MODELS.length) continue;
  const med = medianSeries(list);
  for (let d = 0; d < DAYS; d++) {
    const dayMs = start.getTime() + d * 86400000;
    const t = scoreOf(truth[si], SITES[si], dayMs);
    if (t === null) continue;
    const each = list.map((s) => scoreOf(s, SITES[si], dayMs));
    if (each.some((x) => x === null)) continue;
    const b = scoreOf(med, SITES[si], dayMs);
    if (b === null) continue;
    rows.push({ truth: t, a: S.Curve.median(each), b });
  }
}
console.log(`\n標本 ${rows.length}件（全${MODELS.length}モデルが揃ったもの）\n`);
if (!rows.length) process.exit(1);

const stat = (pick) => {
  const e = rows.map((r) => pick(r) - r.truth);
  const mae = e.reduce((s, x) => s + Math.abs(x), 0) / e.length;
  const bias = e.reduce((s, x) => s + x, 0) / e.length;
  const big = e.filter((x) => Math.abs(x) >= 20).length / e.length * 100;
  const rank = rows.filter((r) => S.rankOf(pick(r)).key !== S.rankOf(r.truth).key).length
    / rows.length * 100;
  return { mae, bias, big, rank };
};
const pad = (s, w) => String(s) + " ".repeat(Math.max(0, w -
  [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 0x1100 ? 2 : 1), 0)));
console.log(`${pad("集約のしかた", 30)} ${pad("平均絶対誤差", 14)} ${pad("偏り", 8)} `
  + `${pad("20点以上", 10)} ${pad("評価が変わる", 12)}`);
for (const [name, pick] of [["★A 採点してから中央値（現行）", (r) => r.a],
                            ["  B 変数の中央値で1回採点", (r) => r.b]]) {
  const s = stat(pick);
  console.log(`${pad(name, 30)} ${pad(s.mae.toFixed(2) + "点", 14)} `
    + `${pad((s.bias >= 0 ? "+" : "") + s.bias.toFixed(2), 8)} `
    + `${pad(s.big.toFixed(0) + "%", 10)} ${pad(s.rank.toFixed(0) + "%", 12)}`);
}
// 平均だけ見ても、差が偶然かどうかは分からない。標本ごとにどちらが近かったかを数える。
let winA = 0, winB = 0, tie = 0;
for (const r of rows) {
  const da = Math.abs(r.a - r.truth), db = Math.abs(r.b - r.truth);
  if (Math.abs(da - db) < 0.01) tie++; else if (da < db) winA++; else winB++;
}
const n = winA + winB;
// 差が無い（勝率0.5）としたときの標準偏差。n が大きいので正規近似で足りる。
const z = n ? (winA - n / 2) / Math.sqrt(n * 0.25) : 0;
console.log(`\n標本ごとにどちらが実況に近かったか: A ${winA}件 / B ${winB}件 / 引き分け ${tie}件`);
console.log(`  A の勝率 ${(winA / n * 100).toFixed(1)}%（z = ${z.toFixed(1)}、`
  + `${Math.abs(z) >= 2.58 ? "偶然とは考えにくい" : Math.abs(z) >= 1.96 ? "有意だが強くはない" : "偶然の範囲"}）`);

const diffs = rows.map((r) => Math.abs(r.a - r.b));
const same = diffs.filter((x) => x < 0.5).length / rows.length * 100;
console.log(`\nA と B が 0.5点未満しか違わない標本: ${same.toFixed(0)}%`);
console.log(`両者の差の平均: ${(diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(2)}点 / `
  + `最大 ${Math.max(...diffs).toFixed(1)}点`);
