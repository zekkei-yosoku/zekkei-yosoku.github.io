/*
 * 朝夕焼けの採点の**凍結値**を作り直す。`node freeze-afterglow-baseline.mjs` で上書きする。
 *
 * 2026-09-22 まで、この部分は Swift 版の出力（parity-expected.json）との一致で守られていた。
 * 採点を実写から当てたモデルへ置き換えたので、Swift の値とは一致しなくなる。
 * **Swift の期待値は消さない**（歴史的に正しい値で、天文の突き合わせには今も使う）。
 * 代わりに、いまの実装の出力をここで凍結して、以後の意図しない変化を捕まえる。
 *
 * **作り直すのは、採点を意図して変えたときだけ。** 落ちたから作り直す、をやると
 * この検査は何も守らなくなる。差分を読んで、意図した変化だと確かめてから走らせる。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");

const homeRaw = JSON.parse(readFileSync(new URL("./fixtures/nerima_2026-08-22_home.json", import.meta.url)));
const offsetsRaw = JSON.parse(readFileSync(new URL("./fixtures/nerima_2026-08-22_offsets.json", import.meta.url)));
const day = Date.UTC(2026, 7, 21, 15);           // 2026-08-22 00:00 JST
const place = { latitude: 35.73, longitude: 139.64, terrain: null, elevation: null };
const home = S.decodeLocation(homeRaw), offsetList = offsetsRaw.map(S.decodeLocation);
const bundle = { home, sunriseOffsets: null,
  sunsetOffsets: { low: offsetList[0], mid: offsetList[1], high: offsetList[2] } };

const shot = (ev) => ({
  score: ev.score, base: ev.base, peak: ev.peak, spread: ev.spread,
  perModel: ev.perModel,
  factors: ev.factors.map((f) => ({ label: f.label, c: f.c })),
});

const out = {
  note: "現行Webの朝夕焼けの凍結値。Swift版とは別物（採点を実写から当てたモデルへ置き換えたため）。",
  frozenAt: new Date().toISOString().slice(0, 10),
  fixture: "nerima_2026-08-22",
  coreSha256: (await import("node:crypto")).createHash("sha256")
    .update(readFileSync(new URL("./sorami-core.js", import.meta.url))).digest("hex"),
  model: shot(S.evaluate("sunset", day, bundle, place)),
  // 太陽方位側が取れなかった日の落とし先。ここも固めておかないと、
  // 落ちたときだけ静かに壊れていても気づけない。
  fallback: shot(S.evaluate("sunset", day, { ...bundle, sunsetOffsets: null }, place)),
};
writeFileSync(new URL("./fixtures/afterglow-baseline.json", import.meta.url),
  JSON.stringify(out, null, 2) + "\n");
console.log(`凍結した: モデル ${out.model.score.toFixed(2)}点 / 落とし先 ${out.fallback.score.toFixed(2)}点`);
