import {$,S} from '../../ui/presentation-helpers.js';
import {createForecastRetry,extrasRetry,place} from '../../app/browser-state.js';
import {forecastSummary} from './view.js';
import {applyRoute,routeFromHash} from '../../app/navigation.js';
import {renderSkeleton} from './detail.js';
import {keepRounds} from '../results/controller.js';
let bundle = null;       // 取得済みの予報
let weeks = {};          // phenomenon → [{dayMs, evaluation}]
let forecastDays = [], predictionPlace = null;
let predictionLoadSeq = -1;
let extraSeq = AstroNotesLibrary.gate();            // 地点を切り替えたときに、遅れて来た結果を捨てる
// ---------------------------------------------------------------- 読み込み
let predictionDirty = true, activePredictionKey = null, acceptedPrediction = null;
const predictionKeyFor = p => JSON.stringify([p.latitude,p.longitude,p.elevation??null,p.eyeHeightAGL??1.5,p.terrain??null]);
const predictionNeeded = () => { const r = routeFromHash(); return !r || !!r.id; };
function renderPredictionProgress(progress,seq){
 if(!loadSeq.current(seq)||!predictionNeeded())return;
 const message=$("predictionProgressMessage"),bar=$("predictionProgressBar"),fill=$("predictionProgressFill");if(!message||!bar||!fill)return;
 if(!['prepare','fetch','calculate','finish','cached'].includes(progress?.phase))return;
 const n=progress.completed,total=progress.total,known=['fetch','calculate'].includes(progress.phase)&&Number.isInteger(n)&&Number.isInteger(total)&&total>0&&n>=0&&n<=total;
 if(known){const percent=(progress.phase==='fetch'?n/total*6:6+n/total*8)/14*100;bar.removeAttribute('data-indeterminate');bar.setAttribute('aria-valuenow',String(Math.round(percent)));fill.setAttribute('style',`transform:scaleX(${percent/100})`);}
 else if(progress.phase==='finish'){bar.removeAttribute('data-indeterminate');bar.setAttribute('aria-valuenow','100');fill.setAttribute('style','transform:scaleX(1)');}
 else{bar.setAttribute('data-indeterminate','');bar.removeAttribute('aria-valuenow');}
}
let loadSeq = AstroNotesLibrary.gate();         // 連続で地点や地形を変えたとき、古い応答を捨てるための連番
let predictionRetryContext = null;
const predictionRetry = createForecastRetry(() => {
  const retry = predictionRetryContext;
  if (!retry || !loadSeq.current(retry.seq) || predictionKeyFor(place) !== retry.key || !predictionNeeded()) {
    predictionRetry.reset(); predictionRetryContext = null; return;
  }
  void load(false, retry);
});
async function load(force, retry = null) {
  const requestKey = predictionKeyFor(place);
  // Only the timer for this forecast generation can continue its retry budget.
  if (retry && (retry !== predictionRetryContext || !loadSeq.current(retry.seq) || retry.key !== requestKey)) return;
  if (acceptedPrediction && predictionKeyFor(acceptedPrediction.place) !== requestKey) {
    bundle = null; weeks = {}; forecastDays = []; predictionPlace = null; acceptedPrediction = null;
    $("predictionDataNotice").hidden = true; $("predictionDataNotice").innerHTML = '';
  }
  if (!predictionNeeded()) {
    loadSeq.cancel(); extraSeq.cancel(); extrasRetry.reset(); activePredictionKey = null; predictionDirty = true;
    predictionRetry.reset(); predictionRetryContext = null;
    return;
  }
  if (activePredictionKey === requestKey) return;
  // applyRoute() runs again after each accepted DTO. Its pending-load guard above
  // must win before resetting, or a partial automatic retry gets a fresh budget.
  if (!retry) predictionRetry.reset();
  activePredictionKey = requestKey;
  predictionDirty = true;
  const seq = loadSeq.next();
  // The accepted same-place forecast remains on screen during a refresh. Its
  // Moon/Fuji work still belongs to it, even if the new main request fails.
  const preserveExtras = bundle && predictionPlace && predictionKeyFor(predictionPlace) === requestKey;
  if (!preserveExtras) { extraSeq.cancel(); extrasRetry.reset(); }
  predictionRetryContext = { seq, key: requestKey };
  const current = () => loadSeq.current(seq) && predictionNeeded() && predictionKeyFor(place) === requestKey;
  const forPlace = place;   // 取得開始時の地点で最後まで一貫して評価する
  $("status").hidden = false;
  // 実際の取得・計算の完了項目数を表示。残り時間の推定％は使わない。
  $("status").innerHTML = `<div class="note-wait"><span class="note-wait-character" aria-hidden="true"></span><div class="note-wait-message"><span id="predictionProgressMessage" aria-live="polite">予測中です</span>\
<div class="note-progress" id="predictionProgressBar" role="progressbar" aria-label="予測の進捗" aria-valuemin="0" aria-valuemax="100" data-indeterminate><span class="note-progress-fill" id="predictionProgressFill" aria-hidden="true"></span></div></div></div>`;
  $("bestNote").hidden = true;
  // 最初の1回だけ骨組みを出す。地点を変えたときは、前の表を残したほうが落ち着く
  if (!bundle) { forecastSummary?.waiting(); $("cards").innerHTML = renderSkeleton(Date.now()); }
  try {
    // 光害はその地点の素質なので予報と並行に取得する。取れなくても致命的ではない。
    const prediction = await AstroNotesPrediction.fetch(forPlace,S,{onProgress:progress=>renderPredictionProgress(progress,seq)});
    if (!current()) return;
    // Retire old extras only when replacing their forecast. The new accepted
    // generation lets kickExtras start once without waiting for the old job.
    extraSeq.cancel(); extrasRetry.reset();
    predictionDirty = false; acceptedPrediction = prediction;
    bundle = prediction.bundle;
    S.setTimezoneOffset(bundle.utcOffsetSeconds);
    forPlace.lightPollution = prediction.lightPollution;
    const notice = $("predictionDataNotice");
    const warnings = [];
    if (prediction.warnings?.sunward) warnings.push('太陽方向の予報を一部取得できませんでした。');
    if (prediction.warnings?.lightPollution) warnings.push('星空の光害データを取得できませんでした。');
    notice.hidden = !warnings.length;
    notice.innerHTML = warnings.length ? warnings.join('<br>') + '<button class="fav-btn" type="button">再取得</button>' : '';
    if (!notice.hidden) notice.querySelector('button').onclick = () => load(true);
    weeks = prediction.weeks;
    forecastDays = prediction.days || [];
    predictionPlace = prediction.place;
    predictionLoadSeq = seq;
    keepRounds(forPlace);
    if (Number.isFinite(prediction.retryAt)) predictionRetry.schedule(prediction.retryAt - prediction.asOf);
    else { predictionRetry.reset(); predictionRetryContext = null; }
    $("status").hidden = true;
    // 予報が揃ってから URL の場所を反映する。詳細のURLを直接開いた場合も
    // ここで初めてその現象を描ける。
    applyRoute();
  } catch (e) {
    if (!current()) return;
    // A retained forecast is still the accepted state. Internal navigation must
    // not turn a failed refresh into a new manual attempt and reset its budget.
    // TTL expiry remains the client's fresh() decision; a first load stays dirty.
    if (preserveExtras) predictionDirty = false;
    // A transient failure after a partial DTO still gets the remaining attempts.
    // Keep the accepted forecast and its pre-event records while waiting.
    if (retry) predictionRetry.schedule();
    $("status").hidden = false;
    // **短く書いて、押すものを大きく出す。** 以前は API の英語の理由をそのまま
    // 括弧に入れて出し（"Minutely API request limit exceeded..."）、再試行は
    // 文末の小さな文字だった。読んでも直しようがなく、押すものが見つからない
    // （2026-09-22 ユーザー指摘）。**できることは1つしかないので、それを主ボタンにする。**
    // 理由は console に残す（画面に出しても利用者にできることは変わらない）。
    console.warn("予測の取得に失敗:", e.message);
    // **このアプリが出すものは「予測」。** 材料にしている気象庁やECMWFのものが「予報」で、
    // 混ぜると、どちらの話をしているのか分からなくなる（2026-09-22 ユーザー指摘）。
    $("status").innerHTML = `<p class="warn" style="font-size:0.94rem;font-weight:700;margin-bottom:10px">`
      + `${navigator.onLine === false ? "通信が切れているようです" : "予測に失敗しました"}</p>`
      + `<button id="retry" class="fav-btn primary">再試行</button>`;
    $("retry").onclick = () => load(true);
    $("placeName").textContent = place.name;
  } finally {
    if (loadSeq.current(seq)) activePredictionKey = null;
  }
}

// アメダス実況。2026-10-20 からカードも取得もしない（ユーザー「実況カードは完全に消していい」。点数には使っていない）
export {acceptedPrediction,bundle,extraSeq,forecastDays,load,predictionDirty,predictionKeyFor,predictionLoadSeq,predictionNeeded,predictionPlace,weeks};
