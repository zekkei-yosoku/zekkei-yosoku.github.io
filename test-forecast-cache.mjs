// Open-Meteo の応答の使い回し（S.cachedFetch）。**通信しない。** fetch と Cache Storage を差し替える。
//
// 2026-09-22: 起動・地点の切り替え・配信後の読み直しのたびに全部を取り直し、
// 無料枠（回線ごと600回/分）を超えて「予測に失敗しました」が頻発していた。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };

// ---- 差し替え
let clock = Date.parse("2026-09-22T12:00:00+09:00");
const realNow = Date.now;
Date.now = () => clock;

const calls = [];
let nextStatus = 200;
globalThis.fetch = async (url) => {
  calls.push(String(url));
  const status = nextStatus;
  const body = status === 200 ? { n: calls.length, url: String(url) } : { error: true, reason: "Minutely API request limit exceeded" };
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
};

const stored = new Map();
const fakeCache = {
  async match(req) {
    const e = stored.get(String(req.url ?? req));
    return e ? new Response(e.text, { status: 200, headers: e.headers }) : undefined;
  },
  async put(req, res) {
    stored.set(String(req.url ?? req), { text: await res.text(), headers: Object.fromEntries(res.headers) });
  },
  async keys() { return [...stored.keys()].map((url) => ({ url })); },
  async delete(req) { return stored.delete(String(req.url ?? req)); },
};
globalThis.caches = { open: async () => fakeCache };

const S = require("./sorami-core.js");
const OM = "https://api.open-meteo.com/v1/forecast?latitude=35.1&longitude=138.6";
const settle = () => new Promise((r) => setTimeout(r, 0));   // 掃除（投げっぱなし）を待つ

console.log("== 30分以内は取り直さない ==");
{
  const a = await (await S.cachedFetch(OM)).json();
  const b = await (await S.cachedFetch(OM)).json();
  ok(calls.length === 1, "2回目は通信しない", `calls=${calls.length}`);
  ok(a.n === 1 && b.n === 1, "同じ中身が返る");
  clock += 29 * 60 * 1000;
  await S.cachedFetch(OM);
  ok(calls.length === 1, "29分後もまだ使い回す");
  clock += 2 * 60 * 1000;
  const c = await (await S.cachedFetch(OM)).json();
  ok(calls.length === 2 && c.n === 2, "30分を過ぎたら取り直す", `calls=${calls.length}`);
}

console.log("== 失敗した応答はとっておかない ==");
{
  const url = OM + "&x=429";
  nextStatus = 429;
  const r1 = await S.cachedFetch(url);
  ok(r1.status === 429, "429 はそのまま返す（呼び手が失敗として扱える）");
  ok(!stored.has(url), "429 は保存しない");
  nextStatus = 200;
  const before = calls.length;
  const r2 = await S.cachedFetch(url);
  ok(r2.status === 200 && calls.length === before + 1, "次は取りに行って成功する");
}

console.log("== Open-Meteo 以外は触らない ==");
{
  const before = calls.length;
  const other = "https://www.jma.go.jp/bosai/amedas/data/latest_time.txt";
  await S.cachedFetch(other); await S.cachedFetch(other);
  ok(calls.length === before + 2, "気象庁などは毎回取りに行く");
  ok(!stored.has(other), "保存もしない");
  const b2 = calls.length;
  await S.cachedFetch("https://ensemble-api.open-meteo.com/v1/ensemble?a=1");
  await S.cachedFetch("https://ensemble-api.open-meteo.com/v1/ensemble?a=1");
  ok(calls.length === b2 + 1, "サブドメイン（ensemble・air-quality）も使い回す");
  await S.cachedFetch("https://evil.example/open-meteo.com/v1/x");
  await S.cachedFetch("https://evil.example/open-meteo.com/v1/x");
  ok(calls.length === b2 + 3, "パスに open-meteo.com を含むだけの別サイトは対象外");
}

console.log("== 取得時刻を運ぶ ==");
{
  const url = OM + "&t=1";
  const t0 = clock;
  await S.cachedFetch(url);
  clock += 10 * 60 * 1000;
  const r = await S.cachedFetch(url);
  ok(Number(r.headers.get("x-sorami-fetched-at")) === t0, "使い回した応答は最初に取った時刻を持つ");
}

console.log("== 期限切れは掃除する ==");
{
  clock += 60 * 60 * 1000;
  await S.cachedFetch(OM + "&fresh=1");
  await settle(); await settle();
  const left = [...stored.keys()];
  ok(left.length === 1 && left[0].endsWith("&fresh=1"), "新しい1件だけ残る", JSON.stringify(left.length));
}

console.log("== Cache Storage が無い環境では毎回取りに行く ==");
{
  const saved = globalThis.caches;
  delete globalThis.caches;
  const before = calls.length;
  await S.cachedFetch(OM); await S.cachedFetch(OM);
  ok(calls.length === before + 2, "node や古いブラウザでは従来どおり");
  globalThis.caches = { open: async () => { throw new Error("SecurityError"); } };
  const r = await S.cachedFetch(OM);
  ok(r.ok && calls.length === before + 3, "保存領域が開けなくても取得は止めない");
  globalThis.caches = saved;
}

Date.now = realNow;
console.log(`\n${fail === 0 ? "FORECAST CACHE OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
