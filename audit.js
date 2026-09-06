/*
 * ページ全体のレイアウト監査。目視でなく座標と描画順で判定する。
 *
 * 使い方（ブラウザのコンソール）:
 *   const t = await (await fetch("/audit.js")).text(); new Function(t)();
 *   window.__audit();          // いまの表示位置を検査
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
  const small = [...document.querySelectorAll("main button, main a, main select")].filter((b) => {
    const r = b.getBoundingClientRect();
    return r.height > 0 && tapHeight(b) < 32;
  }).map((b) => ({ txt: (b.textContent || "").trim().slice(0, 14), h: Math.round(tapHeight(b)) }));
  if (small.length) add("タップ領域が小さい", { 件数: small.length, 例: small.slice(0, 5) });

  return report;
};
