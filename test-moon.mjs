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

console.log("== 昼の月は「離角」で決まる（§36・§37）==");
{
  // **月相ではなく太陽からの離角。** 最初これを「輝面比÷空の明るさ」でやったら、
  // 午後2時に出る63%の月が「ほぼ見えない」になった（実際にはよく見える）
  const pick = (want) => {
    let best = null;
    for (let d = 0; d < 30; d += 0.2) {
      const x = A.moon(Date.UTC(2026, 8, 11) + d * 86400000, OBS);
      if (!best || Math.abs(x.illuminatedFraction - want) < Math.abs(best.illuminatedFraction - want)) best = x;
    }
    return best;
  };
  const gibbous = pick(0.65), quarter = pick(0.5), thin = pick(0.04), full = pick(1);
  ok(M.skyContrast(gibbous, 40).value > 0.8, "昼でも上弦過ぎの月ははっきり見える",
     `輝面 ${(gibbous.illuminatedFraction*100).toFixed(0)}% 離角 ${M.skyContrast(gibbous,40).elongation.toFixed(0)}度 → ${M.skyContrast(gibbous,40).value.toFixed(2)}`);
  ok(M.skyContrast(thin, 40).value < 0.15, "昼の細い月は見えない（太陽の近くで空が明るい）",
     `輝面 ${(thin.illuminatedFraction*100).toFixed(0)}% 離角 ${M.skyContrast(thin,40).elongation.toFixed(0)}度 → ${M.skyContrast(thin,40).value.toFixed(2)}`);
  ok(M.skyContrast(thin, -30).value > M.skyContrast(thin, 40).value,
     "同じ細い月でも夜なら見える", `夜 ${M.skyContrast(thin,-30).value.toFixed(2)} > 昼 ${M.skyContrast(thin,40).value.toFixed(2)}`);
  ok(M.skyContrast(full, -30).value >= 0.99 && M.skyContrast(quarter, -30).value >= 0.99,
     "夜は満月も半月も同じくよく見える");
  // 昼と夜のあいだで飛ばない
  const smooth = [-20, -10, -6, 0, 6, 10, 20].map((a) => M.skyContrast(quarter, a).value);
  let jump = 0;
  for (let i = 1; i < smooth.length; i++) jump = Math.max(jump, Math.abs(smooth[i] - smooth[i - 1]));
  ok(jump < 0.35, "薄明のあいだで段差にならない", `最大の変化 ${jump.toFixed(2)}`);
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

console.log("== 減光は等級で扱う（透過率＝確率にしない）==");
{
  const air = { aerosol_optical_depth: 0.15, dust: 0 };
  const r = { relative_humidity_2m: 60 };
  // 高度12度で 1.2等ほど暗くなるが、**月は明らかに見える**
  const e12 = M.extinction(r, air, { apparentAltitude: 12 });
  ok(e12.dimmingMag > 0.8 && e12.dimmingMag < 2.5, "高度12度の減光は1〜2等",
     `${e12.dimmingMag.toFixed(2)} 等`);
  // 満月は地平線でも見える。細い月は消える（実際そのとおり）
  const pick = (want) => { let b = null;
    for (let d = 0; d < 30; d += 0.2) { const x = A.moon(Date.UTC(2026, 8, 11) + d * 86400000, OBS);
      if (!b || Math.abs(x.illuminatedFraction - want) < Math.abs(b.illuminatedFraction - want)) b = x; }
    return b; };
  const eHor = M.extinction(r, air, { apparentAltitude: 0.5 });
  const fullMag = M.brightness(pick(1)).magnitude + eHor.dimmingMag;
  const thinMag = M.brightness(pick(0.03)).magnitude + eHor.dimmingMag;
  ok(fullMag < 0, "満月は地平線でもまだ明るい", `${fullMag.toFixed(1)} 等`);
  ok(thinMag > fullMag + 4, "細い月は地平線で大きく不利", `${thinMag.toFixed(1)} 等`);
}

console.log("== 点は月の高度とともに上がる ==");
{
  const JST = 9 * 3600000, day = Date.UTC(2026, 8, 20) - JST;
  const horizonAt = (az) => (az > 110 && az < 140 ? 2.0 : 0);
  const ev = A.moonEvents(day, day + 86400000, OBS, { horizonAt });
  const air = { aerosol_optical_depth: 0.15, dust: 0 };
  const mk = (reading) => M.timeline(ev, OBS, { kind: "rise", horizonAt,
    readingAt: () => reading, airAt: () => air });
  const clear = mk({ cloud_cover_low: 0, cloud_cover_mid: 0, cloud_cover_high: 0, precipitation: 0, relative_humidity_2m: 50 });
  const rows = clear.rows.filter((r) => r.visible);
  ok(rows.length >= 5, "晴れの時系列が出る", `${rows.length} 行`);
  // **横ばいにならない。** 雲の斜め効果を min(3,slant) で切っていたときは全部同じ点だった
  ok(rows[rows.length - 1].score > rows[0].score + 10, "月が昇るほど点が上がる",
     `${rows[0].score} → ${rows[rows.length - 1].score}`);
  let mono = true;
  for (let i = 1; i < rows.length; i++) if (rows[i].score < rows[i - 1].score - 1) mono = false;
  ok(mono, "晴れなら単調に上がる");
  ok(M.windows(clear.rows).length >= 1, "見える窓が切り出せる");
  // 曇りなら窓が出ない
  const cloudy = mk({ cloud_cover_low: 90, cloud_cover_mid: 90, cloud_cover_high: 60, precipitation: 0, relative_humidity_2m: 85 });
  ok(M.windows(cloudy.rows).length === 0, "曇りなら見える窓は出ない");
  ok(cloudy.rows.length > clear.rows.length, "見えないときは時系列を延ばす（§48「1時間で強制終了しない」）",
     `晴れ ${clear.rows.length} 行 / 曇り ${cloudy.rows.length} 行`);
  // 出来事は強弱をつける（§59）
  const mk2 = M.markers(ev, clear.rows, "rise");
  ok(mk2.some((x) => x.level === "primary") && mk2.some((x) => x.level === "secondary"),
     "出来事に強弱がある（§59 全部を同じ強さで出さない）",
     mk2.map((x) => x.key).join(","));
  ok(mk2[0].at <= mk2[mk2.length - 1].at, "出来事は時刻順");
}

console.log("== 月相の絵文字 ==");
{
  // **上弦と下弦は輝面比が同じ 50%。** 満ち欠けの向きが無いと区別できない
  const pick = (want, waxing) => {
    let b = null;
    for (let d = 0; d < 30; d += 0.1) {
      const x = A.moon(Date.UTC(2026, 8, 11) + d * 86400000, OBS);
      if (!!x.waxing !== waxing) continue;
      if (!b || Math.abs(x.illuminatedFraction - want) < Math.abs(b.illuminatedFraction - want)) b = x;
    }
    return b;
  };
  const up = pick(0.5, true), down = pick(0.5, false);
  ok(Math.abs(up.illuminatedFraction - 0.5) < 0.03 && Math.abs(down.illuminatedFraction - 0.5) < 0.03,
     "輝面50%の月を2つ見つけた（上弦と下弦）");
  ok(M.glyphOf(up) !== M.glyphOf(down), "同じ50%でも上弦と下弦で絵文字が違う",
     `${M.glyphOf(up)} vs ${M.glyphOf(down)}`);
  ok(M.glyphOf(up) === "🌓" && M.glyphOf(down) === "🌗", "北半球向きの向き", `${M.glyphOf(up)} / ${M.glyphOf(down)}`);
  ok(M.phaseOf(up).name === "上弦" && M.phaseOf(down).name === "下弦", "呼び名も分かれる");

  // 一巡すると 8種類すべて出る
  const seen = new Set();
  for (let d = 0; d < 30; d += 0.25) seen.add(M.glyphOf(A.moon(Date.UTC(2026, 8, 11) + d * 86400000, OBS)));
  ok(seen.size === 8, "一巡で8種類そろう", [...seen].join(""));

  // 新月と満月は向きに依らない
  const nm = pick(0, true), fm = pick(1, true);
  ok(M.glyphOf(nm) === "🌑", "新月", M.glyphOf(nm));
  ok(M.glyphOf(fm) === "🌕", "満月", M.glyphOf(fm));

  // 満ちる側と欠ける側で、絵文字の集合が重ならない（新月・満月を除く）
  const wax = new Set(), wane = new Set();
  for (let d = 0; d < 30; d += 0.1) {
    const m = A.moon(Date.UTC(2026, 8, 11) + d * 86400000, OBS);
    const g = M.glyphOf(m);
    if (g === "🌑" || g === "🌕") continue;
    (m.waxing ? wax : wane).add(g);
  }
  const overlap = [...wax].filter((g) => wane.has(g));
  ok(overlap.length === 0, "満ちる側と欠ける側で絵文字が重ならない",
     `満 ${[...wax].join("")} / 欠 ${[...wane].join("")}`);
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
