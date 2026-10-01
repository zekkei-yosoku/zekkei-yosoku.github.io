// HTML としての検査（2026-10-01 ユーザー「UI でのチェックも必要だけど HTML でのチェックもしてね」）。
//
// 画面の見た目（test-layout・audit.js）とは別に、**書いた HTML が HTML として正しいか**を見る。
// パッケージを足さない方針なので、検査器は使わず、要る決まりを自前で見る:
//   - タグの閉じ忘れ・食い違い（省略できる終わりタグは HTML の決まりどおりに補う）
//   - 同じ id が2つ ／ for・aria-labelledby などの参照先が無い
//   - ボタン・リンクの中にボタン・リンク・入力欄（押せる物の入れ子）
//   - ボタン・見出し・span の中に div などの塊（ボタンの中身は「句」だけ）
//   - <p> の中に塊（ブラウザが勝手に <p> を閉じ、見た目と構造が食い違う）
//   - 知らない要素名（綴りの誤り）・同じ属性が2つ・img の alt
// JS が組み立てる部分は、描いたあとの DOM を audit.js の __htmlAudit() で見る。
import fs from "node:fs";

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };

const src = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const scripts = [...src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");

const VOID = new Set("area base br col embed hr img input link meta source track wbr".split(" "));
const KNOWN = new Set(("html head body title meta link style script noscript base main header footer nav aside section article "
  + "h1 h2 h3 h4 h5 h6 hgroup div p span a b i u s em strong small sub sup mark code kbd samp var q cite abbr dfn time data "
  + "br wbr hr pre blockquote ul ol li dl dt dd figure figcaption img picture source video audio track canvas iframe embed object "
  + "table caption thead tbody tfoot tr th td colgroup col form label input button select option optgroup textarea fieldset legend "
  + "datalist output progress meter details summary dialog template slot "
  // インラインの SVG
  + "svg g path circle ellipse line polyline polygon rect text tspan defs use symbol lineargradient radialgradient stop clippath mask title desc").split(" "));
// 句（phrasing）でない、塊の要素。ボタン・span・見出し・<p> の中に置けない
const BLOCK = new Set(("address article aside blockquote details dialog div dl fieldset figcaption figure footer form "
  + "h1 h2 h3 h4 h5 h6 header hgroup hr main menu nav ol p pre section table ul li dd dt").split(" "));
const INTERACTIVE = new Set("a button details embed iframe label select textarea".split(" "));
const PHRASING_ONLY = new Set("button span strong em b i small label h1 h2 h3 h4 h5 h6 q abbr code".split(" "));
// 終わりタグを省略できるもの（自分と同じ要素が来たら閉じる）
const SELF_CLOSING_SIBLING = { p: ["p"], li: ["li"], option: ["option", "optgroup"], dt: ["dt", "dd"], dd: ["dt", "dd"],
  tr: ["tr"], td: ["td", "th", "tr"], th: ["td", "th", "tr"] };
const OPTIONAL_END = new Set(["p", "li", "option", "optgroup", "dt", "dd", "tr", "td", "th", "thead", "tbody", "tfoot", "colgroup", "caption"]);

/// HTML を読んで、決まりに反する所を返す
function analyze(text) {
  // script・style・コメントの中身は HTML ではないので外す（行番号を保つため改行は残す）
  const blank = (s) => s.replace(/[^\n]/g, " ");
  const html = text
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (m, a, b, c) => a + blank(b) + c)
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, b, c) => a + blank(b) + c);
  const lineOf = (i) => html.slice(0, i).split("\n").length;
  const errors = { balance: [], nest: [], unknown: [], dupAttr: [], alt: [], pBlock: [] };
  const ids = new Map();
  const refs = [];
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const end = m[1] === "/", name = m[2].toLowerCase(), attrText = m[3] || "", selfClose = m[4] === "/";
    const at = lineOf(m.index);
    if (!KNOWN.has(name)) errors.unknown.push(`${at}行 <${name}>`);
    if (!end) {
      const attrs = [...attrText.matchAll(/([^\s"'>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g)]
        .map((a) => [a[1].toLowerCase(), (a[2] || "").replace(/^["']|["']$/g, "")]);
      const seen = new Set();
      for (const [k] of attrs) { if (seen.has(k)) errors.dupAttr.push(`${at}行 <${name} ${k}>`); seen.add(k); }
      const attr = Object.fromEntries(attrs);
      if (attr.id) ids.set(attr.id, (ids.get(attr.id) || []).concat(at));
      for (const k of ["for", "aria-labelledby", "aria-describedby", "aria-controls", "list"]) {
        if (attr[k]) for (const id of attr[k].split(/\s+/)) refs.push({ id, at, k });
      }
      if (name === "img" && !("alt" in attr)) errors.alt.push(`${at}行`);
      // 同じ要素が来たら閉じるもの（li の次の li など）
      const sib = Object.entries(SELF_CLOSING_SIBLING).find(([open, closers]) => stack.length
        && stack[stack.length - 1].name === open && closers.includes(name));
      if (sib) stack.pop();
      // <p> の中に塊が来ると、ブラウザは黙って <p> を閉じる
      if (BLOCK.has(name) && stack.length && stack[stack.length - 1].name === "p") {
        errors.pBlock.push(`${at}行 <p>（${stack[stack.length - 1].at}行）の中に <${name}>`);
        stack.pop();
      }
      const inside = (set) => stack.find((s) => set.has(s.name));
      if (name !== "svg" && !stack.some((s) => s.name === "svg")) {
        const host = inside(new Set(["a", "button"]));
        if (host && (INTERACTIVE.has(name) || (name === "input" && attr.type !== "hidden"))) {
          errors.nest.push(`${at}行 <${host.name}>（${host.at}行）の中に <${name}>`);
        }
        const phr = inside(PHRASING_ONLY);
        if (phr && BLOCK.has(name)) errors.nest.push(`${at}行 <${phr.name}>（${phr.at}行）の中に塊 <${name}>`);
      }
      if (!VOID.has(name) && !selfClose) stack.push({ name, at });
      continue;
    }
    // 終わりタグ
    if (VOID.has(name)) { errors.balance.push(`${at}行 </${name}>（空要素に終わりタグ）`); continue; }
    let k = stack.length - 1;
    while (k >= 0 && stack[k].name !== name && OPTIONAL_END.has(stack[k].name)) k--;
    if (k >= 0 && stack[k].name === name) { stack.length = k; continue; }
    if (name === "p") { errors.balance.push(`${at}行 </p> に対応する <p> が無い（直前で黙って閉じられている）`); continue; }
    errors.balance.push(`${at}行 </${name}> が、開いている <${stack.length ? stack[stack.length - 1].name : "（なし）"}>`
      + `（${stack.length ? stack[stack.length - 1].at : "-"}行）と合わない`);
  }
  for (const s of stack) if (!OPTIONAL_END.has(s.name) && !["html", "head", "body"].includes(s.name)) {
    errors.balance.push(`${s.at}行 <${s.name}> が閉じていない`);
  }
  return { errors, ids, refs };
}

console.log("== 検査器が誤りを見つけられるか（わざと壊した HTML） ==");
{
  const bad = (snippet) => analyze(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>t</title></head><body>${snippet}</body></html>`).errors;
  ok(bad("<div><span></div></span>").balance.length > 0, "閉じる順の食い違いを見つける");
  ok(bad("<section><div></section>").balance.length > 0, "閉じ忘れを見つける");
  ok(bad("<p>文<div>塊</div></p>").pBlock.length > 0, "<p> の中の塊を見つける");
  ok(bad("<button><a href=\"#\">x</a></button>").nest.length > 0, "ボタンの中のリンクを見つける");
  ok(bad("<button><div>x</div></button>").nest.length > 0, "ボタンの中の塊を見つける");
  ok(bad("<dvi>x</dvi>").unknown.length > 0, "知らない要素名を見つける");
  ok(bad("<span class=\"a\" class=\"b\">x</span>").dupAttr.length > 0, "同じ属性の2回を見つける");
  ok(bad("<img src=\"a.png\">").alt.length > 0, "alt の無い img を見つける");
  ok(Object.values(bad("<ul><li>a<li>b</ul><p>a<p>b</p><table><tr><td>1<td>2</table><img alt=\"\" src=\"a.png\"><br>")).every((e) => e.length === 0),
    "省略できる終わりタグ・空要素は誤りにしない");
  const d = analyze("<div id=\"x\"></div><div id=\"x\"></div><label for=\"nope\">a</label>");
  ok([...d.ids].some(([, l]) => l.length > 1) && d.refs.some((r) => r.id === "nope"), "同じ id と参照を拾う");
}

const { errors, ids, refs } = analyze(src);

console.log("== 文書の形 ==");
ok(/^<!doctype html>/i.test(src.trimStart()), "<!doctype html> で始まる");
ok(/<html lang="ja"/.test(src), "<html lang=\"ja\">");
ok(/<head>\s*<meta charset="utf-8">/i.test(src), "<meta charset> が head の最初");
ok(/<title>[^<]+<\/title>/.test(src), "<title> がある");
ok(/<meta name="viewport"/.test(src), "viewport がある");

console.log("== タグ ==");
ok(errors.balance.length === 0, "閉じ忘れ・食い違いが無い", errors.balance.slice(0, 8).join(" ／ "));
ok(errors.pBlock.length === 0, "<p> の中に塊を置かない", errors.pBlock.slice(0, 8).join(" ／ "));
ok(errors.unknown.length === 0, "知らない要素名が無い", errors.unknown.slice(0, 8).join(" ／ "));
ok(errors.dupAttr.length === 0, "同じ属性を2回書かない", errors.dupAttr.slice(0, 8).join(" ／ "));
ok(errors.alt.length === 0, "img に alt がある（飾りなら空）", errors.alt.join(" ／ "));

console.log("== 入れ子 ==");
ok(errors.nest.length === 0, "押せる物の中に押せる物・句の中に塊を置かない", errors.nest.slice(0, 8).join(" ／ "));

console.log("== JS が組み立てる HTML ==");
{
  // テンプレートの中の <button>〜</button> と <span>〜</span> に塊を書いていないか（描いたあとは audit.js の __htmlAudit が見る）。
  // 2026-10-01: ISS・月丼・ねらう・富士山の重なる日の行がボタンの中に <div> を入れていた
  const bad = [];
  for (const [open, close] of [["<button", "</button>"], ["<span", "</span>"]]) {
    let i = 0;
    while ((i = scripts.indexOf(open, i)) >= 0) {
      const end = scripts.indexOf(close, i);
      if (end < 0) break;
      const inner = scripts.slice(scripts.indexOf(">", i) + 1, end);
      // 同じ要素の入れ子（span の中の span）は、最初の閉じタグまでで見る。中に塊があれば違反
      const m = /<(div|p|h[1-6]|ul|ol|li|table|section)\b/.exec(inner);
      if (m && !inner.includes(open)) bad.push(`${scripts.slice(0, i).split("\n").length}行目付近 ${open}> の中に <${m[1]}>`);
      i = end;
    }
  }
  ok(bad.length === 0, "テンプレートのボタン・span の中に塊を書かない", bad.slice(0, 6).join(" ／ "));
}

console.log("== id ==");
const dup = [...ids].filter(([, lines]) => lines.length > 1);
ok(dup.length === 0, "同じ id が2つ無い", dup.map(([id, l]) => `${id}（${l.join("・")}行）`).join(" ／ "));
// 参照先は、静的な id か、JS が組み立てる HTML の id（id="..." や .id = "..."）
const scriptIds = new Set([...scripts.matchAll(/\bid="([A-Za-z][\w-]*)"/g), ...scripts.matchAll(/\.id = "([A-Za-z][\w-]*)"/g)].map((x) => x[1]));
const missing = refs.filter((r) => !ids.has(r.id) && !scriptIds.has(r.id));
ok(missing.length === 0, "for・aria-labelledby などの参照先がある", missing.map((r) => `${r.at}行 ${r.k}="${r.id}"`).join(" ／ "));
ok(ids.size > 150, "検査が空振りしていない", `${ids.size} 個の id`);

console.log(`\n${fail === 0 ? "HTML OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
