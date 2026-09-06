# dsh-markdown-input

[English](#english) | [中文](#中文)

<a id="english"></a>

## English

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) web-UI plugin that upgrades the chat composer for Markdown:

- **Composer takeover** — the input box becomes a Markdown live editor (Obsidian-style: markers visible on the active line, folded elsewhere). Built-in takeover panels (approvals, questions, subagent) keep precedence.
- **Render / source mode toggle** — fold markers for writing, or see the raw source; the choice persists in the browser.
- **Raw Markdown is what gets sent** — the rendering is purely visual; the model receives the Markdown source.
- **Markdown-rendered user messages** — sent user messages render as Markdown in the chat history (reusing the host's own renderer), with `@`-mention and skill chips preserved.
- **Paste conversion** — `text/html` clipboard content converts to clean Markdown; `Ctrl/Cmd+Shift+V` pastes the plain flavor untouched.

> **Status: alpha, under active development.** dsh itself is a developer preview with compatibility-breaking changes; this plugin tracks the `0.1.2-rc.x` line of `@deepseek-ai/dsh-*` packages and is re-tested against upstream master.

### Install

```sh
dsh plugin --profile web add dsh-markdown-input   # npm (once published)
dsh plugin --profile web add github:long6177/dsh-markdown-input
```

### Config

| Field | Type | Default | Description |
|---|---|---|---|
| `defaultMode` | `'render' \| 'source'` | `'render'` | Editing mode the composer opens in. |

### License

[MIT](./LICENSE)

---

<a id="中文"></a>

## 中文

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）Web UI 插件，为聊天输入区带来 Markdown 体验：

- **输入区接管** —— 输入框变为 Markdown 实时编辑器（Obsidian 式：光标所在行保留语法标记，移开后折叠）。内置接管面板（审批、提问、子代理）按优先级正常抢占。
- **渲染 / 源码模式切换** —— 写作时折叠标记，需要时查看原始源码；选择持久化在浏览器中。
- **发送的是原始 Markdown 源码** —— 渲染只是视觉层，模型收到的是 Markdown 源码。
- **用户消息 Markdown 化** —— 已发送的用户消息在聊天记录中按 Markdown 渲染（复用宿主自带渲染管线），并保留 @提及 与技能引用 chip。
- **粘贴转换** —— 剪贴板 `text/html` 富文本自动转为干净 Markdown；`Ctrl/Cmd+Shift+V` 直插纯文本原文。

> **状态：alpha，积极开发中。** dsh 本身处于 developer preview、存在破坏性变更；本插件跟随 `@deepseek-ai/dsh-*` 的 `0.1.2-rc.x` 版本线，并对上游 master 持续重测。

### 安装

```sh
dsh plugin --profile web add dsh-markdown-input   # npm（发布后）
dsh plugin --profile web add github:long6177/dsh-markdown-input
```

### 配置

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `defaultMode` | `'render' \| 'source'` | `'render'` | 输入区打开时的编辑模式。 |

### 协议

[MIT](./LICENSE)
