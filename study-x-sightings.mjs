/* 固定地点でXの実景を照合する。過去気象での参考再計算であり、当時の予報ではない。 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { SITE_VERSION, VALIDATION_SITES } from "./validation-sites.mjs";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");
const DAY = 86400000;
const sites = new Map(VALIDATION_SITES.map((s) => [s.id, s]));
const dayMs = (date) => Date.parse(`${date}T03:00:00Z`); // 国内地点の正午
const shift = (date, days) => new Date(dayMs(date) + days * DAY).toISOString().slice(0, 10);
const nonempty = (x) => typeof x === "string" && x.trim().length > 0;
export function validDate(date) {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(dayMs(date)) && new Date(dayMs(date)).toISOString().slice(0, 10) === date;
}

// 同じ期間の全日を先に列挙し、投稿なし・確認不能も台帳に残す。
export function makePlan(start, end) {
  if (!validDate(start) || !validDate(end) || end < start || dayMs(end) - dayMs(start) >= 366 * DAY) {
    throw new Error("期間は有効な日付の昇順で、366日以内にしてください");
  }
  const records = [];
  for (let date = start; date <= end; date = shift(date, 1)) {
    for (const site of VALIDATION_SITES) {
      // 後日投稿を拾う入口。検索の範囲は撮影日の根拠にならない。
      const q = `${site.search} filter:images since:${date} until:${shift(date, 8)}`;
      records.push({ siteId: site.id, date, phenomenon: site.phenomenon, status: "unreviewed",
        url: null, observedQuality: null,
        evidence: { location: "", date: "", window: "", imageReviewed: false },
        searchUrl: `https://x.com/search?${new URLSearchParams({ q, f: "live" })}` });
    }
  }
  return { schemaVersion: 2, siteVersion: SITE_VERSION, start, end,
    purpose: "空の染まり方の検証。水面の反射・構図・太陽が見えたことだけでは評価しない。",
    records };
}

export function prepareRecords(input) {
  if (!Array.isArray(input) && input?.siteVersion !== SITE_VERSION) {
    throw new Error("地点の版が違います。現在の固定地点で台帳を作り直してください");
  }
  const records = Array.isArray(input) ? input : input?.records;
  if (!Array.isArray(records)) throw new Error("records配列が必要です");
  const accepted = [], pending = [], seen = new Set();
  for (const r of records) {
    if (!r || typeof r !== "object") throw new Error("不正な記録です");
    const site = sites.get(r.siteId);
    let reason = null;
    if (r.status !== "confirmed") reason = r.reviewReason || "撮影根拠が未確認";
    else if (!site) reason = "固定検証地点が未指定、または対象外";
    else if (r.phenomenon !== site.phenomenon) reason = "地点の検証現象と不一致";
    else if (!validDate(r.date)) reason = "撮影日が無効";
    else if (!/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+(?:\?.*)?$/.test(r.url || "")) reason = "投稿URLが未確認";
    else if (!["none", "weak", "strong"].includes(r.observedQuality)) reason = "写真の染まり方が未評価";
    else if (!r.evidence || !["location", "date", "window"].every((key) => nonempty(r.evidence[key]))
      || r.evidence.imageReviewed !== true) reason = "場所・撮影日・朝夕・画像の確認根拠が不足";
    if (reason) { pending.push({ ...r, score: null, reviewReason: reason }); continue; }
    const key = `${site.id}:${r.date}:${r.phenomenon}`;
    // 1地点・1日・1現象は1件。複数投稿は人が同じ行の evidence にまとめる。
    if (seen.has(key)) throw new Error(`重複イベントを統合してください: ${key}`);
    seen.add(key);
    accepted.push({ ...r, site });
  }
  return { accepted, pending, total: records.length };
}

export function offsetsFor(site, date, kind) {
  S.setTimezoneOffset(9 * 3600);
  const event = S.Sun.eventTime(kind, dayMs(date), site.latitude, site.longitude);
  if (event === null) throw new Error("太陽の出没時刻がありません");
  const bearing = S.Sun.position(event, site.latitude, site.longitude).azimuth;
  return S.CLOUD_LAYERS.map((layer) => S.Geo.destination(site.latitude, site.longitude, bearing, layer.offsetKm));
}
export function historicalURL(coords, variables, start, end, elevation) {
  const params = new URLSearchParams({
    latitude: coords.map((c) => c.latitude.toFixed(5)).join(","),
    longitude: coords.map((c) => c.longitude.toFixed(5)).join(","),
    start_date: start, end_date: end, hourly: variables.join(","), models: S.MODELS.join(","),
    timezone: "Asia/Tokyo", timeformat: "unixtime", wind_speed_unit: "ms",
  });
  if (Number.isFinite(elevation)) params.set("elevation", String(elevation));
  return `https://historical-forecast-api.open-meteo.com/v1/forecast?${params}`;
}
async function getJSON(url) {
  // 無限再試行や大量連続取得を避け、失敗を台帳へ返す。次回は失敗分だけ再実行できる。
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const raw = await response.json();
  if (!response.ok || raw.error) throw new Error(raw.reason || `HTTP ${response.status}`);
  return raw;
}
const asList = (raw) => Array.isArray(raw) ? raw : [raw];
export async function loadBundle(site, date, kind, get = getJSON) {
  const start = shift(date, -1), end = shift(date, 1);
  const homeRaw = asList(await get(historicalURL([site], S.HOME_VARS, start, end, site.elevation)))[0];
  const offsetRaw = asList(await get(historicalURL(offsetsFor(site, date, kind), S.OFFSET_VARS, start, end)));
  if (offsetRaw.length !== S.CLOUD_LAYERS.length) throw new Error("太陽側3地点の応答が揃いません");
  const home = S.decodeLocation(homeRaw);
  if (!Object.keys(home.byModel).length) throw new Error("予報モデルがありません");
  const offsets = Object.fromEntries(S.CLOUD_LAYERS.map((layer, i) => [layer.key, S.decodeLocation(offsetRaw[i])]));
  return { home, sunsetOffsets: kind === "sunset" ? offsets : null,
    sunriseOffsets: kind === "sunrise" ? offsets : null, air: null, ensemble: null };
}
export async function compare(input, get = getJSON) {
  const { accepted, pending, total } = prepareRecords(input);
  const results = [];
  for (const r of accepted) {
    const { site, ...record } = r;
    try {
      const bundle = await loadBundle(site, r.date, r.phenomenon, get);
      S.setTimezoneOffset(9 * 3600);
      const ev = S.evaluate(r.phenomenon, dayMs(r.date), bundle, site);
      if (!ev || ev.unavailable) throw new Error(ev?.unavailable?.message || "採点できません");
      const offsets = r.phenomenon === "sunrise" ? bundle.sunriseOffsets : bundle.sunsetOffsets;
      for (const model of Object.keys(ev.perModel)) {
        for (const layer of ["low", "high"]) {
          const value = offsets[layer].byModel[model]?.mean(`cloud_cover_${layer}`, ...ev.window);
          if (value === null || value === undefined) throw new Error(`太陽側の雲が欠測: ${model}/${layer}`);
        }
      }
      results.push({ ...record, comparisonStatus: "reference", site,
        score: ev.score, rank: S.phrasing(r.phenomenon, ev.rank).label,
        window: ev.window.map((t) => new Date(t).toISOString()),
        perModel: ev.perModel, modelCount: Object.keys(ev.perModel).length,
        grid: bundle.home.grid, airQuality: "missing", forecastIssuedAt: null,
        dataMode: "historical-forecast-reconstruction", siteVersion: SITE_VERSION });
    } catch (error) {
      results.push({ ...record, site, comparisonStatus: "error", score: null, error: error.message });
    }
  }
  return { schemaVersion: 2, checkedAt: new Date().toISOString(), siteVersion: SITE_VERSION,
    warning: "過去気象で再計算した参考点。大気質未取得。当時表示した予報の再現・命中率ではありません。",
    counts: { planned: total, confirmed: accepted.length, pending: pending.length,
      calculated: results.filter((r) => r.comparisonStatus === "reference").length,
      failed: results.filter((r) => r.comparisonStatus === "error").length },
    results, pending };
}
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--sites") {
    for (const s of VALIDATION_SITES) console.log(`${s.phenomenon}\t${s.displayName || s.name}\t${s.region}\t${s.id}`);
    return;
  }
  if (args[0] === "--plan") {
    if (args.length !== 4) throw new Error("--plan 開始日 終了日 出力JSON");
    const plan = makePlan(args[1], args[2]);
    writeFileSync(args[3], JSON.stringify(plan, null, 2) + "\n", { flag: "wx" });
    console.log(`6地点 × ${(dayMs(args[2]) - dayMs(args[1])) / DAY + 1}日 = ${plan.records.length}件を未確認として作成: ${args[3]}`);
    return;
  }
  if (args.length > 2) throw new Error("入力JSON [出力JSON]、または --sites / --plan 開始日 終了日 出力JSON");
  const input = JSON.parse(readFileSync(args[0] || "data/x-sightings.json", "utf8"));
  const report = await compare(input);
  if (args[1]) writeFileSync(args[1], JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(report.warning);
  console.log(`対象${report.counts.planned} / 確認済${report.counts.confirmed} / 未確認${report.counts.pending} / 参考採点${report.counts.calculated} / 取得失敗${report.counts.failed}`);
  for (const r of report.results) console.log(`${r.date}\t${r.site.name}\t${r.phenomenon}\t${r.score === null ? "—" : Math.round(r.score)}\t${r.rank || r.error}`);
  if (report.counts.failed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
