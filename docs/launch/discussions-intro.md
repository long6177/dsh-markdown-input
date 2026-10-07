<!--
  状态：草稿，待维护者审阅，未发布（#37 人工节点）。
  渠道：deepseek-ai/deepseek-harness 官方 Discussions
  分类：Show Your Plugins!
  发布序：repo topics 设好 → awesome 收录 PR 提交 → 本帖
  发布前：把下方「素材位」注释替换为实际 hero GIF / 截图（素材票产出后接入）
-->

## 标题

dsh-markdown-input — Markdown live rendering in the composer and chat history (alpha, tested on 0.2.0-rc.2)

## 分类

Show Your Plugins!（deepseek-ai/deepseek-harness Discussions）

## 正文

Hi all,

I built a community plugin that layers Markdown onto the DSH Web UI composer and chat history, and I'd like to share it here.

[asset slot: hero GIF — insert the recorded demo before posting]

### What it does

- **Live rendering in the composer** — a low-priority `conversation.composer` chain entry takes the composer over with a bundled CodeMirror 6 editor, Obsidian-style: bold, italic, inline code, and strikethrough take their real styles, code fences fold with a language tag, and syntax markers stay visible on the cursor line and fold away once it leaves (render mode; a source toggle keeps every marker visible). Enter sends (IME-safe), `Shift+Enter` breaks the line, and typed text mirrors into the host draft so it survives page reloads. Built-in takeover panels (approvals, questions, subagent) outrank the entry and keep their elections.
- **Paste conversion** — pasting rich text from the web or Word converts the clipboard `text/html` to clean Markdown at the caret; `Ctrl/Cmd+Shift+V` still pastes plain text, and plain-text, file, and image pastes keep their native behavior.
- **Markdown-rendered user messages** — sent user messages and queued steering messages render as Markdown in the chat history (reusing the host's renderer pipeline), with `@`-mention and skill chips preserved.
- **Graceful degradation** — every surface probes its host face before activating and degrades independently: built-in panels keep the composer when they need it, missing host surfaces shed their feature (never the text face), and a card-level error boundary reverts to the native composer silently with the draft intact.

### Install

```sh
dsh plugin --profile web add dsh-markdown-input
```

### Status

- The plugin is alpha and under active development.
- dsh itself is a developer preview with compatibility-breaking changes. This plugin tracks the `0.2.0-rc.x` line: `0.2.0-rc.2` has been re-tested item by item on device (the tested matrix lives in the repo README), and a daily drift-watch workflow opens one tracking issue per new upstream version so re-testing is scheduled rather than reactive.
- If you wonder why the composer is taken over instead of decorated, the repo carries a technical write-up with per-fact upstream source references (`docs/design/why-takeover.md`), including an upstream wishlist drafted as five interface expectations.

Repo: https://github.com/long6177/dsh-markdown-input — feedback and issues very welcome.

Community plugin — not affiliated with or endorsed by DeepSeek.

### 中文摘要

一个给 DSH Web UI 输入区与聊天记录叠加 Markdown 体验的社区插件：输入区内实时渲染（CodeMirror 接管卡：光标行保留原文标记、移开后折叠，源码模式一键切换），粘贴富文本自动转为干净 Markdown，已发送的用户消息与排队 steering 消息按 Markdown 渲染（保留 @提及与技能 chip），逐面能力探测、失败独立降级、渲染异常自动回落原生输入区且草稿不丢。当前为 alpha；dsh 本身处于 developer preview，本插件跟随 `0.2.0-rc.x` 线，`0.2.0-rc.2` 已真机逐项重测（实测矩阵见仓库 README），上游新版本由每日漂移监视流程逐版跟踪。欢迎试用与反馈。

社区插件，与 DeepSeek 官方无隶属关系。
