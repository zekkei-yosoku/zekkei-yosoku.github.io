/* 標準的な月相表示。天候による可視性の判定は非公開APIで行う。 */
(function (global) {
"use strict";
  const PHASES = [
    { max: 0.02, waxing: null,  glyph: "🌑", name: "新月" },
    { max: 0.34, waxing: true,  glyph: "🌒", name: "三日月" },
    { max: 0.66, waxing: true,  glyph: "🌓", name: "上弦" },
    { max: 0.96, waxing: true,  glyph: "🌔", name: "十三夜" },
    { max: 1.01, waxing: null,  glyph: "🌕", name: "満月" },
    { max: 0.96, waxing: false, glyph: "🌖", name: "十六夜すぎ" },
    { max: 0.66, waxing: false, glyph: "🌗", name: "下弦" },
    { max: 0.34, waxing: false, glyph: "🌘", name: "有明の月" },
  ];
  function phaseOf(moon) {
    const f = moon.illuminatedFraction;
    if (f <= 0.02) return PHASES[0];
    if (f >= 0.985) return PHASES[4];
    const set = PHASES.filter((p) => p.waxing === !!moon.waxing);
    // 輝面比が小さいほうから順に見て、最初に収まる帯
    const ordered = [...set].sort((a, b) => a.max - b.max);
    for (const p of ordered) if (f <= p.max) return p;
    return ordered[ordered.length - 1];
  }
  const glyphOf = (moon) => phaseOf(moon).glyph;

  const SoramiMoon = { PHASES, phaseOf, glyphOf };
  global.SoramiMoon = SoramiMoon;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiMoon;
})(typeof globalThis !== "undefined" ? globalThis : window);
