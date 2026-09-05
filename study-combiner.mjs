/*
 * 「8モデルの中央値」が本当に最良の合成方法かを、学習/検証を分けて測る。
 *
 * なぜやり直すか:
 *   verify.mjs は全標本で各手法のMAEを出し、その中で一番良かったものを「1位」と呼んでいた。
 *   これは**同じデータで選んで同じデータで評価**しており、差が小さいときは
 *   ノイズを実力と読む。前回の「下層雲はECMWF AIが中央値より良い（11.44 vs 11.78）」も
 *   この形で出た数字で、採用の根拠にはできない。
 *
 * 方法:
 *   前半の日付で各手法のパラメータ（偏り補正・重み・最良単独モデル）を決め、
 *   後半の日付だけで評価する。選ぶのと測るのを分ける。
 *
 * 真値: ERA5 再解析（観測そのものではない。雲量は不確かさが大きい）
 * 対象時刻: 各日の日の入りと日の出（夕焼け・朝焼けが効く瞬間）
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");

const VARS = ["cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "cloud_cover", "precipitation"];
const SITES = [
  { name: "札幌", lat: 43.06, lon: 141.35 }, { name: "青森", lat: 40.82, lon: 140.75 },
  { name: "仙台", lat: 38.27, lon: 140.87 }, { name: "新潟", lat: 37.90, lon: 139.02 },
  { name: "東京", lat: 35.68, lon: 139.77 }, { name: "松本", lat: 36.24, lon: 137.97 },
  { name: "名古屋", lat: 35.18, lon: 136.91 }, { name: "金沢", lat: 36.59, lon: 136.63 },
  { name: "大阪", lat: 34.69, lon: 135.50 }, { name: "広島", lat: 34.39, lon: 132.46 },
  { name: "高知", lat: 33.56, lon: 133.53 }, { name: "福岡", lat: 33.59, lon: 130.40 },
  { name: "鹿児島", lat: 31.60, lon: 130.56 }, { name: "那覇", lat: 26.21, lon: 127.68 },
];

const DAYS = Number(process.argv[2] || 180);
const end = new Date(Date.now() - 3 * 86400000);
const start = new Date(end.getTime() - DAYS * 86400000);
const iso = (d) => d.toISOString().slice(0, 10);

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({ error: true, reason: "JSONではない応答" }));
    if (res.ok && !body.error) return body;
    if (body.reason && /limit/i.test(body.reason)) {
      await new Promise((r) => setTimeout(r, 20000 * (i + 1)));
      continue;
    }
    throw new Error(body.reason || `HTTP ${res.status}`);
  }
  throw new Error("リトライ上限");
}
const asList = (raw) => (Array.isArray(raw) ? raw : [raw]);
const params = (extra) => new URLSearchParams({
  latitude: SITES.map((s) => s.lat).join(","), longitude: SITES.map((s) => s.lon).join(","),
  start_date: iso(start), end_date: iso(end),
  hourly: VARS.join(","), timezone: "auto", timeformat: "unixtime", ...extra,
});
function toSeries(payload, suffix = "") {
  const times = payload.hourly.time.map((t) => t * 1000);
  const columns = {};
  for (const v of VARS) {
    const col = payload.hourly[`${v}_${suffix}`] ?? payload.hourly[v];
    if (col) columns[v] = col;
  }
  return new S.Series(times, columns);
}

console.log(`期間 ${iso(start)} 〜 ${iso(end)}（${DAYS}日）／ ${SITES.length}地点／ 日の入りと日の出`);
const truth = asList(await getJSON(
  `https://archive-api.open-meteo.com/v1/archive?${params({ models: "era5" })}`)).map((p) => toSeries(p));

const forecast = {};
for (const m of S.MODELS) {
  try {
    forecast[m] = asList(await getJSON(
      `https://historical-forecast-api.open-meteo.com/v1/forecast?${params({ models: m })}`))
      .map((p) => toSeries(p, m));
    process.stdout.write(`  ${S.MODEL_NAMES[m]}\n`);
  } catch (e) { process.stdout.write(`  ${S.MODEL_NAMES[m]} 取得できず（${e.message}）\n`); }
  await new Promise((r) => setTimeout(r, 1500));
}
const MODELS = S.MODELS.filter((m) => forecast[m]);

// --- 標本づくり
const samples = [];
for (let si = 0; si < SITES.length; si++) {
  for (let d = 0; d <= DAYS; d++) {
    const dayMs = start.getTime() + d * 86400000;
    for (const ev of ["sunset", "sunrise"]) {
      const t = S.Sun.eventTime(ev, dayMs, SITES[si].lat, SITES[si].lon);
      if (t === null) continue;
      const truthVals = {};
      let ok = true;
      for (const v of VARS) {
        const x = truth[si]?.valueAt(v, t);
        if (x === null || x === undefined) { ok = false; break; }
        truthVals[v] = x;
      }
      if (!ok) continue;
      const byModel = {};
      for (const m of MODELS) {
        const f = {};
        let full = true;
        for (const v of VARS) {
          const x = forecast[m][si]?.valueAt(v, t);
          if (x === null || x === undefined) { full = false; break; }
          f[v] = x;
        }
        if (full) byModel[m] = f;
      }
      // 全モデルが揃った標本だけを使う。母数が標本ごとに変わると手法の比較にならない
      // （虹で踏んだのと同じ罠）。
      if (Object.keys(byModel).length === MODELS.length) {
        samples.push({ site: SITES[si].name, t, day: d, truth: truthVals, byModel });
      }
    }
  }
}
samples.sort((a, b) => a.t - b.t);
const cut = Math.floor(samples.length * 0.6);
const train = samples.slice(0, cut), test = samples.slice(cut);
console.log(`\n標本 ${samples.length}件（全${MODELS.length}モデルが揃ったもののみ）`);
console.log(`学習 ${train.length}件（${iso(new Date(train[0].t))}〜${iso(new Date(train[cut - 1].t))}）`);
console.log(`検証 ${test.length}件（${iso(new Date(test[0].t))}〜${iso(new Date(test.at(-1).t))}）\n`);

const clampFor = (v) => (v === "precipitation" ? [0, Infinity] : [0, 100]);
const clamp = (x, v) => { const [lo, hi] = clampFor(v); return Math.min(hi, Math.max(lo, x)); };
const mae = (list, f, v) => list.reduce((s, x) => s + Math.abs(f(x, v) - x.truth[v]), 0) / list.length;
const bias = (list, f, v) => list.reduce((s, x) => s + (f(x, v) - x.truth[v]), 0) / list.length;

// --- 合成の手法。パラメータは train だけで決める
function build(v) {
  const vals = (x) => MODELS.map((m) => x.byModel[m][v]);
  const modelBias = {}, modelMse = {};
  for (const m of MODELS) {
    modelBias[m] = train.reduce((s, x) => s + (x.byModel[m][v] - x.truth[v]), 0) / train.length;
    modelMse[m] = train.reduce((s, x) => s + (x.byModel[m][v] - x.truth[v]) ** 2, 0) / train.length;
  }
  const bestSingle = MODELS.slice().sort((a, b) =>
    train.reduce((s, x) => s + Math.abs(x.byModel[a][v] - x.truth[v]), 0) -
    train.reduce((s, x) => s + Math.abs(x.byModel[b][v] - x.truth[v]), 0))[0];
  const w = MODELS.map((m) => 1 / Math.max(modelMse[m], 1e-6));
  const wsum = w.reduce((a, b) => a + b, 0);

  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const trimmed = (a) => {
    const s = a.slice().sort((x, y) => x - y);
    return s.length > 2 ? mean(s.slice(1, -1)) : mean(s);
  };
  const debiased = (x) => MODELS.map((m) => x.byModel[m][v] - modelBias[m]);

  return {
    meta: { bestSingle: S.MODEL_NAMES[bestSingle], bias: modelBias },
    methods: {
      "★中央値（現行）": (x) => S.Curve.median(vals(x)),
      "単純平均": (x) => mean(vals(x)),
      "刈込平均(最大最小を除く)": (x) => trimmed(vals(x)),
      "最良単独(学習で選択)": (x) => x.byModel[bestSingle][v],
      "偏り補正→中央値": (x) => clamp(S.Curve.median(debiased(x)), v),
      "偏り補正→平均": (x) => clamp(mean(debiased(x)), v),
      "誤差重み付き平均": (x) => clamp(MODELS.reduce((s, m, i) => s + w[i] * x.byModel[m][v], 0) / wsum, v),
      "偏り補正→重み付き平均": (x) =>
        clamp(MODELS.reduce((s, m, i) => s + w[i] * (x.byModel[m][v] - modelBias[m]), 0) / wsum, v),
    },
  };
}

const pad = (s, w) => String(s) + " ".repeat(Math.max(0, w -
  [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 0x1100 ? 2 : 1), 0)));

const winners = {};
for (const v of VARS) {
  const { meta, methods } = build(v);
  console.log(`■ ${v}   （学習での最良単独: ${meta.bestSingle}）`);
  console.log(`  ${pad("手法", 26)} ${pad("検証MAE", 9)} ${pad("学習MAE", 9)} ${pad("偏り", 8)}`);
  const rows = Object.entries(methods).map(([name, f]) =>
    ({ name, test: mae(test, f, v), train: mae(train, f, v), b: bias(test, f, v) }));
  const base = rows.find((r) => r.name.startsWith("★")).test;
  rows.sort((a, b) => a.test - b.test);
  for (const r of rows) {
    const d = ((r.test - base) / base * 100);
    console.log(`  ${pad(r.name, 26)} ${pad(r.test.toFixed(3), 9)} ${pad(r.train.toFixed(3), 9)} `
      + `${pad(r.b >= 0 ? "+" + r.b.toFixed(2) : r.b.toFixed(2), 8)}`
      + (r.name.startsWith("★") ? "" : `  ${d >= 0 ? "+" : ""}${d.toFixed(1)}%`));
  }
  winners[v] = { best: rows[0], base };
  console.log("");
}

console.log("── まとめ（検証側だけで判定）");
for (const v of VARS) {
  const { best, base } = winners[v];
  const gain = (base - best.test) / base * 100;
  console.log(`  ${pad(v, 20)} 最良: ${pad(best.name, 26)} 現行比 ${gain > 0 ? "-" : "+"}${Math.abs(gain).toFixed(1)}%`);
}
console.log(`\n注意: ERA5は観測ではなく再解析。雲量の真値としての不確かさは大きい。`);
console.log(`差が数%なら、手法の優劣ではなく標本の揺らぎの可能性を先に疑うこと。`);
