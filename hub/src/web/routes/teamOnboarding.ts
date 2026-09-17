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

function guideUrl(request: Request, invite: string, namespace: string): string {
    return `${publicOrigin(request)}/team-guide#invite=${encodeURIComponent(invite)}&ns=${encodeURIComponent(namespace)}`
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
a.button, button.button { display: inline-block; background: #1769e0; color: white; padding: 10px 15px; border-radius: 9px; border: none; text-decoration: none; font-size: 15px; font-family: inherit; cursor: pointer; }
button.button[disabled] { opacity: 0.6; cursor: default; }
.copy-row { display: flex; justify-content: flex-end; margin: 12px 0 6px; }
img.shot { display: block; max-width: 100%; height: auto; margin: 10px 0; border-radius: 10px; border: 1px solid #e2e4e9; }
@media (prefers-color-scheme: dark) { body { background: #111315; color: #f1f2f4; } section { background: #1b1e22; } pre { background: #252930; } .muted { color: #a5abb5; } .token { background: #15271b; border-color: #285a39; } img.shot { border-color: #2a2f36; } }
</style>
</head>
<body>
<main>
<section>
<h1>Team HAPI</h1>
<p class="muted">团队共享 Hub。每个人只能看到自己的会话和机器。</p>
<div id="claim-status" class="muted">如果你是通过邀请链接打开的，点「领取我的账号」即可。打开链接不会消耗邀请；已领取过的设备刷新本页仍会显示 Token。</div>
<div id="claim-result"></div>
</section>
<section>
<h2>让 Codex 自动初始化 HAPI</h2>
<p>点下面的「复制提示词」，粘贴到 Codex 对话框发送，让它执行就好（领取账号后 Token 会自动填入）。Codex 会帮你安装、配置并检查连接。</p>
<p class="copy-row"><button id="copy-prompt" class="button" type="button">复制提示词</button></p>
<pre id="codex-prompt">请帮我把这台电脑接入 Team HAPI，并完成本地 HAPI 初始化。

Team HAPI 地址：${safeOrigin}
我的个人 Token：【你的个人 Token】

请按以下步骤操作：
1. 检查 Node.js 和 npm 是否可用。如果缺少，请先告诉我安装 Node.js LTS；不要使用来源不明的安装脚本。
2. 运行 codex --version 检查 Codex CLI 版本，必须不低于 0.145.0（hapi codex 的硬性要求）。版本过低就先升级再继续：npm install -g @openai/codex；如果是 Homebrew 安装的用 brew upgrade codex。
3. 执行 npm install -g @twsxtd/hapi；如果已经安装 hapi，检查并更新到最新稳定版。
4. 在 ~/.hapi/settings.json 中合并写入两项配置（保留文件里已有的其他字段）：apiUrl = ${safeOrigin}，cliApiToken = 我的个人 Token。不要启动本地 Hub。
5. 运行 hapi auth status，确认 HAPI_API_URL 正确、CLI_API_TOKEN 显示 set；不要把 Token 输出到聊天或日志里。
6. 运行 hapi runner start 启动后台服务，然后运行 hapi runner status 确认正常。这样这台电脑会出现在 Team HAPI 的机器列表里，我就能从手机或网页直接新建会话。
7. 完成后告诉我：已经可以从 Team HAPI 新建会话了。除非我明确要求，不要替我启动新的 Codex 会话。

整个过程只操作当前用户的 HAPI 配置，不读取或修改其他用户、其他 Namespace 或无关项目。</pre>
<p class="muted">Token 会经过 Codex 聊天记录；不放心的话，可以之后让管理员生成恢复链接换一个新 Token。</p>
</section>
<section>
<h2>使用教程</h2>
<h3>界面语言</h3>
<p>进入「设置 → 通用 → 语言」，可切换 English / 简体中文。</p>
<img class="shot" src="/team-guide/settings-language.png" alt="设置 → 通用 → 语言">
<h3>手机上添加到桌面（推荐）</h3>
<p>iPhone：先用 Safari 打开本页，点底部「分享」按钮 → 「添加到主屏幕」→ 「添加」。页面顶部的 Install 提示里也有一键步骤引导。<br>Android：用 Chrome 打开，菜单里选「添加到主屏幕」。</p>
<img class="shot" src="/team-guide/ios-install-banner.jpg" alt="Safari 顶部 Install 提示">
<img class="shot" src="/team-guide/ios-install-steps.jpg" alt="添加到主屏幕步骤">
<p class="muted">加到桌面后会像 App 一样打开，随时查看和继续会话。</p>
<h3>让电脑在线</h3>
<p>会话跑在你自己的电脑上。初始化时 Codex 已经帮你启动了后台 runner，电脑会自动出现在机器列表里，之后即使手机关掉网页，也能随时新建会话。</p>
<p>如果列表里没有你的电脑（常见于电脑重启后），把这句话发给 Codex：「运行 hapi runner start」即可恢复。电脑需要保持开机联网，合盖休眠会暂时离线。</p>
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
<img class="shot" src="/team-guide/new-session.png" alt="创建会话页面">
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
  const storageKey = 'hapi_access_token::' + location.origin;
  let storedToken = null;
  try { storedToken = localStorage.getItem(storageKey); } catch {}
  const promptBlock = document.getElementById('codex-prompt');
  const fillPrompt = (token) => {
    if (promptBlock && token) {
      promptBlock.textContent = promptBlock.textContent.split('【你的个人 Token】').join(token);
    }
  };
  if (storedToken) fillPrompt(storedToken);
  const copyButton = document.getElementById('copy-prompt');
  if (copyButton && promptBlock) {
    copyButton.addEventListener('click', async () => {
      let copied = false;
      try {
        await navigator.clipboard.writeText(promptBlock.textContent);
        copied = true;
      } catch {}
      if (!copied) {
        const range = document.createRange();
        range.selectNodeContents(promptBlock);
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
        try { copied = document.execCommand('copy'); } catch {}
      }
      copyButton.textContent = copied ? '已复制 ✓' : '复制失败，请长按选择';
      setTimeout(() => { copyButton.textContent = '复制提示词'; }, 2000);
    });
  }
  const showSavedToken = (message) => {
    status.className = 'muted';
    status.textContent = message;
    result.innerHTML = '';
    const tokenLine = document.createElement('p');
    tokenLine.className = 'token';
    tokenLine.textContent = storedToken;
    const openLine = document.createElement('p');
    openLine.innerHTML = '<a class="button" href="/">打开 Team HAPI</a>';
    result.append(tokenLine, openLine);
  };
  const params = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : '');
  const invite = params.get('invite');
  const inviteNamespace = params.get('ns');
  const showClaimError = () => {
    status.className = 'error';
    result.innerHTML = '';
    const line = document.createElement('p');
    line.textContent = '这个链接已经用过或过期了（每条链接只能用一次）。';
    result.append(line);
    if (inviteNamespace) {
      const detail = document.createElement('p');
      detail.className = 'muted';
      detail.textContent = '它对应的账号是 ' + inviteNamespace + '。把这段发给管理员，请管理员为该账号生成恢复链接，或直接发一条新的邀请链接。';
      result.append(detail);
    }
  };
  if (!invite) {
    if (storedToken) showSavedToken('这台设备已经领取过账号，Token 如下（请保存好）：');
    return;
  }
  status.textContent = '欢迎加入 Team HAPI！打开链接不会消耗邀请，点下面的按钮领取你的账号。';
  const claimButton = document.createElement('button');
  claimButton.className = 'button';
  claimButton.textContent = '领取我的账号';
  claimButton.addEventListener('click', () => {
    claimButton.disabled = true;
    claimButton.textContent = '领取中…';
    fetch('/api/team/onboarding/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invite })
    }).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.accessToken) {
        const error = new Error(body.error || '邀请链接无效或已使用');
        error.status = response.status;
        throw error;
      }
      try { localStorage.setItem(storageKey, body.accessToken); } catch {}
      fillPrompt(body.accessToken);
      status.className = 'muted';
      status.textContent = '账号已创建，请保存下面的 Token（刷新本页仍可看到）。';
      result.innerHTML = '<p class="success">Namespace：<strong>' + body.namespace + '</strong></p>'
        + '<p class="token">' + body.accessToken + '</p>'
        + '<p><a class="button" href="/">打开 Team HAPI</a></p>';
      history.replaceState(null, '', location.pathname);
    }).catch(error => {
      if (storedToken) {
        showSavedToken('这个链接已经用过或过期了，但你在这台设备上已经领取过（Token 如下）：');
        return;
      }
      if (error && error.status === 410) {
        showClaimError();
        return;
      }
      status.className = 'error';
      status.textContent = '领取失败：网络异常，请重试；如果一直失败，请联系管理员。';
      claimButton.disabled = false;
      claimButton.textContent = '领取我的账号';
    });
  });
  result.append(claimButton);
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
                inviteUrl: guideUrl(c.req.raw, created.invite, created.namespace)
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
                inviteUrl: guideUrl(c.req.raw, created.invite, created.namespace)
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
