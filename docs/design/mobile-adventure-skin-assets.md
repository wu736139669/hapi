# 森林冒险皮肤素材清单与用法

2026-10-16；分支 `feat/mobile-adventure-skin`。原先只有森林场景和临时 SVG 向导；本次按本地 `app-asset-gen` 的静态网格、留白与切片规则，用内置 imagegen 生成一张透明素材表，再切成独立文件并接入真实组件。

## 已补齐的元素

| 元素 / 文件名 | 网页资源尺寸 | WebP bytes | 当前用途 |
| --- | --- | ---: | --- |
| 叶帽向导 `guide` | 144×144 | 6,910 | 会话列表、聊天头部、设置预览；替换临时 SVG |
| 任务卷轴 `quest-scroll` | 128×128 | 6,852 | 冒险日志标题 |
| 冒险背包 `backpack` | 256×256 | 19,556 | 空列表主插画 |
| 蘑菇 `mushrooms` | 192×192 | 11,958 | 横幅前景、空列表 |
| 花草 `wildflowers` | 192×192 | 12,178 | 空列表前景 |
| 木框角饰 `wood-corner` | 128×128 | 3,702 | 横幅右上角；旋转使用 |
| 叶片徽章 `leaf-crest` | 96×96 | 4,792 | 非紧凑项目组标题前的装饰 |
| 地图罗盘 `map-compass` | 192×192 | 11,878 | 备用，尚未接入，不随页面请求 |
| 提灯 `lantern` | 128×128 | 7,126 | 备用，尚未接入，不随页面请求 |

网页文件在 [`web/public/skins/forest-adventure/elements/`](../../web/public/skins/forest-adventure/elements/)。九个独立透明 PNG 在 [`forest-adventure-art/cutouts/`](forest-adventure-art/cutouts/)，适合后续复用。WebP 外框为方形透明画布，主体等比缩放，不拉伸；PNG 保留紧贴主体的透明轮廓。

九个 WebP 共 **84,952 bytes**；七个已接入元素为 65,948 bytes。原场景 `forest.webp` 为 1024×342、69,252 bytes；全部十份网页素材合计 **154,204 bytes**。PNG 原图、素材表、审图图和脚本在开发资料目录，不进入网页静态发布目录。

## 一张大图怎么用

1. 先定清单、格子顺序、显示大小和用途。九格只放相近尺寸的静态元素；不把文字、真实按钮或整个聊天界面画进图里。
2. 用同一场景与原角色作参考，生成有真实 alpha 的透明 PNG。植物本身是绿色，直接透明输出，不用绿色背景去抠图。
3. 检查实际输出。本次原图为 **1254×1254 RGBA**；虽然要求正则网格，AI 第一排仍超出了等分边界，不能直接按九等分裁切。
4. 按实际透明沟校准边界，删除 alpha 小于 8/255 的零散背景噪点，保留完整轮廓。再等比排成 **1536×1536、每格 512×512** 的规范素材表，所有主体留有至少 18% 的格内空白。这是重新排版，不会增加原始细节。
5. 从规范网格切出 PNG，并输出带透明边距的网页 WebP；校验非空、alpha、四角和边界。长列表重复使用同一个 URL，由浏览器复用下载。
6. 用浅色、深色和 32px 预览审查，再看真实页面。地图、提灯保留为备用，页面按需请求已使用元素，不下载整张大图。

可重复执行，无生成服务调用：

```bash
# 预览布局、参考图、输出计划；不写文件、不生成图片
python3 web/scripts/art/slice-forest-sheet.py --dry-run

# 从已经保留的原始图重新校准、切片、导出并验证
python3 web/scripts/art/slice-forest-sheet.py
```

原图发生变化时，脚本会校验 SHA-256 和尺寸并要求重新审查边界，不能直接套用旧坐标。

- [生成提示词](forest-adventure-art/prompt.txt)
- [布局、用途、来源及校准参数](forest-adventure-art/manifest.json)
- [AI 原始透明素材表](forest-adventure-art/source-sheet.png)
- [规范九宫格素材表](forest-adventure-art/normalized-sheet.png)
- [浅色 / 深色 / 小尺寸切片预览](forest-adventure-art/cutout-review.png)
- [切片尺寸、透明度与体积报告](forest-adventure-art/slice-report.json)
- [生产构建冷启动离线缓存检查](forest-adventure-art/offline-report.json)

只提交了 **1 次素材表生成**。工具未返回成本数据。生成的原始文件也保留在 `/Users/wusumac/.codex/generated_images/01a144bb-ba8d-70c3-bd3f-352554d3e624/exec-7e735fdd-874e-48f2-8710-6f8921361110.png`；本仓库保存副本，运行时不依赖该绝对路径。

## 组件接入

`ForestAsset` 统一引用切片，默认只在森林皮肤下渲染；设置缩略预览显式传 `preview`。图像均为空 alt、不可拖动、不中断点击。标题、发送、审批、问号和状态文字仍为实时 UI。

```tsx
<ForestAsset name="leaf-crest" className="forest-project-mark" />
```

`ForestCompanion` 使用同一张静态角色图，`!` / `?` 由真实会话数据控制；工作状态只有现有 CSS 的轻微位移。没有把单张静态图称作 AI 生成的逐帧动作。空列表由背包、蘑菇和花草三张透明切片组合。

默认列表和聊天不请求皮肤图片；设置页面允许明确预览。图片随应用本地提供，没有运行时 AI 生成或第三方热链。SW 按需缓存，容量 16 份、最长 30 天；大素材表不参与网页预缓存。

## 还需要什么

当前静态皮肤的必要素材已齐。可选的下一层是向导待机 / 工作 / 休息的独立动作，以及更复杂的木质窗框。动作应以同一角色为锚点逐状态生成和审帧；可伸缩窗框应独立做九宫格边框。它们不适合和本次小道具混在一张任意比例的大图里。本次长消息、按钮和面板继续用可伸缩 CSS，木角饰只作装饰。

## 原场景

`forest.webp`：内置 imagegen 原创生成，2026-10-16。源图 `/Users/wusumac/.codex/generated_images/01a144bb-ba8d-70c3-bd3f-352554d3e624/exec-928d0a01-6b31-48d5-82a5-8d803937632c.png`；`cwebp -q 85 -resize 1024 0` 导出。用户指出首张偏暗写实，不够冒险岛；该首稿未发布。

场景提示词：

> Completely redesign the environment to match a cheerful classic MapleStory-like 2D side-scrolling chibi RPG map. Clean, bright, cute sprite-map art with rounded exaggerated forms, clear dark-brown outlines, limited clean cel-shaded color steps, little realistic texture. A side-on platform of apple-green grass on a tan dirt ledge stretches across the bottom; a large red-capped mushroom cottage with a round wooden door sits on the right; fluffy lime-green tree canopies, chunky trunks, a tiny fence and oversized plants. Light cyan sky, puffy white clouds, hazy blue rounded hills. Daytime, warm greens and creamy yellow; friendly nostalgic 2000s Korean fantasy online-game aesthetic. Quiet sky on the left for live UI text. Very wide 3:1 panorama, recognizable at 390px wide and 80px tall. Original whimsical setting; no actual game characters or branded objects, text, logos, UI, photographic foliage or cinematic shadows.
