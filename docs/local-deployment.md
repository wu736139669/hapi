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

Remote Macs with the same layout:

```bash
scripts/deploy-remote.sh <ssh-target> [tag]     # e.g. scripts/deploy-remote.sh k2lab card-dedupe
```

### Fixed install path (why)

The binary always installs to the **fixed path** `~/.hapi/bin/hapi` (a real
file). macOS TCC keys permission grants (Documents, Downloads, Apple
Music/media library, ...) to the executable path, so one stable path means the
user grants access **once** and macOS remembers it across deploys. The earlier
"new versioned filename per build + symlink" scheme re-prompted for every
build: each deploy looked like a brand-new app, and while the prompt was
unanswered every process touching a protected folder (model probes, session
startup) blocked - which showed up as slow/timeout requests in the app. Do not
reintroduce versioned filenames.

### Code-signature cache (why deploys verify, and roll back)

The fixed path has one hazard: the kernel caches the Mach-O signature per
path, so overwriting it can kill new processes with:

```text
OS_REASON_CODESIGNING
embedded signature doesn't match attached signature
```

This is a deployment/install issue, not a HAPI application error. The deploy
scripts handle it end to end:

1. back up the installed binary to `~/.hapi/bin/backups/` (newest
   `HAPI_KEEP_BACKUPS` kept, default 2; never exec from the backup dir)
2. install the new file with a fresh mtime so the path-keyed signature cache
   re-reads it
3. prove it execs repeatedly (`hapi --version` x3) and `codesign --verify`
4. restart the hub (local) / kickstart the launchd job (remote) and verify
   (`/health` locally; runner state + exec path on the remote)
5. on any failure restore the backup onto the fixed path and restart

Never leave an unverified binary installed.

### Signing

Sign every build with one pinned identity; never ship an ad-hoc signature
(`codesign --sign -`), which has no stable identity and makes TCC re-ask every
permission:

- `scripts/sign-build.sh` (called by both deploy scripts) stores the chosen
  Apple Development SHA-1 in `~/.hapi/signing-identity` and reuses it; override
  with `HAPI_SIGN_IDENTITY` when rotating certificates
- all builds use the signed identifier `run.hapi.cli`
- with no Apple Development identity the scripts fall back to ad-hoc; that
  still runs, but expect TCC prompts to reappear after every deploy

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
`HAPI_CLI_EXECUTABLE` pinned to the fixed path. Running sessions are detached
and survive the restart.

### Manual sequence

```bash
set -euo pipefail
build=cli/dist-exe/bun-darwin-arm64/hapi
bin_dir="$HOME/.hapi/bin"
stable="$bin_dir/hapi"
stamp=$(date +%Y%m%d-%H%M%S)

# Sign with the pinned identity (see scripts/sign-build.sh).
bash scripts/sign-build.sh "$build"

# Back up the installed binary for rollback.
mkdir -p "$bin_dir/backups"
backup="$bin_dir/backups/hapi.$stamp"
[ -f "$stable" ] && cp -p "$stable" "$backup"

# Install to the fixed path with a fresh mtime, then prove it execs.
rm -f "$stable"
cp "$build" "$stable"
chmod 755 "$stable"
"$stable" --version && "$stable" --version && "$stable" --version
codesign --verify --deep --strict "$stable"

launchctl kickstart -k "gui/$(id -u)/com.hapi.hub"
sleep 2
curl -fsS http://127.0.0.1:3006/health >/dev/null
"$stable" --version

# Refresh a running runner so its machine RPCs/capabilities match.
HAPI_CLI_EXECUTABLE="$stable" "$stable" runner start
```

If the health check or a cold start fails, restore the backup and restart:

```bash
rm -f "$stable"
cp "$backup" "$stable"
chmod 755 "$stable"
"$stable" --version
launchctl kickstart -k "gui/$(id -u)/com.hapi.hub"
```

### Remote machines

`scripts/deploy-remote.sh <ssh-target> [tag]` performs the same flow over
SSH: signs locally, checks the remote arch matches, uploads next to the fixed
path, installs by move (fresh inode + mtime), proves the binary execs, then
kickstarts the launchd job (`com.hapi.runner` by default; override with
`HAPI_REMOTE_LAUNCHD_LABEL`) and verifies the runner executes the fixed path.
On any failure it restores the backup and kicks the job again. Running
sessions survive; the remote host needs no build toolchain.
