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
  // **建物の無い方位は −90（この層は何も言わない）。**
  // 0 を置くと、高い場所で下がった地平線（東京タワー150mで −0.4度）を潰す。
  ok(at(270) === -90, "建物の無い方位はこの層が何も言わない", `${at(270).toFixed(2)}度`);
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

console.log("\n== 建物だけで地平線を作っても壊れない ==");
{
  // 地形の測定は標高APIが429で落ちることがある。そのとき建物だけで地平線を作るが、
  // 建物の無い方位が負の値だと「月は常に地平線の上」になる
  const urban = await T.urbanHorizon(OBS, { fetchImpl: stub({ elements: [mkBox(90, 100, 20, { height: "50" })] }) });
  const only = T.combinedHorizon({ terrain: T.flatProfile(), urban });
  ok(only(270) === 0, "建物の無い方位は平らな 0度", `${only(270).toFixed(2)}度`);
  ok(only(90) > 20, "建物のある方位は上がる", `${only(90).toFixed(2)}度`);
  // 建物層だけで作ると壊れる。**必ず下敷きを敷く**
  const broken = T.combinedHorizon({ urban });
  ok(broken(270) === -90, "建物層だけだと地平線が −90 になる（だから下敷きが要る）");
  const A = require("./sorami-astro.js");
  const obs = { latitude: 35.6556, longitude: 139.7476, elevation: 10 };
  const day = Date.UTC(2026, 8, 14) - 9 * 3600000;
  const flat = A.moonEvents(day, day + 86400000, obs, {});
  const withU = A.moonEvents(day, day + 86400000, obs, { horizonAt: only });
  const rf = flat.astronomical.find((e) => e.kind === "rise");
  const ru = withU.terrain.find((e) => e.kind === "rise" && e.event === "firstLimb");
  ok(!ru || ru.at >= rf.at - 60000, "月の出が暦より早くならない",
     ru ? `${Math.round((ru.at - rf.at) / 60000)} 分` : "月の出なし");
}

console.log("\n== 建物は時刻を動かす（点数ではない）==");
{
  // 観測者の西に高い建物を置くと、月の入りだけが早まる。東の月の出は動かない。
  // 実測（芝公園・西南西にザ・プリンス パークタワー 117.5m・24m先）:
  //   月の出 0〜5分の遅れ / **月の入り 80〜130分の早まり**
  const A = require("./sorami-astro.js");
  // **建物を置いた座標と、月を計算する座標を揃える。**
  // mkBox は OBS の周りに置くので、別の座標で月を出すと建物が効かない（実際に踏んだ）
  const obs = OBS;
  // 月の入りの方位を先に出して、そこへ建物を置く
  const day0 = Date.UTC(2026, 8, 16) - 9 * 3600000;
  const setEv = A.moonEvents(day0, day0 + 86400000, obs, {}).astronomical.find((e) => e.kind === "set");
  const setAz = A.moon(setEv.at, obs).azimuth;
  const west = await T.urbanHorizon(obs,
    { fetchImpl: stub({ elements: [mkBox(setAz, 60, 40, { height: "120" })] }) });
  const base = T.combinedHorizon({ terrain: T.flatProfile() });
  const both = T.combinedHorizon({ terrain: T.flatProfile(), urban: west });
  const day = day0;
  const ev = (fn) => A.moonEvents(day, day + 86400000, obs, { horizonAt: fn });
  const pick = (e, kind, name) => e.terrain.find((x) => x.kind === kind && x.event === name)?.at ?? null;
  const f = ev(base), u = ev(both);
  const riseShift = (pick(u, "rise", "firstLimb") ?? 0) - (pick(f, "rise", "firstLimb") ?? 0);
  const setShift = (pick(f, "set", "start") ?? 0) - (pick(u, "set", "start") ?? 0);
  ok(Math.abs(riseShift) < 2 * 60000, "月の出の方位に何も無ければ動かない",
     `${Math.round(riseShift / 60000)} 分`);
  ok(setShift > 20 * 60000, "月の入りの方位にある建物は、入りを早める",
     `方位 ${setAz.toFixed(0)}度 / ${Math.round(setShift / 60000)} 分早まる`);
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

console.log("\n== 地域の代表地点と観測地点を分ける ==");
{
  const city = { id: "search:35.1614,138.6764", name: "富士市", latitude: 35.1614, longitude: 138.6764 };
  ok(T.locationScope(city) === "area", "既存の富士市検索スポットを代表地点へ移行");
  ok(T.locationScope({ ...city, name: "富士市役所" }) === "point", "市役所自体を選んだときは観測地点");
  ok(T.locationScope({ ...city, locationScope: "point" }) === "point", "検索元の明示種別を名前より優先");
  ok(T.locationScope({ id: "geo:35,139", name: "富士市" }) === "point", "現在地の名前を市名に変えても観測地点");
  ok(T.locationScope({ id: "spot", name: "ドイツ村" }) === "point", "同梱施設の村という末尾では除外しない");
  ok(T.locationScope({ id: "default" }) === "area", "既定の東京も代表地点");
  for (const type of ["city", "town", "village", "suburb"]) {
    ok(T.searchLocationScope({ category: "place", addresstype: type }) === "area", `検索の ${type} は地域`);
  }
  ok(T.searchLocationScope({ category: "boundary", type: "administrative" }) === "area", "行政界は地域");
  ok(T.searchLocationScope({ category: "tourism", type: "viewpoint", name: "村" }) === "point", "展望地点は建物を維持");
  ok(T.searchLocationScope({ category: "amenity", type: "townhall", addresstype: "amenity" }) === "point", "施設としての市役所も建物を維持");
  let calls = 0;
  ok(await T.urbanHorizon({ ...OBS, locationScope: "area" }, { fetchImpl: async () => { calls++; throw Error(); } }) === null,
    "地域では建物層を作らない");
  ok(calls === 0, "地域ではOverpassへ問い合わせない");
  const point = await T.urbanHorizon({ ...OBS, locationScope: "point" },
    { fetchImpl: stub({ elements: [mkBox(90, 22, 8, { height: "37" })] }) });
  ok(point[90].horizonAngleDeg > 50, "具体地点では22m先の37m建物も除外しない");
  // 富士市役所の再現: 観測点が輪郭の内側で、頂点までは22m以上ある（OSM way 565645878）
  const inside = await T.urbanHorizon({ ...OBS, locationScope: "point" },
    { fetchImpl: stub({ elements: [mkBox(0, 0, 60, { height: "37" })] }) });
  ok(inside === null, "立っている建物（頂点から離れた内側）を全周の壁にしない");
  const insideAndNext = await T.urbanHorizon({ ...OBS, locationScope: "point" },
    { fetchImpl: stub({ elements: [mkBox(0, 0, 60, { height: "37" }), mkBox(90, 100, 20, { height: "50" })] }) });
  ok(insideAndNext && insideAndNext.meta.buildings === 1 && insideAndNext[270].horizonAngleDeg === -90
     && insideAndNext[90].horizonAngleDeg > 20, "隣の建物だけを数えて地平線にする",
     insideAndNext ? `${insideAndNext.meta.buildings}棟 / 90°=${insideAndNext[90].horizonAngleDeg.toFixed(1)} 270°=${insideAndNext[270].horizonAngleDeg}` : "null");
  ok(T.urbanCacheKey(OBS) !== T.urbanCacheKey({ ...OBS, latitude: OBS.latitude + 0.00001 }), "約1m離れた地点の建物キャッシュを共有しない");
  ok(T.urbanCacheKey(OBS) !== T.urbanCacheKey({ ...OBS, groundM: 1 }), "同じ標高でも地面が異なれば別キャッシュ");
  ok(T.urbanCacheKey(OBS) !== T.urbanCacheKey({ ...OBS, elevation: 1.6 }), "目の高さを丸めて共有しない");
}

console.log(`\n${fail ? "FAILED" : "URBAN OK"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail ? 1 : 0);
