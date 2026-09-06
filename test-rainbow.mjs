/*
 * 虹の必須条件の回帰テスト。
 * 「日が差していない」「日射の予報が無い」ときに高い点数を出さないこと。
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");

let pass = 0, fail = 0;
const ok = (c, label, detail = "") => {
  if (c) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? "  " + detail : ""}`); }
};

// 太陽が低く雨が降っている1日を作る。日射だけを変えて挙動を見る。
const day = Date.UTC(2026, 7, 27) - 9 * 3600000;   // JST 8/27 00:00
const times = Array.from({ length: 24 }, (_, h) => day + h * 3600000);
const build = (direct) => {
  const cols = {
    precipitation: times.map(() => 1.5),
    showers: times.map(() => 0.2),
    direct_radiation: times.map(() => direct),
  };
  if (direct === null) cols.direct_radiation = times.map(() => null);
  return new S.Series(times, cols);
};
const place = { latitude: 35.3, longitude: 134.83, elevation: 329 };
const run = (direct) => {
  const home = build(direct);
  const input = { home, offsets: {}, lat: place.latitude, lon: place.longitude,
    terrain: null, elevation: place.elevation, lightPollution: null, air: null };
  const w = S.SCORERS.rainbow.window(day, input);
  const r = S.SCORERS.rainbow.score(w, input);
  return r.unavailable ? null : r.score;
};

console.log("== 日が差していなければ虹は出ない ==");
const none = run(0);
ok(none !== null && none <= S.T.rainbow.noSunCeiling,
  "直射日光 0W/m² なら上限で止まる", `${none && none.toFixed(0)}点`);
ok(none !== null && S.rankOf(none).key === "poor",
  "評価は「不向き」", `${none && S.rankOf(none).label}`);

console.log("== 日射の予報が無いモデルを良い方へ丸めない ==");
// 気象庁GSMは direct_radiation を全時刻返さない（実測確認済み）。
const unknown = run(null);
ok(unknown !== null && unknown <= S.T.rainbow.unverifiedSunCeiling,
  "日射が欠測なら上限で止まる", `${unknown && unknown.toFixed(0)}点`);
ok(unknown !== null && S.rankOf(unknown).key !== "good" && S.rankOf(unknown).key !== "spectacular",
  "「良好」以上にはしない", `${unknown && S.rankOf(unknown).label}`);

console.log("== 量が少ない日射で満点を付けない ==");
// 太陽高度が低いと快晴時の目安も小さいので、比だけ見ると微量でも満点になっていた。
const trace = run(12), plenty = run(300);
ok(trace !== null && plenty !== null && plenty > trace,
  "日射が多いほうが高い", `12W/m²=${trace.toFixed(0)} / 300W/m²=${plenty.toFixed(0)}`);
ok(trace !== null && S.rankOf(trace).key !== "good" && S.rankOf(trace).key !== "spectacular",
  "12W/m² では「良好」に届かない", `${trace && S.rankOf(trace).label}`);

// 日射ゼロは「確率が低い」ではなく【出ない】。雨が無い日と同じ低さに揃える。
// 実際に踏んだ例: 2026-09-07 の東京、5.4mm/h の雨で日射 0W/m² のとき 25点。
// 雨の予報がない日が 2点なので、出ない日が出ない日の10倍になっていた。
console.log("== 日が差していない時間は、雨が降っていても低いまま ==");
{
  const full = (cols) => new S.Series(times, cols);
  const scoreOf = (home) => {
    const input = { home, offsets: {}, lat: place.latitude, lon: place.longitude,
      terrain: null, elevation: place.elevation, lightPollution: null, air: null };
    return S.SCORERS.rainbow.score(S.SCORERS.rainbow.window(day, input), input);
  };
  const pour = scoreOf(full({ precipitation: times.map(() => 5.4),
    showers: times.map(() => 0.2), direct_radiation: times.map(() => 0) }));
  const dry = scoreOf(full({ precipitation: times.map(() => 0),
    showers: times.map(() => 0), direct_radiation: times.map(() => 600) }));
  ok(pour.score <= 6, "日射ゼロなら5点前後にとどまる", `${pour.score.toFixed(0)}点`);
  ok(Math.abs(pour.score - dry.score) < 6,
    "「土砂降りで日射ゼロ」と「雨なし」がほぼ同じ低さ",
    `日射ゼロ${pour.score.toFixed(0)} / 雨なし${dry.score.toFixed(0)}`);
  ok(pour.refinedWindow === null, "日が差さない時間に時刻を出さない");
}

console.log("== 雨が無ければ虹は出ない（母数からは外さない） ==");
const dry = (() => {
  const home = new S.Series(times, { precipitation: times.map(() => 0),
    showers: times.map(() => 0), direct_radiation: times.map(() => 500) });
  const input = { home, offsets: {}, lat: place.latitude, lon: place.longitude,
    terrain: null, elevation: place.elevation, lightPollution: null, air: null };
  const w = S.SCORERS.rainbow.window(day, input);
  return S.SCORERS.rainbow.score(w, input);
})();
ok(!dry.unavailable, "雨が無くても unavailable にしない（母数に残す）");
ok(dry.score < 40, "雨が無ければ低い点数", `${dry.score.toFixed(0)}点`);

console.log(`\n${fail === 0 ? "RAINBOW OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
