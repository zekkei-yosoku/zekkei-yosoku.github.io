/* 非公開APIの笠雲結果に使う表示ラベル。 */
(function (global) {
const AstroNotesCapCloud = { TYPE_LABEL: { cap: "山頂にかぶる形", high: "やや高い笠", detached: "離れ笠", unknown: "形は不明" } };
global.AstroNotesCapCloud = AstroNotesCapCloud;
if(typeof module !== "undefined" && module.exports) module.exports = AstroNotesCapCloud;
})(typeof globalThis !== "undefined" ? globalThis : window);

/* Legacy global names remain aliases for cached integrations. */
if(typeof AstroNotesCapCloud!=='undefined')globalThis.SoramiCapCloud=AstroNotesCapCloud;
