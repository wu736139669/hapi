# 马卡龙渐变多配色

2026-10-16。用户要求增加不同配色；分支 `feat/macaron-color-variants`，同目录开发，未使用 worktree。新增 5 套，马卡龙共 6 套，加默认、森林共 8 个选择。

| 配色 | 标识 | 色调 |
| --- | --- | --- |
| 原马卡龙渐变 | `macaron-gradient` | 经典粉紫、薄荷、奶油 |
| 蜜桃奶油 | `macaron-peach` | 蜜桃橙、杏黄、淡粉 |
| 薄荷海盐 | `macaron-mint` | 薄荷绿、冰蓝、浅青 |
| 蓝莓奶霜 | `macaron-blueberry` | 雾蓝、浅紫、冰蓝 |
| 柠檬雪酪 | `macaron-lemon` | 奶黄、浅杏、嫩绿 |
| 玫瑰荔枝 | `macaron-rose` | 柔粉、干玫瑰、荔枝白 |

## 实现

每套同时覆盖背景、卡片、按钮、边框与文字，支持浅色/深色/OLED。共享已有马卡龙布局和 CSS 渐变；新增内容只提供色值，零新增图片请求。原经典配色保留，默认与森林样式继续独立。

选择区为手机三列、较宽屏幕四列；每张预览使用自己的色值，不随当前选项串色。八个选项的方向键循环、Home/End、刷新保存及跨页同步继续有效。颜色主题和自定义颜色保留原优先级。

## 验证

17 项浏览器检查通过，包含新增五套的选择/保存、320px 设置布局、430px 浅色聊天、深色/OLED、15 组首屏 HTML 明暗初始化，以及原有森林和马卡龙功能检查。`bun typecheck`、UI fixture 类型检查、单文件构建均通过。

Web 单测 3260 通过、35 个原有失败；本轮新增 10 个配色集成用例通过。完整 `bun run test` 仍在 CLI 原有 7 个失败及 `bun:sqlite` 环境套件错误处中止。CLI/Web 失败 ID 已逐项对比原基线，无新增。

浅色辅助文字与四个渐变端点的静态色值对比度均不低于 4.5:1。按仓库 Major 检查表检查需求、方案及差异；引用的 pre-push-review 技能此前已确认缺失，沿用 AGENTS 要求的机械检查和本地逻辑审查。

[六套同屏对比](screenshots/macaron-variants/comparison.png)、[选择区](screenshots/macaron-variants/picker.png)。真实组件、合成数据，390×844 Chromium；未声称实机 Safari 测试。

## 上线

源码 `8924dba8` 已合并并推送 `local/deploy-main`，部署 mini（Hub + runner）及 k2lab（runner）。两台签名一致、固定路径与新 runner mtime 验证通过，Hub health 正常。两台前后均有 6 个 Agent 可用、Codex 7 个模型。

正式 Hub 验证了 8 个选择、五种新配色的刷新保存、对应首屏颜色与渐变色值、列表完整渐变、无森林装饰、零皮肤图片请求、无横向溢出和页面错误。刷新后在「设置 → 显示 → 界面皮肤」切换。见 [上线报告](macaron-color-variants-deployment.json)。
