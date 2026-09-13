/*
 * 月が見えるかの検査。**通信しない。**
 *
 * 天文そのものは test-astro.mjs（Meeus と米海軍天文台に照合済み）が見ている。
 * ここは「雲・霞・空の明るさをどう重ねるか」を見る。
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const A = require("./sorami-astro.js");
const M = require("./sorami-moon.js");

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };
const OBS = { latitude: 35.6581, longitude: 139.7414, elevation: 0 };

console.log("== 月の明るさは輝面比に比例しない（§30）==");
{
  // 満月は半月の約2倍…ではない。**実際は約10倍**（衝効果）
  const full = A.moon(Date.UTC(2026, 9, 26, 12), OBS);      // 満月に近い日
  let bestFull = null, bestHalf = null;
  for (let d = 0; d < 30; d += 0.25) {
    const m = A.moon(Date.UTC(2026, 8, 11) + d * 86400000, OBS);
    if (!bestFull || m.illuminatedFraction > bestFull.illuminatedFraction) bestFull = m;
    if (!bestHalf || Math.abs(m.illuminatedFraction - 0.5) < Math.abs(bestHalf.illuminatedFraction - 0.5)) bestHalf = m;
  }
  const bf = M.brightness(bestFull), bh = M.brightness(bestHalf);
  const ratio = bf.relative / bh.relative;
  ok(bestFull.illuminatedFraction > 0.98, "満月を見つけた", `輝面 ${(bestFull.illuminatedFraction*100).toFixed(0)}%`);
  ok(Math.abs(bestHalf.illuminatedFraction - 0.5) < 0.03, "半月を見つけた", `輝面 ${(bestHalf.illuminatedFraction*100).toFixed(0)}%`);
  ok(ratio > 6 && ratio < 16, "満月は半月の6〜16倍明るい（輝面比なら2倍のはず）", `${ratio.toFixed(1)} 倍`);
  ok(Math.abs(bf.magnitude - (-12.7)) < 0.3, "満月の等級が実測に近い", `${bf.magnitude.toFixed(2)} 等`);
  // 距離でも変わる。**月相と混ぜない**（実際の近地点・遠地点は月相が違うので、
  // そのまま引くと月相の差が混ざる。2026-09-14 に検査の側で取り違えた）
  const dOnly = M.brightness({ phaseAngle: 0, distanceKm: 406700 }).magnitude
              - M.brightness({ phaseAngle: 0, distanceKm: 356400 }).magnitude;
  ok(dOnly > 0.2 && dOnly < 0.4, "距離だけで 0.2〜0.4等 違う（近地点↔遠地点）", `${dOnly.toFixed(2)} 等`);
  // 実際の距離が正しい範囲にあることは test-astro.mjs が見ている
  let near = null, far = null;
  for (let d = 0; d < 60; d += 0.5) {
    const m = A.moon(Date.UTC(2026, 8, 1) + d * 86400000, OBS);
    if (!near || m.distanceKm < near.distanceKm) near = m;
    if (!far || m.distanceKm > far.distanceKm) far = m;
  }
  ok(far.distanceKm - near.distanceKm > 30000, "60日で距離が3万km以上動く",
     `${Math.round(near.distanceKm)} 〜 ${Math.round(far.distanceKm)} km`);
}

console.log("== 昼の月（§36）==");
{
  const m = A.moon(Date.UTC(2026, 9, 26, 3), OBS);           // 満月・日中
  const day = M.skyContrast(m, 40).value;
  const night = M.skyContrast(m, -30).value;
  ok(night > day, "同じ月でも昼のほうが目立たない", `昼 ${day.toFixed(2)} / 夜 ${night.toFixed(2)}`);
  // 細い月は昼に見えない
  let thin = null;
  for (let d = 0; d < 30; d += 0.25) {
    const x = A.moon(Date.UTC(2026, 8, 12) + d * 86400000, OBS);
    if (x.illuminatedFraction > 0.03 && x.illuminatedFraction < 0.08) { thin = x; break; }
  }
  ok(!!thin, "細い月を見つけた", thin ? `輝面 ${(thin.illuminatedFraction*100).toFixed(0)}%` : "");
  if (thin) ok(M.skyContrast(thin, 40).value < M.skyContrast(m, 40).value,
               "細い月は昼、満月よりずっと目立たない",
               `${M.skyContrast(thin, 40).value.toFixed(2)} < ${day.toFixed(2)}`);
}

console.log("== 月の方向の雲（§22-28）==");
{
  const high = A.moon(Date.UTC(2026, 9, 26, 15), OBS);
  const mk = (cl, cm, ch) => M.cloudTransmission(
    { cloud_cover_low: cl, cloud_cover_mid: cm, cloud_cover_high: ch, precipitation: 0 }, high);
  ok(mk(0, 0, 0).p === 1, "雲が無ければ素通し");
  ok(mk(0, 0, 100).p > mk(100, 0, 0).p, "高い薄雲より低い厚い雲のほうが塞ぐ（§28）",
     `高${mk(0,0,100).p.toFixed(2)} > 低${mk(100,0,0).p.toFixed(2)}`);
  ok(mk(100, 100, 100).p > 0, "全部曇っていても 0 にはしない（§28 薄雲越しに見える）",
     mk(100, 100, 100).p.toFixed(3));
  ok(mk(0, 0, 0).p > mk(50, 0, 0).p && mk(50, 0, 0).p > mk(100, 0, 0).p, "雲量に対して単調");
  ok(M.cloudTransmission({ cloud_cover_low: 0, cloud_cover_mid: 0, cloud_cover_high: 0,
                           precipitation: 2 }, high).p < 0.3, "降水があれば大きく落ちる");
  // **低い月ほど、同じ雲でも塞がれやすい**（§24）
  let low = null;
  for (let h = 0; h < 24; h += 0.25) {
    const x = A.moon(Date.UTC(2026, 9, 26) + h * 3600000, OBS);
    if (x.apparentAltitude > 2 && x.apparentAltitude < 6) { low = x; break; }
  }
  ok(!!low, "低い月を見つけた", low ? `高度 ${low.apparentAltitude.toFixed(1)}度` : "");
  if (low) {
    const r = { cloud_cover_low: 40, cloud_cover_mid: 0, cloud_cover_high: 0, precipitation: 0 };
    ok(M.cloudTransmission(r, low).p < M.cloudTransmission(r, high).p,
       "同じ雲でも低い月のほうが塞がれる（§24）",
       `低${M.cloudTransmission(r, low).p.toFixed(2)} < 高${M.cloudTransmission(r, high).p.toFixed(2)}`);
  }
}

console.log("== 低い高度での減光（§31-32）==");
{
  const mk = (alt) => ({ apparentAltitude: alt });
  const r = { relative_humidity_2m: 60 }, air = { aerosol_optical_depth: 0.15, dust: 0 };
  const e = (alt) => M.extinction(r, air, mk(alt));
  ok(e(60).airmass < 1.2, "天頂近くは大気1枚ぶん", e(60).airmass.toFixed(2));
  ok(e(0.5).airmass > 20 && e(0.5).airmass < 45, "地平線近くは大気30枚ぶん前後", e(0.5).airmass.toFixed(1));
  // sec(z) は地平線で無限大になる。使っていないことを確かめる（§32）
  ok(Number.isFinite(e(0).airmass), "地平線ちょうどでも無限大にならない", e(0).airmass.toFixed(1));
  let prev = 0;
  for (const alt of [0.5, 2, 5, 15, 45, 80]) { const v = e(alt).p; ok(v >= prev, `高度 ${alt}度 で単調に良くなる`, v.toFixed(3)); prev = v; }
  ok(e(5).p < e(45).p * 0.8, "低い月は明らかに減光する", `${e(5).p.toFixed(2)} vs ${e(45).p.toFixed(2)}`);
}

console.log("== 順序を崩さない（§18・§100）==");
{
  const ms = Date.UTC(2026, 9, 26, 12);
  const reading = { cloud_cover_low: 0, cloud_cover_mid: 0, cloud_cover_high: 0,
                    precipitation: 0, relative_humidity_2m: 50 };
  const air = { aerosol_optical_depth: 0.1, dust: 0 };
  // 地形の下なら、天気が良くても見えない
  const under = M.evaluateAt(ms, OBS, { horizonAt: () => 89, reading, air });
  ok(under.visible === false && under.score === 0, "地形の下なら天気によらず見えない");
  const over = M.evaluateAt(ms, OBS, { horizonAt: () => -1, reading, air });
  ok(over.visible === true, "地形の上なら評価される");
  // 出かかりは割り引く
  const m = A.moon(ms, OBS);
  const half = M.evaluateAt(ms, OBS, { horizonAt: () => m.upperLimbAltitude - m.angularRadius, reading, air });
  ok(half.score < over.score, "半分しか出ていなければ点は下がる", `${half.score} < ${over.score}`);
  ok(half.emergedFraction > 0 && half.emergedFraction < 1, "出ている割合が中間", half.emergedFraction.toFixed(2));
  // 写真は見えるより厳しい
  ok(over.pPhoto <= over.pVisible, "写真に撮れる確率は、見える確率を超えない（§9）",
     `${over.pPhoto.toFixed(2)} <= ${over.pVisible.toFixed(2)}`);
}

console.log(`\n${fail === 0 ? "MOON OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
