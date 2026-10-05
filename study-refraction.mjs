/*
 * 天体を重ねるときに、大気でどれだけずれるか（2026-10-05）
 *
 * 館野（つくば）の高層気象観測（IGRA2 JAM00047646）の気温の柱で光線追跡したものを「正解」とし、
 * 同じ時刻について次の4つを比べる。
 *   標準       … 現行の「標準」。天体は Sæmundsson（1010hPa/10℃）、目標は k=7/6
 *   予報の地上 … 現行の「気象予報」。天体は Sæmundsson にモデルの地上気温・気圧、目標は k=7/6
 *   観測の地上 … 現行の「気象予報」が地上の値を完全に当てた場合（観測の地上値を入れる）
 *   予報の柱   … 新方式。モデルの気温の柱（地上2m＋気圧面）で光線追跡
 * 比べる量は「目標のてっぺんに天体が重なるときの天体の真高度」。これがずれると重なる時刻がずれる。
 * モデルは Open-Meteo の過去予報（JMA MSM）。観測の時刻は気球を同化した直後なので、
 * 予報の柱の成績は「当日〜前日の予報」の上限に近い（数日前の予報はこれより外れる）。
 *
 * 使い方: node study-refraction.mjs <IGRA2のデータ.txt> [出力.json]
 */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const RF = require("./sorami-refraction.js");
const A = require("./sorami-astro.js");

const [, , sondePath, outPath] = process.argv;
if (!sondePath) { console.error("使い方: node study-refraction.mjs <IGRA2.txt> [out.json]"); process.exit(2); }
const STATION = { latitude: 36.0581, longitude: 140.1258, groundM: 31 };
const EYE = 1.5;
const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300];
const R_GAS_G = 287.05 / 9.80665;

// ---- 観測（IGRA2）
function readSondes(text) {
  const out = [];
  let cur = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("#")) {
      const [y, m, d, hh] = [line.slice(13, 17), line.slice(18, 20), line.slice(21, 23), line.slice(24, 26)].map(Number);
      cur = { at: Date.UTC(y, m - 1, d, hh), levels: [] };
      out.push(cur);
      continue;
    }
    if (!cur || line.length < 40) continue;
    const typ2 = line[1], p = +line.slice(9, 15), z = +line.slice(16, 21), t = +line.slice(22, 27);
    if (p <= 0 || t === -9999 || t === -8888) continue;
    cur.levels.push({ surface: typ2 === "1", pHPa: p / 100, gph: z > -8888 ? z : null, t: t / 10 });
  }
  return out;
}
/// 気圧と気温の並びから高さを静水圧で積む（観測は有意層に高さが無いため）
function heights(levels, groundM, surfacePHPa) {
  const ls = levels.filter((l) => l.pHPa <= surfacePHPa + 0.05).sort((a, b) => b.pHPa - a.pHPa);
  let z = groundM, prev = null;
  const out = [];
  for (const l of ls) {
    if (prev) z += R_GAS_G * ((prev.t + l.t) / 2 + 273.15) * Math.log(prev.pHPa / l.pHPa);
    out.push({ z, t: l.t, pHPa: l.pHPa });
    prev = l;
  }
  return out;
}
function sondeColumn(s) {
  const sfc = s.levels.find((l) => l.surface);
  if (!sfc) return null;
  const pts = heights(s.levels, STATION.groundM + 2, sfc.pHPa).filter((p) => p.pHPa >= 250);
  if (pts.length < 8 || pts[pts.length - 1].pHPa > 400) return null;
  return { groundM: STATION.groundM, pressureHPa: sfc.pHPa * Math.exp(2 / (R_GAS_G * (sfc.t + 273.15))), points: pts, surfaceT2: sfc.t, surfaceP: sfc.pHPa };
}

// ---- モデル（Open-Meteo 過去予報）
const cacheDir = new URL("./data/refraction-cache/", import.meta.url);
fs.mkdirSync(cacheDir, { recursive: true });
async function model(start, end) {
  const file = new URL(`tateno-${start}-${end}.json`, cacheDir);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const hourly = ["temperature_2m", "surface_pressure", ...LEVELS.map((l) => `temperature_${l}hPa`)].join(",");
  const q = new URLSearchParams({ latitude: STATION.latitude, longitude: STATION.longitude, elevation: STATION.groundM,
    hourly, models: "jma_seamless", start_date: start, end_date: end, timezone: "UTC", timeformat: "unixtime" });
  const r = await fetch("https://historical-forecast-api.open-meteo.com/v1/forecast?" + q);
  if (!r.ok) throw Error("model " + r.status + " " + (await r.text()).slice(0, 200));
  const j = await r.json();
  fs.writeFileSync(file, JSON.stringify(j));
  return j;
}
/// モデルの柱。地面より下に外挿された気圧面（地上気圧より大きい面）は使わない
function modelColumn(h, i, groundM) {
  const t2 = h.temperature_2m[i], ps = h.surface_pressure[i];
  if (!Number.isFinite(t2) || !Number.isFinite(ps)) return null;
  const lv = [{ pHPa: ps, t: t2 }];
  for (const l of LEVELS) { const t = h[`temperature_${l}hPa`][i]; if (Number.isFinite(t) && l < ps - 1) lv.push({ pHPa: l, t }); }
  if (lv.length < 8) return null;
  return { groundM, pressureHPa: ps * Math.exp(2 / (R_GAS_G * (t2 + 273.15))), points: heights(lv, groundM + 2, ps), surfaceT2: t2, surfaceP: ps };
}

// ---- 比べる量
const TARGETS = [
  { id: "塔634m・3km", d: 3000, top: 634 },
  { id: "塔634m・20km", d: 20000, top: 634 },
  { id: "塔333m・25km", d: 25000, top: 333 },
  { id: "山3776m・70km", d: 70000, top: 3776 },
  { id: "山3776m・150km", d: 150000, top: 3776 },
];
const sae = (t, p, c) => A.refraction(t, { pressureHPa: p, temperatureC: c });
/// 式の方式: 目標は k=7/6、天体は Sæmundsson。目標の見かけの角に見かけの位置が来る真高度を解く
function formulaTrue(appTarget, p, c) {
  let lo = appTarget - 2, hi = appTarget;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (m + sae(m, p, c) < appTarget) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
function formula(target, h0, p, c) {
  const app = A.targetElevationAngle(target.d / 1000, h0, STATION.groundM + target.top, { k: 7 / 6 });
  return { app, trueAlt: formulaTrue(app, p, c) };
}
function traced(F, target, h0) {
  const app = RF.targetElevation(F, h0, target.d, STATION.groundM + target.top);
  if (app == null) return null;
  const r = RF.trace(F, h0, app);
  return r.hit ? null : { app, trueAlt: r.trueAltitude };
}
const BODY_APPS = [0, 0.5, 1, 2, 5];

const text = fs.readFileSync(sondePath, "utf8");
const sondes = readSondes(text).filter((s) => s.at >= Date.UTC(2026, 0, 1));
const first = new Date(sondes[0].at).toISOString().slice(0, 10), last = new Date(sondes[sondes.length - 1].at).toISOString().slice(0, 10);
const M = await model(first, last), MH = M.hourly;
const rows = [];
const h0 = STATION.groundM + EYE;
for (const s of sondes) {
  const sc = sondeColumn(s);
  const i = MH.time.indexOf(s.at / 1000);
  const mc = i >= 0 ? modelColumn(MH, i, STATION.groundM) : null;
  if (!sc || !mc) continue;
  const Fs = RF.field([{ s: 0, ...sc }]), Fm = RF.field([{ s: 0, ...mc }]);
  const row = { at: new Date(s.at).toISOString(), sfc: { t: sc.surfaceT2, p: sc.surfaceP }, mdl: { t: mc.surfaceT2, p: mc.surfaceP }, targets: {}, body: {} };
  // 地表付近の気温の傾き（地上→約300m）。逆転の強さの目安
  const t300 = (col) => col.points.find((p) => p.z - STATION.groundM >= 250) || col.points[1];
  row.lapse = { sonde: (t300(sc).t - sc.surfaceT2) / (t300(sc).z - STATION.groundM - 2) * 1000, model: (t300(mc).t - mc.surfaceT2) / (t300(mc).z - STATION.groundM - 2) * 1000 };
  for (const tg of TARGETS) {
    const truth = traced(Fs, tg, h0);
    if (!truth) continue;
    const m = traced(Fm, tg, h0);
    const std = formula(tg, h0, 1010, 10), now = formula(tg, h0, mc.surfaceP * Math.exp(-EYE / (R_GAS_G * (mc.surfaceT2 + 273.15))), mc.surfaceT2);
    const ideal = formula(tg, h0, sc.surfaceP, sc.surfaceT2);
    row.targets[tg.id] = {
      truthApp: truth.app, truthTrue: truth.trueAlt,
      // 真高度の差（分）。正なら、その方式では実際より高い位置で重なると予測している
      standard: (std.trueAlt - truth.trueAlt) * 60, surfaceModel: (now.trueAlt - truth.trueAlt) * 60,
      surfaceObserved: (ideal.trueAlt - truth.trueAlt) * 60, column: m ? (m.trueAlt - truth.trueAlt) * 60 : null,
      // 目標そのものの見かけの角（構図の中で目標が何分ずれて見えるか）
      appStandard: (std.app - truth.app) * 60, appColumn: m ? (m.app - truth.app) * 60 : null,
    };
  }
  for (const a of BODY_APPS) {
    const t = RF.trace(Fs, h0, a);
    if (t.hit) continue;
    const m = RF.trace(Fm, h0, a);
    row.body[a] = { truth: t.refraction * 60, standard: sae(t.trueAltitude, 1010, 10) * 60 - t.refraction * 60,
      surfaceModel: sae(t.trueAltitude, mc.surfaceP, mc.surfaceT2) * 60 - t.refraction * 60,
      column: m.hit ? null : m.refraction * 60 - t.refraction * 60 };
  }
  rows.push(row);
}

// ---- 集計
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
const stat = (xs) => {
  xs = xs.filter(Number.isFinite);
  const n = xs.length, mean = xs.reduce((a, b) => a + b, 0) / n, rms = Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / n);
  return { n, mean: +mean.toFixed(3), rms: +rms.toFixed(3), p05: +q(xs, 0.05).toFixed(3), p95: +q(xs, 0.95).toFixed(3), maxAbs: +Math.max(...xs.map(Math.abs)).toFixed(3) };
};
const summary = { sondes: rows.length, period: [first, last], targets: {}, body: {}, byHour: {} };
for (const tg of TARGETS) {
  const xs = rows.map((r) => r.targets[tg.id]).filter(Boolean);
  summary.targets[tg.id] = { truthAppMean: +(xs.reduce((a, x) => a + x.truthApp, 0) / xs.length).toFixed(3) };
  for (const k of ["standard", "surfaceModel", "surfaceObserved", "column", "appStandard", "appColumn"]) summary.targets[tg.id][k] = stat(xs.map((x) => x[k]));
  for (const hh of ["00", "12"]) {
    const ys = rows.filter((r) => r.at.slice(11, 13) === hh).map((r) => r.targets[tg.id]).filter(Boolean);
    summary.byHour[`${tg.id} ${hh}UTC`] = Object.fromEntries(["standard", "surfaceModel", "column"].map((k) => [k, stat(ys.map((y) => y[k]))]));
  }
}
for (const a of BODY_APPS) {
  const xs = rows.map((r) => r.body[a]).filter(Boolean);
  summary.body[a] = Object.fromEntries(["truth", "standard", "surfaceModel", "column"].map((k) => [k, stat(xs.map((x) => x[k]))]));
}
console.log(JSON.stringify(summary, null, 1));
if (outPath) fs.writeFileSync(outPath, JSON.stringify({ summary, rows }, null, 1));
