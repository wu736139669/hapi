import { afterEach, describe, expect, it } from 'vitest';
import type { CodexHistoryCheckpoint, CodexHistoryState, CodexHistorySyncRequest } from '@hapi/protocol';
import type { ApiSessionClient } from '@/api/apiSession';
import type { CodexAppServerClient } from '../codexAppServerClient';
import { CodexHistorySync, readCurrentThread } from './history';
import { SharedCodexProjection } from './projection';

type Item = { id: string; type: string; text?: string; bytes?: number; completed?: boolean; forbidden?: boolean };
type Turn = { id: string; status: string; items: Item[] };
const workers: CodexHistorySync[] = [];
afterEach(() => { for (const worker of workers.splice(0)) worker.close(); });

function fixture(turns: Turn[], checkpoint: CodexHistoryCheckpoint | null = null) {
    let state: CodexHistoryState = { epoch: 0, revision: 0, checkpoint };
    let acknowledge = true;
    let metadata = {};
    const saved = new Set<string>();
    const emitted: Array<{ id: string; text?: string }> = [];
    const reads: string[] = [];
    let maxFrame = 0;
    const session = {
        getMetadata: () => metadata,
        updateMetadata: (fn: (m: typeof metadata) => typeof metadata) => { metadata = fn(metadata); },
        sendAgentMessage: (body: { message?: string }, id: string) => {
            emitted.push({ id, ...(body.message && body.message.length < 100 ? { text: body.message } : {}) }); saved.add(id);
        },
        sendUserMessage: (_text: string, _meta: unknown, id: string) => { emitted.push({ id }); saved.add(id); },
        async syncCodexHistory(_threadId: string, commit?: CodexHistorySyncRequest['commit']) {
            if (commit) {
                expect(commit.epoch).toBe(state.epoch); expect(commit.revision).toBe(state.revision);
                expect(commit.localIds.every(id => saved.has(id))).toBe(true);
                state = { epoch: state.epoch, revision: state.revision + 1, checkpoint: commit.checkpoint };
            }
            return structuredClone(state);
        },
        async waitForMessages(ids: string[]) { return acknowledge && ids.every(id => saved.has(id)); },
        async flushMetadata() { return true; }
    } as unknown as ApiSessionClient;
    const client = { async request(method: string, params: Record<string, unknown>) {
        if (method === 'thread/read') {
            expect(params.includeTurns).toBe(false);
            return { thread: { id: 'thread', historyMode: 'paginated' } };
        }
        if (method === 'thread/turns/list') {
            if (params.itemsView === 'full') throw new Error('Full turn would exceed the native frame limit');
            const rows = params.sortDirection === 'desc' ? [...turns].reverse() : turns;
            const start = Number(params.cursor ?? 0);
            const data = rows.slice(start, start + Number(params.limit)).map(turn => ({ id: turn.id, status: turn.status, items: [] }));
            return { data, nextCursor: start + Number(params.limit) < rows.length ? String(start + Number(params.limit)) : null };
        }
        if (method === 'thread/items/list') {
            expect(params.limit).toBe(1);
            const turn = turns.find(turn => turn.id === params.turnId)!;
            const rows = params.sortDirection === 'desc' ? [...turn.items].reverse() : turn.items;
            const anchor = params.cursor as { itemId: string };
            const found = typeof params.cursor === 'object' ? rows.findIndex(item => item.id === anchor.itemId) : -1;
            if (params.cursor && typeof params.cursor === 'object' && found < 0) throw new Error('Item anchor not found');
            const start = typeof params.cursor === 'object' ? found + 1 : Number(params.cursor ?? 0);
            const data = rows.slice(start, start + 1).map(item => {
                if (item.forbidden) throw new Error(`Saved old body was reread: ${item.id}`);
                reads.push(item.id);
                return { turnId: turn.id, completedAtMs: item.completed || turn.status !== 'inProgress' ? 1 : null,
                    item: item.type === 'userMessage' ? { id: item.id, type: item.type, content: [{ type: 'text', text: item.text ?? 'input' }] }
                        : { id: item.id, type: item.type, text: item.bytes ? 'x'.repeat(item.bytes) : item.text ?? item.id } };
            });
            const result = { data, nextCursor: start + 1 < rows.length ? String(start + 1) : null };
            maxFrame = Math.max(maxFrame, Buffer.byteLength(JSON.stringify(result)));
            return result;
        }
        throw new Error(`Unexpected native method ${method}`);
    } } as unknown as Pick<CodexAppServerClient, 'request'>;
    const create = () => {
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        const worker = new CodexHistorySync(client, session, projection, () => {}, () => {});
        workers.push(worker); return { worker, projection };
    };
    return { client, session, turns, create, reads, emitted, state: () => state, maxFrame: () => maxFrame,
        acknowledge: (value: boolean) => { acknowledge = value; } };
}

describe('incremental native history', () => {
    it.each([10, 300])('skips an already saved %iMiB history before reading or sending bodies', async oldMiB => {
        const f = fixture([
            { id: 'old', status: 'completed', items: [{ id: 'old-body', type: 'agentMessage', bytes: oldMiB * 1024 * 1024, forbidden: true }] },
            { id: 'new', status: 'completed', items: Array.from({ length: 20 }, (_, i) => ({ id: `new-${i}`, type: 'agentMessage' })) }
        ], { version: 1, pageCursor: null, turnId: 'old', itemId: 'old-body', turnComplete: true });
        await f.create().worker.sync();
        expect(f.reads).toHaveLength(20);
        expect(f.emitted).toHaveLength(20);
        expect(f.state().checkpoint).toMatchObject({ turnId: 'new', itemId: 'new-19', turnComplete: true });
        // New process: no converter or confirmation cache survives. Only the
        // persisted Hub checkpoint prevents the old bodies from being read.
        for (const turn of f.turns) for (const item of turn.items) item.forbidden = true;
        await f.create().worker.sync();
        expect(f.reads).toHaveLength(20);
        expect(f.emitted).toHaveLength(20);
    });

    it('shows the latest result first and pages a 129MiB single turn without a full-turn frame', async () => {
        const f = fixture([
            { id: 'huge', status: 'completed', items: Array.from({ length: 129 }, (_, i) => ({ id: `large-${i}`, type: 'agentMessage', bytes: 1024 * 1024 })) },
            { id: 'latest', status: 'completed', items: [{ id: 'final', type: 'agentMessage', text: 'Latest result' }] }
        ]);
        const { worker } = f.create();
        const current = await readCurrentThread(f.client, 'thread');
        const latest = (current.turns as Array<Record<string, unknown>>)[0];
        await worker.preview(latest);
        expect(f.emitted[0].text).toBe('Latest result');
        expect(f.reads).toEqual(['final']);
        await worker.sync();
        expect(f.maxFrame()).toBeLessThan(2 * 1024 * 1024);
        expect(f.state().checkpoint?.turnId).toBe('latest');
    }, 15_000);

    it('does not skip an unfinished reply or move over it when newer items finish', async () => {
        const f = fixture([{ id: 'active', status: 'inProgress', items: [
            { id: 'user', type: 'userMessage' },
            { id: 'reply', type: 'agentMessage', text: 'partial' },
            { id: 'later', type: 'agentMessage', text: 'Later completed item', completed: true }
        ] }]);
        await f.create().worker.sync();
        expect(f.state().checkpoint).toMatchObject({ itemId: 'user', turnComplete: false });
        expect(f.emitted.some(message => message.text === 'partial')).toBe(false);
        f.turns[0].items[0].forbidden = true;
        f.turns[0].items[1].text = 'Final complete reply'; f.turns[0].items[1].completed = true;
        f.turns[0].status = 'completed';
        await f.create().worker.sync();
        expect(f.emitted.some(message => message.text === 'Final complete reply')).toBe(true);
        expect(f.state().checkpoint).toMatchObject({ itemId: 'later', turnComplete: true });
    });

    it('retries a small batch after an uncertain ACK instead of persisting false progress', async () => {
        const f = fixture([{ id: 'turn', status: 'completed', items: [{ id: 'reply', type: 'agentMessage' }] }]);
        f.acknowledge(false);
        await expect(f.create().worker.sync()).rejects.toThrow('not confirmed');
        expect(f.state().checkpoint).toBeNull();
        f.acknowledge(true);
        await f.create().worker.sync();
        expect(f.emitted[0].id).toBe(f.emitted[1].id);
        expect(f.state().checkpoint?.turnComplete).toBe(true);
    });

    it('invalidates a removed native anchor before starting a new bounded reconciliation', async () => {
        const f = fixture([{ id: 'survivor', status: 'completed', items: [{ id: 'reply', type: 'agentMessage' }] }],
            { version: 1, pageCursor: null, turnId: 'removed', itemId: 'removed-item', turnComplete: true });
        const { worker } = f.create();
        await expect(worker.sync()).rejects.toThrow('anchor'); worker.close();
        expect(f.state().checkpoint).toBeNull();
        await f.create().worker.sync();
        expect(f.state().checkpoint?.turnId).toBe('survivor');
    });
});
