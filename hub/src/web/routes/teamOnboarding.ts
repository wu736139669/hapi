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
h3 { font-size: 15px; margin: 20px 0 8px; }
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
<h2>让 Codex 自动初始化 HAPI</h2>
<p>如果电脑还没有安装 HAPI，把下面整段复制给 Codex（领取账号后 Token 会自动填入）。它会帮你安装、配置并检查连接。</p>
<pre id="codex-prompt">请帮我把这台电脑接入 Team HAPI，并完成本地 HAPI 初始化。

Team HAPI 地址：${safeOrigin}
我的个人 Token：【你的个人 Token】

请按以下步骤操作：
1. 检查 Node.js 和 npm 是否可用。如果缺少，请先告诉我安装 Node.js LTS；不要使用来源不明的安装脚本。
2. 执行 npm install -g @twsxtd/hapi；如果已经安装 hapi，检查并更新到最新稳定版。
3. 在 ~/.hapi/settings.json 中合并写入两项配置（保留文件里已有的其他字段）：apiUrl = ${safeOrigin}，cliApiToken = 我的个人 Token。不要启动本地 Hub。
4. 运行 hapi auth status，确认 HAPI_API_URL 正确、CLI_API_TOKEN 显示 set；不要把 Token 输出到聊天或日志里。
5. 完成后告诉我可以用 hapi codex 开始工作了。除非我明确要求，不要替我启动新的 Codex 会话。

整个过程只操作当前用户的 HAPI 配置，不读取或修改其他用户、其他 Namespace 或无关项目。</pre>
<p class="muted">Token 会经过 Codex 聊天记录；不放心的话，可以之后让管理员生成恢复链接换一个新 Token。</p>
</section>
<section>
<h2>使用教程</h2>
<h3>界面语言</h3>
<p>进入「设置 → 通用 → 语言」，可切换 English / 简体中文。</p>
<h3>手机上添加到桌面（推荐）</h3>
<p>iPhone：先用 Safari 打开本页，点底部「分享」按钮 → 「添加到主屏幕」→ 「添加」。页面顶部的 Install 提示里也有一键步骤引导。<br>Android：用 Chrome 打开，菜单里选「添加到主屏幕」。</p>
<p class="muted">加到桌面后会像 App 一样打开，随时查看和继续会话。</p>
<h3>让电脑在线</h3>
<p>会话跑在你自己的电脑上。先在电脑终端运行 <code>hapi codex</code>（或 <code>hapi claude</code>）并保持开启，Team HAPI 里就会出现你的机器；想让电脑一直在线，可以运行 <code>hapi runner start</code>。</p>
<h3>新建会话</h3>
<p>点「新建会话」，填好下面几项，再点「创建」：</p>
<ol>
<li><b>机器</b>：选择你自己的电脑。</li>
<li><b>目录</b>：填电脑上项目文件夹的路径（例如 /Users/你的用户名/projects/demo），或点「浏览」选择、点「最近路径」快速填入。Agent 就在这个目录里干活。</li>
<li><b>会话类型</b>：保持「简单」即可（直接使用选定的目录）；「工作树」「团队」是进阶用法。</li>
<li><b>代理</b>：选 Codex（或电脑上已装好的其他 Agent）。</li>
<li><b>模型 / 推理强度</b>：默认即可，推理强度可选 High。</li>
<li><b>权限模式</b>：建议选 Yolo，Agent 干活不再逐条等待审批。</li>
</ol>
<h3>导入电脑上的 Codex 历史会话</h3>
<p>在「创建会话」页面找到「导入 Codex 历史」，点「选择…」挑一个本机已有的 Codex 会话，再选好模型 / 推理强度，点「创建」时就会导入这段历史，可以接着聊。</p>
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
    const promptBlock = document.getElementById('codex-prompt');
    if (promptBlock) {
      promptBlock.textContent = promptBlock.textContent.split('【你的个人 Token】').join(body.accessToken);
    }
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
