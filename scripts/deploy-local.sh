#!/bin/bash
# Deploy the freshly built all-in-one binary following docs/local-deployment.md.
# Usage: scripts/deploy-local.sh [tag]
set -euo pipefail

cd "$(dirname "$0")/.."

build=cli/dist-exe/bun-darwin-arm64/hapi
bin_dir="$HOME/.hapi/bin"
stable="$bin_dir/hapi"
stamp=$(date +%Y%m%d-%H%M%S)
tag=${1:-}
release="$bin_dir/hapi.$stamp${tag:+-$tag}"
identity_file="$HOME/.hapi/signing-identity"

if [ ! -x "$build" ]; then
    echo "error: build missing at $build; run 'bun run build:single-exe' first" >&2
    exit 1
fi

mkdir -p "$bin_dir"

# Stable identity keeps TCC grants across rebuilds. Ad-hoc signatures have no
# identity, so macOS re-asks every protected permission after each build.
# Resolution order: HAPI_SIGN_IDENTITY > stored SHA-1 > first Apple Development.
identity=${HAPI_SIGN_IDENTITY:-}
if [ -z "$identity" ]; then
    if [ -s "$identity_file" ]; then
        identity=$(cat "$identity_file")
    fi
    if [ -n "$identity" ] && ! security find-identity -v -p codesigning 2>/dev/null | grep -qF "$identity"; then
        echo "warning: stored signing identity is gone; re-detecting" >&2
        identity=""
    fi
    if [ -z "$identity" ]; then
        identity=$(security find-identity -v -p codesigning 2>/dev/null | awk '/Apple Development/ { print $2; exit }')
    fi
    if [ -z "$identity" ]; then
        echo "warning: no Apple Development identity found; ad-hoc signing will re-prompt TCC on every build" >&2
        identity=-
    else
        printf '%s\n' "$identity" > "$identity_file"
    fi
fi
echo "signing identity: $identity"

# Bun's linker signature is not suitable after installation; re-sign once.
codesign --remove-signature "$build" 2>/dev/null || true
codesign --force --sign "$identity" --identifier run.hapi.cli "$build"
codesign --verify --deep --strict "$build"
echo "signed build ok"

# -p preserves the mtime covered by the code-signature cache.
cp -p "$build" "$release"
codesign --verify --deep --strict "$release"
"$release" --version

if [ -L "$stable" ]; then
    old_target=$(readlink "$stable")
elif [ -e "$stable" ]; then
    old_target="hapi.bak.$stamp"
    mv "$stable" "$bin_dir/$old_target"
else
    old_target=""
fi
ln -sfn "$(basename "$release")" "$stable"
echo "stable link: $stable -> $(readlink "$stable")"
echo "rollback target: ${old_target:-none}"

launchctl kickstart -k "gui/$(id -u)/com.hapi.hub"
sleep 2
if ! curl -fsS http://127.0.0.1:3006/health >/dev/null; then
    echo "health check failed; restoring ${old_target:-none}" >&2
    if [ -n "$old_target" ]; then
        ln -sfn "$old_target" "$stable"
    else
        rm -f "$stable"
    fi
    launchctl kickstart -k "gui/$(id -u)/com.hapi.hub"
    exit 1
fi
echo "health ok"
"$stable" --version
