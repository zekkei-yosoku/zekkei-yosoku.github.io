# AstroNotes

自然現象の見え方と撮影日時を調べるWebアプリです。
公開先: [AstroNotes](https://zekkei-yosoku.github.io/)

## 構成

- `src/index.html` / `src/` — 画面・操作・起動・同期の編集正本（機能別の責務と既存実行順）
- `index.html` / `astronotes-explore.js` — `./bump.sh` で生成する公開用資産。直接編集しない
- `astronotes-prediction.js` — 非公開予測APIの取得・条件照合・キャッシュ
- `astronotes-core.js` — 表示、暦、気象データの標準的な扱い
- `astronotes-astro.js` / `astronotes-align.js` — 天文計算、目標への幾何と見え方
- `astronotes-sky-map.js` — 地図上の天体の方位・高度と出入り
- `astronotes-datetime-ui.js` — 構図と地図で共有する日時操作

独自の採点処理・学習係数・研究用コードは非公開APIリポジトリで管理します。
過去に公開済みの版や、画面に表示する予測結果まで非公開にできるものではありません。
一般的な天文計算と地図の操作は端末で処理します。

## 写真の記録

写真は端末で長辺768pxのJPEGへ縮小し、撮影条件・点数の由来・保存時点の予報・12帯の色の指標とともに記録します。原寸は送信しません。写真一覧は60枚ずつ追加取得でき、保存上限は1人300枚です。分析データを蓄積する機能で、モデルの自動学習は行いません。

## 確認

編集入口は [sourceの編集と依存関係](src/00_編集と依存関係.md) と [AI向け設計索引](src/01_AIエージェント向け設計索引.md)。`./bump.sh` でsourceを組み立ててからcontent version/CSPを更新し、`python3 build-preview.py` でtrialを生成します。`node tools/build-index.mjs --check` は配信物とsourceの完全一致を確認します。

各 `test-*.mjs` をNode.jsで実行します。HTML生成後は
`node update-csp.mjs` でインラインスクリプトのCSPハッシュを更新します。
配信後は通常URLのファイル内容と、地図・日時・権限の実画面も確認します。

## 出典

気象: Open-Meteo、気象庁。地図: OpenStreetMap、国土地理院。
光害: Lorenz Light Pollution Atlas 2025。建物形状の資料と使用条件は画面の出典および `tools/` に記載しています。

## 資産名の互換性

現行の実装は `astronotes-*.js` / `astronotes-*.css` と `AstroNotes*` を使用する。`sorami-*.js` / `sorami-*.css` は古いHTMLのURL互換用として元の内容で残し、現行実装の編集元にはしない。旧グローバル名は現行オブジェクトへの互換aliasとして公開する。

既存利用者のデータと接続を保つため、`sorami.*` 保存キー、キャッシュ名、イベント名、通信ヘッダー、予定のUID、既存URLは互換識別子として維持する。過去の記録・引用・証跡は原文を保全する。
