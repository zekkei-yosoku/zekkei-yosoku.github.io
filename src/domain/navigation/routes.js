/*
 * AstroNotes — URLのhashから画面を決める（純粋関数。location/historyに触れない）
 *
 * 旧 routeFromHash の判定を同じ順序で移した（2026-10-29 構造整理）。
 * 旧共有URL #p= の置換（replaceState）は呼出側の routeFromHash が行う。
 */
(function (global) {
  "use strict";

  /// #p=<token> を #/aim?plan=<token> へ。置き換えないときは null（壊れたescape・使えない文字・長すぎ）
  function normalizeLegacyHash(hash) {
    if (!hash.startsWith('#p=')) return null;
    let token = ''; try { token = decodeURIComponent(hash.slice(3)); } catch { /* Malformed escapes are not a shared route. */ }
    return /^[\w.,\/-]{1,8000}$/.test(token) ? '#/aim?plan=' + token : null;
  }

  /// phenomena は表、または表を返す関数（必要になるまで読まない。旧の S.PHENOMENA と同じ時点）
  function parseRoute(hash, phenomena) {
    const known = (id) => (typeof phenomena === "function" ? phenomena() : phenomena)[id];
    if (hash === "#/explore") return { skymap: true };
    if (hash === "#/almanac") return { almanac: true };
    if (hash.includes("?plan=")) {
      const path = hash.split("?")[0];
      if (path === "#/aim") return { aim: true };
      const shared = /^#\/([A-Za-z]+)\/(\d+)$/.exec(path);
      if (shared && known(shared[1])) return { id: shared[1], dayMs: Number(shared[2]) };
    }
    if (hash === "#/skymap") return { skymap: true };
    if (hash === "#/records") return { records: true };
    if (hash === "#/answers" || hash === "#/forecast/results") return { answers: true };
    if (hash === "#/aim") return { aim: true };
    const am = /^#\/aim\/(fuji|diamond|pearl|tower)$/.exec(hash);
    if (am) return { aim: true, preset: am[1] };
    if (hash === "#/plane") return { plane: true };
    if (hash === "#/iss") return { iss: true };
    if (hash === "#/iss/pick") return { iss: true, issPick: true };
    if (hash === "#/admin") return { admin: true };
    const m = /^#\/([A-Za-z]+)(?:\/(\d+))?$/.exec(hash);
    // SCORERS ではなく PHENOMENA で見る（富士山と月は core が採点しないので SCORERS に無い）
    if (!m || !known(m[1])) return null;
    return { id: m[1], dayMs: m[2] ? Number(m[2]) : null };
  }

  const api = { normalizeLegacyHash, parseRoute };
  global.AstroNotesNavigationRoutes = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
