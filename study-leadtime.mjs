/*
 * 「何日前の予測か」で点数がどれだけ外れるかを測る。
 *
 * これまで「数日先のスコア誤差は測れていない」としてきた（02_検証結果の未検証表）。
 * 理由は「アンサンブルに過去アーカイブが無く、previous-runs には雲の層別が無い」。
 * 前半は正しいが、後半は**測れない理由になっていなかった**。
 * 層別が無いのは夕焼け・朝焼けの話で、星空は総雲量・降水・湿度だけで採点している。
 * それらには過去実行がある（2026-09-06 実測。層別の雲と視程だけが欠測）。
 *
 * 方法:
 *   予測 = previous-runs-api の `_previous_dayN`（N日前に出した、その時刻への予測）
 *   実況 = ERA5 再解析
 *   星空のスコアを両方で計算し、リードタイム別の平均絶対誤差とランクのずれを出す。
 *
 * 限界:
 *   - 気象庁MSMだけ過去実行が無い。7モデル中6モデルの中央値で測っている
 *   - ERA5 は観測ではない。総雲量の真値としての不確かさは大きい
 *   - 光害・標高・月は決定論的なので、ここで測っているのは気象部分の誤差
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");

const VARS = ["cloud_cover", "precipitation", "relative_humidity_2m"];
const LEADS = [0, 1, 2, 3, 4, 5];
const MODELS = S.MODELS.filter((m) => m !== "jma_msm");   // MSM は過去実行が無い
const SITES = [
  { name: "陸別", lat: 43.46894, lon: 143.74718, elevation: 212 },
  { name: "野辺山高原", lat: 35.9553, lon: 138.47465, elevation: 1346 },
  { name: "美星天文台", lat: 34.67203, lon: 133.54539, elevation: 421 },
  { name: "富士見台高原", lat: 35.48204, lon: 137.62919, elevation: 1718 },
  { name: "南阿蘇村", lat: 32.84694, lon: 131.03258, elevation: 441 },
  { name: "室戸岬", lat: 33.24358, lon: 134.17683, elevation: 3 },
  { name: "東京", lat: 35.6812, lon: 139.7671, elevation: 10 },
  { name: "札幌", lat: 43.0621, lon: 141.3544, elevation: 20 },
];
const PAST_DAYS = Number(process.argv[2] || 60);

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
const hourlyNames = () => {
  const out = [];
  for (const v of VARS) for (const n of LEADS) out.push(n === 0 ? v : `${v}_previous_day${n}`);
  return out;
};

console.log(`過去${PAST_DAYS}日 ／ ${SITES.length}地点 ／ ${MODELS.length}モデル`);
console.log(`予測: previous-runs-api の N日前実行 ／ 実況: ERA5\n`);

// --- 各モデルの、リードタイム別シリーズ
const byModelLead = {};   // [model][lead][siteIndex] = Series
for (const m of MODELS) {
  const p = new URLSearchParams({
    latitude: SITES.map((s) => s.lat).join(","), longitude: SITES.map((s) => s.lon).join(","),
    hourly: hourlyNames().join(","), timezone: "auto", timeformat: "unixtime",
    past_days: String(PAST_DAYS), forecast_days: "1", models: m,
  });
  try {
    const raw = asList(await getJSON(`https://previous-runs-api.open-meteo.com/v1/forecast?${p}`));
    byModelLead[m] = {};
    for (const lead of LEADS) {
      byModelLead[m][lead] = raw.map((payload) => {
        const times = payload.hourly.time.map((t) => t * 1000);
        const columns = {};
        for (const v of VARS) {
          const key = lead === 0 ? v : `${v}_previous_day${lead}`;
          const col = payload.hourly[`${key}_${m}`] ?? payload.hourly[key];
          if (col && col.some((x) => x !== null)) columns[v] = col;
        }
        return Object.keys(columns).length === VARS.length ? new S.Series(times, columns) : null;
      });
    }
    process.stdout.write(`  ${S.MODEL_NAMES[m]}\n`);
  } catch (e) { process.stdout.write(`  ${S.MODEL_NAMES[m]} 取得できず（${e.message}）\n`); }
  await new Promise((r) => setTimeout(r, 1500));
}
// リードごとにモデルの顔ぶれが変わると、誤差の増え方がモデル差と混ざる。
// 全リードで揃うモデルだけに絞る。ARPEGE は4日前より先の過去実行を持たない（実測）。
const available = MODELS.filter((m) => byModelLead[m]
  && LEADS.every((l) => byModelLead[m][l].every(Boolean)));
const dropped = MODELS.filter((m) => byModelLead[m] && !available.includes(m));
if (dropped.length) {
  console.log(`\n先のリードの過去実行が無いため除外: ${dropped.map((m) => S.MODEL_NAMES[m]).join("・")}`);
}
console.log(`使うモデル: ${available.map((m) => S.MODEL_NAMES[m]).join("・")}`);

// --- 実況（ERA5）
const end = new Date(Date.now() - 3 * 86400000);
const start = new Date(end.getTime() - PAST_DAYS * 86400000);
const iso = (d) => d.toISOString().slice(0, 10);
const truthRaw = asList(await getJSON("https://archive-api.open-meteo.com/v1/archive?" + new URLSearchParams({
  latitude: SITES.map((s) => s.lat).join(","), longitude: SITES.map((s) => s.lon).join(","),
  start_date: iso(start), end_date: iso(end),
  hourly: VARS.join(","), timezone: "auto", timeformat: "unixtime", models: "era5",
})));
const truth = truthRaw.map((p) => new S.Series(p.hourly.time.map((t) => t * 1000),
  Object.fromEntries(VARS.map((v) => [v, p.hourly[v]]))));

// --- 星空のスコアを、実況と各リードタイムで計算する
const scoreWith = (series, site, dayMs) => {
  const input = { home: series, offsets: {}, lat: site.lat, lon: site.lon, terrain: null,
                  elevation: site.elevation, lightPollution: null, air: null };
  const win = S.SCORERS.starrySky.window(dayMs, input);
  if (!win) return null;
  const r = S.SCORERS.starrySky.score(win, input);
  return r.unavailable ? null : r.score;
};

const diag = { truthNull: 0, seriesNull: 0, scoreNull: 0, leadShort: 0, ok: 0 };
const samples = [];   // { lead: {score}, truth }
for (let si = 0; si < SITES.length; si++) {
  for (let d = 0; d < PAST_DAYS; d++) {
    const dayMs = start.getTime() + d * 86400000;
    const t = scoreWith(truth[si], SITES[si], dayMs);
    if (t === null) { diag.truthNull++; continue; }
    const row = { site: SITES[si].name, truth: t, byLead: {} };
    for (const lead of LEADS) {
      const series = available.map((m) => byModelLead[m][lead][si]);
      if (series.some((x) => !x)) { diag.seriesNull++; continue; }
      const scores = series.map((x) => scoreWith(x, SITES[si], dayMs)).filter((x) => x !== null);
      // 母数が揃わない標本は使わない（虹で踏んだ罠）
      if (scores.length !== available.length) { diag.scoreNull++; continue; }
      row.byLead[lead] = S.Curve.median(scores);
    }
    if (Object.keys(row.byLead).length === LEADS.length) { samples.push(row); diag.ok++; }
    else diag.leadShort++;
  }
}
console.log(`\n突き合わせ標本: ${samples.length}件（全${available.length}モデル×全リードが揃ったもの）`);
console.log(`  内訳: 実況欠測 ${diag.truthNull} / 予測シリーズ欠け ${diag.seriesNull} / `
  + `点数欠け ${diag.scoreNull} / リード不足 ${diag.leadShort} / 成立 ${diag.ok}\n`);
if (!samples.length) { console.log("標本が取れなかった"); process.exit(1); }

const pad = (s, w) => String(s) + " ".repeat(Math.max(0, w -
  [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 0x1100 ? 2 : 1), 0)));
console.log(`${pad("リードタイム", 14)} ${pad("平均絶対誤差", 14)} ${pad("偏り", 8)} `
  + `${pad("20点以上ずれ", 14)} ${pad("評価が変わる", 14)}`);
const rankOf = (v) => S.rankOf(v).key;
for (const lead of LEADS) {
  const errs = samples.map((s) => s.byLead[lead] - s.truth);
  const mae = errs.reduce((a, b) => a + Math.abs(b), 0) / errs.length;
  const bias = errs.reduce((a, b) => a + b, 0) / errs.length;
  const big = errs.filter((e) => Math.abs(e) >= 20).length / errs.length * 100;
  const rankMiss = samples.filter((s) => rankOf(s.byLead[lead]) !== rankOf(s.truth)).length
    / samples.length * 100;
  console.log(`${pad(lead === 0 ? "当日" : `${lead}日前`, 14)} ${pad(mae.toFixed(1) + "点", 14)} `
    + `${pad((bias >= 0 ? "+" : "") + bias.toFixed(1), 8)} `
    + `${pad(big.toFixed(0) + "%", 14)} ${pad(rankMiss.toFixed(0) + "%", 14)}`);
}
console.log(`\n読み方: 「評価が変わる」は圧巻/よく見える/そこそこ/期待薄 の区分がずれた割合。`);
console.log(`ユーザーが見るのはこの区分なので、点数の誤差より直接効く。`);
console.log(`注意: ERA5 は観測ではない。ここで測っているのは「再解析との差」。`);
