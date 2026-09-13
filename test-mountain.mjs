/*
 * 山体（富士山）の幾何の検査。**通信しない。**
 *
 * 同梱の `data/fuji-grid.json` だけで走る。地平線は通信が要るので、
 * ここでは山体の輪郭・見かけの大きさ・可視割合の計算そのものを見る。
 * 実地形と突き合わせた結果は下のコメントに残す（再現手順つき）。
 *
 * 2026-09-14 に実地形（国土地理院タイル）で8地点を確認し、全て一致した:
 *   山中湖15km PARTIAL 49% / 東京タワー98km 23% / 高尾55km 26% / 河口湖18km 39%
 *   甲府36km 21% / 静岡53km 43% / 名古屋169km NONE / 金沢231km NONE
 * この検証で欠陥が2つ出た:
 *   1. 観測者の標高を手入力に頼ると、DEM と食い違って**すぐ脇に幻の壁**が立つ
 *      （河口湖で172mずれ、100m先に50度の壁ができて「まったく見えない」と出た）
 *   2. 山体を四角く切り取るだけだと箱の中の別の山まで入り、箱の中に立つ観測地点で
 *      輪郭が360度になる（山中湖）。山頂から連結する分だけに塗り分けて解決
 */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const A = require("./sorami-astro.js");
const M = require("./sorami-mountain.js");

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };

const grid = JSON.parse(fs.readFileSync(new URL("./data/fuji-grid.json", import.meta.url), "utf8"));

console.log("== 同梱の格子 ==");
ok(grid.rows > 200 && grid.cols > 200, "格子の大きさ", `${grid.rows} x ${grid.cols}`);
ok(Math.abs(grid.summit.elevationM - 3776) <= 10, "最高点が剣ヶ峰と合う", `${grid.summit.elevationM} m`);
ok(Math.abs(grid.summit.latitude - 35.3606) < 0.002 && Math.abs(grid.summit.longitude - 138.7274) < 0.002,
   "最高点の位置が剣ヶ峰", `${grid.summit.latitude},${grid.summit.longitude}`);
{
  let n = 0, above3000 = 0;
  for (const [, , e] of M.cellsOf(grid, 1000)) { n++; if (e >= 3000) above3000++; }
  ok(n > 20000 && n < 45000, "山体のマス数", String(n));
  // 3000m 以上の面積。富士山では約 12 平方km
  const areaKm2 = above3000 * 0.111 * 0.113;
  ok(areaKm2 > 5 && areaKm2 < 25, "3000m以上の面積", `${areaKm2.toFixed(1)} 平方km`);
}

console.log("== 輪郭 ==");
{
  const far = M.silhouette({ latitude: 35.6586, longitude: 139.7454, elevation: 22 }, grid);
  ok(!!far, "遠方から輪郭が作れる");
  ok(Math.abs(far.apexAngleDeg - 1.74) < 0.1, "東京からの頂点の仰角", `${far.apexAngleDeg.toFixed(3)} 度`);
  ok(Math.abs(far.apexElevationM - grid.summit.elevationM) < 60, "頂点は山頂付近", `${far.apexElevationM} m`);
  ok(far.spanDeg > 10 && far.spanDeg < 30, "98km からの見かけの幅", `${far.spanDeg.toFixed(1)} 度`);
  ok(far.apexAzimuth > 240 && far.apexAzimuth < 260, "東京から見て西南西", `${far.apexAzimuth.toFixed(1)} 度`);

  const near = M.silhouette({ latitude: 35.4200, longitude: 138.8800, elevation: 982 }, grid);
  ok(near.apexAngleDeg > 9 && near.apexAngleDeg < 12, "山中湖からの頂点の仰角", `${near.apexAngleDeg.toFixed(2)} 度`);
  ok(near.spanDeg < 180, "近くても輪郭が一周しない（山体の塗り分けが効いている）",
     `${near.spanDeg.toFixed(1)} 度`);
}

console.log("== 見かけの大きさ ==");
{
  const sizes = [
    [{ latitude: 35.6586, longitude: 139.7454, elevation: 22 }, "東京", "clear"],
    [{ latitude: 35.4200, longitude: 138.8800, elevation: 982 }, "山中湖", "dominant"],
    [{ latitude: 35.1706, longitude: 136.8816, elevation: 18 }, "名古屋", "small"],
  ];
  for (const [obs, name, want] of sizes) {
    const z = M.apparentSize(M.silhouette(obs, grid));
    ok(z.key === want, `${name} の見かけの大きさ`, `${z.deg.toFixed(2)}度 = 満月${z.moonDiameters.toFixed(1)}個 → ${z.label}`);
  }
  // **高さで測る。** 近くだと裾野で幅が60度を超えるが、それは大きく見えるの意味ではない
  const near = M.silhouette({ latitude: 35.4200, longitude: 138.8800, elevation: 982 }, grid);
  const z = M.apparentSize(near);
  ok(z.deg === z.heightDeg, "大きさは高さで測る（幅ではない）", `高さ${z.heightDeg.toFixed(1)} / 幅${z.widthDeg.toFixed(1)}`);
}

console.log("== 可視割合と3分類 ==");
{
  const obs = { latitude: 35.6586, longitude: 139.7454, elevation: 22 };
  const sil = M.silhouette(obs, grid);
  ok(M.visibleFraction(sil, () => -5).classification === "FULL", "遮るものが無ければ FULL");
  ok(M.visibleFraction(sil, () => 90).classification === "NONE", "全部隠れれば NONE");
  const half = M.visibleFraction(sil, () => sil.apexAngleDeg * 0.5);
  ok(half.classification === "PARTIAL", "一部なら PARTIAL", `${(half.fraction * 100).toFixed(0)}%`);
  ok(half.apexVisible === true, "頂上が地平線より上なら頂上は見える");
  const overTop = M.visibleFraction(sil, () => sil.apexAngleDeg + 0.01);
  ok(overTop.apexVisible === false && overTop.classification === "NONE", "頂上より高い地形なら全て隠れる");
  // 割合は単調（地平線を上げれば減る一方）
  let prev = 1.1;
  for (const h of [-1, 0, 0.5, 1.0, 1.5, 2.0]) {
    const f = M.visibleFraction(sil, () => h).fraction;
    if (f > prev + 1e-9) { ok(false, "地平線を上げると可視割合は増えない", `${h}度で ${f}`); prev = -1; break; }
    prev = f;
  }
  if (prev >= 0) ok(true, "地平線を上げると可視割合は増えない（単調）");
}

console.log("== 幾何だけで完結する（天気を見ない）==");
{
  const g = M.geometry({ latitude: 35.6586, longitude: 139.7454, elevation: 22 }, grid, () => 0);
  ok(g.available === true, "判定が出る");
  for (const k of ["classification", "fraction", "apexVisible", "apparentSize", "distanceKm", "azimuthDeg"])
    ok(g[k] !== undefined, `${k} を返す`);
  ok(Math.abs(g.distanceKm - 98) < 3, "距離", `${g.distanceKm.toFixed(1)} km`);
}

console.log(`\n${fail === 0 ? "MOUNTAIN OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
