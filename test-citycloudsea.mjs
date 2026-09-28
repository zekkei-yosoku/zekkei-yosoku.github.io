/*
 * 街の雲海（高い展望台から、街を覆う浅い霧を見下ろす）の回帰テスト。
 *
 * 盆地の雲海とは成因も式も違う。2026-09-28 に盆地の式をそのまま塔へ当てて
 * 東京タワーで76点を出した反省から、別の現象として分けた。
 * ここで守るのは3つ:
 *   1. 低い場所・低い展望台では出さない（地上150m未満は対象外）
 *   2. 地上が乾いていたら、他が揃っていても上限で抑える（必要条件）
 *   3. 見るころに雨なら見下ろせない
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");

let pass = 0, fail = 0;
const ok = (c, label, detail = "") => {
  if (c) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? "  " + detail : ""}`); }
};

const day = Date.UTC(2026, 9, 30) - 9 * 3600000;
const times = Array.from({ length: 72 }, (_, i) => day - 24 * 3600000 + i * 3600000);
const build = ({ dewDep = 0.3, rh = 98, low = 100, prevRain = 17, nowRain = 0, rh925 = 60 } = {}) => {
  const cols = {
    temperature_2m: times.map(() => 14),
    dew_point_2m: times.map(() => 14 - dewDep),
    relative_humidity_2m: times.map(() => rh),
    cloud_cover_low: times.map(() => low),
    cloud_cover: times.map(() => low),
    relative_humidity_925hPa: times.map(() => rh925),
    // 前日の雨は「前の日」に置く。当日の降水は nowRain
    precipitation: times.map((t) => (t < day ? prevRain / 24 : nowRain)),
    wind_speed_10m: times.map(() => 1),
    visibility: times.map(() => 200),
  };
  return new S.Series(times, cols);
};
const run = (series, deckAGL) => {
  const input = { home: series, offsets: {}, lat: 35.7101, lon: 139.8107, terrain: null,
    elevation: 3, eyeElevation: 3 + deckAGL, eyeAGL: deckAGL, lightPollution: null, air: null };
  const w = S.SCORERS.cityCloudSea.window(day, input);
  return S.SCORERS.cityCloudSea.score(w, input);
};

console.log("== 高い展望台からでないと見下ろせない ==");
{
  const s = build();
  ok(!!run(s, 1.5).unavailable, "地面に立っているときは対象外");
  ok(!!run(s, 100).unavailable, "地上100mの展望台でも対象外");
  const deck = run(s, 350);
  ok(!deck.unavailable, "スカイツリーの天望デッキ（地上350m）なら採点する",
    deck.unavailable ? deck.unavailable.message : "");
  const msg = run(s, 1.5).unavailable.message;
  ok(/地上/.test(msg) && /150m/.test(msg), "理由に必要な高さを書く", msg);
  ok(run(s, 1.5).unavailable.kind === "terrain", "地形の話として返す（0点ではない）");
}

console.log("== 霧ができなければ、他が揃っていても出さない ==");
{
  const wet = run(build({ dewDep: 0.3 }), 350);
  const dry = run(build({ dewDep: 4 }), 350);
  ok(wet.score >= 80, "飽和寸前の朝は高い", String(Math.round(wet.score)));
  ok(dry.score <= 25, "乾いた朝は、下層雲が100%でも上限で抑える", String(Math.round(dry.score)));
  ok(dry.ceiling !== undefined || dry.score < wet.score, "上限が効いている");
  const mid = run(build({ dewDep: 1.5 }), 350);
  ok(mid.score > dry.score && mid.score < wet.score, "露点差の順に並ぶ",
    `${Math.round(dry.score)} / ${Math.round(mid.score)} / ${Math.round(wet.score)}`);
}

console.log("== 見るころに降っていたら見下ろせない ==");
{
  const rain = run(build({ nowRain: 1.2 }), 350);
  ok(rain.score <= 20, "雨の朝は上限で抑える", String(Math.round(rain.score)));
  ok(rain.factors.some((f) => /見るころの降水/.test(f.label)), "理由に書く");
}

console.log("== 上まで湿っていたら、雲の中に入る側 ==");
{
  const deep = run(build({ rh925: 95 }), 350);
  const shallow = run(build({ rh925: 55 }), 350);
  ok(deep.score < shallow.score, "厚い層の朝は低くなる",
    `${Math.round(deep.score)} < ${Math.round(shallow.score)}`);
  ok(deep.factors.some((f) => /770m/.test(f.label)), "上空の湿りを理由に出す");
}

console.log("== 盆地の雲海とは別の現象 ==");
{
  ok(S.PHENOMENA.cityCloudSea && S.PHENOMENA.seaOfClouds, "2つの行がある");
  ok(S.PHENOMENA.cityCloudSea.name === "街の雲海", "名前で区別できる");
  // 夜間の雲量は**逆向き**（東京の低い雲は曇った夜のほうが出る）。式に入れない
  const src = String(S.SCORERS.cityCloudSea.score);
  ok(!/nightCloud/.test(src), "夜間の雲量を加点に使わない");
  ok(S.SCORERS.cityCloudSea.source.includes("羽田"), "出典を持つ", S.SCORERS.cityCloudSea.source);
}

console.log(`\n${fail === 0 ? "CITY CLOUD SEA OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
