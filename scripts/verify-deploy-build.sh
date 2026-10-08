#!/bin/bash
# Reject release artifacts that omit locally required fixes before installing.
# An isolated checkout can build successfully while excluding uncommitted work.
set -euo pipefail

build=${1:?usage: verify-deploy-build.sh <binary>}
if [ ! -f "$build" ]; then
    echo "error: release artifact missing: $build" >&2
    exit 1
fi

# These wire/error/SQL literals survive the all-in-one bundle's minification.
# Check the artifact, not its version: local builds can share a version number.
for marker in \
    'codex-history-sync' \
    'codex_history_epochs' \
    'History batch was not confirmed' \
    'Transcript delivery unconfirmed' \
    'usage_session_sources'; do
    if ! LC_ALL=C grep -aqF -- "$marker" "$build"; then
        echo "error: release artifact omits required feature: $marker" >&2
        echo "error: rebuild from the complete deployment workspace, including untracked source files" >&2
        exit 1
    fi
done

echo "release features ok: durable Codex history, confirmed delivery, persistent usage"
