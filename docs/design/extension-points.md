# dsh Web UI 插件扩展点调研 —— 输入区与消息渲染面

dsh（DeepSeek Harness）的 Web UI 是一套可组合的插件架构：官方界面本身由一组内置 UI 包拼装而成，第三方插件与它们走同一套注册面。本文是该架构面向「输入区增强」这一场景的技术底册——上游允许插件改什么、怎么改、每条路的代价是什么；本仓库的接管与编辑器决策（[ADR-0001](../adr/0001-cm6-obsidian-style-editor.md)、[ADR-0002](../adr/0002-composer-chain-takeover.md)、[ADR-0005](../adr/0005-composer-revival.md)）均以本文为依据，工具行弹层的重建规格见 [native-surfaces-rebuild](native-surfaces-rebuild.md)，与主流聊天产品输入区行为的对照见 [prior-art](prior-art.md)。

- **来源**：dsh-markdown-input 维护者整理。初稿 2026-09-06（对照上游 `v0.1.3-alpha.1`）；2026-10-07 对照上游 tag [`dsh-v0.2.0-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases)（commit `639ed01`）逐项复核后入库。
- **方法**：上游源码一手核对（文件路径 + 行号）与上游仓库内官方文档（`docs/`、`packages/*/AGENTS.md`、包 README）交叉印证；文档站与仓库内 `docs/` 同源（上游 `README.md:9-11`）。
- **标注约定**：**[源码证实]** = 上游源码 `路径:行号`；**[文档]** = 上游仓库内官方文档；**[文档推断]** = 文档描述但未逐行核实源码。
- **时效**：上游处于 developer preview，官方 README 明示 "THERE WILL BE COMPATIBILITY-BREAKING CHANGES"（`README.md:13`）。本文行号以 `dsh-v0.2.0-rc.2` 为基准，后续版本会漂移。

---

## 1. Web UI 技术栈与输入区组件

### 1.1 技术栈 [源码证实]

| 层 | 技术 | 证据 |
|---|---|---|
| 前端框架 | **React 18**（`react@^18.2.0`，函数组件 + `useSyncExternalStore`） | `apps/web/package.json:57-58` |
| 构建工具 | **Vite 6**（`apps/web` 打包 shell），库构建用 **tsdown** | `apps/web/package.json:25`（`"build": "vite build"`）；各 `packages/client/*` 的 `tsdown.config.ts` |
| 浏览器运行时 | **Cordis 应用**（`@deepseek-ai/cordis`，整个 Web UI 是一个由插件组合的 Cordis client fiber 树） | `docs/subsystems/web-client.md:5`（"browser-side Cordis application assembled from independently loaded plugins"） |
| 样式方案 | **CSS Modules**（`.module.css`）+ 主题 token（`--dsh-*` / `--dsw-*` CSS 变量） | `packages/client/ui-conversation/src/client/skeleton/InputBar.module.css`；`packages/client/ui-chat/src/client/chat/MessageItem.module.css:36-39` |
| 共享模块基线 | `PLATFORM_MODULES = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit']` | `packages/client/web/src/platform.ts:8-13` |

基线模块表对插件作者的含义：`react`、`cordis`、`ui-slots`、`ui-primitives`（含 `MarkdownText` 等渲染原语）是宿主共享的种子模块，插件引用它们**不增加 bundle 体积**；其余第三方实现库默认私有打包（见 §4.1 第 5 条）。

### 1.2 消息输入区（composer）用什么组件 [源码证实]

**不是原生 textarea，不是 CodeMirror，而是 shell 自有的 Lexical 编辑器绑定到一个 contenteditable div 上。**

- 入口组件：`InputBar`（`conversation.composer.bar` slot 的默认占据者），文件 `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx`。头注释（9-13 行）："The text surface is the shell-owned **Lexical editor** bound here through ComposerContentEditable; chips render as decorator portals, and the keymap registers submit/menu/paste gestures on the editor command layer."
- 编辑面挂载链：`InputBar.tsx:32` 引入 `DraftEditor` → `input/editor/DraftEditor.tsx:38-40` 渲染 `<ComposerContentEditable editor={...} editable={editable}>` → `ComposerContentEditable.tsx:31` 把 Lexical editor `setRootElement()` 到一个 `<div contentEditable role="textbox" aria-multiline="true" data-composer-input>` 上（`data-composer-input` 属性在 46 行）。
- Lexical 依赖：`packages/client/ui-conversation/package.json:87-96` —— `@lexical/history`、`@lexical/plain-text`、`@lexical/text`、`@lexical/utils`、`lexical`（均 `^0.49.0`）；另有 devDep `@lexical/headless`。
- 附属机制：
  - placeholder 是兄弟 div（`data-composer-placeholder`，`DraftEditor.tsx:55`）；
  - 单滚动容器注释 "One scrollport, one text surface"（`InputBar.tsx:398`）；
  - chip/装饰器经 decorator portals 渲染，键位注册在编辑器命令层。
- **composer 文本面是纯文本编辑**：`ui-conversation` 包内没有任何对草稿做 Markdown 渲染的依赖（`package.json` 无 markdown/micromark 类依赖）；草稿只以字符串进入 `InputState.draft`。

---

## 2. UI 插件 API 全貌

### 2.1 三类注册面 [源码证实 + 文档]

均在浏览器半的 client context 上：

1. **`ctx.slots.register(options, component)`**：向一个已声明的 slot 贡献 React 组件。类型定义：`packages/client/ui-slots/src/index.ts`（`SlotMap` 在 26 行；`SlotCore.register` 在 1203 行，同 key 同 priority 的二次注册会抛错、不同 priority 即影子替换，1211-1231 行）。
2. **`ctx.slots.inject(key, callback)`**：向**别的包声明**的 slot 安全贡献——回调在声明存活期内运行、声明坍塌时回收、重声明时重跑。[文档] `docs/subsystems/slots.md:19`；扩展规则同文件 195 行："Declare a new child slot only in the component that owns and renders that location. Other packages wait with `ctx.slots.inject()`."
3. **`ctx.uiConversation.events.register(definition)`**：注册 `ConversationNodeDefinition`（事件 → 视图节点状态机）。[源码证实] `packages/client/ui-conversation/src/client/conversation/event-registry.ts:5,13`；接口 `packages/client/ui-conversation/src/client/contract/conversation.ts:196` 起。

### 2.2 全部 slot id（声明树快照）[源码证实]

类型来源（`declare module '@deepseek-ai/dsh-client-ui-slots'` 的 `SlotMap` 合并）：

- `packages/client/ui-conversation/src/client/contract/slots.ts`
- `packages/client/ui-chat/src/client/contract/slots.ts`
- `packages/client/ui-approval/src/client/contract/slots.ts`
- `packages/client/ui-settings/src/client/contract/slots.ts`、`ui-settings-models/src/client/slot-contract.ts` 及 `ui-settings-*` 包族
- `packages/client/ui-sidebar/src/client/contract/slots.ts`
- `packages/client/ui-layout/src/client/index.ts`
- `packages/client/ui-renderer/src/client/registry.ts`
- `packages/client/ui-tool/src/client/contract/slots.ts`
- `packages/client/ui-workspace/src/client/contract/slots.ts`
- `packages/client/ui-trajectory/src/client/trajectory-contract.ts`
- `packages/extensions/ui-cordis/src/client/slots.ts`

官方声明树见 `docs/subsystems/slots.md`「Current hierarchy」一节（109 行起）；权威的逐 key 清单用官方自检工具生成：`cordis_inspect what:"client"` 可查每个 key 的 cardinality、scope、owner props、standard props、当前占据者与 replacement risk（`slots.md:190`；目录由 `scripts/gen-client-catalog.ts` 生成）。

**与输入区相关的 slot 语义**（`packages/client/ui-conversation/src/client/contract/slots.ts`）[源码证实]：

| slot id | kind/scope | 语义 | 行号 |
|---|---|---|---|
| `conversation.composer` | chain / session | **"Selector-routed replacements for the current Session's resident composer"**——整体替换输入区的选举链 | 187 |
| `conversation.input.dock` | list / session | "Full-width entries above the composer card"（卡片上方整行） | 195 |
| `conversation.input.overlay` | list / session | "Floating entries rendered inside the resident composer card"（卡内浮动） | 197 |
| `conversation.composer.dock` | list / session | "Ambient entries below the composer card"（卡片下方） | 199 |
| `conversation.input.left` | list / session | "Compact controls at the left of the composer tool row" | 201 |
| `conversation.input.right` | list / session | "Compact controls before the composer submit action" | 203 |
| `conversation.input.activity` | single / session | "Compact action after the model selector; it can expand across the toolbar…"（0.2.0 新增座位） | 205 |
| `conversation.composer.bar` | single / session-maybe | **"Resident composer body, including the no-Session inert state"**——composer 本体（默认占据者 = 内置 `InputBar`） | 207 |
| `conversation.input.attachments` | single / session-maybe | "Optional draft-attachment rail and drop target"（可替换附件栏） | 209 |
| `conversation.input.plan` | single / session | 工具行内的 Plan 控件（可替换） | 215 |
| `conversation.input.permission` | single / session | 工具行内的权限预设控件（可替换） | 217 |
| `conversation.input.model` | single / session | 工具行内的模型选择器（可替换；占位说明附带 `--dsh-composer-model-text-display` 等收缩约定） | 223 |

声明位置（谁声明了这些子 slot）[源码证实]：

- `conversation` 根 entry 声明 `conversation.composer`、`conversation.composer.bar`、`conversation.input.dock` 等：`packages/client/ui-conversation/src/client/apply.ts:315-317`
- `conversation.composer.bar` entry（内置 InputBar）声明 `input.attachments/overlay/permission/left/plan/right/model/activity`、`composer.dock`：`apply.ts:421-432`
- 渲染点：链在 `skeleton/ConversationContent.tsx:172-176`；`input.dock` 在 `ConversationContent.tsx:167`；各子 slot 在 `InputBar.tsx:383`（overlay）、386（attachments）、443（permission）、444（plan）、448（left）、454（right）、455（model）、458（activity）、501（composer.dock）

### 2.3 `conversation.composer` 选举链 [源码证实]

- 选举规则：每个 entry 提供纯函数 `select(owner)`（owner = `ComposerChainProps = { sessionId, session, pendingInteraction }`），priority 升序尝试、默认 0、低者先试，第一个非 null 返回者当选并把结果作为 `matched` prop 注入；全部拒绝则渲染 owner fallback（`packages/client/ui-slots/src/index.ts:284-296` 的 `ChainSelect` 约定）。
- 关键的 `overlay: true` 选项（`ChainRenderOpts`，`ui-slots/src/index.ts:269-282`；注释原文在 274-280 行）："Keep the fallback permanently mounted: an election hides it (wrapped, display:none) instead of unmounting it … fallback-held state (**composer drafts**, DOM state) survives a takeover. Chain kind only; **the sole consumer is the `conversation.composer` chain**."
- 内置 dispatch 点：`packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx:172-176`：

```tsx
const composer = renderSlotChain(
  'conversation.composer',
  { sessionId, session, pendingInteraction },
  { fallback: composerBar, fallbackOnly: sessionId === undefined, overlay: true },
)
```

### 2.4 `ConversationNodeDefinition` + keyed Chat renderer 控制什么 [源码证实]

**控制的是「消息 / 聊天记录渲染」，与输入区无关。**

- 接口：`packages/client/ui-conversation/src/client/contract/conversation.ts:196` 起 —— `kind` / `target?` / `match(event)`（恒等提取器，返回 `{id, role: 'start'|'update'} | null`）/ `start(context, match, reader)` / `update(context, match)` / `publication?` / `buildLocationData?` / `buildViewNode?`。
- keyed Chat renderer：`conversation.chat.node` 是 `kind:'keyed'` slot，`keyProps` 按 `ChatNodeKind` 供给 `{ node }`（`packages/client/ui-chat/src/client/contract/slots.ts:290-297`）。注册渲染器 = `ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: '<ChatNodeKind>' }, Component))`。
- 内置 renderer 注册表：`packages/client/ui-chat/src/client/chat/register-node-renderers.ts`（`user` 31 行、`steering` 33 行、`assistant-step` 42 行，另有 `command`、`compaction`、`model-retry`、`turn-error` 等 kind）。
- 事件来源：`ui-conversation` 把 Client 的 `SessionEventLikeEntry` 窗口（durable `session/event` 历史 + Client-only `assistant/live-chunk` 瞬态）喂给 assembler；**浏览器插件不直接监听 `session/event`，而是通过 Definition 间接消费**。[文档] `docs/subsystems/conversation.md:11`。
- **`session/event` 的直接监听（宿主半）**：`ctx.on('session/event', (_session, event) => {...})`，官方 cookbook 示例 `docs/cookbook/extension-cookbook.md:79`；官方对照表（同文件 129 行）："Web Client Chat business node → register a `ConversationNodeDefinition` and `conversation.chat.node` keyed renderer"。
- 浏览器半的事件进入：`ctx.remote.$on('<event>', handler)`（Connection `$events` 逻辑流转发；waterfall 监听器可返回结果 / `next()` / reject）——[文档] `docs/subsystems/web-client.md:34`；实例 [源码证实]：`packages/client/ui-approval/src/client/index.ts:104`（`ctx.remote.$on('approval/request', …)` 应答审批）、`packages/client/ui-user-questions/src/client/index.ts:400`。

---

## 3. 用户消息是否已按 Markdown 渲染？[源码证实：否]

### 用户消息 = 纯文本 + 引用 chip，**未渲染 Markdown**

- 渲染代码：`packages/client/ui-chat/src/client/chat/MessageItem.tsx:221-222`：

```tsx
{showBubble && <div className={css.bubble}>
  {projectUserText(text, referenceLabels, skillNames, 'skill', references)}
  ...
</div>}
```

- `projectUserText`：`packages/client/ui-primitives/src/user-text.tsx`（头注释 1-19 行明确其职责仅为 "Display projection of reference forms in sent user text"）——四类装饰：会话 wire 形式 `@[label](dsh-session:...)` 折叠、`@label` 提及、`@name` 形状匹配、已加载技能的 `/name`。**其余文字一律按 plain run 输出，没有任何 Markdown 解析**（该文件不 import 任何 markdown 库）。
- CSS 佐证：气泡是 `white-space: pre-wrap; word-break: break-word`（`packages/client/ui-chat/src/client/chat/MessageItem.module.css:38-39`，36 行注释 "The projected user text is inline runs"）。
- 排队 steering 消息同样走 `projectUserText`（`MessageItem.tsx:242` 起 `PendingSteeringBubble` → `UserStyleBubble`）。

### 助手消息 = 完整 Markdown 渲染（GFM + 数学公式，流式增量）

- 渲染链：`chat.node(key='assistant-step')`（`register-node-renderers.ts:42`）→ `AssistantNodeView.tsx:33` → `AssistantMarkdown.tsx:54` → **`MarkdownText`**（`@deepseek-ai/dsh-client-ui-primitives`）。
- `MarkdownText` 实现：`packages/client/ui-primitives/src/markdown/MarkdownText.tsx`（1-13 行头注释："Untrusted assistant-Markdown renderer over the direct mdast pipeline … streaming"；流式时除尾部外所有块冻结为缓存的 React 元素、仅重解析尾部）；底层是 **micromark / mdast 自装管线**，非 react-markdown：`packages/client/ui-primitives/package.json` 依赖 `mdast-util-from-markdown`（48 行）、`micromark-extension-gfm`（51 行）、`micromark-extension-math`（47 行；KaTeX：`MarkdownText.tsx:24` `import 'katex/dist/katex.min.css'`）。

**对 dsh-markdown-input 的意义**：发送后的用户消息在上游聊天记录里是纯文本气泡。「用户消息 Markdown 化」只能通过替换用户消息渲染器（`conversation.chat.node` key=`user`，见 §6.3 第 4 条）在渲染端实现；输入端（发送前）的实时渲染则属于 composer 文本面，是本插件的核心命题。

---

## 4. 「宿主 / 浏览器双半结构」

### 4.1 打包与注入 [源码证实 + 文档]

一个 UI 插件 = 一个普通 Cordis 包 + 一个浏览器半 bundle：

1. **package.json 特殊字段 `dsh.client`** [文档，`packages/client/AGENTS.md:144`]：
   ```jsonc
   "dsh": {
     "client": {
       "platform": "web",            // 必填，恒为 'web'；声明必须带 ./client 导出，扫描否则抛错
       "inject": ["@deepseek-ai/dsh-client-ui-session", ...],  // 仅信息性依赖边（预检显示 / HMR diff），不决定激活顺序
       "immediately": true,          // 可选：第一阶段预取（仅基础设施行）
       "external": ["..."]           // 可选：基线之外的精确模块请求
     }
   }
   ```
   扫描 / 校验实现：`packages/client/modules/src/index.ts`（`dsh.client.external` 行校验在 517 行附近）；语义文档 `packages/client/AGENTS.md:144`。
2. **bundle 出口**：`exports["./client"]` 指向构建产物（约定 `lib/client.js`）[源码证实，`packages/client/ui-jobs/package.json:13-15`]。宿主服务的是**构建后**的 bundle："the registry serves `lib/client.js`, not sources"（`packages/client/AGENTS.md:146`）。
3. **注入方式 = `<script>` 组合脚本，非 iframe** [文档 + 源码证实]：宿主扫描启用的包 → 组合 `WebBootGraph` → 渲染 index 时注入 `<head>`：`window.__ModuleLoader__` 队列 facade、应用 combo 的 preload、parser-blocking bootstrap 脚本、然后 `window.__DSH_BOOT__` 图全局（`<` 转义防脚本逃逸）→ Vite 入口。`docs/subsystems/client-modules.md:11,80`；`packages/client/modules/README.md`（"Lazy-CJS model" 节 66 行起）。
4. **bundle 运行模型 = lazy-CJS**：执行 bundle 只注册 factory；materialize 时才以同步 `require` 运行模块体（CSS 注入等副作用也在 factory 闭包里）[文档，`packages/client/modules/README.md:66-68`]。
5. **共享模块**：动态 bundle 的 externals 对着 `PLATFORM_MODULES` 冻结表解析（§1.1）；第三方实现库可私有打包（"Silence means a private copy"，`packages/client/AGENTS.md:80`）。`dsh.client.external` 明确**不是** feature 插件的依赖机制。
6. **bundle 路由**：`GET /plugins/??<pkg-a>/client.js,<pkg-b>/client.js&rev=<rev>`，immutable 缓存，Indexed Source Map v3，URL ≤3KiB 分片 [文档，`docs/subsystems/client-modules.md:76`；`packages/client/modules/README.md:74`]。
7. **HMR**：dev 下 `dsh-client-hmr` 轮询 bundle → `rebuilt(id)` 重散列 → 通知浏览器半按 rev 换 URL [文档，`docs/subsystems/client-modules.md:106-108`]。

### 4.2 宿主半 ↔ 浏览器半如何通信 [源码证实 + 文档]

- 两个半都是 Cordis context，但**运行在不同进程**（Node / browser），通过 API Gateway（WebSocket `/api` 载体）连接：
  - **浏览器→宿主调用**：Typert `@Remote` 装饰的生成方法挂到 `ctx.remote.<namespace>.<method>()`（`docs/subsystems/web-client.md:30`）。
  - **宿主→浏览器事件**：`ctx.remote.$on('<event>', handler)`；普通事件转发到根 Client Context，waterfall 事件路由到对应 Session Context，监听器返回结果 / `next()` / reject（`web-client.md:34`）。
  - 实例 [源码证实]：`packages/client/ui-approval/src/client/index.ts:104`；`packages/client/ui-user-questions/src/client/index.ts:400`。
- **数据获取**：slot 的 standard props 已携带 Conversation / Input 快照（见 §2.2 表与 `docs/subsystems/slots.md:79-97` 的 standard-kit hooks 表）；官方开发指引（`packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md`）与 `docs/subsystems/slots.md` 均要求优先使用 slot props 自带的面，而不是绕道 Host 再取一遍。
- 动态（运行时生成的）插件另有 `ctx.dynamicCordisRunner`：`define/run/getClientCode/invoke/reportRenderFailure/...`（`docs/subsystems/extensions.md:70-234`），client 半 runner 为 `packages/extensions/cordis-client-runner`。

---

## 5. UI 插件官方示例（上游仓库内）

### 5.1 最小 UI 插件：`ui-jobs`（双半）[源码证实]

`packages/client/ui-jobs/`：

- 宿主半 `src/index.ts:10-11`：**空 apply**（"Loader-visible no-op body; the browser half carries the feature" ——空壳只为让插件出现在宿主 Loader / cordis.yml 中）。
- 浏览器半 `src/client/index.ts`：

  ```ts
  export const inject = ['jobs', 'slots', 'locale']          // 27 行
  export function apply(ctx: ClientContext): void {          // 34 行
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-jobs: dictionaries')
    ctx.slots.inject('conversation.session.header.actions', () =>
      ctx.slots.register({ name: 'conversation.session.header.actions', id: 'job-list', order: 20, locale: NS }, JobListAction))
  }
  ```

- package.json：`dsh.client = { inject: [...], platform: 'web' }`（56-64 行）+ `exports["./client"]`（13-15 行）。

### 5.2 composer 整体替换先例（**官方已有触碰输入区的插件，不止一个**）[源码证实]

- **`ui-approval`**（审批面板接管 composer）：`packages/client/ui-approval/src/client/index.ts:91-100` —— `ctx.slots.inject('conversation.composer', () => ctx.slots.register({ name: 'conversation.composer', priority: 1, select: ({pendingInteraction}) => pendingInteraction instanceof PendingApproval ? pendingInteraction : null, ... }, ApprovalPanel))`。
- **`ui-user-questions`**（提问面板接管 composer）：`packages/client/ui-user-questions/src/client/index.ts:382-386` —— 同模式，`select` 匹配 `PendingQuestion`。
- **`ui-subagent`**：`packages/client/ui-subagent/src/client/index.ts:96-98` 也注册 `conversation.composer`（子代理只读 composer）。
- 三者都是**条件性接管**（pending 时替换、其余时候让 fallback 出示）。这正是选举链 + `overlay: true` 的设计意图：fallback（含草稿状态）保活隐藏，接管结束后无缝还原（§2.3）。

### 5.3 消息渲染贡献的官方完整 worked example [文档]

`docs/subsystems/conversation.md:64-240`：从 `SessionEventMap` 声明合并（宿主 emit `review/start|progress|end`）、`ChatNodeDataMap` 合并、`ConversationNodeDefinition`（match/start/update/publication/buildLocationData/buildViewNode），到 `ctx.uiConversation.events.register(reviewDefinition)` + `ctx.slots.inject('conversation.chat.node', …)` 的端到端示例（238-240 行）。

### 5.4 slot 贡献的官方最小示例 [文档]

`docs/subsystems/slots.md:21-45`（给 `conversation.session.header.actions` 加一个按钮）。

---

## 6. 稳定性评估与挂载点选择

### 6.1 稳定面 vs 私有面 [源码证实]

**稳定面（官方插件契约，跨包可依赖）**：

- `SlotMap` 全部 slot key、kind、scope、owner props（TS 类型随包发布，`contract/slots.ts`）；官方提供运行时自检：`cordis_inspect what:"client"` 可查每 key 的 "cardinality, scope, owner props, standard props, current occupants, declaration owner, and **replacement risk**"（`docs/subsystems/slots.md:190`；生成器 `scripts/gen-client-catalog.ts`）。
- standard kit hooks：`useConversation`、`useInput`、`inputActions`（ui-conversation）、`useChat`（ui-chat）、`useSession/useProjection/useSessions`（ui-session）——"available according to the target slot's scope, independent of which package registered the component"（`docs/subsystems/slots.md:79-97`）。
- **`InputActions` 是公开 API**（`packages/client/ui-conversation/src/client/contract/input.ts:222-241`）：`captureInsertion()` / `insertText(text, span)` / `setDraft(text)` / `addAttachments` / `removeAttachment` / `pruneAttachments` / `submit()`。**插件可以编程读写草稿、插入文本并触发提交，完全不用碰编辑器实例。**（0.2.0 线在早期版本基础上新增了版本守卫的 `captureInsertion`/`insertText`——插入不再惧怕并发编辑竞态。）
- `SessionInput` facade 另带 `notify(level, text)`、`focus()` 与 `state` 快照（`input.ts`，紧邻 `InputActions` 之前）。

**私有内部（明确不可跨插件边界）**：

- `ComposerKeyboard`（携带 **Lexical editor 实例**、caretSpan、arbitrate 等）：`packages/client/ui-conversation/src/client/contract/draft-editor.ts:29-37` 注释原文 "**InputBar-exclusive … Handed to the composer-bar entry through its own inject — package-internal, never across a plugin boundary**"。第三方插件拿不到 Lexical editor。
- composer 的 DOM 结构 / class 名：`data-composer-card`、`data-composer-input`、`data-composer-placeholder` 等（`InputBar.tsx:378`、`ComposerContentEditable.tsx:46`、`DraftEditor.tsx:55`）都是包内 CSS Modules 哈希类 + 少量 data 钩子，无稳定性承诺；CSS Modules 类名构建期哈希，DOM 增强式 hack 极脆。
- 各 `ChatNodeKind` 的 `node.data` 形状随 ui-chat 版本演化（developer preview）。

### 6.2 「替换输入区」的三条官方路径与代价

| 路径 | 机制 | 代价 / 风险 |
|---|---|---|
| A. 选举链接管 | `ctx.slots.inject('conversation.composer', () => ctx.slots.register({ name, select: () => <非null>, priority }, MyComposer))` | 先例充分（§5.2）；`overlay:true` 使内置条保活隐藏、草稿状态幸存（`ui-slots/src/index.ts:274-280`）。**但接管期间内置工具行（input.left/right/model/plan/activity/permission）与附件栏全部隐藏**——因为它们是 fallback（InputBar）声明并渲染的子 slot。与 approval / questions 抢占时按 priority 竞争。 |
| B. 影子替换 `conversation.composer.bar` | `single` slot 的 priority 影子替换：同 cell 不同 priority 共存、**最低 priority 者渲染**（`ui-slots/src/index.ts:1211-1214`；文档 `slots.md:60` "intentionally reusing a shipped cell replaces its presentation"）。对 shipped（默认 0）注册更低 priority 即永久替换内置 InputBar。 | 新占据者**拿不到** shipped entry 声明的子 slot 渲染权（官方规则：子 slot 只能由拥有并渲染该位置的组件声明，`slots.md:195`），需自行重实现工具行 / 附件栏；官方把它列为 replacement point 但仓库内无先例插件这么做。 |
| C. DOM 增强（挂 DOM / 改样式） | 无官方 API；只能赌 `data-composer-card` / `data-composer-input` 等 data 属性 | **最不稳定**：CSS Modules 哈希类、内部重构无预告、React 重渲染可能移除注入节点。仅作最后手段。 |

### 6.3 挂载点建议（按侵入度升序）

1. **纯附加增强（推荐起点）**：`conversation.input.dock`（卡片上方整行，可放 Markdown 工具条 / 模板栏）或 `conversation.composer.dock`（下方）。list slot、加新 `id` 即可、零冲突（`contract/slots.ts:195,199`）。工具行小按钮用 `conversation.input.left` / `conversation.input.right`（渲染点 `InputBar.tsx:448,454`）；卡内浮动预览用 `conversation.input.overlay`（`InputBar.tsx:383`）。
2. **草稿操作走公开 API**：增强面板通过 standard kit 的 `useInput`（读 `InputState.draft`、`attachmentIds`、`phase`、`queue`）+ `inputActions.setDraft()/insertText()/submit()` 完成读写与发送——不需要、也拿不到 Lexical editor。
3. **需要整体换输入体验时**：走 `conversation.composer` 选举链接管（有 3 个官方先例，§5.2），并自渲染所需的子面；或 B 路径影子替换 `conversation.composer.bar`（重型方案，需自带工具行）。本插件选择 A 路径的理由与硬化约束见 [ADR-0002](../adr/0002-composer-chain-takeover.md) 与 [ADR-0005](../adr/0005-composer-revival.md)；接管后需要重建的工具行弹层逐件规格见 [native-surfaces-rebuild](native-surfaces-rebuild.md)。
4. **用户消息 Markdown 化（聊天记录侧）**：注册 `conversation.chat.node` key=`user` 的 renderer 替换内置 `UserMessageNodeView`（`register-node-renderers.ts:31`），复用 `@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownText`（基线模块，`platform.ts:8-13`，**免费 import**）——这是把"已发送用户消息渲染成 Markdown"的正规路径；注意该 cell 是 keyed 替换点（`slots.md:60`），且 `node.data` 形状需跟随版本。
5. **发布通道**：静态包经宿主 loader 配置 / cordis patch 挂进组合（`packages/bundle/web-app/cordis.patch.yml` 为官方示例层）；另外存在**动态插件通道**——agent 运行时经 `cordis_define` / `cordis_run` 装载 client 半（`docs/subsystems/extensions.md:70-234`）。npm 发布 + 桌面端插件管理 UI 安装是面向第三方分发的一般路径（本仓库的发布仪式见 [ADR-0004](../adr/0004-npm-release-remote-feedback-loop.md) 与[发布序操作文档](../agents/release.md)）。

### 6.4 残留不确定性

- 路径 B（影子替换 `conversation.composer.bar`）在仓库内无插件先例；"子 slot 渲染权不随影子替换转移"如今有文档背书（`slots.md:195`），但影子替换场景下的运行时行为未做专门验证。
- 上游版本风险：`0.2.0-rc.2` 仍为 developer preview，slot 面虽类型化且自检工具齐全，但 key 集合与 `node.data` 形状可能增删。上游新版本的跟进以逐版真机重测收口（清单索引见 [docs/release/README.md](../release/README.md)），术语见 [CONTEXT.md 词汇表](../../CONTEXT.md)。

---

## 相关文档

- 决策记录：[ADR-0001 编辑器选型](../adr/0001-cm6-obsidian-style-editor.md) · [ADR-0002 选举链接管](../adr/0002-composer-chain-takeover.md) · [ADR-0005 接管卡复活](../adr/0005-composer-revival.md) · [ADR-0006 hero 座位重建](../adr/0006-hero-seats-in-card-rebuild.md)
- 同级深文：[native-surfaces-rebuild](native-surfaces-rebuild.md)（工具行弹层重建规格） · [prior-art](prior-art.md)（ChatGPT 输入区 Markdown 行为对照）
- 验证：每版真机验收清单索引见 [docs/release/README.md](../release/README.md)
- 术语：[CONTEXT.md 词汇表](../../CONTEXT.md)
