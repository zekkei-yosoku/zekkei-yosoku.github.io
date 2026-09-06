/* 固定地点の実景照合。外部通信なしで証拠のゲートと地点別の採点経路を検証する。 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { VALIDATION_SITES } from "./validation-sites.mjs";
import { validDate, makePlan, prepareRecords, offsetsFor, loadBundle, compare } from "./study-x-sightings.mjs";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");
const DATE = "2026-09-05";
const JST = 9 * 3600;
const byId = (id) => VALIDATION_SITES.find((site) => site.id === id);
const record = (siteId = "kasai-rinkai", overrides = {}) => ({
  siteId, date: DATE, phenomenon: byId(siteId).phenomenon, status: "confirmed",
  url: "https://x.com/example/status/123456789", observedQuality: "strong",
  evidence: { location: "本文に固定地点の名称", date: "本文に撮影年月日", window: "本文に朝夕と撮影時刻", imageReviewed: true },
  ...overrides,
});

// 取得URLに応じて別の地点・別の空を返し、本物の decode/evaluate まで通す。
function weather(url) {
  const params = new URL(url).searchParams;
  const latitudes = params.get("latitude").split(",").map(Number);
  const longitudes = params.get("longitude").split(",").map(Number);
  const variables = params.get("hourly").split(",");
  const start = Date.parse(`${params.get("start_date")}T00:00:00+09:00`) / 1000;
  const end = Date.parse(`${params.get("end_date")}T23:00:00+09:00`) / 1000;
  const time = Array.from({ length: (end - start) / 3600 + 1 }, (_, i) => start + i * 3600);
  const raws = latitudes.map((latitude, i) => {
    const good = latitude > 35.5;
    const values = {
      cloud_cover_low: good ? 10 : 95, cloud_cover_mid: good ? 30 : 95,
      cloud_cover_high: good ? 45 : 95, precipitation: 0, visibility: 25000,
      temperature_2m: 20, relative_humidity_2m: 65, dew_point_2m: 14,
      wind_speed_10m: 5, surface_pressure: 1013,
    };
    const hourly = { time };
    for (const model of S.MODELS.slice(0, 2)) {
      for (const variable of variables) {
        const value = variable.startsWith("relative_humidity_") ? 65 : (values[variable] ?? 0);
        hourly[`${variable}_${model}`] = time.map(() => value);
      }
    }
    return { latitude, longitude: longitudes[i], elevation: Number(params.get("elevation") ?? 0),
      utc_offset_seconds: JST, hourly };
  });
  return raws.length === 1 ? raws[0] : raws;
}

test("6地点はアプリのカタログ座標・標高を参照し、朝3・夕3に分かれる", () => {
  assert.equal(VALIDATION_SITES.length, 6);
  assert.equal(new Set(VALIDATION_SITES.map((site) => site.id)).size, 6);
  assert.equal(VALIDATION_SITES.filter((site) => site.phenomenon === "sunrise").length, 3);
  assert.equal(VALIDATION_SITES.filter((site) => site.phenomenon === "sunset").length, 3);
  for (const site of VALIDATION_SITES) {
    const catalog = globalThis.SORAMI_SPOTS.spots.find((item) => item.id === site.id);
    if (catalog) {
      for (const key of ["name", "latitude", "longitude", "elevation"]) assert.equal(site[key], catalog[key], `${site.id}:${key}`);
      assert.ok(catalog.phenomena.includes(site.phenomenon));
    } else {
      assert.ok(site.coordinateSource, `${site.id}の座標根拠`);
      assert.ok(site.coordinateVerifiedOn, `${site.id}の確認日`);
    }
  }
});

test("実在する日付だけを受け付け、月またぎを含め全日を台帳へ列挙する", () => {
  assert.equal(validDate("2024-02-29"), true);
  for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-1-01", "", null]) assert.equal(validDate(date), false);
  const plan = makePlan("2026-08-31", "2026-09-02");
  assert.equal(plan.records.length, 18);
  assert.deepEqual([...new Set(plan.records.map((r) => r.date))], ["2026-08-31", "2026-09-01", "2026-09-02"]);
  assert.equal(new Set(plan.records.map((r) => `${r.siteId}:${r.date}:${r.phenomenon}`)).size, 18);
  assert.ok(plan.records.every((r) => r.status === "unreviewed" && r.observedQuality === null));
  assert.throws(() => makePlan("2026-09-02", "2026-09-01"), /期間/);
  assert.throws(() => makePlan("2026-01-01", "2027-01-02"), /期間/);
});

test("投稿なしの全日を残し、未確認台帳にはネットワークを使わない", async () => {
  let calls = 0;
  const plan = makePlan("2026-09-01", "2026-09-02");
  const report = await compare(plan, async () => { calls++; throw new Error("呼ばれてはいけない"); });
  assert.equal(calls, 0);
  assert.deepEqual(report.counts, { planned: 12, confirmed: 0, pending: 12, calculated: 0, failed: 0 });
  assert.equal(report.results.length, 0);
  assert.ok(report.pending.every((r) => r.score === null && r.observedQuality === null));
});

test("場所・撮影日・朝夕・画像・URL・品質に不備がある投稿と旧データは採点しない", async () => {
  const original = record();
  const incompleteEvidence = ["location", "date", "window"].map((key) =>
    record("kasai-rinkai", { evidence: { ...original.evidence, [key]: "  " } }));
  const invalid = [
    record("kasai-rinkai", { siteId: "unknown" }),
    record("kasai-rinkai", { phenomenon: "sunset" }),
    record("kasai-rinkai", { date: "2026-02-29" }),
    record("kasai-rinkai", { status: "unreviewed" }),
    record("kasai-rinkai", { url: "https://example.com/image.jpg" }),
    record("kasai-rinkai", { observedQuality: null }),
    record("kasai-rinkai", { evidence: { ...original.evidence, imageReviewed: false } }),
    ...incompleteEvidence,
    { date: DATE, phenomenon: "sunrise", strength: "strong", url: original.url, score: 99 },
  ];
  let calls = 0;
  const report = await compare(invalid, async () => { calls++; throw new Error("呼ばれてはいけない"); });
  assert.equal(calls, 0);
  assert.equal(report.counts.pending, invalid.length);
  assert.equal(report.counts.confirmed, 0);
  assert.ok(report.pending.every((r) => r.score === null && r.reviewReason));
});

test("同一地点・撮影日・現象を二重採点せず、取得前に統合を求める", async () => {
  const a = record();
  const b = record("kasai-rinkai", { url: "https://x.com/other/status/987654321" });
  assert.throws(() => prepareRecords([a, b]), /重複イベント/);
  let calls = 0;
  await assert.rejects(compare([a, b], async () => { calls++; }), /重複イベント/);
  assert.equal(calls, 0);
});

test("2地点の本地点・太陽側URLを独立に作り、標高は本地点だけへ渡す", async () => {
  const requests = [];
  const get = async (url) => { requests.push(new URL(url)); return weather(url); };
  const dawn = byId("kasai-rinkai"), dusk = byId("katase");
  const dawnBundle = await loadBundle(dawn, DATE, "sunrise", get);
  const duskBundle = await loadBundle(dusk, DATE, "sunset", get);
  assert.equal(requests.length, 4);
  for (const [index, site] of [[0, dawn], [2, dusk]]) {
    const home = requests[index].searchParams, offset = requests[index + 1].searchParams;
    assert.equal(home.get("latitude"), site.latitude.toFixed(5));
    assert.equal(home.get("longitude"), site.longitude.toFixed(5));
    assert.equal(home.get("elevation"), String(site.elevation));
    assert.equal(offset.has("elevation"), false);
    assert.equal(offset.get("latitude").split(",").length, 3);
    assert.equal(home.get("timezone"), "Asia/Tokyo");
    assert.equal(offset.get("timezone"), "Asia/Tokyo");
  }
  const dawnLon = requests[1].searchParams.get("longitude").split(",").map(Number);
  const duskLon = requests[3].searchParams.get("longitude").split(",").map(Number);
  assert.ok(dawnLon.every((lon) => lon > dawn.longitude), "朝焼けは東側を取得");
  assert.ok(duskLon.every((lon) => lon < dusk.longitude), "夕焼けは西側を取得");
  assert.notEqual(requests[1].href, requests[3].href);
  assert.ok(dawnBundle.sunriseOffsets && !dawnBundle.sunsetOffsets);
  assert.ok(duskBundle.sunsetOffsets && !duskBundle.sunriseOffsets);
  assert.equal(dawnBundle.home.grid.latitude, Number(dawn.latitude.toFixed(5)));
  assert.equal(duskBundle.home.grid.latitude, Number(dusk.latitude.toFixed(5)));
});

test("時計の既存設定や取得中の変更によらず、国内地点の朝夕を同じ日に採点する", async () => {
  const site = byId("kasai-rinkai");
  S.setTimezoneOffset(JST);
  const expectedOffsets = offsetsFor(site, DATE, "sunrise");
  S.setTimezoneOffset(-8 * 3600);
  assert.deepEqual(offsetsFor(site, DATE, "sunrise"), expectedOffsets);
  const report = await compare([record(), record("katase")], async (url) => {
    S.setTimezoneOffset(-8 * 3600); // 他処理が変更していても compare は採点前に国内時刻へ戻す。
    return weather(url);
  });
  assert.equal(report.counts.calculated, 2);
  assert.equal(S.Cal.startOfDay(Date.parse(`${DATE}T03:00:00Z`)), Date.parse(`${DATE}T00:00:00+09:00`));
  for (const row of report.results) {
    const localHours = row.window.map((time) => (new Date(time).getUTCHours() + 9) % 24);
    assert.ok(localHours.every((hour) => row.phenomenon === "sunrise" ? hour < 12 : hour >= 12));
    assert.ok(row.window.every((time) => new Date(Date.parse(time) + JST * 1000).toISOString().startsWith(DATE)));
  }
});

test("モック気象を実採点まで通し、地点別の点数と参考値の制約を出力する", async () => {
  const report = await compare([record(), record("katase", { observedQuality: "none" })], async (url) => weather(url));
  assert.deepEqual(report.counts, { planned: 2, confirmed: 2, pending: 0, calculated: 2, failed: 0 });
  const [dawn, dusk] = report.results;
  assert.ok(dawn.score > dusk.score, `${dawn.score} > ${dusk.score}`);
  for (const row of report.results) {
    assert.ok(Number.isFinite(row.score) && row.score >= 0 && row.score <= 100);
    assert.equal(row.modelCount, 2);
    assert.equal(Object.keys(row.perModel).length, 2);
    assert.equal(row.airQuality, "missing");
    assert.equal(row.forecastIssuedAt, null);
    assert.equal(row.dataMode, "historical-forecast-reconstruction");
    assert.ok(["圧巻", "よく染まる", "ほんのり", "期待薄"].includes(row.rank));
    assert.equal(row.comparisonStatus, "reference");
  }
  assert.equal(dusk.observedQuality, "none", "染まらなかった確認例も保持する");
  assert.match(report.warning, /当時表示した予報の再現・命中率ではありません/);
});

test("取得失敗は0点にせずnullとし、他地点の照合は続ける", async () => {
  const failedSite = byId("kasai-rinkai");
  const report = await compare([record(), record("katase")], async (url) => {
    if (new URL(url).searchParams.get("latitude") === failedSite.latitude.toFixed(5)) throw new Error("取得失敗のテスト");
    return weather(url);
  });
  assert.equal(report.counts.failed, 1);
  assert.equal(report.counts.calculated, 1);
  assert.equal(report.results[0].score, null);
  assert.equal(report.results[0].comparisonStatus, "error");
  assert.match(report.results[0].error, /取得失敗/);
  assert.ok(Number.isFinite(report.results[1].score));
});

test("太陽側の3地点応答不足と本地点のモデル欠損を採点エラーにする", async () => {
  const shortOffsets = await compare([record()], async (url) => {
    const raw = weather(url);
    return Array.isArray(raw) ? raw.slice(0, 2) : raw;
  });
  assert.equal(shortOffsets.counts.failed, 1);
  assert.equal(shortOffsets.results[0].score, null);
  assert.match(shortOffsets.results[0].error, /太陽側3地点/);
  const missingHome = await compare([record()], async (url) => {
    const raw = weather(url);
    return Array.isArray(raw) ? raw : { ...raw, hourly: { time: raw.hourly.time } };
  });
  assert.equal(missingHome.counts.failed, 1);
  assert.equal(missingHome.results[0].score, null);
  assert.match(missingHome.results[0].error, /モデル/);
});

test("HTTP成功相当でも太陽側雲量が全null、または一モデルだけ欠測なら点数を出さない", async () => {
  for (const missing of ["all", "low", "high"]) {
    const report = await compare([record()], async (url) => {
      const raw = weather(url);
      if (!Array.isArray(raw)) return raw;
      for (let i = 0; i < raw.length; i++) {
        const hourly = raw[i].hourly;
        for (const key of Object.keys(hourly)) {
          if (key === "time") continue;
          const affected = missing === "all"
            || (i === (missing === "low" ? 0 : 2) && key === `cloud_cover_${missing}_${S.MODELS[0]}`);
          if (affected) hourly[key] = hourly.time.map(() => null);
        }
      }
      return raw;
    });
    assert.equal(report.counts.failed, 1, missing);
    assert.equal(report.counts.calculated, 0, missing);
    assert.equal(report.results[0].score, null, missing);
    assert.match(report.results[0].error, /太陽側の雲が欠測/, missing);
  }
});
