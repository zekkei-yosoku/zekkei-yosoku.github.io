/*
 * AstroNotes — 探すの見え方job（SkyMapUI sessionの読取口と描画世代）
 *
 * 編集条件の正本はSkyMapUIのsessionのまま。ここは読取snapshotとcache key、
 * 描画jobの世代（epoch/frameKey/frameBase/pendingKey）だけを持ち、DOMに触れない（2026-10-29 構造整理）。
 * cache keyのフィールドと並びは旧exploreと同じ。変えると描き直し判定が変わる。
 */
(function (global) {
  "use strict";

  function create(deps) {
    const { readRenderState, clone, getAuthGeneration, dayStart, getAirMode, getAtmosphereKey, onInvalidate } = deps;
    let epoch = 0, frameKey = "", frameBase = "", pendingKey = "";

    function snapshot() { return clone(readRenderState()); }
    function stamp(s) { return JSON.stringify([getAuthGeneration(), s.body, s.target, s.observer, s.ground, s.eyeM, s.partId, s.limb, s.matchMode, dayStart(s.at), getAirMode(), getAtmosphereKey()]); }
    function baseStamp(s) { return JSON.stringify([getAuthGeneration(), s.body, s.target, s.observer, s.ground, s.eyeM, s.partId, s.limb, s.matchMode, getAirMode()]); }
    function invalidate(keepScene = false) { epoch++; frameKey = ""; frameBase = ""; pendingKey = ""; if (onInvalidate) onInvalidate(keepScene); }
    // soft refreshは前の見え方を残すため、invalidate後もframeBaseを戻す
    function begin(key, soft) { const keep = frameBase; invalidate(soft); if (soft) frameBase = keep; pendingKey = key; return epoch; }
    function current(run) { return run === epoch; }
    function matches(key) { return stamp(snapshot()) === key; }
    function commit(key, s) { frameKey = key; frameBase = baseStamp(s); }
    // 古いjobのfinallyは無視する
    function settle(run) { if (run !== epoch) return false; pendingKey = ""; return true; }
    function forgetFrame() { frameKey = ""; }

    return {
      snapshot, stamp, baseStamp, invalidate, begin, current, matches, commit, settle, forgetFrame,
      get epoch() { return epoch; },
      get frameKey() { return frameKey; },
      get frameBase() { return frameBase; },
      get pendingKey() { return pendingKey; },
    };
  }

  const api = { create };
  global.AstroNotesPlanningSession = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
