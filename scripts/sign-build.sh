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

# codesign reads the private key from the login keychain, and only a GUI
# (Aqua) session can reach it: processes started by launchd/agents live in
# the Background domain and fail with errSecInternalComponent even while
# Keychain Access shows the keychain unlocked. Warn early with the fix
# instead of surfacing a bare codesign error. Ad-hoc signing needs no key.
if [ "$identity" != "-" ] && [ "$(launchctl managername 2>/dev/null || true)" != "Aqua" ]; then
    echo "warning: not running in a GUI (Aqua) session; codesign cannot reach the login keychain." >&2
    echo "warning: run the deploy from a Terminal window on this machine," >&2
    echo "warning: or run 'security unlock-keychain' first. (errSecInternalComponent)" >&2
fi

# Bun's linker signature is not suitable after installation; re-sign once.
codesign --remove-signature "$build" 2>/dev/null || true
codesign --force --sign "$identity" --identifier run.hapi.cli "$build"
codesign --verify --deep --strict "$build"
echo "signed build ok"
