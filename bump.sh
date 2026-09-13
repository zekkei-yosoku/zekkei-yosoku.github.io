#!/bin/sh
# JS のキャッシュバスターを更新する。index.html を編集したら実行してから commit する。
cd "$(dirname "$0")"
# 秒まで入れる。分単位だと連続で直したときに同じ版になり、
# 古い JS がキャッシュから使われて画面が壊れる（実際に踏んだ）。
V=$(date +%Y%m%d%H%M%S)
# **読み込んでいる自前の .js を全部まとめて更新する。**
# 以前は spots.js と sorami-core.js だけを名指ししていた。2026-09-14 に
# sorami-astro / terrain / mountain / fuji / moon / composition を足したとき、
# ここを直し忘れて**新しい5ファイルが古いまま使われる**ところだった。
# 名指しをやめ、`?v=数字` が付いているものを機械的に置き換える。
sed -i '' -E "s/([A-Za-z0-9_-]+\.js\?v=)[0-9]+/\1$V/g" index.html
echo "cache buster -> $V"
echo "更新した読み込み:"
grep -oE '[A-Za-z0-9_-]+\.js\?v=[0-9]+' index.html | sed 's/^/  /'
# 取りこぼしが無いか。**版の付いていない自前の js があれば言う**
grep -oE 'src="[A-Za-z0-9_-]+\.js"' index.html | sed 's/^/  ★版が付いていない: /' || true
