#!/bin/bash
# Keep disk usage bounded for the fixed-path deployment:
#   - keep the newest N backup copies in <bin-dir>/backups (default 2)
#   - remove legacy versioned binaries (hapi.YYYYMMDD-HHMMSS*) from the
#     pre-fixed-path era; the fixed path ~/.hapi/bin/hapi is never touched
# Usage: scripts/prune-backups.sh [keep] [bin-dir]
set -euo pipefail

keep=${1:-${HAPI_KEEP_BACKUPS:-2}}
bin_dir=${2:-$HOME/.hapi/bin}
backup_dir="$bin_dir/backups"

case "$keep" in
    ''|*[!0-9]*)
        echo "error: keep must be a number >= 1" >&2
        exit 1
        ;;
esac
if [ "$keep" -lt 1 ]; then
    echo "error: keep must be >= 1" >&2
    exit 1
fi

if [ ! -d "$bin_dir" ]; then
    echo "prune: no $bin_dir, nothing to do"
    exit 0
fi

freed=0

if [ -d "$backup_dir" ]; then
    count=0
    for backup in $(ls -1 "$backup_dir" 2>/dev/null | grep -E '^hapi\.' | sort -r || true); do
        count=$((count + 1))
        if [ "$count" -le "$keep" ]; then
            continue
        fi
        size=$(stat -f "%z" "$backup_dir/$backup" 2>/dev/null || echo 0)
        rm -f "$backup_dir/$backup"
        freed=$((freed + size))
        echo "pruned backup: $backup ($((size / 1048576))MB)"
    done
    echo "kept backups: $((count < keep ? count : keep))"
fi

for version in $(ls -1 "$bin_dir" 2>/dev/null | grep -E '^hapi\.[0-9]{8}-[0-9]{6}' | sort -r || true); do
    size=$(stat -f "%z" "$bin_dir/$version" 2>/dev/null || echo 0)
    rm -f "$bin_dir/$version"
    freed=$((freed + size))
    echo "removed legacy: $version ($((size / 1048576))MB)"
done

echo "freed: $((freed / 1048576))MB"
