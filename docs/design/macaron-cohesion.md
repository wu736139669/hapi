# 马卡龙整页整体性调整

2026-10-17；分支 `fix/macaron-cohesive-surfaces`，原目录开发，未使用 worktree。用户反馈背景与各种框不够整体。原实现将较强渐变、接近白色的面板、逐层描边/阴影以及实色页头和输入区叠加，造成视觉断层。

六套配色共用同一套表面规则：

- 渐变色与当前背景混合，浅色/深色/OLED 分别采用 58% / 16% / 7% 强度；卡片、页头与面板以这一底色推导。
- 常态会话条目去掉可见描边和阴影，保留轻微同色填充。选中条目用侧边强调，键盘焦点仍可辨识。
- 分组标题取消独立白色条块；吸顶时以轻薄底色和局部模糊遮住下方滚动文字。
- 聊天正文取消整轮大外框，代码与审批继续有清晰的功能分组。工具背景、代码背景、分隔线从同一主题强调色推导，减少中性灰与彩色底的割裂。
- 页头、状态行、常态输入区共享整页背景；输入框留轻边界。展开编辑时使用不透明底色，避免内容叠加。
- 设置面板减轻边框和阴影；弹窗仍有独立实底。危险操作颜色、显式颜色主题、自定义表面/边框以及默认和森林皮肤维持原功能。

## 验证

`bun typecheck`、UI fixture 类型检查、单文件构建通过。17 项浏览器功能检查均验证通过：首次运行有 1 项在 Chromium 创建 context 阶段超时，应用代码尚未执行；其余 16 项通过，该项单独重跑通过。输入框常态透明、展开后不透明、关闭后恢复的边界已纳入原有草稿/键盘检查。

Web 单测 3261 通过、35 个原有失败；新增一项跨配色保留自定义表面与边框的检查通过。完整 `bun run test` 在 CLI 原有 7 个失败和 `bun:sqlite` 环境套件错误处中止。CLI/Web 失败 ID 与原基线逐项一致，无新增。未改消息流水线或协议，无需重生成原生协议 fixtures。

引用的 pre-push-review 技能此前已确认缺失；执行 AGENTS 机械检查及仓库 Major 清单本地审查。未发现本次引入的 Major 问题。

[列表/聊天前后对比](screenshots/macaron-cohesion/before-after.png)、[设置页](screenshots/macaron-cohesion/mint-settings.png)、[深色聊天](screenshots/macaron-cohesion/mint-chat-dark.png)、[OLED](screenshots/macaron-cohesion/blueberry-oled.png)。真实组件、合成数据、390×844 Chromium；未声称实机 Safari 测试。

## 上线

源码 `aa082c0f` 已合并并推送 `local/deploy-main`，部署 mini（Hub + runner）与 k2lab（runner）。两台签名相同、固定路径与新 runner mtime 验证通过，Hub health 正常；部署前后均为 6 个 Agent 可用、Codex 7 个模型。

正式 Hub 逐一验证了五种新增配色的选择、刷新保存、首屏颜色和渐变色值，并确认工具栏透明、列表常态无阴影/可见描边、无皮肤图片请求、无页面错误或横向溢出。刷新已有马卡龙页面即可应用。见 [上线报告](macaron-cohesion-deployment.json)。
