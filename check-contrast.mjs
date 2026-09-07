/*
 * 配色のコントラスト検査。
 * 文字として使う色は、その色が【実際に載る地】に対して 4.5:1 以上（WCAG AA の本文基準）。
 *
 * 以前はライトモードで 良好 2.60・平凡 2.42・補助文 2.21 と、
 * 大きな文字の基準 3.0 すら下回っていた。目で見て気づけなかったので機械で測る。
 *
 * 2026-09-07: この検査そのものに穴があった。
 *   - 地を「カード地」1種類しか見ていなかった。実際の画面はページ地（--bg）や
 *     日のチップ地（--text 6% をカードへ重ねた色）の上にも文字を置いており、
 *     白でぎりぎり 4.5 を超える色がそこでは 4.0 前後まで落ちていた。
 *   - `--orange`（内訳の △）が検査対象に入っておらず、2.76:1 が野放しだった。
 *   実物のDOMで測ると ライト161件・ダーク123件の要素が基準割れしていた。
 *   地を増やし、色ごとに「どの地に載るか」を明示する形へ直した。
 *
 * 2026-09-07: **表のセルの地を一度も測っていなかった。**
 *   14日表のセルは点数に応じて色を塗り、その上に点数と信頼度を書いている。
 *   画面のいちばん広い色面なのに、地の一覧に無かったので検査対象外だった。
 *   実際そこでライトの色が潰れていた（24点と62点で赤成分が3しか違わない）。
 *   いちばん濃いセルと中間のセルを地として足し、--text を検査対象に入れた。
 *
 * **地を増やしたら USED_ON も更新すること。**
 * 新しい地に文字を置いたのに登録しなければ、また同じ見逃し方をする。
 */
import fs from "node:fs";
const css = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");

const hex = (h) => { h = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = ([r, g, b]) => {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/// 不透明な地の上へ、色を p（0〜1）の濃さで重ねた結果。
const overlay = (fg, bg, p) => fg.map((c, i) => Math.round(c * p + bg[i] * (1 - p)));

// :root と dark ブロックからそれぞれ変数を拾う
const block = (re) => { const m = css.match(re); return m ? m[1] : ""; };
const rootVars = block(/:root \{([\s\S]*?)\n  \}/);
const darkVars = block(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?:root \{([\s\S]*?)\n  \}/);
const parse = (text) => Object.fromEntries(
  [...text.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]));
const expand = (h) => (h.length === 4 ? "#" + h.slice(1).split("").map((c) => c + c).join("") : h);
// --sunk と濃さの設定は別の :root ブロックにある。個別に拾う。
const one = (re, fallback) => { const m = css.match(re); return m ? m[1] : fallback; };
const sunkLight = one(/:root \{ --sunk: (#[0-9a-fA-F]{6})/);
const sunkDark = one(/prefers-color-scheme: dark\) \{ :root \{ --sunk: (#[0-9a-fA-F]{6})/);
const numIn = (text, name, fallback) => {
  const m = text.match(new RegExp("--" + name + ":\\s*([\\d.]+)"));
  return m ? +m[1] : fallback;
};
const light = { ...parse(rootVars), sunk: sunkLight,
  tintSpan: numIn(rootVars, "tint-span", 48), tintExp: numIn(rootVars, "tint-exp", 0.75) };
const dark = { ...light, ...parse(darkVars), sunk: sunkDark,
  tintSpan: numIn(darkVars, "tint-span", 48), tintExp: numIn(darkVars, "tint-exp", 0.75) };
for (const [name, v] of [["--sunk(light)", sunkLight], ["--sunk(dark)", sunkDark]]) {
  if (!v) { console.log(`  ?    ${name} を読めなかった`); process.exit(1); }
}

/// その色が実際に載る地。ここに無い組み合わせは測られない。
///   card … .card の上（既定）
///   page … main の地（--bg）。リンク・戻る・並び替えのラベル・末尾の注記
///   chip … 日のボタン（.day）。--text 6% をカードへ重ねた色
///   accent … 差し色そのものを地にしたところ（選択中のチップ、記録の回答ボタン）
const USED_ON = {
  // 表のセルの上に載る点数と信頼度。いちばん濃いところで効くか見る。
  text:        ["card", "page", "cellMax", "cellMid"],
  secondary:   ["card", "page"],
  tertiary:    ["card", "page", "chip"],
  accent:      ["card", "page"],
  good:        ["card", "chip"],
  fair:        ["card", "chip"],
  poor:        ["card", "chip"],
  spectacular: ["card", "chip"],
  red:         ["card"],
  orange:      ["card"],
  "on-accent": ["accent"],
};

let fail = 0;
for (const [theme, vars] of [["ライト", light], ["ダーク", dark]]) {
  // 地は変数から作る。--card や --text を変えれば地も自動で追従する。
  const card = hex(expand(vars.card));
  // セルの地は index.html の cellTint と同じ式で作る。
  //   strength = 10 + span * (score/100)^exp  を --sunk へ混ぜる
  const sunk = hex(expand(vars.sunk));
  const cell = (tint, score) => {
    const strength = (10 + vars.tintSpan * Math.pow(score / 100, vars.tintExp)) / 100;
    return overlay(hex(expand(tint)), sunk, strength);
  };
  const grounds = {
    card: { label: "カード地", rgb: card },
    page: { label: "ページ地", rgb: hex(expand(vars.bg)) },
    chip: { label: "チップ地", rgb: overlay(hex(expand(vars.text)), card, 0.06) },
    accent: { label: "差し色地", rgb: hex(expand(vars.accent)) },
    cellMax: { label: "セル100点", rgb: cell(vars["t-spectacular"], 100) },
    cellMid: { label: "セル 65点", rgb: cell(vars["t-good"], 65) },
  };
  console.log(`\n== ${theme} ==`);
  for (const [name, on] of Object.entries(USED_ON)) {
    if (!vars[name]) { console.log(`  ?    --${name} が定義されていない`); fail++; continue; }
    for (const key of on) {
      const g = grounds[key];
      const r = ratio(hex(expand(vars[name])), g.rgb);
      const okay = r >= 4.5;
      if (!okay) fail++;
      console.log(`  ${okay ? "ok  " : "FAIL"} --${name.padEnd(12)} ${vars[name]}  on ${g.label}  ${r.toFixed(2)}`);
    }
  }
}
console.log(`\n${fail === 0 ? "CONTRAST OK" : "FAILED — " + fail + " 件"}`);
process.exit(fail === 0 ? 0 : 1);
