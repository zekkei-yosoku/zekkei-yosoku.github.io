/*
 * Sorami — 地形（DEM）
 *
 * 「その方角の地平線は何度の高さにあるか」を求める。月が地形から出てくる時刻（月 §14-16）と、
 * 富士山が手前の山に隠れていないか（富士 §19-21）の両方がこれを要る。
 *
 * **事前計算はできない。** 2026-09-07 に内蔵スポット一覧を画面から外し、利用者が
 * OpenStreetMap で世界中の任意地点を登録する形になった。地点が決め打ちでない以上、
 * 出荷時に地形を焼き込むことができない。
 *
 * そこで **要る方角だけを、その場で測って憶える**。
 *   月の出   … 月の方位のまわり ±10度ほど
 *   富士山   … 富士山の方角ひとつ
 * 全周360度を測る必要は無い。地形は変わらないので、一度測れば使い回せる。
 *
 * 方位・距離は楕円体（WGS84）の測地線（2026-10-05 まで球）。
 * 標高は Open-Meteo Elevation API（Copernicus DEM 相当・約90m）。
 * **1回のリクエストで100点まで**（2026-09-14 実測。101点以上は 400 が返る）。
 */
(function (global) {
  "use strict";

  const A = global.SoramiAstro
    || (typeof require !== "undefined" ? require("./sorami-astro.js") : null);
  if (!A) throw new Error("sorami-astro.js が先に要ります");

  const DEG = Math.PI / 180;
  const EARTH_KM = 6371.0088;
  const MAX_POINTS = 100;            // Open-Meteo の上限（実測）
  const ENDPOINT = "https://api.open-meteo.com/v1/elevation";

  /*
   * 方位・距離・行き先は**楕円体（WGS84）の測地線**で解く（Vincenty）。2026-10-05 まで地球を球として解いていて、
   * 日本の緯度では北東・南東・南西・北西の向きで方位が最大0.12〜0.14°ずれた（南北・東西では0）。
   * 鷺沼北公園→スカイツリーで 57.2954° と出て、正しくは 57.4108°（国土地理院の測量計算と一致）。
   * 0.115° は月の直径の2割で、月が塔を横切る高さが約7′下に予測されていた（ユーザーの連写で発覚）。
   * 天体の方位は地理緯度の北から測るので、地上の目標もこの方位で比べる。
   */
  const WGS_A = 6378137, WGS_F = 1 / 298.257223563, WGS_B = WGS_A * (1 - WGS_F);
  /// 測地線の逆問題。{ km, azimuth（出発点での方位） }。収束しなければ球で返す（対蹠点の近くだけ）
  function inverse(aLat, aLon, bLat, bLon) {
    if (aLat === bLat && aLon === bLon) return { km: 0, azimuth: 0 };
    const L = (bLon - aLon) * DEG;
    const U1 = Math.atan((1 - WGS_F) * Math.tan(aLat * DEG)), U2 = Math.atan((1 - WGS_F) * Math.tan(bLat * DEG));
    const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
    let lam = L, sinS, cosS, sig, cos2a, cos2sm, sinL, cosL;
    for (let i = 0; i < 100; i++) {
      sinL = Math.sin(lam); cosL = Math.cos(lam);
      sinS = Math.hypot(cU2 * sinL, cU1 * sU2 - sU1 * cU2 * cosL);
      if (sinS === 0) return { km: 0, azimuth: 0 };
      cosS = sU1 * sU2 + cU1 * cU2 * cosL; sig = Math.atan2(sinS, cosS);
      const sinA = cU1 * cU2 * sinL / sinS; cos2a = 1 - sinA * sinA;
      cos2sm = cos2a ? cosS - 2 * sU1 * sU2 / cos2a : 0;
      const C = WGS_F / 16 * cos2a * (4 + WGS_F * (4 - 3 * cos2a)), prev = lam;
      lam = L + (1 - C) * WGS_F * sinA * (sig + C * sinS * (cos2sm + C * cosS * (-1 + 2 * cos2sm * cos2sm)));
      if (Math.abs(lam - prev) < 1e-12) {
        const u2 = cos2a * (WGS_A * WGS_A - WGS_B * WGS_B) / (WGS_B * WGS_B);
        const A_ = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2))), B_ = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
        const dS = B_ * sinS * (cos2sm + B_ / 4 * (cosS * (-1 + 2 * cos2sm * cos2sm) - B_ / 6 * cos2sm * (-3 + 4 * sinS * sinS) * (-3 + 4 * cos2sm * cos2sm)));
        const az = Math.atan2(cU2 * sinL, cU1 * sU2 - sU1 * cU2 * cosL) / DEG;
        return { km: WGS_B * A_ * (sig - dS) / 1000, azimuth: (az % 360 + 360) % 360 };
      }
    }
    return { km: sphereKm(aLat, aLon, bLat, bLon), azimuth: sphereBearing(aLat, aLon, bLat, bLon) };
  }
  /// 測地線の順問題（方位と距離から行き先）
  function destination(lat, lon, bearingDeg, distanceKm) {
    const a1 = bearingDeg * DEG, s = distanceKm * 1000, sa1 = Math.sin(a1), ca1 = Math.cos(a1);
    const tU1 = (1 - WGS_F) * Math.tan(lat * DEG), cU1 = 1 / Math.sqrt(1 + tU1 * tU1), sU1 = tU1 * cU1;
    const sig1 = Math.atan2(tU1, ca1), sinA = cU1 * sa1, cos2a = 1 - sinA * sinA;
    const u2 = cos2a * (WGS_A * WGS_A - WGS_B * WGS_B) / (WGS_B * WGS_B);
    const A_ = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2))), B_ = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
    let sig = s / (WGS_B * A_), cos2sm, sinS, cosS;
    for (let i = 0; i < 100; i++) {
      cos2sm = Math.cos(2 * sig1 + sig); sinS = Math.sin(sig); cosS = Math.cos(sig);
      const dS = B_ * sinS * (cos2sm + B_ / 4 * (cosS * (-1 + 2 * cos2sm * cos2sm) - B_ / 6 * cos2sm * (-3 + 4 * sinS * sinS) * (-3 + 4 * cos2sm * cos2sm)));
      const next = s / (WGS_B * A_) + dS;
      if (Math.abs(next - sig) < 1e-12) { sig = next; break; }
      sig = next;
    }
    cos2sm = Math.cos(2 * sig1 + sig); sinS = Math.sin(sig); cosS = Math.cos(sig);
    const x = sU1 * sinS - cU1 * cosS * ca1;
    const p2 = Math.atan2(sU1 * cosS + cU1 * sinS * ca1, (1 - WGS_F) * Math.hypot(sinA, x));
    const lam = Math.atan2(sinS * sa1, cU1 * cosS - sU1 * sinS * ca1);
    const C = WGS_F / 16 * cos2a * (4 + WGS_F * (4 - 3 * cos2a));
    const L = lam - (1 - C) * WGS_F * sinA * (sig + C * sinS * (cos2sm + C * cosS * (-1 + 2 * cos2sm * cos2sm)));
    let lo = (lon + L / DEG) % 360; if (lo > 180) lo -= 360; if (lo < -180) lo += 360;
    return { latitude: p2 / DEG, longitude: lo };
  }

  /// 2点間の方位角（北から東回り、出発点での測地線の向き）
  const bearing = (aLat, aLon, bLat, bLon) => inverse(aLat, aLon, bLat, bLon).azimuth;
  /// 測地線の長さ[km]
  const distanceKm = (aLat, aLon, bLat, bLon) => inverse(aLat, aLon, bLat, bLon).km;

  // 球での値。逆問題が収束しない（対蹠点の近く）ときの受け皿だけに使う
  function sphereBearing(aLat, aLon, bLat, bLon) {
    const p1 = aLat * DEG, p2 = bLat * DEG, dl = (bLon - aLon) * DEG;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return ((Math.atan2(y, x) / DEG) % 360 + 360) % 360;
  }
  function sphereKm(aLat, aLon, bLat, bLon) {
    const p1 = aLat * DEG, p2 = bLat * DEG;
    const dp = p2 - p1, dl = (bLon - aLon) * DEG;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /**
   * 標高をまとめて引く。**100点ずつに割って投げる。**
   * @param {Array} points [{latitude, longitude}]
   * @returns {Promise<number[]>} 標高[m]。取れなかった点は null
   */
  async function fetchElevations(points, { fetchImpl = global.fetch, timeoutMs = 20000 } = {}) {
    const out = [];
    for (let i = 0; i < points.length; i += MAX_POINTS) {
      const chunk = points.slice(i, i + MAX_POINTS);
      const q = `latitude=${chunk.map((p) => p.latitude.toFixed(5)).join(",")}`
              + `&longitude=${chunk.map((p) => p.longitude.toFixed(5)).join(",")}`;
      // 429（呼びすぎ）は待って試し直す。**黙って諦めない、無限に叩かない。**
      let res = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        res = await fetchImpl(`${ENDPOINT}?${q}`, { signal: AbortSignal.timeout(timeoutMs) });
        if (res.ok) break;
        if (res.status !== 429 && res.status < 500) break;
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      }
      if (!res || !res.ok) throw new Error(`標高が取れません（HTTP ${res ? res.status : "?"}）`);
      const j = await res.json();
      if (!Array.isArray(j.elevation) || j.elevation.length !== chunk.length) {
        throw new Error(`標高の件数が合いません（要求 ${chunk.length} / 応答 ${j.elevation?.length}）`);
      }
      out.push(...j.elevation);
    }
    return out;
  }

  // ---------------------------------------------------------------- 標高タイル
  /*
   * 国土地理院の標高タイル（dem_png）。**1リクエストで 256x256 = 65536点。**
   * Open-Meteo の標高API（1回100点）より桁が3つ多い。CORS も開いている
   * （`access-control-allow-origin: *` を実測確認）。
   *
   * **日本国内だけ。** 外はこれまでどおり Open-Meteo を使う。
   * 出典表示が要る: 国土地理院「標高タイル」
   */
  const GSI_TILE = "https://cyberjapandata.gsi.go.jp/xyz/dem_png";
  const JAPAN = { minLat: 20, maxLat: 46, minLon: 122, maxLon: 154 };
  const inJapan = (lat, lon) =>
    lat >= JAPAN.minLat && lat <= JAPAN.maxLat && lon >= JAPAN.minLon && lon <= JAPAN.maxLon;

  const tileXf = (lon, z) => (lon + 180) / 360 * 2 ** z;
  const tileYf = (lat, z) => {
    const r = lat * DEG;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z;
  };
  /// 画素の RGB を標高[m]へ。(128,0,0) は「標高なし」（国土地理院の仕様）
  function pixelToElevation(r, g, b) {
    if (r === 128 && g === 0 && b === 0) return null;
    const x = r * 65536 + g * 256 + b;
    return x < 8388608 ? x * 0.01 : (x - 16777216) * 0.01;
  }

  // 標高タイルの保存。**国土地理院は Cache-Control を返さない**（`last-modified` と
  // `etag` だけ）。放っておくと読み直しのたびに再検証の往復が入る。地形は変わらないので
  // こちらで持つ。1枚65536点ぶんで、線1本に88枚使う（実測）。
  const DEM_CACHE = "sorami-dem-v1";
  const DEM_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  // 1枚 約80〜110KB（2026-10-05 実測。以前の「20KB」は誤り）。最も精度の高い層と近くの細かいズームにしてから、
  // 1地点で月の地平線・候補地の見通し・富士山の稜線を合わせて約300枚になるので、5地点ぶん持つ（約150MB）
  const DEM_MAX = 1600;
  const DEM_AT = "x-sorami-at";              // 使う場所より前に置く（後ろだと TDZ）
  const DEM_MISSING = "x-sorami-missing";    // タイルの無い区画（404）の印
  const demStore = () => (typeof caches !== "undefined" && caches && typeof caches.open === "function"
    ? caches : null);

  /// PNG のバイト列を画素へ。`createImageBitmap` が無ければ諦めて Image の道に落とす
  async function decodeTile(blob) {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, bmp.width, bmp.height);
    if (bmp.close) bmp.close();
    return data;
  }

  /// Image で読む道。保存領域が使えない環境ぶんの受け皿
  function loadTileByImage(url) {
    return new Promise((resolve) => {
      if (typeof Image === "undefined" || typeof document === "undefined") { resolve(null); return; }
      const img = new Image();
      let finished = false;
      const finish = (value) => { if (!finished) { finished = true; clearTimeout(timer); resolve(value); } };
      const timer = setTimeout(() => finish(null), 8000);
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = img.width; c.height = img.height;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          finish(ctx.getImageData(0, 0, img.width, img.height));
        } catch { finish(null); }        // 汚染された canvas 等。**落とさない**
      };
      img.onerror = () => finish(null);  // 海など、タイルの無い区画は 404
      img.src = url;
    });
  }

  const tiles = new Map();
  const TILE_MEM = 240;                      // 手元に持つ画素（1枚 約260KB）。古いものから手放し、要れば保存領域から読み直す
  // 標高タイルの無い升目（404＝陸の無い外洋）。水の判定で、海と分かっている所へ水域タイルを取りに行かないために憶える
  const demMissing = new Set();
  /// タイルを1枚読む。**同じタイルは二度取りに行かない**（この画面でも、次に開いたときも）。
  /// layer は国土地理院の標高タイルの種類（既定は10mメッシュの dem_png）
  function loadTile(z, x, y, layer = "dem_png") {
    const key = layer === "dem_png" ? `${z}/${x}/${y}` : `${layer}/${z}/${x}/${y}`;
    if (tiles.has(key)) return tiles.get(key);
    const url = `${GSI_TILE.replace(/dem_png$/, layer)}/${z}/${x}/${y}.png`;
    const p = (async () => {
      const store = demStore();
      let cache = null;
      if (store) {
        try {
          cache = await store.open(DEM_CACHE);
          const hit = await cache.match(url);
          const at = hit ? Number(hit.headers.get(DEM_AT)) : NaN;
          if (hit && Date.now() - at < DEM_TTL_MS && Date.now() >= at) {
            // **海など、タイルの無い区画も憶えておく。** 開くたびに同じ升目へ取りに行って
            // 404 を並べていた（2026-09-30 総点検。ねらうの線が相模湾・東京湾の上を通るたびに十数枚）
            if (hit.headers.get(DEM_MISSING)) { demMissing.add(key); return null; }
            const img = await decodeTile(await hit.blob());
            if (img) return img;
          }
        } catch { cache = null; }       // 保存領域が使えなくても、取得は止めない
      }
      if (!cache || typeof fetch !== "function") return loadTileByImage(url);
      let res = null;
      try { res = await fetch(url, { mode: "cors", signal: global.AbortSignal?.timeout(8000) }); } catch { return loadTileByImage(url); }
      if (!res.ok) {                    // 海など、タイルの無い区画は 404
        if (res.status === 404) {
          demMissing.add(key);
          try {
            await cache.put(url, new Response("", { status: 200,
              headers: { [DEM_MISSING]: "1", [DEM_AT]: String(Date.now()) } }));
          } catch { /* 憶えられなくても、今回は海として返す */ }
        }
        return null;
      }
      const blob = await res.blob();
      const img = await decodeTile(blob);
      if (!img) return loadTileByImage(url);
      try {
        await cache.put(url, new Response(blob, { status: 200,
          headers: { "content-type": "image/png", [DEM_AT]: String(Date.now()) } }));
        pruneDemCache(cache);
      } catch { /* 容量超過など。使い回せないだけで、今回の結果は返す */ }
      return img;
    })();
    tiles.set(key, p);
    while (tiles.size > TILE_MEM) tiles.delete(tiles.keys().next().value);
    return p;
  }

  /// 古いものから消す。放っておくと地点を変えるたびに増え続ける
  let demPruning = false;
  async function pruneDemCache(cache) {
    if (demPruning) return;
    demPruning = true;
    try {
      const keys = await cache.keys();
      if (keys.length <= DEM_MAX) return;
      const aged = [];
      for (const req of keys) {
        const r = await cache.match(req);
        aged.push({ req, at: r ? Number(r.headers.get(DEM_AT)) || 0 : 0 });
      }
      aged.sort((a, b) => a.at - b.at);
      for (const x of aged.slice(0, aged.length - DEM_MAX)) await cache.delete(x.req);
    } catch { /* 掃除は補助 */ } finally { demPruning = false; }
  }

  /// 1つの層から1点。タイル自体が取れなければ undefined、「標高なし」画素なら null
  async function sampleLayer(layer, lat, lon, z) {
    const fx = tileXf(lon, z), fy = tileYf(lat, z);
    const img = await loadTile(z, Math.floor(fx), Math.floor(fy), layer);
    if (!img) return undefined;
    const px = Math.min(img.width - 1, Math.floor((fx % 1) * img.width));
    const py = Math.min(img.height - 1, Math.floor((fy % 1) * img.height));
    const i = (py * img.width + px) * 4;
    return pixelToElevation(img.data[i], img.data[i + 1], img.data[i + 2]);
  }

  /*
   * 標高タイルは、画素ごとに最も精度の高いDEMから読む（2026-10-05 ユーザー「標高は全て一番精度が高いやつを使うようにしてよ」）。
   * 1mメッシュ（航空レーザ。dem1a_png、z17まで）→ 5m（航空レーザ。dem5a_png、z15まで）→ 5m（写真測量。dem5b・dem5c、z15まで）→ 10m（dem_png、z14まで）。
   * 1m・5mにも縮小版（z8〜）があり、同じズームなら画素の大きさは同じで、元のDEMの精度だけが上がる。
   * 上の層はタイルがあっても範囲外の画素が「標高なし」なので画素ごとに下へ落とす。1mも5m（レーザ）も無ければ10mを見て、
   * 10mでも「標高なし」かタイルが無ければ海（写真測量の5mを取りに行かない。海の上で404を並べないため）。
   * 2026-10-05 まで10mだけ（dem_png）。1mは関東の平野・山地、富士山、屋久島まで実測で返った（大雪山は5mだけ）。
   * 10mだけのときとの違い（月の全周の地平線・40km）: 高尾山の中腹で中央0.65°・最大11°、河口湖北岸で最大0.9°、鷺沼北公園で最大0.3°。
   * 鷺沼北公園から見た富士山の稜線は最大0.8′。代わりに初回の取得が増える（月の全周の地平線で 1.7MB→6.7MB、高尾山の中腹で 2.4MB→9.0MB。30日とっておく）。
   * 10mを先に見て海を確かめる順（1m→10m→5m）より、1地点あたり0.2〜1.4MB少ない（2026-10-05 実測）
   */
  /// 標高タイルから1点（最も精度の高い層）。タイル自体が取れなければ undefined、海なら null
  async function sampleTile(lat, lon, z) {
    if (!inJapan(lat, lon)) return undefined;
    for (const [layer, maxZ] of [["dem1a_png", 17], ["dem5a_png", 15]]) {
      const v = await sampleLayer(layer, lat, lon, Math.min(z, maxZ));
      if (Number.isFinite(v)) return v;
    }
    const ten = await sampleLayer("dem_png", lat, lon, Math.min(z, 14));
    if (!Number.isFinite(ten)) return ten;
    for (const [layer, maxZ] of [["dem5b_png", 15], ["dem5c_png", 15]]) {
      const v = await sampleLayer(layer, lat, lon, Math.min(z, maxZ));
      if (Number.isFinite(v)) return v;
    }
    return ten;
  }

  /*
   * 観測点からの距離に合わせたズーム。観測点から見て画素1つが0.5°以下になるまで上げる（z17＝約1mまで）。
   * 見上げ角の誤差は「画素の中の高さの違い ÷ 距離」なので、近い点ほど細かい画素が要る。100m先はz17、1km先はz14、3km先はz13。
   * 以前は一律z11（1画素 約60m）で、100m先の点は画素1つが30°に見えていた。
   * 0.5°は急な斜面（傾き0.5）でも見上げ角の誤差が0.2°以内で、地平線を測る距離の刻みより細かい。0.3°にすると月の全周の地平線で
   * 1mのタイルが56枚→82枚（従来の10mは22枚）に増えるので、ここで止めた（2026-10-05 鷺沼北公園で実測）。
   * 遠い点は呼び手のズーム（base）より粗くしない。輪1本あたりのタイルは数枚で済む（画素が距離に比例して大きくなるため）。
   */
  const NEAR_PIXEL_RAD = 0.5 * DEG;
  function zoomFor(from, p, base) {
    if (!from) return base;
    const dy = (p.latitude - from.latitude) * 111195;
    const dx = (p.longitude - from.longitude) * 111195 * Math.cos(from.latitude * DEG);
    const want = Math.max(0.01, Math.hypot(dx, dy) * NEAR_PIXEL_RAD);
    const z = Math.ceil(Math.log2(156543.03 * Math.cos(p.latitude * DEG) / want));
    return Math.max(base, Math.min(17, z));
  }

  /// 標高タイルから1点。取れなければ null（呼び手が Open-Meteo へ落とす）
  async function elevationFromTile(lat, lon, z = 11) {
    const v = await sampleTile(lat, lon, z);
    return v === undefined ? null : v;
  }

  /*
   * 立つ場所の地面の標高。国土地理院の標高API（その地点で最も精度の高いDEM: 1mメッシュ（航空レーザ）→ 5m → 10m を
   * 国土地理院の側で選ぶ）。出どころは hsrc（「1m（レーザ）」など）。海は "-----" で 0m とする。
   * 2026-10-05 まで10mメッシュのタイル z13（1画素 約16m）で、鷺沼北公園の撮影地が 1mメッシュの 86.85m に対し 81.52m と出ていた。
   * 目の高さが1m違うと26km先の目標の見上げ角が0.13′変わる。
   * タイルで1m→5m→10mと探す形も試したが、候補地が多い画面の初回で標高タイルを223枚（うち404が95枚）取りに行ったのでやめた。
   * 1地点1回の小さな応答で、同時は6件まで、取った値は標高タイルと同じ置き場に30日とっておく。取れなければ10mメッシュのタイル。
   */
  const GSI_POINT = "https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php";
  const points = new Map();
  let pointActive = 0;
  let pointRetryAfter = 0;
  const pointWaiting = [];
  async function pointLimited(fn) {
    while (pointActive >= 6) await new Promise((ok) => pointWaiting.push(ok));
    pointActive++;
    try { return await fn(); } finally { pointActive--; const next = pointWaiting.shift(); if (next) next(); }
  }
  function parsePoint(j) {
    if (j && Number.isFinite(Number(j.elevation)) && j.elevation !== "") return { elevation: Number(j.elevation), source: String(j.hsrc || "") };
    if (j && j.elevation === "-----") return { elevation: 0, source: "海" };
    return null;
  }
  async function groundElevation(lat, lon, { withSource = false, fetchImpl = global.fetch } = {}) {
    if (!inJapan(lat, lon)) return null;
    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (!points.has(key)) {
      points.set(key, (async () => {
        const url = `${GSI_POINT}?lon=${lon.toFixed(6)}&lat=${lat.toFixed(6)}&outtype=JSON`;
        const store = demStore();
        let cache = null;
        if (store) {
          try {
            cache = await store.open(DEM_CACHE);
            const hit = await cache.match(url), at = hit ? Number(hit.headers.get(DEM_AT)) : NaN;
            if (hit && Date.now() - at < DEM_TTL_MS && Date.now() >= at) { const v = parsePoint(await hit.json()); if (v) return v; }
          } catch { cache = null; }
        }
        try {
          const res = typeof fetchImpl === "function" ? await pointLimited(async () => {
            // APIが応答しないと線と候補地がいつまでも終わらない。
            // 失敗後30秒はタイルへ回し、数百地点で同じ失敗を繰り返さない。
            if (Date.now() < pointRetryAfter) return null;
            try {
              const r = await fetchImpl(url, { signal: global.AbortSignal?.timeout(8000) });
              if (!r?.ok && (r?.status === 429 || r?.status >= 500)) pointRetryAfter = Date.now() + 30000;
              return r;
            } catch { pointRetryAfter = Date.now() + 30000; return null; }
          }) : null;
          if (res && res.ok) {
            const j = await res.json(), v = parsePoint(j);
            if (v) {
              if (cache) {
                try {
                  await cache.put(url, new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json", [DEM_AT]: String(Date.now()) } }));
                  pruneDemCache(cache);
                } catch { /* 憶えられなくても今回の値は返す */ }
              }
              return v;
            }
          }
        } catch { /* 下の10mメッシュへ */ }
        const t = await sampleTile(lat, lon, 17);
        return t === undefined ? null : { elevation: t === null ? 0 : t, source: t === null ? "海" : "標高タイル" };
      })());
      const pending = points.get(key);
      pending.then((v) => { if (!v && points.get(key) === pending) points.delete(key); });
      while (points.size > 3000) points.delete(points.keys().next().value);
    }
    const v = await points.get(key);
    return v ? (withSource ? v : v.elevation) : null;
  }

  /**
   * 標高をまとめて引く。**日本国内なら標高タイル（最も精度の高い層）、外なら Open-Meteo。**
   * タイルは1枚65536点ぶんなので、まとまった範囲を見るときに桁違いに速い。
   * `from`（観測点）を渡すと、近い点ほど細かいズームで読む（zoomFor）。
   */
  async function elevations(points, opts = {}) {
    if (!points.length) return [];
    if (points.every((p) => inJapan(p.latitude, p.longitude)) && typeof Image !== "undefined") {
      const base = opts.zoom ?? 11;
      const raw = await Promise.all(points.map((p) => sampleTile(p.latitude, p.longitude, zoomFor(opts.from, p, base))));
      // 読めたタイルの「標高なし」画素は海なので 0m（海面）とする。
      // 以前は Open-Meteo で埋め直していて、富士市では全周 816点が海で 100点ずつ 9回叩き、
      // 本番で 429 が続いて地形の地平線ごと失敗していた（2026-09-22）。
      const out = raw.map((v) => (v === null ? 0 : v === undefined ? null : v));
      if (out.every((v) => v !== null)) return out;
      // タイルが取れなかった点だけ Open-Meteo で埋める（海だけの区画は 404）
      const missing = points.filter((_, i) => out[i] === null);
      const filled = await fetchElevations(missing, opts);
      let k = 0;
      return out.map((v) => (v === null ? filled[k++] : v));
    }
    return fetchElevations(points, opts);
  }

  /**
   * 目の高さの目安（富士 §8「ObserverHeightAGLが不明な場合」）。
   *
   * **推測で決め打ちしない。** 利用者が選べる形にして、選ばなければ「立った目線」。
   * 展望台やビルの上では地面の標高だけでは足りず、ここが数十〜数百m効く。
   */
  const EYE_HEIGHT_PRESETS = [
    { key: "standing", label: "地面に立って", m: 1.5 },
    { key: "car",      label: "車の中から", m: 1.2 },
    { key: "roof2",    label: "2階・低い展望台", m: 5 },
    { key: "roof5",    label: "5階建ての屋上", m: 15 },
    { key: "tower50",  label: "50m ほどの展望台", m: 50 },
    { key: "tower100", label: "100m ほどの展望台", m: 100 },
    { key: "tower150", label: "150m ほどの展望台", m: 150 },
    { key: "tower250", label: "250m ほどの展望台", m: 250 },
    { key: "tower350", label: "350m 以上の展望台", m: 350 },
  ];

  /**
   * 観測者の目の高さを決める（富士 §7・§8）。
   *
   *   目の高さ = 地面の標高（DEM）+ 立っている高さ
   *
   * **地面の標高は DEM から取る。手入力の数字を使わない。**
   * 食い違うと、すぐ脇に幻の壁が立つか、逆に無い視界が開ける。
   * 2026-09-14 に河口湖の座標で 172m ずれ、100m先に 50度の壁ができて
   * 「富士山がまったく見えない」と出た。
   *
   * 手入力の値は「DEM と大きく違わないか」の確認にだけ使う。
   *
   * @param {number} eyeHeightAGL 地面からの目の高さ[m]。展望台やビルならその高さ
   */
  async function resolveObserver(latitude, longitude, { eyeHeightAGL = 1.5, statedElevation = null, ...opts } = {}) {
    const [ground] = await elevations([{ latitude, longitude }], opts);
    if (ground === null || ground === undefined) {
      if (statedElevation === null) throw new Error("地面の標高が取れませんでした");
      return { latitude, longitude, groundM: statedElevation, eyeHeightAGL,
               elevation: statedElevation + eyeHeightAGL, source: "手入力（DEMが取れず）", mismatchM: null };
    }
    const mismatch = statedElevation === null ? null : Math.round(statedElevation - ground);
    return {
      latitude, longitude, groundM: ground, eyeHeightAGL,
      elevation: ground + eyeHeightAGL,
      source: "DEM",
      mismatchM: mismatch,
      // 大きくずれていたら座標を疑う。**黙って進めない**
      warning: mismatch !== null && Math.abs(mismatch) > 30
        ? `手入力の標高 ${statedElevation}m と DEM の ${Math.round(ground)}m が ${Math.abs(mismatch)}m 違います。座標を確かめてください`
        : null,
    };
  }

  /**
   * 見る距離の刻み。
   *
   * **近いほど細かく。** 500m の丘でも 10km なら 2.8度で、100km 先の富士山（1.8度）を隠す。
   * 近くを粗く見ると地平線を取り違える。遠方は「高い山がそこにあるか」だけなので粗くてよい。
   *
   * 既定は22点。**細い尾根は取りこぼし得る**（DEM 90m に対して間隔が広い区間がある）。
   * 精度が要る用途（富士山への視線）は `step` を指定して等間隔で密に取る。
   */
  const DEFAULT_STEPS = [0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 7, 9,
                         12, 16, 20, 26, 33, 42, 55, 70, 100];

  function stepsFor({ maxKm = 100, step = null } = {}) {
    if (step) {
      const out = [];
      for (let d = step; d <= maxKm + 1e-9; d += step) out.push(Number(d.toFixed(4)));
      return out;
    }
    return DEFAULT_STEPS.filter((d) => d <= maxKm);
  }

  /**
   * 指定した方位の地平線の高さ（度）を測る。
   * @param {object} observer { latitude, longitude, elevation }（elevation は m）
   * @param {number[]} azimuths 測る方位
   */
  async function measureHorizon(observer, azimuths, opts = {}) {
    const dists = stepsFor(opts);
    const points = [];
    for (const az of azimuths) {
      for (const d of dists) points.push(destination(observer.latitude, observer.longitude, az, d));
    }
    const elevs = await elevations(points, { ...opts, from: observer });

    const result = [];
    let i = 0;
    for (const az of azimuths) {
      let best = { angle: -90, distanceKm: null, elevationM: null };
      for (const d of dists) {
        const e = elevs[i++];
        if (e === null || e === undefined) continue;
        const a = A.targetElevationAngle(d, observer.elevation ?? 0, e, opts);
        if (a > best.angle) best = { angle: a, distanceKm: d, elevationM: e };
      }
      // 地形が観測者より低いだけなら、地平線は「海の地平線」まで下がる
      const seaHorizon = -A.targetElevationAngle(
        A.horizonDistanceKm(Math.max(0, observer.elevation ?? 0), opts), observer.elevation ?? 0, 0, opts);
      result.push({
        azimuth: az,
        horizonAngleDeg: Math.max(best.angle, -Math.abs(seaHorizon)),
        byDistanceKm: best.distanceKm,
        byElevationM: best.elevationM,
        samples: dists.length,
      });
    }
    return result;
  }

  // ---------------------------------------------------------------- 建物（urban 層）

  // Overpass は**よく 504 を返す**（混んでいる時間帯は連発する。2026-09-14 実測）。
  // 1本だけに頼ると市街地で建物層が入らない日ができるので、順に試す。
  // 受付（overpass-api.de）が止まる・混むときは、裏の個別サーバー（z・lz4）が応答することが多い
  // （2026-09-30。受付が混んで 504 のあいだも z・lz4 は2秒で返した）。順に試す
  const OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    // overpass-api.de の3台が接続を断り（この回線の遮断の疑い）、kumi も返らないときに通った（2026-10-02 実測）
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  ];

  // 月の仕様「地平線」: 行き先の代表点を、建物脇の観測点と取り違えない。
  // 新規検索は Nominatim の種別を保存。旧検索だけ自治体名の末尾で移行する。
  function locationScope(place = {}) {
    if (place.locationScope === "area" || place.locationScope === "point") return place.locationScope;
    if (place.id === "default") return "area";
    if (String(place.id || "").startsWith("search:") && /[市区町村]$/.test(place.name || "")) return "area";
    return "point";
  }

  function searchLocationScope(result) {
    const category = result.category || result.class;
    const type = result.addresstype || result.type;
    return category === "boundary" || (category === "place" &&
      ["country", "state", "province", "region", "county", "municipality", "city", "town", "village",
       "hamlet", "borough", "city_district", "suburb", "quarter", "neighbourhood", "island"].includes(type))
      ? "area" : "point";
  }

  /**
   * 緯度経度らしき文字列を読む。地図アプリからの貼り付けをそのまま受ける。
   *   「35.31176, 139.47653」「35.31176 139.47653」
   *   「35°18'42.3"N 139°28'35.5"E」（Googleマップの表記）
   *   「N35.31176 E139.47653」
   * 読めなければ null。**日本の外でも読む**（判断は呼び手に任せる）。
   */
  /**
   * 地図アプリのURLから緯度経度を取り出す。**通信しない**ので、
   * 短縮リンク（maps.app.goo.gl/…）は読めない（座標が本文に無く、転送先を読むには通信が要る）。
   *   Googleマップ  /maps/@35.36,138.72,17z ／ ?q=35.36,138.72 ／ ?ll= ／ !3d35.36!4d138.72
   *   Appleマップ   ?ll=35.36,138.72 ／ ?coordinate=
   *   地理院地図    #15/35.360/138.727
   *   OpenStreetMap #map=15/35.360/138.727
   */
  function parseMapLink(text) {
    const t = String(text || "").trim();
    if (!/^https?:\/\//i.test(t)) return null;
    const num = "(-?\\d{1,3}(?:\\.\\d+)?)";
    const patterns = [
      new RegExp(`[?&](?:q|ll|sll|coordinate|daddr|center)=${num}%2C${num}`, "i"),
      new RegExp(`[?&](?:q|ll|sll|coordinate|daddr|center)=${num},\\s*${num}`, "i"),
      new RegExp(`/@${num},${num}`),                       // Googleマップの表示位置
      new RegExp(`!3d${num}!4d${num}`),                    // Googleマップの地物の位置
      new RegExp(`[#&]map=\\d+(?:\\.\\d+)?/${num}/${num}`),   // OpenStreetMap
      new RegExp(`#\\d+(?:\\.\\d+)?/${num}/${num}`),          // 地理院地図
      new RegExp(`[?&]lat=${num}[&#].*?[?&]lon(?:gitude)?=${num}`, "i"),
    ];
    for (const re of patterns) {
      const m = t.match(re);
      if (!m) continue;
      const lat = Number(m[1]), lon = Number(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lon)
          && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { latitude: lat, longitude: lon };
    }
    return null;
  }

  /// 短縮リンクかどうか。**中身は読めない**（座標が本文に無く、転送先を読むには通信が要る）。
  /// 画面で「一度開いて貼り直して」と案内するために見分ける。
  const isShortMapLink = (text) =>
    /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|maps\.apple\.com\/p\/)/i.test(String(text || "").trim());

  function parseLatLon(text) {
    const link = parseMapLink(text);
    if (link) return link;
    const t = String(text || "").trim()
      .replace(/[，、]/g, ",")                     // 全角の区切り
      .replace(/[０-９．－]/g, (c) => "0123456789.-"["０１２３４５６７８９．－".indexOf(c)])
      // **分・秒・度の記号をそろえる。** iPhone は打った ' と " を自動で丸い引用符（’ ”）に変えるので、
      // そのままでは読めず、地名として検索して何も出なかった（2026-10-01 ユーザー「35°44'52.1"N 139°55'49.1"E が検索できない」）。
      // 記号は字の見た目が似ていて、書き写すとまとめて直線の引用符になってしまうので、\u で書く
      .replace(/[\u2018\u2019\u02BC\u2032\uFF07\u00B4\u0060]/g, "'")   // ‘ ’ ʼ ′ ＇ ´ `
      .replace(/[\u201C\u201D\u02BA\u2033\uFF02]/g, '"')               // “ ” ʺ ″ ＂
      .replace(/[\u00BA\u02DA]/g, "\u00B0");                              // º ˚ → °
    if (!t) return null;
    // 度分秒。N/S/E/W は前後どちらでもよい
    const dms = /([NSEWnsew])?\s*(\d{1,3})[\u00B0度]\s*(?:(\d{1,2})['分]\s*(?:([\d.]+)["秒]?)?)?\s*([NSEWnsew])?/g;
    const found = [];
    let m;
    while ((m = dms.exec(t)) !== null) {
      if (!m[2]) continue;
      const sign = /[SWsw]/.test(`${m[1] || ""}${m[5] || ""}`) ? -1 : 1;
      const value = sign * (Number(m[2]) + Number(m[3] || 0) / 60 + Number(m[4] || 0) / 3600);
      found.push({ value, hemi: (m[1] || m[5] || "").toUpperCase() });
      if (found.length === 2) break;
    }
    if (found.length === 2) {
      const [a, b] = found;
      const latFirst = !(a.hemi === "E" || a.hemi === "W" || b.hemi === "N" || b.hemi === "S");
      const lat = latFirst ? a.value : b.value, lon = latFirst ? b.value : a.value;
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { latitude: lat, longitude: lon };
      return null;
    }
    // 十進。「N35.3, E139.4」も読む
    const dec = t.match(/^([NSns])?\s*(-?\d{1,3}(?:\.\d+)?)\s*[NSns]?\s*[,\s]\s*([EWew])?\s*(-?\d{1,3}(?:\.\d+)?)\s*[EWew]?$/);
    if (!dec) return null;
    let lat = Number(dec[2]), lon = Number(dec[4]);
    if (/[Ss]/.test(dec[1] || "")) lat = -Math.abs(lat);
    if (/[Ww]/.test(dec[3] || "")) lon = -Math.abs(lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { latitude: lat, longitude: lon };
  }

  /// 国土地理院の地名検索の結果が「地域の代表点」かどうか。
  /// 行政区画の名前（◯◯都・◯◯市・◯◯区…）だけのときは代表点、
  /// 施設や地物の名前なら点として扱う。**代表点ではダイヤモンド富士も建物の地平線も出せない。**
  /**
   * 展望台の高さ。**塔の先端の高さと、展望台の床の高さは違う。**
   *
   * OSM の `height` は構造物の高さなので、東京タワーなら 333m（先端）で、
   * 人が立つメインデッキ 125m とは別物。地平線も月の出も、立つ高さで変わる。
   * **公表値のあるものは名前で持つ。**
   *
   * `aglM` は地上からの高さ。地面の標高は標高タイルから足す。
   * 出典は各施設の公表値（2026-09-28 時点）。
   * **案内の「150m」「250m」が海抜のことがある。** 六本木ヒルズ（32m）・サンシャイン60（30m）は
   * 海抜で案内しているので、地上へ直して持つ（2026-10-02。それまで海抜の数字を地上として足し、20〜30m 高く解いていた）。
   */
  // 東京タワーは公式案内の地上150m/250m。旧125m/224m設定を2026-10-07に訂正。
  const OBSERVATION_DECKS = [
    { match: /東京スカイツリー|スカイツリー/, decks: [
      { name: "天望デッキ", aglM: 350 }, { name: "天望回廊", aglM: 450 }] },
    { match: /東京タワー/, decks: [
      { name: "メインデッキ", aglM: 150 }, { name: "トップデッキ", aglM: 250 }] },
    { match: /あべのハルカス/, decks: [{ name: "ハルカス300", aglM: 300 }] },
    { match: /六本木ヒルズ|森タワー|東京シティビュー/, decks: [
      { name: "東京シティビュー", aglM: 218 }, { name: "スカイデッキ", aglM: 238 }] },
    { match: /渋谷スカイ|渋谷スクランブルスクエア/, decks: [{ name: "展望台", aglM: 229 }] },
    { match: /サンシャイン ?60/, decks: [{ name: "展望台", aglM: 221 }] },
    { match: /東京都庁/, decks: [{ name: "展望室", aglM: 202 }] },
    { match: /横浜ランドマークタワー|スカイガーデン/, decks: [{ name: "スカイガーデン", aglM: 273 }] },
    { match: /江の?島シーキャンドル/, decks: [{ name: "展望台", aglM: 42 }] },
    { match: /千葉ポートタワー/, decks: [{ name: "展望台", aglM: 113 }] },
    { match: /東京ワールドゲート|虎ノ門ヒルズ/, decks: [{ name: "展望台", aglM: 250 }] },
  ];
  // **施設名を含むだけの別物**を弾く。「東京タワー前交番」は展望台ではない
  const NOT_THE_PLACE = /(交番|派出所|駐在所|駅|バス停|停留所|郵便局|入口|出口|前|通り|商店|ストア|学校|病院|タウン|ホテル)/;
  // 「東京都庁舎」のように、少しだけ長い言い方は同じ施設として通す
  const SAME_PLACE_TAIL = /^[\s　]*(展望|天望|メイン|トップ|デッキ|回廊|スカイ|ガーデン|タワー|ビル|棟|本社)/;

  /**
   * 名前から展望台の高さを引く。無ければ null。
   * **名前の頭から当たることを求める。** 部分一致だけだと
   * 「愛宕警察署東京タワー前交番」が展望台になる（2026-09-28 実測）。
   */
  function decksFor(name) {
    if (!name) return null;
    const n = String(name).trim();
    for (const d of OBSERVATION_DECKS) {
      const m = d.match.exec(n);
      if (!m || m.index !== 0) continue;
      const rest = n.slice(m[0].length);
      if (NOT_THE_PLACE.test(rest)) continue;
      if (rest === "" || rest.length <= 1 || SAME_PLACE_TAIL.test(rest)) return d.decks;
    }
    return null;
  }

  /**
   * 展望台の呼び名。**地点の名前と同じなら「展望台」と書く。**
   * 「渋谷スカイ」で「渋谷スカイ 地上229m」と出ると、名前が二度出て読みにくい
   * （2026-09-28 ユーザー指摘）。固有の呼び名があるものだけ、その名前で出す。
   */
  function deckLabel(deckName, placeName) {
    const d = String(deckName || "").trim(), p = String(placeName || "").trim();
    if (!d) return "展望台";
    if (!p) return d;
    return (p.includes(d) || d.includes(p)) ? "展望台" : d;
  }

  /**
   * OSM のタグから構造物の高さを読む。**展望台の高さではない。**
   * `height` があればそれ、無ければ階数から（1階3.3m）。
   * @returns {{m:number, from:string}|null}
   */
  function structureHeight(tags) {
    if (!tags) return null;
    const h = parseFloat(tags.height);
    if (Number.isFinite(h) && h > 3 && h < 1000) return { m: h, from: "height" };
    const lv = parseFloat(tags["building:levels"]);
    if (Number.isFinite(lv) && lv >= 2 && lv < 200) return { m: Math.round(lv * 3.3), from: "levels" };
    return null;
  }

  /// 展望台・塔・高い建物か（検索結果に印を付けるため）
  function isLookout(r) {
    const t = (r && r.extratags) || {};
    if (r && (r.type === "viewpoint" || t.tourism === "viewpoint")) return "viewpoint";
    if (t["tower:type"] === "observation") return "observation";
    if ((r && r.type === "tower") || t.man_made === "tower") return "tower";
    const h = structureHeight(t);
    if (h && h.m >= 30) return "building";
    return null;
  }

  function gsiLocationScope(title) {
    const t = String(title || "").trim();
    if (!t) return "area";
    // 「東京都練馬区」「静岡県富士宮市」のように行政区画だけで終わるもの
    return /^[^\s]*?(都|道|府|県)?[^\s]*?(市|区|町|村|郡)$/.test(t) || /^[^\s]+(都|道|府|県)$/.test(t)
      ? "area" : "point";
  }

  // 建物は数mの移動で変わる。地面と目の高さも別々にキーへ含める。
  function urbanCacheKey(observer) {
    return JSON.stringify([observer.latitude, observer.longitude, observer.groundM, observer.elevation]);
  }

  /// 輪郭（緯度経度の多角形）が点を含むか。建物の大きさなら平面近似で足りる
  function containsPoint(geometry, lat, lon) {
    let inside = false;
    for (let i = 0, j = geometry.length - 1; i < geometry.length; j = i++) {
      const a = geometry[i], b = geometry[j];
      if ((a.lat > lat) !== (b.lat > lat)
          && lon < (b.lon - a.lon) * (lat - a.lat) / (b.lat - a.lat) + a.lon) inside = !inside;
    }
    return inside;
  }

  /**
   * Wikidata にある高さ（P2048、地上から）と標高（P2044）。メートル（Q11573）とフィート（Q3710）だけ読む。
   * OpenStreetMap に高さが無い目標物でも、wikidata の参照があれば取れる（大平和祈念塔は OSM に高さが無く、Wikidata に 180m。2026-10-01
   * ユーザー「検索したらその建物、目標物の高さを取得して出すとかだとダメなの？」）。読めなければ null
   */
  async function wikidataHeight(qid, { fetchImpl = null, timeoutMs = 8000 } = {}) {
    if (!/^Q\d+$/.test(String(qid || ""))) return null;
    const f = fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!f) return null;
    try {
      const res = await f(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json&origin=*`, {
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined });
      if (!res.ok) return null;
      const d = await res.json();
      const claims = (d && d.entities && d.entities[qid] && d.entities[qid].claims) || {};
      const RANK = { preferred: 0, normal: 1, deprecated: 9 };
      const pick = (pid) => {
        const list = (claims[pid] || []).slice().sort((a, b) => (RANK[a.rank] ?? 5) - (RANK[b.rank] ?? 5));
        for (const c of list) {
          const v = c.rank !== "deprecated" && c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
          if (!v) continue;
          const amt = parseFloat(v.amount), unit = String(v.unit || "").split("/").pop();
          const m = unit === "Q11573" ? amt : unit === "Q3710" ? amt * 0.3048 : NaN;
          if (Number.isFinite(m) && m > 0) return m;
        }
        return null;
      };
      const out = { heightM: pick("P2048"), elevationM: pick("P2044") };
      return out.heightM || out.elevationM ? out : null;
    } catch { return null; }
  }

  /**
   * **運営の違うサーバーへ1本ずつ同時に聞き、使える最初の返事を使う**（残りは打ち切る）。1つずつ順に聞くと、混んでいる先に当たって
   * 打ち切りまで待ち、3回に2回は取れなかった（2026-10-01 実測。z.overpass は空を返し、overpass-api.de は返らないことがある）。
   * 打ち切りの返事（remark）は使わない。`usable(d)` が偽の返事（空など）も使わない。待つのは全体で timeoutMs まで。取れなければ null。
   *
   * **1台に同時1本**（技術構成「Overpass へ問い合わせるときの決まり」）。overpass-api.de は受付で、裏の z・lz4 へ振り分けるので、
   * z・lz4 と一緒に投げると裏の1台に2本届く。**同時に投げるときは受付を外す**。画面の中でも**問い合わせは1つずつ**（前のが終わってから。
   * 待つあいだに要らなくなったら `wanted()` が偽を返し、投げない）。2026-10-01 に受付と z・lz4 へ同時に投げる作りにして試験を重ね、
   * 翌日 overpass-api.de の3台ともこの回線からの接続を拒否していた（2026-09-30 の遮断と同じ症状）
   */
  let overpassBusy = null;
  async function overpassFirst(q, usable, { endpoint = OVERPASS, fetchImpl, timeoutMs, wanted = null }) {
    while (overpassBusy) await overpassBusy.catch(() => {});
    if (wanted && !wanted()) return null;
    const run = overpassAsk(q, usable, { endpoint, fetchImpl, timeoutMs });
    overpassBusy = run;
    try { return await run; } finally { if (overpassBusy === run) overpassBusy = null; }
  }
  async function overpassAsk(q, usable, { endpoint, fetchImpl, timeoutMs }) {
    const all = Array.isArray(endpoint) ? endpoint : [endpoint];
    const spread = all.filter((u) => !/^https:\/\/overpass-api\.de\//.test(u));
    const list = spread.length && spread.length < all.length ? spread : all;
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), timeoutMs);
    const ask = async (url) => {
      const res = await fetchImpl(url, {
        method: "POST", signal: ctrl ? ctrl.signal : undefined,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(q),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (!d || d.remark || !Array.isArray(d.elements) || !usable(d)) throw new Error("empty");
      return d;
    };
    try { return await Promise.any(list.map(ask)); }
    catch { return null; }
    finally { clearTimeout(timer); if (ctrl) ctrl.abort(); }
  }

  /**
   * 2点を結ぶ線に掛かる高い建物（OpenStreetMap。高さか階数を持つ minHeightM 以上のもの）。`[{ ring: [[緯度, 経度], …], heightM }]`。
   * 同梱の高い建物の一覧（首都圏）の外で、観測地点から目標が建物で隠れるかを確かめるのに使う（2026-10-02 ユーザー
   * 「その間が建物や地形的に観測地点から目標物がそもそも見えないことってあるよね」）。
   * **空の返事は、道路の数（out count）が入っているときだけ「高い建物は無い」とみなす**（壊れたミラーは何も入れずに返す）。取れなければ null。
   * 打ち切りは 25秒（urbanHorizon と同じ）。大阪の 1.5km の線で返事まで 17〜23秒かかった（2026-10-02 実測）
   */
  async function buildingsAlong(from, to, { widthM = 10, minHeightM = 20, endpoint = OVERPASS, fetchImpl = null, timeoutMs = 25000, wanted = null } = {}) {
    const f = fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!f) return null;
    const line = `around:${widthM},${from.latitude},${from.longitude},${to.latitude},${to.longitude}`;
    const q = `[out:json][timeout:25][maxsize:67108864];(`
      + `way["building"]["height"](${line});way["building"]["building:levels"](${line});`
      + `way["building:part"]["height"](${line});way["man_made"="tower"]["height"](${line});`
      + `);out tags geom;way["highway"](${line});out count;`;
    const roads = (d) => d.elements.some((e) => e.type === "count" && Number(e.tags && e.tags.ways) > 0);
    const d = await overpassFirst(q, (x) => roads(x) || x.elements.some((e) => e.type === "way"), { endpoint, fetchImpl: f, timeoutMs, wanted });
    if (!d) return null;
    const out = [];
    for (const el of d.elements) {
      if (el.type !== "way" || !Array.isArray(el.geometry) || el.geometry.length < 3) continue;
      const h = buildingHeightM(el.tags);
      if (h === null || h < minHeightM) continue;
      out.push({ ring: el.geometry.map((p) => [p.lat, p.lon]), heightM: h });
    }
    return out;
  }

  /**
   * その点に建つ建物（OpenStreetMap）の高さ。輪郭の中に点があるもの、無ければ輪郭が 25m 以内のいちばん近いもの。
   * 高さのタグが無ければ階数から見積もる（estimated: true）。見つからなければ null。
   * 他の目標を地図で置いたとき、建物の高さを自動で入れるのに使う（2026-10-01 ユーザー「建物の高さがわかるなら自動で入力がいいな」）。
   * **必ず打ち切る**（Overpass は返ってこないことがある）
   */
  async function buildingAt(lat, lon, { endpoint = OVERPASS, fetchImpl = null, timeoutMs = 12000 } = {}) {
    const f = fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!f) return null;
    // **輪郭から150mで引き、点が輪郭の中かで決める。** around は輪郭の線との距離なので、25m で引くと
    // 大きな建物（あべのハルカス）の真ん中に置いたとき、線が遠くて引けなかった（2026-10-01 実測）。
    // 大きな建物は relation（外側の輪郭が複数）で載っていることがあるので、それも引く
    const q = `[out:json][timeout:20][maxsize:33554432];(`
      + `way["building"](around:150,${lat},${lon});way["building:part"](around:150,${lat},${lon});`
      + `relation["building"](around:150,${lat},${lon});way["man_made"="tower"](around:150,${lat},${lon});`
      + `);out tags geom;`;
    const d = await overpassFirst(q, (x) => x.elements.length > 0, { endpoint, fetchImpl: f, timeoutMs });
    if (!d) return null;
    let best = null;
    for (const el of d.elements) {
      const h = buildingHeightM(el.tags);
      const qid = el.tags && el.tags.wikidata;
      // way は自分の輪郭、relation は外側の輪郭（複数あれば全部）
      const rings = el.type === "relation"
        ? (el.members || []).filter((m) => m.role === "outer" && Array.isArray(m.geometry)).map((m) => m.geometry)
        : [el.geometry];
      // 高さも階数も無くても、Wikidata の参照があれば候補にする（高さはあとで Wikidata から）
      if ((h === null && !qid) || !rings.length || rings.some((g) => !g || g.length < 3)) continue;
      const dist = rings.some((g) => containsPoint(g, lat, lon)) ? 0
        : Math.min(...rings.flat().map((pt) => distanceKm(lat, lon, pt.lat, pt.lon) * 1000));
      if (dist > 25) continue;
      if (!best || dist < best.distM || (dist === best.distM && (h ?? 0) > (best.heightM ?? 0))) {
        best = { heightM: h, distM: dist, estimated: !(parseFloat(el.tags.height) > 0), name: el.tags.name || "", wikidata: qid || null };
      }
    }
    // 高さのタグが無い（無いか、階数からの見積もりだけ）なら、Wikidata の高さを使う
    if (best && best.estimated && best.wikidata) {
      const wd = await wikidataHeight(best.wikidata, { fetchImpl });
      if (wd && wd.heightM) best = { ...best, heightM: wd.heightM, estimated: false, from: "wikidata" };
    }
    return best && best.heightM ? best : null;
  }

  /// タグから高さ[m]を出す。`height` が無ければ階数から見積もる
  function buildingHeightM(tags) {
    if (!tags) return null;
    const h = parseFloat(String(tags.height ?? "").replace("m", "").trim());
    if (Number.isFinite(h) && h > 0 && h < 700) return h;
    const lv = parseFloat(tags["building:levels"]);
    // 3.5m/階 ＋ 屋上構造物ぶん 2m。**推定値であることを呼び出し側へ返す**
    if (Number.isFinite(lv) && lv > 0 && lv < 200) return lv * 3.5 + 2;
    return null;
  }

  /**
   * 建物が作る地平線（月 §19 の `urban` 層）。
   *
   * **輪郭の頂点ごとに距離を取る。** 重心＋固定幅で近似すると、20m先の1棟が
   * 方位74度ぶんを塗りつぶす。最近傍距離の仰角を建物の方位幅すべてへ当てると、
   * 中央値55度というあり得ない地平線になる（2026-09-14、どちらも実際に踏んだ）。
   *
   * **限界（呼び出し側で利用者へ伝えること）:**
   * - OSM で高さを持つ建物は全体の13%（6地点4041棟の実測）。地域差が大きく
   *   再開発地区は50〜60%、地方都市と郊外は2%。**欠けているぶんは低く出る**
   * - 値そのものが誤っていることがある（東京都庁第一本庁舎は `height=133`、実際243.4m）
   * - **建物の地面の高さを観測者と同じとみなしている。** 斜面では誤差になる
   * - 欠落も誤りも「隠れにくい側」へ倒れるので、**この地平線は下限**
   */
  async function urbanHorizon(observer, {
    radiusM = [1000, 400], step = 1, endpoint = OVERPASS, fetchImpl = null, signal = null,
    timeoutMs = 25000,
  } = {}) {
    if (locationScope(observer) === "area") return null;
    // 半径も段階で試す。混んでいる時間帯は 1km が通らず 300m は 4秒で通る（実測）。
    // **近場だけでも入れたほうが、何も入らないよりずっと真値に近い**（建物は近いほど効く）。
    const radii = Array.isArray(radiusM) ? radiusM : [radiusM];
    if (radii.length > 1) {
      for (const r of radii) {
        const got = await urbanHorizon(observer,
          { radiusM: r, step, endpoint, fetchImpl, signal, timeoutMs });
        if (got) return got;
      }
      return null;
    }
    const R = radii[0];
    const f = fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!f) return null;
    const { latitude: lat, longitude: lon } = observer;
    const eyeAGL = Math.max(0, (observer.elevation ?? 0) - (observer.groundM ?? 0)) || 1.5;

    // **高さを持つものだけをサーバ側で絞る。** 絞らずに半径2kmを引くと Overpass が 504 を返す。
    // 実測（新宿中央公園・半径1km）: 4566件 / 転送 410KB（gzip）。
    //
    // **高さでさらに絞らない。** 転送量は減るが、住宅地の地平線が壊れる（2026-09-14 実測）。
    //
    // | 絞り | 新宿（高層街） | 世田谷（住宅地） |
    // |---|---|---|
    // | 12m超/4階以上 | 取りこぼし 0度・転送 146KB | **459/1440方位が低く出る・最大10.33度** |
    // | 20m超/6階以上 | 6方位・最大2.20度 | 1059/1440方位・最大19.60度 |
    //
    // 高層街では小さい建物が一度も地平線を取らないので絞っても変わらない。
    // 住宅地では2階建てが地平線そのもの。**新宿だけで測っていたら誤った判断をしていた。**
    // **使うメモリを小さく宣言する。** 既定の 512MB は混んでいるとき確保できず、504 で待たされる（2026-09-30）
    const q = `[out:json][timeout:120][maxsize:134217728];(`
      + `way["building"]["height"](around:${R},${lat},${lon});`
      + `way["building"]["building:levels"](around:${R},${lat},${lon});`
      + `way["man_made"="tower"]["height"](around:${R},${lat},${lon});`
      + `);out tags geom;`;

    const endpoints = Array.isArray(endpoint) ? endpoint : [endpoint];
    let data = null;
    for (const url of endpoints) {
      try {
        // **必ず打ち切る。** Overpass は 504 を返さず**そのまま返ってこない**ことがある
        // （2026-09-14、50秒待っても応答なし）。待ち続けると月の行が永久に出ない。
        const res = await f(url, {
          method: "POST",
          signal: signal || (typeof AbortSignal !== "undefined" && AbortSignal.timeout
            ? AbortSignal.timeout(timeoutMs) : undefined),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(q),
        });
        if (!res.ok) continue;                 // 504/429 は次のミラーへ
        const d = await res.json();
        // Overpass は打ち切っても 200 で返し、`remark` に理由を書く。**黙って使わない**
        if (!d || d.remark || !Array.isArray(d.elements)) continue;
        data = d; break;
      } catch { /* 次のミラーへ */ }
    }
    if (!data) return null;

    const N = Math.round(360 / step);
    // **建物の無い方位は −90（この層は何も言わない）。**
    //
    // 0 にしてはいけない。高い場所では地平線が 0度より下がる（東京タワー150mで −0.4度）。
    // 建物層に 0 を置くと `combinedHorizon` の max がそれを拾い、**下がった地平線を潰す**。
    //
    // ただし **この層だけで地平線を作ってはいけない。** −90 が大半を占めるので
    // 月が常に地平線の上と判定される。実際そうなり、芝公園の月の出が
    // 暦より 343分早い 2:38 と出た（2026-09-14）。
    // 必ず地形（取れなければ平らな 0）と重ねて使う。
    const prof = new Array(N).fill(-90);
    let used = 0, estimated = 0, tallest = null;

    for (const el of data.elements) {
      const h = buildingHeightM(el.tags);
      const g = el.geometry;
      if (h === null || !g || g.length < 3) continue;

      const pts = g.map((pt) => [bearing(lat, lon, pt.lat, pt.lon),
                                 distanceKm(lat, lon, pt.lat, pt.lon) * 1000]);
      // **自分が立っている建物は地平線にしない**（屋上や展望台は目の高さで表す）。
      // 頂点との距離だけで判定すると、大きな建物の中では壁が全周を囲む。
      // 富士市の代表点は富士市役所（37m）の輪郭の内側・頂点まで22mで、
      // 全周が 38〜53度に塞がり、14日とも月が出ないと判定された（2026-09-17）。
      //
      // **高い所に立つときは、輪郭の外側でも「その建物」のことがある。**
      // 座標は建物の中心とは限らない。スカイツリーの天望回廊（地上450m）で、
      // 輪郭まで29mのスカイツリー本体（634m）が方位0度を **81度** 塞いでいた
      // （2026-09-28 実測）。地上450mに立っていて29m先に634mの構造物があるなら、
      // それは自分が入っている建物。**目の高さに応じて近傍を広げる。**
      const near = Math.min(...pts.map((x) => x[1]));
      const ownStructure = near < Math.max(2, eyeAGL * 0.2) && h > eyeAGL;
      if (near < 2 || ownStructure || containsPoint(g, lat, lon)) continue;
      if (el.tags && el.tags.height === undefined) estimated++;
      used++;

      for (let i = 0; i < pts.length; i++) {
        const [b1, d1] = pts[i], [b2, d2] = pts[(i + 1) % pts.length];
        let db = ((b2 - b1 + 540) % 360) - 180;
        if (Math.abs(db) > 90) continue;      // 観測者を囲む異常な形
        const n = Math.max(1, Math.ceil(Math.abs(db) / step));
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const b = ((b1 + db * t) % 360 + 360) % 360;
          const d = d1 + (d2 - d1) * t;
          if (d < 2) continue;
          const a = Math.atan2(h - eyeAGL, d) / DEG;
          const idx = Math.round(b / step) % N;
          if (a > prof[idx]) {
            prof[idx] = a;
            if (!tallest || a > tallest.angleDeg) {
              tallest = { angleDeg: a, name: el.tags?.name || null,
                          heightM: h, distanceM: Math.round(d), azimuth: b };
            }
          }
        }
      }
    }
    if (!used) return null;
    const profile = prof.map((v, i) => ({ azimuth: i * step, horizonAngleDeg: v }));
    profile.meta = { buildings: used, estimatedHeights: estimated, radiusM: R, tallest };
    return profile;
  }

  /**
   * 地平線を**種類ごとに持って、重ねる**（月 §19）。
   *
   * 初期版で見るのは地形だけ。だが「建物で隠れている」と「山で隠れている」は
   * 利用者にとって別の話で、直し方も違う（前者は少し歩けば解決する）。
   * 後から建物を足せるよう、最初から分けておく。
   *
   *   terrain … DEM から測った地形
   *   urban   … 建物・鉄塔など（OpenStreetMap。具体的な観測地点で使用）
   *   user    … 利用者が現地で測って登録したもの（月 §20 UserHorizonProfile。**未実装**）
   */
  /// 平らな地平線のプロファイル。地形が測れなかったときの下敷きに使う
  function flatProfile(step = 1) {
    const out = [];
    for (let a = 0; a < 360; a += step) out.push({ azimuth: a, horizonAngleDeg: 0 });
    return out;
  }

  function combinedHorizon(layers) {
    const fns = Object.entries(layers)
      .filter(([, v]) => v && v.length)
      .map(([name, prof]) => [name, horizonFunction(prof)]);
    const f = (az) => {
      let best = -90, by = null;
      for (const [name, fn] of fns) { const v = fn(az); if (v > best) { best = v; by = name; } }
      return best;
    };
    f.detail = (az) => {
      const out = {};
      let best = -90, by = null;
      for (const [name, fn] of fns) { const v = fn(az); out[name] = v; if (v > best) { best = v; by = name; } }
      return { angleDeg: best, blockedBy: by, layers: out };
    };
    f.layers = Object.keys(layers).filter((k) => layers[k] && layers[k].length);
    return f;
  }

  /**
   * 測った地平線から「方位 → 高さ」の関数を作る。**間は線形で埋める。**
   * 月の方位は連続的に変わるので、測った方位に無い値も要る（月 §14）。
   */
  function horizonFunction(profile) {
    if (!profile || !profile.length) return () => 0;
    const pts = [...profile].sort((a, b) => a.azimuth - b.azimuth);
    return (az) => {
      const x = ((az % 360) + 360) % 360;
      let lo = pts[pts.length - 1], hi = pts[0];
      for (let i = 0; i < pts.length; i++) {
        if (pts[i].azimuth <= x) lo = pts[i];
        if (pts[i].azimuth >= x) { hi = pts[i]; break; }
      }
      if (lo === hi) return lo.horizonAngleDeg;
      let span = hi.azimuth - lo.azimuth; if (span < 0) span += 360;
      let off = x - lo.azimuth; if (off < 0) off += 360;
      if (span === 0) return lo.horizonAngleDeg;
      const t = off / span;
      return lo.horizonAngleDeg * (1 - t) + hi.horizonAngleDeg * t;
    };
  }

  /**
   * 対象へ向かう視線上の地形を取る（富士 §19「Terrain LOS」）。
   * 方位ひとつなので**密に取れる**。
   */
  async function profileToward(observer, target, opts = {}) {
    const az = bearing(observer.latitude, observer.longitude, target.latitude, target.longitude);
    const total = distanceKm(observer.latitude, observer.longitude, target.latitude, target.longitude);
    // 100点に収まる刻みにする（1リクエストで済ませる）
    const step = opts.step ?? Math.max(0.09, total / (MAX_POINTS - 1));
    const dists = stepsFor({ maxKm: total * 0.999, step });
    const pts = dists.map((d) => destination(observer.latitude, observer.longitude, az, d));
    const elevs = await elevations(pts, { ...opts, from: observer });
    return {
      azimuth: az,
      totalKm: total,
      stepKm: step,
      profile: dists.map((d, i) => ({ distanceKm: d, elevationM: elevs[i] }))
                    .filter((p) => p.elevationM !== null && p.elevationM !== undefined),
    };
  }

  // ---------------------------------------------------------------- 地名索引（2026-09-30）
  /*
   * 同梱の地名索引（data/place-index.json：山・峠・展望地・岬・滝。build-place-index.mjs で OSM から作る）を引く。
   * 国土地理院の住所検索と Nominatim は、住所まじりの語（「群馬県桐生市富士見町赤城山鳥居峠」）で
   * 峠そのものを返さなかった（2026-09-28 ユーザー指摘）。
   * **索引の名前が語の中に含まれる**ものも拾い、含まれる名前どうしが近ければ（赤城山と鳥居峠）
   * 並べて書かれた地名とみなして推す。語の終わりにある名前（いちばん細かい地名）をさらに推す。
   */
  const normName = (s) => String(s || "").normalize("NFKC").replace(/[\s　・,，、。]/g, "");
  const toHiragana = (s) => String(s || "").replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const openedIndex = new WeakMap();
  function openPlaceIndex(j) {
    let idx = openedIndex.get(j);
    if (idx) return idx;
    idx = { rows: (j.places || []).map((r) => ({
      kind: (j.kinds || {})[r[0]] || "", name: r[1], nameN: normName(r[1]), kana: r[2] || "",
      latitude: r[3] / 1e5, longitude: r[4] / 1e5, elevation: r[5] ?? null, muni: (j.munis || [])[r[6]] || "" })) };
    openedIndex.set(j, idx);
    return idx;
  }
  // 住所の頭（都道府県・市区郡・町村）。語の中の地名を探す前に外す。「…富士見町赤城山」の「富士見」を地名として拾わない
  const ADMIN_HEAD = /^(?:東京都|北海道|京都府|大阪府|[^\s]{2,3}?県)?(?:[^都道府県市区町村郡]{1,5}?[市郡])?(?:[^都道府県市区町村郡]{1,5}?区)?(?:[^都道府県市区町村郡]{1,5}?[町村])?/;
  // 表記ゆれ（那智の滝／那智滝、竜ヶ岳／竜ケ岳／竜が岳）
  const loose = (s) => s.replace(/[のノヶケが之ッ]/g, "");
  function searchPlaceIndex(index, query, { near = null, limit = 8 } = {}) {
    const q = normName(query);
    if (q.length < 2 || !index) return [];
    const qh = toHiragana(q);
    let core = q.replace(ADMIN_HEAD, "");
    if (core.length < 2) core = q;
    const coreL = loose(core);
    const idx = openPlaceIndex(index);
    const hits = [];
    for (const r of idx.rows) {
      let s = 0, inQuery = false;
      if (r.nameN === q || r.nameN === core) s = 100;
      else if (r.kana && r.kana === qh) s = 95;
      else if (coreL.length >= 2 && loose(r.nameN) === coreL) s = 92;
      else if (r.nameN.startsWith(core)) s = 85;
      else if (r.kana && qh.length >= 2 && r.kana.startsWith(qh)) s = 75;
      else if (r.nameN.includes(core)) s = 70;
      else if (r.nameN.length >= 2 && core.includes(r.nameN)) { s = 30 + 6 * Math.min(6, r.nameN.length); inQuery = true; }
      if (!s) continue;
      // 市区町村・都道府県が語に書いてあれば、その中のものを推す
      if (r.muni) {
        const m = r.muni.match(/^(.+?[都道府県])(.*)$/);
        if (q.includes(r.muni)) s += 25;
        else if (m && m[2] && q.includes(m[2])) s += 20;
        else if (m && q.includes(m[1])) s += 8;
      }
      if (inQuery && core.endsWith(r.nameN)) s += 10;
      hits.push({ r, s, inQuery });
    }
    // **長い地名の一部になっている短い名前は捨てる**（「赤城山」の中の「城山」で全国の城山が並んだ）
    const inQNames = [...new Set(hits.filter((h) => h.inQuery).map((h) => h.r.nameN))];
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (h.inQuery && inQNames.some((n) => n.length > h.r.nameN.length && n.includes(h.r.nameN))) hits.splice(i, 1);
    }
    const inQ = hits.filter((h) => h.inQuery);
    const kept = [...new Set(inQ.map((h) => h.r.nameN))];
    if (inQ.length && inQ.length < 600) {
      for (const h of inQ) {
        // 語に含まれる名前どうしが 5km 以内なら、並べて書かれた地名（「赤城山鳥居峠」）
        if (inQ.some((o) => o !== h && o.r.nameN !== h.r.nameN
          && distanceKm(o.r.latitude, o.r.longitude, h.r.latitude, h.r.longitude) < 5)) h.s += 25;
        // **前に書かれた地名の近くに無い同名は下げる**（赤城の鳥居峠が無いとき、嬬恋村の鳥居峠を1位にしない）
        const before = inQ.filter((o) => o.r.nameN !== h.r.nameN && !o.r.nameN.includes(h.r.nameN)
          && core.indexOf(o.r.nameN) >= 0 && core.indexOf(o.r.nameN) < core.indexOf(h.r.nameN));
        if (before.length && !before.some((o) => distanceKm(o.r.latitude, o.r.longitude, h.r.latitude, h.r.longitude) < 10)) h.s -= 25;
        // **語の残りが説明できない一致は弱い当たり**（「摩周湖第一展望台」の「第一展望台」で全国の第一展望台を先に出さない）
        let rest = core;
        for (const n of kept) rest = rest.split(n).join("");
        // その地点の市区町村名（「屋久島町」の「屋久島」）が書いてあれば、それも説明できる残り
        const city = (h.r.muni.match(/^.+?[都道府県](.*)$/) || [])[1] || "";
        const stem = city.replace(/[市区町村]$/, "").replace(/^.+郡/, "");
        if (stem.length >= 2) rest = rest.split(stem).join("");
        if (rest.length >= 2) h.s = Math.min(h.s, 55);
      }
    }
    // 同点なら近い順。**ただし標高の高い山を少し先に**（標高20mで1km近い扱い）。
    // 「高尾山」で町田市の丘（100m）より八王子の高尾山（599m）を先に出す
    const away = (r) => (near ? distanceKm(near.latitude, near.longitude, r.latitude, r.longitude) : 0)
      - (Number.isFinite(r.elevation) ? r.elevation / 20 : 0);
    hits.sort((a, b) => b.s - a.s || away(a.r) - away(b.r));
    return hits.slice(0, limit).map(({ r, s }) => ({
      name: r.name, kind: r.kind, muni: r.muni, latitude: r.latitude, longitude: r.longitude,
      elevation: r.elevation, score: s }));
  }

  // ---------------------------------------------------------------- 水の上か（2026-10-01）
  //
  // **観測地点を水の上に置かない**（ユーザー「観測地点は陸上に」「他の観測地点も水の上にならないように」）。
  // ISS の中心線のいちばん近い点が海の上に出ていて、川岸の候補地は川の中心線の上に立たせていた。
  //
  // **標高タイルでは見分けられない。** 海は「標高なし」になるが、湖・池・川の水面には標高が入っている
  // （霞ヶ浦 0.2m・琵琶湖 84.6m・荒川 −0.6m。5m メッシュでも井の頭池や川に値がある。2026-10-01 実測）。
  // 国土地理院の最適化ベクトルタイルの「水域」（WA 層）を使う。海・湖・池・川の水面が面で入っている
  // （同日実測: 東京湾・琵琶湖・霞ヶ浦・河口湖・不忍池・井の頭池が水、川岸候補の中心線の点は14中12が水。
  // 残り2つは河川敷の乾いた所）。z16 で1枚 約600m 四方・20KB 前後。
  // **タイルの無い升目（404）は外洋**（陸のある升目には必ず道や建物が入る）。
  const WATER_TILE = "https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1";
  const WATER_Z = 16;
  const waterTiles = new Map();

  /// MVT（Mapbox Vector Tile）から「水域」の面だけを読む。依存を持たないので、要るところだけ手で解く。
  /// `codeKey` を渡すと、面ごとのその属性（数）も `codes` に返す（建物の種別 vt_code。2026-10-06）
  function decodeWaterLayer(u8, layerName = "WA", codeKey = null) {
    let p = 0;
    const varint = () => { let r = 0, s = 0, b; do { b = u8[p++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; };
    const skip = (w) => { if (w === 0) varint(); else if (w === 1) p += 8; else if (w === 2) { const l = varint(); p += l; } else if (w === 5) p += 4; };
    const zz = (n) => (n >>> 1) ^ -(n & 1);
    while (p < u8.length) {
      const tag = varint();
      if ((tag >> 3) !== 3 || (tag & 7) !== 2) { skip(tag & 7); continue; }
      const layerEnd = varint() + p;
      let name = "", extent = 4096;
      const polys = [], tagsOf = [], keys = [], values = [];
      while (p < layerEnd) {
        const t = varint(), f = t >> 3, w = t & 7;
        if (f === 1 && w === 2) { const l = varint(); name = new TextDecoder().decode(u8.subarray(p, p + l)); p += l; }
        else if (f === 5 && w === 0) extent = varint();
        else if (codeKey && f === 3 && w === 2) { const l = varint(); keys.push(new TextDecoder().decode(u8.subarray(p, p + l))); p += l; }
        else if (codeKey && f === 4 && w === 2) {
          // 値は整数（uint/sint/int）だけ読む。種別コードは整数
          const end = varint() + p;
          let v = null;
          while (p < end) { const vt = varint(), vf = vt >> 3; if (vf === 4 || vf === 5) v = varint(); else if (vf === 6) v = zz(varint()); else skip(vt & 7); }
          values.push(v);
        }
        else if (f === 2 && w === 2) {
          const featEnd = varint() + p;
          let type = 0;
          const geom = [], tags = [];
          while (p < featEnd) {
            const ft = varint(), ff = ft >> 3, fw = ft & 7;
            if (ff === 3 && fw === 0) type = varint();
            else if (ff === 4 && fw === 2) { const end = varint() + p; while (p < end) geom.push(varint()); }
            else if (codeKey && ff === 2 && fw === 2) { const end = varint() + p; while (p < end) tags.push(varint()); }
            else skip(fw);
          }
          if (type !== 3) continue;          // 面だけ
          const rings = [];
          let x = 0, y = 0, cur = null;
          for (let i = 0; i < geom.length;) {
            const c = geom[i++], id = c & 7, n = c >> 3;
            if (id === 7) { if (cur) rings.push(cur); cur = null; continue; }
            for (let k = 0; k < n; k++) {
              x += zz(geom[i++]); y += zz(geom[i++]);
              if (id === 1) { if (cur) rings.push(cur); cur = [[x, y]]; } else if (cur) cur.push([x, y]);
            }
          }
          if (cur) rings.push(cur);
          polys.push(rings);
          tagsOf.push(tags);
        } else skip(w);
      }
      p = layerEnd;
      if (name === layerName) {
        if (!codeKey) return { extent, polys };
        // 層の中で keys・values は地物より後に来ることがあるので、層を読み終えてから引く
        const ki = keys.indexOf(codeKey);
        const codes = tagsOf.map((tags) => { for (let i = 0; i < tags.length; i += 2) if (tags[i] === ki) return values[tags[i + 1]] ?? null; return null; });
        return { extent, polys, codes };
      }
    }
    return { extent: 4096, polys: [], codes: [] };   // その層の無い升目
  }

  /// 面の中か（穴は外側の輪と逆回りなので、輪をまとめて偶奇で数えれば穴も効く）
  function inWaterLayer(layer, px, py) {
    for (const rings of layer.polys) {
      let inside = false;
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i], [xj, yj] = ring[j];
          if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
        }
      }
      if (inside) return true;
    }
    return false;
  }

  function loadWaterTile(x, y, fetchImpl) {
    const key = `${x}/${y}`;
    if (waterTiles.has(key)) return waterTiles.get(key);
    const p = (async () => {
      try {
        const res = await fetchImpl(`${WATER_TILE}/${WATER_Z}/${x}/${y}.pbf`);
        if (res.status === 404) return "sea";
        if (!res.ok) return null;
        return decodeWaterLayer(new Uint8Array(await res.arrayBuffer()));
      } catch { return null; }
    })();
    waterTiles.set(key, p);
    // 取れなかった升目は憶えない（次に呼ばれたときに取り直す）
    p.then((v) => { if (v === null) waterTiles.delete(key); });
    return p;
  }

  // ---------------------------------------------------------------- 近くの建物（2026-10-06）
  //
  // 候補地の見通しに、**立つ点の近くの普通の建物**を入れる。同梱の高い建物（7階以上・20m以上）と OpenStreetMap の高さ付きの建物だけでは、
  // 新四谷見附橋から東京スカイツリー（月の高さ4.5°）の線が 90m 先から高さタグの無い建物6棟に掛かっていたのに、候補に出ていた（ユーザー報告）。
  // 国土地理院の最適化ベクトルタイルの建物（BldA 層）は全国にあり、種別がある（地図記号の定義。国土地理院「地図記号」）:
  //   3101 普通建物 … 3階未満（木造は3階以上も）  3102 堅ろう建物 … 非木造で地上3階相当以上・60m未満  3103 高層建物 … 60m以上
  //   3111・3112 無壁舎（屋根だけ。駐輪場・ホームの屋根など）は入れない
  // 高さは入っていないので、**種別の下限**を使う（低めに見積もる＝隠れると言い過ぎない）。普通建物は平屋の屋根まで（約6m）、
  // 堅ろう建物は3階（約10m）、高層建物は60m。z16 で1枚 約600m 四方・50KB 前後（水域と同じタイル）
  const GSI_BUILDING_MIN_M = { 3101: 6, 3102: 10, 3103: 60 };
  const buildingTiles = new Map();
  function loadBuildingTile(x, y, fetchImpl) {
    const key = `${x}/${y}`;
    if (buildingTiles.has(key)) return buildingTiles.get(key);
    const p = (async () => {
      try {
        const res = await fetchImpl(`${WATER_TILE}/${WATER_Z}/${x}/${y}.pbf`);
        if (res.status === 404) return { extent: 4096, polys: [], codes: [] };   // 外洋の升目
        if (!res.ok) return null;
        return decodeWaterLayer(new Uint8Array(await res.arrayBuffer()), "BldA", "vt_code");
      } catch { return null; }
    })();
    buildingTiles.set(key, p);
    p.then((v) => { if (v === null) buildingTiles.delete(key); });
    // 手元に持つのは200枚まで（候補地24か所で2〜3枚ずつ）
    if (buildingTiles.size > 200) buildingTiles.delete(buildingTiles.keys().next().value);
    return p;
  }

  /**
   * `from` から `to` への線分が通る建物（国土地理院の建物）。線が最初に入る距離 `entryM` と、その点 `entry`、種別の下限の高さ `minHeightM`。
   * **立つ点を含む建物は入れない**（展望台・駅の上などは、目の高さで表す。月の地平線の建物と同じ決まり）。
   * タイルが1枚でも取れなければ null（呼び手は「確かめられなかった」として、隠れると決めない）
   */
  async function gsiBuildingsAlong(from, to, { fetchImpl = (typeof fetch === "function" ? (u) => fetch(u, { mode: "cors", signal: global.AbortSignal?.timeout(8000) }) : null) } = {}) {
    if (!fetchImpl || !inJapan(from.latitude, from.longitude)) return null;
    const totalM = distanceKm(from.latitude, from.longitude, to.latitude, to.longitude) * 1000;
    const brg = bearing(from.latitude, from.longitude, to.latitude, to.longitude) * Math.PI / 180;
    const cosLat = Math.cos(from.latitude * Math.PI / 180), ux = Math.sin(brg), uy = Math.cos(brg);
    const xy = (la, lo) => [(lo - from.longitude) * 111320 * cosLat, (la - from.latitude) * 110540];
    // 線が通る升目（50m おきに拾う。升目は約600m）
    const keys = new Set();
    for (let d = 0; d <= totalM + 50; d += 50) {
      const pt = destination(from.latitude, from.longitude, brg * 180 / Math.PI, Math.min(d, totalM) / 1000);
      keys.add(`${Math.floor(tileXf(pt.longitude, WATER_Z))}/${Math.floor(tileYf(pt.latitude, WATER_Z))}`);
    }
    const tiles = await Promise.all([...keys].map((k) => { const [x, y] = k.split("/").map(Number); return loadBuildingTile(x, y, fetchImpl).then((t) => [x, y, t]); }));
    if (tiles.some(([, , t]) => t === null)) return null;
    const n = 2 ** WATER_Z, out = [];
    for (const [tx, ty, tile] of tiles) {
      tile.polys.forEach((rings, i) => {
        const minHeightM = GSI_BUILDING_MIN_M[tile.codes[i]];
        if (!minHeightM) return;
        const ring = rings[0].map(([px, py]) => {
          const fx = (tx + px / tile.extent) / n, fy = (ty + py / tile.extent) / n;
          return [Math.atan(Math.sinh(Math.PI * (1 - 2 * fy))) * 180 / Math.PI, fx * 360 - 180];
        });
        const pts = ring.map(([la, lo]) => xy(la, lo));
        let entry = null, inside = false;
        for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
          const [x1, y1] = pts[b], [x2, y2] = pts[a];
          if ((y1 > 0) !== (y2 > 0) && 0 < (x2 - x1) * (0 - y1) / (y2 - y1) + x1) inside = !inside;
          const ex = x2 - x1, ey = y2 - y1, den = ux * ey - uy * ex;
          if (Math.abs(den) < 1e-9) continue;
          const t = (x1 * ey - y1 * ex) / den, u = (x1 * uy - y1 * ux) / den;
          if (u < 0 || u > 1 || t < 0 || t > totalM) continue;
          if (entry === null || t < entry) entry = t;
        }
        if (inside || entry === null) return;
        out.push({ ring, code: tile.codes[i], minHeightM, entryM: entry,
          entry: destination(from.latitude, from.longitude, brg * 180 / Math.PI, entry / 1000) });
      });
    }
    // 升目の境で1棟が2つに分かれていることがある。近い方の入口だけ使えば足りる（判定は最も高く見える1棟で決まる）
    return out.sort((a, b) => a.entryM - b.entryM);
  }

  /**
   * 点ごとに水の上か。true＝水（海・湖・池・川）、false＝陸、null＝分からない（日本の外・通信の失敗）。
   * 呼び手は null を「確かめられなかった」として扱う（陸と決めつけない）。
   */
  async function waterAt(points, { fetchImpl = (typeof fetch === "function" ? (u) => fetch(u, { mode: "cors", signal: global.AbortSignal?.timeout(8000) }) : null),
                                   useDem = typeof document !== "undefined" } = {}) {
    if (!fetchImpl) return points.map(() => null);
    return Promise.all(points.map(async (pt) => {
      if (!inJapan(pt.latitude, pt.longitude)) return null;
      // 標高タイル（z11・約20km 四方）が丸ごと無い升目は外洋。水域タイルを取りに行かない
      // （外洋の水域タイルも 404 で、ISS の帯が太平洋を通る回に1点ずつ 404 が並んでいた。2026-10-01）
      if (useDem) {
        const dx = Math.floor(tileXf(pt.longitude, 11)), dy = Math.floor(tileYf(pt.latitude, 11));
        await loadTile(11, dx, dy);
        if (demMissing.has(`11/${dx}/${dy}`)) return true;
      }
      const fx = tileXf(pt.longitude, WATER_Z), fy = tileYf(pt.latitude, WATER_Z);
      const tile = await loadWaterTile(Math.floor(fx), Math.floor(fy), fetchImpl);
      if (tile === null) return null;
      if (tile === "sea") return true;
      return inWaterLayer(tile, (fx % 1) * tile.extent, (fy % 1) * tile.extent);
    }));
  }

  const SoramiTerrain = {
    MAX_POINTS, DEFAULT_STEPS, OBSERVATION_DECKS, decksFor, deckLabel, structureHeight, isLookout,
    destination, bearing, distanceKm, inverse,
    fetchElevations, elevations, elevationFromTile, groundElevation, inJapan, resolveObserver,
    measureHorizon, horizonFunction, combinedHorizon,
    urbanHorizon, buildingHeightM, buildingAt, buildingsAlong, gsiBuildingsAlong, GSI_BUILDING_MIN_M, wikidataHeight, OVERPASS, flatProfile, locationScope, searchLocationScope, gsiLocationScope, parseLatLon, parseMapLink, isShortMapLink, urbanCacheKey,
    profileToward, stepsFor, EYE_HEIGHT_PRESETS, searchPlaceIndex, normName,
    waterAt, decodeWaterLayer,
  };
  global.SoramiTerrain = SoramiTerrain;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiTerrain;
})(typeof globalThis !== "undefined" ? globalThis : window);
