import type { AgentSessionConfigOptionDescriptor } from '@/agent/types';

/** Minimal fetch signature used by the OpenCode variant discovery tests. */
export type OpenCodeVariantFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type OpenCodeReasoningEffortState = {
    modelId: string;
    currentValue: string | null;
    option: AgentSessionConfigOptionDescriptor;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function splitModelId(value: string): { providerId: string; modelId: string } | null {
    const separator = value.indexOf('/');
    if (separator <= 0 || separator === value.length - 1) return null;
    return {
        providerId: value.slice(0, separator),
        modelId: value.slice(separator + 1)
    };
}

function displayName(value: string): string {
    return value
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getProviders(payload: unknown): JsonRecord[] {
    if (!isRecord(payload)) return [];
    const providers = Array.isArray(payload.all)
        ? payload.all
        : Array.isArray(payload.providers)
            ? payload.providers
            : [];
    return providers.filter(isRecord);
}

/**
 * Reads OpenCode's native model variants.
 *
 * OpenCode exposes DeepSeek reasoning levels as model `variants` in its HTTP
 * API. They are intentionally not inferred from the model name: providers can
 * add/remove levels independently, and the ACP configOptions response does not
 * currently include this information.
 */
export async function fetchOpenCodeReasoningEffortState(options: {
    baseUrl: string;
    directory: string;
    sessionId: string;
    modelId?: string | null;
    fetchImpl?: OpenCodeVariantFetch;
}): Promise<OpenCodeReasoningEffortState | null> {
    const fetchFn = options.fetchImpl ?? (fetch as OpenCodeVariantFetch);
    const query = `?directory=${encodeURIComponent(options.directory)}`;

    try {
        const sessionResponse = await fetchFn(
            `${options.baseUrl}/session/${encodeURIComponent(options.sessionId)}${query}`,
            { method: 'GET' }
        );
        if (!sessionResponse.ok) return null;
        const sessionPayload: unknown = await sessionResponse.json().catch(() => null);
        const sessionModel = isRecord(sessionPayload) && isRecord(sessionPayload.model)
            ? sessionPayload.model
            : null;

        const providerId = asString(sessionModel?.providerID)
            ?? (options.modelId ? splitModelId(options.modelId)?.providerId : null);
        const modelId = asString(sessionModel?.id)
            ?? (options.modelId ? splitModelId(options.modelId)?.modelId : null);
        if (!providerId || !modelId) return null;

        const providersResponse = await fetchFn(`${options.baseUrl}/provider${query}`, { method: 'GET' });
        if (!providersResponse.ok) return null;
        const providersPayload: unknown = await providersResponse.json().catch(() => null);
        const provider = getProviders(providersPayload).find((entry) => entry.id === providerId);
        const models = provider && isRecord(provider.models) ? provider.models : null;
        const model = models && isRecord(models[modelId]) ? models[modelId] : null;
        const variants = model && isRecord(model.variants) ? model.variants : null;
        if (!variants) return null;

        const optionsList = Object.keys(variants)
            .filter((value) => value.trim().length > 0)
            .map((value) => ({ value, name: displayName(value) }));
        if (optionsList.length === 0) return null;

        const currentVariant = asString(sessionModel?.variant);
        return {
            modelId: `${providerId}/${modelId}`,
            currentValue: currentVariant && optionsList.some((entry) => entry.value === currentVariant)
                ? currentVariant
                : null,
            option: {
                id: `opencode/variant/${providerId}/${modelId}`,
                category: 'thought_level',
                currentValue: currentVariant ?? undefined,
                options: optionsList
            }
        };
    } catch {
        // Discovery is supplementary. An older OpenCode build may not expose
        // /provider or /session; the ACP thought-level path can still be used.
        return null;
    }
}

