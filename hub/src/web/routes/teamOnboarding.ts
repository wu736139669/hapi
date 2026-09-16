import { Hono } from 'hono'
import { z } from 'zod'
import { getConfiguration } from '../../configuration'
import { constantTimeEquals } from '../../utils/crypto'
import type { Store } from '../../store'

const inviteBodySchema = z.object({
    namespace: z.string().optional(),
    expiresInHours: z.number().int().min(1).max(168).optional()
})

const claimBodySchema = z.object({
    invite: z.string().min(1).max(512)
})

function getBearerToken(value: string | undefined): string | null {
    if (!value?.startsWith('Bearer ')) return null
    const token = value.slice('Bearer '.length).trim()
    return token || null
}

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
}

function publicOrigin(request: Request): string {
    let configured = ''
    try {
        configured = getConfiguration().publicUrl.trim().replace(/\/$/, '')
    } catch {
        // Route-level tests can render the guide without booting the full Hub.
    }
    if (configured) return configured
    return new URL(request.url).origin
}

function guideUrl(request: Request, invite: string): string {
    return `${publicOrigin(request)}/team-guide#invite=${encodeURIComponent(invite)}`
}

function isAdminRequest(request: Request): boolean {
    const token = getBearerToken(request.headers.get('authorization') ?? undefined)
    return Boolean(token && constantTimeEquals(token, getConfiguration().cliApiToken))
}

function renderGuidePage(origin: string): string {
    const safeOrigin = escapeHtml(origin)
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Team HAPI 使用指南</title>
<style>
:root { color-scheme: light dark; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
body { margin: 0; background: #f5f6f8; color: #17181b; }
main { max-width: 720px; margin: 0 auto; padding: 32px 20px 56px; }
section { background: white; border-radius: 18px; padding: 24px; margin: 16px 0; box-shadow: 0 5px 24px #0000000d; }
h1 { margin: 0 0 8px; font-size: 28px; }
h2 { font-size: 18px; margin: 0 0 12px; }
p, li { line-height: 1.65; }
code, pre { font-family: ui-monospace,SFMono-Regular,Menlo,monospace; }
pre { overflow: auto; background: #f0f1f4; border-radius: 10px; padding: 14px; }
.muted { color: #6d717b; }
.success { color: #087443; }
.error { color: #b42318; }
.token { word-break: break-all; user-select: all; background: #eef8f1; border: 1px solid #b8e1c4; border-radius: 10px; padding: 12px; }
a.button { display: inline-block; background: #1769e0; color: white; padding: 10px 15px; border-radius: 9px; text-decoration: none; }
@media (prefers-color-scheme: dark) { body { background: #111315; color: #f1f2f4; } section { background: #1b1e22; } pre { background: #252930; } .muted { color: #a5abb5; } .token { background: #15271b; border-color: #285a39; } }
</style>
</head>
<body>
<main>
<section>
<h1>Team HAPI</h1>
<p class="muted">团队共享 Hub。每个人只能看到自己的会话和机器。</p>
<div id="claim-status" class="muted">如果你是通过邀请链接打开的，页面会自动领取账号。</div>
<div id="claim-result"></div>
</section>
<section>
<h2>第一次使用</h2>
<ol>
<li>打开管理员发给你的邀请链接。链接只能使用一次，过期后请联系管理员重新生成。</li>
<li>页面显示 Token 后，请复制保存到自己的密码管理器；管理员看不到你的 Token。</li>
<li>点击“打开 Team HAPI”进入网页，或者在电脑终端配置 CLI。</li>
</ol>
<pre>npm install -g @twsxtd/hapi
export HAPI_API_URL=${safeOrigin}
hapi auth login
# 粘贴页面上显示的个人 Token
hapi codex</pre>
</section>
<section>
<h2>Codex 初始化提示词</h2>
<p>第一次启动 Codex 后，可以把下面这段作为第一条消息发送，让它了解团队环境和协作边界：</p>
<pre>你现在是我在 Team HAPI 上使用的 Codex 编程助手。请先完成初始化：
1. 确认当前工作目录，读取项目中的 AGENTS.md 和 README.md（如果存在），并检查 git status；不要读取其他项目或其他 Namespace。
2. 默认使用中文回复；开始修改前先说明任务理解、计划、涉及文件和验证方式。
3. 只在当前项目目录内工作；不要访问或输出 HAPI Token、Namespace 凭证或其他成员的数据。
4. 修改保持最小范围，优先修复根因；未经我确认不要删除文件、重置或覆盖他人改动、提交或推送。
5. 完成后运行合适的测试或类型检查，并总结改动、验证结果和剩余风险。
如果工作区已有改动，先说明并避开无关文件。</pre>
</section>
<section>
<h2>Token 丢失怎么办</h2>
<p>联系管理员，让管理员按你的 Namespace 生成恢复链接。恢复链接会签发一个新的 Token，但不会删除你之前的会话。</p>
<p class="muted">不要把 Token 发到群聊、截图或提交到代码仓库。</p>
</section>
</main>
<script>
(() => {
  const status = document.getElementById('claim-status');
  const result = document.getElementById('claim-result');
  const params = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : '');
  const invite = params.get('invite');
  if (!invite) return;
  status.textContent = '正在领取你的 Team HAPI 账号…';
  fetch('/api/team/onboarding/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ invite })
  }).then(async response => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.accessToken) throw new Error(body.error || '邀请链接无效或已使用');
    localStorage.setItem('hapi_access_token::' + location.origin, body.accessToken);
    status.textContent = '账号已创建，请保存下面的 Token。';
    result.innerHTML = '<p class="success">Namespace：<strong>' + body.namespace + '</strong></p>'
      + '<p class="token">' + body.accessToken + '</p>'
      + '<p><a class="button" href="/">打开 Team HAPI</a></p>';
    history.replaceState(null, '', location.pathname);
  }).catch(error => {
    status.className = 'error';
    status.textContent = error instanceof Error ? error.message : '邀请链接无效或已使用';
  });
})();
</script>
</body>
</html>`
}

export function createTeamOnboardingRoutes(store: Store): Hono {
    const app = new Hono()

    app.get('/team-guide', (c) => {
        return c.html(renderGuidePage(publicOrigin(c.req.raw)))
    })

    app.post('/api/team/admin/invite', async (c) => {
        if (!isAdminRequest(c.req.raw)) return c.json({ error: 'Admin authorization required' }, 401)
        const body = await c.req.json().catch(() => null)
        const parsed = inviteBodySchema.safeParse(body)
        if (!parsed.success) return c.json({ error: 'Invalid invite request' }, 400)

        try {
            const created = store.accessTokens.createInvite({
                kind: 'enroll',
                namespace: parsed.data.namespace,
                expiresInHours: parsed.data.expiresInHours
            })
            return c.json({
                kind: 'enroll',
                namespace: created.namespace,
                expiresAt: created.expiresAt,
                inviteUrl: guideUrl(c.req.raw, created.invite)
            })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to create invite' }, 400)
        }
    })

    app.post('/api/team/admin/recovery', async (c) => {
        if (!isAdminRequest(c.req.raw)) return c.json({ error: 'Admin authorization required' }, 401)
        const body = await c.req.json().catch(() => null)
        const parsed = inviteBodySchema.extend({ namespace: z.string() }).safeParse(body)
        if (!parsed.success) return c.json({ error: 'Namespace is required' }, 400)

        try {
            const created = store.accessTokens.createInvite({
                kind: 'recovery',
                namespace: parsed.data.namespace,
                expiresInHours: parsed.data.expiresInHours
            })
            return c.json({
                kind: 'recovery',
                namespace: created.namespace,
                expiresAt: created.expiresAt,
                inviteUrl: guideUrl(c.req.raw, created.invite)
            })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to create recovery link' }, 400)
        }
    })

    app.post('/api/team/onboarding/claim', async (c) => {
        const body = await c.req.json().catch(() => null)
        const parsed = claimBodySchema.safeParse(body)
        if (!parsed.success) return c.json({ error: 'Invalid invite' }, 400)
        const claimed = store.accessTokens.claimInvite(parsed.data.invite)
        if (!claimed) return c.json({ error: 'Invite is invalid, expired, or already used' }, 410)
        return c.json({
            success: true,
            namespace: claimed.namespace,
            accessToken: claimed.accessToken
        })
    })

    return app
}
