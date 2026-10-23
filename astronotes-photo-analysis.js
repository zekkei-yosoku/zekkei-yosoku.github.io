/**
 * 写真を保存するときの分析（2026-10-16）。**機械学習に使える形で、記録と一緒に残す。**
 *
 * 写真（長辺768px）は残すので、色の指標は後からでも作り直せる。
 * 保存の瞬間を過ぎると取り戻せないのは、次の3つ。だから保存時に必ず残す。
 *   1. 日時・場所・点数が、写真から読んだ値か・手で直した値か・既定値のままか
 *   2. 端末にだけある開始前の予報（`sorami.rounds`。8日で消え、別の端末には無い）
 *   3. 縮小した写しから消える EXIF の補足（時差の有無・元の寸法）
 *
 * 色の指標は定点写真採点の warm-sky-v2（Vault 朝焼け・夕焼け/検証データ/20260920_定点写真採点/指標定義.json）を、
 * **空の枠なし・横12本の帯ごと**に出す。利用者の写真は地平線の位置が分からず、
 * 範囲の取り方で値が大きく変わる（定点91枚で、上1/3だと順位相関0.24、地平線より上の帯だと0.99）。
 * 地平線の位置は後で決める。帯ごとに残せば、上から k 本の値は画素数の重み付けで正確に出せる。
 *
 * 予報は「事前」「事後」「なし」を分ける。予報が当たったかの評価に使えるのは事前だけ。
 * 判定は既存の isPreEventRound と同じ「保存した時刻が時間帯の開始より前」。
 *
 * 設計: Vault 成果物/20261016_写真の保存時分析の設計案/00_設計案
 */
(function (global) {
  "use strict";

  const SCHEMA = "photo-analysis/1";
  const COLOR_METHOD = "warm-sky-v2-bands12/1";
  const BANDS = 12;
  /** API が受け取る上限（文字数）。超えるときは予報の大きい項目から外す（外したものは `dropped` に残す） */
  const MAX_CHARS = 16384;

  const f32 = Math.fround;
  const clip8 = (n) => (n < 0 ? 0 : n > 255 ? 255 : n);

  /**
   * 1画素の RGB（0〜255）を、Pillow の `convert("HSV")` と同じバイトへ。
   *
   * Pillow（libImaging/Convert.c の rgb2hsv_row）は単精度で計算し、`(int)(h * 255.0)` で**切り捨てる**。
   * 倍精度で素直に書くと境目の色で1ずれるので、単精度の丸め（Math.fround）まで合わせる。
   * 全1677万色で Pillow 11.3.0 と一致することを test-photo-analysis.mjs で確かめている。
   */
  function hsvByte(r, g, b) {
    const maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
    if (maxc === minc) return [0, 0, maxc];
    const cr = f32(maxc - minc);
    const s = f32(cr / maxc);
    const rc = f32((maxc - r) / cr), gc = f32((maxc - g) / cr), bc = f32((maxc - b) / cr);
    let h;
    if (r === maxc) h = f32(bc - gc);
    else if (g === maxc) h = f32(2 + rc - bc);
    else h = f32(4 + gc - rc);
    h = f32((h / 6 + 1) % 1);
    return [clip8(Math.trunc(h * 255)), clip8(Math.trunc(s * 255)), maxc];
  }

  // 式の各項はバイトごとに決まるので、256通りの表にしておく（44万画素を毎回計算しない）
  const HUE_W = new Float64Array(256), SAT_W = new Float64Array(256), VISIBLE = new Uint8Array(256), DARK = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const hue = (i * 360) / 255, sat = i / 255, val = i / 255;
    // 赤〜橙 0〜40°・桃 330〜360° は1。黄 40〜65°・紫 300〜330° は直線で減らす
    HUE_W[i] = hue <= 40 ? 1 : hue < 65 ? (65 - hue) / 25 : hue >= 330 ? 1 : hue > 300 ? (hue - 300) / 30 : 0;
    SAT_W[i] = Math.min(1, Math.max(0, (sat - 0.08) / 0.52));
    VISIBLE[i] = val >= 0.12 && val <= 0.98 ? 1 : 0;
    DARK[i] = val < 0.12 ? 1 : 0;
  }

  /** Python の round（偶数への丸め）。帯の境界を Python の再計算と揃えるため */
  function roundHalfEven(x) {
    const f = Math.floor(x), d = x - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }
  function bandEdges(height, n = BANDS) {
    const edges = [];
    for (let i = 0; i <= n; i++) edges.push(roundHalfEven((height * i) / n));
    return edges;
  }

  const r4 = (x) => Math.round(x * 1e4) / 1e4;

  /**
   * RGBA の画素列から、横12本の帯ごとの色の指標を出す。
   * warm: 帯の中の warm-sky-v2 の強さの平均×100（定点写真採点の photo_score と同じ尺度）
   * invalid: 暗すぎる（明度0.12未満）か白飛び（最小チャンネル250超）の画素の割合
   */
  function colorBands(data, width, height, { exact = false } = {}) {
    const round = exact ? (x) => x : r4;
    const edges = bandEdges(height);
    const bands = [];
    let vSum = 0, dark = 0, clipped = 0;
    for (let i = 0; i < BANDS; i++) {
      let warm = 0, invalid = 0;
      const rows = edges[i + 1] - edges[i];
      for (let y = edges[i]; y < edges[i + 1]; y++) {
        let p = y * width * 4;
        for (let x = 0; x < width; x++, p += 4) {
          const r = data[p], g = data[p + 1], b = data[p + 2];
          const [h, s, v] = hsvByte(r, g, b);
          warm += HUE_W[h] * SAT_W[s] * VISIBLE[v];
          const isDark = DARK[v], isClip = Math.min(r, g, b) > 250 ? 1 : 0;
          invalid += isDark || isClip ? 1 : 0;
          vSum += v; dark += isDark; clipped += isClip;
        }
      }
      const n = rows * width;
      bands.push({ warm: n ? round((100 * warm) / n) : null, invalid: n ? round(invalid / n) : null });
    }
    const total = width * height;
    return {
      method: COLOR_METHOD,
      width, height,
      bands,
      summary: { meanValue: round(vSum / 255 / total), darkFraction: round(dark / total), clippedFraction: round(clipped / total) },
    };
  }

  /** 上から k 本の帯をまとめた値（画素数で重み付け）。地平線の位置が分かったときに使う */
  function topBands(color, k) {
    const edges = bandEdges(color.height);
    let sum = 0, rows = 0;
    for (let i = 0; i < k; i++) {
      const n = edges[i + 1] - edges[i];
      sum += color.bands[i].warm * n; rows += n;
    }
    return rows ? sum / rows : null;
  }

  /**
   * 保存する JPEG（data URL）を読み直して計算する。**送る前の canvas ではなく、保存するものから計算する**
   * （後で同じ写真から同じ値を作り直せるように）。data URL を fetch すると CSP の connect-src に掛かるので、自分で Blob にする。
   */
  async function analyzeDataUrl(dataUrl) {
    const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl || "");
    if (!m) throw Error("写真を読み直せませんでした");
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: m[1] }));
    try {
      const c = document.createElement("canvas");
      c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
      return { ...colorBands(img.data, bmp.width, bmp.height), source: "thumb768-jpeg-q0.72" };
    } finally {
      if (bmp.close) bmp.close();
    }
  }

  /**
   * 入力欄の値の由来。保存シートを開いたときに入れた値（filled）から変わっていなければその由来、変わっていれば手入力。
   * filled: { value, source }
   */
  function inputSource(current, filled) {
    if (!filled) return current ? "manual" : "none";
    if ((current || "") === (filled.value || "")) return filled.value ? filled.source : "none";
    return current ? "manual" : "none";
  }

  const PRE = (snap) => Number.isFinite(snap?.capturedAt) && Array.isArray(snap?.window) && snap.capturedAt < snap.window[0];

  /**
   * 撮影の回に当たる予報を選ぶ。
   * candidates: 同じ現象・同じ撮影日の予報。{ capturedAt, peak, window, score, rank, confidence, perModel, factors, observations, placeId, latitude, longitude, origin }
   *   origin は "round"（端末に残した開始前の回）か "current"（いま画面にある予報）
   * ctx: { takenAtMs, latitude, longitude, timeSource, locationSource, algorithmVersion, distanceM(lat1, lon1, lat2, lon2),
   *        selectedPeak（予報の欄の📷から開いたときの、その回の peak） }
   */
  function matchForecast(candidates, ctx) {
    const none = (reason) => ({ kind: "none", reason, algorithmVersion: ctx.algorithmVersion || null });
    if (!Number.isFinite(ctx.takenAtMs) || ctx.timeSource === "default_now" || ctx.timeSource === "none") return none("no_time");
    if (!Number.isFinite(ctx.latitude) || !Number.isFinite(ctx.longitude)
      || ctx.locationSource === "default_place" || ctx.locationSource === "none") return none("no_location");
    // 点数か気象の値があり、地点が分かる予報だけ（地点が分からないと、写真の場所の予報か確かめられない）
    const usable = (candidates || []).filter((c) => c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)
      && (Number.isFinite(c.score) || (c.observations && Object.keys(c.observations).length)));
    if (!usable.length) return none(candidates && candidates.length ? "out_of_range" : "no_forecast");
    const selected = (c) => Number.isFinite(ctx.selectedPeak) && c.origin === "round" && c.peak === ctx.selectedPeak;
    const withDistance = usable.map((c) => ({ c, d: ctx.distanceM(ctx.latitude, ctx.longitude, c.latitude, c.longitude) }));
    // 予報の欄で選んだ回を優先し、次に事前、その中で一番近い地点
    withDistance.sort((a, b) => (selected(b.c) - selected(a.c)) || (PRE(b.c) - PRE(a.c)) || (a.d - b.d));
    const { c, d } = withDistance[0];
    return {
      kind: PRE(c) ? "pre_event" : "post_event",
      reason: null,
      origin: c.origin || null,
      selected: selected(c),
      // 端末に残した回は、残したときの版を使う。版を残す前（2026-10-16より前）の回は不明（null）で、今の版を書かない
      algorithmVersion: c.algorithmVersion !== undefined ? c.algorithmVersion : ctx.algorithmVersion || null,
      peak: c.peak ?? null, window: c.window ?? null,
      capturedAt: c.capturedAt ?? null,
      leadMs: Number.isFinite(c.capturedAt) ? ctx.takenAtMs - c.capturedAt : null,
      placeId: c.placeId ?? null,
      distanceM: Number.isFinite(d) ? Math.round(d) : null,
      score: Number.isFinite(c.score) ? c.score : null,
      rank: c.rank ?? null, confidence: c.confidence ?? null,
      perModel: c.perModel ?? null, factors: c.factors ?? null, observations: c.observations ?? null,
    };
  }

  /**
   * 保存する形にまとめる。API の上限を超えるときは、予報の大きい項目（factors → perModel → observations）から外して
   * `forecast.dropped` に名前を残す。
   */
  function buildAnalysis({ computedAt, web, entry, input, color, forecast }) {
    const out = { schema: SCHEMA, computedAt, web: web || null, entry, input, color: color || null, forecast };
    let text = JSON.stringify(out);
    if (text.length <= MAX_CHARS) return { analysis: out, text };
    const dropped = [];
    for (const key of ["factors", "perModel", "observations"]) {
      if (!out.forecast || out.forecast[key] == null) continue;
      out.forecast = { ...out.forecast, [key]: null };
      dropped.push(key);
      out.forecast.dropped = dropped.slice();
      text = JSON.stringify(out);
      if (text.length <= MAX_CHARS) return { analysis: out, text };
    }
    return { analysis: null, text: null };
  }

  const AstroNotesPhotoAnalysis = {
    SCHEMA, COLOR_METHOD, BANDS, MAX_CHARS,
    hsvByte, roundHalfEven, bandEdges, colorBands, topBands, analyzeDataUrl,
    inputSource, matchForecast, buildAnalysis,
  };
  global.AstroNotesPhotoAnalysis = AstroNotesPhotoAnalysis;
  if (typeof module !== "undefined" && module.exports) module.exports = AstroNotesPhotoAnalysis;
})(typeof globalThis !== "undefined" ? globalThis : window);

/* Legacy global names remain aliases for cached integrations. */
if(typeof AstroNotesPhotoAnalysis!=='undefined')globalThis.SoramiPhotoAnalysis=AstroNotesPhotoAnalysis;
