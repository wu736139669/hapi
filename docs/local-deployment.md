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

The all-in-one Bun executable uses an ad-hoc Mach-O signature. macOS caches
that signature against the executable pathname and modification time. Replacing
`~/.hapi/bin/hapi` in place (including a temp-file + rename) or using a plain
`cp` can leave a stale code-signature cache. The next launch then fails with:

```text
OS_REASON_CODESIGNING
embedded signature doesn't match attached signature
```

This is a deployment/install issue, not a HAPI application error. Use a fresh
versioned path for every build and keep the stable command path as a symlink.
Do not deploy by copying over the stable path.

Example for the macOS arm64 local machine:

```bash
set -euo pipefail
build=cli/dist-exe/bun-darwin-arm64/hapi
stamp=$(date +%Y%m%d-%H%M%S)
release="$HOME/.hapi/bin/hapi.$stamp"

# Bun's linker signature is not suitable after installation; re-sign once.
codesign --remove-signature "$build" 2>/dev/null || true
codesign --force --sign - "$build"
codesign --verify --deep --strict "$build"

# -p preserves the mtime covered by the code-signature cache.
cp -p "$build" "$release"
codesign --verify --deep --strict "$release"
"$release" --help >/dev/null

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
