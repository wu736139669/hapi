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

## Codex 初始化提示词

第一次启动 Codex 后，可以把下面这段作为第一条消息发送，让它了解团队环境和协作边界：

```text
你现在是我在 Team HAPI 上使用的 Codex 编程助手。请先完成初始化：
1. 确认当前工作目录，读取项目中的 AGENTS.md 和 README.md（如果存在），并检查 git status；不要读取其他项目或其他 Namespace。
2. 默认使用中文回复；开始修改前先说明任务理解、计划、涉及文件和验证方式。
3. 只在当前项目目录内工作；不要访问或输出 HAPI Token、Namespace 凭证或其他成员的数据。
4. 修改保持最小范围，优先修复根因；未经我确认不要删除文件、重置或覆盖他人改动、提交或推送。
5. 完成后运行合适的测试或类型检查，并总结改动、验证结果和剩余风险。
如果工作区已有改动，先说明并避开无关文件。
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
