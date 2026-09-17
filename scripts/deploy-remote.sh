#!/bin/bash
# Deploy the built-and-signed all-in-one binary to a remote Mac over SSH.
# Usage: scripts/deploy-remote.sh <ssh-target> [tag]
#   e.g. scripts/deploy-remote.sh k2lab card-dedupe
#
# The remote host uses the same fixed-path layout as this repo:
# ~/.hapi/bin/hapi (real file) supervised by a launchd job
# (default com.hapi.runner; override with HAPI_REMOTE_LAUNCHD_LABEL).
#
# Fixed path keeps macOS TCC grants stable (granted once, remembered across
# deploys). To stay safe against the per-path code-signature cache the script
# backs up the installed binary, installs with a fresh mtime, proves the new
# binary execs repeatedly, and rolls back on any failure.
set -euo pipefail

cd "$(dirname "$0")/.."

target=${1:-}
tag=${2:-}
if [ -z "$target" ]; then
    echo "usage: scripts/deploy-remote.sh <ssh-target> [tag]" >&2
    exit 1
fi

label=${HAPI_REMOTE_LAUNCHD_LABEL:-com.hapi.runner}
build=cli/dist-exe/bun-darwin-arm64/hapi
stamp=$(date +%Y%m%d-%H%M%S)
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=10)

if [ ! -x "$build" ]; then
    echo "error: build missing at $build; run 'bun run build:single-exe' first" >&2
    exit 1
fi

# Sign locally with the pinned identity so the remote keeps a stable signer.
bash scripts/sign-build.sh "$build"

local_arch=$(uname -m)
remote_arch=$(ssh "${ssh_opts[@]}" "$target" 'uname -m')
if [ "$local_arch" != "$remote_arch" ]; then
    echo "error: remote arch $remote_arch does not match local build arch $local_arch" >&2
    exit 1
fi
remote_home=$(ssh "${ssh_opts[@]}" "$target" 'printf %s "$HOME"')

echo "target: $target ($remote_arch)"
echo "release: $stamp${tag:+-$tag}"

# Upload next to the fixed path, then install by move (fresh inode + mtime).
ssh "${ssh_opts[@]}" "$target" "mkdir -p '$remote_home/.hapi/bin/backups'"
scp -q -C "${ssh_opts[@]}" "$build" "$target:$remote_home/.hapi/bin/.hapi.incoming"

ssh "${ssh_opts[@]}" "$target" "STAMP='$stamp' TAG='$tag' LABEL='$label' bash -s" <<'REMOTE'
set -euo pipefail

bin_dir="$HOME/.hapi/bin"
stable="$bin_dir/hapi"
backup_dir="$bin_dir/backups"
incoming="$bin_dir/.hapi.incoming"

if [ ! -x "$incoming" ]; then
    echo "error: uploaded binary missing at $incoming" >&2
    exit 1
fi

backup=""
if [ -f "$stable" ]; then
    backup="$backup_dir/hapi.$STAMP${TAG:+-$TAG}"
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

rm -f "$stable"
mv "$incoming" "$stable"
chmod 755 "$stable"
"$stable" --version
"$stable" --version
"$stable" --version
codesign --verify --deep --strict "$stable"
echo "installed: $stable"

if ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    echo "error: launchd job $LABEL is not loaded on this host" >&2
    restore_backup || true
    exit 1
fi

launchctl kickstart -k "gui/$(id -u)/$LABEL"

runner_pid=""
runner_exe=""
for _ in $(seq 1 15); do
    sleep 1
    if [ -f "$HOME/.hapi/runner.state.json" ]; then
        runner_pid=$(sed -n 's/.*"pid": *\([0-9][0-9]*\).*/\1/p' "$HOME/.hapi/runner.state.json" | head -n 1 || true)
    fi
    if [ -n "$runner_pid" ] && kill -0 "$runner_pid" 2>/dev/null; then
        runner_exe=$(lsof -p "$runner_pid" 2>/dev/null | awk '$4=="txt"{print $NF}' | head -n 1)
        break
    fi
    runner_pid=""
done

if [ -z "$runner_pid" ]; then
    echo "warning: runner did not come up" >&2
    if restore_backup; then
        launchctl kickstart -k "gui/$(id -u)/$LABEL"
    fi
    exit 1
fi

echo "runner pid: $runner_pid"
echo "runner exe: $runner_exe"
case "$runner_exe" in
    "$stable") echo "remote deploy ok" ;;
    *) echo "warning: runner executable is $runner_exe, expected $stable" >&2 ;;
esac
REMOTE

# Keep remote disk usage bounded: newest N backups, drop legacy versioned files.
ssh "${ssh_opts[@]}" "$target" "HAPI_KEEP_BACKUPS='${HAPI_KEEP_BACKUPS:-2}' bash -s" < scripts/prune-backups.sh

echo "rollback: ssh $target \"rm -f ~/.hapi/bin/hapi && cp <backup> ~/.hapi/bin/hapi && chmod 755 ~/.hapi/bin/hapi && launchctl kickstart -k gui/\\\$(id -u)/$label\""
