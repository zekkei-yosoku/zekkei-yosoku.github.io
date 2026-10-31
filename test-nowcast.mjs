import {sourceHtml} from './tools/test-source.mjs';
/*
 * 実況表示の回帰テスト。
 *
 * 予報と実況を突き合わせて「ずれています」と警告する仕掛けは撤去した。
 * 8モデルの中央値は点数のための道具で、いまの気温を当てる道具ではない。
 * 現在時刻ですでにモデル間が7℃割れることがあり（2026-08-27 東京 26.1〜33.0℃）、
 * その差を異常として出していた。比べる相手が違う。
 * 実況は測った値をそのまま出し、標高差だけ物理で直す。
 */
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./astronotes-core.js");

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? "  " + detail : ""}`); }
};

const station = (name, elevation) => ({ id: name, name, elevation, latitude: 0, longitude: 0 });

console.log("== 標高差があれば直した値を出す ==");
// 注記だけ足しても、見出しには10℃違う数字が残る。直した値そのものを出す。
const est = (t, target, st) =>
  S.Amedas.estimatedTemperature({ fieldStation: { temperature: st }, targetElevation: target, temperature: t });
const note = (t, target, st) =>
  S.Amedas.elevationNote({ fieldStation: { temperature: st }, targetElevation: target, temperature: t });

const zaoEst = est(24.9, 1660, station("山形", 153));
ok(zaoEst !== null && Math.abs(zaoEst.value - 15.1) < 0.05,
  "山形24.9℃・標高差1507m → 約15.1℃", String(zaoEst?.value));
ok(zaoEst.raw === 24.9, "元の観測値も残す");
ok(est(26.7, 10, station("東京", 25)) === null, "標高差が小さければ直さない（そのまま実況）");
ok(est(27.7, 353, station("和田山", 80)) === null, "273m では直さない（閾値300m）");
const lowEst = est(5.0, 100, station("浪合", 1240));
ok(lowEst !== null && Math.abs(lowEst.value - 12.4) < 0.05,
  "観測点のほうが高ければ上げる方向へ直す", String(lowEst?.value));
ok(est(24.9, null, station("山形", 153)) === null, "地点の標高が分からなければ直さない");
ok(est(null, 1660, station("山形", 153)) === null, "気温が欠測なら直さない");

console.log("== 何をどう直したかを書く ==");
const zaoNote = note(24.9, 1660, station("山形", 153)) ?? "";
ok(/山形（標高153m）の 24\.9℃/.test(zaoNote), "元の観測点と値を書く", zaoNote);
ok(/1507m 高いぶんを補正した推定/.test(zaoNote), "推定であることを書く", zaoNote);
ok(/天気・湿度はふもとの値/.test(zaoNote), "直せない値はふもとのままだと書く", zaoNote);
ok(note(26.7, 10, station("東京", 25)) === null, "直していなければ注記も出さない");

console.log("== 突き合わせの警告は持たない ==");
ok(S.Nowcast === undefined, "Nowcast.compare を持たない");
const html = sourceHtml();
ok(!/disagree/.test(html), "画面に「ずれています」を出さない");
// 2026-10-20 画面の実況カードは外した（ユーザー「実況カードは完全に消していい」）。sorami-core の実況の計算は残る
ok(!html.includes('id="nowcast"'), "画面に実況カードを出さない");

console.log(`\n${fail === 0 ? "NOWCAST OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
