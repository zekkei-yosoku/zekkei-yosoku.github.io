// 月丼: 建物の高さが OSM に入っていない5か所（浮島町公園・東扇島東公園・川崎マリエン・若洲海浜公園・海ほたる）の地平線。
//
// 2026-09-30 に取り直したら、どこも半径1kmに建物は100〜190棟あるのに、**高さの入った建物は0棟**だった。
// 「高さの分かる建物だけ」の決まり（urbanHorizon）では地形のままになるので、ここだけ
// **高さの無い建物を種類ごとの目安の高さで数える**（工場・倉庫など 12m、そのほか 8m）。
// 出た配列を sorami-routes.js の SPOT_HORIZONS へ入れる（地形の値と大きいほう）。
//
//   node study-plane-horizons.mjs
//
// 名乗り（User-Agent）を付けて、個別のサーバー（z・lz4）へ1本ずつ投げる（名乗りが無いと 406 で弾かれる）。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const TR = require("./sorami-terrain.js");
const RT = require("./sorami-routes.js");
const EP = ["https://z.overpass-api.de/api/interpreter", "https://lz4.overpass-api.de/api/interpreter"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INDUSTRIAL = /^(industrial|warehouse|factory|manufacture|storage_tank|hangar|commercial|retail|office)$/;
// 床面積の小さい建物（150m²未満＝公園のトイレ・小屋・守衛所）は 4m。8m と見なすと、園内の小屋が近くで大きく塞ぐ
const assumed = (t, areaM2) => (areaM2 < 150 ? 4 : INDUSTRIAL.test(t.building || "") || t.man_made === "storage_tank" ? 12 : 8);
const areaOf = (g, lat0) => {
  const kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110574;
  let a = 0;
  for (let i = 0, j = g.length - 1; i < g.length; j = i++) a += (g[j].lon * kx) * (g[i].lat * ky) - (g[i].lon * kx) * (g[j].lat * ky);
  return Math.abs(a) / 2;
};

async function overpass(q) {
  for (let i = 0; i < 6; i++) {
    const url = EP[i % EP.length];
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "zekkei-yosoku study" },
        body: "data=" + encodeURIComponent(q) });
      if (r.ok) { const j = await r.json(); if (!j.remark) return j; }
    } catch { /* 次へ */ }
    await sleep(5000 * (i + 1));
  }
  return null;
}

const out = {};
for (const id of ["ukishima", "higashiogishima", "marien", "wakasu", "umihotaru"]) {
  const s = RT.SPOTS.find((x) => x.id === id);
  const eye = 1.5 + (s.deckM || 0);
  const R = 1000;
  const j = await overpass(`[out:json][timeout:90];(way["building"](around:${R},${s.latitude},${s.longitude});`
    + `way["man_made"~"^(storage_tank|tower|chimney|silo)$"](around:${R},${s.latitude},${s.longitude}););out tags geom;`);
  if (!j) { console.log(id, "取れない"); continue; }
  const prof = new Array(72).fill(0);           // 5°ごと、0.1°単位
  const who = new Array(72).fill("");
  let used = 0, known = 0;
  for (const el of j.elements) {
    const g = el.geometry;
    if (!g || g.length < 3) continue;
    let h = TR.buildingHeightM(el.tags);
    if (h === null) h = assumed(el.tags || {}, areaOf(g, s.latitude)); else known++;
    const pts = g.map((p) => [TR.bearing(s.latitude, s.longitude, p.lat, p.lon), TR.distanceKm(s.latitude, s.longitude, p.lat, p.lon) * 1000]);
    if (Math.min(...pts.map((x) => x[1])) < 3) continue;      // 自分が立っている建物（展望室の建物など）
    used++;
    for (let i = 0; i < pts.length; i++) {
      const [b1, d1] = pts[i], [b2, d2] = pts[(i + 1) % pts.length];
      const db = ((b2 - b1 + 540) % 360) - 180;
      if (Math.abs(db) > 90) continue;
      const n = Math.max(1, Math.ceil(Math.abs(db)));
      for (let k = 0; k <= n; k++) {
        const b = ((b1 + db * k / n) % 360 + 360) % 360, d = d1 + (d2 - d1) * k / n;
        const a = Math.atan2(h - eye, d) * 180 / Math.PI;
        const idx = Math.round(b / 5) % 72;
        const v = Math.round(Math.max(0, a) * 10);
        if (v > prof[idx]) { prof[idx] = v; who[idx] = `${el.tags.building || el.tags.man_made} ${Math.round(areaOf(g, s.latitude))}m² ${h}m ${Math.round(d)}m先`; }
      }
    }
  }
  const old = RT.SPOT_HORIZONS[id];
  const merged = old.map((v, i) => Math.max(v, prof[i]));
  out[id] = merged;
  const changed = merged.map((v, i) => [i * 5, old[i], v]).filter(([, a, b]) => a !== b);
  console.log(`${id} ${s.name}: 建物 ${used}棟（高さの入った建物 ${known}）・変わった方位 ${changed.length}・最大 ${Math.max(...merged) / 10}°`);
  if (process.env.WHO) for (let i = 0; i < 72; i += 1) if (prof[i] >= 30) console.log(`   ${i * 5}° ${prof[i] / 10}° ← ${who[i]}`);
  await sleep(2000);
}
console.log(JSON.stringify(out));
