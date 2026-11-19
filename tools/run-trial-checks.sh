#!/bin/bash
# 本番と trial を公開する前の確認を1回で通す: 単体テスト、生成物の一致、探すの実ブラウザ確認。
# 使い方: python3 tools/serve-checks.py を web で動かし、
#   NODE_PATH=<playwright のある node_modules> OUT=<ログ置き場> tools/run-trial-checks.sh
# SKIP_UNIT=1 で単体を、SKIP_BROWSER=1 で実ブラウザ確認を飛ばす。GitHub では .github/workflows/checks.yml が push のたびに回す。
# 各検査は既定300秒で失敗終了する。長時間検査が必要なら CHECK_TIMEOUT_SECONDS で明示する。
# 失敗した確認があれば終了コード 1。ログは $OUT/<名前>.log。
cd "$(dirname "$0")/.." || exit 2
B=${BASE:-http://127.0.0.1:8992/trial/}; OUT=${OUT:-${TMPDIR:-/tmp}/astronotes-checks}; mkdir -p "$OUT"; failed=0
# 落ちた確認はログの末尾を出す（GitHubでは $OUT が残らない）
run(){
  name=$1; shift; start=$(date +%s); echo "$name start (timeout ${CHECK_TIMEOUT_SECONDS:-300}s)"
  python3 tools/run-check-command.py "${CHECK_TIMEOUT_SECONDS:-300}" env "$@" > "$OUT/$name.log" 2>&1
  code=$?; echo "$name exit $code $(( $(date +%s)-start ))s"
  [ $code -eq 0 ] || { failed=1; tail -n 30 "$OUT/$name.log" | sed "s/^/  $name| /"; }
}
# API のソース（../api、非公開）と突き合わせる2本は、それが無い場所（GitHub）では回せない。
units=(test-*.mjs)
if [ ! -f ../api/src/index.js ]; then units=(); for f in test-*.mjs; do case $f in test-access-table.mjs|test-layout.mjs) echo "skip $f (../api が無い)";; *) units+=("$f");; esac; done; fi
if [ -z "$SKIP_UNIT" ]; then run unit node --test "${units[@]}"; fi
run source-check node tools/build-index.mjs --check
run overlap-check python3 tools/build-overlap-products.py --check
run build-check python3 build-preview.py --check
[ -n "$SKIP_BROWSER" ] && exit $failed
run generic CANDIDATE_GENERIC_BASE=$B CANDIDATE_GENERIC_OUT="$OUT/generic" node tools/test-candidate-generic-runtime.cjs
run continuation CANDIDATE_BASE=${B}index.html CANDIDATE_OUT="$OUT/continuation" CANDIDATE_WIDTHS=320,390 node tools/check-trial-candidate-continuation.cjs
run composition COMPOSITION_BASE=${B}index.html COMPOSITION_OUT="$OUT/composition" node tools/test-candidate-composition.cjs
run composition-entry COMPOSITION_ENTRY_BASE=${B}index.html COMPOSITION_ENTRY_OUT="$OUT/composition-entry" node tools/test-composition-search-entry.cjs
run composition-layout COMPOSITION_STABILITY_BASE=${B}index.html COMPOSITION_STABILITY_OUT="$OUT/composition-layout" COMPOSITION_STABILITY_WIDTH=320 COMPOSITION_STABILITY_THEME=dark node tools/test-composition-layout-stability.cjs
run workspace CANDIDATE_FLOW_BASE=$B node tools/test-candidate-workspace-flow.cjs
run preview-positions POSITION_NAV_BASE=$B POSITION_NAV_OUT="$OUT/positions" node tools/test-preview-position-navigation.cjs
run unified node tools/test-candidate-unified-ui.cjs
run search-design SEARCH_DESIGN_BASE=$B node tools/test-explore-search-design.cjs
run preview-swipe PREVIEW_SWIPE_BASE=${B}index.html node tools/test-explore-preview-swipe.cjs
run bar-layout BAR_LAYOUT_BASE=${B}index.html BAR_LAYOUT_OUT="$OUT/bar" node tools/test-explore-bar-layout.cjs
run real-map CANDIDATE_MAP_OUT="$OUT/map" node tools/test-candidate-real-map.cjs
run record RECORD_DISCOVERY_BASE=${B}index.html node tools/test-record-discovery.cjs
run record-alignment OPPORTUNITIES_BASE=${B}index.html OPPORTUNITIES_ALIGNMENT=1 OPPORTUNITIES_WIDTH=320,390 OPPORTUNITIES_THEME=dark OPPORTUNITIES_OUT="$OUT/record-alignment" node tools/test-record-opportunities.cjs
run lifecycle PREVIEW_LIFECYCLE_BASE=${B}index.html node tools/test-explore-preview-lifecycle.cjs
run auto CANDIDATE_AUTO_BASE=${B}index.html node tools/test-candidate-auto-search.cjs
run date CANDIDATE_DATE_BASE=$B node tools/test-candidate-date-navigation.cjs
run compose COMPOSE_BASE=$B node tools/test-explore-compose.cjs
run view-first VIEW_FIRST_BASE=$B node tools/test-explore-view-first.cjs
run obstruction-display OBSTRUCTION_BASE=${B}index.html OBSTRUCTION_OUT="$OUT/obstruction" node tools/test-preview-obstruction-display.cjs
run preview-calculation-cache PREVIEW_CACHE_BASE=$B PREVIEW_CACHE_OUT="$OUT/preview-calculation-cache" node tools/test-preview-calculation-cache.cjs
run error-log ERROR_LOG_BASE=$B node tools/test-trial-error-log.cjs
exit $failed
