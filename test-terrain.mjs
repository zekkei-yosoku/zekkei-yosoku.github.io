// 標高タイル（国土地理院 dem_png）の読み方。**通信しない。** Image と canvas を差し替えて形だけを検査する。
//
// 2026-09-22: 富士市で月の地形地平線が平らに落ちていた。駿河湾の「標高なし」画素 816点を
// Open-Meteo で埋め直し、100点ずつ 9回叩いて本番で 429 が続き、測定ごと失敗していた。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const T = require("./sorami-terrain.js");

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };

// タイル座標 → 画素の決め方（x+y が偶数なら陸 12.34m、奇数なら「標高なし」(128,0,0)）。
// MISSING に入れたタイルは 404（海だけの区画）として onerror を返す。
const MISSING = new Set();
const requested = [];
globalThis.Image = class {
  set src(url) {
    requested.push(url);
    const m = url.match(/\/(\d+)\/(\d+)\/(\d+)\.png$/);
    this._key = `${m[2]}/${m[3]}`;
    this.width = 256; this.height = 256;
    queueMicrotask(() => (MISSING.has(this._key) ? this.onerror() : this.onload()));
  }
};
globalThis.document = {
  createElement: () => {
    let key = null;
    return {
      getContext: () => ({
        drawImage: (img) => { key = img._key; },
        getImageData: (_x, _y, w, h) => {
          const [x, y] = key.split("/").map(Number);
          const sea = (x + y) % 2 === 1;
          const data = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < w * h; i++) {
            if (sea) { data[i * 4] = 128; } else { data[i * 4 + 2] = 1234 & 255; data[i * 4 + 1] = 1234 >> 8; }
          }
          return { width: w, height: h, data };
        },
      }),
    };
  },
};

// z11 のタイル番号から、その中央の緯度経度
const center = (x, y, z = 11) => {
  const n = Math.PI - 2 * Math.PI * (y + 0.5) / 2 ** z;
  return { latitude: 180 / Math.PI * Math.atan(Math.sinh(n)), longitude: (x + 0.5) / 2 ** z * 360 - 180 };
};
const LAND = center(1812, 810);      // 偶数 → 陸
const SEA = center(1812, 811);       // 奇数 → 「標高なし」
const GONE = center(1813, 812);      // 404

const counting = () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const n = new URL(url).searchParams.get("latitude").split(",").length;
    calls.push(n);
    return new Response(JSON.stringify({ elevation: Array(n).fill(7) }), { status: 200 });
  };
  return { calls, fetchImpl };
};

console.log("== 海の画素は 0m、Open-Meteo へ回さない ==");
{
  const { calls, fetchImpl } = counting();
  const pts = [...Array(300)].map((_, i) => (i % 2 ? SEA : LAND));
  const e = await T.elevations(pts, { fetchImpl });
  ok(calls.length === 0, "海の点が 300点中 150点あっても Open-Meteo を叩かない", `calls=${calls.length}`);
  ok(e[0] === 12.34, "陸は画素の値", `${e[0]}`);
  ok(e[1] === 0, "海は 0m", `${e[1]}`);
  ok(e.length === 300 && e.every((v) => v !== null), "全点が埋まる");
}

console.log("== タイルが取れない点だけ Open-Meteo で埋める ==");
{
  MISSING.add("1813/812");
  const { calls, fetchImpl } = counting();
  const e = await T.elevations([LAND, SEA, GONE, GONE], { fetchImpl });
  ok(calls.length === 1 && calls[0] === 2, "404 タイルの 2点だけを 1回で問い合わせる", JSON.stringify(calls));
  ok(e[0] === 12.34 && e[1] === 0 && e[2] === 7 && e[3] === 7, "順序どおりに戻る", JSON.stringify(e));
}

console.log("== 1点読み（観測点の地面）は従来どおり ==");
{
  ok(await T.elevationFromTile(LAND.latitude, LAND.longitude) === 12.34, "陸は値");
  ok(await T.elevationFromTile(SEA.latitude, SEA.longitude) === null, "「標高なし」は null のまま（呼び手が判断する）");
  ok(await T.elevationFromTile(GONE.latitude, GONE.longitude) === null, "404 も null");
  ok(await T.elevationFromTile(10, 10) === null, "国外は null");
}

console.log(`\n${fail === 0 ? "TERRAIN OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
