#!/bin/bash
# Deploy the built-and-signed all-in-one binary to a remote Mac over SSH.
# Usage: scripts/deploy-remote.sh <ssh-target> [tag]
#   e.g. scripts/deploy-remote.sh k2lab stable-signing
#
# The remote host must use this repo's deployment layout: a versioned binary
# under ~/.hapi/bin/ with the stable `hapi` symlink, supervised by a launchd
# job (default com.hapi.runner; override with HAPI_REMOTE_LAUNCHD_LABEL).
# Running sessions survive the restart; new sessions use the new binary.
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
release="hapi.$stamp${tag:+-$tag}"
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=10)

if [ ! -x "$build" ]; then
    echo "error: build missing at $build; run 'bun run build:single-exe' first" >&2
    exit 1
fi

# Sign locally with the pinned identity: the remote TCC database keys grants
# to the signing identity, so shipping an ad-hoc build there re-triggers
# permission prompts after every deploy.
bash scripts/sign-build.sh "$build"

local_arch=$(uname -m)
remote_arch=$(ssh "${ssh_opts[@]}" "$target" 'uname -m')
if [ "$local_arch" != "$remote_arch" ]; then
    echo "error: remote arch $remote_arch does not match local build arch $local_arch" >&2
    exit 1
fi
remote_home=$(ssh "${ssh_opts[@]}" "$target" 'printf %s "$HOME"')

echo "target: $target ($remote_arch)"
echo "release: $release"

# Copy to a NEW versioned filename: macOS caches Mach-O signatures by path,
# so never overwrite an existing executable path.
ssh "${ssh_opts[@]}" "$target" "mkdir -p '$remote_home/.hapi/bin'"
scp -q -C "${ssh_opts[@]}" "$build" "$target:$remote_home/.hapi/bin/$release"

ssh "${ssh_opts[@]}" "$target" "STAMP='$stamp' TAG='$tag' LABEL='$label' bash -s" <<'REMOTE'
set -euo pipefail

bin_dir="$HOME/.hapi/bin"
stable="$bin_dir/hapi"
new_name="hapi.$STAMP${TAG:+-$TAG}"
new="$bin_dir/$new_name"

if [ ! -x "$new" ]; then
    echo "error: uploaded binary missing at $new" >&2
    exit 1
fi

codesign --verify --deep --strict "$new"
"$new" --version

if ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    echo "error: launchd job $LABEL is not loaded on this host" >&2
    exit 1
fi

old_target=""
if [ -L "$stable" ]; then
    old_target=$(readlink "$stable")
fi

ln -sfn "$new_name" "$stable"
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

echo "link: $(readlink "$stable")"
echo "rollback target: ${old_target:-none}"
if [ -z "$runner_pid" ]; then
    echo "warning: runner not up yet; check 'launchctl print gui/$(id -u)/$LABEL'" >&2
    exit 1
fi
echo "runner pid: $runner_pid"
echo "runner exe: $runner_exe"
case "$runner_exe" in
    *"$new_name"*) echo "remote deploy ok" ;;
    *) echo "warning: runner executable is not $new_name; it will switch on the next restart" >&2 ;;
esac
REMOTE

# Keep disk usage bounded on the remote host: current + previous version.
ssh "${ssh_opts[@]}" "$target" "HAPI_KEEP_VERSIONS='${HAPI_KEEP_VERSIONS:-2}' bash -s" < scripts/prune-versions.sh

echo "rollback: ssh $target \"ln -sfn <old target> ~/.hapi/bin/hapi && launchctl kickstart -k gui/\\\$(id -u)/$label\""
