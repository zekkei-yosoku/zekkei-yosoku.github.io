/*
 * 「地点の標高をモデルへ渡す」ことの影響を測る。
 *
 * 渡さないと、モデルは 90m DEM を格子平均した標高の値を返す。
 * 山の展望台では実際より数百メートル低い場所の気温・風になっていた。
 * 気温そのものが閾値の現象（霧氷 ≤-5℃・ダイヤモンドダスト ≤-15℃）では
 * これは見落としに直結する。
 *
 * 前後で何がどれだけ変わるかを、同じ地点・同じ時刻で並べて出す。
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");

const SPOTS = [
  { name: "高ボッチ高原", latitude: 36.1614, longitude: 138.0022, elevation: 1665, terrain: "summit" },
  { name: "蔵王", latitude: 38.1450, longitude: 140.4400, elevation: 1660, terrain: "summit" },
  { name: "美ヶ原", latitude: 36.2236, longitude: 138.1069, elevation: 2034, terrain: "summit" },
  { name: "大江山", latitude: 35.4664, longitude: 135.1069, elevation: 833, terrain: "basin_rim" },
  { name: "竹田城跡", latitude: 35.3003, longitude: 134.8290, elevation: 353, terrain: "basin_rim" },
  { name: "備中松山城", latitude: 34.8094, longitude: 133.6183, elevation: 430, terrain: "basin_rim" },
  { name: "東京", latitude: 35.6812, longitude: 139.7671, elevation: 10, terrain: null },
];

const pad = (s, w) => String(s) + " ".repeat(Math.max(0, w -
  [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 0x1100 ? 2 : 1), 0)));

console.log("標高をモデルへ渡した場合としない場合の比較\n");
for (const spot of SPOTS) {
  const withElev = await S.fetchForecast(spot.latitude, spot.longitude, 4, spot);
  await new Promise((r) => setTimeout(r, 1200));
  const without = await S.fetchForecast(spot.latitude, spot.longitude, 4,
    { ...spot, elevation: null });
  await new Promise((r) => setTimeout(r, 1200));

  const gw = withElev.home.grid.elevation, go = without.home.grid.elevation;
  console.log(`══ ${spot.name}  登録 ${spot.elevation}m`);
  console.log(`   モデルが使った標高: 渡す ${gw}m / 渡さない ${go}m（差 ${(gw - go).toFixed(0)}m）`);
  if (Math.abs(gw - go) < 1) { console.log("   → 差が無いので影響なし\n"); continue; }

  // 気温の差（週全体の最低・平均）
  // home は {grid, byModel}。モデル横断の中央値で見る（アプリの採点と同じ扱い）。
  const stat = (bundle) => {
    const series = Object.values(bundle.home.byModel);
    const agg = (v, how) => {
      const vals = series.filter((x) => x.isSupported(v)).map((x) => {
        const t0 = x.times[0], t1 = x.times.at(-1);
        return how === "min" ? x.min(v, t0, t1) : x.mean(v, t0, t1);
      }).filter((x) => x !== null);
      return vals.length ? S.Curve.median(vals) : null;
    };
    return { min: agg("temperature_2m", "min"), mean: agg("temperature_2m", "mean"),
             wind: agg("wind_speed_10m", "mean"), rh: agg("relative_humidity_2m", "mean") };
  };
  const a = stat(withElev), b = stat(without);
  console.log(`   最低気温 ${a.min?.toFixed(1)}℃ ← ${b.min?.toFixed(1)}℃（${(a.min - b.min).toFixed(1)}）`
    + `  平均気温 ${a.mean?.toFixed(1)}℃ ← ${b.mean?.toFixed(1)}℃（${(a.mean - b.mean).toFixed(1)}）`);
  console.log(`   平均風速 ${a.wind?.toFixed(1)}m/s ← ${b.wind?.toFixed(1)}m/s`
    + `  平均湿度 ${a.rh?.toFixed(0)}% ← ${b.rh?.toFixed(0)}%`);

  // 各現象のスコア
  const now = Date.now();
  const rows = [];
  for (const id of Object.keys(S.SCORERS)) {
    const wk = (bundle) => {
      const week = S.evaluateWeek(id, bundle, spot, 4, now);
      const e = week.find((x) => !x.evaluation.unavailable);
      return e ? Math.round(e.evaluation.score) : (week[0]?.evaluation.unavailable ? "対象外" : "—");
    };
    rows.push([S.PHENOMENA[id].name, wk(withElev), wk(without)]);
  }
  console.log(`   ${pad("現象", 22)} ${pad("標高あり", 10)} ${pad("なし", 8)}`);
  for (const [n, x, y] of rows) {
    const d = (typeof x === "number" && typeof y === "number") ? x - y : null;
    console.log(`   ${pad(n, 22)} ${pad(x, 10)} ${pad(y, 8)}`
      + (d !== null && d !== 0 ? `  ${d > 0 ? "+" : ""}${d}` : ""));
  }
  console.log("");
}
console.log("注意: いまは9月で、霧氷・ダイヤモンドダストは季節外のため差が出ない。");
console.log("影響が出るのは冬季。気温そのものが閾値なので、数百メートルのずれは見落としになる。");
