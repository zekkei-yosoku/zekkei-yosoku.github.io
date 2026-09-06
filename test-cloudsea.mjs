/*
 * 雲海の判定の回帰テスト。
 *
 * 雲海が見えるには3つ要る（三菱自動車「雲海の仕組み」）:
 *   1. 低いところで霧ができる
 *   2. 逆転層が天井になって雲頂高度が決まる
 *   3. 観察者がその雲頂より高い位置にいる
 * 3 をまったく見ていなかったので、点数が高くても現地で霧の中に立つことがあり得た。
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");

let pass = 0, fail = 0;
const ok = (c, label, detail = "") => {
  if (c) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? "  " + detail : ""}`); }
};

// 気温が高度とともに下がる（逆転なし）／途中から上がる（逆転あり）分布を作る。
const day = Date.UTC(2026, 10, 15) - 9 * 3600000;
const times = Array.from({ length: 48 }, (_, i) => day + i * 3600000);
const build = (profile, surface = {}) => {
  const cols = {
    temperature_2m: times.map((_, i) => (i % 24 >= 12 && i % 24 <= 15 ? 18 : 4)),
    wind_speed_10m: times.map(() => surface.wind ?? 0.5),
    relative_humidity_2m: times.map(() => surface.humidity ?? 95),
    // 露点。既定は気温にほぼ張り付かせる（飽和寸前＝霧ができる側）。
    dew_point_2m: times.map((_, i) =>
      (i % 24 >= 12 && i % 24 <= 15 ? 18 : 4) - (surface.dewDep ?? 0.5)),
    cloud_cover: times.map(() => surface.cloud ?? 5),
    precipitation: times.map(() => surface.rain ?? 0),
  };
  for (const [lvl, [h, t]] of Object.entries(profile)) {
    cols[`geopotential_height_${lvl}hPa`] = times.map(() => h);
    cols[`temperature_${lvl}hPa`] = times.map(() => t);
    cols[`relative_humidity_${lvl}hPa`] = times.map(() => 95);
  }
  return new S.Series(times, cols);
};
const run = (home, elevation) => {
  const input = { home, offsets: {}, lat: 35.3, lon: 134.83,
    terrain: "basinRim", elevation, lightPollution: null, air: null };
  const w = S.SCORERS.seaOfClouds.window(day + 24 * 3600000, input);
  const r = S.SCORERS.seaOfClouds.score(w, input);
  return r;
};
// 250m から上が暖かい＝逆転層の底が 250m
const withInversion = { 1000: [80, 3], 975: [250, 3], 950: [500, 8], 925: [760, 7], 900: [1000, 6], 850: [1500, 2] };
// 単調に下がる＝逆転なし
const noInversion   = { 1000: [80, 8], 975: [250, 7], 950: [500, 6], 925: [760, 5], 900: [1000, 4], 850: [1500, 0] };

console.log("== 観察者が雲海の上か中か ==");
const above = run(build(withInversion), 800);   // 逆転層の底 250m より十分上
const inside = run(build(withInversion), 200);  // 逆転層より下＝霧の中
ok(!above.unavailable && !inside.unavailable, "どちらも採点できる");
ok(above.score > inside.score, "見下ろせるほうが高い", `上${above.score.toFixed(0)} / 中${inside.score.toFixed(0)}`);
ok(S.rankOf(inside.score).key === "poor", "霧の中に入る日は「不向き」", S.rankOf(inside.score).label);
ok(above.factors.some((f) => f.detail && f.detail.includes("見下ろせます")), "見下ろせると書く");
ok(inside.factors.some((f) => f.detail && f.detail.includes("霧の中に入ります")), "中に入ると書く");

console.log("== 逆転層が見つからないときは何もしない ==");
// 「天井が無い」のか「モデルが捉えていない」のか区別できない。
const flat = run(build(noInversion), 800);
ok(!flat.factors.some((f) => f.label.startsWith("雲海の天井")), "天井の行を出さない");
ok(flat.score > inside.score, "見つからないことを理由に下げない",
  `逆転なし${flat.score.toFixed(0)} / 中に入る${inside.score.toFixed(0)}`);

console.log("== 成因を名指しする ==");
const radiative = run(build(withInversion, { rain: 0, cloud: 5 }), 800);   // 晴れた夜・雨なし
ok(radiative.factors.some((f) => f.label.includes("放射霧")), "冷え込みが効いていれば放射霧",
  radiative.factors.filter((f) => f.label.startsWith("型:")).map((f) => f.label).join(""));
const afterRain = run(build(withInversion, { rain: 3, cloud: 5 }), 800);
ok(afterRain.factors.some((f) => f.label.includes("雨上がり")), "前日に雨があれば雨上がりの雲海",
  afterRain.factors.filter((f) => f.label.startsWith("型:")).map((f) => f.label).join(""));

// --- 採点から外した項が、本当に採点へ入っていないこと ---
//
// 実測（秩父の公式ベストショット162日）で、風速も前日最高−当日最低も
// 逆向きだった。逆向きの項を重い配点で残すと、出る日ほど低く出る。
console.log("== 風速と気温差は採点に入れない ==");
const calm = run(build(withInversion, { wind: 0.2 }), 800);
const windy = run(build(withInversion, { wind: 6.0 }), 800);
ok(calm.score === windy.score, "風速を変えても点数が動かない",
  `無風${calm.score.toFixed(1)} / 強風${windy.score.toFixed(1)}`);
ok(!calm.factors.some((f) => f.label.startsWith("風速")), "風速の行を出さない");
ok(!calm.factors.some((f) => f.label.startsWith("気温差")), "気温差の行を出さない");

console.log("== 露点差がいちばん効く ==");
const wet = run(build(withInversion, { dewDep: 0.3 }), 800);
const dry = run(build(withInversion, { dewDep: 6.0 }), 800);
ok(wet.score > dry.score + 20, "飽和寸前のほうが大きく高い",
  `露点差0.3℃で${wet.score.toFixed(0)} / 6℃で${dry.score.toFixed(0)}`);
ok(wet.factors.some((f) => f.label.startsWith("気温と露点の差")), "露点差の行を出す");
ok(S.SCORERS.seaOfClouds.score(
  S.SCORERS.seaOfClouds.window(day + 24 * 3600000, {
    home: new S.Series(times, { temperature_2m: times.map(() => 4) }),
    offsets: {}, lat: 35.3, lon: 134.83, terrain: "basinRim", elevation: 800,
    lightPollution: null, air: null }),
  { home: new S.Series(times, { temperature_2m: times.map(() => 4) }),
    offsets: {}, lat: 35.3, lon: 134.83, terrain: "basinRim", elevation: 800,
    lightPollution: null, air: null }).unavailable !== null,
  "露点が無ければ採点しない（0点に丸めない）");

console.log("== モデルに霧そのものを予測させない ==");
// 放射霧は 5km 格子・面の間隔 230m のモデルが解像できない。
// 気圧面の湿度で霧を判定させたら、雲海スポット10地点×7日のうち69件が
// 「下層が乾いている」になり全部15点になった。
const core = fs_read();
function fs_read() { return require("node:fs").readFileSync(new URL("./sorami-core.js", import.meta.url), "utf8"); }
ok(!/satRH/.test(core), "気圧面の湿度で霧の有無を判定していない");
ok(/function inversionBase/.test(core), "分布からは逆転層の高さだけを読む");

// --- 51メンバーは雲海の天井を判定できない ---
//
// メンバーは気圧面を1面も持たないので、逆転層をまたいだ判定を一度もできない。
// 判定できない集団が揃っているのは当たり前で、それを「揃っている」と読むと、
// 8モデルが割れている日に「評価はほぼ動きません」（A）が出る。
// 【実測】美の山公園 2026-09-09: 8モデルの幅43点・気象庁MSMは「中に入る」→ A だった。
console.log("== アンサンブルを信頼度の根拠にしない ==");
const scorer = S.SCORERS.seaOfClouds;
const win = [day + 24 * 3600000 + 5 * 3600000, day + 24 * 3600000 + 7 * 3600000];
// メンバーと同じ「気圧面を持たない」系列
const flatMember = new S.Series(times, {
  temperature_2m: times.map(() => 4), wind_speed_10m: times.map(() => 0.5),
  relative_humidity_2m: times.map(() => 95), cloud_cover: times.map(() => 5),
  precipitation: times.map(() => 0),
});
ok(typeof scorer.ensembleBlind === "function", "雲海は「見られない」を申告する");
ok(scorer.ensembleBlind(flatMember, win) !== null, "気圧面を持たないメンバーは根拠にしない");
ok(scorer.ensembleBlind(build(withInversion), win) === null,
  "気圧面がそろっていれば使ってよい");
ok(S.SCORERS.starrySky.ensembleBlind === undefined,
  "気圧面を使わない現象は従来どおりアンサンブルを使う");

// --- 幅が狭くても評価が割れていれば「高」と言わない ---
//
// ランクの帯は20〜25点間隔。幅10点でも境目をまたげば評価は割れる。
// アンサンブル側は rankAgreement で塞いでいる。モデル側にも同じ確認が要る。
console.log("== モデルの幅が狭くても評価が割れていれば下げる ==");
const near = S.rankOf(41).key !== S.rankOf(39).key;
ok(near, "40点付近にランクの境目がある（この確認の前提）", `${S.rankOf(39).label}/${S.rankOf(41).label}`);
ok(S.confidenceOf(8, 1).key === "high", "全モデルが同じ評価なら高いまま");
ok(S.confidenceOf(8, 0.5).key === "medium", "半数が別の評価なら1段下げる");
ok(S.confidenceOf(8, 0.5).cappedByDisagreement === true, "下げた理由を持ち回す");
ok(S.confidenceOf(8, 0.4).key === "low", "表示している評価が少数派なら低");
ok(S.confidenceOf(8).key === "high", "一致率が無ければ従来どおり幅だけで決める");

console.log(`\n${fail === 0 ? "CLOUDSEA OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
