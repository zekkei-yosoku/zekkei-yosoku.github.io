// ---------------------------------------------------------------- ページとして開く選択画面（2026-10-21）
//
// ユーザー「メニューとかログインあたり以外はページ化するんじゃなかった？」→「ページ」と「短いシート」の2種類に決定。
// ページ: 探す・見る・選ぶ・入力する画面。全画面で開き、左上の「戻る」・ブラウザの戻る（iPhone のスワイプ）で閉じる。
// 短いシート: 数個から選ぶ・確認だけ（その他の天体・地図アプリで開く・時刻の操作設定・画角調整・日付）。
// メニュー・ログイン・アカウント・設定（メニューと対の右パネル）は今のまま。
// 中身と処理は各 dialog のまま、開き方だけ変える。下の画面は残るので、戻ると入力と位置が残る。
// 入力のページ（input）は、検索欄以外を書き換えたあとに戻ると「破棄しますか？」を出す。保存の釦で閉じるときは聞かない
const PAGE_DIALOGS = {
  placeSheet: {}, mapSheet: {}, aimLineSheet: {}, planSheet: {}, issPickSheet: {},
  previewBodyDialog: {}, skyMapBodyDialog: {},
  previewTargetDialog: { input: true }, photoSheet: { input: true }, skyMapTargetSheet: { input: true },
  favSheet: { ownConfirm: true }, myPlaceSheet: { ownConfirm: true }, myShapeSheet: { ownConfirm: true },
};
const pageStack = [];
// 「戻る」の釦などで閉じたぶんの履歴は、まとめて1回で戻す（続けて history.back() を呼ぶと取りこぼすブラウザがある）
// var: 画面の移動（pushRoute）は起動時にも呼ばれうるので、宣言より前に読んでも落ちないように
var pagePop = { n: 0, waiters: [], timer: 0, queued: false };
function pagePopFlush() {
  const n = pagePop.n;
  if (!n) return;
  history.go(-n);
  // popstate が来ないとき（履歴が無いなど）も待っている処理を止めない
  clearTimeout(pagePop.timer);
  pagePop.timer = setTimeout(pagePopDone, 600);
}
function pagePopDone() {
  clearTimeout(pagePop.timer);
  pagePop.n = 0;
  const w = pagePop.waiters.splice(0);
  for (const f of w) f();
}
/// 履歴を戻している途中なら、終わってから進める（戻っている間に画面を移ると、その移った先が戻されてしまう）
function afterPagePop(f) { if (pagePop.n) pagePop.waiters.push(f); else f(); }
const PAGE_BACK_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';
function preparePage(el) {
  if (el.dataset.page) return;
  el.dataset.page = "1";
  el.classList.add("as-page");
  const head = el.querySelector(":scope > .sheet-head");
  // 右上の「閉じる」「キャンセル」は隠して、その処理を左上の「戻る」から呼ぶ（各画面の閉じる処理をそのまま使う）
  const close = head && [...head.querySelectorAll(":scope > button")].pop();
  if (close) { close.hidden = true; close.dataset.pageClose = "1"; }
  const back = document.createElement("button");
  back.type = "button"; back.className = "page-back"; back.setAttribute("aria-label", "戻る");
  back.innerHTML = `${PAGE_BACK_ICON}<span>戻る</span>`;
  back.onclick = () => pageLeave(el);
  if (head) head.prepend(back);
  if (PAGE_DIALOGS[el.id].input) {
    // 検索欄と、その場で保存する欄（カテゴリを編集など data-no-dirty）は入力途中に数えない
    const mark = (e) => { if (!(e.target instanceof HTMLInputElement && e.target.type === "search") && !e.target.closest?.("[data-no-dirty]")) el.dataset.dirty = "1"; };
    el.addEventListener("input", mark, true);
    el.addEventListener("change", mark, true);
  }
  if (!PAGE_DIALOGS[el.id].ownConfirm) el.addEventListener("cancel", (e) => { e.preventDefault(); pageLeave(el); });   // Esc
  // 左の縁（24px）から内側へスワイプすると閉じる（2026-10-21 ユーザー「左枠から内側へのスワイプでページを閉じたい」）。
  // 指に合わせてページをずらし、画面幅の3割（最大120px）を越えて離したら「戻る」と同じ。縦に動かしたらやめる。
  // 地図の中から始めても地図を動かさないよう、ページの段階で受けて先へ渡さない
  let edge = null;
  const edgeReset = () => { edge = null; el.style.transform = ""; };
  el.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    edge = e.touches.length === 1 && t.clientX <= 24 ? { x: t.clientX, y: t.clientY, dx: 0, on: false } : null;
  }, { capture: true, passive: true });
  el.addEventListener("touchmove", (e) => {
    if (!edge) return;
    const t = e.touches[0], dx = t.clientX - edge.x, dy = t.clientY - edge.y;
    if (!edge.on && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { edgeReset(); return; }
    if (dx > 6) edge.on = true;
    if (!edge.on) return;
    edge.dx = Math.max(0, dx);
    el.style.transform = `translateX(${edge.dx}px)`;
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
  }, { capture: true, passive: false });
  el.addEventListener("touchend", () => {
    if (!edge) return;
    const go = edge.on && edge.dx > Math.min(120, innerWidth * 0.3);
    edgeReset();
    if (go) pageLeave(el);
  }, { capture: true });
  el.addEventListener("touchcancel", edgeReset, { capture: true });
  // 閉じた**その時点で**履歴を戻す数を数える。close の知らせは後から届くので、同じ処理の中で画面を移ると
  // （候補を選んで別の画面へ、など）移った先の履歴を戻してしまう
  const nativeClose = el.close.bind(el);
  el.close = (v) => { if (el.open) pageWillClose(el); nativeClose(v); };
  el.addEventListener("close", () => { if(!el.open)pageWillClose(el); });   // Ignore a queued close event after this page was reopened.
}
/// ページとして開いた（showSheet から）: 入力の印を消し、履歴を1つ積む
function pageOpened(el) {
  delete el.dataset.dirty;
  if (!pageStack.includes(el)) pageStack.push(el);
  // 前のページを閉じた直後（地点→地図で選ぶ、など）は、その履歴を戻し終えてから積む
  if (!NO_HISTORY) afterPagePop(() => {
    if (!el.open) return;
    const depth = ((history.state && history.state.depth) || 0) + 1;
    history.pushState({ ...(history.state || {}), depth, page: el.id }, "", location.href);
  });
}
const PAGE_DISCARD = "入力した内容を破棄しますか？";   // お気に入りの登録と同じ文
/// 「戻る」: 入力途中なら確かめてから、その画面の閉じる処理で閉じる
function pageLeave(el) {
  if (PAGE_DIALOGS[el.id].input && el.dataset.dirty && !confirm(PAGE_DISCARD)) return;
  const close = el.querySelector(":scope > .sheet-head > [data-page-close]");
  if (close) close.click(); else el.close();
}
function pageWillClose(el) {
  const i = pageStack.indexOf(el);
  if (i < 0) return;
  pageStack.splice(i, 1);
  if (el.pageClosedByHistory) { el.pageClosedByHistory = false; return; }
  // 釦で閉じた: 開いたときに積んだ履歴を戻す（同じ処理の中で続けて閉じたぶんはまとめて1回で）
  if (NO_HISTORY) return;
  pagePop.n++;
  if (!pagePop.queued) { pagePop.queued = true; queueMicrotask(() => { pagePop.queued = false; pagePopFlush(); }); }
}
window.addEventListener("popstate", () => {
  if (pagePop.n) { pagePopDone(); return; }
  const top = pageStack[pageStack.length - 1];
  if (!top || (history.state && history.state.page === top.id)) return;
  // ブラウザの戻る・スワイプ。入力途中で「破棄しない」なら、もう一度積んでページに残る
  if (PAGE_DIALOGS[top.id].input && top.dataset.dirty && !confirm(PAGE_DISCARD)) {
    const depth = ((history.state && history.state.depth) || 0) + 1;
    history.pushState({ ...(history.state || {}), depth, page: top.id }, "", location.href);
    return;
  }
  top.pageClosedByHistory = true;
  const close = top.querySelector(":scope > .sheet-head > [data-page-close]");
  if (close) close.click(); else top.close();
  // 閉じる処理が自分で聞いて「破棄しない」になった（お気に入り）: 戻った履歴を積み直してページに残る
  if (top.open) {
    top.pageClosedByHistory = false;
    const depth = ((history.state && history.state.depth) || 0) + 1;
    history.pushState({ ...(history.state || {}), depth, page: top.id }, "", location.href);
  }
});

/// シートを開く。**シートそのものに焦点を置く**（2026-10-02 ユーザー「なんか青くなって選択状態で開くのが気に入らない」）。
/// showModal だけだと最初の釦（閉じる）に焦点が行き、選ばれた状態（青い枠）で開く。<dialog autofocus> は効かないブラウザがあった。
/// 明示的な入力操作のときだけ、このあとで入力欄へ焦点を移す
function showSheet(el) {
  const page = !!PAGE_DIALOGS[el.id];
  if (page) preparePage(el);
  el.showModal();
  el.focus({ preventScroll: true });
  if (page) pageOpened(el);
}
// 題名は一覧へ（何画面進んでいても1回で）。「← 戻る」はひとつ前の画面へ
$("homeLink").onclick = () => { closeTools(); if(globalThis.AstroNotesAlmanacDashboard?.enter())almanacDay=AstroNotesHomeTime.start(Date.now()); pushRoute("#/almanac"); };
$("toolsHome").onclick = () => { closeTools(); goList(); };
$("almanacMenu").onclick = () => {if(globalThis.AstroNotesAlmanacDashboard?.enter())almanacDay=AstroNotesHomeTime.start(Date.now());pushRoute('#/almanac');};
$("backLink").onclick = () => { closeTools(); goBack(); };
$("toolsButton").onclick = () => ($("toolsMenu").hidden ? openTools() : closeTools());
$("toolsClose").onclick = () => closeTools({ restoreFocus: true });
$("toolsScrim").onclick = () => closeTools({ restoreFocus: true });
for (const el of $("toolsMenu").querySelectorAll("[data-tool]")) {
  el.onclick = () => {
    if (el.dataset.tool === "#/skymap") { closeTools(); if (!atSkyMap) SkyMapUI?.enter(atAim); return; }
    if (el.dataset.tool === "#/aim/tower" && atSkyMap && SkyMapUI?.prepareFraming()) { pushRoute("#/aim"); return; }
    if (el.dataset.tool === "#/aim/tower" && atAim) { closeTools(); return; }
    pushRoute(el.dataset.tool);
  };
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("toolsMenu").hidden) { e.preventDefault(); closeTools({ restoreFocus: true }); }
});
