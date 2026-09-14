/**
 * 富士山の笠雲。
 *
 * **これは校正された確率ではない。** 仕様書が最終形として求めているのは
 * 長期ライブカメラ画像で学習・校正した確率予測だが、正解ラベルが0件のため
 * 学習も校正もできていない。ここで出すのは、Kusaka et al. 2026 の知見を根拠に
 * 「材料が揃っているか」を測った**物理スコア**で、他の7現象と同じ0〜100点。
 * 実地精度は未検証（ユーザー判断で精度確認を飛ばして導入・2026-09-15）。
 *
 * 出典: Kusaka et al., 2026, "Characteristics of unique cap, Tsurushi and Hata
 *       clouds around Mount Fuji", Weather 81, 182–190. DOI 10.1002/wea.7774
 *       - 笠雲は暖候期・朝に多い
 *       - 比較的強い西南西風で多い。**富士山を横切る方向の風**が効く
 *       - 山頂被覆型では 700〜600hPa 付近に高湿度層
 *       - 離れ笠ではより高い 500hPa 付近に高湿度層
 *       - 湿度極大の高度と笠雲形成高度が関連する
 *
 * 特徴量の作り方は `cap-cloud/atmosphere.mjs` と同じにしてある（同じ物理を2回書かない）。
 * あちらは研究用の収集器で確率を返さない。こちらは画面へ出す採点。
 */
(function (global) {
  "use strict";

  const A = global.SoramiAstro;
  const DEG = Math.PI / 180;
  const SUMMIT_M = 3776;
  const FUJI = { latitude: 35.360555, longitude: 138.727363, summitM: SUMMIT_M };
  const LEVELS = [850, 800, 700, 600, 500, 400];
  const VARS = LEVELS.flatMap((p) =>
    ["geopotential_height", "temperature", "relative_humidity", "wind_speed", "wind_direction"]
      .map((v) => `${v}_${p}hPa`));

  const SOURCE = "笠雲は Kusaka et al. 2026（Weather 81, 182–190）の知見を根拠にした物理スコア。"
    + "上空の状態は Open-Meteo（GFS・約25km）。**実地精度は未検証です。**";

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const finite = (n) => typeof n === "number" && Number.isFinite(n);
  /// 0→0、1→1 の間をなめらかに上げる（閾値で階段にしない）
  const ramp = (v, lo, hi) => clamp01((v - lo) / (hi - lo));

  function destination(lat, lon, bearing, km) {
    const d = km / 6371.0088, b = bearing * DEG, p = lat * DEG, l = lon * DEG;
    const q = Math.asin(Math.sin(p) * Math.cos(d) + Math.cos(p) * Math.sin(d) * Math.cos(b));
    return { latitude: q / DEG,
      longitude: (l + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p),
                                 Math.cos(d) - Math.sin(p) * Math.sin(q))) / DEG };
  }

  /// 山頂と、30km の8方位。風上側を選ぶために要る（§19 風上側の3次元大気）
  function samplePoints() {
    return [{ id: "summit", ...FUJI },
      ...Array.from({ length: 8 }, (_, i) => ({ id: `ring-${i * 45}`, bearing: i * 45,
        ...destination(FUJI.latitude, FUJI.longitude, i * 45, 30) }))];
  }

  function buildURL(points, days) {
    const u = new URL("https://api.open-meteo.com/v1/gfs");
    u.search = new URLSearchParams({
      latitude: points.map((p) => p.latitude.toFixed(6)).join(","),
      longitude: points.map((p) => p.longitude.toFixed(6)).join(","),
      models: "gfs_global", hourly: VARS.join(","),
      forecast_days: String(days), wind_speed_unit: "ms", temperature_unit: "celsius",
      timezone: "Asia/Tokyo", timeformat: "unixtime",
      elevation: points.map(() => "nan").join(","), cell_selection: "nearest",
    });
    return u.toString();
  }

  function profileAt(raw, index) {
    const out = [];
    for (const p of LEVELS) {
      const val = (k) => raw.hourly[`${k}_${p}hPa`]?.[index];
      const speed = val("wind_speed"), dir = val("wind_direction");
      const z = val("geopotential_height"), t = val("temperature"), rh = val("relative_humidity");
      if (![speed, dir, z, t, rh].every(finite)) return null;
      if (speed < 0 || dir < 0 || dir > 360 || rh <= 0 || rh > 100) return null;
      out.push({ z_m: z, pressure_hpa: p, temperature_c: t, rh_pct: rh,
        u_ms: -speed * Math.sin(dir * DEG), v_ms: -speed * Math.cos(dir * DEG) });
    }
    out.sort((a, b) => a.z_m - b.z_m);
    for (let i = 1; i < out.length; i++) if (out[i].z_m <= out[i - 1].z_m) return null;
    return out;
  }

  function interpolate(levels, z, key) {
    if (z < levels[0].z_m || z > levels[levels.length - 1].z_m) return null;   // **外挿しない**
    const exact = levels.find((l) => l.z_m === z);
    if (exact) return exact[key];
    const i = levels.findIndex((l) => l.z_m > z);
    const a = levels[i - 1], b = levels[i];
    return a[key] + (b[key] - a[key]) * (z - a.z_m) / (b.z_m - a.z_m);
  }

  /// 湿度・風・安定度。`cap-cloud/atmosphere.mjs` と同じ定義
  function features(levels) {
    if (!levels || levels.length < 3) return null;
    for (const l of levels) {
      l.theta = (l.temperature_c + 273.15) * Math.pow(1000 / l.pressure_hpa, 287.05 / 1004);
    }
    for (let i = 0; i < levels.length; i++) {
      const a = levels[Math.max(0, i - 1)], b = levels[Math.min(levels.length - 1, i + 1)];
      let d = (b.theta - a.theta) / (b.z_m - a.z_m);
      if (i > 0 && i < levels.length - 1) {
        const h1 = levels[i].z_m - a.z_m, h2 = b.z_m - levels[i].z_m;
        d = -h2 / (h1 * (h1 + h2)) * a.theta + (h2 - h1) / (h1 * h2) * levels[i].theta
            + h1 / (h2 * (h1 + h2)) * b.theta;
      }
      levels[i].n2 = 9.80665 / levels[i].theta * d;
    }
    const at = (k) => interpolate(levels, SUMMIT_M, k);
    const t = at("temperature_c"), rh = at("rh_pct"), u = at("u_ms"), v = at("v_ms"), n2 = at("n2");
    if (![t, rh, u, v, n2].every(finite)) return null;

    // 露点差。飽和にどれだけ近いか
    const g = Math.log(rh / 100) + 17.625 * t / (243.04 + t);
    const td = 243.04 * g / (17.625 - g);

    const peak = Math.max(...levels.map((l) => l.rh_pct));
    const peaks = levels.filter((l) => l.rh_pct === peak);
    const speed = Math.hypot(u, v);
    const dir = speed > 1e-8 ? ((Math.atan2(-u, -v) / DEG) + 360) % 360 : null;

    return {
      rhSummit: rh, temperatureSummitC: t, dewpointDepression: t - td,
      rhMax: peak,
      // 湿度極大が平坦なら高度を一点に決めない（§20・平坦を単一高度にしない）
      zRhMaxMinusSummit: peaks.length === 1 ? peaks[0].z_m - SUMMIT_M : null,
      moistPeakAmbiguous: peaks.length > 1,
      moistPeakBaseM: Math.min(...peaks.map((l) => l.z_m)),
      moistPeakTopM: Math.max(...peaks.map((l) => l.z_m)),
      windSpeed: speed, windDirectionDeg: dir, n2,
    };
  }

  /**
   * 材料が揃っているかを採点する。**掛け算**にする（富士山・月と同じ）。
   *
   * 足し算だと「風が全く無い」と「山頂が乾ききっている」が他の項で埋め合わされる。
   * 笠雲はどれか一つでも欠ければ出ないので、掛ける。
   */
  function scoreOf(f, atMs) {
    if (!f) return null;
    const why = [];

    // ① 湿った層が山頂を包むか、その上に乗るか。**これが最重要**（§20 湿度鉛直構造）
    //
    // **極大の高度だけでは決まらない。** 極大が 700hPa（約3,000m）でも、
    // 湿潤層が 600hPa（約4,200m）まで伸びていれば山頂（3,776m）を包むので笠になる。
    // 最初これを極大の高度だけで判定し、700hPa 極大の典型例を
    // 「山頂より下」として弾いていた（2026-09-15、合成例の検査で発覚）。
    //
    // 2つの型を別々に評価して、高いほうを採る（§21）。
    //   山頂被覆型 … 山頂そのものが湿っている
    //   離れ笠     … 山頂の上（500hPa付近）に湿った層があり、山頂は乾いていてよい
    const dz = f.zRhMaxMinusSummit;
    const capTerm = ramp(f.rhSummit, 55, 92);
    // 離れ笠は山頂の 1,000〜3,000m 上に極大があるとき
    const above = dz === null ? null : dz;
    const detachedTerm = above === null ? 0
      : 0.8 * ramp(f.rhMax, 60, 92)
            * (above >= 800 ? clamp01(1 - Math.max(0, above - 2600) / 1800) : above / 800);
    let layer = Math.max(capTerm, detachedTerm);
    if (dz === null) {
      // 極大が平坦（飽和が厚い）。高度は決められないが、厚い湿潤層は材料そのもの
      layer = Math.max(layer, 0.8 * ramp(f.rhMax, 60, 90));
      why.push("湿った層が厚い");
    } else if (capTerm >= detachedTerm) {
      why.push(f.rhSummit >= 85 ? "山頂が湿っている" : "山頂付近に湿った層");
    } else {
      why.push("山頂の上に湿った層");
    }
    if (layer < 0.05) why[0] = "山頂付近が乾いている";

    // ② 山体を横切る風（§22-23）。**強い風が要る**。弱いと持ち上がらない
    const wind = ramp(f.windSpeed, 6, 16);
    // 西南西が最も多い。ただし**方位で決め打ちしない**——横切っていれば効く
    const cross = f.windDirectionDeg === null ? 0.5
      : 0.75 + 0.25 * Math.abs(Math.cos((f.windDirectionDeg - 247.5) * DEG));

    // ③ 成層安定（§25）。安定でないと波が立たず、対流雲になる
    const stable = f.n2 <= 0 ? 0.15 : ramp(f.n2, 0.00002, 0.00012);

    // ④ 山頂で飽和に届くか（§24 持ち上げ・飽和）
    const saturate = clamp01(1 - f.dewpointDepression / 12);

    const value = layer * wind * cross * stable * saturate;
    const score = Math.round(100 * value);

    // 型。湿度極大の高度で分ける（§21）
    // 山頂は 3,776m。700hPa≈3,000m / 600hPa≈4,200m / 500hPa≈5,600m。
    // 論文の「山頂被覆型は700〜600hPa、離れ笠は500hPa付近」を高度差に直すと、
    // 離れ笠はおよそ山頂の 1,400m 上から。
    const type = dz === null ? "unknown"
      : dz <= 700 ? "cap"           // 山頂被覆型
      : dz <= 1400 ? "high"         // 高めの笠
      : "detached";                 // 離れ笠（500hPa付近）

    return {
      score, value, type,
      parts: [
        { key: "layer", label: "湿った層の位置", p: layer,
          why: `山頂 ${Math.round(f.rhSummit)}%`
            + (dz === null ? ` / 極大 ${Math.round(f.rhMax)}%（高度は幅あり）`
               : ` / 極大 ${Math.round(f.rhMax)}% は山頂の${dz >= 0 ? "上" : "下"} ${Math.abs(Math.round(dz))}m`) },
        { key: "wind", label: "山を越える風", p: wind * cross,
          why: `${Math.round(f.windSpeed)}m/s`
            + (f.windDirectionDeg === null ? "" : ` ${dirName(f.windDirectionDeg)}`) },
        { key: "stable", label: "大気の安定", p: stable,
          why: f.n2 <= 0 ? "不安定（対流の雲になりやすい）" : `N² ${(f.n2 * 1e5).toFixed(1)}×10⁻⁵` },
        { key: "saturate", label: "山頂で飽和するか", p: saturate,
          why: `露点差 ${f.dewpointDepression.toFixed(1)}℃` },
      ],
      why: why[0] || "",
    };
  }

  const DIRS = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東",
                "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
  const dirName = (deg) => DIRS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

  const TYPE_LABEL = { cap: "山頂にかぶる形", high: "やや高い笠", detached: "離れ笠", unknown: "形は不明" };

  /// 上空の予報を取る。山頂＋8方位の1回のリクエスト
  async function fetchUpperAir({ days = 3, fetchImpl = null, signal = null } = {}) {
    const f = fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!f) return null;
    const points = samplePoints();
    try {
      const res = await f(buildURL(points, days), { signal });
      if (!res.ok) return null;
      const raw = await res.json();
      const list = Array.isArray(raw) ? raw : [raw];
      if (list.length !== points.length) return null;
      return { points, list, fetchedAt: Date.now() };
    } catch { return null; }
  }

  /// 風上側の地点を選ぶ（風が来る方向の格子）
  function upwindIndexFor(dirDeg) {
    if (dirDeg === null) return null;
    return 1 + (Math.round(dirDeg / 45) % 8);
  }

  /**
   * ある時刻の笠雲の材料を採点する。
   * **風上側の大気**で採る（山頂の格子は約25kmなので山そのものを解像していない）。
   */
  function evaluateAt(upper, atMs) {
    if (!upper) return null;
    const center = upper.list[0];
    const i = center.hourly.time.indexOf(Math.round(atMs / 1000));
    if (i < 0) return null;
    const local = features(profileAt(center, i));
    if (!local) return null;
    const j = upwindIndexFor(local.windDirectionDeg);
    let f = local, fromUpwind = false;
    if (j !== null && upper.list[j]) {
      const w = upper.list[j];
      const k = w.hourly.time.indexOf(Math.round(atMs / 1000));
      if (k >= 0) {
        const uf = features(profileAt(w, k));
        if (uf) { f = uf; fromUpwind = true; }
      }
    }
    const s = scoreOf(f, atMs);
    if (!s) return null;
    return { ms: atMs, ...s, features: f, fromUpwind };
  }

  /**
   * 1日ぶんの評価。**他の現象と完全に同じ形で返す。**
   *
   * 笠雲は朝に多い（Kusaka et al.）が、**朝だけを見ない**。
   * 一日のうち最も材料が揃う時刻を代表にする。
   */
  function evaluateDay(upper, dayMs, S, { asOf = Date.now(), stepMs = 3600000 } = {}) {
    const daysAhead = Math.max(0, Math.round((dayMs - S.Cal.startOfDay(asOf)) / 86400000));
    const shell = (unavailable) => ({
      phenomenon: "capCloud", window: [dayMs + 5 * 3600000, dayMs + 18 * 3600000],
      peak: dayMs + 8 * 3600000, specificTime: false, unavailable,
      score: 0, base: 0, factors: [], perModel: {}, models: 0, spread: [0, 0],
      source: SOURCE, daysAhead, asOf, confidence: S.confidenceOf(40, null),
      rank: S.rankOf(0), uncertainty: null,
    });
    if (!upper) return shell({ kind: "forecast", message: "上空の予報がまだ届いていません" });

    // 空が明るい時間帯。笠雲は見えてこそ意味がある
    const start = dayMs + 5 * 3600000, end = dayMs + 18 * 3600000;
    let best = null;
    const hours = [];
    for (let t = start; t <= end; t += stepMs) {
      const e = evaluateAt(upper, t);
      if (!e) continue;
      hours.push({ at: t, score: e.score, type: e.type });
      if (!best || e.score > best.score) best = e;
    }
    if (!best) return shell({ kind: "forecast", message: "この日の上空の予報がまだ届いていません" });

    const factors = best.parts.map((x) => ({
      label: x.label, c: 0, detail: `${Math.round(x.p * 100)}%　${x.why}`,
    }));
    factors.push({ label: "形", c: 0, detail: TYPE_LABEL[best.type] });

    const width = 12 + S.leadTimePenalty(daysAhead);   // **未検証なので広めに持つ**
    return {
      phenomenon: "capCloud", window: [start, end], peak: best.ms, specificTime: false,
      unavailable: null, score: best.score, base: best.score, factors,
      perModel: {}, models: 0,
      spread: [Math.max(0, best.score - width), Math.min(100, best.score + width)],
      source: SOURCE, daysAhead, asOf,
      confidence: S.confidenceOf(width, null), rank: S.rankOf(best.score),
      uncertainty: {
        basis: "single", ensembleBlind: null, modelWidth: width, ensembleIqr: null,
        ensembleMembers: null, ensembleMedian: null, ensembleBand: null,
        ensembleHistogram: null, ensembleScores: null,
        expectedError: Math.round(width * 0.6), agreement: null,
        modelAgreement: null, fallbackWidth: width,
      },
      detail: best, hours,
    };
  }

  const SoramiCapCloud = {
    FUJI, LEVELS, VARS, SOURCE, TYPE_LABEL,
    samplePoints, buildURL, profileAt, interpolate, features, scoreOf,
    fetchUpperAir, upwindIndexFor, evaluateAt, evaluateDay, dirName,
  };
  global.SoramiCapCloud = SoramiCapCloud;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiCapCloud;
})(typeof globalThis !== "undefined" ? globalThis : window);
