/*
 * 標高を渡さないことで、冬の現象をどれだけ見落としていたかを数える。
 *
 * 霧氷は気温 ≤ -5℃、ダイヤモンドダストは ≤ -15℃ が閾値。
 * モデルが数百メートル低い場所の気温を返していれば、閾値をまたぐ回数がそのまま変わる。
 * 2026年1〜2月の発表済み予報アーカイブで、同じ地点・同じ時刻を2通り取って数える。
 */
// 座標と標高は spots.js（正本）から読む。
// 一度ここを記憶で書いて、DEMと数百メートルずれた「欠陥」を捏造した。
// 第7節に「記憶ベースの座標は31件中11件が誤っていた」と自分で書いてあるのに繰り返した。
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
require("./spots.js");
const SPOTS = globalThis.SORAMI_SPOTS.spots
  .filter((x) => x.phenomena.includes("rime") || x.phenomena.includes("diamondDust"))
  .map((x) => ({ name: x.name, lat: x.latitude, lon: x.longitude, elevation: Math.round(x.elevation) }));

const START = "2026-01-01", END = "2026-02-28";
const RIME = -5, DD = -15;

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

const pad = (s, w) => String(s) + " ".repeat(Math.max(0, w -
  [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 0x1100 ? 2 : 1), 0)));

console.log(`${START} 〜 ${END}／気象庁MSM・発表済み予報のアーカイブ`);
console.log(`霧氷の閾値 ${RIME}℃ ／ ダイヤモンドダストの閾値 ${DD}℃\n`);
console.log(`${pad("地点", 16)} ${pad("登録", 7)} ${pad("DEM", 7)} ${pad("最低気温", 18)} `
  + `${pad("≤-5℃の日", 20)} ${pad("≤-15℃の日", 20)}`);

for (const s of SPOTS) {
  const q = (elev) => new URLSearchParams({
    latitude: String(s.lat), longitude: String(s.lon),
    start_date: START, end_date: END,
    hourly: "temperature_2m", timezone: "auto", timeformat: "unixtime", models: "jma_msm",
    ...(elev ? { elevation: String(elev) } : {}),
  });
  let withE, without;
  try {
    withE = await getJSON(`https://historical-forecast-api.open-meteo.com/v1/forecast?${q(s.elevation)}`);
    await new Promise((r) => setTimeout(r, 1200));
    without = await getJSON(`https://historical-forecast-api.open-meteo.com/v1/forecast?${q(null)}`);
    await new Promise((r) => setTimeout(r, 1200));
  } catch (e) { console.log(`${pad(s.name, 16)} 取得できず: ${e.message}`); continue; }

  // 日ごとの最低気温を出し、閾値を割った日を数える
  const daily = (p) => {
    const off = p.utc_offset_seconds, by = {};
    p.hourly.time.forEach((t, i) => {
      const v = p.hourly.temperature_2m[i];
      if (v === null) return;
      const day = Math.floor((t + off) / 86400);
      by[day] = by[day] === undefined ? v : Math.min(by[day], v);
    });
    const mins = Object.values(by);
    return { days: mins.length, rime: mins.filter((x) => x <= RIME).length,
             dd: mins.filter((x) => x <= DD).length,
             min: mins.length ? Math.min(...mins) : null };
  };
  const a = daily(withE), b = daily(without);
  console.log(`${pad(s.name, 16)} ${pad(s.elevation + "m", 7)} ${pad(without.elevation + "m", 7)} `
    + `${pad(`${a.min?.toFixed(1)} ← ${b.min?.toFixed(1)}℃`, 18)} `
    + `${pad(`${a.rime} ← ${b.rime}日 (+${a.rime - b.rime})`, 20)} `
    + `${pad(`${a.dd} ← ${b.dd}日 (+${a.dd - b.dd})`, 20)}`);
}

console.log(`\n「←」の右が標高を渡していなかったときの値。`);
console.log(`差がそのまま、霧氷・ダイヤモンドダストの見落としだった日数にあたる。`);
