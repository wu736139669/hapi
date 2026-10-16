# 马卡龙上下安全区色差修复

后续调整：[列表高度与文字对齐](macaron-list-density.md)。

2026-10-17；分支 `fix/macaron-safe-area-background`，在原目录开发，未使用 worktree。

用户的 iPhone 截图显示，顶部状态栏与列表渐变之间存在浅色横条，底部也有同类色差。列表的顶部安全区 padding 位于绘制渐变的组件外层；外层、body 和文档画布仍保留纯色背景。仅调整列表工具栏无法覆盖这些区域。

六套马卡龙皮肤改用文档画布上的同一层渐变；body、会话左右栏及列表/聊天/新建/设置页面透明，避免在安全区边缘重新开始渐变。渐变高度采用 `100dvh`，不随输入法导致的内容区缩短重新缩放。展开编辑器继续使用不透明覆盖层。HTML 冷启动同步设置已解析的背景变量，继续尊重显式配色和自定义背景；默认和森林皮肤不应用此画布规则。

18 项浏览器回归全部通过。新增检查模拟顶部 59px、底部 34px 留白，在列表、聊天、设置、深色和 OLED 页面检查背景连续；原有审批、发送、终止、草稿、窄屏与配色持久化检查通过。旧绘制方式复现的上下边界最大 RGB 通道跳变为 5 / 20，新方式为 0 / 1。[模拟对比图](screenshots/macaron-safe-area/comparison.png)来自 Chromium 真实组件和合成数据，并非实机 Safari 验收。

`bun typecheck`、UI fixture 类型检查及单文件构建通过。Web 单测 3261 通过、35 个原有失败；完整测试在 CLI 的 7 个原有失败和 `bun:sqlite` 环境错误处中止。失败 ID 与既有基线逐项一致。引用的 pre-push-review 技能此前确认缺失，采用 AGENTS 机械检查及仓库 Major 清单本地审查；未发现本次引入的 Major 问题。未改消息流水线或协议，无需重生成原生 fixtures。

源码 `f7fde1b9` 已合并并推送 `local/deploy-main`，部署 mini（Hub + runner）与 k2lab（runner）。两台固定路径签名一致，新 runner mtime 与文件相符，Hub health 正常；部署前后均为 6 个 Agent 可用、Codex 7 个模型。正式 Hub 的列表外层、画布及配色刷新验证通过，上下模拟边界通道跳变为 0 / 1。见 [部署报告](macaron-safe-area-deployment.json)。
