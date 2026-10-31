// ---------------------------------------------------------------- 永続化（localStorage）
const store = AstroNotesStorage.create(()=>localStorage);
// お気に入りは、内蔵スポットと同じ項目を自分で付けられる。
// terrain は表示用ではない。astronotes-core の needsProfile（鉛直分布を取るか）と、
// 雲海・霧氷の対象判定に使われる。ここで選び間違えると点数が変わる。
const TERRAINS = [
  ["",           "選ばない（標高で判定）"],
  ["summit",     "山頂・尾根"],
  ["basinRim",   "盆地や谷を見下ろす高台"],
  ["basinFloor", "盆地・谷の底"],
  ["plain",      "平地"],
  ["coast",      "海岸"],
];

// 取り込んだものを信用しない。書き出しファイルは手で編集できるし、
// 同期でサーバー越しにも同じ形が入ってくる。
// 描画側のエスケープと二重にするのは、どちらか一方だけだと
// 新しい描画箇所を足したときに素通りするため。
const isText = (v) => typeof v === "string" && v.length <= 2000;
function cleanSighting(r) {
  if (!r || typeof r !== "object" || !isText(r.id) || !r.id) return null;
  if (!S.PHENOMENA[r.phenomenon]) return null;            // 知らない現象は描けない
  if (!Number.isFinite(r.peak)) return null;              // 日付が無いと並べられない
  // 写真から読んだ値も信用しない。同期でサーバー越しにも入ってくる
  const num = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : null);
  return { ...r, placeName: isText(r.placeName) ? r.placeName : "",
    outcome: isText(r.outcome) ? r.outcome : "unchecked",
    actualScore: Number.isFinite(r.actualScore) && r.actualScore >= 0 && r.actualScore <= 100 ? Math.round(r.actualScore) : null,
    score: Number.isFinite(r.score) ? r.score : 0,
    observedAtMs: num(r.observedAtMs, 0, 4102444800000),      // 2100年まで
    photoLatitude: num(r.photoLatitude, -90, 90),
    photoLongitude: num(r.photoLongitude, -180, 180),
    photoAltitudeM: num(r.photoAltitudeM, -500, 9000),
    photoDistanceM: num(r.photoDistanceM, 0, 2e7),
    photoAglM: num(r.photoAglM, -100, 1000),
    photoOutsideWindow: typeof r.photoOutsideWindow === "boolean" ? r.photoOutsideWindow : null };
}
/**
 * 保存した地点の展望台の高さを、現在の施設別の床高一覧で引き直す。
 * 東京タワーは公称値と図面の床高が異なるため、2026-10-08に図面の推定床高へ更新。
 * 地上で立つ選択や独自の高さは保持する。共有URL内の明示高さは保持する。
 */
function freshDecks(f) {
  const now = Array.isArray(f.decks) && AstroNotesTerrain.decksFor(f.name);
  if (!now) return f;
  const i = f.decks.findIndex((d) => d && d.aglM === f.eyeHeightAGL);
  return { ...f, decks: now, eyeHeightAGL: i >= 0 && now[i] ? now[i].aglM : f.eyeHeightAGL };
}
function cleanFavorite(f) {
  if (!f || typeof f !== "object" || !isText(f.id) || !f.id) return null;
  if (!Number.isFinite(f.latitude) || Math.abs(f.latitude) > 90 || !Number.isFinite(f.longitude) || Math.abs(f.longitude) > 180) return null;
  f = freshDecks(f);
  return { ...f, locationScope: AstroNotesTerrain.locationScope(f), name: isText(f.name) && f.name ? f.name : "名称未設定",
    subtitle: isText(f.subtitle) ? f.subtitle : "",
    note: isText(f.note) ? f.note : "",
    terrain: TERRAINS.some(([v]) => v === f.terrain) && f.terrain ? f.terrain : null,
    elevation: Number.isFinite(f.elevation) ? f.elevation : null,
    // 地面からの目の高さ。**地面の標高とは別物。** 展望台では数十〜数百m効く
    eyeHeightAGL: Number.isFinite(f.eyeHeightAGL) && f.eyeHeightAGL >= 0 && f.eyeHeightAGL <= 700
      ? f.eyeHeightAGL : null,
    // ねらうの「他の目標」として登録したときの高さ（地上から）。目の高さとは別物
    targetHeightM: Number.isFinite(f.targetHeightM) && f.targetHeightM >= 0 && f.targetHeightM <= 1000
      ? f.targetHeightM : null,
    phenomena: Array.isArray(f.phenomena) ? f.phenomena.filter((p) => S.PHENOMENA[p]) : [],
    // 対象のカテゴリ（2026-10-21）。名前は20文字まで。無ければカテゴリなし
    targetCategory: isText(f.targetCategory) && f.targetCategory.trim() && f.targetCategory.trim().length <= 20 ? f.targetCategory.trim() : null };
}

const DEFAULT_PLACE = { id: "default", name: "東京", subtitle: "東京都",
  latitude: 35.6812, longitude: 139.7671, terrain: null, elevation: null };
// 地点も壊れうる。座標が数値でなければ既定へ戻す（座標が無いと予報を取りに行けない）。
let place = (() => {
  const p = store.get("sorami.place", DEFAULT_PLACE);
  if (!p || typeof p !== "object" || !Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90 || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180) {
    return { ...DEFAULT_PLACE };
  }
  return { ...freshDecks(p), locationScope: AstroNotesTerrain.locationScope(p), name: typeof p.name === "string" && p.name ? p.name : DEFAULT_PLACE.name,
    subtitle: typeof p.subtitle === "string" ? p.subtitle : "" };
})();
// 読み込み時にも同じ検査を通す。localStorage は壊れうる（取り込みの途中失敗、
// 別タブとの競合、同期の不具合、手で書き換えられた場合）。
// 実際、null が混ざった配列で描画が3箇所落ちることを確認した（2026-09-07）。
const cleanList = (key, fn) => {
  const raw = store.get(key, []);
  return Array.isArray(raw) ? raw.map(fn).filter(Boolean) : [];
};
let favorites = cleanList("sorami.favorites", cleanFavorite);
let sightings = cleanList("sorami.sightings", cleanSighting);

// 一覧の並び。既定の「標準」は現象の固定順で、日をまたいでも行が動かない。
// いつも同じ場所を見れば済むという利点があるので、これを既定から外さない。
// 並び替えは「今日どれが上か」を知りたいときに、利用者が明示的に選ぶ。
//
// 並べる値は【カードの見出しに出ている回】から取る。14日間の最高点で
// 並べると、見出しが「平凡」のカードが先頭に来て、言っていることと
// 出しているものが食い違う。
const GRADE_ORDER = { A: 0, B: 1, C: 2 };
// ラベルは「何で並べるか」だけ。
// ⇅ の札の中に出るので「〜順」は繰り返しになる。
// 向きも書かない。点数と信頼度は高いほうが先、時刻は早いほうが先で、
// どれも向きは一つしかない。迷わないものに注釈を足すと読みにくくなるだけ。
// 名前は表の左上の札にも出る。列の幅は 84px しかないので、どれも2〜3文字に収める。
const SORTS = {
  standard: { label: "標準", key: null },
  score: { label: "点数", key: (u) => -u.evaluation.score },
  // 信頼度が同じなら点数の高い順。1000 は点数（0〜100）を跨がない間隔。
  grade: { label: "信頼度", key: (u) =>
    GRADE_ORDER[S.reliabilityGrade(u.evaluation.confidence, u.evaluation.models).key] * 1000
    - u.evaluation.score },
  time: { label: "時刻", key: (u) => u.evaluation.peak || u.dayMs },
};
let sortMode = SORTS[store.get("sorami.sort", "standard")] ? store.get("sorami.sort", "standard") : "standard";

const WIDE = window.matchMedia("(min-width: 900px)");

// 画面は2つ。一覧（全現象×7日）と詳細（1現象・1日）。
// 同じページにスクロールで並べていたが、表と詳細が混ざって読みにくかった。
// 場所は URL のハッシュに持つので、ブラウザの戻るがそのまま効く。
//   #            → 一覧
//   #/sunset     → 夕焼けの直近の回
//   #/sunset/172… → 夕焼けの特定の日
let picked = null;       // 詳細で見ている現象（一覧のときは null）
const viewStateOwner = AstroNotesStateOwner.create(globalThis);
viewStateOwner.defineLegacy("atSkyMap", false);
let SkyMapUI = null;
let aimCustomRequest = 0;
viewStateOwner.defineLegacy("atAim", false);       // 「ねらう」のページを見ているか
viewStateOwner.defineLegacy("atPlane", false);     // 「月丼」のページを見ているか
viewStateOwner.defineLegacy("atIss", false);       // 「人工衛星」（旧 ISSの月面通過）のページを見ているか
viewStateOwner.defineLegacy("atAnswers", false);
viewStateOwner.defineLegacy("atAlmanac", false);
let almanacPoint = null, almanacTimeline = null, almanacScrub = 'date', almanacDragAt = null, almanacPlayback = null;
let almanacDay = AstroNotesHomeTime.start(Date.now());
viewStateOwner.defineLegacy("atRecords", false);   // 記録画面を見ているか
viewStateOwner.defineLegacy("atAdmin", false);     // 管理者画面を見ているか
// 次の配信（互換層の撤去）の資産を、キャッシュに残ったこのHTMLでも動かすための受け口。撤去と同時に消す
const viewState = { get skyMap() { return atSkyMap; }, get aim() { return atAim; }, get records() { return atRecords; } };
let listScrollY = 0;     // 一覧へ戻ったときに元の位置へ戻す

let bundle = null;       // 取得済みの予報
let weeks = {};          // phenomenon → [{dayMs, evaluation}]
let forecastDays = [], predictionPlace = null;
let predictionLoadSeq = -1, extrasLoadedSeq = -1;
// Hidden tabs wait for visibility without spending a retry. Each forecast generation
// has a bounded retry budget; changing the place cancels all its timers/listeners.
function createForecastRetry(run, maxAttempts = 3) {
  let attempts = 0, timer = null, resume = null, generation = 0;
  const clear = () => { if (timer !== null) clearTimeout(timer); timer = null;
    if (resume) document.removeEventListener("visibilitychange", resume); resume = null; };
  return {
    reset() { clear(); attempts = 0; ++generation; },
    schedule(baseDelay = 60000) {
      if (attempts >= maxAttempts || timer !== null || resume) return;
      const mine = generation;
      const fire = () => {
        timer = null;
        if (mine !== generation) return;
        if (document.hidden) {
          resume = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", resume); resume = null; fire(); } };
          document.addEventListener("visibilitychange", resume); return;
        }
        ++attempts; run();
      };
      timer = setTimeout(fire, Math.max(60000, Math.min(baseDelay, 300000)) * 2 ** attempts);
    }
  };
}
const extrasRetry = createForecastRetry(() => { extrasLoadedSeq = -1; kickExtras(); });
let selectedDay = {};    // phenomenon → dayMs
