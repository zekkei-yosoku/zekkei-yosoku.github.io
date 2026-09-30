// 標高タイル（国土地理院 dem_png）の読み方。**通信しない。** Image と canvas を差し替えて形だけを検査する。
//
// 2026-09-22: 富士市で月の地形地平線が平らに落ちていた。駿河湾の「標高なし」画素 816点を
// Open-Meteo で埋め直し、100点ずつ 9回叩いて本番で 429 が続き、測定ごと失敗していた。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const T = require("./sorami-terrain.js");

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };

// タイル座標 → 画素の決め方（x+y が偶数なら陸 12.34m、奇数なら「標高なし」(128,0,0)）。
// MISSING に入れたタイルは 404（海だけの区画）として onerror を返す。
const MISSING = new Set();
const requested = [];
globalThis.Image = class {
  set src(url) {
    requested.push(url);
    const m = url.match(/\/(\d+)\/(\d+)\/(\d+)\.png$/);
    this._key = `${m[2]}/${m[3]}`;
    this.width = 256; this.height = 256;
    queueMicrotask(() => (MISSING.has(this._key) ? this.onerror() : this.onload()));
  }
};
globalThis.document = {
  createElement: () => {
    let key = null;
    return {
      getContext: () => ({
        drawImage: (img) => { key = img._key; },
        getImageData: (_x, _y, w, h) => {
          const [x, y] = key.split("/").map(Number);
          const sea = (x + y) % 2 === 1;
          const data = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < w * h; i++) {
            if (sea) { data[i * 4] = 128; } else { data[i * 4 + 2] = 1234 & 255; data[i * 4 + 1] = 1234 >> 8; }
          }
          return { width: w, height: h, data };
        },
      }),
    };
  },
};

// z11 のタイル番号から、その中央の緯度経度
const center = (x, y, z = 11) => {
  const n = Math.PI - 2 * Math.PI * (y + 0.5) / 2 ** z;
  return { latitude: 180 / Math.PI * Math.atan(Math.sinh(n)), longitude: (x + 0.5) / 2 ** z * 360 - 180 };
};
const LAND = center(1812, 810);      // 偶数 → 陸
const SEA = center(1812, 811);       // 奇数 → 「標高なし」
const GONE = center(1813, 812);      // 404

const counting = () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const n = new URL(url).searchParams.get("latitude").split(",").length;
    calls.push(n);
    return new Response(JSON.stringify({ elevation: Array(n).fill(7) }), { status: 200 });
  };
  return { calls, fetchImpl };
};

console.log("== 海の画素は 0m、Open-Meteo へ回さない ==");
{
  const { calls, fetchImpl } = counting();
  const pts = [...Array(300)].map((_, i) => (i % 2 ? SEA : LAND));
  const e = await T.elevations(pts, { fetchImpl });
  ok(calls.length === 0, "海の点が 300点中 150点あっても Open-Meteo を叩かない", `calls=${calls.length}`);
  ok(e[0] === 12.34, "陸は画素の値", `${e[0]}`);
  ok(e[1] === 0, "海は 0m", `${e[1]}`);
  ok(e.length === 300 && e.every((v) => v !== null), "全点が埋まる");
}

console.log("== タイルが取れない点だけ Open-Meteo で埋める ==");
{
  MISSING.add("1813/812");
  const { calls, fetchImpl } = counting();
  const e = await T.elevations([LAND, SEA, GONE, GONE], { fetchImpl });
  ok(calls.length === 1 && calls[0] === 2, "404 タイルの 2点だけを 1回で問い合わせる", JSON.stringify(calls));
  ok(e[0] === 12.34 && e[1] === 0 && e[2] === 7 && e[3] === 7, "順序どおりに戻る", JSON.stringify(e));
}

console.log("== 1点読み（観測点の地面）は従来どおり ==");
{
  ok(await T.elevationFromTile(LAND.latitude, LAND.longitude) === 12.34, "陸は値");
  ok(await T.elevationFromTile(SEA.latitude, SEA.longitude) === null, "「標高なし」は null のまま（呼び手が判断する）");
  ok(await T.elevationFromTile(GONE.latitude, GONE.longitude) === null, "404 も null");
  ok(await T.elevationFromTile(10, 10) === null, "国外は null");
}

console.log("== 緯度経度の文字列を読む ==");
// 地図アプリからの貼り付けをそのまま受ける（2026-09-24 ユーザー依頼）
{
  const near = (r, lat, lon) => r && Math.abs(r.latitude - lat) < 1e-4 && Math.abs(r.longitude - lon) < 1e-4;
  ok(near(T.parseLatLon("35.31176, 139.47653"), 35.31176, 139.47653), "十進・カンマ区切り");
  ok(near(T.parseLatLon("35.31176 139.47653"), 35.31176, 139.47653), "十進・空白区切り");
  ok(near(T.parseLatLon("３５．３１１７６，１３９．４７６５３"), 35.31176, 139.47653), "全角でも読む");
  ok(near(T.parseLatLon(`35°18'42.3"N 139°28'35.5"E`), 35.3117, 139.4765), "度分秒（Googleマップの表記）");
  ok(near(T.parseLatLon("N35.31176 E139.47653"), 35.31176, 139.47653), "N/E 付き");
  ok(near(T.parseLatLon("-35.3, -139.4"), -35.3, -139.4), "南半球・西経");
  ok(T.parseLatLon("高尾山") === null, "地名は座標として読まない");
  ok(T.parseLatLon("35.3") === null, "片方だけは読まない");
  ok(T.parseLatLon("91.0, 139.4") === null, "緯度が範囲外なら読まない");
  ok(T.parseLatLon("139.47653, 35.31176") === null, "経度が先の並びは受け付けない（緯度が範囲外）");
  ok(T.parseLatLon("") === null && T.parseLatLon(null) === null, "空でも落ちない");
}

console.log("== 地図アプリのURLから座標を取る ==");
{
  const near = (r, lat, lon) => r && Math.abs(r.latitude - lat) < 1e-4 && Math.abs(r.longitude - lon) < 1e-4;
  ok(near(T.parseLatLon("https://www.google.com/maps?q=35.7477414,139.9303575&entry=gps"), 35.7477, 139.9304),
    "Googleマップ ?q=");
  ok(near(T.parseLatLon("https://www.google.com/maps/@35.3606,138.7274,17z"), 35.3606, 138.7274),
    "Googleマップ /@ の表示位置");
  ok(near(T.parseLatLon("https://www.google.com/maps/place/x/@35.3606,138.7274,15z/data=!3m1!4b1!4m6!3d35.3606!4d138.7274"),
    35.3606, 138.7274), "Googleマップの地物のURL");
  ok(near(T.parseLatLon("https://maps.apple.com/?ll=35.6812,139.7671&q=Tokyo"), 35.6812, 139.7671), "Appleマップ");
  ok(near(T.parseLatLon("https://maps.gsi.go.jp/#15/35.360000/138.727000/"), 35.36, 138.727), "地理院地図");
  ok(near(T.parseLatLon("https://www.openstreetmap.org/#map=15/35.3600/138.7270"), 35.36, 138.727), "OpenStreetMap");
  // **短縮リンクは読めない。** 転送先を読むには通信が要る（相手はCORSで読ませない）
  ok(T.parseLatLon("https://maps.app.goo.gl/BS9w87GutEMdLHqe7?g_st=ic") === null, "短縮リンクは座標を持たない");
  ok(T.isShortMapLink("https://maps.app.goo.gl/BS9w87GutEMdLHqe7?g_st=ic"), "短縮リンクだと見分ける");
  ok(!T.isShortMapLink("https://www.google.com/maps/@35.3,138.7,17z"), "長いURLは短縮リンク扱いしない");
  ok(T.parseLatLon("https://example.com/no-coords") === null, "座標の無いURLは読まない");
}

console.log("== 海の升目（404）を憶えて、開き直しても取りに行かない（2026-09-30） ==");
{
  const store = new Map();
  globalThis.caches = { open: async () => ({
    match: async (u) => (store.has(u) ? store.get(u).clone() : undefined),
    put: async (u, r) => { store.set(u, r); },
    keys: async () => [...store.keys()].map((url) => ({ url })),
    delete: async (u) => store.delete(u),
  }) };
  let fetched = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched++; return new Response("", { status: 404 }); };
  const path = require.resolve("./sorami-terrain.js");
  const p = center(1818, 806);           // 日本の範囲の中（範囲の外は取りに行かない）
  delete require.cache[path];
  const T1 = require("./sorami-terrain.js");
  ok(await T1.elevationFromTile(p.latitude, p.longitude) === null, "404 の升目は海（null）");
  delete require.cache[path];
  const T2 = require("./sorami-terrain.js");      // 画面を開き直したのと同じ（手元の憶えは空）
  ok(await T2.elevationFromTile(p.latitude, p.longitude) === null && fetched === 1,
    "開き直しても、同じ升目へは取りに行かない", `取得 ${fetched}回`);
  globalThis.fetch = realFetch;
  delete globalThis.caches;
  delete require.cache[path];
  require("./sorami-terrain.js");
}

console.log("== 地名索引（山・峠・展望地）（2026-09-30） ==");
{
  // 住所まじりの語でも、中に書かれた地名で当てる（2026-09-28 ユーザー指摘「赤城山鳥居峠が出ない」）
  const idx = { kinds: { p: "山", s: "峠", v: "展望地" }, munis: ["群馬県前橋市", "長野県塩尻市", "群馬県桐生市", "静岡県富士宮市"],
    places: [["s", "鳥居峠", "とりいとうげ", 3655800, 13918900, 1390, 0], ["p", "赤城山", "あかぎさん", 3656000, 13919300, 1828, 0],
      ["s", "鳥居峠", "とりいとうげ", 3604500, 13779000, 1197, 1], ["v", "富士見台", "", 3531000, 13862000, null, 3],
      ["p", "鳴神山", "", 3643000, 13925000, 980, 2]] };
  const a = T.searchPlaceIndex(idx, "群馬県桐生市富士見町赤城山鳥居峠");
  ok(a[0] && a[0].name === "鳥居峠" && a[0].muni === "群馬県前橋市", "住所まじりでも、赤城山の鳥居峠が1位", a.map((r) => `${r.name}(${r.muni})`).join(" / "));
  ok(a.some((r) => r.name === "赤城山"), "並んで書かれた赤城山も出る");
  const b = T.searchPlaceIndex(idx, "鳥居峠", { near: { latitude: 36.0, longitude: 137.8 } });
  ok(b.length === 2 && b[0].muni === "長野県塩尻市", "同名は、いま見ている地点に近い順");
  ok(T.searchPlaceIndex(idx, "とりいとうげ").length === 2, "かなでも引ける");
  ok(T.searchPlaceIndex(idx, "Ｔ").length === 0 && T.searchPlaceIndex(idx, "山").length === 0, "1文字では引かない");
  // 赤城の鳥居峠が索引に無いとき（公開データに無い地名）は、遠くの同名より赤城山を先に
  const noAkagiPass = { ...idx, places: idx.places.filter((r) => !(r[1] === "鳥居峠" && r[6] === 0)) };
  const c = T.searchPlaceIndex(noAkagiPass, "群馬県桐生市富士見町赤城山鳥居峠");
  ok(c[0] && c[0].name === "赤城山", "近くに無い同名（塩尻の鳥居峠）より、並べて書かれた赤城山を先に", c.map((r) => `${r.name}(${r.muni})`).join(" / "));
  ok(T.searchPlaceIndex(idx, "富士見台")[0].name === "富士見台", "名前がそのまま一致");
  // 住所の頭（都道府県・市区郡・町村）の中の地名を拾わない（「富士見町」の「富士見」）
  const withFujimi = { ...idx, places: [...idx.places, ["p", "富士見", "", 3570000, 13860000, 1640, 3]] };
  ok(T.searchPlaceIndex(withFujimi, "群馬県桐生市富士見町赤城山鳥居峠")[0].muni === "群馬県前橋市", "住所の中の「富士見」を地名として拾わない");
  const idx2 = { kinds: { w: "滝" }, munis: ["和歌山県那智勝浦町"], places: [["w", "那智滝", "", 3367500, 13588900, null, 0]] };
  ok(T.searchPlaceIndex(idx2, "那智の滝")[0]?.name === "那智滝", "「の」の有無を同じとみなす（那智の滝／那智滝）");
}

console.log(`\n${fail === 0 ? "TERRAIN OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
