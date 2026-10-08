import { describe, expect, it, vi } from 'vitest';
import { manageThreadGoal } from './manageThreadGoal';

const goal = { threadId: 'root', objective: 'Ship the fix', status: 'paused', tokenBudget: 10000,
    tokensUsed: 350, timeUsedSeconds: 12, createdAt: 1, updatedAt: 2 };

describe('native Goal controls', () => {
    it('edits objective and budget without resuming a paused Goal or starting a turn', async () => {
        const request = vi.fn(async (method: string, params: Record<string, unknown>) => ({
            goal: method === 'thread/goal/get' ? goal : { ...goal, ...params }
        }));
        const result = await manageThreadGoal('root', { action: 'update', objective: '  Ship with tests  ', tokenBudget: null }, request);
        expect(result.goal).toMatchObject({ objective: 'Ship with tests', status: 'paused', tokenBudget: null, tokensUsed: 350 });
        expect(request.mock.calls).toEqual([
            ['thread/goal/get', { threadId: 'root' }],
            ['thread/goal/set', { threadId: 'root', origin: 'user', objective: 'Ship with tests', tokenBudget: null }]
        ]);
    });

    it.each([['pause', 'paused'], ['resume', 'active']] as const)('uses native status for %s', async (action, status) => {
        const request = vi.fn(async (method: string, params: Record<string, unknown>) => ({
            goal: method === 'thread/goal/get' ? goal : { ...goal, ...params }
        }));
        expect((await manageThreadGoal('root', { action }, request)).goal?.status).toBe(status);
        expect(request.mock.calls.at(-1)).toEqual(['thread/goal/set', { threadId: 'root', origin: 'user', status }]);
    });

    it('clears only the scoped native Goal and tolerates an already cleared Goal', async () => {
        const request = vi.fn(async () => ({ cleared: false }));
        expect(await manageThreadGoal('root', { action: 'clear' }, request)).toEqual({ goal: null });
        expect(request.mock.calls).toEqual([['thread/goal/clear', { threadId: 'root', origin: 'user' }]]);
    });

    it('does not create a Goal when editing one that another client removed', async () => {
        const request = vi.fn(async () => ({ goal: null }));
        await expect(manageThreadGoal('root', { action: 'update', objective: 'Stale edit' }, request)).rejects.toThrow('No Goal');
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('validates actions before contacting Codex and propagates native failures', async () => {
        const request = vi.fn(async () => { throw new Error('Native Goal failure'); });
        await expect(manageThreadGoal('root', { action: 'update', objective: ' ' }, request)).rejects.toThrow();
        await expect(manageThreadGoal('root', { action: 'update', objective: 'Fix', tokenBudget: -1 }, request)).rejects.toThrow();
        await expect(manageThreadGoal('root', { action: 'pause', threadId: 'other' }, request)).rejects.toThrow();
        expect(request).not.toHaveBeenCalled();
        await expect(manageThreadGoal('root', { action: 'clear' }, request)).rejects.toThrow('Native Goal failure');
    });

    it('normalizes snake-case native usage and accepts the Unicode character limit', async () => {
        const request = vi.fn(async () => ({ goal: { objective: '目标', status: 'paused', thread_id: 'root',
            token_budget: 5000, tokens_used: 20, time_used_seconds: 5, created_at: 1, updated_at: 2 } }));
        expect((await manageThreadGoal('root', { action: 'get' }, request)).goal).toMatchObject({ threadId: 'root', tokensUsed: 20, tokenBudget: 5000 });
        await manageThreadGoal('root', { action: 'update', objective: '😀'.repeat(4000) }, request);
        await expect(manageThreadGoal('root', { action: 'update', objective: '😀'.repeat(4001) }, request)).rejects.toThrow();
    });
});
