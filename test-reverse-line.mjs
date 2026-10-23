// 逆算（2026-10-20 trial）: 重ね方に「少しずらす」を足した線。**通信しない。**
// 線の点から見ると、天体の中心が目標の先端から、指定した直径ぶん右・上にある
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const AL = require("./astronotes-align.js");
const A = require("./astronotes-astro.js");

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };

const skytree = AL.targetById("skytree");
const day = Date.parse("2026-11-24T00:00:00+09:00");
for (const [body, side] of [["moon", "set"], ["sun", "set"]]) {
  for (const shift of [[0, 0], [0, 1], [0.5, -0.5], [-1, 2]]) {
    const p = await AL.solvePoint(skytree, body, day, 12, side, { partId: "tip", shift });
    if (!p) { ok(false, `${body} ${shift} が解ける`); continue; }
    const obs = { latitude: p.latitude, longitude: p.longitude, elevation: 1.5 };
    const g = AL.geometryFrom({ ...obs, elevation: 0 }, skytree, { partId: "tip" });
    const st = A[body](p.at, obs);
    const xy = AL.viewProjector(g.azimuth, g.angle)(st.azimuth, st.apparentAltitude);
    const d = 2 * st.angularRadius;
    const miss = Math.hypot(xy[0] / d - shift[0], xy[1] / d - shift[1]);
    ok(miss < 0.05, `${body} ずらし ${shift.join(",")} の位置に天体の中心が来る`, `ずれ ${miss.toFixed(3)} 直径`);
  }
}
{
  const plain = await AL.line(skytree, "moon", day, { partId: "tip", sides: ["set"] });
  const moved = await AL.line(skytree, "moon", day, { partId: "tip", sides: ["set"], shift: [1, 0] });
  ok(plain.length && moved.length, "ずらした線も引ける");
  const a = plain[0].points[10], b = moved[0].points[10];
  ok(Math.abs(a.distanceKm - b.distanceKm) < 1e-9 && Math.hypot(a.latitude - b.latitude, a.longitude - b.longitude) > 1e-4, "同じ距離でも別の場所になる");
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
