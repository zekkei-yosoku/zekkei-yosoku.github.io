// 固定フィクスチャ（2026-08-22 練馬・実際は大雨だった日）を通して、採点が勝手に動いていないかを見る。
// 「移植したつもり」を目視で済ませないための仕組み（8/22 のミスと同型の失敗の防止）。
//
// **何を何と突き合わせているか。**
//   天文（日の出入り・方位・月）… Swift 版（テスト108件で検証済み）の値と一致すること
//   朝夕焼け               … Swiftとは別物。**いまの実装を凍結した値**と一致すること
//   星空                   … Swiftとは別物。値を並べて出すだけ（2026-09-06 に意図して分岐）
//
// 朝夕焼けが分岐したのは 2026-09-22。採点を規則から、実写に当てたモデルへ置き換えたため。
// Swift の期待値は消さない。天文はいまも突き合わせているし、歴史的に正しい値でもある。
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");

const expected = JSON.parse(readFileSync(new URL("./parity-expected.json", import.meta.url)));
// フィクスチャは web/fixtures/ に置いた複製を読む。**リポジトリの外を参照しない。**
// 以前は SoramiCore のテストディレクトリを絶対パスで読んでいて、Swift版を消すと
// web の検査まで動かなくなる状態だった（2026-09-22 に複製して切り離した）。
const homeRaw = JSON.parse(readFileSync(new URL("./fixtures/nerima_2026-08-22_home.json", import.meta.url)));
const offsetsRaw = JSON.parse(readFileSync(new URL("./fixtures/nerima_2026-08-22_offsets.json", import.meta.url)));

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

// 2026-09-22: 朝夕焼けの採点を、実写（環境省の定点カメラ）から当てたモデルへ置き換えた。
// **Swift 版の期待値とは、もう一致しない。**
//
// ここで期待値を黙って書き換えると、移植ミスと設計変更の区別がつかなくなる。
// 星空のときと同じ形にする: **意図的に分岐した項目として両方の値を出し**、
// いまの実装の出力は別に凍結して、そちらで回帰を捕まえる。
// Swift の値（parity-expected.json）は消さない。天文の突き合わせには今も使っている。
console.log("== 朝夕焼け（Web版がモデルへ移行。Swiftとは意図的に別物） ==");
const home = S.decodeLocation(homeRaw);
const offsetList = offsetsRaw.map(S.decodeLocation);
const bundle = {
  home,
  sunsetOffsets: { low: offsetList[0], mid: offsetList[1], high: offsetList[2] },
  sunriseOffsets: null,
};
const place = { latitude: lat, longitude: lon, terrain: null, elevation: null };
const modern = S.evaluate("sunset", day, bundle, place);
console.log(`  Web版 ${modern.score.toFixed(2)} / Swift版 ${expected.sunset_score.toFixed(2)}`
  + "  ← 規則から、実写に当てた加法モデルへ（2026-09-22）");
console.log(`  内訳: ${modern.factors.map((f) => `${f.label} ${f.c >= 0 ? "+" : ""}${f.c.toFixed(1)}`).join(" / ")}`);

// 凍結値との突き合わせ。**作り直すのは採点を意図して変えたときだけ**
// （`node freeze-afterglow-baseline.mjs`）。落ちたから作り直す、をやると何も守らなくなる。
const frozen = JSON.parse(readFileSync(new URL("./fixtures/afterglow-baseline.json", import.meta.url)));
function checkShot(name, ev, exp) {
  check(`${name}.score`, ev.score, exp.score, 0.001);
  check(`${name}.base`, ev.base, exp.base, 0.001);
  check(`${name}.peak`, ev.peak / 1000, exp.peak / 1000, 0.5);
  ev.spread.forEach((v, i) => check(`${name}.spread.${i}`, v, exp.spread[i], 0.001));
  for (const m of Object.keys(exp.perModel)) {
    if (ev.perModel[m] === undefined) { failures++; console.log(`  NG ${name}.perModel.${m} が消えた`); continue; }
    check(`${name}.perModel.${m}`, ev.perModel[m], exp.perModel[m], 0.001);
  }
  if (ev.factors.length !== exp.factors.length) {
    failures++; console.log(`  NG ${name}.factor数: いま=${ev.factors.length} 凍結=${exp.factors.length}`);
    console.log("   いま:", ev.factors.map((f) => f.label));
    console.log("   凍結:", exp.factors.map((f) => f.label));
  } else {
    ev.factors.forEach((f, i) => {
      if (f.label !== exp.factors[i].label) {
        failures++; console.log(`  NG ${name}.内訳名[${i}]: いま='${f.label}' 凍結='${exp.factors[i].label}'`);
      } else check(`${name}.寄与[${i}] ${f.label}`, f.c, exp.factors[i].c, 0.001);
    });
  }
}
checkShot("モデル", modern, frozen.model);
// 太陽方位側が取れなかった日は規則へ落ちる。**落とし先も固めておく。**
// ここを見ていないと、落ちたときだけ静かに壊れていても気づけない。
checkShot("落とし先", S.evaluate("sunset", day, { ...bundle, sunsetOffsets: null }, place), frozen.fallback);

// 2026-09-10 B1: 期間量の時刻を正した意図的差分。**採点の作りを替えても、
// 窓に入る値の取り方は変わっていない**ことを、系列そのもので確かめる。
// この日の窓は18:02–18:42 JST。雨は18–19時を表す19時値1.8mmを使う。
// 旧版の18時値2.2mmは17–18時の雨で、対象窓外。
console.log("== 期間量の時刻（窓に入る値） ==");
const window = S.SCORERS.sunset.window(day, { lat, lon });
check("対象窓の降水", home.byModel.ecmwf_ifs025.max("precipitation", ...window), 1.8);

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

console.log(failures === 0
  ? "\nPARITY OK — 天文はSwiftと一致、朝夕焼けと星空は意図的な分岐（凍結値で回帰を監視）"
  : `\nPARITY NG — ${failures} 件不一致`);
process.exit(failures === 0 ? 0 : 1);
