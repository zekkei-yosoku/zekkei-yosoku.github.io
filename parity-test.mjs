// Swift 版（テスト108件で検証済み）と JS 移植の突き合わせ。
// 固定フィクスチャ（2026-08-22 練馬・実際は大雨だった日）を両実装に通し、
// スコア・内訳・天文計算が一致することを検証する。
// 「移植したつもり」を目視で済ませないための仕組み（8/22 のミスと同型の失敗の防止）。
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");

const expected = JSON.parse(readFileSync(new URL("./parity-expected.json", import.meta.url)));
const homeRaw = JSON.parse(readFileSync(
  "/Users/okadayudai/Developer/Sorami/SoramiCore/Tests/SoramiCoreTests/Fixtures/nerima_2026-08-22_home.json"));
const offsetsRaw = JSON.parse(readFileSync(
  "/Users/okadayudai/Developer/Sorami/SoramiCore/Tests/SoramiCoreTests/Fixtures/nerima_2026-08-22_offsets.json"));

let failures = 0;
function check(name, actual, exp, tol = 1e-6) {
  const ok = Math.abs(actual - exp) <= tol;
  if (!ok) { failures++; console.log(`  NG ${name}: js=${actual} swift=${exp} (差 ${actual - exp})`); }
  else console.log(`  ok ${name}: ${actual.toFixed ? actual.toFixed(4) : actual}`);
}

const lat = 35.73, lon = 139.64;
const day = Date.UTC(2026, 7, 21, 15); // 2026-08-22 00:00 JST

console.log("== 天文 ==");
check("sunset", S.Sun.eventTime("sunset", day, lat, lon) / 1000, expected.sunset_epoch, 0.5);
check("sunrise", S.Sun.eventTime("sunrise", day, lat, lon) / 1000, expected.sunrise_epoch, 0.5);
check("astroDusk", S.Sun.eventTime("astronomicalDusk", day, lat, lon) / 1000, expected.astro_dusk_epoch, 0.5);
check("sunsetAzimuth", S.Sun.position(S.Sun.eventTime("sunset", day, lat, lon), lat, lon).azimuth,
      expected.sunset_azimuth, 0.001);
check("moonIllumEclipse", S.Moon.state(948429840000, lat, lon).illuminatedFraction,
      expected.moon_illum_eclipse, 1e-6);

console.log("== 夕焼け評価（フィクスチャ） ==");
const home = S.decodeLocation(homeRaw);
const offsetList = offsetsRaw.map(S.decodeLocation);
const bundle = {
  home,
  sunsetOffsets: { low: offsetList[0], mid: offsetList[1], high: offsetList[2] },
  sunriseOffsets: null,
};
const place = { latitude: lat, longitude: lon, terrain: null, elevation: null };
const ev = S.evaluate("sunset", day, bundle, place);
check("score", ev.score, expected.sunset_score, 0.001);
check("base", ev.base, expected.sunset_base);
check("spread.low", ev.spread[0], expected.sunset_spread[0], 0.001);
check("spread.high", ev.spread[1], expected.sunset_spread[1], 0.001);
check("peak", ev.peak / 1000, expected.sunset_peak_epoch, 0.5);
// フィクスチャは4モデル時代のもの。以後モデルを増やしたので、
// 両方に存在するモデルだけ比べる（増やした分は固定データに無いのが正しい）。
const sharedModels = S.MODELS.filter((m) => expected.sunset_perModel[m] !== undefined
                                         && ev.perModel[m] !== undefined);
console.log(`  （フィクスチャと共通のモデル: ${sharedModels.length}本）`);
for (const m of sharedModels) check(`perModel.${m}`, ev.perModel[m], expected.sunset_perModel[m], 0.001);

console.log("== 内訳（寄与と観測値の一致） ==");
// 文言は Web 版で平易化したため Swift と異なる（表示の問題）。
// 検証したいのは計算なので、寄与の値と、ラベルに埋め込まれた観測値（数字）を比べる。
// これで「順序が変わった」「値が変わった」は捕まえられる。
const digits = (s) => (s.match(/-?\d+(?:\.\d+)?/g) || []).join(",");
const expFactors = expected.sunset_factors;
if (ev.factors.length !== expFactors.length) {
  failures++; console.log(`  NG factor数: js=${ev.factors.length} swift=${expFactors.length}`);
  console.log("  js:", ev.factors.map((f) => f.label));
  console.log("  swift:", expFactors.map((f) => f.label));
} else {
  ev.factors.forEach((f, i) => {
    const a = digits(f.label), b = digits(expFactors[i].label);
    if (a !== b) { failures++; console.log(`  NG 観測値[${i}]: js='${f.label}'(${a}) swift='${expFactors[i].label}'(${b})`); }
    else check(`寄与[${i}] ${f.label}`, f.c, expFactors[i].c, 0.001);
  });
}

// 星空は 2026-09-06 に Web 版だけ「夜のうち最も条件の良い連続3時間で採点する」へ変更した。
// 夜通しの平均では「前半だけ快晴」と「一晩じゅう半分曇り」が同点になり、
// 見に行くかの判断に使えなかったため。Swift 版は夜通し平均のまま止めている。
//
// ここを Swift の値へ合わせ直すと、意図した改善を「不一致」として毎回潰すことになる。
// かといって黙って期待値を書き換えると、移植ミスと設計変更の区別がつかなくなる。
// **意図的に分岐した項目として明示し、両方の値を出す**形にする。
console.log("== 星空評価（Web版が先行。Swiftとは意図的に別物） ==");
const starry = S.evaluate("starrySky", day, bundle, place);
console.log(`  Web版 ${starry.score.toFixed(2)} / Swift版 ${expected.starry_score.toFixed(2)}`
  + `  ← 夜通し平均から「最も良い連続3時間」へ変更（2026-09-06）`);
console.log(`  採点した時間帯: ${starry.refinedWindow
  ? new Date(starry.refinedWindow[0]).toISOString() + " 〜 " + new Date(starry.refinedWindow[1]).toISOString()
  : "夜通し"}`);

console.log(failures === 0 ? "\nPARITY OK — Swift と一致" : `\nPARITY NG — ${failures} 件不一致`);
process.exit(failures === 0 ? 0 : 1);
