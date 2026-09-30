/*
 * 地点検索の地名索引（山・峠・展望地・岬・滝）を作る。**一度走らせて、結果を同梱する。**
 *
 *   node build-place-index.mjs    → data/place-index.json
 *
 * 2026-09-28 ユーザー指摘「住所検索で出ないところ多すぎ。Googleだと出るのに。群馬県桐生市富士見町赤城山鳥居峠とか」
 * 「建物の展望台だけじゃなくて山の展望スポットとかもっとスポット検索ができるようにして欲しい」。
 * 国土地理院の住所検索は「群馬県桐生市」までしか返さず、Nominatim は住所まじりの語で0件だった。
 * **山・峠・展望地の地名索引を持っていない**のが原因。OSM から全国ぶん取って自前で持つ。
 *
 * 拾うもの（名前のあるものだけ）:
 *   山 natural=peak・volcano ／ 峠 natural=saddle・mountain_pass=yes ／ 展望地 tourism=viewpoint
 *   岬 natural=cape ／ 滝 natural=waterfall
 * 読み（name:ja-Hira・name:ja_kana）があれば持つ（かなで引けるように）。
 * 市区町村は国土地理院の逆ジオコーダ（0.02°≒2km の升ごとに1回引いて使い回す）。
 *
 * 全国の下支えに Wikidata（山・峠・滝・岬・展望地・火山・丘。CC0）も足す。OSM は Overpass が混むと取れないため。
 * `PARTIAL=1` で、取れた区画（と、ねらうの候補地で取った区画）だけで作る。
 *
 * 出典: © OpenStreetMap contributors（ODbL）／Wikidata（CC0）／国土地理院（逆ジオコーダ）
 * Overpass は混むと落ちるので、区画ごとに取って `data/place-index-cache/` に置き、やり直せるようにする。
 */
import fs from "node:fs";
import path from "node:path";

const CACHE = "data/place-index-cache";
const OUT = "data/place-index.json";
fs.mkdirSync(CACHE, { recursive: true });
const UA = "zekkei-yosoku place-index builder (https://zekkei-yosoku.github.io)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// **名乗り（User-Agent）を付ける。** overpass-api.de は curl の既定や「Mozilla/5.0」だけの名乗りを 406 で弾く
// （2026-09-30。「投げすぎて回線ごと止められた」と一度書いたが誤りで、名乗りのある問い合わせは通った）。
// 混んでいるときは受付（overpass-api.de）より、裏の個別サーバー（z・lz4）のほうが通りやすい。1台に同時1本ずつ
const OVERPASS = ["https://z.overpass-api.de/api/interpreter", "https://lz4.overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];

// 宣言する実行時間は短めに（90秒）。**混んでいるとき、長い宣言の問い合わせほど後回しにされる**（2026-09-30）
// 点（node）だけ。展望地を面まで探すと重く、混んでいる日は打ち切られた（名前つきの展望地は大半が点）
// **使うメモリを小さく宣言する**（maxsize）。既定の 512MB は混んでいるとき確保できず、504 で待たされ続けた。
// 64MB と宣言したら同じ区画が 24秒で通った（2026-09-30）
const QUERY = (s, w, n, e) => `[out:json][timeout:90][maxsize:67108864];
(
  node["natural"~"^(peak|volcano|saddle|cape|waterfall)$"]["name"](${s},${w},${n},${e});
  node["mountain_pass"="yes"]["name"](${s},${w},${n},${e});
  node["tourism"="viewpoint"]["name"](${s},${w},${n},${e});
);
out qt;`;

async function overpass(q, first = 0, attempts = 8) {
  for (let attempt = 0; attempt < attempts; attempt++) {
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

// 日本の陸を覆う区画（2°）。海だけの区画は空で返るので、そのまま空として置く
const STEP = 2;
const chunks = [];
for (let s = 24; s < 46; s += STEP) for (let w = 122; w < 146; w += STEP) {
  // 明らかに海だけの区画を除く（大陸側・太平洋の沖）
  if (s >= 38 && w < 138) continue;          // 日本海の北西
  if (s < 30 && w > 132) continue;           // 小笠原は別に取る
  if (s >= 34 && s < 38 && w < 128) continue;  // 朝鮮半島側
  chunks.push([s, w]);
}
chunks.push([26, 140], [24, 140], [24, 152]);  // 小笠原・硫黄島・南鳥島のあたり
console.log(`区画 ${chunks.length} 個（${STEP}°）`);

const elements = new Map();
const todo = [...chunks];
let done = 0;
await Promise.all(OVERPASS.map(async (_, wi) => {
  while (todo.length) {
    const [s, w] = todo.shift();
    const file = path.join(CACHE, `${s}_${w}.json`);
    let j;
    if (fs.existsSync(file)) j = JSON.parse(fs.readFileSync(file, "utf8"));
    else if (process.env.PARTIAL) continue;
    else {
      // 最初から4つに割って取る（1°ずつ。軽い問い合わせのほうが混んでいても通る）
      const h = STEP / 2, parts = [];
      for (const [ds, dw] of [[0, 0], [0, h], [h, 0], [h, h]]) {
        parts.push(await overpass(QUERY(s + ds, w + dw, s + ds + h, w + dw + h), wi, 10));
        await sleep(1500);
      }
      j = { elements: parts.flatMap((x) => x.elements || []) };
      fs.writeFileSync(file, JSON.stringify(j));
      await sleep(1500);
    }
    for (const el of j.elements || []) elements.set(`${el.type}/${el.id}`, el);
    if (++done % 10 === 0) console.log(`  ${done}/${chunks.length} 区画 ・ 地物 ${elements.size}`);
  }
}));
// ねらうの候補地で取った関東・富士山まわりの区画にも、山・峠・展望地が入っている（使い回す）
for (const f of fs.existsSync("data/aim-places-cache") ? fs.readdirSync("data/aim-places-cache") : []) {
  if (!/^\d/.test(f)) continue;
  const j = JSON.parse(fs.readFileSync(path.join("data/aim-places-cache", f), "utf8"));
  for (const el of j.elements || []) elements.set(`${el.type}/${el.id}`, el);
}
console.log(`地物 ${elements.size}`);

// ---------------------------------------------------------------- Wikidata（全国。Overpass が混んでいても止まらない）
// Overpass が一日じゅう 504 を返した日があった（2026-09-30）。Wikidata の山・峠・滝・岬・展望地・火山・丘で全国を下支えする
// 種類ごとに分けて問い合わせる（まとめると Wikidata 側で打ち切られ、途中までの応答になった）
const WD_CLASSES = ["Q8502", "Q8072", "Q54050", "Q133056", "Q34038", "Q185113", "Q6017969"];
const wdBindings = [];
for (const cls of WD_CLASSES) {
  const file = path.join(CACHE, `wikidata-${cls}.json`);
  if (!fs.existsSync(file)) {
    const q = `SELECT ?item ?label ?coord ?ele ?kana WHERE {
      ?item wdt:P31 wd:${cls} ; wdt:P17 wd:Q17 ; wdt:P625 ?coord .
      ?item rdfs:label ?label FILTER(lang(?label) = "ja")
      OPTIONAL { ?item wdt:P2044 ?ele }
      OPTIONAL { ?item wdt:P1814 ?kana }
    }`;
    let text = null;
    for (let i = 0; i < 4 && !text; i++) {
      const res = await fetch("https://query.wikidata.org/sparql?query=" + encodeURIComponent(q),
        { headers: { accept: "application/sparql-results+json", "user-agent": UA } });
      const t = await res.text();
      try { JSON.parse(t); if (res.ok) text = t; } catch { /* 打ち切られた応答 */ }
      if (!text) { console.log(`    Wikidata ${cls} ${res.status} → 待って再試行`); await sleep(10000 * (i + 1)); }
    }
    if (!text) throw new Error(`Wikidata ${cls} が取れない`);
    fs.writeFileSync(file, text);
    await sleep(2000);
  }
  for (const b of JSON.parse(fs.readFileSync(file, "utf8")).results.bindings) wdBindings.push({ ...b, cls: { value: cls } });
}
const WD_KIND = { Q8502: "山", Q8072: "山", Q54050: "山", Q133056: "峠", Q34038: "滝", Q185113: "岬", Q6017969: "展望地" };
const wdRows = [];
for (const b of wdBindings) {
  const m = b.coord.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
  if (!m) continue;
  const kind = WD_KIND[b.cls.value.split("/").pop()];
  const ele = b.ele ? Number.parseFloat(b.ele.value) : NaN;
  wdRows.push({ kind, name: b.label.value.replace(/\s*\(.*?\)$|（.*?）$/, "").trim(), kana: b.kana ? b.kana.value : "",
    lat: Number(m[2]), lon: Number(m[1]), ele: Number.isFinite(ele) && ele > 0 && ele < 4000 ? Math.round(ele) : null });
}
console.log(`Wikidata ${wdRows.length}`);

// ---------------------------------------------------------------- 形をそろえる
const toHira = (s) => String(s || "").replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const KIND = (t) => (t.natural === "peak" || t.natural === "volcano" ? "山"
  : t.natural === "saddle" || t.mountain_pass === "yes" ? "峠"
  : t.tourism === "viewpoint" ? "展望地" : t.natural === "cape" ? "岬" : t.natural === "waterfall" ? "滝" : null);
let rows = [];
for (const el of elements.values()) {
  const t = el.tags || {};
  const kind = KIND(t);
  // 点、または面の中心（`out center`）か外周（`out geom`）の平均
  const g = el.geometry && el.geometry.length ? el.geometry : null;
  const lat = el.lat ?? el.center?.lat ?? (g ? g.reduce((a, p) => a + p.lat, 0) / g.length : undefined);
  const lon = el.lon ?? el.center?.lon ?? (g ? g.reduce((a, p) => a + p.lon, 0) / g.length : undefined);
  if (!kind || !t.name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  // 日本語の名前を採る（name が英字だけで name:ja があればそちら）
  const name = (/[぀-鿿]/.test(t.name) ? t.name : t["name:ja"] || t.name).trim();
  if (!/[぀-鿿]/.test(name)) continue;
  const kana = toHira(t["name:ja-Hira"] || t["name:ja_kana"] || t["name:ja-Kana"] || "").replace(/\s/g, "");
  const ele = Number.parseFloat(String(t.ele || "").replace(/[^\d.]/g, ""));
  rows.push({ kind, name, kana, lat, lon, ele: Number.isFinite(ele) && ele > 0 && ele < 4000 ? Math.round(ele) : null });
}
// Wikidata を後ろに足す（OSM と重なるものは下で1つにまとまる。OSM を先にして、OSM の位置を残す）
for (const r of wdRows) {
  if (!r.kind || !r.name || !/[\u3040-\u9fff]/.test(r.name)) continue;
  rows.push({ ...r, kana: toHira(r.kana).replace(/\s/g, ""), fromWd: true });
}
// 同じ種類・同じ名前で 300m 以内は1つに（Wikidata の座標は粗いことがあるので 1.5km まで同じとみなす）
const seen = new Map();
const dist = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 111 * Math.cos(a.lat * Math.PI / 180));
rows = rows.filter((r) => {
  const k = `${r.kind}:${r.name}`;
  const list = seen.get(k) || [];
  if (list.some((q) => dist(q, r) < (q.fromWd || r.fromWd ? 1.5 : 0.3))) return false;
  list.push(r); seen.set(k, list);
  return true;
});
console.log(`索引 ${rows.length}: ${["山", "峠", "展望地", "岬", "滝"].map((k) => `${k} ${rows.filter((r) => r.kind === k).length}`).join(" ・ ")}`);

// ---------------------------------------------------------------- 市区町村（国土地理院の逆ジオコーダ）
const muniText = await (await fetch("https://maps.gsi.go.jp/js/muni.js", { headers: { "user-agent": UA } })).text();
const MUNI = {};
for (const m of muniText.matchAll(/MUNI_ARRAY\["(\d+)"\]\s*=\s*'([^']*)'/g)) {
  const [, pref, , city] = m[2].split(",");
  MUNI[m[1]] = `${pref}${city.replace(/\s|　/g, "")}`;
}
const cellFile = path.join(CACHE, "muni-cells.json");
const cells = fs.existsSync(cellFile) ? JSON.parse(fs.readFileSync(cellFile, "utf8")) : {};
const cellOf = (r) => `${Math.round(r.lat / 0.02)},${Math.round(r.lon / 0.02)}`;
const need = [...new Set(rows.map(cellOf))].filter((k) => cells[k] === undefined);
console.log(`市区町村: 升 ${need.length} 個を引く（済み ${Object.keys(cells).length}）`);
let n = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (need.length) {
    const k = need.shift();
    const [a, b] = k.split(",").map(Number);
    const lat = (a * 0.02).toFixed(4), lon = (b * 0.02).toFixed(4);
    for (let i = 0; i < 4; i++) {
      try {
        const res = await fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`,
          { headers: { "user-agent": UA } });
        const j = await res.json();
        cells[k] = j && j.results ? String(Number(j.results.muniCd)) : "";
        break;
      } catch { await sleep(2000 * (i + 1)); }
    }
    if (++n % 1000 === 0) { console.log(`  升 ${n}`); fs.writeFileSync(cellFile, JSON.stringify(cells)); }
  }
}));
fs.writeFileSync(cellFile, JSON.stringify(cells));

// ---------------------------------------------------------------- 書き出し
// 升の中心が海で市区町村が取れないときは、その点で引き直す
for (const r of rows) {
  let code = cells[cellOf(r)];
  if (!code) {
    try {
      const res = await fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${r.lat}&lon=${r.lon}`,
        { headers: { "user-agent": UA } });
      const j = await res.json();
      code = j && j.results ? String(Number(j.results.muniCd)) : "";
    } catch { code = ""; }
  }
  r.muni = MUNI[code] || "";
}
const munis = [...new Set(rows.map((r) => r.muni))];
const KIND_CODE = { 山: "p", 峠: "s", 展望地: "v", 岬: "c", 滝: "w" };
const out = {
  builtOn: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
  source: "© OpenStreetMap contributors (ODbL) / Wikidata (CC0) / 国土地理院",
  kinds: Object.fromEntries(Object.entries(KIND_CODE).map(([k, v]) => [v, k])),
  munis,
  // [種類, 名前, 読み, 緯度×1e5, 経度×1e5, 標高, 市区町村の番号]
  places: rows.map((r) => [KIND_CODE[r.kind], r.name, r.kana, Math.round(r.lat * 1e5), Math.round(r.lon * 1e5),
    r.ele, munis.indexOf(r.muni)]),
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`→ ${OUT} ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB ・ ${out.places.length} か所`);
