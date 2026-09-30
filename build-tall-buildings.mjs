/*
 * 塔（スカイツリー・東京タワー）のまわりの高い建物を取り、同梱する。**一度走らせて、結果を同梱する。**
 *
 *   node build-tall-buildings.mjs    → data/tall-buildings.json
 *
 * ねらうの塔の候補地で「建物で先端が隠れる場所」を外すのに、画面から毎回 Overpass へ問い合わせていたが、
 * 24か所の帯をまとめて引く問い合わせは混んだ公開サーバーで 47〜64秒かかり、画面では使えなかった（2026-10-01）。
 * 隠す主役になる**高い建物（7階以上、または 20m 以上）**だけを先に取っておき、画面では手元で判定する。
 * 低い建物は数が多すぎるので持たない（近くの低い建物は、現地で立つ位置を少し動かせば避けられる）。
 *
 * 範囲: スカイツリーの 40km・東京タワーの 22km（線を引く距離）を覆う矩形を 0.1° の升に割り、1升ずつ取る。
 * Overpass には名乗りを付け、使うメモリを小さく宣言し、**1本ずつ・間をあけて**投げる（2026-09-30 に投げすぎて遮断された）。
 * 出典: © OpenStreetMap contributors（ODbL）
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const TR = require("./sorami-terrain.js");

const CACHE = "data/tall-buildings-cache";
const OUT = "data/tall-buildings.json";
fs.mkdirSync(CACHE, { recursive: true });
const UA = "zekkei-yosoku tall-buildings builder (https://zekkei-yosoku.github.io)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EP = "https://overpass-api.de/api/interpreter";
const MIN_M = 20;

// 7階以上・20m 以上だけをサーバー側で選ぶ（全部の建物を持ってくると重い）
const QUERY = (s, w, n, e) => `[out:json][timeout:90][maxsize:67108864];
(
  way["building"]["building:levels"~"^([7-9]|[1-9][0-9]+)$"](${s},${w},${n},${e});
  way["building"]["height"~"^([2-9][0-9]|[1-9][0-9][0-9])(\\\\.[0-9]+)? ?m?$"](${s},${w},${n},${e});
  way["man_made"~"^(tower|chimney)$"]["height"](${s},${w},${n},${e});
);
out tags geom qt;`;

async function overpass(q) {
  for (let i = 0; i < 8; i++) {
    try {
      const res = await fetch(EP, { method: "POST", headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(q) });
      const text = await res.text();
      if (res.ok && text.trim().startsWith("{")) {
        const j = JSON.parse(text);
        if (!j.remark) return j;
        console.log(`    打ち切り: ${j.remark.slice(0, 80)}`);
      } else console.log(`    ${res.status} → 待つ`);
      // 429 は枠が空くまで、504 は混雑。どちらも長めに待つ
      await sleep(res.status === 429 ? 120000 : 60000);
    } catch (err) { console.log(`    ${err.message} → 待つ`); await sleep(60000); }
  }
  throw new Error("Overpass が返らない");
}

const S = { latitude: 35.710063, longitude: 139.8107 }, T = { latitude: 35.658581, longitude: 139.745433 };
const near = (la, lo) => TR.distanceKm(S.latitude, S.longitude, la, lo) <= 41 || TR.distanceKm(T.latitude, T.longitude, la, lo) <= 23;
const STEP = 0.1;
const cells = [];
for (let s = 35.33; s < 36.1; s += STEP) for (let w = 139.35; w < 140.27; w += STEP) {
  let hit = false;
  for (let i = 0; i <= 2 && !hit; i++) for (let k = 0; k <= 2 && !hit; k++) hit = near(s + STEP * i / 2, w + STEP * k / 2);
  if (hit) cells.push([Number(s.toFixed(2)), Number(w.toFixed(2))]);
}
// スカイツリーに近い升から
cells.sort((a, b) => Math.hypot(a[0] - S.latitude, a[1] - S.longitude) - Math.hypot(b[0] - S.latitude, b[1] - S.longitude));
console.log(`升 ${cells.length} 個（${STEP}°）`);

const kx = (lat) => Math.cos(lat * Math.PI / 180) * 111320, ky = 110574;
// 候補地は塔から見て太陽・月が出入りする方角（35〜145°・215〜325°）にしかない。建物もその方角だけ持つ
const SECT = (b) => (b >= 30 && b <= 150) || (b >= 210 && b <= 330);
const inSector = (la, lo) =>
  (TR.distanceKm(S.latitude, S.longitude, la, lo) <= 41 && SECT(TR.bearing(S.latitude, S.longitude, la, lo)))
  || (TR.distanceKm(T.latitude, T.longitude, la, lo) <= 23 && SECT(TR.bearing(T.latitude, T.longitude, la, lo)));

const seen = new Set();
const out = [];
let n = 0;
for (const [s, w] of cells) {
  const file = path.join(CACHE, `${s}_${w}.json`);
  let j;
  if (fs.existsSync(file)) j = JSON.parse(fs.readFileSync(file, "utf8"));
  else {
    j = await overpass(QUERY(s, w, Number((s + STEP).toFixed(2)), Number((w + STEP).toFixed(2))));
    fs.writeFileSync(file, JSON.stringify(j));
    await sleep(5000);
  }
  for (const el of j.elements || []) {
    if (seen.has(el.id) || !el.geometry || el.geometry.length < 3) continue;
    seen.add(el.id);
    const h = TR.buildingHeightM(el.tags);
    if (!Number.isFinite(h) || h < MIN_M) continue;
    // **円で持つ**（中心・面積と同じ円の半径・高さ）。外周の形まで持つと数MB になる。
    // 線が建物に入る距離の見積もりには円で足りる（塔の先端を隠すかは、高さと距離でほぼ決まる）
    const g = el.geometry;
    const c = [g.reduce((a, p) => a + p.lat, 0) / g.length, g.reduce((a, p) => a + p.lon, 0) / g.length];
    if (!inSector(c[0], c[1])) continue;
    let area = 0;
    for (let i = 0, k = g.length - 1; i < g.length; k = i++) {
      area += (g[k].lon - c[1]) * kx(c[0]) * (g[i].lat - c[0]) * ky - (g[i].lon - c[1]) * kx(c[0]) * (g[k].lat - c[0]) * ky;
    }
    const r = Math.sqrt(Math.abs(area) / 2 / Math.PI);
    out.push([Math.round(c[0] * 1e5), Math.round(c[1] * 1e5), Math.round(h), Math.max(3, Math.round(r))]);
  }
  if (++n % 10 === 0) console.log(`  ${n}/${cells.length} 升 ・ 建物 ${out.length}`);
}
fs.writeFileSync(OUT, JSON.stringify({
  builtOn: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
  source: "© OpenStreetMap contributors (ODbL)", minHeightM: MIN_M,
  // [中心の緯度×1e5, 中心の経度×1e5, 高さm, 面積と同じ円の半径m]
  buildings: out,
}));
console.log(`→ ${OUT} ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB ・ ${out.length} 棟`);
