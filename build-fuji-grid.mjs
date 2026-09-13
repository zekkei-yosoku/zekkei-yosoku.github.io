/*
 * 富士山の標高格子を作る。**一度だけ走らせて、結果を同梱する。**
 *
 * 観測地点は利用者が自由に決めるので事前計算できないが、**富士山は動かない**。
 * 山体の形だけ先に持っておけば、どの地点からでも「山体の輪郭」を計算できる。
 *
 *   node build-fuji-grid.mjs
 *
 * 出力: data/fuji-grid.json
 */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const T = require("./sorami-terrain.js");

// 剣ヶ峰（最高地点）
const SUMMIT = { latitude: 35.360555, longitude: 138.727363 };
const SPAN_DEG = 0.15;      // 中心から ±0.15度 ≈ 南北17km・東西14km。1000m 等高線を覆う
const STEP_DEG = 0.005;     // ≈ 南北555m・東西450m
const MIN_KEEP_M = 1000;    // これ未満は「山体」として扱わない（裾野の平地を落とす）

const lats = [], lons = [];
for (let d = -SPAN_DEG; d <= SPAN_DEG + 1e-9; d += STEP_DEG) lats.push(Number((SUMMIT.latitude + d).toFixed(6)));
for (let d = -SPAN_DEG; d <= SPAN_DEG + 1e-9; d += STEP_DEG) lons.push(Number((SUMMIT.longitude + d).toFixed(6)));

const points = [];
for (const la of lats) for (const lo of lons) points.push({ latitude: la, longitude: lo });
console.log(`格子 ${lats.length} x ${lons.length} = ${points.length} 点`);
console.log(`1回100点なので ${Math.ceil(points.length / 100)} 回の取得。ゆっくり進めます`);

// **途中から再開できるようにする。** 429 で落ちても取った分を捨てない
const CACHE = "/tmp/fuji-grid-partial.json";
let elevs = [];
if (fs.existsSync(CACHE)) {
  const c = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  if (c.total === points.length && c.step === STEP_DEG && c.span === SPAN_DEG) {
    elevs = c.elevs;
    console.log(`  途中から再開: ${elevs.length}/${points.length}`);
  }
}
let stalled = 0;
while (elevs.length < points.length) {
  const chunk = points.slice(elevs.length, elevs.length + 100);
  try {
    const e = await T.fetchElevations(chunk, {});
    elevs.push(...e);
    stalled = 0;
    fs.writeFileSync(CACHE, JSON.stringify({ total: points.length, step: STEP_DEG, span: SPAN_DEG, elevs }));
    process.stdout.write(`\r  ${elevs.length}/${points.length}`);
    await new Promise((r) => setTimeout(r, 2500));
  } catch (e) {
    stalled++;
    if (stalled > 8) { console.log(`\n  止まりました（${elevs.length}/${points.length}）: ${e.message}`); process.exit(1); }
    const wait = 30000 * stalled;
    process.stdout.write(`\r  ${elevs.length}/${points.length}  待機 ${wait / 1000}秒（${e.message}）      `);
    await new Promise((r) => setTimeout(r, wait));
  }
}
console.log("");

// 山体だけ残す。全部持つと重いし、裾野の平地は輪郭に効かない
const cells = [];
let idx = 0, maxE = -Infinity, maxAt = null;
for (const la of lats) for (const lo of lons) {
  const e = elevs[idx++];
  if (e === null || e === undefined) continue;
  if (e > maxE) { maxE = e; maxAt = { la, lo }; }
  if (e >= MIN_KEEP_M) cells.push([Number(la.toFixed(4)), Number(lo.toFixed(4)), Math.round(e)]);
}
console.log(`最高点 ${maxE}m @ ${maxAt.la},${maxAt.lo}（実際の剣ヶ峰 3776m）`);
console.log(`${MIN_KEEP_M}m 以上のマス: ${cells.length} / ${points.length}`);

const out = {
  作った日: new Date().toISOString().slice(0, 10),
  出典: "Open-Meteo Elevation API（Copernicus DEM 相当・約90m）",
  注意: "山体だけを残してある。ここに無いマスは " + MIN_KEEP_M + "m 未満か取得できなかった点",
  summit: { latitude: maxAt.la, longitude: maxAt.lo, elevationM: maxE },
  spanDeg: SPAN_DEG, stepDeg: STEP_DEG, minKeepM: MIN_KEEP_M,
  cells,   // [緯度, 経度, 標高m]
};
fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/fuji-grid.json", JSON.stringify(out));
console.log(`保存: data/fuji-grid.json  ${(fs.statSync("data/fuji-grid.json").size / 1024).toFixed(0)} KB`);
