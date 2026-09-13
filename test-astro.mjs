/*
 * 天文と幾何の土台の検査。**外部の権威と突き合わせる。**
 *
 * 自作どうしで比べても、間違ったまま一致するだけ。ここでは
 *   1. Meeus 『Astronomical Algorithms』の worked example（表そのものの正しさ）
 *   2. 米海軍天文台（USNO）の月出没 API（通しで正しいか）
 * の2つに当てる。USNO は通信が要るので、繋がらないときは飛ばす（落とさない）。
 *
 * 2026-09-14 にこの検査が本物の欠陥を2つ出した:
 *   - 観測地補正の時角の符号が逆で、視差が月を「下げる」のでなく「上げて」いた（9分ずれ）
 *   - 国立天文台のCGIを GET で叩いていて、**どの日付でも同じ時刻**が返っていた
 *     （検証側が壊れていた。日付の一致確認を入れて発覚）
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const A = require("./sorami-astro.js");

let pass = 0, fail = 0, skip = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };
const near = (a, b, tol, name, unit = "") =>
  ok(Math.abs(a - b) <= tol, name, `計算 ${a.toFixed(6)} / 期待 ${b} / 差 ${(a - b).toFixed(6)}${unit}`);

console.log("== Meeus の worked example ==");
{
  // 例 47.a  1992年4月12日 0h TD
  const g = A.moonGeocentric(Date.UTC(1992, 3, 12));
  near(g.longitude, 133.162655, 1e-5, "月の黄経（例 47.a）");
  near(g.latitude, -3.229126, 1e-5, "月の黄緯（例 47.a）");
  near(g.distanceKm, 368409.7, 0.1, "月の距離（例 47.a）", " km");
  // 例 25.b  1992年10月13日 0h TD
  near(A.sunPosition(Date.UTC(1992, 9, 13)).longitude, 199.90895, 1e-4, "太陽の見かけ黄経（例 25.b）");
  // 例 22.a  1987年4月10日 0h TD
  const T = A.centuries(Date.UTC(1987, 3, 10));
  near(A.meanObliquity(T), 23 + 26 / 60 + 27.407 / 3600, 1e-6, "平均黄道傾斜（例 22.a）");
  // 章動は簡略式なので 0.5" まで許す（AA 22 の注記どおり）
  near(A.nutation(T).dPsi * 3600, -3.788, 0.5, "章動 Δψ（簡略式・0.5\"以内）", "\"");
  near(A.nutation(T).dEps * 3600, 9.443, 0.5, "章動 Δε（簡略式・0.5\"以内）", "\"");
}

console.log("== 物理的にあり得る範囲か ==");
{
  let minD = Infinity, maxD = -Infinity, minR = Infinity, maxR = -Infinity, maxIll = 0, minIll = 1;
  const obs = { latitude: 35.66, longitude: 139.74, elevation: 0 };
  for (let i = 0; i < 400; i++) {
    const m = A.moon(Date.UTC(2026, 0, 1) + i * 86400000 * 0.7, obs);
    minD = Math.min(minD, m.distanceKm); maxD = Math.max(maxD, m.distanceKm);
    minR = Math.min(minR, m.angularDiameter * 60); maxR = Math.max(maxR, m.angularDiameter * 60);
    maxIll = Math.max(maxIll, m.illuminatedFraction); minIll = Math.min(minIll, m.illuminatedFraction);
  }
  ok(minD > 356000 && minD < 358000, "最も近い月の距離が実際の範囲", `${minD.toFixed(0)} km`);
  ok(maxD > 405000 && maxD < 407500, "最も遠い月の距離が実際の範囲", `${maxD.toFixed(0)} km`);
  ok(minR > 29.0 && minR < 29.8, "最小の見かけ直径", `${minR.toFixed(2)} 分角`);
  ok(maxR > 33.2 && maxR < 34.3, "最大の見かけ直径", `${maxR.toFixed(2)} 分角`);
  ok(maxIll > 0.99, "満月では輝面比がほぼ1", maxIll.toFixed(4));
  ok(minIll < 0.02, "新月では輝面比がほぼ0", minIll.toFixed(4));
}

console.log("== 視差は月を下げる（上げてはいけない）==");
{
  const obs = { latitude: 35.66, longitude: 139.74, elevation: 0 };
  let raised = 0, checked = 0;
  for (let i = 0; i < 200; i++) {
    const ms = Date.UTC(2026, 5, 1) + i * 3600000;
    const m = A.moon(ms, obs);
    if (m.geometricAltitude < 5) continue;         // 地平線近くは大気差が混ざるので除く
    const g = A.moonGeocentric(ms), T = g.T, n = A.nutation(T), eps = A.meanObliquity(T) + n.dEps;
    const eq = A.toEquatorial(g.longitude + n.dPsi, g.latitude, eps);
    const gast = A.apparentSiderealTime(ms, n.dPsi, eps);
    const H = ((gast + obs.longitude - eq.ra) % 360 + 360) % 360;
    const geoAlt = A.toHorizontal(H, eq.dec, obs.latitude).altitude;
    checked++;
    if (m.geometricAltitude > geoAlt + 1e-9) raised++;
  }
  ok(checked > 50, "十分な標本で確かめた", `${checked} 件`);
  ok(raised === 0, "観測地補正で月が上がる例がない", `${raised} 件が上がっていた`);
}

console.log("== 幾何（地球の丸みと大気差）==");
{
  // 標高0mの観測者から見た地平線までの距離。屈折なしで約 3.57√h km
  const noRefr = A.horizonDistanceKm(100, { k: 1 });
  near(noRefr, 3.57 * Math.sqrt(100), 0.5, "地平線までの距離（屈折なし・高さ100m）", " km");
  ok(A.horizonDistanceKm(100) > noRefr, "屈折を入れると地平線は遠くなる",
     `${A.horizonDistanceKm(100).toFixed(1)} km > ${noRefr.toFixed(1)} km`);
  // 富士山（3776m）を100km先から見たときの見かけ高度。
  // 沈み込み 673m を引いて 3103m。atan(3103/100000) = 1.777度。
  // **意外に低い。** 満月（0.52度）の3.4個ぶんしかない
  const a = A.targetElevationAngle(100, 0, 3776);
  near(a, 1.777, 0.01, "100km先の富士山頂の見かけ高度", " 度");
  ok(A.targetElevationAngle(100, 0, 3776) > A.targetElevationAngle(100, 0, 3776, { k: 1 }),
     "屈折があると対象は高く見える");
  ok(A.curvatureDropM(100) > 500 && A.curvatureDropM(100) < 800,
     "100km 先の沈み込み", `${A.curvatureDropM(100).toFixed(0)} m`);
  // 地形遮蔽。**近い低山のほうが、遠い高山より高く見える。**
  // 500m の丘でも 10km なら 2.82度で、100km 先の富士山（1.78度）を隠す。
  // 地形LOSを見なければならない理由がこれ（2026-09-14、検査を書いた側が取り違えた）
  ok(A.terrainBlocks([{ distanceKm: 50, elevationM: 1200 }], 0, 100, 3776).blocked === false,
     "50km 1200m（1.18度）は富士山を隠さない");
  ok(A.terrainBlocks([{ distanceKm: 10, elevationM: 500 }], 0, 100, 3776).blocked === true,
     "10km 500m（2.82度）は富士山を隠す");
  const b = A.terrainBlocks([{ distanceKm: 10, elevationM: 500 }, { distanceKm: 50, elevationM: 1200 }],
                            0, 100, 3776);
  ok(b.blocked === true && b.byDistanceKm === 10, "いちばん高く見える地形で判定する", `${b.byDistanceKm} km`);
  ok(b.marginDeg < 0, "遮られているときは余裕が負", `${b.marginDeg.toFixed(3)} 度`);
  // 観測者が高いところに立てば見える
  ok(A.terrainBlocks([{ distanceKm: 10, elevationM: 500 }], 800, 100, 3776).blocked === false,
     "標高800mに立てば 10km 500m の丘は越えられる");
}

console.log("== USNO の月出没と突き合わせる ==");
{
  const PLACES = [
    { name: "東京", lat: 35.6581, lon: 139.7414 },
    { name: "札幌", lat: 43.0621, lon: 141.3544 },
    { name: "那覇", lat: 26.2124, lon: 127.6809 },
  ];
  const DATES = ["2026-09-14", "2026-09-22", "2026-10-15", "2026-12-25", "2027-03-20"];
  const JST = 9 * 3600000;
  const diffs = [];
  let netFail = false;
  for (const p of PLACES) {
    for (const date of DATES) {
      let d;
      try {
        const r = await fetch(`https://aa.usno.navy.mil/api/rstt/oneday?date=${date}&coords=${p.lat},${p.lon}&tz=9`,
          { signal: AbortSignal.timeout(15000) });
        d = (await r.json()).properties?.data;
      } catch { netFail = true; break; }
      if (!d) { netFail = true; break; }
      // **返ってきた日付が頼んだものと一致するか。** ここを見ないと、
      // 同じ答えを返し続ける相手に気づけない（2026-09-14 に実際に踏んだ）
      const got = `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
      if (got !== date) { ok(false, `USNO が別の日付を返した`, `要求 ${date} / 応答 ${got}`); continue; }
      const [y, mo, dy] = date.split("-").map(Number);
      const day = Date.UTC(y, mo - 1, dy) - JST;
      const ev = A.moonCrossings(day, day + 86400000,
        { latitude: p.lat, longitude: p.lon, elevation: 0 }, { limb: "upper" });
      for (const [phen, kind] of [["Rise", "rise"], ["Set", "set"]]) {
        const u = (d.moondata || []).find((x) => x.phen === phen);
        const e = ev.find((x) => x.kind === kind);
        if (!u || !e) continue;
        const um = Number(u.time.slice(0, 2)) * 60 + Number(u.time.slice(3, 5));
        const t = new Date(e.at + JST);
        let dm = t.getUTCHours() * 60 + t.getUTCMinutes() - um;
        if (dm > 720) dm -= 1440; if (dm < -720) dm += 1440;
        diffs.push(Math.abs(dm));
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    if (netFail) break;
  }
  if (netFail && !diffs.length) {
    skip++; console.log("  skip 通信できないので飛ばす（USNO）");
  } else {
    ok(diffs.length >= 20, "十分な標本を取れた", `${diffs.length} 件`);
    ok(Math.max(...diffs) <= 2, "全て2分以内", `最大 ${Math.max(...diffs)} 分`);
    const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    ok(avg <= 1, "絶対平均が1分以内", `${avg.toFixed(2)} 分`);
  }
}

console.log(`\n${fail === 0 ? "ASTRO OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗${skip ? ` / ${skip} 件スキップ` : ""}`);
process.exit(fail === 0 ? 0 : 1);
