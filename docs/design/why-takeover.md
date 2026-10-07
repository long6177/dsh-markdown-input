# 为什么是接管 —— 输入区路线的工程叙事与上游愿望清单

> **用途**：给访客读的对外叙事与技术说明。本仓库的输入区路线经历过「接管 → 绘制层 → 接管复活」的完整往返（[ADR-0002](../adr/0002-composer-chain-takeover.md) → [ADR-0003](../adr/0003-native-composer-paint-layer.md) → [ADR-0005](../adr/0005-composer-revival.md)），这部分经验是本插件最有分享价值的资产。**分工**：ADR 系列记决策与取舍，本文记对外叙事与技术说明，互链、不重复。
>
> **证据基准**：上游 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) @ tag `dsh-v0.2.0-rc.2`（commit `639ed01`）。文内引用的上游路径与行号均以该 tag 为准，随上游版本漂移。扩展点全景见 [extension-points](extension-points.md)；工具行弹层的逐件重建规格见 [native-surfaces-rebuild](native-surfaces-rebuild.md)；术语见 [CONTEXT.md 词汇表](../../CONTEXT.md)。

## 背景：命题与路线

本插件的核心命题是**输入区（composer）内的 Markdown 实时渲染**：敲下语法标记的当下就看到格式效果，发送的文本与看到的呈现同源。上游 Web UI 的 composer 文本面是宿主自有的 Lexical 编辑器（`InputBar.tsx` 头注释与挂载链，见 [extension-points §1.2](extension-points.md)），以纯文本承载草稿；周边附加槽（`conversation.input.dock` / `composer.dock` 等）能贡献小部件，但都无法改变文本面本身。

我们走过两条路，都以真机结论收口、记录在案：

- **绘制层**（[ADR-0003](../adr/0003-native-composer-paint-layer.md)，alpha.2–3）：保留原生输入区，仅做 paint 级着色。真机验收撞上浏览器 API 硬上限——CSS Custom Highlight API 只提供颜色/背景/描边等 paint 级属性，没有字重与字形，「真加粗」在该路线上不可实现。路线按用户结论退役。
- **接管卡**（[ADR-0002](../adr/0002-composer-chain-takeover.md)、[ADR-0005](../adr/0005-composer-revival.md)，alpha.4 起现行）：经 `conversation.composer` 选举链以低优先级注册，自带 CodeMirror 6 编辑器承担文本面，实时渲染（Obsidian 式实时预览）由此获得布局级自由；审批、提问、子代理等内置面板优先级更高、照常抢占，`overlay` 语义让被接管的内置输入区保活隐藏、草稿状态在接管切换间幸存。

第一代接管卡（alpha.0–1）因重建面缺陷密集也退役过一次；复活的先决条件是两条硬化约束（error boundary + 逐面能力探测，见下文「我们的应对」）。本文余下部分解释：为什么接管必然带来一张重建清单——这不是实现选择，而是当前扩展模型的结构性结果。

## 先说上游给了什么

公平起见先列出已具备的面——缺口清单应当放在这个背景里读：

- **槽位 API 公开且有文档**：声明/生命周期/注入面/扩展规则见上游官方文档 `docs/subsystems/slots.md`；选举链语义、优先级与接管语义见 `packages/client/ui-conversation/README.md:96-139`。
- **官方接管先例充分**：审批（`ui-approval`）、提问（`ui-user-questions`）、子代理（`ui-subagent`）三个官方插件都以同一条 `conversation.composer` 选举链做条件性接管（[extension-points §5.2](extension-points.md)）。
- **数据面公开可达**：草稿读写与提交走 `InputActions` 公开 API（`captureInsertion()` / `insertText()` / `setDraft()` / `submit()` 等，`contract/input.ts:222-241`）；命令目录、权限预设、模型目录等服务面均可注入（见 [extension-points §6.1](extension-points.md)）。
- **运行时自检工具**：`cordis_inspect what:"client"` 可查每个 slot 的 cardinality、owner props、当前占据者与 replacement risk（`docs/subsystems/slots.md:190`）。

## 真正的缺口：四条精确事实

以下四条都有上游源码位置背书，不概括、不引申。

### ① 视图层组件不导出

工具行控件与弹层的**组合视图组件**不在各包 `./client` 导出面上，第三方只能拿到类型或数据服务，拿不到现成控件：

| 视图 | 所在包的 client 导出 | 证据 |
|---|---|---|
| `MenuView`（`+` 命令菜单 / `/` 弹层） | `InputTriggerService`/`InputTriggerController` + 仅类型 `MenuViewProps` | `packages/client/ui-input-trigger/src/client/index.ts:18-24` |
| `PopupSelectView`（第二层选择弹卡） | `CommandUiRuntime`/`CommandDirectory`/`PopupSelectController` + 仅类型 `PopupSelectViewProps` | `packages/client/ui-commands/src/client/index.ts:23-28` |
| `PermissionSelect`（权限预设弹层） | 仅类型 `PermissionSelectInjected`/`PermissionSelectProps` | `packages/client/ui-permission-presets/src/client/index.ts:51-54` |
| `ModelSelect`（模型/推理等级弹卡） | `ModelDirectory`/`ModelDirectoryResolver`（数据服务可用） | `packages/client/ui-model-selection/src/client/index.ts:33-37` |

种子包 `ui-primitives` 提供 `Menu`、`MenuSurface`、`RiskConfirmation` 等通用原语（基线模块、免费 import），数据面也全部可达——所以缺的既不是积木也不是数据，而是**组合完成的控件本体**：接管方需要按原生形态自绘这四类弹层，并逐件复刻其键盘、定位与降级语义（规格记录见 [native-surfaces-rebuild](native-surfaces-rebuild.md)）。

### ② 原生座位随接管结构性消失

接管改变的不只是文本面，而是整个回退子树的可见性。链分派把 `composerBar` 整体作为 fallback（`packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx:172-176`），`overlay: true` 的语义是「保活但隐藏」——选举成立时 fallback 以 `display:none` 包裹退场（`packages/client/ui-slots/src/index.ts:269-282`）。而以下原生座位都挂在 fallback 子树内部：

- **回退体本身**（`ConversationContent.tsx:163-169`）内含：hero 工作区行（`heroWorkspaceRow`，:110-134，含 `conversation.hero.workspace`/`conversation.hero.agentPreset` 两个子槽）与 `conversation.input.dock` 的渲染点（:167）——后者是 todo dock（`TodoPanel.tsx:116-117`，order 0）与 goal 条（`ui-goal/src/client/index.ts:92-96,144`，order 10）的座位；
- **内置 InputBar**（`conversation.composer.bar` 的默认占据者）在自己内部声明并渲染九个子座位（`packages/client/ui-conversation/src/client/apply.ts:420-433`；渲染点 `InputBar.tsx:383,386,443,444,448,454,455,501`），PlanChip（`conversation.input.plan`）在列；**上下文量表（ContextMeter）甚至不是槽位**——它是 InputBar 根 `.dock` 里的固定兄弟组件（`InputBar.tsx:503`）；
- **会话统计（StatsPills）**占据 `conversation.composer.dock`（`packages/client/ui-chat/src/client/apply.ts:283-288`），而该槽位只由 InputBar 内部挂载（`InputBar.tsx:501`）——接管期间无人渲染它。

同时，官方规则是「子槽只能由拥有并渲染该位置的组件声明，其他包用 `ctx.slots.inject()` 等待」（`docs/subsystems/slots.md:195`）——接管方拿不到这些子座位的渲染权，也没有官方通道让这些座位改从接管者体内出现。结果：接管一经成立，todo dock、ContextMeter、StatsPills、hero 工作区行、PlanChip、GoalStrip（以及排队消息栏、Agent 预设座位）从界面上集体消失；要保住这些功能，只能在接管卡内逐件重建。本卡就是这么做的（[ADR-0006](../adr/0006-hero-seats-in-card-rebuild.md) 及 [CONTEXT.md](../../CONTEXT.md) 中「计划 chip」「目标栏」「上下文量表」等词条），并且每个上游 preview 版本都要重测一遍重建面对齐。

### ③ preview 期破坏性变更

上游在 README 明示处于 developer preview、会有兼容性破坏（`README.md:13`："THERE WILL BE COMPATIBILITY-BREAKING CHANGES."）。对接管型插件这是实打实的重测税——本仓库已经历过的两例：

- 宿主 primitives 图标组件改名曾导致接管卡渲染崩溃、整卡卸载（alpha.0 → alpha.1 修复，见 [ADR-0005](../adr/0005-composer-revival.md)）；
- `remote` 命名空间取法改点号服务、`commands.execute` 补 attachments 参数（alpha.6 修复，见[发布清单索引](../release/README.md)）。

上游同时维护着面向外部读者的升级指引机制（`docs/upgrade-guide/`），但破坏发生时插件作者仍需逐版跟跑。

### ④ 无插件脚手架/模板

仓库内有大量优质参考——扩展菜谱（`docs/cookbook/extension-cookbook.md`，但开头即声明片段「省略 import 与辅助实现、并非复制即可运行」见 :5）、面向 monorepo 内部包的逐文件清单（`docs/cookbook/adding-a-package.md`）、面向 agent 的插件开发技能（`packages/preset/agent-preset/skills/cordis-plugin-development/`，自带 `decoration`/`mcp` 两个极简模板、服务于 `install_bundle` 工作区包流程）。但面向**经 npm 分发、双半结构、带构建工具链的 UI 插件**——也就是 `dsh.client` 清单 + TypeScript 构建 + `lib/client.js` 出口这一形态——没有可初始化的脚手架、CLI 或模板仓库；已发布的 `@deepseek-ai/*` 包中也不存在生成器类 `bin`。第一个走通这条路插件要自己拼装全部工程壳，并把每个坑各自踩一遍。

## 我们的应对

四条缺口各有对应的工程回应，全部有成文记录：

1. **逐面能力探测 + 独立降级**：编辑器面、工具行各控件面、弹层面独立探测自己的宿主依赖（注入服务、RPC 面、投影键的存在性）；任一面失效只降级该面——隐藏或回落原生对应控件，绝不牵连文本面（[ADR-0005](../adr/0005-composer-revival.md) 硬化约束之二）。
2. **error boundary**：接管卡整体包裹在 React error boundary 内，渲染异常时整卡卸载、静默回落原生输入区，草稿经宿主草稿 API 保全（硬化约束之一；其必要性来自 ③ 的真实一课）。
3. **真机重测仪式**：每次发布附带 ≤8 条验收清单、逐条真机对照，结果沉淀为[发布清单索引](../release/README.md)——它同时是这份「实测矩阵」对外口径的依据；发布前在保真模式下对准上游 tag 全量执行（[ADR-0007](../adr/0007-dev-deps-published-packages-with-fidelity-mode.md)）。
4. **漂移监视**：每日自动探测上游四路信号（npm 版本与 dist-tag、Release/Tag、白名单路径提交、官方契约文档提交），命中新版本即开票、一版一票跑全套测试与 semver 检查——把「③ 的重测税」从被动发现改成例行公事。

## 上游愿望清单

把上述缺口翻译成五条**接口与期望**（写给上游社区讨论用，不含诉求式批评，措辞详见独立成帖的 Discussions Ideas 草稿：[discussions-wishlist](../launch/discussions-wishlist.md)——发布后在此处补线上链接）：

1. **视图层复用 / 原生面工具包**——让接管方能复用原生控件本体而非自绘；
2. **原生座位从接管者渲染**——让随接管隐藏的座位有官方通道改从接管方体内出现，避免结构性消失；
3. **正式的接管契约 + 一致性测试套件**——让第三方可以实现、且可自证合规的接管；
4. **插件脚手架/模板**——面向 npm 分发的双半 UI 插件形态的初始化模板；
5. **preview 期的契约稳定性或弃用策略**——含迁移指引，让逐版跟跑有章可循。

## 若官方输入区扩展点出现

显式声明我们的立场：**如果上游将来提供官方的输入区扩展点——无论是视图层复用、座位移交、还是正式的接管契约——我们乐意把重建面迁移过去，也乐意把这条路上攒下的规格与测试经验（[native-surfaces-rebuild](native-surfaces-rebuild.md) 的逐件复刻规格、逐面探测与降级范式、[发布清单](../release/README.md)的真机验收记录）贡献回上游。**接管是我们今天在现有扩展模型下的工程选择，不是终点形态。

## 相关文档

- 决策记录：[ADR-0001 编辑器选型](../adr/0001-cm6-obsidian-style-editor.md) · [ADR-0002 选举链接管](../adr/0002-composer-chain-takeover.md) · [ADR-0003 绘制层（已退役）](../adr/0003-native-composer-paint-layer.md) · [ADR-0004 发布与反馈闭环](../adr/0004-npm-release-remote-feedback-loop.md) · [ADR-0005 接管卡复活](../adr/0005-composer-revival.md) · [ADR-0006 hero 座位重建](../adr/0006-hero-seats-in-card-rebuild.md) · [ADR-0007 开发依赖模型](../adr/0007-dev-deps-published-packages-with-fidelity-mode.md)
- 同级深文：[extension-points](extension-points.md)（扩展点全景） · [native-surfaces-rebuild](native-surfaces-rebuild.md)（弹层重建规格） · [prior-art](prior-art.md)（主流输入区行为对照）
- 发布与验证：[发布清单索引](../release/README.md)
- 对外文案：[docs/launch/](../launch/README.md)（发布稿草稿，未发布）
- 术语：[CONTEXT.md 词汇表](../../CONTEXT.md)
