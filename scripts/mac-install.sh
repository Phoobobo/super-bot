#!/bin/sh
# Install this archive in place. Does not read auth files or touch an existing SUPERBOT_STATE.
set -eu
cd "$(dirname "$0")/.."
npm ci
npm run build
echo "installed $(pwd)"
echo "uninstall with scripts/mac-uninstall.sh"
