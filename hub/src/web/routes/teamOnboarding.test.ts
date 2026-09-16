import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import { createTeamOnboardingRoutes } from './teamOnboarding'

describe('Team onboarding', () => {
    it('claims an invite and rejects a second claim', async () => {
        const store = new Store(':memory:')
        try {
            const created = store.accessTokens.createInvite({ kind: 'enroll', namespace: 'new-member' })
            const app = new Hono()
            app.route('/', createTeamOnboardingRoutes(store))

            const first = await app.request('/api/team/onboarding/claim', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ invite: created.invite })
            })
            expect(first.status).toBe(200)
            expect(await first.json()).toMatchObject({ success: true, namespace: 'new-member' })

            const second = await app.request('/api/team/onboarding/claim', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ invite: created.invite })
            })
            expect(second.status).toBe(410)
        } finally {
            store.close()
        }
    })

    it('does not expose the invite in the guide page URL query', async () => {
        const store = new Store(':memory:')
        try {
            const app = new Hono()
            app.route('/', createTeamOnboardingRoutes(store))
            const response = await app.request('/team-guide')
            const html = await response.text()
            expect(response.status).toBe(200)
            expect(html).toContain('Team HAPI')
            expect(html).toContain('location.hash')
            expect(html).toContain('让 Codex 自动初始化 HAPI')
            expect(html).toContain('npm install -g @twsxtd/hapi')
            expect(html).toContain('【你的个人 Token】')
            expect(html).toContain('cliApiToken')
            expect(html).toContain('codex-prompt')
            expect(html).toContain('使用教程')
            expect(html).toContain('添加到主屏幕')
            expect(html).toContain('Yolo')
            expect(html).toContain('/team-guide/new-session.png')
        } finally {
            store.close()
        }
    })
})
