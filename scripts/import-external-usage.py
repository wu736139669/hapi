#!/usr/bin/env python3
"""Attach token usage from OpenCode sessions that are NOT HAPI sessions.

Those sessions have no HAPI session id, so neither the live token_count
pipeline nor the machine usage report can attribute them. This tool aggregates
their absolute per-(day, model) totals from OpenCode's own store and writes
them into the hub's reconciled-usage ledger under a synthetic session id.

The synthetic id is deliberately NOT registered in usage_session_sources, so
no existing session's live events are superseded: this is purely additive.
Re-running replaces the same rows (idempotent, no double counting).

Dry run by default. Pass --apply to write to the hub DB.
"""

import argparse
import os
import shlex
import sqlite3
import subprocess
import sys
import time

DEFAULT_OPENCODE_DB = "~/.local/share/opencode/opencode.db"
DEFAULT_HUB_DB = "~/.hapi/hapi.db"


def sh(cmd: str) -> str:
    return subprocess.run(cmd, shell=True, check=True, text=True, capture_output=True).stdout


def remote_sql(ssh_target: str, db_path: str, ids_file: str) -> list[str]:
    """Aggregate assistant token rows for the given OpenCode session ids."""
    ssh_opts = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", ssh_target]
    remote_home = subprocess.run(
        ssh_opts + ['printf %s "$HOME"'], check=True, text=True, capture_output=True
    ).stdout.strip()
    if db_path.startswith("~/"):
        db_path = remote_home + db_path[1:]

    remote_ids = "/tmp/hapi-external-usage-ids.txt"
    with open(ids_file, "rb") as fh:
        subprocess.run(ssh_opts + [f"cat > {shlex.quote(remote_ids)}"], stdin=fh, check=True)
    try:
        sql = f"""
.mode tabs
CREATE TEMP TABLE ids(id TEXT PRIMARY KEY);
.import {remote_ids} ids
SELECT
  date(datetime(json_extract(data,'$.time.created')/1000,'unixepoch','localtime')) AS day,
  json_extract(data,'$.model.providerID') || '/' || json_extract(data,'$.model.id') AS model,
  count(*) AS requests,
  sum(json_extract(data,'$.tokens.input')
      + coalesce(json_extract(data,'$.tokens.cache.read'),0)
      + coalesce(json_extract(data,'$.tokens.cache.write'),0)) AS input_tokens,
  sum(json_extract(data,'$.tokens.output')
      + coalesce(json_extract(data,'$.tokens.reasoning'),0)) AS output_tokens,
  sum(coalesce(json_extract(data,'$.tokens.cache.read'),0)) AS cache_read,
  sum(coalesce(json_extract(data,'$.tokens.cache.write'),0)) AS cache_write
FROM session_message JOIN ids ON ids.id = session_message.session_id
WHERE type='assistant' AND json_extract(data,'$.tokens.input') > 0
GROUP BY day, model
ORDER BY day, model;
"""
        out = subprocess.run(
            ssh_opts + [f"sqlite3 -readonly {shlex.quote(db_path)}"],
            input=sql,
            check=True,
            text=True,
            capture_output=True,
        ).stdout
    finally:
        subprocess.run(ssh_opts + [f"rm -f {shlex.quote(remote_ids)}"], check=False)
    return [line.split("\t") for line in out.strip().splitlines() if line.strip()]


def local_sql(db_path: str, ids_file: str) -> list[str]:
    # Read the v2 table when present (new OpenCode); fall back to legacy.
    has_v2 = "session_message" in sh(
        f"sqlite3 -readonly {shlex.quote(db_path)} \"SELECT name FROM sqlite_master WHERE type='table' AND name='session_message'\""
    )
    source = "session_message" if has_v2 else "message"
    role_filter = "type='assistant'" if has_v2 else "json_extract(data,'$.role')='assistant'"
    model_sql = (
        "json_extract(data,'$.model.providerID') || '/' || json_extract(data,'$.model.id')"
        if has_v2
        else "json_extract(data,'$.providerID') || '/' || json_extract(data,'$.modelID')"
    )
    sql = f"""
.mode tabs
CREATE TEMP TABLE ids(id TEXT PRIMARY KEY);
.import {shlex.quote(ids_file)} ids
SELECT
  date(datetime(json_extract(data,'$.time.created')/1000,'unixepoch','localtime')) AS day,
  {model_sql} AS model,
  count(*) AS requests,
  sum(json_extract(data,'$.tokens.input')
      + coalesce(json_extract(data,'$.tokens.cache.read'),0)
      + coalesce(json_extract(data,'$.tokens.cache.write'),0)) AS input_tokens,
  sum(json_extract(data,'$.tokens.output')
      + coalesce(json_extract(data,'$.tokens.reasoning'),0)) AS output_tokens,
  sum(coalesce(json_extract(data,'$.tokens.cache.read'),0)) AS cache_read,
  sum(coalesce(json_extract(data,'$.tokens.cache.write'),0)) AS cache_write
FROM {source} JOIN ids ON ids.id = {source}.session_id
WHERE {role_filter} AND json_extract(data,'$.tokens.input') > 0
GROUP BY day, model
ORDER BY day, model;
"""
    out = subprocess.run(
        ["sqlite3", "-readonly", db_path],
        input=sql,
        check=True,
        text=True,
        capture_output=True,
    ).stdout
    return [line.split("\t") for line in out.strip().splitlines() if line.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ssh-target", help="SSH alias/host holding the OpenCode store (omit for local)")
    parser.add_argument("--opencode-db", default=DEFAULT_OPENCODE_DB)
    parser.add_argument("--session-file", required=True, help="file with one OpenCode session id per line")
    parser.add_argument("--session-id", default="external:k2lab:PersonalAgent", help="synthetic ledger session id")
    parser.add_argument("--hub-db", default=DEFAULT_HUB_DB)
    parser.add_argument("--namespace", default="default")
    parser.add_argument("--apply", action="store_true", help="write to the hub DB (default: dry run)")
    args = parser.parse_args()

    if not args.session_id.startswith("external:"):
        print("refusing to write: --session-id must start with 'external:'", file=sys.stderr)
        return 2
    ids = [line.strip() for line in open(args.session_file) if line.strip()]
    if not ids:
        print("no session ids in --session-file", file=sys.stderr)
        return 2

    opencode_db = os.path.expanduser(args.opencode_db)
    if args.ssh_target:
        rows = remote_sql(args.ssh_target, args.opencode_db, args.session_file)
    else:
        rows = local_sql(opencode_db, args.session_file)

    print(f"sessions: {len(ids)}  rows: {len(rows)}  ledger: {args.session_id}")
    input_total = output_total = 0
    for day, model, requests, inp, out, cache_read, cache_write in rows:
        input_total += int(float(inp))
        output_total += int(float(out))
        print(f"  {day}  {model}  requests={requests}  input={int(float(inp))/1e6:.1f}M  output={int(float(out))/1e6:.2f}M")
    print(f"total: input={input_total/1e6:.1f}M output={output_total/1e6:.2f}M")
    if not args.apply:
        print("dry run: no DB changes. pass --apply to write.")
        return 0

    hub_db = os.path.expanduser(args.hub_db)
    db = sqlite3.connect(hub_db, timeout=30)
    try:
        exists = db.execute("SELECT 1 FROM sessions WHERE id = ?", (args.session_id,)).fetchone()
        if exists:
            print(f"refusing to write: {args.session_id} is a real HAPI session", file=sys.stderr)
            return 2
        now_ms = int(time.time() * 1000)
        db.execute("BEGIN IMMEDIATE")
        db.execute(
            "DELETE FROM usage_reconciliation WHERE session_id = ? AND agent = 'opencode'",
            (args.session_id,),
        )
        db.executemany(
            """INSERT INTO usage_reconciliation
               (namespace, session_id, day, model, agent, input_tokens, output_tokens,
                cache_read_tokens, cache_creation_tokens, requests, updated_at)
               VALUES (?, ?, ?, ?, 'opencode', ?, ?, ?, ?, ?, ?)""",
            [
                (args.namespace, args.session_id, day, model, int(float(inp)), int(float(out)),
                 int(float(cache_read)), int(float(cache_write)), int(requests), now_ms)
                for day, model, requests, inp, out, cache_read, cache_write in rows
            ],
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    print(f"applied {len(rows)} rows to {hub_db}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
