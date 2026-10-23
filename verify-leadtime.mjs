/*
 * リードタイム（何日前の予報か）ごとの精度を測る。
 *
 * 週間予報が当日の予報より当たらないのは当然だが、本アプリの信頼度は
 * モデル間のばらつきだけで決めており、リードタイムを見ていない。
 * どれだけ劣化するのかを実測して、根拠のある補正値を得る。
 *
 * 材料: previous-runs-api の `_previous_dayN`（N日前に発表された予報）
 *       vs archive-api（ERA5 再解析）
 * 制約: 雲の層別（low/mid/high）は過去実行が保存されていない。
 *       全雲量と降水で代用する。
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./astronotes-core.js");

const LEADS = [0, 1, 2, 3, 4, 5, 6, 7];
const VARS = ["cloud_cover", "precipitation"];
const SITES = [
  { name: "札幌", lat: 43.06, lon: 141.35 }, { name: "仙台", lat: 38.27, lon: 140.87 },
  { name: "東京", lat: 35.68, lon: 139.77 }, { name: "新潟", lat: 37.90, lon: 139.02 },
  { name: "名古屋", lat: 35.18, lon: 136.91 }, { name: "大阪", lat: 34.69, lon: 135.50 },
  { name: "広島", lat: 34.39, lon: 132.46 }, { name: "高知", lat: 33.56, lon: 133.53 },
  { name: "福岡", lat: 33.59, lon: 130.40 }, { name: "那覇", lat: 26.21, lon: 127.68 },
];
const PAST_DAYS = Number(process.argv[2] || 14);

async function getJSON(url) {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url);
    const body = await res.json();
    if (res.ok && !body.error) return body;
    if (body.reason && /limit/i.test(body.reason)) { await new Promise((r) => setTimeout(r, 20000 * (i + 1))); continue; }
    throw new Error(body.reason || `HTTP ${res.status}`);
  }
  throw new Error("リトライ上限");
}
const asList = (raw) => (Array.isArray(raw) ? raw : [raw]);

// --- N日前の予報（層別が無いので全雲量と降水）
const hourly = [];
for (const v of VARS) {
  hourly.push(v);
  for (const L of LEADS) if (L > 0) hourly.push(`${v}_previous_day${L}`);
}
const prevRaw = asList(await getJSON("https://previous-runs-api.open-meteo.com/v1/forecast?" +
  new URLSearchParams({
    latitude: SITES.map((s) => s.lat).join(","), longitude: SITES.map((s) => s.lon).join(","),
    hourly: hourly.join(","), past_days: String(PAST_DAYS), forecast_days: "1",
    timezone: "auto", timeformat: "unixtime",
  })));

// --- 実況（ERA5）
const end = new Date(Date.now() - 2 * 86400000);
const start = new Date(end.getTime() - (PAST_DAYS + 2) * 86400000);
const iso = (d) => d.toISOString().slice(0, 10);
const truthRaw = asList(await getJSON("https://archive-api.open-meteo.com/v1/archive?" +
  new URLSearchParams({
    latitude: SITES.map((s) => s.lat).join(","), longitude: SITES.map((s) => s.lon).join(","),
    start_date: iso(start), end_date: iso(end), hourly: VARS.join(","),
    timezone: "auto", timeformat: "unixtime", models: "era5",
  })));

const series = (payload, key) => {
  const times = payload.hourly.time.map((t) => t * 1000);
  return new S.Series(times, { v: payload.hourly[key] || [] });
};

console.log(`リードタイム別の精度 ／ ${SITES.length}地点 × 過去${PAST_DAYS}日 ／ 日の入り時刻で比較`);
console.log("実況は ERA5 再解析。雲は層別が保存されていないため全雲量で代用\n");

for (const v of VARS) {
  console.log(`■ ${v === "cloud_cover" ? "全雲量" : "降水"}`);
  console.log("  何日前   MAE     RMSE    相関    標本");
  for (const L of LEADS) {
    const key = L === 0 ? v : `${v}_previous_day${L}`;
    const pairs = [];
    for (let si = 0; si < SITES.length; si++) {
      const f = series(prevRaw[si], key);
      const t = series(truthRaw[si], v);
      if (!f.isSupported("v")) continue;
      for (let d = -PAST_DAYS; d <= 0; d++) {
        const dayMs = Date.now() + d * 86400000;
        const sunset = S.Sun.eventTime("sunset", dayMs, SITES[si].lat, SITES[si].lon);
        if (sunset === null) continue;
        const fv = f.valueAt("v", sunset), tv = t.valueAt("v", sunset);
        if (fv === null || tv === null) continue;
        pairs.push([fv, tv]);
      }
    }
    if (!pairs.length) { console.log(`  ${L}日前   （データなし）`); continue; }
    const n = pairs.length;
    const mae = pairs.reduce((s, [f, t]) => s + Math.abs(f - t), 0) / n;
    const rmse = Math.sqrt(pairs.reduce((s, [f, t]) => s + (f - t) ** 2, 0) / n);
    const mf = pairs.reduce((s, [f]) => s + f, 0) / n, mt = pairs.reduce((s, [, t]) => s + t, 0) / n;
    const cov = pairs.reduce((s, [f, t]) => s + (f - mf) * (t - mt), 0);
    const vf = Math.sqrt(pairs.reduce((s, [f]) => s + (f - mf) ** 2, 0));
    const vt = Math.sqrt(pairs.reduce((s, [, t]) => s + (t - mt) ** 2, 0));
    const r = vf && vt ? cov / (vf * vt) : 0;
    console.log(`  ${L}日前   ${mae.toFixed(2).padStart(6)}  ${rmse.toFixed(2).padStart(6)}  ${r.toFixed(3).padStart(6)}  ${String(n).padStart(4)}`);
  }
  console.log("");
}
