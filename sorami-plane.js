/*
 * Sorami — 月丼（月と飛行機を重ねる）を狙う場所を探す
 *
 * **考え方は「ねらう」と同じ。** 違うのは、目標が山や塔ではなく
 * **航路の上を動く点**であること。
 *
 *   ある時刻の月は、方位も高度も決まっている。
 *   航路の上の点 P（高度 h）を月に重ねたいなら、観測者は
 *   **P から見て月と反対の方位**に、`h / tan(月の高度)` だけ離れて立つ。
 *   P を航路に沿って動かすと、立ち位置が並んで線になる。
 *
 * これを**時刻ぶん重ねる**と、同じ場所が何分ぶん当たるかが出る。
 * 飛行機は1機ではなく次々に来るので、**当たる分数 × その時間帯の便数**が
 * 狙い目の目安になる。
 *
 * **確率そのものは出さない。** 管制の指示で経路は前後左右にずれるし、
 * 便数も日によって変わる。出せるのは「条件が揃う場所と時間」まで。
 */
(function (global) {
  "use strict";

  const A = global.SoramiAstro || (typeof require !== "undefined" ? require("./sorami-astro.js") : null);
  const RT = global.SoramiRoutes || (typeof require !== "undefined" ? require("./sorami-routes.js") : null);
  if (!A || !RT) throw new Error("astro / routes が先に要ります");

  const DEG = Math.PI / 180;
  const R_KM = 6371.0088;

  function distanceKm(aLat, aLon, bLat, bLon) {
    const dLat = (bLat - aLat) * DEG, dLon = (bLon - aLon) * DEG;
    const la = aLat * DEG, lb = bLat * DEG;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
    return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function bearing(aLat, aLon, bLat, bLon) {
    const la = aLat * DEG, lb = bLat * DEG, dLon = (bLon - aLon) * DEG;
    const y = Math.sin(dLon) * Math.cos(lb);
    const x = Math.cos(la) * Math.sin(lb) - Math.sin(la) * Math.cos(lb) * Math.cos(dLon);
    return (Math.atan2(y, x) / DEG + 360) % 360;
  }

  /// その地点から見た飛行機の方位と見上げ角
  function seenFrom(obs, point, eyeM = 1.5) {
    const d = distanceKm(obs.latitude, obs.longitude, point.latitude, point.longitude);
    const up = point.altitudeM - ((obs.elevation ?? 0) + eyeM);
    return {
      azimuth: bearing(obs.latitude, obs.longitude, point.latitude, point.longitude),
      altitude: Math.atan2(up, d * 1000) / DEG,
      distanceKm: d,
    };
  }

  /// 2つの方向のあいだの角度（度）。方位の折り返しを跨いでも正しい
  function separation(az1, alt1, az2, alt2) {
    const a1 = alt1 * DEG, a2 = alt2 * DEG, dz = (az1 - az2) * DEG;
    const c = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(dz);
    return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
  }

  /**
   * ある時刻に、その航路の飛行機を月に重ねられる立ち位置の並び。
   * @returns {{latitude,longitude,altitudeM,planeKm,at}[]}
   */
  function standLine(path, moon, at, { eyeM = 1.5, maxKm = 40, minAltDeg = 5 } = {}) {
    if (!moon || moon.apparentAltitude < minAltDeg) return [];
    const t = Math.tan(moon.apparentAltitude * DEG);
    const back = (moon.azimuth + 180) % 360;
    const out = [];
    for (const p of path) {
      const d = (p.altitudeM - eyeM) / t / 1000;          // km
      if (!(d > 0.15) || d > maxKm) continue;
      const q = RT.destination(p.latitude, p.longitude, back, d);
      out.push({ ...q, altitudeM: p.altitudeM, planeKm: d, at });
    }
    return out;
  }

  /**
   * 狙い目を探す。**格子の上で「月の視線が航路を横切っている時間」を数える。**
   *
   * 長い最終進入の上には常に数機いるので、視線が航路を横切っていさえすれば、
   * あとは**待てば飛行機のほうから来る**。だから狙い目は
   *   「横切っている分数」×「その時間帯の到着率」＝**待つあいだに通る機数**
   * で測れる。これは確率ではなく、**期待できる機数**。
   *
   * 飛行機が近すぎると月からはみ出す。全長60mの機体が月（視直径0.52°）に
   * 収まるのは **6.6km より遠く**。2km なら月の3倍の大きさで写る。
   * 逆に遠すぎると点になる。**2〜20km、ねらいめは4〜12km**とする。
   *
   * そのため**月は低いほうがよい**。高度45°の月に高度1000mの機を重ねるには
   * 1km まで寄らせることになり、機体が大きすぎる。2〜30°だけを見る。
   */
  function findSpots(dayMs, paths, {
    center = { latitude: RT.RJTT.latitude, longitude: RT.RJTT.longitude },
    radiusKm = 30, gridKm = 1, stepMin = 5,
    minMoonAlt = 2, maxMoonAlt = 30,
    minPlaneKm = 2, maxPlaneKm = 20, bestPlaneKm = [4, 12],
    eyeM = 1.5, hours = 24, limit = 12, arrivalsShare = 0.5,
  } = {}) {
    const samples = [];
    for (let i = 0; i * stepMin * 60000 <= hours * 3600000; i++) {
      const at = dayMs + i * stepMin * 60000;
      const here = { latitude: center.latitude, longitude: center.longitude, elevation: 0 };
      const m = A.moon(at, here);
      if (m.apparentAltitude >= minMoonAlt && m.apparentAltitude <= maxMoonAlt) {
        samples.push({ at, azimuth: m.azimuth, altitude: m.apparentAltitude,
          illuminated: m.illuminatedFraction,
          sunAltitude: A.sun(at, here).apparentAltitude });
      }
    }
    if (!samples.length) return { spots: [], samples: 0, moonWindow: null };

    const lanes = Math.max(1, paths.length);
    const cells = new Map();
    const degPerKmLat = 1 / 110.574;
    const degPerKmLon = 1 / (111.320 * Math.cos(center.latitude * DEG));
    for (const s of samples) {
      const hour = new Date(s.at + 9 * 3600000).getUTCHours();
      // 1本の経路あたりの到着率（機/分）。便数の半分が到着で、それを経路で分ける
      const perMin = RT.trafficAt(hour) * arrivalsShare / lanes / 60;
      for (const path of paths) {
        for (const q of standLine(path.points, { apparentAltitude: s.altitude, azimuth: s.azimuth },
          s.at, { eyeM, maxKm: maxPlaneKm, minAltDeg: minMoonAlt })) {
          if (q.planeKm < minPlaneKm) continue;
          if (distanceKm(center.latitude, center.longitude, q.latitude, q.longitude) > radiusKm) continue;
          const gy = Math.round((q.latitude - center.latitude) / (gridKm * degPerKmLat));
          const gx = Math.round((q.longitude - center.longitude) / (gridKm * degPerKmLon));
          const key = `${gx},${gy}`;
          let cell = cells.get(key);
          if (!cell) {
            cell = { latitude: center.latitude + gy * gridKm * degPerKmLat,
                     longitude: center.longitude + gx * gridKm * degPerKmLon,
                     times: new Set(), planes: 0, hits: [], paths: new Set() };
            cells.set(key, cell);
          }
          cell.times.add(s.at);
          cell.planes += perMin * stepMin;
          cell.paths.add(path.id);
          cell.hits.push({ at: s.at, planeKm: q.planeKm, altitudeM: q.altitudeM,
            moonAlt: s.altitude, moonAz: s.azimuth, path: path.id,
            illuminated: s.illuminated, sunAltitude: s.sunAltitude });
        }
      }
    }

    const spots = [...cells.values()].map((c) => {
      const times = [...c.times].sort((a, b) => a - b);
      // 代表は「機体の大きさがちょうどよい」回
      const mid = (bestPlaneKm[0] + bestPlaneKm[1]) / 2;
      const best = c.hits.reduce((a, b) =>
        (quality(b) > quality(a) ? b : a), c.hits[0]);
      return {
        latitude: c.latitude, longitude: c.longitude,
        minutes: times.length * stepMin,
        planes: Math.round(c.planes),
        from: times[0], to: times[times.length - 1],
        quality: Math.round(quality(best) * 100) / 100,
        score: Math.round(c.planes * quality(best) * 10) / 10,
        best, paths: [...c.paths],
      };
    }).sort((a, b) => b.score - a.score || b.planes - a.planes);

    return {
      spots: spots.slice(0, limit), all: spots.slice(0, 400), samples: samples.length,
      moonWindow: [samples[0].at, samples[samples.length - 1].at],
      illuminated: samples[0].illuminated,
    };
  }

  /**
   * 海の上を落とす。**上位が東京湾の真ん中になるのを防ぐ。**
   * 進入は湾の上を通るので、計算だけだと立てない場所が並ぶ。
   * 標高タイルは海の画素を「標高なし」で返すので、それで陸を見分ける。
   * @param {function} elevationAt (lat, lon) → 標高[m] / null（海）/ undefined（タイル無し）
   */
  async function keepOnLand(spots, elevationAt, limit = 12) {
    if (typeof elevationAt !== "function") return spots.slice(0, limit);
    const out = [];
    for (const s of spots) {
      if (out.length >= limit) break;
      let e;
      try { e = await elevationAt(s.latitude, s.longitude); } catch { e = undefined; }
      if (Number.isFinite(e)) out.push({ ...s, elevationM: e });
    }
    return out;
  }

  /**
   * その回の「写りの良さ」0〜1。**機数とは別に持つ。**
   *   ① 月が写るか … 輝面が細いほど背景として弱い。昼は白っぽくなる
   *   ② 機体の大きさ … 全長60mが月（視直径0.52°）に収まるのは6.6kmより遠く。
   *      近すぎればはみ出し、遠すぎれば点になる
   */
  function quality(hit) {
    if (!hit) return 0;
    const lit = Math.max(0, Math.min(1, (hit.illuminated ?? 1)));
    // 輝面は効くが、三日月の月丼も成立するので 0 にはしない
    const litQ = 0.35 + 0.65 * lit;
    // 昼は空が明るく、月が薄い。薄明までは落とし、真昼はさらに落とす
    const sun = hit.sunAltitude ?? -18;
    const dayQ = sun < -6 ? 1 : sun < 0 ? 0.85 : sun < 10 ? 0.6 : 0.45;
    // 大きさ。4〜12kmを満点にして、その外を落とす
    const d = hit.planeKm;
    const sizeQ = d < 2 ? 0 : d < 4 ? (d - 2) / 2 : d <= 12 ? 1 : d < 20 ? 1 - (d - 12) / 8 * 0.6 : 0.4;
    return litQ * dayQ * sizeQ;
  }

  /**
   * **名前のある場所を採点する。** 格子で探すと上位が東京湾の真ん中になるので、
   * 「今日はここ」と言うには、立てる場所の中から選ぶ必要がある。
   *
   * その場所から月の方向へ視線を伸ばし、航路のそばを通るかを見る。
   * 「そば」は角度で見る（月の視直径は0.52°なので、1°離れれば重ならない）。
   *
   * @returns {{spot, minutes, planes, score, best, windows}[]} 良い順
   */
  function rankSpots(dayMs, paths, spots, {
    stepMin = 5, tolDeg = 1.0, minMoonAlt = 2, maxMoonAlt = 30,
    minPlaneKm = 2, maxPlaneKm = 20, eyeM = 1.5, hours = 24, arrivalsShare = 0.5, limit = 6,
  } = {}) {
    const lanes = Math.max(1, paths.length);
    const out = [];
    for (const spot of spots) {
      const obs = { latitude: spot.latitude, longitude: spot.longitude,
                    elevation: spot.elevationM ?? 0 };
      const hits = [];
      for (let i = 0; i * stepMin * 60000 <= hours * 3600000; i++) {
        const at = dayMs + i * stepMin * 60000;
        const m = A.moon(at, obs);
        if (m.apparentAltitude < minMoonAlt || m.apparentAltitude > maxMoonAlt) continue;
        const sunAltitude = A.sun(at, obs).apparentAltitude;
        for (const path of paths) {
          // 視線がいちばん近くを通る点を探す
          let best = null;
          for (const pt of path.points) {
            const v = seenFrom(obs, pt, eyeM);
            if (v.distanceKm < minPlaneKm || v.distanceKm > maxPlaneKm) continue;
            const sep = separation(v.azimuth, v.altitude, m.azimuth, m.apparentAltitude);
            if (!best || sep < best.sep) best = { sep, v, pt };
          }
          if (!best || best.sep > tolDeg) continue;
          hits.push({ at, path: path.id, planeKm: best.v.distanceKm,
            altitudeM: best.pt.altitudeM, sepDeg: best.sep,
            moonAlt: m.apparentAltitude, moonAz: m.azimuth,
            illuminated: m.illuminatedFraction, sunAltitude });
        }
      }
      if (!hits.length) continue;
      const times = [...new Set(hits.map((h) => h.at))].sort((a, b) => a - b);
      let planes = 0;
      for (const h of hits) {
        const hour = new Date(h.at + 9 * 3600000).getUTCHours();
        planes += RT.trafficAt(hour) * arrivalsShare / lanes / 60 * stepMin;
      }
      const best = hits.reduce((a, b) => (quality(b) > quality(a) ? b : a), hits[0]);
      out.push({
        spot, minutes: times.length * stepMin, planes: Math.round(planes),
        from: times[0], to: times[times.length - 1],
        quality: Math.round(quality(best) * 100) / 100,
        score: Math.round(planes * quality(best) * 10) / 10,
        best, windows: mergeWindows(times, stepMin),
        paths: [...new Set(hits.map((h) => h.path))],
      });
    }
    return out.sort((a, b) => b.score - a.score || b.planes - a.planes).slice(0, limit);
  }

  /// 連続した時刻をひとまとまりにする（1回の「狙える時間帯」）
  function mergeWindows(times, stepMin) {
    const gap = stepMin * 60000 * 1.5;
    const out = [];
    for (const t of times) {
      const last = out[out.length - 1];
      if (last && t - last.to <= gap) last.to = t;
      else out.push({ from: t, to: t });
    }
    return out;
  }

  /// その日に使う経路。運用（北風・南風）で変わる
  function pathsFor(operation, { landing = true, takeoff = false } = {}) {
    const op = RT.OPERATIONS[operation];
    if (!op) return [];
    const out = [];
    if (landing) {
      for (const r of op.landing) {
        out.push({ id: `${r} 着陸`, kind: "landing", runway: r, points: RT.approachPath(r) });
      }
    }
    if (takeoff) {
      for (const r of op.takeoff) {
        out.push({ id: `${r} 離陸`, kind: "takeoff", runway: r, points: RT.departurePath(r) });
      }
    }
    return out;
  }

  const SoramiPlane = { distanceKm, bearing, seenFrom, separation, standLine, findSpots, keepOnLand, rankSpots, mergeWindows, pathsFor, quality };
  global.SoramiPlane = SoramiPlane;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiPlane;
})(typeof globalThis !== "undefined" ? globalThis : this);
