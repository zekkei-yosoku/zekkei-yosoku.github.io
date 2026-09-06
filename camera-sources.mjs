// 固定検証地点に使える公開カメラの調査台帳。
// live-only は現在の状態確認用で、過去日の実景照合には使わない。
export const CAMERA_SOURCE_VERSION = "2026-09-06";

export const CAMERA_HISTORY = Object.freeze({
  TIMESTAMPED_ARCHIVE: "timestamped-archive",
  LIVE_ONLY: "live-only",
  EVENT_REPLAY: "event-replay",
  UNVERIFIED: "unverified",
});

export const CAMERA_SOURCES = Object.freeze([
  {
    id: "chichibu-cloudview",
    siteId: "chichibu-unkai",
    name: "秩父雲海カメラ",
    provider: "秩父市",
    type: "official-page",
    url: "https://navi.city.chichibu.lg.jp/cloudview/",
    coverage: "exact",
    history: CAMERA_HISTORY.TIMESTAMPED_ARCHIVE,
    cadence: "5min",
    phenomena: ["seaOfClouds"],
    checkedOn: CAMERA_SOURCE_VERSION,
    evidence: "撮影日時を指定して過去約20日分の画像URLを取得できる。",
  },
  {
    id: "enoshima-yacht-harbor",
    siteId: "katase",
    name: "江の島ヨットハーバー公式ライブカメラ",
    provider: "リビエラリゾート",
    type: "official-page",
    url: "https://www.riviera.co.jp/marina/enoshima/livecamera/",
    coverage: "nearby",
    history: CAMERA_HISTORY.LIVE_ONLY,
    cadence: "live",
    phenomena: ["sunset", "sunrise"],
    checkedOn: CAMERA_SOURCE_VERSION,
    evidence: "湘南港から片瀬東浜〜鎌倉〜逗子方面をライブ配信。過去画像の案内は確認できない。",
  },
  {
    id: "katase-kugenuma-namiaru",
    siteId: "katase",
    name: "鵠沼海岸ライブカメラ",
    provider: "NAMIARU MOVIE",
    type: "youtube",
    url: "https://livecamera.fujiyamasan.com/kanagawa-fujisawa-kugenuma-coast.html",
    coverage: "nearby",
    history: CAMERA_HISTORY.LIVE_ONLY,
    cadence: "live",
    phenomena: ["sunset", "sunrise"],
    checkedOn: CAMERA_SOURCE_VERSION,
    evidence: "新江ノ島水族館前〜片瀬西浜・江の島・相模湾を動画で確認できる。過去画像の案内はない。",
  },
  {
    id: "inamuragasaki-liveatlas",
    siteId: "inamuragasaki",
    name: "稲村ヶ崎ライブカメラ",
    provider: "湘南ライブカメラ（YouTube）",
    type: "youtube",
    url: "https://live-atlas.com/place/inamuragasaki/",
    coverage: "exact",
    history: CAMERA_HISTORY.LIVE_ONLY,
    cadence: "live",
    phenomena: ["sunset"],
    checkedOn: CAMERA_SOURCE_VERSION,
    evidence: "稲村ヶ崎の現在映像とYouTubeリンクを確認できる。過去画像の案内はない。",
  },
  {
    id: "osanbashi-official",
    siteId: "osanbashi",
    name: "大さん橋公式ウェブカメラ",
    provider: "横浜港大さん橋国際客船ターミナル",
    type: "official-page",
    url: "https://osanbashi.jp/floorguide/web_camera",
    coverage: "exact",
    history: CAMERA_HISTORY.LIVE_ONLY,
    cadence: "10sec",
    phenomena: ["sunset"],
    checkedOn: CAMERA_SOURCE_VERSION,
    evidence: "10秒ごとに最新状態へ切り替わる。過去画像・録画の案内は確認できない。",
  },
  {
    id: "inubosaki-coast-guard",
    siteId: "inubosaki",
    name: "犬吠埼灯台ライブカメラ",
    provider: "海上保安庁",
    type: "official-page",
    url: "https://www6.kaiho.mlit.go.jp/03kanku/choshi/inubosaki_lt/kisyou/index.html",
    coverage: "exact",
    history: CAMERA_HISTORY.LIVE_ONLY,
    cadence: "live",
    phenomena: ["sunrise"],
    checkedOn: CAMERA_SOURCE_VERSION,
    evidence: "犬吠埼灯台の海況・映像をリアルタイム提供。過去映像の案内は確認できない。",
  },
  {
    id: "katagai-bcm",
    siteId: "katagai",
    name: "片貝漁港・片貝新堤ライブ画像",
    provider: "BCM（Surf Patrol）",
    type: "live-page",
    url: "https://www.surfers-ocean.com/%E3%82%B5%E3%83%BC%E3%83%95%E3%82%A3%E3%83%B3%E6%B3%A2%E6%83%85%E5%A0%B1/%E7%89%87%E8%B2%9D/",
    coverage: "nearby",
    history: CAMERA_HISTORY.LIVE_ONLY,
    cadence: "unknown",
    phenomena: ["sunrise"],
    checkedOn: CAMERA_SOURCE_VERSION,
    evidence: "片貝漁港・片貝新堤の現在画像を掲載。固定地点の片貝中央海岸との画角一致は未確認で、過去画像の案内もない。",
  },
  {
    id: "katagai-ichimatsu-youtube",
    siteId: "katagai",
    name: "一松海岸YouTubeライブ（周辺）",
    provider: "長生村",
    type: "youtube",
    url: "https://www.surfers-ocean.com/%E3%82%B5%E3%83%BC%E3%83%95%E3%82%A3%E3%83%B3%E6%B3%A2%E6%83%85%E5%A0%B1/%E7%89%87%E8%B2%9D/",
    coverage: "nearby",
    history: CAMERA_HISTORY.UNVERIFIED,
    cadence: "live",
    phenomena: ["sunrise"],
    checkedOn: CAMERA_SOURCE_VERSION,
    evidence: "片貝から南へ離れた一松海岸のライブ。地点一致の確認には使わない。",
  },
  {
    id: "kasai-weathernews-nearby",
    siteId: "kasai-rinkai",
    name: "江戸川区中葛西ライブカメラ（周辺）",
    provider: "ウェザーニュース",
    type: "official-page",
    url: "https://weathernews.jp/onebox/livecam/kanto/tokyo/7CDDE90688C6/",
    coverage: "nearby",
    history: CAMERA_HISTORY.LIVE_ONLY,
    cadence: "10min",
    phenomena: ["sunrise"],
    checkedOn: CAMERA_SOURCE_VERSION,
    evidence: "葛西臨海公園の周辺天気を見る補助カメラ。公園内の景観確認には使わない。",
  },
]);

const validHistory = new Set(Object.values(CAMERA_HISTORY));
const validTypes = new Set(["official-page", "live-page", "youtube"]);
const validCoverage = new Set(["exact", "nearby"]);

export function validateCameraSources(sources = CAMERA_SOURCES) {
  const ids = new Set();
  for (const source of sources) {
    if (!source.id || ids.has(source.id)) throw new Error(`カメラIDが重複: ${source.id}`);
    ids.add(source.id);
    if (!source.siteId || !source.name || !source.provider || !source.url) throw new Error(`カメラ台帳の必須項目不足: ${source.id}`);
    if (!validTypes.has(source.type)) throw new Error(`カメラ種別が不正: ${source.id}`);
    if (!validCoverage.has(source.coverage)) throw new Error(`カメラ範囲が不正: ${source.id}`);
    if (!validHistory.has(source.history)) throw new Error(`履歴種別が不正: ${source.id}`);
    if (!source.checkedOn || !source.evidence) throw new Error(`確認根拠が不足: ${source.id}`);
    if (source.history === CAMERA_HISTORY.TIMESTAMPED_ARCHIVE && source.coverage !== "exact") {
      throw new Error(`地点一致しないアーカイブを採用不可: ${source.id}`);
    }
  }
  return true;
}

export function sourcesFor(siteId) {
  return CAMERA_SOURCES.filter((source) => source.siteId === siteId);
}

export function historicalSourcesFor(siteId) {
  return sourcesFor(siteId).filter((source) => source.history === CAMERA_HISTORY.TIMESTAMPED_ARCHIVE);
}

validateCameraSources();
