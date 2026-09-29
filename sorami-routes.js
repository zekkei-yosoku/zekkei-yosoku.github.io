/*
 * Sorami — 空港の滑走路と、飛行機が通る道（月丼用）
 *
 * **月丼**＝月と飛行機を重ねて撮ること。重なるかどうかは
 *   「その時刻の月の方位・高度」と「そのとき飛行機がいる場所」
 * だけで決まる。月は計算で出せる。飛行機は**航路が決まっている**ので、
 * 進入・出発の経路を形として持っておけば、重なる立ち位置が解ける。
 *
 * ここに置くのは**経路の形**だけ。月との突き合わせは `sorami-plane.js`。
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
   */
  const RJTT = {
    id: "RJTT", name: "羽田空港", latitude: 35.5533, longitude: 139.7811, elevationM: 6,
    runways: [
      { ident: "34L", threshold: { latitude: 35.536591, longitude: 139.785672 }, headingDegT: 330, elevationM: 6 },
      { ident: "34R", threshold: { latitude: 35.53969, longitude: 139.805142 }, headingDegT: 330, elevationM: 6 },
      // 16L/16R（南風の都心上空ルート）は、好天時の RNAV 進入で**降下角 3.45°**（騒音のため高めに通す）。
      // 月丼は晴れた日の話なので、こちらを使う。出典: 国土交通省・中野区「羽田空港の新飛行経路」
      { ident: "16L", threshold: { latitude: 35.565897, longitude: 139.78655 }, headingDegT: 150, elevationM: 7, glideDeg: 3.45 },
      { ident: "16R", threshold: { latitude: 35.560452, longitude: 139.768734 }, headingDegT: 150, elevationM: 6, glideDeg: 3.45 },
      { ident: "22", threshold: { latitude: 35.567459, longitude: 139.777114 }, headingDegT: 215, elevationM: 11 },
      { ident: "04", threshold: { latitude: 35.549015, longitude: 139.761274 }, headingDegT: 35, elevationM: 6 },
      { ident: "23", threshold: { latitude: 35.540598, longitude: 139.822125 }, headingDegT: 223, elevationM: 17 },
      { ident: "05", threshold: { latitude: 35.524001, longitude: 139.803469 }, headingDegT: 57, elevationM: 14 },
    ],
  };
  const runwayOf = (ident) => RJTT.runways.find((r) => r.ident === ident) || null;
  /// 滑走路の端を越える高さ（ILS の基準高 TCH）。ICAO Annex 10 / PANS-OPS の標準 15m（50ft）
  const THRESHOLD_CROSSING_M = 15;

  /**
   * 運用の向き。**風で決まる。**
   *   北風運用 … 南から進入して北へ降りる（34L/34R）。出発は 05 と 34R
   *   南風運用 … 北から進入して南へ降りる（16L/16R）。出発は 22 と 16L
   * 南風の到着は都心の上を通る（2020年からの経路）。**15〜19時だけ**。
   */
  const OPERATIONS = {
    north: { name: "北風運用", landing: ["34L", "34R"], takeoff: ["05", "34R"] },
    south: { name: "南風運用（都心上空）", landing: ["16L", "16R"], takeoff: ["22", "16L"],
             landingHours: [15, 19], note: "南風の到着は都心の上空。15〜19時だけです" },
    // **15〜19時以外の南風は、湾の側から B・D 滑走路へ降りる**（都心の上は通らない）。
    // 以前はこれを持たず、南風の日は一日じゅう都心上空の線を引いていた（2026-09-28 修正）
    southBay: { name: "南風運用（湾側）", landing: ["22", "23"], takeoff: ["16L", "16R"],
                note: "15〜19時以外の南風は、湾の側から降ります" },
  };

  /**
   * 優先滑走路。**風が弱ければ北風運用のまま。** 34 への追い風がこれを超えたら南風運用へ移る。
   * 5ノット（2.6m/s）は ICAO PANS-ATM の「優先滑走路を使わない追い風」の目安。
   */
  const TAILWIND_LIMIT_MS = 2.6;

  /**
   * 風から運用を決める。
   *
   * 以前は「風向が北寄りか南寄りか」だけで決めていたので、**弱い南風でも南風運用**にしていた。
   * 実際は風が弱ければ北風運用のまま（優先滑走路）。34 への追い風成分で決める。
   *
   * @param {number} windFromDeg 風が吹いてくる方位（気象の風向）
   * @param {number} [windSpeedMs] 風速。無ければ向きだけで決める（従来どおり）
   * @param {number} [hourJst] 時刻。南風のときに、都心上空（15〜19時）か湾側かを分ける
   */
  function operationFor(windFromDeg, windSpeedMs, hourJst) {
    if (!Number.isFinite(windFromDeg)) return null;
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
      const p = destination(rw.threshold.latitude, rw.threshold.longitude, back, d);
      // **滑走路の端を 15m（50ft）の高さで越える。** ICAO の標準（ILS の基準高 TCH）。
      // 以前は端で高さ0として引いていて、どの距離でも 15m 低かった（5km 先・月の高さ3°の場面で
      // 0.17°＝月の半径の6割ずれる。2026-09-30）
      out.push({ ...p, altitudeM: rw.elevationM + THRESHOLD_CROSSING_M + d * 1000 * Math.tan(slope * DEG), distanceKm: d });
    }
    return out;
  }

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
   * 建物が取れなかった5か所（浮島町公園・東扇島東公園・川崎マリエン・若洲海浜公園・海ほたる）は地形だけ。
   * 羽田 第2ターミナルは建物が近く、北〜東が 30〜50° まで塞がる（展望デッキの囲いもある）。
   */
  const SPOT_HORIZONS = {
    t1: [0,0,0,0,0,20,20,21,21,22,23,23,24,24,49,50,48,46,44,43,4,0,0,0,0,0,0,0,16,16,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5,8,7,7,1,4,5,5,3,5,1,0,0,0,0,0,58,58,0,217,0],
    t2: [98,102,107,129,324,404,449,476,500,504,508,513,517,521,516,493,471,451,428,356,158,121,118,114,71,62,55,50,45,8,7,0,0,74,91,103,118,137,165,164,159,141,126,114,0,0,0,0,0,0,0,5,9,5,5,3,4,159,5,3,5,1,1,0,0,0,0,33,37,55,64,68],
    t3: [17,0,0,0,0,0,0,0,0,0,0,0,0,0,0,43,58,57,54,51,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,42,48,52,54,56,57,58,58,58,58,57,55,52,50,47,44,40,35,1,3,4,7,5,6,3,1,0,0,0,0,0,0,12,16,17],
    jonanjima: [1,1,0,0,0,0,1,3,3,0,6,6,4,4,1,0,0,0,0,0,0,0,0,0,0,0,0,2,1,0,0,1,1,0,1,2,1,2,2,2,9,16,16,29,29,15,15,14,16,17,3,19,36,38,36,5,8,8,5,6,5,5,13,6,4,0,1,1,1,0,0,0],
    keihinjima: [10,24,24,6,4,4,2,0,2,0,3,0,0,0,0,0,0,0,0,0,0,1,3,4,5,5,4,4,4,4,4,4,3,3,2,2,1,1,1,1,0,0,0,0,5,10,10,4,6,5,15,37,37,8,8,7,10,13,13,21,9,7,3,7,15,2,1,1,16,18,16,10],
    morigasaki: [2,2,0,25,27,28,29,29,30,30,2,2,2,0,0,0,1,1,2,2,2,16,16,11,12,4,16,1,1,1,14,15,24,24,29,29,27,33,33,32,26,14,37,36,35,33,44,26,37,33,24,52,30,35,35,26,53,56,53,45,56,58,55,11,12,10,17,18,18,8,7,8],
    ukishima: [1,1,1,2,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,1,2,1,3,3,3,1,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,2,1,2,9,7,3,3,2,2,3,9,4,2,1,1,1,0,0,1,1,1,1,1],
    skybridge: [2,2,2,2,2,1,11,11,16,16,16,23,23,23,22,11,11,10,1,0,0,0,0,0,0,0,0,1,1,0,0,0,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,1,27,29,31,32,29,12,14,2,4,8,6,5,4,2,1,1,1,4,4,1,1,2,2],
    daishibashi: [11,0,0,3,5,0,0,44,48,53,56,52,0,0,0,0,0,0,0,52,53,36,33,33,0,1,0,1,0,0,1,9,9,0,0,0,0,0,0,1,2,0,0,1,1,0,1,0,1,3,6,10,10,17,17,2,2,28,28,9,4,4,3,2,1,1,1,2,1,1,1,0],
    rokugobashi: [5,7,5,5,7,8,52,53,26,0,25,24,11,16,24,23,21,20,7,37,36,32,14,23,22,0,0,0,0,71,76,77,80,1,15,15,6,0,0,1,0,2,1,3,2,2,50,49,5,3,3,5,10,33,122,125,125,125,122,10,8,3,2,16,16,2,1,18,5,4,3,5],
    gasbashi: [120,110,109,3,3,3,2,2,1,2,3,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,2,1,0,0,0,0,0,0,0,1,3,1,3,2,6,5,3,2,3,24,4,7,6,7,10,4,3,7,7,9,11,10,5,3,1,1,2,2,5,5,3,3,120],
    higashiogishima: [0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,1,2,1,4,3,1,1,0,0,0,0,0,0,0,0,0,0,1,1,3,0,0,3,1,5,2,5,11,5,5,1,7,5,6,3,4,1,3,1,1,0,0,0,0,0,0],
    marien: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,1,3,4,3,4,10,7,5,2,4,5,4,4,4,0,1,0,0,0,0,0,0,0,0],
    wakasu: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,2,0,0,0,0,0,0,0,0,1,2,2,0,0,1,0,0,3,6,7,3,3,2,4,3,5,3,2,1,0,0,0,0,0,0,0,0,0,0],
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

  const SoramiRoutes = { RJTT, runwayOf, OPERATIONS, operationFor, SPOTS,
                         approachPath, departurePath, HOURLY_MOVEMENTS, HOURLY_ARRIVALS, HOURLY_DEPARTURES,
                         trafficAt, destination, THRESHOLD_CROSSING_M, SPOT_HORIZONS, spotHorizonAt };
  global.SoramiRoutes = SoramiRoutes;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiRoutes;
})(typeof globalThis !== "undefined" ? globalThis : this);
