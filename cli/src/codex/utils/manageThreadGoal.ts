import { CodexGoalRequestSchema, type CodexGoalResponse } from '@hapi/protocol/apiTypes';
import { ThreadGoalSchema } from '@hapi/protocol/schemas';

type NativeRequest = (method: string, params: Record<string, unknown>) => Promise<unknown>;

function readGoal(response: unknown): CodexGoalResponse {
    const value = (response as { goal?: unknown } | null)?.goal;
    if (value === null) return { goal: null };
    const goal = value as Record<string, unknown> | undefined;
    return { goal: ThreadGoalSchema.parse({
        ...goal,
        threadId: goal?.threadId ?? goal?.thread_id,
        tokenBudget: goal?.tokenBudget ?? goal?.token_budget ?? null,
        tokensUsed: goal?.tokensUsed ?? goal?.tokens_used ?? 0,
        timeUsedSeconds: goal?.timeUsedSeconds ?? goal?.time_used_seconds ?? 0,
        createdAt: goal?.createdAt ?? goal?.created_at ?? 0,
        updatedAt: goal?.updatedAt ?? goal?.updated_at ?? 0
    }) };
}

/** Native Goal controls bypass the chat queue and never interrupt a turn. */
export async function manageThreadGoal(threadId: string, raw: unknown, request: NativeRequest): Promise<CodexGoalResponse> {
    const action = CodexGoalRequestSchema.parse(raw);
    if (action.action === 'get') return readGoal(await request('thread/goal/get', { threadId }));
    if (action.action === 'clear') {
        await request('thread/goal/clear', { threadId, origin: 'user' });
        return { goal: null };
    }
    // Check for a removed Goal before applying an edit.
    const current = readGoal(await request('thread/goal/get', { threadId }));
    if (!current.goal) throw new Error('No Goal to update. Refresh the session.');
    return readGoal(await request('thread/goal/set', {
        threadId,
        origin: 'user',
        ...(action.action === 'update'
            ? { objective: action.objective, ...(action.tokenBudget !== undefined ? { tokenBudget: action.tokenBudget } : {}) }
            : { status: action.action === 'pause' ? 'paused' : 'active' })
    }));
}
