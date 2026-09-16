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

如果电脑还没有安装 HAPI，可以把下面整段复制给 Codex。它会帮忙安装、配置并检查连接；个人 Token 只在本机终端交互输入，不要粘贴到 Codex 聊天里。

```text
请帮我把这台电脑接入 Team HAPI，并完成本地 HAPI 初始化。

Team HAPI 地址：https://team-hapi.aichickenfarm.cn

请按以下步骤操作：
1. 检查 Node.js 和 npm 是否可用。如果缺少，请先告诉我安装 Node.js LTS；不要使用来源不明的安装脚本。
2. 执行 npm install -g @twsxtd/hapi；如果已经安装 hapi，检查并更新到最新稳定版。
3. 把 HAPI_API_URL 持久化为 https://team-hapi.aichickenfarm.cn：在 shell 配置文件（~/.zshrc 或 ~/.bashrc）中 export，或合并写入 ~/.hapi/settings.json 的 apiUrl 字段并保留已有字段。不要启动本地 Hub。
4. 运行 hapi auth login，让我在本机终端按提示粘贴管理员发给我的个人 Token。Token 不得出现在聊天内容、命令参数、脚本、日志或 git 文件中。
5. 如果当前终端不支持交互式输入，不要让我把 Token 粘贴到聊天里；请停止并告诉我在本机终端手动运行 hapi auth login。
6. 运行 hapi auth status 验证 HAPI_API_URL 正确且 CLI_API_TOKEN 显示 set；不要输出 Token 本身。
7. 完成后告诉我可以使用 hapi codex 开始工作。除非我明确要求，不要替我启动新的 Codex 会话。

整个过程中只操作当前用户的 HAPI 配置，不读取或修改其他用户、其他 Namespace 或无关项目。
```

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
