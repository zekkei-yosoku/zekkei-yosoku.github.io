// 写真の保存時分析（sorami-photo-analysis.js）。
//
// 色の指標は Python（Pillow）の定点写真採点と同じ値を出す必要がある。後で残した写真から Python で計算し直すため。
// 基準値は fixtures/photo-analysis-pillow.json（Vault 成果物/20261016_写真の保存時分析の設計案/写真分析の基準値を作る.py で作成）。
// 個人の写真は使わず、全色の表と決まった式の合成画像で比べる。
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const A = require("./sorami-photo-analysis.js");
const ref = JSON.parse(readFileSync(new URL("./fixtures/photo-analysis-pillow.json", import.meta.url), "utf8"));

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };

console.log("RGB→HSV が Pillow と全色で一致する");
{
  let mismatch = 0;
  const buf = new Uint8Array(65536 * 3);
  for (let r = 0; r < 256; r++) {
    let p = 0;
    for (let g = 0; g < 256; g++) for (let b = 0; b < 256; b++) {
      const [h, s, v] = A.hsvByte(r, g, b);
      buf[p++] = h; buf[p++] = s; buf[p++] = v;
    }
    if (createHash("sha256").update(buf).digest("hex") !== ref.hsvPlaneSha256[r]) mismatch++;
  }
  ok(mismatch === 0, `256面すべて一致（Pillow ${ref.pillow}）`, mismatch ? `不一致 ${mismatch}面` : "");
}

console.log("帯の境界は Python の round（偶数への丸め）");
ok(A.roundHalfEven(62.5) === 62 && A.roundHalfEven(187.5) === 188 && A.roundHalfEven(0.5) === 0 && A.roundHalfEven(1.5) === 2, "62.5→62・187.5→188");
for (const img of ref.synthetic) ok(JSON.stringify(A.bandEdges(img.height)) === JSON.stringify(img.edges), `高さ${img.height}の境界`);

console.log("合成画像の12帯が Pillow＋numpy と一致する");
const synth = (w, h, seed) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) d[p + c] = (x * x * 7 + y * 13 + x * y * 3 + c * 59 + seed * 11) % 256;
    d[p + 3] = 255;
  }
  return d;
};
for (const img of ref.synthetic) {
  const got = A.colorBands(synth(img.width, img.height, img.seed), img.width, img.height, { exact: true });
  let worst = 0;
  img.bands.forEach((b, i) => {
    worst = Math.max(worst, Math.abs(got.bands[i].warm - b.warm), Math.abs(got.bands[i].invalid - b.invalid));
  });
  for (const k of ["meanValue", "darkFraction", "clippedFraction"]) worst = Math.max(worst, Math.abs(got.summary[k] - img.summary[k]));
  // 丸める前の値で比べる。合計の順序（numpy は対の和）だけの差
  ok(worst <= 1e-9, `${img.width}×${img.height}`, `最大差 ${worst.toExponential(2)}`);
}

console.log("上から k 本の値は画素数で重み付けする");
{
  const color = { height: 750, bands: Array.from({ length: 12 }, (_, i) => ({ warm: i === 0 ? 10 : 0 })) };
  // 境界 [0,62,125,…]：1本目は62行、2本目は63行
  ok(Math.abs(A.topBands(color, 2) - (10 * 62) / 125) < 1e-12, "1本目62行・2本目63行");
}

console.log("入力欄の由来");
ok(A.inputSource("2026-10-16T17:30", { value: "2026-10-16T17:30", source: "exif_offset" }) === "exif_offset", "写真から入れたまま");
ok(A.inputSource("2026-10-16T17:40", { value: "2026-10-16T17:30", source: "exif_offset" }) === "manual", "手で直した");
ok(A.inputSource("35.1, 139.1", { value: "35.1, 139.1", source: "default_place" }) === "default_place", "既定の地点のまま");
ok(A.inputSource("", { value: "", source: "default_place" }) === "none", "空のまま");
ok(A.inputSource("", { value: "35.1, 139.1", source: "exif" }) === "none", "消した");

console.log("予報の照合");
const dist = (a, b, c, d) => Math.hypot(a - c, b - d) * 111000;
const base = { takenAtMs: 1000, latitude: 35, longitude: 139, timeSource: "exif_offset", locationSource: "exif", algorithmVersion: "v", distanceM: dist };
const pre = { origin: "round", capturedAt: 100, window: [500, 1500], peak: 1000, score: 60, latitude: 35.01, longitude: 139, observations: { "cloud_cover@m": 10 } };
const preFar = { ...pre, score: 40, latitude: 35.2 };
const post = { origin: "current", capturedAt: 1200, window: [500, 1500], peak: 1000, score: 70, latitude: 35, longitude: 139 };
ok(A.matchForecast([pre], { ...base, timeSource: "default_now" }).reason === "no_time", "日時が既定値なら結び付けない");
ok(A.matchForecast([pre], { ...base, takenAtMs: null }).reason === "no_time", "日時が無い");
ok(A.matchForecast([pre], { ...base, locationSource: "default_place" }).reason === "no_location", "場所が既定値なら結び付けない");
ok(A.matchForecast([], base).reason === "no_forecast", "予報が無い");
ok(A.matchForecast([{ capturedAt: 1, window: [2, 3] }], base).reason === "out_of_range", "点数も気象の値も無い");
ok(A.matchForecast([{ ...pre, latitude: undefined }], base).reason === "out_of_range", "地点が分からない予報は使わない（2026-10-16 レビュー指摘）");
{
  const chosen = { ...pre, peak: 1001, score: 55, latitude: 35.05 };
  const f = A.matchForecast([pre, chosen], { ...base, selectedPeak: 1001 });
  ok(f.score === 55 && f.selected === true, "予報の欄で選んだ回を、近い回より優先する");
  ok(A.matchForecast([pre, chosen], base).selected === false, "選んでいなければ近い回");
}
{
  const f = A.matchForecast([post, preFar, pre], base);
  ok(f.kind === "pre_event" && f.score === 60, "事後より事前、事前の中では近いほう", JSON.stringify({ kind: f.kind, score: f.score }));
  ok(f.leadMs === 900 && f.distanceM === 1110, "leadMs＝撮影−保存、距離はm");
}
{
  const f = A.matchForecast([post], base);
  ok(f.kind === "post_event" && f.leadMs === -200, "開始後に取った予報は事後（leadMs が負）");
  const g = A.matchForecast([{ ...post, capturedAt: 400 }], base);
  ok(g.kind === "pre_event", "画面の予報でも開始前に取っていれば事前");
}
ok(A.matchForecast([{ ...pre, capturedAt: 500 }], base).kind === "post_event", "保存が開始と同時刻なら事前にしない（isPreEventRound と同じ）");
ok(A.matchForecast([pre], base).algorithmVersion === "v", "画面の予報（版の項目なし）は今の版");
ok(A.matchForecast([{ ...pre, algorithmVersion: null }], base).algorithmVersion === null, "版を残す前の回は不明のまま");
ok(A.matchForecast([{ ...pre, algorithmVersion: "old" }], base).algorithmVersion === "old", "残したときの版を使う");

console.log("撮影の日の予報の候補（index.html の forecastCandidates）");
{
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const a = html.indexOf("function forecastCandidates"), b = html.indexOf("/**", a);
  const S = { PHENOMENA: { sunset: {} }, JstCal: { sameDay: (x, y) => Math.floor((x + 9 * 3600e3) / 864e5) === Math.floor((y + 9 * 3600e3) / 864e5) } };
  const day = Date.UTC(2026, 9, 16, 8);               // 17:00 JST
  const rounds = [{ pid: "sunset", peak: day, capturedAt: day - 6 * 3600e3, window: [day - 1200e3, day + 1200e3], score: 60, latitude: 35, longitude: 139, placeId: "p", observations: { "cloud_cover@m": 1 } },
    { pid: "sunrise", peak: day, capturedAt: 0, window: [1, 2], score: 1, latitude: 35, longitude: 139 },
    { pid: "sunset", peak: day - 864e5, capturedAt: 0, window: [1, 2], score: 1, latitude: 35, longitude: 139 }];
  const make = (src) => new Function("S", "store", "bundle", "place", "weeks", "collectObservations", src + ";return forecastCandidates;");
  const fc = make(html.slice(a, b));
  const store = { get: () => rounds };
  const place = { id: "here", latitude: 35.1, longitude: 139.1 };
  const weeks = { sunset: [{ dayMs: day, evaluation: { peak: day, window: [day - 1200e3, day + 1200e3], score: 70, rank: { key: "good" }, confidence: { key: "high" } } }] };
  const got = fc(S, store, { fetchedAt: day - 3600e3 }, place, weeks, () => ({ "cloud_cover@m": 2, _grid_elevation: 9 }))("sunset", day + 600e3);
  ok(got.length === 2 && got[0].origin === "round" && got[0].score === 60, "同じ現象・同じ日の回だけ");
  ok(got[1].origin === "current" && got[1].score === 70 && got[1].capturedAt === day - 3600e3 && got[1].rank === "good", "いまの予報は取得時刻を保存時刻として渡す");
  const onlyGrid = fc(S, store, { fetchedAt: 0 }, place, {}, () => ({ _grid_elevation: 9 }))("sunset", day);
  ok(onlyGrid.length === 1, "気象の値が地点の標高だけなら、いまの予報は候補にしない");
  ok(fc(S, store, null, null, {}, () => ({}))("sunset", null).length === 0, "撮影時刻が無ければ候補なし");
}

console.log("上限を超えたら予報の大きい項目から外す");
{
  const big = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, 1.2345]));
  const forecast = { kind: "pre_event", factors: big(1500), perModel: big(10), observations: big(10) };
  const { analysis, text } = A.buildAnalysis({ computedAt: 1, entry: "record_sheet", input: {}, color: null, forecast });
  ok(analysis && analysis.forecast.factors === null && analysis.forecast.perModel !== null && text.length <= A.MAX_CHARS, "factors だけ外れる");
  ok(JSON.stringify(analysis.forecast.dropped) === '["factors"]', "外したものを残す");
  const small = A.buildAnalysis({ computedAt: 1, entry: "record_sheet", input: {}, color: null, forecast: { kind: "none" } });
  ok(small.analysis.schema === A.SCHEMA && !("dropped" in small.analysis.forecast), "小さければそのまま");
}

console.log(`\n${pass}件成功 / ${fail}件失敗`);
process.exit(fail ? 1 : 0);
