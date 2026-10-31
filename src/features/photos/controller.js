import {$,S,esc} from '../../app/presentation-helpers.js';
import {picked,place,store} from '../../app/browser-state.js';
import {bundle,weeks} from '../forecast/load.js';
import {groundAt,iconFor} from '../forecast/view.js';
import {answerHtml,collectObservations,findSighting,recordAnswer,samePlaceAs} from '../results/controller.js';
import {requireLogin} from '../places/controller.js';
import {accessState,apiTransport,auth,renderToolAccess,toolAllowed} from '../account/session-and-access.js';
import {showSheet} from '../../app/overlays.js';
import {recheckAccess} from '../account/access-recheck.js';
// ---------------------------------------------------------------- 写真から記録する
//
// 原寸は送らず、端末で縮小した写し（長辺768px）と、EXIFから読んだ
// 「いつ・どこ」だけを送る。原寸を置くには保存場所（R2）が要る。
//
// 小さくても残す意味はある。**採点のしかたを変えたとき、付け直せるのは写真だけ**で、
// 「あの日は何点だった」という記憶は残らない。
let photoSheetGeneration = 0, photoAttachGeneration = 0, photoSaving = false;
const photoDraft = { file: null, thumb: null, tile: null, exif: null, width: 0, height: 0, round: null,
  // 保存時の分析（2026-10-16）。色の帯は写真を選んだ直後に計算を始める。入力欄は「開いたときに入れた値と由来」を覚え、保存時に比べる
  color: null, colorJob: null, original: null, filled: null, scoreInitial: "default_70", scoreMoved: false };

/**
 * 長辺 `max` px に縮めた JPEG を data URL で返す。
 *
 * 長辺768pxのJPEGを保存し、一覧には長辺192pxの写しを使う。
 * 保存するJPEGから12帯の色の指標を計算する。原寸は送信しない。
 * APIで1枚のサイズと1人300枚の上限を検める。
 */
async function makeThumb(file, max = 768, quality = 0.72) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(bmp, 0, 0, w, h);
  const url = c.toDataURL("image/jpeg", quality);
  const size = { width: bmp.width, height: bmp.height };
  if (bmp.close) bmp.close();
  return { url, ...size };
}

/// 写真を読み込んで下書きへ入れる。**写真は必須**（2026-10-02 ユーザー「遡って記録…それは写真をアップロードが必須」）
async function photoAttach(file) {
  if (photoSaving) return false;
  const generation = ++photoAttachGeneration, sheet = photoSheetGeneration, token = auth?.token;
  const current = () => generation === photoAttachGeneration && sheet === photoSheetGeneration && token === auth?.token;
  photoDraft.file = file;
  photoDraft.thumb = null; photoDraft.tile = null; photoDraft.exif = null;
  photoDraft.loading = true;
  $("photoSave").disabled = true;
  $("photoPreview").hidden = true;
  const draft = { file, exif: null, thumb: null, tile: null, width: 0, height: 0,
    color: null, colorJob: null,
    original: { width: null, height: null, type: file.type || null, bytes: Number.isFinite(file.size) ? file.size : null } };
  try { draft.exif = await AstroNotesExif.readFile(file); } catch { /* EXIFなしでも保存できる */ }
  if (!current()) return false;
  try {
    const t = await makeThumb(file);
    if (!current()) return false;
    const tile = await makeThumb(file, 192, 0.7);
    if (!current()) return false;
    draft.thumb = t.url; draft.tile = tile.url;
    draft.width = t.width; draft.height = t.height;
    draft.original.width = t.width; draft.original.height = t.height;
    const analyzer = globalThis.AstroNotesPhotoAnalysis;
    if (analyzer) draft.colorJob = analyzer.analyzeDataUrl(t.url)
      .then((color) => { if (current()) photoDraft.color = color; return color; }).catch(() => null);
  } catch { /* 写真の読込エラーは保存時に案内する */ }
  if (!current()) return false;
  Object.assign(photoDraft, draft, { loading: false });
  $("photoSave").disabled = false;
  $("photoPreview").src = draft.thumb || "";
  $("photoPreview").hidden = !draft.thumb;
  $("photoChoose").textContent = draft.thumb ? "写真を選び直す" : "写真を選ぶ";
  return true;
}

/**
 * 記録を足す。**過去に遡って入れられる。**
 * その日の予測が手元に無くても、見たものは記録できる
 * （予測との突き合わせは、予測があった回だけの話）。
 */
/// round: 「実際はどうでしたか？」の 📷 から開いたとき、その回（{ pid, peak, score }）。現象・時刻・点数を入れて開き、
/// 保存したらその回の答えと写真の時刻・位置も記録する
async function openPhotoSheet(file, round = null) {
  if (photoSaving || !requireLogin("記録")) return;
  const generation = ++photoSheetGeneration;
  ++photoAttachGeneration;
  photoDraft.loading = false;
  photoDraft.ownerToken = auth?.token;
  $("photoSave").disabled = false;
  photoDraft.round = round;
  photoDraft.file = null; photoDraft.exif = null; photoDraft.thumb = null; photoDraft.tile = null;
  photoDraft.width = 0; photoDraft.height = 0;
  photoDraft.color = null; photoDraft.colorJob = null; photoDraft.original = null; photoDraft.filled = null;
  // 点数の初期値の由来。予報の欄から開いたときは、予報の点のままか・本人が答えた点かを呼び出し側が渡す
  photoDraft.scoreInitial = round ? round.scoreSource || "prefilled_forecast" : "default_70";
  photoDraft.scoreMoved = false;
  $("photoPreview").hidden = true;
  $("photoChoose").textContent = "写真を選ぶ";
  if (file) await photoAttach(file);
  if (generation !== photoSheetGeneration || photoDraft.ownerToken !== auth?.token) return;
  $("photoErr").hidden = true;

  // 現象の一覧。**この画面の順で出す**（一覧と同じ並びなら迷わない）
  $("photoPhenom").innerHTML = Object.entries(S.PHENOMENA)
    .sort((a, b) => (a[1].order ?? 99) - (b[1].order ?? 99))
    .map(([id, m]) => `<option value="${id}">${esc(m.name)}</option>`).join("");
  // いま見ている現象があれば、それを初期値に
  if (picked && S.PHENOMENA[picked]) $("photoPhenom").value = picked;
  if (round) $("photoPhenom").value = round.pid;

  const score = String(round ? Math.round(round.score) : 70);
  $("photoScore").value = score;
  $("photoScoreOut").textContent = score;
  $("photoNote").value = "";

  photoFillFromExif();
  showSheet($("photoSheet"));
}

/// 写真から読めたものを入力欄へ。**読めなければ既定を入れて、手で直せるようにする**
function photoFillFromExif() {
  const at = photoAt();
  const iso = (ms) => new Date(ms + tzOffsetMs()).toISOString().slice(0, 16);
  // 写真から時刻が読めればそれ、無ければ「いま」。どちらも過去へ直せる
  $("photoWhen").value = iso(at ?? photoDraft.round?.peak ?? Date.now());
  const r = photoDraft.exif;
  $("photoWhere").value = r && Number.isFinite(r.latitude)
    ? `${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}`
    : (place ? `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}` : "");
  // 入れた値の由来を覚える。保存時に入力欄と比べ、変わっていれば手入力とみなす（分析で既定値と本人の値を分けるため）
  photoDraft.filled = {
    when: { value: $("photoWhen").value,
      source: at !== null ? (r && r.takenAtMs !== null && r.takenAtMs !== undefined ? "exif_offset" : "exif_local_place_tz")
        : photoDraft.round?.peak ? "round_peak" : "default_now" },
    where: { value: $("photoWhere").value,
      source: r && Number.isFinite(r.latitude) ? "exif" : place ? "default_place" : "none" },
  };
  $("photoMeta").textContent = photoMetaText();
}

/// 画面で使っている時差。予報が返した地点の時差を使い、無ければ端末の時差
function tzOffsetMs() {
  return Number.isFinite(bundle?.utcOffsetSeconds)
    ? bundle.utcOffsetSeconds * 1000 : -new Date().getTimezoneOffset() * 60000;
}
/// 入力欄の日時 → 時刻。地点の時差で読む
function photoWhenMs() {
  const v = $("photoWhen").value;
  if (!v) return null;
  const naive = Date.parse(`${v}:00Z`);
  return Number.isFinite(naive) ? naive - tzOffsetMs() : null;
}
/// 入力欄の場所 → 座標。緯度経度でも地図のURLでもよい
function photoWhereAt() {
  const v = $("photoWhere").value.trim();
  if (!v) return null;
  return AstroNotesTerrain.parseLatLon(v) || AstroNotesTerrain.parseMapLink(v);
}

/// 写真から分かったことを1行で。**分からないものは「分かりません」と書く**
function photoMetaText() {
  if (!photoDraft.file) return "";
  const r = photoDraft.exif;
  const got = [];
  if (photoAt()) got.push("日時");
  if (r && Number.isFinite(r.latitude)) got.push("場所");
  if (r && Number.isFinite(r.altitudeM)) got.push(`標高 ${Math.round(r.altitudeM)}m`);
  const size = photoDraft.width ? `${photoDraft.width}×${photoDraft.height}` : "";
  return [got.length ? `写真から：${got.join("・")}` : "写真に日時と場所は入っていません", size]
    .filter(Boolean).join(" ・ ");
}
/// 撮影時刻。時差が入っていなければ、その地点の時差を当てる
function photoAt() {
  const r = photoDraft.exif;
  if (!r || !r.takenLocal) return null;
  if (r.takenAtMs !== null && r.takenAtMs !== undefined) return r.takenAtMs;
  const offsetMin = Number.isFinite(bundle?.utcOffsetSeconds) ? bundle.utcOffsetSeconds / 60 : null;
  return offsetMin !== null ? AstroNotesExif.instantFrom(r.takenLocal, offsetMin) : null;
}

/**
 * 保存時の分析（2026-10-16）。日時・場所・点数の由来、撮影の回の予報（事前／事後／なし）、色の帯をまとめる。
 * **何が起きても保存は止めない。** 失敗したら分析なし（null）で送る。
 * 設計: Vault 成果物/20261016_写真の保存時分析の設計案
 */
async function photoAnalysisFor(body, scoreSource, draft = photoDraft) {
  try {
    const A = AstroNotesPhotoAnalysis;
    const whenValue = draft.whenValue ?? $("photoWhen").value;
    const whereValue = draft.whereValue ?? $("photoWhere").value;
    const candidates = draft.candidates ?? forecastCandidates(body.phenomenon, body.takenAt);
    const color = draft.color || (draft.colorJob ? await draft.colorJob : null);
    const filled = draft.filled || {};
    const timeSource = A.inputSource(whenValue, filled.when);
    const locationSource = A.inputSource(whereValue, filled.where);
    const r = draft.exif;
    // 予報の欄の📷から開いたときは、その回を優先する（現象を選び直したら別の記録なので優先しない）
    const round = draft.round;
    const forecast = A.matchForecast(candidates, {
      takenAtMs: body.takenAt, latitude: body.latitude, longitude: body.longitude, timeSource, locationSource,
      selectedPeak: round && round.pid === body.phenomenon ? round.peak : null,
      algorithmVersion: AstroNotesPrediction.VERSION,
      distanceM: (a, b, c, d) => AstroNotesTerrain.distanceKm(a, b, c, d) * 1000,
    });
    const { analysis } = A.buildAnalysis({
      computedAt: Date.now(),
      web: document.querySelector('meta[name="app-version"]')?.content || null,
      entry: draft.round ? "answer_photo" : "record_sheet",
      input: { timeSource, locationSource, scoreSource,
        // 位置と標高は photos の列が正本なので、ここには有無だけ（重ねて残さない）
        exif: r ? { offsetKnown: r.offsetKnown ?? null, hasGps: !!r.hasGps, hasAltitude: Number.isFinite(r.altitudeM) } : null,
        original: draft.original },
      color, forecast,
    });
    return analysis;
  } catch (e) {
    console.warn("写真の分析を残せませんでした:", e);
    return null;
  }
}
/**
 * 撮影の日の予報の候補。端末に残した回（sorami.rounds）と、いま画面にある予報。
 * 事前か事後かは matchForecast が「保存した時刻が時間帯の開始より前か」で決める。
 */
function forecastCandidates(pid, takenAt) {
  if (!Number.isFinite(takenAt) || !S.PHENOMENA[pid]) return [];
  const out = [];
  for (const r of store.get("sorami.rounds", [])) {
    if (!r || r.pid !== pid || !Number.isFinite(r.peak) || !S.JstCal.sameDay(r.peak, takenAt)) continue;
    out.push({ origin: "round", capturedAt: r.capturedAt, peak: r.peak, window: r.window, score: r.score, rank: r.rank,
      confidence: r.confidence, perModel: r.perModel, factors: r.factors, observations: r.observations || null,
      placeId: r.placeId ?? null, latitude: r.latitude, longitude: r.longitude, algorithmVersion: r.algorithmVersion ?? null });
  }
  if (bundle && place) {
    const row = (weeks[pid] || []).find((e) => e && S.JstCal.sameDay(e.evaluation?.peak ?? e.dayMs, takenAt));
    const ev = row && !row.evaluation?.unavailable ? row.evaluation : null;
    const obs = collectObservations(pid, takenAt);
    const hasObs = Object.keys(obs).some((k) => !k.startsWith("_"));
    if (ev || hasObs) {
      out.push({ origin: "current", capturedAt: bundle.fetchedAt, peak: ev?.peak ?? null, window: ev?.window ?? null,
        score: Number.isFinite(ev?.score) ? ev.score : null, rank: ev?.rank?.key ?? null, confidence: ev?.confidence?.key ?? null,
        perModel: ev?.perModel ?? null, factors: ev?.factors ?? null, observations: hasObs ? obs : null,
        placeId: place.id ?? null, latitude: place.latitude, longitude: place.longitude });
    }
  }
  return out;
}

/**
 * 写真の時刻・位置を、その回の記録に足す形へ。**入力欄が正本**（写真から入れた値も手で直したらそちら）。
 *
 * 写真の標高から「地上何mで撮ったか」も出す。
 * **写真の GPSAltitude は Geolocation API の高度とは別物。**
 * 前者は標高（ジオイド補正済み）、後者は仕様どおり楕円体高で、
 * 日本ではジオイドぶん 32〜38m ずれる。実測（iPhone・庄内）では
 * 写真の標高 27.8m に対し DEM 29.2m で **1.4m** しか違わなかった
 * （同じ端末のライブ高度は 31.8m ずれていた）。
 * ただし**1枚での確認**なので、これだけで設定を書き換えず、食い違いを知らせるに留める。
 * 時刻が分かると、採点の時間帯の中で撮られたかが分かる（雲海の正例162日のうち44日は窓の外で撮られていた。02_検証結果）
 */
async function photoShot(body, r = photoDraft.exif) {
  let aglM = null;
  if (Number.isFinite(body.altitude) && Number.isFinite(body.latitude)) {
    const g = await groundAt(body.latitude, body.longitude);
    if (g !== null) aglM = body.altitude - g;
  }
  return { observedAtMs: body.takenAt, observedOffsetKnown: r ? r.offsetKnown : null,
    photoLatitude: body.latitude, photoLongitude: body.longitude, photoAltitudeM: body.altitude, photoAglM: aglM };
}
$("photoPick").onclick = () => openPhotoSheet(null);
$("photoClose").onclick = () => { if (!photoSaving) $("photoSheet").close(); };
$("photoSheet").addEventListener("cancel", (e) => { if (photoSaving) e.preventDefault(); });
$("photoSheet").addEventListener("close", () => { ++photoSheetGeneration; ++photoAttachGeneration; photoDraft.round = null; });
$("photoChoose").onclick = (e) => { e.preventDefault(); $("photoFile").click(); };
$("photoFile").onchange = async () => {
  const f = $("photoFile").files && $("photoFile").files[0];
  $("photoFile").value = "";                 // 同じ写真をもう一度選べるように
  if (!f) return;
  if (!await photoAttach(f)) return;
  photoFillFromExif();                       // 写真から読めたもので入力欄を入れ直す
};
$("photoScore").oninput = () => { $("photoScoreOut").textContent = $("photoScore").value; photoDraft.scoreMoved = true; };
$("photoSave").onclick = async (e) => {
  e.preventDefault();
  if (photoSaving || photoDraft.loading) return;
  if (photoDraft.ownerToken !== undefined && photoDraft.ownerToken !== auth?.token) {
    photoDraft.thumb = null; photoDraft.tile = null; $("photoPreview").src = "";
    $("photoSheet").close(); return;
  }
  // 写真の読込みが完了してから保存する。
  if (!photoDraft.thumb) {
    $("photoErr").textContent = photoDraft.file ? "この写真は読み込めませんでした。別の写真を選んでください" : "写真を選んでください";
    $("photoErr").hidden = false;
    return;
  }
  const r = photoDraft.exif;
  const where = photoWhereAt();
  // **入力欄が正本。** 写真から入れた値も、手で直したらそちらを使う
  const body = {
    phenomenon: $("photoPhenom").value,
    score: Number($("photoScore").value),
    takenAt: photoWhenMs(),
    latitude: where ? where.latitude : null,
    longitude: where ? where.longitude : null,
    altitude: r && Number.isFinite(r.altitudeM) ? r.altitudeM : null,
    placeName: place?.name || null,
    note: $("photoNote").value.trim() || null,
    thumb: photoDraft.thumb, tile: photoDraft.tile,
    width: photoDraft.width, height: photoDraft.height,
  };
  const generation = photoSheetGeneration, account = accessState.generation, token = auth?.token;
  const draft = { ...photoDraft, round: photoDraft.round ? { ...photoDraft.round } : null,
    whenValue: $("photoWhen").value, whereValue: $("photoWhere").value,
    candidates: forecastCandidates(body.phenomenon, body.takenAt), place: { ...place } };
  const current = () => generation === photoSheetGeneration && account === accessState.generation && token === auth?.token;
  const controls = ["photoSave", "photoClose", "photoChoose", "photoFile", "photoWhen", "photoWhere", "photoPhenom", "photoScore", "photoNote"];
  photoSaving = true;
  for (const id of controls) $(id).disabled = true;
  try {
    // 点数の由来。動かしたら本人の点、動かしていなければ開いたときの初期値の由来（分析のモジュールに頼らず決める）
    const scoreSource = draft.scoreMoved ? "user_moved" : draft.scoreInitial;
    body.analysis = await photoAnalysisFor(body, scoreSource, draft);
    if (!current()) return;
    await apiTransport("POST", "/photos", body);
    // 「実際はどうでしたか？」から開いたときは、その回の答え（この点数）と写真の時刻・位置も記録する。
    // 現象を選び直したら、その回とは別の記録なので答えにしない。
    // **予報の点数のまま保存したら答えにしない**（2026-10-16。以前は予報の点が本人の答えとして入っていた）。
    // 答え済みの回には写真の時刻・位置だけを足し、まだ答えていない回は答えられるよう残す
    if (!current()) return;
    const round = draft.round;
    if (round && body.phenomenon === round.pid && samePlaceAs(draft.place, place)) {
      const shot = await photoShot(body, draft.exif);
      if (!current() || !samePlaceAs(draft.place, place)) return;
      if (scoreSource === "user_moved" || scoreSource === "answered") recordAnswer(round.pid, round.peak, body.score, shot);
      else {
        const existing = findSighting(round.pid, round.peak);
        if (existing) recordAnswer(round.pid, round.peak, existing.actualScore, shot);
      }
    }
    photoDraft.round = null;
    $("photoSheet").close();
    await loadPhotos();
  } catch (err) {
    if (!current()) return;
    $("photoErr").textContent = err.message || "保存できませんでした";
    $("photoErr").hidden = false;
  } finally {
    photoSaving = false;
    for (const id of controls) $(id).disabled = false;
  }
};

let photos = [];
let photosRequest = 0, photosCursor = null, photosLoading = false, photosError = null;
let photosOwner = null, photosRetryAppend = false;
$("photoListMore").onclick = () => loadPhotos(true);
$("photoListRetry").onclick = () => loadPhotos(photosRetryAppend);
function renderPhotoListState() {
  $("photoListStatus").hidden = !photosLoading && !photosError;
  $("photoListStatus").textContent = photosError || (photosLoading ? "写真を読み込んでいます…" : "");
  $("photoListRetry").hidden = !photosError;
  $("photoListRetry").disabled = photosLoading;
  $("photoListMore").hidden = !photosCursor;
  $("photoListMore").disabled = photosLoading;
}
async function loadPhotos(append = false) {
  const request = ++photosRequest, token = auth?.token;
  if (token !== photosOwner) { photos = []; photosCursor = null; photosOwner = token; }
  if (!renderToolAccess("answers")) {
    photos = []; photosCursor = null; photosLoading = false; photosError = null;
    renderPhotos(); renderPhotoListState(); return;
  }
  photosRetryAppend = append;
  const cursor = append ? photosCursor : null;
  photosLoading = true; photosError = null; renderPhotoListState();
  try {
    const response = await apiTransport("GET", "/photos" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""));
    if (request !== photosRequest || token !== auth?.token || !toolAllowed("records")) return;
    const incoming = response.photos || [];
    photos = append ? [...new Map([...photos, ...incoming].map((p) => [p.id, p])).values()] : incoming;
    photosCursor = response.nextCursor || null;
  } catch (e) {
    if (request !== photosRequest || token !== auth?.token) return;
    if (e?.status === 403 || e?.status === 401) { photos = []; photosCursor = null; }
    if (e?.status === 403) void recheckAccess(0);
    photosError = "写真を読み込めませんでした。回線を確認して、もう一度お試しください。";
  } finally {
    if (request === photosRequest && token === auth?.token) {
      photosLoading = false; renderPhotos(); renderPhotoListState();
    }
  }
}
function renderPhotos() {
  const host = $("photoList");
  if (!host) return;
  host.innerHTML = photos.map((p) => {
    const when = p.taken_at ? `${S.Cal.monthDay(p.taken_at)}` : "";
    const name = S.PHENOMENA[p.phenomenon] ? S.PHENOMENA[p.phenomenon].name : p.phenomenon;
    // 写真の無い記録は空箱に見えるので、現象の印で埋める
    //（絵文字は現象の識別にだけ使う＝ここは識別なので使ってよい）
    return `<div class="ph-card${p.tile ? "" : " noimg"}">
      ${p.tile
        ? `<img src="${esc(p.tile)}" alt="${esc(name)} ${p.score}点" loading="lazy">`
        : `<div class="ph-blank" aria-hidden="true">${S.PHENOMENA[p.phenomenon] ? iconFor(p.phenomenon, p.taken_at || undefined, { observer: Number.isFinite(p.latitude) && Number.isFinite(p.longitude) ? p : null }) : "・"}</div>`}
      <button class="tap ph-del" data-photo-del="${esc(p.id)}" aria-label="この写真を消す">✕</button>
      <div class="ph-tag"><span>${esc(name)}</span><span>${p.score}点</span></div>
      ${when ? `<div class="ph-tag" style="bottom:auto;top:0"><span>${esc(when)}</span></div>` : ""}
    </div>`;
  }).join("");
  for (const el of host.querySelectorAll("[data-photo-del]")) {
    el.onclick = async () => {
      if (!confirm("この写真の記録を消します。よろしいですか？")) return;
      try { await apiTransport("POST", "/photos/delete", { id: el.dataset.photoDel }); await loadPhotos(); }
      catch (err) { alert(err.message || "消せませんでした"); }
    };
  }
}

function wireOutcomes(root) {
  // **記録もログインして使う。** サーバーに持つものなので、
  // 端末にだけ貯めて消えるより、入口で止めて案内したほうがよい
  for (const box of root.querySelectorAll(".answer")) {
    const pid = box.dataset.pid, peak = +box.dataset.peak, pred = +box.dataset.pred;
    const gauge = box.querySelector("[data-gauge]"), out = box.querySelector("[data-gauge-out]");
    const save = box.querySelector('[data-answer="save"]');
    gauge.oninput = () => {
      box.dataset.gaugeMoved = "1";          // 写真の点数の由来に使う（2026-10-16）
      out.innerHTML = answerHtml(pid, +gauge.value, pred);
      const same = box.dataset.recorded !== "" && +gauge.value === +box.dataset.recorded;
      save.disabled = same;
      save.textContent = same ? "記録済み" : "この点で記録";
    };
    for (const b of box.querySelectorAll("[data-answer]")) {
      b.onclick = () => {
        if (!requireLogin("記録")) return;
        const k = b.dataset.answer;
        if (k === "diff") {
          // 違った → ゲージを出す（記録はまだしない）
          for (const x of box.querySelectorAll(".outcome button")) x.classList.toggle("on", x === b);
          box.querySelector(".answer-gauge").hidden = false;
          return;
        }
        recordAnswer(pid, peak, k === "same" ? pred : k === "save" ? +gauge.value : null);
      };
    }

  }
}
export {loadPhotos,photos,photosCursor,photosError,photosLoading,photosOwner,photosRequest,renderPhotoListState,renderPhotos,wireOutcomes};
