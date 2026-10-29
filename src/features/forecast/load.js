// ---------------------------------------------------------------- 読み込み
let predictionDirty = true, activePredictionKey = null, acceptedPrediction = null;
const predictionKeyFor = p => JSON.stringify([p.latitude,p.longitude,p.elevation??null,p.eyeHeightAGL??1.5,p.terrain??null]);
const predictionNeeded = () => { const r = routeFromHash(); return !r || !!r.id; };
function renderPredictionProgress(progress,seq){
 if(seq!==loadSeq||!predictionNeeded())return;
 const message=$("predictionProgressMessage"),bar=$("predictionProgressBar"),fill=$("predictionProgressFill");if(!message||!bar||!fill)return;
 if(!['prepare','fetch','calculate','finish','cached'].includes(progress?.phase))return;
 const n=progress.completed,total=progress.total,known=['fetch','calculate'].includes(progress.phase)&&Number.isInteger(n)&&Number.isInteger(total)&&total>0&&n>=0&&n<=total;
 if(known){const percent=(progress.phase==='fetch'?n/total*6:6+n/total*8)/14*100;bar.removeAttribute('data-indeterminate');bar.setAttribute('aria-valuenow',String(Math.round(percent)));fill.setAttribute('style',`transform:scaleX(${percent/100})`);}
 else if(progress.phase==='finish'){bar.removeAttribute('data-indeterminate');bar.setAttribute('aria-valuenow','100');fill.setAttribute('style','transform:scaleX(1)');}
 else{bar.setAttribute('data-indeterminate','');bar.removeAttribute('aria-valuenow');}
}
let loadSeq = 0;         // 連続で地点や地形を変えたとき、古い応答を捨てるための連番
async function load(force) {
  const requestKey = predictionKeyFor(place);
  if (acceptedPrediction && predictionKeyFor(acceptedPrediction.place) !== requestKey) {
    bundle = null; weeks = {}; forecastDays = []; predictionPlace = null; acceptedPrediction = null;
  }
  if (!predictionNeeded()) {
    ++loadSeq; ++extraSeq; extrasRetry.reset(); activePredictionKey = null; predictionDirty = true;
    return;
  }
  if (activePredictionKey === requestKey) return;
  activePredictionKey = requestKey;
  predictionDirty = true;
  const seq = ++loadSeq;
  ++extraSeq; extrasRetry.reset();
  const forPlace = place;   // 取得開始時の地点で最後まで一貫して評価する
  $("status").hidden = false;
  // 実際の取得・計算の完了項目数を表示。残り時間の推定％は使わない。
  $("status").innerHTML = `<div class="note-wait"><span class="note-wait-character" aria-hidden="true"></span><div class="note-wait-message"><span id="predictionProgressMessage" aria-live="polite">予測中です</span><div class="note-progress" id="predictionProgressBar" role="progressbar" aria-label="予測の進捗" aria-valuemin="0" aria-valuemax="100" data-indeterminate><span class="note-progress-fill" id="predictionProgressFill" aria-hidden="true"></span></div></div></div>`;
  $("bestNote").hidden = true;
  // 最初の1回だけ骨組みを出す。地点を変えたときは、前の表を残したほうが落ち着く
  if (!bundle) $("cards").innerHTML = renderSkeleton(Date.now());
  try {
    // 光害はその地点の素質なので予報と並行に取得する。取れなくても致命的ではない。
    const prediction = await AstroNotesPrediction.fetch(forPlace,S,{onProgress:progress=>renderPredictionProgress(progress,seq)});
    if (seq !== loadSeq) return;
    predictionDirty = false; acceptedPrediction = prediction;
    bundle = prediction.bundle;
    S.setTimezoneOffset(bundle.utcOffsetSeconds);
    forPlace.lightPollution = prediction.lightPollution;
    const notice = $("predictionDataNotice");
    notice.hidden = !prediction.warnings?.lightPollution;
    notice.innerHTML = prediction.warnings?.lightPollution ? '星空の光害データを取得できませんでした。<button class="fav-btn" type="button">再取得</button>' : '';
    if (!notice.hidden) notice.querySelector('button').onclick = () => load(true);
    weeks = prediction.weeks;
    forecastDays = prediction.days || [];
    predictionPlace = prediction.place;
    predictionLoadSeq = seq;
    keepRounds(forPlace);
    $("status").hidden = true;
    // 予報が揃ってから URL の場所を反映する。詳細のURLを直接開いた場合も
    // ここで初めてその現象を描ける。
    applyRoute();
  } catch (e) {
    if (seq !== loadSeq) return;
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
    // 予測を使わない画面（天体・飛行機・ISS・記録・管理）は、取れなくてもURLどおり開く。
    // 起動時の画面切替を予測の成功後にしか行っておらず、一時的な取得失敗で一覧に止まり、
    // 地点名も「…」のままだった（2026-10-05 iOS 27 の総点検で確認）。
    const route = routeFromHash();
    if (!bundle && route && !route.id) applyRoute();
    else $("placeName").textContent = place.name;
  } finally {
    if (seq === loadSeq) activePredictionKey = null;
  }
}

// アメダス実況。2026-10-20 からカードも取得もしない（ユーザー「実況カードは完全に消していい」。点数には使っていない）
