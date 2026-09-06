# DeepSeek Harness (dsh) Web UI 插件架构调研 — 面向「增强聊天输入框」插件设计

- 调研对象：`github.com/deepseek-ai/deepseek-harness` @ `d347e703908d0406b7a7ef80e3a0e594d86b2215`（v0.1.3-alpha.1，developer preview）
- 调研方式：本地源码克隆（一手来源）+ 仓库内 docs/
- 标注约定：**[源码证实]** = 源码文件路径:行号；**[文档]** = 仓库内官方文档路径；**[文档推断]** = 文档描述但未逐行核实源码
- 本仓库仍在快速迭代，官方 README 明确警告 "THERE WILL BE COMPATIBILITY-BREAKING CHANGES"（README.md:14）

---

## 1. Web UI 技术栈与输入框组件

### 1.1 技术栈 [源码证实]

| 层 | 技术 | 证据 |
|---|---|---|
| 前端框架 | **React 18**（`react@^18.2.0`，函数组件 + `useSyncExternalStore`） | `apps/web/package.json`（devDependencies 中 react/react-dom/@vitejs/plugin-react） |
| 构建工具 | **Vite 6**（`apps/web` 打包 shell），库构建用 **tsdown** | `apps/web/package.json:scripts.build = "vite build"`；各 `packages/client/*` 的 `tsdown.config.ts` |
| 浏览器运行时 | **Cordis 应用**（`@deepseek-ai/cordis`，整个 Web UI 是一个由插件组合的 Cordis client fiber 树） | `docs/subsystems/web-client.md:5`（"browser-side Cordis application assembled from independently loaded plugins"） |
| 样式方案 | **CSS Modules**（`.module.css`，组件内 `import css from './X.module.css'`）+ 主题 token（`--dsh-*` / `--dsw-*` CSS 变量） | `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx:38`；`packages/client/ui-chat/src/client/chat/MessageItem.module.css:36-38` |
| 共享模块基线 | `PLATFORM_MODULES = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives']` | `packages/client/web/src/platform.ts:8-13` |

### 1.2 消息输入框（composer）用的什么组件 [源码证实]

**不是原生 textarea，不是 CodeMirror，而是 shell 自有的 Lexical 编辑器绑定到一个 contenteditable div 上。**

- 入口组件：`InputBar`（`conversation.composer.bar` slot 的默认占据者），文件 `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx`
  - 头部注释（1-14 行）："The text surface is the shell-owned **Lexical editor** bound here through ComposerContentEditable; chips render as decorator portals, and the keymap registers submit/menu/paste gestures on the editor command layer."
  - 编辑面挂载：`InputBar.tsx:438` `<ComposerContentEditable editor={...} editable={editable} ...>`
  - `InputBar.tsx:431-435` 注释："One scrollport, one text surface: the contenteditable grows with its content and `.scroll` — capped at 14 lines in CSS — is the only thing that scrolls."
- `ComposerContentEditable`：`packages/client/ui-conversation/src/client/input/editor/ComposerContentEditable.tsx:36-58` — 把 Lexical editor `setRootElement()` 到一个 `<div contentEditable role="textbox" aria-multiline="true" data-composer-input>` 上（`data-composer-input` 属性在 52 行）。
- Lexical 依赖：`packages/client/ui-conversation/package.json:51-55` — `@lexical/history`、`@lexical/plain-text`、`@lexical/text`、`@lexical/utils`、`lexical`（均 `^0.49.0`）；另有 devDep `@lexical/headless`。
- 附属机制：
  - chip/装饰器：`DecoratorPortals`（`InputBar.tsx:33,459`）
  - 键位：`registerComposerKeymap`（`InputBar.tsx:34,273-308`）
  - placeholder 是兄弟 div（`data-composer-placeholder`，`InputBar.tsx:454-458`），注释确认历史上曾是 textarea（445 行）
- **composer 是纯文本编辑**：包内没有任何对草稿做 markdown 渲染的代码（draft 只以字符串进 `InputState.draft`，见 §3）。

---

## 2. UI 插件 API 全貌

### 2.1 核心 API 形态 [源码证实 + 文档]

三类注册面（均在浏览器半的 client context 上）：

1. **`ctx.slots.register(options, component)`**：向一个已声明的 slot 贡献 React 组件。类型定义：`packages/client/ui-slots/src/index.ts`（`SlotCore.register` 在 772-927 行；`SlotMap` 在 26 行；`SlotEntryDef` 在 102-124 行）。
2. **`ctx.slots.inject(key, callback)`**：向**别的包声明**的 slot 安全贡献——回调在声明存活期内运行、声明坍塌时回收、重声明时重跑。文档：`docs/subsystems/slots.md:17`；规范出处 `packages/client/AGENTS.md:141`。
3. **`ctx.uiConversation.events.register(definition)`**：注册 `ConversationNodeDefinition`（事件→视图节点状态机）。源码：`packages/client/ui-conversation/src/client/conversation/event-registry.ts:19`；接口：`packages/client/ui-conversation/src/client/contract/conversation.ts:185-245`。

### 2.2 全部 slot id（声明树快照）[源码证实]

类型来源（`declare module '@deepseek-ai/dsh-client-ui-slots'` 的 `SlotMap` 合并）：
- `packages/client/ui-conversation/src/client/contract/slots.ts:118-198`
- `packages/client/ui-chat/src/client/contract/slots.ts:190-234`
- `packages/client/ui-approval/src/client/contract/slots.ts`
- `packages/client/ui-settings/src/client/contract/slots.ts`
- `packages/client/ui-sidebar/src/client/contract/slots.ts`
- `packages/client/ui-layout/src/client/index.ts`
- `packages/client/ui-renderer/src/client/registry.ts`
- `packages/client/ui-tool/src/client/contract/slots.ts`
- `packages/client/ui-workspace/src/client/contract/slots.ts`
- `packages/client/ui-settings-models/src/client/slot-contract.ts`、`ui-settings-plugins/src/client/slot-contract.ts`
- `packages/client/ui-trajectory/src/client/trajectory-contract.ts`
- `packages/extensions/ui-cordis/src/client/slots.ts`

官方声明树（`docs/subsystems/slots.md:110-164`，与源码一致）：

```text
root
├─ sidebar
│  ├─ sidebar.brand.mark / sidebar.brand.name / sidebar.footer.action
│  ├─ sidebar.workspaces → sidebar.workspaces.directoryFlow
│  └─ sidebar.settings → settings.trigger / settings.header / settings.action
│                        / settings.close / settings.onboarding
│     └─ settings.section → settings.general.item / settings.models.provider-card
│                            / settings.models.footer
│        └─ settings.plugins.tab → settings.plugin.item
├─ conversation
│  ├─ conversation.session
│  │  └─ conversation.view
│  │     ├─ conversation.chat.node (keyed, 按 ChatNodeKind 派发)
│  │     │  ├─ conversation.chat.assistant-actions
│  │     │  ├─ conversation.chat.commandview
│  │     │  ├─ conversation.chat.turnTail (chain)
│  │     │  └─ tool.call.toolview → tool.call.images / tool.view.cordis
│  │     ├─ conversation.message.images
│  │     └─ conversation.trajectory.images
│  ├─ conversation.session.header
│  │  ├─ conversation.session.header.lineage
│  │  ├─ conversation.session.header.actions
│  │  └─ conversation.session.header.utilities
│  ├─ conversation.composer (chain) ← 【composer 整体替换点】
│  │  └─ conversation.approval.detail
│  ├─ conversation.composer.bar (single) ← 【composer 本体替换点】
│  │  ├─ conversation.input.attachments
│  │  ├─ conversation.input.plan
│  │  └─ conversation.input.model
│  ├─ conversation.input.overlay  (list, composer 卡片内浮动)
│  ├─ conversation.input.dock     (list, composer 卡片上方整行)
│  ├─ conversation.composer.dock  (list, composer 卡片下方)
│  ├─ conversation.input.left     (list, 工具行左侧)
│  ├─ conversation.input.right    (list, 提交按钮前)
│  ├─ conversation.hero.brand.mark / conversation.hero.workspace
│  │  └─ conversation.hero.workspace.directoryFlow
│  └─ conversation.hero.agentPreset
├─ details → conversation.details.tool
└─ shell.overlay
```

**与输入区相关的 slot 语义**（`packages/client/ui-conversation/src/client/contract/slots.ts`）[源码证实]：

| slot id | kind/scope | 语义 | 行号 |
|---|---|---|---|
| `conversation.composer` | chain / session | **"Selector-routed replacements for the current Session's resident composer"**——整体替换 composer 的选举链 | 145 |
| `conversation.composer.bar` | single / session-maybe | **"Resident composer body"**——composer 本体（默认占据者 = 内置 `InputBar`） | 163 |
| `conversation.input.dock` | list / session | "Full-width entries above the composer card" | 153 |
| `conversation.input.overlay` | list / session | "Floating entries rendered inside the resident composer card" | 155 |
| `conversation.composer.dock` | list / session | "Ambient entries below the composer card" | 157 |
| `conversation.input.left` | list / session | "Compact controls at the left of the composer tool row" | 159 |
| `conversation.input.right` | list / session | "Compact controls before the composer submit action" | 161 |
| `conversation.input.attachments` | single / session-maybe | "Optional draft-attachment rail and drop target"（可替换附件栏） | 165-169 |
| `conversation.input.plan` / `conversation.input.model` | single / session | 工具行内的 Plan / 模型选择器（可替换） | 171-173 |

声明位置（谁声明了这些子 slot）[源码证实]：
- `conversation` 根 entry 声明 `conversation.composer`、`conversation.composer.bar`、`conversation.input.dock` 等：`packages/client/ui-conversation/src/client/apply.ts:216-228`
- `conversation.composer.bar` entry（内置 InputBar）声明 `input.attachments/overlay/left/plan/right/model`、`composer.dock`：`apply.ts:294-305`
- 渲染点：`ConversationRoot.tsx:356-360`（chain）与 `InputBar.tsx:416,419,500,504,509,510,552`（各子 slot）

### 2.3 `conversation.composer` chain 与 `renderSlotChain` [源码证实]

- chain 选举：每个 entry 提供纯函数 `select(owner)`（owner = `ComposerChainProps = { sessionId, session, pendingInteraction }`，`contract/slots.ts:330-337`），priority 升序尝试，第一个非 null 返回者当选并把结果作为 `matched` prop 注入；全部拒绝则渲染 owner fallback（`packages/client/ui-slots/src/index.ts:226-262`）。
- 关键的 `overlay: true` 选项（`ui-slots/src/index.ts:238-249`）："Keep the fallback permanently mounted: an election hides it (wrapped, display:none) instead of unmounting it … fallback-held state (**composer drafts**, DOM state) survives a takeover. Chain kind only; **the sole consumer is the `conversation.composer` chain**."
- 内置 dispatch 点：`packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx:356-360`：

```tsx
const composer = renderSlotChain(
  'conversation.composer',
  { sessionId, session, pendingInteraction },
  { fallback: composerBar, fallbackOnly: sessionId === undefined, overlay: true },
)
```

### 2.4 `ConversationNodeDefinition` + keyed Chat renderer 控制的是什么 [源码证实]

**控制的是「消息/聊天记录渲染」，与输入框无关。**

- 接口：`packages/client/ui-conversation/src/client/contract/conversation.ts:185-245` —— `kind` / `target?` / `match(event)`（恒等提取器，返回 `{id, role: 'start'|'update'} | null`）/ `start(context, match, reader)` / `update(context, match)` / `publication?` / `buildLocationData?` / `buildViewNode?`。
- keyed Chat renderer：`conversation.chat.node` 是 `kind:'keyed'` slot，`keyProps` 按 `ChatNodeKind` 供给 `{ node }`（`packages/client/ui-chat/src/client/contract/slots.ts:196-203`）。注册渲染器 = `ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: '<ChatNodeKind>' }, Component))`。
- 内置 renderer 注册表：`packages/client/ui-chat/src/client/chat/register-node-renderers.ts:19-56`（`user`/`steering`/`context`/`system-prompt`/`assistant-step`/`command`/`compaction`/`model-retry`/`turn-error`/`turn-max-tokens`/`turn-process`/`turn-tail`/`unknown`）。
- 事件来源：`ui-conversation` 把 Client `SessionEventLikeEntry` 窗口（durable `session/event` 历史 + Client-only `assistant/live-chunk` 瞬态）喂给 assembler；**浏览器插件不直接监听 `session/event`，而是通过 Definition 间接消费**。`docs/subsystems/conversation.md:11,45`。
- **`session/event` 的直接监听（宿主半）**：`ctx.on('session/event', (_session, event) => {...})`，官方 cookbook 示例 `docs/cookbook/extension-cookbook.md:79`；官方表格（同文件 129 行）："Web Client Chat business node → register a `ConversationNodeDefinition` and `conversation.chat.node` keyed renderer"。
- 浏览器半的事件进入：`ctx.remote.$on('<event>', handler)`（Connection `$events` 逻辑流转发；waterfall 监听器可返回结果/`next()`/reject）——`docs/subsystems/web-client.md:32`；实例：`packages/client/ui-approval/src/client/index.ts:90`。

---

## 3. 用户消息是否已按 Markdown 渲染？[源码证实：否]

### 用户消息 = 纯文本 + 引用 chip，**未渲染 Markdown**

- 渲染代码：`packages/client/ui-chat/src/client/chat/MessageItem.tsx:221-224`：

```tsx
{showBubble && <div className={css.bubble}>
  {projectUserText(text, referenceLabels, skillNames)}
  ...
</div>}
```

- `projectUserText`：`packages/client/ui-primitives/src/user-text.tsx:1-48+`。头注释明确其职责仅为"Display projection of **reference forms** in sent user text"——四类装饰：会话 wire 形式 `@[label](dsh-session:...)` 折叠、`@label` 提及、`@name` 形状匹配、已加载技能的 `/name`。**其余文字一律按 plain run 输出，没有任何 markdown 解析**（该文件不 import 任何 markdown 库）。
- CSS 佐证：气泡是 `white-space: pre-wrap; word-break: break-word`（`packages/client/ui-chat/src/client/chat/MessageItem.module.css:38-39`），注释："The projected user text is inline runs"。
- 排队 steering 消息同样走 `projectUserText`（`MessageItem.tsx:242-254` `PendingSteeringBubble` → `UserStyleBubble`）。

### 助手消息 = 完整 Markdown 渲染（GFM + 数学公式，流式增量）

- 渲染链：`chat.node(key='assistant-step')` → `AssistantNodeView`（`packages/client/ui-chat/src/client/chat/AssistantNodeView.tsx:30`）→ `AssistantMarkdown`（`packages/client/ui-chat/src/client/chat/AssistantMarkdown.tsx:50-59`）→ **`MarkdownText`**（`@deepseek-ai/dsh-client-ui-primitives`）。
- `MarkdownText` 实现：`packages/client/ui-primitives/src/markdown/MarkdownText.tsx`（1-12 行头注释："Untrusted assistant-Markdown renderer over the direct mdast pipeline … streaming"）；底层是 **micromark/mdast 自装管线**，非 react-markdown：`packages/client/ui-primitives/package.json` 依赖 `mdast-util-from-markdown`、`micromark-extension-gfm`、`micromark-extension-math`（KaTeX：`MarkdownText.tsx:23` `import 'katex/dist/katex.min.css'`）。
- 流式优化：冻结块缓存 React 元素、仅重解析尾部（`MarkdownText.tsx:63-120`）。

**结论（对本设计最关键）**：发送后的用户消息在聊天记录里是纯文本气泡；「用户消息 Markdown 预览」只能通过插件自行渲染预览（发送前）或替换用户消息渲染器（`conversation.chat.node` key=`user`，见 §6）实现。

---

## 4. 「宿主/浏览器双半结构」

### 4.1 打包与注入 [源码证实 + 文档]

一个 UI 插件 = 一个普通 Cordis 包 + 一个浏览器半 bundle：

1. **package.json 特殊字段 `dsh.client`** [源码证实]：
   ```jsonc
   "dsh": {
     "client": {
       "platform": "web",            // 必填，恒为 'web'
       "inject": ["@deepseek-ai/dsh-client-ui-session", ...],  // 仅信息性依赖边（预检/HMR diff），不决定激活顺序
       "immediately": true,          // 可选：第一阶段预取（仅基础设施行）
       "external": ["..."]           // 可选：基线之外的精确模块请求
     }
   }
   ```
   扫描/校验实现：`packages/client/modules/src/index.ts:211`（`dsh.client.external` 读取）；语义文档 `packages/client/AGENTS.md:140`（"platform: 'web' always, and the declaration requires a `./client` export (the scan throws without one)"）。
2. **bundle 出口**：`exports["./client"]` 指向构建产物（约定 `lib/client.js`）[源码证实，`packages/client/ui-jobs/package.json:16-18`]。宿主服务的是**构建后**的 bundle："the registry serves `lib/client.js`, not sources"（`packages/client/AGENTS.md:142`）。
3. **注入方式 = `<script>` 组合脚本，非 iframe** [文档 + 源码证实]：宿主扫描启用的包 → 组合 `WebBootGraph` → 渲染 index 时注入 `<head>`：`window.__ModuleLoader__` 队列 facade、应用 combo 的 preload、parser-blocking bootstrap 脚本、然后 `window.__DSH_BOOT__` 图全局（`<` 转义防脚本逃逸）→ Vite 入口。`docs/subsystems/client-modules.md:11,85`；`packages/client/modules/README.md`（"Boot manifest injection"节）。
4. **bundle 运行模型 = lazy-CJS**：执行 bundle 只注册 factory；materialize 时才以同步 `require` 运行模块体（CSS 注入等副作用也在 factory 闭包里）[文档，`packages/client/modules/README.md` "Lazy-CJS model"]。
5. **共享模块**：动态 bundle 的 externals 对着 `PLATFORM_MODULES` 冻结表解析（§1.1）；第三方实现库可私有打包（"Silence means a private copy"，`packages/client/AGENTS.md:79`）。`dsh.client.external` 明确**不是** feature 插件的依赖机制（同文件 78 行）。
6. **bundle 路由**：`GET /plugins/??<pkg-a>/client.js,<pkg-b>/client.js&rev=<rev>`，immutable 缓存，Indexed Source Map v3，URL ≤3KiB 分片 [文档，`docs/subsystems/client-modules.md:85`]。
7. **HMR**：dev 下 `dsh-client-hmr` stat-poll bundle → `rebuilt(id)` 重散列 → SSE 通知浏览器半按 rev 换 URL [文档，`docs/subsystems/client-modules.md:103`]。

### 4.2 宿主半 ↔ 浏览器半如何通信 [源码证实 + 文档]

- 两个半都是 Cordis context，但**运行在不同进程**（Node / browser），通过 API Gateway（WebSocket `/api` 载体）连接：
  - **浏览器→宿主调用**：Typert `@Remote` 装饰的生成方法挂到 `ctx.remote.<namespace>.<method>()`（`docs/subsystems/web-client.md:28-30`）。
  - **宿主→浏览器事件**：`ctx.remote.$on('<event>', handler)`；普通事件转发到根 Client Context，waterfall 事件路由到对应 Session Context，监听器返回结果 / `next()` / reject（`web-client.md:32`）。
  - 实例 [源码证实]：`packages/client/ui-approval/src/client/index.ts:90-92`（`ctx.remote.$on('approval/request', …)` 回答审批）；`packages/client/ui-user-questions/src/client/index.ts:104-106`。
- **数据获取的正确姿势**：slot 的 standard props 已带 Conversation/Input 快照（见 §5），文档明确 "If Slot props already provide the Conversation Snapshot, do not fetch it again through Host"（`packages/preset/agent-presets/presets/cordis/skills/cordis-plugin-development/SKILL.md` "Choose a platform" 节）。
- 动态（运行时 agent 生成）插件另有 `ctx.dynamicCordisRunner`：`define/run/getClientCode/invoke/reportRenderFailure/...`（`docs/subsystems/extensions.md:69-253`），client 半 runner 为 `packages/extensions/cordis-client-runner`（package.json 描述 "Browser half of dynamic dual-half plugin packages"）。

---

## 5. UI 插件完整示例（仓库内）

### 5.1 最小 UI 插件：`ui-jobs`（双半）[源码证实]

`packages/client/ui-jobs/`：
- 宿主半 `src/index.ts:8`：**空 apply**（"Pure UI plugin: the empty apply exists so the plugin appears in the host cordis.yml / Loader"）。
- 浏览器半 `src/client/index.ts:26-44`：
  ```ts
  export const inject = ['sessions', 'slots', 'locale']
  export function apply(ctx: ClientContext): void {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-job: dictionaries')
    ctx.slots.inject('conversation.session.header.actions', () =>
      ctx.slots.register({ name: 'conversation.session.header.actions', id: 'job-list', order: 20, locale: NS }, JobListAction))
  }
  ```
- package.json：`dsh.client = { inject: [locale, ui-conversation, ui-primitives], platform: 'web' }` + `exports["./client"]`。

### 5.2 composer 整体替换先例（**官方已有碰输入区的插件，且不止一个**）[源码证实]

- **`ui-approval`**（审批面板接管 composer）：`packages/client/ui-approval/src/client/index.ts:80-89` —— `ctx.slots.inject('conversation.composer', () => ctx.slots.register({ name: 'conversation.composer', priority: 1, select: ({pendingInteraction}) => pendingInteraction instanceof PendingApproval ? pendingInteraction : null, locale: NS, children: { 'conversation.approval.detail': … } }, ApprovalPanel))`。
- **`ui-user-questions`**（提问面板接管 composer）：`packages/client/ui-user-questions/src/client/index.ts:94-103` —— 同模式，`select` 匹配 `PendingQuestion`。
- **`ui-subagent`**：`packages/client/ui-subagent/src/client/index.ts:76` 也注册 `conversation.composer`（子代理只读 composer，`SubagentReadOnlyComposer.tsx`）。
- 三者都是**条件性接管**（pending 时替换、其余时候让 fallback 出示）。这正是 chain + `overlay: true` 的设计意图：fallback（含草稿状态）保活隐藏，接管结束后无缝还原（§2.3）。

### 5.3 消息渲染贡献的官方完整 worked example [文档]

`docs/subsystems/conversation.md:51-217`：从 `SessionEventMap` 声明合并（宿主 emit `review/start|progress|end`）、`ChatNodeDataMap` 合并、`ConversationNodeDefinition`（match/start/update/publication/buildLocationData/buildViewNode），到 `ctx.uiConversation.events.register(reviewDefinition)` + `ctx.slots.inject('conversation.chat.node', … register({name, key:'review-job'}, ReviewNodeView))` 的端到端示例。

### 5.4 slot 贡献的官方最小示例 [文档]

`docs/subsystems/slots.md:19-42`（`conversation.session.header.actions` 加一个按钮）。

---

## 6. 稳定性评估与最小侵入挂载点建议

### 6.1 稳定 vs 私有 [源码证实]

**稳定面（官方插件契约，跨包可依赖）**：
- `SlotMap` 全部 slot key、kind、scope、owner props（TS 类型随包发布，`contract/slots.ts`）；官方文档甚至提供了运行时自检：`cordis_inspect what:"client"` 可查每 key 的 "cardinality, scope, owner props, standard props, current occupants, declaration owner, and **replacement risk**"（`docs/subsystems/slots.md:166`；生成器 `scripts/gen-client-catalog.ts`）。
- standard kit hooks：`useConversation`、`useInput`、`inputActions`（`ui-conversation`，`contract/slots.ts:181-197`）、`useChat`（ui-chat）、`useSession/useProjection/useSessions`（ui-session）——"available according to the target slot's scope, independent of which package registered the component"（`docs/subsystems/slots.md:79-92`）。
- **`InputActions` 是公开 API**（`packages/client/ui-conversation/src/client/contract/input.ts:229-240`）：`setDraft(text)` / `addAttachments` / `removeAttachment` / `pruneAttachments` / `submit()`。**插件可以编程读写草稿并触发提交，完全不用碰编辑器实例。**

**私有内部（明确不可跨插件边界）**：
- `ComposerKeyboard`（携带 **Lexical editor 实例**、caretSpan、arbitrate 等）：`contract/input.ts:249-256` 注释原文 "**InputBar-exclusive … package-internal, never across a plugin boundary**"。第三方插件拿不到 Lexical editor。
- composer 的 DOM 结构/class 名：`css.card`、`css.scroll`、`data-composer-card`、`data-composer-input`、`data-input-scroll`、`data-composer-placeholder` 等（`InputBar.tsx:408-459`）都是包内 CSS Modules 哈希类 + 少量 data 钩子，无稳定性承诺；CSS Modules 类名构建期哈希，DOM 增强式 hack 极脆。
- 各 `ChatNodeKind` 的 `node.data` 形状随 ui-chat 版本演化（developer preview）。

### 6.2 「替换输入框」的三条官方路径与代价

| 路径 | 机制 | 代价/风险 |
|---|---|---|
| A. chain 接管 | `ctx.slots.inject('conversation.composer', () => ctx.slots.register({ name, select: () => <非null>, priority }, MyComposer))` | 先例充分（§5.2）；`overlay:true` 使内置条保活隐藏、草稿状态幸存（`ui-slots/src/index.ts:238-249`）。**但接管期间内置工具行（input.left/right/model/plan）与附件栏全部隐藏**——因为它们是 fallback 的子 slot。与 approval/questions 抢占时按 priority 竞争。 |
| B. shadow `conversation.composer.bar` | `single` slot 的 priority 影子替换：同 cell 不同 priority 共存、**最低 priority 者渲染**（`ui-slots/src/index.ts:830-855`；文档 `slots.md:58` "intentionally reusing a shipped cell replaces its presentation"）。对 shipped(默认 0) 注册更低 priority 即永久替换内置 InputBar。 | 新占据者**拿不到** shipped entry 声明的子 slot 渲染权（声明授权归 declaring entry，`ui-slots/src/index.ts:147`），需自行重实现工具行/附件栏；官方把它列为"replacement point"但无先例插件这么做。 |
| C. DOM 增强（挂 DOM/改样式） | 无官方 API；只能赌 `data-composer-card`/`data-composer-input` 等 data 属性 | **最不稳定**：CSS Modules 哈希类、内部重构无预告、React 重渲染可能移除注入节点。仅作为最后手段。 |

### 6.3 最小侵入挂载点建议（按侵入度升序）

1. **纯附加增强（推荐起点）**：`conversation.input.dock`（卡片上方整行，可放 Markdown 工具条/模板栏）或 `conversation.composer.dock`（下方）。list slot、加新 `id` 即可、零冲突（`contract/slots.ts:153,157`）。工具行小按钮用 `conversation.input.left` / `conversation.input.right`（`InputBar.tsx:504,509`）；卡片内浮动预览用 `conversation.input.overlay`（`InputBar.tsx:416`）。
2. **草稿操作走公开 API**：增强面板通过 standard kit 的 `useInput`（读 `InputState.draft`、`attachmentIds`、`phase`、`queue`）+ `inputActions.setDraft()/submit()` 完成读写与发送——不需要、也拿不到 Lexical editor。
3. **需要整体换输入体验时**：走 `conversation.composer` chain 接管（有 3 个官方先例），并自渲染所需的子面；或 B 路径 shadow `conversation.composer.bar`（重型方案，需自带工具行）。
4. **用户消息 Markdown 化（聊天记录侧）**：注册 `conversation.chat.node` key=`user` 的 renderer 替换内置 `UserMessageNodeView`（`register-node-renderers.ts:19`），复用 `@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownText`（基线模块，`platform.ts:12`，**免费 import**）——这是把"已发送用户消息渲染成 Markdown"的正规路径；注意该 cell 是 keyed 替换点（官方文档视为合法替换，`slots.md:175`），且 `node.data` 形状（`UserMessageNode`，content: text/image/file blocks）需跟随版本。
5. **发布通道**：静态包 = loader 配置/cordis patch 挂进组合（`packages/bundle/web-app/cordis.patch.yml` 为官方示例层）；另外存在**动态插件通道**——agent 运行时经 `cordis_define`/`cordis_run` 装载 client 半（`packages/preset/agent-presets/presets/cordis/skills/cordis-plugin-development/SKILL.md`，client 代码必须是 `React.createElement`、无 JSX/构建器）。

### 6.4 残留不确定性

- `conversation.composer.bar` 的 priority 影子替换（路径 B）无仓库先例，children 授权归属行为基于 `SlotCore` 源码推断（声明跟随 entry 存活，`ui-slots/src/index.ts:902-920,1160-1180`），未做运行时验证。
- 官方文档站 `deepseek-harness.github.io/deepseek-harness/` 未单独抓取；本文所有 [文档] 引用均来自仓库内 `docs/`（与文档站同源，README.md:11）。
- 版本风险：v0.1.3-alpha.1，README 明示兼容性破坏变更可能随时发生；slot 面虽类型化且自检工具齐全，但 key 集合本身可能增删。
