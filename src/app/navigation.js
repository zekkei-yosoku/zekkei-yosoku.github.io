function routeFromHash() {
  if(location.hash.startsWith('#p=')){
    let token='';try{token=decodeURIComponent(location.hash.slice(3));}catch{/* Malformed escapes are not a shared route. */}
    if(/^[\w.,\/-]{1,8000}$/.test(token))history.replaceState(history.state,'',location.pathname+location.search+'#/aim?plan='+token);
  }
  if(location.hash === "#/explore") return {skymap:true};
  if (location.hash === "#/almanac") return { almanac: true };
  if (location.hash.includes("?plan=")) {
    const hash = location.hash.split("?")[0];
    if (hash === "#/aim") return { aim: true };
    const shared = /^#\/([A-Za-z]+)\/(\d+)$/.exec(hash);
    if (shared && S.PHENOMENA[shared[1]]) return { id: shared[1], dayMs: Number(shared[2]) };
  }
  if (location.hash === "#/skymap") return { skymap: true };
  if (location.hash === "#/records") return { records: true };
  if (location.hash === "#/answers" || location.hash === "#/forecast/results") return { answers: true };
  if (location.hash === "#/aim") return { aim: true };
  // メニューから来たときは、何を狙うかが決まっている（目標と天体を先に入れる）
  const am = /^#\/aim\/(fuji|diamond|pearl|tower)$/.exec(location.hash);
  if (am) return { aim: true, preset: am[1] };
  if (location.hash === "#/plane") return { plane: true };
  if (location.hash === "#/iss") return { iss: true };
  if (location.hash === "#/iss/pick") return { iss: true, issPick: true };   // 以前の衛星を選ぶの道（今はページを重ねる。openIss）
  if (location.hash === "#/admin") return { admin: true };
  const m = /^#\/([A-Za-z]+)(?:\/(\d+))?$/.exec(location.hash);
  // **`SCORERS` ではなく `PHENOMENA` で見る。**
  // 富士山と月は core が採点しない（astronotes-fuji / astronotes-moon が採点して
  // `weeks` へ入れる）ので、`SCORERS` に無い。ここで弾くと詳細が開かない。
  if (!m || !S.PHENOMENA[m[1]]) return null;
  return { id: m[1], dayMs: m[2] ? Number(m[2]) : null };
}

/// 詳細へ進む。日を指定しなければ直近の回に合わせる。
function pick(id, now, dayMs) {
  const u = upcoming(weeks[id], now);
  const day = dayMs !== undefined && dayMs !== null ? dayMs : (u ? u.dayMs : null);
  pushRoute(day !== null ? `#/${id}/${day}` : `#/${id}`);
}

/// 画面を進める。**履歴の1つ1つに「一覧から何画面目か」（depth）を持たせる。**
///
/// 以前は進めた回数を変数で数えていたが、ブラウザの戻る・進むでは減らず、
/// 同じ画面をメニューから開き直すと履歴は増えないのに数だけ増えた。
/// 数がずれると、一覧へ戻るつもりでアプリの外まで戻ってしまう。
/// 履歴そのものに持たせれば、戻る・進むでも必ず合う。
///
/// **ホーム画面に置いた iPhone のアプリでは、ブラウザの履歴を積まない**（2026-10-02 ユーザー「縁を内側にスライドさせたら、
/// 戻る・進むを無効化しないとメニューが開かないことあるぞ」）。履歴があると、左の端からなぞったとき iOS の「戻る」が先に取り、
/// メニューが開かない（一覧では開く＝戻る先が無いとき）。ページから iOS の戻る・進むは止められないので、戻る先を作らない。
/// ひとつ前の画面はアプリの中で覚える（appTrail）。Safari のタブでは今までどおり積む（Safari の戻るボタンで戻れるように）。
/// Android はホーム画面のアプリでも端のなぞりが OS の「戻る」なので積む（積まないとアプリから出てしまう）
const NO_HISTORY = navigator.standalone === true;
const appTrail = [];   // NO_HISTORY のときの来た道（前の画面の hash。一覧は ""）
function pushRoute(hash) {
  closeTools();
  // 選択のページを閉じて戻している途中なら、戻し終えてから移る（globalThis: 検査で関数だけを取り出して動かすときにも落ちない）
  if (globalThis.pagePop?.n) { afterPagePop(() => pushRoute(hash)); return; }
  if (location.hash === hash) return;
  if (NO_HISTORY) {
    appTrail.push(location.hash);
    history.replaceState({ depth: appTrail.length }, "", hash);
  } else {
    const depth = ((history.state && history.state.depth) || 0) + 1;
    history.pushState({ depth }, "", hash);
  }
  applyRoute();   // pushState・replaceState は hashchange を起こさない
}

/// 一覧へ戻る。**何画面進んでいても一度で戻る**（2026-10-01）。
/// 1つずつ戻していたので、一覧→詳細→道具と進んでから題名を押すと詳細で止まっていた。
/// 戻った先が一覧でなければ（詳細のURLを直接開いてから進んだ場合）、そこを一覧に置き換える。
/// 履歴は増やさない（増やすと、一覧でブラウザの戻るを押したときに道具の画面へ戻ってしまう）。
/// ひとつ前の画面へ。前がアプリの中に無ければ（URL を直接開いた画面）一覧へ
function isMenuPage() {
  const r = routeFromHash();
  return !r || !!(r.almanac || r.aim || r.skymap || r.plane || r.iss || r.records || r.answers);
}
function goBack() {
  if (globalThis.pagePop?.n) { afterPagePop(goBack); return; }
  if (NO_HISTORY) {
    const prev = appTrail.pop();
    if (!prev) { goList(); return; }
    history.replaceState({ depth: appTrail.length }, "", prev);
    applyRoute();
    return;
  }
  if ((history.state && history.state.depth) > 0) history.back();
  else goList();
}

let toListAfterBack = false;
function goList() {
  if (NO_HISTORY) appTrail.length = 0;
  const depth = NO_HISTORY ? 0 : (history.state && history.state.depth) || 0;
  if (depth > 0) { toListAfterBack = true; history.go(-depth); return; }
  if (routeFromHash()) { history.replaceState(null, "", location.pathname + location.search); applyRoute(); }
}

function applyRoute() {
  if (restoreSharedPlan() === "reload") { load(true); return; }
  const route = routeFromHash();
  const enteringHome=!!route?.almanac&&!atAlmanac;
  atAlmanac = !!route?.almanac;
  if(enteringHome&&globalThis.AstroNotesAlmanacDashboard?.enter())almanacDay=AstroNotesHomeTime.start(Date.now());
  if(!atAlmanac){almanacPlayback?.stop(false);almanacTimeline?.stop();globalThis.AstroNotesAlmanacDashboard?.stop();}
  picked = route && route.id ? route.id : null;
  const wasAnswers=atAnswers;
  atRecords = !!(route && route.records);
  atAnswers = !!route?.answers;
  if(!wasAnswers||!atAnswers)$("answerHistory").open=false;
  if (atAnswers) loadPhotos();
  atAdmin = !!(route && route.admin);
  if(atAim!==!!(route&&route.aim))aimCustomRequest++;
  atAim = !!(route && route.aim);
  if (!atAim) aim.pendingModelPreset = null;
  atSkyMap = !!route?.skymap;
  if (!atSkyMap) SkyMapUI?.leave();
  atPlane = !!(route && route.plane);
  atIss = !!(route && route.iss);
  if (atAim) openAim(route.preset || null);
  if (!atAdmin && typeof clearAdminView === "function") clearAdminView();
  if (atPlane) openPlane();
  if (atIss) openIss();
  if (atAdmin) renderAdmin();
  if (route && route.id) {
    // 日を含まない URL は「直近の回」を指す。前に見ていた日を残すと、
    // #/sunset を開いたのに数日先が出るという食い違いになる。
    if (route.dayMs !== null) selectedDay[route.id] = route.dayMs;
    else delete selectedDay[route.id];
  }
  // 一覧を離れる前に位置を憶える（メニューから道具を開いたときも、ブラウザの戻る・進むでも）
  if (currentView === "list") listScrollY = window.scrollY;
  render();
  if (atSkyMap) SkyMapUI?.open();
  if (predictionNeeded() && (predictionDirty || !AstroNotesPrediction.fresh(acceptedPrediction, place, Date.now()))) void load(false);
  // 2026-10-15 ユーザー「AstroNotesに切り替えたら一番上のタイトルも変えて。ロゴもある」。FramingとMap（メニューのAstroNotes）を開いている間は題名とマークをAstroNotesに
  const astroNotes = atAim || atSkyMap;
  if (astroNotes) try { localStorage.setItem("sorami.astroLast", atSkyMap ? "skymap" : "aim"); } catch {}
  $("mastheadName").textContent = "AstroNotes";
  $("mastheadMark").hidden = true; $("mastheadAstroMark").hidden = false;
  $("mastheadName").hidden = true;
  $("homeLink").setAttribute("aria-label", "AstroNotes：ホームへ戻る");
  // 画面が入れ替わるので位置を戻す。一覧は元いた位置へ、ほかの画面は先頭から。
  // 以前は「詳細と記録だけ先頭」としていたので、道具の画面が一覧の途中の位置で開いていた（2026-10-01）
  window.scrollTo(0, currentView === "list" ? listScrollY : 0);
  globalThis.TrialExplore?.routeChanged();
}
// アプリの中のリンク（#/capCloud など）も pushRoute で進める。リンクのまま進むと、深さを持たない履歴が積まれ
// （「← 戻る」が一覧まで飛ぶ）、ホーム画面のアプリでは iOS の戻るが端のなぞりを取る
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest('a[href^="#/"]');
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  pushRoute(a.getAttribute("href"));
});
window.addEventListener("hashchange", () => {
  closeTools();
  if (toListAfterBack) {
    toListAfterBack = false;
    if (routeFromHash()) history.replaceState(null, "", location.pathname + location.search);
  }
  applyRoute();
});

// 記録へ進む。一覧の位置を覚えておき、戻るで返す。

// いちばんの狙いめ。【押せない】ただの案内にしてある。
//
// 以前はカードごと押すとその現象へ飛んでいたが、見た目が情報カードなので
// 押すつもりのない場所で画面が変わっていた。押せるのは日のボタンだけにする。
// 1行で「この現象・この日・この評価」を出す。見どころにも、先の予定にも使う。
