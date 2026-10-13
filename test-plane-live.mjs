// 月丼ライブ（`sorami-plane-live.js`）。**通信しない。**
//
// 月の前を横切る機体を幾何で作り、通過の時刻と円盤にかかる時間が出るかを確かめる。
// 進入路への吸着と減速、古い位置・地上・外挿の打ち切りも見る（2026-10-13 E199）。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const A = require("./sorami-astro.js");
const RT = require("./sorami-routes.js");
const L = require("./sorami-plane-live.js");

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };

// 月が高さ20°前後にある時刻（2026-10-13 15:45 JST、城南島から方位217°・高さ21°）
const NOW = Date.parse("2026-10-13T15:45:00+09:00");
const spot = RT.SPOTS.find((s) => s.id === "jonanjima");
const obs = { latitude: spot.latitude, longitude: spot.longitude, elevation: 3, eyeM: 1.5 };

/// 月の前を、lead 秒後に、distKm 先で、真横に gs で横切る機体
function crossing(lead, distKm, gs, extra = {}) {
  const m = A.moon(NOW + lead * 1000, obs);
  let lo = 0, hi = 8000;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (A.targetElevationAngle(distKm, obs.elevation + obs.eyeM, mid) < m.apparentAltitude) lo = mid; else hi = mid;
  }
  const h = (lo + hi) / 2;
  const q = RT.destination(obs.latitude, obs.longitude, m.azimuth, distKm);
  const track = (m.azimuth + 90) % 360;
  const st = RT.destination(q.latitude, q.longitude, (track + 180) % 360, gs * 0.514444 * lead / 1000);
  return { hex: "t" + lead, flight: "TEST", t: "B738", lat: st.latitude, lon: st.longitude,
    alt_baro: Math.round(h / 0.3048), alt_geom: (h + L.GEOID_M) / 0.3048, gs, track, track_rate: 0, geom_rate: 0,
    seen_pos: 0, ...extra };
}

console.log("== 月の前を横切る瞬間を出す ==");
{
  for (const [lead, km, gs] of [[20, 8, 140], [20.5, 8, 140], [15.3, 4, 160], [40.7, 15, 250]]) {
    const r = L.predictAll(obs, { now: NOW, ac: [crossing(lead, km, gs)] }, { nowMs: NOW });
    const a = r.aircraft[0];
    const at = a.closest ? (a.closest.t - NOW) / 1000 : NaN;
    ok(a && a.transit && Math.abs(at - lead) < 0.1, `${km}km先・${gs}kt・${lead}秒後に月の中心を通る`,
      `${at.toFixed(2)}秒・中心から${a.closest?.sep.toFixed(3)}°`);
  }
  // 円盤にかかる時間は 月の直径 ÷ 横切る角速度。8km・140kt なら約1秒（月丼の正本の式と同じ）
  const a = L.predictAll(obs, { now: NOW, ac: [crossing(20.5, 8, 140)] }, { nowMs: NOW }).aircraft[0];
  const dur = (a.transit.to - a.transit.from) / 1000;
  ok(dur > 0.8 && dur < 1.3, "8km・140kt で円盤にかかるのは約1秒", `${dur.toFixed(2)}秒`);
  // 点（1秒刻み）の間で横切っても落とさない
  ok(a.transit.from > NOW + 19.5e3 && a.transit.to < NOW + 21.5e3, "1秒刻みの点の間で横切っても拾う");
}

console.log("== 月から離れて通る機体は通過にしない ==");
{
  const c = crossing(20, 8, 140);
  const r = L.predictAll(obs, { now: NOW, ac: [{ ...c, alt_geom: c.alt_geom + 400 / 0.3048 }] }, { nowMs: NOW });
  const a = r.aircraft[0];
  ok(!a.transit && a.closest.sep > 2, "400m 高く通る機体は月の上を通り過ぎる", `${a.closest.sep.toFixed(2)}°`);
}

console.log("== 使わない位置 ==");
{
  const c = crossing(20, 8, 140);
  const r = L.predictAll(obs, { now: NOW, ac: [
    { ...c, hex: "old", seen_pos: 45 }, { ...c, hex: "gnd", alt_baro: "ground" }, { hex: "nopos", flight: "X" },
    { ...c, hex: "nogs", gs: undefined },
  ] }, { nowMs: NOW });
  ok(r.aircraft.length === 0, "30秒より古い・地上・位置なし・速度なしは使わない", `${r.aircraft.length}機`);
}

console.log("== 外挿は60秒で切る ==");
{
  const r = L.predictAll(obs, { now: NOW, ac: [crossing(90, 8, 140)] }, { nowMs: NOW });
  const a = r.aircraft[0];
  ok(a.mode === "kinematic" && !a.transit, "90秒先の通過は外挿では出さない");
  ok(a.sky.at(-1).t <= NOW + L.KINEMATIC_S * 1000, "外挿の線は60秒まで");
}

console.log("== 進入路に沿わせる ==");
{
  const rw = RT.runwayOf("34R");
  const at = (km) => RT.destination(rw.threshold.latitude, rw.threshold.longitude, (rw.headingDegT + 180) % 360, km);
  const p = at(15);
  const a = { hex: "app", flight: "ANA1", lat: p.latitude, lon: p.longitude, gs: 180, tas: 185, track: 330,
    alt_geom: (L.glideAltM(rw, 15) + L.GEOID_M) / 0.3048, geom_rate: -900, seen_pos: 0 };
  const tr = L.trackAhead(a, NOW, NOW + 180e3);
  ok(tr.mode === "approach" && tr.runway === "34R", "34R の最終進入に乗る", `${tr.mode} ${tr.runway}`);
  // 減速: しきい値5km手前で対気速度145kt（対地は風のぶん 180−(185−145)=140kt）。そこまで線形に落ちる
  const along = (q) => L.alongRunway(rw, q.latitude, q.longitude).alongKm;
  const v = (i) => (along(tr.points[i]) - along(tr.points[i + 10])) / 10 * 1000 / 0.514444;
  ok(Math.abs(v(0) - 180) < 3, "はじめは今の対地速度", `${v(0).toFixed(0)}kt`);
  const i5 = tr.points.findIndex((q) => along(q) < 4.5);
  ok(i5 > 0 && Math.abs(v(i5) - 140) < 3, "5km手前からは最終進入の速さ", `${v(i5).toFixed(0)}kt`);
  ok(tr.points.every((q) => Math.abs(q.altitudeM - L.glideAltM(rw, along(q))) < 1), "高さは進入路のとおり");
  // 15km を 180→140kt で進むと約3分20秒。長く予測させると、しきい値で止まる
  const long = L.trackAhead(a, NOW, NOW + 400e3);
  ok(long.points.at(-1).t < NOW + 400e3 && along(long.points.at(-1)) < 0.2, "しきい値で終わる（接地）",
    `${((long.points.at(-1).t - NOW) / 1000).toFixed(0)}秒`);
  // 進入路より低く水平に飛んでいる機体は、乗るまでその高さ
  const p2 = at(25);
  const low = { ...a, lat: p2.latitude, lon: p2.longitude, alt_geom: (L.glideAltM(rw, 25) - 150 + L.GEOID_M) / 0.3048, geom_rate: 0 };
  const t2 = L.trackAhead(low, NOW, NOW + 180e3);
  ok(t2.mode === "approach" && Math.abs(t2.points[0].altitudeM - (L.glideAltM(rw, 25) - 150)) < 1,
    "下から乗る機体は乗るまで今の高さ");
  ok(t2.points.some((q) => Math.abs(q.altitudeM - L.glideAltM(rw, along(q))) < 1), "乗ったあとは進入路の高さ");
  // 上昇中・向きが違う機体は進入路に乗せない
  ok(L.trackAhead({ ...a, geom_rate: 1500 }, NOW, NOW + 60e3).mode === "kinematic", "上昇中は乗せない");
  ok(L.trackAhead({ ...a, track: 300 }, NOW, NOW + 60e3).mode === "kinematic", "向きが30°違えば乗せない");
}

console.log("== 地平線の下は数えない ==");
{
  const r = L.predictAll({ ...obs, horizonAt: () => 40 }, { now: NOW, ac: [crossing(20, 8, 140)] }, { nowMs: NOW });
  ok(!r.aircraft[0].transit && !r.aircraft[0].closest, "建物で隠れる高さなら通過にしない");
}

console.log("== 補う ==");
{
  const a = L.predictAll(obs, { now: NOW, ac: [crossing(20, 8, 140)] }, { nowMs: NOW }).aircraft[0];
  const s = L.skyAt(a.sky, NOW + 20000);
  ok(s && Math.hypot(s.dx, s.dy) < 0.05, "20秒後の位置は月の中心", s && `${Math.hypot(s.dx, s.dy).toFixed(3)}°`);
  ok(L.skyAt(a.sky, NOW - 5000) === null && L.skyAt(a.sky, NOW + 600e3) === null, "予測の範囲の外は出さない");
  ok(L.confidence({ mode: "approach" }, NOW + 60e3, NOW) === "高" && L.confidence({ mode: "kinematic" }, NOW + 45e3, NOW) === "低",
    "確度は進入路と外挿で分ける");
}

console.log(`\n${fail ? "NG" : "OK"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail ? 1 : 0);
