# 森林皮肤图片增强

2026-10-16；分支 `feat/mobile-adventure-rich-art`，基于已上线的 `c4ac102d`。用户反馈首版图片元素太少，要求增加图片。延续当前工作目录、单独分支开发，不创建 worktree；验证后沿用用户已授权的合并部署流程。

## 这次改变

首版图片集中在顶部横幅和小图标，聊天区大面积纯色。增强版同时增加画面面积、素材种类和出现位置：

- 列表底部增加约 210px 高的森林小景：大树、蘑菇屋、传送门、栅栏与花草。小景放在不透明的条目和项目标题后方，不占列表布局高度，不遮挡文字与点击。
- 聊天头部增加 56px 场景带，复用已有森林背景并叠加新透明道具；实际聊天容器低于 600px 时收起。通过容器查询响应软键盘或分栏分配的高度，不仅依赖浏览器窗口高度。
- 独立生成木纹窗框，用 CSS `border-image` 的 24% 切片绘制横幅、会话条目、助手消息和输入框；中心为真实透明，不将整张图片拉伸盖在正文上。
- 放大列表、聊天头部和横幅向导；原图身份不变，按手机像素密度重新导出。地图和提灯从备用素材改为实际场景装饰。
- 紧凑侧栏保持原来的密度；默认皮肤不请求这些图片；森林皮肤下维持键盘焦点轮廓，所有场景均无点击和拖动行为。

没有新增游戏数值、虚构任务状态、轮询或逐帧动画。发送、中止、审批、提问、草稿和主题仍沿用原组件。

## 素材与复现

只新增两次 AI 生成：一张 2×2 场景道具表和一张独立透明木框。参考首版森林与道具表，保留明亮 Q 版、棕色描边、绿叶 / 蘑菇 / 木质材料的统一风格。两份原始 PNG 都是 1254×1254 RGBA；请求参数、提示词、来源与 SHA-256 保存在 `forest-adventure-rich-art/`。

四个环境切片：蘑菇屋 512px、提灯树 512px、传送门 320px、花园栅栏 384px。向导和花草更新为 256px，保持原始角色与轮廓。窗框输出 512px，中心 alpha 验证为 0；可作为伸缩边框复用。

运行时共 15 个 WebP、**397,976 bytes**。其中原场景 69,252，首批当前导出 99,636，新增环境道具 197,940，木框 31,148。前一轮低密度预览约 298KB；高密度导出后以当前约 398KB 为准。原始大图和独立 PNG 留在开发资料，不进入网页发布目录。

```bash
python3 web/scripts/art/slice-forest-sheet.py --manifest docs/design/forest-adventure-rich-art/manifest.json --dry-run
python3 web/scripts/art/slice-forest-sheet.py --manifest docs/design/forest-adventure-rich-art/manifest.json
python3 web/scripts/art/prepare-forest-frame.py
```

原图变化会被 SHA-256 检查拦下，需要重新审查切片边界。导出仅做透明噪点清理、完整轮廓切片、排版与缩放，没有额外生成请求。SW 原有 16 份按需缓存容量覆盖当前 15 份图片。

## 验证

- 全包 `bun typecheck`、fixture 类型检查通过；完整 `bun run build:single-exe` 通过，内嵌资源包含全部新图片。
- 9 项浏览器用例通过：原有发送 / 中止 / 审批 / 问题、主题、默认回退、透明度与尺寸检查；新增紧凑侧栏不加载装饰、实际聊天容器缩到 430px 后收起场景、输入框留在容器内且草稿保留。
- `bun run test:web`：3245 pass、35 fail，失败 ID 与既有基线逐项相同。`bun run test` 的 CLI 部分仍为原有 7 个失败及 `bun:sqlite` 环境 suite 问题；无新增失败。9 个皮肤单元用例通过。
- CLI / Hub / shared / relay 源码与增强前无差异；不改聊天管线或 golden fixtures。
- 按仓库 Major 清单审查图片装饰的作用范围、真实状态、可操作性、默认回退、缓存和短窗口；仓库引用的 pre-push-review 技能缺失，沿用此前明确记录的本地清单审查，未假称运行缺失技能。

已查看的实际组件截图（390×844 逻辑视口）：

- [列表浅色](screenshots/forest-rich-list-light.png)、[列表深色](screenshots/forest-rich-list-dark.png)
- [聊天浅色](screenshots/forest-rich-chat-light.png)、[聊天深色](screenshots/forest-rich-chat-dark.png)
- [空列表](screenshots/forest-rich-empty-light.png)

这是浏览器手机视口验证，实体手机 / Safari PWA / Telegram 宿主仍未实测。
