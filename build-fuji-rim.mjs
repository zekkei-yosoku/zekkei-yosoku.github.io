/*
 * 富士山の火口の縁（頂の形）を作る。**一度走らせて、結果を sorami-align.js に貼る。**
 *
 *   node build-fuji-rim.mjs   → 標準出力に FUJI_RIM の文字列
 *
 * 山頂は点ではない。火口の縁が直径 800m ほどの輪になっていて、縁の高さは 3725〜3774m と場所で違う。
 * ダイヤモンド富士・パール富士は「天体の中心が、頂の稜線（縁）のどこかに届くか」で決まる。
 * 剣ヶ峰1点で見ると、高尾山の冬至が「縁がかすめる」になって一覧から落ちていた（2026-09-30）。
 *
 * 国土地理院 DEM5A（dem5a_png・z15・画素約4m）から、3690m 以上の点を 20m 格子に間引く。
 * 出力は「火口の中心からの東[m], 北[m], 標高-3600[m]」を並べた整数の列。
 * 出典: 国土地理院「標高タイル（基盤地図情報数値標高モデル DEM5A）」
 */
import * as D from "./dem-tile.mjs";
const z = 15, CENTER = [35.36295, 138.73003], STEP = 20, MIN = 3690;
const kx = Math.cos(CENTER[0] * Math.PI / 180) * 111320, ky = 110574;
const x0 = Math.floor(D.tileXf(138.722, z)), x1 = Math.floor(D.tileXf(138.738, z));
const y0 = Math.floor(D.tileYf(35.368, z)), y1 = Math.floor(D.tileYf(35.356, z));
const cells = new Map();
for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
  const res = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/${z}/${x}/${y}.png`);
  if (!res.ok) throw new Error(`${x}/${y} ${res.status}`);
  const img = D.decodePng(Buffer.from(await res.arrayBuffer()));
  for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
    const i = (py * 256 + px) * img.channels;
    const e = D.pixelToElevation(img.data[i], img.data[i + 1], img.data[i + 2]);
    if (e === null || e < MIN) continue;
    const lon = (x + (px + 0.5) / 256) / 2 ** z * 360 - 180;
    const n = Math.PI - 2 * Math.PI * (y + (py + 0.5) / 256) / 2 ** z;
    const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    const ex = (lon - CENTER[1]) * kx, ny = (lat - CENTER[0]) * ky;
    // 20m 格子ごとに一番高い点を残す（稜線を削らない）
    const key = `${Math.round(ex / STEP)},${Math.round(ny / STEP)}`;
    const c = cells.get(key);
    if (!c || e > c[2]) cells.set(key, [Math.round(ex), Math.round(ny), e]);
  }
}
const pts = [...cells.values()];
const top = pts.reduce((a, b) => (b[2] > a[2] ? b : a));
console.error(`${pts.length} 点 ・ 最高 ${top[2].toFixed(1)}m（中心から東${top[0]}m 北${top[1]}m）`);
console.log(pts.flatMap(([e, n, h]) => [e, n, Math.round(h - 3600)]).join(","));
