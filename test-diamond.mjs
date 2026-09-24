// ダイヤモンド富士・パール富士（`SoramiFuji.alignments`）。**通信しない。**
//
// 太陽が山頂の方位を横切る瞬間の高度差で判定する。
// 既知の名所の日付と突き合わせて固定する。地形（DEM）は使わず、
// 距離と標高から出した見上げ角を渡す（判定そのものを見るため）。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const A = require("./sorami-astro.js");
const TR = require("./sorami-terrain.js");
const F = require("./sorami-fuji.js");

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };
const jst = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ");
const mmdd = (ms) => jst(ms).slice(5, 10);

/// 地形を使わない幾何。山頂までの距離・方位と、目の高さからの見上げ角
const geomOf = (o) => {
  const d = TR.distanceKm(o.latitude, o.longitude, F.FUJI.latitude, F.FUJI.longitude);
  return { available: true, azimuthDeg: TR.bearing(o.latitude, o.longitude, F.FUJI.latitude, F.FUJI.longitude),
    topVisibleAngleDeg: A.targetElevationAngle(d, o.elevation + 1.5, F.FUJI.summitM),
    apexVisible: true, distanceKm: d };
};
const next = (o, opts = {}) => F.alignments(o, geomOf(o),
  { from: Date.parse("2026-09-24T00:00:00+09:00"), days: 400, ...opts });

console.log("== 既知の名所の日付に合う ==");
{
  // 高尾山（599m）: 冬至前後の日の入り
  const takao = next({ latitude: 35.6252, longitude: 139.2436, elevation: 599 }, { bodies: ["sun"], limit: 1 });
  ok(takao.sun.length === 1, "高尾山で回が見つかる");
  ok(mmdd(takao.sun[0].at) === "12-22", "高尾山は12月22日ごろ", jst(takao.sun[0].at));
  ok(takao.sun[0].side === "set", "日の入り側");

  // 田貫湖（休暇村側・660m）: 4月下旬と8月下旬の日の出
  const tanuki = next({ latitude: 35.3466, longitude: 138.5644, elevation: 660 }, { bodies: ["sun"], limit: 2 });
  ok(tanuki.sun.length === 2, "田貫湖は年2回");
  ok(tanuki.sun.every((e) => e.side === "rise"), "どちらも日の出側");
  ok(mmdd(tanuki.sun[0].at) === "04-21", "1回目は4月21日ごろ", jst(tanuki.sun[0].at));
  ok(mmdd(tanuki.sun[1].at) === "08-23", "2回目は8月23日ごろ", jst(tanuki.sun[1].at));

  // 江ノ島: 富士山は西北西。春と秋の日の入り
  const eno = next({ latitude: 35.2996, longitude: 139.4805, elevation: 5 }, { bodies: ["sun"], limit: 2 });
  ok(eno.sun.length === 2 && eno.sun.every((e) => e.side === "set"), "江ノ島は日の入り側で2回");
  ok(mmdd(eno.sun[0].at) === "04-06", "1回目は4月6日ごろ", jst(eno.sun[0].at));
}

console.log("== 重なり具合を言い分ける ==");
{
  const eno = next({ latitude: 35.2996, longitude: 139.4805, elevation: 5 }, { bodies: ["sun"], limit: 1 });
  const e = eno.sun[0];
  ok(Math.abs(e.gap) <= e.radius, "江ノ島は中心が半径の内側（重なる）", `ずれ${e.gap.toFixed(2)}°`);
  ok(["center", "overlap"].includes(e.rank), "ランクは ど真ん中 か 重なる", e.rankLabel);
  // 2026-09-24: 「前後◯〜◯も」は**中心が半径の内側に入る日だけ**を数える。
  // 縁がかすめる日まで含めると、冬至まわりは3週間になって「重なります」と言えない
  ok(e.dayCount >= 1 && e.to >= e.from, "重なる日をまとめて1回として返す", `${e.dayCount}日`);
  ok(e.grazeDays >= e.dayCount, "縁がかすめる日は別に数える", `${e.grazeDays}日`);

  // 高尾山の山頂は、中心が山頂の少し上を通る年がある。**言い切らない**
  const takao = next({ latitude: 35.6252, longitude: 139.2436, elevation: 599 }, { bodies: ["sun"], limit: 1 });
  ok(takao.sun[0].rank === "graze" && takao.sun[0].gap > 0,
    "中心が外れる年は「縁がかすめる」と言う", `ずれ${takao.sun[0].gap.toFixed(2)}°`);
  ok(takao.sun[0].dayCount <= takao.sun[0].grazeDays && takao.sun[0].dayCount === 1,
    "かすめるだけの回は「前後も」と言わない", `${takao.sun[0].dayCount}日 / かすめ${takao.sun[0].grazeDays}日`);
}

console.log("== 起きない場所 ==");
{
  const sapporo = next({ latitude: 43.06, longitude: 141.35, elevation: 20 }, { bodies: ["sun"], limit: 2 });
  ok(sapporo.sun.length === 0, "富士山が地平線より下の地点では回が無い");
  const none = F.alignments({ latitude: 35, longitude: 139, elevation: 0 }, { available: false });
  ok(none === null, "幾何が無ければ null");
}

console.log("== パール富士（月）==");
{
  const takao = next({ latitude: 35.6252, longitude: 139.2436, elevation: 599 }, { bodies: ["moon"], limit: 3 });
  ok(takao.moon.length === 3, "月も回が見つかる", takao.moon.map((m) => jst(m.at)).join(" / "));
  ok(takao.moon.every((m) => m.illuminated !== null && m.illuminated >= 0 && m.illuminated <= 1),
    "輝面の割合を返す", takao.moon.map((m) => Math.round(m.illuminated * 100) + "%").join(" / "));
  ok(takao.moon.every((m) => Math.abs(m.gap) <= 2 * m.radius), "山頂から外れすぎた回は返さない");
  ok(takao.moon.every((m, i, a) => i === 0 || m.at > a[i - 1].at), "時刻の順に並ぶ");
}

console.log("== 立つ場所で日付が変わる（代表地点では出せない理由）==");
{
  const south = next({ latitude: 35.3466, longitude: 138.5644, elevation: 660 }, { bodies: ["sun"], limit: 1 });
  const north = next({ latitude: 35.3556, longitude: 138.5644, elevation: 660 }, { bodies: ["sun"], limit: 1 });
  const shiftDays = Math.abs(south.sun[0].at - north.sun[0].at) / 86400000;
  ok(shiftDays >= 5, "南北に1kmで数日ずれる", `${shiftDays.toFixed(0)}日`);
}

console.log(`\n${fail === 0 ? "DIAMOND OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
