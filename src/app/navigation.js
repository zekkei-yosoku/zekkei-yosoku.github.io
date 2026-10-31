import {$,S} from './presentation-helpers.js';
import {SkyMapUI,aimCustomRequest,almanacDay,picked,place,selectedDay,viewState,weeks} from './browser-state.js';
import {acceptedPrediction,load,predictionDirty,predictionNeeded} from '../features/forecast/load.js';
import {currentView,render,upcoming} from '../features/forecast/view.js';
import {loadPhotos} from '../features/photos/controller.js';
import {almanacPlayback,almanacTimeline} from '../features/home/controller.js';
import {aim} from '../features/framing/controller.js';
import {openPlane} from '../features/aircraft/controller.js';
import {openIss} from '../features/satellites/controller.js';
import {openAim} from '../features/framing/reverse-and-entry.js';
import {closeTools} from '../features/account/session-and-access.js';
import {afterPagePop} from './overlays.js';
import {clearAdminView,renderAdmin} from '../features/account/admin-view.js';
import {restoreSharedPlan} from '../features/plans/controller.js';
let listScrollY = 0;     // 一覧へ戻ったときに元の位置へ戻す
/// 判定は AstroNotesNavigationRoutes（純粋）。旧共有URL #p= は読むたびに #/aim?plan= へ置き換えてから判定する（置き換え後の hash を読む）
/// メニューから来たときは、何を狙うかが決まっている（#/aim/fuji など。目標と天体を先に入れる）。#/iss/pick は以前の衛星を選ぶの道（今はページを重ねる。openIss）
/// **`SCORERS` ではなく `PHENOMENA` で見る。** 富士山と月は core が採点しない（astronotes-fuji / astronotes-moon が採点して
/// `weeks` へ入れる）ので、`SCORERS` に無い。ここで弾くと詳細が開かない。
function routeFromHash() {
  const legacy = AstroNotesNavigationRoutes.normalizeLegacyHash(location.hash);
  if (legacy !== null) history.replaceState(history.state, '', location.pathname + location.search + legacy);
  return AstroNotesNavigationRoutes.parseRoute(location.hash, () => S.PHENOMENA);
}

/// 詳細へ進む。日を指定しなければ直近の回に合わせる。
function pick(id, now, dayMs) {
  const u = upcoming(weeks[id], now);
  const day = dayMs !== undefined && dayMs !== null ? dayMs : (u ? u.dayMs : null);
  navigationHistory.pushRoute(day !== null ? `#/${id}/${day}` : `#/${id}`);
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
/// 来た道は AstroNotesNavigationHistory が単独で持つ。下の NO_HISTORY / appTrail は同じ値・同じ配列を指す読取口（写しではない）
const navigationHistory = AstroNotesNavigationHistory.createHistory({
  noHistory: navigator.standalone === true,
  get location() { return location; },
  get history() { return history; },
  closeTools: () => closeTools(),
  // 選択のページを閉じて戻している途中なら、戻し終えてから移る（globalThis: 検査で関数だけを取り出して動かすときにも落ちない）
  pagePop: () => globalThis.pagePop,
  afterPagePop: (run) => afterPagePop(run),
  applyRoute: () => applyRoute(),
  routeFromHash: () => routeFromHash(),
});

/// 一覧へ戻る。**何画面進んでいても一度で戻る**（2026-10-01）。
/// 1つずつ戻していたので、一覧→詳細→道具と進んでから題名を押すと詳細で止まっていた。
/// 戻った先が一覧でなければ（詳細のURLを直接開いてから進んだ場合）、そこを一覧に置き換える。
/// 履歴は増やさない（増やすと、一覧でブラウザの戻るを押したときに道具の画面へ戻ってしまう）。
/// ひとつ前の画面へ。前がアプリの中に無ければ（URL を直接開いた画面）一覧へ
function isMenuPage() {
  const r = routeFromHash();
  return !r || !!(r.almanac || r.aim || r.skymap || r.plane || r.iss || r.records || r.answers);
}


function applyRoute() {
  if (restoreSharedPlan() === "reload") { load(true); return; }
  const route = routeFromHash();
  const enteringHome=!!route?.almanac&&!viewState.almanac;
  viewState.almanac = !!route?.almanac;
  if(enteringHome&&globalThis.AstroNotesAlmanacDashboard?.enter())almanacDay=AstroNotesHomeTime.start(Date.now());
  if(!viewState.almanac){almanacPlayback?.stop(false);almanacTimeline?.stop();globalThis.AstroNotesAlmanacDashboard?.stop();}
  picked = route && route.id ? route.id : null;
  const wasAnswers=viewState.answers;
  viewState.records = !!(route && route.records);
  viewState.answers = !!route?.answers;
  if(!wasAnswers||!viewState.answers)$("answerHistory").open=false;
  if (viewState.answers) loadPhotos();
  viewState.admin = !!(route && route.admin);
  if(viewState.aim!==!!(route&&route.aim))aimCustomRequest++;
  viewState.aim = !!(route && route.aim);
  if (!viewState.aim) aim.pendingModelPreset = null;
  viewState.skyMap = !!route?.skymap;
  if (!viewState.skyMap) SkyMapUI?.leave();
  viewState.plane = !!(route && route.plane);
  viewState.iss = !!(route && route.iss);
  if (viewState.aim) openAim(route.preset || null);
  if (!viewState.admin && typeof clearAdminView === "function") clearAdminView();
  if (viewState.plane) openPlane();
  if (viewState.iss) openIss();
  if (viewState.admin) renderAdmin();
  if (route && route.id) {
    // 日を含まない URL は「直近の回」を指す。前に見ていた日を残すと、
    // #/sunset を開いたのに数日先が出るという食い違いになる。
    if (route.dayMs !== null) selectedDay[route.id] = route.dayMs;
    else delete selectedDay[route.id];
  }
  // 一覧を離れる前に位置を憶える（メニューから道具を開いたときも、ブラウザの戻る・進むでも）
  if (currentView === "list") listScrollY = window.scrollY;
  render();
  if (viewState.skyMap) SkyMapUI?.open();
  if (predictionNeeded() && (predictionDirty || !AstroNotesPrediction.fresh(acceptedPrediction, place, Date.now()))) void load(false);
  // 2026-10-15 ユーザー「AstroNotesに切り替えたら一番上のタイトルも変えて。ロゴもある」。FramingとMap（メニューのAstroNotes）を開いている間は題名とマークをAstroNotesに
  const astroNotes = viewState.aim || viewState.skyMap;
  if (astroNotes) try { localStorage.setItem("sorami.astroLast", viewState.skyMap ? "skymap" : "aim"); } catch {}
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
  navigationHistory.pushRoute(a.getAttribute("href"));
});
window.addEventListener("hashchange", () => {
  closeTools();
  navigationHistory.settleListAfterBack();
  applyRoute();
});

// 記録へ進む。一覧の位置を覚えておき、戻るで返す。

// いちばんの狙いめ。【押せない】ただの案内にしてある。
//
// 以前はカードごと押すとその現象へ飛んでいたが、見た目が情報カードなので
// 押すつもりのない場所で画面が変わっていた。押せるのは日のボタンだけにする。
// 1行で「この現象・この日・この評価」を出す。見どころにも、先の予定にも使う。
export {applyRoute,isMenuPage,navigationHistory,pick,routeFromHash};
