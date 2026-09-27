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
  // 3°の降下角。10km手前で約530m（10000×tan3° ＝ 524m ＋ 標高）
  const at10 = p.find((q) => q.distanceKm === 10);
  ok(Math.abs(at10.altitudeM - 530) < 15, "10km手前で約530m", `${Math.round(at10.altitudeM)}m`);
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

console.log(`\n${fail === 0 ? "PLANE OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
