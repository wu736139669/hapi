import { Database } from 'bun:sqlite'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { Store } from '../src/store'
import { decodeMessageContent } from '../src/store/contentCodec'
import { getUsageEventsByNamespace } from '../src/store/usage'
import type { UsageEvent, ReconciledUsageRow } from '../src/store/usage'
import { parseUsageEvent } from '../src/store/usageParser'
import type { UsageSource } from '../src/store/usageSources'
import { mergeRecoveredUsage } from '../src/sync/usageRecovery'
import { getUsageSummary } from '../src/sync/usageService'

// Operates only on accounting tables. Supply a SQLite backup for rehearsal;
// an explicit --apply is required for every run, including rehearsals.
const options = parseArgs({ options: {
    db: { type: 'string' }, input: { type: 'string', multiple: true },
    backup: { type: 'string', multiple: true }, report: { type: 'string' },
    namespace: { type: 'string', default: 'default' }, apply: { type: 'boolean', default: false }
} }).values
if (!options.db || !options.report || !options.apply) {
    throw new Error('Required: --db <path> --input <usage.ndjson> --report <json> --apply; rehearse on a backup first')
}
const namespace = options.namespace
const base = { machineId: z.string().min(1), agent: z.enum(['codex', 'claude', 'dsh', 'opencode']), nativeSessionId: z.string().min(1) }
const count = z.number().int().nonnegative()
const schema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('binding'), ...base, sessionId: z.string().min(1), namespace: z.string().min(1),
        createdAt: count.nullish(), model: z.string().nullish(), nativeHapi: z.boolean().optional() }),
    z.object({ type: z.literal('event'), ...base, createdAt: count, content: z.unknown(), nativeHapi: z.boolean().optional() }),
    z.object({ type: z.literal('counter'), ...base, createdAt: count, sourceKey: z.string().min(1), model: z.string().nullish(),
        inputTokens: count, outputTokens: count, cacheReadTokens: count, cacheCreationTokens: count })
])
type NativeRow = z.infer<typeof schema>
type Binding = Extract<NativeRow, { type: 'binding' }>
function sourceKey(row: { machineId: string; agent: string; nativeSessionId: string }): string {
    return JSON.stringify([row.machineId, row.agent, row.nativeSessionId])
}
const inputs: NativeRow[] = []
const collectedAt = new Map<string, number>()
for (const path of options.input ?? []) {
    const capturedAt = Math.floor(statSync(path).mtimeMs)
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line.trim()) continue
        const row = schema.parse(JSON.parse(line))
        inputs.push(row)
        collectedAt.set(sourceKey(row), Math.max(collectedAt.get(sourceKey(row)) ?? 0, capturedAt))
    }
}
const store = new Store(options.db)
const before = getUsageSummary(store, namespace, 'all', 'Asia/Shanghai')
const bindings = new Map<string, Binding[]>()
for (const row of inputs) {
    if (row.type !== 'binding' || row.namespace !== namespace) continue
    const key = sourceKey(row)
    const values = bindings.get(key) ?? []
    if (!values.some((value) => value.sessionId === row.sessionId)) values.push(row)
    bindings.set(key, values)
    store.usage.rememberSource({ ...row, namespace })
}
let repaired = store.usage.repairTransferredEvents(namespace)
const stages: Array<{ source: string; inserted: number; matched: number; enriched: number }> = []

// Old snapshots did not necessarily index all messages. Re-parse retained
// messages so cache-exclusive provider formats use today's normalized input.
for (const path of options.backup ?? []) {
    console.error(`Recovering backup: ${path}`)
    const db = new Database(path, { readonly: true })
    const sessions = new Map<string, { id: string; metadata: unknown; model: string | null }>()
    for (const row of db.prepare('SELECT id, metadata, model FROM sessions WHERE namespace = ?').all(namespace) as Array<{ id: string; metadata: string | null; model: string | null }>) {
        sessions.set(row.id, { ...row, metadata: row.metadata ? JSON.parse(row.metadata) as unknown : null })
    }
    const events = new Map<string, UsageEvent>()
    type BackupMessage = { id: string; session_id: string; seq: number; created_at: number; local_id: string | null; content: string | Uint8Array | null }
    for (const row of db.prepare(`SELECT id, session_id, seq, created_at, local_id, content FROM messages
        WHERE session_id IN (SELECT id FROM sessions WHERE namespace = ?) ORDER BY created_at, seq`).iterate(namespace) as Iterable<BackupMessage>) {
        const session = sessions.get(row.session_id)
        if (!session) continue
        const event = parseUsageEvent(session, { id: row.id, seq: row.seq, createdAt: row.created_at,
            localId: row.local_id, content: decodeMessageContent(row.content) })
        if (!event) continue
        event.model ??= session.model
        const key = `${event.agent}|${event.sourceKey}`
        const prior = events.get(key)
        if (!prior || event.kind === 'delta') events.set(key, event)
    }
    const hasNamespace = (db.prepare('PRAGMA table_info(usage_events)').all() as Array<{ name: string }>).some((row) => row.name === 'namespace')
    // Namespace-less legacy ledgers were single-user. Read them via a TEMP
    // view on this readonly connection, never migrate the backup itself.
    if (!hasNamespace) {
        db.exec(`CREATE TEMP VIEW usage_events_legacy AS SELECT '${namespace.replaceAll("'", "''")}' AS namespace, * FROM main.usage_events;
            CREATE TEMP VIEW usage_events AS SELECT * FROM usage_events_legacy`)
    }
    for (const event of getUsageEventsByNamespace(db, namespace)) {
        const key = `${event.agent}|${event.sourceKey}`
        if (!events.has(key)) events.set(key, event)
    }
    stages.push({ source: path, ...mergeRecoveredUsage(store, namespace, [...events.values()]) })
    db.close()
}

const existing = store.usage.getEventsByNamespace(namespace)
const streams = new Map<string, UsageEvent[]>()
for (const event of existing) {
    if (event.agent !== 'codex' || event.kind !== 'cumulative') continue
    const native = event.sourceKey.split('|')[1]!
    const values = streams.get(native) ?? []
    values.push(event)
    streams.set(native, values)
}
const nativeEvents = new Map<string, UsageEvent>()
const authoritativeModels = new Set<string>()
const snapshots = new Map<string, { source: UsageSource; rows: Map<string, ReconciledUsageRow>; seen: Set<string> }>()
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
let sequence = 0
let unbound = 0
for (const row of inputs) {
    if (row.type === 'binding') continue
    const aliases = bindings.get(sourceKey(row))
    if (!aliases?.length) { unbound += 1; continue }
    const ordered = [...aliases].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    const binding = ordered.findLast((value) => (value.createdAt ?? 0) <= row.createdAt) ?? ordered[0]!
    let sessionId = binding.sessionId
    if (row.agent === 'codex') {
        const stream = streams.get(row.nativeSessionId)
        // Preserve the ledger's session boundaries across resumes/merges.
        const prior = stream?.findLast((event) => event.createdAt <= row.createdAt)
        sessionId = prior?.sessionId ?? stream?.[0]?.sessionId ?? sessionId
    }
    if (row.type === 'counter' && row.agent === 'opencode') {
        const key = sourceKey(row)
        const value = snapshots.get(key) ?? { source: { ...binding, namespace }, rows: new Map<string, ReconciledUsageRow>(), seen: new Set<string>() }
        if (value.seen.has(row.sourceKey)) continue
        value.seen.add(row.sourceKey)
        const day = date.format(new Date(row.createdAt))
        const model = row.model ?? binding.model ?? 'unknown'
        const bucketKey = `${day}|${model}`
        const bucket = value.rows.get(bucketKey) ?? { sessionId, day, model, agent: 'opencode', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, requests: 0 }
        bucket.inputTokens += row.inputTokens
        bucket.outputTokens += row.outputTokens
        bucket.cacheReadTokens += row.cacheReadTokens
        bucket.cacheCreationTokens += row.cacheCreationTokens
        bucket.requests += 1
        value.rows.set(bucketKey, bucket)
        snapshots.set(key, value)
        continue
    }
    const event: UsageEvent | null = row.type === 'event'
        ? parseUsageEvent({ id: sessionId, metadata: { flavor: row.agent } }, {
            id: `native-${++sequence}`, seq: sequence, createdAt: row.createdAt, localId: null, content: row.content })
        : { sessionId, sourceKey: `native|${row.machineId}|${row.agent}|${row.nativeSessionId}|${row.sourceKey}`,
            sourceSeq: ++sequence, createdAt: row.createdAt, agent: row.agent, model: row.model ?? null, kind: 'delta',
            inputTokens: row.inputTokens, outputTokens: row.outputTokens, cacheReadTokens: row.cacheReadTokens,
            cacheCreationTokens: row.cacheCreationTokens, lastInputTokens: null, lastOutputTokens: null,
            lastCacheReadTokens: null, lastCacheCreationTokens: null }
    if (!event) continue
    const hasNativeModel = event.model !== null
    event.model ??= binding.model ?? null
    const key = `${event.agent}|${event.sourceKey}`
    if (hasNativeModel) authoritativeModels.add(key)
    const prior = nativeEvents.get(key)
    if (!prior || (event.kind === 'delta' && event.outputTokens >= prior.outputTokens)) nativeEvents.set(key, event)
}
stages.push({ source: 'native histories', ...mergeRecoveredUsage(store, namespace, [...nativeEvents.values()], authoritativeModels) })
for (const [key, snapshot] of snapshots) store.usage.reconcileSource(snapshot.source, [...snapshot.rows.values()], collectedAt.get(key)!)
repaired += store.usage.repairTransferredEvents(namespace)
const after = getUsageSummary(store, namespace, 'all', 'Asia/Shanghai')
const report = { database: options.db, namespace, repairedTransferredEvents: repaired, stages, nativeSources: bindings.size,
    nativeSnapshots: snapshots.size, unboundRows: unbound, before, after,
    addedTokens: after.totals.totalTokens - before.totals.totalTokens,
    addedRequests: after.totals.requests - before.totals.requests,
    generatedAt: new Date().toISOString() }
writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
store.close()
console.log(JSON.stringify({ repaired, stages, nativeSources: bindings.size, nativeSnapshots: snapshots.size, unbound,
    before: before.totals, after: after.totals, addedTokens: report.addedTokens }))
