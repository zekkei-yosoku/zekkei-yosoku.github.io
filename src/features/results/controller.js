import {$,RANK_COLOR,S,esc} from '../../app/presentation-helpers.js';
import {bundle,place,sightings,store,viewState,weeks} from '../../app/browser-state.js';
import {iconFor,render} from '../forecast/view.js';
import {navigationHistory} from '../../app/navigation.js';
import {toolAllowed} from '../account/session-and-access.js';
import {accountSync} from '../account/sync-bridge.js';
import {renderNotebook} from '../plans/controller.js';
// ---------------------------------------------------------------- 記録・校正
// 同じ地点かどうか。**名前では見分けられない。**「現在地」は移動先でも同じ名前になり、
// 同名の別地点で同じ日・同じ現象を記録すると、前の記録が上書きされていた（調査 C-5）。
// 記録した時点の座標は前から残してあるので、それを使う。
// 0.005度 ≒ 550m。GPSの揺れより十分大きく、別の地点より十分小さい。
function samePlaceAs(record, here) {
  if (Number.isFinite(record?.latitude) && Number.isFinite(record?.longitude)
      && Number.isFinite(here?.latitude) && Number.isFinite(here?.longitude)) {
    return Math.abs(record.latitude - here.latitude) < 0.005
        && Math.abs(record.longitude - here.longitude) < 0.005;
  }
  return record?.placeName === here?.name;   // 座標を持たない古い記録は名前で照合する
}
/**
 * **今日の回の予測を端末に残す**（2026-10-02 ユーザー「遡って記録とかできたら良い？」→「１も２もやろう」）。
 * 予報は毎回「今日から先」を取り直すので、残さないと前日の夕焼けに翌朝もう答えられなかった。
 * 残すのは**始まる前の予測**（始まってから計算し直した値で上書きしない。予測の振り返りは「見る前に出していた点」とするもの）。
 * 写真なしで答えられる（外れた日ほど写真を撮らないので、写真を必須にすると外れの記録が集まらない）。8日より古い回は捨てる
 */
const savedRoundClient = AstroNotesSavedRounds.createClient();
const ROUND_KEEP_MS = 8 * 86400000, ROUND_ANSWER_MS = 7 * 86400000, ROUND_MAX = 240;
function keepRounds(forPlace, now = Date.now()) {
  const today = S.Cal.startOfDay(now);
  const list = store.get("sorami.rounds", []).filter((r) => r && now - r.peak < ROUND_KEEP_MS);
  for (const [pid, entries] of Object.entries(weeks)) {
    for (const e of entries) {
      const ev = e.evaluation;
      // 今日と明日の回（明日の朝焼けを、明日アプリを開く前の予測で残す。開いたのが日の出のあとでも始まる前の予測になる）
      if (!ev || ev.unavailable || (e.dayMs !== today && e.dayMs !== S.Cal.addDays(today, 1)) || !Array.isArray(ev.window) || now >= ev.window[0]) continue;
      const i = list.findIndex((r) => r.pid === pid && samePlaceAs(r, forPlace) && S.JstCal.sameDay(r.peak, ev.peak));
      if (i >= 0 && now >= list[i].window[0]) continue;      // 始まったあとは上書きしない
      const snap = { pid, peak: ev.peak, capturedAt: now, latitude: forPlace.latitude, longitude: forPlace.longitude,
        placeName: forPlace.name, placeId: forPlace.id, score: ev.score, rank: ev.rank.key, confidence: ev.confidence.key,
        perModel: ev.perModel, factors: ev.factors, window: ev.window, specificTime: ev.specificTime,
        observations: collectObservations(pid, ev.peak), algorithmVersion: globalThis.AstroNotesPrediction?.VERSION ?? null };
      if (i >= 0) list[i] = snap; else list.push(snap);
    }
  }
  // 地点を何度も替えると増えるので、新しい順に上限まで（1件はおよそ4KB）
  list.sort((a, b) => b.peak - a.peak);
  store.set("sorami.rounds", list.slice(0, ROUND_MAX));
}
/// 残した回を、今の予報の回と同じ形に
const roundFromSnap = (r) => ({ pid: r.pid, predictionSource: r.predictionSource || null, observations: r.observations || null, ev: {
  peak: r.peak, score: r.score, rank: S.RANKS.find((x) => x.key === r.rank) || S.rankOf(r.score),
  confidence: { key: r.confidence }, perModel: r.perModel, factors: r.factors, window: r.window, specificTime: r.specificTime } });
/// 保存時刻が開始前と確認できる予測だけを予測の振り返りに使う。
/// 旧版の保存時刻不明な回は保持するが、事後予測との区別ができないので使わない。
function isPreEventRound(r) {
  return r && Number.isFinite(r.capturedAt) && Array.isArray(r.window) && r.capturedAt < r.window[0];
}
// 端末の開始前の予測を優先。近くの定番地点の予測は出典付きで補う。
function availableRoundSnaps(now = Date.now()) {
  const local = store.get("sorami.rounds", []).filter((r) => isPreEventRound(r) && samePlaceAs(r, place) && now - r.peak < ROUND_KEEP_MS);
  const server = savedRoundClient.state(place).rounds.filter((r) => isPreEventRound(r) && now - r.peak < ROUND_KEEP_MS &&
    !local.some((x) => x.pid === r.pid && S.JstCal.sameDay(x.peak, r.peak)));
  return [...local, ...server];
}
function roundOf(pid, peak) {
  const r = availableRoundSnaps().find((x) => x.pid === pid && S.JstCal.sameDay(x.peak, peak));
  return r ? roundFromSnap(r) : null;
}
/// 終了から7日以内、この地点の開始前に保存した回。
function answerableRounds(now) {
  return availableRoundSnaps(now).filter((r) => S.PHENOMENA[r.pid] && r.window[1] <= now && now - r.window[1] <= ROUND_ANSWER_MS).map(roundFromSnap);
}
function savedPredictionNote(source) {
  if (source?.kind !== "server" || typeof source.spotName !== "string" || !Number.isFinite(source.capturedAt) || !Number.isFinite(source.distanceKm)) return "";
  return `<span class="tiny sub-line" style="display:block;margin:4px 0">${esc(source.spotName)}の事前予測 ${Number.isFinite(source.score) ? Math.round(source.score) + "点・" : ""}${Math.round(source.distanceKm * 1000)}m先・${S.JstCal.monthDay(source.capturedAt)} ${S.JstCal.hhmm(source.capturedAt)}保存</span>`;
}
function savedRoundUnavailable() {
  const state = savedRoundClient.state(place);
  if (state.status === "loading" || state.status === "idle") return '保存した予測を確認しています…';
  if (state.status === "error") return `${esc(state.reason)}。<button type="button" class="fav-btn" data-retry-rounds>再取得</button>`;
  return `保存した予測がないため、結果を比べられません。${esc(state.reason || "この回の予測は保存されていません")}`;
}
function findSighting(pid, peak) {
  return sightings.find((s) => s.phenomenon === pid && samePlaceAs(s, place) && S.JstCal.sameDay(s.peak, peak));
}
/// 答えを記録する。actual は実際の点（0〜100）、null は確認せず。帯グラフの答えは点から出す（S.outcomeFromActual）。
/// **前の記録に付いている写真の時刻・位置は残す**（以前は答えるたびに作り直し、先に添えた写真の情報が消えていた）
function recordAnswer(pid, peak, actual, shot = null) {
  const round = roundOf(pid, peak);
  const existing = findSighting(pid, peak);
  if (!round && !existing) return;
  if (!existing && (round.ev.window[1] > Date.now() || Date.now() - round.ev.window[1] > ROUND_ANSWER_MS)) return;
  // 答え直しでも記録済みの予測を変えない。旧版の記録・写真も保持する。
  const ev = existing ? { ...round?.ev, ...existing, rank: S.rankOf(existing.score), confidence: { key: existing.confidence } } : round.ev;
  const a = Number.isFinite(actual) ? Math.max(0, Math.min(100, Math.round(actual))) : null;
  const record = { ...(existing || {}),
    id: existing?.id || crypto.randomUUID(),
    // 照合は placeName で行っている（findSighting）。名前は変えられるので、
    // 将来 ID で照合し直せるよう、記録した時点の地点IDも残しておく。
    recordedAt: Date.now(), phenomenon: pid, placeName: place.name, placeId: place.id,
    latitude: place.latitude, longitude: place.longitude,
    peak: ev.peak, score: ev.score, rank: ev.rank.key, confidence: ev.confidence.key,
    perModel: ev.perModel, factors: ev.factors, window: ev.window,
    actualScore: a, outcome: S.outcomeFromActual(pid, ev.score, a),
    // 取得時の気象値だけを保持。旧記録の欠測を今の予報で埋めない。
    predictionSource: existing ? existing.predictionSource || null : round.predictionSource || null,
    observations: existing ? existing.observations || {} : round.observations || {},
    ...(shot ? shotFields(ev, shot) : {}),
  };
  if (existing) sightings = sightings.map((s) => (s.id === existing.id ? record : s));
  else sightings.push(record);
  store.set("sorami.sightings", sightings);
  accountSync().queuePush("sight", record.id);
  render();
}
/// 写真の時刻・位置から、記録に足す項目（地点からの距離・採点の時間帯の外か）
function shotFields(ev, shot) {
  const far = (Number.isFinite(shot.photoLatitude) && Number.isFinite(shot.photoLongitude))
    ? AstroNotesTerrain.distanceKm(place.latitude, place.longitude, shot.photoLatitude, shot.photoLongitude) * 1000
    : null;
  // 旧記録は予測の窓が残っていないことがある。時間内だったとは断定しない。
  const outside = Array.isArray(ev.window) && Number.isFinite(shot.observedAtMs)
    ? (shot.observedAtMs < ev.window[0] || shot.observedAtMs > ev.window[1]) : null;
  return { ...shot, photoDistanceM: far, photoOutsideWindow: outside };
}

// 生の気象値を残す。閾値を変えたときに過去の記録を再採点できなければ校正のデータにならない。
function collectObservations(pid, peak) {
  if (!bundle) return {};
  const out = {};
  for (const [m, series] of Object.entries(bundle.home.byModel)) {
    for (const v of S.HOME_VARS) {
      if (!series.isSupported(v)) continue;
      const value = series.valueAt(v, peak);
      if (value !== null) out[`${v}@${m}`] = value;
    }
  }
  const offsets = pid === "sunrise" ? bundle.sunriseOffsets : bundle.sunsetOffsets;
  if (offsets) {
    for (const layer of S.CLOUD_LAYERS) {
      const loc = offsets[layer.key];
      if (!loc) continue;
      for (const [m, series] of Object.entries(loc.byModel)) {
        const value = series.valueAt(layer.variable, peak);
        if (value !== null) out[`${layer.variable}@${m}#sunward-${layer.key}`] = value;
      }
    }
  }
  out._grid_elevation = bundle.home.grid.elevation;
  return out;
}
// まだ答えていない、終わった回。
//
// 記録の操作は現象の詳細の中だけにあり、記録カードからは辿れなかった。
// カードに見えるボタンが「書き出し／読み込み」だけだったので、
// それが主要な操作に見えていた（実際そう受け取られた）。
// 答える場所をここに置く。アプリを開いて1タップで済む。
function renderPending(now, hidden) {
  const host = viewState.answers ? $("recordsPending") : $("recPending");
  (viewState.answers ? $("recPending") : $("recordsPending")).hidden = true;
  if (viewState.answers) hidden = !toolAllowed("records");
  if (!toolAllowed("records")) { host.hidden=true;host.innerHTML="";$("forecastResultsCount").hidden=true;$("forecastResultsCount").textContent="";return; }
  // 終わってから7日以内の回（端末に残した回を含む。keepRounds）。答えた回は出さない
  const out = answerableRounds(now).filter(({ pid, ev }) => !findSighting(pid, ev.peak))
    .map(({ pid, ev, predictionSource }) => ({ id: pid, ev, predictionSource, peak: ev.peak }));
  out.sort((a, b) => b.peak - a.peak);
  const state = savedRoundClient.state(place);
  const notice = (state.status === "loading" || state.status === "idle") ? `<p class="tiny" role="status">保存した予測を確認しています…</p>` : state.status === "error" ? `<p class="tiny" role="status">${savedRoundUnavailable()}${state.rounds.length ? "（取得済みの予測で結果を残せます）" : ""}</p>` : state.status === "ready" && !out.length && state.reason && state.reason !== "近くに保存対象の地点がありません" ? `<p class="tiny" role="status">${esc(state.reason)}</p>` : "";
  const count=$("forecastResultsCount");count.hidden=!out.length;count.textContent=out.length?String(out.length):"";
  if (!viewState.answers) { host.hidden=true;host.innerHTML="";return; }
  $("answersPendingCount").textContent=out.length?`${out.length}件`:"";
  $("answersEmpty").hidden=!!out.length||!!notice||state.status==='loading'||state.status==='idle';
  host.hidden = hidden || (!out.length && !notice);
  if (!out.length) { host.innerHTML = notice; return; }

  // 現象で訊きたいことが違うので、見出しは両方を包める言い方にする。
  host.innerHTML = `${notice}<div class="pending">

    ${out.map(({ id, ev, predictionSource }) => {
      const meta = S.PHENOMENA[id], color = RANK_COLOR[ev.rank.key];
      return `<div class="pending-row">
        <div><span style="font-size:1.1rem">${iconFor(id, ev.peak)}</span>
          <strong>${S.longNameOf(id)}</strong>
          <span class="muted">${S.Cal.relativeDay(ev.peak, now)}${ev.specificTime === false ? "" : " " + S.Cal.hhmmRounded(ev.peak)}</span>
          ・<span style="color:${color}">${esc(S.phrasing(id, ev.rank).label)} ${Math.round(ev.score)}</span></div>
        ${savedPredictionNote(predictionSource)}
        ${outcomeButtons(id, ev.peak, ev.score, findSighting(id, ev.peak))}
      </div>`;
    }).join("")}
  </div>`;
}


document.addEventListener("click", (e) => {
  const answerEntry=e.target.closest?.('[data-open-answers]');
  if(answerEntry){navigationHistory.pushRoute('#/forecast/results');if(toolAllowed('records')&&answerEntry.hasAttribute('data-answer-history')){$('answerHistory').open=true;$('answerHistory').querySelector('summary').focus();}return;}
  if(e.target.closest?.('[data-open-forecast]')){navigationHistory.goList();return;}
  if (!e.target.closest?.("[data-retry-rounds]")) return;
  void savedRoundClient.ensure(place, () => render(), true);
  render();
});

// 結果の選択肢は予測内の「結果」タブだけで使う。
/**
 * 写真がどこで撮られたかを、**判断できる形で**言う。
 *
 * 距離を数字で出すだけだと、それが問題なのかどうかが読み手に伝わらない。
 * この記録は「この地点のこの回」に紐づいているので、遠くで撮った写真を付けると
 * **別の場所の空を、この地点の点数の証拠にしてしまう**。
 *
 * 目安（スマホの位置情報は水平で10m前後）:
 *   〜300m   同じ場所とみなす。むしろ「その場所で撮られている」という裏付け
 *   〜3km    同じ市街地。空の状態は近いが、地形の見え方は変わり得る
 *   3km〜    別の場所。記録の地点が違う可能性が高い
 */
function shotPlaceNote(s) {
  const d = s.photoDistanceM;
  if (!Number.isFinite(d)) {
    return `・<span style="color:var(--tertiary)">位置なし</span>`;
  }
  if (d <= 300) return "・この場所で撮影";
  if (d <= 3000) return `・${Math.round(d / 100) / 10}km 離れた場所`;
  return `・<strong style="color:var(--orange)">${d < 100000 ? Math.round(d / 1000) : Math.round(d / 1000)}km 離れた場所で撮影</strong>`;
}

/**
 * 写真の標高から出した「地上何m」と、いま選んでいる「立つ高さ」が食い違ったら知らせる。
 *
 * **書き換えない。** 写真の標高が DEM と1.4mで合った実測は1枚だけで、
 * これだけで設定を自動で変える根拠にはならない。気づける形にするところまで。
 */
function shotHeightNote(s) {
  const agl = s.photoAglM;
  if (!Number.isFinite(agl)) return "";
  const chosen = place.eyeHeightAGL ?? 1.5;
  // 20m は「5階建ての屋上」と「地面」を分ける線。写真の標高の誤差より十分大きい
  if (Math.abs(agl - chosen) < 20) return "";
  const near = AstroNotesTerrain.EYE_HEIGHT_PRESETS
    .reduce((a, b) => (Math.abs(b.m - agl) < Math.abs(a.m - agl) ? b : a));
  return `<div class="tiny shot-note">写真は<strong>地上 ${Math.round(agl)}m</strong>で撮られています`
    + `（いまの設定は「${esc(AstroNotesTerrain.EYE_HEIGHT_PRESETS.find((x) => x.m === chosen)?.label
        ?? chosen + "m")}」）。`
    + `近いのは「${esc(near.label)}」です。</div>`;
}

/**
 * 実際はどうだったかを答える部品。ホームと詳細で同じものを使う（選択肢がずれると同じ回に別々の答えが入る）。
 * **「予測通り」は1回押すだけ。違ったときだけゲージで何点だったかを選ぶ**（2026-10-02 ユーザー「選択式じゃなくて何点だったかを
 * ゲージで選ばせたら」「予測通りってボタンと、違うならゲージ」）。ゲージは予測の点から始め、予測の位置に印を置く。
 * 2026-10-28: 結果は点数評価を維持し、新規写真アップロード操作だけを外す。既存写真由来の記録は表示を維持する。
 */
function outcomeButtons(id, peak, predicted, sighting = null) {
  const shot = sighting && Number.isFinite(sighting.observedAtMs)
    ? `<div class="tiny shot-note">📷 ${S.JstCal.hhmmRounded(sighting.observedAtMs)} の写真`
      + shotPlaceNote(sighting)
      + `${sighting.photoOutsideWindow ? "・<strong>採点した時間帯の外</strong>" : ""}</div>`
      + shotHeightNote(sighting)
    : "";
  const pred = Math.round(predicted);
  const actual = sighting && Number.isFinite(sighting.actualScore) ? sighting.actualScore : null;
  // 前の記録（答えだけで点数の無いもの）は、予測通り・確認せずだけ押した形で出す
  const state = !sighting ? null
    : actual !== null ? (actual === pred ? "same" : "diff")
    : sighting.outcome === "asExpected" ? "same"
    : sighting.outcome === "unchecked" && !Number.isFinite(sighting.observedAtMs) ? "none" : null;
  const on = (k) => (state === k ? ' class="on"' : "");
  const v = actual ?? pred;
  // つまみの中心は端で半分ずれるので、予測の印もつまみの動く幅に合わせる（つまみ 28px）
  const at = `calc(${pred}% + ${(14 - pred * 0.28).toFixed(1)}px)`;
  // 記録した点のままなら「記録済み」（押せない）。ゲージを動かすと「この点で記録」に戻る。
  // 詳細の画面では記録しても同じ形で描き直されるので、これが無いと押しても何も変わらないように見えた
  //（2026-10-02 ユーザー「違ったを選んで点数を変えて、この点で記録を押しても何も変わらない」）
  const saved = state === "diff" && actual !== null;
  return `<div class="answer" data-pid="${id}" data-peak="${peak}" data-pred="${pred}" data-recorded="${saved ? actual : ""}">
    <div class="outcome">
      <button data-answer="same"${on("same")}>予測通り</button>
      <button data-answer="diff"${on("diff")}>違った</button>
      <button data-answer="none"${on("none")}>確認せず</button>
    </div>
    <div class="answer-gauge"${state === "diff" ? "" : " hidden"}>
      <div class="gauge-track"><span class="gauge-pred" style="left:${at}" aria-hidden="true"></span>
        <input type="range" min="0" max="100" step="1" value="${v}" data-gauge aria-label="実際は何点だったか"></div>
      <div class="gauge-foot"><output data-gauge-out>${answerHtml(id, v, pred)}</output>
        <button data-answer="save" class="fav-btn primary"${saved ? " disabled" : ""}>${saved ? "記録済み" : "この点で記録"}</button></div>
    </div>
    ${shot}
  </div>`;
}
/// ゲージの読み: 「52点・まずまず」と、その下に小さく「予測 74」（320px でも折り返しの位置が変わらないよう2行に決めておく）
const answerHtml = (id, v, pred) => `${v}点・${esc(S.actualWord(id, v))}<span class="tiny sub-line">予測 ${pred}</span>`;

function renderRecords(now, pendingHidden) {
  globalThis.MyPlacesUI?.renderRecordsHub?.();
  renderNotebook();
  renderPending(now ?? Date.now(), pendingHidden);
  if (!viewState.answers || !toolAllowed("records")) {
    for (const id of ['recList','calibration','recordsPending']) $(id).replaceChildren();
    $("recordsRoundPlace").textContent='';$("recCount").textContent='';$("answersPendingCount").textContent="";
    for(const id of ["answersEmpty","recEmpty","recBody"])$(id).hidden=true;
    $("answerHistory").open=false;
    return;
  }
  $("recordsRoundPlace").textContent = "見た空に近いものを選んでください。";
  const conclusive = sightings.filter((s) => s.outcome !== "unchecked");
  $("recCount").textContent = `${sightings.length}件`;
  // 記録がゼロのうちは、空の帯グラフを毎回出しても読むものがない。
  // 何をすれば貯まるかだけ書く。
  const empty = sightings.length === 0;
  $("recEmpty").hidden = !empty;
  $("recBody").hidden = empty;
  if (empty) return;

  $("calibration").innerHTML =
    qualityCalibration(conclusive.filter((s) => S.recordKind(s.phenomenon) === "quality"))
    + occurrenceCalibration(conclusive.filter((s) => S.recordKind(s.phenomenon) === "occurrence"));

  const LABEL = Object.fromEntries(
    [...S.RECORD_OUTCOMES.quality, ...S.RECORD_OUTCOMES.occurrence]);
  // 記録は読み込みで外から入ってくる。**外から来た文字をそのまま HTML へ入れない。**
  // `s.outcome` を素で埋めていたため、細工した JSON を読み込ませると任意の HTML が動いた
  // （2026-09-07 に実際に発火することを確認）。知らない現象は描かない（描くと落ちる）。
  $("recList").innerHTML = `<p class="tiny muted">すべての場所</p>`
    + ([...sightings].sort((a, b) => b.peak - a.peak).slice(0, 30).map((s) => {
      const meta = S.PHENOMENA[s.phenomenon];
      if (!meta) return "";
      return `
    <div class="list-item" style="display:flex;gap:8px;align-items:center">
      <span>${iconFor(s.phenomenon, s.peak)}</span>
      <span style="flex:1"><strong style="font-size:0.81rem">${S.JstCal.monthDay(s.peak)} ${esc(s.placeName)}</strong>
        <span class="tiny sub-line">${meta.name} ・ ${Math.round(s.score) || 0}点</span>${savedPredictionNote(s.predictionSource)}</span>
      <span class="badge" style="background:var(--line)">${Number.isFinite(s.actualScore) ? `実際 ${s.actualScore}点` : esc(LABEL[s.outcome] ?? s.outcome)}</span></div>`;
    }).join("")
    || `<p class="tiny" style="padding:8px 0">まだありません</p>`);
}

// 帯は 20点刻み。標本ゼロの帯は 0% ではなく「—」。
// データが無いことと、外れたことを区別する。
const BANDS = [0, 20, 40, 60, 80];
const inBand = (list, lo) => list.filter((s) => s.score >= lo && (s.score < lo + 20 || lo === 80));

// 出るか出ないかの現象。点数どおりの割合で出ていれば較正できている。
// 棒は単色。隣の質のグラフでは色が答えを表すので、同じ画面で色に2つの意味を持たせない。
function occurrenceCalibration(list) {
  if (!list.length) return "";
  const rows = BANDS.map((lo) => {
    const bin = inBand(list, lo), seen = bin.filter((s) => s.outcome === "seen").length;
    const rate = bin.length ? seen / bin.length : null, predicted = lo + 10;
    return `<div class="bin"><span class="lb">${lo}–${lo + 20}</span>
      <span class="bar">${rate !== null ? `<span class="fill" style="width:${rate * 100}%;background:var(--good)"></span>` : ""}
        <span class="mark" style="left:${predicted}%"></span></span>
      <span class="pv">${rate !== null ? Math.round(rate * 100) + "%" : "—"}</span>
      <span class="tiny" style="width:20px;text-align:right">${bin.length}</span></div>`;
  }).join("");
  return `<div class="section-h" style="margin-top:4px"><h2>出たかどうか</h2>
      <span class="muted">${list.length}件</span></div>
    <p class="tiny" style="margin:-2px 0 6px">雲海・霧氷・ダイヤモンドダスト・虹</p>
    <div class="bins">${rows}</div>
    <p class="tiny" style="margin-top:6px">棒＝実際に見えた割合 ／ 線＝点数どおりの水準</p>`;
}

// 質の現象。「見えたか」では何点でもほぼ100%になるので、
// 期待に対してどうだったかの内訳を見る。
function qualityCalibration(list) {
  if (!list.length) return "";
  const SEG = [["worse", "期待外れ", "var(--tertiary)"],
               ["asExpected", "予測通り", "var(--good)"],
               ["better", "期待以上", "var(--spectacular)"]];
  const rows = BANDS.map((lo) => {
    const bin = inBand(list, lo);
    const seg = bin.length ? SEG.map(([k, , color]) => {
      const n = bin.filter((s) => s.outcome === k).length;
      return n ? `<span class="seg" style="width:${n / bin.length * 100}%;background:${color}"></span>` : "";
    }).join("") : "";
    return `<div class="bin"><span class="lb">${lo}–${lo + 20}</span>
      <span class="bar">${seg}</span>
      <span class="pv">${bin.length ? "" : "—"}</span>
      <span class="tiny" style="width:20px;text-align:right">${bin.length}</span></div>`;
  }).join("");
  return `<div class="section-h" style="margin-top:4px"><h2>点数どおりだったか</h2>
      <span class="muted">${list.length}件</span></div>
    <p class="tiny" style="margin:-2px 0 6px">朝焼け・夕焼け・星空</p>
    <div class="bins">${rows}</div>
    <p class="tiny" style="margin-top:6px">
      <span style="color:var(--good)">■</span> 予測通り が多く、
      <span style="color:var(--tertiary)">■</span> 期待外れ と
      <span style="color:var(--spectacular)">■</span> 期待以上 が釣り合っていれば点数は合っています。
      期待外れ側に偏っていれば点数が甘く、期待以上側に偏っていれば辛いということ。</p>`;
}
export {answerHtml,collectObservations,findSighting,keepRounds,recordAnswer,renderRecords,roundOf,samePlaceAs,savedPredictionNote,savedRoundClient,savedRoundUnavailable};
