/* 非公開APIの笠雲結果に使う表示ラベル。 */
(function (global) {
const SoramiCapCloud = { TYPE_LABEL: { cap: "山頂にかぶる形", high: "やや高い笠", detached: "離れ笠", unknown: "形は不明" } };
global.SoramiCapCloud = SoramiCapCloud;
if(typeof module !== "undefined" && module.exports) module.exports = SoramiCapCloud;
})(typeof globalThis !== "undefined" ? globalThis : window);
