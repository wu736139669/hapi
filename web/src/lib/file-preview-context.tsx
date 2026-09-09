import { createContext, useContext, type ReactNode } from 'react'

export type FilePreviewRequest = {
    sessionId: string
    filePath: string
}

type FilePreviewContextValue = {
    openFilePreview: (request: FilePreviewRequest) => void
}

const FilePreviewContext = createContext<FilePreviewContextValue | null>(null)

export function FilePreviewContextProvider(props: {
    value: FilePreviewContextValue
    children: ReactNode
}) {
    return <FilePreviewContext.Provider value={props.value}>{props.children}</FilePreviewContext.Provider>
}

export function useFilePreview(): FilePreviewContextValue {
    const context = useContext(FilePreviewContext)
    if (!context) {
        throw new Error('FilePreviewContext is not available')
    }
    return context
}

export function useOptionalFilePreview(): FilePreviewContextValue | null {
    return useContext(FilePreviewContext)
}
