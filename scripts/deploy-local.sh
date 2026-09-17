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

if [ ! -x "$build" ]; then
    echo "error: build missing at $build; run 'bun run build:single-exe' first" >&2
    exit 1
fi

mkdir -p "$bin_dir"

bash scripts/sign-build.sh "$build"

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

# Refresh the runner so its machine RPCs/capabilities match the new binary.
# Compiled binaries never self-update after a deploy: the heartbeat mtime check
# compares against the runner's own resolved exec path, which never changes.
# `runner start` stops the stale runner first; running sessions are unaffected.
runner_state="$HOME/.hapi/runner.state.json"
runner_pid=$(sed -n 's/.*"pid": *\([0-9][0-9]*\).*/\1/p' "$runner_state" 2>/dev/null | head -n 1 || true)
if [ -n "${runner_pid:-}" ] && kill -0 "$runner_pid" 2>/dev/null; then
    if HAPI_CLI_EXECUTABLE="$stable" "$stable" runner start; then
        echo "runner refreshed"
    else
        echo "warning: runner refresh failed; run '$stable runner start' manually" >&2
        exit 1
    fi
else
    echo "runner not running; skipped refresh"
fi

# Keep disk usage bounded: current + previous version (override HAPI_KEEP_VERSIONS).
bash scripts/prune-versions.sh "${HAPI_KEEP_VERSIONS:-2}" "$bin_dir"
