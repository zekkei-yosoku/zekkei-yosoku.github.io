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

  /// 方位と距離から緯度経度を出す（大円）
  function destination(lat, lon, bearingDeg, distanceKm) {
    const ang = distanceKm / EARTH_KM, b = bearingDeg * DEG;
    const p1 = lat * DEG, l1 = lon * DEG;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(ang) + Math.cos(p1) * Math.sin(ang) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(ang) * Math.cos(p1),
                               Math.cos(ang) - Math.sin(p1) * Math.sin(p2));
    let lo = (l2 / DEG) % 360; if (lo > 180) lo -= 360; if (lo < -180) lo += 360;
    return { latitude: p2 / DEG, longitude: lo };
  }

  /// 2点間の方位角（北から東回り）
  function bearing(aLat, aLon, bLat, bLon) {
    const p1 = aLat * DEG, p2 = bLat * DEG, dl = (bLon - aLon) * DEG;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return ((Math.atan2(y, x) / DEG) % 360 + 360) % 360;
  }

  /// 大円距離
  function distanceKm(aLat, aLon, bLat, bLon) {
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

  const tiles = new Map();
  /// タイルを1枚読む。**同じタイルは二度取りに行かない。**
  function loadTile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (tiles.has(key)) return tiles.get(key);
    const p = new Promise((resolve) => {
      if (typeof Image === "undefined" || typeof document === "undefined") { resolve(null); return; }
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = img.width; c.height = img.height;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          resolve(ctx.getImageData(0, 0, img.width, img.height));
        } catch { resolve(null); }        // 汚染された canvas 等。**落とさない**
      };
      img.onerror = () => resolve(null);  // 海など、タイルの無い区画は 404
      img.src = `${GSI_TILE}/${z}/${x}/${y}.png`;
    });
    tiles.set(key, p);
    return p;
  }

  /// 標高タイルから1点。タイル自体が取れなければ undefined、「標高なし」画素なら null
  async function sampleTile(lat, lon, z) {
    if (!inJapan(lat, lon)) return undefined;
    const fx = tileXf(lon, z), fy = tileYf(lat, z);
    const img = await loadTile(z, Math.floor(fx), Math.floor(fy));
    if (!img) return undefined;
    const px = Math.min(img.width - 1, Math.floor((fx % 1) * img.width));
    const py = Math.min(img.height - 1, Math.floor((fy % 1) * img.height));
    const i = (py * img.width + px) * 4;
    return pixelToElevation(img.data[i], img.data[i + 1], img.data[i + 2]);
  }

  /// 標高タイルから1点。取れなければ null（呼び手が Open-Meteo へ落とす）
  async function elevationFromTile(lat, lon, z = 11) {
    const v = await sampleTile(lat, lon, z);
    return v === undefined ? null : v;
  }

  /**
   * 標高をまとめて引く。**日本国内なら標高タイル、外なら Open-Meteo。**
   * タイルは1枚65536点ぶんなので、まとまった範囲を見るときに桁違いに速い。
   */
  async function elevations(points, opts = {}) {
    if (!points.length) return [];
    if (points.every((p) => inJapan(p.latitude, p.longitude)) && typeof Image !== "undefined") {
      const raw = await Promise.all(points.map((p) => sampleTile(p.latitude, p.longitude, opts.zoom ?? 11)));
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
    const elevs = await elevations(points, opts);

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
  const OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
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
    const q = `[out:json][timeout:120];(`
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
      if (Math.min(...pts.map((x) => x[1])) < 2 || containsPoint(g, lat, lon)) continue;
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
    const elevs = await elevations(pts, opts);
    return {
      azimuth: az,
      totalKm: total,
      stepKm: step,
      profile: dists.map((d, i) => ({ distanceKm: d, elevationM: elevs[i] }))
                    .filter((p) => p.elevationM !== null && p.elevationM !== undefined),
    };
  }

  const SoramiTerrain = {
    MAX_POINTS, DEFAULT_STEPS,
    destination, bearing, distanceKm,
    fetchElevations, elevations, elevationFromTile, inJapan, resolveObserver,
    measureHorizon, horizonFunction, combinedHorizon,
    urbanHorizon, buildingHeightM, OVERPASS, flatProfile, locationScope, searchLocationScope, urbanCacheKey,
    profileToward, stepsFor, EYE_HEIGHT_PRESETS,
  };
  global.SoramiTerrain = SoramiTerrain;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiTerrain;
})(typeof globalThis !== "undefined" ? globalThis : window);
