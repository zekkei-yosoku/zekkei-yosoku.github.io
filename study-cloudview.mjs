/*
 * 秩父市・秩父観光なびの公式「秩父雲海カメラ」を観測台帳にする。
 *
 * Xの投稿ではなく、公式カメラが保存している静止画の撮影日時を使う。
 * 画像そのものは保存せず、出典ページと画像URLだけを記録する。
 * observedQuality は画像を目視確認した後に none / weak / strong を入れる。
 * 未確認画像を陰性にしないため、初回出力はすべて unreviewed にする。
 *
 * 使い方:
 *   node study-cloudview.mjs 6 data/cloudview-sightings-YYYYMMDD.json
 *
 * 公式サイトは過去20日程度を保持しているため、取得できる日だけを出力する。
 */
import { writeFileSync } from "node:fs";

export const CLOUDVIEW_BASE = "https://navi.city.chichibu.lg.jp/cloudview";

function htmlDecode(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

/**
 * 「毎日同時刻」のHTMLから公式カメラ画像の日時とURLだけを取り出す。
 * 同じ画像が複数箇所に載る場合は画像URLで重複排除する。
 */
export function parseCloudviewPage(html, pageUrl = CLOUDVIEW_BASE) {
  const rows = [];
  const seen = new Set();
  const itemRe = /<button\b[^>]*data-full="([^"]+)"[^>]*data-caption="([^"]+)"[^>]*>[\s\S]*?<\/button>/g;
  for (const match of html.matchAll(itemRe)) {
    const imagePath = htmlDecode(match[1]);
    const cameraTime = htmlDecode(match[2]);
    if (!/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(cameraTime)) continue;
    if (!imagePath.startsWith("/photos/")) continue;
    if (seen.has(imagePath)) continue;
    seen.add(imagePath);
    const date = cameraTime.slice(0, 10).replaceAll("/", "-");
    rows.push({
      date,
      cameraTime,
      phenomenon: "seaOfClouds",
      status: "unreviewed",
      observedQuality: null,
      source: pageUrl,
      imageUrl: new URL(imagePath, CLOUDVIEW_BASE + "/").href,
    });
  }
  return rows.sort((a, b) => a.cameraTime.localeCompare(b.cameraTime));
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": "ZekkeiYosoku-validation/1.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.text();
}

async function main() {
  const hour = process.argv[2] ?? "6";
  const output = process.argv[3] ?? `data/cloudview-sightings-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.json`;
  if (!/^\d{1,2}$/.test(hour) || Number(hour) > 23) {
    throw new Error("時間は0〜23で指定してください");
  }
  const source = `${CLOUDVIEW_BASE}/every/${Number(hour)}/`;
  const records = parseCloudviewPage(await fetchText(source), source);
  const payload = {
    source,
    attribution: "秩父雲海カメラ（秩父市・秩父観光なび）",
    license: "CC BY-NC 4.0",
    camera: "秩父グリーンミューズパーク 旅立ちの丘",
    hour: Number(hour),
    note: "公式保存画像の撮影日時を使う。画像未確認は陰性にしない。",
    records,
  };
  writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`公式カメラ ${Number(hour)}時頃: ${records.length}件を ${output} に保存`);
  console.log("画像を目視確認した行だけ observedQuality を none / weak / strong に更新する。");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
