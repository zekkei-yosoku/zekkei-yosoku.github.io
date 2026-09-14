/**
 * 写真の撮影時刻と位置を読む（EXIF）。**画像そのものは扱わない。**
 *
 * 記録の真値を増やすため。3択のボタンより、
 * 「いつ・どこで撮ったか」のほうが照合に使える。
 *
 * **写真は送らない。** ここで時刻と座標だけ取り出し、画像は捨てる。
 * 送るデータが増えないので、保存先も費用も変わらない。
 *
 * 依存パッケージなし。JPEG の APP1 に入る TIFF ヘッダを直接読む。
 */
(function (global) {
  "use strict";

  // TIFF のタグ番号。必要なものだけ
  const TAG = {
    EXIF_IFD: 0x8769,
    GPS_IFD: 0x8825,
    DATETIME: 0x0132,              // IFD0。更新時刻なので当てにしすぎない
    DATETIME_ORIGINAL: 0x9003,     // Exif IFD。**撮影した瞬間**
    OFFSET_TIME_ORIGINAL: 0x9011,  // Exif IFD。撮影時の時差（"+09:00"）
    GPS_LAT_REF: 1, GPS_LAT: 2, GPS_LON_REF: 3, GPS_LON: 4,
    GPS_ALT_REF: 5, GPS_ALT: 6, GPS_DATE: 29, GPS_TIME: 7,
  };
  // 型ごとの1要素あたりのバイト数
  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

  /// JPEG から APP1（Exif）の中身を切り出す
  function findExif(buf) {
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;   // SOI が無い
    let p = 2;
    while (p + 4 <= v.byteLength) {
      if (v.getUint8(p) !== 0xFF) return null;
      const marker = v.getUint8(p + 1);
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { p += 2; continue; }
      if (marker === 0xDA || marker === 0xD9) return null;            // 画像本体。ここより後に Exif は無い
      const len = v.getUint16(p + 2);
      if (marker === 0xE1 && len >= 8) {
        // "Exif\0\0"
        let ok = true;
        const sig = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
        for (let i = 0; i < 6; i++) if (v.getUint8(p + 4 + i) !== sig[i]) { ok = false; break; }
        if (ok) return { start: p + 10, end: p + 2 + len };
      }
      p += 2 + len;
    }
    return null;
  }

  /// IFD をたどってタグを集める
  function readIfd(v, tiff, offset, little, want, out, depth) {
    if (depth > 3 || offset <= 0 || tiff + offset + 2 > v.byteLength) return;
    const n = v.getUint16(tiff + offset, little);
    if (n > 512) return;                                  // 壊れたデータで暴走させない
    for (let i = 0; i < n; i++) {
      const e = tiff + offset + 2 + i * 12;
      if (e + 12 > v.byteLength) return;
      const tag = v.getUint16(e, little);
      const type = v.getUint16(e + 2, little);
      const count = v.getUint32(e + 4, little);
      const size = (TYPE_SIZE[type] || 0) * count;
      if (!size || count > 4096) continue;
      const at = size <= 4 ? e + 8 : tiff + v.getUint32(e + 8, little);
      if (at < 0 || at + size > v.byteLength) continue;

      if (tag === TAG.EXIF_IFD || tag === TAG.GPS_IFD) {
        const sub = v.getUint32(at, little);
        readIfd(v, tiff, sub, little, want, tag === TAG.GPS_IFD ? out.gps : out.exif, depth + 1);
        continue;
      }
      if (type === 2) {                                   // ASCII
        let s = "";
        for (let k = 0; k < count; k++) {
          const c = v.getUint8(at + k);
          if (c === 0) break;
          s += String.fromCharCode(c);
        }
        out[tag] = s;
      } else if (type === 5 || type === 10) {             // RATIONAL
        const vals = [];
        for (let k = 0; k < count; k++) {
          const num = type === 5 ? v.getUint32(at + k * 8, little) : v.getInt32(at + k * 8, little);
          const den = type === 5 ? v.getUint32(at + k * 8 + 4, little) : v.getInt32(at + k * 8 + 4, little);
          vals.push(den === 0 ? 0 : num / den);
        }
        out[tag] = vals;
      } else if (type === 1 || type === 7) {              // BYTE / UNDEFINED
        out[tag] = v.getUint8(at);
      } else if (type === 3) {
        out[tag] = v.getUint16(at, little);
      } else if (type === 4) {
        out[tag] = v.getUint32(at, little);
      }
    }
  }

  /// 度分秒 → 度
  const dms = (a, ref) => {
    if (!Array.isArray(a) || a.length < 3) return null;
    const d = a[0] + a[1] / 60 + a[2] / 3600;
    return (ref === "S" || ref === "W") ? -d : d;
  };

  /**
   * @param {ArrayBuffer} buf 画像のバイト列
   * @returns {{takenAtMs, takenAtText, offsetText, latitude, longitude, altitudeM, hasGps}|null}
   */
  function read(buf) {
    const loc = findExif(buf);
    if (!loc) return null;
    const v = new DataView(buf);
    const tiff = loc.start;
    if (tiff + 8 > v.byteLength) return null;
    const bom = v.getUint16(tiff);
    if (bom !== 0x4949 && bom !== 0x4D4D) return null;
    const little = bom === 0x4949;
    if (v.getUint16(tiff + 2, little) !== 0x002A) return null;
    const first = v.getUint32(tiff + 4, little);

    const out = { exif: {}, gps: {} };
    readIfd(v, tiff, first, little, null, out, 0);

    const dt = out.exif[TAG.DATETIME_ORIGINAL] || out[TAG.DATETIME] || null;
    const off = out.exif[TAG.OFFSET_TIME_ORIGINAL] || null;
    // "2026:09:15 05:31:02" → ISO
    //
    // **時差が分からないなら、瞬間（ms）を出さない。**
    //
    // EXIF の DateTimeOriginal は「カメラの時計の壁の時刻」であって瞬間ではない。
    // 時差タグ（OffsetTimeOriginal）はスマホは付けるが、**一眼は付けないことが多い**。
    // 最初 UTC とみなして ms を出していたら、実機の Canon の写真で
    // macOS の読み取り（JST解釈）と **9時間ずれた**（2026-09-15 実測）。
    // 呼び出し側が地点の時差で解釈できるよう、壁の時刻は文字列で返す。
    const local = (dt && /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/.test(dt))
      ? dt.slice(0, 10).replace(/:/g, "-") + "T" + dt.slice(11, 19)
      : null;
    let takenAtMs = null;
    const offsetKnown = !!(off && /^[+-]\d{2}:\d{2}$/.test(off));
    if (local && offsetKnown) {
      const t = Date.parse(local + off);
      if (Number.isFinite(t)) takenAtMs = t;
    }
    const lat = dms(out.gps[TAG.GPS_LAT], out.gps[TAG.GPS_LAT_REF]);
    const lon = dms(out.gps[TAG.GPS_LON], out.gps[TAG.GPS_LON_REF]);
    let alt = null;
    if (Array.isArray(out.gps[TAG.GPS_ALT])) {
      alt = out.gps[TAG.GPS_ALT][0];
      if (out.gps[TAG.GPS_ALT_REF] === 1) alt = -alt;    // 1 = 海面より下
    }
    return {
      // 瞬間。**時差が分かるときだけ埋まる**
      takenAtMs,
      // カメラの時計が示していた壁の時刻（"2026-09-15T05:31:02"）。時差は含まない
      takenLocal: local,
      takenAtText: dt,
      offsetText: off,
      offsetKnown,
      latitude: Number.isFinite(lat) ? lat : null,
      longitude: Number.isFinite(lon) ? lon : null,
      altitudeM: Number.isFinite(alt) ? alt : null,
      hasGps: Number.isFinite(lat) && Number.isFinite(lon),
    };
  }

  /**
   * 壁の時刻を、指定した時差で瞬間に直す。
   * 一眼は時差タグを持たないので、**撮った地点の時差**を呼び出し側が渡す
   * （アプリは Open-Meteo の `utc_offset_seconds` を既に持っている）。
   */
  function instantFrom(takenLocal, utcOffsetMinutes) {
    if (!takenLocal || !Number.isFinite(utcOffsetMinutes)) return null;
    const sign = utcOffsetMinutes < 0 ? "-" : "+";
    const a = Math.abs(utcOffsetMinutes);
    const hh = String(Math.floor(a / 60)).padStart(2, "0");
    const mm = String(a % 60).padStart(2, "0");
    const t = Date.parse(`${takenLocal}${sign}${hh}:${mm}`);
    return Number.isFinite(t) ? t : null;
  }

  /**
   * File から読む。**先頭だけを読む。**
   *
   * EXIF は JPEG の先頭（APP1）にあるので、全部を載せる必要がない。
   * iPhone の写真は 7MB あり、`file.arrayBuffer()` はそれを丸ごとメモリへ置く。
   * 既定の 256KB で足りなければ 1MB まで伸ばす。
   */
  async function readFile(file, { headBytes = 262144, maxBytes = 1048576 } = {}) {
    if (!file || typeof file.slice !== "function") return null;
    for (const n of [headBytes, maxBytes]) {
      const buf = await file.slice(0, Math.min(n, file.size)).arrayBuffer();
      const r = read(buf);
      if (r) return r;
      if (n >= file.size) break;      // 全部読んでも無い
    }
    return null;
  }

  const SoramiExif = { read, readFile, findExif, instantFrom, TAG };
  global.SoramiExif = SoramiExif;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiExif;
})(typeof globalThis !== "undefined" ? globalThis : window);
