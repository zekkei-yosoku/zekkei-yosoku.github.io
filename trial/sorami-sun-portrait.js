/* ホームの太陽の絵（2026-10-19）。宇宙イラスト風の太陽を前もって作った画像 almanac-sun-surface-v1.png
   （生成元：tools/build-sun-texture.py。ユーザーが示した画像は使わず、計算で描いたもの）を表示する。
   円盤の直径は画像の83%で、月の絵と同じ大きさに見える。高度・時刻では変えない。動きはなし。
   画像を読めないときは、計算で描く簡単な太陽に切り替える（表示を空にしない）。 */
(function (g) {
'use strict';
const SRC = 'almanac-sun-surface-v1.png', SIZE = 960, DISC = 0.415, TIMEOUT_MS = 10000, tokens = new WeakMap();
let sourcePromise = null;
function source() {
  if (sourcePromise) return sourcePromise;
  sourcePromise = new Promise((resolve, reject) => {
    const image = new Image(); let done = false;
    const timer = setTimeout(() => { if (done) return; done = true; reject(Error('Sun surface timeout')); }, TIMEOUT_MS);
    image.decoding = 'async';
    image.onload = () => { if (done) return; done = true; clearTimeout(timer); resolve(image); };
    image.onerror = () => { if (done) return; done = true; clearTimeout(timer); reject(Error('Sun surface unavailable')); };
    image.src = SRC;
  }).catch((e) => { sourcePromise = null; throw e; });
  return sourcePromise;
}
// 画像が無いときの太陽（黄〜橙の円盤と控えめな光）
function fallback(ctx) {
  const c = SIZE / 2, r = SIZE * DISC;
  const glow = ctx.createRadialGradient(c, c, r * 0.98, c, c, SIZE / 2);
  glow.addColorStop(0, 'rgba(255,170,50,0.55)'); glow.addColorStop(1, 'rgba(255,170,50,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(c, c, SIZE / 2, 0, Math.PI * 2); ctx.fill();
  const disc = ctx.createRadialGradient(c - r * 0.2, c - r * 0.2, r * 0.1, c, c, r);
  disc.addColorStop(0, '#ffe896'); disc.addColorStop(0.55, '#fcb828'); disc.addColorStop(1, '#e07a10');
  ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.fill();
}
async function draw(canvas, { detached = false } = {}) {
  const token = {}; tokens.set(canvas, token);
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d'); if (!ctx) return { texture: false };
  let image = null;
  try { image = await source(); } catch { /* 画像が無くても太陽は出す */ }
  if (tokens.get(canvas) !== token || (!detached && canvas.isConnected === false)) return { stale: true };
  ctx.clearRect(0, 0, SIZE, SIZE);
  if (image) ctx.drawImage(image, 0, 0, SIZE, SIZE); else fallback(ctx);
  return { texture: !!image };
}
const api = Object.freeze({ draw, SRC, SIZE, DISC });
g.SoramiSunPortrait = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
