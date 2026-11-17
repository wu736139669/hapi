import { describe, expect, it } from 'vitest';
import { asOpencodeGoalState, extractOpencodeGoalChange, fetchOpencodeGoal } from './opencodeGoal';

describe('asOpencodeGoalState', () => {
    it('accepts a live OpenCode goal', () => {
        expect(asOpencodeGoalState({
            id: 'goal-1',
            objective: 'ship it',
            status: 'active',
            rounds: 3,
            maxRounds: 50,
            boot: 'boot-1',
            updatedAt: 123
        })).toMatchObject({ id: 'goal-1', status: 'active', rounds: 3 });
    });

    it('rejects malformed or unsupported statuses', () => {
        expect(asOpencodeGoalState(null)).toBeNull();
        expect(asOpencodeGoalState({ id: 'g', objective: 'x', status: 'waiting', rounds: 0, maxRounds: 50 })).toBeNull();
        expect(asOpencodeGoalState({ id: 'g', objective: '', status: 'active', rounds: 0, maxRounds: 50 })).toBeNull();
    });
});

describe('extractOpencodeGoalChange', () => {
    it('reads a flat goal.changed payload', () => {
        expect(extractOpencodeGoalChange({ sessionID: 'ses_1', goal: { id: 'g' } })).toEqual({
            sessionID: 'ses_1', goal: { id: 'g' }
        });
    });

    it('walks the v2 data envelope', () => {
        expect(extractOpencodeGoalChange({
            type: 'rpc.opencode.goal.changed',
            data: { data: { sessionID: 'ses_1', goal: null } }
        })).toEqual({ sessionID: 'ses_1', goal: null });
    });

    it('returns null when no goal payload exists', () => {
        expect(extractOpencodeGoalChange({ sessionID: 'ses_1' })).toBeNull();
        expect(extractOpencodeGoalChange(null)).toBeNull();
    });
});

describe('fetchOpencodeGoal', () => {
    it('reads opencode.goal/get through the plugin RPC', async () => {
        const goal = { id: 'g', objective: 'ship', status: 'paused', rounds: 2, maxRounds: 50, updatedAt: 9 };
        let seenUrl = '';
        let seenBody = '';
        const response = {
            ok: true,
            json: async () => ({ output: goal })
        } as Response;
        const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
            seenUrl = String(url);
            seenBody = String(init?.body ?? '');
            return response;
        }) as unknown as typeof fetch;

        const result = await fetchOpencodeGoal({
            baseUrl: 'http://127.0.0.1:1234',
            directory: '/project',
            sessionID: 'ses_1',
            headers: { authorization: 'Basic abc' },
            fetchImpl
        });

        expect(seenUrl).toContain('/api/rpc/opencode.goal/get?directory=%2Fproject');
        expect(JSON.parse(seenBody)).toEqual({ input: { sessionID: 'ses_1' } });
        expect(result).toMatchObject({ id: 'g', status: 'paused' });
    });

    it('returns null on a failed RPC call', async () => {
        const fetchImpl = (async () => ({ ok: false, json: async () => ({}) }) as Response) as unknown as typeof fetch;
        await expect(fetchOpencodeGoal({
            baseUrl: 'http://127.0.0.1:1234', directory: '/p', sessionID: 's', headers: {}, fetchImpl
        })).resolves.toBeNull();
    });
});
