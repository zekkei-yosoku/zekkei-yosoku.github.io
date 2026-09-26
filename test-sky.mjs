// 空の展開図（`sorami-sky.js`）。**通信しない。**
//
// 答え合わせは国立天文台の値で行う（東京の日の出・日の入と、その方位）。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SK = require("./sorami-sky.js");

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };
const jst = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(11, 16);
const day = (s) => Date.parse(`${s}T00:00:00+09:00`);
const TOKYO = { latitude: 35.6581, longitude: 139.7414, elevation: 25 };

console.log("== 通り道 ==");
{
  const t = SK.track("sun", day("2026-06-21"), TOKYO, { stepMin: 5 });
  ok(t.length === 289, "1日を5分刻みで289点", `${t.length}点`);
  ok(t.every((p, i, a) => i === 0 || p.at > a[i - 1].at), "時刻の順に並ぶ");
  ok(t.every((p) => Number.isFinite(p.azimuth) && Number.isFinite(p.altitude)), "方位と高度を持つ");
  const m = SK.track("moon", day("2026-06-21"), TOKYO, { stepMin: 30 });
  ok(m.every((p) => p.illuminated !== null), "月は輝面を持つ");
  ok(t.every((p) => p.illuminated === null), "太陽は輝面を持たない");
}

console.log("== 方位の折り返しをほどく ==");
{
  const p = SK.unwrap([{ azimuth: 350 }, { azimuth: 355 }, { azimuth: 5 }, { azimuth: 15 }]);
  ok(p.map((v) => v.x).join(",") === "350,355,365,375", "北をまたいでも連続", p.map((v) => v.x).join(","));
  const q = SK.unwrap([{ azimuth: 10 }, { azimuth: 5 }, { azimuth: 355 }, { azimuth: 350 }]);
  ok(q.map((v) => v.x).join(",") === "10,5,-5,-10", "逆回りも連続", q.map((v) => v.x).join(","));
}

console.log("== 平らな地平線なら、日の出入りの時刻に合う ==");
{
  // 国立天文台（東京）: 2026-12-22 は 日の出 6:47 / 日の入 16:32
  const t = SK.track("sun", day("2026-12-22"), TOKYO, { stepMin: 5 });
  const spans = SK.visibleSpans(t, () => 0, "sun", TOKYO);
  ok(spans.length === 1, "1日1回", `${spans.length}回`);
  ok(jst(spans[0].from) >= "06:40" && jst(spans[0].from) <= "06:52", "日の出は6:47ごろ", jst(spans[0].from));
  ok(jst(spans[0].to) >= "16:26" && jst(spans[0].to) <= "16:38", "日の入は16:32ごろ", jst(spans[0].to));
}

console.log("== 稜線が高いと、見え始めが遅れる ==");
{
  const t = SK.track("sun", day("2026-12-22"), TOKYO, { stepMin: 5 });
  const flat = SK.visibleSpans(t, () => 0, "sun", TOKYO)[0];
  // 東側だけ10度の壁。日の出は遅れ、日の入は変わらない
  const wall = (az) => (az > 45 && az < 180 ? 10 : 0);
  const walled = SK.visibleSpans(t, wall, "sun", TOKYO)[0];
  ok(walled.from > flat.from + 30 * 60000, "見え始めが30分以上遅れる",
    `${jst(flat.from)} → ${jst(walled.from)}`);
  ok(Math.abs(walled.to - flat.to) < 60000, "沈む側は変わらない", jst(walled.to));
}

console.log("== 描く範囲 ==");
{
  const t = SK.track("sun", day("2026-06-21"), TOKYO, { stepMin: 5 });
  const spans = SK.visibleSpans(t, () => 0, "sun", TOKYO);
  const f = SK.frame(t, spans);
  ok(f.spanDeg <= 140 && f.spanDeg >= 60, "横幅は60〜140度に収める", `${Math.round(f.spanDeg)}度`);
  // 夏至の東京の南中高度は約77.8度
  ok(f.topDeg >= 80 && f.topDeg <= 90, "上端は最高高度より上", `${f.topDeg}度`);
  const p = SK.peak(t);
  ok(p.altitude > 77 && p.altitude < 79, "夏至の南中高度は約77.8度", p.altitude.toFixed(1));
  ok(jst(p.at) >= "11:30" && jst(p.at) <= "12:10", "南中は正午ごろ", jst(p.at));
}

console.log("== 稜線と方位の目盛り ==");
{
  const line = SK.skyline((az) => (az < 180 ? 5 : 1), 350, 370, 1);
  ok(line.length === 21, "端から端まで引く", `${line.length}点`);
  ok(line[0].angle === 1 && line[line.length - 1].angle === 5, "360をまたいで折り返す",
    `${line[0].angle} → ${line[line.length - 1].angle}`);
  const ticks = SK.compassTicks(350, 460);
  ok(ticks.map((t) => t.name).join(",") === "北,北東,東", "北をまたぐ目盛り",
    ticks.map((t) => `${t.x}:${t.name}`).join(" "));
}

console.log("== 3Dの向きと格子 ==");
{
  const near = (v, w, eps = 1e-9) => Math.abs(v - w) < eps;
  const n = SK.direction(0, 0, 1), e = SK.direction(90, 0, 1), up = SK.direction(0, 90, 1);
  ok(near(n.z, -1) && near(n.x, 0), "北は -Z", JSON.stringify(n));
  ok(near(e.x, 1) && near(e.z, 0), "東は +X", JSON.stringify(e));
  ok(near(up.y, 1), "真上は +Y");
  const s45 = SK.direction(180, 45, 10);
  ok(near(s45.z, 10 * Math.cos(Math.PI / 4)) && s45.y > 0, "南45度も長さを保つ",
    `${s45.x.toFixed(2)},${s45.y.toFixed(2)},${s45.z.toFixed(2)}`);

  // 方位が一周する格子は、端と最初がつながる（つなぎ目に隙間を作らない）
  const az = Array.from({ length: 8 }, (_, i) => i * 45);
  const dist = [1, 2, 3];
  const g = SK.meshGrid(az, dist, () => 0);
  ok(g.positions.length === 8 * 3 * 3, "点の数は 方位×距離", String(g.positions.length / 3));
  ok(g.indices.length === 8 * 2 * 6, "面の数も一周ぶん", String(g.indices.length / 3));
  ok(Math.max(...g.indices) === 8 * 3 - 1, "最後の方位が最初へ戻る");
  // 見上げ角が高いほど、同じ距離でも高く置かれる
  const flat = SK.meshGrid([0], [10], () => 0);
  const tilt = SK.meshGrid([0], [10], () => 30);
  ok(tilt.positions[1] > flat.positions[1], "角度が大きいほど y が上",
    `${flat.positions[1].toFixed(2)} → ${tilt.positions[1].toFixed(2)}`);
}

console.log(`\n${fail === 0 ? "SKY OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
