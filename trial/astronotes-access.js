/*
 * AstroNotes — 画面ごとに要る許可（認可表）
 *
 * メニュー・直URL・起動画面・画面内の入口は、この表で出し分ける（2026-10-15 総点検M04の第1段）。
 * 以前は「構図＝diamond・pearl・tower のどれか」が index.html の別々の場所に書かれており、
 * 直URLの月丼・ISS・記録だけ判定が抜けていた（総点検A01）。
 *
 * **判定の正本はサーバー**（/me の tools と、保護APIの権限確認）。この表は
 * 「どの画面にどの許可が要るか」の正本。名前と並びはAPIの TOOLS と同じにする
 * （test-access-table.mjs が突き合わせる）。
 * 目標×天体の判定も canFrame に集約する。画面全体の許可と本人確認は呼出側に残す。
 */
(function (global) {
  "use strict";

  const TOOLS = Object.freeze(["diamond", "pearl", "tower", "skymap", "plane", "iss", "records"]);

  /// 画面 → 開くのに要る許可（どれか1つ）と、許されていないときに出す名前
  const SCREENS = Object.freeze({
    framing: Object.freeze({ tools: Object.freeze(["diamond", "pearl", "tower"]), label: "構図" }),
    skymap: Object.freeze({ tools: Object.freeze(["skymap"]), label: "地図" }),
    plane: Object.freeze({ tools: Object.freeze(["plane"]), label: "月丼" }),
    iss: Object.freeze({ tools: Object.freeze(["iss"]), label: "人工衛星" }),
    records: Object.freeze({ tools: Object.freeze(["records"]), label: "記録" }),
    answers: Object.freeze({ tools: Object.freeze(["records"]), label: "結果" }),
  });

  /// 付与された道具の並びで、その画面を開けるか。知らない画面名は書き間違いなので投げる
  function canOpen(granted, screen) {
    const need = SCREENS[screen];
    if (!need) throw new Error("Unknown screen: " + screen);
    return Array.isArray(granted) && need.tools.some((tool) => granted.includes(tool));
  }

  // Preserve the existing target/body rule, including short-circuit order.
  // A predicate supports the existing authenticated toolAllowed boundary;
  // an array supports isolated contract tests and other explicit callers.
  function canFrame(granted, targetId, body) {
    const allow = typeof granted === "function" ? granted
      : (tool) => Array.isArray(granted) && granted.includes(tool);
    if (targetId !== "fuji") return allow("tower");
    return body === "sun" ? allow("diamond") : body === "moon" ? allow("pearl")
      : allow("tower") && (allow("diamond") || allow("pearl"));
  }

  const api = { TOOLS, SCREENS, canOpen, canFrame };
  global.AstroNotesAccess = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);

/* Legacy global names remain aliases for cached integrations. */
if(typeof AstroNotesAccess!=='undefined')globalThis.SoramiAccess=AstroNotesAccess;
