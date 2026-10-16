import { expect, test } from '@playwright/test'

const fixture = '/e2e-fixtures/adventure-skin-fixture.html'

test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => {
        localStorage.setItem('hapi-lang', 'en')
        localStorage.setItem('hapi.fue.v1.rich-composer-mentions', '1')
        localStorage.setItem('hapi.fue.v1.scratchlist-toggle', '1')
    })
})

test('skin selection persists, synchronizes across tabs, and returns to default', async ({ page, context }) => {
    await page.goto(`${fixture}?view=settings`)
    const forest = page.getByRole('radio', { name: 'Forest Adventure', exact: true })
    await forest.click()
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'forest-adventure')
    await expect(forest).toHaveAttribute('aria-checked', 'true')
    await forest.press('ArrowLeft')
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'default')
    await page.getByRole('radiogroup', { name: 'Interface skin' }).getByRole('radio', { name: 'Default', exact: true }).press('ArrowRight')
    await expect(forest).toBeFocused()
    await page.reload()
    await expect(forest).toHaveAttribute('aria-checked', 'true')
    const second = await context.newPage()
    await second.goto(`${fixture}?view=settings`)
    await expect(second.getByRole('radio', { name: 'Forest Adventure', exact: true })).toHaveAttribute('aria-checked', 'true')
    await second.getByRole('radio', { name: 'Default', exact: true }).first().click()
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'default')
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--app-bg'))).toBe('')
    await second.close()
})

test('real chat approves a tool, sends a message, and stops the running session', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${fixture}?skin=forest-adventure`)
    await page.getByRole('button', { name: /把想法变成/ }).click()
    await page.getByRole('button', { name: 'Allow', exact: true }).click()
    await expect(page.locator('.hapi-skin-header .forest-companion')).toHaveAttribute('data-companion-state', 'idle')
    const editor = page.getByRole('textbox').first()
    await editor.fill('Check the forest interface')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.locator('.hapi-skin-header .forest-companion')).toHaveAttribute('data-companion-state', 'working')
    await page.getByRole('button', { name: 'Abort', exact: true }).click()
    await expect(page.locator('.hapi-skin-header .forest-companion')).toHaveAttribute('data-companion-state', 'idle')
    const probe = await page.evaluate(() => window.__adventure)
    expect(probe.sent).toContain('Check the forest interface')
    expect(probe.requests).toContainEqual({ path: '/api/sessions/forest-session/permissions/approval-1/approve', method: 'POST' })
    expect(probe.requests).toContainEqual({ path: '/api/sessions/forest-session/abort', method: 'POST' })
    expect(errors).toEqual([])
})

test('denial keeps its real request action under the skin', async ({ page }) => {
    await page.goto(`${fixture}?skin=forest-adventure&view=chat`)
    await page.getByRole('button', { name: 'Deny', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.__adventure.requests.some(request => request.path.endsWith('/approval-1/deny') && request.method === 'POST'))).toBe(true)
    await expect(page.locator('.hapi-skin-header .forest-companion')).toHaveAttribute('data-companion-state', 'idle')
})

test('phone sizes, short viewport, dark modes, and desktop keep the page contained', async ({ page }) => {
    await page.goto(`${fixture}?skin=forest-adventure`)
    for (const width of [320, 360, 390, 430, 1280]) {
        await page.setViewportSize({ width, height: 800 })
        await expect(page.locator('.forest-banner')).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }
    await page.setViewportSize({ width: 360, height: 800 })
    await page.getByRole('button', { name: /把想法变成/ }).click()
    await page.getByRole('textbox').first().focus()
    await page.getByRole('textbox').first().fill('Keep my draft')
    await page.getByRole('button', { name: 'Expand message editor', exact: true }).click()
    await expect(page.locator('[data-testid="composer-shell"]')).toHaveAttribute('data-expanded', 'true')
    await page.getByRole('button', { name: 'Collapse message editor', exact: true }).click()
    await expect.poll(() => page.getByRole('textbox').first().evaluate(element => element instanceof HTMLTextAreaElement ? element.value : element.textContent)).toBe('Keep my draft')
    await page.setViewportSize({ width: 360, height: 420 })
    await expect.poll(() => page.locator('[data-testid="composer-shell"]').evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(420)
    for (const appearance of ['dark', 'oled']) {
        await page.goto(`${fixture}?skin=forest-adventure&view=chat&appearance=${appearance}`)
        await expect(page.locator('html')).toHaveAttribute('data-theme', appearance)
        await expect(page.locator('[data-testid="composer-shell"]')).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360)
    }
})

test('reduced motion and default mode avoid decoration work', async ({ page }) => {
    const images: string[] = []
    page.on('request', request => { if (request.resourceType() === 'image' && request.url().includes('/skins/')) images.push(request.url()) })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(fixture)
    await expect(page.locator('.forest-banner')).toHaveCount(0)
    await expect(page.locator('.forest-companion')).toHaveCount(0)
    expect(images).toEqual([])
    await page.goto(`${fixture}?skin=forest-adventure&view=chat`)
    await page.evaluate(() => window.__adventure.patch({ thinking: true }))
    const animation = await page.locator('.hapi-skin-header .forest-companion__sprite').evaluate(element => getComputedStyle(element).animationName)
    expect(animation).toBe('none')
})

test('transparent cutouts decode without loading source sheets, and the empty-list action works', async ({ page }) => {
    const images: string[] = []
    page.on('request', request => { if (request.resourceType() === 'image') images.push(request.url()) })
    await page.goto(`${fixture}?skin=forest-adventure`)
    await expect(page.locator('[data-forest-asset="guide"]').first()).toBeVisible()
    await page.goto(`${fixture}?skin=forest-adventure&view=empty`)
    await expect(page.locator('.forest-empty-illustration')).toBeVisible()
    const alphaCorners = await page.locator('img[data-forest-asset]').evaluateAll(async elements => {
        return Promise.all(elements.map(async element => {
            const image = element as HTMLImageElement
            await image.decode()
            const canvas = document.createElement('canvas')
            canvas.width = image.naturalWidth
            canvas.height = image.naturalHeight
            const context = canvas.getContext('2d')!
            context.drawImage(image, 0, 0)
            return [[0, 0], [canvas.width - 1, 0], [0, canvas.height - 1], [canvas.width - 1, canvas.height - 1]]
                .map(([x, y]) => context.getImageData(x, y, 1, 1).data[3])
        }))
    })
    expect(alphaCorners.length).toBeGreaterThan(0)
    expect(alphaCorners.flat().every(alpha => alpha === 0)).toBe(true)
    expect(images.some(url => /source-sheet|normalized-sheet/.test(url))).toBe(false)
    await page.setViewportSize({ width: 320, height: 640 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
    await page.getByRole('button', { name: 'Start a session', exact: true }).click()
    await expect(page.locator('[data-testid="composer-shell"]')).toBeVisible()
})

test('rich scenery preserves compact navigation and yields to the actual chat height', async ({ page }) => {
    await page.goto(`${fixture}?skin=forest-adventure&compact`)
    await expect(page.locator('.session-list-item').first()).toBeVisible()
    await expect(page.locator('.forest-scenery')).toHaveCount(0)
    await expect(page.locator('[data-forest-asset]')).toHaveCount(0)

    await page.goto(`${fixture}?skin=forest-adventure&view=chat`)
    const scenery = page.locator('.forest-scenery--chat')
    await expect(scenery).toBeVisible()
    await expect(scenery).toHaveCSS('pointer-events', 'none')
    const editor = page.getByRole('textbox').first()
    await editor.fill('Keep this draft while the keyboard opens')
    // Shrink the allocated pane without shrinking the browser window (soft keyboard / split pane).
    await page.locator('.hapi-session-chat').evaluate(element => { element.style.height = '430px' })
    await expect(scenery).toBeHidden()
    const chatBottom = await page.locator('.hapi-session-chat').evaluate(element => element.getBoundingClientRect().bottom)
    expect(await page.locator('[data-testid="composer-shell"]').evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(chatBottom)
    await expect.poll(() => editor.evaluate(element => element instanceof HTMLTextAreaElement ? element.value : element.textContent)).toBe('Keep this draft while the keyboard opens')
    await page.locator('.hapi-session-chat').evaluate(element => { element.style.removeProperty('height') })
    await expect(scenery).toBeVisible()
})

test.describe('first HTML load', () => {
    test.use({ serviceWorkers: 'block' })
    test('the production HTML resolves skin and custom background before React loads', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('hapi-appearance-skin', 'forest-adventure')
            localStorage.setItem('hapi-appearance', 'dark')
            localStorage.setItem('hapi-theme-colors', JSON.stringify({ dark: { background: '#193122' } }))
        })
        await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: '' }))
        await page.goto('/')
        await expect(page.locator('html')).toHaveAttribute('data-skin', 'forest-adventure')
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
        await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#193122')
        expect(await page.evaluate(() => document.documentElement.style.backgroundColor)).toBe('rgb(25, 49, 34)')
    })
})

test('a real question card remains selectable and submits its own request ID', async ({ page }) => {
    await page.goto(`${fixture}?skin=forest-adventure&view=chat`)
    await page.locator('[data-testid="composer-shell"]').waitFor()
    await page.evaluate(() => window.__adventure.patch({ agentState: { requests: {
        'question-1': { tool: 'AskUserQuestion', toolCallId: 'question-tool', createdAt: Date.now(), arguments: {
            questions: [{ question: 'Which route?', header: 'Path', multiSelect: false, options: [
                { label: 'Forest', description: 'Through the trees' }, { label: 'River', description: 'Along the river' },
            ] }],
        } },
    } } }))
    await page.getByText('Forest', { exact: true }).click()
    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.__adventure.requests.some(request => request.path.endsWith('/question-1/approve') && request.method === 'POST'))).toBe(true)
})
