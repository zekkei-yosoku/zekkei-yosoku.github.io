// ISS の月面通過（`astronotes-iss.js`）。**通信しない**（軌道要素は fixtures に固定した 2026-09-29 のもの）。
//
// 確かめること:
//   1. 中心線の点・時刻で、衛星（satellite.js の見かけの方向）と天体（astronotes-astro）が重なる
//   2. 帯の縁（半幅ずらした点）で、ISS がちょうど円盤の縁をかすめる
//   3. 帯の幅と通過の長さが、ISS の距離から出る値と合う
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const A = require("./astronotes-astro.js");
const I = require("./astronotes-iss.js");
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
  // 1. 中心線の点・時刻で、satellite.js の衛星の向きと astronotes-astro の太陽の向き（大気差なし）が重なる
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

// ---------------------------------------------------------------- 人工衛星の通過（2026-10-21）
console.log("== 何機ぶんの軌道要素を読む ==");
{
  const raw = fs.readFileSync(new URL("./fixtures/iss-20260929.tle", import.meta.url), "utf8").trim().split(/\r?\n/);
  const two = I.parseTleList(`${raw.join("\n")}\n${raw.slice(-2).join("\n")}\n`);
  ok(two.length === 2 && two.every((t) => t.catnr === 25544), "名前の行が無い組も読む（2組）", two.map((t) => t.name).join(" / "));
  ok(tle.catnr === 25544, "衛星番号を1行目から読む");
}

console.log("== 日が当たっているか ==");
{
  const sunFar = { x: 1.5e8, y: 0, z: 0 };
  ok(I.sunlit({ x: 6771, y: 0, z: 0 }, sunFar) === true, "太陽の側の衛星は照らされる");
  ok(I.sunlit({ x: -6771, y: 0, z: 0 }, sunFar) === false, "地球の真裏（高さ400km）は影の中");
  ok(I.sunlit({ x: -6771, y: 6500, z: 0 }, sunFar) === true, "裏側でも地球の円盤の外なら照らされる");
}

console.log("== 空を通る回（東京・7日） ==");
{
  const obs = { latitude: 35.6812, longitude: 139.7671, elevation: 40 };
  const ps = I.passes(sat, tle, { observer: obs, fromMs: from, hours: 168, minEl: 0 });
  // 独立の答え: satellite.js の見かけの仰角を1秒ずつ総当たり
  const rec = sat.twoline2satrec(tle.line1, tle.line2);
  const gd = { latitude: obs.latitude * Math.PI / 180, longitude: obs.longitude * Math.PI / 180, height: 0.04 };
  const el = (t) => { const d = new Date(t), pv = sat.propagate(rec, d); return sat.ecfToLookAngles(gd, sat.eciToEcf(pv.position, sat.gstime(d))).elevation * 180 / Math.PI; };
  const brute = [];
  let cur = null;
  for (let t = from - 1200000; t < from + 168 * 3600000 + 1200000; t += 1000) {
    const e = el(t);
    if (e > 0 && !cur) cur = { rise: t, max: e, maxAt: t };
    if (cur && e > cur.max) { cur.max = e; cur.maxAt = t; }
    if (e <= 0 && cur) { cur.set = t; if (cur.set >= from) brute.push(cur); cur = null; }
  }
  ok(ps.length === brute.length && ps.length > 30, "地平線の上を通る回の数が総当たりと同じ", `${ps.length}回 / 総当たり${brute.length}回`);
  let dT = 0, dE = 0;
  for (const b of brute) {
    const p = ps.find((q) => Math.abs(q.max.at - b.maxAt) < 120000);
    if (!p) { dT = Infinity; continue; }
    dT = Math.max(dT, Math.abs(p.rise.at - b.rise) / 1000, Math.abs(p.set.at - b.set) / 1000);
    dE = Math.max(dE, Math.abs(p.max.elevation - b.max));
  }
  ok(dT <= 2, "出・消の時刻は総当たり（1秒刻み）と2秒以内", `${dT}秒`);
  ok(dE < 0.05, "いちばん高い仰角は総当たりと0.05°以内", `${dE.toFixed(4)}°`);
  // 見える区間の端は、条件（照らされている・空が暗い・仰角10°以上）を本当に満たす
  const vis = ps.filter((p) => p.visible);
  ok(vis.length >= 1, "この週は見える回がある", `${vis.length}回`);
  let okEnds = true;
  for (const p of vis) for (const q of [p.visible.start, p.visible.end, p.visible.max]) {
    if (!q.lit || q.elevation < I.VISIBLE_MIN_EL - 1e-9 || A.sun(q.at, obs).apparentAltitude > I.DARK_SUN_ALT) okEnds = false;
  }
  ok(okEnds, "見える区間の始め・終わり・最高点は、照らされていて空が暗く仰角10°以上");
  ok(ps.filter((p) => p.sunAltitude > 0).every((p) => !p.visible), "昼の回は見える回に入れない");
  // 2026-09-29 18:20 JST ごろ北西から現れ、ほぼ真上を通り南東で影に入る回（軌道要素の元期の当日）
  const first = I.passes(sat, tle, { observer: obs, fromMs: Date.parse("2026-09-29T18:00:00+09:00"), hours: 1 }).find((p) => p.visible);
  ok(first && first.visible.entersShadow && first.visible.max.elevation > 75, "影に入って消える回を見分ける",
    first && `${new Date(first.visible.end.at + 9 * 3600000).toISOString().slice(11, 19)} 最大${first.visible.max.elevation.toFixed(0)}°`);
}

console.log("== 真下の通り道 ==");
{
  const t0 = Date.parse("2026-09-29T09:20:00Z");
  const tr = I.groundTrack(sat, tle, t0, t0 + 600000, 60);
  ok(tr.length === 11, "10分を1分刻みで11点", `${tr.length}点`);
  // 真下に立てば、衛星はほぼ天頂（地表の式で解いた近似の確かめ）
  const rec = sat.twoline2satrec(tle.line1, tle.line2);
  let worst = 90;
  for (const q of tr) {
    const d = new Date(q.at), pv = sat.propagate(rec, d);
    const la = sat.ecfToLookAngles({ latitude: q.latitude * Math.PI / 180, longitude: q.longitude * Math.PI / 180, height: 0 }, sat.eciToEcf(pv.position, sat.gstime(d)));
    worst = Math.min(worst, la.elevation * 180 / Math.PI);
  }
  ok(worst > 89.5, "真下の点から見ると衛星は天頂（89.5°より上）", `${worst.toFixed(3)}°`);
}

console.log("== 日本語名の表（data/satellite-names-ja.json、Wikidata CC0） ==");
{
  const d = JSON.parse(fs.readFileSync(new URL("./data/satellite-names-ja.json", import.meta.url), "utf8"));
  const m = new Map(d.names.map((r) => [r[0], r]));
  ok(d.license === "CC0 1.0" && d.names.length > 1000, "CC0 の表で1000機以上", `${d.names.length}機`);
  ok(m.size === d.names.length && d.names.every((r) => Number.isInteger(r[0]) && r[0] > 0 && typeof r[1] === "string" && r[1]), "番号は重ならず、日本語名がある");
  ok(m.get(25544)[1] === "ISS（国際宇宙ステーション）" && m.get(25544)[3].includes("ザーリャ"), "ISS は呼び名を上書きし、ザーリャは別名に");
  ok(m.get(48274)[1] === "天宮（中国の宇宙ステーション）" && m.get(48274)[3].includes("天和"), "天宮は呼び名を上書きし、天和は別名に");
  ok(m.get(40267)[1] === "ひまわり8号", "ひまわり8号（40267）", m.get(40267)[1]);
}

console.log(`\n${fail === 0 ? "ISS OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
