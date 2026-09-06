/*
 * X の公開実景投稿と、発表済み予報から計算した点数を照合する。
 *
 * X に投稿が無い日は「出なかった」とは扱わない。投稿された実景だけを
 * 正例の手がかりとして見るため、これは命中率ではなく陽性例の確認である。
 * 日付・現象・投稿URLを data/x-sightings.json に置いて実行する。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");

const SPOT = { name: "美の山公園", latitude: 36.05668, longitude: 139.11363,
               terrain: "basinRim", elevation: 571 };
const inputPath = process.argv[2] || "data/x-sightings.json";
const records = JSON.parse(readFileSync(inputPath, "utf8"))
  .filter((x) => x && x.date && x.phenomenon && x.url)
  .sort((a, b) => a.date.localeCompare(b.date) || a.phenomenon.localeCompare(b.phenomenon));
if (!records.length) throw new Error("観測記録がありません");

const phenomenonIds = new Set(Object.keys(S.SCORERS));
for (const r of records) {
  if (!phenomenonIds.has(r.phenomenon)) throw new Error(`未知の現象: ${r.phenomenon}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) throw new Error(`日付はYYYY-MM-DD: ${r.date}`);
}

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({ error: true, reason: "JSONではない応答" }));
    if (res.ok && !body.error) return body;
    if (body.reason && /limit/i.test(body.reason)) {
      await new Promise((resolve) => setTimeout(resolve, 20000 * (i + 1)));
      continue;
    }
    throw new Error(body.reason || `HTTP ${res.status}`);
  }
  throw new Error("リトライ上限");
}

const asList = (raw) => Array.isArray(raw) ? raw : [raw];
const iso = (date, deltaDays = 0) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
};
const dateMs = (date) => new Date(`${date}T03:00:00Z`).getTime();
const historicalURL = (coords, vars, start, end) => {
  const p = new URLSearchParams({
    latitude: coords.map((c) => c.latitude.toFixed(4)).join(","),
    longitude: coords.map((c) => c.longitude.toFixed(4)).join(","),
    start_date: start, end_date: end,
    hourly: vars.join(","), models: S.MODELS.join(","),
    timezone: "auto", timeformat: "unixtime",
  });
  return `https://historical-forecast-api.open-meteo.com/v1/forecast?${p}`;
};
const offsetKm = [6000, 15000, 30000].map((ft) => 1.32 * Math.sqrt(ft) * 1.609344);
const offsetsFor = (date, kind) => {
  const day = dateMs(date);
  const event = S.Sun.eventTime(kind === "sunrise" ? "sunrise" : "sunset", day,
                                SPOT.latitude, SPOT.longitude);
  const bearing = event === null ? (kind === "sunrise" ? 90 : 270)
    : S.Sun.position(event, SPOT.latitude, SPOT.longitude).azimuth;
  return offsetKm.map((km) => S.Geo.destination(SPOT.latitude, SPOT.longitude, bearing, km));
};
const toOffsets = (list) => Object.fromEntries(["low", "mid", "high"].map((k, i) => [k, list[i]]));

const dates = records.map((r) => r.date);
const start = iso(dates[0], -2), end = iso(dates.at(-1), 1);
const homeVars = [...S.HOME_VARS, ...S.PROFILE_VARS];
console.log(`地点 ${SPOT.name}（${SPOT.elevation}m）／ ${start} 〜 ${end} ／ ${records.length}件`);
const homeRaw = await getJSON(historicalURL([{ latitude: SPOT.latitude, longitude: SPOT.longitude }], homeVars, start, end));
const home = S.decodeLocation(asList(homeRaw)[0]);
S.setTimezoneOffset(asList(homeRaw)[0].utc_offset_seconds);

// 現象ごとに必要な方位側サンプルを、対象日ごとに取る。
const offsetBundles = new Map();
for (const r of records.filter((x) => x.phenomenon === "sunrise" || x.phenomenon === "sunset")) {
  if (offsetBundles.has(`${r.date}:${r.phenomenon}`)) continue;
  const raw = await getJSON(historicalURL(offsetsFor(r.date, r.phenomenon), S.OFFSET_VARS,
                                          iso(r.date, -1), iso(r.date, 1)));
  offsetBundles.set(`${r.date}:${r.phenomenon}`, toOffsets(asList(raw).map(S.decodeLocation)));
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const bundleFor = (r) => ({
  home,
  sunsetOffsets: r.phenomenon === "sunset" ? offsetBundles.get(`${r.date}:sunset`) : null,
  sunriseOffsets: r.phenomenon === "sunrise" ? offsetBundles.get(`${r.date}:sunrise`) : null,
  air: null, ensemble: null,
});
const rows = records.map((r) => {
  const ev = S.evaluate(r.phenomenon, dateMs(r.date), bundleFor(r), SPOT);
  return { ...r, score: ev?.unavailable ? null : ev?.score ?? null,
           rank: ev?.unavailable ? "対象外" : ev?.rank?.label ?? "—",
           unavailable: ev?.unavailable?.message ?? null };
});
const pad = (s, w) => String(s) + " ".repeat(Math.max(0, w - [...String(s)].length));
console.log(`\n${pad("日付", 12)} ${pad("現象", 12)} ${pad("点数", 8)} ${pad("評価", 10)} 根拠`);
for (const r of rows) {
  const score = r.score === null ? "—" : Math.round(r.score);
  console.log(`${pad(r.date, 12)} ${pad(r.phenomenon, 12)} ${pad(score, 8)} `
    + `${pad(r.rank, 10)} ${r.strength || ""} ${r.url}`);
}
console.log("\nXの投稿がある日だけを照合した正例チェックです。投稿がない日は判定していません。");
console.log(JSON.stringify(rows, null, 2));
