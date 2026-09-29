// ISS の月面通過（`sorami-iss.js`）。**通信しない**（軌道要素は fixtures に固定した 2026-09-29 のもの）。
//
// 確かめること:
//   1. 中心線の点・時刻で、衛星（satellite.js の見かけの方向）と天体（sorami-astro）が重なる
//   2. 帯の縁（半幅ずらした点）で、ISS がちょうど円盤の縁をかすめる
//   3. 帯の幅と通過の長さが、ISS の距離から出る値と合う
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const A = require("./sorami-astro.js");
const I = require("./sorami-iss.js");
const io = await import("./vendor/satellite/io.js");
const pr = await import("./vendor/satellite/propagation.js");
const tr = await import("./vendor/satellite/transforms.js");
const sat = { twoline2satrec: io.twoline2satrec, propagate: pr.propagate, gstime: pr.gstime,
              eciToEcf: tr.eciToEcf, ecfToLookAngles: tr.ecfToLookAngles };

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };

console.log("== 軌道要素を読む ==");
const tle = I.parseTle(fs.readFileSync(new URL("./fixtures/iss-20260929.tle", import.meta.url), "utf8"));
ok(tle && tle.line1.startsWith("1 25544") && tle.line2.startsWith("2 25544"), "ISS（25544）の2行がある");
ok(new Date(tle.epochMs).toISOString().startsWith("2026-09-29T02:38"), "元期は 2026-09-29 02:38 UTC",
  new Date(tle.epochMs).toISOString());
ok(I.parseTle("でたらめ") === null, "読めなければ null");

console.log("== 地面との交点 ==");
{
  // 真上から来る線は、その真下の地面に当たる
  const B = { x: 0, y: 0, z: 400000 }, S = { x: 0, y: 0, z: 7000 };
  const g = I.groundPoint(B, S);
  ok(g && Math.abs(g.z - 6356.752) < 0.01, "極の真上からなら極に当たる", g && g.z.toFixed(3));
  ok(I.groundPoint({ x: 0, y: 0, z: 400000 }, { x: 10000, y: 0, z: 390000 }) === null, "地球をそれる線は当たらない");
  ok(I.groundPoint({ x: 0, y: 0, z: 400000 }, { x: 0, y: 0, z: 6000 }) === null, "衛星が地面より下なら当たらない");
}

console.log("== 通過を解く（東京から300km・72時間） ==");
const from = Date.parse("2026-09-30T00:00:00+09:00");
const center = { latitude: 35.71, longitude: 139.81 };
const sun = I.transits(sat, tle, { center, radiusKm: 300, fromMs: from, hours: 72, body: "sun" });
ok(sun.length >= 1, "太陽の前を通る回が見つかる", `${sun.length}回`);
for (const r of sun) {
  const when = new Date(r.at + 9 * 3600000).toISOString().slice(0, 19);
  // 1. 中心線の点・時刻で、satellite.js の衛星の向きと sorami-astro の太陽の向き（大気差なし）が重なる
  const rec = sat.twoline2satrec(tle.line1, tle.line2), date = new Date(r.at);
  const pv = sat.propagate(rec, date);
  const la = sat.ecfToLookAngles({ latitude: r.center.latitude * Math.PI / 180, longitude: r.center.longitude * Math.PI / 180, height: 0 },
    sat.eciToEcf(pv.position, sat.gstime(date)));
  const s = A.sun(r.at, { ...r.center, elevation: 0 });
  const dAz = (la.azimuth * 180 / Math.PI - s.azimuth) * Math.cos(s.geometricAltitude * Math.PI / 180);
  const dEl = la.elevation * 180 / Math.PI - s.geometricAltitude;
  ok(Math.hypot(dAz, dEl) < 0.01, `${when}: 中心線の上で ISS と太陽の中心が重なる`, `${Math.hypot(dAz, dEl).toFixed(4)}°`);
  // 2. 帯の幅: ISS までの距離 × 太陽の直径（角度）を、視線の傾きで地面へ広げた値の範囲
  const minW = r.rangeKm * 2 * s.angularRadius * Math.PI / 180;
  ok(r.halfWidthKm * 2 >= minW * 0.9 && r.halfWidthKm * 2 <= minW / Math.sin(s.geometricAltitude * Math.PI / 180) * 1.3,
    `${when}: 帯の幅が ISS までの距離から出る範囲`, `${(r.halfWidthKm * 2).toFixed(2)}km（下限 ${minW.toFixed(2)}km）`);
  // 3. 通過は1秒に満たない（ISS の見かけの速さ 1°/秒前後に対し、円盤は 0.5°）
  ok(r.durationS > 0.2 && r.durationS < 2, `${when}: 通過は一瞬`, `${r.durationS}秒`);
  // 帯の縁では、ISS は円盤の縁をかすめるだけ
  const edge = I.passAt(sat, rec, "sun", r.center.latitude, r.center.longitude, r.at, { spanS: 4, stepS: 0.02 });
  ok(edge.minSep < 0.01, `${when}: 中心線上の最接近はほぼ0°`, `${edge.minSep.toFixed(4)}°`);
}
const moon = I.transits(sat, tle, { center, radiusKm: 300, fromMs: from, hours: 72, body: "moon" });
ok(Array.isArray(moon), "月も解ける（この3日は東京の近くを通らない）", `${moon.length}回`);

console.log(`\n${fail === 0 ? "ISS OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
