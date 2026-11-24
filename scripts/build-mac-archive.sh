#!/bin/sh
# Build a version-pinned archive for a later Mac run. Does not publish or deploy.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
sha=$(git -C "$root" rev-parse HEAD)
short=$(git -C "$root" rev-parse --short=12 HEAD)
out=${1:-/tmp/super-bot-mac-$short.tar.gz}
stage=$(mktemp -d)
name=super-bot-mac-$short
dest=$stage/$name
mkdir -p "$dest"
cd "$root"
npm run build
tar -C "$root" -cf - \
  package.json package-lock.json LICENSE NOTICE README.md \
  docs examples skills src dist scripts/mac-e2e.mjs scripts/mac-install.sh scripts/mac-uninstall.sh \
  tsconfig.json | tar -C "$dest" -xf -
cat > "$dest/ARCHIVE.txt" <<EOF
super-bot mac archive
commit $sha
entry scripts/mac-install.sh
then SUPERBOT_MAC_E2E=1 node scripts/mac-e2e.mjs
default dry-run. live requires SUPERBOT_MAC_LIVE=1
never drives an existing hc pane
EOF
tar -C "$stage" -czf "$out" "$name"
checksum=$(sha256sum "$out" | awk '{print $1}')
echo "$checksum  $out"
echo "$checksum" > "${out}.sha256"
rm -rf "$stage"
