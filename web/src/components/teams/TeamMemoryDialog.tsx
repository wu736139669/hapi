import { useQuery } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { queryKeys } from '@/lib/query-keys'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { TeamDialog } from './TeamDialog'

const MARKDOWN_EXTENSIONS = ['.md', '.markdown']

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function TeamMemoryDialog(props: {
    teamId: string
    path: string | null
    onClose: () => void
}) {
    const { api } = useAppContext()
    const { t } = useTranslation()

    const query = useQuery({
        queryKey: queryKeys.teamMemoryFile(props.teamId, props.path ?? ''),
        queryFn: async () => {
            if (!api || !props.path) throw new Error('API unavailable')
            return await api.getTeamMemoryFile(props.teamId, props.path)
        },
        enabled: Boolean(api && props.path),
        staleTime: 10_000,
        retry: false,
    })

    const isMarkdown = props.path ? MARKDOWN_EXTENSIONS.some((extension) => props.path!.toLowerCase().endsWith(extension)) : false

    return (
        <TeamDialog
            open={Boolean(props.path)}
            title={props.path ?? ''}
            onClose={props.onClose}
            footer={null}
        >
            <div className="max-h-[60vh] min-h-[120px] overflow-auto">
                {query.isLoading ? (
                    <div className="py-6 text-center text-sm text-[var(--app-hint)]">{t('team.memory.loading')}</div>
                ) : query.error ? (
                    <div className="py-6 text-center text-sm text-red-600">
                        {query.error instanceof Error ? query.error.message : t('team.memory.failed')}
                    </div>
                ) : query.data ? (
                    <>
                        <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--app-hint)]">
                            <span>
                                {new Date(query.data.updatedAt).toLocaleString()}
                            </span>
                            <span>{formatSize(new Blob([query.data.content]).size)}</span>
                        </div>
                        {isMarkdown ? (
                            <MarkdownRenderer content={query.data.content} className="text-sm" preserveSingleLineBreaks standalone />
                        ) : (
                            <pre className="whitespace-pre-wrap break-words text-xs text-[var(--app-fg)]">{query.data.content}</pre>
                        )}
                    </>
                ) : null}
            </div>
        </TeamDialog>
    )
}
