/*
 * 秩父の雲海予報（@chichibu_unkai）と、絶景予報の雲海スコアを突き合わせる。
 *
 * **これは真値との比較ではない。** 相手も予報であって観測ではない。
 * 一致しても正しさの証明にはならないが、食い違えば調べる価値のある信号になる。
 *
 * 相手は秩父在住の気象予報士が2017年から出しているもので、
 * 本人は結果（雲海が出たか）を持っているが公開していない。
 * 公開されているのは確率と、「70%超はほぼ出る／35%以下はほぼ出ない」という記述だけ。
 *
 * 地点: 美の山公園（秩父盆地の展望地）
 *   座標は OSM Nominatim、標高は Open-Meteo の 90m DEM から取得した実測値。
 *   相手の予報は「秩父地方」全体で、こちらは1点。粒度が違うことを踏まえて読む。
 *
 * 使い方:
 *   node study-chichibu.mjs chichibu-unkai-forecast.csv
 *   CSV は date と probability（または p）列を持つ（date は雲海が出る朝の日付）。
 *   JSON の [{"date":"2026-09-06","p":33}, ...] も受け付ける。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");

const SPOT = { name: "美の山公園", latitude: 36.05668, longitude: 139.11363,
               terrain: "basinRim", elevation: 571 };

const file = process.argv[2];
if (!file) { console.log("使い方: node study-chichibu.mjs <相手の予報CSV/JSON>"); process.exit(1); }
const rawInput = readFileSync(file, "utf8").trim();
const theirs = (rawInput.startsWith("[")
  ? JSON.parse(rawInput)
  : (() => {
      const lines = rawInput.split(/\r?\n/).filter(Boolean);
      const header = lines.shift().split(",");
      const ix = Object.fromEntries(header.map((name, i) => [name.trim(), i]));
      const probability = ix.p ?? ix.probability;
      if (ix.date === undefined || probability === undefined) {
        throw new Error("CSVには date と p または probability 列が必要です");
      }
      return lines.map((line) => {
        const cells = line.split(",");
        return { date: cells[ix.date]?.trim(), p: Number(cells[probability]) };
      });
    })())
  .filter((x) => x.date && Number.isFinite(x.p))
  .sort((a, b) => a.date.localeCompare(b.date));
if (!theirs.length) { console.log("予報が読めなかった"); process.exit(1); }

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

// 発表済み予報のアーカイブから、その朝を採点する。
// 前日の最高気温が要るので、範囲を1日手前から取る。
const start = new Date(new Date(theirs[0].date + "T00:00:00Z") - 2 * 86400000)
  .toISOString().slice(0, 10);
const end = theirs.at(-1).date;
console.log(`地点 ${SPOT.name}（${SPOT.elevation}m）／ 期間 ${start} 〜 ${end} ／ ${theirs.length}日`);

const byModel = {};
for (const m of S.MODELS) {
  const p = new URLSearchParams({
    latitude: String(SPOT.latitude), longitude: String(SPOT.longitude),
    start_date: start, end_date: end,
    // 現行アプリと同じく、雲海の天井（逆転層）を判定する気圧面も取る。
    // historical-forecast-api は models= と気圧面を併用できる。単一モデル指定時は
    // 変数名にモデル suffix が付かないため、下の読み出しは両方を受ける。
    hourly: [...S.HOME_VARS, ...S.PROFILE_VARS].join(","),
    timezone: "auto", timeformat: "unixtime", models: m,
  });
  try {
    const raw = await getJSON(`https://historical-forecast-api.open-meteo.com/v1/forecast?${p}`);
    const times = raw.hourly.time.map((t) => t * 1000);
    const columns = {};
    for (const v of [...S.HOME_VARS, ...S.PROFILE_VARS]) {
      const c = raw.hourly[`${v}_${m}`] ?? raw.hourly[v];
      if (c && c.some((x) => x !== null)) columns[v] = c;
    }
    if (Object.keys(columns).length) {
      byModel[m] = new S.Series(times, columns);
      if (raw.utc_offset_seconds !== undefined) S.setTimezoneOffset(raw.utc_offset_seconds);
    }
    process.stdout.write(`  ${S.MODEL_NAMES[m]}\n`);
  } catch (e) { process.stdout.write(`  ${S.MODEL_NAMES[m]} 取得できず（${e.message}）\n`); }
  await new Promise((r) => setTimeout(r, 1200));
}
const models = Object.keys(byModel);
if (!models.length) { console.log("予報が取れなかった"); process.exit(1); }

const bundle = { home: { grid: { latitude: SPOT.latitude, longitude: SPOT.longitude,
                                elevation: SPOT.elevation }, byModel },
                 sunsetOffsets: null, sunriseOffsets: null, air: null, ensemble: null };

const pad = (s, w) => String(s) + " ".repeat(Math.max(0, w -
  [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 0x1100 ? 2 : 1), 0)));
console.log(`\n${pad("朝", 12)} ${pad("相手", 8)} ${pad("絶景予報", 10)} ${pad("評価", 10)} 主な内訳`);

const rows = [];
for (const t of theirs) {
  const dayMs = new Date(t.date + "T00:00:00Z").getTime() - (S.Cal.startOfDay(0) === 0 ? 0 : 0);
  const ev = S.evaluate("seaOfClouds", new Date(t.date + "T03:00:00Z").getTime(), bundle, SPOT);
  if (!ev || ev.unavailable) {
    console.log(`${pad(t.date, 12)} ${pad(t.p + "%", 8)} ${pad("—", 10)} ${ev ? ev.unavailable.message : "採点できず"}`);
    continue;
  }
  const top = ev.factors.slice().sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, 3)
    .map((f) => `${f.label}${f.c >= 0 ? "+" : ""}${f.c.toFixed(0)}`).join(" / ");
  console.log(`${pad(t.date, 12)} ${pad(t.p + "%", 8)} ${pad(Math.round(ev.score), 10)} `
    + `${pad(S.phrasing("seaOfClouds", ev.rank).label, 10)} ${top}`);
  rows.push({ date: t.date, theirs: t.p, ours: ev.score });
}

if (rows.length >= 3) {
  const n = rows.length;
  const mx = rows.reduce((s, r) => s + r.theirs, 0) / n;
  const my = rows.reduce((s, r) => s + r.ours, 0) / n;
  const cov = rows.reduce((s, r) => s + (r.theirs - mx) * (r.ours - my), 0);
  const sx = Math.sqrt(rows.reduce((s, r) => s + (r.theirs - mx) ** 2, 0));
  const sy = Math.sqrt(rows.reduce((s, r) => s + (r.ours - my) ** 2, 0));
  const r = sx && sy ? cov / (sx * sy) : 0;
  console.log(`\n標本 ${n}件 ／ 相関 ${r.toFixed(2)} ／ 平均 相手 ${mx.toFixed(0)}%・こちら ${my.toFixed(0)}点`);
  // 相手の「70%超はほぼ出る／35%以下はほぼ出ない」に対して、こちらがどう出ているか
  const hi = rows.filter((x) => x.theirs > 70), lo = rows.filter((x) => x.theirs <= 35);
  if (hi.length) console.log(`  相手が70%超の日（${hi.length}件）: こちらの平均 ${(hi.reduce((s, x) => s + x.ours, 0) / hi.length).toFixed(0)}点`);
  if (lo.length) console.log(`  相手が35%以下の日（${lo.length}件）: こちらの平均 ${(lo.reduce((s, x) => s + x.ours, 0) / lo.length).toFixed(0)}点`);
  console.log(`\n注意: 相手も予報であって観測ではない。一致は正しさの証明にならない。`);
  console.log(`食い違う日を個別に見て、どちらの読みが物理的に妥当かを確かめるための材料。`);
}
