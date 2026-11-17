import { isObject } from '@hapi/protocol';

/** The subset of OpenCode's `Goal.State` HAPI projects into the session. */
export type OpencodeGoalState = {
    id: string;
    objective: string;
    status: 'active' | 'paused' | 'complete';
    rounds: number;
    maxRounds: number;
    reason?: string;
    updatedAt: number;
};

export function asOpencodeGoalState(value: unknown): OpencodeGoalState | null {
    if (!isObject(value)) return null;
    const { id, objective, status, rounds, maxRounds, updatedAt } = value;
    if (typeof id !== 'string' || typeof objective !== 'string' || !objective.trim()) return null;
    if (status !== 'active' && status !== 'paused' && status !== 'complete') return null;
    if (typeof rounds !== 'number' || typeof maxRounds !== 'number') return null;
    return {
        id,
        objective,
        status,
        rounds,
        maxRounds,
        ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
        ...(typeof updatedAt === 'number' ? { updatedAt } : { updatedAt: 0 })
    };
}

/** Read a goal through OpenCode's plugin RPC (`opencode.goal/get`). */
export async function fetchOpencodeGoal(opts: {
    baseUrl: string;
    directory: string;
    sessionID: string;
    headers: Record<string, string>;
    fetchImpl?: typeof fetch;
}): Promise<OpencodeGoalState | null> {
    const url = `${opts.baseUrl}/api/rpc/opencode.goal/get?directory=${encodeURIComponent(opts.directory)}`;
    const response = await (opts.fetchImpl ?? fetch)(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...opts.headers },
        body: JSON.stringify({ input: { sessionID: opts.sessionID } }),
        signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const output = isObject(body) ? body.output : undefined;
    return asOpencodeGoalState(output ?? null);
}

/**
 * Pull `{ sessionID, goal }` out of an `rpc.opencode.goal.changed` event.
 * v2 event frames wrap the body twice (`{ type, data: { type, data, location } }`
 * in some builds, flat `{ type, data: { sessionID, goal } }` in others), so
 * walk a bounded number of `data` levels instead of assuming one shape.
 */
export function extractOpencodeGoalChange(properties: unknown): { sessionID?: string; goal: unknown } | null {
    if (!isObject(properties)) return null;
    let current: Record<string, unknown> = properties;
    for (let depth = 0; depth < 4; depth++) {
        if ('sessionID' in current || 'goal' in current) {
            const sessionID = typeof current.sessionID === 'string' ? current.sessionID : undefined;
            if ('goal' in current) return { sessionID, goal: current.goal };
        }
        if (!isObject(current.data)) return null;
        current = current.data;
    }
    return null;
}
