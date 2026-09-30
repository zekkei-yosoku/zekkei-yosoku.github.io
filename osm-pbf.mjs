/*
 * OpenStreetMap の PBF ファイルから、タグの付いた点（node）だけを抜き出す。**外部パッケージを使わない。**
 *
 * 2026-09-30、地名索引を Overpass で全国ぶん取ろうとして、混雑と遮断で取れなかった。
 * Geofabrik が配っている地域別の抽出（*.osm.pbf）を手元で読めば、公開 API に負荷をかけずに済む。
 *
 * PBF の形（https://wiki.openstreetmap.org/wiki/PBF_Format）:
 *   [4バイトの長さ][BlobHeader][Blob] のくり返し。Blob は zlib で縮めた PrimitiveBlock。
 *   PrimitiveBlock = 文字列表 ＋ PrimitiveGroup（DenseNodes / Node / Way / Relation）。
 *   DenseNodes は id・緯度・経度を差分で、タグを「キー,値,…,0」の並びで持つ。
 * 道（way）と関係（relation）は読まない（名前のある展望地は大半が点）。
 */
import fs from "node:fs";
import zlib from "node:zlib";

/// protobuf の読み手。varint は 2^53 まで Number で扱う（OSM の id と座標はその内側）
class Reader {
  constructor(buf, start = 0, end = buf.length) { this.b = buf; this.p = start; this.end = end; }
  eof() { return this.p >= this.end; }
  varint() {
    let r = 0, mul = 1, byte;
    do {
      byte = this.b[this.p++];
      r += (byte & 0x7f) * mul;
      mul *= 128;
    } while (byte & 0x80);
    return r;
  }
  svarint() { const n = this.varint(); return n % 2 === 0 ? n / 2 : -(n + 1) / 2; }
  bytes() { const len = this.varint(); const s = this.p; this.p += len; return [s, this.p]; }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.p += 8;
    else if (wire === 2) { const len = this.varint(); this.p += len; }
    else if (wire === 5) this.p += 4;
    else throw new Error(`知らない wire type ${wire}`);
  }
}

/// 詰め込まれた varint の並び（packed）をすべて読む
function packed(buf, [s, e], signed) {
  const r = new Reader(buf, s, e), out = [];
  while (!r.eof()) out.push(signed ? r.svarint() : r.varint());
  return out;
}

/**
 * PBF を頭から読み、`wanted(tags)` が真の点を返す。
 * @param {string} file
 * @param {object} opts  keys: 調べるキー（この中に1つでもあれば候補）。onProgress(読んだバイト, 全体)
 * @returns {Array<{type:"node", id, lat, lon, tags}>}
 */
export function readTaggedNodes(file, wanted, { keys = [], onProgress = null, limitBytes = Infinity } = {}) {
  const fd = fs.openSync(file, "r");
  const size = Math.min(fs.fstatSync(fd).size, limitBytes);
  const out = [];
  const lenBuf = Buffer.alloc(4);
  let pos = 0, blocks = 0;
  const keySet = new Set(keys);
  try {
    while (pos < size) {
      fs.readSync(fd, lenBuf, 0, 4, pos); pos += 4;
      const hlen = lenBuf.readUInt32BE(0);
      const hbuf = Buffer.alloc(hlen);
      fs.readSync(fd, hbuf, 0, hlen, pos); pos += hlen;
      // BlobHeader: 1 type, 3 datasize
      let type = "", datasize = 0;
      for (const r = new Reader(hbuf); !r.eof();) {
        const tag = r.varint(), f = tag >>> 3, w = tag & 7;
        if (f === 1 && w === 2) { const [s, e] = r.bytes(); type = hbuf.toString("utf8", s, e); }
        else if (f === 3 && w === 0) datasize = r.varint();
        else r.skip(w);
      }
      if (pos + datasize > size) break;              // 途中まで（limitBytes）で止めたとき
      const bbuf = Buffer.alloc(datasize);
      fs.readSync(fd, bbuf, 0, datasize, pos); pos += datasize;
      if (type !== "OSMData") continue;
      // Blob: 1 raw, 3 zlib_data
      let data = null;
      for (const r = new Reader(bbuf); !r.eof();) {
        const tag = r.varint(), f = tag >>> 3, w = tag & 7;
        if (f === 1 && w === 2) { const [s, e] = r.bytes(); data = bbuf.subarray(s, e); }
        else if (f === 3 && w === 2) { const [s, e] = r.bytes(); data = zlib.inflateSync(bbuf.subarray(s, e)); }
        else r.skip(w);
      }
      if (!data) throw new Error("zlib 以外の圧縮は読めない");
      readBlock(data, wanted, keySet, out);
      if (onProgress && ++blocks % 500 === 0) onProgress(pos, size, out.length);
    }
  } finally { fs.closeSync(fd); }
  return out;
}

function readBlock(buf, wanted, keySet, out) {
  // PrimitiveBlock: 1 stringtable, 2 primitivegroup, 17 granularity, 19 lat_offset, 20 lon_offset
  let st = null; const groups = []; let gran = 100, latOff = 0, lonOff = 0;
  for (const r = new Reader(buf); !r.eof();) {
    const tag = r.varint(), f = tag >>> 3, w = tag & 7;
    if (f === 1 && w === 2) st = r.bytes();
    else if (f === 2 && w === 2) groups.push(r.bytes());
    else if (f === 17 && w === 0) gran = r.varint();
    else if (f === 19 && w === 0) latOff = r.varint();
    else if (f === 20 && w === 0) lonOff = r.varint();
    else r.skip(w);
  }
  // 文字列表は、位置だけ持って必要なときに読む
  const strs = [];
  if (st) for (const r = new Reader(buf, st[0], st[1]); !r.eof();) {
    const tag = r.varint(), f = tag >>> 3, w = tag & 7;
    if (f === 1 && w === 2) strs.push(r.bytes()); else r.skip(w);
  }
  const str = (i) => buf.toString("utf8", strs[i][0], strs[i][1]);
  // 調べるキーの番号（この表の中で）
  const keyIdx = new Set();
  strs.forEach((_, i) => { if (keySet.has(str(i))) keyIdx.add(i); });
  if (!keyIdx.size) return;
  const coord = (off, v) => 1e-9 * (off + gran * v);

  for (const [gs, ge] of groups) {
    for (const r = new Reader(buf, gs, ge); !r.eof();) {
      const tag = r.varint(), f = tag >>> 3, w = tag & 7;
      if (f === 2 && w === 2) {                       // DenseNodes
        const [ds, de] = r.bytes();
        let ids = null, lats = null, lons = null, kv = null;
        for (const d = new Reader(buf, ds, de); !d.eof();) {
          const t2 = d.varint(), f2 = t2 >>> 3, w2 = t2 & 7;
          if (f2 === 1 && w2 === 2) ids = d.bytes();
          else if (f2 === 8 && w2 === 2) lats = d.bytes();
          else if (f2 === 9 && w2 === 2) lons = d.bytes();
          else if (f2 === 10 && w2 === 2) kv = d.bytes();
          else d.skip(w2);
        }
        if (!kv) continue;                             // タグの付いた点が1つも無い塊
        const kvs = packed(buf, kv, false);
        // まずタグだけ見て、欲しいキーを持つ点の番号を集める（座標は必要な点だけ足し上げる）
        const hit = new Map();
        for (let i = 0, n = 0; i < kvs.length; n++) {
          let has = false; const start = i;
          while (kvs[i] !== 0) { if (keyIdx.has(kvs[i])) has = true; i += 2; }
          if (has) hit.set(n, [start, i]);
          i++;
        }
        if (!hit.size) continue;
        const idv = packed(buf, ids, true), la = packed(buf, lats, true), lo = packed(buf, lons, true);
        let id = 0, lat = 0, lon = 0;
        for (let n = 0; n < idv.length; n++) {
          id += idv[n]; lat += la[n]; lon += lo[n];
          const h = hit.get(n);
          if (!h) continue;
          const tags = {};
          for (let i = h[0]; i < h[1]; i += 2) tags[str(kvs[i])] = str(kvs[i + 1]);
          if (wanted(tags)) out.push({ type: "node", id, lat: coord(latOff, lat), lon: coord(lonOff, lon), tags });
        }
      } else if (f === 1 && w === 2) {                // Node（まれ）
        const [ns, ne] = r.bytes();
        let id = 0, lat = 0, lon = 0, keys = [], vals = [];
        for (const d = new Reader(buf, ns, ne); !d.eof();) {
          const t2 = d.varint(), f2 = t2 >>> 3, w2 = t2 & 7;
          if (f2 === 1 && w2 === 0) id = d.svarint();
          else if (f2 === 2 && w2 === 2) keys = packed(buf, d.bytes(), false);
          else if (f2 === 3 && w2 === 2) vals = packed(buf, d.bytes(), false);
          else if (f2 === 8 && w2 === 0) lat = d.svarint();
          else if (f2 === 9 && w2 === 0) lon = d.svarint();
          else d.skip(w2);
        }
        if (!keys.some((k) => keyIdx.has(k))) continue;
        const tags = {};
        keys.forEach((k, i) => { tags[str(k)] = str(vals[i]); });
        if (wanted(tags)) out.push({ type: "node", id, lat: coord(latOff, lat), lon: coord(lonOff, lon), tags });
      } else r.skip(w);
    }
  }
}
