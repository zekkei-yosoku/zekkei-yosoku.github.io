/*
 * 「ねらう」の候補地（立てる場所）を作る。**一度走らせて、結果を同梱する。**
 *
 *   node build-aim-places.mjs    → data/aim-places.json
 *
 * 線だけでは「その日、どこへ行けばよいか」が分からない（2026-09-30 ユーザー指摘
 * 「月丼みたいにその日の観測に適した場所を出して」）。月丼と同じく、**立てる場所の中から**選ぶ。
 * 線は毎日向きが変わるので、少数の定番だけでは線に掛からない日が多い。地物を面で持つ。
 *
 * 拾うもの（名前のあるものだけ。展望地は名前が無くても拾う）:
 *   展望地 tourism=viewpoint ／ 山頂 natural=peak ／ 峠 mountain_pass・natural=saddle
 *   橋 bridge:name（歩ける道）・man_made=bridge ／ 公園 leisure=park（0.5ha 以上）
 *   海岸 natural=beach ／ 桟橋 man_made=pier ／ 展望台（高さの公表値があるものだけ・下の DECKS）
 *   川岸 waterway=river（東京の目標のまわりだけ・5km 以上の川を 2km ごとに）
 *
 * 範囲: 組み込みの目標ごとに、線が引ける距離（`lineRange`）の中で、
 *   太陽・月が出入りする方角（目標から見て 35〜145° と 215〜325°）だけ。
 *
 * 出典: © OpenStreetMap contributors（ODbL）／国土地理院（標高タイル・逆ジオコーダ）
 * Overpass は混むと落ちるので、区画ごとに取って `data/aim-places-cache/` に置き、やり直せるようにする。
 * 取れない区画が残るときは `PARTIAL=1 node build-aim-places.mjs` で、取れた区画だけで作る
 * （2026-09-30 の版は 168 区画中 129。富士山の西 90〜150km の長野・岐阜・愛知寄りが抜けている）。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import * as DEM from "./dem-tile.mjs";
const require = createRequire(import.meta.url);
const TR = require("./sorami-terrain.js");
const AL = require("./sorami-align.js");

const CACHE = "data/aim-places-cache";
const OUT = "data/aim-places.json";
fs.mkdirSync(CACHE, { recursive: true });
const UA = "zekkei-yosoku aim-places builder (https://zekkei-yosoku.github.io)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 範囲
const SECTORS = [[35, 145], [215, 325]];
const REGIONS = AL.TARGETS.map((t) => {
  const top = Math.max(...t.parts.map((p) => p.m));
  const r = AL.lineRange(top);
  return { t, minKm: r.minKm * 0.8, maxKm: r.maxKm };
});
function inRegion(lat, lon, padKm = 0) {
  for (const { t, minKm, maxKm } of REGIONS) {
    const d = TR.distanceKm(t.latitude, t.longitude, lat, lon);
    if (d < minKm - padKm || d > maxKm + padKm) continue;
    const b = TR.bearing(t.latitude, t.longitude, lat, lon);
    // 近いところは方位の幅を広く取る（pad が効く）
    const slack = d > 0 ? Math.min(90, padKm / d * 180 / Math.PI) : 90;
    if (SECTORS.some(([a, z]) => b >= a - slack && b <= z + slack)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- Overpass
// 作るときだけ使う。公開の Overpass を4つ（1つずつ同時に1本）。画面からは使わない
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const QUERY = (s, w, n, e) => `[out:json][timeout:180];
(
  nwr["tourism"="viewpoint"](${s},${w},${n},${e});
  node["natural"~"^(peak|saddle)$"]["name"](${s},${w},${n},${e});
  node["mountain_pass"="yes"]["name"](${s},${w},${n},${e});
  way["leisure"="park"]["name"](${s},${w},${n},${e});
  relation["leisure"="park"]["name"](${s},${w},${n},${e});
  way["natural"="beach"]["name"](${s},${w},${n},${e});
  relation["natural"="beach"]["name"](${s},${w},${n},${e});
  way["man_made"="pier"]["name"](${s},${w},${n},${e});
  way["bridge"]["bridge:name"]["highway"](${s},${w},${n},${e});
  way["man_made"="bridge"]["name"](${s},${w},${n},${e});
);
out geom qt;`;

async function overpass(q, first = 0) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const url = OVERPASS[(first + attempt) % OVERPASS.length];
    try {
      const res = await fetch(url, { method: "POST", headers: { "user-agent": UA,
        "content-type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(q) });
      const text = await res.text();
      if (res.ok && text.trim().startsWith("{")) {
        const j = JSON.parse(text);
        if (!j.remark || !/runtime error|timed out/i.test(j.remark)) return j;
      }
      console.log(`    ${url.split("/")[2]} ${res.status} → 待って再試行`);
    } catch (err) { console.log(`    ${err.message} → 待って再試行`); }
    await sleep(15000 * (attempt + 1));
  }
  throw new Error("Overpass が返らない");
}

const STEP = 0.2;
const chunks = [];
for (let s = 34.2; s < 36.8; s += STEP) {
  for (let w = 137.2; w < 140.6; w += STEP) {
    let hit = false;
    for (let i = 0; i <= 4 && !hit; i++) for (let j = 0; j <= 4 && !hit; j++) {
      hit = inRegion(s + STEP * i / 4, w + STEP * j / 4, 12);
    }
    if (hit) chunks.push([Number(s.toFixed(2)), Number(w.toFixed(2))]);
  }
}
// 東京と富士山のあいだから先に取る（途中で止まっても使える所から埋まる）
chunks.sort((a, b) => Math.hypot(a[0] - 35.5, a[1] - 139.3) - Math.hypot(b[0] - 35.5, b[1] - 139.3));
console.log(`区画 ${chunks.length} 個（${STEP}°）`);
if (process.env.DRY) process.exit(0);

const elements = new Map();
let done = 0;
// Overpass ごとに1本ずつ（同じ相手に同時に2本投げない）
const todo = [...chunks];
await Promise.all(OVERPASS.map(async (_, wi) => {
  while (todo.length) {
    const [s, w] = todo.shift();
    const file = path.join(CACHE, `${s}_${w}.json`);
    let j;
    if (fs.existsSync(file)) j = JSON.parse(fs.readFileSync(file, "utf8"));
    else if (process.env.PARTIAL) continue;      // 取れている区画だけで作る（画面の確認用）
    else {
      j = await overpass(QUERY(s, w, Number((s + STEP).toFixed(2)), Number((w + STEP).toFixed(2))), wi);
      fs.writeFileSync(file, JSON.stringify(j));
      await sleep(1500);
    }
    for (const el of j.elements || []) elements.set(`${el.type}/${el.id}`, el);
    done++;
    if (done % 10 === 0) console.log(`  ${done}/${chunks.length} 区画 ・ 地物 ${elements.size}`);
  }
}));
console.log(`地物 ${elements.size}`);

// ---------------------------------------------------------------- 形
const frame = (lat0, lon0) => {
  const kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110574;
  return { xy: ([la, lo]) => [(lo - lon0) * kx, (la - lat0) * ky], ll: ([x, y]) => [lat0 + y / ky, lon0 + x / kx] };
};
function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function areaM2(ringXY) {
  let a = 0;
  for (let i = 0, j = ringXY.length - 1; i < ringXY.length; j = i++) a += ringXY[j][0] * ringXY[i][1] - ringXY[i][0] * ringXY[j][1];
  return Math.abs(a) / 2;
}
/// ダグラス・ポーカー。外周を 15m の精度でならし、頂点を減らす
function simplify(pts, tol) {
  if (pts.length <= 3) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i], [x1, y1] = pts[a], [x2, y2] = pts[b];
      const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
      const d = Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = true; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const geomOf = (el) => (el.geometry || []).filter(Boolean).map((g) => [g.lat, g.lon]);
const memberGeom = (el) => (el.members || []).filter((m) => m.role !== "inner" && m.geometry)
  .flatMap((m) => m.geometry.filter(Boolean).map((g) => [g.lat, g.lon]));
const centroid = (pts) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
const enc = (pts) => pts.flatMap(([la, lo]) => [Math.round(la * 1e5), Math.round(lo * 1e5)]);

const NOT_WALKABLE = /^(motorway|motorway_link|trunk_link|raceway|construction|proposed)$/;
const places = [];
const bridgeWays = [];
for (const el of elements.values()) {
  const t = el.tags || {};
  if (t.tourism === "viewpoint") {
    const pts = el.type === "node" ? [[el.lat, el.lon]] : (el.type === "way" ? geomOf(el) : memberGeom(el));
    if (!pts.length) continue;
    const [la, lo] = el.type === "node" ? pts[0] : centroid(pts);
    places.push({ kind: "展望地", name: t.name || "", shape: "point", lat: la, lon: lo, ele: Number.parseFloat(t.ele) });
  } else if (el.type === "node" && (t.natural === "peak" || t.natural === "saddle" || t.mountain_pass === "yes")) {
    places.push({ kind: t.natural === "peak" ? "山頂" : "峠", name: t.name, shape: "point",
      lat: el.lat, lon: el.lon, ele: Number.parseFloat(t.ele) });
  } else if (t.leisure === "park" || t.natural === "beach" || t.man_made === "pier") {
    const kind = t.leisure === "park" ? "公園" : t.natural === "beach" ? "海岸" : "桟橋";
    const raw = el.type === "relation" ? hull(memberGeom(el)) : geomOf(el);
    if (raw.length < 2) continue;
    const c = centroid(raw);
    const F = frame(c[0], c[1]);
    const closed = el.type === "relation" || (raw.length > 3 && Math.hypot(...F.xy(raw[0]).map((v, i) => v - F.xy(raw[raw.length - 1])[i])) < 1);
    if (closed) {
      // **閉じた輪は始点と終点が同じ点なので、そのまま間引くと全部が「線分上」になってつぶれる。**
      // 始点から一番遠い点で2つに割って、それぞれ間引く
      const xy = raw.map(F.xy);
      let far = 1;
      for (let i = 1; i < xy.length; i++) if (Math.hypot(xy[i][0] - xy[0][0], xy[i][1] - xy[0][1]) > Math.hypot(xy[far][0] - xy[0][0], xy[far][1] - xy[0][1])) far = i;
      const ringXY = [...simplify(xy.slice(0, far + 1), 15).slice(0, -1), ...simplify(xy.slice(far), 15).slice(0, -1)];
      const a = areaM2(xy);
      if (kind === "公園" && a < 5000) continue;
      const ring = ringXY.map(F.ll);
      places.push({ kind, name: t.name, shape: "area", lat: c[0], lon: c[1], g: ring, areaM2: Math.round(a) });
    } else {
      const lineXY = simplify(raw.map(F.xy), 10);
      places.push({ kind, name: t.name, shape: "line", lat: c[0], lon: c[1], g: lineXY.map(F.ll) });
    }
  } else if (t.bridge && t["bridge:name"] && t.highway) {
    if (NOT_WALKABLE.test(t.highway) || t.foot === "no" || t.access === "no" || t.access === "private") continue;
    bridgeWays.push({ name: t["bridge:name"], pts: geomOf(el) });
  } else if (t.man_made === "bridge" && t.name) {
    bridgeWays.push({ name: t.name, pts: geomOf(el) });
  }
}

// 橋は上下線や区間ごとに道が分かれているので、同じ名前で近いものを1本にまとめる
const byName = new Map();
for (const w of bridgeWays) {
  if (!w.pts.length) continue;
  const c = centroid(w.pts);
  const list = byName.get(w.name) || [];
  let g = list.find((x) => TR.distanceKm(x.c[0], x.c[1], c[0], c[1]) < 0.4);
  if (!g) { g = { name: w.name, c, pts: [] }; list.push(g); byName.set(w.name, list); }
  g.pts.push(...w.pts);
}
let bridges = 0;
for (const list of byName.values()) {
  for (const g of list) {
    // 端から端（いちばん離れた2点）を橋の軸にする
    let best = null;
    for (let i = 0; i < g.pts.length; i++) for (let j = i + 1; j < g.pts.length; j++) {
      const d = TR.distanceKm(g.pts[i][0], g.pts[i][1], g.pts[j][0], g.pts[j][1]);
      if (!best || d > best.d) best = { d, a: g.pts[i], b: g.pts[j] };
    }
    if (!best || best.d < 0.04) continue;
    const c = centroid([best.a, best.b]);
    places.push({ kind: "橋", name: g.name, shape: "line", lat: c[0], lon: c[1], g: [best.a, best.b], lengthM: Math.round(best.d * 1000) });
    bridges++;
  }
}
console.log(`橋 ${bridges} 本（道 ${bridgeWays.length} 本から）`);

// ---------------------------------------------------------------- 川岸（東京の目標のまわりだけ）
// スカイツリーの日の入り側のように線が東西に伸びる日は、南北に流れる川の橋とは交わらず、
// 定番の荒川・中川・江戸川の土手が拾えなかった（2026-09-30）。**川そのものを線として持つ。**
// 立つのは土手（川の中心線から少し横）だが、時刻の差は数秒なので中心線と線の交点で解く。
// 小さな流れを除くため、同じ名前で合わせて 5km 以上の川だけ。2km ごとに区切る（1本の川が線と何度も交わるため）
const riverFile = path.join(CACHE, "rivers.json");
if (!fs.existsSync(riverFile)) {
  const j = await overpass(`[out:json][timeout:170];way["waterway"="river"]["name"](35.40,139.35,36.05,140.25);out geom qt;`);
  fs.writeFileSync(riverFile, JSON.stringify(j));
}
{
  const ways = JSON.parse(fs.readFileSync(riverFile, "utf8")).elements
    .filter((el) => el.tags && el.tags.name && !el.tags.tunnel && el.geometry && el.geometry.length >= 2);
  const lenOf = (pts) => pts.slice(1).reduce((a, p, i) => a + TR.distanceKm(pts[i][0], pts[i][1], p[0], p[1]), 0);
  const total = new Map();
  for (const w of ways) total.set(w.tags.name, (total.get(w.tags.name) || 0) + lenOf(geomOf(w)));
  let pieces = 0;
  for (const w of ways) {
    if ((total.get(w.tags.name) || 0) < 5) continue;
    const pts = geomOf(w);
    const c0 = centroid(pts);
    const F = frame(c0[0], c0[1]);
    const simple = simplify(pts.map(F.xy), 30).map(F.ll);
    // 2km ごとに切る
    let cur = [simple[0]], acc = 0;
    const flush = () => {
      if (cur.length < 2) return;
      const c = cur[Math.floor(cur.length / 2)];
      places.push({ kind: "川岸", name: w.tags.name, shape: "line", lat: c[0], lon: c[1], g: cur });
      pieces++;
    };
    for (let i = 1; i < simple.length; i++) {
      acc += TR.distanceKm(simple[i - 1][0], simple[i - 1][1], simple[i][0], simple[i][1]);
      cur.push(simple[i]);
      if (acc >= 2) { flush(); cur = [simple[i]]; acc = 0; }
    }
    flush();
  }
  console.log(`川岸 ${pieces} 区間`);
}

// ---------------------------------------------------------------- 展望台（高さの公表値があるものだけ）
// 床の高さは sorami-terrain の OBSERVATION_DECKS と同じ値。座標は OSM の建物。
const DECKS = [
  { name: "東京スカイツリー 天望デッキ", q: "東京スカイツリー", deckM: 350 },
  { name: "東京スカイツリー 天望回廊", q: "東京スカイツリー", deckM: 450 },
  { name: "東京タワー メインデッキ", q: "東京タワー", deckM: 150 },
  { name: "東京タワー トップデッキ", q: "東京タワー", deckM: 250 },
  { name: "六本木ヒルズ 東京シティビュー", q: "六本木ヒルズ森タワー", deckM: 250 },
  { name: "渋谷スカイ", q: "渋谷スクランブルスクエア", deckM: 229 },
  { name: "サンシャイン60 展望台", q: "Sunshine 60", deckM: 251 },
  { name: "千葉ポートタワー 展望台", q: "千葉ポートタワー", deckM: 113 },
  { name: "江の島シーキャンドル", q: "江の島シーキャンドル", deckM: 42 },
];
const deckCache = path.join(CACHE, "decks.json");
const deckPos = fs.existsSync(deckCache) ? JSON.parse(fs.readFileSync(deckCache, "utf8")) : {};
for (const d of DECKS) {
  if (!deckPos[d.q]) {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=jp&q=${encodeURIComponent(d.q)}`,
      { headers: { "user-agent": UA, "accept-language": "ja" } });
    const j = await res.json();
    if (j[0]) deckPos[d.q] = [Number(j[0].lat), Number(j[0].lon)];
    await sleep(1100);
  }
  const p = deckPos[d.q];
  if (!p) { console.log(`  展望台の座標が引けない: ${d.q}`); continue; }
  places.push({ kind: "展望台", name: d.name, shape: "point", lat: p[0], lon: p[1], deckM: d.deckM });
}
fs.writeFileSync(deckCache, JSON.stringify(deckPos));

// ---------------------------------------------------------------- 絞る・重複を除く
const reachKm = (p) => (p.g ? Math.max(...p.g.map(([la, lo]) => TR.distanceKm(p.lat, p.lon, la, lo))) : 0);
let kept = places.filter((p) => inRegion(p.lat, p.lon, reachKm(p) + 0.5));
const seen = new Map();
kept = kept.filter((p) => {
  if (p.kind === "川岸") return true;          // 同じ川の別の区間は別物
  const key = `${p.kind}:${p.name}`;
  const near = (seen.get(key) || []).some((q) => TR.distanceKm(q.lat, q.lon, p.lat, p.lon) < (p.name ? 0.3 : 0.05));
  if (near) return false;
  seen.set(key, [...(seen.get(key) || []), p]);
  return true;
});
const count = (k) => kept.filter((p) => p.kind === k).length;
console.log(`範囲の中 ${kept.length}: ${["展望地", "山頂", "峠", "橋", "公園", "海岸", "桟橋", "展望台", "川岸"].map((k) => `${k} ${count(k)}`).join(" ・ ")}`);

// ---------------------------------------------------------------- 標高（点だけ。面と線は画面で立つ位置の標高を読む）
let n = 0;
for (const p of kept) {
  if (p.shape !== "point") continue;
  if (!Number.isFinite(p.ele) || p.kind !== "山頂") {
    try { const e = await DEM.elevationAt(p.lat, p.lon, 13); if (Number.isFinite(e)) p.ele = e; } catch { /* 取れなければ下で 0 */ }
  }
  if (!Number.isFinite(p.ele)) p.ele = 0;
  if (++n % 500 === 0) console.log(`  標高 ${n}`);
}

// ---------------------------------------------------------------- 住所（国土地理院の逆ジオコーダ）
const muniText = await (await fetch("https://maps.gsi.go.jp/js/muni.js", { headers: { "user-agent": UA } })).text();
const MUNI = {};
for (const m of muniText.matchAll(/MUNI_ARRAY\["(\d+)"\]\s*=\s*'([^']*)'/g)) {
  const [, pref, , city] = m[2].split(",");
  MUNI[m[1]] = `${pref}${city.replace(/\s|　/g, "")}`;
}
const addrCacheFile = path.join(CACHE, "address.json");
const addrCache = fs.existsSync(addrCacheFile) ? JSON.parse(fs.readFileSync(addrCacheFile, "utf8")) : {};
async function address(lat, lon) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (addrCache[key] !== undefined) return addrCache[key];
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`,
        { headers: { "user-agent": UA } });
      const j = await res.json();
      const r = j && j.results;
      const muni = r ? MUNI[String(Number(r.muniCd))] || "" : "";
      addrCache[key] = r ? `${muni}${(r.lv01Nm || "").replace(/^－$/, "")}` : "";
      return addrCache[key];
    } catch { await sleep(2000 * (i + 1)); }
  }
  return "";
}
n = 0;
const queue = [...kept];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const p = queue.shift();
    p.address = await address(p.lat, p.lon);
    if (++n % 500 === 0) { console.log(`  住所 ${n}`); fs.writeFileSync(addrCacheFile, JSON.stringify(addrCache)); }
  }
}));
fs.writeFileSync(addrCacheFile, JSON.stringify(addrCache));

// ---------------------------------------------------------------- 書き出し
const KIND_CODE = { 展望地: "v", 山頂: "p", 峠: "s", 橋: "b", 公園: "k", 海岸: "c", 桟橋: "r", 展望台: "d", 川岸: "w" };
const out = {
  builtOn: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
  source: "© OpenStreetMap contributors (ODbL) / 国土地理院",
  // g はラベル点 p からの差
  gRelative: true,
  kinds: Object.fromEntries(Object.entries(KIND_CODE).map(([k, v]) => [v, k])),
  places: kept.map((p) => {
    const r = { k: KIND_CODE[p.kind], n: p.name, a: p.address || "", p: enc([[p.lat, p.lon]]) };
    if (p.shape === "point") r.e = Math.round(p.ele);
    // 形はラベル点からの差（×1e5）で持つ。桁が減って、全体が4割ほど小さくなる
    if (p.g) { r.s = p.shape === "area" ? "a" : "l"; r.g = enc(p.g).map((v, i) => v - r.p[i % 2]); }
    if (p.deckM) r.d = p.deckM;
    return r;
  }),
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`→ ${OUT} ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB ・ ${out.places.length} か所`);
