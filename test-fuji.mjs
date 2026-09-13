/*
 * 富士山が見えるかの検査。
 *
 * **年間可視日数で較正した**（§102「a,b,cを感覚で固定禁止」・§173 Score Calibration）。
 * 東京から富士山が見えるのは年間およそ 50〜130日、冬に集中し夏はほとんど無い、
 * というのはよく知られた統計。ERA5 と CAMS の実データ1年ぶんを流して確かめる。
 *
 * 2026-09-14 の結果（H下限0.3km・コントラスト閾値 0.02 ＝ Koschmieder の物理値）:
 *   年間 90日  冬(12-2月) 53日  夏(6-8月) 0日
 *   11月20 / 12月21 / 1月22 / 2月10 / 6-8月 0
 * **係数を一切いじらずに合った。**
 *
 * この較正で本物の欠陥が2つ出た:
 *   1. 地上視程で Koschmieder を距離に掛けていた。Open-Meteo の視程は **24kmで頭打ち**
 *      （しかもGFSのみ）で、東京からは常に「くっきり0」になった（§66・§69 が警告している誤り）
 *   2. 「境界層より上なら消散ゼロ」という段差にしたら、朝の浅い境界層で
 *      **くっきり100** が出た。指数分布に直した（§70-72）
 *
 * 通信の要る部分は、繋がらなければ飛ばす（落とさない）。
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const A = require("./sorami-astro.js");
const F = require("./sorami-fuji.js");

let pass = 0, fail = 0, skip = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };

console.log("== 視線の高さ ==");
{
  for (const D of [15, 50, 100, 169]) {
    const end = F.sightLineHeightM(D, 100, D, 3776);
    ok(Math.abs(end - 3776) < 5, `${D}km 先の視線は山頂で終わる`, `${end.toFixed(0)} m`);
  }
  ok(F.sightLineHeightM(0, 171, 98, 3776) === 171, "起点は目の高さ");
  // 遠いほど、同じ距離での視線は低い（角度が浅いから）
  ok(F.sightLineHeightM(20, 100, 50, 3776) > F.sightLineHeightM(20, 100, 150, 3776),
     "近い山を見るときのほうが視線は急");
}

console.log("== 雲の層 ==");
{
  ok(F.CLOUD_BANDS.low.topM === 2000 && F.CLOUD_BANDS.mid.topM === 6000, "層の区切りが ECMWF の定義");
  // **富士山は 3776m。高層雲は山より上にあって視線を塞がない**
  const at99 = F.sightLineHeightM(99, 171, 100, 3776);
  ok(at99 < F.CLOUD_BANDS.high.baseM, "山頂手前でも視線は高層雲より下", `${at99.toFixed(0)} m`);
  ok(F.seeThrough(0) === 1, "雲が無ければ素通し");
  ok(F.seeThrough(100) > 0 && F.seeThrough(100) < 0.4,
     "全天曇りでも 0 にはしない（薄い雲は透ける・§50）", F.seeThrough(100).toFixed(2));
  let prev = 2;
  for (const c of [0, 25, 50, 75, 100]) { const v = F.seeThrough(c); ok(v <= prev, `雲量 ${c}% で単調に減る`, v.toFixed(2)); prev = v; }
}

console.log("== 空気の澄み具合 ==");
{
  const mk = (aod, pbl, rh) => F.clarityOf({ relative_humidity_2m: rh, boundary_layer_height: pbl },
    { aerosol_optical_depth: aod, dust: 0 }, 98, { observerEyeM: 171 });
  // **段差が無いこと。** 目の高さの前後で境界層を動かしても飛ばない
  const near = [100, 150, 171, 200, 250].map((p) => mk(0.14, p, 40).value);
  ok(Math.max(...near) - Math.min(...near) < 0.05, "目の高さの前後で跳ばない", JSON.stringify(near.map((v) => v.toFixed(2))));
  // 濃いほど悪くなる（単調）
  let prev = 2;
  for (const aod of [0.05, 0.1, 0.2, 0.4, 0.8]) { const v = mk(aod, 800, 50).value; ok(v <= prev, `AOD ${aod} で単調に下がる`, v.toFixed(2)); prev = v; }
  // 近い山は霞に強い
  const far = F.clarityOf({ relative_humidity_2m: 70, boundary_layer_height: 800 },
    { aerosol_optical_depth: 0.3, dust: 0 }, 98, { observerEyeM: 171 }).value;
  const close = F.clarityOf({ relative_humidity_2m: 70, boundary_layer_height: 800 },
    { aerosol_optical_depth: 0.3, dust: 0 }, 15, { observerEyeM: 982 }).value;
  ok(close > far, "同じ霞でも近い山のほうがくっきり", `15km ${close.toFixed(2)} > 98km ${far.toFixed(2)}`);
  ok(mk(0.14, 800, 90).value <= mk(0.14, 800, 30).value, "湿度が高いほど霞む（吸湿成長・§75）");
  ok(F.clarityOf({ relative_humidity_2m: 50 }, null, 98, {}).value === null, "エアロゾルが無ければ判定しない");
}

console.log("== 採点は掛け算（§103）==");
{
  const geom = { available: true, classification: "FULL", fraction: 1, distanceKm: 98,
                 apparentSize: { deg: 1.6, label: "はっきり分かる" } };
  const home = { byModel: { m: { isSupported: () => true, valueAt: (v) => ({
    visibility: 24000, cloud_cover_low: 0, cloud_cover_mid: 0, cloud_cover_high: 0,
    relative_humidity_2m: 40, precipitation: 0, boundary_layer_height: 600 }[v] ?? null) } } };
  const air = { isSupported: () => true, valueAt: (v) => ({ aerosol_optical_depth: 0.08, dust: 0 }[v] ?? null) };
  const weather = { summit: { byModel: { m: { isSupported: () => true, valueAt: () => 0 } } }, corridor: [] };
  const good = F.evaluateFuji(geom, weather, home, Date.now(), { air, observerEyeM: 171 });
  ok(good.available && good.score > 0, "晴れていれば点が付く", `${good.score} 点 ${good.band.label}`);

  // 富士山が雲に覆われていたら、自地点が晴れていても落ちる（足し算だと相殺する・§104）
  const capped = { summit: { byModel: { m: { isSupported: () => true,
    valueAt: (v) => (v === "cloud_cover_mid" ? 100 : 0) } } }, corridor: [] };
  const bad = F.evaluateFuji(geom, capped, home, Date.now(), { air, observerEyeM: 171 });
  ok(bad.score < good.score * 0.5, "富士山が雲の中なら、自地点が晴れていても大きく落ちる",
     `${good.score} → ${bad.score} 点`);

  // 幾何で見えないなら天気を見るまでもない（§3・§109）
  const none = F.evaluateFuji({ available: true, classification: "NONE", fraction: 0 },
                              weather, home, Date.now(), { air });
  ok(none.score === 0 && none.blockedByTerrain === true, "地形に隠れていれば天気によらず0");
  ok(none.confidence === "A", "地形の判定は天気と違って確か");
}

console.log("== 年間可視日数で較正されているか（通信）==");
{
  const LAT = 35.6586, LON = 139.7454, EYE = 171, DIST = 98;
  let data = null;
  try {
    const met = await (await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}`
      + `&start_date=2025-09-01&end_date=2026-08-31&hourly=cloud_cover_low,cloud_cover_mid,relative_humidity_2m,boundary_layer_height&timezone=Asia/Tokyo`,
      { signal: AbortSignal.timeout(60000) })).json();
    const air = await (await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LON}`
      + `&start_date=2025-09-01&end_date=2026-08-31&hourly=aerosol_optical_depth,dust&timezone=Asia/Tokyo`,
      { signal: AbortSignal.timeout(60000) })).json();
    const aod = new Map(air.hourly.time.map((t, i) => [t, air.hourly.aerosol_optical_depth[i]]));
    const dust = new Map(air.hourly.time.map((t, i) => [t, air.hourly.dust[i]]));
    data = met.hourly.time.map((t, i) => ({ t, rh: met.hourly.relative_humidity_2m[i],
      pbl: met.hourly.boundary_layer_height[i], cl: met.hourly.cloud_cover_low[i],
      cm: met.hourly.cloud_cover_mid[i], aod: aod.get(t), dust: dust.get(t) }));
  } catch { data = null; }
  if (!data || data.length < 8000) { skip++; console.log("  skip 通信できないので飛ばす（過去データ）"); }
  else {
    const byDay = new Map();
    for (const r of data) {
      const hh = Number(r.t.slice(11, 13));
      if (hh < 6 || hh > 17 || r.aod == null || r.rh == null) continue;
      const c = F.clarityOf({ relative_humidity_2m: r.rh, boundary_layer_height: r.pbl },
        { aerosol_optical_depth: r.aod, dust: r.dust }, DIST, { observerEyeM: EYE });
      const clear = F.seeThrough(r.cl) * F.seeThrough(r.cm) > 0.5;
      const day = r.t.slice(0, 10);
      byDay.set(day, (byDay.get(day) || false) || (clear && c.contrast >= F.CONTRAST_THRESHOLD));
    }
    const vis = [...byDay.entries()].filter(([, v]) => v);
    const cnt = (mm) => vis.filter(([d]) => mm.includes(d.slice(5, 7))).length;
    const total = vis.length, winter = cnt(["12", "01", "02"]), summer = cnt(["06", "07", "08"]);
    ok(total >= 50 && total <= 130, "年間の可視日数が統計の範囲", `${total} 日（統計 50〜130日）`);
    ok(winter >= 30, "冬に十分な日数がある", `${winter} 日`);
    ok(summer <= 10, "夏はほとんど見えない", `${summer} 日`);
    ok(winter > summer * 3, "冬に強く偏る", `冬 ${winter} / 夏 ${summer}`);
  }
}

console.log(`\n${fail === 0 ? "FUJI OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗${skip ? ` / ${skip} 件スキップ` : ""}`);
process.exit(fail === 0 ? 0 : 1);
