/*
 * 雲海の風速条件が「読んでいる量」として成立するかを確かめる。
 *
 * 問題:
 *   宙畑・秩父の決定木の第2分岐「風速 < 0.85 m/s」は【秩父アメダス＝盆地底の観測値】。
 *   アプリが読むのは【展望台（尾根）の予測値】。同じ量ではない。
 *   2025年11月の竹田城跡で 0.85 を下回った日は 30日中 0日で、30点ぶんの加点が死んでいる。
 *
 * 確かめること:
 *   (1) 数値予報モデルは、展望台と数km離れた谷底とで別の風速を返すのか。
 *       返さないなら「谷底の風」はそもそも取得不能で、閾値の移植ではなく設計変更が要る。
 *   (2) 気温はどうか。Open-Meteo は標高で気温を補正するので、こちらは差が出るはず。
 *       出るなら、宙畑の「前日最高−当日最低」も谷底で評価し直せる余地がある。
 *
 * 結論の読み方:
 *   MSM は 5km 格子。竹田城の盆地は幅数km で、格子1〜2個ぶんしかない。
 *   「差が出ない」は装置の分解能の話であって、現実に差が無いという意味ではない。
 */
const RADII = [2, 4, 6, 8, 10, 14];
const BEARINGS = 12;
const SPOTS = [
  { name: "竹田城跡", lat: 35.3003, lon: 134.8290, elevation: 353 },
  { name: "高ボッチ高原", lat: 36.1614, lon: 138.0022, elevation: 1665 },
  { name: "大江山", lat: 35.4664, lon: 135.1069, elevation: 833 },
  { name: "備中松山城", lat: 34.8094, lon: 133.6183, elevation: 430 },
];

const R = 6371;
function offset(lat, lon, km, deg) {
  const b = deg * Math.PI / 180, la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
  const d = km / R;
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la),
                              Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return [la2 * 180 / Math.PI, lo2 * 180 / Math.PI];
}

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

const START = "2025-11-01", END = "2025-11-30";

for (const spot of SPOTS) {
  // --- 周囲でいちばん低い格子点を探す
  const pts = [[spot.lat, spot.lon]];
  for (const km of RADII) {
    for (let i = 0; i < BEARINGS; i++) pts.push(offset(spot.lat, spot.lon, km, i * 360 / BEARINGS));
  }
  const el = await getJSON("https://api.open-meteo.com/v1/elevation?"
    + new URLSearchParams({ latitude: pts.map((p) => p[0].toFixed(4)).join(","),
                            longitude: pts.map((p) => p[1].toFixed(4)).join(",") }));
  const elevations = el.elevation;
  let lowIdx = 0;
  elevations.forEach((e, i) => { if (e < elevations[lowIdx]) lowIdx = i; });
  const low = pts[lowIdx];
  const distKm = lowIdx === 0 ? 0 : RADII[Math.floor((lowIdx - 1) / BEARINGS)];

  console.log(`\n══ ${spot.name}`);
  console.log(`  展望台 ${elevations[0]}m（登録標高 ${spot.elevation}m）`);
  console.log(`  最低点 ${elevations[lowIdx]}m / ${distKm}km / ${low[0].toFixed(4)},${low[1].toFixed(4)}`
    + `  → 標高差 ${(elevations[0] - elevations[lowIdx]).toFixed(0)}m`);

  // --- 両点の気温と風速（気象庁MSM・発表済み予報のアーカイブ）
  const q = new URLSearchParams({
    latitude: `${spot.lat},${low[0].toFixed(4)}`, longitude: `${spot.lon},${low[1].toFixed(4)}`,
    start_date: START, end_date: END,
    hourly: "temperature_2m,wind_speed_10m", timezone: "auto", timeformat: "unixtime",
    models: "jma_msm",
  });
  let data;
  try {
    data = await getJSON(`https://historical-forecast-api.open-meteo.com/v1/forecast?${q}`);
  } catch (e) { console.log(`  取得できず: ${e.message}`); continue; }
  const [top, bottom] = data;
  console.log(`  Open-Meteo が返した標高: 展望台 ${top.elevation}m / 最低点 ${bottom.elevation}m`);

  const n = top.hourly.time.length;
  let sameWind = 0, sameTemp = 0, cnt = 0;
  let dW = 0, dT = 0, maxDW = 0;
  // 早朝（現地4〜7時）だけを見る。雲海が出る時間帯。
  const off = top.utc_offset_seconds;
  const calmTop = { top: 0, bottom: 0, n: 0 };
  for (let i = 0; i < n; i++) {
    const hour = Math.floor(((top.hourly.time[i] + off) % 86400) / 3600);
    if (hour < 4 || hour > 7) continue;
    const wt = top.hourly.wind_speed_10m[i], wb = bottom.hourly.wind_speed_10m[i];
    const tt = top.hourly.temperature_2m[i], tb = bottom.hourly.temperature_2m[i];
    if ([wt, wb, tt, tb].some((x) => x === null)) continue;
    cnt++;
    if (wt === wb) sameWind++;
    if (tt === tb) sameTemp++;
    dW += Math.abs(wt - wb); dT += Math.abs(tt - tb);
    maxDW = Math.max(maxDW, Math.abs(wt - wb));
    calmTop.n++;
    if (wt < 0.85) calmTop.top++;
    if (wb < 0.85) calmTop.bottom++;
  }
  if (!cnt) { console.log("  早朝の標本なし"); continue; }
  console.log(`  早朝(4-7時) ${cnt}時間ぶん`);
  console.log(`    風速が完全に同値: ${(sameWind / cnt * 100).toFixed(0)}%  平均差 ${(dW / cnt).toFixed(2)}m/s  最大差 ${maxDW.toFixed(2)}m/s`);
  console.log(`    気温が完全に同値: ${(sameTemp / cnt * 100).toFixed(0)}%  平均差 ${(dT / cnt).toFixed(2)}℃`);
  console.log(`    風速<0.85m/s の割合: 展望台 ${(calmTop.top / calmTop.n * 100).toFixed(0)}%  最低点 ${(calmTop.bottom / calmTop.n * 100).toFixed(0)}%`);
  await new Promise((r) => setTimeout(r, 1500));
}

console.log(`\n読み方: 風速が同値ばかりなら、モデルは谷底と尾根を区別していない。`);
console.log(`その場合「谷底の風速<0.85m/s」は取得不能な量であり、閾値を移植しても意味がない。`);
