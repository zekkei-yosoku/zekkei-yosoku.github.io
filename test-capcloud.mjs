// 笠雲の採点。**合成した鉛直プロファイルで検査する。**
//
// 実データでの的中率は未検証（ユーザー判断で精度確認を飛ばして導入・2026-09-15）。
// ここで確かめるのは物理の向きだけ——材料が欠けたときに点が落ちるか、
// 湿度極大の高度で型が分かれるか、掛け算が効いているか。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("./sorami-capcloud.js");
const S = require("./sorami-core.js");

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };

// 気圧面 → だいたいの高度（標準大気）
const Z = { 850: 1500, 800: 2000, 700: 3000, 600: 4200, 500: 5600, 400: 7200 };
/**
 * 鉛直プロファイルを組み立てる。
 * @param rhAt  気圧面 → 湿度
 * @param opts  windMs / windDeg / lapse（℃/km。小さいほど安定）
 */
function profile({ rhAt, windMs = 20, windDeg = 247.5, lapse = 5.5, t850 = 10 }) {
  return C.LEVELS.map((p) => {
    const z = Z[p];
    return { z_m: z, pressure_hpa: p,
      temperature_c: t850 - lapse * (z - Z[850]) / 1000,
      rh_pct: rhAt[p],
      u_ms: -windMs * Math.sin(windDeg * Math.PI / 180),
      v_ms: -windMs * Math.cos(windDeg * Math.PI / 180) };
  }).sort((a, b) => a.z_m - b.z_m);
}
const scoreFor = (opts) => C.scoreOf(C.features(profile(opts)));
/// 周囲8方位を同じプロファイルで埋める
const ringOf = (rhAt) => Array.from({ length: 8 }, () => C.features(profile({ rhAt })));

// 山頂 3776m は 700hPa(3000m) と 600hPa(4200m) の間
const CAP  = { 850: 55, 800: 60, 700: 92, 600: 88, 500: 40, 400: 30 };  // 山頂付近が湿る
const DRY  = { 850: 30, 800: 25, 700: 22, 600: 20, 500: 18, 400: 15 };
const HIGH = { 850: 40, 800: 35, 700: 45, 600: 55, 500: 95, 400: 50 };  // 500hPa が極大
// **一様な曇天と雨。** ここを笠雲より高く出したのが 2026-09-15 の欠陥
const OVER = { 850: 95, 800: 96, 700: 97, 600: 96, 500: 94, 400: 90 };
const RAIN = { 850: 99, 800: 98, 700: 97, 600: 95, 500: 92, 400: 85 };

console.log("== 材料が揃えば高く、欠ければ落ちる ==");
const base = scoreFor({ rhAt: CAP });
ok(base !== null, "採点できる");
ok(base.score >= 50, "湿った層・強い西南西風・安定 が揃えば高い", `${base.score}点`);

const dry = scoreFor({ rhAt: DRY });
ok(dry.score < 15, "乾いていれば低い", `${dry.score}点`);

const calm = scoreFor({ rhAt: CAP, windMs: 2 });
ok(calm.score < 15, "風が弱ければ低い（持ち上がらない）", `${calm.score}点`);

const unstable = scoreFor({ rhAt: CAP, lapse: 9.9 });
ok(unstable.score < base.score * 0.5, "不安定なら大きく落ちる（対流の雲になる）",
   `${unstable.score}点 / 安定時 ${base.score}点`);

console.log("\n== 一様な曇天を笠雲にしない ==");
{
  // ユーザー指摘「これって普通の曇り空なんじゃないの」（2026-09-15）。
  // 当時: 笠雲むき81点に対し **曇天96点・雨95点** で順位が逆だった。
  // 原因は2つ。「露点差が小さいほど高得点」＝すでに雲の状態を最高点にしていたことと、
  // 湿潤層の厚さを見ていなかったこと。笠雲はレンズで、全層が湿っていればただの曇天。
  const cap = scoreFor({ rhAt: CAP });
  const over = scoreFor({ rhAt: OVER });
  const rain = scoreFor({ rhAt: RAIN });
  ok(over.score < cap.score, "曇天は笠雲むきより低い", `曇天${over.score} < 笠雲${cap.score}`);
  ok(rain.score < cap.score, "雨は笠雲むきより低い", `雨${rain.score} < 笠雲${cap.score}`);
  ok(over.score <= 10, "曇天はほぼ0", `${over.score}点`);
  ok(rain.score <= 10, "雨はほぼ0", `${rain.score}点`);
  // **0にはしない。** 厚い雲に埋もれて見えないだけで、笠雲自体は起こり得る
  ok(over.score >= 0, "0未満にはならない");

  const f = C.features(profile({ rhAt: OVER }));
  ok(f.moistDepthM > 4000, "全層が湿っていることを厚さで捉える", `${Math.round(f.moistDepthM)}m`);
  ok(C.features(profile({ rhAt: CAP })).moistDepthM <= 2000, "笠雲むきは薄い層",
     `${Math.round(C.features(profile({ rhAt: CAP })).moistDepthM)}m`);
}

console.log("\n== 周りが晴れていなければ笠雲ではない ==");
{
  // ユーザー指摘（2026-09-15）「周りは晴れてて富士山の上だけに雲ができるのが笠雲」
  // 「富士山頂に雲があったとしても周りも雲だから笠雲ではない」。
  // 鉛直（レンズの薄さ）だけでは足りない——薄い層が一面に広がることもある。
  // 30km 8方位は取っていたのに、風上1点しか使っていなかった。
  const f = C.features(profile({ rhAt: CAP }));
  const dryRing = ringOf({ 850: 45, 800: 40, 700: 50, 600: 45, 500: 30, 400: 25 });
  const wetRing = ringOf(OVER);

  const clear = C.scoreOf(f, { ring: dryRing });
  const cloudy = C.scoreOf(f, { ring: wetRing });
  ok(clear.score > 60, "まわりが乾いていれば高い", `${clear.score}点`);
  ok(cloudy.score < clear.score * 0.3, "**同じ鉛直構造でも、まわりが湿っていれば落ちる**",
     `${cloudy.score}点 vs ${clear.score}点`);

  // **分からないときは下げない。** 周囲の予報が足りないことを減点の理由にしない
  ok(C.scoreOf(f, { ring: [] }).score === clear.score, "周囲が取れなければ下げない");
  ok(C.scoreOf(f, { ring: dryRing.slice(0, 3) }).score === clear.score,
     "3点しか無ければ判断しない（中央値が当てにならない）");

  // **1点でも湿っていたらダメ、にはしない。** 風上側が湿っているのは笠雲の日でも当然
  const oneWet = [...dryRing.slice(0, 7), C.features(profile({ rhAt: OVER }))];
  ok(C.scoreOf(f, { ring: oneWet }).score > clear.score * 0.8,
     "1方位だけ湿っていても大きく落とさない", `${C.scoreOf(f, { ring: oneWet }).score}点`);

  // 内訳に出る
  const part = cloudy.parts.find((x) => x.key === "surround");
  ok(part && part.why.includes("まわり30km"), "まわりの状態を内訳に出す", part && part.why);
}

console.log("\n== すでに飽和している空気を最高点にしない ==");
{
  // 笠雲は「風上では飽和していない空気が、山で持ち上げられて凝結する」現象
  const parts = (rhAt) => Object.fromEntries(scoreFor({ rhAt }).parts.map((x) => [x.key, x.p]));
  ok(parts(OVER).saturate < parts(CAP).saturate,
     "すでに雲の中なら「持ち上げで雲になるか」は下がる",
     `曇天${parts(OVER).saturate.toFixed(2)} < 笠雲${parts(CAP).saturate.toFixed(2)}`);
  // 乾きすぎても届かない
  const farDry = { 850: 50, 800: 45, 700: 55, 600: 50, 500: 30, 400: 25 };
  ok(parts(farDry).saturate < 1, "乾きすぎれば持ち上げても届かない");
}

console.log("\n== 離れ笠は雲になる高さで測る ==");
{
  // 山頂の露点差だけで測っていたら、離れ笠が7点まで落ちた（山頂は乾いていてよい）
  const det = scoreFor({ rhAt: HIGH });
  ok(det.type === "detached", "離れ笠と判定される");
  ok(det.score >= 30, "山頂が乾いていても落としすぎない", `${det.score}点`);
  const f = C.features(profile({ rhAt: HIGH }));
  ok(f.dewpointDepressionAtPeak < f.dewpointDepression,
     "湿度極大の高さのほうが飽和に近い",
     `極大${f.dewpointDepressionAtPeak.toFixed(1)}℃ < 山頂${f.dewpointDepression.toFixed(1)}℃`);
}

console.log("\n== 掛け算になっている（1つ欠ければ埋め合わせられない）==");
{
  // 湿りは満点でも風がゼロなら、他が良くても高くならない
  const noWind = scoreFor({ rhAt: CAP, windMs: 0.5 });
  ok(noWind.score <= 5, "風だけ欠けても全体が落ちる", `${noWind.score}点`);
  // 足し算なら「湿り満点＋安定満点」で半分は残るはず。そうなっていないことを見る
  ok(noWind.score < base.score * 0.2, "足し算的な埋め合わせが起きない");
}

console.log("\n== 湿度極大の高度で型が分かれる ==");
{
  ok(base.type === "cap", "山頂付近の極大は山頂被覆型", base.type);
  const det = scoreFor({ rhAt: HIGH });
  ok(det.type === "detached", "500hPa付近の極大は離れ笠", det.type);
  ok(det.score > 0, "離れ笠も0にしない（笠雲の仲間）", `${det.score}点`);
}

console.log("\n== 山頂より下の湿りを笠雲にしない ==");
{
  const below = { 850: 95, 800: 92, 700: 60, 600: 30, 500: 25, 400: 20 };
  const r = scoreFor({ rhAt: below });
  ok(r.score < base.score * 0.5, "山にかかる雲と笠雲を区別する", `${r.score}点 / ${base.score}点`);
  ok(r.parts.find((x) => x.key === "layer").why.includes("下"), "理由に「下」と出る");
}

console.log("\n== 風向は決め打ちにしない ==");
{
  // 西南西が最多だが、**方位で0にはしない**（横切っていれば効く）
  const wsw = scoreFor({ rhAt: CAP, windDeg: 247.5 });
  const ne  = scoreFor({ rhAt: CAP, windDeg: 67.5 });
  const s   = scoreFor({ rhAt: CAP, windDeg: 180 });
  ok(wsw.score >= ne.score, "西南西が最も高い", `${wsw.score} vs ${ne.score}`);
  ok(ne.score > wsw.score * 0.6, "北東でも極端に落とさない", `${ne.score}点`);
  ok(s.score > 0, "南風でも0にしない", `${s.score}点`);
}

console.log("\n== 湿度極大が平坦なとき ==");
{
  const flat = { 850: 60, 800: 95, 700: 95, 600: 95, 500: 95, 400: 40 };
  const f = C.features(profile({ rhAt: flat }));
  ok(f.moistPeakAmbiguous === true, "極大が一点に決まらないことを持つ");
  ok(f.zRhMaxMinusSummit === null, "高度を勝手に一点に決めない");
  const r = C.scoreOf(f);
  // 極大が一点に決まらなくても**採点は続く**。重心を使うので型も決まる
  ok(r.score > 0, "それでも採点はする", `${r.score}点`);
  ok(Number.isFinite(f.zMoistCenterMinusSummit), "重心は常に決まる",
     `${Math.round(f.zMoistCenterMinusSummit)}m`);
}

console.log("\n== 取得日数 ==");
{
  // 3日固定にしていたので、他の行が14日あるのに笠雲だけ切れて壊れて見えた
  const days = (n) => new URL(C.buildURL(C.samplePoints(), n)).searchParams.get("forecast_days");
  ok(days(14) === "14", "14日を頼める", days(14));
  ok(days(99) === "16", "上限16で頭打ち（APIの上限）", days(99));
  ok(days(0) === "1", "0以下でも1にする", days(0));
  ok(C.samplePoints().length === 9, "山頂＋8方位の9地点", `${C.samplePoints().length}地点`);
}

console.log("\n== 出はじめ・最盛・弱まる ==");
{
  const h = (n) => Date.UTC(2026, 8, 15, n - 9);   // JST n時
  const mk = (pairs) => pairs.map(([hour, score]) => ({ at: h(hour), score, type: "cap" }));
  // **閾値はその日が到達したランクの境界。** 40点固定にしたら、条件の良い日は
  // 0:00〜23:00 の24時間になって何も言っていなかった（2026-09-15 実データで発覚）
  ok(S.RANKS.find((r) => r.key === "fair").min === 40, "うっすらの境界は40点");

  const t = C.timingOf(mk([[3,10],[4,20],[5,45],[6,70],[7,88],[8,60],[9,30],[10,5]]), S);
  ok(t !== null, "時間帯が出る");
  ok(t.thresholdScore === 85, "ピーク88ならみごと（85点）の境界で絞る", `${t.thresholdScore}点`);
  ok(new Date(t.peakAt + 9*3600000).getUTCHours() === 7, "いちばん整うのは最大の時刻");
  ok(t.peakScore === 88, "その点数");
  ok(t.hours === 1, "良い日ほど絞られる", `${t.hours}時間`);
  ok(t.openStart === false && t.openEnd === false, "一日の中に収まっている");

  // **一日ほぼ平らな日を「時間帯」と言わない**
  const flat = mk(Array.from({ length: 24 }, (_, i) => [i, i >= 4 && i <= 9 ? 97 : 60]));
  const tf = C.timingOf(flat, S);
  ok(tf.thresholdScore === 85, "ピーク97ならみごとの境界", `${tf.thresholdScore}点`);
  ok(tf.hours === 6 && tf.allDay === false, "60点の時間帯は外れる", `${tf.hours}時間`);
  const allHigh = mk(Array.from({ length: 24 }, (_, i) => [i, 90]));
  ok(C.timingOf(allHigh, S).allDay === true, "本当に一日中なら allDay を立てる");

  // 中くらいの日は、その日のランクで絞る
  const mid = C.timingOf(mk(Array.from({ length: 24 }, (_, i) => [i, i >= 5 && i <= 8 ? 66 : 45])), S);
  ok(mid.thresholdScore === 65, "ピーク66なら 出やすい（65点）の境界", `${mid.thresholdScore}点`);
  ok(mid.hours === 4, "45点の時間帯は外れる", `${mid.hours}時間`);

  // 一日の端に張り付く＝前後の日へ続いている可能性
  const edge = C.timingOf(mk([[3,70],[4,68],[5,70],[6,66]]), S);
  ok(edge.openStart === true, "先頭から始まっていれば前の日から続く扱い");
  ok(edge.openEnd === true, "末尾まで続いていれば翌日へ続く扱い");

  // **途切れる時間帯を一つにまとめない。** 雲は切れることがある
  const gap = C.timingOf(mk([[3,10],[4,70],[5,20],[6,75],[7,30]]), S);
  ok(gap.spans === 2, "途切れを数える", `${gap.spans}区間`);
  ok(new Date(gap.peakAt + 9*3600000).getUTCHours() === 6, "最も整う区間を代表にする");

  // 届かない日
  ok(C.timingOf(mk([[3,10],[4,20],[5,30]]), S) === null, "40点に届かなければ時間帯なし");
  ok(C.timingOf([], S) === null, "空なら null");
  ok(C.timingOf(null, S) === null, "null なら null");
}

console.log("\n== 点数が跳ばない（量子化しない）==");
{
  // 気圧面は6枚しかないので、**閾値で切ると1%の湿度差で厚さが1,400m飛ぶ**。
  // 実データで 09時6060m → 11時1636m → 16時4348m と跳ね、
  // 点数が 0→92→…→0→78 という物理的にあり得ない並びになった（2026-09-15）。
  // 雲海の「天井の量子化による点数の跳び」と同じ型。
  //
  // 湿度をなめらかに動かして、厚さと点数が連続に動くことを見る。
  const at = (rh700) => {
    const rhAt = { 850: 60, 800: 70, 700: rh700, 600: rh700 - 6, 500: 45, 400: 35 };
    const f = C.features(profile({ rhAt }));
    return { depth: f.moistDepthM, score: C.scoreOf(f).score };
  };
  let maxDepthJump = 0, maxScoreJump = 0;
  let prev = at(70);
  for (let rh = 71; rh <= 100; rh++) {
    const cur = at(rh);
    maxDepthJump = Math.max(maxDepthJump, Math.abs(cur.depth - prev.depth));
    maxScoreJump = Math.max(maxScoreJump, Math.abs(cur.score - prev.score));
    prev = cur;
  }
  // 湿度1%で厚さが数百m飛ぶなら、それは閾値で切っている証拠
  ok(maxDepthJump < 200, "湿度1%あたりの厚さの変化が小さい", `最大 ${Math.round(maxDepthJump)}m`);
  ok(maxScoreJump <= 6, "湿度1%あたりの点数の変化が小さい", `最大 ${maxScoreJump}点`);
  // 重心を使うのは、極大の高度だと2つの気圧面が同値になった瞬間に飛ぶため
  ok(!/zRhMaxMinusSummit/.test(C.scoreOf.toString()), "採点に極大の高度を使わない");

  // 厚さそのものは単調に増える（湿るほど厚い）
  ok(at(100).depth > at(80).depth && at(80).depth > at(72).depth, "湿るほど厚くなる",
     `${Math.round(at(72).depth)} → ${Math.round(at(80).depth)} → ${Math.round(at(100).depth)}m`);
}

console.log("\n== 壊れた入力で落ちない ==");
{
  ok(C.features(null) === null, "null");
  ok(C.features([]) === null, "空");
  ok(C.scoreOf(null) === null, "特徴量が無ければ null");
  const short = profile({ rhAt: CAP }).slice(0, 2);
  ok(C.features(short) === null, "層が足りなければ null");
}

console.log("\n== 見えなければ点数を下げる ==");
{
  // ユーザー「絶景を見ることが前提だからね」（2026-09-15）。
  // 見に行くための道具なので、見えないものを高得点で出さない。
  // **発生と可視は別々に計算したうえで掛ける**——内訳から
  // 「出るけれど見えない」のか「そもそも出ない」のかが読み取れるようにする。
  const day = S.Cal.startOfDay(Date.now());
  const times = [];
  for (let t = day; t < day + 86400000; t += 3600000) times.push(Math.round(t / 1000));
  const mk = (rhAt) => {
    const h = { time: times };
    for (const p of C.LEVELS) {
      h[`geopotential_height_${p}hPa`] = times.map(() => Z[p]);
      h[`temperature_${p}hPa`] = times.map(() => 10 - 5.5 * (Z[p] - Z[850]) / 1000);
      h[`relative_humidity_${p}hPa`] = times.map(() => rhAt[p]);
      h[`wind_speed_${p}hPa`] = times.map(() => 20);
      h[`wind_direction_${p}hPa`] = times.map(() => 247.5);
    }
    return { latitude: 35.36, longitude: 138.73, hourly: h };
  };
  const upper = { points: C.samplePoints(), list: C.samplePoints().map(() => mk(CAP)),
                  fetchedAt: Date.now() };
  const fuji = (pVisible) => ({ unavailable: null, detail: { pVisible } });

  const seen = C.evaluateDay(upper, day, S, { fujiDay: fuji(1) });
  const hazy = C.evaluateDay(upper, day, S, { fujiDay: fuji(0.4) });
  const hidden = C.evaluateDay(upper, day, S, { fujiDay: fuji(0.02) });
  const unknown = C.evaluateDay(upper, day, S, { fujiDay: null });

  ok(seen.score > 50, "見えるなら高い", `${seen.score}点`);
  ok(Math.abs(hazy.score - seen.score * 0.4) <= 1, "見えにくければ比例して下がる",
     `${hazy.score}点`);
  ok(hidden.score <= 3, "山ごと見えなければほぼ0", `${hidden.score}点`);

  // **分からないときは下げない。** 富士山の予報が届いていないことを減点の理由にしない
  ok(unknown.score === seen.score, "富士山の評価が無ければ下げない");
  ok(unknown.visibility === null, "可視が不明であることを持ち回る");

  // **発生だけの点数を残す。** 「出るけれど見えない」を後から読み取れるように
  ok(hidden.formationScore === seen.formationScore,
     "発生の点数は可視で変わらない", `${hidden.formationScore}点`);
  ok(hidden.formationScore > hidden.score, "出るけれど見えない日が区別できる",
     `発生${hidden.formationScore} → 表示${hidden.score}`);

  // 内訳に出る
  const f = hidden.factors.find((x) => x.label === "ここから富士山が見えるか");
  ok(f && f.detail.includes("山ごと見えにくい"), "内訳に理由を出す", f && f.detail);
  const fu = unknown.factors.find((x) => x.label === "ここから富士山が見えるか");
  ok(fu && fu.detail.includes("届いていません"), "不明なら不明と書く");

  // 時間帯は**発生**で決まる（見えなくても材料が揃う時刻は同じ）
  ok(hidden.timing && seen.timing && hidden.timing.peakAt === seen.timing.peakAt,
     "時間帯は可視で動かさない");
}

console.log("\n== 1日ぶんの評価が他の現象と同じ形で返る ==");
{
  // 上空の予報を合成する
  const day = S.Cal.startOfDay(Date.now());
  const times = [];
  for (let t = day; t < day + 86400000; t += 3600000) times.push(Math.round(t / 1000));
  const mk = (rhAt) => {
    const h = { time: times };
    for (const p of C.LEVELS) {
      h[`geopotential_height_${p}hPa`] = times.map(() => Z[p]);
      h[`temperature_${p}hPa`] = times.map(() => 10 - 5.5 * (Z[p] - Z[850]) / 1000);
      h[`relative_humidity_${p}hPa`] = times.map(() => rhAt[p]);
      h[`wind_speed_${p}hPa`] = times.map(() => 20);
      h[`wind_direction_${p}hPa`] = times.map(() => 247.5);
    }
    return { latitude: 35.36, longitude: 138.73, hourly: h };
  };
  const upper = { points: C.samplePoints(), list: C.samplePoints().map(() => mk(CAP)), fetchedAt: Date.now() };
  const ev = C.evaluateDay(upper, day, S);
  ok(ev.unavailable === null, "評価できる");
  for (const k of ["phenomenon", "window", "peak", "score", "rank", "confidence", "uncertainty", "source", "factors"]) {
    ok(ev[k] !== undefined, `${k} がある`);
  }
  ok(typeof ev.confidence === "object", "confidence はオブジェクト（数値だと詳細が undefined になる）");
  ok(ev.uncertainty.basis === "single", "モデル横断でないことを basis で示す");
  ok(ev.rank.key !== undefined, "rank がある");
  // 2026-09-16 に人手ラベル63件で検証し、出典から「未検証」が外れた。
  // 代わりに**外れる割合を明示しているか**を確かめる。数字を書かずに出さない
  // 「5回に1回外れる」は誤りだった（当たる割合と拾える割合の取り違え）。
  // もとの発生頻度と、高得点でも多くは見られないことを書く
  ok(/50日に1日/.test(ev.source), "出典にもとの発生頻度を書く");
  ok(/十数回に1回/.test(ev.source), "出典に高得点でも多くは見られないことを書く");
  ok(!/5回に1回/.test(ev.source), "誤った割合を書かない");
  ok(!ev.source.includes("未検証"), "検証済みなので未検証と書かない");
  ok(ev.source.includes("人手ラベル"), "出典に学習データを書く");
  // 予報が無ければ黙って0にしない
  const none = C.evaluateDay(null, day, S);
  ok(none.unavailable && none.unavailable.kind === "forecast", "予報が無ければ unavailable");
}


// ---- 学習済みモデル（2026-09-16 導入） ----
// **人手ラベルで確定した事例に対して、期待どおりの点が出るか。**
// 手で組んだ6項では 2021-12-03（論文の確定事例）が0点、2026-01-05 が42〜64点だった。
{
  const f = {
    rhSummit: 86, rhMax: 88, zMoistCenterMinusSummit: -58, windSpeed: 22,
    n2: 0.00018, dewpointDepression: 1.9, dewpointDepressionAtPeak: 1.6,
    moistDepthM: 880, windDirectionDeg: 247,
  };
  const dryRing = Array.from({ length: 8 }, () => ({ moistDepthM: 300 }));
  const wetRing = Array.from({ length: 8 }, () => ({ moistDepthM: 4000 }));

  const morning = C.scoreOf(f, { ring: dryRing, hour: 8 });
  const evening = C.scoreOf(f, { ring: dryRing, hour: 19 });
  ok(morning.score > evening.score, "同じ大気でも夜は低く出る（見えないので）");

  const wet = C.scoreOf(f, { ring: wetRing, hour: 8 });
  ok(morning.score > wet.score, "周りが湿っていれば低く出る");

  const dry = C.scoreOf({ ...f, rhSummit: 20, dewpointDepression: 18 },
                        { ring: dryRing, hour: 8 });
  ok(morning.score > dry.score, "山頂が乾いていれば低く出る");

  const calm = C.scoreOf({ ...f, windSpeed: 2 }, { ring: dryRing, hour: 8 });
  ok(morning.score > calm.score, "風が弱ければ低く出る");

  // hour を渡さなければ従来の6項へ落ちる（壊さないための保険）
  const noHour = C.scoreOf(f, { ring: dryRing });
  ok(Number.isFinite(noHour.score), "時刻が無くても点は出る");

  // 6項の内訳は理由として残っている
  ok(morning.parts.length === 6, "内訳は6項のまま残す");
  ok(morning.parts.every((p) => p.label && p.why), "各項に説明がある");
}


// ---- 学習範囲外の時刻（2026-09-16） ----
// 深夜0時を入れると時刻の係数が外挿され、0:00 に70点が出ていた
{
  const f = {
    rhSummit: 86, rhMax: 88, zMoistCenterMinusSummit: -58, windSpeed: 22,
    n2: 0.00018, dewpointDepression: 1.9, dewpointDepressionAtPeak: 1.6,
    moistDepthM: 880, windDirectionDeg: 247,
  };
  const ring = Array.from({ length: 8 }, () => ({ moistDepthM: 300 }));
  for (const h of [0, 3, 4, 20, 23]) {
    const r = C.scoreOf(f, { ring, hour: h });
    ok(r.score === 0, `${h}時は学習範囲外なので0点`);
  }
  const night = C.scoreOf(f, { ring, hour: 2 });
  ok(night.modelParts && night.modelParts[0].note, "夜は理由に『見えない時間帯』を出す");
  ok(C.scoreOf(f, { ring, hour: 5 }).score > 0, "5時は範囲内");
  ok(C.scoreOf(f, { ring, hour: 19 }).score >= 0, "19時は範囲内");
}


console.log("\n== 時刻の区分と明るい時間（2026-09-16） ==");
{
  const f = {
    rhSummit: 86, rhMax: 88, zMoistCenterMinusSummit: -58, windSpeed: 22,
    n2: 0.00018, dewpointDepression: 1.9, dewpointDepressionAtPeak: 1.6,
    moistDepthM: 880, windDirectionDeg: 247,
  };
  const ring = Array.from({ length: 8 }, () => ({ moistDepthM: 300 }));
  const at = (h) => C.scoreOf(f, { ring, hour: h }).score;
  // 直線で入れていたら、どの日もピークが範囲の端の5時になった
  ok(at(5) === at(7) && at(7) === at(9), "朝（5〜9時）は時刻で差を付けない");
  ok(at(7) > at(12) && at(12) > at(16), "朝 > 昼 > 午後");

  // 大気を一日中同じにした合成データで、冬と夏の明るい時間を比べる
  const Z = { 850: 1500, 800: 2000, 700: 3100, 600: 4300, 500: 5800, 400: 7500 };
  const rh = { 850: 40, 800: 50, 700: 88, 600: 92, 500: 45, 400: 30 };
  const upperOn = (dayMs) => {
    const times = [];
    for (let t = dayMs; t < dayMs + 86400000; t += 3600000) times.push(Math.round(t / 1000));
    const mk = () => {
      const h = { time: times };
      for (const p of C.LEVELS) {
        h[`geopotential_height_${p}hPa`] = times.map(() => Z[p]);
        h[`temperature_${p}hPa`] = times.map(() => 10 - 5.5 * (Z[p] - Z[850]) / 1000);
        h[`relative_humidity_${p}hPa`] = times.map(() => rh[p]);
        h[`wind_speed_${p}hPa`] = times.map(() => 20);
        h[`wind_direction_${p}hPa`] = times.map(() => 247.5);
      }
      return { latitude: 35.36, longitude: 138.73, hourly: h };
    };
    return { points: C.samplePoints(), list: C.samplePoints().map(mk), fetchedAt: Date.now() };
  };
  const winter = S.Cal.startOfDay(Date.parse("2026-01-10T12:00:00+09:00"));
  const summer = S.Cal.startOfDay(Date.parse("2026-07-10T12:00:00+09:00"));
  const scoresAt = (dayMs, hour) => {
    const up = upperOn(dayMs);
    const t = dayMs + hour * 3600000;
    const lw = S.Sun.lightWindows(dayMs, C.FUJI.latitude, C.FUJI.longitude);
    const dark = t < lw.blueMorning[0] || t > lw.blueEvening[1];
    return { dark, raw: C.evaluateAt(up, t).score };
  };
  ok(scoresAt(winter, 5).dark, "冬の5時は暗い時間として扱う");
  ok(!scoresAt(summer, 5).dark, "夏の5時は明るい時間として扱う");
  const evW = C.evaluateDay(upperOn(winter), winter, S, { asOf: winter });
  const peakHourW = new Date(evW.peak).getHours();
  ok(peakHourW >= 6, `冬は暗い5時をピークにしない（ピーク ${peakHourW}時）`);
}

console.log(`\n${fail ? "FAILED" : "CAPCLOUD OK"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail ? 1 : 0);
