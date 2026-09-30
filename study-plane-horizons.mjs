// 月丼: 建物が取れなかった5か所（浮島町公園・東扇島東公園・川崎マリエン・若洲海浜公園・海ほたる）の地平線を取り直す。
// Overpass が空いているときに `node study-plane-horizons.mjs` で走らせ、出た配列を sorami-routes.js の SPOT_HORIZONS へ入れる。
// 2026-09-30 は Overpass が一日じゅう応答せず、5か所とも取れなかった。
// 月丼: 建物が取れなかった5か所の地平線を取り直す（地形の値と建物の値の大きいほう）
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const TR = require("./sorami-terrain.js"); const RT = require("./sorami-routes.js");
const ids = ["ukishima", "higashiogishima", "marien", "wakasu", "umihotaru"];
const EP = ["https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const out = {};
for (const id of ids) {
  const s = RT.SPOTS.find((x) => x.id === id);
  const eye = 1.5 + (s.deckM || 0);
  let prof = null;
  for (let k = 0; k < 4 && !prof; k++) {
    prof = await TR.urbanHorizon({ latitude: s.latitude, longitude: s.longitude, elevation: eye, groundM: 0, locationScope: "point" },
      { radiusM: [1000, 600, 400], endpoint: EP, timeoutMs: 90000 });
    if (!prof) await new Promise((r) => setTimeout(r, 20000));
  }
  if (!prof) { console.log(id, "建物が取れない"); continue; }
  const old = RT.SPOT_HORIZONS[id];
  const merged = old.map((v, i) => {
    // 5°ごとの升: その升の中（±2.5°）の建物の最大
    let m = -90;
    for (let a = i * 5 - 2; a <= i * 5 + 2; a++) m = Math.max(m, prof[((a % 360) + 360) % 360].horizonAngleDeg);
    return Math.max(v, Math.round(Math.max(0, m) * 10));
  });
  out[id] = merged;
  console.log(id, `建物 ${prof.meta.buildings}棟（高さ推定 ${prof.meta.estimatedHeights}）半径${prof.meta.radiusM}m`,
    "変わった方位", merged.filter((v, i) => v !== old[i]).length, "最大", Math.max(...merged) / 10, "°");
}
console.log(JSON.stringify(out));
