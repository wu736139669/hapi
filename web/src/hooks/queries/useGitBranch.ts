import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { buildGitStatusFiles } from '@/lib/gitParsers'
import { queryKeys } from '@/lib/query-keys'

/**
 * Current git branch of the session's working directory.
 *
 * Lightweight on purpose: one `git status` RPC (no diff numstat calls like
 * useGitStatusFiles) so the session header can show the branch without
 * pulling file-change summaries. Only fetched for live sessions — the RPC
 * runs through the agent process — and resolves to null when the status is
 * unavailable (non-git directory, detached HEAD, dead session).
 */
export function useGitBranch(api: ApiClient | null, sessionId: string | null, enabled: boolean): string | null {
    const resolvedSessionId = sessionId ?? 'unknown'
    const query = useQuery({
        queryKey: queryKeys.gitBranch(resolvedSessionId),
        queryFn: async () => {
            if (!api || !sessionId) return null
            const statusResult = await api.getGitStatus(sessionId)
            if (!statusResult.success) return null
            return buildGitStatusFiles(statusResult.stdout ?? '', '', '').branch
        },
        enabled: Boolean(api && sessionId && enabled),
    })

    return query.data ?? null
}
