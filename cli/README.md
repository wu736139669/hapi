# hapi CLI

Run Claude Code, Codex, Cursor Agent, DeepSeek Harness, Grok Build, or OpenCode sessions from your terminal and control them remotely through the hapi hub.

## What it does

- Starts Claude Code sessions and registers them with hapi-hub.
- Starts Codex mode for OpenAI-based sessions.
- Starts Cursor Agent mode for Cursor CLI sessions.
- Connects to a running DeepSeek Harness Web host for native DSH sessions.
- Starts Grok Build locally or via ACP for remote sessions.
- Starts OpenCode mode via ACP and its plugin hook system.
- Provides an MCP stdio bridge for external tools.
- Manages a background runner for long-running sessions.
- Includes diagnostics and auth helpers.

## Typical flow

1. Start the hub and set env vars (see ../hub/README.md).
2. Set the same CLI_API_TOKEN on this machine or run `hapi auth login`.
3. Run `hapi` to start a session.
4. Use the web app or Telegram Mini App to monitor and control.

## Commands

### Session commands

- `hapi` - Start a Claude Code session (passes through Claude CLI flags). See `src/index.ts`.
- `hapi codex` - Start Codex mode. See `src/codex/runCodex.ts`.
- `hapi codex resume <sessionId>` - Resume existing Codex session.
- `hapi cursor` - Start Cursor Agent mode. See `src/cursor/runCursor.ts`.
  Supports `hapi cursor resume <chatId>`, `hapi cursor --continue`, `--mode plan|ask`, `--yolo`, `--model`.
  Local and remote modes supported; remote uses `agent -p` with stream-json.
- `hapi dsh` - Start or resume a DeepSeek Harness session through `dsh web`.
  Start DSH first with `dsh web --port 3080`. HAPI uses `http://127.0.0.1:3080` by default; set `HAPI_DSH_URL` to override it. DSH 0.2.x launch tokens can be supplied with `HAPI_DSH_TOKEN` or `HAPI_DSH_TOKEN_FILE` (the bundled launch wrapper writes this file).
- `hapi grok` - Start Grok Build mode. See `src/grok/runGrok.ts`.
- `hapi opencode` - Start OpenCode mode via ACP. See `src/opencode/runOpencode.ts`.
  Note: OpenCode supports local and remote modes; local mode streams via OpenCode plugins.
- `hapi resume [sessionId]` - List resumable sessions for this machine or resume one locally.
- `hapi ping-peer <session-id-prefix> <message>` - Resume (if needed) and message another session. Prefer this or MCP `ping_peer` / `list_peers` over reinventing JWT+curl. Also `--message-file` / `--list`.
- `hapi spawn-peer --dir PATH --name TITLE --message-file -` - Spawn a session and deliver a required first message. Optional `--machine ID|hostname` targets another runner (resolved via GET /api/machines); `--dir` must exist on the target. Machine spawn HTTP 200 is not a working peer; this command fails if the remit does not land. Prefer MCP `spawn_peer`.
- `hapi usage [--since 24h|7d|<ISO>|<ms>] [--until …] [--json]` - When agents were working across every machine on the hub, from `GET /api/activity`. `--json` prints one `hapi.activity.v1` report for other tools (time trackers); errors go to stderr with exit codes 2 (arguments), 3 (no token or refused), 4 (hub too old), 1 (other).
- `hapi inspect-peer <session-id-or-prefix>` - Read-only peer metadata + recent message text (no resume). Prefer this or MCP `inspect_peer` when a user cites `[title](/sessions/<id>)` or Copy-reference `See session "…" (/sessions/<id>) for context`. `/sessions/<id>` is a hub path, not a local file. Optional `--limit`.
- `hapi set-mode <session-id-or-prefix> <mode>` - Change the permission mode of an existing session, like the web permission picker. Active sessions switch immediately; inactive ones use it on next resume. An invalid mode prints the modes allowed for that agent.

Peer messages default to `auto`: use the target's live state to steer an active
Codex turn when steering is available; otherwise queue, resuming an inactive
session if needed. Auto currently queues for all other agent flavors. Prefer
auto for routine collaboration when queueing is an acceptable fallback.
Use explicit `queue` for non-urgent updates that can wait. Use `steer` for
important, time-sensitive findings the peer needs to know now, not after its
current turn: a correction that invalidates its assumptions, a blocker, or a
result that changes its next action. State why it matters now and what the peer
should adjust. Steer requires insertion into an active Claude (remote), Pi, Codex, or Cursor ACP
turn; it does not abort that turn or guarantee an immediate response. MCP `ping_peer` accepts
the same optional `deliveryMode: "auto" | "queue" | "steer"` field. Auto is
resolved by the peer sender; ordinary web/native chat delivery is unchanged.

```bash
hapi ping-peer <session-id> 'The dependency is ready' --delivery-mode auto
hapi ping-peer <session-id> 'Run the next check' --delivery-mode queue
hapi ping-peer <session-id> 'Use the corrected input path' --delivery-mode steer
```

Queue success reports `accepted` with a `ping-peer-` localId, not confirmed
delivery. Delivery is shown in the recipient chat only after its runtime
acknowledges consumption. Steer messages retain the same peer identity prefix.

Steer rejects unsupported agents, idle targets, and inactive targets before
sending. It reuses the queued-message Steer action: success reports `steered`,
or `invoked` if the target consumed the message before the action arrived.
Auto uses Codex's `steeringActive` state and control capabilities, not just
`active` or `thinking`. If the turn changes after selection, auto uses the same
safe error handling as explicit steer; it does not resend or silently retry.
If steering fails after the message was accepted, the error includes its
`localId`; it may still be queued or already consumed. Inspect the target
before retrying; do not automatically resend the prompt. Steering does not
abort the current turn.

Codex recovery reads current state and a small recent preview first. A background
worker pages native items and persists confirmed progress in the Hub database;
later restarts or reconnects continue from that position. Existing sessions need
one initial background reconciliation. A history rollback or replaced Hub
message epoch invalidates the checkpoint. Native versions without item paging
fall back to one turn per request, so a very large individual turn still needs
native item-pagination support.

### Resume a remote session locally

```bash
hapi resume
hapi resume <session-id>
```

`hapi resume` lists resumable sessions for the current machine. `hapi resume <session-id>` hands off an active remote session and opens the same HAPI session in the local terminal.

### Authentication

- `hapi auth status` - Show authentication configuration and token source.
- `hapi auth login` - Interactively enter and save CLI_API_TOKEN.
- `hapi auth logout` - Clear saved credentials.

See `src/commands/auth.ts`.

### Runner management

- `hapi runner start` - Start runner as detached process.
- `hapi runner stop` - Stop runner gracefully.
- `hapi runner status` - Show runner diagnostics.
- `hapi runner list` - List active sessions managed by runner.
- `hapi runner stop-session <sessionId>` - Terminate specific session.
- `hapi runner logs` - Print path to latest runner log file.

Both `start` and `start-sync` accept repeatable `--workspace-root <path>` (or `--workspace-root=<path>`). When set:

- The web `/browse` page surfaces scoped file trees rooted at those paths.
- The runner refuses `list-directory` and `spawn-session` requests for paths outside the configured roots.
- The runner can serve read-only file, Git, and ripgrep requests for inactive
  sessions through its machine-scoped `workspace-file-access` capability.
- `~` and `~/foo` are expanded.

Omitting the flag keeps the legacy behavior: no scoping, no `/browse` feature.

See `src/runner/run.ts`.

### Diagnostics

- `hapi doctor` - Show full diagnostics (version, runner status, logs, processes).
- `hapi doctor clean` - Kill runaway HAPI processes.

See `src/ui/doctor.ts`.

### Other

- `hapi mcp` - Start MCP stdio bridge. See `src/codex/happyMcpStdioBridge.ts`.
- `hapi hub` - Start the bundled hub (single binary workflow).
- `hapi server` - Alias for `hapi hub`.

DeepSeek Harness connects through its Web runtime. Start `dsh web --port 3080`
first; HAPI uses `http://127.0.0.1:3080` by default and honors `HAPI_DSH_URL`:

```bash
export HAPI_DSH_URL=http://127.0.0.1:3080
hapi dsh
```

DSH sessions are remote-only. HAPI supports native session creation and resume,
history sync/import, model and reasoning selection, permission approvals,
queued-message steering, and structured questions through the Web runtime. The
DSH runtime owns MCP injection, live tool/reasoning telemetry and permission
policy; usage is reconciled from DSH's own token ledger.

### Required

- `CLI_API_TOKEN` - Shared secret; must match the hub. Can be set via env or `~/.hapi/settings.json` (env wins).
- `HAPI_API_URL` - Hub base URL (default: http://localhost:3006).

### Optional

- `HAPI_HOME` - Config/data directory (default: ~/.hapi).
- `HAPI_EXPERIMENTAL` - Enable experimental features (true/1/yes).
- `HAPI_EXTRA_HEADERS_JSON` - JSON object of extra headers to send on CLI → hub requests, e.g. `{"Cookie":"CF_Authorization=..."}`. Can also be set as the `extraHeaders` object in `~/.hapi/settings.json` (environment variable wins).
- `HAPI_CLAUDE_PATH` - Path to a specific `claude` executable.
- `HAPI_DSH_URL` - DSH Web runtime base URL for `hapi dsh` (default: `http://127.0.0.1:3080`).
- `HAPI_SESSION_ID` - The current HAPI session ID, available inside agent shells. Use it in scripts that target the current conversation without listing sessions.
- An explicitly configured `HAPI_API_URL` is also made available to agent shells. HAPI does not copy settings-backed `CLI_API_TOKEN` secrets into the agent environment; credentials already present in the parent environment may still be inherited. Web Terminal PTYs (session Terminal button) strip hub secrets and agent-context markers (`HAPI_AGENT_CONTEXT`, `CURSOR_AGENT`, …) and set `HAPI_USER_TERMINAL=1` so operator tools treat that shell as human-facing.

For peer discovery and messaging, use the session's MCP `list_peers`,
`inspect_peer`, and `ping_peer` tools, or the corresponding CLI commands.
To create a new peer with work attached, use MCP `spawn_peer` or `hapi spawn-peer`.
The first message is required and verified in the transcript before success;
machine-spawn HTTP 200 alone does not prove the task was delivered. In-session
spawns add a Parent `[title](/sessions/<uuid>)` citation so parent renames do not
change its identity.
On a remote runner host, configure the matching hub URL and token so shell
commands reach the same hub (`hapi auth login` saves the token).

Lazy Codex (terminal) sessions export the id only after the hub row is
materialized, which happens when the MCP bridge starts — before the agent process
is spawned — so path-only self-targeting does not race a missing hub row.
Explicitly naming another session (prefix or full uuid) still works; that path
may list sessions.

Runner waits up to 30 seconds for Codex startup (15 seconds for other agents),
overridable with `HAPI_RUNNER_WEBHOOK_TIMEOUT_MS`. A Codex startup deadline
returns an unconfirmed result and keeps its process tracked; a late webhook
completes the same session. Wait for that row or explicitly stop it rather
than creating duplicates. Process exit and explicit stop still clean up the
child. The Hub gives Codex spawn RPCs 60 seconds for preflight plus startup.

## Storage

Data is stored in `~/.hapi/` (or `$HAPI_HOME`):

- `settings.json` - User settings (machineId, token, onboarding flag). See `src/persistence.ts`.
- `runner.state.json` - Runner state (pid, port, version, heartbeat).
- `logs/` - Log files.

## Requirements

- Claude CLI installed and logged in (`claude` on PATH).
- Cursor Agent CLI installed (`agent` on PATH) for `hapi cursor`. Install: `curl https://cursor.com/install -fsS | bash` (macOS/Linux), `irm 'https://cursor.com/install?win32=true' | iex` (Windows).
- Grok Build CLI installed (`grok` on PATH) for `hapi grok`. Authenticate with `grok login --device-auth` on headless runner machines, or set `XAI_API_KEY`.
- OpenCode CLI installed (`opencode` on PATH).
- Bun 1.4.4 for building from source.

## Build from source

From the repo root:

```bash
bun install
bun run build:cli
bun run build:cli:exe
```

For an all-in-one binary that also embeds the web app:

```bash
bun run build:single-exe
```

## Large Codex thread recovery

Cold resumes and established internal subscriptions exclude inline turns; HAPI
reads history separately. The initial root subscription retains the existing
response behavior so empty native threads can initialize their history source.
This does not truncate the native rollout or reduce the context restored by Codex.

For exceptionally large threads, set `HAPI_CODEX_LAZY_HISTORY_IDS` to a
comma-separated list of native Codex thread IDs in the Runner environment before
starting the Runner. Only these roots replay their newest turn when reading
paginated history and skip child history replay. Other threads retain full replay;
legacy native threads without paginated history still use the full-history path.
Descendant discovery and subscriptions to loaded children are retained, including
after reconnect, so pending questions and live child events can still reach HAPI.

This option favors recovery latency over Hub history completeness. It does not
implement UI-driven pagination or asynchronous backfill. Older turns and child
traces missing from the Hub may remain missing after reconnect; messages with an
uncertain delivery state may need manual inspection if their acceptance evidence
is in an older turn. Native rollout files remain intact. Historical fork checks
still read complete history when the message-to-turn mapping is already known;
older messages without that mapping cannot be forked through the Hub. A single
turn can still be large, so this is a turn limit rather than a byte limit.

## Source structure

- `src/api/` - Bot communication (Socket.IO + REST).
- `src/claude/` - Claude Code integration.
- `src/codex/` - Codex mode integration.
- `src/cursor/` - Cursor Agent integration.
- `src/dsh/` - DeepSeek Harness Web RPC, history import, and live session integration.
- `src/grok/` - Grok Build native TUI + ACP integration.
- `src/agent/` - Shared support for ACP-compatible agents.
- `src/opencode/` - OpenCode ACP + hook integration.
- `src/runner/` - Background service.
- `src/commands/` - CLI command handlers.
- `src/ui/` - User interface and diagnostics.
- `src/modules/` - Tool implementations (ripgrep, difftastic, git).

## Releasing

From the repository root, `bun run release-all <version>` updates the CLI package,
shared app version, iOS `MARKETING_VERSION` (app and notification extension, all
configurations), and Android's default `versionName`, then commits, tags `v<version>`,
and pushes. It requires a clean working tree on `main`. Use `--dry-run` to preview
without changing files. Native build numbers (`CURRENT_PROJECT_VERSION` / `versionCode`)
remain managed separately; Android's `-PhapiVersionName` override is preserved.

The pushed tag triggers `.github/workflows/release.yml`, which builds all binaries,
runs `bun run --cwd cli publish-npm`, and creates the GitHub Release. npm publishing
uses [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC), so no npm
token is involved; each `@twsxtd/hapi*` package must list `tiann/hapi` /
`release.yml` as its trusted publisher on npmjs.com. Packages already on npm are
skipped, so a failed release can be retried by re-running the workflow.

`setup-bun` reads the build version from the root `package.json`'s `packageManager`.
Keep local release builds on that version too. Bun 1.4.0 produces invalid
darwin-arm64 signatures that macOS 27 rejects with `SIGKILL`; Bun 1.4.4 includes
the [upstream signing fix](https://github.com/oven-sh/bun/pull/39837).

## Related docs

- `../hub/README.md`
- `../web/README.md`
