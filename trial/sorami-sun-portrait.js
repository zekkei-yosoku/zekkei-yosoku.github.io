/* ホームの太陽の絵（2026-10-19）。宇宙イラスト風（ユーザーが示した画像の雰囲気を計算で描く。画像そのものは使わない）。
   黄〜橙の鮮やかな色、炎のようなうねり（値ノイズの fbm と領域ゆがみ）、白く光る部分、まぶしい縁と外側の光。
   高度・時刻に関係なく常に同じ見た目（ユーザー判断）。動き・プロミネンスはなし。一度描いた画素は使い回す。 */
(function (g) {
'use strict';
const SIZE = 512, DISC = 0.33;
// 色の段（暗い橙 → 橙 → 黄 → 淡い黄 → ほぼ白）
const PALETTE = [[0, [214, 92, 8]], [0.35, [245, 140, 20]], [0.6, [255, 196, 46]], [0.82, [255, 236, 120]], [1, [255, 252, 225]]];
const GLOW = [[0, [255, 236, 150], 0.95], [0.08, [255, 176, 40], 0.7], [0.3, [255, 120, 20], 0.28], [1, [255, 120, 20], 0]];
let cache = null;
// 見本（ユーザー承認）と同じ式で同じ模様にする
function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), f = (t) => t * t * (3 - 2 * t), u = f(x - xi), v = f(y - yi);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, octaves) { let v = 0, a = 0.5, f = 1; for (let i = 0; i < octaves; i++) { v += a * vnoise(x * f, y * f, s + i * 17); f *= 2.03; a *= 0.5; } return v; }
const smooth = (t) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
function palette(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < PALETTE.length; i++) if (t <= PALETTE[i][0]) { const [a, ca] = PALETTE[i - 1], [b, cb] = PALETTE[i], u = (t - a) / (b - a); return ca.map((v, k) => v + (cb[k] - v) * u); }
  return PALETTE[PALETTE.length - 1][1];
}
// 太陽の円盤の画素（RGBA）。外側は透明
function surface(size = SIZE) {
  const out = new Uint8ClampedArray(size * size * 4), r = size * DISC, c = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = (x + 0.5 - c) / r, ny = (y + 0.5 - c) / r, rr = nx * nx + ny * ny, i = (y * size + x) * 4;
    if (rr > 1) continue;
    const mu = Math.sqrt(1 - rr), squeeze = 0.55 + 0.45 * mu;                      // 縁ほど模様を詰めて球に見せる
    const sx = nx / squeeze * 3.2, sy = ny / squeeze * 3.2;
    const wx = fbm(sx + 5.2, sy + 1.3, 3, 4), wy = fbm(sx + 1.7, sy + 9.2, 7, 4);
    const n = fbm(sx + 2.2 * wx, sy + 2.2 * wy, 11, 5), cells = fbm(sx * 4.5, sy * 4.5, 23, 3);
    let t = 0.3 + 1.05 * (n - 0.32) + 0.18 * (cells - 0.5);
    t += smooth((fbm(sx * 1.3 + 7, sy * 1.3 + 3, 31, 3) - 0.6) / 0.16) * 0.6;       // 白く光る部分
    t = t * (0.78 + 0.22 * mu) + (rr > 0.9 ? (rr - 0.9) * 3.2 : 0);                 // 縁：少し暗くしてから最外周を明るく
    const col = palette(t);
    for (let k = 0; k < 3; k++) out[i + k] = col[k];
    out[i + 3] = 255 * Math.min(1, (1 - Math.sqrt(rr)) * r);
  }
  return out;
}
function draw(canvas) {
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d'); if (!ctx) return false;
  if (!cache) {
    const disc = document.createElement('canvas'); disc.width = disc.height = SIZE;
    disc.getContext('2d').putImageData(new ImageData(surface(), SIZE, SIZE), 0, 0); cache = disc;
  }
  const c = SIZE / 2, r = SIZE * DISC, glow = ctx.createRadialGradient(c, c, r * 0.97, c, c, r * 1.45);
  for (const [at, col, a] of GLOW) glow.addColorStop(at, `rgba(${col},${a})`);
  ctx.clearRect(0, 0, SIZE, SIZE); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(c, c, r * 1.45, 0, Math.PI * 2); ctx.fill();
  ctx.drawImage(cache, 0, 0);
  return true;
}
const api = Object.freeze({ draw, surface, SIZE, DISC });
g.SoramiSunPortrait = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
