#!/bin/bash
# Sign the all-in-one build with the pinned stable identity so macOS TCC
# grants survive rebuilds. Shared by deploy-local.sh and deploy-remote.sh.
# Usage: scripts/sign-build.sh [build-path]
set -euo pipefail

cd "$(dirname "$0")/.."

build=${1:-cli/dist-exe/bun-darwin-arm64/hapi}
identity_file="$HOME/.hapi/signing-identity"

if [ ! -x "$build" ]; then
    echo "error: build missing at $build; run 'bun run build:single-exe' first" >&2
    exit 1
fi

# Ad-hoc signatures have no stable identity, so every rebuild looks like a new
# app and macOS re-asks each protected permission. Resolution order:
# HAPI_SIGN_IDENTITY > stored SHA-1 > first Apple Development identity.
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
        mkdir -p "$(dirname "$identity_file")"
        printf '%s\n' "$identity" > "$identity_file"
    fi
fi
echo "signing identity: $identity"

# Bun's linker signature is not suitable after installation; re-sign once.
codesign --remove-signature "$build" 2>/dev/null || true
codesign --force --sign "$identity" --identifier run.hapi.cli "$build"
codesign --verify --deep --strict "$build"
echo "signed build ok"
