# 森林冒险皮肤验收记录

日期：2026-10-16。分支：`feat/mobile-adventure-skin`；基线：`a8feb4feafea0b5f36a770ad2e75e195a1b8d7e0`。

已由本地 `goal-instruction-writer` 技能生成指令，创建 native Goal 并执行。生产实现、素材和本次验证完成；全仓仍有已确认的基线失败，**不能称为全仓测试全绿**。未提交、部署、推送或合并。

## Goal anchor

手机 Web / PWA 可切换森林冒险皮肤；常用页面统一、状态真实、主要交互正常；能完整回退默认。范围限定前端呈现及必要验证；当前目录指定分支开发，不使用 worktree。

## 验收矩阵

| 条件 | 结果与证据 |
| --- | --- |
| C1 偏好 | 皮肤预览、同页即时切换、刷新、跨标签更新、默认回退已测；非法 / 禁止存储由单元覆盖；不改已有配色偏好 |
| C2 视觉 | 原创横版森林、叶帽角色、两行任务条目、聊天 / 工具 / 输入框 / 设置窗框已接入生产组件；新会话、文件 / 终端头部及共享弹层继承皮肤；截图已查看 |
| C3 状态 | 全量 Session 和 Summary 共用推导；工作与请求并存遵循已有优先级；审批、提问、后台、空闲和断开有用例；不虚构成功 / 失败 |
| C4 主题 | 原有预设和自定义色优先级保留；light / dark / oled、恢复默认和首屏背景已测；接入既有系统 / Telegram 更新链 |
| C5 交互 | 真实 SessionChat 的发送、中止、审批允许 / 拒绝和问题选项提交通过浏览器验证；展开 / 收起保留草稿；文件、新会话、终端业务逻辑未改，未连接真实 runner 执行 |
| C6 布局 | 320 / 360 / 390 / 430 / 1280px 无整页横向溢出；360×420 短视口与展开输入可用；保留 920px 分栏；这是浏览器模拟 |
| C7 无障碍 / 性能 | radio 箭头 / Home / End、焦点、减少动态效果已覆盖；仅动画当前聊天角色，列表角色静态、隐藏页暂停；默认列表不请求场景；生产构建的按需素材缓存及离线读取通过 |
| C8 检查 | 类型、构建、9 个新增单元和 8 项浏览器用例通过；全量测试及基线对照已执行，Web 零新增失败；全仓绿灯条件不成立，未掩盖失败 |
| C9 证据 | 本记录、测试摘要、素材清单、8 张实际截图与素材审图；已展示列表、深色聊天、设置及空列表；未把模拟或作者判断称作真机 / 用户验收 |
| C10 范围 | 仅 Web 呈现、偏好、素材缓存及必要测试 / 文档；CLI / Hub / shared / relay 和依赖文件无差异；不改聊天管线及 golden fixtures；无 worktree、部署或服务重启 |

## 检查结果

| 命令 / 检查 | 结果 |
| --- | --- |
| `bun typecheck` | 通过：CLI、Web、Hub、Relay |
| `bun run --cwd web typecheck --project e2e-fixtures/tsconfig.adventure.json` | 通过：新增生产组件 fixture 及其依赖 |
| `bun run build:web` | 通过：主应用、PWA worker 及 Studio；既有 KaTeX 路径、Browserslist、chunk 大小提示仍在 |
| 新增 `useAppearanceSkin`、`appearanceSkin.integration`、`sessionCompanionState` Vitest | 9 / 9 通过 |
| `PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_WEB_PORT=5187 bunx playwright test -c playwright.adventure.config.ts` | 8 / 8 通过；包含新增透明素材解码、alpha、备用素材不请求和空态操作 |
| `bun run test` | 未全绿：CLI 2886 pass、7 fail、8 skip；另有 `usageScan.test.ts` 无法在 Node/Vitest 导入 `bun:sqlite` 的 suite 失败；串联退出后另行跑其余包 |
| `bun run test:web` | 当前 3245 pass、35 fail、320 文件；基线 3236 pass、相同 35 fail、317 文件。新增 9 个用例通过；失败 ID 集合完全相同，新增失败为 0 |
| 基线 CLI 对应 5 文件 | 118 pass、同样 7 fail，复现 DSH 参数、OpenCode slash commands / model RPC 和 ACP 超时问题 |
| `bun run test:hub` | 1453 pass、2 fail、3 skip；失败在未修改的 OpenCode 会话清理测试 |
| `bun run test:shared` | 326 pass、2 fail；失败在未修改的 DSH capability / agent config 描述测试 |
| `bun run test:relay` | 118 pass、0 fail |
| `git diff --check` | 通过 |
| `git diff --exit-code a8feb4fe -- cli hub shared relay` | 通过，无后端 / 协议改动 |

基线通过 `git archive a8feb4fe` 导出测试快照、复用已安装依赖执行，不是 Git worktree，也不包含本次皮肤代码。第一次快照因缺根 tsconfig 无测试运行，该次不计作对照；补齐后 Web 重测复现相同 35 个失败。CLI 快照补齐未改的 Hub 后复现上述 7 个失败。失败 ID 与计数见 `mobile-adventure-skin-test-summary.json`。

Web 原有失败涉及文件操作文案、未读、导出、App Badge、输入提示、session mention、Agy 模型和新会话偏好。没有为追求全绿扩展本次业务范围。

## 浏览器覆盖

1. 设置选择 → 键盘切换 → 刷新 → 第二标签回退默认并同步第一标签。
2. 实际列表打开聊天 → Allow → 发送 → 工作角色 → Abort → 空闲角色；检查真实 API 路径与 POST。
3. Deny 保留拒绝路径及独立请求 ID。
4. 手机 / 桌面 / 短视口、输入展开保留草稿、dark / oled。
5. reduced-motion 不动画；默认列表不下载场景。
6. 禁用 SW、阻止 React main，核对生产 HTML 首屏 skin、dark、自定义背景和 theme-color。
7. 实际 AskUserQuestion 选项与 Submit 使用问题自身请求 ID。
8. 实际图片解码并读取透明四角；不下载素材表 / 备用图片；320px 空列表操作可进入真实聊天组件。

生产构建另以独立 5188 端口预览：默认素材缓存为 0；按需请求场景及九个切片后缓存 10 份。关闭 Chrome、保留测试 profile、断网重新启动、禁用 HTTP 缓存；10 份图片全部由 SW 返回并正常解码，见 `forest-adventure-art/offline-report.json`。初次验证因同一页面复用已解码图片、没有发起新的请求，未用该次结果证明 SW；重启浏览器后完成上述检查。只验证静态素材离线，不代表离线执行 agent 命令。

## 视觉与可读性

用户指出第一张素材不够冒险岛，已替换为明亮 Q 版横版地图；首稿未进入仓库。首次页面截图发现角色挤短标题，已将非紧凑条目分为标题、元信息两行；默认和紧凑布局不变。后按用户的大图切片要求，生成一张 3×3 静态透明素材表，校准边界后切出九个元素；七个已接入，地图 / 提灯备用。临时 SVG 向导已替换为同风格 AI 角色；文本、状态及按钮都是实时组件。来源、提示及脚本见 `mobile-adventure-skin-assets.md`。

场景 1024×342，69,252 bytes；九个透明 WebP 共 84,952 bytes，全部网页素材合计 154,204 bytes。源码大图和 PNG 切片放开发资料目录，不随网页构建发布。默认页不请求，设置页明确预览时加载。默认森林配色的计算对比度如下；自定义色继续尊重用户选择。

| 外观 | 正文 / 背景 | 次要文字 / 背景 | 主按钮文字 / 背景 |
| --- | --- | --- | --- |
| Light | 10.32:1 | 4.65:1 | 5.51:1 |
| Dark | 13.63:1 | 7.55:1 | 10.82:1 |
| OLED | 17.42:1 | 9.64:1 | 10.82:1 |

已查看的运行截图（390×844）：

- `screenshots/forest-list-light.png`
- `screenshots/forest-list-dark.png`
- `screenshots/forest-chat-light.png`
- `screenshots/forest-chat-dark.png`
- `screenshots/forest-settings-light.png`
- `screenshots/default-list-light.png`
- `screenshots/forest-empty-light.png`
- `screenshots/forest-empty-dark.png`

素材补齐后重跑：`bun typecheck`、fixture 类型检查、9 个相关单元、8 项浏览器用例及 `bun run build:web` 均通过。先前全仓基线对照记录保留；本次未重复运行所有无关包。

## 本地复现

仓库根运行 `bun run --cwd web dev -- --host 127.0.0.1 --port 5187 --strictPort`，再在该电脑打开：

`http://127.0.0.1:5187/e2e-fixtures/adventure-skin-fixture.html?skin=forest-adventure&lang=zh-CN`

可加 `&view=chat`、`&view=settings`、`&appearance=dark`；`skin=default` 看默认对照。fixture 用生产组件、合成会话和模拟传输，不读真实会话、不操作真实 runner。本机 localhost 不是手机可访问的公网链接。

## 限制与边界

- 未做实体 iPhone / Android、Safari PWA、Telegram 宿主或真实软键盘验证；已测桌面 Chrome 的视口、输入、素材缓存和减少动态效果。
- 用户的美术修正已应用；没有最终用户接受反馈，不能将作者检查当作用户确认。
- 全仓基线失败如实保留，未扩展 DSH / OpenCode / 未读等业务修复。
- 未提交、推送、合并、部署或重启当前 Hub / Runner；现用已部署 HAPI 尚未更新。

## 工作单元与对齐

| 阶段 | 目标、变化及证据 | 对齐 |
| --- | --- | --- |
| 偏好与主题 | C1/C4；有限偏好接入既有主题链、回退及覆盖顺序；6 个新增用例和既有主题用例通过 | ON_TARGET |
| 美术与页面 | C2；根据用户修正替换场景，生产组件接入并通过截图修正标题密度 | ON_TARGET |
| 状态与交互 | C3/C5；全量 / Summary 同源，3 个状态用例；审批、问题、发送、中止及展开输入浏览器验证 | ON_TARGET |
| 边界与性能 | C6/C7；尺寸、模拟键盘视口、主题、键盘 radio、减少动态效果、对比度、素材离线缓存 | ON_TARGET |
| 验证与审查 | C8/C10；类型、构建、8 项 E2E；完整测试及快照对照，Web 零新增失败；无范围外业务修改 | ON_TARGET |
| 交付 | C9；本记录、素材、测试摘要及截图；剩余限制明确、未部署 | ON_TARGET |
