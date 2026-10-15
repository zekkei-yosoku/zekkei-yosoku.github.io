/* 富士山の標準幾何と表示用気象読取。独自採点は非公開API。 */
(function (global) {
"use strict";
  const A = global.SoramiAstro || (typeof require !== "undefined" ? require("./sorami-astro.js") : null);
  const TR = global.SoramiTerrain || (typeof require !== "undefined" ? require("./sorami-terrain.js") : null);
  const MT = global.SoramiMountain || (typeof require !== "undefined" ? require("./sorami-mountain.js") : null);
  if (!A || !TR || !MT) throw new Error("astro / terrain / mountain が先に要ります");

  const FUJI = { latitude: 35.360555, longitude: 138.727363, summitM: 3776, name: "富士山" };

  // 雲の層が実際に何mにあるか。ECMWF / Open-Meteo の区分に合わせる。
  //   low  … 800hPa より下（およそ 0〜2km）
  //   mid  … 800〜450hPa（およそ 2〜6km）
  //   high … 450hPa より上（およそ 6km 以上）
  // **富士山は 3776m。** 低層と中層は視線を塞ぐが、高層は山より上にあって塞がない。
  // 「全天の雲量」で判定してはいけない理由がこれ（§45）。
  function median(values) {
    const v = values.filter((x) => x !== null && x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  /// 地点（decodeLocation の結果）から、その時刻の値をまとめて読む
  function readAt(loc, ms, vars) {
    const out = {};
    if (!loc || !loc.byModel) return out;
    for (const v of vars) {
      out[v] = median(Object.values(loc.byModel)
        .filter((sr) => sr.isSupported(v))
        .map((sr) => sr.valueAt(v, ms)));
    }
    return out;
  }
  const HOME_NEEDS = ["visibility", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
                      "relative_humidity_2m", "precipitation", "boundary_layer_height"];
  const CACHE_KEY = "sorami.fuji.geometry";
  const CACHE_VERSION = 2;          // 計算を変えたら上げる。古い記憶を使い続けない
  const CACHE_MAX = 40;

  /// 記憶の鍵。**目の高さも含める**（展望台に上がれば結果が変わる）
  const cacheKeyFor = (obs) =>
    `${obs.latitude.toFixed(4)},${obs.longitude.toFixed(4)},${Math.round(obs.elevation)}`;

  function readCache(store) {
    try {
      const raw = store ? store.getItem(CACHE_KEY) : null;
      const j = raw ? JSON.parse(raw) : null;
      return j && j.v === CACHE_VERSION && j.items ? j : { v: CACHE_VERSION, items: {} };
    } catch { return { v: CACHE_VERSION, items: {} }; }
  }
  function writeCache(store, cache) {
    try {
      const keys = Object.keys(cache.items);
      if (keys.length > CACHE_MAX) {
        // 古いものから捨てる
        keys.sort((a, b) => (cache.items[a].at || 0) - (cache.items[b].at || 0))
            .slice(0, keys.length - CACHE_MAX).forEach((k) => delete cache.items[k]);
      }
      if (store) store.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch { /* 容量いっぱい等。**憶えられなくても動く** */ }
  }

  /**
   * その地点から富士山がどう見えるか（幾何だけ）。憶えていればそれを返す。
   *
   * @param {object} obs  { latitude, longitude, elevation }（elevation は目の高さ）
   * @param {object} grid data/fuji-grid.json
   */
  async function resolveGeometry(obs, grid, { store = null, binDeg = 0.4, ...opts } = {}) {
    const key = cacheKeyFor(obs);
    const cache = readCache(store);
    if (cache.items[key]) return { ...cache.items[key].geom, fromCache: true };

    const sil = MT.silhouette(obs, grid, opts);
    if (!sil) {
      const geom = { available: false, reason: "山体に届く点が無い" };
      cache.items[key] = { at: Date.now(), geom }; writeCache(store, cache);
      return { ...geom, fromCache: false };
    }
    // **輪郭のある方位だけ測る。** 全周360度は要らない
    const azs = sil.outline.map((o) => o.azimuth);
    let lo = Math.min(...azs), hi = Math.max(...azs), shift = 0;
    if (hi - lo > 180) {                       // 0/360 をまたぐとき
      const w = azs.map((a) => (a > 180 ? a - 360 : a));
      lo = Math.min(...w); hi = Math.max(...w); shift = 360;
    }
    const want = [];
    for (let a = lo; a <= hi + 1e-9; a += binDeg) want.push(((a % 360) + 360) % 360);
    // 山体の手前までで打ち切る。**富士山自身を遮蔽物として数えない**
    const maxKm = Math.max(1, sil.nearestKm - 0.5);
    const profile = await TR.measureHorizon(obs, want, { maxKm, ...opts });
    const hz = TR.combinedHorizon({ terrain: profile });
    const geom = { ...MT.geometry(obs, grid, hz, opts), horizonProfile: profile, measuredAt: Date.now() };
    delete geom.silhouette;                     // 記憶が肥大するので輪郭そのものは持たない
    cache.items[key] = { at: Date.now(), geom };
    writeCache(store, cache);
    return { ...geom, fromCache: false };
  }

  const ALIGN_RANKS = [
    { key: "center", label: "ど真ん中", within: 0.5 },
    { key: "overlap", label: "重なる", within: 1 },
    { key: "graze", label: "縁がかすめる", within: 2 },
  ];
  const alignRank = (gap, radius) =>
    ALIGN_RANKS.find((r) => Math.abs(gap) <= r.within * radius) || null;

  const bodyAt = (body, ms, obs) => (body === "moon" ? A.moon(ms, obs) : A.sun(ms, obs));
  const azDiff = (a, b) => ((a - b + 540) % 360) - 180;

  /// その日、天体が方位 az を横切る時刻（複数あり得る）。粗く走査して二分法で詰める
  function azimuthCrossings(body, dayMs, obs, az, stepMs) {
    const out = [];
    let prev = null;
    for (let t = dayMs; t <= dayMs + 86400000; t += stepMs) {
      const diff = azDiff(bodyAt(body, t, obs).azimuth, az);
      // 符号が変わったところが横切った瞬間。0/360 をまたぐ見かけの反転は幅で除く
      if (prev && Math.sign(prev.diff) !== Math.sign(diff) && Math.abs(diff - prev.diff) < 90) {
        let lo = prev.t, hi = t, loDiff = prev.diff;
        for (let i = 0; i < 36; i++) {
          const mid = (lo + hi) / 2;
          const midDiff = azDiff(bodyAt(body, mid, obs).azimuth, az);
          if (Math.sign(midDiff) === Math.sign(loDiff)) { lo = mid; loDiff = midDiff; } else hi = mid;
        }
        out.push((lo + hi) / 2);
      }
      prev = { t, diff };
    }
    return out;
  }

  /**
   * ダイヤモンド富士・パール富士の次の回。
   * @param {object} obs   { latitude, longitude, elevation }（elevation は目の高さを含む）
   * @param {object} geom  resolveGeometry の結果（azimuthDeg / topVisibleAngleDeg / apexVisible）
   */
  function alignments(obs, geom, { from = Date.now(), days = 400, bodies = ["sun", "moon"],
                                   limit = 2, stepMs = null } = {}) {
    if (!geom || !geom.available) return null;
    const az = geom.azimuthDeg;
    // 山頂が手前の地形に隠れているなら、重なっても見えない。
    // 見えている一番上の角度を使う（山頂が見えていれば山頂の角度と同じ）
    const targetAngle = Number.isFinite(geom.topVisibleAngleDeg) ? geom.topVisibleAngleDeg : null;
    if (!Number.isFinite(az) || targetAngle === null) return null;

    // **頂は点ではなく火口の縁という輪**（sorami-align の FUJI_RIM）。山頂が見えているなら、
    // 天体の中心が縁の稜線に届くかで決める。剣ヶ峰1点だと、高尾山の冬至が「縁がかすめる」になっていた（2026-09-30）。
    // 手前の地形で山頂が隠れているときは、見えている一番上の点で従来どおり見る
    const AL = global.SoramiAlign || null;
    const outline = AL && geom.apexVisible ? AL.rimOutline(obs, AL.targetById("fuji")) : null;
    const scanAz = outline ? outline.azimuth : az;
    const out = {};
    for (const body of bodies) {
      const step = stepMs ?? (body === "moon" ? 900000 : 600000);
      const found = [];
      let group = null;
      for (let i = 0; i < days && found.length < limit; i++) {
        const dayMs = from + i * 86400000;
        for (const at0 of azimuthCrossings(body, dayMs, obs, scanAz, step)) {
          const j = outline ? AL.judge(body, at0, obs, targetAngle, 0, outline) : null;
          const at = j ? j.at : at0;
          const st = j ? j.st : bodyAt(body, at, obs);
          const gap = j ? j.gap : st.apparentAltitude - targetAngle;      // ＋なら山頂の上を通る
          const rank = j && j.rank ? ALIGN_RANKS.find((r) => r.key === j.rank) || alignRank(gap, st.angularRadius)
            : alignRank(gap, st.angularRadius);
          // 地平線の下、または山頂から外れすぎている回は落とす
          if (!rank || st.apparentAltitude < -1) continue;
          const later = bodyAt(body, at + 60000, obs).apparentAltitude;
          // **昼の細い月は見えない。** パール富士は月が写ってこそなので、
          // 空が明るい時間帯（太陽が −6度より上）の細い月は出さない。
          const sunAlt = body === "moon" ? A.sun(at, obs).apparentAltitude : null;
          if (body === "moon" && sunAlt > -6 && st.illuminatedFraction < 0.6) continue;
          const row = { at, gap, radius: st.angularRadius, rank: rank.key, rankLabel: rank.label,
                        side: later < st.apparentAltitude ? "set" : "rise",
                        altitude: st.apparentAltitude, sunAltitude: sunAlt,
                        illuminated: body === "moon" ? st.illuminatedFraction : null };
          // 続きの日は同じ「回」。いちばん近い日を代表にする
          row.off = j && Number.isFinite(j.off) ? j.off : 0;
          if (group && at - group.last <= 40 * 3600000) {
            group.days.push(row);
            group.last = at;
            // どちらも頂の縁に届くなら、縁の真ん中に近い日を代表にする
            if (Math.abs(row.gap) < Math.abs(group.best.gap)
              || (row.gap === group.best.gap && row.off < group.best.off)) group.best = row;
          } else {
            if (group) found.push(group);
            group = { days: [row], best: row, last: at };
            if (found.length >= limit) break;
          }
        }
      }
      if (group && found.length < limit) found.push(group);
      // 「前後◯〜◯も」は、**中心が半径の内側に入る日だけ**を数える。
      // 縁がかすめる日（半径の2倍まで）まで含めると、冬至まわりは3週間になって
      // 「重なります」と言えなくなる（2026-09-24 高尾山で実測）。
      out[body] = found.slice(0, limit).map((g) => {
        const solid = g.days.filter((d) => d.rank !== "graze");
        const span = solid.length ? solid : [g.best];
        return { ...g.best, from: span[0].at, to: span[span.length - 1].at,
                 dayCount: span.length, grazeDays: g.days.length };
      });
    }
    return out;
  }

  const SoramiFuji = { FUJI, readAt, median, HOME_NEEDS, resolveGeometry, cacheKeyFor, CACHE_KEY, CACHE_VERSION, alignments, alignRank, ALIGN_RANKS, azimuthCrossings };
  global.SoramiFuji = SoramiFuji;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiFuji;
})(typeof globalThis !== "undefined" ? globalThis : window);
