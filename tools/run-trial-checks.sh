#!/bin/bash
# trial を公開する前の確認を1回で通す: 単体テスト、生成物の一致、探すの実ブラウザ確認。
# 使い方: python3 -m http.server 8992 --bind 127.0.0.1 を web で動かし、
#   NODE_PATH=<playwright のある node_modules> OUT=<ログ置き場> tools/run-trial-checks.sh
# SKIP_UNIT=1 で単体を、SKIP_BROWSER=1 で実ブラウザ確認を飛ばす。GitHub では .github/workflows/checks.yml が push のたびに回す。
# 失敗した確認があれば終了コード 1。ログは $OUT/<名前>.log。
cd "$(dirname "$0")/.." || exit 2
B=${BASE:-http://127.0.0.1:8992/trial/}; OUT=${OUT:-${TMPDIR:-/tmp}/astronotes-checks}; mkdir -p "$OUT"; failed=0
run(){ name=$1; shift; start=$(date +%s); env "$@" > "$OUT/$name.log" 2>&1; code=$?; echo "$name exit $code $(( $(date +%s)-start ))s"; [ $code -eq 0 ] || failed=1; }
if [ -z "$SKIP_UNIT" ]; then run unit node --test test-*.mjs; fi
run build-check python3 build-preview.py --check
[ -n "$SKIP_BROWSER" ] && exit $failed
run generic CANDIDATE_GENERIC_BASE=$B CANDIDATE_GENERIC_OUT="$OUT/generic" node tools/test-candidate-generic-runtime.cjs
run continuation CANDIDATE_BASE=${B}index.html CANDIDATE_OUT="$OUT/continuation" CANDIDATE_WIDTHS=320,390 node tools/check-trial-candidate-continuation.cjs
run composition COMPOSITION_BASE=${B}index.html COMPOSITION_OUT="$OUT/composition" node tools/test-candidate-composition.cjs
run workspace CANDIDATE_FLOW_BASE=$B node tools/test-candidate-workspace-flow.cjs
run unified node tools/test-candidate-unified-ui.cjs
run search-design SEARCH_DESIGN_BASE=$B node tools/test-explore-search-design.cjs
run preview-swipe PREVIEW_SWIPE_BASE=${B}index.html node tools/test-explore-preview-swipe.cjs
run bar-layout BAR_LAYOUT_BASE=${B}index.html BAR_LAYOUT_OUT="$OUT/bar" node tools/test-explore-bar-layout.cjs
run real-map CANDIDATE_MAP_OUT="$OUT/map" node tools/test-candidate-real-map.cjs
run record RECORD_DISCOVERY_BASE=${B}index.html node tools/test-record-discovery.cjs
run lifecycle PREVIEW_LIFECYCLE_BASE=${B}index.html node tools/test-explore-preview-lifecycle.cjs
run auto CANDIDATE_AUTO_BASE=${B}index.html node tools/test-candidate-auto-search.cjs
run date CANDIDATE_DATE_BASE=$B node tools/test-candidate-date-navigation.cjs
run compose COMPOSE_BASE=$B node tools/test-explore-compose.cjs
run view-first VIEW_FIRST_BASE=$B node tools/test-explore-view-first.cjs
run error-log ERROR_LOG_BASE=$B node tools/test-trial-error-log.cjs
exit $failed
