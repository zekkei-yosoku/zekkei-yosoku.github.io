/*
 * AstroNotes — 来た道（ブラウザ履歴の depth と、ホーム画面のiPhoneアプリの appTrail）
 *
 * pushRoute/goBack/goList と NO_HISTORY・appTrail・toListAfterBack をここだけが持つ（2026-10-29 構造整理）。
 * create は何も呼ばない。location/history などは呼ぶたびに deps から読む（旧と同じ時点で解決する）。
 * 判断理由は src/app/navigation.js の注記を正本とする。
 */
(function (global) {
  "use strict";

  function createHistory(deps) {
    const NO_HISTORY = deps.noHistory;
    const appTrail = [];   // NO_HISTORY のときの来た道（前の画面の hash。一覧は ""）
    let toListAfterBack = false;

    function pushRoute(hash) {
      deps.closeTools();
      if (deps.pagePop()?.n) { deps.afterPagePop(() => pushRoute(hash)); return; }
      const location = deps.location, history = deps.history;
      if (location.hash === hash) return;
      if (NO_HISTORY) {
        appTrail.push(location.hash);
        history.replaceState({ depth: appTrail.length }, "", hash);
      } else {
        const depth = ((history.state && history.state.depth) || 0) + 1;
        history.pushState({ depth }, "", hash);
      }
      deps.applyRoute();   // pushState・replaceState は hashchange を起こさない
    }

    function goBack() {
      if (deps.pagePop()?.n) { deps.afterPagePop(goBack); return; }
      const history = deps.history;
      if (NO_HISTORY) {
        const prev = appTrail.pop();
        if (!prev) { goList(); return; }
        history.replaceState({ depth: appTrail.length }, "", prev);
        deps.applyRoute();
        return;
      }
      if ((history.state && history.state.depth) > 0) history.back();
      else goList();
    }

    function goList() {
      if (NO_HISTORY) appTrail.length = 0;
      const location = deps.location, history = deps.history;
      const depth = NO_HISTORY ? 0 : (history.state && history.state.depth) || 0;
      if (depth > 0) { toListAfterBack = true; history.go(-depth); return; }
      if (deps.routeFromHash()) { history.replaceState(null, "", location.pathname + location.search); deps.applyRoute(); }
    }

    /// hashchange で applyRoute の前に呼ぶ。goList の go(-depth) で戻った先が一覧でなければ一覧に置き換える
    function settleListAfterBack() {
      if (!toListAfterBack) return;
      toListAfterBack = false;
      const location = deps.location, history = deps.history;
      if (deps.routeFromHash()) history.replaceState(null, "", location.pathname + location.search);
    }

    return {
      pushRoute, goBack, goList, settleListAfterBack,
      get noHistory() { return NO_HISTORY; },
      get appTrail() { return appTrail; },
      get toListAfterBack() { return toListAfterBack; },
    };
  }

  const api = { createHistory };
  global.AstroNotesNavigationHistory = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
