#!/bin/sh
# Assemble all source, validate classic scripts, and atomically write versioned/CSP delivery.
set -eu
cd "$(dirname "$0")"
node tools/build-index.mjs
