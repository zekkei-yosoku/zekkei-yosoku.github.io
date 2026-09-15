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
      forecast_days: String(Math.max(1, Math.min(16, days))), wind_speed_unit: "ms", temperature_unit: "celsius",
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
    const dep = (tc, rhp) => {
      const g = Math.log(rhp / 100) + 17.625 * tc / (243.04 + tc);
      return tc - 243.04 * g / (17.625 - g);
    };

    const peak = Math.max(...levels.map((l) => l.rh_pct));
    const peaks = levels.filter((l) => l.rh_pct === peak);
    // **離れ笠は山頂より上にできる。** その高さの露点差も持つ
    const peakLevel = peaks[0];
    const speed = Math.hypot(u, v);
    const dir = speed > 1e-8 ? ((Math.atan2(-u, -v) / DEG) + 360) % 360 : null;

    return {
      rhSummit: rh, temperatureSummitC: t,
      dewpointDepression: dep(t, rh),
      // 湿度極大の高さでの露点差。離れ笠の判定に使う
      dewpointDepressionAtPeak: dep(peakLevel.temperature_c, peakLevel.rh_pct),
      rhMax: peak,
      // 湿度極大が平坦なら高度を一点に決めない（§20・平坦を単一高度にしない）
      zRhMaxMinusSummit: peaks.length === 1 ? peaks[0].z_m - SUMMIT_M : null,
      moistPeakAmbiguous: peaks.length > 1,
      // **採点に使うのはこちら。** 湿り具合で重みを付けた高さの重心。
      // 「どの気圧面が最大か」で決めると、2つが同値になった瞬間に飛ぶ
      // （実データで点数が18点跳んだ。2026-09-15）。重心なら連続に動く。
      zMoistCenterMinusSummit: moistCenter(levels) - SUMMIT_M,
      moistPeakBaseM: Math.min(...peaks.map((l) => l.z_m)),
      moistPeakTopM: Math.max(...peaks.map((l) => l.z_m)),
      windSpeed: speed, windDirectionDeg: dir, n2,
      // **湿った層の厚さ。** 笠雲はレンズなので層が薄い。
      // 全層が湿っていれば、それは笠雲ではなく一様な曇天や雨。
      moistDepthM: moistDepth(levels),
      columnTopM: levels[levels.length - 1].z_m, columnBaseM: levels[0].z_m,
    };
  }

  /**
   * 湿った層の厚さ[m]。**連続な量にする。**
   *
   * 最初は「RH 85%以上の連続部分の厚さ」にしていたが、気圧面は 6枚しかないので
   * **RH が1%動いて85%線をまたぐだけで厚さが1,400m飛んだ。**
   * 実データで 09時6060m → 10時2896m → 11時1636m → 16時4348m と跳ね、
   * 点数が 0→14→92→…→0→78 という物理的にあり得ない並びになった
   * （2026-09-15）。雲海で記録済みの「天井の量子化による点数の跳び」と同じ型。
   *
   * 層ごとに「どれくらい湿っているか」で重みを付けて足す。
   * RH 70%で0、95%で1。閾値をまたぐ瞬間が無いので跳ばない。
   */
  /// 湿り具合で重みを付けた高さの重心[m]。湿った層がどのあたりにあるか
  function moistCenter(levels) {
    let num = 0, den = 0;
    for (const l of levels) {
      const w = clamp01((l.rh_pct - 70) / 25);
      num += l.z_m * w; den += w;
    }
    // どこも湿っていなければ、いちばん湿った高さで代用する
    if (den < 1e-6) {
      const peak = Math.max(...levels.map((l) => l.rh_pct));
      return levels.find((l) => l.rh_pct === peak).z_m;
    }
    return num / den;
  }

  function moistDepth(levels) {
    let sum = 0;
    for (let i = 0; i < levels.length - 1; i++) {
      const dz = levels[i + 1].z_m - levels[i].z_m;
      const rh = (levels[i].rh_pct + levels[i + 1].rh_pct) / 2;
      sum += dz * clamp01((rh - 70) / 25);
    }
    return sum;
  }

  /**
   * 材料が揃っているかを採点する。**掛け算**にする（富士山・月と同じ）。
   *
   * 足し算だと「風が全く無い」と「山頂が乾ききっている」が他の項で埋め合わされる。
   * 笠雲はどれか一つでも欠ければ出ないので、掛ける。
   */
  function scoreOf(f, { ring = [] } = {}) {
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
    // **重心を使う。** 「どの気圧面が最大か」で決めると、2つが同値になった瞬間に
    // 高度が `null` へ飛び、点数が18点跳んだ（2026-09-15 実データ）。
    const dz = f.zMoistCenterMinusSummit;
    const capTerm = ramp(f.rhSummit, 55, 92);
    // 離れ笠は山頂の 800〜2,600m 上に湿りの重心があるとき
    const detachedTerm = 0.8 * ramp(f.rhMax, 60, 92)
      * (dz >= 800 ? clamp01(1 - Math.max(0, dz - 2600) / 1800) : clamp01(dz / 800));
    const layer = Math.max(capTerm, detachedTerm);
    why.push(capTerm >= detachedTerm
      ? (f.rhSummit >= 85 ? "山頂が湿っている" : "山頂付近に湿った層")
      : "山頂の上に湿った層");
    if (layer < 0.05) why[0] = "山頂付近が乾いている";

    // ② 山体を横切る風（§22-23）。**強い風が要る**。弱いと持ち上がらない
    const wind = ramp(f.windSpeed, 6, 16);
    // 西南西が最も多い。ただし**方位で決め打ちしない**——横切っていれば効く
    const cross = f.windDirectionDeg === null ? 0.5
      : 0.75 + 0.25 * Math.abs(Math.cos((f.windDirectionDeg - 247.5) * DEG));

    // ③ 成層安定（§25）。安定でないと波が立たず、対流雲になる
    const stable = f.n2 <= 0 ? 0.15 : ramp(f.n2, 0.00002, 0.00012);

    // ④ **持ち上げて飽和するか**（§24）。**すでに飽和していたら笠雲ではない。**
    //
    // 最初これを「露点差が小さいほど高得点」にしていたら、
    // **一様な曇天（96点）や雨（95点）が笠雲むきの日（81点）より高く出た**
    // （2026-09-15 ユーザー指摘「これって普通の曇り空なんじゃないの」）。
    // すでに雲になっている空気を最高点にしていたのが誤り。
    //
    // 笠雲は「風上では飽和していない空気が、山で持ち上げられてその場で凝結する」現象。
    // 数百mの持ち上げで閉じる差（乾燥断熱9.8℃/km と露点減率1.8℃/km の差 ≒ 8℃/km）が要る。
    // 露点差 0℃ = すでに雲 / 1〜5℃ = 持ち上げで閉じる / 8℃超 = 持ち上げても届かない。
    // **どの高さで雲になるかは型で違う。** 山頂被覆型は山頂、離れ笠は湿度極大の高さ。
    // 山頂の露点差だけで測っていたら、離れ笠が7点まで落ちた（2026-09-15）。
    const detachedWins = detachedTerm > capTerm;
    const dd = detachedWins ? f.dewpointDepressionAtPeak : f.dewpointDepression;
    // **立ち上がりをなだらかにする。** 0.3〜1℃で0.75動かしていたら、
    // 湿度1%で15点動いた（2026-09-15）。予報の精度に見合わない。
    // 「すでに一面の雲」の判別は ⑤ 薄さ と ⑥ 周り が担う（実データで 0.05 / 0.08 と効いた）。
    // ここは「持ち上げれば届く範囲か」だけを見る。
    const saturate = dd <= 2 ? 0.6 + 0.4 * clamp01(dd / 2)   // 0℃でも0.6は残す
      : dd <= 5 ? 1                                          // 持ち上げで閉じる
      : clamp01(1 - (dd - 5) / 4);                           // 9℃で届かない

    // ⑤ **レンズの薄さ。** 笠雲は限られた厚さの湿潤層にできる。
    // 全層が湿っていれば一様な曇天か雨で、山の形に沿った雲にはならない。
    const depth = f.moistDepthM;
    // **0にしない。** 厚い雲の中に笠雲が埋もれることはある（見分けられないだけ）。
    // 段差で切らないのはこの採点器の他の項と同じ方針
    // 層厚0（どこも湿っていない）を特別扱いしない。乾いていることは ① が見ている。
    // 分岐を残していたら 0.5→1 の段差になった（2026-09-15）
    const lens = depth <= 1800 ? 1                         // レンズらしい厚さ
      : Math.max(0.05, 1 - (depth - 1800) / 2600);         // 4,400mで一様な曇天

    // ⑥ **周りが晴れているか**（水平方向の対比）。
    //
    // 笠雲は「一帯は晴れているのに山の上だけ雲」。30km 離れた8方位が軒並み
    // 湿っていれば、それは広がった雲の系であって笠雲ではない。
    // 鉛直（⑤ レンズの薄さ）だけでは足りない——薄い層が一面に広がることもある。
    //
    // **1点でも湿っていたらダメ、にはしない。** 笠雲の日でも風上側は湿っている
    // （そこから空気が来るので当然）。見るのは**全体がどれだけ湿っているか**の中央値。
    let surround = 1;
    if (ring.length >= 4) {
      const depths = ring.map((r) => r.moistDepthM).sort((a, b) => a - b);
      const median = depths[Math.floor(depths.length / 2)];
      surround = median <= 1500 ? 1 : Math.max(0.08, 1 - (median - 1500) / 2500);
    }

    const value = layer * wind * cross * stable * saturate * lens * surround;
    const score = Math.round(100 * value);

    // 型。湿度極大の高度で分ける（§21）
    // 山頂は 3,776m。700hPa≈3,000m / 600hPa≈4,200m / 500hPa≈5,600m。
    // 論文の「山頂被覆型は700〜600hPa、離れ笠は500hPa付近」を高度差に直すと、
    // 離れ笠はおよそ山頂の 1,400m 上から。
    const type = dz <= 700 ? "cap"    // 山頂被覆型
      : dz <= 1400 ? "high"          // 高めの笠
      : "detached";                  // 離れ笠（500hPa付近）

    return {
      score, value, type,
      parts: [
        { key: "layer", label: "湿った層の位置", p: layer,
          why: `山頂 ${Math.round(f.rhSummit)}% / 湿りの中心は山頂の`
            + `${dz >= 0 ? "上" : "下"} ${Math.abs(Math.round(dz))}m（極大 ${Math.round(f.rhMax)}%）` },
        { key: "wind", label: "山を越える風", p: wind * cross,
          why: `${Math.round(f.windSpeed)}m/s`
            + (f.windDirectionDeg === null ? "" : ` ${dirName(f.windDirectionDeg)}`) },
        { key: "stable", label: "大気の安定", p: stable,
          why: f.n2 <= 0 ? "不安定（対流の雲になりやすい）" : `N² ${(f.n2 * 1e5).toFixed(1)}×10⁻⁵` },
        { key: "saturate", label: "持ち上げで雲になるか", p: saturate,
          why: dd < 0.5 ? `露点差 ${dd.toFixed(1)}℃（すでに雲の中）`
            : dd > 5 ? `露点差 ${dd.toFixed(1)}℃（持ち上げても届きにくい）`
            : `露点差 ${dd.toFixed(1)}℃` },
        { key: "surround", label: "周りが晴れているか", p: surround,
          why: ring.length < 4 ? "周囲の予報が足りません"
            : surround >= 0.9 ? "まわり30kmは湿っていません"
            : "まわり30kmも湿っています（一帯の雲の可能性）" },
        { key: "lens", label: "湿った層の薄さ", p: lens,
          why: depth > 3000 ? `厚さ ${Math.round(depth / 100) / 10}km（一様な曇天に近い）`
            : `厚さ ${Math.round(depth / 100) / 10}km` },
      ],
      why: why[0] || "",
    };
  }

  const DIRS = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東",
                "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
  const dirName = (deg) => DIRS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

  const TYPE_LABEL = { cap: "山頂にかぶる形", high: "やや高い笠", detached: "離れ笠", unknown: "形は不明" };

  /**
   * 上空の予報を取る。山頂＋8方位の1回のリクエスト。
   *
   * `days` は**一覧と同じ日数**を呼び出し側から渡す。3日固定にしていたら、
   * 他の行が14日あるのに笠雲だけ3日で切れて壊れて見えた（2026-09-15）。
   */
  async function fetchUpperAir({ days = 14, fetchImpl = null, signal = null } = {}) {
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
    // **周りが晴れているか。** 笠雲は「一帯は晴れているのに山の上だけ雲」という
    // 対比そのもの。一帯が曇っていれば、山頂に雲があってもそれは笠雲ではない
    // （2026-09-15 ユーザー指摘）。30km 8方位を取っているのに風上1点しか
    // 使っていなかった。
    const ring = [];
    for (let k = 1; k <= 8; k++) {
      const w = upper.list[k];
      if (!w) continue;
      const kk = w.hourly.time.indexOf(Math.round(atMs / 1000));
      if (kk < 0) continue;
      const rf = features(profileAt(w, kk));
      if (rf) ring.push(rf);
    }
    const s = scoreOf(f, { ring });
    if (!s) return null;
    return { ms: atMs, ...s, features: f, fromUpwind, ringCount: ring.length };
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

    // **一日ぜんぶ見る。** 代表の点数は空が明るい時間帯から採るが、
    // 時間帯（出はじめ・最盛・弱まる）は夜も含めて出す。
    // 笠雲は朝に多く（Kusaka et al.）、明るくなる前からできていることがある。
    const start = dayMs, end = dayMs + 86400000;
    const lit = [dayMs + 5 * 3600000, dayMs + 18 * 3600000];
    let best = null;
    const hours = [];
    for (let t = start; t < end; t += stepMs) {
      const e = evaluateAt(upper, t);
      if (!e) continue;
      hours.push({ at: t, score: e.score, type: e.type });
      // 代表は**見える時間帯**から。夜中が最盛でも「今日の笠雲」としては出せない
      if (t >= lit[0] && t <= lit[1] && (!best || e.score > best.score)) best = e;
    }
    if (!best) {
      // 明るい時間に一つも評価できなくても、夜のぶんだけはある場合がある
      const any = hours.length ? hours.reduce((a, b) => (b.score > a.score ? b : a)) : null;
      if (!any) return shell({ kind: "forecast", message: "この日の上空の予報がまだ届いていません" });
      best = evaluateAt(upper, any.at);
      if (!best) return shell({ kind: "forecast", message: "この日の上空の予報がまだ届いていません" });
    }

    const factors = best.parts.map((x) => ({
      label: x.label, c: 0, detail: `${Math.round(x.p * 100)}%　${x.why}`,
    }));
    factors.push({ label: "形", c: 0, detail: TYPE_LABEL[best.type] });
    const timing = timingOf(hours, S);

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
      detail: best, hours, timing,
    };
  }

  /**
   * 条件がいちばん整う時間帯。
   *
   * **「できはじめる時刻」は出せない。** このスコアが測っているのは「材料が揃っているか」で、
   * 材料は総観規模（数時間〜一日）でしか動かない。雲そのものの発生・消滅より遅い。
   * 最初これを 40点（うっすら）の出入りで「出はじめ・弱まる」として出したら、
   * 条件の良い日は **0:00〜23:00 の24時間**になって何も言っていなかった
   * （2026-09-15、実データで発覚）。
   *
   * 出せるのは「一日のうち、いつが最も整うか」。
   * **閾値は、その日が到達したランクの境界にする。** 見出しが「みごとな笠 97」なら
   * 85点以上でいられる時間、「かかりそう 66」なら65点以上でいられる時間。
   * 見出しの言葉と時間帯の意味が一致し、良い日ほど自動的に絞られる。
   *
   * **点数が未検証なので、時刻も未検証。** 1時間きざみのまま出す。
   */
  function timingOf(hours, S) {
    if (!hours || hours.length < 2) return null;
    const peakScore = Math.max(...hours.map((h) => h.score));
    if (peakScore <= 0) return null;
    // その日が届いたランクの下限。最低でも「うっすら」（40点）
    const rank = S.rankOf(peakScore);
    const TH = Math.max(S.RANKS.find((r) => r.key === "fair").min, rank.min);
    const on = hours.filter((h) => h.score >= TH);
    if (!on.length) return null;

    // 連続した区間に切る。雲は途切れることがあるので、**一つにまとめない**
    const spans = [];
    let cur = null;
    for (const h of hours) {
      if (h.score >= TH) {
        if (!cur) cur = { from: h.at, to: h.at, peak: h };
        cur.to = h.at;
        if (h.score > cur.peak.score) cur.peak = h;
      } else if (cur) { spans.push(cur); cur = null; }
    }
    if (cur) spans.push(cur);
    if (!spans.length) return null;

    const main = spans.reduce((a, b) => (b.peak.score > a.peak.score ? b : a));
    const hoursLong = Math.round((main.to - main.from) / 3600000) + 1;
    return {
      from: main.from, to: main.to, peakAt: main.peak.at, peakScore: main.peak.score,
      thresholdScore: TH, rankLabel: rank.key, spans: spans.length, hours: hoursLong,
      // 一日の端に張り付いているなら、前後の日へ続いている可能性がある
      openStart: main.from === hours[0].at,
      openEnd: main.to === hours[hours.length - 1].at,
      // **ほぼ一日なら「時間帯」と言わない。** 絞れていないことを絞れたように見せない
      allDay: hoursLong >= 20,
    };
  }

  const SoramiCapCloud = {
    FUJI, LEVELS, VARS, SOURCE, TYPE_LABEL,
    samplePoints, buildURL, profileAt, interpolate, features, scoreOf,
    fetchUpperAir, upwindIndexFor, evaluateAt, evaluateDay, timingOf, dirName,
  };
  global.SoramiCapCloud = SoramiCapCloud;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiCapCloud;
})(typeof globalThis !== "undefined" ? globalThis : window);
