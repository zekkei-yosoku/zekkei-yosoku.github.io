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
      { ident: "16L", threshold: { latitude: 35.565897, longitude: 139.78655 }, headingDegT: 150, elevationM: 7 },
      { ident: "16R", threshold: { latitude: 35.560452, longitude: 139.768734 }, headingDegT: 150, elevationM: 6 },
      { ident: "22", threshold: { latitude: 35.567459, longitude: 139.777114 }, headingDegT: 215, elevationM: 11 },
      { ident: "04", threshold: { latitude: 35.549015, longitude: 139.761274 }, headingDegT: 35, elevationM: 6 },
      { ident: "23", threshold: { latitude: 35.540598, longitude: 139.822125 }, headingDegT: 223, elevationM: 17 },
      { ident: "05", threshold: { latitude: 35.524001, longitude: 139.803469 }, headingDegT: 57, elevationM: 14 },
    ],
  };
  const runwayOf = (ident) => RJTT.runways.find((r) => r.ident === ident) || null;

  /**
   * 運用の向き。**風で決まる。**
   *   北風運用 … 南から進入して北へ降りる（34L/34R）。出発は 05 と 34R
   *   南風運用 … 北から進入して南へ降りる（16L/16R）。出発は 22 と 16L
   * 南風の到着は都心の上を通る（2020年からの経路）。**15〜19時だけ**。
   */
  const OPERATIONS = {
    north: { name: "北風運用", landing: ["34L", "34R"], takeoff: ["05", "34R"] },
    south: { name: "南風運用", landing: ["16L", "16R"], takeoff: ["22", "16L"],
             landingHours: [15, 19], note: "南風の到着は都心の上空。15〜19時だけです" },
  };

  /**
   * 風の向きから運用を決める。滑走路の向き（北北西／南南東）に対し、
   * **向かい風になるほうへ降りる**。真南北成分だけを見る。
   * @param {number} windFromDeg 風が吹いてくる方位（気象の風向）
   */
  function operationFor(windFromDeg) {
    if (!Number.isFinite(windFromDeg)) return null;
    // 滑走路の軸は 330°/150°。風がその軸の北寄り半面から吹けば北風運用
    const diff = ((windFromDeg - 330 + 540) % 360) - 180;
    return Math.abs(diff) < 90 ? "north" : "south";
  }

  /**
   * 進入の経路。滑走路のしきい値から**手前へ**まっすぐ伸ばし、3°で上がる。
   * @returns {{latitude,longitude,altitudeM,distanceKm}[]} 近い順
   */
  function approachPath(ident, { fromKm = 2, toKm = 30, stepKm = 0.5, slopeDeg = 3 } = {}) {
    const rw = runwayOf(ident);
    if (!rw) return [];
    const back = (rw.headingDegT + 180) % 360;
    const out = [];
    for (let d = fromKm; d <= toKm + 1e-9; d += stepKm) {
      const p = destination(rw.threshold.latitude, rw.threshold.longitude, back, d);
      out.push({ ...p, altitudeM: rw.elevationM + d * 1000 * Math.tan(slopeDeg * DEG), distanceKm: d });
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
   * 1時間あたりのだいたいの便数。**羽田の運用時間の目安で、実測ではない。**
   * ADS-B の受信記録がたまれば、ここを実測へ置き換える。
   * 深夜（23〜6時）は国際線が少し。日中は多い。
   */
  const HOURLY_MOVEMENTS = [
    4, 3, 2, 2, 2, 6, 24, 40, 44, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 40, 36, 30, 18, 8,
  ];
  const trafficAt = (hourJst) => HOURLY_MOVEMENTS[((hourJst % 24) + 24) % 24];

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
                         approachPath, departurePath, HOURLY_MOVEMENTS, trafficAt, destination };
  global.SoramiRoutes = SoramiRoutes;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiRoutes;
})(typeof globalThis !== "undefined" ? globalThis : this);
