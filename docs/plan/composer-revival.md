# 输入区复活需求落实文档（alpha.4 / alpha.5）

> 依据：[ADR-0005](../adr/0005-composer-revival.md)（复活决定与硬化约束）。
> 共识来源：2026-10-02/03 需求拷问（六问全部定案，见 §2）。
> 跟踪票：[#18](https://github.com/long6177/dsh-markdown-input/issues/18)。三弹层机制规格（file:line 级）见本地工作笔记 `outputs/native-input-popups-spec.md`。

## 1. 背景与决策链

- v1（alpha.0/alpha.1）：接管卡 + CodeMirror 6，编辑器面真机两轮验证通过（折叠渲染、IME、草稿镜像），但重建周边缺陷密集，被 ADR-0003 退役。
- v2（alpha.2/alpha.3）：原生输入区 + 绘制层。alpha.3 真机验收暴露 CSS Custom Highlight API 硬上限（paint 级属性，无字重字形），用户否决「只有着色没有真加粗/斜体」的效果，开发暂停。
- 现决定（ADR-0005）：回到 v1 形态作为长期路线，以两条硬化约束重启；用户核心诉求 = **真正的 Markdown 实时渲染 + 尽量原样的输入区体验**（工具行四控件、引用 chip、补全弹层）。

## 2. 拷问定案（共识）

| # | 问题 | 定案 |
|---|---|---|
| Q1 | 交付切分 | **两段**：alpha.4 复活核心（chip 纯文本透传），alpha.5 chip 全量。各带 ≤8 条专属清单 |
| Q2 | chip 范围 | **全量**：@ 文件/文件夹 chip、会话引用 chip、`/技能` 词典命中 chip、`@` 文件搜索弹层、`/` 命令+技能两组补全弹层。补全弹层是硬需求 |
| Q3 | 渲染/源码模式开关 | **保留**（ADR-0001 差异化卖点，CM6 配置级成本） |
| Q4 | 附件栏 | **v1 水准**：已上传附件 chip 显示 + 移除 + 上传中占位；进度/图片预览/错误重试后置 |
| Q5 | 崩溃回落体验 | **回落 + 一次性轻提示**：接管卡卸载、原生输入区顶上、非模态提示数秒消失、console 记录原因、重启后重试接管 |
| Q6 | 治理 | 先需求文档（本文）→ 走票 → 分步开发 |

## 3. 技术事实（调查结论，实现依据）

1. **submit 走命令路由**：`inputActions.submit()` 的提交事务经会话 InputTriggerController 裁决（`facade.ts:5-6`）——从接管卡提交 `/compact`、`/goal …` 等命令行文本会被路由执行，不会当普通消息发给模型。alpha.4 的 goal/plan 菜单项 = 插入与原生同款的本地化 claim token 文本，Enter 提交即正确路由。
2. **chip = 纯文本之上的装饰**：草稿文本即线格式；`scanTextRefs` 对 `@` 与 `/` 触发按热词典精确命中打装饰（`decorations.ts:46-70`），`/技能` 也是 chip。alpha.4 纯文本透传即可保证正确性（提交、草稿镜像、宿主重扫描全链路不坏）。
3. **三弹层规格**：宿主视图组件一律不导出（须自绘或 vendor），数据层全部可达——命令目录 `remote.commands.list/execute`、权限 `permissions` 投影 + `live.command('/permission <preset>')`、模型 `ctx.modelDirectories` 目录服务。视觉/键盘/locale 全规格见 `outputs/native-input-popups-spec.md`。
4. **v1 面件可整段恢复**：v1 源码完整存在于 `c4daae1^`，恢复后按 rc.2 适配。
5. **硬化硬指标**：alpha.0 整端崩溃的教训 → error boundary + 逐面能力探测是复活的先决条件（ADR-0005），不是可选项。

## 4. alpha.4 —— 复活核心

### 4.1 范围

- 接管卡（`conversation.composer` 选举链低优先级）+ 自带 CM6 编辑器（Obsidian 式实时渲染：光标行保留标记、移开折叠；真加粗/斜体/行内代码/删除线样式）。
- 渲染/源码模式开关。
- 工具行四控件：
  - ① `+` 命令菜单：添加/指令两分节、八条目（file/goal/plan/feedback/compact/permission/model/export），goal/plan 点击插 claim token，permission/model 行链式打开第二层弹卡，feedback/compact/export 直达动作。
  - ② 权限预设：Menu + RiskConfirmation（完全权限确认门），读 `permissions` 投影，写 `/permission <preset>`。
  - ③ 模型/推理等级：两行 pane 卡片，数据走 `modelDirectories`（可达性 spike 先行）。
  - ④ 发送/停止/排队（v1 #11 已解，对齐 rc.2；alpha.6 真机复测发现停止半件缺失，#32 补齐：普通会话主按钮 `primaryStops` 变停 + 可续子会话专属停止钮，走会话域 `conversation.cancel`，队列保留）。
- 附件栏 v1 水准；粘贴转 Markdown 迁入 CM6 paste handler（复用 `paste-decision.ts` 转换器；图片/文件粘贴交宿主 intake）。
- chip 纯文本透传（不装饰、不丢内容）。
- 硬化：error boundary + 一次性轻提示 + 会话内闩锁；逐面能力探测（编辑器面/工具行各控件面/弹层面独立降级）。
- 退役：PaintDock/PasteDock 与 dock 注册移除；绘制层引擎归档（git 历史保留）。

### 4.2 分步开发顺序（TDD，每步带测试）

1. **M1 v1 面件落地**：从 `c4daae1^` 恢复 MarkdownComposer / markdown-editor / live-render / conversation-face / locales / CSS，适配 rc.2 与当前 main。
2. **M2 硬化**：error boundary（含轻提示）+ 逐面能力探测框架。
3. **M3 工具行**：④ 发送/停止 → ① `+` 菜单 → ② 权限 → ③ 模型（spike 先行）。
4. **M4 粘贴迁移**：CM6 paste handler + 富文本转换。
5. **M5 清理与验证**：dock 注册退役、全量单测 + typecheck + build。
6. **M6 发布**：alpha.4 清单定稿 → npm publish（维护者输 OTP）→ 真机验收。

### 4.3 验收清单草稿（发布时定稿，≤8 条）

1. 插件管理 UI 升级到 alpha.4 成功，输入区变为接管卡（回归预期）。
2. 编辑器可输入，焦点、中文 IME、Enter 发送 / Shift+Enter 换行正常。
3. 实时渲染：粗体/斜体/行内代码/删除线以真样式呈现、语法标记淡显；光标行保留标记、移开折叠；渲染/源码开关可用。
4. `+` 菜单：添加/指令两节八条目齐全；goal/plan 插入标记后回车正确触发；compact/export 立即执行。
5. 权限 pill：三预设切换生效、完全权限有确认门；模型 pill：模型/推理等级切换生效。
6. 发送/停止：空闲发送、运行中可停止、可排队追加。
7. 附件与粘贴：文件上传/移除正常；富文本粘贴转干净 Markdown、Ctrl/Cmd+Shift+V 纯文本直插。
8. chip 透传与回落：@文件/技能/会话引用以纯文本发送后宿主正确识别；禁用插件回落原生无残留；（如触发）降级有提示、草稿幸存。

## 5. alpha.5 —— chip 全量

- `@` 文件搜索补全弹层 + 文件/文件夹 chip（含空格引号转义 `@"path with spaces"`）。
- `/` 补全弹层：指令 + 技能两组（命令目录 + 技能贡献，同宿主管线数据源）。
- `/技能` 词典命中 chip、会话引用 chip（`@[label](dsh-session:…)`）。
- goal/plan claim 幽灵提示装饰。
- 排队消息栏（#30，alpha.4 真机缺口）：接管卡内重建原生 queue dock 视图——行数据走输入货币 `InputState.queue`（facade 覆写 agent inbox）+ 会话快照 `pendingSubmissions` 回显，撤回/编辑/插话走会话域 `conversation.updateQueue`（原生 dock 同路径）；动作面按能力探测缺席时仅降按钮、行可见不降。
- 输入参考：宿主弹层截图（用户提供时以其为准，否则按源码仿）。

## 6. 治理与退役动作

- 跟踪票：[#18](https://github.com/long6177/dsh-markdown-input/issues/18)。#15/#16 已收尾（交付物随 ADR-0005 退役，收尾说明落在票内）。
- 词汇表：`CONTEXT.md` 已增「接管卡」、退役「绘制层」的现行地位。
- 版本线：`0.2.0-alpha.4` / `0.2.0-alpha.5`，发布闭环依 [ADR-0004](../adr/0004-npm-release-remote-feedback-loop.md) 不变。
