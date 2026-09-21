/*
 * 朝夕焼けの採点を、実写から当てたモデルへ置き換えた分の検査。
 *
 * ここで守るのは4つ。
 *   * **Python で当てた係数と、JSの移植が同じ数を出すこと**（固定例12件を突き合わせる）
 *   * 内訳の合計が表示スコアとぴったり合うこと（合わないと「なぜこの点数か」が嘘になる）
 *   * 6入力が揃わないときは、黙って0点にせず規則の採点へ落ちること
 *   * 雨の日が絶景にならないこと（規則の「降水があると30点まで」を外したので）
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");
const EXPORT = JSON.parse(readFileSync(new URL("./fixtures/afterglow-model-export.json", import.meta.url)));

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };

// 窓の中で一定の値を返す系列。採点は窓の平均（降水は最大）しか見ないので、これで十分。
const WS = Date.UTC(2026, 8, 21, 8, 0), WE = Date.UTC(2026, 8, 21, 9, 0);
const series = (cols) => new S.Series([WS, WS + 1800000, WE],
  Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, [v, v, v]])));
const inputFor = (v) => ({
  lat: 34.2, lon: 134.1,
  home: series({ cloud_cover_low: v.home_low, cloud_cover_mid: v.home_mid,
    cloud_cover_high: v.home_high, precipitation: v.precip }),
  offsets: {
    low: series({ cloud_cover_low: v.sun_low_low, cloud_cover_high: 0 }),
    mid: series({ cloud_cover_mid: 0, cloud_cover_low: 0 }),
    high: series({ cloud_cover_high: v.sun_high_high, cloud_cover_low: 0 }),
  },
  air: null,
});
const scoreOf = (v) => S.SCORERS.sunset.score([WS, WE], inputFor(v));

console.log("== Python で当てた係数と一致する ==");
{
  let worst = 0;
  for (const g of EXPORT.golden) {
    const r = scoreOf(g.in);
    worst = Math.max(worst, Math.abs(r.score - g.score));
  }
  ok(worst < 0.001, `固定例${EXPORT.golden.length}件の点数が一致する`, `最大差 ${worst.toExponential(2)}`);
  // 対応表の外挿も含めて、同じ入力なら同じ数が出ること
  const twice = [scoreOf(EXPORT.golden[0].in).score, scoreOf(EXPORT.golden[0].in).score];
  ok(twice[0] === twice[1], "同じ入力なら同じ点数");
}

console.log("== 内訳が説明になっている ==");
{
  const r = scoreOf({ home_low: 20, home_mid: 30, home_high: 40, precip: 0, sun_low_low: 10, sun_high_high: 25 });
  const sum = r.base + r.factors.reduce((a, f) => a + f.c, 0);
  ok(Math.abs(sum - r.score) < 1e-9, "基準 + 内訳 = 表示スコア", `${sum.toFixed(6)} vs ${r.score.toFixed(6)}`);
  ok(r.factors.length === 6, "6つの入力それぞれが1行になる", String(r.factors.length));
  ok(Math.abs(r.base - EXPORT.reference_score) < 0.001,
    "基準は「ふつうの日」の点数", `${r.base.toFixed(2)} vs ${EXPORT.reference_score}`);
  ok(r.factors.every((f) => f.label && f.detail), "どの行にも見出しと説明がある");
  ok(r.factors.some((f) => /上層の雲 40%/.test(f.label)), "観測値を見出しに出す",
    r.factors.map((f) => f.label).join(" / "));
}

console.log("== 実写が示した向き ==");
{
  // 学習が出した形: どの高さの雲も、増えるほど染まりにくい。
  const at = (h) => scoreOf({ home_low: 0, home_mid: 0, home_high: h, precip: 0, sun_low_low: 0, sun_high_high: 0 }).score;
  ok(at(0) > at(50) && at(50) > at(90), "上層の雲は多いほど下がる", `${at(0).toFixed(1)} → ${at(50).toFixed(1)} → ${at(90).toFixed(1)}`);
  const lowAt = (l) => scoreOf({ home_low: l, home_mid: 0, home_high: 0, precip: 0, sun_low_low: 0, sun_high_high: 0 }).score;
  ok(lowAt(0) > lowAt(80), "下層の雲は多いほど下がる", `${lowAt(0).toFixed(1)} → ${lowAt(80).toFixed(1)}`);
}

console.log("== 雨の日を絶景にしない ==");
{
  // 規則の「降水があれば30点まで」を外したので、実データで確かめた性質を検査でも固定する。
  // 学習の形は最後の節(2.0mm)より先で反転していた（雨が強いほど点数が上がっていた）。
  // 「増えて良くなることはない」で止めてある。ここが外れると強い雨で点数が戻る。
  const at = (p) => scoreOf({ home_low: 0, home_mid: 0, home_high: 0, precip: p, sun_low_low: 0, sun_high_high: 0 }).score;
  ok(at(2) >= at(3) && at(3) >= at(10) && at(10) >= at(100), "雨は強くなっても点数が戻らない",
    [2, 3, 10, 100].map((p) => at(p).toFixed(1)).join(" → "));
  // 実際に降る日は雲もあるので、もっと下がる
  const rainy = scoreOf({ home_low: 80, home_mid: 70, home_high: 60, precip: 3, sun_low_low: 80, sun_high_high: 60 });
  ok(rainy.score < 40, "曇って降っている日は平凡より下", rainy.score.toFixed(1));
  for (const p of [1, 3, 5, 10, 30]) {
    const r = scoreOf({ home_low: 0, home_mid: 0, home_high: 0, precip: p, sun_low_low: 0, sun_high_high: 0 });
    ok(r.score < 85, `降水 ${p}mm は絶景にならない`, r.score.toFixed(1));
  }
}

console.log("== 入力が欠けたら規則へ落ちる ==");
{
  const bare = { lat: 34.2, lon: 134.1, air: null,
    home: series({ cloud_cover_low: 10, cloud_cover_mid: 20, cloud_cover_high: 40, precipitation: 0 }) };
  const r = S.SCORERS.sunset.score([WS, WE], bare);
  ok(r.unavailable === null, "太陽方位側が無くても採点はできる");
  ok(!r.factors.some((f) => /ふつうの日より/.test(f.detail)), "そのときはモデルではなく規則の内訳", 
    r.factors.map((f) => f.label).join(" / ").slice(0, 60));
  ok(Math.abs(r.base + r.factors.reduce((a, f) => a + f.c, 0) - r.score) < 1e-9, "規則側も 基準 + 内訳 = 表示");
  // 雲量そのものが無ければ、これまでどおり「取得できなかった」
  const empty = { lat: 34.2, lon: 134.1, air: null, home: series({ precipitation: 0 }) };
  ok(S.SCORERS.sunset.score([WS, WE], empty).unavailable?.kind === "missingData", "雲量が無ければ取得不能");
}

console.log("== 朝も夕と同じモデルで採点する ==");
{
  const v = { home_low: 10, home_mid: 20, home_high: 30, precip: 0, sun_low_low: 5, sun_high_high: 15 };
  const dusk = S.SCORERS.sunset.score([WS, WE], inputFor(v));
  const dawn = S.SCORERS.sunrise.score([WS, WE], inputFor(v));
  ok(Math.abs(dusk.score - dawn.score) < 1e-9, "同じ入力なら朝も夕も同じ点数");
  ok(dawn.factors.some((f) => /日の出方向/.test(f.label)), "朝は「日の出方向」と書く",
    dawn.factors.map((f) => f.label).join(" / "));
}

console.log(`\n${fail === 0 ? "AFTERGLOW MODEL OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
