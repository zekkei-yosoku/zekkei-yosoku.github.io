/*
 * 人工衛星の日本語名の表を作る。**一度走らせて、結果を同梱する。**
 *
 *   node build-satellite-names.mjs    → data/satellite-names-ja.json
 *
 * 2026-10-21 ユーザー「日本語名一覧とかないの？」。CelesTrak の衛星名は英語（HIMAWARI-8 など）だけなので、
 * Wikidata（CC0）の「衛星カタログ番号（P377）」と日本語の名前を突き合わせて、番号→日本語名の表を持つ。
 * 同じ番号に複数の項目が付くことがある（25544 は 国際宇宙ステーション と ザーリャ）。
 * 呼び名を決めておきたいものだけ OVERRIDES で上書きし、残りの日本語名は別名（検索用）に入れる。
 *
 * 出力: { source, license, fetchedAt, names: [[番号, 日本語名, 英語名, [別名…]], …] }（番号順）
 */
import fs from "node:fs";

const OUT = new URL("./data/satellite-names-ja.json", import.meta.url);
// Wikidata の名前より、利用者が呼ぶ名前を優先するもの
const OVERRIDES = {
  25544: "ISS（国際宇宙ステーション）",
  48274: "天宮（中国の宇宙ステーション）",   // Wikidata は中心モジュールの「天和」
};

const query = `SELECT ?s ?scn ?ja ?en (GROUP_CONCAT(DISTINCT ?alt; separator="|") AS ?alts) WHERE {
  ?s wdt:P377 ?scn .
  ?s rdfs:label ?ja . FILTER(LANG(?ja) = "ja")
  OPTIONAL { ?s rdfs:label ?en . FILTER(LANG(?en) = "en") }
  OPTIONAL { ?s skos:altLabel ?alt . FILTER(LANG(?alt) = "ja") }
} GROUP BY ?s ?scn ?ja ?en`;

const res = await fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}`, {
  headers: { Accept: "application/sparql-results+json", "User-Agent": "AstroNotes-satellite-names/1.0 (https://zekkei-yosoku.github.io/)" },
});
if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
const rows = (await res.json()).results.bindings;

const byNo = new Map();
for (const r of rows) {
  const no = Number(r.scn.value);
  if (!Number.isInteger(no) || no <= 0) continue;   // 番号でない値（予備の記法など）は捨てる
  const qid = Number(r.s.value.replace(/.*Q/, ""));
  const e = byNo.get(no) || [];
  e.push({ qid, ja: r.ja.value, en: r.en ? r.en.value : "", alts: r.alts && r.alts.value ? r.alts.value.split("|") : [] });
  byNo.set(no, e);
}

const names = [...byNo.entries()].sort((a, b) => a[0] - b[0]).map(([no, items]) => {
  items.sort((a, b) => a.qid - b.qid);   // 同じ番号に複数あるときは、古い項目（多くは衛星そのもの）を先に
  const ja = OVERRIDES[no] || items[0].ja;
  const en = items.find((i) => i.en)?.en || "";
  const alias = [...new Set(items.flatMap((i) => [i.ja, ...i.alts]))].filter((s) => s && s !== ja);
  return alias.length ? [no, ja, en, alias] : [no, ja, en];
});

fs.writeFileSync(OUT, JSON.stringify({
  source: "Wikidata (P377 satellite catalog number + Japanese label)",
  license: "CC0 1.0",
  fetchedAt: new Date().toISOString().slice(0, 10),
  names,
}) + "\n");
console.log(`${names.length} 機 → ${OUT.pathname}`);
