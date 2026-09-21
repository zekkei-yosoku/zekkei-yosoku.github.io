// 朝夕焼けの検証に使う環境省ライブカメラの地点。照合用で、アプリ本体のスポット一覧には追加しない。
//
// 2026-09-21追加。Obsidian の検証（ドメイン/開発/絶景日和/朝焼け・夕焼け/02_検証結果）で、
// 2018年の定点写真1年分を人手採点と突き合わせて選んだ地点。採用と保留の理由は次のとおり。
//
//   加太(52)   採用（期間限定）。光軸267.3度・水平画角50.4度を太陽円板の目視読み取りで確定。
//              5〜7月と12月は日の入りが画角外になるので、その期間は太陽方向の空を見ていない。
//   五色台(70) 採用（期間限定）。光軸282.1度・画角71.8度。12〜1月が画角外。
//   竹富(106)  保留。光軸271.4度・画角67.6度で日の入りは通年画角内だが、写真指標と人手採点の
//              順位一致が0.62/0.70と目安0.7に届かない標本がある。2018年内に保存解像度が変わった。
//   玉取崎(104) 保留。光軸・画角が未確定。太陽円板がはっきり写るフレームが1枚しか見つからず、
//              その1枚（夏至前後）で既に画面右端だった。通年で太陽方向が画角外の可能性が高い。
//
// 田貫湖(43)と浄土ヶ浜(116)は入れていない。田貫湖は2標本とも写真の色づきがほぼ0で説明変数に
// ならず、浄土ヶ浜は生物多様性センターの利用規約で「環境省の所有ではないカメラ」として
// PDL1.0の適用外とされ、権利者の許諾なしには使えない。
//
// ここで保存するのは予報であって画像ではない。画像の利用条件とは別に、予報の保存は
// Open-Meteo の利用条件に従う。
export const AFTERGLOW_CAMERA_SITE_VERSION = "2026-09-21-afterglow-cameras-1";

export const AFTERGLOW_CAMERA_SITES = [
  {
    id: "kada-kitan", name: "紀州加太からみた紀淡海峡", prefecture: "和歌山県和歌山市",
    latitude: 34.292845, longitude: 135.072338, elevation: 90, terrain: "coast",
    phenomenon: "sunset", cameraNumber: 52,
    coordinateSource: "https://www.sizenken.biodic.go.jp/view_new.php?no=52",
    elevationSource: "https://api.open-meteo.com/v1/elevation、2026-09-21に座標で取得",
    elevationNote: "DEMの値。カメラ取付高は未確認。",
    locationRule: "環境省インターネット自然研究所のカメラ地点。加太の別地点からの撮影と混ぜない。",
    fieldOfView: { axisAzimuthDeg: 267.3, horizontalFovDeg: 50.4,
      method: "太陽円板の目視読み取り2点で解き、未使用の3枚目で検証（2026-09-21）",
      eventOutsideFrameMonths: [5, 6, 7, 12] },
    adoption: "採用（期間限定）",
  },
  {
    id: "goshikidai-setonaikai", name: "五色台からみた瀬戸内海", prefecture: "香川県坂出市",
    latitude: 34.356592, longitude: 133.920114, elevation: 373, terrain: "coast",
    phenomenon: "sunset", cameraNumber: 70,
    coordinateSource: "https://www.sizenken.biodic.go.jp/view_new.php?no=70",
    elevationSource: "https://api.open-meteo.com/v1/elevation、2026-09-21に座標で取得",
    elevationNote: "DEMの値。カメラ取付高は未確認。",
    locationRule: "環境省インターネット自然研究所のカメラ地点。五色台の別展望地と混ぜない。",
    fieldOfView: { axisAzimuthDeg: 282.1, horizontalFovDeg: 71.8,
      method: "太陽円板の目視読み取り2点で解き、未使用の3枚目で検証（2026-09-21）",
      eventOutsideFrameMonths: [1, 12] },
    adoption: "採用（期間限定）",
  },
  {
    id: "taketomi-nishisanbashi", name: "竹富島・西桟橋", prefecture: "沖縄県竹富町",
    latitude: 24.331569, longitude: 124.079837, elevation: 0, terrain: "coast",
    phenomenon: "sunset", cameraNumber: 106,
    coordinateSource: "https://www.sizenken.biodic.go.jp/view_new.php?no=106",
    elevationSource: "https://api.open-meteo.com/v1/elevation、2026-09-21に座標で取得",
    elevationNote: "DEMの値0m。カメラ取付高は未確認。",
    locationRule: "環境省インターネット自然研究所のカメラ地点。竹富島の別海岸と混ぜない。",
    fieldOfView: { axisAzimuthDeg: 271.4, horizontalFovDeg: 67.6,
      method: "太陽円板の目視読み取り2点で解き、未使用の3枚目で検証（2026-09-21）",
      eventOutsideFrameMonths: [] },
    adoption: "保留（写真指標と人手採点の一致が目安未満）",
  },
  {
    id: "tamatorizaki", name: "石垣島・玉取崎", prefecture: "沖縄県石垣市",
    latitude: 24.490556, longitude: 124.278918, elevation: 39, terrain: "coast",
    phenomenon: "sunrise", cameraNumber: 104,
    coordinateSource: "https://www.sizenken.biodic.go.jp/view_new.php?no=104",
    elevationSource: "https://api.open-meteo.com/v1/elevation、2026-09-21に座標で取得",
    elevationNote: "DEMの値。カメラ取付高は未確認。",
    locationRule: "環境省インターネット自然研究所のカメラ地点。石垣島の別展望地と混ぜない。",
    fieldOfView: { axisAzimuthDeg: null, horizontalFovDeg: null,
      method: "未確定。円板がはっきり写るフレームが1枚のみで2点そろわない",
      eventOutsideFrameMonths: null },
    adoption: "保留（光軸・画角が未確定）",
  },
].map((s) => ({ ...s, coordinateVerifiedOn: "2026-09-21" }));
