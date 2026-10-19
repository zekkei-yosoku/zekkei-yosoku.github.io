/* ホームの太陽の絵（2026-10-19）。高度・時刻に関係なく常に同じ見た目（ユーザー判断：色を変えない、地平線で隠さない）。
   周縁減光（色ごとに一次式）、ごく細かい粒状の質感、外側のやわらかい光。黒点は日によって違い作り物になるので描かない。
   一度描いた画素は使い回す（描き直しの負担を出さない）。 */
(function (g) {
'use strict';
const SIZE = 512, DISC = 0.33, BASE = [255, 216, 140], LIMB = [0.36, 0.48, 0.60], GLOW = [255, 165, 50];
let cache = null;
// 決まった種の値ノイズ（毎回同じ質感になる）
function noise(seed) {
  const n = 130, grid = new Float32Array(n * n); let s = seed;
  for (let i = 0; i < grid.length; i++) { s = (s * 1103515245 + 12345) % 2147483648; grid[i] = s / 2147483648; }
  const at = (x, y) => grid[(y % 128) * n + (x % 128)], f = (t) => t * t * (3 - 2 * t);
  return (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = f(x - xi), yf = f(y - yi), a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf; };
}
// 太陽の円盤の画素（RGBA）。外側は透明
function surface(size = SIZE) {
  const out = new Uint8ClampedArray(size * size * 4), r = size * DISC, c = size / 2, n1 = noise(7), n2 = noise(19);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5 - c) / r, dy = (y + 0.5 - c) / r, rr = dx * dx + dy * dy, i = (y * size + x) * 4;
    if (rr > 1) continue;
    const mu = Math.sqrt(1 - rr), gran = 1 + 0.055 * (n1(x / 7, y / 7) - 0.5) * mu + 0.03 * (n2(x / 2.6, y / 2.6) - 0.5) * mu;
    for (let k = 0; k < 3; k++) out[i + k] = BASE[k] * (1 - LIMB[k] * (1 - mu)) * gran;
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
  const c = SIZE / 2, r = SIZE * DISC, glow = ctx.createRadialGradient(c, c, r * 0.9, c, c, r * 1.42);
  glow.addColorStop(0, `rgba(${GLOW},0.5)`); glow.addColorStop(1, `rgba(${GLOW},0)`);
  ctx.clearRect(0, 0, SIZE, SIZE); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(c, c, r * 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.drawImage(cache, 0, 0);
  return true;
}
const api = Object.freeze({ draw, surface, SIZE, DISC, BASE });
g.SoramiSunPortrait = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
