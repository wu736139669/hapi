# 马卡龙渐变皮肤

2026-10-16；用户要求新增一套马卡龙渐变色皮肤。分支 `feat/macaron-gradient-skin`，原目录开发，未使用 worktree。新增第三种 `macaron-gradient`，默认和森林冒险继续保留。

## 设计与实现

- 整页淡粉、浅紫、薄荷、奶油黄，静态 CSS 多重渐变绘制。无顶部横幅、无新增图片或下载依赖。
- 会话卡片使用奶白底色、细紫边与柔和阴影，标题和元信息分行。聊天正文、代码与审批保留清晰底色，输入框与主要按钮使用同系列配色。
- 深色为低亮度梅紫、青绿；OLED 使用黑色基底和更暗的渐变端点。默认浅色辅助文字对四个渐变端点的对比度最低 4.64:1。
- 覆盖列表、聊天、新建会话、设置和通用面板；紧凑列表保持原有信息布局。所有样式限定在该皮肤下。
- 三个预览在同一行；方向键循环、Home/End、单选焦点、跨标签页同步、存储受限回退均沿用现有机制。
- 接入现有配色解析器：显式颜色主题和自定义颜色优先于皮肤默认值。首屏 HTML 同步解析三种明暗状态，避免加载 React 时底色跳变。

## 验证

`bun typecheck`、独立 UI fixture 类型检查和单文件构建通过。15 项浏览器检查通过（原森林 9 项、新皮肤 6 项），覆盖三套皮肤切换、保存与跨页同步、320/360/390/430/1280 宽度、深色/OLED、键盘压缩、展开输入框和草稿保留、真实组件审批/发送/停止、首屏 HTML 初始化。马卡龙列表与聊天无 `/skins/` 图片请求。

完整 `bun run test` 在 CLI 已有 7 项失败及 `bun:sqlite` 环境套件错误处中止。独立 Web 为 3250 通过、35 失败，新增 5 个皮肤参数化用例通过。CLI/Web 失败 ID 已与先前基线逐项比对，无新增。未更改消息流水线、协议或原生客户端。

按仓库 Major 检查表审阅需求、方案和改动。引用的 `~/.cursor/skills/pre-push-review/` 技能此前已确认缺失，执行 AGENTS 规定的机械检查与本地逻辑审查。

## 画面

真实组件、合成会话、390×844 Chromium；未声称实机 Safari 测试：

- [列表](screenshots/macaron-list-light.png)、[密集会话](screenshots/macaron-list-dense.png)、[深色列表](screenshots/macaron-list-dark.png)。
- [聊天](screenshots/macaron-chat-light.png)、[深色聊天](screenshots/macaron-chat-dark.png)、[空列表](screenshots/macaron-empty-light.png)。
- [三套皮肤设置](screenshots/macaron-settings-light.png)。

## 上线

源码 `1bb12c86` 已合并并推送到 `local/deploy-main`，部署 mini（Hub + runner）与 k2lab（runner）。两台固定路径签名和新 runner 文件 mtime 验证通过，CDHash 一致；Hub health 正常。部署前后两台均有 6 个 Agent 可用、Codex 7 个模型。

正式 Hub 的 390×844 页面确认三选项、马卡龙选择持久化、首屏颜色、整页渐变、无森林装饰、零皮肤图片请求、无横向溢出和页面错误。刷新后在「设置 → 显示 → 界面皮肤」选择「马卡龙渐变」。见 [上线报告](macaron-gradient-deployment.json)。
