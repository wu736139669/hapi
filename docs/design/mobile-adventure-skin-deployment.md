# 森林冒险皮肤上线记录

日期：2026-10-16。用户在素材接入完成后明确要求合并主分支并部署。

- 部署主分支：`local/deploy-main`，与 `docs/local-deployment.md` 和本地 `hapi-deploy` 技能指定的源码分支一致。
- 功能提交：`eb540f80c8bdfe4f177a986a95045586a8b175f9`，`feat: add forest adventure mobile skin`。
- 功能分支快进合并到部署主分支，已推送 `origin/local/deploy-main`；原功能分支保留。全程在当前目录操作，未创建 worktree。
- 安装版本仍为 `0.30.7`；本次为该版本的本地功能更新，使用提交、签名及 runner 文件时间确认产物更新。
- 完整构建一次；使用仓库 `scripts/deploy-local.sh` 和 `scripts/deploy-remote.sh k2lab` 部署。

## 合并前检查

`bun typecheck`、`bun run build:single-exe`、8 项浏览器用例通过；9 个新单元用例包含在 Web 测试中并通过。安装包检查通过，保留 Codex 历史断点、消息确认及持久用量等原部署功能；CLI / Hub / shared / relay 源码与原基线无差异。

重跑 `bun run test`：CLI 2886 pass、7 fail、8 skip，另有既有 `bun:sqlite` 环境 suite 失败，串联停止。另行重跑 Web：3245 pass、35 fail。失败 ID 与前次独立基线验证逐项一致，新增失败为 0；未称全仓测试全绿。

仓库引用的 `~/.cursor/skills/pre-push-review/SKILL.md` 已缺失；本地技能目录和 HAPI 技能查找均未找到，未假称执行该技能。按 `AGENTS.md` 明列的 mechanical 检查及 `.github/prompts/codex-pr-review.md` 的需求、方案、Major 清单审查本次改动，无已知新增 Major 问题。未跳过 Git hooks。

## 安装与服务验收

| 检查 | mini / 小吴家 | k2lab |
| --- | --- | --- |
| 固定安装路径 | `/Users/wusumac/.hapi/bin/hapi` | `/Users/sudaxia/.hapi/bin/hapi` |
| CLI 版本 | 0.30.7，安装时连续冷启动三次通过 | 0.30.7，安装时连续冷启动三次通过 |
| 签名检查 | `codesign --verify --deep --strict` 通过 | 同左 |
| 签名标识 | `run.hapi.cli` / Team `X75CUV458P` | 同左 |
| CodeDirectory hash | `9be69d463b38c0051881e2e66962daaa959cc19b` | 同左 |
| 新 runner PID | 25675 | 17099 |
| 加载文件 | 新固定路径，启动 mtime 匹配安装文件 | 新固定路径，启动 mtime 匹配安装文件 |
| Hub 健康 | `/health` 返回 `status: ok` | 连接 mini 的 Hub，机器 active |
| Agent 可用性 | 原有 6 个保持可用 | 原有 6 个保持可用 |
| Codex 模型 API | `success: true`，7 个模型 | `success: true`，7 个模型 |

两台保持可用的 Agent：Claude、Codex、Cursor、DSH、Grok、OpenCode。部署前后由已认证 Hub API 实测；没有用版本号或健康端点代替功能探测。本机 runner 按部署脚本使用干净登录环境及本机覆盖文件刷新，远端通过原 launchd job 刷新。

## 实际线上页面

对已部署的 `http://127.0.0.1:3006`，使用独立 Chrome 浏览器上下文验证：

- 10 份场景 / 切片资源全部以 `image/webp` 返回，SHA-256 与发布源文件逐份一致。
- 实际 `/settings/display` 页面出现皮肤选择项；选择森林后立即生效，刷新后仍选中。
- 实际 `/sessions` 页面显示森林横幅；390×844 视口无整页横向溢出、无 page error。

用户入口：刷新 HAPI，打开 **设置 → 显示 → 界面皮肤 → 森林冒险**。选择保存在当前浏览器；每部手机或浏览器可独立选择。需要回退外观时选择“默认”。

未做实体手机、Safari PWA 或 Telegram 宿主验收；上述线上验证来自桌面 Chrome 的手机视口。

## 回滚资料

安装脚本已保存旧二进制备份：

- mini：`/Users/wusumac/.hapi/bin/backups/hapi.20261016-221052-forest-adventure-eb540f80`
- k2lab：`/Users/sudaxia/.hapi/bin/backups/hapi.20261016-221141-forest-adventure-eb540f80`

回滚应将备份恢复到各自固定路径，再重启对应 Hub / runner 并验收，不直接执行备份目录中的文件。操作细节见 [本地部署文档](../local-deployment.md)。本次无需回滚。

[结构化上线证据](forest-adventure-art/deployment-report.json)；[开发验收记录](mobile-adventure-skin-evidence.md)；[素材与切片](mobile-adventure-skin-assets.md)。
