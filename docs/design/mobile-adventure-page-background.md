# 森林皮肤整页背景

用户实机截图指出顶部「冒险日志」横幅太大，列表剩余部分仍是平色。调整分支 `feat/forest-skin-page-background`，在原目录开发，未使用 worktree。

- 移除占 100px 的列表横幅和占 56px 的聊天装饰横条。
- 新增原创竖版森林：边缘树冠、远山、瀑布、传送门、蘑菇屋和小桥。生成工具为内置 image_gen；[完整提示词](forest-adventure-page-art/prompt.md)、[源图](forest-adventure-page-art/source.png)。
- `ForestScenery` 绝对定位填满列表或聊天面板，固定在滚动内容后方，不拦截点击、不参与高度分配。键盘压缩聊天面板时背景随面板缩放。
- 会话卡片保留 92% 的纸色，叠加全图浅色遮罩，文字区域保持柔和；深色/OLED 使用主题底色遮罩。默认皮肤、紧凑导航不加载整页图。
- 移除原场景带的 size containment 和低高度隐藏规则。审批、发送、停止、草稿和展开编辑器流程保持原行为。

新图导出 `web/public/skins/forest-adventure/forest-page.webp`，768×1661、166,252 bytes。总资源 16 份、564,228 bytes；SW 按需缓存上限 16，未增预加载。

## 验证

`bun typecheck` 和独立 UI fixture 类型检查通过；9 项浏览器检查通过。覆盖 320/360/390/430/1280 宽度、420px 短视口、实际面板压缩、草稿保留、审批与提问、发送与停止、默认零图片请求、紧凑导航、背景覆盖整个面板及列表滚动后位置不变。

[列表](screenshots/forest-page-list-light.png)、[密集会话](screenshots/forest-page-list-dense.png)、[深色列表](screenshots/forest-page-list-dark.png)、[聊天](screenshots/forest-page-chat-light.png)、[深色聊天](screenshots/forest-page-chat-dark.png)、[空列表](screenshots/forest-page-empty-light.png)。均为真实组件、合成会话数据，390×844 Chromium；未声称实机 Safari 验证。

完整 `bun run test` 在 CLI 原有 7 项失败及 Node Vitest 无法导入 `bun:sqlite` 的套件处中止；独立 Web 3245 通过、35 失败。已逐项比对原有失败 ID，均无新增，见 [验证报告](forest-adventure-page-art/verification.json)。未改 CLI、Hub、shared、relay 或消息流水线。

仓库引用的 `~/.cursor/skills/pre-push-review/` 在前次搜索后仍不可用；执行了 AGENTS 指定的机械检查，并按 `.github/prompts/codex-pr-review.md` 本地审阅需求、方案与本次差异，无新增 Major 问题。

## 上线

源码 `08bb829e` 已快进合并并推送 `local/deploy-main`，构建一次，部署到 mini（Hub + runner）及 k2lab（runner）。固定路径签名验证、反复冷启动、Hub health、runner 新文件 mtime 验证通过；两台 CDHash 一致（`e8d106d5101be1e0b9740eb98d96ce6da9b9f62a`）。两台部署前后均有 6 个 Agent 可用、Codex 7 个模型。

正式 Hub 手机页面验证了选择持久化、移除横幅、背景覆盖整个面板、图片源文件哈希一致、默认皮肤零图片请求、无横向溢出和页面错误。独立冷浏览器关闭 HTTP 缓存后，16 份素材均由 Service Worker 离线返回。[上线报告](forest-adventure-page-art/deployment-report.json)、[离线报告](forest-adventure-page-art/offline-report.json)。
