/* ホームの金星の絵。マリナー10号の画像（NASA/JPL-Caltech PIA23791、パブリックドメイン。tools/build-venus-texture.py で円盤にする）に、
   選択した日時の満ち欠けの陰を付け、見かけの大きさに合わせて縮める。
   厚い大気で光が回り込むので明暗の境はぼかし、細い三日月のときは夜の側の縁にも淡い光の輪を出す。 */
(function (g) {
'use strict';
const PHOTO_LIMB = -1.656, NIGHT_ALPHA = 0.14, SRC = 'almanac-venus-surface-v1.webp', SIZE = 720, RADIUS = SIZE * 0.46, MIN_ARCSEC = 9, MAX_ARCSEC = 66, MIN_SCALE = 0.38, TIMEOUT_MS = 10000, tokens = new WeakMap(), last = new WeakMap();
let surfacePromise = null;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function surface() {
  if (surfacePromise) return surfacePromise;
  surfacePromise = new Promise((resolve, reject) => {
    const image = new Image(); let done = false;
    const timer = setTimeout(() => { if (done) return; done = true; reject(Error('Venus surface timeout')); }, TIMEOUT_MS);
    image.decoding = 'async';
    image.onload = () => {
      if (done) return; done = true; clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => { if (done) return; done = true; clearTimeout(timer); reject(Error('Venus surface unavailable')); };
    image.src = SRC;
  }).catch((e) => { surfacePromise = null; throw e; });
  return surfacePromise;
}
// 写真の輝いている側を光の向きへ回す。写真に写っていない夜の側は陰に隠れる
function turned(image, limb) {
  const flat = document.createElement('canvas'); flat.width = SIZE; flat.height = SIZE;
  const c = flat.getContext('2d', { willReadFrequently: true }), half = SIZE / 2;
  c.translate(half, half); c.rotate(limb - PHOTO_LIMB); c.imageSmoothingQuality = 'high'; c.drawImage(image, -RADIUS, -RADIUS, RADIUS * 2, RADIUS * 2);
  return c.getImageData(0, 0, SIZE, SIZE).data;
}
function shade(ctx, pixels, fraction, limb) {
  const image = ctx.createImageData(SIZE, SIZE), out = image.data, c = SIZE / 2, edgeWidth = 0.06;
  const cosI = clamp(2 * fraction - 1, -1, 1), sinI = Math.sqrt(1 - cosI * cosI), lx = sinI * Math.sin(limb), ly = sinI * Math.cos(limb), lz = cosI, flat = Math.hypot(lx, ly) || 1;
  const ring = smooth(0.4, 0.015, fraction);
  const peak = cosI >= 0 ? 1 : Math.max(sinI, 0.05);
  // 細い三日月は幅が狭いので、早く明るくして形を見せる
  const soft = 0.42 + 0.38 * smooth(0.03, 0.5, fraction);
  for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
    const x = (i + 0.5 - c) / RADIUS, y = (c - j - 0.5) / RADIUS, rr = x * x + y * y, p = (j * SIZE + i) * 4;
    if (rr > 1) {
      const rho = Math.sqrt(rr), over = (rho - 1) / edgeWidth;
      if (over >= 1) continue;
      const facing = (x * lx + y * ly) / (flat * rho), glow = Math.pow(1 - over, 2.2) * (0.24 * smooth(-0.15, 0.85, facing) * sinI + 0.06 * (1 - sinI) + 0.42 * ring * smooth(-1.15, 0.3, facing));
      out[p] = 250; out[p + 1] = 242; out[p + 2] = 222; out[p + 3] = Math.round(255 * clamp(glow, 0, 1));
      continue;
    }
    // 明暗の境はなだらかに。一番明るい所は細い三日月でも満月形でも同じ明るさにする
    const z = Math.sqrt(1 - rr), d = (x * lx + y * ly + z * lz) / peak, lit = Math.pow(smooth(-0.06, soft, d), 0.85), lift = 1 + 0.55 * Math.pow(1 - z, 2.4);
    const r = pixels ? pixels[p] : 238, gr = pixels ? pixels[p + 1] : 226, b = pixels ? pixels[p + 2] : 200, alpha = lit + (1 - lit) * NIGHT_ALPHA, ghost = (1 - lit) * NIGHT_ALPHA;
    // 暗い部分は黒く塗らず透かす。夜の側だけ薄く残す
    out[p] = Math.round(clamp((r * lift * lit + 34 * ghost) / alpha, 0, 255)); out[p + 1] = Math.round(clamp((gr * lift * lit + 38 * ghost) / alpha, 0, 255)); out[p + 2] = Math.round(clamp((b * lift * lit + 50 * ghost) / alpha, 0, 255));
    out[p + 3] = Math.round(255 * alpha);
  }
  ctx.putImageData(image, 0, 0);
}
// 見かけの大きさ（秒角）に合わせて円盤の大きさを変える。遠いときも形が読める大きさは残す
function scaleOf(arcsec) { return clamp(MIN_SCALE + (arcsec - MIN_ARCSEC) / (MAX_ARCSEC - MIN_ARCSEC) * (1 - MIN_SCALE), MIN_SCALE, 1); }
async function draw(canvas, state) {
  const prev = last.get(canvas);
  // 時刻の操作のたびに描き直さない。形と大きさが見て分かるほど変わったときだけ
  if (prev?.texture && Math.abs(prev.fraction - state.illuminatedFraction) < 0.0008 && Math.abs(prev.limb - state.limb) < 0.008 && Math.abs(prev.size - state.diameterArcsec) < 0.1) return { texture: true };
  const token = {}; tokens.set(canvas, token);
  let image = null;
  try { image = await surface(); } catch { /* 画像が無くても形は出す */ }
  if (tokens.get(canvas) !== token) return { stale: true };
  const pixels = image ? turned(image, state.limb) : null;
  const ctx = canvas.getContext?.('2d'); if (!ctx) return { texture: false };
  const work = document.createElement('canvas'); work.width = SIZE; work.height = SIZE;
  shade(work.getContext('2d'), pixels, state.illuminatedFraction, state.limb);
  canvas.width = SIZE; canvas.height = SIZE;
  const shown = SIZE * scaleOf(state.diameterArcsec), at = (SIZE - shown) / 2;
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(work, at, at, shown, shown);
  last.set(canvas, { fraction: state.illuminatedFraction, limb: state.limb, size: state.diameterArcsec, texture: !!pixels });
  return { texture: !!pixels };
}
const api = Object.freeze({ draw, scaleOf, retry: () => { surfacePromise = null; }, SRC });
g.AstroNotesVenusPortrait = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
