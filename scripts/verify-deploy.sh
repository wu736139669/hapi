#!/bin/bash
# Post-deploy functional verification for mini + k2lab.
#
# Proves the machines are actually USABLE, not just that a binary was installed:
#   health / version / signer / mtime / runner process & executable
#   hub metadata matches the installed file
#   agent availability did not regress vs the last passing run
#   Codex model loading still works where it worked before
#
# Usage:
#   scripts/verify-deploy.sh                # verify, update baseline on PASS
#   scripts/verify-deploy.sh --init         # only record current state as baseline
#   scripts/verify-deploy.sh --json         # machine-readable summary
#   scripts/verify-deploy.sh --no-baseline  # skip baseline comparison
#
# Exit: 0 = PASS, 1 = FAIL, 2 = setup error (hub unreachable / no JWT)
#
# Never prints the hub token.
set -uo pipefail

cd "$(dirname "$0")/.."

HUB=${HAPI_HUB_URL:-http://127.0.0.1:3006}
REMOTE_TARGET=${HAPI_REMOTE_TARGET:-k2lab}
LOCAL_NAME=${HAPI_LOCAL_NAME:-小吴家}
REMOTE_NAME=${HAPI_REMOTE_NAME:-小吴k2lab}
STABLE="$HOME/.hapi/bin/hapi"
BASELINE="$HOME/.hapi/deploy-baseline.json"

JSON=0
INIT=0
USE_BASELINE=1
for arg in "$@"; do
    case "$arg" in
        --json) JSON=1 ;;
        --init) INIT=1 ;;
        --no-baseline) USE_BASELINE=0 ;;
        -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
        *) echo "unknown arg: $arg" >&2; exit 2 ;;
    esac
done

fails=0
warns=0
rows=()
json_rows=()

record() { # status check detail
    local status=$1 check=$2 detail=$3
    rows+=("$status|$check|$detail")
    json_rows+=("{\"status\":\"$status\",\"check\":\"$check\",\"detail\":\"$detail\"}")
    case "$status" in
        FAIL) fails=$((fails + 1)) ;;
        WARN) warns=$((warns + 1)) ;;
    esac
}

ok()   { record OK   "$1" "$2"; }
warn() { record WARN "$1" "$2"; }
fail() { record FAIL "$1" "$2"; }

get_jwt() {
    grep -o 'token=eyJ[A-Za-z0-9._-]*' "$HOME/.hapi/logs/hub.log" 2>/dev/null \
        | tail -1 | sed 's/^token=//'
}

api() { # path
    curl -fsS --max-time 10 -H "Authorization: Bearer $JWT" "$HUB$1" 2>/dev/null
}

machine_id() { # display name
    sqlite3 "$HOME/.hapi/hapi.db" \
        "select id from machines where json_extract(metadata,'\$.displayName')='$1';" 2>/dev/null
}

# ---------- hub ----------
hub_ok=0
if curl -fsS --max-time 5 "$HUB/health" >/dev/null 2>&1; then
    hub_ok=1
    ok "hub /health" "200"
else
    fail "hub /health" "unreachable at $HUB"
fi

JWT=$(get_jwt)
if [ -z "$JWT" ]; then
    fail "hub token" "no token= in ~/.hapi/logs/hub.log"
    [ "$hub_ok" = 1 ] && exit 2
fi

# ---------- local binary ----------
local_version=""
local_mtime=""
if [ -x "$STABLE" ]; then
    local_version=$("$STABLE" --version 2>/dev/null | sed 's/^hapi version: //')
    local_mtime=$(stat -f '%m' "$STABLE" 2>/dev/null)
    [ -n "$local_version" ] && ok "mini binary" "version $local_version" \
        || fail "mini binary" "cannot run $STABLE"
    ident=$(codesign -dv "$STABLE" 2>&1 | sed -n 's/^Identifier=//p')
    team=$(codesign -dv "$STABLE" 2>&1 | sed -n 's/^TeamIdentifier=//p')
    if [ "$ident" = "run.hapi.cli" ] && [ "$team" = "X75CUV458P" ]; then
        ok "mini signer" "$ident / $team"
    else
        fail "mini signer" "got ${ident:-none} / ${team:-none}, expected run.hapi.cli / X75CUV458P"
    fi
else
    fail "mini binary" "missing $STABLE"
fi

# ---------- local runner ----------
local_pid=$(sed -n 's/.*"pid": *\([0-9][0-9]*\).*/\1/p' "$HOME/.hapi/runner.state.json" 2>/dev/null | head -n 1)
if [ -n "$local_pid" ] && kill -0 "$local_pid" 2>/dev/null; then
    exe=$(lsof -p "$local_pid" 2>/dev/null | awk '$4=="txt"{print $NF}' | head -n 1)
    [ "$exe" = "$STABLE" ] && ok "mini runner" "pid $local_pid -> $exe" \
        || fail "mini runner" "pid $local_pid runs ${exe:-unknown}, expected $STABLE"
else
    fail "mini runner" "no live pid in runner.state.json"
fi

# ---------- remote ----------
remote_version=""
remote_mtime=""
remote_out=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE_TARGET" '
    v=$("$HOME/.hapi/bin/hapi" --version 2>/dev/null | sed "s/^hapi version: //")
    m=$(stat -f %m "$HOME/.hapi/bin/hapi" 2>/dev/null)
    i=$(codesign -dv "$HOME/.hapi/bin/hapi" 2>&1 | sed -n "s/^Identifier=//p")
    t=$(codesign -dv "$HOME/.hapi/bin/hapi" 2>&1 | sed -n "s/^TeamIdentifier=//p")
    p=$(sed -n "s/.*\"pid\": *\([0-9][0-9]*\).*/\1/p" "$HOME/.hapi/runner.state.json" 2>/dev/null | head -n 1)
    if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then a=alive; else a=dead; fi
    e=""
    if [ "$a" = alive ]; then e=$(lsof -p "$p" 2>/dev/null | awk "\$4==\"txt\"{print \$NF}" | head -n 1); fi
    printf "VERSION=%s\nMTIME=%s\nIDENT=%s\nTEAM=%s\nPID=%s\nALIVE=%s\nEXE=%s\n" \
        "$v" "$m" "$i" "$t" "$p" "$a" "$e"
' 2>/dev/null)

if [ -z "$remote_out" ]; then
    fail "k2lab ssh" "cannot reach $REMOTE_TARGET"
else
    remote_version=$(printf '%s\n' "$remote_out" | sed -n 's/^VERSION=//p')
    remote_mtime=$(printf '%s\n' "$remote_out" | sed -n 's/^MTIME=//p')
    r_ident=$(printf '%s\n' "$remote_out" | sed -n 's/^IDENT=//p')
    r_team=$(printf '%s\n' "$remote_out" | sed -n 's/^TEAM=//p')
    r_pid=$(printf '%s\n' "$remote_out" | sed -n 's/^PID=//p')
    r_alive=$(printf '%s\n' "$remote_out" | sed -n 's/^ALIVE=//p')
    r_exe=$(printf '%s\n' "$remote_out" | sed -n 's/^EXE=//p')

    [ -n "$remote_version" ] && ok "k2lab binary" "version $remote_version" \
        || fail "k2lab binary" "cannot run ~/.hapi/bin/hapi"
    if [ "$r_ident" = "run.hapi.cli" ] && [ "$r_team" = "X75CUV458P" ]; then
        ok "k2lab signer" "$r_ident / $r_team"
    else
        fail "k2lab signer" "got ${r_ident:-none} / ${r_team:-none}"
    fi
    if [ "$r_alive" = "alive" ]; then
        case "$r_exe" in
            */".hapi/bin/hapi") ok "k2lab runner" "pid $r_pid -> $r_exe" ;;
            *) fail "k2lab runner" "pid $r_pid runs ${r_exe:-unknown}" ;;
        esac
    else
        fail "k2lab runner" "not running"
    fi
fi

# ---------- version consistency ----------
if [ -n "$local_version" ] && [ -n "$remote_version" ]; then
    [ "$local_version" = "$remote_version" ] \
        && ok "version match" "both $local_version" \
        || fail "version match" "mini=$local_version k2lab=$remote_version"
fi

# ---------- hub metadata ----------
check_meta() { # display name installed_mtime
    local name=$1 mtime=$2 id row meta_ms meta_ver
    id=$(machine_id "$name")
    if [ -z "$id" ]; then
        warn "hub $name" "machine not registered"
        return
    fi
    local i
    for i in $(seq 1 20); do
        row=$(sqlite3 "$HOME/.hapi/hapi.db" \
            "select coalesce(json_extract(metadata,'\$.happyCliVersion'),''), coalesce(json_extract(metadata,'\$.startedCliMtimeMs'),0) from machines where id='$id';" 2>/dev/null)
        meta_ver=${row%%|*}
        meta_ms=${row##*|}
        meta_ms=${meta_ms%%.*}   # sqlite/json may yield a float
        case "$meta_ms" in ''|*[!0-9]*) meta_ms=0 ;; esac
        [ -n "$meta_ver" ] && break
        sleep 1
    done
    [ "$meta_ver" = "$local_version" ] \
        && ok "hub $name version" "$meta_ver" \
        || fail "hub $name version" "hub=$meta_ver binary=$local_version"
    if [ -n "$mtime" ] && [ -n "$meta_ms" ] && [ "$meta_ms" != "0" ]; then
        delta=$(( meta_ms / 1000 - mtime ))
        [ "${delta#-}" -le 2 ] \
            && ok "hub $name mtime" "matches installed file" \
            || fail "hub $name mtime" "hub=${meta_ms}ms file=${mtime}s (delta ${delta}s)"
    fi
}

[ "$hub_ok" = 1 ] && check_meta "$LOCAL_NAME" "$local_mtime"
[ "$hub_ok" = 1 ] && [ -n "$remote_mtime" ] && check_meta "$REMOTE_NAME" "$remote_mtime"

# ---------- agent availability + models ----------
baseline_get() { # name key
    [ -f "$BASELINE" ] || return 1
    jq -r --arg n "$1" --arg k "$2" '.[$n][$k] // empty | if type=="array" then join(",") else tostring end' "$BASELINE" 2>/dev/null
}

baseline_put() { # name json_fragment
    mkdir -p "$(dirname "$BASELINE")"
    [ -f "$BASELINE" ] || echo '{}' > "$BASELINE"
    tmp=$(mktemp)
    jq --arg n "$1" --argjson v "$2" '.[$n] = $v' "$BASELINE" > "$tmp" 2>/dev/null && mv "$tmp" "$BASELINE"
}

verify_machine_agents() { # display name
    local name=$1 id resp now_agents base_agents
    id=$(machine_id "$name")
    [ -n "$id" ] || return

    resp=$(api "/api/machines/$id/agent-availability")
    if [ -z "$resp" ]; then
        fail "agents $name" "agent-availability request failed"
        return
    fi
    now_agents=$(printf '%s' "$resp" | jq -r '[.agents[] | select(.available) | .agent] | join(",")' 2>/dev/null)
    [ -n "$now_agents" ] && ok "agents $name" "$(printf '%s' "$now_agents" | tr ',' ' ')" \
        || warn "agents $name" "none available"

    if [ "$USE_BASELINE" = 1 ] && [ "$INIT" = 0 ]; then
        base_agents=$(baseline_get "$name" agents)
        if [ -n "$base_agents" ]; then
            lost=$(comm -23 <(printf '%s' "$base_agents" | tr ',' '\n' | sort) \
                            <(printf '%s' "$now_agents" | tr ',' '\n' | sort) | paste -sd, -)
            [ -z "$lost" ] && ok "agents $name baseline" "no regression" \
                || fail "agents $name baseline" "lost: $lost"
        else
            warn "agents $name baseline" "not recorded yet (run --init)"
        fi
    fi

    resp=$(api "/api/machines/$id/codex-models")
    if [ -n "$resp" ]; then
        success=$(printf '%s' "$resp" | jq -r '.success // false' 2>/dev/null)
        count=$(printf '%s' "$resp" | jq -r '(.models // []) | length' 2>/dev/null)
        if [ "$success" = "true" ]; then
            ok "codex $name" "$count models"
        else
            base=$(baseline_get "$name" codex_models)
            [ "$base" = "true" ] && fail "codex $name" "was working, now success=false" \
                                 || warn "codex $name" "not available (also before)"
        fi
    fi
}

if [ "$hub_ok" = 1 ] && [ -n "$JWT" ]; then
    verify_machine_agents "$LOCAL_NAME"
    verify_machine_agents "$REMOTE_NAME"
fi

# ---------- baseline ----------
if [ "$INIT" = 1 ] || [ "$USE_BASELINE" = 1 ] && [ "$fails" = 0 ]; then
    for name in "$LOCAL_NAME" "$REMOTE_NAME"; do
        id=$(machine_id "$name")
        [ -n "$id" ] || continue
        agents=$(api "/api/machines/$id/agent-availability" | jq -c '[.agents[] | select(.available) | .agent]' 2>/dev/null)
        codex=$(api "/api/machines/$id/codex-models" | jq -r '.success // false' 2>/dev/null)
        [ -n "$agents" ] && baseline_put "$name" "{\"agents\":$agents,\"codex_models\":${codex:-false}}"
    done
fi

# ---------- output ----------
if [ "$JSON" = 1 ]; then
    printf '{"result":"%s","failed":%d,"warned":%d,"checks":[%s]}\n' \
        "$([ "$fails" = 0 ] && echo PASS || echo FAIL)" "$fails" "$warns" \
        "$(IFS=,; echo "${json_rows[*]}")"
else
    printf '%-6s %-24s %s\n' "STATUS" "CHECK" "DETAIL"
    printf '%-6s %-24s %s\n' "------" "------------------------" "----------------------------------------"
    for r in "${rows[@]}"; do
        IFS='|' read -r s c d <<< "$r"
        printf '%-6s %-24s %s\n' "$s" "$c" "$d"
    done
    echo
    if [ "$fails" = 0 ]; then
        echo "RESULT: PASS (warn $warns)"
    else
        echo "RESULT: FAIL ($fails failed, $warns warned)"
        echo "rollback: see SKILL.md / scripts print the exact command after each deploy"
    fi
fi

[ "$fails" = 0 ] && exit 0 || exit 1
