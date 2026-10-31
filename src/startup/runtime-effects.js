import {WIDE,bundle} from '../app/browser-state.js';
import {render} from '../features/forecast/view.js';
// 幅が閾値をまたいだら描画し直す（ウィンドウのリサイズ・画面回転）
WIDE.addEventListener("change", () => { if (bundle) render(); });

// GitHub Pages は HTML に max-age=600 を付けるため、更新しても最大10分は
// 古い index.html が使われる。JS 側にキャッシュバスターを付けていても、
// その版番号を書いている HTML 自体が古いので効かない（実際に旧画面が出た）。
//
// 読み込み後に本物の HTML を取りに行き、版が違えば一度だけ読み直す。
// 一度きりにするのは、取得に失敗し続けたときの再読み込みループを避けるため。
async function checkForUpdate() {
  const release = document.querySelector('meta[name="app-version"]')?.content;
  const running = (document.querySelector('script[src*="astronotes-core.js"]') || {}).src || "";
  const mine = release || (running.match(/[?&]v=(\d+)/) || [])[1];
  if (!mine) return;
  try {
    const html = await (await fetch(location.pathname + "?v=" + Date.now(), { cache: "no-store" })).text();
    const latest = (html.match(/name="app-version" content="(\d+)"/) || [])[1] || (html.match(/astronotes-core\.js\?v=(\d+)/) || [])[1];
    if (!latest || latest === mine) return;
    // 読み直し済みの印は「読み直した先の版」で持つ。走っている版で持つと、
    // 同じセッション中の2回目の配信を拾えなくなる（1回で打ち止めになる）
    if (sessionStorage.getItem("sorami.reloaded") === latest) return;
    sessionStorage.setItem("sorami.reloaded", latest);
    location.reload();
  } catch { /* 取れなければそのまま使う。更新確認は補助 */ }
}

// 枠の中で開かれていたら止める。**戻せない操作がある**（アカウントの削除、
// すべての端末からログアウト）。GitHub Pages はヘッダを足せず、
// frame-ancestors は meta では効かないので、ここで見るしかない。
if (window.top !== window.self) {
  document.body.innerHTML =
    '<p style="padding:24px;font:16px/1.8 system-ui">この画面は枠の中では開けません。'
    + '<br><a href="https://zekkei-yosoku.github.io/" target="_top">AstroNotesをひらく</a></p>';
  throw new Error("枠の中では開けません");
}

// 説明文の折り返し候補を、句読点の後ろだけに置く。
// CSS の word-break:keep-all と対で効く。**片方だけでは意味が無い。**
for (const el of document.querySelectorAll(".sheet .hint, .sheet .tiny")) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
  for (const t of texts) {
    if (!/[。、・]/.test(t.data)) continue;
    const frag = document.createDocumentFragment();
    // 区切り文字を残したまま分ける
    for (const part of t.data.split(/([。、・])/)) {
      if (!part) continue;
      frag.append(part);
      if (/^[。、・]$/.test(part)) frag.append(document.createElement("wbr"));
    }
    t.replaceWith(frag);
  }
}

// シートを開いている間、後ろの本文を動かさない。
// **`<dialog>` は背面の「操作」は止めるが、「スクロール」は止めない。**
// 指やホイールが背面に乗ると本文が流れ、閉じたときに別の場所を見ていることになる。
//
// 開閉のたびに各所へ書き足すのではなく、dialog の open 属性を見て一括で扱う。
// 呼び出し箇所は10か所以上あり、**書き忘れが必ず出る**（管理画面で同じ失敗をした）。
// E94: calendar, image and shared link all use the same immutable plan snapshot.
export {checkForUpdate};
