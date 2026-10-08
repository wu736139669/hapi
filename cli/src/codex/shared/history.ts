import { z } from 'zod';
import type { CodexHistoryCheckpoint, CodexHistoryState } from '@hapi/protocol';
import type { ApiSessionClient } from '@/api/apiSession';
import type { CodexAppServerClient } from '../codexAppServerClient';
import type { SharedCodexProjection } from './projection';
import { record, string } from './gateway';

const TurnSchema = z.object({ id: z.string(), status: z.string(), items: z.array(z.unknown()).optional() }).passthrough();
const TurnsSchema = z.object({ data: z.array(TurnSchema), nextCursor: z.string().nullish() });
const ItemsSchema = z.object({ data: z.array(z.object({ turnId: z.string(), item: z.object({ id: z.string(), type: z.string() }).passthrough(), startedAtMs: z.number().nullish(), completedAtMs: z.number().nullish() })), nextCursor: z.string().nullish() });
const EMPTY: CodexHistoryCheckpoint = { version: 1, pageCursor: null, turnId: null, itemId: null, turnComplete: false };
const BATCH_ITEMS = 16;
const BATCH_BYTES = 256 * 1024;

export async function readCurrentThread(client: Pick<CodexAppServerClient, 'request'>, threadId: string): Promise<Record<string, unknown>> {
    const thread = record(record(await client.request('thread/read', { threadId, includeTurns: false })).thread);
    const page = TurnsSchema.parse(await client.request('thread/turns/list', { threadId, limit: 1, sortDirection: 'desc', itemsView: 'summary' }));
    return { ...thread, turns: page.data };
}

/** One native item body at a time: even a 129MiB turn never becomes one RPC
 * frame or one accumulated history array. Checkpoints cover only final items
 * whose complete projection and history metadata are durable at the Hub. */
export class CodexHistorySync {
    private running?: Promise<void>;
    private timer?: ReturnType<typeof setTimeout>;
    private rerun = false;
    private invalidated = false;
    private readonly abort = new AbortController();
    private itemPagination = true;

    constructor(
        private readonly client: Pick<CodexAppServerClient, 'request'>,
        private readonly session: Pick<ApiSessionClient, 'syncCodexHistory' | 'waitForMessages' | 'flushMetadata'>,
        private readonly projection: SharedCodexProjection,
        private readonly onItem: (turnId: string, item: unknown) => void,
        private readonly onError: (error: unknown) => void
    ) {}

    schedule(delay = 1_000): void {
        if (this.abort.signal.aborted) return;
        if (this.running) { this.rerun = true; return; }
        if (this.timer) return;
        this.timer = setTimeout(() => { this.timer = undefined; void this.sync().catch(this.onError); }, delay);
    }
    invalidate(): void { this.invalidated = true; this.schedule(0); }
    close(): void { this.abort.abort(); clearTimeout(this.timer); }
    sync(): Promise<void> {
        if (this.abort.signal.aborted) return Promise.resolve();
        return this.running ??= this.syncNow().finally(() => {
            this.running = undefined;
            if (this.rerun) { this.rerun = false; this.schedule(0); }
        });
    }

    /** Small tail preview for first paint. User history boundaries are rebuilt
     * in ascending order below, not guessed from a recent steered input. */
    async preview(turn: Record<string, unknown>): Promise<void> {
        if (!string(turn.id) || !this.itemPagination) return;
        let cursor: string | undefined; let bytes = 0;
        const revision = this.projection.historyRevision(); let title: string | undefined;
        for (let i = 0; i < 12 && !this.abort.signal.aborted; i++) {
            let page: z.infer<typeof ItemsSchema>;
            try { page = ItemsSchema.parse(await this.client.request('thread/items/list', { threadId: this.projection.threadId, turnId: turn.id, cursor, limit: 1, sortDirection: 'desc' })); }
            catch (error) { if (this.unsupported(error)) { this.itemPagination = false; return; } throw error; }
            for (const entry of page.data) {
                bytes += Buffer.byteLength(JSON.stringify(entry));
                if (entry.item.type === 'userMessage') continue;
                this.onItem(entry.turnId, entry.item);
                const result = await this.projection.historyItem(turn, entry.item, this.completed(turn, entry), true, this.createdAt(turn, entry));
                title ??= result.title;
                if (!await this.session.waitForMessages(result.localIds, this.abort.signal)) throw new Error('Latest history messages were not confirmed');
            }
            cursor = page.nextCursor ?? undefined;
            if (!cursor || bytes >= BATCH_BYTES) break;
        }
        this.projection.finishHistory(revision, title);
    }

    private unsupported(error: unknown): boolean {
        return error instanceof Error && /unsupported|unknown method|method not found/i.test(error.message);
    }
    private completed(turn: Record<string, unknown>, entry: z.infer<typeof ItemsSchema>['data'][number]): boolean {
        return turn.status !== 'inProgress' || entry.completedAtMs != null || entry.item.type === 'userMessage'
            || ['completed', 'failed', 'declined'].includes(String(entry.item.status));
    }
    private createdAt(turn: Record<string, unknown>, entry: z.infer<typeof ItemsSchema>['data'][number]): number | undefined {
        return entry.completedAtMs ?? entry.startedAtMs ?? (typeof turn.startedAt === 'number' ? turn.startedAt * 1000 : undefined);
    }
    private async syncNow(): Promise<void> {
        let state = await this.session.syncCodexHistory(this.projection.threadId);
        if (this.invalidated) {
            state = await this.commit(state, null, []); this.invalidated = false;
        }
        try { await this.catchUp(state); }
        catch (error) {
            // A removed turn/item anchor is a history change, not an excuse to
            // trust an old checkpoint. Persist the reset before retrying.
            if (state.checkpoint && error instanceof Error && /cursor|anchor|item .*not found|turn .*not found/i.test(error.message)) {
                const current = await this.session.syncCodexHistory(this.projection.threadId);
                await this.commit(current, null, []); this.rerun = true;
            }
            throw error;
        }
    }
    private async commit(state: CodexHistoryState, checkpoint: CodexHistoryCheckpoint | null, localIds: string[]): Promise<CodexHistoryState> {
        return this.session.syncCodexHistory(this.projection.threadId, { epoch: state.epoch, revision: state.revision, checkpoint, localIds: [...new Set(localIds)] });
    }
    private async catchUp(initial: CodexHistoryState): Promise<void> {
        let state = initial;
        let position = state.checkpoint ?? { ...EMPTY };
        let cursor = position.pageCursor;
        let anchor = position.turnId;
        let batchIds: string[] = []; let batchItems = 0; let batchBytes = 0;
        const revision = this.projection.historyRevision(); let title: string | undefined;
        const flush = async () => {
            if (!await this.session.waitForMessages(batchIds, this.abort.signal)) throw new Error('History batch was not confirmed');
            if (this.abort.signal.aborted) return;
            if (JSON.stringify(position) !== JSON.stringify(state.checkpoint)) {
                if (!await this.session.flushMetadata(15_000)) throw new Error('History metadata was not confirmed');
                state = await this.commit(state, position, batchIds);
            }
            batchIds = []; batchItems = 0; batchBytes = 0;
        };
        do {
            if (this.abort.signal.aborted) return;
            const page = TurnsSchema.parse(await this.client.request('thread/turns/list', { threadId: this.projection.threadId, cursor, limit: 1, sortDirection: 'asc', itemsView: 'notLoaded' }));
            if (anchor && page.data[0]?.id !== anchor) throw new Error('History turn anchor no longer exists');
            anchor = null;
            for (const turn of page.data) {
                const continuing = position.turnId === turn.id;
                if (continuing && position.turnComplete && turn.status !== 'inProgress') continue;
                let itemCursor: string | { type: 'item'; itemId: string } | undefined = continuing && position.itemId && !position.turnComplete
                    ? { type: 'item', itemId: position.itemId } : undefined;
                let gap = false;
                let legacy: z.infer<typeof ItemsSchema> | undefined;
                do {
                    if (this.abort.signal.aborted) return;
                    let items: z.infer<typeof ItemsSchema>;
                    if (this.itemPagination) {
                        try { items = ItemsSchema.parse(await this.client.request('thread/items/list', { threadId: this.projection.threadId, turnId: turn.id, cursor: itemCursor, limit: 1, sortDirection: 'asc' })); }
                        catch (error) { if (!this.unsupported(error)) throw error; this.itemPagination = false; }
                    }
                    if (!this.itemPagination) {
                        // Older stores: one turn, never includeTurns:true or an
                        // unbounded full-history request. Large single legacy
                        // turns still require native item-pagination support.
                        legacy ??= await this.legacyItems(turn, cursor, itemCursor);
                        items = legacy;
                    }
                    for (const entry of items!.data) {
                        const completed = this.completed(turn, entry);
                        this.onItem(turn.id, entry.item);
                        const result = await this.projection.historyItem(turn, entry.item, completed, true, this.createdAt(turn, entry));
                        title = result.title ?? title;
                        batchIds.push(...result.localIds); batchItems++; batchBytes += Buffer.byteLength(JSON.stringify(entry));
                        gap ||= !completed;
                        if (!gap) position = { version: 1, pageCursor: cursor, turnId: turn.id, itemId: entry.item.id, turnComplete: false };
                        if (batchItems >= BATCH_ITEMS || batchBytes >= BATCH_BYTES) await flush();
                    }
                    itemCursor = items!.nextCursor ?? undefined;
                } while (itemCursor);
                if (!gap && turn.status !== 'inProgress') position = { ...position, pageCursor: cursor, turnId: turn.id,
                    itemId: position.turnId === turn.id ? position.itemId : null, turnComplete: true };
                await flush();
                // Keep a contiguous prefix: later live output stays visible,
                // but cannot move the checkpoint over an unfinished item.
                if (gap || turn.status === 'inProgress') { this.projection.finishHistory(revision, title); return; }
            }
            cursor = page.nextCursor ?? null;
        } while (cursor);
        this.projection.finishHistory(revision, title);
    }

    private async legacyItems(turn: z.infer<typeof TurnSchema>, cursor: string | null, anchor?: string | { type: 'item'; itemId: string }): Promise<z.infer<typeof ItemsSchema>> {
        const page = TurnsSchema.parse(await this.client.request('thread/turns/list', { threadId: this.projection.threadId, cursor, limit: 1, sortDirection: 'asc', itemsView: 'full' }));
        if (page.data[0]?.id !== turn.id) throw new Error('History turn anchor no longer exists');
        const items = (page.data[0].items ?? []).map(record);
        const offset = typeof anchor === 'object' ? items.findIndex(item => item.id === anchor.itemId) : -1;
        if (anchor && offset < 0) throw new Error('History item anchor no longer exists');
        return ItemsSchema.parse({ data: items.slice(offset + 1).map(item => ({ turnId: turn.id, item })), nextCursor: null });
    }
}
