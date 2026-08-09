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
