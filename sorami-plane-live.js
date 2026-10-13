/*
 * Sorami — 月丼ライブ。いま飛んでいる機体の先の位置を予測し、月の前を通るかを解く（2026-10-13 E199）
 *
 * 機体の位置は ADS-B の集約（adsb.fi を私有APIが中継）。届くまでに数秒遅れるうえ、
 * 8km 先の着陸機は空の上を約0.5°/秒で動き、月（0.52°）を約1秒で横切る。
 * だから**いまの位置を描くだけでは役に立たない**。先の位置を予測して
 * 「どの機体が・何秒後に・月のどこを通るか」を出す。**通信しない。**
 *
 * 予測は2通り。
 *   進入路 … 羽田の最終進入に乗っている機体は `approachPath` と同じ進入路（3°・端15m）に沿わせる。
 *            高さも進入路から出す（ADS-B の高さはジオイド・気圧の補正が要り、8km 先で 37m の差が月の半径ぶんになる）。
 *            最終進入では減速するので、対気速度が FINAL_KT まで落ちるぶんだけ対地速度も落とす（風は変わらない前提）
 *   外挿   … それ以外は対地速度・針路・旋回率・昇降率で伸ばす。選択高度（MCP）で上下を止める
 *
 * 当たり具合（2026-10-13 羽田30NM・8.3分・約1.1万組の実測。北風運用だけで測った値）:
 *   進入路 … 時刻のずれ中央値 0.7/1.5/2.3/3.8秒（30〜60/60〜90/90〜120/120〜180秒先）、横ずれ3〜5m、高さずれ9〜17m。
 *            減速を入れる前は 1.5/5.0/10.3/19.2秒（予測が先行していた）
 *   外挿   … 30〜60秒先で横ずれ中央値220m・90%で1.5km（旋回・誘導）。先の予測には使えないので KINEMATIC_S で切る
 */
(function (global) {
  "use strict";

  const A = global.SoramiAstro || (typeof require !== "undefined" ? require("./sorami-astro.js") : null);
  const RT = global.SoramiRoutes || (typeof require !== "undefined" ? require("./sorami-routes.js") : null);
  const P = global.SoramiPlane || (typeof require !== "undefined" ? require("./sorami-plane.js") : null);
  if (!A || !RT || !P) throw new Error("astro / routes / plane が先に要ります");

  const DEG = Math.PI / 180;
  const FT = 0.3048, KT = 0.514444, FPM = 0.00508;
  /// 東京付近のジオイド高（WGS84 楕円体から標高まで）。alt_geom は楕円体高なので引く。
  /// 進入路の機体で確かめた: alt_geom−37m と進入路の高さの差は −25〜+32m
  const GEOID_M = 37;
  /// 最終進入の対気速度と、それまでに落としきる位置（しきい値の手前 km）。上の実測で偏りが±0.2秒になる値
  const FINAL_KT = 145, STABLE_KM = 5;
  /// 旋回の続き方（秒）。20〜80秒・なしで当たり具合はほぼ変わらず、20秒がわずかに良かった
  const TURN_DECAY_S = 20;
  /// 予測する長さ。外挿は先へ行くほど外れるので短く持つ
  const APPROACH_S = 180, KINEMATIC_S = 60;
  /// 位置がこれより古い機体は使わない
  const STALE_S = 30;

  const wrap180 = (d) => ((d % 360) + 540) % 360 - 180;

  /// 機体の高さ（海面から m）。GNSS の楕円体高を優先し、無ければ気圧高度をそのまま使う
  function heightOf(a) {
    if (Number.isFinite(a.alt_geom)) return { m: a.alt_geom * FT - GEOID_M, source: "geom" };
    if (Number.isFinite(a.alt_baro)) return { m: a.alt_baro * FT, source: "baro" };
    return null;
  }

  /// 滑走路の進入路の上での位置。しきい値から手前への距離（km）と、中心線からの横ずれ（km、右が正）
  function alongRunway(rw, lat, lon) {
    const d = P.distanceKm(rw.threshold.latitude, rw.threshold.longitude, lat, lon);
    const back = (rw.headingDegT + 180) % 360;
    const off = wrap180(P.bearing(rw.threshold.latitude, rw.threshold.longitude, lat, lon) - back) * DEG;
    return { alongKm: d * Math.cos(off), crossKm: d * Math.sin(off) };
  }
  const glideAltM = (rw, alongKm) =>
    rw.elevationM + RT.THRESHOLD_CROSSING_M + alongKm * 1000 * Math.tan((rw.glideDeg ?? 3) * DEG);

  /// 最終進入に乗っているか。向き・横ずれ・高さが進入路に合い、上がっていない機体だけ
  function approachOf(a, h) {
    if (!Number.isFinite(a.track) || !Number.isFinite(a.gs)) return null;
    if ((a.geom_rate ?? a.baro_rate ?? 0) * FPM > 2) return null;
    let best = null;
    for (const rw of RT.RJTT.runways) {
      if (Math.abs(wrap180(a.track - rw.headingDegT)) > 12) continue;
      const { alongKm, crossKm } = alongRunway(rw, a.lat, a.lon);
      if (alongKm < 0.3 || alongKm > 35) continue;
      if (Math.abs(crossKm) > 0.6 + 0.04 * alongKm) continue;
      if (Math.abs(h.m - glideAltM(rw, alongKm)) > 120 + 8 * alongKm) continue;
      if (!best || Math.abs(crossKm) < Math.abs(best.crossKm)) best = { rw, alongKm, crossKm };
    }
    return best;
  }

  /**
   * 1機の先の位置。dataMs（その位置の時刻）から toMs まで dt 秒おき。
   * @returns {{mode, runway, points: {t, latitude, longitude, altitudeM}[]}|null}
   */
  function trackAhead(a, dataMs, toMs, dt = 1) {
    const h = heightOf(a);
    if (!h || !Number.isFinite(a.lat) || !Number.isFinite(a.lon) || !Number.isFinite(a.gs) || !Number.isFinite(a.track)) return null;
    const app = approachOf(a, h);
    const points = [];
    if (app) {
      const { rw } = app;
      const cosOff = Math.cos(wrap180(a.track - rw.headingDegT) * DEG);
      const v0 = a.gs * KT * cosOff / 1000;                 // km/s 進入路に沿う速さ
      const tas = Number.isFinite(a.tas) ? a.tas : a.gs;
      const vF = Math.min(v0, Math.max(0.03, (a.gs - Math.max(0, tas - FINAL_KT)) * KT * cosOff / 1000));
      const speedAt = (along) => app.alongKm <= STABLE_KM ? v0
        : along <= STABLE_KM ? vF : vF + (v0 - vF) * (along - STABLE_KM) / (app.alongKm - STABLE_KM);
      // 進入路より低く水平に飛んでいる機体は、進入路に下から乗るまでその高さのまま
      const below = h.m < glideAltM(rw, app.alongKm) - 30;
      const back = (rw.headingDegT + 180) % 360, right = (rw.headingDegT + 90) % 360;
      let along = app.alongKm;
      for (let t = dataMs; t <= toMs; t += dt * 1000) {
        if (along < 0) break;                                // 接地
        const cross = app.crossKm * (along / app.alongKm);   // しきい値へ向けて中心線に寄る
        const c = RT.destination(rw.threshold.latitude, rw.threshold.longitude, back, along);
        const q = RT.destination(c.latitude, c.longitude, right, cross);
        const glide = glideAltM(rw, along);
        points.push({ t, latitude: q.latitude, longitude: q.longitude, altitudeM: below ? Math.min(glide, h.m) : glide });
        along -= speedAt(along) * dt;
      }
      return { mode: "approach", runway: rw.ident, points };
    }
    let lat = a.lat, lon = a.lon, alt = h.m, trk = a.track;
    const v = a.gs * KT / 1000;
    const rate0 = Number.isFinite(a.track_rate) ? a.track_rate : 0;
    const vz = (a.geom_rate ?? a.baro_rate ?? 0) * FPM;
    const sel = Number.isFinite(a.nav_altitude_mcp) ? a.nav_altitude_mcp * FT : null;
    for (let t = dataMs, k = 0; t <= toMs; t += dt * 1000, k++) {
      points.push({ t, latitude: lat, longitude: lon, altitudeM: Math.max(0, alt) });
      trk = (trk + rate0 * Math.exp(-(k * dt) / TURN_DECAY_S) * dt + 360) % 360;
      ({ latitude: lat, longitude: lon } = RT.destination(lat, lon, trk, v * dt));
      let next = alt + vz * dt;
      if (sel != null && sel > 0) {
        if (vz > 0 && alt <= sel && next > sel) next = sel;
        if (vz < 0 && alt >= sel && next < sel) next = sel;
      }
      alt = next;
    }
    return { mode: "kinematic", runway: null, points };
  }

  /// 月の位置を15秒おきに計算して線形に補う（月は1秒に0.004°しか動かない）
  function moonTrack(obs, fromMs, toMs, stepMs = 15000) {
    const list = [];
    for (let t = fromMs - stepMs; t <= toMs + stepMs; t += stepMs) {
      const m = A.moon(t, obs);
      list.push({ t, az: m.azimuth, alt: m.apparentAltitude, radius: m.angularRadius,
        illuminated: m.illuminatedFraction, brightLimbZenithAngle: m.brightLimbZenithAngle });
    }
    return (t) => {
      const i = Math.max(0, Math.min(list.length - 2, Math.floor((t - list[0].t) / stepMs)));
      const p = list[i], q = list[i + 1], f = (t - p.t) / stepMs;
      return { az: (p.az + wrap180(q.az - p.az) * f + 360) % 360, alt: p.alt + (q.alt - p.alt) * f,
        radius: p.radius, illuminated: p.illuminated, brightLimbZenithAngle: p.brightLimbZenithAngle };
    };
  }

  /**
   * 全機を予測して、月との関係を出す。
   * @param obs  { latitude, longitude, elevation, eyeM, horizonAt(az) }
   * @param data 中継の応答（{ now, ac }）
   * @returns {{ moonAt, aircraft: { hex, flight, type, gs, mode, runway, dataAgeS, sky, closest, transit }[] }}
   *   sky は月を中心にした空の上の座標（度。dx は方位の大きい側が正、dy は上が正）。
   *   closest は月の中心に一番近づく瞬間、transit は円盤にかかっている間（無ければ null）
   */
  function predictAll(obs, data, { nowMs = Date.now() } = {}) {
    const moonAt = moonTrack(obs, nowMs, nowMs + APPROACH_S * 1000);
    const eyeM = obs.eyeM ?? 1.5;
    const horizonAt = obs.horizonAt || (() => 0);
    const out = [];
    for (const a of (data && data.ac) || []) {
      if (!a || a.alt_baro === "ground" || !Number.isFinite(a.lat)) continue;
      const dataMs = data.now - (a.seen_pos ?? 0) * 1000;
      if (nowMs - dataMs > STALE_S * 1000) continue;
      const first = trackAhead(a, dataMs, nowMs + APPROACH_S * 1000);
      if (!first) continue;
      const tr = first.mode === "kinematic"
        ? { ...first, points: first.points.filter((p) => p.t <= nowMs + KINEMATIC_S * 1000) } : first;
      if (tr.points.length < 2) continue;
      const sky = tr.points.map((p) => {
        const s = P.seenFrom(obs, p, eyeM);
        const m = moonAt(p.t);
        return { t: p.t, latitude: p.latitude, longitude: p.longitude, az: s.azimuth, alt: s.altitude,
          distKm: s.distanceKm, altitudeM: p.altitudeM,
          dx: wrap180(s.azimuth - m.az) * Math.cos(m.alt * DEG), dy: s.altitude - m.alt,
          hidden: s.altitude < horizonAt(s.azimuth), moonUp: m.alt > 0, moonR: m.radius };
      });
      // 点と点のあいだも見る。8km 先の着陸機は1秒で0.5°動くので、点だけだと月（0.52°）をまたいで見落とす
      let closest = null, inFrom = null, inTo = null;
      for (let i = 1; i < sky.length; i++) {
        const p = sky[i - 1], q = sky[i];
        if (q.t < nowMs || p.hidden || q.hidden || !p.moonUp) continue;
        const ex = q.dx - p.dx, ey = q.dy - p.dy, l2 = ex * ex + ey * ey;
        const f = l2 > 0 ? Math.max(0, Math.min(1, -(p.dx * ex + p.dy * ey) / l2)) : 0;
        const d = Math.hypot(p.dx + ex * f, p.dy + ey * f);
        if (!closest || d < closest.sep) {
          closest = { t: p.t + (q.t - p.t) * f, sep: d, dx: p.dx + ex * f, dy: p.dy + ey * f,
            distKm: p.distKm + (q.distKm - p.distKm) * f, altitudeM: p.altitudeM + (q.altitudeM - p.altitudeM) * f };
        }
        // 円盤に入っている区間: |p + e·s| = 月の半径 を s について解く
        const b = 2 * (p.dx * ex + p.dy * ey), c = p.dx * p.dx + p.dy * p.dy - p.moonR * p.moonR;
        const disc = b * b - 4 * l2 * c;
        if (l2 > 0 && disc >= 0) {
          const s1 = (-b - Math.sqrt(disc)) / (2 * l2), s2 = (-b + Math.sqrt(disc)) / (2 * l2);
          if (s2 >= 0 && s1 <= 1) {
            const from = p.t + (q.t - p.t) * Math.max(0, s1), to = p.t + (q.t - p.t) * Math.min(1, s2);
            inFrom = inFrom == null ? from : Math.min(inFrom, from);
            inTo = inTo == null ? to : Math.max(inTo, to);
          }
        }
      }
      out.push({
        hex: a.hex, flight: a.flight || a.r || a.hex || "", type: a.t || "", gs: a.gs,
        mode: tr.mode, runway: tr.runway, dataAgeS: (nowMs - dataMs) / 1000,
        sky, closest, transit: inFrom != null ? { from: inFrom, to: inTo } : null,
      });
    }
    out.sort((x, y) => (x.closest?.sep ?? 99) - (y.closest?.sep ?? 99));
    return { moonAt, aircraft: out };
  }

  /// t における空の上の位置（予測の点の間を補う）。範囲の外は null
  function skyAt(sky, t) {
    if (!sky.length || t < sky[0].t || t > sky[sky.length - 1].t) return null;
    for (let i = 1; i < sky.length; i++) {
      if (sky[i].t >= t) {
        const p = sky[i - 1], q = sky[i], f = (t - p.t) / (q.t - p.t || 1);
        const mix = (k) => p[k] + (q[k] - p[k]) * f;
        return { ...p, t, dx: mix("dx"), dy: mix("dy"), alt: mix("alt"), distKm: mix("distKm"),
          altitudeM: mix("altitudeM"), latitude: mix("latitude"), longitude: mix("longitude"),
          az: (p.az + wrap180(q.az - p.az) * f + 360) % 360 };
      }
    }
    return { ...sky[sky.length - 1] };
  }

  /// 予測の確からしさの目安（上の実測から）。進入路は2分先まで「高」、外挿は30秒先まで「中」
  function confidence(ac, atMs, nowMs = Date.now()) {
    const s = (atMs - nowMs) / 1000;
    if (ac.mode === "approach") return s <= 120 ? "高" : "中";
    return s <= 30 ? "中" : "低";
  }

  const SoramiPlaneLive = { heightOf, approachOf, alongRunway, glideAltM, trackAhead, moonTrack, predictAll, skyAt,
    confidence, GEOID_M, FINAL_KT, STABLE_KM, APPROACH_S, KINEMATIC_S, STALE_S };
  global.SoramiPlaneLive = SoramiPlaneLive;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiPlaneLive;
})(typeof globalThis !== "undefined" ? globalThis : this);
