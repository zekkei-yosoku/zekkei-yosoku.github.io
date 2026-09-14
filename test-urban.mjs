// 建物の地平線（urban 層）。**通信しない。** fetch を差し替えて形だけを検査する。
//
// 実データでの挙動は 作業スレッド/2026-09-14_月と富士山の可視予測/03_建物と展望台の高さ
// に実測として残してある（新宿 31.3% が建物の裏、絞り方の比較など）。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const T = require("./sorami-terrain.js");

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };

console.log("== 高さの読み取り ==");
ok(T.buildingHeightM({ height: "133" }) === 133, "height をそのまま使う");
ok(T.buildingHeightM({ height: "45 m" }) === 45, "単位付きでも読む");
ok(T.buildingHeightM({ "building:levels": "48" }) === 48 * 3.5 + 2, "階数から見積もる（3.5m/階＋2m）");
ok(T.buildingHeightM({ height: "133", "building:levels": "48" }) === 133, "height があれば height を優先");
ok(T.buildingHeightM({}) === null, "どちらも無ければ null");
ok(T.buildingHeightM({ height: "0" }) === null, "0m は捨てる");
ok(T.buildingHeightM({ height: "9999" }) === null, "ありえない値は捨てる");
ok(T.buildingHeightM(null) === null, "タグが無くても落ちない");

// 観測者から真東 100m のところに 1辺20m・高さ50m の建物を置く
const OBS = { latitude: 35.0, longitude: 139.0, groundM: 0, elevation: 1.5 };
const mkBox = (bearingDeg, distM, sideM, tags) => {
  const c = T.destination(OBS.latitude, OBS.longitude, bearingDeg, distM / 1000);
  const half = sideM / 2000;
  const n = T.destination(c.latitude, c.longitude, 0, half);
  const s = T.destination(c.latitude, c.longitude, 180, half);
  const e = T.destination(c.latitude, c.longitude, 90, half);
  const w = T.destination(c.latitude, c.longitude, 270, half);
  return { type: "way", id: Math.random(), tags,
    geometry: [{ lat: n.latitude, lon: e.longitude }, { lat: s.latitude, lon: e.longitude },
               { lat: s.latitude, lon: w.longitude }, { lat: n.latitude, lon: w.longitude },
               { lat: n.latitude, lon: e.longitude }] };
};
const stub = (payload) => async () => ({ ok: true, json: async () => payload });

console.log("\n== 建物1棟から地平線を作る ==");
{
  const els = [mkBox(90, 100, 20, { building: "yes", height: "50" })];
  const prof = await T.urbanHorizon(OBS, { fetchImpl: stub({ elements: els }) });
  ok(prof && prof.length === 360, "全周360本を返す", prof ? `${prof.length}` : "null");
  const at = (az) => prof[Math.round(((az % 360) + 360) % 360)].horizonAngleDeg;
  // **手前の面までの距離で測る。** 中心は100mだが一辺20mなので手前の面は90m。
  // 中心距離で期待値を書いて落とした（2026-09-14）。地平線は「その方位で
  // いちばん高く見えるところ」なので、面のうち最も近い点が効く。
  const expect = Math.atan2(50 - 1.5, 90) * 180 / Math.PI;   // 約 28.3度
  ok(Math.abs(at(90) - expect) < 0.5, "真東の仰角が手前の面までの距離と合う",
     `${at(90).toFixed(2)}度 / 期待 ${expect.toFixed(2)}度`);
  ok(at(270) < 0, "反対側は塞がっていない", `${at(270).toFixed(2)}度`);
  // 20m の建物が 100m 先 → 見込み角は約 11.4度ぶん。方位30度も覆っていたら塗りすぎ
  const wide = prof.filter((x) => x.horizonAngleDeg > 0).length;
  ok(wide >= 6 && wide <= 20, "塗る方位の幅が建物の見込み角に見合う", `${wide} 本`);
  ok(prof.meta.buildings === 1 && prof.meta.tallest.heightM === 50, "内訳を返す");
}

console.log("\n== 近い建物ほど高く見える ==");
{
  const near = await T.urbanHorizon(OBS, { fetchImpl: stub({ elements: [mkBox(0, 50, 20, { height: "30" })] }) });
  const far  = await T.urbanHorizon(OBS, { fetchImpl: stub({ elements: [mkBox(0, 500, 20, { height: "30" })] }) });
  ok(near[0].horizonAngleDeg > far[0].horizonAngleDeg * 5, "同じ高さなら近いほうがずっと高い",
     `${near[0].horizonAngleDeg.toFixed(1)}度 vs ${far[0].horizonAngleDeg.toFixed(1)}度`);
}

console.log("\n== 高いところに立つと建物を見下ろす ==");
{
  const high = { ...OBS, elevation: 150 };   // 目線 150m（東京タワー大展望台）
  const prof = await T.urbanHorizon(high, { fetchImpl: stub({ elements: [mkBox(90, 100, 20, { height: "50" })] }) });
  ok(prof[90].horizonAngleDeg < 0, "50mの建物は150mから見れば下", `${prof[90].horizonAngleDeg.toFixed(1)}度`);
}

console.log("\n== 黙って壊れない ==");
{
  ok(await T.urbanHorizon(OBS, { fetchImpl: stub({ elements: [] }) }) === null, "建物が無ければ null");
  ok(await T.urbanHorizon(OBS, { fetchImpl: stub({ elements: [mkBox(0, 100, 20, {})] }) }) === null,
     "高さの無い建物だけなら null（0度の地平線を作らない）");
  // Overpass は打ち切っても 200 で返し、remark に理由を書く
  ok(await T.urbanHorizon(OBS, { fetchImpl: stub({ remark: "runtime error: Query timed out", elements: [] }) }) === null,
     "remark 付きの不完全な応答を使わない");
  ok(await T.urbanHorizon(OBS, { fetchImpl: async () => ({ ok: false }) }) === null, "HTTPエラーで null");
  ok(await T.urbanHorizon(OBS, { fetchImpl: async () => { throw new Error("net"); } }) === null, "通信断で null");
}

console.log("\n== ミラーへ切り替える ==");
{
  // Overpass はよく 504 を返す。1本目が落ちたら次を試す
  const els = [mkBox(90, 100, 20, { height: "50" })];
  const calls = [];
  const flaky = async (url) => {
    calls.push(url);
    if (calls.length === 1) return { ok: false, status: 504 };
    return { ok: true, json: async () => ({ elements: els }) };
  };
  const prof = await T.urbanHorizon(OBS, { fetchImpl: flaky });
  ok(prof !== null, "1本目が504でも2本目で取れる");
  ok(calls.length === 2 && calls[0] !== calls[1], "別のミラーを叩いている", calls.join(" → "));

  const allDown = async () => ({ ok: false, status: 504 });
  ok(await T.urbanHorizon(OBS, { fetchImpl: allDown }) === null, "全部落ちていれば null");

  // remark 付き（打ち切り）も次のミラーへ
  const calls2 = [];
  const remarky = async (url) => {
    calls2.push(url);
    if (calls2.length === 1) return { ok: true, json: async () => ({ remark: "timed out", elements: [] }) };
    return { ok: true, json: async () => ({ elements: els }) };
  };
  ok(await T.urbanHorizon(OBS, { fetchImpl: remarky }) !== null, "打ち切り応答でも次を試す");
  ok(Array.isArray(T.OVERPASS) && T.OVERPASS.length >= 2, "ミラーを2本以上持っている");

  // Overpass は 504 を返さず**そのまま返ってこない**ことがある（実測50秒無応答）。
  // 待ち続けると月の行が永久に出ないので、必ず打ち切る。
  let sawSignal = false;
  await T.urbanHorizon(OBS, { timeoutMs: 50, fetchImpl: async (_u, init) => {
    sawSignal = !!(init && init.signal);
    return { ok: true, json: async () => ({ elements: els }) };
  } });
  ok(sawSignal, "fetch に打ち切りの signal を渡している");

  // 半径も段階で試す。1km が通らない時間帯でも、近場だけ入れば地形だけよりずっと良い
  const radii = [];
  const bigFails = async (_u, init) => {
    const r = /around:(\d+)/.exec(decodeURIComponent(init.body))[1];
    radii.push(+r);
    if (+r >= 1000) return { ok: false, status: 504 };
    return { ok: true, json: async () => ({ elements: els }) };
  };
  const got = await T.urbanHorizon(OBS, { fetchImpl: bigFails });
  ok(got !== null, "1kmが通らなくても近場で取れる");
  ok(got && got.meta.radiusM < 1000, "使った半径を内訳に残す", got ? `${got.meta.radiusM}m` : "");
  ok(radii[0] > radii[radii.length - 1], "広いほうから順に試す", radii.join(" → "));
}

console.log("\n== 重ねると高いほうが勝つ ==");
{
  const terrain = Array.from({ length: 360 }, (_, i) => ({ azimuth: i, horizonAngleDeg: 2 }));
  const urban = await T.urbanHorizon(OBS, { fetchImpl: stub({ elements: [mkBox(90, 100, 20, { height: "50" })] }) });
  const both = T.combinedHorizon({ terrain, urban });
  ok(Math.abs(both(270) - 2) < 0.01, "建物の無い方位は地形の値", `${both(270).toFixed(2)}度`);
  ok(both(90) > 20, "建物のある方位は建物の値", `${both(90).toFixed(2)}度`);
  ok(both.detail(90).blockedBy === "urban", "どちらが遮っているかを返す");
  ok(both.detail(270).blockedBy === "terrain", "地形側も区別できる");
}

console.log(`\n${fail ? "FAILED" : "URBAN OK"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail ? 1 : 0);
