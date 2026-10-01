/*
 * ページ全体のレイアウト監査。目視でなく座標と描画順で判定する。
 *
 * 使い方（ブラウザのコンソール）:
 *   const s = document.createElement("script"); s.src = "/audit.js"; document.head.append(s);
 *   window.__audit();          // いまの表示位置を検査
 *
 * **`new Function(...)` では読み込めない。** CSP が `script-src 'self' 'unsafe-inline'` で
 * `unsafe-eval` を許していないため、文字列からの実行は弾かれる（2026-09-28 に踏んだ）。
 * 同じ生成元のファイルとして読ませれば 'self' で通る。
 *
 * 重なりの判定は elementFromPoint（描画順）で行う。
 * getBoundingClientRect だけだと、閉じた <details> のように
 * 箱だけ残って描画されない要素を犯人と誤認する（実際に3回誤認した）。
 */
window.__audit = function () {
  const report = { viewport: innerWidth + "x" + innerHeight, issues: [] };
  const add = (kind, detail) => report.issues.push({ kind, ...detail });

  // 1) 横スクロール
  const de = document.documentElement;
  if (de.scrollWidth > innerWidth + 1) {
    const wide = [...document.querySelectorAll("body *")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1);
    }).slice(0, 5).map((el) => el.tagName + "." + String(el.className || "").slice(0, 24));
    add("横スクロール", { scrollWidth: de.scrollWidth, viewport: innerWidth, 原因候補: wide });
  }

  // 2) カード同士の実描画の重なり（elementFromPoint で最前面を見る）
  //
  // モーダルが開いていると背面のカードは当然すべて覆われる。それを毎回7件挙げると、
  // 本物の重なりがその中に埋もれる（タップ領域の検査で同じことをやって実際に埋もれた）。
  // 開いている間は「背面は検査していない」と明示して飛ばす。
  const modal = document.querySelector("dialog[open]");
  const cards = modal ? [] :
    [...document.querySelectorAll("main > .card, main > #listView > .card, #cards > .card, #detailPane .card")]
      .filter((e) => e.getBoundingClientRect().height > 0);
  if (modal) add("モーダルが開いている", { 対象: modal.id || modal.className, 注: "背面の重なりは検査していない" });
  for (const card of cards) {
    const r = card.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) continue;
    let covered = 0, total = 0, by = new Set();
    for (let y = Math.max(2, r.top + 4); y < Math.min(innerHeight - 2, r.bottom - 4); y += 16) {
      for (let x = r.left + 8; x < r.right - 8; x += 48) {
        total++;
        const el = document.elementFromPoint(x, y);
        if (el && !card.contains(el) && !el.contains(card)) {
          covered++; by.add(el.tagName + "." + String(el.className || "").slice(0, 18));
        }
      }
    }
    if (total > 0 && covered / total > 0.05) {
      add("要素の重なり", { 対象: card.id || card.className, 覆われた割合: Math.round(100 * covered / total) + "%", 覆っている: [...by].slice(0, 4) });
    }
  }

  // 3) 親からはみ出している子
  // 閉じた <details> の中身は箱だけ残るが描画されない。親からはみ出して見えても実害はない。
  const inClosedDetails = (el) => {
    for (let e = el; e; e = e.parentElement) {
      if (e.tagName === "DETAILS" && !e.open) return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll("main .card")) {
    if (inClosedDetails(el)) continue;
    const pr = el.getBoundingClientRect();
    for (const kid of el.children) {
      const kr = kid.getBoundingClientRect();
      if (kr.height === 0) continue;
      if (kr.bottom > pr.bottom + 2 && !inClosedDetails(kid)) {
        add("親からはみ出し", { 親: el.id || el.className, 子: kid.tagName + "." + String(kid.className || "").slice(0, 18), はみ出し: Math.round(kr.bottom - pr.bottom) + "px" });
      }
    }
  }

  // 3-2) カードから横へはみ出している要素（孫まで見る）
  //     直接の子しか見ていなかったため、数値表がカードから右へ62px出ていたのを
  //     取り逃した。ページ全体の横スクロールも起きないので気づけなかった。
  for (const card of document.querySelectorAll("main .card")) {
    if (inClosedDetails(card)) continue;
    const cr = card.getBoundingClientRect();
    if (!cr.width) continue;
    // 途中にスクロール枠（overflow-x が visible でない要素）があれば、
    // はみ出して見えても実際にはクリップされている。数値表がこれに当たる。
    const clipped = (el) => {
      for (let e = el.parentElement; e && e !== card; e = e.parentElement) {
        const ox = getComputedStyle(e).overflowX;
        if (ox && ox !== "visible") return true;
      }
      return false;
    };
    for (const el of card.querySelectorAll("*")) {
      if (inClosedDetails(el) || clipped(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const over = Math.round(Math.max(r.right - cr.right, cr.left - r.left));
      if (over > 2) {
        add("カードから横へはみ出し", { カード: card.id || card.className,
          要素: el.tagName + "." + String(el.className || "").slice(0, 18),
          はみ出し: over + "px" });
        break;   // 同じ原因で子孫が芋づるに出るので、カードごと1件に絞る
      }
    }
  }

  // 4) 文字が切れている（省略でなく物理的なはみ出し）
  for (const el of document.querySelectorAll("main h1, main h2, main .name, main .n, main .d, main .tiny, main .muted")) {
    if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== "auto"
        && getComputedStyle(el).textOverflow !== "ellipsis") {
      add("文字のはみ出し", { 要素: el.tagName + "." + String(el.className || "").slice(0, 18), txt: (el.textContent || "").trim().slice(0, 22), scroll: el.scrollWidth, client: el.clientWidth });
    }
  }

  // 5) タップ領域が小さすぎる（44px 未満）
  // 見た目が小さくても ::after で当たり判定を広げているものがある（.tap）。
  // 描画上の高さだけで数えると、対処済みのものを毎回挙げて本物が埋もれる。
  const tapHeight = (b) => {
    const r = b.getBoundingClientRect();
    const after = getComputedStyle(b, "::after");
    if (after.content === "none" || after.position !== "absolute") return r.height;
    const h = parseFloat(after.height);
    return Number.isFinite(h) ? Math.max(r.height, h) : r.height;
  };
  // 本文の中の出典リンク（footer）は行の高さのまま。**的を広げると文が崩れる**ので、
  // §3「タップ領域」の対象外として扱う（毎回挙げると本物の指摘が埋もれる）。
  const small = [...document.querySelectorAll("main button, main a, main select")]
    .filter((b) => !b.closest("#footer")).filter((b) => {
    const r = b.getBoundingClientRect();
    return r.height > 0 && tapHeight(b) < 32;
  }).map((b) => ({ txt: (b.textContent || "").trim().slice(0, 14), h: Math.round(tapHeight(b)) }));
  if (small.length) add("タップ領域が小さい", { 件数: small.length, 例: small.slice(0, 5) });

  return report;
};

/*
 * 描いたあとの DOM が HTML として正しいか（2026-10-01 ユーザー「HTML でのチェックもしてね」）。
 * index.html の静的な部分は test-html.mjs が見る。こちらは **JS が組み立てた部分**（一覧・詳細・道具の行など）。
 * 画面ごとに中身が変わるので、各画面を開いてから呼ぶ:  window.__htmlAudit()
 */
window.__htmlAudit = function () {
  const report = { issues: [] };
  const add = (kind, list) => { if (list.length) report.issues.push({ kind, 件数: list.length, 例: list.slice(0, 5) }); };
  const where = (el) => {
    const host = el.closest("[id]");
    return `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""}`
      + (host && host !== el ? ` @#${host.id}` : el.id ? `#${el.id}` : "");
  };
  // 同じ id
  const seen = new Map();
  for (const el of document.querySelectorAll("[id]")) seen.set(el.id, (seen.get(el.id) || 0) + 1);
  add("同じ id が2つ以上", [...seen].filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`));
  // 押せる物の中に押せる物（svg の中は除く）
  const inter = "a[href], button, input:not([type=hidden]), select, textarea, label, details, iframe";
  add("押せる物の中に押せる物", [...document.querySelectorAll("a[href], button")]
    .filter((h) => h.querySelector(inter)).map((h) => `${where(h)} ⊃ ${where(h.querySelector(inter))}`));
  // 句だけを入れる要素の中に塊
  const block = "div, p, ul, ol, li, dl, table, section, article, aside, nav, header, footer, h1, h2, h3, h4, h5, h6, form, figure, blockquote, pre, hr, details, dialog";
  add("ボタン・span・見出しの中に塊", [...document.querySelectorAll("button, span, strong, em, small, label, h1, h2, h3, h4, h5, h6")]
    .filter((h) => !h.closest("svg") && h.querySelector(block)).map((h) => `${where(h)} ⊃ ${where(h.querySelector(block))}`));
  // <p> の中に塊を書くと、ブラウザが <p> を閉じて、属性の無い空の <p> が残る
  add("属性の無い空の <p>（<p> の中に塊を書いた跡）", [...document.querySelectorAll("p")]
    .filter((p) => !p.attributes.length && !p.childNodes.length).map(where));
  // 参照先
  const refs = [];
  for (const k of ["for", "aria-labelledby", "aria-describedby", "aria-controls"]) {
    for (const el of document.querySelectorAll(`[${k}]`)) {
      for (const id of el.getAttribute(k).split(/\s+/)) if (id && !document.getElementById(id)) refs.push(`${where(el)} ${k}="${id}"`);
    }
  }
  add("参照先の id が無い", refs);
  // 押せる物・入力欄に名前がある（読み上げで何の釦か分かる）
  const nameOf = (el) => (el.getAttribute("aria-label") || "").trim()
    || (el.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join("").trim()
    || (el.textContent || "").trim() || (el.getAttribute("title") || "").trim()
    || [...el.querySelectorAll("img[alt]")].map((i) => i.alt).join("").trim()
    || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent.trim())
    || el.closest("label")?.textContent.trim() || (el.getAttribute("placeholder") || "").trim();
  // hidden 属性の付いたもの自体は描かれない（ファイル選択の input は別の釦から開く）ので数えない
  add("名前の無い釦・入力欄", [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea")]
    .filter((el) => !el.hidden && !nameOf(el)).map(where));
  add("alt の無い img", [...document.querySelectorAll("img:not([alt])")].map(where));
  return report;
};
