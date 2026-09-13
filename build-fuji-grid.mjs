/*
 * 富士山の標高格子を作る。**一度だけ走らせて、結果を同梱する。**
 *
 *   node build-fuji-grid.mjs     → data/fuji-grid.json
 *
 * 観測地点は利用者が自由に決めるので事前計算できないが、**富士山は動かない**。
 * 山体の形だけ先に持っておけば、どの地点からでも輪郭を計算できる。
 *
 * 標高は国土地理院の標高タイル（dem_png・z=13・画素約16m）。
 * Open-Meteo の標高API（1回100点）でやろうとしたら 429 が続いて止まった。
 * タイルなら1回で 256x256 = 65536点。桁が3つ違う。
 * 出典表示が要る: 国土地理院「標高タイル」
 *
 * 出力は Int16 の格子を base64 にしたもの。JSONに数値を並べると 5倍以上になる。
 */
import fs from "node:fs";
import * as D from "./dem-tile.mjs";

const SUMMIT = { latitude: 35.360555, longitude: 138.727363 };   // 剣ヶ峰
const ZOOM = 13;
// 1000m 等高線までを覆う。緯度 ±0.13度 ≈ 14.4km、経度 ±0.16度 ≈ 14.5km
const SPAN_LAT = 0.13, SPAN_LON = 0.16;
const D_LAT = 0.001, D_LON = 0.00125;      // 約 111m x 113m
const NO_DATA = -32768;

const rows = Math.round(SPAN_LAT * 2 / D_LAT) + 1;
const cols = Math.round(SPAN_LON * 2 / D_LON) + 1;
const lat0 = Number((SUMMIT.latitude - SPAN_LAT).toFixed(6));
const lon0 = Number((SUMMIT.longitude - SPAN_LON).toFixed(6));
console.log(`格子 ${rows} 行 x ${cols} 列 = ${rows * cols} マス（約111m x 113m）`);

const grid = new Int16Array(rows * cols);
let maxE = -Infinity, maxAt = null, got = 0, missing = 0;
for (let r = 0; r < rows; r++) {
  const la = lat0 + r * D_LAT;
  for (let c = 0; c < cols; c++) {
    const lo = lon0 + c * D_LON;
    let e;
    try { e = await D.elevationAt(la, lo, ZOOM); }
    catch (err) { console.log(`\n  ${la},${lo}: ${err.message}`); e = null; }
    if (e === null || e === undefined) { grid[r * cols + c] = NO_DATA; missing++; continue; }
    grid[r * cols + c] = Math.round(e);
    got++;
    if (e > maxE) { maxE = e; maxAt = { la, lo }; }
  }
  if (r % 20 === 0 || r === rows - 1) {
    process.stdout.write(`\r  ${r + 1}/${rows} 行  タイル ${D.tileCacheSize()} 枚  取得 ${got}  欠測 ${missing}`);
  }
}
console.log("");
console.log(`最高点 ${maxE.toFixed(1)}m @ ${maxAt.la.toFixed(6)},${maxAt.lo.toFixed(6)}（剣ヶ峰は 3776m）`);

// **山頂から繋がっている部分だけを「富士山」とする。**
//
// 四角く切り取っただけだと、箱の中の別の山（三国山稜など）まで入る。
// 山中湖のように箱の中に入る観測地点では、まわり中の地形が「山体」と見なされ、
// 輪郭が360度に広がってしまう（2026-09-14 に実際に起きた）。
// 山頂から MIN_BODY_M 以上のマスを塗り広げ、届かなかったところは落とす。
const MIN_BODY_M = 1000;
{
  const sr = Math.round((maxAt.la - lat0) / D_LAT), sc = Math.round((maxAt.lo - lon0) / D_LON);
  const keep = new Uint8Array(rows * cols);
  const stack = [sr * cols + sc];
  keep[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop(), r = (i / cols) | 0, c = i % cols;
    for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const j = nr * cols + nc;
      if (keep[j]) continue;
      const v = grid[j];
      if (v === NO_DATA || v < MIN_BODY_M) continue;
      keep[j] = 1; stack.push(j);
    }
  }
  let body = 0, dropped = 0;
  for (let i = 0; i < grid.length; i++) {
    if (keep[i]) { body++; continue; }
    if (grid[i] !== NO_DATA && grid[i] >= MIN_BODY_M) dropped++;
    grid[i] = NO_DATA;
  }
  console.log(`山体 ${body} マス（${MIN_BODY_M}m 以上で山頂から繋がっている分）`);
  console.log(`落とした ${dropped} マス（箱の中の別の山・裾野の外側）`);
}

const out = {
  作った日: new Date().toISOString().slice(0, 10),
  出典: "国土地理院 標高タイル（dem_png, z=13, 画素約16m）",
  作り方: "node build-fuji-grid.mjs",
  注意: "Int16 の格子を base64 にしてある。-32768 は欠測または山体の外。標高は m 単位の整数",
  山体の定義: "1000m 以上で、剣ヶ峰から八方向に繋がっているマスだけ",
  summit: { latitude: maxAt.la, longitude: maxAt.lo, elevationM: Math.round(maxE) },
  lat0, lon0, dLat: D_LAT, dLon: D_LON, rows, cols, noData: NO_DATA,
  data: Buffer.from(grid.buffer).toString("base64"),
};
fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/fuji-grid.json", JSON.stringify(out));
const kb = fs.statSync("data/fuji-grid.json").size / 1024;
console.log(`保存: data/fuji-grid.json  ${kb.toFixed(0)} KB  （タイル ${D.tileCacheSize()} 枚で作った）`);
