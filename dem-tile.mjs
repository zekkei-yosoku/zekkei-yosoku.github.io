/*
 * 国土地理院の標高タイル（dem_png）を読む。
 *
 * **Open-Meteo の標高APIは1回100点まで**で、富士山の格子を作るのに38回叩いたら
 * 429 が続いて止まった。GSI のタイルは **1回で 256×256 = 65536点** 取れる。
 * 桁が3つ違う。解像度も z=11 で約62m（Open-Meteo の Copernicus 90m より細かい）。
 *
 * 標高の入れ方（国土地理院の仕様）:
 *   x = R*65536 + G*256 + B
 *   x < 2^23 なら h = x * 0.01 [m]、そうでなければ h = (x - 2^24) * 0.01
 *   (128, 0, 0) は「標高なし」
 *
 * 日本国内限定。世界中を見る用途には使えない（そちらは Open-Meteo のまま）。
 * 出典表示が要る: 国土地理院「標高タイル」https://maps.gsi.go.jp/development/ichiran.html
 *
 * PNG を読むのに外部パッケージは使わない。zlib は Node に入っている。
 */
import zlib from "node:zlib";

/// PNG（8bit RGB/RGBA・非インターレース）を画素配列へ。**それ以外は受け付けない。**
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("PNG ではない");
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`8bit 以外は読めない（${bitDepth}）`);
  if (colorType !== 2 && colorType !== 6) throw new Error(`RGB/RGBA 以外は読めない（${colorType}）`);
  if (interlace !== 0) throw new Error("インターレースは読めない");

  const ch = colorType === 2 ? 3 : 4;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(width * height * ch);
  const stride = width * ch;
  let ri = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[ri++];
    const line = raw.subarray(ri, ri + stride); ri += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {                       // Paeth
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`知らないフィルタ ${filter}`);
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, channels: ch, data: out };
}

/// 画素の RGB を標高[m]へ。取れない画素は null
export function pixelToElevation(r, g, b) {
  if (r === 128 && g === 0 && b === 0) return null;
  const x = r * 65536 + g * 256 + b;
  return x < 8388608 ? x * 0.01 : (x - 16777216) * 0.01;
}

export const tileX = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
export const tileY = (lat, z) => {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z);
};
/// タイル座標（小数）
export const tileXf = (lon, z) => (lon + 180) / 360 * 2 ** z;
export const tileYf = (lat, z) => {
  const r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z;
};

const cache = new Map();
/// タイルを取って憶える。**同じタイルを二度取りに行かない。**
export async function loadTile(z, x, y, { fetchImpl = fetch } = {}) {
  const key = `${z}/${x}/${y}`;
  if (cache.has(key)) return cache.get(key);
  const url = `https://cyberjapandata.gsi.go.jp/xyz/dem_png/${z}/${x}/${y}.png`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(20000) });
  if (res.status === 404) { cache.set(key, null); return null; }   // 海など、データの無い区画
  if (!res.ok) throw new Error(`タイルが取れません ${key}（HTTP ${res.status}）`);
  const img = decodePng(Buffer.from(await res.arrayBuffer()));
  cache.set(key, img);
  return img;
}

/// 緯度経度の標高。タイルは自動で取得・再利用する
export async function elevationAt(lat, lon, z = 11, opts = {}) {
  const fx = tileXf(lon, z), fy = tileYf(lat, z);
  const img = await loadTile(z, Math.floor(fx), Math.floor(fy), opts);
  if (!img) return null;
  const px = Math.min(img.width - 1, Math.floor((fx % 1) * img.width));
  const py = Math.min(img.height - 1, Math.floor((fy % 1) * img.height));
  const i = (py * img.width + px) * img.channels;
  return pixelToElevation(img.data[i], img.data[i + 1], img.data[i + 2]);
}

export const tileCacheSize = () => cache.size;
