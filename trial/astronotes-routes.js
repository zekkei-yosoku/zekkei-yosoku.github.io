/*
 * AstroNotes — 空港の滑走路と、飛行機が通る道（月丼用）
 *
 * **月丼**＝月と飛行機を重ねて撮ること。重なるかどうかは
 *   「その時刻の月の方位・高度」と「そのとき飛行機がいる場所」
 * だけで決まる。月は計算で出せる。飛行機は**航路が決まっている**ので、
 * 進入・出発の経路を形として持っておけば、重なる立ち位置が解ける。
 *
 * ここに置くのは**経路の形**だけ。月との突き合わせは `astronotes-plane.js`。
 *
 * 出典:
 *   滑走路の位置と真方位 … OurAirports `runways.csv`（RJTT）。
 *     https://davidmegginson.github.io/ourairports-data/
 *   進入の降下角 … ILS/RNAV の標準 3.0°
 *   運用の向き（北風・南風）と時間帯 … 国土交通省「羽田空港の新しい飛行経路」
 *
 * **これは経路の代表線であって、実際の1機ではない。** 管制の指示で前後左右にずれる。
 */
(function (global) {
  "use strict";

  const DEG = Math.PI / 180;

  /**
   * 滑走路。`ident` は着陸時に向かう方位の呼び名。
   * `threshold` はその名前の端（＝そこへ降りてくる端）の座標。
   * `headingDegT` は**真方位**（磁方位ではない）。
   * `landingThreshold` は着陸の基準となる移設された滑走路端（AIP RJTT AD2.12）。無ければ `threshold`。
   */
  const RJTT = {
    id: "RJTT", name: "羽田空港", latitude: 35.5533, longitude: 139.7811, elevationM: 6,
    runways: [
      { ident: "34L", threshold: { latitude: 35.536591, longitude: 139.785672 }, headingDegT: 330, elevationM: 6 },
      { ident: "34R", threshold: { latitude: 35.53969, longitude: 139.805142 }, landingThreshold: { latitude: 35.542506, longitude: 139.80315 }, headingDegT: 330, elevationM: 6 },
      // 16L/16R（南風の都心上空ルート）は、好天時の RNAV 進入で**降下角 3.45°**（騒音のため高めに通す）。
      // 月丼は晴れた日の話なので、こちらを使う。出典: 国土交通省・中野区「羽田空港の新飛行経路」
      { ident: "16L", threshold: { latitude: 35.565897, longitude: 139.78655 }, landingThreshold: { latitude: 35.562853, longitude: 139.788706 }, headingDegT: 150, elevationM: 7, glideDeg: 3.45 },
      { ident: "16R", threshold: { latitude: 35.560452, longitude: 139.768734 }, landingThreshold: { latitude: 35.556242, longitude: 139.771719 }, headingDegT: 150, elevationM: 6, glideDeg: 3.45 },
      { ident: "22", threshold: { latitude: 35.567459, longitude: 139.777114 }, headingDegT: 215, elevationM: 11 },
      { ident: "04", threshold: { latitude: 35.549015, longitude: 139.761274 }, headingDegT: 35, elevationM: 6 },
      { ident: "23", threshold: { latitude: 35.540598, longitude: 139.822125 }, headingDegT: 223, elevationM: 17 },
      { ident: "05", threshold: { latitude: 35.524001, longitude: 139.803469 }, headingDegT: 42.5, elevationM: 14 },
    ],
  };
  const runwayOf = (ident) => RJTT.runways.find((r) => r.ident === ident) || null;
  /// 滑走路の端を越える高さ（ILS の基準高 TCH）。ICAO Annex 10 / PANS-OPS の標準 15m（50ft）
  const THRESHOLD_CROSSING_M = 15;

  /**
   * 風から選ぶ簡略モデル。実際の使用滑走路は気象・管制・時間帯でも変わる。
   *   北風運用 … 南から進入して北へ降りる（34L/34R）。出発は 05 と 34R
   *   南風運用 … 北から進入して南へ降りる（16L/16R）。出発は 22 と 16L
   * 南風の到着は都心の上を通る（2020年からの経路）。**15〜19時だけ**。
   */
  const OPERATIONS = {
    north: { name: "北風運用", landing: ["34L", "34R"], takeoff: ["05", "34R"] },
    south: { name: "南風運用（都心上空）", landing: ["16L", "16R"], takeoff: ["22", "16L"],
             landingHours: [15, 19], note: "南風の新経路は15〜19時のうち3時間程度。実運用は未確認です" },
    // **15〜19時以外の南風は、湾の側から B・D 滑走路へ降りる**（都心の上は通らない）。
    // 以前はこれを持たず、南風の日は一日じゅう都心上空の線を引いていた（2026-09-28 修正）
    southBay: { name: "南風運用（湾側）", landing: ["22", "23"], takeoff: ["16L", "16R"],
                note: "南風の湾側モデル。6〜15時・19〜23時を対象とします" },
  };

  /**
   * 想定運用を選ぶための既存の追い風閾値。羽田の実運用を確定する条件ではない。
   */
  const TAILWIND_LIMIT_MS = 2.6;

  /**
   * 風から想定運用を選ぶ。描画前には operationStatus(at).supported も確認する。
   *
   * 以前は「風向が北寄りか南寄りか」だけで決めていたので、**弱い南風でも南風運用**にしていた。
   * このモデルでは34への追い風成分で選ぶ。ATIS等による実運用の確認は行っていない。
   *
   * @param {number} windFromDeg 風が吹いてくる方位（気象の風向）
   * @param {number} [windSpeedMs] 風速。無ければ向きだけで決める（従来どおり）
   * @param {number} [hourJst] 時刻。南風のときに、都心上空（15〜19時）か湾側かを分ける
   */
  function operationFor(windFromDeg, windSpeedMs, hourJst) {
    if (!Number.isFinite(windFromDeg) || windFromDeg < 0 || windFromDeg > 360) return null;
    if (windSpeedMs !== undefined && (!Number.isFinite(windSpeedMs) || windSpeedMs < 0)) return null;
    if (hourJst !== undefined && (!Number.isFinite(hourJst) || hourJst < 0 || hourJst >= 24)) return null;
    let south;
    if (Number.isFinite(windSpeedMs)) {
      // 34（330°）へ降りるときの向かい風成分。負なら追い風
      const head = windSpeedMs * Math.cos((windFromDeg - 330) * DEG);
      south = -head > TAILWIND_LIMIT_MS;
    } else {
      // 滑走路の軸は 330°/150°。風がその軸の北寄り半面から吹けば北風運用
      const diff = ((windFromDeg - 330 + 540) % 360) - 180;
      south = Math.abs(diff) >= 90;
    }
    if (!south) return "north";
    if (!Number.isFinite(hourJst)) return "south";
    const [from, to] = OPERATIONS.south.landingHours;
    return hourJst >= from && hourJst < to ? "south" : "southBay";
  }

  /**
   * 選択日時にこの簡略モデルを使えるか。時刻は実行端末のTZによらずJSTで判定する。
   * Date、epoch milliseconds、タイムゾーン付きISO文字列を受け取る。欠測を現在時刻に補完しない。
   * 国交省の時間窓は運用確定情報ではなく、北風の新旧経路形状はこのモデルで区別していない。
   * https://www.mlit.go.jp/koku/haneda/action/
   */
  function operationStatus(at) {
    let epochMs = NaN;
    if (typeof at === "number") epochMs = at;
    else if (typeof at === "string" && /(?:Z|[+-]\d{2}:\d{2})$/i.test(at)) epochMs = Date.parse(at);
    else if (Object.prototype.toString.call(at) === "[object Date]") epochMs = Date.prototype.getTime.call(at);
    const local = new Date(epochMs + 9 * 3600000);
    const hourJst = Number.isFinite(epochMs) && Number.isFinite(local.getTime())
      ? local.getUTCHours() + local.getUTCMinutes() / 60 + local.getUTCSeconds() / 3600 : null;
    const sourceUrl = "https://www.mlit.go.jp/koku/haneda/action/";
    const modelLimit = "滑走路付近の簡略経路です。天候・管制による変更や北風の新旧経路の違いは再現していません";
    const base = { timeZone: "Asia/Tokyo", hourJst, sourceUrl, modelLimit, operationConfirmed: false };
    if (hourJst === null) return { ...base, supported: false, period: "unknown", northWindow: null, southWindow: null,
      note: "日時が確認できないため経路を表示できません" };
    if (hourJst < 6 || hourJst >= 23) return { ...base, supported: false, period: "night", northWindow: null, southWindow: null,
      note: "23〜6時は海上の深夜早朝経路になります。このモデルは対応していません" };
    const afternoonWindow = hourJst >= 15 && hourJst < 19;
    const northWindow = (hourJst >= 7 && hourJst < 11.5) || afternoonWindow ? "new" : "existing";
    const southWindow = afternoonWindow ? "new" : "existing";
    return { ...base, supported: true, period: "day", northWindow, southWindow,
      note: afternoonWindow
        ? "15〜19時は新経路の時間帯ですが、運用はそのうち3時間程度です。実際の経路は未確認です"
        : "風と時刻から選ぶ想定運用です。実際の使用滑走路・経路は未確認です" };
  }

  /**
   * 進入の経路。滑走路のしきい値から**手前へ**まっすぐ伸ばし、3°で上がる。
   * @returns {{latitude,longitude,altitudeM,distanceKm}[]} 近い順
   */
  function approachPath(ident, { fromKm = 2, toKm = 30, stepKm = 0.5, slopeDeg = null } = {}) {
    const rw = runwayOf(ident);
    if (!rw) return [];
    const back = (rw.headingDegT + 180) % 360;
    // 降下角は滑走路ごと（16L/16R の都心上空ルートは 3.45°、ほかは標準の 3.0°）
    const slope = slopeDeg ?? rw.glideDeg ?? 3;
    const out = [];
    for (let d = fromKm; d <= toKm + 1e-9; d += stepKm) {
      const t = rw.landingThreshold ?? rw.threshold;
      const p = destination(t.latitude, t.longitude, back, d);
      // **滑走路の端を 15m（50ft）の高さで越える。** ICAO の標準（ILS の基準高 TCH）。
      // 以前は端で高さ0として引いていて、どの距離でも 15m 低かった（5km 先・月の高さ3°の場面で
      // 0.17°＝月の半径の6割ずれる。2026-09-30）
      out.push({ ...p, altitudeM: rw.elevationM + THRESHOLD_CROSSING_M + d * 1000 * Math.tan(slope * DEG), distanceKm: d });
    }
    return out;
  }

  /**
   * 公表の飛行方式（AIP Japan RJTT AD2.24、SWIM portal 20261126発行分）。
   * 通過点の座標は STAR/SID の Waypoint Coordinates 表と進入図から。高度は図の制限高度、
   * 無い点は前後の制限高度から距離で按分する。管制の指示で実際はずれる。**航空機の運航には使えない。**
   *
   * 到着は滑走路から外へ向かう順。`faf` までは降下角 `glideDeg` の直線（最終進入）。
   * `faf` が座標でなく数値なら、滑走路の延長線上のその距離[NM]（22 の LDA は最後の1.8NMだけ滑走路に正対する）。
   * `cut` があれば、高度の按分にはその先の点も使い、線はその点で切る。
   * 出発は飛行の順。滑走路の向きに `vaFt` まで上がってから最初の点へ向かう（SID の VA→DF）。
   * 上昇は勾配 `climb` の直線で、at or above の制限を下回る区間だけ持ち上げる。
   */
  const FT = 0.3048, NM = 1.852;
  const PROCEDURES = {
    arrival: {
      "16L": { glideDeg: 3.45, faf: [35.69578, 139.69418], source: "AIP RJTT IAC RNP RWY16L・STAR AKSEL L", cut: "SPINE", fixes: [
        ["LYCEE", 35.74837, 139.68261, 4000], ["SANDY", 35.82153, 139.73411, 4500], ["SACHS", 35.81061, 139.81067],
        ["SNARE", 35.79197, 139.87725, 6000], ["SOPPY", 35.74967, 140.02786, 7000], ["SPINE", 35.70375, 140.1905],
        ["SNOKE", 35.59767, 140.23658], ["SHAFT", 35.37428, 140.22036, 9000]] },
      "16R": { glideDeg: 3.45, faf: [35.70354, 139.66686], source: "AIP RJTT IAC RNP RWY16R・STAR AKSEL R", fixes: [
        ["ROWAN", 35.75191, 139.63232, 3800], ["REMUS", 35.80209, 139.63209], ["RACER", 35.86484, 139.67622],
        ["NATTY", 35.89747, 139.75869, 5000], ["NIGEL", 35.93542, 139.85494, 6000], ["NEURO", 35.95767, 139.91147, 6000],
        ["NURSE", 36.16092, 140.03147, 9000]] },
      "34L": { glideDeg: 3, faf: [35.32203, 139.93744], source: "AIP RJTT IAC ILS Z RWY34L・STAR AKSEL 1A", fixes: [
        ["ARLON", 35.25703, 139.98328, 5000], ["WEDGE", 35.15011, 139.97958, 8000]] },
      "34R": { glideDeg: 3, faf: [35.37022, 139.92503], source: "AIP RJTT IAC ILS Z RWY34R・STAR GODIN 2C", fixes: [
        ["CAMEL", 35.28839, 139.98272, 4000], ["CLOAK", 35.26333, 140.03561, 4000], ["CREAM", 35.29539, 140.10344],
        ["EDDIE", 35.2465, 140.36136, 8000]] },
      "22": { glideDeg: 3, faf: 1.8, turnKm: 1.5, source: "AIP RJTT IAC LDA W RWY22・STAR AKSEL 1B", fixes: [
        ["BONDO", 35.60536, 140.07847, 5000], ["BIBLO", 35.60564, 140.14292, 5500], ["BEAST", 35.58578, 140.18558, 6000],
        ["BACON", 35.53194, 140.20419, 7000], ["SHAFT", 35.37428, 140.22036, 8000]] },
      "23": { glideDeg: 3, faf: [35.6814, 139.99165], source: "AIP RJTT IAC ILS Z RWY23・STAR GODIN 1S", cut: "SCREW", fixes: [
        ["SMILE", 35.74344, 140.06692, 4000], ["SNAKE", 35.87639, 140.11003], ["", 35.89589, 140.03436],
        ["STEAM", 35.93147, 139.95233, 4000], ["SCREW", 36.05033, 139.90011], ["NOVEL", 36.35192, 140.00136, 8000]] },
    },
    departure: {
      "05": { vaFt: 500, source: "AIP RJTT SID LAXAS（RWY05）", fixes: [
        ["TT501", 35.55797, 139.84164], ["TT502", 35.54011, 139.95575], ["LOCUP", 35.45522, 139.93569, 5000], ["TAURA", 35.31281, 139.74647, 9000]] },
      "34R": { vaFt: 700, source: "AIP RJTT SID BEKLA（RWY34R）", fixes: [
        ["ARAKA", 35.64689, 139.84497], ["GUGVA", 35.70389, 139.85831], ["OHEDO", 35.7565, 139.81072], ["INTEL", 35.76472, 139.72783, 9000]] },
      "22": { vaFt: 600, source: "AIP RJTT SID LAXAS（RWY22）", fixes: [
        ["HOBBS", 35.44831, 139.76147], ["BASSA", 35.35244, 139.76172], ["UMUKI", 35.20531, 139.81367], ["PIPER", 35.16619, 139.76167, 9000]] },
      "16L": { vaFt: 500, source: "AIP RJTT SID BEKLA（RWY16L）", fixes: [
        ["T6L23", 35.441, 139.92753], ["WELDA", 35.49483, 139.99908, 6000], ["PLUTO", 35.60892, 139.96022], ["KAIJI", 35.736, 139.9685],
        ["INTEL", 35.76472, 139.72783, 9000]] },
      "16R": { vaFt: 500, source: "AIP RJTT SID LAXAS（RWY16R）", fixes: [
        ["T6R11", 35.43125, 139.86033], ["TAURA", 35.31281, 139.74647, 9000]] },
    },
  };
  /// 旋回半径[km]。到着 約210kt・出発 約200kt を傾き25°で回る大きさ
  const ARRIVAL_TURN_KM = 2.2, DEPARTURE_TURN_KM = 1.8, DEPARTURE_CLIMB = 0.08;

  // 羽田を中心にした平面（100km以内で距離の誤差0.3%未満）
  const KM_PER_DEG = 6371.0088 * DEG, COS0 = Math.cos(RJTT.latitude * DEG);
  const toXY = (lat, lon) => [(lon - RJTT.longitude) * COS0 * KM_PER_DEG, (lat - RJTT.latitude) * KM_PER_DEG];
  const toLL = (x, y) => ({ latitude: RJTT.latitude + y / KM_PER_DEG, longitude: RJTT.longitude + x / (COS0 * KM_PER_DEG) });
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
  const len = (a) => Math.hypot(a[0], a[1]), unit = (a) => mul(a, 1 / len(a)), crossZ = (a, b) => a[0] * b[1] - a[1] * b[0];

  /**
   * 通過点を、滑らかな飛行の線にする。
   * pts[0]→pts[1] は直線（最終進入／離陸直後）。pts[1] では直線に接したまま旋回し、pts[2] へ向いたら直進する。
   * それより先の通過点は、手前で旋回を始めて内側を回る（fly-by）。
   * 各点の s は元の折れ線での距離（高度の按分に使う）。
   */
  function smoothRoute(pts, turnKm, firstTurnKm = turnKm) {
    const out = [{ p: pts[0], s: 0 }];
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(sub(pts[i], pts[i - 1])));
    const straight = (a, b, sa, sb) => {
      const n = Math.max(1, Math.ceil(len(sub(b, a)) / 0.5));
      for (let k = 1; k <= n; k++) out.push({ p: add(a, mul(sub(b, a), k / n)), s: sa + (sb - sa) * k / n });
    };
    const arc = (c, r, a0, sweep, sa, sb) => {
      const n = Math.max(2, Math.ceil(Math.abs(sweep) * r / 0.15));
      for (let k = 1; k <= n; k++) { const a = a0 + sweep * k / n; out.push({ p: [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)], s: sa + (sb - sa) * k / n }); }
    };
    straight(pts[0], pts[1], 0, cum[1]);
    if (pts.length < 3) return { out, cum };
    // pts[1]: 接したまま回って、pts[2] へ接線で抜ける
    let cur = pts[1], curS = cum[1];
    {
      const u = unit(sub(pts[1], pts[0])), w = sub(pts[2], pts[1]);
      const side = Math.sign(crossZ(u, w));
      const r = Math.min(firstTurnKm, 0.45 * len(w));
      if (side !== 0 && Math.abs(Math.atan2(crossZ(u, unit(w)), u[0] * w[0] + u[1] * w[1])) > 0.5 * DEG) {
        const n = side > 0 ? [-u[1], u[0]] : [u[1], -u[0]];
        const c = add(pts[1], mul(n, r)), cw = sub(pts[2], c), d = len(cw);
        const phi = Math.atan2(cw[1], cw[0]), alpha = Math.acos(Math.min(1, r / d));
        const a0 = Math.atan2(pts[1][1] - c[1], pts[1][0] - c[0]);
        const aT = side > 0 ? phi - alpha : phi + alpha;
        let sweep = aT - a0;
        if (side > 0) { while (sweep < 0) sweep += 2 * Math.PI; } else { while (sweep > 0) sweep -= 2 * Math.PI; }
        const q = [c[0] + r * Math.cos(aT), c[1] + r * Math.sin(aT)];
        const sq = cum[1] + (cum[2] - cum[1]) * Math.min(1, (Math.abs(sweep) * r) / len(w));
        arc(c, r, a0, sweep, cum[1], sq);
        cur = q; curS = sq;
      }
    }
    for (let i = 2; i < pts.length - 1; i++) {
      const vin = sub(pts[i], cur), vout = sub(pts[i + 1], pts[i]);
      const ui = unit(vin), uo = unit(vout);
      const theta = Math.atan2(crossZ(ui, uo), ui[0] * uo[0] + ui[1] * uo[1]);
      if (Math.abs(theta) < 0.5 * DEG) { straight(cur, pts[i], curS, cum[i]); cur = pts[i]; curS = cum[i]; continue; }
      const t = Math.tan(Math.abs(theta) / 2);
      const r = Math.min(turnKm, 0.5 * Math.min(len(vin), len(vout)) / t);
      const lead = r * t;
      const t1 = sub(pts[i], mul(ui, lead)), t2 = add(pts[i], mul(uo, lead));
      const s1 = cum[i] - lead, s2 = cum[i] + lead;
      straight(cur, t1, curS, s1);
      const n = theta > 0 ? [-ui[1], ui[0]] : [ui[1], -ui[0]];
      const c = add(t1, mul(n, r));
      arc(c, r, Math.atan2(t1[1] - c[1], t1[0] - c[0]), theta, s1, s2);
      cur = t2; curS = s2;
    }
    straight(cur, pts[pts.length - 1], curS, cum[cum.length - 1]);
    return { out, cum };
  }

  function interpolateAlt(cum, alts, s) {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return alts[i - 1] + (alts[i] - alts[i - 1]) * Math.min(1, Math.max(0, f));
  }
  /// 高度の無い点を、前後の高度の距離按分で埋める
  function fillAltitudes(cum, alts) {
    const out = alts.slice();
    for (let i = 0; i < out.length; i++) {
      if (Number.isFinite(out[i])) continue;
      let a = i - 1, b = i + 1;
      while (b < out.length && !Number.isFinite(out[b])) b++;
      out[i] = b < out.length ? out[a] + (out[b] - out[a]) * (cum[i] - cum[a]) / (cum[b] - cum[a]) : out[a];
    }
    return out;
  }
  function finishRoute(res, alts, cutS) {
    // 高度は外（到着）／先（出発）へ向かって下がらない。16R の RIPOD 3.45°パス 3810ft と ROWAN 3800ft のような丸めの差を吸収
    const filled = fillAltitudes(res.cum, alts).map((a, i, all) => Math.max(a, ...all.slice(0, i + 1)));
    const pts = [];
    let d = 0, prev = null;
    for (const { p, s } of res.out) {
      if (prev) d += len(sub(p, prev));
      prev = p;
      if (cutS !== null && s > cutS + 1e-6) break;
      pts.push({ ...toLL(p[0], p[1]), altitudeM: interpolateAlt(res.cum, filled, s), distanceKm: d });
    }
    return pts;
  }

  /// 公表の飛行方式による到着経路（滑走路から外へ）。無ければ null
  function procedureApproachPath(ident) {
    const m = PROCEDURES.arrival[ident], rw = runwayOf(ident);
    if (!m || !rw) return null;
    const t = rw.landingThreshold ?? rw.threshold;
    const faf = Array.isArray(m.faf) ? m.faf
      : (({ latitude, longitude }) => [latitude, longitude])(destination(t.latitude, t.longitude, (rw.headingDegT + 180) % 360, m.faf * NM));
    const pts = [toXY(t.latitude, t.longitude), toXY(faf[0], faf[1]), ...m.fixes.map(([, la, lo]) => toXY(la, lo))];
    const res = smoothRoute(pts, ARRIVAL_TURN_KM, m.turnKm ?? ARRIVAL_TURN_KM);
    const fafKm = res.cum[1];
    const alts = [rw.elevationM + THRESHOLD_CROSSING_M, rw.elevationM + THRESHOLD_CROSSING_M + fafKm * 1000 * Math.tan(m.glideDeg * DEG),
      ...m.fixes.map((f) => (Number.isFinite(f[3]) ? f[3] * FT : NaN))];
    const cutIndex = m.cut ? m.fixes.findIndex((f) => f[0] === m.cut) + 2 : -1;
    return finishRoute(res, alts, cutIndex > 1 ? res.cum[cutIndex] : null);
  }

  /// 公表の飛行方式による出発経路（飛ぶ順）。無ければ null
  function procedureDeparturePath(ident, { fromKm = 1 } = {}) {
    const m = PROCEDURES.departure[ident], rw = runwayOf(ident);
    if (!m || !rw) return null;
    const start = destination(rw.threshold.latitude, rw.threshold.longitude, rw.headingDegT, fromKm);
    const vaKm = fromKm + m.vaFt * FT / DEPARTURE_CLIMB / 1000;
    const va = destination(rw.threshold.latitude, rw.threshold.longitude, rw.headingDegT, vaKm);
    const pts = [toXY(start.latitude, start.longitude), toXY(va.latitude, va.longitude), ...m.fixes.map(([, la, lo]) => toXY(la, lo))];
    const res = smoothRoute(pts, DEPARTURE_TURN_KM);
    // 勾配どおりの高度。at or above の制限を下回れば、その点までの勾配を上げる
    const base = rw.elevationM + fromKm * 1000 * DEPARTURE_CLIMB;
    const alts = res.cum.map((c, i) => base + c * 1000 * DEPARTURE_CLIMB);
    m.fixes.forEach((f, k) => { if (Number.isFinite(f[3]) && alts[k + 2] < f[3] * FT) {
      const need = f[3] * FT, g = (need - base) / res.cum[k + 2];
      for (let j = 1; j <= k + 2; j++) alts[j] = Math.max(alts[j], base + res.cum[j] * g);
      for (let j = k + 3; j < alts.length; j++) alts[j] = Math.max(alts[j], need + (res.cum[j] - res.cum[k + 2]) * 1000 * DEPARTURE_CLIMB);
    } });
    return finishRoute(res, alts, null).map((p) => ({ ...p, distanceKm: p.distanceKm + fromKm }));
  }

  const procedureSource = (kind, ident) => PROCEDURES[kind === "takeoff" ? "departure" : "arrival"][ident]?.source ?? null;
  // 旧名（キャッシュされた呼び出し側のため）
  const measuredApproachPath = (ident) => procedureApproachPath(ident);
  const measuredSource = (ident) => procedureSource("landing", ident);

  /**
   * 出発の経路。滑走路の向きへまっすぐ、上昇率で上がる。
   * **離陸はすぐ旋回する**ので、まっすぐな区間だけを短く持つ。
   */
  function departurePath(ident, { fromKm = 1, toKm = 12, stepKm = 0.5, climbRatio = 0.08 } = {}) {
    const rw = runwayOf(ident);
    if (!rw) return [];
    const out = [];
    for (let d = fromKm; d <= toKm + 1e-9; d += stepKm) {
      const p = destination(rw.threshold.latitude, rw.threshold.longitude, rw.headingDegT, d);
      out.push({ ...p, altitudeM: rw.elevationM + d * 1000 * climbRatio, distanceKm: d });
    }
    return out;
  }

  /**
   * 定番の撮影地。**行ける場所だけを名前で持つ。**
   *
   * 格子で探すと上位が東京湾の真ん中になる（進入は湾の上を通るため）。
   * 「今日はここ」と言えるようにするには、**立てる場所**の中から選ぶ必要がある。
   *
   * 座標は OpenStreetMap（Nominatim）で引いた実測値。`note` は現地の性格。
   */
  const SPOTS = [
    // `deckM` は地上からの高さ。**低い月は地上だと街に隠れる**ので、展望台は有利
    { id: "t1", name: "羽田 第1ターミナル 展望デッキ", latitude: 35.54915, longitude: 139.78450, deckM: 20, note: "A滑走路(34L/16R)の正面。屋上" },
    { id: "t2", name: "羽田 第2ターミナル 展望デッキ", latitude: 35.55081, longitude: 139.78823, deckM: 20, note: "C滑走路(34R/16L)の正面。屋上" },
    { id: "t3", name: "羽田 第3ターミナル 展望デッキ", latitude: 35.54389, longitude: 139.76865, deckM: 20, note: "国際線側。西向きが開ける" },
    { id: "jonanjima", name: "城南島海浜公園", latitude: 35.58144, longitude: 139.78484, note: "定番。滑走路の北側で、着陸機が頭上を通る" },
    { id: "keihinjima", name: "京浜島つばさ公園", latitude: 35.57051, longitude: 139.77017, note: "定番。A滑走路に近い" },
    { id: "morigasaki", name: "森ヶ崎公園", latitude: 35.56353, longitude: 139.75044, note: "住宅地の高台。空が開ける" },
    { id: "ukishima", name: "浮島町公園", latitude: 35.52157, longitude: 139.78802, note: "定番。滑走路の南側で、離着陸が近い" },
    { id: "skybridge", name: "多摩川スカイブリッジ", latitude: 35.54045, longitude: 139.76095, note: "多摩川の河口。歩道あり" },
    { id: "daishibashi", name: "大師橋（多摩川）", latitude: 35.53662, longitude: 139.74058, note: "多摩川の橋。進入の真下寄り" },
    { id: "rokugobashi", name: "六郷橋（多摩川）", latitude: 35.54134, longitude: 139.70988, note: "多摩川の橋。羽田の西" },
    { id: "gasbashi", name: "ガス橋（多摩川）", latitude: 35.56371, longitude: 139.67928, note: "多摩川の橋。さらに西" },
    { id: "higashiogishima", name: "東扇島東公園", latitude: 35.50437, longitude: 139.77243, note: "扇島。滑走路の南、海側が開ける" },
    { id: "marien", name: "川崎マリエン 展望室", latitude: 35.49735, longitude: 139.76268, deckM: 51, note: "扇島。地上51mの展望室" },
    { id: "wakasu", name: "若洲海浜公園", latitude: 35.62360, longitude: 139.83741, note: "湾の北。ゲートブリッジ越し" },
    { id: "kasai", name: "葛西臨海公園", latitude: 35.64221, longitude: 139.85948, note: "湾の北東" },
    { id: "sanbanze", name: "ふなばし三番瀬海浜公園", latitude: 35.67273, longitude: 139.96662, note: "千葉側。北風の進入の延長" },
    { id: "umihotaru", name: "海ほたる", latitude: 35.46299, longitude: 139.87642, deckM: 12, note: "湾のまんなか。車で行ける。5階デッキ" },
    { id: "nakanoshima", name: "中の島大橋（木更津）", latitude: 35.38380, longitude: 139.91253, deckM: 27, note: "千葉側。歩道橋の上は地上27m" },
    { id: "futtsu", name: "富津公園", latitude: 35.31298, longitude: 139.81080, note: "湾の南。進入のさらに遠方" },
    { id: "chibaport", name: "千葉ポートタワー 展望台", latitude: 35.60042, longitude: 140.09786, deckM: 113, note: "千葉側。地上113m" },
    { id: "inage", name: "稲毛海浜公園", latitude: 35.62137, longitude: 140.05948, note: "千葉側。海が開ける" },
  ];


  /**
   * 定番の場所の**地平線**（建物と地形でどこまで空が隠れるか）。方位 0,5,10,…,355° の高さ[0.1度]。
   *
   * 2026-09-30 に、国土地理院の標高タイル（地形）と OpenStreetMap の建物の高さ（半径1km）から測った。
   * 低い月（2〜5°）は地上の場所だと街に隠れることがあり、以前はそれを見ずに「重なる」と数えていた。
   * 浮島町公園・東扇島東公園・川崎マリエン・若洲海浜公園・海ほたるの5か所は、半径1kmに建物が100〜230棟あるのに
   * **OSM に高さの入った建物が1棟も無い**（2026-09-30 確認）。ここだけ種類ごとの目安の高さで数えた
   * （工場・倉庫・事務所など 12m、床面積150m²未満の小屋 4m、そのほか 8m。`study-plane-horizons.mjs`）。
   * 浮島町公園は北〜北西に工場が迫り 8〜9° まで塞がる（羽田の着陸機が通る北東〜東は 1.6° 以下）。
   * 羽田 第2ターミナルは建物が近く、北〜東が 30〜50° まで塞がる（展望デッキの囲いもある）。
   */
  const SPOT_HORIZONS = {
    t1: [0,0,0,0,0,20,20,21,21,22,23,23,24,24,49,50,48,46,44,43,4,0,0,0,0,0,0,0,16,16,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5,8,7,7,1,4,5,5,3,5,1,0,0,0,0,0,58,58,0,217,0],
    t2: [98,102,107,129,324,404,449,476,500,504,508,513,517,521,516,493,471,451,428,356,158,121,118,114,71,62,55,50,45,8,7,0,0,74,91,103,118,137,165,164,159,141,126,114,0,0,0,0,0,0,0,5,9,5,5,3,4,159,5,3,5,1,1,0,0,0,0,33,37,55,64,68],
    t3: [17,0,0,0,0,0,0,0,0,0,0,0,0,0,0,43,58,57,54,51,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,42,48,52,54,56,57,58,58,58,58,57,55,52,50,47,44,40,35,1,3,4,7,5,6,3,1,0,0,0,0,0,0,12,16,17],
    jonanjima: [1,1,0,0,0,0,1,3,3,0,6,6,4,4,1,0,0,0,0,0,0,0,0,0,0,0,0,2,1,0,0,1,1,0,1,2,1,2,2,2,9,16,16,29,29,15,15,14,16,17,3,19,36,38,36,5,8,8,5,6,5,5,13,6,4,0,1,1,1,0,0,0],
    keihinjima: [10,24,24,6,4,4,2,0,2,0,3,0,0,0,0,0,0,0,0,0,0,1,3,4,5,5,4,4,4,4,4,4,3,3,2,2,1,1,1,1,0,0,0,0,5,10,10,4,6,5,15,37,37,8,8,7,10,13,13,21,9,7,3,7,15,2,1,1,16,18,16,10],
    morigasaki: [2,2,0,25,27,28,29,29,30,30,2,2,2,0,0,0,1,1,2,2,2,16,16,11,12,4,16,1,1,1,14,15,24,24,29,29,27,33,33,32,26,14,37,36,35,33,44,26,37,33,24,52,30,35,35,26,53,56,53,45,56,58,55,11,12,10,17,18,18,8,7,8],
    ukishima: [76,79,70,59,51,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,9,9,1,2,5,3,3,3,5,5,0,0,0,0,6,6,5,15,15,15,17,17,17,14,15,15,14,15,12,16,49,52,54,47,69,90,92,92,89,86,92,89,85,82,81,86,81],
    skybridge: [2,2,2,2,2,1,11,11,16,16,16,23,23,23,22,11,11,10,1,0,0,0,0,0,0,0,0,1,1,0,0,0,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,1,27,29,31,32,29,12,14,2,4,8,6,5,4,2,1,1,1,4,4,1,1,2,2],
    daishibashi: [11,0,0,3,5,0,0,44,48,53,56,52,0,0,0,0,0,0,0,52,53,36,33,33,0,1,0,1,0,0,1,9,9,0,0,0,0,0,0,1,2,0,0,1,1,0,1,0,1,3,6,10,10,17,17,2,2,28,28,9,4,4,3,2,1,1,1,2,1,1,1,0],
    rokugobashi: [5,7,5,5,7,8,52,53,26,0,25,24,11,16,24,23,21,20,7,37,36,32,14,23,22,0,0,0,0,71,76,77,80,1,15,15,6,0,0,1,0,2,1,3,2,2,50,49,5,3,3,5,10,33,122,125,125,125,122,10,8,3,2,16,16,2,1,18,5,4,3,5],
    gasbashi: [120,110,109,3,3,3,2,2,1,2,3,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,2,1,0,0,0,0,0,0,0,1,3,1,3,2,6,5,3,2,3,24,4,7,6,7,10,4,3,7,7,9,11,10,5,3,1,1,2,2,5,5,3,3,120],
    higashiogishima: [4,6,7,7,7,7,6,4,33,33,33,33,33,33,6,17,17,33,32,31,29,27,26,12,12,12,9,8,7,7,7,7,7,11,21,22,20,13,14,27,26,24,18,16,13,9,9,6,3,7,8,8,12,29,29,14,15,14,5,6,3,4,1,3,1,1,0,0,0,0,0,0],
    marien: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,1,3,4,3,4,10,7,5,2,4,5,4,4,4,0,1,0,0,0,0,0,0,0,0],
    wakasu: [8,6,6,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,4,2,0,5,5,0,4,6,6,8,9,10,11,11,11,12,12,13,14,15,15,16,17,18,20,20,10,10,10,9,8,8,7,10,10,10,9,9,7,6],
    kasai: [20,22,24,26,28,28,24,25,25,23,10,11,11,10,9,25,27,27,14,0,0,0,0,9,0,0,0,0,0,0,1,0,2,0,0,0,0,2,2,2,2,5,5,5,5,8,8,4,4,4,4,8,1,4,1,5,4,7,4,4,1,1,0,0,0,14,15,15,16,17,18,19],
    sanbanze: [2,2,2,2,1,2,2,1,1,2,2,2,2,1,1,1,62,62,61,61,0,0,0,0,72,73,70,62,0,0,0,0,1,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,4,2,0,0,4,5,3,5,0,0,0,0,0,0,0,1,1,1,1,1,2,1],
    umihotaru: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,2,1,2,2,0,1,1,1,2,3,5,2,2,2,1,1,2,0,0,0,0,0,0,0,0,1,2,0,0,0,0,4,3,7,7,4,2,4,5,5,3,0,0,0,0,0,0,0,0,0,0,0],
    nakanoshima: [0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,1,3,2,4,4,4,3,5,6,6,6,5,5,4,4,3,6,4,3,2,3,1,0,0,0,0,0,0,3,0,0,0,0,1,2,4,5,6,4,6,2,3,4,0,0,0,0,0,0,0,0,0,0],
    futtsu: [0,0,0,0,0,0,0,0,0,0,1,0,0,2,2,3,2,3,3,5,6,8,7,11,5,8,9,6,6,4,5,13,13,13,13,13,13,13,3,3,3,3,3,3,3,1,2,2,2,2,1,3,3,1,4,9,2,8,4,4,6,5,3,0,0,0,0,0,0,0,0,0],
    chibaport: [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,2,2,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0],
    inage: [1,1,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1,1,8,8,8,1,0,0,1,1,1,1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0,1,2,0,0,0,0,0,0,0,0,0,1,1,1,1,1],
  };
  /// その場所から、その方位の地平線の高さ[度]。測っていない場所は 0
  function spotHorizonAt(spotId, azimuthDeg) {
    const h = SPOT_HORIZONS[spotId];
    if (!h) return 0;
    const x = ((azimuthDeg % 360) + 360) % 360 / 5;
    const i = Math.floor(x) % 72, j = (i + 1) % 72, f = x - Math.floor(x);
    return (h[i] * (1 - f) + h[j] * f) / 10;
  }

  /**
   * 1時間あたりの**到着便と出発便**（時刻表の便数）。
   *
   * 2026-09-28 には「年間48.6万回を時間帯へ推定で配った発着回数 × 到着は半分」としていた。
   * 実際の時刻表を見ると、**到着と出発は時間帯でまるで違う**（7時台は到着6便・出発50便、
   * 21時台は到着44便・出発18便）。半分ずつと仮定すると、朝の月丼で到着機を6倍に見積もっていた。
   *
   * 出典: 羽田空港の時刻表（2024年8月の日曜）を時間帯ごとに数えた公開記事
   *   https://mjblog271.com/hndtimetable/ 到着665便・出発664便＝1日1,329回。
   *   国土交通省の年間48.6万回（＝1日約1,330回）と一致する。
   * 時刻表の時刻は駐機場での時刻なので、進入はその5〜10分前。1時間の刻みでは差が出ない。
   * 曜日・季節で数便は動く（2026-09-30 に置き換え）。
   */
  const HOURLY_ARRIVALS = [
    4, 3, 1, 0, 4, 11, 10, 6, 36, 38, 36, 40, 36, 43, 43, 43, 43, 43, 43, 41, 43, 44, 41, 13,
  ];
  const HOURLY_DEPARTURES = [
    7, 7, 5, 0, 0, 2, 30, 50, 49, 50, 49, 42, 39, 34, 34, 37, 43, 45, 40, 40, 30, 18, 9, 4,
  ];
  const HOURLY_MOVEMENTS = HOURLY_ARRIVALS.map((a, i) => a + HOURLY_DEPARTURES[i]);
  const hourIndex = (h) => ((h % 24) + 24) % 24;
  /// その時間の便数。kind を渡せば到着（landing）か出発（takeoff）だけ、無ければ両方
  const trafficAt = (hourJst, kind = null) => kind === "landing" ? HOURLY_ARRIVALS[hourIndex(hourJst)]
    : kind === "takeoff" ? HOURLY_DEPARTURES[hourIndex(hourJst)] : HOURLY_MOVEMENTS[hourIndex(hourJst)];

  // --- 球面の小道具（terrain と同じ式。ここだけで完結させる） ---
  const R_KM = 6371.0088;
  function destination(lat, lon, bearingDeg, distanceKm) {
    const d = distanceKm / R_KM, b = bearingDeg * DEG;
    const la = lat * DEG, lo = lon * DEG;
    const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la),
      Math.cos(d) - Math.sin(la) * Math.sin(la2));
    return { latitude: la2 / DEG, longitude: ((lo2 / DEG + 540) % 360) - 180 };
  }
  function haversineKm(aLat, aLon, bLat, bLon) {
    const dLat = (bLat - aLat) * DEG, dLon = (bLon - aLon) * DEG;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLon / 2) ** 2;
    return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  const AstroNotesRoutes = { RJTT, runwayOf, OPERATIONS, operationFor, operationStatus, SPOTS,
                         approachPath, departurePath, measuredApproachPath, measuredSource, procedureApproachPath, procedureDeparturePath, procedureSource, PROCEDURES, HOURLY_MOVEMENTS, HOURLY_ARRIVALS, HOURLY_DEPARTURES,
                         trafficAt, destination, THRESHOLD_CROSSING_M, SPOT_HORIZONS, spotHorizonAt };
  global.AstroNotesRoutes = AstroNotesRoutes;
  if (typeof module !== "undefined" && module.exports) module.exports = AstroNotesRoutes;
})(typeof globalThis !== "undefined" ? globalThis : this);

/* Legacy global names remain aliases for cached integrations. */
if(typeof AstroNotes!=='undefined')globalThis.Sorami=AstroNotes;if(typeof AstroNotesRoutes!=='undefined')globalThis.SoramiRoutes=AstroNotesRoutes;
