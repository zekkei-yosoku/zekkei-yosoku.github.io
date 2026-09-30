/*
 * 総点検。全現象を、それが実際に起こりうる地点で動かして確かめる。
 *
 * 東京だけで見ていると 7現象のうち4つが「対象外」で、
 * 雲海・霧氷・ダイヤモンドダストの採点が実データで動くのを一度も見ていない。
 * 標高のある地点、光害の少ない地点、そして【南半球（いま冬）】を混ぜる。
 *
 * 確かめること:
 *   1. 不変条件 — 点数が 0〜100、内訳の合計が点数と一致、欠測の扱い
 *   2. 期待 — 暗い空では星空が高い、標高が足りない地点は対象外、など
 *   3. 信頼度 — アンサンブルが取れて予測誤差が出ているか
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");

const SITES = [
  { name: "東京",        lat: 35.6812, lon: 139.7671, elevation: 10,   note: "都市・低地" },
  { name: "竹田城跡",     lat: 35.3003, lon: 134.8290, elevation: 353,  note: "雲海の名所" },
  { name: "高ボッチ高原",  lat: 36.1614, lon: 138.0022, elevation: 1665, note: "高標高・雲海/星空" },
  { name: "阿智村",       lat: 35.4400, lon: 137.7400, elevation: 800,  note: "星空（光害が少ない）" },
  { name: "旭川",        lat: 43.7706, lon: 142.3650, elevation: 112,  note: "ダイヤモンドダスト（冬）" },
  { name: "蔵王",        lat: 38.1450, lon: 140.4400, elevation: 1660, note: "霧氷（冬）" },
  { name: "ルアペフ山(NZ)", lat: -39.2817, lon: 175.5639, elevation: 1600, note: "南半球・いま冬" },
  { name: "ウシュアイア(AR)", lat: -54.8019, lon: -68.3030, elevation: 30, note: "南半球・寒冷" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let problems = [];
const flag = (site, id, msg, detail = "") =>
  problems.push(`${site} / ${S.PHENOMENA[id] ? S.PHENOMENA[id].name : id}: ${msg}${detail ? "  " + detail : ""}`);

const results = {};

for (const site of SITES) {
  let bundle, lp = null;
  try {
    [bundle, lp] = await Promise.all([
      S.fetchForecast(site.lat, site.lon, 8, { latitude: site.lat, longitude: site.lon, elevation: site.elevation }),
      S.LightPollution.lookup(site.lat, site.lon).catch(() => null),
    ]);
  } catch (e) { console.error(`  ${site.name}: 取得失敗 ${e.message}`); await sleep(15000); continue; }

  const place = { latitude: site.lat, longitude: site.lon, elevation: site.elevation, lightPollution: lp };
  const row = { site: site.name, note: site.note, mpsas: lp ? +lp.mpsas.toFixed(1) : null,
                ensemble: !!bundle.ensemble, phenomena: {} };

  const today = S.JstCal.startOfDay(Date.now());
  for (const id of Object.keys(S.SCORERS)) {
    // 直近の「まだ終わっていない回」を見る。
    // どの日を見たのかを控える。日付を記録しないと、実行時刻が回の終わりを
    // またいだときに翌日を採点していることに気づけない（一度これで誤読した）。
    let ev = null, evDay = null;
    for (let d = 0; d < 3 && !ev; d++) {
      const e = S.evaluate(id, today + d * 86400000, bundle, place);
      if (e && e.window[1] > Date.now()) { ev = e; evDay = d; }
    }
    if (!ev) { flag(site.name, id, "3日先までに評価できる回がない"); continue; }

    const out = { unavailable: ev.unavailable ? (ev.unavailable.reason || "?") : null,
                  score: Math.round(ev.score), rank: ev.rank ? ev.rank.label : "—",
                  conf: ev.confidence ? ev.confidence.label : "—",
                  err: ev.uncertainty && ev.uncertainty.expectedError !== null
                       ? Math.round(ev.uncertainty.expectedError) : null,
                  basis: ev.uncertainty ? ev.uncertainty.basis : "—",
                  agree: ev.uncertainty && ev.uncertainty.agreement !== null && ev.uncertainty.agreement !== undefined
                         ? Math.round(ev.uncertainty.agreement * 100) : null,
                  day: evDay, factors: ev.factors.length };
    row.phenomena[id] = out;

    // --- 不変条件 ---
    if (!(ev.score >= 0 && ev.score <= 100)) flag(site.name, id, "点数が 0〜100 の外", String(ev.score));
    if (ev.unavailable) {
      if (!ev.unavailable.message) flag(site.name, id, "対象外なのに理由が無い");
      if (ev.score !== 0) flag(site.name, id, "対象外なのに点数がある", String(ev.score));
    } else {
      if (!ev.factors.length) flag(site.name, id, "内訳が空");
      const sum = ev.base + ev.factors.reduce((a, f) => a + f.c, 0);
      if (Math.abs(sum - ev.score) > 0.05) {
        flag(site.name, id, "内訳の合計が点数と一致しない",
          `基準${ev.base.toFixed(1)} + 内訳${(sum - ev.base).toFixed(1)} = ${sum.toFixed(1)} ≠ ${ev.score.toFixed(1)}`);
      }
      if (!ev.confidence) flag(site.name, id, "信頼度が無い");
      // 雲海は、51通りの計算が気圧面を持たず天井を判定できないので、**わざと**モデルの割れ方で見る
      // （`ensembleBlind` に理由が入る。e43aead）。理由の無いときだけ指摘する（2026-09-30 総点検で直した）
      if (bundle.ensemble && ev.uncertainty && ev.uncertainty.basis !== "ensemble" && !ev.uncertainty.ensembleBlind) {
        flag(site.name, id, "アンサンブルがあるのに使われていない");
      }
      if (!ev.perModel || Object.keys(ev.perModel).length < 5) {
        flag(site.name, id, "モデル別の点数が少ない", String(Object.keys(ev.perModel || {}).length));
      }
    }
  }
  results[site.name] = row;
  console.error(`  ${site.name} ok  (光害 ${row.mpsas ?? "—"} / アンサンブル ${row.ensemble ? "あり" : "なし"})`);
  await sleep(2500);
}

// ---------------- 出力 ----------------
const IDS = Object.keys(S.PHENOMENA).sort((a, b) => S.PHENOMENA[a].order - S.PHENOMENA[b].order);
console.log("\n【現象ごとの結果】数字=点数、—=対象外\n");
const head = "地点".padEnd(20) + IDS.map((i) => S.PHENOMENA[i].name.slice(0, 4).padStart(6)).join("");
console.log(head);
for (const site of SITES) {
  const r = results[site.name];
  if (!r) { console.log(site.name.padEnd(20) + "  取得できず"); continue; }
  const cells = IDS.map((id) => {
    const p = r.phenomena[id];
    if (!p) return "    ?";
    return (p.unavailable ? "—" : `${p.score}${p.day ? "*" : ""}`).padStart(6);
  }).join("");
  console.log(site.name.padEnd(20) + cells);
}

console.log("  * が付いた欄は、今日の回が終わっているため翌日以降を採点している\n");
console.log("【期待どおりか】");
const check = (label, cond, detail = "") => {
  console.log(`  ${cond ? "ok  " : "NG  "}${label}${detail ? "  " + detail : ""}`);
  if (!cond) problems.push(`期待はずれ: ${label} ${detail}`);
};
const g = (s, id) => (results[s] && results[s].phenomena[id]) || null;

const tokyoStar = g("東京", "starrySky"), achiStar = g("阿智村", "starrySky");
if (tokyoStar && achiStar) {
  const bothZero = achiStar.score === 0 && tokyoStar.score === 0;
  check("光害の少ない阿智村のほうが東京より星空が高い（両方0の日は判定しない）",
    achiStar.unavailable || tokyoStar.unavailable || bothZero
      ? true : achiStar.score > tokyoStar.score,
    bothZero ? "両方0（雲で見えない日）なので判定を見送り"
             : `阿智村 ${achiStar.score} vs 東京 ${tokyoStar.score}`);
}
check("東京は標高10mなので雲海が対象外",
  !!(g("東京", "seaOfClouds") && g("東京", "seaOfClouds").unavailable),
  g("東京", "seaOfClouds") ? String(g("東京", "seaOfClouds").unavailable) : "");
check("高ボッチ高原(1665m)は雲海が採点される",
  g("高ボッチ高原", "seaOfClouds") && !g("高ボッチ高原", "seaOfClouds").unavailable,
  g("高ボッチ高原", "seaOfClouds") ? String(g("高ボッチ高原", "seaOfClouds").unavailable ?? g("高ボッチ高原", "seaOfClouds").score) : "");
check("高ボッチ高原(1665m)は霧氷の標高条件を満たす（季節で対象外にはなりうる）",
  g("高ボッチ高原", "rime") && g("高ボッチ高原", "rime").unavailable !== "terrain",
  g("高ボッチ高原", "rime") ? String(g("高ボッチ高原", "rime").unavailable ?? g("高ボッチ高原", "rime").score) : "");
check("いま夏の日本では旭川もダイヤモンドダストが対象外",
  g("旭川", "diamondDust") && !!g("旭川", "diamondDust").unavailable,
  g("旭川", "diamondDust") ? String(g("旭川", "diamondDust").unavailable ?? g("旭川", "diamondDust").score) : "");

const nz = results["ルアペフ山(NZ)"], ar = results["ウシュアイア(AR)"];
const southRime = [nz && nz.phenomena.rime, ar && ar.phenomena.rime].filter(Boolean);
check("南半球（いま冬）で霧氷が採点される地点がある",
  southRime.some((p) => !p.unavailable),
  southRime.map((p) => p.unavailable ?? p.score).join(" / "));
const southDD = [nz && nz.phenomena.diamondDust, ar && ar.phenomena.diamondDust].filter(Boolean);
check("南半球でダイヤモンドダストの判定が動く（対象外でも理由が出る）",
  southDD.length > 0, southDD.map((p) => p.unavailable ?? p.score).join(" / "));

console.log("\n【信頼度】");
for (const site of SITES) {
  const r = results[site.name]; if (!r) continue;
  const ev = r.phenomena.sunset;
  if (ev && !ev.unavailable) {
    console.log(`  ${site.name.padEnd(20)} 夕焼け ${String(ev.score).padStart(3)}点 ±${String(ev.err ?? "—").padStart(2)}  同じ評価 ${String(ev.agree ?? "—").padStart(3)}%  信頼度${ev.conf}`);
  }
}

console.log(`\n${problems.length === 0 ? "問題なし" : "問題 " + problems.length + " 件"}`);
for (const p of problems) console.log("  - " + p);
process.exit(problems.length ? 1 : 0);
