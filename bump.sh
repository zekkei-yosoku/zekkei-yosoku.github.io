#!/bin/sh
# Update only changed resource ids, the HTML release id, and exact CSP hashes.
set -eu
cd "$(dirname "$0")"
node update-assets.mjs
node update-csp.mjs
