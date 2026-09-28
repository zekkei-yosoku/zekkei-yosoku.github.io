/*
 * 崖の点検。すべての採点器に、1つの入力だけを細かく動かした値を流し、
 * **予報の誤差より小さな差で点が大きく跳ぶ所（崖）**が無いかを見る。
 *
 * 2026-09-29 に初めて流したとき、ダイヤモンドダストが −15.0℃ と −14.75℃ で 99→32点、
 * 星空が降水 0.1→0.15mm で 90→50点、盆地の雲海が 0.2→0.25mm で 90→25点、
 * 街の雲海が上空の湿度 89.5→90% で 89→55点 と崩れていた。予報の小さな揺れで答えが裏返る。
 *
 * 残してよい崖は、**理由を書いて下の ALLOWED に載せる**。黙って増やさない。
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };
// 残してよい崖と、その理由
const ALLOWED = {
  // 朝夕焼けの雨の上限（30点）。実写の定点カメラ737事象で決めた規則の番人で、
  // その資料で傾けたときの影響を測るまでは動かさない
  "sunset/precipitation": "実写の資料で測ってから",
  "sunrise/precipitation": "実写の資料で測ってから",
  // 虹は雨粒が無ければ出ない。**定義として**0から始まる
  "rainbow/precipitation": "雨が無ければ虹は無い（定義）",
  // 街の雲海の正解データは「雨なし」の朝。0.5mm まで傾けると評価期間の分離が下がった（0.866→0.857）
  "cityCloudSea/precipitation": "正解データの定義が雨なし",
};
const LIMIT = 15;
S.setTimezoneOffset(32400);
const day = Date.parse("2026-11-15T00:00:00+09:00");
const times = Array.from({ length: 96 }, (_, i) => day - 24 * 3600000 + i * 3600000);
const cols = (base) => {
  const c = {};
  for (const [k, v] of Object.entries(base)) c[k] = times.map(() => v);
  if (base.dewDep !== undefined) { c.dew_point_2m = times.map(() => base.temperature_2m - base.dewDep); delete c.dewDep; }
  return c;
};
const BASE = {
  temperature_2m: 10, dewDep: 3, relative_humidity_2m: 80, precipitation: 0, showers: 0, weather_code: 1,
  cloud_cover: 30, cloud_cover_low: 5, cloud_cover_mid: 20, cloud_cover_high: 40, visibility: 30000,
  wind_speed_10m: 2, wind_direction_10m: 0, surface_pressure: 1015, direct_radiation: 300,
  relative_humidity_925hPa: 60, relative_humidity_850hPa: 50, relative_humidity_700hPa: 40,
  relative_humidity_500hPa: 30, relative_humidity_300hPa: 30, relative_humidity_200hPa: 30,
};
const PER = {
  sunset: { input: {}, base: {} },
  sunrise: { input: {}, base: {} },
  starrySky: { input: { lightPollution: { mpsas: 21.5 } }, base: { cloud_cover: 10, cloud_cover_low: 0, cloud_cover_mid: 5, cloud_cover_high: 5, relative_humidity_2m: 60 } },
  seaOfClouds: { input: { terrain: "basinRim", elevation: 800, eyeElevation: 801.5 }, base: { dewDep: 0.8, relative_humidity_2m: 95, cloud_cover: 10 } },
  cityCloudSea: { input: { elevation: 3, eyeElevation: 353, eyeAGL: 350 }, base: { dewDep: 0.6, relative_humidity_2m: 96, cloud_cover_low: 100, cloud_cover: 100 } },
  rainbow: { input: {}, base: { precipitation: 1, cloud_cover: 60, direct_radiation: 300 } },
  rime: { input: { elevation: 1500, eyeElevation: 1501.5 }, base: { temperature_2m: -8, dewDep: 0.2, relative_humidity_2m: 98, wind_speed_10m: 3, visibility: 500 } },
  diamondDust: { input: { elevation: 300, eyeElevation: 301.5 }, base: { temperature_2m: -18, dewDep: 2, relative_humidity_2m: 88, cloud_cover: 5, wind_speed_10m: 1 } },
};
const SWEEPS = [
  ["cloud_cover", 0, 100, 1], ["cloud_cover_low", 0, 100, 1], ["cloud_cover_mid", 0, 100, 1], ["cloud_cover_high", 0, 100, 1],
  ["precipitation", 0, 3, 0.05], ["relative_humidity_2m", 30, 100, 0.5], ["dewDep", 0, 10, 0.1],
  ["temperature_2m", -25, 30, 0.25], ["wind_speed_10m", 0, 15, 0.1], ["visibility", 0, 50000, 100],
  ["direct_radiation", 0, 800, 5], ["relative_humidity_925hPa", 30, 100, 0.5],
];
for (const [id, cfg] of Object.entries(PER)) {
  const sc = S.SCORERS[id];
  for (const [v, lo, hi, step] of SWEEPS) {
    let prev = null, worst = { d: 0 };
    for (let x = lo; x <= hi + 1e-9; x += step) {
      const b = { ...BASE, ...cfg.base, [v]: +x.toFixed(4) };
      if (v === "temperature_2m" && b.dewDep === undefined) b.dewDep = 3;
      const home = new S.Series(times, cols(b));
      const input = { home, offsets: { sunset: home, sunrise: home }, lat: 35.7, lon: 139.7, terrain: null,
        elevation: 50, eyeElevation: 51.5, eyeAGL: 1.5, lightPollution: null, air: null, ...cfg.input };
      let r;
      try { const w = sc.window(day, input); r = w ? sc.score(w, input) : null; } catch (e) { r = { err: e.message }; }
      const s = r && !r.unavailable && !r.err && Number.isFinite(r.score) ? r.score : null;
      if (prev !== null && s !== null && Math.abs(s - prev.s) > worst.d) worst = { d: Math.abs(s - prev.s), from: prev.x, to: +x.toFixed(4), a: prev.s, b: s };
      if (s !== null) prev = { s, x: +x.toFixed(4) };
    }
    const key = `${id}/${v}`;
    const detail = worst.d ? `${worst.from}→${worst.to}: ${worst.a.toFixed(0)}→${worst.b.toFixed(0)}点` : "";
    if (ALLOWED[key]) console.log(`  --   ${key} は理由つきで許す（${ALLOWED[key]}）`, detail);
    else ok(worst.d < LIMIT, `${key} に ${LIMIT}点以上の崖が無い`, detail);
  }
}
console.log(`\n${fail === 0 ? "CLIFFS OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
