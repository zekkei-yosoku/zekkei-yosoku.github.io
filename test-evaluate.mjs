/*
 * モデル集約の回帰テスト。
 * 表示スコアは中央値であり、代表モデル由来の内訳には差分行が入ることを固定する。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");

let pass = 0, fail = 0;
const ok = (condition, label, detail = "") => {
  if (condition) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `  ${detail}` : ""}`); }
};

const home = S.decodeLocation(JSON.parse(readFileSync(
  "/Users/okadayudai/Developer/Sorami/SoramiCore/Tests/SoramiCoreTests/Fixtures/nerima_2026-08-22_home.json")));
const offsetsRaw = JSON.parse(readFileSync(
  "/Users/okadayudai/Developer/Sorami/SoramiCore/Tests/SoramiCoreTests/Fixtures/nerima_2026-08-22_offsets.json"));
const offsets = offsetsRaw.map(S.decodeLocation);
const bundle = {
  home,
  sunsetOffsets: { low: offsets[0], mid: offsets[1], high: offsets[2] },
  sunriseOffsets: null,
};
const day = Date.UTC(2026, 7, 21, 15);
const place = { latitude: 35.73, longitude: 139.64, terrain: null, elevation: null };
const ev = S.evaluate("sunset", day, bundle, place);
const scores = Object.values(ev.perModel);
const median = S.Curve.median(scores);
const representative = scores.reduce((best, score) =>
  Math.abs(score - median) < Math.abs(best - median) ? score : best, scores[0]);
const adjustment = ev.factors.find((f) => f.label === "モデル中央値との差");

console.log("== 表示値 =中央値 ==");
ok(Math.abs(ev.score - median) < 0.001, "表示スコアはモデル中央値", `${ev.score} vs ${median}`);
ok(ev.rank.key === S.rankOf(median).key, "ランクも中央値から決まる", `${ev.rank.key}`);
ok(Math.abs(ev.score - representative) > 0.001, "代表モデル値をそのまま表示しない", `${ev.score} vs ${representative}`);

console.log("== 内訳 =表示値 ==");
const total = ev.base + ev.factors.reduce((sum, f) => sum + f.c, 0);
ok(Math.abs(total - ev.score) < 0.001, "基準 + 内訳 = 表示スコア", `${total} vs ${ev.score}`);
ok(adjustment && Math.abs(adjustment.c - (median - representative)) < 0.001,
  "中央値との差を内訳に明示", `${adjustment && adjustment.c}`);

console.log(`\n${fail === 0 ? "EVALUATE OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
