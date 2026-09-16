# Team HAPI 使用指南

Team HAPI 是团队共用的 Hub。每位成员使用独立的 Namespace 和 Token，只能看到自己 Namespace 下的会话、机器和文件。

## 成员第一次使用

1. 打开管理员发来的一次性邀请链接。
2. 页面自动创建账号，显示你的 Namespace 和个人 Token。
3. 立即把 Token 保存到密码管理器；管理员不会看到 Token，链接也只能领取一次。
4. 点击页面上的 **打开 Team HAPI**，即可使用网页端。

如需在终端使用：

```bash
npm install -g @twsxtd/hapi
export HAPI_API_URL=https://team-hapi.aichickenfarm.cn
hapi auth login
# 粘贴邀请页显示的个人 Token
hapi codex
```

也可以在 `hapi auth login` 后使用 `hapi claude`、`hapi gemini` 等本机已安装的 Agent。

## 让 Codex 自动初始化 HAPI

如果电脑还没有安装 HAPI，把下面整段复制给 Codex，并把【你的个人 Token】换成邀请页显示的个人 Token（在邀请页直接复制会自动填入）。它会帮你安装、配置并检查连接。

```text
请帮我把这台电脑接入 Team HAPI，并完成本地 HAPI 初始化。

Team HAPI 地址：https://team-hapi.aichickenfarm.cn
我的个人 Token：【你的个人 Token】

请按以下步骤操作：
1. 检查 Node.js 和 npm 是否可用。如果缺少，请先告诉我安装 Node.js LTS；不要使用来源不明的安装脚本。
2. 执行 npm install -g @twsxtd/hapi；如果已经安装 hapi，检查并更新到最新稳定版。
3. 在 ~/.hapi/settings.json 中合并写入两项配置（保留文件里已有的其他字段）：apiUrl = https://team-hapi.aichickenfarm.cn，cliApiToken = 我的个人 Token。不要启动本地 Hub。
4. 运行 hapi auth status，确认 HAPI_API_URL 正确、CLI_API_TOKEN 显示 set；不要把 Token 输出到聊天或日志里。
5. 完成后告诉我可以用 hapi codex 开始工作了。除非我明确要求，不要替我启动新的 Codex 会话。

整个过程只操作当前用户的 HAPI 配置，不读取或修改其他用户、其他 Namespace 或无关项目。
```

Token 会经过 Codex 聊天记录；不放心的话，可以之后让管理员生成恢复链接换一个新 Token。

## 使用教程

### 界面语言

进入「设置 → 通用 → 语言」，可切换 English / 简体中文。

### 手机上添加到桌面（推荐）

- iPhone：先用 Safari 打开本页，点底部「分享」按钮 → 「添加到主屏幕」→ 「添加」。页面顶部的 Install 提示里也有一键步骤引导。
- Android：用 Chrome 打开，菜单里选「添加到主屏幕」。

加到桌面后会像 App 一样打开，随时查看和继续会话。

### 让电脑在线

会话跑在你自己的电脑上。先在电脑终端运行 `hapi codex`（或 `hapi claude`）并保持开启，Team HAPI 里就会出现你的机器；想让电脑一直在线，可以运行 `hapi runner start`。

### 新建会话

点「新建会话」，填好下面几项，再点「创建」：

1. **机器**：选择你自己的电脑。
2. **目录**：填电脑上项目文件夹的路径（例如 `/Users/你的用户名/projects/demo`），或点「浏览」选择、点「最近路径」快速填入。Agent 就在这个目录里干活。
3. **会话类型**：保持「简单」即可（直接使用选定的目录）；「工作树」「团队」是进阶用法。
4. **代理**：选 Codex（或电脑上已装好的其他 Agent）。
5. **模型 / 推理强度**：默认即可，推理强度可选 High。
6. **权限模式**：建议选 Yolo，Agent 干活不再逐条等待审批。

### 导入电脑上的 Codex 历史会话

在「创建会话」页面找到「导入 Codex 历史」，点「选择…」挑一个本机已有的 Codex 会话，再选好模型 / 推理强度，点「创建」时就会导入这段历史，可以接着聊。

## Token 丢失

联系管理员，提供自己的 Namespace。管理员生成恢复链接后，打开链接即可获得新 Token；原有会话和机器不会删除，旧 Token 会失效。

## 管理员生成邀请链接

管理员使用 Hub 的原始 `CLI_API_TOKEN` 调用管理接口。原始 Token 只应保存在管理员机器或密码管理器中，不要发给团队成员。

创建新成员邀请（Namespace 可省略，省略时自动生成）：

```bash
curl -fsS -X POST https://team-hapi.aichickenfarm.cn/api/team/admin/invite \
  -H "Authorization: Bearer $CLI_API_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"expiresInHours":24}'
```

成员恢复邀请：

```bash
curl -fsS -X POST https://team-hapi.aichickenfarm.cn/api/team/admin/recovery \
  -H "Authorization: Bearer $CLI_API_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"namespace":"member-name","expiresInHours":24}'
```

响应里的 `inviteUrl` 就是要发给成员的一次性链接。邀请默认 24 小时有效，最长 7 天；链接本身包含秘密信息，请通过私聊发送。

## 安全边界

- 成员 Token 只对应一个 Namespace，不能通过修改 Token 后缀访问其他 Namespace。
- 成员之间互相看不到会话、机器和文件。
- 管理员可以创建邀请和恢复链接，但不会从数据库中读取成员 Token。
- 不要把 Token 放入群聊、截图、代码仓库或工单。
