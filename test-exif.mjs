// EXIF の読み取り。**合成したバイト列で検査する。**（個人の写真を使わない）
//
// 写真そのものは扱わない。撮影時刻と座標だけ取り出して画像は捨てる設計なので、
// ここで検査するのはバイト列の解釈だけ。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("./sorami-exif.js");

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };

// ---- EXIF 付き JPEG を組み立てる ----
function buildJpeg({ dateTimeOriginal, offsetTime, lat, lon, altM, little = true }) {
  const entries = [];               // IFD0
  const exif = [];                  // Exif IFD
  const gps = [];                   // GPS IFD
  const heap = [];                  // 4バイトに収まらない値の置き場
  let heapLen = 0;
  const pushHeap = (bytes) => { const at = heapLen; heap.push(bytes); heapLen += bytes.length; return at; };
  const ascii = (s) => { const b = [...s].map(c => c.charCodeAt(0)); b.push(0); if (b.length % 2) b.push(0); return b; };
  const rat = (nums) => {
    const b = [];
    for (const [n, d] of nums) {
      for (const x of [n, d]) {
        if (little) b.push(x & 255, (x >> 8) & 255, (x >> 16) & 255, (x >>> 24) & 255);
        else b.push((x >>> 24) & 255, (x >> 16) & 255, (x >> 8) & 255, x & 255);
      }
    }
    return b;
  };
  const toDms = (deg) => { const a = Math.abs(deg); const d = Math.floor(a);
    const mF = (a - d) * 60; const m = Math.floor(mF); const s = Math.round((mF - m) * 60 * 1000);
    return [[d, 1], [m, 1], [s, 1000]]; };

  if (dateTimeOriginal) exif.push({ tag: 0x9003, type: 2, val: ascii(dateTimeOriginal) });
  if (offsetTime) exif.push({ tag: 0x9011, type: 2, val: ascii(offsetTime) });
  if (lat !== undefined && lat !== null) {
    gps.push({ tag: 1, type: 2, val: ascii(lat >= 0 ? "N" : "S") });
    gps.push({ tag: 2, type: 5, val: rat(toDms(lat)), count: 3 });
    gps.push({ tag: 3, type: 2, val: ascii(lon >= 0 ? "E" : "W") });
    gps.push({ tag: 4, type: 5, val: rat(toDms(lon)), count: 3 });
  }
  if (altM !== undefined && altM !== null) {
    gps.push({ tag: 5, type: 1, val: [altM < 0 ? 1 : 0], count: 1, inline: true });
    gps.push({ tag: 6, type: 5, val: rat([[Math.round(Math.abs(altM) * 100), 100]]), count: 1 });
  }

  // IFD をバイト列へ。offset は TIFF 先頭からの相対
  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };
  function ifdBytes(list, baseOffset, extraTags = []) {
    const all = [...list, ...extraTags];
    const n = all.length;
    const dirLen = 2 + n * 12 + 4;
    const body = []; let dataAt = baseOffset + dirLen;
    const dir = [];
    const u16 = (x) => little ? [x & 255, (x >> 8) & 255] : [(x >> 8) & 255, x & 255];
    const u32 = (x) => little ? [x & 255, (x >> 8) & 255, (x >> 16) & 255, (x >>> 24) & 255]
                              : [(x >>> 24) & 255, (x >> 16) & 255, (x >> 8) & 255, x & 255];
    dir.push(...u16(n));
    for (const e of all) {
      const count = e.count ?? e.val.length;
      const size = (TYPE_SIZE[e.type] || 1) * count;
      dir.push(...u16(e.tag), ...u16(e.type), ...u32(count));
      if (e.fixedOffset !== undefined) { dir.push(...u32(e.fixedOffset)); continue; }
      if (size <= 4) { const p = [...e.val]; while (p.length < 4) p.push(0); dir.push(...p.slice(0, 4)); }
      else { dir.push(...u32(dataAt)); body.push(...e.val); dataAt += size; }
    }
    dir.push(...u32(0));
    return [...dir, ...body];
  }
  // 先に子 IFD を置く場所を決める
  const ifd0Len = 2 + (2) * 12 + 4;                 // Exif ポインタ + GPS ポインタ の2件
  const exifAt = 8 + ifd0Len;
  const exifBytes = ifdBytes(exif, exifAt);
  const gpsAt = exifAt + exifBytes.length;
  const gpsBytes = ifdBytes(gps, gpsAt);
  const u32 = (x) => little ? [x & 255, (x >> 8) & 255, (x >> 16) & 255, (x >>> 24) & 255]
                            : [(x >>> 24) & 255, (x >> 16) & 255, (x >> 8) & 255, x & 255];
  const ifd0 = ifdBytes([], 8, [
    { tag: 0x8769, type: 4, count: 1, val: u32(exifAt), fixedOffset: exifAt },
    { tag: 0x8825, type: 4, count: 1, val: u32(gpsAt), fixedOffset: gpsAt },
  ]);
  const tiff = [
    ...(little ? [0x49, 0x49] : [0x4D, 0x4D]),
    ...(little ? [0x2A, 0x00] : [0x00, 0x2A]),
    ...u32(8),
    ...ifd0, ...exifBytes, ...gpsBytes,
  ];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const len = app1.length + 2;
  const bytes = [0xFF, 0xD8, 0xFF, 0xE1, (len >> 8) & 255, len & 255, ...app1, 0xFF, 0xD9];
  return new Uint8Array(bytes).buffer;
}

console.log("== 撮影時刻を読む ==");
{
  const b = buildJpeg({ dateTimeOriginal: "2026:09:15 05:31:02", offsetTime: "+09:00",
                        lat: 35.360555, lon: 138.727363, altM: 1250.5 });
  const r = E.read(b);
  ok(r !== null, "EXIF を見つけられる");
  ok(r.takenAtText === "2026:09:15 05:31:02", "撮影時刻の文字列", r && r.takenAtText);
  ok(r.offsetKnown === true && r.offsetText === "+09:00", "時差も読む", r && r.offsetText);
  const jst = new Date(r.takenAtMs + 9 * 3600000).toISOString();
  ok(jst.startsWith("2026-09-15T05:31:02"), "JST 5:31 として解釈できる", jst);
}

console.log("\n== 座標を読む ==");
{
  const b = buildJpeg({ dateTimeOriginal: "2026:09:15 05:31:02", offsetTime: "+09:00",
                        lat: 35.360555, lon: 138.727363, altM: 1250.5 });
  const r = E.read(b);
  ok(r.hasGps === true, "位置があることが分かる");
  ok(Math.abs(r.latitude - 35.360555) < 1e-4, "緯度", r.latitude?.toFixed(6));
  ok(Math.abs(r.longitude - 138.727363) < 1e-4, "経度", r.longitude?.toFixed(6));
  ok(Math.abs(r.altitudeM - 1250.5) < 0.1, "標高", r.altitudeM);
}

console.log("\n== 南半球・西経 ==");
{
  const b = buildJpeg({ dateTimeOriginal: "2026:01:02 03:04:05", offsetTime: "-05:00",
                        lat: -33.8688, lon: -70.6693 });
  const r = E.read(b);
  ok(r.latitude < 0 && Math.abs(r.latitude + 33.8688) < 1e-4, "南緯は負", r.latitude?.toFixed(4));
  ok(r.longitude < 0 && Math.abs(r.longitude + 70.6693) < 1e-4, "西経は負", r.longitude?.toFixed(4));
}

console.log("\n== ビッグエンディアン（Motorola 形式）==");
{
  const b = buildJpeg({ dateTimeOriginal: "2026:09:15 05:31:02", offsetTime: "+09:00",
                        lat: 35.360555, lon: 138.727363, little: false });
  const r = E.read(b);
  ok(r !== null && Math.abs(r.latitude - 35.360555) < 1e-4, "MM でも読める", r && r.latitude?.toFixed(6));
}

console.log("\n== 分からないものを決め打ちしない ==");
{
  // 時差が無い写真。JST とみなすと最大9時間ずれる
  const b = buildJpeg({ dateTimeOriginal: "2026:09:15 05:31:02", lat: 35.36, lon: 138.72 });
  const r = E.read(b);
  ok(r.offsetKnown === false, "時差が無いことを持ち回る");
  // **時差が無ければ瞬間を出さない。** EXIF の時刻はカメラの時計の壁の時刻であって
  // 瞬間ではない。UTC とみなして ms を出していたら、実機の Canon の写真で
  // macOS の読み取りと 9時間ずれた（2026-09-15 実測）
  ok(r.takenAtMs === null, "時差が分からなければ瞬間（ms）を出さない");
  ok(r.takenLocal === "2026-09-15T05:31:02", "壁の時刻は残す", r.takenLocal);
  // 撮った地点の時差を当てれば瞬間になる
  const ms = E.instantFrom(r.takenLocal, 540);
  ok(new Date(ms).toISOString().startsWith("2026-09-14T20:31:02"),
     "JST(+9) を当てると瞬間になる", new Date(ms).toISOString());
  ok(E.instantFrom(r.takenLocal, -300) > ms, "別の時差なら別の瞬間になる");
  ok(E.instantFrom(null, 540) === null && E.instantFrom(r.takenLocal, NaN) === null,
     "足りなければ null");

  // 位置情報を外した写真
  const b2 = buildJpeg({ dateTimeOriginal: "2026:09:15 05:31:02", offsetTime: "+09:00" });
  const r2 = E.read(b2);
  ok(r2.hasGps === false && r2.latitude === null, "位置が無ければ null（0度にしない）");
  ok(r2.takenAtMs !== null, "位置が無くても時刻は使える（時差が分かっていれば）");
}

console.log("\n== 壊れた入力で落ちない ==");
{
  ok(E.read(new ArrayBuffer(0)) === null, "空");
  ok(E.read(new Uint8Array([1, 2, 3, 4, 5, 6]).buffer) === null, "JPEG ですらない");
  ok(E.read(new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]).buffer) === null, "EXIF の無い JPEG");
  const b = new Uint8Array(buildJpeg({ dateTimeOriginal: "2026:09:15 05:31:02", lat: 35.36, lon: 138.72 }));
  for (const cut of [12, 20, 40, 60]) {
    const t = b.slice(0, Math.min(cut, b.length)).buffer;
    let threw = false;
    try { E.read(t); } catch { threw = true; }
    ok(!threw, `途中で切れたファイルで例外を投げない（${cut}バイト）`);
  }
}

console.log(`\n${fail ? "FAILED" : "EXIF OK"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail ? 1 : 0);
