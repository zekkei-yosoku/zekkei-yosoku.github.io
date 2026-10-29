// ---------------------------------------------------------------- 指の操作（引き出しのスワイプ・地図のつまみ）
//
// **左の端から右へなぞると引き出しが開く**（2026-10-01 ユーザー「メニューについて左からスワイプで開くようにできたりしない？」）。
// 開いているときは左へなぞると閉じる。引き出しは指に付いてきて、離したときに半分より出ているか、速く払っていれば開く。
// 始めは**左の端だけ**（地図・3D の空・日付の帯など、横に動かす部品と取り合わないため）。
// ホーム画面に置いたアプリには端のスワイプの「戻る」が無いのでそのまま効く。Safari では Safari の「戻る」が先に取る
// （行き先はこのアプリの「← 戻る」と同じ）。
//
// **ページは拡大させない**（2026-10-01 ユーザー「拡大を禁止しておいて」）。
// それまでは地図の上の2本指だけ止めていたが、画面を開いた直後に地図をつまむとページごと拡大し、地図が画面を占めて
// 戻れなくなった（「地図を拡大した時に画面も拡大されちゃって戻らなくなる」・画面録画）。ページを拡大して得をする画面が無いので、
// ページ全体で止める。止め方は3つ重ねる: viewport（maximum-scale=1, user-scalable=no。Safari は無視することがある）、
// CSS（html の touch-action: pan-x pan-y）、ここ（2本指の touchstart と Safari の gesture を止める）。
// 地図の拡大・縮小は地図が pointer で自分で受ける（touch を止めても pointer は届く）。
// touchmove は passive のままにする（ページ全体の touchmove を止められる形にすると、計算中にスクロールまで待たされる）。
const SWIPE_EDGE_PX = 28;
let swipe = null;
document.addEventListener("touchstart", (e) => {
  // 2本目の指が下りたら、ページの拡大を止める（地図は pointer で自分で拡大する）
  if (e.touches.length > 1) { e.preventDefault(); swipe = null; return; }
  const t = e.touches[0];
  const open = !$("toolsMenu").hidden && $("toolsMenu").classList.contains("on");
  if (open) {
    if (!e.target.closest("#toolsMenu, #toolsScrim")) return;
  } else if (t.clientX > SWIPE_EDGE_PX || (isMenuPage() && $("toolsButton").hidden && currentView !== "list") || document.querySelector("dialog[open]")
             || e.target.closest(".mapwrap, canvas, input, select, textarea, .preview-footer-track")) {
    // ☰ が出ていない（使える道具が無い）ときは、なぞっても開かない
    return;
  }
  const forecastTop = !open && currentView === "list";
  // 予測一覧の左端は履歴移動ではなく一覧先頭へ。Safariの戻るにも渡さない。
  if (forecastTop && t.clientX <= 8 && e.cancelable) e.preventDefault();
  swipe = { x0: t.clientX, y0: t.clientY, t0: e.timeStamp, open, top: forecastTop, back: !open && (forecastTop || !isMenuPage()), active: false, p: open ? 1 : 0 };
}, { passive: false });
document.addEventListener("touchmove", (e) => {
  if (!swipe || e.touches.length !== 1) return;
  const t = e.touches[0];
  const dx = t.clientX - swipe.x0, dy = t.clientY - swipe.y0;
  const menu = $("toolsMenu"), scrim = $("toolsScrim");
  if (!swipe.active) {
    // 縦に動いた（一覧を送る）・向きが逆なら、引き出しの操作にしない
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }
    if (Math.abs(dx) < 10) return;
    if (swipe.open ? dx > 0 : dx < 0) { swipe = null; return; }
    swipe.active = true;
    if (swipe.back) { swipe.dx = dx; swipe.v = dx / Math.max(1, e.timeStamp - swipe.t0); return; }
    if (!swipe.open) {
      clearTimeout(toolsAnim);
      markToolsCurrent();
      scrim.hidden = false; menu.hidden = false;
    }
    menu.style.transition = scrim.style.transition = "none";
    swipe.width = menu.offsetWidth || 300;
  }
  if (swipe.back) { swipe.dx = dx; swipe.v = dx / Math.max(1, e.timeStamp - swipe.t0); return; }
  swipe.p = Math.max(0, Math.min(1, (swipe.open ? 1 : 0) + dx / swipe.width));
  swipe.v = dx / Math.max(1, e.timeStamp - swipe.t0);
  menu.style.transform = `translateX(${(swipe.p - 1) * 100}%)`;
  scrim.style.opacity = String(swipe.p);
}, { passive: true });
const endSwipe = (e) => {
  if (!swipe || !swipe.active) { swipe = null; return; }
  const { p, v = 0, open, back, top, dx = 0 } = swipe;
  swipe = null;
  if (back) {
    if (e?.type !== "touchcancel" && (dx >= 64 || (dx >= 24 && v > 0.4))) { swipeEndedAt = performance.now(); if(top){listScrollY=0;window.scrollTo(0,0);}else goBack(); }
    return;
  }
  const menu = $("toolsMenu"), scrim = $("toolsScrim");
  swipeEndedAt = performance.now();
  const wantOpen = open ? !(p < 0.6 || v < -0.4) : (p > 0.4 || v > 0.4);
  // 指を離した位置から、ふつうの開け閉めの動きで続ける。行き先の class を先に決めてから、指の位置（inline）を外す
  if (wantOpen) { menu.classList.add("on"); scrim.classList.add("on"); }
  menu.style.transition = scrim.style.transition = "";
  menu.style.transform = ""; scrim.style.opacity = "";
  if (wantOpen) { if (!open) openTools({ focus: false }); }
  else closeTools();
};
// なぞり終わりの指で、引き出しの項目や後ろの釦を押したことにしない
let swipeEndedAt = 0;
document.addEventListener("click", (e) => {
  // 指を離した直後に来る click だけ（続けて ☰ を押したときまで止めない）
  if (performance.now() - swipeEndedAt < 120) { e.preventDefault(); e.stopPropagation(); }
}, true);
document.addEventListener("touchend", endSwipe);
document.addEventListener("touchcancel", endSwipe);
// Safari のつまむ拡大（gesture）も止める
for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

/// 使える道具が変わったら（ログイン・ログアウト・期限切れ）、詳細に出している道具の中身も出し直す
let toolsDrawnKey = null;
function redrawIfToolsChanged() {
  const key = allowedTools().join(",");
  if (key !== toolsDrawnKey) { toolsDrawnKey = key; startFujiAlign(); redrawDayDetail(); }
}
