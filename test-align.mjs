// 「ねらう」の計算（`sorami-align.js`）。**通信しない。**
//
// 線: その日に重なって見える観測点の並び。
//   目標までの距離が決まれば見上げ角が決まり、その高度を天体が通る時刻と方位が決まる。
//   観測者は目標から見てその方位の**反対側**にいる。
// 答え合わせは既知の名所で行う（高尾山の冬至のダイヤモンド富士）。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const TR = require("./sorami-terrain.js");
const AL = require("./sorami-align.js");

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };
const jst = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ");

const fuji = AL.targetById("fuji");
const skytree = AL.targetById("skytree");
const TAKAO = { latitude: 35.6252, longitude: 139.2436, elevation: 599 };

console.log("== 線が既知の名所を通る ==");
{
  // 2026-12-22 の日の入側の線は、高尾山（山頂 599m）を通る
  const day = Date.parse("2026-12-22T00:00:00+09:00");
  const lines = await AL.line(fuji, "sun", day, { sides: ["set"], minKm: 40, maxKm: 70, stepKm: 5, partId: "summit" });
  ok(lines.length === 1 && lines[0].points.length >= 5, "日の入側の線が引ける",
    `${lines[0] ? lines[0].points.length : 0}点`);
  const near = lines[0].points.reduce((a, b) =>
    (TR.distanceKm(TAKAO.latitude, TAKAO.longitude, b.latitude, b.longitude)
      < TR.distanceKm(TAKAO.latitude, TAKAO.longitude, a.latitude, a.longitude) ? b : a));
  const off = TR.distanceKm(TAKAO.latitude, TAKAO.longitude, near.latitude, near.longitude);
  ok(off < 1, "高尾山から1km以内を通る", `${off.toFixed(2)}km / ${jst(near.at)}`);
  ok(jst(near.at).slice(11) > "15:30" && jst(near.at).slice(11) < "16:40", "時刻も日の入ごろ", jst(near.at));
}

console.log("== 観測者は天体の反対側 ==");
{
  // 日の入のダイヤモンド富士は、富士山の**東**から見る（太陽は西へ沈む）
  const day = Date.parse("2026-12-22T00:00:00+09:00");
  const lines = await AL.line(fuji, "sun", day, { sides: ["set"], minKm: 30, maxKm: 60, stepKm: 10, partId: "summit" });
  ok(lines[0].points.every((p) => p.longitude > fuji.longitude), "日の入側の線は富士山の東側",
    lines[0].points.map((p) => p.longitude.toFixed(2)).join(" / "));
  const rise = await AL.line(fuji, "sun", day, { sides: ["rise"], minKm: 30, maxKm: 60, stepKm: 10, partId: "summit" });
  ok(rise.length === 0 || rise[0].points.every((p) => p.longitude < fuji.longitude), "日の出側は西側");
}

console.log("== どこに重ねるかで場所が変わる ==");
{
  const day = Date.parse("2026-12-22T00:00:00+09:00");
  const at = (partId, limb) => AL.solvePoint(skytree, "moon", day, 10, "set", { partId, limb });
  const tipTop = await at("tip", "onTop");
  const tipCenter = await at("tip", "center");
  const tipBehind = await at("tip", "behind");
  const gallery = await at("gallery", "center");
  const d = (a, b) => TR.distanceKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;
  ok(tipTop && tipCenter && tipBehind && gallery, "先端と天望回廊、3つの合わせ方すべてで解ける");
  ok(d(tipTop, tipCenter) > 10 && d(tipTop, tipCenter) < 200,
    "「てっぺんに乗る」と「中心が重なる」は数十m違う", `${Math.round(d(tipTop, tipCenter))}m`);
  ok(d(tipCenter, gallery) > 100, "先端と天望回廊（第二展望台）は100m以上違う",
    `${Math.round(d(tipCenter, gallery))}m`);
  ok(tipTop.altitude > tipCenter.altitude && tipCenter.altitude > tipBehind.altitude,
    "乗る→中心→隠れる の順に、天体の高度が下がる");
}

console.log("== 一覧（この地点で次に重なる日）==");
{
  const from = Date.parse("2026-09-25T00:00:00+09:00");
  const rows = AL.upcoming(TAKAO, fuji, "sun", { from, days: 400, limit: 3, partId: "summit" });
  ok(rows.length >= 1, "高尾山から富士山×太陽の回が見つかる", rows.map((r) => jst(r.at)).join(" / "));
  ok(jst(rows[0].at).slice(0, 10) === "2026-12-22", "冬至ごろ", jst(rows[0].at));
  ok(rows[0].side === "set", "日の入側");
  const moon = AL.upcoming({ latitude: 35.67, longitude: 139.91, elevation: 3 }, skytree, "moon",
    { from, days: 400, limit: 3, partId: "tip", limb: "onTop" });
  ok(moon.length >= 1 && moon.every((m) => m.illuminated !== null), "スカイツリー×月も出て、輝面を持つ",
    moon.map((m) => `${jst(m.at)} ${Math.round(m.illuminated * 100)}%`).join(" / "));
}

console.log("== 線の長さは目標の高さで決まる ==");
{
  // 60mの避雷針を120km先から見上げても地平線の下。距離の幅を高さから決める
  const fuji = AL.lineRange(3776), tink = AL.lineRange(60);
  ok(fuji.maxKm > 100 && fuji.minKm > 5, "富士山は数kmより外〜100km超", JSON.stringify(fuji));
  ok(tink.maxKm <= 5 && tink.minKm < 1, "60mの目標は数km以内", JSON.stringify(tink));
  const day = Date.parse("2026-10-06T00:00:00+09:00");
  const tb = AL.targetById("tinkerbell");
  const lines = await AL.line(tb, "moon", day, { partId: "tip", limb: "onTop" });
  ok(lines.length === 2, "距離を渡さなくても線が引ける", `${lines.length}本`);
  ok(lines.every((l) => l.points.every((p) => p.altitude > 0)), "どの点も地平線より上");
  const set = lines.find((l) => l.side === "set");
  ok(set.points.every((p) => p.longitude > tb.longitude), "月の入側は目標の東");
}

console.log("== 目標の高さが無ければ計算しない ==");
{
  const day = Date.parse("2026-12-22T00:00:00+09:00");
  const bad = { id: "x", name: "高さ未設定", latitude: 35.6, longitude: 139.7, parts: [] };
  ok((await AL.line(bad, "sun", day, { minKm: 10, maxKm: 20, stepKm: 5 })).length === 0, "線は引けない");
  ok(AL.upcoming(TAKAO, bad, "sun", { from: day, days: 5 }).length === 0, "一覧も空");
}

console.log(`\n${fail === 0 ? "ALIGN OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
