# three.js（そのまま置いてある）

- 版: **0.186.1**（npm の `three` の `build/` から `three.module.js` と `three.core.js` をそのままコピー）
- ライセンス: MIT（`LICENSE`）
- 取得元: https://registry.npmjs.org/three/0.186.1 の tarball

## なぜ CDN ではなく置いてあるか

CDN から読むと `script-src`（CSP）に外部を足すことになり、CDN が落ちた日に画面が死ぬ。
`self` から配れば、いまの CSP のままで動く。ビルドも要らない（ブラウザ標準の ESM と import map）。

正本: Vault `ドメイン/開発/絶景日和/03_技術構成`「ビルドは入れない。依存は vendoring なら可」

## 更新のしかた

1. 新しい版の tarball から `build/three.module.js` と `build/three.core.js` を上書き
2. この README の版を直す
3. 3D の画面（`#/sky` の「3D」）を実機で開いて、地形と太陽・月が出ることを見る
