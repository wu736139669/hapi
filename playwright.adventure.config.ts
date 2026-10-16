import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
    ...base,
    testMatch: 'adventure-skin.spec.ts',
    projects: base.projects?.map(project => ({
        ...project,
        use: { ...project.use, channel: process.env.PLAYWRIGHT_CHANNEL },
    })),
})
