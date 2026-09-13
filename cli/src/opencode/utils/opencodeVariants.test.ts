import { describe, expect, it, vi } from 'vitest';
import { fetchOpenCodeReasoningEffortState } from './opencodeVariants';

function response(payload: unknown, ok = true): Response {
    return new Response(JSON.stringify(payload), {
        status: ok ? 200 : 404,
        headers: { 'content-type': 'application/json' }
    });
}

describe('fetchOpenCodeReasoningEffortState', () => {
    it('discovers native model variants and the live selected value', async () => {
        const fetchImpl = vi.fn(async (url: string) => {
            if (url.includes('/session/')) {
                return response({
                    model: {
                        providerID: 'opencode-go',
                        id: 'deepseek-v4.1-flash',
                        variant: 'max'
                    }
                });
            }
            return response({
                all: [{
                    id: 'opencode-go',
                    models: {
                        'deepseek-v4.1-flash': {
                            variants: {
                                low: { reasoningEffort: 'low' },
                                high: { reasoningEffort: 'high' },
                                max: { reasoningEffort: 'max' }
                            }
                        }
                    }
                }]
            });
        });

        const state = await fetchOpenCodeReasoningEffortState({
            baseUrl: 'http://127.0.0.1:1234',
            directory: '/workspace',
            sessionId: 'session-1',
            fetchImpl
        });

        expect(state).toMatchObject({
            modelId: 'opencode-go/deepseek-v4.1-flash',
            currentValue: 'max',
            option: {
                category: 'thought_level',
                options: [
                    { value: 'low', name: 'Low' },
                    { value: 'high', name: 'High' },
                    { value: 'max', name: 'Max' }
                ]
            }
        });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('returns null when the selected model has no variants', async () => {
        const fetchImpl = vi.fn(async (url: string) => url.includes('/session/')
            ? response({ model: { providerID: 'opencode-go', id: 'big-pickle' } })
            : response({ all: [{ id: 'opencode-go', models: { 'big-pickle': { variants: {} } } }] }));

        await expect(fetchOpenCodeReasoningEffortState({
            baseUrl: 'http://127.0.0.1:1234',
            directory: '/workspace',
            sessionId: 'session-1',
            fetchImpl
        })).resolves.toBeNull();
    });
});

