import { expect, test } from '@playwright/test'

const fixture = '/e2e-fixtures/adventure-skin-fixture.html'

const macaronVariants = [
    { skin: 'macaron-peach', name: 'Peach Cream', light: '#fff8f2', dark: '#241b18', tone: '#ffd9c7' },
    { skin: 'macaron-mint', name: 'Mint Sea Salt', light: '#f4fbf8', dark: '#15221f', tone: '#caece2' },
    { skin: 'macaron-blueberry', name: 'Blueberry Cream', light: '#f7f8ff', dark: '#191e2c', tone: '#d3ddfa' },
    { skin: 'macaron-lemon', name: 'Lemon Sorbet', light: '#fffcef', dark: '#242117', tone: '#fff0b9' },
    { skin: 'macaron-rose', name: 'Rose Lychee', light: '#fff7fb', dark: '#251923', tone: '#f7cfe0' },
] as const

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
        await expect(page.locator('.forest-scenery--list')).toBeVisible()
        await expect(page.locator('.forest-banner')).toHaveCount(0)
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

test('full-page scenery stays behind scrolling content and never reserves chat space', async ({ page }) => {
    await page.goto(`${fixture}?skin=forest-adventure&compact`)
    await expect(page.locator('.session-list-item').first()).toBeVisible()
    await expect(page.locator('.forest-scenery')).toHaveCount(0)
    await expect(page.locator('[data-forest-asset]')).toHaveCount(0)

    await page.goto(`${fixture}?skin=forest-adventure&dense`)
    const listScenery = page.locator('.forest-scenery--list')
    await expect(listScenery).toHaveCSS('position', 'absolute')
    await expect(page.locator('.forest-banner')).toHaveCount(0)
    const listBox = await page.locator('.hapi-session-list').boundingBox()
    expect(await listScenery.boundingBox()).toEqual(listBox)
    expect((await page.locator('.session-list-item').first().boundingBox())!.y).toBeLessThan(180)
    await page.locator('.session-list-scrollbar-left').evaluate(element => { element.scrollTop = 450 })
    await expect.poll(() => page.locator('.session-list-scrollbar-left').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    expect(await listScenery.boundingBox()).toEqual(listBox)
    await expect(page.locator('.forest-scenery__world')).toHaveCSS('background-image', /forest-page\.webp/)

    await page.goto(`${fixture}?skin=forest-adventure&view=chat`)
    const scenery = page.locator('.forest-scenery--chat')
    await expect(scenery).toBeVisible()
    await expect(scenery).toHaveCSS('position', 'absolute')
    await expect(scenery).toHaveCSS('pointer-events', 'none')
    expect(await scenery.boundingBox()).toEqual(await page.locator('.hapi-session-chat').boundingBox())
    const editor = page.getByRole('textbox').first()
    await editor.fill('Keep this draft while the keyboard opens')
    // Shrink the allocated pane without shrinking the browser window (soft keyboard / split pane).
    await page.locator('.hapi-session-chat').evaluate(element => { element.style.height = '430px' })
    await expect(scenery).toBeVisible()
    expect(await scenery.boundingBox()).toEqual(await page.locator('.hapi-session-chat').boundingBox())
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

test.describe('Macaron Gradient', () => {
    test('all skins cycle with the keyboard, persist, and synchronize across tabs', async ({ page, context }) => {
        await page.goto(`${fixture}?view=settings`)
        const choices = page.getByRole('radiogroup', { name: 'Interface skin' })
        await expect(choices.getByRole('radio')).toHaveCount(8)
        const macaron = choices.getByRole('radio', { name: 'Macaron Gradient', exact: true })
        const last = choices.getByRole('radio', { name: 'Rose Lychee', exact: true })
        await choices.getByRole('radio', { name: 'Default', exact: true }).press('End')
        await expect(last).toBeFocused()
        await expect(page.locator('html')).toHaveAttribute('data-skin', 'macaron-rose')
        await last.press('ArrowRight')
        await expect(choices.getByRole('radio', { name: 'Default', exact: true })).toBeFocused()
        await choices.getByRole('radio', { name: 'Default', exact: true }).press('ArrowUp')
        await expect(last).toBeFocused()
        await last.press('Home')
        await choices.getByRole('radio', { name: 'Default', exact: true }).press('ArrowRight')
        await expect(choices.getByRole('radio', { name: 'Forest Adventure', exact: true })).toBeFocused()
        await macaron.click()
        await page.reload()
        await expect(macaron).toHaveAttribute('aria-checked', 'true')
        const second = await context.newPage()
        await second.goto(`${fixture}?view=settings`)
        await expect(second.getByRole('radio', { name: 'Macaron Gradient', exact: true })).toHaveAttribute('aria-checked', 'true')
        await second.getByRole('radio', { name: 'Forest Adventure', exact: true }).click()
        await expect(page.locator('html')).toHaveAttribute('data-skin', 'forest-adventure')
        await second.getByRole('radio', { name: 'Default', exact: true }).first().click()
        await expect(page.locator('html')).toHaveAttribute('data-skin', 'default')
        expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--app-bg'))).toBe('')
        await second.close()
    })

    test('the real approval, send and stop actions work without forest decoration', async ({ page }) => {
        const images: string[] = []
        const errors: string[] = []
        page.on('request', request => { if (request.resourceType() === 'image' && request.url().includes('/skins/')) images.push(request.url()) })
        page.on('pageerror', error => errors.push(error.message))
        await page.goto(`${fixture}?skin=macaron-gradient`)
        await expect(page.locator('.hapi-session-list')).toHaveCSS('background-image', /radial-gradient/)
        await page.getByRole('button', { name: /把想法变成/ }).click()
        await expect(page.locator('.forest-companion, .forest-scenery')).toHaveCount(0)
        await page.getByRole('button', { name: 'Allow', exact: true }).click()
        await page.getByRole('textbox').first().fill('Check the macaron skin')
        await page.getByRole('button', { name: 'Send', exact: true }).click()
        await page.getByRole('button', { name: 'Abort', exact: true }).click()
        const probe = await page.evaluate(() => window.__adventure)
        expect(probe.sent).toContain('Check the macaron skin')
        expect(probe.requests).toContainEqual({ path: '/api/sessions/forest-session/permissions/approval-1/approve', method: 'POST' })
        expect(probe.requests).toContainEqual({ path: '/api/sessions/forest-session/abort', method: 'POST' })
        expect(images).toEqual([])
        expect(errors).toEqual([])
    })

    test('phone widths, dark modes and the soft keyboard keep content readable and contained', async ({ page }) => {
        await page.goto(`${fixture}?skin=macaron-gradient&dense`)
        for (const width of [320, 360, 390, 430, 1280]) {
            await page.setViewportSize({ width, height: 844 })
            await expect(page.locator('.session-list-item').first()).toBeVisible()
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        }
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto(`${fixture}?skin=macaron-gradient&view=chat`)
        const editor = page.getByRole('textbox').first()
        await editor.fill('Keep my macaron draft')
        await page.getByRole('button', { name: 'Expand message editor', exact: true }).click()
        await expect(page.locator('[data-testid="composer-shell"]')).toHaveAttribute('data-expanded', 'true')
        await page.getByRole('button', { name: 'Collapse message editor', exact: true }).click()
        await page.locator('.hapi-session-chat').evaluate(element => { element.style.height = '430px' })
        expect(await page.locator('[data-testid="composer-shell"]').evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(430)
        await expect.poll(() => editor.evaluate(element => element instanceof HTMLTextAreaElement ? element.value : element.textContent)).toBe('Keep my macaron draft')
        for (const [scheme, background] of [['dark', '#1c1724'], ['oled', '#000000']]) {
            await page.goto(`${fixture}?skin=macaron-gradient&view=chat&appearance=${scheme}`)
            await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
            expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--app-bg'))).toBe(background)
            await expect(page.locator('.hapi-session-chat')).toHaveCSS('background-image', /radial-gradient/)
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
        }
    })

    test.describe('first HTML load', () => {
        test.use({ serviceWorkers: 'block' })
        for (const [scheme, background] of [['light', '#fcf7fb'], ['dark', '#1c1724'], ['oled', '#000000']]) {
            test(`resolves ${scheme} before React loads`, async ({ page }) => {
                await page.addInitScript(({ scheme }) => {
                    localStorage.setItem('hapi-appearance-skin', 'macaron-gradient')
                    localStorage.setItem('hapi-appearance', scheme)
                }, { scheme })
                await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: '' }))
                await page.goto('/')
                await expect(page.locator('html')).toHaveAttribute('data-skin', 'macaron-gradient')
                await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
                await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', background)
            })
        }
    })

    test('all five color variants select, persist, and adapt to phone widths and dark modes', async ({ page }) => {
        await page.goto(`${fixture}?view=settings`)
        await page.setViewportSize({ width: 320, height: 844 })
        for (const variant of macaronVariants) {
            const option = page.getByRole('radio', { name: variant.name, exact: true })
            await option.click()
            await page.reload()
            await expect(option).toHaveAttribute('aria-checked', 'true')
            await expect(page.locator('html')).toHaveAttribute('data-skin', variant.skin)
            expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--macaron-tone-start').trim())).toBe(variant.tone)
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
        }
        for (const variant of macaronVariants) {
            for (const scheme of ['light', 'dark', 'oled'] as const) {
                await page.setViewportSize({ width: scheme === 'light' ? 430 : 390, height: 844 })
                await page.goto(`${fixture}?skin=${variant.skin}&appearance=${scheme}&view=chat`)
                await expect(page.locator('[data-testid="composer-shell"]')).toBeVisible()
                await expect(page.locator('.hapi-session-chat')).toHaveCSS('background-image', /radial-gradient/)
                expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--app-bg'))).toBe(scheme === 'oled' ? '#000000' : variant[scheme])
                await expect(page.locator('.forest-scenery, .forest-companion')).toHaveCount(0)
                expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
            }
        }
    })

    test.describe('variant first HTML load', () => {
        test.use({ serviceWorkers: 'block' })
        test('all variant backgrounds resolve in every appearance before React loads', async ({ page }) => {
            await page.addInitScript(() => {
                const params = new URLSearchParams(location.search)
                localStorage.setItem('hapi-appearance-skin', params.get('bootSkin')!)
                localStorage.setItem('hapi-appearance', params.get('bootScheme')!)
            })
            await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: '' }))
            for (const variant of macaronVariants) {
                for (const scheme of ['light', 'dark', 'oled'] as const) {
                    await page.goto(`/?bootSkin=${variant.skin}&bootScheme=${scheme}`)
                    await expect(page.locator('html')).toHaveAttribute('data-skin', variant.skin)
                    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', scheme === 'oled' ? '#000000' : variant[scheme])
                }
            }
        })
    })
})
