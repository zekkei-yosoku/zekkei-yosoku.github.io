import {$,esc} from '../app/presentation-helpers.js';
import {favorites,place} from '../app/browser-state.js';
import {bundle} from '../features/forecast/load.js';
import {currentView,groundAt} from '../features/forecast/view.js';
import {PLACE_PICKERS,choosePlace,clearFavMapReturn,favDraft,favMapReturn,openFavSheet,renderSheet,selectPlace} from '../features/places/controller.js';
import {MapPick} from '../ui/map/picker.js';
import {aimSetFrom} from '../features/framing/observer.js';
import {aimRenderSheetCands} from '../features/framing/candidates.js';
import {API,auth} from '../features/account/session-and-access.js';
import {showSheet} from '../app/overlays.js';
import {recentHistory} from '../features/framing/presentation.js';
let placeSheetFor = null;
let favUndo = [];      // 消したものを戻すための控え。地点シートを閉じるまで持つ。
/// 都道府県（JIS X 0401 の番号順。ISO 3166-2:JP の JP-01〜JP-47 と同じ）
const JP_PREFECTURES = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県",
  "新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県",
  "鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"];
/// 地図で選んだ点の名前（近くの地名）と住所（都道府県＋市区町村）。取れなければ座標を名前にする
async function nearName(lat, lon, { signal } = {}) {
  let name = `${lat.toFixed(4)}, ${lon.toFixed(4)}`, area = "";
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=ja`
      + `&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`;
    const r = await fetch(url, { signal, headers: { accept: "application/json" } });
    if (r.ok) {
      const a = (await r.json()).address || {};
      // 施設・公園・山などの名前 → 町名（丁目・字）→ 道路の順。道路名（「市川柏線」）は場所の名前として分かりにくい
      const near = a.tourism || a.leisure || a.natural || a.building
        || a.quarter || a.neighbourhood || a.hamlet || a.suburb || a.village || a.town || a.road || a.city;
      if (near) name = String(near).slice(0, 24);
      // 東京都の区などは都道府県が入らない返事があるので、ISO 3166-2（JP-13 など）から補う（2026-10-21、現在地で「墨田区」だけになった）
      const iso = /^JP-(\d\d)$/.exec(a["ISO3166-2-lvl4"] || "");
      const pref = a.province || a.state || (iso ? JP_PREFECTURES[Number(iso[1]) - 1] : "") || "";
      area = [pref, a.city || a.town || a.village || ""].join("");
    }
  } catch { /* 名前が取れなくても座標で進める */ }
  return { name, area };
}

/// 緯度経度の点を地点にする（地図の「この場所にする」と、検索欄に緯度経度を入れたとき）。
/// 標高はその場所の値を読む（**地点検索の代表点と違い、ここが効く**）。取れなければ標高なしで進める。
/// 名前は近くの地名を当てる。取れなければ座標そのものを名前にする。
async function selectPointAt(lat, lon, subtitle, options = {}) {
  const elevation = await groundAt(lat, lon);
  const { name } = await nearName(lat, lon);
  if (options.isCurrent && !options.isCurrent()) return;
  choosePlace({ id: `map:${lat.toFixed(5)},${lon.toFixed(5)}`,
    name, subtitle, latitude: lat, longitude: lon,
    elevation: elevation === null || elevation === undefined ? null : Math.round(elevation * 10) / 10,
    // **点は代表点ではない。** ダイヤモンド富士や建物の地平線が出せる
    locationScope: "point" }, options);
}

let mapPickRequest = 0;
$("mapSheet").addEventListener("close", () => { mapPickRequest++; $("mapPick").disabled = false; $("mapPick").textContent = "この場所にする"; });
$("mapPick").onclick = async () => {
  const request = ++mapPickRequest, owner = auth?.token, mode = placeSheetFor;
  const c = MapPick.center();
  $("mapPick").disabled = true;
  $("mapPick").textContent = "標高を読んでいます…";
  if (favMapReturn && favDraft) {
    const draft = favDraft, origin = draft.origin;
    const [elevation, nearby] = await Promise.all([groundAt(c.latitude, c.longitude), nearName(c.latitude, c.longitude)]);
    if (request !== mapPickRequest || !$("mapSheet").open || owner !== auth?.token || !favMapReturn || favDraft !== draft || draft.ownerToken !== owner) return;
    favDraft.latitude = c.latitude;
    favDraft.longitude = c.longitude;
    favDraft.subtitle = nearby.area || "地図で選んだ地点";
    favDraft.elevation = elevation == null ? null : Math.round(elevation * 10) / 10;
    favDraft.locationScope = "point";
    $("mapSheet").close();
    clearFavMapReturn();
    $("mapPick").disabled = false;
    $("mapPick").textContent = "この場所にする";
    openFavSheet(favDraft.index, { point: favDraft, replacePoint: true, after: favDraft.after,
      target: favDraft.targetHeightM });
    favDraft.origin = origin;
    return;
  }
  const keepSheet = $("placeSheet").open && !!(placeSheetFor && PLACE_PICKERS[placeSheetFor]);
  await selectPointAt(c.latitude, c.longitude, "地図で選んだ地点", { keepSheet, isCurrent: () => request === mapPickRequest && $("mapSheet").open && owner === auth?.token && mode === placeSheetFor });
  if (request !== mapPickRequest) return;
  $("mapSheet").close();
  $("mapPick").disabled = false;
  $("mapPick").textContent = "この場所にする";
};

/// 地点の画面を開く。mode は placeSheetFor（null＝AstroNotesの地点、"aim"＝ねらうの観測地点）
function refreshPlacePickerActions(picker) {
  const back = !!(picker && picker.custom() && Number.isFinite(place.latitude));
  // 選択を外す（構図・地図の撮影地点。resetLabel がある）は、対象を選ぶと同じく見出しの右の「解除」（2026-10-21 ユーザー
  // 「この解除も撮影地点のなかの右上が自然じゃない？」）。予測の地点へ戻す（人工衛星・月丼・ホーム）は本文の行のまま
  const clearable = !!(picker && picker.resetLabel && picker.custom());
  $("placeHeadActions").hidden = !clearable;
  $("sheetInherit").hidden = !back || clearable;
  if (back) $("sheetInherit").textContent = picker.resetLabel || `📍 AstroNotesの地点（${place.name}）にする`;
}
function openPlaceSheet(mode = null, { focusSearch = false } = {}) {
  placeSheetFor = mode;$("geoStatus").textContent = "";window.MyPlacesUI?.resetShapePicker?.();
  const picker = mode && PLACE_PICKERS[mode];
  $("placeSheetTitle").textContent = picker ? picker.title : "地点";
  refreshPlacePickerActions(picker);
  $("favNotice").textContent = "";
  for (const el of document.querySelectorAll(".save-err")) el.hidden = true;
  renderSheet();
  aimRenderSheetCands();
  try { recentHistory.open(); } catch { /* Keep the existing location picker available. */ }
  showSheet($("placeSheet"));
  // お気に入りを選べるよう、通常はシートへ焦点を置いたままにする。
  // 検索は入力欄をタップして始める。明示的な検索専用入口だけfocusSearchで指定できる。
  if (focusSearch) { $("searchBox").focus(); $("searchBox").select(); }
}
$("placeButton").onclick = () => openPlaceSheet(null);
$("aimFromButton").onclick = () => openPlaceSheet("aim");
$("aimFromClear").onclick = () => {aimSetFrom(null);$("aimFromButton").focus();};
$("aimTargetButton").onclick = () => openPlaceSheet("aimTarget");
$("sheetInherit").onclick = () => {
  const picker = placeSheetFor && PLACE_PICKERS[placeSheetFor];   // 閉じる前に（閉じると戻る）
  $("placeSheet").close();
  if (picker && picker.reset) picker.reset();
};
$("placeClose").onclick = () => $("placeSheet").close();
$("placeClear").onclick = () => $("sheetInherit").click();
// 取り消しはシートを開いている間だけ持つ。閉じたら確定させる（次に開いたときに
// 前回消したものの「元に戻す」が残っていると、何を消したのか分からなくなる）。
let geoRequest = 0;
$("placeSheet").addEventListener("close", () => {
  geoRequest++;
  favUndo = [];
  // 次に地点カードから開いたときに、ねらうの観測地点を決めてしまわないよう戻す
  placeSheetFor = null;
  $("placeSheetTitle").textContent = "地点";
  $("sheetInherit").hidden = true; $("placeHeadActions").hidden = true;
});
$("geoButton").onclick = () => {
  const request = ++geoRequest;
  $("geoStatus").textContent = "";
  if (!navigator.geolocation) {
    $("geoStatus").textContent = "このブラウザでは現在地を取得できません。地点を検索するか、地図から選んでください";
    return;
  }
  navigator.geolocation.getCurrentPosition(
    // 座標で識別し、閉じたシートや後から選んだ地点を遅い応答で変更しない。
    async (pos) => {
      if (request !== geoRequest || !$("placeSheet").open) return;
      // 住所も出す（2026-10-21 ユーザー「現在地を押した時に標高だけしか出てない。他の地点みたいに取得できた住所も」）。
      // 地図で選んだ点と同じく近くの住所（都道府県＋市区町村）。取れなければ空のまま進める
      $("geoStatus").textContent = "現在地の住所を調べています…";
      let area = "";
      try { area = (await nearName(pos.coords.latitude, pos.coords.longitude)).area || ""; } catch { area = ""; }
      if (request !== geoRequest || !$("placeSheet").open) return;
      $("geoStatus").textContent = "";
      choosePlace({ id: `geo:${pos.coords.latitude.toFixed(4)},${pos.coords.longitude.toFixed(4)}`,
        name: "現在地", subtitle: area, latitude: pos.coords.latitude, longitude: pos.coords.longitude, terrain: null, elevation: null });
    },
    (error) => {
      if (request !== geoRequest || !$("placeSheet").open) return;
      $("geoStatus").textContent = error.code === 1
        ? "位置情報が許可されていません。端末とブラウザの位置情報の許可を確認してください"
        : error.code === 3 ? "現在地の取得に時間がかかっています。もう一度試すか、地点を検索してください"
        : "現在地を取得できませんでした。端末の位置情報の設定を確認するか、地点を検索してください";
    },
    { timeout: 10000 });
};
/// 同梱の地名索引（山・峠・展望地・岬・滝。data/place-index.json）。初めて検索したときに1回だけ読む
let placeIndexPromise = null;
function placeIndex() {
  if (!placeIndexPromise) {
    placeIndexPromise = fetch("data/place-index.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .catch((e) => { placeIndexPromise = null; throw e; });
  }
  return placeIndexPromise;
}

/// 地名・施設名を引く。**地点シートと地図の両方から使う。**
/// 国土地理院の地名検索（日本の公式データ。施設名に強い）と Nominatim（OSM。店・観光地）を
/// 両方引いて混ぜる。「練馬区役所」でOSMは本庁を返さず分館を上位に出す（2026-09-24 実測）。
/// **山・峠・展望地は同梱の索引から引く**（2026-09-30）。住所の検索は「群馬県桐生市」までしか返さず、
/// 「赤城山鳥居峠」のような地名が出なかった（ユーザー指摘）
// 検索元に未収録の施設と、利用者が名前を付けたお気に入りも検索する。
let searchSupplementPromise = null;
function searchSupplement() {
  if (!searchSupplementPromise) searchSupplementPromise = fetch("data/search-supplement.json?v=20261019-address-1")
    .then(r => { if (!r.ok) throw new Error("補完索引の取得失敗"); return r.json(); })
    .catch(e => { searchSupplementPromise = null; throw e; });
  return searchSupplementPromise;
}
// Load once on the first search; a failed load is retryable.
let photographicSearchPromise = null;
function photographicSearch() {
  if (!photographicSearchPromise) photographicSearchPromise = searchJson("data/aim-places.json")
    .then(data => AstroNotesPlaceSearch.open(data))
    .catch(e => { photographicSearchPromise = null; throw e; });
  return photographicSearchPromise;
}
function namedPlaceMatches(q, rows) {
  const norm = s => AstroNotesTerrain.normName(s).replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const query = norm(q);if (!query) return [];
  if (String(q).trim().split(/\s+/).length > 1) return rows
    .filter(r => AstroNotesPlaceSearch.match(q, {...r, address: r.address || r.detail || r.subtitle}))
    .filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
  return rows.filter(r => [r.name, ...(r.aliases || [])].some(n => norm(n).includes(query)))
    .filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
}
// 同じ検索の連打をまとめ、通信が長引いても検索画面を待たせ続けない。
const searchResponseCache = new Map();
let nextOsmSearchAt = 0;
function searchJson(url) {
  const cached = searchResponseCache.get(url);
  if (cached && Date.now() - cached.at < 300000) return cached.promise;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 6000);
  let delay = 0;
  if (url.startsWith("https://nominatim.openstreetmap.org/search?")) {
    const now = Date.now();delay = Math.max(0, nextOsmSearchAt - now);nextOsmSearchAt = now + delay + 1000;
  }
  const start = delay ? new Promise(resolve => setTimeout(resolve, delay)) : Promise.resolve();
  const promise = start.then(() => fetch(url, {signal: controller.signal}))
    .then(r => {if (!r.ok) throw new Error("地名検索の通信失敗");return r.json();})
    .catch(e => {searchResponseCache.delete(url);throw e;}).finally(() => clearTimeout(timer));
  searchResponseCache.set(url, {at: Date.now(), promise});
  if (searchResponseCache.size > 40) searchResponseCache.delete(searchResponseCache.keys().next().value);
  return promise;
}
async function searchPlaces(q, {localOnly = false, near = place, localityOnly = false} = {}) {
  q = String(q).normalize("NFKC").trim().replace(/\s+/g, " ");
  const gsiUrl = "https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + encodeURIComponent(q);
  // `extratags=1` で `height` / `building:levels` / `tower:type` が返る。
  // **展望台は立つ高さが効く**ので、検索の時点で持っておく
  const osmUrl = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams(
    { q, format: "jsonv2", limit: "8", ...(localityOnly ? {} : {countrycodes: "jp"}), "accept-language": "ja", extratags: "1" });
  const [gsiRes, osmRes, idxRes, supplementRes, photoRes] = await Promise.allSettled([
    localOnly ? Promise.resolve([]) : searchJson(gsiUrl),
    localOnly ? Promise.resolve([]) : searchJson(osmUrl),
    localityOnly ? Promise.resolve([]) : placeIndex().then((j) => AstroNotesTerrain.searchPlaceIndex(j, q, { near, limit: 8 })),
    searchSupplement(),
    localityOnly ? Promise.resolve([]) : photographicSearch(),
  ]);
  const photos = (photoRes.status === "fulfilled" ? AstroNotesPlaceSearch.search(photoRes.value, q) : []).map(r => {
    // Canonical current deck heights take precedence over the legacy catalog's d.
    const registry = r.kind === "展望台" ? AstroNotesTerrain.OBSERVATION_DECKS.find(d => r.name.search(d.match) === 0)?.decks : null;
    const decks = AstroNotesTerrain.decksFor(r.name) || registry;
    const namedDeck = decks?.filter(d => r.name.includes(d.name.replace(/[（(].*$/, "")));
    return {...r, decks: namedDeck?.length ? namedDeck : decks,
      lookout: r.kind === "展望地" ? "viewpoint" : null};
  });
  const landmarkRows = AstroNotesAlign.TARGETS.filter(r => r.id !== "tinkerbell" && r.id !== "fuji").map(r => ({
    ...r, aliases: r.id === "skytree" ? ["スカイツリー", "とうきょうスカイツリー"] : [],
    kind: r.id === "fuji" ? "山" : "施設", detail: r.id === "skytree" ? "東京都墨田区押上" : r.id === "tokyotower" ? "東京都港区芝公園" : "施設・対象", scope: "point", source: "landmark", decks: AstroNotesTerrain.decksFor(r.name),
  }));
  const registeredLookouts = AstroNotesTerrain.OBSERVATION_DECKS.filter(r => r.place).map(r => ({
    ...r.place, decks:r.decks, scope:"point", source:"landmark", lookout:"observation",
  }));
  const landmarks = namedPlaceMatches(q, [...landmarkRows, ...registeredLookouts]);
  const saved = namedPlaceMatches(q, favorites).map(r => ({...r, detail: r.subtitle || "お気に入り", scope: r.locationScope || "point", source: "saved", kind: Number.isFinite(r.targetHeightM)?"登録済みの対象":"お気に入り", savedPlace: r}));
  const supplemented = namedPlaceMatches(q, supplementRes.status === "fulfilled" ? supplementRes.value.places || [] : [])
    .map(r => ({...r, scope: "point", kind: "公園", source: "supplement"}));
  const local = (idxRes.status === "fulfilled" ? idxRes.value : []).map((r) => ({
    name: r.name,
    detail: [r.muni, Number.isFinite(r.elevation) ? `標高${r.elevation}m` : null].filter(Boolean).join(" ・ "),
    latitude: r.latitude, longitude: r.longitude, scope: "point", source: "index",
    kind: r.kind, decks: AstroNotesTerrain.decksFor(r.name), lookout: r.kind === "展望地" ? "viewpoint" : null, elevation: r.elevation, indexScore: r.score,
  }));
  const gsi = (gsiRes.status === "fulfilled" && Array.isArray(gsiRes.value) ? gsiRes.value : [])
    .filter((f) => f && f.geometry && Array.isArray(f.geometry.coordinates))
    .map((f) => {
      const address = (supplementRes.status === "fulfilled" ? supplementRes.value.municipalities : null)?.[String(Number(f.properties?.addressCode))] || "";
      return {
        name: String(f.properties?.title || "").trim(),
        address, detail: `${address || "住所を確認できません"}（国土地理院）`,
        latitude: +f.geometry.coordinates[1], longitude: +f.geometry.coordinates[0],
        scope: AstroNotesTerrain.gsiLocationScope(f.properties?.title),
        source: "gsi",
        kind: AstroNotesTerrain.gsiLocationScope(f.properties?.title) === "area" ? "地域" : /駅$/.test(f.properties?.title || "") ? "駅" : null,
        // 公表値の展望台は名前だけで引ける。OSM が当たらなくても出す
        decks: AstroNotesTerrain.decksFor(String(f.properties?.title || "")),
      };
    });
  const osm = (osmRes.status === "fulfilled" && Array.isArray(osmRes.value) ? osmRes.value : [])
    .map((r) => {
      const name = r.name || r.display_name.split(",")[0];
      // **展望台の高さは、公表値があればそれを使う。** OSM の `height` は
      // 構造物の高さで、東京タワーなら 333m（先端）＝立つ場所ではない
      const decks = AstroNotesTerrain.decksFor(name);
      const struct = AstroNotesTerrain.structureHeight(r.extratags);
      return {
        name, detail: r.display_name,
        kind: /station|halt|stop/.test(r.type || "") || /駅(?:[（(].*)?$/.test(name) ? "駅" : r.type === "park" ? "公園" : null,
        latitude: +r.lat, longitude: +r.lon,
        scope: AstroNotesTerrain.searchLocationScope(r),
        source: "osm",
        lookout: AstroNotesTerrain.isLookout(r),
        decks, structureM: struct ? struct.m : null, structureFrom: struct ? struct.from : null,
        wikidata: (r.extratags && r.extratags.wikidata) || null,
      };
    });
  // A shortened Plus Code needs reference locations, not a nearby named POI.
  // Keep distinct geocoder candidates instead of applying the usual near/POI ranking.
  if (localityOnly) {
    const candidates = [...gsi, ...osm].filter(r => r.name && Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
    const nameKey = s => AstroNotesTerrain.normName(s).toLowerCase(), queryKey = nameKey(q);
    // GSI also returns facilities containing a city name (e.g. 138 hits for
    // Yokohama). Those are not separate reference cities for the same code.
    const exact = candidates.filter(r => nameKey(r.name) === queryKey || r.scope === "area" && nameKey(r.name).endsWith(queryKey));
    const regions = candidates.filter(r => r.scope === "area");
    // An exact facility must not hide a differently qualified region name.
    const references = exact.length || regions.length ? [...new Set([...exact, ...regions])] : candidates;
    references.searchFailed = gsiRes.status === "rejected" || osmRes.status === "rejected";
    return references;
  }
  // **名前が一致するものを上に。** そのうえで、**いま見ている地点から近い順**。
  // 「高尾山」は地理院に8件あり、距離を見ないと遠い同名が枠を埋めて八王子の高尾山が出ない
  const normQuery = AstroNotesTerrain.normName(q);
  const score = (r) => {
    const names = [r.name, ...(r.aliases || [])].map(n => AstroNotesTerrain.normName(n));
    if (names.includes(normQuery)) return 0;
    if (names.some(n => n.startsWith(normQuery))) return 1;
    if (names.some(n => n.includes(normQuery))) return 2;
    if (r.source === "photo" && AstroNotesPlaceSearch.match(q, r)) return 2;
    return r.source === "index" && r.indexScore >= 60 ? 2 : 3;
  };
  const away = (r) => AstroNotesTerrain.distanceKm(near.latitude, near.longitude, r.latitude, r.longitude);
  const merged = [];
  const hasLocalAnd = q.includes(" ") && [...saved, ...landmarks, ...supplemented, ...photos, ...local]
    .some(r => AstroNotesPlaceSearch.match(q, {...r, address: r.address || r.detail}));
  // 出典ごとの優先枠を廃止。一致の強さを全候補で比較し、眺望地が本体を追い越さない。
  const priority = r => r.source === "saved" ? 0 : r.source === "landmark" ? 1 : r.source === "supplement" ? 2 : 3;
  const ordered = [...saved, ...landmarks, ...supplemented, ...photos, ...local, ...gsi, ...osm]
    .sort((a, b) => score(a) - score(b) || priority(a) - priority(b) || away(a) - away(b));
  const exactFacility = landmarks.some(r => score(r) === 0);
  for (const r of ordered) {
    // 施設名に完全一致したとき「役所」だけで当たった遠方の別施設を混ぜない。
    if (exactFacility && ![r.name, ...(r.aliases || [])].map(AstroNotesTerrain.normName).some(n => n && (n.includes(normQuery) || normQuery.includes(n)))) continue;
    if (!r.name || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) continue;
    // AND local terms across name, aliases and address. Geocoders also handle
    // translated names and address normalization, so trust their own query parsing.
    if (q.includes(" ") && !AstroNotesPlaceSearch.match(q, {...r, address: r.address || r.detail})
      && (hasLocalAnd || !["gsi", "osm"].includes(r.source))) continue;
    // 検索語をまったく含まない候補は、**1件も当たらなかったときだけ**出す（索引は語の中の地名で当てるので除く）
    if (!["index", "photo", "saved", "supplement", "landmark"].includes(r.source) && score(r) === 3 && merged.length >= 1) continue;
    // 索引の山や岬は、地理院・OSM の代表点と数百m ずれることがある（宗谷岬が二重に出た）。索引が絡むときは 1.5km まで同じとみなす
    // ただし種類が食い違う（駅と山）なら別物。高尾山の山頂がケーブルカーの「高尾山」駅（1.3km）に吸収されていた（2026-10-05 総点検）
    // 当てはまる候補が複数あれば最も近いものにまとめる（索引の代表点へ寄せたとき、別の同名候補と重ならないように）
    let dup = null, dupKm = Infinity;
    for (const m of merged) {
      if (m.name !== r.name) continue;
      const km = AstroNotesTerrain.distanceKm(m.latitude, m.longitude, r.latitude, r.longitude);
      if (km < ((m.source === "index" || r.source === "index") && (!m.kind || !r.kind || m.kind === r.kind) ? 1.5 : 0.2) && km < dupKm) { dup = m; dupKm = km; }
    }
    // 同じ場所が両方から返ったら、住所の書いてあるほう（OSM）の説明を採る。
    // **高さも引き継ぐ。** 地理院の地名情報には高さが無いので、
    // ここで捨てると「東京タワー」が展望台として出なくなる（2026-09-28 実測）
    if (dup) {
      // Preserve the bundled bridge/park representative point when a geocoder
      // returns the same name on a nearby road or bank instead.
      if (r.source === "photo" && !["saved", "landmark", "supplement", "index"].includes(dup.source)) {
        dup.latitude = r.latitude; dup.longitude = r.longitude; dup.detail = r.detail;
        dup.address = r.address; dup.kind = r.kind; dup.scope = r.scope; dup.source = "photo";
      }
      if (dup.source === "gsi" && r.source === "osm") { dup.detail = r.detail; dup.detailFromOsm = true; }
      // **残した側に無い情報は、どちらの組み合わせでも引き継ぐ。** OSM 同士でも同名の別物が並ぶ
      // （「通天閣」は塔と、前のシェアサイクル置き場。置き場を残して塔の高さ 108m を捨てていた。2026-10-01）。
      // Wikidata の参照も捨てない（OSM に高さの無い目標物＝大平和祈念塔の高さを取りに行けなくなる）
      if (!dup.decks && r.decks) dup.decks = r.decks;
      if (!dup.lookout && r.lookout) dup.lookout = r.lookout;
      if (dup.structureM == null && r.structureM != null) { dup.structureM = r.structureM; dup.structureFrom = r.structureFrom; }
      if (!dup.wikidata && r.wikidata) dup.wikidata = r.wikidata;
      // 同梱の索引は山頂・展望地の代表点と市町村・標高・種類を持つ。OSM・地理院の側を残したときは位置と説明を索引から採る
      // （「高尾山」が OSM の「高尾山, 東京都, 193-0841, 日本」だけになり、町田の100mの山と見分けられなかった。2026-10-05 総点検）
      if (r.source === "index" && dup.source !== "index") {
        dup.detail = r.detail; dup.kind = r.kind || dup.kind; dup.latitude = r.latitude; dup.longitude = r.longitude;
        if (dup.elevation == null && Number.isFinite(r.elevation)) dup.elevation = r.elevation;
      }
      continue;
    }
    // 並びには距離を使うが、画面には出さない（2026-10-01 ユーザー指摘「一つ前の検索の場所から何キロはいらない」）
    merged.push(r);
    if (merged.length >= 8) break;
  }
  merged.searchFailed = !localOnly && gsiRes.status === "rejected" && osmRes.status === "rejected";
  return merged;
}

/// 検索結果を並べる。押したときの動きは呼び出し側が決める（地点にする／地図を動かす）
/// 検索結果に出す高さの印。**展望台は立つ高さが効く**ので、その場で分かるようにする
function lookoutTag(r) {
  if (r.decks && r.decks.length) {
    return `<span class="tag-lookout">展望 ${r.decks.map((d) => `${d.aglM}m${d.heightBasis === "published-viewpoint" ? "（公称）" : ""}`).join("／")}</span>`;
  }
  if (!r.lookout) return "";
  if (r.structureM) {
    // 塔は**先端の高さ**しか分からない。展望台はそれより下なので、そう書く
    const what = r.lookout === "building" ? "屋上" : "先端";
    return `<span class="tag-lookout">高さ ${Math.round(r.structureM)}m（${what}）</span>`;
  }
  return `<span class="tag-lookout">展望</span>`;
}

/**
 * 展望台の選択。**複数あるときだけ出す。**
 * 東京タワーの メインデッキ150m / トップデッキ250m、
 * スカイツリーの 天望デッキ350m / 天望回廊450m は、立つ場所で地平線が変わる。
 */
/// 地点カードを出す画面か（その地点が主語の画面だけ）
const placeCardShown = () => ["list", "detail", "answers"].includes(currentView);
function renderDeckRow() {
  const decks = (place && place.decks) || [];
  const row = $("deckRow");
  row.hidden = decks.length < 1 || !placeCardShown();
  if (row.hidden) return;
  const cur = place.eyeHeightAGL ?? 1.5;
  const opts = [...decks.map((d) =>
                  [String(d.aglM), `${AstroNotesTerrain.deckLabel(d.name, place.name)} 地上${d.aglM}m`]),
                ["1.5", "地面に立って 1.5m"]];
  $("deckPick").innerHTML = opts.map(([v, label]) =>
    `<option value="${v}"${Number(v) === cur ? " selected" : ""}>${esc(label)}</option>`).join("");
  const ground = place.elevation ?? bundle?.home.grid.elevation;
  $("deckNote").textContent = Number.isFinite(ground)
    ? `目の高さ ${Math.round(ground + cur)}m（標高${Math.round(ground)}m＋${cur}m）` : "";
}
$("deckPick").onchange = () => {
  const m = Number($("deckPick").value);
  if (!Number.isFinite(m)) return;
  // 取り直しは要らない（同じ座標の予報は使い回される）。地形と月だけ計算し直す
  selectPlace({ ...place, eyeHeightAGL: m });
};

function renderSearchResults(host, results, onPick) {
  host.innerHTML = results.length
    ? results.map((r, i) => `<button class="list-item" data-sr="${i}"><strong>${esc(r.name)}</strong>
        ${r.kind ? `<span class="tag-lookout">${esc(r.kind)}</span>` : ""} ${r.kind && !r.decks?.length && !r.structureM ? "" : lookoutTag(r)}
        <span class="tiny sub-line">${esc(r.detail || "")}${r.scope === "area" ? "（地域の代表地点）" : ""}</span></button>`).join("")
    : `<p class="tiny" role="status">${results.searchFailed ? "検索先に接続できませんでした。もう一度検索するか、地図で選んでください。" : "見つかりませんでした。市区町村を加えるか、地図で選んでください。"}</p>`;
  for (const el of host.querySelectorAll("[data-sr]")) {
    el.onclick = () => onPick(results[+el.dataset.sr]);
  }
}

function wireSearchBox(boxId, resultsId, onPick, onCoord, options = {}) {
  // 共通の地点検索。地名・座標・Plus Codeを各画面の既存の選択先へ渡す。
  const field = $(boxId), searchButton = $(`${boxId}Go`);
  if (field && searchButton) {
    field.parentElement.classList.add("location-search-row");
    field.setAttribute("aria-label", field.getAttribute("aria-label") || "地点を検索（住所・地名・駅名・緯度経度・Plus Code・地図のURL）");
    field.title = "住所・地名・駅名・緯度経度・Plus Code・地図のURL";
    field.placeholder = "住所・地名・座標・Plus Code";
    field.setAttribute("enterkeyhint", "search");
    searchButton.classList.add("location-search-go");
    searchButton.type = "button";
    searchButton.setAttribute("aria-label", "検索");
    searchButton.title = "検索";
    searchButton.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>';
  }

  // **確定の拾い方は2通り持つ。** iOS のキーボードの「検索」では keydown の Enter が
  // 届かないことがあり、`input[type=search]` の `search` イベントでしか拾えない。
  // 同じ語で二重に走らないよう、直前の語を憶えておく。
  let last = null, seq = 0, lastTimer = 0, localTimer = 0;
  const box = $(boxId), results = $(resultsId);
  const searchNear = () => options.near ? options.near() : boxId === "mapSearch" ? MapPick.center() : placeSheetFor && PLACE_PICKERS[placeSheetFor] ? PLACE_PICKERS[placeSheetFor].point() || place : place;
  const invalidate = () => { ++seq; last = null; clearTimeout(lastTimer); clearTimeout(localTimer); results.removeAttribute("aria-busy"); results.innerHTML = ""; };
  const pick = (result, ticket) => {
    if (ticket !== seq) return;
    if (options.isCurrent && !options.isCurrent()) return;
    invalidate();
    box.blur?.();
    return onPick(result);
  };
  // 消去/入力変更で表示と待機中の結果を同時に無効化。遅い旧検索を復活させない。
  results.setAttribute("aria-live", "polite");
  box.addEventListener("input", () => {
    invalidate();const q = box.value.trim(), ticket = seq;
    if (q.length < 2 || AstroNotesTerrain.parseLatLon(q) || AstroNotesPlusCode.parse(q) || /^https?:/.test(q)) return;
    // 入力中は端末内の候補だけ。外部の地名APIは検索ボタン/Enterで呼ぶ。
    localTimer = setTimeout(async () => {
      const found = await searchPlaces(q, {localOnly: true, near: searchNear()});
      if (ticket === seq && box.value.trim() === q && (!options.isCurrent || options.isCurrent()) && found.length) renderSearchResults(results, found, r => pick(r, ticket));
    }, 200);
  });
  box.closest("dialog")?.addEventListener("close", invalidate);
  const run = async () => {
    const q = $(boxId).value.trim();
    if (!q) { invalidate(); return; }
    if (q === last) return;
    last = q;
    const ticket = ++seq;
    const current = () => ticket === seq && box.value.trim() === q && (!options.isCurrent || options.isCurrent());
    clearTimeout(lastTimer); clearTimeout(localTimer);
    lastTimer = setTimeout(() => { if (ticket === seq) last = null; }, 800);
    // **緯度経度を入れたらそこへ。** 地図アプリからの貼り付け（度分秒・全角）も読む。
    // 検索に投げても地名としては当たらないので、先にこちらで拾う（2026-09-24 ユーザー依頼）。
    const coord = AstroNotesTerrain.parseLatLon(q);
    if (coord) { $(resultsId).innerHTML = ""; onCoord(coord); return; }
    const plusCode = AstroNotesPlusCode.parse(q);
    if (plusCode) {
      results.innerHTML = ""; results.setAttribute("aria-busy", "true");
      if (plusCode.kind === "short" && plusCode.locality) results.innerHTML = '<p class="tiny" role="status">Plus Codeの地域名を調べています…</p>';
      try {
        const found = await AstroNotesPlusCode.resolve(plusCode, locality => searchPlaces(locality, {localityOnly:true}));
        if (!current()) return;
        if (found.results.length) {
          renderSearchResults(results, found.results, r => { if (current()) pick(r, ticket); });
          if (found.message) results.insertAdjacentHTML("afterbegin", `<p class="tiny" role="status">${esc(found.message)}</p>`);
        } else results.innerHTML = `<p class="tiny" role="status">${esc(found.message)}</p>`;
      } catch {
        if (current()) results.innerHTML = '<p class="warn" role="status">Plus Codeを検索できませんでした。もう一度検索するか、地図で選んでください。</p>';
      } finally { if (current()) results.removeAttribute("aria-busy"); }
      return;
    }
    // 度（°・度）があるのに読めなければ、座標の書き間違い。地名として探しても何も出ないので、書き方を言う
    if (/[°º˚度]/.test(q)) {
      $(resultsId).innerHTML = `<p class="tiny">緯度経度を読めませんでした。<span class="nb">35°44'52.1"N 139°55'49.1"E</span> や
        <span class="nb">35.7478, 139.9303</span> の形で入れてください。</p>`;
      return;
    }
    // 短縮リンク（maps.app.goo.gl/…）は**ブラウザからは行き先を読めない**（CORS）。
    // 2026-09-27 から、行き先だけを調べる経路を API に置いた。
    if (AstroNotesTerrain.isShortMapLink(q)) {
      // 短縮リンクは CORS で読めないので、**行き先だけ**サーバーに調べてもらう。
      // 座標の取り出しは、いつもと同じ `parseMapLink`（規則を2か所に置かない）。
      $(resultsId).innerHTML = `<p class="tiny">リンクの行き先を調べています…</p>`;
      let resolved = null;
      try {
        const r = await fetch(`${API}/resolve-map-link?u=${encodeURIComponent(q)}`);
        const body = await r.json();
        if (r.ok && body.url) resolved = AstroNotesTerrain.parseMapLink(body.url);
      } catch { resolved = null; }
      if (!current()) return;
      if (resolved && onCoord) {
        $(boxId).value = "";
        $(resultsId).innerHTML = "";
        onCoord(resolved);
        return;
      }
      $(resultsId).innerHTML = `<p class="tiny">このリンクからは座標が分かりませんでした。
        一度開いて、出てきたアドレス（<span class="nb">.../@35.36,138.72,17z</span> のような形）か、
        緯度経度そのものを貼ってください。</p>`;
      return;
    }
    $(resultsId).dataset.kind = "";
    results.setAttribute("aria-busy", "true");
    const local = await searchPlaces(q, {localOnly: true, near: searchNear()});
    if (!current()) return;
    if (local.length) renderSearchResults(results, local, r => pick(r, ticket));
    else results.innerHTML = "";
    results.insertAdjacentHTML("beforeend", `<p class="tiny" role="status">検索中…</p>`);
    try {
      const found = await searchPlaces(q, {near: searchNear()});
      if (current()) renderSearchResults(results, found, r => pick(r, ticket));
    } catch { if (current()) results.innerHTML = `<p class="warn" role="status">検索できませんでした。もう一度検索するか、地図で選んでください。</p>`; }
    finally {if (current()) results.removeAttribute("aria-busy");}
  };
  // 日本語の変換を確定する Enter では始めない（確定のたびに検索が走る）
  $(boxId).addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) run(); });
  $(boxId).addEventListener("search", run);       // iOS のキーボードの「検索」
  // 「検索」釦。押せば必ず始まる（同じ語でも、もう一度探す）
  const go = document.getElementById(`${boxId}Go`);
  if (go) go.onclick = () => { last = null; run(); };
  return invalidate;
}

wireSearchBox("searchBox", "searchResults", (r) => {
  if (r.savedPlace) { choosePlace(r.savedPlace); return; }
  // **展望台を選んだら、その高さを地点に持たせる。**
  // 公表値があればそれ（東京タワーのメインデッキ 150m など）。
  // 無ければ OSM の構造物の高さだが、塔は先端なので**自動では立たせない**。
  const decks = r.decks && r.decks.length ? r.decks
    : (r.lookout === "building" && r.structureM ? [{ name: "屋上", aglM: Math.round(r.structureM) }] : null);
  choosePlace({ id: `search:${r.latitude},${r.longitude}`, name: r.name,
    // 索引の説明から標高は外す（地点カードが標高を別に書くので二重になる）
    subtitle: r.source === "photo" || r.source === "gsi" && !r.detailFromOsm ? r.address || "" : r.source === "index" ? r.detail.replace(/ ・ 標高\d+m$/, "")
      : r.detail.split(",").slice(1, 3).join("").trim(),
    latitude: r.latitude, longitude: r.longitude, terrain: null,
    // 山頂は索引の標高（OSM の ele）を使う。無ければ地図の標高タイルで付く
    elevation: ["index", "photo"].includes(r.source) && Number.isFinite(r.elevation) ? r.elevation : null,
    locationScope: r.scope,
    decks, eyeHeightAGL: decks ? decks[0].aglM : null,
    structureM: r.structureM ?? null, structureFrom: r.structureFrom ?? null, wikidata: r.wikidata ?? null, lookout: r.lookout ?? null });
}, async (c) => {
  // 座標を入れたら、**そのままその場所を地点にする**（2026-10-01 ユーザー「候補から選択しないと検索できないようになってるんでしょ」）。
  // 以前は地図を開いて「この場所にする」をもう一度押させていた。位置を直したいときは「地図で選ぶ」から
  $("searchResults").innerHTML = `<p class="tiny">${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)} にしています…</p>`;
  await selectPointAt(c.latitude, c.longitude, `緯度経度 ${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`);
  $("searchResults").innerHTML = ""; $("searchBox").value = "";
});

// 地図の中の検索は**地点を決めない。地図を動かすだけ。**
// 「だいたいの場所まで飛んで、そこからピンを寄せる」ための入口（2026-09-24 ユーザー依頼）。
wireSearchBox("mapSearch", "mapSearchResults", (r) => {
  // 代表地点（市区町村）は広いので引いて出し、施設や地物なら寄せる
  MapPick.setView(r.latitude, r.longitude, r.zoom ?? (r.scope === "area" ? 13 : 16));
  $("mapSearchResults").innerHTML = "";
  $("mapSearch").value = r.name;
}, (c) => { MapPick.setView(c.latitude, c.longitude, 16); });

function renderFavToggle() {
  const isFav = favorites.some((f) => f.id === place.id);
  $("favToggle").textContent = isFav ? "★" : "☆";
  $("favToggle").style.color = isFav ? "var(--accent)" : "var(--tertiary)";
  // ★ は解除ではなく編集を開く。記号だけでは伝わらないので読み上げ名で言う。
  $("favToggle").setAttribute("aria-label", isFav ? "お気に入りを編集" : "お気に入りに登録");
}
// ☆ は即登録ではなくフォームを開く。現象・地形・メモを付けてこそ一覧が使えるものになるし、
// ★ からそのまま編集・削除へ入れる。
$("favToggle").onclick = (e) => {
  e.stopPropagation();
  openFavSheet(favorites.findIndex((f) => f.id === place.id));
};
// 未ログインのときは、押せない見た目にはせず、押したらログインへ案内する。
// 隠すと「なぜ無いのか」が分からない。
new MutationObserver(renderFavToggle).observe($("placeName"), { childList: true });
export {favUndo,nearName,openPlaceSheet,placeCardShown,placeIndex,placeSheetFor,refreshPlacePickerActions,renderDeckRow,renderFavToggle,wireSearchBox};
