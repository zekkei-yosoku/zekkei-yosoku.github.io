/*
 * 予報の当たり具合を、実況（ERA5再解析）と突き合わせて測る。
 *
 * 目的は、このアプリの根幹にある仮説を検証すること:
 *   「複数モデルの中央値は、個々のモデルより当たる」
 * これが偽なら、アンサンブルという設計そのものを見直す必要がある。
 *
 * 方法:
 *   予報 = historical-forecast-api（実際に発表された予報のアーカイブ）
 *   実況 = archive-api（ERA5 再解析）
 *   対象時刻 = 各日の日の入り時刻（夕焼けの判定が効く瞬間）
 *
 * 限界（結論を読むときに必ず併せて見ること）:
 *   - アーカイブ予報は概ね当日〜翌日のリードタイム。数日先の精度は測れていない
 *   - ERA5 も観測そのものではなくモデル同化の産物。特に雲量は不確かさが大きい
 *   - 気圧面湿度は再解析側から取れないため、雲量と降水のみで比較している
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./astronotes-core.js");

const MODELS = S.MODELS;
const VARS = ["cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "precipitation"];

// 気候の異なる地点を選ぶ。1地点だけだとその土地の癖を精度と取り違える。
const SITES = [
  { name: "札幌", lat: 43.06, lon: 141.35 },
  { name: "仙台", lat: 38.27, lon: 140.87 },
  { name: "東京", lat: 35.68, lon: 139.77 },
  { name: "新潟", lat: 37.90, lon: 139.02 },
  { name: "名古屋", lat: 35.18, lon: 136.91 },
  { name: "大阪", lat: 34.69, lon: 135.50 },
  { name: "広島", lat: 34.39, lon: 132.46 },
  { name: "高知", lat: 33.56, lon: 133.53 },
  { name: "福岡", lat: 33.59, lon: 130.40 },
  { name: "那覇", lat: 26.21, lon: 127.68 },
];

const DAYS = Number(process.argv[2] || 60);
const end = new Date(Date.now() - 2 * 86400000);          // 再解析は数日遅れる
const start = new Date(end.getTime() - DAYS * 86400000);
const iso = (d) => d.toISOString().slice(0, 10);

async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url);
    const body = await res.json();
    if (res.ok && !body.error) return body;
    if (body.reason && /limit/i.test(body.reason)) {
      await new Promise((r) => setTimeout(r, 20000 * (i + 1)));
      continue;
    }
    throw new Error(body.reason || `HTTP ${res.status}`);
  }
  throw new Error("リトライ上限");
}

function params(extra) {
  return new URLSearchParams({
    latitude: SITES.map((s) => s.lat).join(","),
    longitude: SITES.map((s) => s.lon).join(","),
    start_date: iso(start), end_date: iso(end),
    hourly: VARS.join(","), timezone: "auto", timeformat: "unixtime",
    ...extra,
  });
}

const asList = (raw) => (Array.isArray(raw) ? raw : [raw]);
// モデルを1本だけ指定したときはキーにサフィックスが付かない。
// 付いている場合と付いていない場合の両方を見る。
function toSeries(payload, suffix = "") {
  const times = payload.hourly.time.map((t) => t * 1000);
  const columns = {};
  for (const v of VARS) {
    const col = payload.hourly[`${v}_${suffix}`] ?? payload.hourly[v];
    if (col) columns[v] = col;
  }
  return new S.Series(times, columns);
}

console.log(`検証期間 ${iso(start)} 〜 ${iso(end)}（${DAYS}日）／ ${SITES.length}地点`);
console.log("予報: 発表済み予報のアーカイブ ／ 実況: ERA5 再解析\n");

// --- 実況（ERA5）
const truthRaw = asList(await getJSON(
  `https://archive-api.open-meteo.com/v1/archive?${params({ models: "era5" })}`));
const truth = truthRaw.map((p) => toSeries(p));

// --- 各モデルの予報
const forecast = {};
for (const m of MODELS) {
  try {
    const raw = asList(await getJSON(
      `https://historical-forecast-api.open-meteo.com/v1/forecast?${params({ models: m })}`));
    forecast[m] = raw.map((p) => toSeries(p, m));
    process.stdout.write(`  ${S.MODEL_NAMES[m]} 取得\n`);
  } catch (e) {
    process.stdout.write(`  ${S.MODEL_NAMES[m]} 取得できず（${e.message}）\n`);
  }
  await new Promise((r) => setTimeout(r, 1200));
}
const available = MODELS.filter((m) => forecast[m]);
console.log("");

// --- 各日の日の入り時刻で突き合わせる
const samples = [];   // { site, sunsetMs, truth:{...}, byModel:{m:{...}} }
for (let si = 0; si < SITES.length; si++) {
  const site = SITES[si];
  for (let d = 0; d <= DAYS; d++) {
    const dayMs = start.getTime() + d * 86400000;
    const sunset = S.Sun.eventTime("sunset", dayMs, site.lat, site.lon);
    if (sunset === null) continue;
    const t = {};
    let ok = true;
    for (const v of VARS) {
      const x = truth[si]?.valueAt(v, sunset);
      if (x === null || x === undefined) { ok = false; break; }
      t[v] = x;
    }
    if (!ok) continue;
    const byModel = {};
    for (const m of available) {
      const f = {};
      let full = true;
      for (const v of VARS) {
        const x = forecast[m][si]?.valueAt(v, sunset);
        if (x === null || x === undefined) { full = false; break; }
        f[v] = x;
      }
      if (full) byModel[m] = f;
    }
    if (Object.keys(byModel).length >= 3) samples.push({ site: site.name, truth: t, byModel });
  }
}
console.log(`突き合わせ標本: ${samples.length}件\n`);

// --- 指標
function stats(pairs) {
  const n = pairs.length;
  if (!n) return null;
  const mae = pairs.reduce((s, [f, t]) => s + Math.abs(f - t), 0) / n;
  const rmse = Math.sqrt(pairs.reduce((s, [f, t]) => s + (f - t) ** 2, 0) / n);
  const mf = pairs.reduce((s, [f]) => s + f, 0) / n;
  const mt = pairs.reduce((s, [, t]) => s + t, 0) / n;
  const cov = pairs.reduce((s, [f, t]) => s + (f - mf) * (t - mt), 0);
  const vf = Math.sqrt(pairs.reduce((s, [f]) => s + (f - mf) ** 2, 0));
  const vt = Math.sqrt(pairs.reduce((s, [, t]) => s + (t - mt) ** 2, 0));
  const r = vf && vt ? cov / (vf * vt) : 0;
  return { n, mae, rmse, r, bias: mf - mt };
}

const pad = (s, w) => String(s) + " ".repeat(Math.max(0, w - [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 0x1100 ? 2 : 1), 0)));

for (const v of VARS) {
  console.log(`■ ${v}`);
  console.log(`  ${pad("予報の出し手", 16)} ${pad("MAE", 7)} ${pad("RMSE", 7)} ${pad("相関", 6)} ${pad("偏り", 7)}`);
  const rows = [];
  for (const m of available) {
    const pairs = samples.filter((s) => s.byModel[m]).map((s) => [s.byModel[m][v], s.truth[v]]);
    rows.push([S.MODEL_NAMES[m], stats(pairs)]);
  }
  // アンサンブル中央値（このアプリが採用している値）
  const medPairs = samples.map((s) => {
    const vals = Object.values(s.byModel).map((f) => f[v]);
    return [S.Curve.median(vals), s.truth[v]];
  });
  rows.push(["★中央値（本アプリ）", stats(medPairs)]);
  // 参考: 単純平均
  const avgPairs = samples.map((s) => {
    const vals = Object.values(s.byModel).map((f) => f[v]);
    return [vals.reduce((a, b) => a + b, 0) / vals.length, s.truth[v]];
  });
  rows.push(["（参考）単純平均", stats(avgPairs)]);

  rows.sort((a, b) => (a[1]?.mae ?? 999) - (b[1]?.mae ?? 999));
  for (const [name, st] of rows) {
    if (!st) { console.log(`  ${pad(name, 16)} —`); continue; }
    console.log(`  ${pad(name, 16)} ${pad(st.mae.toFixed(2), 7)} ${pad(st.rmse.toFixed(2), 7)} ${pad(st.r.toFixed(3), 6)} ${pad((st.bias >= 0 ? "+" : "") + st.bias.toFixed(2), 7)}`);
  }
  console.log("");
}
