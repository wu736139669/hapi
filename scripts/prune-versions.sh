#!/bin/bash
# Prune old versioned hapi binaries in a deployment bin dir, keeping the current
# symlink target plus the N most recent previous versions (default 2 total).
# Usage: scripts/prune-versions.sh [keep-count] [bin-dir]
#   keep-count defaults to $HAPI_KEEP_VERSIONS, then 2 (current + previous).
#   bin-dir defaults to $HOME/.hapi/bin.
# Safe to run while sessions are live: unlinking a binary does not affect
# running processes (they keep the open file), only future rollbacks.
set -euo pipefail

keep=${1:-${HAPI_KEEP_VERSIONS:-2}}
bin_dir=${2:-$HOME/.hapi/bin}

case "$keep" in
    ''|*[!0-9]*)
        echo "error: keep-count must be a number >= 2" >&2
        exit 1
        ;;
esac
if [ "$keep" -lt 2 ]; then
    echo "error: keep-count must be >= 2 (current + previous)" >&2
    exit 1
fi

if [ ! -d "$bin_dir" ]; then
    echo "prune: no $bin_dir, nothing to do"
    exit 0
fi

stable="$bin_dir/hapi"
current=""
if [ -L "$stable" ]; then
    current=$(readlink "$stable")
fi

# Newest-first by filename: hapi.YYYYMMDD-HHMMSS[-tag] sorts chronologically.
versions=$(ls -1 "$bin_dir" 2>/dev/null | grep -E '^hapi\.[0-9]{8}-[0-9]{6}' | sort -r || true)

kept=""
count=0
freed=0
if [ -n "$current" ] && [ -f "$bin_dir/$current" ]; then
    kept="$current"
    count=1
fi

for version in $versions; do
    [ "$version" = "$current" ] && continue
    if [ "$count" -lt "$keep" ]; then
        kept="$kept $version"
        count=$((count + 1))
        continue
    fi
    size=$(stat -f "%z" "$bin_dir/$version" 2>/dev/null || echo 0)
    rm -f "$bin_dir/$version"
    freed=$((freed + size))
    echo "pruned: $version ($((size / 1048576))MB)"
done

echo "kept:${kept:- none} (count=$count)"
echo "freed: $((freed / 1048576))MB"
