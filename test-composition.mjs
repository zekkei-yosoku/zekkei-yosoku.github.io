/*
 * 構図（パール富士・ダイヤモンド富士）の検査。**通信しない。**
 *
 * **構図が成立することと、撮れることは別**（§82）。ここは幾何だけを見る。
 * 天気は sorami-moon.js / sorami-fuji.js が別に持つ。
 *
 * 太陽そのものの正しさは米海軍天文台と照合済み（日の出・日の入りが4日とも1分以内）。
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const A = require("./sorami-astro.js");
const C = require("./sorami-composition.js");

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };
const FUJI = { latitude: 35.360555, longitude: 138.727363, elevationM: 3776, name: "富士山" };
const JST = 9 * 3600000;
const ymd = (ms) => new Date(ms + JST).toISOString().slice(0, 10);

console.log("== 対象の見かけの位置 ==");
{
  const tokyo = { latitude: 35.6586, longitude: 139.7454, elevation: 171 };
  const v = C.targetView(tokyo, FUJI);
  ok(Math.abs(v.altitude - 1.74) < 0.05, "東京タワーから富士山頂の仰角", `${v.altitude.toFixed(2)} 度`);
  ok(v.azimuth > 245 && v.azimuth < 255, "西南西", `${v.azimuth.toFixed(1)} 度`);
  ok(Math.abs(v.distanceKm - 98) < 3, "距離", `${v.distanceKm.toFixed(1)} km`);
}

console.log("== ダイヤモンド富士（太陽）==");
{
  // 田貫湖。**立つ位置で日付が変わる**のが本質（§81-83）
  const spots = [
    ["北岸", 35.3610, 138.5665],
    ["休暇村", 35.3556, 138.5658],
    ["南岸", 35.3495, 138.5670],
  ];
  const found = [];
  for (const [name, la, lo] of spots) {
    const obs = { latitude: la, longitude: lo, elevation: 660 };
    const al = C.findAlignments("sun", obs, FUJI,
      Date.UTC(2027, 3, 1) - JST, Date.UTC(2027, 4, 10) - JST, { stepMs: 120000 });
    ok(al.length > 0, `${name} で成立する日が見つかる`, al.map((a) => ymd(a.at)).join(", "));
    if (al.length) found.push({ name, day: new Date(al[0].at + JST).getUTCDate(), al: al[0] });
  }
  ok(found.length === 3, "3か所とも見つかった");
  if (found.length === 3) {
    // **1km 動くと日付が10日以上ずれる。** これが構図の本質
    const span = Math.max(...found.map((f) => f.day)) - Math.min(...found.map((f) => f.day));
    ok(span >= 8, "湖の端から端で日付が8日以上ずれる", `${span} 日`);
    // 南へ行くほど遅くなる（太陽の出る方位が北へ動くため）
    ok(found[0].day < found[2].day, "北岸のほうが早い",
       `北 ${found[0].day}日 → 南 ${found[2].day}日`);
    // 有名な4/20前後は南側
    ok(found[2].day >= 16 && found[2].day <= 22, "南岸は4月中〜下旬（有名な時期と合う）",
       `4/${found[2].day}`);
  }
  // 春と秋（夏至をまたいで2回）
  const obs = { latitude: 35.3495, longitude: 138.5670, elevation: 660 };
  const autumn = C.findAlignments("sun", obs, FUJI,
    Date.UTC(2027, 7, 1) - JST, Date.UTC(2027, 8, 15) - JST, { stepMs: 120000 });
  ok(autumn.length > 0, "8月にも成立する（年2回）", autumn.map((a) => ymd(a.at)).join(", "));
}

console.log("== パール富士（月）==");
{
  const obs = { latitude: 35.3495, longitude: 138.5670, elevation: 660 };
  // **定点からのパール富士は年に数回しかない**（1年ぶんを走査して実測。
  // 1.0度以内が8回、最接近 0.44度）。半年で「必ず複数」を期待するのは誤り
  const al = C.findAlignments("moon", obs, FUJI,
    Date.UTC(2027, 0, 1) - JST, Date.UTC(2028, 0, 1) - JST, { stepMs: 120000 });
  ok(al.length >= 1, "1年で見つかる", `${al.length} 回: ${al.map((a) => ymd(a.at)).join(", ")}`);
  ok(al.every((a) => a.separationDeg <= a.bodyRadiusDeg * 2 + 0.11), "どれも山頂付近に重なる");
  ok(al.every((a) => a.illuminatedFraction !== null), "月相も分かる");
  // 太陽より珍しい（太陽は年2回、決まった時期に来る）
  const sunCount = C.findAlignments("sun", obs, FUJI,
    Date.UTC(2027, 0, 1) - JST, Date.UTC(2028, 0, 1) - JST, { stepMs: 300000 }).length;
  ok(sunCount >= 2, "太陽は年2回以上", `${sunCount} 回`);
}

console.log("== 重なり方を区別する ==");
{
  const obs = { latitude: 35.3495, longitude: 138.5670, elevation: 660 };
  const al = C.findAlignments("sun", obs, FUJI,
    Date.UTC(2027, 3, 1) - JST, Date.UTC(2027, 4, 10) - JST, { stepMs: 60000 });
  ok(al.some((a) => ["on", "above", "behind"].includes(a.kind)), "山頂に乗るか重なるかを返す",
     al.map((a) => `${ymd(a.at)}:${a.kind}`).join(" "));
  for (const a of al) {
    ok(Math.abs(a.azimuthOffsetDeg) <= 1 && Math.abs(a.altitudeOffsetDeg) <= 1,
       `${ymd(a.at)} のずれが1度以内`,
       `方位 ${a.azimuthOffsetDeg.toFixed(2)} / 高度 ${a.altitudeOffsetDeg.toFixed(2)}`);
  }
}

console.log("== 名前 ==");
{
  ok(C.nameOf("moon", FUJI) === "パール富士", "月＋富士山＝パール富士");
  ok(C.nameOf("sun", FUJI) === "ダイヤモンド富士", "太陽＋富士山＝ダイヤモンド富士");
  ok(C.nameOf("moon", { name: "東京タワー" }) === "月と東京タワー", "他の対象は素直な名前");
}

console.log(`\n${fail === 0 ? "COMPOSITION OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
