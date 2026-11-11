import {$} from '../../ui/presentation-helpers.js';
import {store} from '../../app/browser-state.js';
import {inheritedPoint} from '../places/controller.js';
import {createMapView} from '../../ui/map/picker.js';
import {issApply,issPick} from './controller.js';
// ---------------------------------------------------------------- 人工衛星（旧 ISS の月面通過）
//
// 衛星の位置は CelesTrak の軌道要素（TLE）を SGP4（satellite.js）で進める。
// 軌道要素は日に数回更新され、宇宙ステーションはときどき高度を上げるので、**先の日ほど外れる**。
// 7日先まで出し、3日より先には「目安」と付ける。
// 2026-10-21 ユーザー「ISSを衛星を探す系のページにしたい」。ISS 専用だったのは取ってくる衛星番号だけなので、
// 衛星を選べるようにし、空を横切る「通過」の表示を足した。道・権限ID・保存キー（sorami.iss*）は互換のため変えない。
const ISS_PRESETS = [[25544, "ISS（国際宇宙ステーション）"], [48274, "天宮（中国の宇宙ステーション）"], [20580, "ハッブル宇宙望遠鏡"]];
const iss = { body: "moon", rangeKm: 150, sat: null, tle: null, result: [], pick: 0, seq: AstroNotesLibrary.gate(), wired: false,
              from: null,   // 探す範囲の中心。null ならAstroNotesの地点を引き継ぐ（ねらうと同じ。2026-10-01）
              tab: "pass", catnr: Number(store.get("sorami.issSat", 25544)) || 25544,
              extra: store.get("sorami.issSatExtra", null),   // 「衛星を選ぶ」で選んだ、よく見る3機以外の衛星 { catnr, name（CelesTrak の名前） }
              names: null,   // 番号→{ ja, en, alias }（data/satellite-names-ja.json）
              passes: [], passPick: 0, showAll: false, track: [] };
/// 選んでいる衛星の呼び名
function issSatName() {
  const p = ISS_PRESETS.find(([n]) => n === iss.catnr);
  if (p) return p[1].replace(/（.*）$/, "");
  const w = iss.names && iss.names.get(iss.catnr);
  if (w) return w.ja;
  return iss.extra && iss.extra.catnr === iss.catnr ? iss.extra.name : `衛星 ${iss.catnr}`;
}
/// 衛星のカード: 日本語名（無ければ CelesTrak の英語名）と、英語名・衛星番号
function issRenderSatCard() {
  const p = ISS_PRESETS.find(([n]) => n === iss.catnr);
  const w = iss.names && iss.names.get(iss.catnr);
  const ex = iss.extra && iss.extra.catnr === iss.catnr ? iss.extra : null;
  $("issSatName").textContent = p ? p[1] : w ? w.ja : ex ? ex.name : `衛星 ${iss.catnr}`;
  const en = (ex && ex.name) || (w && w.en) || "";
  $("issSatSub").textContent = [p || w ? en : "", `衛星番号 ${iss.catnr}`].filter(Boolean).join(" ・ ");
}
/// ISS の探す範囲の中心。替えていなければAstroNotesの地点。**観測地点ではない**（立つ場所は回ごとに帯の中から選ぶ）
function issFromPoint() { return iss.from || inheritedPoint(); }
function issSetFrom(p) {
  iss.from = p ? { name: p.name, subtitle: p.subtitle || "", latitude: p.latitude, longitude: p.longitude } : null;
  // 地図も新しい中心へ（帯はその近くに出る）
  const P = issFromPoint();
  IssMap.open({ latitude: P.latitude, longitude: P.longitude }, iss.tab === "pass" ? 5 : 8);
  // 「今夜見える」は前の地点で解いたものなので消す
  issPick.visSeq.cancel(); issPick.visible = null;
  issApply();
}
const IssMap = createMapView({ canvas: "issCanvas", zoomIn: "issIn", zoomOut: "issOut" });

export {ISS_PRESETS,IssMap,iss,issFromPoint,issRenderSatCard,issSatName,issSetFrom};
