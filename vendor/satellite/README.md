# satellite.js（同梱）

- 版: 7.1.0（npm `satellite.js`、MIT）。取得 2026-09-30、tarball の sha512 先頭 `53a9d19a5f4d6fb755f4`
- 同梱したのは SGP4 の伝搬と座標変換に要るファイルだけ（`io.js` `propagation.js` `transforms.js` `ext.js` `constants.js` `propagation/*`）。
  `index.js` は WebAssembly 版を読み込み、その中に `from 'satellite.js'` という素の名前の読み込みがあってブラウザで解けないので入れない。
- 画面からは `import("./vendor/satellite/io.js")` のように個別に読む（three.js と同じく CSP は `script-src 'self'` のまま）。
- `package.json` は Node の検査で ESM として読ませるためだけのもの。
