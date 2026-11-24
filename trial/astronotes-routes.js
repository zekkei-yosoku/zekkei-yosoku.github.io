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
    id: "RJTT", name: "羽田空港", shortName: "羽田", latitude: 35.5533, longitude: 139.7811, elevationM: 6,
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
  function approachPath(ident, opts = {}) { return approachFrom(runwayOf(ident), opts); }
  function approachFrom(rw, { fromKm = 2, toKm = 30, stepKm = 0.5, slopeDeg = null } = {}) {
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

  // 空港を中心にした平面（100km以内で距離の誤差0.3%未満）。経路を作る間だけその空港に合わせる
  const KM_PER_DEG = 6371.0088 * DEG;
  let frame = { latitude: RJTT.latitude, longitude: RJTT.longitude, cos: Math.cos(RJTT.latitude * DEG) };
  const setFrame = (c) => { frame = { latitude: c.latitude, longitude: c.longitude, cos: Math.cos(c.latitude * DEG) }; };
  const toXY = (lat, lon) => [(lon - frame.longitude) * frame.cos * KM_PER_DEG, (lat - frame.latitude) * KM_PER_DEG];
  const toLL = (x, y) => ({ latitude: frame.latitude + y / KM_PER_DEG, longitude: frame.longitude + x / (frame.cos * KM_PER_DEG) });
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

  /// 公表の飛行方式による経路を作る関数の組。procs は PROCEDURES と同じ形、center は平面の中心（空港）
  function makeProcedures(procs, runwayOfF, center) {
  /// 到着経路（滑走路から外へ）。無ければ null
  function approach(ident) {
    const m = procs.arrival?.[ident], rw = runwayOfF(ident);
    if (!m || !rw) return null;
    setFrame(center);
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

  /// 出発経路（飛ぶ順）。無ければ null
  function departure(ident, { fromKm = 1 } = {}) {
    const m = procs.departure?.[ident], rw = runwayOfF(ident);
    if (!m || !rw) return null;
    setFrame(center);
    const start = destination(rw.threshold.latitude, rw.threshold.longitude, rw.headingDegT, fromKm);
    // vaFt は海抜（at or above ○FT）。標高の高い空港では滑走路からの高さはその分だけ低い。
    // 最初の通過点より先へは伸ばさない（鹿児島16 は VA 1300ft の手前に FK602 がある）
    const first = m.fixes[0], firstAlong = first ? haversineKm(rw.threshold.latitude, rw.threshold.longitude, first[1], first[2]) * Math.cos((bearingDeg(rw.threshold.latitude, rw.threshold.longitude, first[1], first[2]) - rw.headingDegT) * DEG) : Infinity;
    const vaKm = Math.min(fromKm + Math.max(0.3, (m.vaFt * FT - rw.elevationM) / DEPARTURE_CLIMB / 1000), Math.max(fromKm + 0.3, 0.7 * firstAlong));
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

  const source = (kind, ident) => procs[kind === "takeoff" ? "departure" : "arrival"]?.[ident]?.source ?? null;
  return { approach, departure, source };
  }
  const HANEDA_PROCEDURES = makeProcedures(PROCEDURES, runwayOf, RJTT);
  const procedureApproachPath = (ident) => HANEDA_PROCEDURES.approach(ident);
  const procedureDeparturePath = (ident, opts) => HANEDA_PROCEDURES.departure(ident, opts);
  const procedureSource = (kind, ident) => HANEDA_PROCEDURES.source(kind, ident);
  // 旧名（キャッシュされた呼び出し側のため）
  const measuredApproachPath = (ident) => procedureApproachPath(ident);
  const measuredSource = (ident) => procedureSource("landing", ident);

  /**
   * 出発の経路。滑走路の向きへまっすぐ、上昇率で上がる。
   * **離陸はすぐ旋回する**ので、まっすぐな区間だけを短く持つ。
   */
  function departurePath(ident, opts = {}) { return departureFrom(runwayOf(ident), opts); }
  function departureFrom(rw, { fromKm = 1, toKm = 12, stepKm = 0.5, climbRatio = 0.08 } = {}) {
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
  function bearingDeg(aLat, aLon, bLat, bLon) {
    const y = Math.sin((bLon - aLon) * DEG) * Math.cos(bLat * DEG);
    const x = Math.cos(aLat * DEG) * Math.sin(bLat * DEG) - Math.sin(aLat * DEG) * Math.cos(bLat * DEG) * Math.cos((bLon - aLon) * DEG);
    return (Math.atan2(y, x) / DEG + 360) % 360;
  }
  function haversineKm(aLat, aLon, bLat, bLon) {
    const dLat = (bLat - aLat) * DEG, dLon = (bLon - aLon) * DEG;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLon / 2) ** 2;
    return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /**
   * 国内の空港（AIP Japan AD2.12 の滑走路端。AD2.12 に座標が無い空港・滑走路は OurAirports で補う）。
   * 名前は Wikidata の日本語名。生成: SWIM AIP 20261126発行分。自衛隊・米軍の基地は除く（民間便のある共用飛行場は含む）。
   * [ICAO, 名前, IATA, 緯度, 経度, [[滑走路, 真方位, 端の緯度, 端の経度, 標高m, 移設端の緯度?, 移設端の経度?], …]]
   */
  const AIRPORT_ROWS = [
    ["RJAA","成田国際空港","NRT",35.76528,140.38556,[["16L",149.5,35.8052,140.378108,41.0],["16R",149.5,35.774389,140.368292,39.5],["34L",329.51,35.743322,140.390739,42.5],["34R",329.51,35.785783,140.392144,43.0]]],
    ["RJAF","松本空港","MMJ",36.16667,137.92278,[["18",171.24,36.175658,137.920936,649.8],["36",351.24,36.157858,137.924403,665.1]]],
    ["RJAH","茨城空港","IBR",36.18146,140.41443,[["03R",21.2,36.169601,140.410004,32.0],["21L",201.19,36.192501,140.421005,32.0]]],
    ["RJAN","新島空港","",34.36944,139.26861,[["11",102.32,34.370308,139.264289,27.1],["29",282.32,34.368769,139.272789,28.0]]],
    ["RJAZ","神津島空港","",34.18944,139.13361,[["11",105.11,34.190381,139.1293,133.2],["29",285.11,34.188503,139.137681,143.6]]],
    ["RJBB","関西国際空港","KIX",34.4273,135.244,[["06L",50.72,34.428501,135.206161,7.3],["06R",51.34,34.4174,135.229004,1.8],["24L",231.33,34.437199,135.259003,4.6],["24R",230.71,34.451332,135.240005,9.8]]],
    ["RJBD","南紀白浜空港","SHM",33.66222,135.36444,[["15",140.97,33.669317,135.357736,90.8],["33",320.97,33.655308,135.371317,83.5]]],
    ["RJBE","神戸空港","UKB",34.63278,135.22389,[["09",84.61,34.631642,135.210311,6.5],["27",264.61,34.633758,135.237456,6.3]]],
    ["RJBK","岡南飛行場","",34.59139,133.93333,[["09",85.5,34.590461,133.926789,0.6],["27",265.5,34.591217,133.939839,0.6]]],
    ["RJBT","但馬飛行場","TJH",35.51278,134.78694,[["01",3.0,35.507453,134.78665,177.9],["19",183.0,35.518253,134.787342,174.6]]],
    ["RJCB","帯広空港","OBO",42.73333,143.21722,[["17",159.3,42.744128,143.212031,143.3],["35",339.3,42.723075,143.222822,153.9]]],
    ["RJCC","新千歳空港","CTS",42.77528,141.6925,[["01L",352.62,42.761639,141.692825,18.9],["01R",352.62,42.761986,141.696458,17.5],["19L",172.62,42.788767,141.691744,23.5],["19R",172.62,42.788433,141.688106,25.0]]],
    ["RJCH","函館空港","HKD",41.77,140.82194,[["12",107.98,41.774339,140.804892,28.1],["30",287.98,41.765983,140.839167,46.0]]],
    ["RJCK","釧路空港","KUH",43.04083,144.19306,[["17",158.96,43.051472,144.187478,98.3],["35",338.96,43.030467,144.198494,88.4]]],
    ["RJCM","女満別空港","MMB",43.88056,144.16417,[["18",174.66,43.891808,144.162606,31.1],["36",354.66,43.869403,144.1655,41.2]]],
    ["RJCN","中標津空港","SHB",43.5775,144.96,[["08",71.02,43.5745,144.948083,71.1],["26",251.02,43.580353,144.9715,64.6]]],
    ["RJCO","札幌丘珠空港","OKD",43.1175,141.38139,[["14",134.85,43.122186,141.374753,6.1],["32",314.85,43.112661,141.387822,8.2]]],
    ["RJCR","礼文空港","RBJ",45.455,141.03917,[["14",132.33,45.457417,141.035622,29.9],["32",312.33,45.452569,141.043183,24.1]]],
    ["RJCW","稚内空港","WKJ",45.40444,141.80222,[["08",68.9,45.400872,141.789008,7.2],["26",248.9,45.407992,141.815217,9.4]]],
    ["RJDA","天草飛行場","AXJ",32.48222,130.15889,[["13",124.55,32.485058,130.154486,100.6],["31",304.55,32.479944,130.16325,100.6]]],
    ["RJDB","壱岐空港","IKI",33.74917,129.78583,[["02",9.36,33.743697,129.784639,7.0],["20",189.36,33.754372,129.786747,15.8]]],
    ["RJDC","山口宇部空港","UBJ",33.93,131.27861,[["07",62.27,33.924669,131.266797,7.1],["25",242.27,33.935156,131.290733,6.6]]],
    ["RJDK","上五島空港","",33.01361,129.1925,[["17",167.81,33.017122,129.191486,76.5],["35",347.81,33.010072,129.193292,84.4]]],
    ["RJDO","小値賀空港","",33.19083,129.09028,[["03",20.32,33.187467,129.088869,11.9],["21",200.32,33.194231,129.09185,4.0]]],
    ["RJDT","対馬空港","TSJ",34.285,129.33056,[["14",136.04,34.291053,129.323386,62.5],["32",316.04,34.278725,129.337714,55.5]]],
    ["RJEB","紋別空港","MBE",44.30417,143.40417,[["14",131.93,44.309925,143.394703,24.4],["32",311.93,44.2979,143.41335,21.9]]],
    ["RJEC","旭川空港","AKJ",43.67083,142.4475,[["16",154.17,43.680844,142.440822,201.2],["34",334.17,43.660589,142.454331,219.8]]],
    ["RJEO","奥尻空港","OIR",42.07167,139.43278,[["13",120.15,42.074969,139.425197,54.9],["31",300.15,42.068183,139.440869,43.0]]],
    ["RJER","利尻空港","RIS",45.24194,141.1875,[["07",56.68,45.237598,141.177994,29.9],["25",237.04,45.246411,141.197225,34.1]]],
    ["RJFC","屋久島空港","KUM",30.38556,130.65917,[["14",133.87,30.390261,130.653575,34.1],["32",313.87,30.380889,130.664833,37.8]]],
    ["RJFE","福江空港","FUJ",32.66639,128.83278,[["03",25.75,32.65815,128.828178,68.0],["21",205.75,32.674392,128.837442,83.2]]],
    ["RJFF","福岡空港","FUK",33.58444,130.45167,[["16L",150.24,33.596919,130.443186,4.6],["16R",150.24,33.595969,130.441219,4.6],["34L",330.24,33.576403,130.454589,9.9],["34R",330.24,33.574967,130.458186,9.8]]],
    ["RJFG","種子島空港","TNE",30.605,130.99167,[["13",122.91,30.609981,130.982828,237.1],["31",302.91,30.600181,131.000342,231.0]]],
    ["RJFK","鹿児島空港","KOJ",31.80333,130.71944,[["16",150.0,31.815114,130.711483,276.1],["34",330.0,31.791686,130.727328,261.8]]],
    ["RJFM","宮崎空港","KMI",31.87722,131.44861,[["09",85.18,31.876183,131.435283,4.6],["27",265.18,31.878072,131.461611,6.3]]],
    ["RJFO","大分空港","OIT",33.47944,131.73722,[["01",0.0,33.465981,131.737006,5.8],["19",180.0,33.493025,131.737244,5.2]]],
    ["RJFR","北九州空港","KKJ",33.84556,131.035,[["18",170.35,33.856644,131.032731,6.7],["36",350.35,33.834467,131.037269,7.0]]],
    ["RJFS","佐賀空港","HSG",33.14972,130.30222,[["11",99.25,33.151167,130.291642,1.8],["29",279.25,33.148269,130.3128,1.8]]],
    ["RJFT","熊本空港","KMJ",32.83722,130.85528,[["07",64.54,32.831501,130.841003,183.2],["25",244.58,32.843122,130.869522,195.7]]],
    ["RJFU","長崎空港","NGS",32.91694,129.91361,[["14",138.0,32.927022,129.902714,4.3],["32",318.0,32.906919,129.924178,4.6]]],
    ["RJGG","中部国際空港","NGO",34.85833,136.80528,[["18",169.0,34.873892,136.801675,4.6],["36",349.0,34.842942,136.809114,4.6]]],
    ["RJKA","奄美空港","ASJ",28.43083,129.7125,[["03",25.75,28.42255,129.708086,8.2],["21",205.75,28.438781,129.717017,4.3]]],
    ["RJKB","沖永良部空港","OKE",27.43167,128.70556,[["04",34.58,27.4258,128.701004,30.2],["22",214.15,27.436661,128.709372,30.2]]],
    ["RJKI","喜界空港","KKX",28.3213,129.92799,[["07",65.1,28.318399,129.921005,6.4,28.318613,129.921528],["25",245.1,28.323299,129.932999,5.5,28.323086,129.932476]]],
    ["RJKN","徳之島空港","TKN",27.83638,128.88136,[["01",5.61,27.8274,128.880005,5.2],["19",185.61,27.8454,128.882004,4.3]]],
    ["RJNA","県営名古屋空港","NKM",35.255,136.92444,[["16",152.42,35.266433,136.917414,15.8],["34",332.42,35.244544,136.93135,15.2]]],
    ["RJNF","福井空港","FKJ",36.14278,136.22389,[["18",175.75,36.148242,136.223447,5.2],["36",355.75,36.137456,136.2244,5.8]]],
    ["RJNK","小松飛行場","KMQ",36.39389,136.4075,[["06",55.0,36.386925,136.395147,11.6],["24",235.0,36.400853,136.419856,5.6]]],
    ["RJNO","隠岐空港","OKI",36.17833,133.32333,[["08",67.89,36.175011,133.313242,77.1],["26",247.89,36.181797,133.333839,82.9]]],
    ["RJNS","静岡空港","FSZ",34.79611,138.18944,[["12",112.0,34.800203,138.176811,138.4],["30",292.0,34.791761,138.202139,125.8]]],
    ["RJNT","富山空港","TOY",36.64833,137.1875,[["02",13.59,36.639664,137.184786,29.0],["20",193.59,36.657183,137.190039,19.2]]],
    ["RJNW","能登空港","NTQ",37.29333,136.96222,[["07",66.77,37.2897,136.951772,216.4],["25",246.77,37.296811,136.9725,214.0]]],
    ["RJOA","広島空港","HIJ",34.43611,132.91944,[["10",90.0,34.436025,132.903125,326.7],["28",270.0,34.436025,132.935764,325.3]]],
    ["RJOB","岡山空港","OKJ",34.75694,133.85528,[["07",59.23,34.750019,133.841358,245.7],["25",239.23,34.763856,133.869511,245.1]]],
    ["RJOC","出雲空港","IZO",35.4136,132.89,[["07",59.28,35.4091,132.880005,1.8],["25",239.28,35.418301,132.899002,4.6]]],
    ["RJOH","米子空港","YGJ",35.4922,133.23599,[["07",64.13,35.487499,133.225998,3.0],["25",244.12,35.495399,133.246002,6.1]]],
    ["RJOI","岩国錦帯橋空港","IWK",34.145,132.24694,[["02",9.2,34.13406,132.244868,3.2],["20",189.2,34.155777,132.249082,3.1]]],
    ["RJOK","高知空港","KCZ",33.54611,133.66944,[["14",130.51,33.553344,133.659161,12.8],["32",310.51,33.538703,133.679631,5.4]]],
    ["RJOM","松山空港","MYJ",33.82722,132.69972,[["14",130.55,33.834583,132.689369,7.6],["32",310.55,33.819931,132.709892,5.2]]],
    ["RJOO","大阪国際空港","ITM",34.78444,135.43917,[["14L",135.0,34.795269,135.428686,15.2],["14R",135.0,34.791325,135.428706,14.0],["32L",315.0,34.7722,135.451878,9.5],["32R",315.0,34.783617,135.442808,10.4]]],
    ["RJOR","鳥取空港","TTJ",35.53,134.165,[["10",93.78,35.530644,134.154047,8.8],["28",273.78,35.529453,134.176053,19.7]]],
    ["RJOS","徳島阿波おどり空港","TKS",34.13222,134.60917,[["11",102.53,34.134717,134.596039,0],["29",282.53,34.129822,134.622492,0]]],
    ["RJOT","高松空港","TAK",34.21417,134.01556,[["08",72.9,34.210739,134.002808,177.7],["26",252.9,34.217367,134.028736,178.7]]],
    ["RJOW","石見空港","IWJ",34.67639,131.79028,[["11",104.78,34.678689,131.779753,56.0],["29",284.78,34.674089,131.800853,52.0]]],
    ["RJOY","八尾空港","",34.59667,135.60056,[["09",86.72,34.5956,135.589005,11.0],["13",127.34,34.599667,135.597472,11.6],["27",266.65,34.596389,135.605594,11.6],["31",307.34,34.594444,135.60575,11.6]]],
    ["RJSA","青森空港","AOJ",40.73333,140.68861,[["06",51.91,40.724936,140.674614,197.2],["24",231.91,40.741608,140.702575,202.4]]],
    ["RJSC","山形空港","GAJ",38.41194,140.37111,[["01",6.57,38.402947,140.370017,105.7],["19",186.57,38.420844,140.372644,107.6]]],
    ["RJSD","佐渡空港","SDS",38.06056,138.415,[["10",97.33,38.060933,138.410058,29.6],["28",277.33,38.059919,138.420119,16.2]]],
    ["RJSF","福島空港","FKS",37.2275,140.42806,[["01",2.2,37.216175,140.427433,365.8],["19",182.2,37.238683,140.428514,368.5]]],
    ["RJSI","花巻空港","HNA",39.42861,141.13528,[["02",10.73,39.417661,141.132672,86.3],["20",190.73,39.439789,141.138086,90.7]]],
    ["RJSK","秋田空港","AXT",39.61556,140.21861,[["10",96.61,39.616939,140.204206,87.9],["28",276.61,39.61435,140.233125,95.6]]],
    ["RJSM","三沢空港","MSJ",40.7032,141.368,[["10",95.03,40.704399,141.350006,34.7],["28",275.03,40.702,141.386002,28.7]]],
    ["RJSN","新潟空港","KIJ",37.95583,139.11167,[["04",31.91,37.948258,139.114672,6.9],["10",92.69,37.956864,139.094939,8.3],["22",211.91,37.958322,139.122586,1.8],["28",272.69,37.955808,139.123358,3.1]]],
    ["RJSR","大館能代空港","ONJ",40.19194,140.37167,[["11",100.3,40.193436,140.359864,79.0],["29",280.3,40.190306,140.382994,89.0]]],
    ["RJSS","仙台空港","SDJ",38.13972,140.91694,[["09",82.55,38.138802,140.899002,3.4],["12",117.7,38.139458,140.914747,3.5],["27",262.56,38.142272,140.932656,3.5],["30",297.7,38.134433,140.926867,3.5]]],
    ["RJSY","庄内空港","SYO",38.81222,139.78722,[["09",79.45,38.810717,139.775867,18.0],["27",259.45,38.814017,139.798503,26.2]]],
    ["RJTF","調布飛行場","",35.67167,139.52806,[["17",163.2,35.674994,139.52665,42.7],["35",343.2,35.668092,139.529203,41.8]]],
    ["RJTH","八丈島空港","HAC",33.115,139.78583,[["08",69.56,33.111953,139.775853,86.0],["26",249.56,33.118256,139.795933,86.6]]],
    ["RJTO","大島空港","OIM",34.78194,139.36028,[["03",20.15,34.774444,139.356908,42.1],["21",200.15,34.789678,139.363681,35.7]]],
    ["RJTQ","三宅島空港","MYE",34.07361,139.56028,[["02",16.88,34.066933,139.557947,20.4],["20",196.88,34.077286,139.561722,18.6]]],
    ["RJTT","東京国際空港","HND",35.55333,139.78111,[["04",35.01,35.549019,139.761278,6.2],["05",42.56,35.524003,139.803464,6.2],["16L",149.88,35.565897,139.786553,6.2,35.562853,139.788706],["16R",149.88,35.559986,139.769067,6.2,35.556242,139.771719],["22",215.01,35.567467,139.777114,6.2],["23",222.56,35.540597,139.822114,6.2],["34L",329.88,35.5366,139.785669,6.2],["34R",329.88,35.539694,139.805136,6.2,35.542506,139.80315]]],
    ["ROAH","那覇空港","OKA",26.19333,127.63972,[["18L",177.3,26.209342,127.645233,3.3],["18R",177.3,26.203056,127.6324,5.0],["36L",357.3,26.178706,127.633547,4.3],["36R",357.3,26.182289,127.646503,2.7]]],
    ["ROIG","石垣空港","ISG",24.39639,124.245,[["04",35.87,24.389142,124.239344,38.4],["22",215.87,24.403775,124.2509,33.5]]],
    ["ROKJ","久米島空港","UEO",26.36361,126.71389,[["03",21.17,26.355089,126.710186,6.6],["21",201.17,26.371922,126.717425,5.7]]],
    ["ROKR","慶良間空港","KJP",26.16833,127.29333,[["02",15.44,26.164867,127.292361,46.2],["20",195.44,26.171817,127.294531,48.8]]],
    ["ROMD","南大東空港","MMD",25.84667,131.26361,[["02",15.66,25.839983,131.261461,50.9],["20",195.66,25.853019,131.2655,45.4]]],
    ["ROMY","宮古空港","MMY",24.78278,125.295,[["04",38.31,24.775736,125.289003,37.8],["22",218.31,24.789906,125.301267,45.7]]],
    ["RORA","粟国空港","AGJ",26.59278,127.24028,[["01",4.88,26.589169,127.240006,13.4],["19",184.88,26.596364,127.240689,7.9]]],
    ["RORE","伊江島空港","IEJ",26.7225,127.78694,[["04",38.87,26.717278,127.782056,64.9],["22",218.87,26.727778,127.791528,75.0]]],
    ["RORK","北大東空港","KTD",25.94472,131.32694,[["03",25.5,25.938572,131.323525,22.6],["21",205.5,25.950792,131.329969,24.4]]],
    ["RORS","下地島空港","SHI",24.82667,125.14472,[["17",165.5,24.840044,125.141353,4.6],["35",345.5,24.813764,125.148539,16.6]]],
    ["RORT","多良間空港","TRA",24.65389,124.67528,[["18",172.78,24.660525,124.674539,10.4],["36",352.78,24.647092,124.6764,11.0]]],
    ["RORY","与論空港","RNJ",27.04389,128.40167,[["14",138.03,27.047911,128.397622,10.8],["32",318.03,27.039858,128.405708,15.9]]],
    ["ROYN","与那国空港","OGN",24.4675,122.97972,[["08",75.27,24.465103,122.970239,21.9],["26",255.27,24.469692,122.989317,12.7]]],
  ];
  /**
   * 羽田以外の公表の飛行方式（自動読み取り）。到着は RNP 進入図の IAF→IF→FAF、出発は RNAV SID の符号表。
   * 形は PROCEDURES と同じ。読み取れなかった滑走路は直線の概算のまま。
   */
  const AIRPORT_PROCEDURES = {
    RJAA: {"arrival":{"16L":{"glideDeg":3.0,"faf":[35.87692,140.32619],"source":"AIP RJAA IAC RNP RWY16L","fixes":[["AMITY",35.97174,140.25737],["NORMA",35.98356,140.54833]]},"16R":{"glideDeg":3.0,"faf":[35.88977,140.28474],"source":"AIP RJAA IAC ILS Y or LOC RWY16R(CAT II & III)","fixes":[["NORMA",35.98356,140.54833]]},"34L":{"glideDeg":3.0,"faf":[35.57671,140.51077],"source":"AIP RJAA IAC ILS RWY34L","fixes":[["GIINA",35.52478,140.75761],["TYLER",35.44736,140.6355]]},"34R":{"glideDeg":3.0,"faf":[35.66215,140.48139],"source":"AIP RJAA IAC RNP RWY34R","fixes":[["TEMIS",35.53381,140.57356],["TYLER",35.44736,140.6355]]}},"departure":{"16R":{"vaFt":600,"source":"AIP RJAA SID TETRA-RNAV（RWY16R）","fixes":[["ASPEN",35.58083,140.50781],["A6R11",35.51581,140.5545],["A6R13",35.44858,140.41461],["A6R14",35.55686,140.33664],["TETRA",35.77399,140.26549]]},"34L":{"vaFt":600,"source":"AIP RJAA SID BORLO-RNAV（RWY34L）","fixes":[["ARIES",35.93539,140.25164,4000],["A4L11",35.98767,140.21364],["A4L12",36.04239,140.27967],["A4L13",36.04353,140.43325],["A4L14",35.99383,140.53472]]}}},
    RJAF: {"arrival":{"18":{"glideDeg":3.0,"faf":[36.29716,137.90596],"source":"AIP RJAF IAC RNP Z RWY18(AR)","fixes":[["RIPSI",35.89454,137.69261]]},"36":{"glideDeg":3.0,"faf":[35.98366,138.01683],"source":"AIP RJAF IAC RNP Z RWY36(AR)","fixes":[["RIPSI",35.89454,137.69261]]}},"departure":{"36":{"vaFt":2600,"source":"AIP RJAF SID NIIGATA  MATSUMOTO- RNAV（RWY36）","fixes":[["AF600",36.34289,137.91367],["MBE",36.15597,137.91982,10000]]}}},
    RJAH: {"arrival":{"03R":{"glideDeg":3.0,"faf":[36.09864,140.37882],"source":"AIP RJAH IAC ILS X RWY03R","fixes":[["NAKAH",36.43608,140.38078]]},"21L":{"glideDeg":3.0,"faf":[36.27639,140.47011],"source":"AIP RJAH IAC TACAN RWY21L","fixes":[]}}},
    RJAN: {"arrival":{"29":{"glideDeg":3.0,"faf":[34.38529,139.39576],"source":"AIP RJAN IAC RNP RWY29","fixes":[["AN950",34.40643,139.49318],["WAVES",34.57001,139.35809]]}}},
    RJBB: {"arrival":{"06L":{"glideDeg":3.0,"faf":[34.38815,135.14606],"source":"AIP RJBB IAC ILS Z or LOC Z RWY06L (CAT II)","fixes":[["MIBIB",34.33123,135.06154],["BERRY",34.25056,134.94211]]},"06R":{"glideDeg":3.0,"faf":[34.29131,135.04199],"source":"AIP RJBB IAC ILS X or LOC X RWY06R (CAT II)","fixes":[["GATES",34.60658,135.20306]]},"24L":{"glideDeg":3.0,"faf":[34.47425,135.31409],"source":"AIP RJBB IAC ILS Z or LOC Z RWY24L (CAT II","fixes":[["AMBER",34.49506,135.34519],["MAYAH",34.60659,135.20306]]},"24R":{"glideDeg":3.0,"faf":[34.50174,135.31533],"source":"AIP RJBB IAC RNP RWY24R","fixes":[["OPARU",34.53376,135.36319],["MAYAH",34.60659,135.20306]]}},"departure":{"06R":{"vaFt":500,"source":"AIP RJBB SID LINDA - RNAV（RWY06R）","fixes":[["B6R10",34.46656,135.29611],["B6R11",34.528,135.31253,2500],["B6R12",34.57139,135.14808],["IDLAK",34.50172,134.99806,5000],["LINDA",34.50439,134.86114]]},"06L":{"vaFt":500,"source":"AIP RJBB SID NANKO - RNAV（RWY06L）","fixes":[["B6L01",34.54956,135.28558],["NANKO",34.61075,135.35583,5000]]},"24R":{"vaFt":500,"source":"AIP RJBB SID OBLUR - RNAV（RWY24R）","fixes":[["LELUS",34.41017,135.05258],["ELMUL",34.40278,134.91225,5000],["EPKUR",34.28358,134.66222],["SURIF",34.24072,134.60047]]},"24L":{"vaFt":500,"source":"AIP RJBB SID RINKU  IWAYA - RNAV（RWY24L）","fixes":[["B4L10",34.36025,135.12625],["LELUS",34.41017,135.05258],["BB400",34.50064,135.08542],["PUNIB",34.59439,135.0605,5000],["MAIKO",34.61103,134.99697]]}}},
    RJBD: {"arrival":{"15":{"glideDeg":3.0,"faf":[33.72037,135.30618],"source":"AIP RJBD IAC RJBD__IAC  (LOC RWY15)_20260709.txt","fixes":[]},"33":{"glideDeg":3.0,"faf":[33.57037,135.48272],"source":"AIP RJBD IAC RJBD__IAC  (RNP Z RWY33 (AR))_20261126.txt","fixes":[]}},"departure":{"33":{"vaFt":800,"source":"AIP RJBD SID RJBD__SID - Instrument (KUSHIMOTO-RNAV)_20250515.txt（RWY33）","fixes":[["BD300",33.59583,135.27344],["BD301",33.55689,135.41142,5000],["KEC",33.44775,135.7945]]}}},
    RJBE: {"arrival":{"09":{"glideDeg":3.0,"faf":[34.61811,135.0386],"source":"AIP RJBE IAC RNP RWY09","fixes":[["SIOJI",34.61257,134.9691]]}},"departure":{"09":{"vaFt":500,"source":"AIP RJBE SID MUKRI（RWY09）","fixes":[["TARUP",34.57322,135.10736],["LEMET",34.55825,135.06117,3000],["MUKRI",34.56264,134.90533]]},"27":{"vaFt":500,"source":"AIP RJBE SID MUKRI（RWY27）","fixes":[["TARUP",34.57322,135.10736],["LEMET",34.55825,135.06117,3000],["MUKRI",34.56264,134.90533]]}}},
    RJBT: {"arrival":{"01":{"glideDeg":3.0,"faf":[35.41409,134.77932],"source":"AIP RJBT IAC LOC RWY01","fixes":[["TAKDA",35.26911,134.76753],["ASAGI",35.04367,134.75067]]}}},
    RJCB: {"arrival":{"35":{"glideDeg":3.0,"faf":[42.64388,143.26335],"source":"AIP RJCB IAC ILS Z or LOC Z RWY35","fixes":[["TAIKI",42.45175,143.35784]]}}},
    RJCC: {"arrival":{"01L":{"glideDeg":3.0,"faf":[42.66538,141.70975],"source":"AIP RJCC IAC ILS Z or LOC RWY01L","fixes":[["GUVOX",42.51633,141.73575]]},"01R":{"glideDeg":3.0,"faf":[42.61556,141.72216],"source":"AIP RJCC IAC ILS Y RWY01R","fixes":[["YOTEI",42.51667,141.73931]]},"19L":{"glideDeg":3.0,"faf":[42.88431,141.67489],"source":"AIP RJCC IAC ILS Z or LOC Z RWY19L","fixes":[["KAORY",43.05064,141.73519]]},"19R":{"glideDeg":3.0,"faf":[42.93365,141.66246],"source":"AIP RJCC IAC ILS Y RWY19R (CAT II & III)","fixes":[["NACKS",43.00019,141.65069]]}},"departure":{"01L":{"vaFt":500,"source":"AIP RJCC SID RJCC__SID (RNAV)_20260611.txt（RWY01L）","fixes":[["CC01N",42.84664,141.68156],["CC02N",42.87994,141.7335],["CC03N",42.94539,141.75078,3000],["CC01H",43.00853,141.76747],["KURIS",43.15522,141.706]]},"01R":{"vaFt":500,"source":"AIP RJCC SID RJCC__SID (RNAV)_20260611.txt（RWY01R）","fixes":[["CC01T",42.86203,141.69628],["CC02T",42.87211,141.80269],["CC03T",42.80544,141.81431,3000],["CHE",42.69992,141.68617],["REZOT",42.56636,141.2725]]},"19R":{"vaFt":500,"source":"AIP RJCC SID RJCC__SID (RNAV)_20260611.txt（RWY19R）","fixes":[["CC01Y",42.68719,141.70992],["CC02Y",42.65092,141.77753,3000],["CC02H",42.66656,141.84661],["CC03H",42.76222,141.87003,5000],["KURIS",43.15522,141.706]]},"19L":{"vaFt":500,"source":"AIP RJCC SID RJCC__SID (RNAV)_20260611.txt（RWY19L）","fixes":[["CC01Y",42.68719,141.70992],["CC02Y",42.65092,141.77753,3000],["CC02H",42.66656,141.84661],["CC03H",42.76222,141.87003,5000],["KURIS",43.15522,141.706]]}}},
    RJCH: {"arrival":{"12":{"glideDeg":3.0,"faf":[41.82048,140.61472],"source":"AIP RJCH IAC RNP Z RWY12","fixes":[["PATRA",41.84475,140.51303],["ESASI",41.91341,140.19012]]}},"departure":{"12":{"vaFt":600,"source":"AIP RJCH SID RJCH__SID (TOI-RNAV)_20250220.txt（RWY12）","fixes":[["TIKYU",41.68403,141.17264,6000]]},"30":{"vaFt":500,"source":"AIP RJCH SID RJCH__SID (TOI-RNAV)_20250220.txt（RWY30）","fixes":[["TIKYU",41.68403,141.17264,6000]]}}},
    RJCK: {"arrival":{"17":{"glideDeg":3.0,"faf":[43.13075,144.14583],"source":"AIP RJCK IAC RNP X RWY17","fixes":[["ONAGA",43.23692,144.08986],["KANPO",43.13408,143.93717]]},"35":{"glideDeg":3.0,"faf":[42.9542,144.23843],"source":"AIP RJCK IAC RNP RWY35","fixes":[["NOKKA",42.87697,144.27875],["CRANE",42.82133,144.14628]]}},"departure":{"17":{"vaFt":700,"source":"AIP RJCK SID ENTOD - RNAV（RWY17）","fixes":[["MULNA",42.88103,144.27667],["ENTOD",42.53061,144.34842,10000]]},"35":{"vaFt":900,"source":"AIP RJCK SID ENTOD - RNAV（RWY35）","fixes":[["TASAB",43.00433,144.08564],["MUBLA",42.91469,144.13272,4600],["ENTOD",42.53061,144.34842,10000]]}}},
    RJCM: {"arrival":{"18":{"glideDeg":3.0,"faf":[43.97119,144.15233],"source":"AIP RJCM IAC ILS X RWY18","fixes":[["CM853",43.99162,144.03349],["GINGA",43.62743,143.95304]]},"36":{"glideDeg":3.0,"faf":[43.83622,144.16978],"source":"AIP RJCM IAC RNP RWY36","fixes":[["GINGA",43.62743,143.95304]]}},"departure":{"36":{"vaFt":1000,"source":"AIP RJCM SID RJCM__SID(NULKI-RNAV)_20250417.txt（RWY36）","fixes":[["AKNEP",43.81642,143.98511],["NULKI",43.55044,143.88714,7000]]},"18":{"vaFt":600,"source":"AIP RJCM SID RJCM__SID(NULKI-RNAV)_20250417.txt（RWY18）","fixes":[["BISAK",43.80247,144.17414],["NULKI",43.55044,143.88714,7000]]}}},
    RJCN: {"arrival":{"26":{"glideDeg":3.0,"faf":[43.598,145.04226],"source":"AIP RJCN IAC RNP W RWY26(LPV only)","fixes":[["CN661",43.52627,145.10724],["MASHU",43.47088,144.53736]]}},"departure":{"08":{"vaFt":700,"source":"AIP RJCN SID NOKIK-RNAV（RWY08）","fixes":[["MAMIL",43.49336,144.78478],["NOKIK",43.44517,144.59433,5000]]},"26":{"vaFt":700,"source":"AIP RJCN SID NOKIK-RNAV（RWY26）","fixes":[["MAMIL",43.49336,144.78478],["NOKIK",43.44517,144.59433,5000]]}}},
    RJCO: {"arrival":{"14":{"glideDeg":3.0,"faf":[43.18236,141.29204],"source":"AIP RJCO IAC RNP RWY14","fixes":[["OLSUT",43.28842,141.14567],["PEXOV",43.51309,141.28401]]}},"departure":{"14":{"vaFt":500,"source":"AIP RJCO SID TOBET EAST  NORTH-RNAV（RWY14）","fixes":[["TOBET",43.24364,141.54964],["KURIS",43.15522,141.706,5000]]},"32":{"vaFt":2000,"source":"AIP RJCO SID BANKE  ADBEB-RNAV（RWY32）","fixes":[["BANKE",43.04961,141.25994],["MOIWA",42.932,141.22017,8000],["ADBEB",42.85881,141.09353,11000]]}}},
    RJCW: {"arrival":{"08":{"glideDeg":3.0,"faf":[45.36518,141.65809],"source":"AIP RJCW IAC ILS or LOC RWY08","fixes":[]},"26":{"glideDeg":3.5,"faf":[45.42975,141.91964],"source":"AIP RJCW IAC VOR RWY26","fixes":[]}},"departure":{"08":{"vaFt":900,"source":"AIP RJCW SID RJCW__SID (YOROI-RNAV)_20240418.txt（RWY08）","fixes":[["WAPPY",45.11486,141.79089],["YOROI",45.00864,141.78558,9000]]},"26":{"vaFt":700,"source":"AIP RJCW SID RJCW__SID (YOROI-RNAV)_20240418.txt（RWY26）","fixes":[["WAPPY",45.11486,141.79089],["YOROI",45.00864,141.78558,9000]]}}},
    RJDA: {"departure":{"13":{"vaFt":800,"source":"AIP RJDA SID HABOH - RNAV（RWY13）","fixes":[["HABOH",32.58931,130.36469],["FUGEN",32.65542,130.49042]]},"31":{"vaFt":1400,"source":"AIP RJDA SID HABOH - RNAV（RWY31）","fixes":[["HABOH",32.58931,130.36469],["FUGEN",32.65542,130.49042]]}}},
    RJDB: {"arrival":{"02":{"glideDeg":3.0,"faf":[33.6698,129.77006],"source":"AIP RJDB IAC RJDB__IAC(RNP RWY02)_20230615.txt","fixes":[["MAPNI",33.61214,129.75869]]},"20":{"glideDeg":3.0,"faf":[33.82676,129.80106],"source":"AIP RJDB IAC RJDB__IAC(RNP RWY20)_20230615.txt","fixes":[["ASESU",33.88441,129.81248]]}},"departure":{"02":{"vaFt":600,"source":"AIP RJDB SID RJDB__SID- Instrument(AKNAG-RNAV)_20240321.txt（RWY02）","fixes":[["DB200",33.70322,129.85122],["AKNAG",33.33806,129.84578,7000]]}}},
    RJDC: {"arrival":{"07":{"glideDeg":3.0,"faf":[33.89753,131.20493],"source":"AIP RJDC IAC ILS Y RWY07","fixes":[["KATTA",34.00362,131.6869]]}}},
    RJDT: {"arrival":{"14":{"glideDeg":3.0,"faf":[34.3305,129.27749],"source":"AIP RJDT IAC RNP RWY14","fixes":[["SARUI",34.38599,129.21284]]},"32":{"glideDeg":3.0,"faf":[34.24216,129.38018],"source":"AIP RJDT IAC RNP RWY32","fixes":[["DT250",34.20606,129.42204],["AGATA",34.17317,129.46328]]}},"departure":{"32":{"vaFt":900,"source":"AIP RJDT SID FRAIZ-RNAV（RWY32）","fixes":[["DT200",34.35408,129.42253],["FRAIZ",33.96358,129.61864,6000]]}}},
    RJEB: {"arrival":{"32":{"glideDeg":3.0,"faf":[44.21646,143.53932],"source":"AIP RJEB IAC ILS or LOC RWY32","fixes":[]}}},
    RJEC: {"arrival":{"16":{"glideDeg":3.0,"faf":[43.72751,142.40966],"source":"AIP RJEC IAC RNP Z RWY16","fixes":[["PIPPU",43.88221,142.39524],["OSOBA",43.87468,142.24321]]}}},
    RJEO: {"departure":{"13":{"vaFt":600,"source":"AIP RJEO SID RJEO__SID- Instrument  (AONAE-RNAV)_20260319.txt（RWY13）","fixes":[["AONAE",42.00633,139.746],["ESASI",41.91342,140.19014]]},"31":{"vaFt":600,"source":"AIP RJEO SID RJEO__SID- Instrument  (AONAE-RNAV)_20260319.txt（RWY31）","fixes":[["EO100",41.98175,139.36517],["AONAE",42.00633,139.746],["ESASI",41.91342,140.19014]]}}},
    RJER: {"arrival":{"07":{"glideDeg":3.0,"faf":[45.19903,141.09399],"source":"AIP RJER IAC RNP Y RWY07 (LPV only)","fixes":[["ER777",45.26269,141.01746]]},"25":{"glideDeg":3.0,"faf":[45.29873,141.31166],"source":"AIP RJER IAC LOC RWY25","fixes":[["ENRIT",45.35141,141.42737],["LEDAX",45.09521,141.56836]]}},"departure":{"07":{"vaFt":600,"source":"AIP RJER SID LEDAX-RNAV（RWY07）","fixes":[["ER700",45.33978,141.40178],["ER701",45.22767,141.50408],["LEDAX",45.09521,141.56836,8000]]},"25":{"vaFt":600,"source":"AIP RJER SID UBKUX-RNAV（RWY25）","fixes":[["ER501",45.21644,141.132],["UBKUX",44.96381,141.20297,6000]]}}},
    RJFC: {"arrival":{"14":{"glideDeg":3.0,"faf":[30.4498,130.58199],"source":"AIP RJFC IAC RNP RWY14","fixes":[["PANRI",30.50761,130.51237],["ONSKE",30.62304,130.64807]]},"32":{"glideDeg":3.0,"faf":[30.33266,130.72271],"source":"AIP RJFC IAC RNP RWY32","fixes":[["NOLIM",30.28169,130.78377],["TGE",30.60216,130.99153]]}},"departure":{"32":{"vaFt":520,"source":"AIP RJFC SID SURF-RNAV（RWY32）","fixes":[["TGE",30.60216,130.99153]]}}},
    RJFE: {"arrival":{"03":{"glideDeg":3.0,"faf":[32.57858,128.79927],"source":"AIP RJFE IAC VOR RWY03","fixes":[]}}},
    RJFF: {"arrival":{"16L":{"glideDeg":3.0,"faf":[33.68321,130.38414],"source":"AIP RJFF IAC RNP RWY16L","fixes":[["AKTIB",33.75578,130.33498],["ENTIX",33.7993,130.30526]]},"16R":{"glideDeg":3.0,"faf":[33.68226,130.38217],"source":"AIP RJFF IAC RNP RWY16R","fixes":[["OKINO",33.81235,130.45477]]},"34R":{"glideDeg":3.0,"faf":[33.40241,130.57579],"source":"AIP RJFF IAC RNP RWY34R","fixes":[["ADPAR",33.33,130.62499],["KIGUS",33.28768,130.53663]]}},"departure":{"34R":{"vaFt":500,"source":"AIP RJFF SID KURUME-RNAV（RWY34R）","fixes":[["FF401",33.65872,130.40092],["FF402",33.70342,130.49436],["FF403",33.641,130.537],["YURRY",33.43947,130.63828],["YAMEK",33.35163,130.59431]]},"34L":{"vaFt":500,"source":"AIP RJFF SID KURUME-RNAV（RWY34L）","fixes":[["F4L01",33.65778,130.39894],["FF402",33.70342,130.49436],["FF403",33.641,130.537],["YURRY",33.43947,130.63828],["YAMEK",33.35163,130.59431]]},"16L":{"vaFt":500,"source":"AIP RJFF SID HAKATA-RNAV（RWY16L）","fixes":[["UPSAM",33.40522,130.57128],["FF604",33.35211,130.46047],["FF605",33.46228,130.38531],["DGC",33.67622,130.38964]]},"16R":{"vaFt":500,"source":"AIP RJFF SID HAKATA-RNAV（RWY16R）","fixes":[["UPSAM",33.40522,130.57128],["FF604",33.35211,130.46047],["FF605",33.46228,130.38531],["DGC",33.67622,130.38964]]}}},
    RJFG: {"arrival":{"13":{"glideDeg":3.0,"faf":[30.64339,130.92308],"source":"AIP RJFG IAC RNP RWY 13","fixes":[["ASERO",30.68808,130.84301],["KAGYA",30.7931,130.92094]]},"31":{"glideDeg":3.0,"faf":[30.56916,131.05571],"source":"AIP RJFG IAC RNP RWY 31","fixes":[["ATSOP",30.52918,131.12697],["TEPPO",30.76012,131.13431]]}},"departure":{"13":{"vaFt":1200,"source":"AIP RJFG SID KAGYA-RNAV（RWY13）","fixes":[["KAGYA",30.7931,130.92094],["FG801",30.92494,130.87206,6000]]},"31":{"vaFt":1300,"source":"AIP RJFG SID KAGYA-RNAV（RWY31）","fixes":[["KAGYA",30.7931,130.92094],["FG801",30.92494,130.87206,6000]]}}},
    RJFK: {"departure":{"16":{"vaFt":1300,"source":"AIP RJFK SID MIZOBE-RNAV（RWY16）","fixes":[["FK602",31.77125,130.74114],["HKC",31.69722,130.58294,5000]]},"34":{"vaFt":2000,"source":"AIP RJFK SID ATRUK-RNAV（RWY34）","fixes":[["OVSID",31.95533,130.66192],["ATRUK",32.07383,130.61358]]}}},
    RJFM: {"arrival":{"27":{"glideDeg":3.0,"faf":[31.88632,131.57756],"source":"AIP RJFM IAC ILS Z or LOC Z RWY27","fixes":[["OYODO",31.89459,131.69287]]}},"departure":{"09":{"vaFt":500,"source":"AIP RJFM SID RJFM__SID (KIZAK-RNAV)_20250320.txt（RWY09）","fixes":[["KIZAK",31.73611,131.62536]]},"27":{"vaFt":500,"source":"AIP RJFM SID RJFM__SID (KIZAK-RNAV)_20250320.txt（RWY27）","fixes":[["FM700",31.87,131.34956],["FM701",31.96367,131.34022],["FM702",31.97031,131.43236],["KIZAK",31.73611,131.62536]]}}},
    RJFO: {"arrival":{"01":{"glideDeg":3.0,"faf":[33.40235,131.73645],"source":"AIP RJFO IAC ILS X RWY01","fixes":[["FO153",33.36854,131.83466],["TANSO",33.4685,131.85936]]},"19":{"glideDeg":3.0,"faf":[33.63347,131.73849],"source":"AIP RJFO IAC RNP Z RWY19","fixes":[["KAREI",33.68921,131.83798]]}},"departure":{"19":{"vaFt":500,"source":"AIP RJFO SID RJFO__SID (TOYO-RNAV)_20250320.txt（RWY19）","fixes":[["FO901",33.38086,131.73625]]},"01":{"vaFt":500,"source":"AIP RJFO SID RJFO__SID (TOYO-RNAV)_20250320.txt（RWY01）","fixes":[["AKNIS",33.42342,131.83283]]}}},
    RJFR: {"arrival":{"18":{"glideDeg":3.0,"faf":[33.92934,131.01784],"source":"AIP RJFR IAC ILS Y RWY18","fixes":[["FR853",33.99075,131.09736]]}}},
    RJFS: {"arrival":{"11":{"glideDeg":3.0,"faf":[33.16775,130.19627],"source":"AIP RJFS IAC VOR RWY11","fixes":[]},"29":{"glideDeg":3.0,"faf":[33.14044,130.41157],"source":"AIP RJFS IAC VOR RWY29","fixes":[]}},"departure":{"11":{"vaFt":500,"source":"AIP RJFS SID BALLOON - RNAV（RWY11）","fixes":[["FS100",33.08947,130.45711],["KIKYU",33.18086,130.92786,13000]]},"29":{"vaFt":500,"source":"AIP RJFS SID BALLOON - RNAV（RWY29）","fixes":[["FS900",33.06947,130.29106],["FS100",33.08947,130.45711],["KIKYU",33.18086,130.92786,13000]]}}},
    RJFT: {"arrival":{"25":{"glideDeg":3.0,"faf":[32.93344,131.04033],"source":"AIP RJFT IAC RNP Z RWY25(AR)","fixes":[["DIKAN",33.02089,131.07741],["ASONO",33.01614,131.24706]]}},"departure":{"07":{"vaFt":1100,"source":"AIP RJFT SID MIFNE-RNAV（RWY07）","fixes":[["FT700",32.90878,130.80414],["FT701",32.88203,130.73772],["MIFNE",32.63806,130.76075,4000]]},"25":{"vaFt":1100,"source":"AIP RJFT SID MIFNE-RNAV（RWY25）","fixes":[["FT500",32.81072,130.78881],["MIFNE",32.63806,130.76075,4000]]}}},
    RJFU: {"arrival":{"32":{"glideDeg":3.0,"faf":[32.81034,130.02711],"source":"AIP RJFU IAC ILS Y or LOC Y RWY 32","fixes":[]}},"departure":{"14":{"vaFt":500,"source":"AIP RJFU SID AKNAG-RNAV（RWY14）","fixes":[["FU400",32.85158,129.98322],["MIGAP",32.89789,129.84283],["AKNAG",33.33806,129.84578,7000]]},"32":{"vaFt":500,"source":"AIP RJFU SID CHIKUGO-RNAV（RWY32）","fixes":[["FU200",33.02628,129.79656],["TOHKI",33.16033,129.97331],["HIZEN",33.09792,130.08436,13000],["MUTUU",33.02483,130.21403],["GOROH",32.97708,130.29847,17000]]}}},
    RJGG: {"arrival":{"18":{"glideDeg":3.0,"faf":[34.93142,136.78784],"source":"AIP RJGG IAC RNP RWY18","fixes":[]},"36":{"glideDeg":3.0,"faf":[34.77039,136.82653],"source":"AIP RJGG IAC RNP RWY36","fixes":[]}},"departure":{"36":{"vaFt":500,"source":"AIP RJGG SID OUMI-RNAV（RWY36）","fixes":[["TITAN",34.90322,136.67119]]}}},
    RJKA: {"arrival":{"03":{"glideDeg":3.0,"faf":[28.3462,129.66955],"source":"AIP RJKA IAC VOR RWY03","fixes":[]},"21":{"glideDeg":3.0,"faf":[28.51604,129.75957],"source":"AIP RJKA IAC RNP Z RWY21","fixes":[["TUMGI",28.73251,129.88354]]}},"departure":{"03":{"vaFt":500,"source":"AIP RJKA SID IKEJI-RNAV（RWY03）","fixes":[["KA303",28.34433,129.72497],["IKEJI",28.26147,129.73742]]},"21":{"vaFt":500,"source":"AIP RJKA SID USAGI EAST-RNAV（RWY21）","fixes":[["KA102",28.47936,129.83025,4000],["KA103",28.49594,130.0395,5000],["POMAS",28.50411,130.14419,6000]]}}},
    RJKB: {"arrival":{"04":{"glideDeg":3.0,"faf":[27.3809,128.66696],"source":"AIP RJKB IAC RNP RWY04","fixes":[["KB452",27.31897,128.61992],["KEVUB",27.24976,128.56743]]},"22":{"glideDeg":3.0,"faf":[27.47887,128.7415],"source":"AIP RJKB IAC RNP RWY22","fixes":[["KB252",27.54078,128.7887],["LILLY",27.60973,128.84159]]}},"departure":{"04":{"vaFt":500,"source":"AIP RJKB SID HORAI-RNAV（RWY04）","fixes":[["HORAI",27.63786,128.86117]]},"22":{"vaFt":600,"source":"AIP RJKB SID NEORI  AZEFU  SONNA  YUNTA-RNAV（RWY22）","fixes":[["ASATO",27.18172,128.50408]]}}},
    RJKI: {"departure":{"07":{"vaFt":600,"source":"AIP RJKI SID BOROS-RNAV（RWY07）","fixes":[["KI773",28.35461,130.01097],["BOROS",28.54961,129.89808,3000]]},"25":{"vaFt":500,"source":"AIP RJKI SID IKYUN-RNAV（RWY25）","fixes":[["IKYUN",28.25397,129.72083,3000]]}}},
    RJKN: {"arrival":{"01":{"glideDeg":3.0,"faf":[27.72109,128.86962],"source":"AIP RJKN IAC RNP Z RWY 01","fixes":[["HORAI",27.63787,128.86116],["ISENN",27.63031,128.95461]]},"19":{"glideDeg":3.0,"faf":[27.91543,128.88609],"source":"AIP RJKN IAC LOC Z RWY 19","fixes":[["SOTEZ",28.00272,128.77672]]}},"departure":{"01":{"vaFt":800,"source":"AIP RJKN SID ANOXA-RNAV（RWY01）","fixes":[["KOKTO",28.02439,128.82142]]}}},
    RJNA: {"arrival":{"34":{"glideDeg":3.0,"faf":[35.1624,136.98358],"source":"AIP RJNA IAC ILS Y or LOC Y RWY34","fixes":[]}}},
    RJNF: {"arrival":{"18":{"glideDeg":3.0,"faf":[36.22318,136.21682],"source":"AIP RJNF IAC RNP RWY18","fixes":[["KAGAR",36.30644,136.20945],["GOZEN",36.41803,136.19905]]}},"departure":{"18":{"vaFt":800,"source":"AIP RJNF SID AWARA-RNAV（RWY18）","fixes":[["AWARA",36.29982,136.09644]]},"36":{"vaFt":500,"source":"AIP RJNF SID AWARA-RNAV（RWY36）","fixes":[["AWARA",36.29982,136.09644]]}}},
    RJNK: {"arrival":{"06":{"glideDeg":3.0,"faf":[36.33059,136.29539],"source":"AIP RJNK IAC ILS Z or LOC Z RWY06","fixes":[["DAIJO",36.28158,136.20883]]},"24":{"glideDeg":3.0,"faf":[36.44974,136.50674],"source":"AIP RJNK IAC RNP RWY24","fixes":[["GOSIK",36.50102,136.59784],["KINKA",36.53631,136.71406]]}},"departure":{"06":{"vaFt":500,"source":"AIP RJNK SID OHNNO  GINJO  SONBU-RNAV（RWY06）","fixes":[["KAETU",36.40217,136.24658],["OHNNO",35.89119,136.63428,12000]]},"24":{"vaFt":500,"source":"AIP RJNK SID OHNNO  GINJO  SONBU-RNAV（RWY24）","fixes":[["AWAZU",36.32961,136.29361],["OHNNO",35.89119,136.63428,12000]]}}},
    RJNO: {"arrival":{"08":{"glideDeg":3.0,"faf":[36.14343,133.21757],"source":"AIP RJNO IAC RNP RWY08","fixes":[["TAKHI",36.11137,133.12077],["SAIGO",35.99436,133.414]]},"26":{"glideDeg":3.0,"faf":[36.20879,133.4159],"source":"AIP RJNO IAC RNP RWY26","fixes":[["JOUDO",36.23103,133.48368],["SAIGO",35.99436,133.414]]}},"departure":{"08":{"vaFt":700,"source":"AIP RJNO SID NAKAU-RNAV（RWY08）","fixes":[["DONDO",35.93144,133.26044]]},"26":{"vaFt":800,"source":"AIP RJNO SID OKUNI-RNAV（RWY26）","fixes":[["TIBRI",35.97492,133.14008]]}}},
    RJNS: {"arrival":{"30":{"glideDeg":3.0,"faf":[34.74301,138.34797],"source":"AIP RJNS IAC ILS Z or LOC Z RWY30","fixes":[["OHCHA",34.70722,138.45461]]}},"departure":{"12":{"vaFt":900,"source":"AIP RJNS SID FUJIK-RNAV（RWY12）","fixes":[["ONMAE",34.62297,138.36617],["NS301",34.48356,138.33689],["NS302",34.45336,138.54542],["NS303",34.62681,138.58228],["FUJIK",34.69467,138.42756,7000]]},"30":{"vaFt":1200,"source":"AIP RJNS SID FUJIK-RNAV（RWY30）","fixes":[["ONMAE",34.62297,138.36617],["NS301",34.48356,138.33689],["NS302",34.45336,138.54542],["NS303",34.62681,138.58228],["FUJIK",34.69467,138.42756,7000]]}}},
    RJNT: {"arrival":{"20":{"glideDeg":3.0,"faf":[36.73804,137.21432],"source":"AIP RJNT IAC RNP Z RWY20","fixes":[["MEDIC",36.83625,137.24644]]}},"departure":{"02":{"vaFt":600,"source":"AIP RJNT SID UOZU-RNAV（RWY02）","fixes":[["NT001",36.76892,137.19692],["IKUJI",37.03819,137.49236]]},"20":{"vaFt":700,"source":"AIP RJNT SID UOZU-RNAV（RWY20）","fixes":[["NT001",36.76892,137.19692],["IKUJI",37.03819,137.49236]]}}},
    RJNW: {"arrival":{"07":{"glideDeg":3.0,"faf":[37.26925,136.86176],"source":"AIP RJNW IAC VOR RWY07","fixes":[]},"25":{"glideDeg":3.0,"faf":[37.33628,137.08782],"source":"AIP RJNW IAC ILS Z or LOC Z RWY25","fixes":[["NOPPY",37.37075,137.18889]]}}},
    RJOA: {"arrival":{"10":{"glideDeg":3.0,"faf":[34.43597,132.79869],"source":"AIP RJOA IAC ILS Y RWY10 (CAT III)","fixes":[["OA054",34.51857,132.75104],["PUNUP",34.57027,132.92566]]}},"departure":{"10":{"vaFt":1500,"source":"AIP RJOA SID MARCO-RNAV（RWY10）","fixes":[["OA021",34.436,132.98356],["LEMON",34.22469,132.46358,11000]]},"28":{"vaFt":1600,"source":"AIP RJOA SID MARCO-RNAV（RWY28）","fixes":[["OA811",34.42786,132.82314],["LEMON",34.22469,132.46358,11000]]}}},
    RJOB: {"arrival":{"07":{"glideDeg":3.0,"faf":[34.70659,133.75313],"source":"AIP RJOB IAC ILS Z RWY07","fixes":[]},"25":{"glideDeg":3.0,"faf":[34.82136,133.98676],"source":"AIP RJOB IAC RNP Z RWY25 (AR)","fixes":[["BIKAN",34.85544,134.05644],["BENES",34.83454,134.15541]]}},"departure":{"07":{"vaFt":1400,"source":"AIP RJOB SID OLIVE-RNAV（RWY07）","fixes":[["OB700",34.79283,133.92847],["OLIVE",34.75492,134.45006]]},"25":{"vaFt":1400,"source":"AIP RJOB SID WASYU-RNAV（RWY25）","fixes":[["DANGO",34.54767,133.61511,7000],["WASYU",34.47153,133.38364]]}}},
    RJOC: {"arrival":{"07":{"glideDeg":3.0,"faf":[35.35991,132.77884],"source":"AIP RJOC IAC RNP RWY07","fixes":[["SUBIE",35.31738,132.69121],["OKUNI",35.4035,132.62883]]}},"departure":{"07":{"vaFt":500,"source":"AIP RJOC SID RJOC__SID (MATSUE  TAKHI  SAIGO  KYOKA - RNAV)_20250807.txt（RWY07）","fixes":[["OC712",35.50461,133.00944],["OC713",35.74217,133.20494]]}}},
    RJOH: {"arrival":{"07":{"glideDeg":3.0,"faf":[35.43912,133.10352],"source":"AIP RJOH IAC RNP Z RWY07","fixes":[["KYURI",35.39431,132.99183]]},"25":{"glideDeg":3.0,"faf":[35.54174,133.36068],"source":"AIP RJOH IAC ILS Z or LOC Z RWY25","fixes":[["GAINA",35.60653,133.52406],["DAIEI",35.51064,133.70289]]}},"departure":{"07":{"vaFt":500,"source":"AIP RJOH SID KITARO-RNAV（RWY07）","fixes":[["OH701",35.59233,133.41219],["OH703",35.67739,133.32756],["MIHOU",35.53111,133.09392,8000]]},"25":{"vaFt":500,"source":"AIP RJOH SID KITARO-RNAV（RWY25）","fixes":[["OH501",35.45869,133.37969],["OH701",35.59233,133.41219],["OH703",35.67739,133.32756],["MIHOU",35.53111,133.09392,8000]]}}},
    RJOK: {"arrival":{"32":{"glideDeg":3.0,"faf":[33.49054,133.74683],"source":"AIP RJOK IAC ILS Z or LOC Z RWY32","fixes":[["ANPAN",33.41876,133.84681]]}},"departure":{"14":{"vaFt":500,"source":"AIP RJOK SID RJOK__SID (RUSEV-RNAV)_20260806.txt（RWY14）","fixes":[["OK14A",33.41397,133.72617],["OK14B",33.40081,133.84453],["OK400",33.56903,134.05572],["RUSEV",33.81231,133.91397]]},"32":{"vaFt":500,"source":"AIP RJOK SID RJOK__SID (OMOGO-RNAV)_20260806.txt（RWY32）","fixes":[["OK32A",33.5925,133.75478],["OK32B",33.52886,133.84356],["OK32E",33.36644,133.66383],["YUZNO",33.65944,133.28464],["OMOGO",33.68047,133.20919,8000]]}}},
    RJOM: {"arrival":{"14":{"glideDeg":3.0,"faf":[33.9185,132.57159],"source":"AIP RJOM IAC RJOM__IAC  (ILS Z or LOC Z RWY14)_20210225.txt","fixes":[["ROBIN",33.941,132.53939]]}},"departure":{"14":{"vaFt":1300,"source":"AIP RJOM SID RJOM__SID- Instrument  (MARCO-RNAV)_20250320.txt（RWY14）","fixes":[["OM401",33.76761,132.62933],["OM402",33.85819,132.49003],["MARCO",34.07944,132.14728]]},"32":{"vaFt":500,"source":"AIP RJOM SID RJOM__SID- Instrument  (MARCO-RNAV)_20250320.txt（RWY32）","fixes":[["OM402",33.85819,132.49003],["MARCO",34.07944,132.14728]]}}},
    RJOO: {"arrival":{"32L":{"glideDeg":3.0,"faf":[34.64937,135.60024],"source":"AIP RJOO IAC ILS RWY32L","fixes":[["IKOMA",34.60464,135.65411]]}}},
    RJOR: {"arrival":{"10":{"glideDeg":3.0,"faf":[35.53445,134.08323],"source":"AIP RJOR IAC ILS Y RWY10","fixes":[["OR056",35.61939,134.0593]]}}},
    RJOS: {"arrival":{"29":{"glideDeg":3.0,"faf":[34.11369,134.70947],"source":"AIP RJOS IAC RNP Z RWY29","fixes":[["DATIS",33.9811,134.93698]]}},"departure":{"11":{"vaFt":500,"source":"AIP RJOS SID RJOS__SID (HONMA-RNAV)_20240321.txt（RWY11）","fixes":[["HATIS",34.02736,134.72447]]},"29":{"vaFt":500,"source":"AIP RJOS SID RJOS__SID (KAGAWA-RNAV)_20240321.txt（RWY29）","fixes":[["OBDED",34.15042,134.31078,5000],["KTE",34.2125,134.02259]]}}},
    RJOT: {"arrival":{"26":{"glideDeg":3.0,"faf":[34.26177,134.20309],"source":"AIP RJOT IAC ILS Y or LOC Y RWY26","fixes":[]}}},
    RJSA: {"arrival":{"24":{"glideDeg":3.0,"faf":[40.82942,140.85023],"source":"AIP RJSA IAC ILS Z or LOC Z RWY24 (CAT II and III)","fixes":[]}},"departure":{"06":{"vaFt":1100,"source":"AIP RJSA SID OHMAR-RNAV（RWY06）","fixes":[["SMELT",40.895,140.78167],["TSUKI",41.05142,140.85908]]},"24":{"vaFt":1100,"source":"AIP RJSA SID SHIRAKAMI-RNAV（RWY24）","fixes":[["SA611",40.80831,140.59756],["SA612",40.75672,140.51131]]}}},
    RJSF: {"arrival":{"01":{"glideDeg":3.0,"faf":[37.09595,140.42167],"source":"AIP RJSF IAC ILS Y or LOC Y RWY01","fixes":[["SOUMA",37.01253,140.41767]]},"19":{"glideDeg":3.0,"faf":[37.33825,140.40467],"source":"AIP RJSF IAC VOR RWY19","fixes":[]}}},
    RJSI: {"arrival":{"02":{"glideDeg":3.0,"faf":[39.33487,141.11999],"source":"AIP RJSI IAC VOR RWY02","fixes":[]},"20":{"glideDeg":3.0,"faf":[39.52845,141.15981],"source":"AIP RJSI IAC RNP X RWY20","fixes":[["APUSO",39.61369,141.18075]]}},"departure":{"02":{"vaFt":700,"source":"AIP RJSI SID SAMBO-RNAV（RWY02）","fixes":[["AKARI",39.72153,141.13842],["DASCO",39.85256,141.14067]]},"20":{"vaFt":1300,"source":"AIP RJSI SID SAMBO-RNAV（RWY20）","fixes":[["SI010",39.44983,141.03211],["AKARI",39.72153,141.13842],["DASCO",39.85256,141.14067]]}}},
    RJSK: {"arrival":{"10":{"glideDeg":3.0,"faf":[39.61938,140.0791],"source":"AIP RJSK IAC RJSK__IAC(VOR RWY10)_20261029.txt","fixes":[]},"28":{"glideDeg":3.0,"faf":[39.60756,140.30858],"source":"AIP RJSK IAC RJSK__IAC(ILS Z or LOC Z RWY28)_20250417.txt","fixes":[["GAKKO",39.72747,140.40328]]}},"departure":{"10":{"vaFt":900,"source":"AIP RJSK SID RJSK__SID- Instrument(NIIGATA-RNAV)_20250417.txt（RWY10）","fixes":[["SK011",39.60225,140.36733],["SK012",39.52767,140.35603],["ELPEK",39.19478,139.77836]]},"28":{"vaFt":900,"source":"AIP RJSK SID RJSK__SID- Instrument(MUTSU-RNAV)_20250417.txt（RWY28）","fixes":[["NUPLI",39.80614,140.18236]]}}},
    RJSN: {"departure":{"10":{"vaFt":500,"source":"AIP RJSN SID SUKOB-RNAV（RWY10）","fixes":[["SN000",37.95214,139.22075],["SN001",38.03547,139.22581]]}}},
    RJSR: {"arrival":{"11":{"glideDeg":3.0,"faf":[40.21114,140.22839],"source":"AIP RJSR IAC ILS Z RWY11","fixes":[["SR173",40.1497,140.14303],["BONJI",39.98706,140.29792]]}},"departure":{"11":{"vaFt":1600,"source":"AIP RJSR SID YUWA（RWY11）","fixes":[["LEGAM",40.12156,140.20386],["UKBAS",39.96853,140.11908],["UWE",39.61714,140.18694]]},"29":{"vaFt":700,"source":"AIP RJSR SID YUWA（RWY29）","fixes":[["AKPAT",40.20797,140.25192],["UKBAS",39.96853,140.11908],["UWE",39.61714,140.18694]]}}},
    RJSS: {"arrival":{"27":{"glideDeg":3.0,"faf":[38.15181,141.02562],"source":"AIP RJSS IAC RNP Y RWY27","fixes":[["OVRID",38.16244,141.1304],["SNOOK",37.98375,140.91436]]},"30":{"glideDeg":3.1,"faf":[38.09346,141.01035],"source":"AIP RJSS IAC VOR RWY30","fixes":[]}},"departure":{"09":{"vaFt":500,"source":"AIP RJSS SID SUTBA-RNAV（RWY09）","fixes":[["SS901",38.1485,140.99322],["AKOLO",37.97597,140.99733],["EBOSI",38.00797,140.62661],["SUTBA",38.00353,140.46344,9000]]},"27":{"vaFt":500,"source":"AIP RJSS SID SUTBA-RNAV（RWY27）","fixes":[["SS701",38.13292,140.84214],["EBOSI",38.00797,140.62661],["SUTBA",38.00353,140.46344,9000]]}}},
    RJSY: {"arrival":{"09":{"glideDeg":3.0,"faf":[38.79096,139.64098],"source":"AIP RJSY IAC ILS Z or LOC Z RWY09","fixes":[["YURAH",38.7755,139.53622]]},"27":{"glideDeg":3.0,"faf":[38.79257,139.93089],"source":"AIP RJSY IAC RNP Y RWY27(AR)","fixes":[["ANNON",38.62927,140.07924],["USUBA",38.53723,140.16247]]}},"departure":{"27":{"vaFt":500,"source":"AIP RJSY SID ZUNDA-RNAV（RWY27）","fixes":[["SY900",38.63747,140.02989],["TADAT",38.50831,140.20061,11000],["YTE",38.38862,140.35795]]}}},
    RJTF: {"departure":{"17":{"vaFt":700,"source":"AIP RJTF SID RJTF__SID- Instrument_20251002.txt（RWY17）","fixes":[["TF511",35.50731,139.60364],["KOSKA",35.25583,139.58753]]},"35":{"vaFt":900,"source":"AIP RJTF SID RJTF__SID- Instrument_20251002.txt（RWY35）","fixes":[["TF510",35.65842,139.60114],["TF511",35.50731,139.60364],["KOSKA",35.25583,139.58753]]}}},
    RJTH: {"arrival":{"26":{"glideDeg":3.0,"faf":[33.19269,140.00239],"source":"AIP RJTH IAC LOC Z RWY26","fixes":[]}}},
    RJTO: {"arrival":{"03":{"glideDeg":3.0,"faf":[34.70906,139.32787],"source":"AIP RJTO IAC LOC Y RWY03","fixes":[]}},"departure":{"03":{"vaFt":700,"source":"AIP RJTO SID MIHARA-RNAV（RWY03）","fixes":[["HATSU",34.97656,139.49808]]},"21":{"vaFt":1000,"source":"AIP RJTO SID MIHARA-RNAV（RWY21）","fixes":[["TO100",34.86436,139.37811],["HATSU",34.97656,139.49808]]}}},
    RJTQ: {"departure":{"02":{"vaFt":500,"source":"AIP RJTQ SID SCOTT（RWY02）","fixes":[["SCOTT",34.389,139.68231]]},"20":{"vaFt":500,"source":"AIP RJTQ SID SCOTT（RWY20）","fixes":[["TQ001",34.07669,139.62042],["SCOTT",34.389,139.68231]]}}},
    ROAH: {"arrival":{"18R":{"glideDeg":3.0,"faf":[26.26182,127.62878],"source":"AIP ROAH IAC ILS or LOC RWY18R","fixes":[["EISAR",26.48275,127.50529]]},"36L":{"glideDeg":3.0,"faf":[26.1141,127.63659],"source":"AIP ROAH IAC RNP RWY36L","fixes":[["BLISS",26.04702,127.63973],["VIGER",25.96219,127.59081]]},"36R":{"glideDeg":3.0,"faf":[26.11758,127.64954],"source":"AIP ROAH IAC RNP RWY36R","fixes":[["NAMIE",26.04765,127.65281],["VIGER",25.96219,127.59081]]}},"departure":{"18R":{"vaFt":500,"source":"AIP ROAH SID ESKOB-RNAV（RWY18R）","fixes":[["KYANN",26.00825,127.65467],["AH801",26.01156,127.74156],["ESKOB",26.16931,127.95767]]},"36R":{"vaFt":500,"source":"AIP ROAH SID ESKOB-RNAV（RWY36R）","fixes":[["H6R00",26.24869,127.64339],["KIZNA",26.43689,127.52825],["GELMA",26.34385,127.40867],["OLVAL",26.06972,127.41147],["ESKOB",26.16931,127.95767]]},"36L":{"vaFt":500,"source":"AIP ROAH SID ESKOB-RNAV（RWY36L）","fixes":[["KIZNA",26.43689,127.52825],["GELMA",26.34385,127.40867],["OLVAL",26.06972,127.41147],["ESKOB",26.16931,127.95767]]},"18L":{"vaFt":500,"source":"AIP ROAH SID ESKOB-RNAV（RWY18L）","fixes":[["KYANN",26.00825,127.65467],["AH801",26.01156,127.74156],["ESKOB",26.16931,127.95767]]}}},
    ROIG: {"arrival":{"04":{"glideDeg":3.0,"faf":[24.31288,124.17918],"source":"AIP ROIG IAC ILS Z or LOC Z RWY04","fixes":[["JOTTO",24.24397,124.12492],["KOHAM",24.39883,124.03709]]},"22":{"glideDeg":3.0,"faf":[24.49059,124.31952],"source":"AIP ROIG IAC RNP Y RWY22(AR)","fixes":[["MURAT",24.54109,124.3595],["OMOCK",24.60879,124.41315]]}},"departure":{"04":{"vaFt":600,"source":"AIP ROIG SID AYAKA-RNAV（RWY04）","fixes":[["IG400",24.47519,124.30733],["IG401",24.52531,124.30978],["IG402",24.55003,124.23111],["AYAKA",24.40414,123.59206,5000]]},"22":{"vaFt":600,"source":"AIP ROIG SID AYAKA-RNAV（RWY22）","fixes":[["IG200",24.35503,124.21242],["IG201",24.29333,124.16381],["IG202",24.31539,123.9895],["IG203",24.34881,123.84047,5000],["AYAKA",24.40414,123.59206]]}}},
    ROKJ: {"arrival":{"03":{"glideDeg":3.0,"faf":[26.26068,126.66962],"source":"AIP ROKJ IAC LOC RWY03","fixes":[["DUFFY",26.14069,126.51344]]}},"departure":{"21":{"vaFt":500,"source":"AIP ROKJ SID DORIS  DUFFY（RWY21）","fixes":[["DORIS",26.07514,126.69814,3000]]}}},
    ROMD: {"arrival":{"02":{"glideDeg":3.0,"faf":[25.78902,131.24883],"source":"AIP ROMD IAC VOR RWY02","fixes":[]},"20":{"glideDeg":3.0,"faf":[25.89998,131.2871],"source":"AIP ROMD IAC VOR RWY20","fixes":[]}},"departure":{"02":{"vaFt":600,"source":"AIP ROMD SID CORCO SOUTH-RNAV（RWY02）","fixes":[["CORCO",25.87403,130.98753,5000]]},"20":{"vaFt":600,"source":"AIP ROMD SID CORCO SOUTH-RNAV（RWY20）","fixes":[["CORCO",25.87403,130.98753,5000]]}}},
    ROMY: {"arrival":{"04":{"glideDeg":3.0,"faf":[24.7195,125.23503],"source":"AIP ROMY IAC VOR RWY04","fixes":[]},"22":{"glideDeg":3.0,"faf":[24.8467,125.35046],"source":"AIP ROMY IAC ILS Z or LOC Z RWY22","fixes":[["MIBAI",24.91225,125.40731]]}},"departure":{"04":{"vaFt":700,"source":"AIP ROMY SID UMAKI-RNAV（RWY04）","fixes":[["WAIDO",24.69217,125.33014,3000],["UMAKI",24.62269,124.85417,3000]]}}},
    RORK: {"arrival":{"03":{"glideDeg":3.0,"faf":[25.85448,131.26379],"source":"AIP RORK IAC VOR Y RWY03","fixes":[["CORCO",25.87403,130.98753]]}},"departure":{"03":{"vaFt":500,"source":"AIP RORK SID CORCO NORTH-RNAV（RWY03）","fixes":[["CORCO",25.87403,130.98753,5000]]},"21":{"vaFt":500,"source":"AIP RORK SID CORCO NORTH-RNAV（RWY21）","fixes":[["CORCO",25.87403,130.98753,5000]]}}},
    RORS: {"arrival":{"17":{"glideDeg":3.0,"faf":[24.917,125.12029],"source":"AIP RORS IAC RNP RWY17","fixes":[["DIANA",24.99809,125.09808]]},"35":{"glideDeg":3.0,"faf":[24.74247,125.17224],"source":"AIP RORS IAC VOR RWY35","fixes":[]}},"departure":{"17":{"vaFt":500,"source":"AIP RORS SID RORS__SID (FREED-RNAV)_20250320.txt（RWY17）","fixes":[["RS700",24.88347,125.2725]]}}},
    RORY: {"arrival":{"14":{"glideDeg":3.0,"faf":[27.11936,128.32962],"source":"AIP RORY IAC VOR RWY14","fixes":[]},"32":{"glideDeg":3.0,"faf":[26.98452,128.46314],"source":"AIP RORY IAC VOR RWY32","fixes":[]}},"departure":{"14":{"vaFt":700,"source":"AIP RORY SID ERABU-RNAV（RWY14）","fixes":[["MARIX",27.27569,128.63517],["ONC",27.43289,128.69897]]},"32":{"vaFt":500,"source":"AIP RORY SID MEKAX-RNAV（RWY32）","fixes":[["MIDIP",27.23969,128.34678]]}}},
    ROYN: {"arrival":{"26":{"glideDeg":3.0,"faf":[24.49513,123.09527],"source":"AIP ROYN IAC RNP Y RWY26","fixes":[["ANGAI",24.51922,123.19596]]}},"departure":{"26":{"vaFt":600,"source":"AIP ROYN SID AYAKA-RNAV（RWY26）","fixes":[["YN600",24.57347,122.95339],["AYAKA",24.40414,123.59206]]}}},
  };
  const SHORT_NAMES = { RJTT: "羽田", RJAA: "成田", RJBB: "関空", RJOO: "伊丹", RJGG: "中部", RJCC: "新千歳", RJNA: "小牧", RJCO: "丘珠", RJOS: "徳島", RJOI: "岩国" };
  const AIRPORTS = AIRPORT_ROWS.map(([id, name, iata, latitude, longitude, rws]) => ({
    id, name, iata, latitude, longitude,
    shortName: SHORT_NAMES[id] || name.replace(/(国際)?(空港|飛行場)$/, ""),
    elevationM: Math.min(...rws.map((r) => r[4])),
    runways: rws.map(([ident, headingDegT, lat, lon, elevationM, dLat, dLon]) => ({ ident, headingDegT, elevationM,
      threshold: { latitude: lat, longitude: lon }, ...(dLat ? { landingThreshold: { latitude: dLat, longitude: dLon } } : {}) })),
  }));
  const airportById = (id) => AIRPORTS.find((a) => a.id === id) || null;
  /// いちばん近い空港。滑走路の向きが分かっている空港だけ
  function nearestAirport(lat, lon) {
    let best = null, bestKm = Infinity;
    for (const a of AIRPORTS) { const d = haversineKm(lat, lon, a.latitude, a.longitude); if (d < bestKm) { bestKm = d; best = a; } }
    return best ? { airport: best, distanceKm: bestKm } : null;
  }

  const COMPASS = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
  /**
   * 羽田以外の空港の簡略モデル。**公表の経路は未反映**で、滑走路の延長線の直線だけを引く。
   * 運用は最も長い滑走路と同じ向きの滑走路を向きごとにまとめ、向かい風が最も強い向きへ降りて、同じ向きへ離陸する。
   * 優先滑走路・騒音の決まり・運用時間・便数は持たない。
   */
  function genericRoutes(airport) {
    const runwayOfA = (ident) => airport.runways.find((r) => r.ident === ident) || null;
    const P = makeProcedures(AIRPORT_PROCEDURES[airport.id] || {}, runwayOfA, airport);
    const recip = (ident) => { const n = (Number(ident.slice(0, 2)) + 17) % 36 + 1; return String(n).padStart(2, "0") + ({ L: "R", R: "L", C: "C" }[ident.slice(2)] || ""); };
    const lengthKm = (r) => { const o = runwayOfA(recip(r.ident)); return o ? haversineKm(r.threshold.latitude, r.threshold.longitude, o.threshold.latitude, o.threshold.longitude) : 0; };
    const main = airport.runways.reduce((a, b) => (lengthKm(b) > lengthKm(a) ? b : a), airport.runways[0]);
    const axisOff = (h) => { const d = Math.abs(((h - main.headingDegT) % 180 + 180) % 180); return Math.min(d, 180 - d); };
    const ops = {};
    for (const r of airport.runways) {
      if (axisOff(r.headingDegT) > 25) continue;
      const same = Math.abs(((r.headingDegT - main.headingDegT + 540) % 360) - 180) < 90;
      const key = same ? "a" : "b";
      (ops[key] ||= { heading: same ? main.headingDegT : (main.headingDegT + 180) % 360, landing: [], takeoff: [] });
      ops[key].landing.push(r.ident); ops[key].takeoff.push(r.ident);
    }
    for (const o of Object.values(ops)) {
      // 向かい風で降りるので、風の来る向き＝滑走路の向き
      o.name = `${COMPASS[Math.round(o.heading / 45) % 8]}風運用（${o.landing.join("・")}）`;
    }
    const operationForA = (windFromDeg, windSpeedMs) => {
      if (!Number.isFinite(windFromDeg) || windFromDeg < 0 || windFromDeg > 360) return null;
      let best = null, head = -Infinity;
      for (const [key, o] of Object.entries(ops)) { const h = Math.cos((windFromDeg - o.heading) * DEG); if (h > head) { head = h; best = key; } }
      return best;
    };
    const operationStatusA = (at) => {
      const t = typeof at === "number" ? at : Date.parse(at);
      if (!Number.isFinite(t)) return { supported: false, period: "unknown", operationConfirmed: false, note: "日時が確認できないため経路を表示できません" };
      return { supported: true, period: "day", timeZone: "Asia/Tokyo", operationConfirmed: false,
        modelLimit: AIRPORT_PROCEDURES[airport.id] ? "公表の飛行方式から自動で読み取った代表経路です（読み取れない滑走路は直線）。優先滑走路・運用時間は反映していません" : "滑走路の延長線の直線だけの概算です。旋回する経路・優先滑走路・運用時間は反映していません",
        note: "風から選ぶ想定運用です。実際の使用滑走路・経路・便の有無は未確認です" };
    };
    return { AIRPORT: airport, runwayOf: runwayOfA, OPERATIONS: ops, operationFor: operationForA, operationStatus: operationStatusA,
      approachPath: (ident, opts) => approachFrom(runwayOfA(ident), opts), departurePath: (ident, opts) => departureFrom(runwayOfA(ident), opts),
      procedureApproachPath: P.approach, procedureDeparturePath: P.departure, procedureSource: P.source,
      measuredApproachPath: P.approach, measuredSource: (ident) => P.source("landing", ident),
      SPOTS: [], SPOT_HORIZONS: {}, spotHorizonAt: () => null, HAS_TRAFFIC: false,
      // 便数は持たない。狙い目の並べ替えに使う重みとして、昼間に1時間1便を置く
      trafficAt: (hourJst) => { const h = ((hourJst % 24) + 24) % 24; return h >= 7 && h < 22 ? 1 : 0; } };
  }

  const HANEDA = { AIRPORT: RJTT, runwayOf, OPERATIONS, operationFor, operationStatus, approachPath, departurePath,
    measuredApproachPath, measuredSource, procedureApproachPath, procedureDeparturePath, procedureSource,
    SPOTS, SPOT_HORIZONS, spotHorizonAt, trafficAt, HAS_TRAFFIC: true };
  /// 対象の空港を切り替える。経路・運用の関数（下の公開オブジェクトの同名の項目）が、その空港のものに入れ替わる
  function selectAirport(id) {
    const a = id === "RJTT" ? HANEDA : airportById(id) ? genericRoutes(airportById(id)) : null;
    if (!a) return false;
    Object.assign(AstroNotesRoutes, a);
    return true;
  }

  const AstroNotesRoutes = { RJTT, runwayOf, OPERATIONS, operationFor, operationStatus, SPOTS,
                         approachPath, departurePath, measuredApproachPath, measuredSource, procedureApproachPath, procedureDeparturePath, procedureSource, PROCEDURES, HOURLY_MOVEMENTS, HOURLY_ARRIVALS, HOURLY_DEPARTURES,
                         trafficAt, destination, THRESHOLD_CROSSING_M, SPOT_HORIZONS, spotHorizonAt,
                         AIRPORT: RJTT, HAS_TRAFFIC: true, AIRPORTS, airportById, nearestAirport, selectAirport };
  global.AstroNotesRoutes = AstroNotesRoutes;
  if (typeof module !== "undefined" && module.exports) module.exports = AstroNotesRoutes;
})(typeof globalThis !== "undefined" ? globalThis : this);

/* Legacy global names remain aliases for cached integrations. */
if(typeof AstroNotes!=='undefined')globalThis.Sorami=AstroNotes;if(typeof AstroNotesRoutes!=='undefined')globalThis.SoramiRoutes=AstroNotesRoutes;
