#!/bin/bash
# Deploy the freshly built all-in-one binary to the fixed path ~/.hapi/bin/hapi.
# Usage: scripts/deploy-local.sh [tag]
#
# Fixed path is deliberate: macOS TCC keys permission grants to the executable
# path, so a stable path means Documents / media-library access is granted once
# and remembered across deploys (versioned filenames re-prompted every build).
#
# At the same time macOS caches the Mach-O signature per path, so overwriting
# the path can kill new processes (exit 137). This script therefore installs
# with a fresh mtime, proves the new binary execs repeatedly, and rolls back
# from ~/.hapi/bin/backups on any failure.
set -euo pipefail

cd "$(dirname "$0")/.."

build=cli/dist-exe/bun-darwin-arm64/hapi
bin_dir="$HOME/.hapi/bin"
stable="$bin_dir/hapi"
backup_dir="$bin_dir/backups"
stamp=$(date +%Y%m%d-%H%M%S)
tag=${1:-}

if [ ! -x "$build" ]; then
    echo "error: build missing at $build; run 'bun run build:single-exe' first" >&2
    exit 1
fi

mkdir -p "$bin_dir" "$backup_dir"

bash scripts/sign-build.sh "$build"

# Rollback copy of the currently installed binary. Never exec from here;
# rollback restores it onto the fixed path instead.
backup=""
if [ -f "$stable" ]; then
    backup="$backup_dir/hapi.$stamp${tag:+-$tag}"
    cp -p "$stable" "$backup"
    echo "backup: $backup"
fi

restore_backup() {
    if [ -z "$backup" ]; then
        echo "no backup to restore" >&2
        return 1
    fi
    echo "restoring $backup" >&2
    rm -f "$stable"
    cp "$backup" "$stable"
    chmod 755 "$stable"
    "$stable" --version
}

# Install to the fixed path with a fresh mtime (invalidates the path-keyed
# signature cache), then prove it execs repeatedly.
rm -f "$stable"
cp "$build" "$stable"
chmod 755 "$stable"
"$stable" --version
"$stable" --version
"$stable" --version
codesign --verify --deep --strict "$stable"
echo "installed: $stable"

launchctl kickstart -k "gui/$(id -u)/com.hapi.hub"
sleep 2
if ! curl -fsS http://127.0.0.1:3006/health >/dev/null; then
    echo "health check failed" >&2
    restore_backup || true
    launchctl kickstart -k "gui/$(id -u)/com.hapi.hub"
    exit 1
fi
echo "health ok"

# Refresh the runner so its machine RPCs/capabilities match the new binary.
# Compiled binaries never self-update: the heartbeat mtime check compares the
# runner's own resolved exec path, which is fixed for the life of the process.
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

# Keep disk usage bounded: newest N backups (default 2), drop legacy versioned files.
bash scripts/prune-backups.sh "${HAPI_KEEP_BACKUPS:-2}" "$bin_dir"

echo "rollback: rm -f '$stable' && cp '${backup:-<backup>}' '$stable' && chmod 755 '$stable' && launchctl kickstart -k gui/$(id -u)/com.hapi.hub"
