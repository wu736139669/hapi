#!/bin/bash
# Deploy the freshly built all-in-one binary following docs/local-deployment.md.
set -euo pipefail

cd "$(dirname "$0")/.."
build=cli/dist-exe/bun-darwin-arm64/hapi
stamp=$(date +%Y%m%d-%H%M%S)
release="$HOME/.hapi/bin/hapi.$stamp-capacity-retry"
stable="$HOME/.hapi/bin/hapi"

echo "release: $release"

# Bun's linker signature is not suitable after installation; re-sign once.
codesign --remove-signature "$build" 2>/dev/null || true
codesign --force --sign - "$build"
codesign --verify --deep --strict "$build"
echo "signed build ok"

# -p preserves the mtime covered by the code-signature cache.
cp -p "$build" "$release"
codesign --verify --deep --strict "$release"
"$release" --version
echo "release verified"

if [ -L "$stable" ]; then
    old_target=$(readlink "$stable")
else
    old_target="hapi.bak.$stamp"
    mv "$stable" "$HOME/.hapi/bin/$old_target"
fi
ln -sfn "$(basename "$release")" "$stable"
echo "stable link: $stable -> $(readlink "$stable")"
echo "rollback target: $old_target"
