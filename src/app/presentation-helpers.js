
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

const CELL_RAMP = [
  [0,  "--t-poor"], [40, "--t-fair"], [65, "--t-good"], [85, "--t-spectacular"], [100, "--t-spectacular"],
];
// 点数の色（単色）。評価色の間を点数で補間し、濃さも上げる。
function cellTint(score, past = false) {
  const v = Math.max(0, Math.min(100, score));
  let i = 0;
  while (i < CELL_RAMP.length - 2 && v >= CELL_RAMP[i + 1][0]) i++;
  const [s0, c0] = CELL_RAMP[i], [s1, c1] = CELL_RAMP[i + 1];
  const t = s1 === s0 ? 0 : (v - s0) / (s1 - s0);
  const hue = c0 === c1 ? `var(${c0})`
    : `color-mix(in srgb, var(${c1}) ${(t * 100).toFixed(1)}%, var(${c0}))`;
  // 濃さの幅と立ち上がりはモードで違う（--tint-span / --tint-exp）。
  // ライトは黒に近い文字が載るので 10〜72% まで塗れる。ダークは明るい地に
  // 淡い文字が載るため 10〜58% が限界（実測）。同じ数値を両方に使うと、
  // ライト側が薄すぎて 24点と62点が見分けられなかった。
  // 終わった回は色を薄くして下げる（文字を薄くすると、押せる要素の基準を割るため）。
  const strength = ((10 + TINT.span * Math.pow(v / 100, TINT.exp)) * (past ? 0.42 : 1)).toFixed(1);
  return `color-mix(in srgb, ${hue} ${strength}%, var(--sunk))`;
}

// セルの地は【単色】。
// 色そのものが 期待薄→絶景 の連続グラデーションになっているので、
// 塗りの高さでも同じことを言うと、同じ情報を2回描くことになる。
// 色で「どれくらい期待できるか」、数字で正確な値、A/B/C でその確からしさ。
const cellBg = (score, past = false) => cellTint(score, past);
// 凡例。セルと同じ式から作る（凡例と実物が食い違わないように）。
const rampGradient = () =>
  `linear-gradient(90deg, ${[0, 20, 40, 52, 65, 75, 85, 100].map((v) => cellTint(v)).join(",")})`;

// 「信頼度中 62–85」だけでは何のことか伝わらない。
// 何が・どれだけ・なぜ不確かなのかを、そのまま言葉にする。
//
// 出どころは2系統。アンサンブル（51通りの計算）が取れていれば
// 「スコアが何点ずれそうか」まで言える。取れなければモデルの割れ方で代用する。
function confidenceText(ev) {
  const u = ev.uncertainty;
  const d = ev.daysAhead || 0;
  const parts = [];

  if (u && u.basis === "ensemble") {
    const e = Math.round(u.expectedError);
    // 「±0点」は精度の主張として強すぎる。1点未満はまとめて「ほぼ動きません」。
    parts.push(e < 1
      ? (ev.confidence.cappedByModelDisagreement
          ? `${u.ensembleMembers}通りの計算の内部では揃っています`
          : `${u.ensembleMembers}通りの計算がほぼ一致していて、点数はあまり動きません`)
      : `${u.ensembleMembers}通りの計算から、点数は ±${e}点 ほど動く見込みです`);
    // 点数の幅が小さくても評価が割れていることがある（上限に張り付いた分布）。
    // そのときは幅ではなく「何通りが別の評価か」を言う。数字だけ見て
    // 安心されるのを避ける。
    if (ev.confidence.cappedByDisagreement && u.agreement !== null && u.agreement !== undefined) {
      const other = Math.round(u.ensembleMembers * (1 - u.agreement));
      parts.push(`ただし ${other}通りは別の評価です`);
    } else if (ev.confidence.key === "medium") parts.push("評価が1段変わり得ます");
    else if (ev.confidence.key === "low") parts.push("評価はあてになりません");
    if (ev.confidence.cappedByModelDisagreement && u.modelAgreement != null) {
      const other = Math.round(ev.models * (1 - u.modelAgreement));
      parts.push(`ただし ${other}つの予報モデルは別の評価です`);
    }
  } else if (u && u.basis === "single") {
    // **モデルを横断して採点していない現象**（富士山・月）。
    // 「N つの予報モデルが…」と言うと嘘になる（実際 N=0 で「0つの」と出た）。
    // 何を根拠に幅を出しているかを、そのまま言う。
    // 何日先かは下の日数の注意で1回だけ言う。ここでも言うと「4日先なので…。4日先の予測です」と重なった（2026-10-13 総点検）
    const w = Math.round(u.expectedError);
    parts.push(w < 1 ? "点数はあまり動きません" : `点数は ±${w}点 ほど動く見込みです`);
    if (ev.confidence.key === "medium") parts.push("評価が1段変わり得ます");
    else if (ev.confidence.key === "low") parts.push("評価はあてになりません");
  } else {
    const lo = Math.round(ev.spread[0]), hi = Math.round(ev.spread[1]);
    const n = Object.keys(ev.perModel).length;
    const spreadWide = hi - lo >= 30;
    // アンサンブルが有るのに使わなかった日は、その理由を言う。
    // 黙って別の根拠へ切り替えると、同じ画面の数字の意味が日によって変わる。
    if (u && u.ensembleBlind) parts.push(u.ensembleBlind);
    // 「ほぼ同じ」と言えるのは、評価の帯（20〜25点間隔）より明らかに狭いときだけ。
    // 20点の幅を「ほぼ同じ」と書くと、A の説明として強すぎる。
    if (ev.confidence.key === "high") parts.push(hi - lo <= 10
      ? `${n}つの予報モデルがほぼ同じ見立てです（${lo}〜${hi}点）`
      : `${n}つの予報モデルは ${lo}〜${hi}点 に収まっています`);
    else if (spreadWide) parts.push(`予報モデルの見立てが ${lo}〜${hi}点 と割れています`);
    else parts.push(`予報モデルは ${lo}〜${hi}点 でおおむね揃っています`);
    // 幅が狭くても帯の境目をまたげば評価は割れる。数字だけ見て安心されるのを避ける。
    if (ev.confidence.cappedByDisagreement && u && u.modelAgreement !== null
        && u.modelAgreement !== undefined) {
      const other = Math.round(n * (1 - u.modelAgreement));
      parts.push(`ただし ${other}つのモデルは別の評価です`);
    }
  }

  // モデルが落ちる日は、同じ「中央値」でも土台が違う。何本で出した値かを言う。
  if (typeof ev.models === "number" && ev.models > 0 && ev.models < S.MODELS.length) {
    parts.push(`この日まで予報を出しているのは ${S.MODELS.length}モデル中 ${ev.models}つです`);
  }
  // 日数の注意は残す。1〜5日先はアンサンブルの見積もりが実測とよく一致することを
  // 確認したが（星空・288標本）、6日先から先は同じ手段で確かめられていない。
  if (d >= 6) parts.push(`${d}日先は、見積もりが実測と合うかを確かめられていません`);
  else if (d >= 5) parts.push(`${d}日先なので、日が近づいたら見直してください`);
  else if (d >= 2) parts.push(`${d}日先の予測です`);
  return parts.join("。");
}
// 51メンバーの散らばりを見せる。「信頼度 中」と言われるより、
// 51本がどう散らばっているかを見たほうが、利用者は自分で判断できる。
//
// ただしメンバーの【絶対値は本体スコアと比べられない】。メンバー側は
// 太陽方位オフセットも視程も持たず、ECMWF 単独で計算しているため、
// 実データで本体スコアと最大 31 点ずれる。並べて出すと
// 「どっちが本当なの」という答えられない問いを生む。
// そこで本体スコアを中心に重ね直し、【散らばりの形だけ】を見せる。
function renderEnsemble(ev) {
  const u = ev.uncertainty;
  if (!u || u.basis !== "ensemble" || !u.ensembleScores) return "";
  const shift = ev.score - u.ensembleMedian;
  const shifted = u.ensembleScores.map((v) => Math.round(Math.max(0, Math.min(100, v + shift))));
  const hist = Array(10).fill(0);
  for (const v of shifted) hist[Math.min(9, Math.floor(v / 10))]++;
  const peak = Math.max(...hist, 1);
  const sorted = [...shifted].sort((a, b) => a - b);
  const q = (p) => sorted[Math.round((sorted.length - 1) * p)];
  const lo = q(0.1), hi = q(0.9), q1 = q(0.25), q3 = q(0.75);
  const bars = hist.map((c, i) => {
    const mid = i * 10 + 5, inBand = mid >= q1 && mid <= q3;
    return `<div class="ens-bar" title="${i * 10}〜${i * 10 + 9}点：${c}通り">
      <div style="height:${Math.round(100 * c / peak)}%;background:${inBand ? RANK_COLOR[S.rankOf(mid).key] : "var(--line)"}"></div></div>`;
  }).join("");
  const ranks = [...new Set(shifted.map((v) => S.rankOf(v).label))];
  return `<div class="section-h" style="margin-top:8px"><h2>この点数はどれくらい動きうるか</h2></div>
    <div class="ens">${bars}</div>
    <div class="ens-axis"><span>0</span><span>50</span><span>100</span></div>
    <p class="tiny">ECMWF が初期値をわずかに変えて計算した${u.ensembleMembers}通りの散らばりを、
      この点数（${Math.round(ev.score)}点）を中心に重ねたものです。
      色が付いているのが真ん中の半分（${q1}〜${q3}点）、上下1割を除くと ${lo}〜${hi}点。
      ${ranks.length > 1 ? `評価としては<strong>${ranks.join("・")}</strong>のいずれもあり得ます。` : `評価は<strong>${ranks[0]}</strong>で動きません。`}</p>
    <p class="tiny">点数そのものは8つの予報モデルの中央値です。この${u.ensembleMembers}通りは
      <strong>動きうる幅を測るためだけ</strong>に使っています
      （太陽の方向の空を見ていないので、点数の高さ自体は比べられません）。</p>`;
}
// 「次の見どころ」は 36 時間以内の最高スコアを出すだけなので、
// 全部だめな日でも 29 点の「不向き」がそこに載る（実データで確認）。
// 見どころと呼べない日に見どころと書かない。
const HIGHLIGHT_HEAD = {
  spectacular: "次の見どころ", good: "次の見どころ",
  fair: "いちばん期待できるもの",
  // poor は見出しを出さない。「なさそうです」と言いながら候補を並べると矛盾する。
  // renderBestNote で別の形にする。
};
const CONF_ICON = { high: "◎", medium: "△", low: "⚠︎" };

// 「次の見どころ」を14日ぶん全部から選ぶ。
//
// 36時間以内に絞っていた時期があるが、ほとんどの日は該当が無く
// 「本日の絶景はなさそうです」の1行で終わっていた。2日後に良好な日があっても
// 言わないので、見に行く日を決める役に立っていなかった。
//
// ただし点数だけで選ぶと、信頼度Cの7日先が最上位に出る。
// 先の予測ほど当たらないので、確からしさで割り引いてから比べる。
// 引く量は評価の帯の間隔（20〜25点）を目安にしている。
const LEAD_PENALTY = { A: 0, B: 6, C: 16 };

// 月・富士山・笠雲は見どころに出さない（`PHENOMENA[id].highlight === false`）。
// 他の現象は起きるか起きないかで、起きれば出かける理由になる。
// 月と富士山は**晴れていればだいたい見える**ので、条件の良い日は必ず上位へ来て
// 見どころの枠を占め続け、雲海や虹のような「その日だけ」を押し出す。
// 表の行としては同じ重みで残す（見どころに出さないだけ）。
// 笠雲は理由が違う。高い点でも実際に見えるのは十数回に1回なので、先頭に出すと誤誘導になる（2026-09-17）。
function pickHighlight(weeks, now) {
  let best = null;
  for (const [id, entries] of Object.entries(weeks)) {
    if (S.PHENOMENA[id] && S.PHENOMENA[id].highlight === false) continue;
    for (const e of entries) {
      const ev = e.evaluation;
      if (!ev || ev.unavailable || ev.window[1] <= now) continue;
      const merit = ev.score - LEAD_PENALTY[S.reliabilityGrade(ev.confidence, ev.models).key];
      if (!best || merit > best.merit || (merit === best.merit && ev.peak < best.u.evaluation.peak)) {
        best = { id, u: e, merit };
      }
    }
  }
  return best;
}
