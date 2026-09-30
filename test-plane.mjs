// 月丼（`sorami-routes.js` / `sorami-plane.js`）。**通信しない。**
//
// 滑走路の座標と真方位は OurAirports の実測値。そこから引いた進入経路が
// 実際の位置に合うか、公表されている事実で答え合わせする。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const RT = require("./sorami-routes.js");
const P = require("./sorami-plane.js");

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };
const jst = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(11, 16);
const day = (s) => Date.parse(`${s}T00:00:00+09:00`);

console.log("== 運用の向きは風で決まる ==");
{
  ok(RT.operationFor(0) === "north" && RT.operationFor(340) === "north", "北寄りの風は北風運用");
  ok(RT.operationFor(180) === "south" && RT.operationFor(200) === "south", "南寄りの風は南風運用");
  // 滑走路の軸は 330°/150°。**真横（60°/240°）がちょうど境目**で、
  // そこを1度でも越えると 34 には追い風になる
  ok(RT.operationFor(59) === "north", "60°の手前までは北風運用");
  ok(RT.operationFor(61) === "south", "60°を越えると 34 には追い風なので南風運用");
  ok(RT.operationFor(239) === "south" && RT.operationFor(241) === "north", "反対側の境目も同じ");
  ok(RT.operationFor(150) === "south", "真南東は南風運用");
  ok(RT.operationFor(null) === null, "風が無ければ決めない");
}

console.log("== 進入経路 ==");
{
  // 34L は南から北へ降りる。経路は滑走路の**南南東**へ伸びる
  const p = RT.approachPath("34L", { fromKm: 5, toKm: 20, stepKm: 5 });
  ok(p.length === 4, "4点", `${p.length}点`);
  const rw = RT.runwayOf("34L");
  ok(p.every((q) => q.latitude < rw.threshold.latitude), "北へ降りるので経路は南側");
  ok(p.every((q) => q.longitude > rw.threshold.longitude), "330°の反対＝150°なので東寄り");
  // 3°の降下角。10km手前で約545m（10000×tan3° ＝ 524m ＋ 滑走路の端を越える高さ15m ＋ 標高）
  const at10 = p.find((q) => q.distanceKm === 10);
  ok(Math.abs(at10.altitudeM - 545) < 5, "10km手前で約545m", `${Math.round(at10.altitudeM)}m`);
  // 公表の進入図: ILS Z RWY 34L は APOLO（D15.1＝約28km）で 5000ft（1524m）からグライドスロープに乗る
  const at28 = RT.approachPath("34L", { fromKm: 28, toKm: 28 })[0];
  ok(Math.abs(at28.altitudeM - 1524) < 120, "28km手前で約5000ft（進入図の APOLO と合う）", `${Math.round(at28.altitudeM)}m`);
  ok(p.every((q, i, a) => i === 0 || q.altitudeM > a[i - 1].altitudeM), "遠いほど高い");

  // 16L は北から南へ降りる。経路は滑走路の北側
  const q16 = RT.approachPath("16L", { fromKm: 5, toKm: 10, stepKm: 5 });
  const rw16 = RT.runwayOf("16L");
  ok(q16.every((q) => q.latitude > rw16.threshold.latitude), "南へ降りるので経路は北側");
}

console.log("== 立ち位置は月の反対側 ==");
{
  const path = [{ latitude: 35.5, longitude: 139.8, altitudeM: 1000 }];
  // 月が真東（90°）の高度10°にいるなら、立ち位置は機体の**西**
  const west = P.standLine(path, { azimuth: 90, apparentAltitude: 10 }, 0);
  ok(west.length === 1 && west[0].longitude < 139.8, "東の月なら西に立つ",
    west[0] && west[0].longitude.toFixed(3));
  // 高度10°・機体1000m なら、5.7km 離れる（1000/tan10° ＝ 5671m）
  ok(Math.abs(west[0].planeKm - 5.67) < 0.1, "距離は 高さ/tan(月の高度)",
    `${west[0].planeKm.toFixed(2)}km`);
  // 月が高いほど近づく
  const high = P.standLine(path, { azimuth: 90, apparentAltitude: 40 }, 0);
  ok(high[0].planeKm < west[0].planeKm, "月が高いほど機体に近づく",
    `10°で${west[0].planeKm.toFixed(1)}km → 40°で${high[0].planeKm.toFixed(1)}km`);
  // 地平線より下の月では引かない
  ok(P.standLine(path, { azimuth: 90, apparentAltitude: -3 }, 0).length === 0, "月が出ていなければ無い");
}

console.log("== 見え方の良し悪し ==");
{
  const base = { illuminated: 1, sunAltitude: -18, planeKm: 8 };
  ok(P.quality(base) === 1, "満月・夜・8km が満点", String(P.quality(base)));
  ok(P.quality({ ...base, planeKm: 1.5 }) === 0, "2km未満は機体が月からはみ出す");
  ok(P.quality({ ...base, planeKm: 25 }) < 0.5, "20km超は点になる");
  ok(P.quality({ ...base, illuminated: 0.05 }) < 0.45, "新月に近いと弱い");
  ok(P.quality({ ...base, sunAltitude: 30 }) < 0.5, "真昼は落ちる");
  ok(P.quality({ ...base, sunAltitude: -3 }) > P.quality({ ...base, sunAltitude: 20 }),
    "薄明は真昼より良い");
}

console.log("== 狙い目 ==");
{
  // 2026-11-24 は満月に近い（輝面99%）。北風運用の到着を狙う
  const r = P.findSpots(day("2026-11-24"), P.pathsFor("north", { landing: true }), { limit: 5 });
  ok(r.spots.length === 5, "候補が出る", `${r.spots.length}件`);
  ok(r.illuminated > 0.9, "満月に近い日", `${Math.round(r.illuminated * 100)}%`);
  const top = r.spots[0];
  ok(top.planes >= 10, "待つあいだに10機以上", `約${top.planes}機`);
  ok(top.best.planeKm >= 2 && top.best.planeKm <= 20, "機体の距離が範囲内",
    `${top.best.planeKm.toFixed(1)}km`);
  ok(top.best.moonAlt >= 2 && top.best.moonAlt <= 30, "月は低い", `${top.best.moonAlt.toFixed(0)}°`);
  ok(top.from < top.to, "時間帯を持つ", `${jst(top.from)}〜${jst(top.to)}`);
  // 進入は羽田の南に伸びるので、狙い目も南側
  ok(r.spots.every((s) => s.latitude < RT.RJTT.latitude), "北風運用の狙い目は羽田の南");

  // 月が出ない日は空になる（高度の窓を極端に狭めて確かめる）
  const none = P.findSpots(day("2026-11-24"), P.pathsFor("north", { landing: true }),
    { minMoonAlt: 88, maxMoonAlt: 89 });
  ok(none.spots.length === 0 && none.samples === 0, "条件に合う月が無ければ空");
}

console.log("== 海の上は落とす ==");
{
  const r = P.findSpots(day("2026-11-24"), P.pathsFor("north", { landing: true }), { limit: 50 });
  // 標高タイルの代わりに、緯度で陸と海を作る
  const fake = async (lat) => (lat > 35.40 ? 5 : null);
  const land = await P.keepOnLand(r.all, fake, 5);
  ok(land.length === 5, "陸だけで5件そろう", `${land.length}件`);
  ok(land.every((s) => s.latitude > 35.40), "海の点が混ざらない");
  ok(land.every((s) => Number.isFinite(s.elevationM)), "標高を持って返る");
  const noFilter = await P.keepOnLand(r.all, null, 3);
  ok(noFilter.length === 3, "判定できなければそのまま返す");
}

console.log("== 展望台の上は目が高い ==");
{
  // 2026-09-28 ユーザー「月丼は展望台からでも撮れるのでは」→ そのとおりで、
  // 目が高いほど機体との高低差が縮み、同じ月の高さでも近くを通る機を狙える。
  // 低い月は地上だと街に隠れるので、展望台のほうが有利なことも多い。
  const day2 = day("2026-11-24");
  const at = (deckM) => P.rankSpots(day2, P.pathsFor("north", { landing: true }),
    [{ id: "x", name: "ためし", latitude: 35.3130, longitude: 139.8108, deckM }],
    { stepMin: 2, limit: 1 })[0];
  const low = at(0), high = at(150);
  ok(low && high, "どちらも候補になる");
  // 目が高いほど、**同じ機体に重ねるのに必要な距離が縮む**（高低差が減るため）
  const path = [{ latitude: 35.45, longitude: 139.85, altitudeM: 1200 }];
  const moon = { azimuth: 30, apparentAltitude: 7 };
  const dGround = P.standLine(path, moon, 0, { eyeM: 1.5 })[0].planeKm;
  const dDeck = P.standLine(path, moon, 0, { eyeM: 150 })[0].planeKm;
  ok(dDeck < dGround, "目が高いほど、重ねるのに要る距離が縮む",
    `地上1.5m で ${dGround.toFixed(1)}km → 150m で ${dDeck.toFixed(1)}km`);
  // 重なる時刻もずれる（同じ場所でも、目の高さで合う瞬間が変わる）
  ok(low.best.at !== high.best.at, "重なる時刻がずれる",
    `${jst(low.best.at)} → ${jst(high.best.at)}`);
  // 展望台の高さを渡さなければ、これまでどおり地面
  const none = P.rankSpots(day2, P.pathsFor("north", { landing: true }),
    [{ id: "x", name: "ためし", latitude: 35.3130, longitude: 139.8108 }], { stepMin: 2, limit: 1 })[0];
  ok(none && Math.abs(none.best.planeKm - low.best.planeKm) < 0.01, "高さが無ければ地面と同じ");
  // 定番の場所にも展望台の高さが入っている
  const decks = RT.SPOTS.filter((x) => Number.isFinite(x.deckM));
  ok(decks.length >= 5, "展望台の高さを持つ場所がある", `${decks.length}件`);
  ok(RT.SPOTS.find((x) => x.id === "chibaport").deckM === 113, "千葉ポートタワーは地上113m");
}

console.log("== 運用は風の強さと時刻でも決まる（2026-09-28） ==");
{
  // 優先滑走路: 風が弱ければ北風運用のまま。34 への追い風が 5kt（2.6m/s）を超えたら南風
  ok(RT.operationFor(180, 1.5, 12) === "north", "弱い南風（1.5m/s）は北風運用のまま");
  ok(RT.operationFor(150, 2.5, 12) === "north", "真正面の南風でも 2.5m/s なら北風運用");
  ok(RT.operationFor(150, 3.0, 16) === "south", "3m/s の南風・16時は都心上空の南風運用");
  ok(RT.operationFor(150, 3.0, 21) === "southBay", "同じ南風でも21時は湾側から降りる");
  ok(RT.operationFor(150, 3.0, 14) === "southBay", "14時も湾側（都心上空は15〜19時だけ）");
  ok(RT.operationFor(150, 3.0, 19) === "southBay", "19時ちょうどからは湾側");
  ok(RT.operationFor(350, 12, 16) === "north", "強い北風は北風運用");
  // 横風（真横 60°）は 34 への追い風成分がほぼ 0 なので北風運用
  ok(RT.operationFor(60, 8, 16) === "north", "真横の風は追い風にならないので北風運用");
  // 風速を渡さなければ従来どおり向きだけ
  ok(RT.operationFor(180) === "south", "風速が無ければ向きだけで決める（従来）");
  // 湾側の南風運用は 22・23 へ。経路は滑走路の北東へ伸びる
  const bay = P.pathsFor("southBay", { landing: true });
  ok(bay.map((p) => p.runway).join(",") === "22,23", "湾側の南風は 22・23 へ降りる");
  const rw22 = RT.runwayOf("22");
  ok(bay[0].points.every((q) => q.latitude > rw22.threshold.latitude && q.longitude > rw22.threshold.longitude),
    "22 への進入は北東から");
}

console.log("== 重なりは交点を解く（2026-09-28） ==");
{
  // 以前は 0.5km 刻みの最寄り点と月の角度が 1° 以内なら「重なる」としていた。
  // 8km 先では点と点が空の上で 3.6° 離れ、真上を通っても外し、1° ずれても当たりにしていた。
  const A = require("./sorami-astro.js");
  const d0 = day("2026-11-24");
  let checked = 0, worst = 0;
  for (const spot of RT.SPOTS) {
    const obs = { latitude: spot.latitude, longitude: spot.longitude, elevation: spot.deckM ?? 0 };
    const track = [];
    for (let i = 0; i <= 720; i++) {
      const at = d0 + i * 120000; const m = A.moon(at, obs);
      track.push({ at, azimuth: m.azimuth, altitude: m.apparentAltitude,
        illuminated: m.illuminatedFraction, use: m.apparentAltitude >= 2 && m.apparentAltitude <= 30 });
    }
    for (const path of P.pathsFor("north", { landing: true })) {
      for (const c of P.crossingsFrom(obs, path, track)) {
        if (c.moonAlt < 2 || c.moonAlt > 30) continue;
        // 交点の時刻の月と、経路を 10m 刻みにした点との最小角度
        const m = A.moon(c.at, obs);
        let best = 9;
        for (const pt of RT.approachPath(path.runway, { fromKm: 2, toKm: 30, stepKm: 0.01 })) {
          const v = P.seenFrom(obs, pt, 1.5);
          best = Math.min(best, P.separation(v.azimuth, v.altitude, m.azimuth, m.apparentAltitude));
        }
        worst = Math.max(worst, best); checked++;
        if (c.diskMin <= 0 || c.windowMin < c.diskMin) worst = 99;
      }
    }
  }
  ok(checked >= 3, "定番の場所で交点が見つかる", `${checked}件`);
  ok(worst < P.MOON_RADIUS_DEG, "交点の時刻に、機体は月の円盤の中にいる",
    `最大 ${worst.toFixed(3)}°（月の半径 ${P.MOON_RADIUS_DEG}°）`);
  // 観測者の背後を回る区間が、方位の ±180° で「月の前を横切る線」に化けないこと
  const r = P.rankSpots(d0, P.pathsFor("north", { landing: true }), RT.SPOTS, { limit: 30 });
  ok(r.every((s) => s.crossings.every((c) => c.planeKm >= 2 && c.planeKm <= 20)), "機体の距離はすべて範囲内");
  // 使われていない経路は数えない
  const none = P.rankSpots(d0, P.pathsFor("north", { landing: true }), RT.SPOTS,
    { limit: 30, activeAt: () => false });
  ok(none.length === 0, "その時刻に使われていない経路では重ならない");
  const onlyL = P.rankSpots(d0, P.pathsFor("north", { landing: true }), RT.SPOTS,
    { limit: 30, activeAt: (p) => p.runway === "34L" });
  ok(onlyL.every((s) => s.paths.every((id) => id.startsWith("34L"))), "使われている経路だけ数える");
  // 期待機数は「円盤が航路にかかっている時間 × 便数」。構える時間はそれより長い
  ok(r.every((s) => s.crossings.every((c) => c.windowMin >= c.diskMin)), "構える時間は円盤の時間より長い");
}

console.log("== 便数と降下角は公表値に合わせる（2026-09-28） ==");
{
  // 国交省: 年間 48.6万回（2020年3月〜）＝1日 約1,330回。以前の目安は1日約800回で6割しかなかった
  const perDay = RT.HOURLY_MOVEMENTS.reduce((a, b) => a + b, 0);
  ok(Math.abs(perDay * 365 - 486000) / 486000 < 0.03, "年間の発着回数が公表値（48.6万回）の±3%",
    `${perDay}回/日 × 365 = ${(perDay * 365 / 10000).toFixed(1)}万回`);
  // 1時間の上限は 84回（従来）〜90回（新経路の時間帯）。それを超えない
  ok(RT.HOURLY_MOVEMENTS.every((n) => n <= 90), "どの時間も上限90回以下");
  // 到着と出発は時間帯でまるで違う（時刻表: 7時台は到着6・出発50、21時台は到着44・出発18）。
  // 以前は「発着×半分」で、朝の到着を6倍に見積もっていた
  ok(RT.trafficAt(7, "landing") === 6 && RT.trafficAt(7, "takeoff") === 50, "7時台は出発が多い（到着6・出発50）");
  ok(RT.trafficAt(21, "landing") === 44 && RT.trafficAt(21, "takeoff") === 18, "21時台は到着が多い（到着44・出発18）");
  ok(RT.HOURLY_ARRIVALS.reduce((a, b) => a + b, 0) === 665 && RT.HOURLY_DEPARTURES.reduce((a, b) => a + b, 0) === 664,
    "時刻表の合計（到着665・出発664）");
  // 南風の都心上空ルート（16L/16R）は好天時 RNAV で 3.45°。ほかは 3.0°
  const at = (rw) => RT.approachPath(rw, { fromKm: 10, toKm: 10 })[0].altitudeM;
  ok(Math.abs(at("16L") - (7 + 15 + 10000 * Math.tan(3.45 * Math.PI / 180))) < 1, "16L は 3.45°（10km手前で約625m）",
    `${Math.round(at("16L"))}m`);
  ok(Math.abs(at("34L") - (6 + 15 + 10000 * Math.tan(3 * Math.PI / 180))) < 1, "34L は 3.0°（10km手前で約545m）",
    `${Math.round(at("34L"))}m`);
  // 滑走路の端は 15m（50ft）で越える（ICAO の標準）
  ok(Math.abs(RT.approachPath("34L", { fromKm: 0, toKm: 0 })[0].altitudeM - 21) < 0.5, "滑走路の端を15mで越える");
  // 機体の見上げ角は地球の丸みと大気差を含む（平らとして解くと 20km 先で 0.08° 高く出る）
  const flat = Math.atan2(1000, 20000) * 180 / Math.PI;
  const curved = P.seenFrom({ latitude: 35.5, longitude: 139.8, elevation: 0 },
    { ...RT.RJTT.runways[0].threshold, altitudeM: 1000 }, 0).altitude;
  const d = P.distanceKm(35.5, 139.8, RT.RJTT.runways[0].threshold.latitude, RT.RJTT.runways[0].threshold.longitude);
  const flatHere = Math.atan2(1000, d * 1000) * 180 / Math.PI;
  ok(curved < flatHere, "見上げ角は丸みのぶん低い", `${d.toFixed(1)}km 先 1000m: 平ら ${flatHere.toFixed(3)}° → ${curved.toFixed(3)}°`);
}

console.log("== 定番の場所の地平線（2026-09-30） ==");
{
  // 建物と地形で空が隠れる高さを、定番21か所ぶん測って持つ
  ok(Object.keys(RT.SPOT_HORIZONS).length === RT.SPOTS.length, "定番の場所すべてに地平線がある",
    `${Object.keys(RT.SPOT_HORIZONS).length}/${RT.SPOTS.length}`);
  ok(RT.SPOT_HORIZONS.t2.length === 72, "方位5°ごと（72本）");
  // 第2ターミナルは北〜東が建物で塞がる
  ok(RT.spotHorizonAt("t2", 45) > 30, "第2ターミナルは北東が建物で高く塞がる", `${RT.spotHorizonAt("t2", 45).toFixed(1)}°`);
  ok(RT.spotHorizonAt("umihotaru", 180) < 1, "海ほたるの南は海で開けている");
  ok(RT.spotHorizonAt("unknown", 90) === 0, "測っていない場所は 0");
  // OSM に高さの入った建物が無い5か所は、種類ごとの目安の高さで数えた（2026-09-30）
  ok(RT.spotHorizonAt("ukishima", 310) > 7, "浮島町公園は北西の工場で 7° 以上塞がる", `${RT.spotHorizonAt("ukishima", 310).toFixed(1)}°`);
  ok(RT.spotHorizonAt("ukishima", 60) < 2, "浮島町公園の北東（羽田の着陸機の側）は開けている", `${RT.spotHorizonAt("ukishima", 60).toFixed(1)}°`);
  // 地平線の下に月があるときは数えない
  const d0 = day("2026-11-24");
  const open = P.rankSpots(d0, P.pathsFor("north", { landing: true }),
    [{ id: "x", name: "ためし", latitude: 35.3130, longitude: 139.8108 }], { limit: 1 })[0];
  const blocked = P.rankSpots(d0, P.pathsFor("north", { landing: true }),
    [{ id: "x", name: "ためし", latitude: 35.3130, longitude: 139.8108, horizonAt: () => 45 }], { limit: 1 })[0];
  ok(open && !blocked, "地平線が45°の場所では、低い月の回は数えない");
}

console.log(`\n${fail === 0 ? "PLANE OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
