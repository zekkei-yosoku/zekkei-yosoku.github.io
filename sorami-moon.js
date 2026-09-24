/*
 * Sorami — 月が見えるか
 *
 * 指示書（月）§21-47。**月出時刻を表示する機能ではない**（§100）。
 *
 *   天文の月出 → 地形の月出 → 明るい縁が出る → 雲を抜けて見える → 写真に撮れる
 *
 * この順序を崩さない（§18・§100）。前の段が済んでいないのに次は来ない。
 *
 * 幾何（sorami-astro.js）と地形（sorami-terrain.js）の上に、雲と霞を重ねる。
 */
(function (global) {
  "use strict";

  const A = global.SoramiAstro || (typeof require !== "undefined" ? require("./sorami-astro.js") : null);
  const TR = global.SoramiTerrain || (typeof require !== "undefined" ? require("./sorami-terrain.js") : null);
  const FJ = global.SoramiFuji || (typeof require !== "undefined" ? require("./sorami-fuji.js") : null);
  if (!A || !TR || !FJ) throw new Error("astro / terrain / fuji が先に要ります");

  /// 出典
  const SOURCE = "月の位置は Meeus『Astronomical Algorithms』第47章（観測地補正つき）。"
    + "明るさは視等級の実測式。雲とエアロゾルは Open-Meteo（8モデルの中央値・CAMS）。";

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  /**
   * 月の明るさ（§30）。**輝面比に比例させてはいけない。**
   *
   * 満月は半月の2倍ではなく約10倍明るい。月面の反射は位相角に強く依存する
   * （衝効果）。ここでは月の視等級の実測式を使う。
   *   m ≈ -12.73 + 0.026|α| + 4e-9 α^4    （α は位相角[度]）
   * 距離の違いも入れる（近地点と遠地点で 30% 違う）。
   */
  function brightness(moon) {
    const a = Math.abs(moon.phaseAngle);
    const mag = -12.73 + 0.026 * a + 4e-9 * a ** 4
              + 5 * Math.log10(moon.distanceKm / 384400);
    // 満月を 1 とした相対的な明るさ
    return { magnitude: mag, relative: Math.pow(10, -0.4 * (mag - (-12.73))) };
  }

  /**
   * 空の明るさに対して月が目立つか（§37 Moon / Sky Contrast・§36 Daytime Moon）。
   *
   * **昼は「月相」ではなく「太陽からの離角」で決まる。**
   * 昼の月が見えにくいのは月が暗いからではない。月面の明るさ自体は月相でほとんど
   * 変わらず（同じ月面を見ている）、細い月が見えないのは
   *   1. 光っている面積が小さい
   *   2. 太陽の近くにあり、そこの空がいちばん明るい
   * の2つのため。最初これを「輝面比 ÷ 空の明るさ」でやったら、午後2時に出る
   * 63%の月が「コントラスト 0.09」＝ほぼ見えない、になった（2026-09-14）。
   * 実際にはよく見える。
   *
   * 夜は逆に、地平線の上にあればたいてい見える。ごく細い月だけ薄明に負ける。
   */
  function skyContrast(moon, sunAltitude) {
    const b = brightness(moon);
    const elongation = 180 - moon.phaseAngle;      // 太陽からの離角
    const illum = moon.illuminatedFraction;

    // 夜の見やすさ。細い月は薄明に負けるが、それ以外はほぼ見える
    const night = clamp01(0.55 + 0.45 * Math.min(1, illum * 8));
    // 昼の見やすさ。離角と、光っている面積で決まる
    const day = clamp01((elongation - 15) / 45) * clamp01(illum * 4);
    // 太陽高度で混ぜる。-6度（市民薄明の終わり）より下は夜、+6度より上は昼
    const dayWeight = clamp01((sunAltitude + 6) / 12);
    const value = night * (1 - dayWeight) + day * dayWeight;

    return { value: clamp01(value),
             relativeBrightness: b.relative, magnitude: b.magnitude,
             elongation, dayWeight, nightValue: night, dayValue: day };
  }

  /**
   * 月の方向の雲（§22-26）。
   *
   * **全天の雲量で判定してはいけない**（§22）。月の方位・高度の側の雲を見る。
   * 月が低いほど視線は遠くの雲を通る（§24）。
   */
  function cloudTransmission(reading, moon) {
    if (!reading) return { p: null, why: "予報が無い" };
    const alt = Math.max(0.1, moon.apparentAltitude);
    // 視線が各層を横切る距離。低いほど長い（airmass に近い考え方）
    const slant = 1 / Math.sin(alt * Math.PI / 180);
    let p = 1;
    const notes = [];
    for (const [name, band, label] of [
      ["low", "cloud_cover_low", "低い雲"],
      ["mid", "cloud_cover_mid", "中くらいの雲"],
      ["high", "cloud_cover_high", "高い雲"],
    ]) {
      const c = reading[band];
      if (!Number.isFinite(c)) continue;
      // 斜めに見るほど雲に当たりやすい。**頭打ちを緩やかにする。**
      // min(3, slant) で切ると高度19度より下が全部同じになり、月が昇っても
      // 点が横ばいになった（2026-09-14）。飽和させつつ滑らかに効かせる
      const reach = 1 + 1.6 * (1 - Math.exp(-(slant - 1) / 2.2));
      const effective = clamp01((c / 100) * reach);
      // **月は明るいので薄い雲は透ける**（§28）。高い雲ほど透けやすい
      const thin = name === "high" ? 0.55 : name === "mid" ? 0.3 : 0.12;
      p *= clamp01((1 - effective) + effective * thin);
      if (c >= 30) notes.push(`${label} ${Math.round(c)}%`);
    }
    if (Number.isFinite(reading.precipitation) && reading.precipitation > 0.1) {
      p *= 0.15; notes.push("降水");
    }
    return { p: clamp01(p), why: notes.join(" / ") || "月の方向に目立つ雲なし", slant };
  }

  /**
   * 低い高度での減光（§31-35）。月出・月入では大気を長く通る。
   */
  function extinction(reading, air, moon) {
    const alt = moon.apparentAltitude;
    // 地平線の下でも**同じ形を返す**。片方だけ項目が欠けると、呼び手が落ちる
    // （2026-09-14、地形の地平線が負の地点＝高い山の上で実際に落ちた）
    if (alt < -0.5) {
      return { p: 0, transmission: 0, dimmingMag: 99, why: "地平線の下",
               airmass: Infinity, opticalDepth: Infinity };
    }
    // 低高度対応の airmass（Kasten & Young 1989）。sec(z) は地平線付近で破綻する（§32）
    const z = 90 - Math.max(0, alt);
    const am = 1 / (Math.cos(z * Math.PI / 180) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
    const aod = air && Number.isFinite(air.aerosol_optical_depth) ? air.aerosol_optical_depth : 0.15;
    const rh = reading && Number.isFinite(reading.relative_humidity_2m) ? reading.relative_humidity_2m : 60;
    const growth = 1 + Math.max(0, (rh - 60) / 40) * 1.2;      // §34 RH × エアロゾル
    let tau = (aod * growth + 0.12) * am;                      // 0.12 はレイリー＋オゾン
    const notes = [`大気の厚み ${am.toFixed(1)}倍`];
    if (air && Number.isFinite(air.dust) && air.dust > 20) {   // §35 Dust
      tau += air.dust / 300 * am; notes.push(`ダスト ${Math.round(air.dust)}`);
    }
    // **透過率をそのまま「見える確率」にしない。**
    // 大気で 1.2等 暗くなっても月は明らかに見える。最初これを透過率＝確率にしたら、
    // 高度12度の月が「見える20%」になった（2026-09-14）。実際にははっきり見える。
    // 等級で扱う。減光後の明るさが肉眼の限界より明るいかどうか。
    const dimmingMag = 1.086 * tau;
    return { transmission: Math.exp(-tau), dimmingMag, why: notes.join(" / "),
             airmass: am, opticalDepth: tau,
             // 明るさへの効き（くっきり度に使う）。0〜1
             p: clamp01(Math.exp(-tau * 0.35)) };
  }

  /**
   * ある時刻に月が見えるか。
   *
   * @param {number} ms   時刻
   * @param {object} obs  { latitude, longitude, elevation }（elevation は目の高さ）
   * @param {function} horizonAt 方位 → 地形の地平線[度]
   */
  function evaluateAt(ms, obs, { horizonAt = () => 0, reading = null, air = null } = {}) {
    const m = A.moon(ms, obs);
    const sun = A.sunPosition ? null : null;
    const horizon = horizonAt(m.azimuth);
    const aboveTerrain = m.upperLimbAltitude - horizon;

    if (aboveTerrain <= 0) {
      return { ms, moon: m, visible: false, aboveTerrainDeg: aboveTerrain,
               pVisible: 0, pPhoto: 0, score: 0, reason: "まだ地平線の下" };
    }
    const cloud = cloudTransmission(reading, m);
    const ext = extinction(reading, air, m);
    const sunAlt = sunAltitude(ms, obs);
    const contrast = skyContrast(m, sunAlt);

    // 減光したあとの明るさが、肉眼の限界より明るいか。
    // 満月なら地平線でも見えるが、細い月は消える（実際そのとおり）
    const observedMag = brightness(m).magnitude + ext.dimmingMag;
    const LIMIT_MAG = 1.0;
    const brightEnough = clamp01((LIMIT_MAG - observedMag) / 2);

    const pVisible = clamp01((cloud.p ?? 0.6) * brightEnough * contrast.value);
    // **写真に撮れるかは、見えるかとは別**（§9）。薄雲でも眼では見えるが写真は眠くなる
    const pPhoto = clamp01(pVisible * (cloud.p ?? 0.6) * ext.p);
    // 月の一部だけ地形から出ている間は割り引く
    const emerged = clamp01(aboveTerrain / Math.max(0.05, m.angularDiameter));
    // **点は確率そのものではない。** 見える確率に、くっきり度と「どれだけ出ているか」を掛ける。
    // 見えるだけの月と、地平線を離れて澄んで見える月は、行く価値が違う
    const clarity = clamp01(ext.p * (cloud.p ?? 0.6));
    const score = Math.round(100 * pVisible * (0.45 + 0.55 * clarity) * (0.4 + 0.6 * emerged));

    return {
      ms, moon: m, visible: true, aboveTerrainDeg: aboveTerrain, emergedFraction: emerged,
      pVisible, pPhoto, score,
      clarity: Math.round(100 * clarity),
      observedMagnitude: observedMag, dimmingMag: ext.dimmingMag,
      parts: [
        { key: "cloud", label: "月の方向の雲", p: cloud.p, why: cloud.why },
        { key: "air", label: "大気の澄み具合", p: ext.p,
          why: `${ext.why} / ${ext.dimmingMag.toFixed(1)}等 暗くなる` },
        { key: "contrast", label: "空に対する明るさ", p: contrast.value,
          why: `輝面 ${Math.round(m.illuminatedFraction * 100)}% / 太陽高度 ${sunAlt.toFixed(0)}度` },
      ],
      sunAltitude: sunAlt,
    };
  }

  /// 太陽の高度（薄明の判定に要る）
  function sunAltitude(ms, obs) {
    const s = A.sunPosition(ms);
    const T = A.centuries(ms);
    const { dPsi, dEps } = A.nutation(T);
    const eps = A.meanObliquity(T) + dEps;
    const eq = A.toEquatorial(s.longitude, 0, eps);
    const gast = A.apparentSiderealTime(ms, dPsi, eps);
    const H = ((gast + obs.longitude - eq.ra) % 360 + 360) % 360;
    return A.toHorizontal(H, eq.dec, obs.latitude).altitude;
  }

  // ------------------------------------------------------------------ 時系列
  /**
   * 月出（または月入）の前後を、時刻ごとに並べる（§48・§49）。
   *
   * **「1時間で強制終了」しない**（§48）。雲が長く残って最初に見える時刻が
   * 60分を超えるなら、見えるところまで延ばす。
   *
   * @param {string} kind "rise" | "set"
   */
  function timeline(events, obs, {
    kind = "rise", stepMs = 300000, spanMs = 3600000, maxSpanMs = 3 * 3600000,
    horizonAt = () => 0, readingAt = () => null, airAt = () => null,
  } = {}) {
    const terrain = events.terrain.filter((e) => e.kind === kind);
    const anchorEv = terrain.find((e) => e.event === (kind === "rise" ? "firstLimb" : "start"))
      || events.astronomical.find((e) => e.kind === kind);
    if (!anchorEv) return null;

    const from = kind === "rise" ? anchorEv.at - stepMs * 3 : anchorEv.at - spanMs;
    let to = kind === "rise" ? anchorEv.at + spanMs : anchorEv.at + stepMs * 3;
    const rows = [];
    for (let t = from; t <= to; t += stepMs) {
      rows.push(evaluateAt(t, obs, { horizonAt, reading: readingAt(t), air: airAt(t) }));
      // まだ一度も見えていないなら延ばす（§48）
      if (t >= to - stepMs && kind === "rise" && to - anchorEv.at < maxSpanMs
          && !rows.some((r) => r.pVisible >= 0.5)) to += spanMs;
    }
    return { kind, anchor: anchorEv, rows, stepMs };
  }

  /**
   * 見える窓を切り出す（§70 複数の窓を許す・§71 1つに固定しない）。
   * 雲が通り過ぎるときは、晴れ間が複数できる。
   */
  function windows(rows, { threshold = 0.5, minRows = 2 } = {}) {
    const out = [];
    let cur = null;
    for (const r of rows) {
      if (r.pVisible >= threshold) {
        if (!cur) cur = { start: r.ms, end: r.ms, peak: r, rows: 0 };
        cur.end = r.ms; cur.rows++;
        if (r.score > cur.peak.score) cur.peak = r;
      } else if (cur) { if (cur.rows >= minRows) out.push(cur); cur = null; }
    }
    if (cur && cur.rows >= minRows) out.push(cur);
    return out.sort((a, b) => b.peak.score - a.peak.score);
  }

  /// 時刻ごとの主な出来事（§58-59）。**全部を同じ強さで出さない**
  function markers(events, rows, kind = "rise") {
    const out = [];
    const push = (at, key, label, level) => { if (at) out.push({ at, key, label, level }); };
    const t = (name) => events.terrain.find((e) => e.kind === kind && e.event === name)?.at;
    const b = events.brightLimb.find((e) => e.kind === kind)?.at;
    const a = events.astronomical.find((e) => e.kind === kind)?.at;
    if (kind === "rise") {
      push(t("firstLimb"), "terrainFirst", "地形から出はじめ", "primary");
      push(b, "brightLimb", "光っている面が出る", "primary");
      push(t("fullDisk"), "fullDisk", "まるごと出る", "secondary");
      push(a, "astronomical", "天文上の月の出", "secondary");
    } else {
      push(t("start"), "terrainStart", "地形へ入りはじめ", "primary");
      push(t("full"), "terrainFull", "完全に隠れる", "primary");
      push(a, "astronomical", "天文上の月の入", "secondary");
    }
    const first = rows.find((r) => r.pVisible >= 0.5);
    if (first) push(first.ms, "firstVisible", kind === "rise" ? "見え始め" : "最後に見える", "primary");
    const peak = rows.reduce((x, y) => (y.score > (x?.score ?? -1) ? y : x), null);
    if (peak && peak.score > 0) push(peak.ms, "peak", "いちばん良い", "primary");
    return out.sort((x, y) => x.at - y.at);
  }

  /**
   * 1日ぶんの評価。**既存の7現象と完全に同じ形で返す。**
   * 14日×現象の表に、他の現象と同じ行として並べるため。
   *
   * 月は「その日いちばん良く見える時刻」を代表にする。
   * 月の出だけを見ると、日中に出る細い月の日が常に低くなり、
   * 夜に高く昇っている時間帯を捨ててしまう。
   */
  function evaluateDay(obs, dayMs, S, {
    horizonAt = () => 0, readingAt = () => null, airAt = () => null,
    asOf = Date.now(), stepMs = 1800000,
  } = {}) {
    const daysAhead = Math.max(0, Math.round((dayMs - S.Cal.startOfDay(asOf)) / 86400000));
    const start = dayMs, end = dayMs + 86400000;
    let best = null, above = 0, total = 0, buildingBlocked = false;
    for (let t = start; t < end; t += stepMs) {
      total++;
      const e = evaluateAt(t, obs, { horizonAt, reading: readingAt(t), air: airAt(t) });
      if (!e.visible) {
        const detail = horizonAt.detail?.(e.moon.azimuth);
        // 山の上には出るが建物で遮られる時間がある場合だけ、建物を理由に挙げる。
        if (detail?.blockedBy === "urban" &&
            e.moon.upperLimbAltitude > (detail.layers.terrain ?? 0)) buildingBlocked = true;
        continue;
      }
      above++;
      if (!best || e.score > best.score) best = e;
    }
    const shell = (unavailable) => ({
      phenomenon: "moon", window: [start, end - 1], peak: dayMs + 21 * 3600000,
      specificTime: false, unavailable, score: 0, base: 0, factors: [], perModel: {},
      source: SOURCE, models: 0, spread: [0, 0], daysAhead, asOf, confidence: S.confidenceOf(40, null), rank: S.rankOf(0),
      uncertainty: null,
    });
    if (!above) return shell({ kind: "geometry", message: buildingBlocked
      ? "この日は周囲の建物に遮られます"
      : "この日は地平線の上に出ません" });
    if (!best) return shell({ kind: "forecast", message: "この日の予報がまだ届いていません" });

    const m = best.moon;
    const factors = best.parts.map((x) => ({
      label: x.label, c: 0, detail: `${x.p === null ? "—" : Math.round(x.p * 100) + "%"}　${x.why}`,
    }));
    factors.push({ label: "月の様子", c: 0, detail:
      `輝面 ${Math.round(m.illuminatedFraction * 100)}%　最も高いとき ${m.apparentAltitude.toFixed(0)}度` });

    const width = 8 + S.leadTimePenalty(daysAhead);
    return {
      phenomenon: "moon", window: [start, end - 1], peak: best.ms, specificTime: true,
      unavailable: null, score: best.score, base: best.score, factors,
      perModel: {}, models: 0, spread: [Math.max(0, best.score - width), Math.min(100, best.score + width)],
      source: SOURCE,
      // **confidence はオブジェクト**（既存 confidenceOf と同じ形）。
      // 数値を入れたら詳細画面が undefined になった（2026-09-14）
      daysAhead, asOf, confidence: S.confidenceOf(width, null), rank: S.rankOf(best.score),
      // **既存の7現象と同じ項目を揃える。** 欠けると詳細画面が ±NaN になる
      uncertainty: {
        basis: "single", ensembleBlind: null, modelWidth: width, ensembleIqr: null,
        ensembleMembers: null, ensembleMedian: null, ensembleBand: null,
        ensembleHistogram: null, ensembleScores: null,
        expectedError: Math.round(width * 0.6), agreement: null,
        modelAgreement: null, fallbackWidth: width,
      },
      detail: best,
    };
  }

  /**
   * 月相の絵文字と呼び名。
   *
   * **装飾ではない。** 満月か細い月かは「行くかどうか」を左右する情報で、
   * 一覧の行を見た瞬間に分かるほうがよい（04_デザイン定義「絵文字は識別に使う」）。
   *
   * 絵文字は北半球向き（満ちていく月は右側が光る）。日本ではこれで正しい。
   * 上弦と下弦は輝面比が同じ 50% なので、**満ち欠けの向きが要る**。
   */
  const PHASES = [
    { max: 0.02, waxing: null,  glyph: "🌑", name: "新月" },
    { max: 0.34, waxing: true,  glyph: "🌒", name: "三日月" },
    { max: 0.66, waxing: true,  glyph: "🌓", name: "上弦" },
    { max: 0.96, waxing: true,  glyph: "🌔", name: "十三夜" },
    { max: 1.01, waxing: null,  glyph: "🌕", name: "満月" },
    { max: 0.96, waxing: false, glyph: "🌖", name: "十六夜すぎ" },
    { max: 0.66, waxing: false, glyph: "🌗", name: "下弦" },
    { max: 0.34, waxing: false, glyph: "🌘", name: "有明の月" },
  ];
  function phaseOf(moon) {
    const f = moon.illuminatedFraction;
    if (f <= 0.02) return PHASES[0];
    if (f >= 0.985) return PHASES[4];
    const set = PHASES.filter((p) => p.waxing === !!moon.waxing);
    // 輝面比が小さいほうから順に見て、最初に収まる帯
    for (const p of [...set].sort((a, b) => a.max - b.max)) if (f <= p.max) return p;
    return set[set.length - 1];
  }
  const glyphOf = (moon) => phaseOf(moon).glyph;

  const SoramiMoon = {
    brightness, skyContrast, cloudTransmission, extinction, evaluateAt, sunAltitude,
    timeline, windows, markers, evaluateDay, PHASES, phaseOf, glyphOf,
  };
  global.SoramiMoon = SoramiMoon;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiMoon;
})(typeof globalThis !== "undefined" ? globalThis : window);
