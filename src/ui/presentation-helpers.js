import {applyRoute} from '../app/navigation.js';

"use strict";
const S = AstroNotes;
const $ = (id) => document.getElementById(id);
// シングルクォートも落とす。いまは属性を全部ダブルクォートで囲んでいるので
// 実害は無いが、あとで `id='${...}'` と書いた誰か（自分）がそこで破る。
// 1文字足すだけなので、覚えておく方式より確実。
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const RANK_COLOR = { spectacular: "var(--spectacular)", good: "var(--good)", fair: "var(--fair)", poor: "var(--poor)" };
// 凡例に出す言葉。astronotes-core の汎用ラベル（絶景／良好／平凡／不向き）は
// 「事務的な語だと点数が何を意味するのか伝わらない」という理由で画面に出さない決まりで、
// 全7現象の最下段は「期待薄」で統一されている。凡例もその語に合わせる。
// 上端だけは現象ごとに違う（圧巻／満天／大雲海／好条件／見頃）ので、
// 一つに束ねる語としてアプリ名と同じ「絶景」を使う。
// マトリクスのセルの地。点数を【連続の色】にする。
//
// 評価は4段だが点数は連続なので、4色だけだと 41点と64点が同じ色になる。
// 隣り合う評価色の間を点数で補間し、濃さも 8%→34% で上げる。
// 色で「どれくらい期待できるか」、数字で正確な値、という役割分担。
//
// 濃さの上限34%は、上に載る点数と信頼度が本文基準（4.5:1）を保てる範囲として
// 実DOMで測って決めた。ここを上げると先に文字が読めなくなる。
// 濃さの設定は CSS 側に置く。モードで違ううえ、色そのものと同じ場所で管理したい。
const TINT = { span: 48, exp: 0.75 };
function readTint() {
  const cs = getComputedStyle(document.documentElement);
  TINT.span = parseFloat(cs.getPropertyValue("--tint-span")) || 48;
  TINT.exp = parseFloat(cs.getPropertyValue("--tint-exp")) || 0.75;
}
readTint();
// OS のライト・ダーク切り替えに追従する（<html data-theme>）。替えたら値を読み直して描き直す。
// **裏にいる間と、戻った直後は替えない**（2026-10-06 ユーザー録画「レイアウトの色が勝手に変わって戻る」）。
// iOS はアプリが裏へ回るとき、切り替え画面のスナップショットを撮るため外観をライト⇄ダークに往復させる
// （ネイティブのアプリでも traitCollectionDidChange が2回呼ばれる既知の挙動）。メディアクエリにそのまま従っていたので、
// Google マップから戻ると約1.3秒ライトで出ていた。表で本当に替えたときは、値が落ち着くのを少し待ってから替える
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
let themeTimer = 0, themeHoldUntil = 0;
function getThemePreference() {
  try { const mode = localStorage.getItem('sorami.theme'); return ['auto','light','dark'].includes(mode) ? mode : 'auto'; } catch { return 'auto'; }
}
function setThemePreference(mode) {
  if (!['auto','light','dark'].includes(mode)) return false;
  try { localStorage.setItem('sorami.theme', mode); } catch { return false; }
  themeHoldUntil = 0;
  applyTheme();
  return true;
}
function applyTheme() {
  clearTimeout(themeTimer);
  if (document.hidden) return;
  const wait = themeHoldUntil - Date.now();
  if (wait > 0) { themeTimer = setTimeout(applyTheme, wait); return; }
  const mode = getThemePreference();
  const theme = mode === "auto" ? (darkQuery.matches ? "dark" : "light") : mode;
  if (document.documentElement.dataset.theme === theme) return;
  document.documentElement.dataset.theme = theme;
  readTint(); applyRoute();
}
darkQuery.addEventListener("change", () => { clearTimeout(themeTimer); themeTimer = setTimeout(applyTheme, 400); });
document.addEventListener("visibilitychange", () => {
  clearTimeout(themeTimer);
  if (document.hidden) return;
  // 戻った直後は、外観の値がスナップショット用のままのことがある（録画では約1.3秒）。2秒は替えない
  themeHoldUntil = Date.now() + 2000;
  themeTimer = setTimeout(applyTheme, 2000);
});

export {$,RANK_COLOR,S,TINT,esc,getThemePreference,setThemePreference};
