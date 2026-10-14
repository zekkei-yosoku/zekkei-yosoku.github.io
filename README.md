# 絶景予測

自然現象の見え方と撮影日時を調べるWebアプリです。
公開先: [絶景予測](https://zekkei-yosoku.github.io/)

## 構成

- `index.html` — 画面と道具間の連携
- `sorami-prediction.js` — 非公開予測APIの取得・条件照合・キャッシュ
- `sorami-core.js` — 表示、暦、気象データの標準的な扱い
- `sorami-astro.js` / `sorami-aim.js` — 天文計算、目標への幾何と見え方
- `sorami-sky-map.js` — 地図上の天体の方位・高度と出入り
- `sorami-datetime-ui.js` — 重ねるとスカイマップで共有する日時操作

独自の採点処理・学習係数・研究用コードは非公開APIリポジトリで管理します。
過去に公開済みの版や、画面に表示する予測結果まで非公開にできるものではありません。
一般的な天文計算と地図の操作は端末で処理します。

## 確認

各 `test-*.mjs` をNode.jsで実行します。HTML変更後は
`node update-csp.mjs` でインラインスクリプトのCSPハッシュを更新します。
配信後は通常URLのファイル内容と、地図・日時・権限の実画面も確認します。

## 出典

気象: Open-Meteo、気象庁。地図: OpenStreetMap、国土地理院。
光害: Lorenz Light Pollution Atlas 2025。建物形状の資料と使用条件は画面の出典および `tools/` に記載しています。
