# Local deployment branch

`local/deploy-main` is the source of the locally deployed HAPI binary.

## Update rule

Never reset this branch to `main` or recreate it from `main`. Update it with:

```bash
git fetch upstream main
git merge upstream/main
```

Resolve conflicts by preserving the local features below. Build and deploy only
after typecheck and focused regression tests pass.

## Local features carried by this branch

- Claude local history import (`tiann/hapi#1429`)
- Codex and Cursor mid-turn steering (`tiann/hapi#1443`)
- Separate setting to pin all active sessions (`tiann/hapi#1447`)
- Claude custom models from `settings.json` (`customClaudeModels`); upstream PR
  `tiann/hapi#1318` was closed, so this must remain local
- macOS case-safe Storage Usage module names, required for local typecheck/build

When one of the open PRs is merged upstream, drop only the equivalent local
commits after verifying the merged implementation is present. Do not drop the
other local features.

## Local work preserved on separate branches

- Notification preferences and customizable push copy:
  `feat/notification-preferences` (`tiann/hapi#1360`)
- HTML preview and completed-unseen marker: `feat/html-preview`
- Earlier recovery work, including Codex quick import:
  `feat/recover-local-features`

These branches must not be deleted during cleanup or upstream updates.

## macOS executable deployment (important)

Deploy with:

```bash
bun run build:single-exe
scripts/deploy-local.sh [tag]
```

The script implements the sequence below, including the runner refresh; read
on to understand the macOS constraints it works around.

### Code-signature cache (never overwrite the stable path)

macOS caches the Mach-O signature against the executable pathname and
modification time. Replacing `~/.hapi/bin/hapi` in place (including a
temp-file + rename) or using a plain `cp` can leave a stale code-signature
cache. The next launch then fails with:

```text
OS_REASON_CODESIGNING
embedded signature doesn't match attached signature
```

This is a deployment/install issue, not a HAPI application error. Use a fresh
versioned path for every build and keep the stable command path as a symlink.
Do not deploy by copying over the stable path.

### Sign with a stable identity (TCC)

macOS TCC records permission grants against the code-signing identity. An
ad-hoc signature (`codesign --sign -`) has no stable identity, so each rebuild
looks like a brand-new app and every protected permission (Documents,
Downloads, Apple Music/media library, ...) is asked again. Sign every build
with one pinned identity:

- `scripts/deploy-local.sh` stores the chosen Apple Development SHA-1 in
  `~/.hapi/signing-identity` and reuses it. Override with
  `HAPI_SIGN_IDENTITY` when rotating certificates.
- All builds use the signed identifier `run.hapi.cli`.
- With no Apple Development identity the script falls back to ad-hoc; that
  still works, but expect TCC prompts to reappear after every deploy.

Agent sessions should also avoid recursive `$HOME` sweeps (`find ~`,
`du -sh ~`, ...) unless they prune TCC-protected folders (`~/Music`,
`~/Pictures`, `~/Movies`, `~/Library`): a walk into
`~/Music/Music/Media.localized` raises a spurious Apple Music prompt
attributed to the hapi binary.

### Refresh the runner

The runner is a long-lived detached process. New sessions it spawns resolve
`~/.hapi/bin/hapi` and therefore pick up the new binary automatically, but the
runner's own code stays old until the process restarts:

- compiled binaries never self-update: the heartbeat compares the mtime of the
  runner's own resolved exec path, which is fixed for the life of the process
- a stale runner keeps old machine RPC handlers and capability flags, so hub
  features fail with "restart the runner" errors

`scripts/deploy-local.sh` runs `hapi runner start` when a runner is already
running; the CLI stops the stale runner and starts a fresh one with
`HAPI_CLI_EXECUTABLE` pinned to the stable symlink. Running sessions are
detached and survive the restart.

### Manual sequence

```bash
set -euo pipefail
build=cli/dist-exe/bun-darwin-arm64/hapi
stamp=$(date +%Y%m%d-%H%M%S)
release="$HOME/.hapi/bin/hapi.$stamp"

identity=$(cat "$HOME/.hapi/signing-identity")   # SHA-1, or a unique cert name

# Bun's linker signature is not suitable after installation; re-sign once.
codesign --remove-signature "$build" 2>/dev/null || true
codesign --force --sign "$identity" --identifier run.hapi.cli "$build"
codesign --verify --deep --strict "$build"

# -p preserves the mtime covered by the code-signature cache.
cp -p "$build" "$release"
codesign --verify --deep --strict "$release"
"$release" --version

# Keep the old target as a rollback point. If hapi is already a symlink,
# replace only the link; otherwise move the legacy regular file aside first.
stable="$HOME/.hapi/bin/hapi"
if [ -L "$stable" ]; then
    old_target=$(readlink "$stable")
else
    old_target="hapi.bak.$stamp"
    mv "$stable" "$HOME/.hapi/bin/$old_target"
fi
ln -sfn "$(basename "$release")" "$stable"

launchctl kickstart -k "gui/$(id -u)/com.hapi.hub"
sleep 2
curl -fsS http://127.0.0.1:3006/health >/dev/null
"$stable" --version

# Refresh a running runner; new sessions already use the new binary via the
# symlink, but the runner's own machine RPCs/capabilities stay stale.
HAPI_CLI_EXECUTABLE="$stable" "$stable" runner start
```

If the health check fails, immediately restore the prior link and restart the
agent:

```bash
ln -sfn "$old_target" "$HOME/.hapi/bin/hapi"
launchctl kickstart -k "gui/$(id -u)/com.hapi.hub"
```

Never use `cp`, `mv`, or `codesign` on the stable symlink target after the
launch agent has been started. Keep versioned binaries until the replacement
has been running and verified.
