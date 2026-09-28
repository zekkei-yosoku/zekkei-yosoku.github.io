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

  // 月の半径（視直径 0.52° の半分）
  const MOON_RADIUS_DEG = 0.26;
  // 経路からの横ずれ。最終進入はILSの電波に乗るので、滑走路に近いほど細い。
  // 20m ＋ 滑走路からの距離 1km あたり 8m（10km 手前で ±100m）とする。
  // **仮定の値**（ADS-B の航跡で実測に置き換えられる印として名前を付けておく）
  const lateralScatterM = (alongKm) => 20 + 8 * Math.max(0, alongKm);
  // 月と経路がほぼ平行に動くと、重なっていられる時間が際限なく伸びる。そこで打ち切る
  const MAX_WINDOW_MIN = 20;

  /// その点のまわりの空を平面に開いた座標（度）。方位の折り返しを跨いでも正しい
  function skyXY(az, alt, az0, alt0) {
    const dAz = ((az - az0 + 540) % 360) - 180;
    return [dAz * Math.cos(alt0 * DEG), alt - alt0];
  }

  /// 線分 AB と線分 CD の交点。A + u(B−A) = C + v(D−C) の u, v を返す（交わらなければ null）
  function segmentHit(ax, ay, bx, by, cx, cy, dx, dy) {
    const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return null;
    const qx = cx - ax, qy = cy - ay;
    const u = (qx * sy - qy * sx) / den;
    const v = (qx * ry - qy * rx) / den;
    return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? { u, v } : null;
  }

  /**
   * ある場所から、**月の通り道が航路の線を横切る瞬間**を解く。
   *
   * 以前は航路を 0.5km 刻みの点で持ち、いちばん近い点と月の角度が 1° 以内なら
   * 「重なる」としていた。8km 先では点と点が空の上で 3.6° も離れるので、
   * **月の真上を通っていても外し**、逆に 1°（月2個ぶん）ずれていても当たりにしていた
   * （2026-09-29 に見直し）。
   *
   * 空の上で、月の軌跡（数分おきの点を結んだ線）と航路（点を結んだ線）の交点を求める。
   * 交点の時刻に、その点を通る機体は月の前を横切る。
   * **重なっていられる時間**は、月の円盤＋機体の大きさ＋経路の横ずれ の幅を、
   * 月が航路を横切る速さで割ったもの。
   */
  function crossingsFrom(obs, path, moonTrack, { eyeM = 1.5, minPlaneKm = 2, maxPlaneKm = 20 } = {}) {
    // distanceKm は観測者から機体まで、alongKm は滑走路から経路に沿った距離
    const sky = path.points.map((pt) => ({ ...seenFrom(obs, pt, eyeM),
      altitudeM: pt.altitudeM, alongKm: pt.distanceKm }));
    const out = [];
    for (let k = 0; k + 1 < moonTrack.length; k++) {
      const m0 = moonTrack[k], m1 = moonTrack[k + 1];
      if (!m0.use && !m1.use) continue;
      const [bx, by] = skyXY(m1.azimuth, m1.altitude, m0.azimuth, m0.altitude);
      const dtMin = (m1.at - m0.at) / 60000;
      for (let j = 0; j + 1 < sky.length; j++) {
        const p = sky[j], q = sky[j + 1];
        // 経路の区間が遠すぎる・近すぎるなら見ない（両端とも範囲外）
        if ((p.distanceKm < minPlaneKm && q.distanceKm < minPlaneKm)
          || (p.distanceKm > maxPlaneKm && q.distanceKm > maxPlaneKm)) continue;
        const [cx, cy] = skyXY(p.azimuth, p.altitude, m0.azimuth, m0.altitude);
        const [dx, dy] = skyXY(q.azimuth, q.altitude, m0.azimuth, m0.altitude);
        // **月の向きから外れた区間は見ない。** 空を平面に開くと、観測者の背後を回る区間は
        // 方位の ±180° をまたいで「月の前を横切る長い線」に化ける（検算で実際に出た）。
        // 月の方位から 30° 以内で、空の上で短い区間だけを交点の候補にする
        if (Math.abs(cx) > 30 || Math.abs(dx) > 30 || Math.hypot(dx - cx, dy - cy) > 15) continue;
        const hit = segmentHit(0, 0, bx, by, cx, cy, dx, dy);
        if (!hit) continue;
        const planeKm = p.distanceKm + hit.v * (q.distanceKm - p.distanceKm);
        if (planeKm < minPlaneKm || planeKm > maxPlaneKm) continue;
        // 月が航路を横切る速さ（航路に直角な成分、度/分）
        const len = Math.hypot(dx - cx, dy - cy) || 1e-9;
        const ex = (dx - cx) / len, ey = (dy - cy) / len;
        const vPerp = Math.abs((bx / dtMin) * ey - (by / dtMin) * ex);
        const cap = (w) => Math.min(MAX_WINDOW_MIN, vPerp > 1e-6 ? w / vPerp : MAX_WINDOW_MIN);
        // **機体が月の円盤を横切れるのは、円盤が航路にかかっている間だけ。**
        // 期待機数はこの時間で数える（横ずれがあっても、ずれた分だけ別の機が入るので平均は変わらない）
        const diskMin = cap(2 * MOON_RADIUS_DEG);
        // 「このころ」に居るべき幅は、経路の横ずれぶん広くとる
        const alongKm = (p.alongKm ?? 0) + hit.v * ((q.alongKm ?? 0) - (p.alongKm ?? 0));
        const spreadDeg = Math.atan2(lateralScatterM(alongKm), planeKm * 1000) / DEG;
        const windowMin = cap(2 * (MOON_RADIUS_DEG + spreadDeg));
        out.push({
          at: Math.round(m0.at + hit.u * (m1.at - m0.at)),
          path: path.id, kind: path.kind, runway: path.runway,
          planeKm, alongKm, altitudeM: p.altitudeM + hit.v * (q.altitudeM - p.altitudeM), sepDeg: 0,
          moonAlt: m0.altitude + hit.u * (m1.altitude - m0.altitude),
          moonAz: (m0.azimuth + hit.u * (((m1.azimuth - m0.azimuth + 540) % 360) - 180) + 360) % 360,
          illuminated: m0.illuminated, diskMin, windowMin,
        });
      }
    }
    return out;
  }

  /**
   * **名前のある場所を採点する。** 格子で探すと上位が東京湾の真ん中になるので、
   * 「今日はここ」と言うには、立てる場所の中から選ぶ必要がある。
   *
   * 各場所で、月の通り道が航路を横切る瞬間を解き（`crossingsFrom`）、
   * **重なっていられる時間 × その時間帯の便数** で「待つあいだに通る機数」を出す。
   *
   * `activeAt(path, at)` で、その時刻にその経路が使われているかを渡せる
   * （運用は風で一日のうちに入れ替わる。南風の都心上空は15〜19時だけ）。
   *
   * @returns {{spot, minutes, planes, score, best, windows}[]} 良い順
   */
  function rankSpots(dayMs, paths, spots, {
    stepMin = 2, minMoonAlt = 2, maxMoonAlt = 30,
    minPlaneKm = 2, maxPlaneKm = 20, eyeM = 1.5, hours = 24, arrivalsShare = 0.5, limit = 6,
    activeAt = null,
  } = {}) {
    const active = typeof activeAt === "function" ? activeAt : () => true;
    // 1本の経路あたりの到着（出発）率。その時刻に同じ種類で使われている経路の数で割る
    const lanesAt = (kind, at) => Math.max(1, paths.filter((p) => p.kind === kind && active(p, at)).length);
    const out = [];
    for (const spot of spots) {
      // **展望台の上なら、そのぶん目が高い。** 機体との高低差が縮むので、
      // 同じ月の高さでも近くを通る機を狙える（低い月は地上だと街に隠れる）
      const obs = { latitude: spot.latitude, longitude: spot.longitude,
                    elevation: (spot.elevationM ?? 0) + (spot.deckM ?? 0) };
      const track = [];
      for (let i = 0; i * stepMin * 60000 <= hours * 3600000; i++) {
        const at = dayMs + i * stepMin * 60000;
        const m = A.moon(at, obs);
        track.push({ at, azimuth: m.azimuth, altitude: m.apparentAltitude,
          illuminated: m.illuminatedFraction,
          use: m.apparentAltitude >= minMoonAlt && m.apparentAltitude <= maxMoonAlt });
      }
      const hits = [];
      for (const path of paths) {
        for (const c of crossingsFrom(obs, path, track, { eyeM, minPlaneKm, maxPlaneKm })) {
          if (c.moonAlt < minMoonAlt || c.moonAlt > maxMoonAlt) continue;
          if (c.at < dayMs || c.at > dayMs + hours * 3600000) continue;
          if (!active(path, c.at)) continue;
          c.sunAltitude = A.sun(c.at, obs).apparentAltitude;
          hits.push(c);
        }
      }
      if (!hits.length) continue;
      hits.sort((a, b) => a.at - b.at);
      let planes = 0, minutes = 0;
      for (const h of hits) {
        const hour = new Date(h.at + 9 * 3600000).getUTCHours();
        // 期待機数＝円盤が航路にかかっている時間 × その経路の到着（出発）率
        planes += RT.trafficAt(hour) * arrivalsShare / lanesAt(h.kind, h.at) / 60 * h.diskMin;
        minutes += h.windowMin;
      }
      const best = hits.reduce((a, b) => (quality(b) > quality(a) ? b : a), hits[0]);
      const windows = mergeWindows(hits.map((h) => ({
        from: h.at - h.windowMin * 30000, to: h.at + h.windowMin * 30000 })));
      out.push({
        spot, minutes: Math.round(minutes), planes: Math.round(planes * 10) / 10,
        from: windows[0].from, to: windows[windows.length - 1].to,
        quality: Math.round(quality(best) * 100) / 100,
        score: Math.round(planes * quality(best) * 10) / 10,
        best, windows, crossings: hits,
        paths: [...new Set(hits.map((h) => h.path))],
      });
    }
    return out.sort((a, b) => b.score - a.score || b.planes - a.planes).slice(0, limit);
  }

  /**
   * 重なる時間帯をひとまとまりにする（1回の「狙える時間帯」）。
   * 時刻の並び（数値）でも、{from, to} の並びでも受ける
   */
  function mergeWindows(items, stepMin = 0) {
    const spans = items.map((x) => (typeof x === "number" ? { from: x, to: x } : { ...x }))
      .sort((a, b) => a.from - b.from);
    const gap = stepMin * 60000 * 1.5;
    const out = [];
    for (const s of spans) {
      const last = out[out.length - 1];
      if (last && s.from - last.to <= gap) last.to = Math.max(last.to, s.to);
      else out.push(s);
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

  const SoramiPlane = { distanceKm, bearing, seenFrom, separation, standLine, findSpots, keepOnLand,
                        crossingsFrom, rankSpots, mergeWindows, pathsFor, quality, MOON_RADIUS_DEG };
  global.SoramiPlane = SoramiPlane;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiPlane;
})(typeof globalThis !== "undefined" ? globalThis : this);
