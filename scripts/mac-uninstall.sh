#!/bin/sh
# Remove only this archive's node_modules and build output.
set -eu
cd "$(dirname "$0")/.."
rm -rf node_modules dist
echo "removed node_modules and dist under $(pwd)"
echo "temporary SUPERBOT_STATE directories named sbot-mac-e2e-* were deleted by the e2e script"
