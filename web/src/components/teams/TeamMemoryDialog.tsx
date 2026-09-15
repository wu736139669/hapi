import { useQuery } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { queryKeys } from '@/lib/query-keys'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { TeamDialog } from './TeamDialog'

const MARKDOWN_EXTENSIONS = ['.md', '.markdown']

export function TeamMemoryDialog(props: {
    leadSessionId: string
    /** Absolute path of the file on the lead's machine. */
    path: string | null
    onClose: () => void
}) {
    const { api } = useAppContext()
    const { t } = useTranslation()

    const query = useQuery({
        queryKey: queryKeys.sessionFile(props.leadSessionId, props.path ?? ''),
        queryFn: async () => {
            if (!api || !props.path) throw new Error('API unavailable')
            return await api.readSessionFile(props.leadSessionId, props.path)
        },
        enabled: Boolean(api && props.path),
        staleTime: 5_000,
        retry: false,
    })

    const isMarkdown = props.path
        ? MARKDOWN_EXTENSIONS.some((extension) => props.path!.toLowerCase().endsWith(extension))
        : false
    const content = query.data?.success ? query.data.content ?? '' : ''

    return (
        <TeamDialog
            open={Boolean(props.path)}
            title={props.path?.split('/').pop() ?? ''}
            onClose={props.onClose}
            footer={null}
        >
            <div className="max-h-[60vh] min-h-[120px] overflow-auto">
                {query.isLoading ? (
                    <div className="py-6 text-center text-sm text-[var(--app-hint)]">{t('team.memory.loading')}</div>
                ) : query.error || (query.data && !query.data.success) ? (
                    <div className="py-6 text-center text-sm text-red-600">
                        {query.data?.error ?? (query.error instanceof Error ? query.error.message : t('team.memory.failed'))}
                    </div>
                ) : (
                    <>
                        <div className="mb-2 truncate font-mono text-[11px] text-[var(--app-hint)]">{props.path}</div>
                        {isMarkdown ? (
                            <MarkdownRenderer content={content} className="text-sm" preserveSingleLineBreaks standalone />
                        ) : (
                            <pre className="whitespace-pre-wrap break-words text-xs text-[var(--app-fg)]">{content}</pre>
                        )}
                    </>
                )}
            </div>
        </TeamDialog>
    )
}
