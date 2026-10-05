/*
 * 視線の先の気象はどれだけ効くか（2026-10-05）
 *
 * 実際の撮影ライン（観測点→目標→その先）に沿って、気象モデル（Open-Meteo 過去予報・JMA）の
 * 気温の柱を並べた場を「正解」とし、次と比べる。
 *   観測点の柱だけ … 観測点の上空の気温の高さ分布を、視線の先まで同じとみなす
 *   現行の気象予報 … 天体は Sæmundsson（観測点の地上気温・気圧）、目標は k=7/6
 *   標準           … 天体は Sæmundsson（1010hPa/10℃）、目標は k=7/6
 * 比べる量は「目標に天体が重なるときの天体の真高度」（海の地平線の場合は、天体の中心が地平線に接する真高度）。
 * 海の上の点は海面水温（Open-Meteo 海洋）を地表面の温度に置く。陸は地上2mより下を一様とする。
 *
 * 使い方: node study-refraction-path.mjs [開始日 終了日] [出力.json]
 */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const RF = require("./sorami-refraction.js");
const A = require("./sorami-astro.js");
const T = require("./sorami-terrain.js");
const L = require("./sorami-align.js");

const start = process.argv[2] || "2025-10-01", end = process.argv[3] || "2026-09-30", outPath = process.argv[4];
const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300];
const R_GAS_G = 287.05 / 9.80665, EYE = 1.5;
const BEYOND = [10, 25, 50, 100, 200];
const sky = L.targetById("skytree"), fuji = L.targetById("fuji");
const CASES = [
  { id: "鷺沼北公園→スカイツリー", obs: { latitude: 35.58426157, longitude: 139.5685059, groundM: 79 }, target: { latitude: sky.latitude, longitude: sky.longitude, topM: sky.parts[0].m } },
  { id: "江の島→富士山", obs: { latitude: 35.2997, longitude: 139.48, groundM: 5 }, target: { latitude: fuji.latitude, longitude: fuji.longitude, topM: fuji.parts[0].m } },
  { id: "海浜幕張→富士山", obs: { latitude: 35.6485, longitude: 140.0345, groundM: 5 }, target: { latitude: fuji.latitude, longitude: fuji.longitude, topM: fuji.parts[0].m } },
  { id: "九十九里（片貝）→東の海の地平線", obs: { latitude: 35.5325, longitude: 140.4636, groundM: 5 }, azimuth: 90 },
];
const HOURS_UTC = [21, 8, 12]; // 6時・17時・21時（日本時間）

const cacheDir = new URL("./data/refraction-cache/", import.meta.url);
fs.mkdirSync(cacheDir, { recursive: true });
async function getJSON(url, file) {
  const f = new URL(file, cacheDir);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url);
    if (r.ok) { const j = await r.json(); fs.writeFileSync(f, JSON.stringify(j)); return j; }
    if (r.status !== 429) throw Error(r.status + " " + (await r.text()).slice(0, 200));
    await new Promise((ok) => setTimeout(ok, 60000));
  }
  throw Error("429が続きました");
}
const heights = (levels, z0) => {
  let z = z0, prev = null;
  return levels.sort((a, b) => b.pHPa - a.pHPa).map((l) => {
    if (prev) z += R_GAS_G * ((prev.t + l.t) / 2 + 273.15) * Math.log(prev.pHPa / l.pHPa);
    prev = l;
    return { z, t: l.t };
  });
};
function column(h, i, groundM, sst) {
  const t2 = h.temperature_2m[i], ps = h.surface_pressure[i];
  if (!Number.isFinite(t2) || !Number.isFinite(ps)) return null;
  const lv = [{ pHPa: ps, t: t2 }];
  for (const l of LEVELS) { const t = h[`temperature_${l}hPa`][i]; if (Number.isFinite(t) && l < ps - 1) lv.push({ pHPa: l, t }); }
  if (lv.length < 4) return null;
  return { groundM, pressureHPa: ps * Math.exp(2 / (R_GAS_G * (t2 + 273.15))), points: heights(lv, groundM + 2), surfaceT: Number.isFinite(sst) ? sst : undefined, t2, ps };
}
const sae = (t, p, c) => A.refraction(t, { pressureHPa: p, temperatureC: c });
function formulaTrue(app, p, c) {
  let lo = app - 3, hi = app + 0.1;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (m + sae(m, p, c) < app) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
const rows = [];
for (const c of CASES) {
  const o = c.obs, h0 = o.groundM + EYE;
  const d = c.target ? T.distanceKm(o.latitude, o.longitude, c.target.latitude, c.target.longitude) : 0;
  const az = c.target ? T.bearing(o.latitude, o.longitude, c.target.latitude, c.target.longitude) : c.azimuth;
  const ss = [...new Set([0, ...(d ? [d / 2, d] : []), ...BEYOND.map((b) => d + b)].map((x) => +x.toFixed(3)))].sort((a, b) => a - b);
  const pts = ss.map((s) => (s ? T.destination(o.latitude, o.longitude, az, s) : { lat: o.latitude, lon: o.longitude }));
  const lat = pts.map((p) => (p.lat ?? p.latitude).toFixed(4)).join(","), lon = pts.map((p) => (p.lon ?? p.longitude).toFixed(4)).join(",");
  const hourly = ["temperature_2m", "surface_pressure", ...LEVELS.map((l) => `temperature_${l}hPa`)].join(",");
  const key = c.id.replace(/[^\p{L}\p{N}]+/gu, "_");
  const wx = await getJSON(`https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${hourly}&models=jma_seamless&start_date=${start}&end_date=${end}&timezone=UTC&timeformat=unixtime`, `path-${key}-${start}-${end}.json`);
  const sea = await getJSON(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=sea_surface_temperature&start_date=${start}&end_date=${end}&timezone=UTC&timeformat=unixtime`, `sst-${key}-${start}-${end}.json`).catch(() => null);
  const W = Array.isArray(wx) ? wx : [wx], SEA = sea ? (Array.isArray(sea) ? sea : [sea]) : [];
  const ground = W.map((w, i) => (i === 0 ? o.groundM : Math.max(0, w.elevation)));
  console.error(c.id, `距離${d.toFixed(1)}km 方位${az.toFixed(1)}° 柱`, ss.map((s, i) => `${s.toFixed(0)}km:${ground[i]}m${W[i].elevation <= 0 ? "(海)" : ""}`).join(" "));
  const times = W[0].hourly.time;
  for (let i = 0; i < times.length; i++) {
    if (!HOURS_UTC.includes(new Date(times[i] * 1000).getUTCHours())) continue;
    const cols = [];
    for (let j = 0; j < W.length; j++) {
      const sstJ = W[j].elevation <= 0 ? SEA[j]?.hourly?.sea_surface_temperature?.[SEA[j].hourly.time.indexOf(times[i])] : undefined;
      const col = column(W[j].hourly, i, ground[j], sstJ);
      if (col) cols.push({ s: ss[j] * 1000, ...col });
    }
    if (cols.length !== W.length) continue;
    const full = RF.field(cols), obsOnly = RF.field([{ ...cols[0], s: 0 }]);
    const row = { at: new Date(times[i] * 1000).toISOString(), case: c.id };
    const pObs = cols[0].ps * Math.exp(-EYE / (R_GAS_G * (cols[0].t2 + 273.15)));
    if (c.target) {
      const q = (F) => { const e = RF.targetElevation(F, h0, d * 1000, c.target.topM); if (e == null) return null; const r = RF.trace(F, h0, e); return r.hit ? null : { app: e, tru: r.trueAltitude }; };
      const qf = q(full), qo = q(obsOnly);
      if (!qf || !qo) continue;
      const appK = A.targetElevationAngle(d, h0, c.target.topM, { k: 7 / 6 });
      row.truthApp = qf.app;
      row.obsOnly = (qo.tru - qf.tru) * 60;
      row.surfaceModel = (formulaTrue(appK, pObs, cols[0].t2) - qf.tru) * 60;
      row.standard = (formulaTrue(appK, 1010, 10) - qf.tru) * 60;
      row.appObsOnly = (qo.app - qf.app) * 60;
      row.appK = (appK - qf.app) * 60;
    } else {
      // 海の地平線: 中心が地平線に接するときの真高度
      const hz = (F) => { const dip = RF.dip(F, h0); const r = RF.trace(F, h0, -dip + 1e-4); return { dip, tru: r.trueAltitude }; };
      const hf = hz(full), ho = hz(obsOnly);
      const dipK = Math.acos(1 / (1 + h0 / (6371008.8 * 7 / 6))) / Math.PI * 180;
      row.truthApp = -hf.dip;
      row.obsOnly = (ho.tru - hf.tru) * 60;
      row.surfaceModel = (formulaTrue(-dipK, pObs, cols[0].t2) - hf.tru) * 60;
      row.standard = (formulaTrue(-dipK, 1010, 10) - hf.tru) * 60;
      row.appObsOnly = (-ho.dip + hf.dip) * 60;
      row.appK = (-dipK + hf.dip) * 60;
      row.sstMinusAir = (cols.find((x) => Number.isFinite(x.surfaceT))?.surfaceT ?? NaN) - cols[0].t2;
    }
    rows.push(row);
  }
}
const qtl = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
const stat = (xs) => { xs = xs.filter(Number.isFinite); const n = xs.length; if (!n) return { n }; return { n, mean: +(xs.reduce((a, b) => a + b, 0) / n).toFixed(3), rms: +Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / n).toFixed(3), p05: +qtl(xs, 0.05).toFixed(3), p95: +qtl(xs, 0.95).toFixed(3), maxAbs: +Math.max(...xs.map(Math.abs)).toFixed(3) }; };
const summary = {};
for (const c of CASES) {
  const xs = rows.filter((r) => r.case === c.id);
  summary[c.id] = { n: xs.length, truthAppMean: +(xs.reduce((a, r) => a + r.truthApp, 0) / xs.length).toFixed(3) };
  for (const k of ["obsOnly", "surfaceModel", "standard", "appObsOnly", "appK"]) summary[c.id][k] = stat(xs.map((r) => r[k]));
  for (const hh of ["21", "08", "12"]) {
    const ys = xs.filter((r) => r.at.slice(11, 13) === hh);
    summary[c.id]["h" + hh] = Object.fromEntries(["obsOnly", "surfaceModel", "standard"].map((k) => [k, stat(ys.map((r) => r[k]))]));
  }
}
console.log(JSON.stringify(summary, null, 1));
if (outPath) fs.writeFileSync(outPath, JSON.stringify({ summary, rows }, null, 1));
