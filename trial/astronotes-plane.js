/*
 * AstroNotes — 月丼（月と飛行機を重ねる）を狙う場所を探す
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

  const A = global.AstroNotesAstro || (typeof require !== "undefined" ? require("../../astronotes-astro.js") : null);
  const RT = global.AstroNotesRoutes || (typeof require !== "undefined" ? require("../../astronotes-routes.js") : null);
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

  /// その地点から見た飛行機の方位と見上げ角。
  /// **地球の丸みと大気差を含める**（「ねらう」の山や塔と同じ式）。平らな地面として解くと、
  /// 10km 先の機体を 0.04°、20km 先で 0.08°（月の半径の3割）高く見積もっていた（2026-09-30）
  function seenFrom(obs, point, eyeM = 1.5) {
    const d = distanceKm(obs.latitude, obs.longitude, point.latitude, point.longitude);
    return {
      azimuth: bearing(obs.latitude, obs.longitude, point.latitude, point.longitude),
      altitude: A.targetElevationAngle(d, (obs.elevation ?? 0) + eyeM, point.altitudeM),
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
    const out = [];
    for (const p of path) {
      // 見上げ角が月の高度になる距離。地球の丸みを含む見上げ角（seenFrom と同じ式）で解く
      let lo = 0.15, hi = maxKm;
      const angle = (dk) => A.targetElevationAngle(dk, eyeM, p.altitudeM);
      if (angle(lo) < moon.apparentAltitude || angle(hi) > moon.apparentAltitude) continue;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (angle(mid) > moon.apparentAltitude) lo = mid; else hi = mid;
      }
      const d = (lo + hi) / 2;
      // 観測者から見た機体の方位が月の方位になるように置く（行きと帰りの方位は子午線の収束ぶんずれる。
      // 「ねらう」と同じ直し。2026-09-30）
      let back = (moon.azimuth + 180) % 360, q = null;
      for (let k = 0; k < 4; k++) {
        q = RT.destination(p.latitude, p.longitude, back, d);
        const seen = bearing(q.latitude, q.longitude, p.latitude, p.longitude);
        const miss = ((moon.azimuth - seen + 540) % 360) - 180;
        if (Math.abs(miss) < 1e-6) break;
        back = (back + miss + 360) % 360;
      }
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
    center = { latitude: (RT.AIRPORT || RT.RJTT).latitude, longitude: (RT.AIRPORT || RT.RJTT).longitude },
    radiusKm = 30, gridKm = 1, stepMin = 5,
    minMoonAlt = 2, maxMoonAlt = 30,
    minPlaneKm = 2, maxPlaneKm = 20, bestPlaneKm = [4, 12],
    eyeM = 1.5, hours = 24, limit = 12,
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
      // 格子の探索は到着の経路を見る（時刻表の到着便）
      const perMin = RT.trafficAt(hour, "landing") / lanes / 60;
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
  // 経路からの横ずれ。**実測で決めた**（2026-09-30）: Pi5 の ADS-B 受信記録1日分で、
  // 22への最終進入（10〜28km手前・47点）の横ずれのばらつきは 5〜8m、中央は 20m 片寄り。
  // 以前の仮定（20m＋1kmあたり8m＝10km手前で±100m）は10倍以上広かった。
  // ばらつきの3倍に中央の片寄りと座標の誤差を足し、25m ＋ 1kmあたり1m とする
  const lateralScatterM = (alongKm) => 25 + 1 * Math.max(0, alongKm);
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
   * （2026-09-28 に見直し）。
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
    minPlaneKm = 2, maxPlaneKm = 20, eyeM = 1.5, hours = 24, limit = 6,
    activeAt = null,
  } = {}) {
    const active = typeof activeAt === "function" ? activeAt : () => true;
    // 1本の経路あたりの到着（出発）率。その時刻に同じ種類で使われている経路の数で割る
    const lanesAt = (kind, at) => Math.max(1, paths.filter((p) => p.kind === kind && active(p, at)).length);
    const out = [];
    for (const spot of spots) {
      // **展望台の上なら、そのぶん目が高い。** 機体との高低差が縮むので、
      // 同じ月の高さでも近くを通る機を狙える（低い月は地上だと街に隠れる）
      // eyeHeightAGL is already the lens/eye height above ground. Legacy deckM
      // means floor height, so only that form receives the default eye offset.
      const observerAGL = Number.isFinite(spot.eyeHeightAGL) ? spot.eyeHeightAGL : (spot.deckM ?? 0) + eyeM;
      const obs = { latitude: spot.latitude, longitude: spot.longitude,
                    elevation: (spot.elevationM ?? 0) + observerAGL };
      const track = [];
      for (let i = 0; i * stepMin * 60000 <= hours * 3600000; i++) {
        const at = dayMs + i * stepMin * 60000;
        const m = A.moon(at, obs);
        track.push({ at, azimuth: m.azimuth, altitude: m.apparentAltitude,
          illuminated: m.illuminatedFraction,
          use: m.apparentAltitude >= minMoonAlt && m.apparentAltitude <= maxMoonAlt });
      }
      // その場所の地平線（建物と地形）。**月の円盤がその上に出ていなければ重ならない**（2026-09-30）
      const horizonAt = typeof spot.horizonAt === "function" ? spot.horizonAt
        : (az) => RT.spotHorizonAt(spot.id, az);
      const hits = [];
      for (const path of paths) {
        for (const c of crossingsFrom(obs, path, track, { eyeM: 0, minPlaneKm, maxPlaneKm })) {
          if (c.moonAlt < minMoonAlt || c.moonAlt > maxMoonAlt) continue;
          if (c.moonAlt - MOON_RADIUS_DEG < horizonAt(c.moonAz)) continue;
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
        // 到着か出発かで時刻表の便数を分ける（朝は出発が多く、夜は到着が多い）
        planes += RT.trafficAt(hour, h.kind) / lanesAt(h.kind, h.at) / 60 * h.diskMin;
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
        // Published procedures include the turns before the final; others remain the straight final model.
        const proc = typeof RT.procedureApproachPath === "function" ? RT.procedureApproachPath(r) : null;
        out.push({ id: `${r} 着陸`, kind: "landing", runway: r, airportId: (RT.AIRPORT || RT.RJTT).id,
          altitudeDatum: "MSL", model: proc ? "procedure" : "representative", source: proc ? RT.procedureSource("landing", r) : null,
          flightOrder: -1, points: proc || RT.approachPath(r) });
      }
    }
    if (takeoff) {
      for (const r of op.takeoff) {
        const proc = typeof RT.procedureDeparturePath === "function" ? RT.procedureDeparturePath(r) : null;
        out.push({ id: `${r} 離陸`, kind: "takeoff", runway: r, airportId: (RT.AIRPORT || RT.RJTT).id,
          altitudeDatum: "MSL", model: proc ? "procedure" : "representative", source: proc ? RT.procedureSource("takeoff", r) : null,
          flightOrder: 1, points: proc || RT.departurePath(r) });
      }
    }
    return out;
  }

  // The map APIs below are pure. Terrain reads, cancellation, UI lifetime and
  // operation selection belong to the caller. groundM is never inferred from a
  // missing value. Every comparison uses the same absolute observer height.
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const length3 = v => Math.hypot(...v);
  const wrap180 = d => ((d + 540) % 360 + 360) % 360 - 180;
  const directionVector = (az, alt) => [Math.cos(alt * DEG) * Math.sin(az * DEG), Math.cos(alt * DEG) * Math.cos(az * DEG), Math.sin(alt * DEG)];
  const earthVector = p => [Math.cos(p.latitude * DEG) * Math.cos(p.longitude * DEG), Math.cos(p.latitude * DEG) * Math.sin(p.longitude * DEG), Math.sin(p.latitude * DEG)];
  const vectorSeparation = (a, b) => Math.atan2(length3(cross3(a, b)), dot3(a, b)) / DEG;
  const validPosition = p => p && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180;

  function mapObserver(input, defaultEye = 1.5) {
    if (!validPosition(input)) return { status: "invalid-observer" };
    if (!Number.isFinite(input.groundM)) return { status: "missing-elevation" };
    const eyeHeightAGL = input.eyeHeightAGL === undefined ? defaultEye : input.eyeHeightAGL;
    if (!Number.isFinite(eyeHeightAGL) || eyeHeightAGL < 0) return { status: "invalid-height" };
    return { status: "ready", latitude: input.latitude, longitude: input.longitude,
      groundM: input.groundM, eyeHeightAGL, elevation: input.groundM + eyeHeightAGL };
  }

  function interpolatePathPoint(a, b, f) {
    const km = distanceKm(a.latitude, a.longitude, b.latitude, b.longitude);
    const p = km > 1e-10 ? RT.destination(a.latitude, a.longitude, bearing(a.latitude, a.longitude, b.latitude, b.longitude), km * f)
      : { latitude: a.latitude, longitude: a.longitude };
    return { ...p, altitudeM: a.altitudeM + (b.altitudeM - a.altitudeM) * f,
      ...(Number.isFinite(a.distanceKm) && Number.isFinite(b.distanceKm)
        ? { distanceKm: a.distanceKm + (b.distanceKm - a.distanceKm) * f } : {}) };
  }

  function mapPaths(paths, maxStepKm = 0.5) {
    const out = [];
    for (const path of Array.isArray(paths) ? paths : []) {
      if (!path || !Array.isArray(path.points)) continue;
      const segments = [];
      for (let i = 0; i + 1 < path.points.length; i++) {
        const a = path.points[i], b = path.points[i + 1];
        if (!validPosition(a) || !validPosition(b) || !Number.isFinite(a.altitudeM) || !Number.isFinite(b.altitudeM)) continue;
        const length = distanceKm(a.latitude, a.longitude, b.latitude, b.longitude);
        const n = Math.max(1, Math.ceil(length / maxStepKm));
        // Data contract: each input segment follows the shortest geodesic with
        // linear MSL altitude. Curves must be represented by their vertices.
        for (let j = 0; j < n; j++) {
          const p = j ? interpolatePathPoint(a, b, j / n) : a;
          const q = j + 1 === n ? b : interpolatePathPoint(a, b, (j + 1) / n);
          const km = distanceKm(p.latitude, p.longitude, q.latitude, q.longitude);
          const av = earthVector(p), bv = earthVector(q), theta = km / R_KM;
          const tangent = theta > 1e-12 ? bv.map((x, k) => (x - av[k] * Math.cos(theta)) / Math.sin(theta)) : [0, 0, 0];
          segments.push({ a: p, b: q, km, av, theta, tangent,
            heading: km > 1e-10 ? bearing(p.latitude, p.longitude, q.latitude, q.longitude) : 0 });
        }
      }
      out.push({ path, segments });
    }
    return out;
  }

  function segmentPoint(s, u) {
    const p = s.km > 1e-10 ? RT.destination(s.a.latitude, s.a.longitude, s.heading, s.km * u)
      : { latitude: s.a.latitude, longitude: s.a.longitude };
    return { ...p, altitudeM: s.a.altitudeM + (s.b.altitudeM - s.a.altitudeM) * u,
      ...(Number.isFinite(s.a.distanceKm) && Number.isFinite(s.b.distanceKm)
        ? { distanceKm: s.a.distanceKm + (s.b.distanceKm - s.a.distanceKm) * u } : {}) };
  }

  // Split distance limits at the exact closest point of the geographic arc.
  // This retains a narrow in-range portion even when both endpoints are outside.
  function distanceSpans(s, obs, minKm, maxKm) {
    const ov = earthVector(obs), raw = s.theta > 1e-12 ? Math.atan2(dot3(ov, s.tangent), dot3(ov, s.av)) / s.theta : 0;
    const near = Math.max(0, Math.min(1, raw));
    const dAt = u => { const p = segmentPoint(s, u); return distanceKm(obs.latitude, obs.longitude, p.latitude, p.longitude); };
    const cuts = [0, 1];
    if (near > 1e-10 && near < 1 - 1e-10) cuts.push(near);
    const branches = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i + 1 < branches.length; i++) {
      const a = branches[i], b = branches[i + 1], da = dAt(a), db = dAt(b);
      for (const limit of [minKm, maxKm]) {
        if ((da - limit) * (db - limit) >= 0) continue;
        let lo = a, hi = b;
        for (let k = 0; k < 30; k++) {
          const mid = (lo + hi) / 2;
          if ((dAt(mid) - limit) * (da - limit) > 0) lo = mid; else hi = mid;
        }
        cuts.push((lo + hi) / 2);
      }
    }
    cuts.sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const lo = cuts[i], hi = cuts[i + 1], d = dAt((lo + hi) / 2);
      if (d >= minKm - 1e-8 && d <= maxKm + 1e-8 && hi - lo > 1e-12) out.push([lo, hi]);
    }
    return out;
  }

  function mapSnapshot(at, input, options) {
    const observer = mapObserver(input, options.eyeHeightAGL ?? 1.5);
    if (!Number.isFinite(at)) return { status: "invalid-time", at, observer };
    if (observer.status !== "ready") return { status: observer.status, at, observer };
    const moon = A.moonDirection(at, observer, options.air || {});
    const horizonAt = typeof options.horizonAt === "function" ? options.horizonAt : null;
    const horizon = horizonAt ? horizonAt(moon.azimuth) : A.seaHorizonAngle(observer.elevation);
    if (!Number.isFinite(horizon)) return { status: "missing-horizon", at, observer, moon };
    const status = moon.apparentAltitude - moon.angularRadius < horizon ? "below-horizon" : "ready";
    return { status, at, observer, moon, visibility: horizonAt ? "horizon-checked" : "obstructions-unchecked" };
  }

  function evaluateMap(snapshot, prepared, options, collect = true) {
    const result = { ...snapshot, overlaps: [], closest: null, pathIds: [] };
    if (snapshot.status !== "ready") return result;
    const { observer, moon } = snapshot;
    const mv = directionVector(moon.azimuth, moon.apparentAltitude), radius = moon.angularRadius;
    const minKm = options.minPlaneKm ?? 2, maxKm = options.maxPlaneKm ?? 20;
    if (!(minKm >= 0 && maxKm > minKm)) return { ...result, status: "invalid-distance-range" };
    for (const { path, segments } of prepared) {
      let previous = null;
      for (const s of segments) {
        const av = seenFrom(observer, s.a, 0), bv = seenFrom(observer, s.b, 0);
        const dmin = Math.min(av.distanceKm, bv.distanceKm), dmax = Math.max(av.distanceKm, bv.distanceKm);
        if (dmin - s.km > maxKm || dmax + s.km < minKm) { previous = null; continue; }
        const sa = vectorSeparation(directionVector(av.azimuth, av.altitude), mv), sb = vectorSeparation(directionVector(bv.azimuth, bv.altitude), mv);
        // Conservative angular bound from the total geographic + vertical
        // displacement. It is deliberately wider than a screen-line bound.
        const motionKm = s.km * 1.02 + Math.abs(s.b.altitudeM - s.a.altitudeM) / 1000;
        const sweep = Math.atan2(motionKm, Math.max(0.001, dmin - motionKm)) / DEG + 0.01;
        if (Math.min(sa, sb) > radius + sweep) { previous = null; continue; }
        const evaluate = u => {
          const point = segmentPoint(s, u), seen = seenFrom(observer, point, 0);
          return { u, point, seen, sep: vectorSeparation(directionVector(seen.azimuth, seen.altitude), mv) };
        };
        for (const [from, to] of distanceSpans(s, observer, minKm, maxKm)) {
          // Short (<=500m) geographic segments at >=2km have a single angular
          // minimum. Subdivision preserves curved input routes and wrap safety.
          let lo = from, hi = to;
          const phi = (Math.sqrt(5) - 1) / 2;
          let u = hi - phi * (hi - lo), v = lo + phi * (hi - lo), fu = evaluate(u), fv = evaluate(v);
          for (let i = 0; i < 28; i++) {
            if (fu.sep < fv.sep) { hi = v; v = u; fv = fu; u = hi - phi * (hi - lo); fu = evaluate(u); }
            else { lo = u; u = v; fu = fv; v = lo + phi * (hi - lo); fv = evaluate(v); }
          }
          const ends = [evaluate(from), evaluate(to), fu, fv];
          const best = ends.reduce((a, b) => a.sep < b.sep ? a : b);
          if (!result.closest || best.sep < result.closest.minSeparationDeg) result.closest = {
            pathId: path.id, kind: path.kind, runway: path.runway, point: best.point,
            planeKm: best.seen.distanceKm, minSeparationDeg: best.sep };
          if (best.sep > radius + 1e-9) { previous = null; continue; }
          if (!result.pathIds.includes(path.id)) result.pathIds.push(path.id);
          if (!collect) continue;
          const boundary = (outside, inside) => {
            if (evaluate(outside).sep <= radius) return outside;
            for (let k = 0; k < 30; k++) {
              const mid = (outside + inside) / 2;
              if (evaluate(mid).sep > radius) outside = mid; else inside = mid;
            }
            return inside;
          };
          const a = boundary(from, best.u), b = boundary(to, best.u);
          const points = [segmentPoint(s, a), best.point, segmentPoint(s, b)];
          const last = previous?.points[previous.points.length - 1];
          if (last && distanceKm(last.latitude, last.longitude, points[0].latitude, points[0].longitude) < 1e-5
            && Math.abs(last.altitudeM - points[0].altitudeM) < 0.01) {
            previous.points.push(...points.slice(1));
            previous.minSeparationDeg = Math.min(previous.minSeparationDeg, best.sep);
          } else {
            previous = { pathId: path.id, kind: path.kind, runway: path.runway, airportId: path.airportId,
              points, minSeparationDeg: best.sep };
            result.overlaps.push(previous);
          }
        }
      }
    }
    return result;
  }

  function routeOverlapAt(at, observer, paths, options = {}) {
    return evaluateMap(mapSnapshot(at, observer, options), mapPaths(paths), options);
  }

  function groundOverlapAt(at, samples, paths, options = {}) {
    const prepared = mapPaths(paths), stats = { total: 0, ready: 0, overlap: 0, missing: 0 };
    const output = (Array.isArray(samples) ? samples : []).map(sample => {
      // A selected observer's horizon must never be reused across the ground
      // surface. Only a per-sample horizon, when supplied, is applied here.
      const opts = { ...options, horizonAt: typeof sample.horizonAt === "function" ? sample.horizonAt : null };
      const input = { ...sample, eyeHeightAGL: sample.eyeHeightAGL ?? options.eyeHeightAGL ?? 1.5 };
      const r = evaluateMap(mapSnapshot(at, input, opts), prepared, opts, false);
      const ready = r.status === "ready", below = r.status === "below-horizon", overlap = ready ? r.pathIds.length > 0 : below ? false : null;
      const sep = r.closest?.minSeparationDeg ?? null;
      stats.total++; if (ready || below) stats.ready++; else stats.missing++; if (overlap) stats.overlap++;
      return { ...sample, status: r.status, overlap,
        score: ready ? (overlap && sep !== null ? Math.max(0, 1 - sep / r.moon.angularRadius) : 0) : below ? 0 : null,
        minSeparationDeg: sep, pathIds: r.pathIds, moonAz: r.moon?.azimuth ?? null,
        moonAlt: r.moon?.apparentAltitude ?? null, angularRadius: r.moon?.angularRadius ?? null,
        visibility: r.visibility ?? null };
    });
    return { status: Number.isFinite(at) ? "ready" : "invalid-time", at, samples: output, stats };
  }

  function diskDirection(moon, diskAngle, fraction = 1) {
    if (diskAngle === null || diskAngle === undefined) return { azimuth: moon.azimuth, altitude: moon.apparentAltitude };
    const az = moon.azimuth * DEG, alt = moon.apparentAltitude * DEG, radius = moon.angularRadius * fraction * DEG;
    const m = directionVector(moon.azimuth, moon.apparentAltitude), east = [Math.cos(az), -Math.sin(az), 0];
    const up = [-Math.sin(alt) * Math.sin(az), -Math.sin(alt) * Math.cos(az), Math.cos(alt)];
    const v = m.map((x, i) => x * Math.cos(radius) + (east[i] * Math.cos(diskAngle) + up[i] * Math.sin(diskAngle)) * Math.sin(radius));
    return { azimuth: (Math.atan2(v[0], v[1]) / DEG + 360) % 360, altitude: Math.atan2(v[2], Math.hypot(v[0], v[1])) / DEG };
  }

  function inverseGroundAt(at, planePoint, options = {}) {
    const { groundM, eyeHeightAGL = 1.5, diskAngle = null, diskFraction = 1 } = options;
    const minKm = options.minPlaneKm ?? 2, maxKm = options.maxPlaneKm ?? 20;
    if (!Number.isFinite(at)) return { status: "invalid-time" };
    if (!validPosition(planePoint) || !Number.isFinite(planePoint.altitudeM)) return { status: "invalid-path" };
    if (!Number.isFinite(groundM)) return { status: "missing-elevation" };
    if (!Number.isFinite(eyeHeightAGL) || eyeHeightAGL < 0 || !(maxKm > minKm && minKm >= 0)
      || !(diskAngle === null || Number.isFinite(diskAngle)) || !Number.isFinite(diskFraction) || diskFraction < 0 || diskFraction > 1)
      return { status: "invalid-options" };
    const height = groundM + eyeHeightAGL;
    let q = validPosition(options.anchor) ? { latitude: options.anchor.latitude, longitude: options.anchor.longitude } : null;
    const evaluate = p => {
      const obs = { ...p, elevation: height }, moon = A.moonDirection(at, obs, options.air || {});
      const target = diskDirection(moon, diskAngle, diskFraction), seen = seenFrom(obs, planePoint, 0);
      return { moon, seen, target, x: wrap180(seen.azimuth - target.azimuth) * Math.cos(target.altitude * DEG), y: seen.altitude - target.altitude,
        error: vectorSeparation(directionVector(seen.azimuth, seen.altitude), directionVector(target.azimuth, target.altitude)) };
    };
    if (!q) {
      const moon = A.moonDirection(at, { ...planePoint, elevation: height }, options.air || {});
      if (moon.apparentAltitude + moon.angularRadius <= 0) return { status: "below-horizon", moon };
      const target = diskDirection(moon, diskAngle, diskFraction);
      let lo = 0.05, hi = Math.max(80, maxKm * 2);
      const angle = d => A.targetElevationAngle(d, height, planePoint.altitudeM);
      if (angle(lo) < target.altitude || angle(hi) > target.altitude) return { status: "out-of-range", moon };
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (angle(mid) > target.altitude) lo = mid; else hi = mid; }
      q = RT.destination(planePoint.latitude, planePoint.longitude, target.azimuth + 180, (lo + hi) / 2);
    }
    let r = evaluate(q), iterations = 0;
    for (; iterations < 20 && r.error > 1e-7; iterations++) {
      const step = 0.001;
      const e = evaluate(RT.destination(q.latitude, q.longitude, 90, step));
      const n = evaluate(RT.destination(q.latitude, q.longitude, 0, step));
      const ex = (e.x - r.x) / step, ey = (e.y - r.y) / step, nx = (n.x - r.x) / step, ny = (n.y - r.y) / step;
      const determinant = ex * ny - nx * ey;
      if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) break;
      let dx = (-r.x * ny + nx * r.y) / determinant, dy = (-ex * r.y + r.x * ey) / determinant;
      const move = Math.hypot(dx, dy), scale = move > 8 ? 8 / move : 1;
      dx *= scale; dy *= scale;
      const next = RT.destination(q.latitude, q.longitude, Math.atan2(dx, dy) / DEG, Math.hypot(dx, dy));
      const nr = evaluate(next);
      if (!Number.isFinite(nr.error)) break;
      q = next; r = nr;
    }
    const status = r.error > 1e-5 ? "not-converged" : r.seen.distanceKm < minKm - 1e-7 || r.seen.distanceKm > maxKm + 1e-7 ? "out-of-range" : "ready";
    return { status, ...q, groundM, eyeHeightAGL, observerElevationM: height,
      planeKm: r.seen.distanceKm, minSeparationDeg: vectorSeparation(directionVector(r.seen.azimuth, r.seen.altitude), directionVector(r.moon.azimuth, r.moon.apparentAltitude)),
      angularErrorDeg: r.error, moon: r.moon, diskAngle, diskFraction, iterations };
  }

  // Seed topology for a continuous ribbon. These are deliberately NOT verified
  // ground candidates: groundM is an explicit seed assumption. The caller must
  // resolve each seed's DEM, rerun inverseGroundAt and check convergence before
  // painting it. Missing or discontinuous sections must not be bridged.
  function groundRibbonSeedsAt(at, paths, options = {}) {
    const seeds = [], ribbons = [], invalidPathIds = [], stepKm = Math.max(0.1, options.stepKm ?? 2), capSteps = Math.max(4, Math.floor(options.capSteps ?? 8));
    for (const path of Array.isArray(paths) ? paths : []) {
      const points = [], raw = Array.isArray(path.points) ? path.points : [];
      // A missing vertex breaks the route. Never make a filled ribbon by
      // silently connecting the valid vertices on its opposite sides.
      if (raw.some(p => !validPosition(p) || !Number.isFinite(p.altitudeM))) { invalidPathIds.push(path.id); continue; }
      // Preserve actual bends/altitude changes; straight model vertices can be
      // coalesced to stepKm without replacing an airport's curved route by a line.
      let lastKept = 0;
      for (let i = 0; i < raw.length; i++) {
        if (!validPosition(raw[i]) || !Number.isFinite(raw[i].altitudeM)) continue;
        let keep = i === 0 || i === raw.length - 1;
        if (!keep && i > 0 && i + 1 < raw.length && validPosition(raw[i - 1]) && validPosition(raw[i + 1])) {
          const before = bearing(raw[i - 1].latitude, raw[i - 1].longitude, raw[i].latitude, raw[i].longitude);
          const after = bearing(raw[i].latitude, raw[i].longitude, raw[i + 1].latitude, raw[i + 1].longitude);
          const d0 = distanceKm(raw[i - 1].latitude, raw[i - 1].longitude, raw[i].latitude, raw[i].longitude);
          const d1 = distanceKm(raw[i].latitude, raw[i].longitude, raw[i + 1].latitude, raw[i + 1].longitude);
          const slope0 = d0 ? (raw[i].altitudeM - raw[i - 1].altitudeM) / d0 : 0;
          const slope1 = d1 ? (raw[i + 1].altitudeM - raw[i].altitudeM) / d1 : 0;
          keep = Math.abs(wrap180(after - before)) > 0.2 || Math.abs(slope1 - slope0) > 0.2
            || distanceKm(raw[lastKept].latitude, raw[lastKept].longitude, raw[i].latitude, raw[i].longitude) >= stepKm - 1e-6;
        }
        if (keep) { points.push(raw[i]); lastKept = i; }
      }
      if (!points.length) continue;
      const dense = [points[0]];
      for (let i = 0; i + 1 < points.length; i++) {
        const a = points[i], b = points[i + 1], n = Math.max(1, Math.ceil(distanceKm(a.latitude, a.longitude, b.latitude, b.longitude) / stepKm - 1e-8));
        for (let j = 1; j <= n; j++) dense.push(j === n ? b : interpolatePathPoint(a, b, j / n));
      }
      points.splice(0, points.length, ...dense);
      const ribbon = { pathId: path.id, kind: path.kind, runway: path.runway, sections: [], startCapIds: [], endCapIds: [] };
      const add = (p, sectionIndex, edge, diskAngle, anchor) => {
        const id = `${path.id}:${sectionIndex}:${edge}`;
        const solution = inverseGroundAt(at, p, { ...options, groundM: options.groundM ?? 0, diskAngle, anchor });
        seeds.push({ id, pathId: path.id, kind: path.kind, runway: path.runway, sectionIndex, edge: edge.startsWith("cap") ? "cap" : edge,
          planePoint: { ...p }, ...solution, diskAngle });
        return seeds[seeds.length - 1];
      };
      for (let i = 0; i < points.length; i++) {
        const p = points[i], center = add(p, i, "center", null);
        const anchor = validPosition(center) ? center : null;
        let perpendicular = 0;
        if (anchor) {
          const obs = { ...anchor, elevation: center.observerElevationM };
          const a = seenFrom(obs, points[Math.max(0, i - 1)], 0), b = seenFrom(obs, points[Math.min(points.length - 1, i + 1)], 0);
          const dx = wrap180(b.azimuth - a.azimuth) * Math.cos(center.moon.apparentAltitude * DEG), dy = b.altitude - a.altitude;
          perpendicular = Math.atan2(dx, -dy);
        }
        const left = add(p, i, "left", perpendicular, anchor), right = add(p, i, "right", perpendicular + Math.PI, anchor);
        ribbon.sections.push({ centerId: center.id, leftId: left.id, rightId: right.id });
        if (i === 0 || i === points.length - 1) {
          const ids = [];
          for (let k = 0; k < capSteps; k++) ids.push(add(p, i, `cap${k}`, 2 * Math.PI * k / capSteps, anchor).id);
          if (i === 0) ribbon.startCapIds = ids;
          if (i === points.length - 1) ribbon.endCapIds = ids;
        }
      }
      ribbons.push(ribbon);
    }
    return { status: "seed", at, seeds, ribbons, invalidPathIds, terrainVerified: false, eyeHeightAGL: options.eyeHeightAGL ?? 1.5,
      seedGroundM: options.groundM ?? 0, maxSectionStepKm: stepKm };
  }

  const AstroNotesPlane = { distanceKm, bearing, seenFrom, separation, standLine, findSpots, keepOnLand,
                        crossingsFrom, rankSpots, mergeWindows, pathsFor, quality, MOON_RADIUS_DEG,
                        routeOverlapAt, groundOverlapAt, inverseGroundAt, groundRibbonSeedsAt };
  global.AstroNotesPlane = AstroNotesPlane;
  if (typeof module !== "undefined" && module.exports) module.exports = AstroNotesPlane;
})(typeof globalThis !== "undefined" ? globalThis : this);

/* Legacy global names remain aliases for cached integrations. */
if(typeof AstroNotes!=='undefined')globalThis.Sorami=AstroNotes;if(typeof AstroNotesAstro!=='undefined')globalThis.SoramiAstro=AstroNotesAstro;if(typeof AstroNotesPlane!=='undefined')globalThis.SoramiPlane=AstroNotesPlane;
if(typeof AstroNotesRoutes!=='undefined')globalThis.SoramiRoutes=AstroNotesRoutes;
