/*
 * ホーム画面・タブ用のアイコンを作る。
 *
 * apple-touch-icon とマニフェストが無いと、OSはアプリ名の先頭文字で代用する。
 * 「絶」の一文字が出ていたのはそれ。
 *
 * 依存を増やしたくないので、PNG は zlib（Node同梱）だけで自前に書き出す。
 * 図は1ピクセルずつ評価する。4×4 のスーパーサンプリングで縁をなめらかにする。
 *
 * 実行: node make-icon.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

// --- PNG の書き出し（IHDR / IDAT / IEND だけの最小構成）
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function writePNG(path, size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8bit RGBA
  // 各行の先頭にフィルタ種別 0 を置く
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]));
}

// --- 図案
//
// 夕暮れの空。上は夜の紺、下へ向かって藍・茜へ移り、地平の少し上に太陽。
// 星を3つだけ上に置く。7現象のうち中心にあるのは空の色と星なので、その2つで描く。
//
// 小さく出ることが前提（iOSのホーム画面で 60pt）。
// 形は「空のグラデーション＋丸」だけにして、細部を持たせない。
// 角丸はOS側が付けるので、こちらは正方形いっぱいに描く。
//
// 太陽と星は中央の8割に収める。マスカブル（Androidが円で抜く）でも欠けないため。
const STOPS = [
  [0.00, [10, 15, 36]],     // 夜
  [0.30, [26, 40, 92]],     // 藍
  [0.52, [86, 62, 120]],    // 薄明の紫
  [0.68, [196, 88, 62]],    // 茜
  [0.84, [240, 133, 41]],   // --accent（ダークモードの橙）
  [1.00, [250, 176, 84]],   // 地平のきわ
];
function sky(t) {
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i];
      const k = (t - t0) / (t1 - t0);
      return [0, 1, 2].map((j) => c0[j] + (c1[j] - c0[j]) * k);
    }
  }
  return STOPS.at(-1)[1].slice();
}
// 星は3つだけ。32pxでも消えない大きさにする。
const STARS = [[0.24, 0.19, 0.020], [0.71, 0.14, 0.017], [0.55, 0.29, 0.014]];
// 太陽は稜線に半分かかる位置に置く。宙に浮かせると月に見える。
const SUN = { x: 0.5, y: 0.665, r: 0.145 };

// 稜線。2つの峰。左が高く、右へ低く流れる。
// 直線ひとつだと地平線、峰があると山になる。「絶景」は空だけでは出ない。
function ridgeY(u) {
  return 0.795
    - 0.105 * Math.exp(-((u - 0.30) ** 2) / 0.020)
    - 0.070 * Math.exp(-((u - 0.72) ** 2) / 0.013);
}
const RIDGE = [14, 17, 30];

function shade(u, v) {
  const c = sky(v);
  // 太陽と、その周りのにじみ
  const d = Math.hypot(u - SUN.x, v - SUN.y);
  const glow = Math.max(0, 1 - d / (SUN.r * 3.0));
  const g = glow ** 2 * 0.5;
  c[0] += (255 - c[0]) * g; c[1] += (223 - c[1]) * g; c[2] += (150 - c[2]) * g;
  if (d < SUN.r) {
    const k = Math.min(1, (SUN.r - d) / (SUN.r * 0.14));
    c[0] += (255 - c[0]) * k; c[1] += (214 - c[1]) * k; c[2] += (122 - c[2]) * k;
  }
  for (const [sx, sy, sr] of STARS) {
    const sd = Math.hypot(u - sx, v - sy);
    if (sd < sr) {
      const k = Math.min(1, (sr - sd) / (sr * 0.55)) * 0.95;
      c[0] += (255 - c[0]) * k; c[1] += (255 - c[1]) * k; c[2] += (255 - c[2]) * k;
    }
  }
  // 稜線から下は影。空の色をわずかに残して、真っ黒にはしない。
  if (v >= ridgeY(u)) return [RIDGE[0], RIDGE[1], RIDGE[2]];
  return c;
}

function render(size) {
  const SS = 4;   // スーパーサンプリング
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS, i = (y * size + x) * 4;
      out[i] = Math.round(r / n); out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n); out[i + 3] = 255;
    }
  }
  return out;
}

for (const size of [32, 180, 192, 512]) {
  writePNG(new URL(`./icon-${size}.png`, import.meta.url).pathname, size, render(size));
  console.log(`icon-${size}.png`);
}
