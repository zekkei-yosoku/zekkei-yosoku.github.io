// 東京を拠点にした固定検証地点の正本。既存地点は spots.js、新規地点は下記の実測地図を参照。
// この設定は照合用。アプリ本体のスポット一覧には追加しない。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("./spots.js");
const catalog = globalThis.SORAMI_SPOTS.spots;
export const SITE_VERSION = "2026-09-06-tokyo-1";
const addedLocations = [
  { id: "kasai-rinkai", name: "葛西臨海公園", prefecture: "東京都江戸川区",
    latitude: 35.6423281, longitude: 139.8603385, elevation: 10, terrain: "coast",
    coordinateSource: "https://www.japan.travel/en/spot/1647/",
    locationRule: "臨海公園側の屋外。橋の先の葛西海浜公園、クリスタルビュー館内とは区別する。" },
  { id: "katagai", name: "片貝中央海岸", prefecture: "千葉県九十九里町",
    latitude: 35.527678553200545, longitude: 140.45222078756794, elevation: 0, terrain: "coast",
    coordinateSource: "https://maruchiba.jp/spot/detail_10660.html",
    locationRule: "片貝中央海岸の撮影に限定。九十九里の別海岸を混ぜない。" },
  { id: "inamuragasaki", name: "稲村ヶ崎", prefecture: "神奈川県鎌倉市",
    latitude: 35.3026605, longitude: 139.5248028, elevation: 8, terrain: "coast",
    coordinateSource: "https://cms.trip-kamakura.com/place/103.html",
    mapPinSource: "https://goo.gl/maps/ZBeCJrAETF12",
    locationRule: "鎌倉海浜公園の稲村ガ崎地区。江ノ島や七里ヶ浜から稲村ヶ崎を写した写真とは区別する。" },
  { id: "osanbashi", name: "大さん橋", prefecture: "神奈川県横浜市",
    latitude: 35.4516796, longitude: 139.6477606, elevation: null, terrain: "coast",
    coordinateSource: "https://www.openstreetmap.org/way/504126759",
    locationRule: "大さん橋屋上で撮影した空。地形DEMの1mを屋上の高さとして使わない。" },
].map((s) => ({ ...s, coordinateVerifiedOn: "2026-09-06",
  elevationSource: s.elevation === null ? "屋上標高未確認。気象モデルの地形標高を使用" : "Open-Meteo elevation API、2026-09-06に座標で取得" }));
const definitions = [
  { id: "kasai-rinkai", phenomenon: "sunrise", region: "東京湾・都内",
    search: "葛西臨海公園 (朝焼け OR 朝日 OR 日の出)",
    source: "https://www.tokyo-park.or.jp/park/kasairinkai/index.html" },
  { id: "katagai", phenomenon: "sunrise", region: "九十九里・千葉",
    search: "片貝 (朝焼け OR 朝日 OR 日の出)",
    source: "https://maruchiba.jp/spot/detail_10660.html" },
  { id: "inubosaki", phenomenon: "sunrise", region: "銚子・千葉",
    search: "犬吠埼 (朝焼け OR 朝日 OR 日の出)",
    source: "https://www.choshikanko.com/kankoDB/犬吠埼灯台/" },
  { id: "katase", phenomenon: "sunset", region: "江ノ島周辺・湘南",
    displayName: "江ノ島（片瀬西浜）",
    locationRule: "撮影場所は片瀬西浜。江ノ島を写していても稲村ヶ崎など別地点からなら混ぜない。",
    search: "(片瀬西浜 OR 西浜海岸 OR 江ノ島 OR 江の島) (夕焼け OR 夕日 OR 夕陽 OR サンセット)",
    source: "https://www.fujisawa-kanko.jp/spot/katase_kugenuma/12.html" },
  { id: "inamuragasaki", phenomenon: "sunset", region: "鎌倉・湘南",
    search: "(稲村ヶ崎 OR 稲村ガ崎 OR 稲村ケ崎) (夕焼け OR 夕日 OR 夕陽 OR サンセット)",
    source: "https://www.trip-kamakura.com/kaiteki_kamakura/topics.php?id=24" },
  { id: "osanbashi", phenomenon: "sunset", region: "横浜・東京湾",
    search: "(大さん橋 OR 大桟橋 OR 横浜港) (夕焼け OR 夕日 OR 夕陽 OR サンセット)",
    source: "https://osanbashi.jp/floorguide/rooftop" },
];
export const VALIDATION_SITES = definitions.map((definition) => {
  const existing = catalog.find((s) => s.id === definition.id);
  const spot = existing || addedLocations.find((s) => s.id === definition.id);
  if (!spot || (existing && !spot.phenomena.includes(definition.phenomenon))) {
    throw new Error(`検証地点の根拠が不一致: ${definition.id}`);
  }
  return { ...spot, ...definition, coordinateSource: spot.coordinateSource || "spots.js",
    locationRule: definition.locationRule || spot.locationRule || "同じ名称の観望地点で撮影した写真に限定する。" };
});
