# dsh-markdown-input

[English](#english) | [中文](#中文)

<a id="english"></a>

## English

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) web-UI plugin that layers Markdown onto the composer and chat history:

- **Markdown-rendered user messages** — sent user messages and queued steering messages render as Markdown in the chat history (reusing the host's own renderer), with `@`-mention and skill chips preserved.
- **Live-rendering takeover composer** — a low-priority `conversation.composer` chain entry ([ADR-0005](docs/adr/0005-composer-revival.md)) takes the composer over with a bundled CodeMirror 6 editor, Obsidian-style: bold/italic/inline code/strikethrough take their real styles, syntax markers fold away once the cursor leaves their line (render mode; a source toggle keeps every marker visible), Enter sends (IME-safe), `Shift+Enter` breaks the line, typed text mirrors into the host draft so it survives page reloads, and the attachment bar covers upload/remove/uploading states. Built-in takeover panels (approvals, questions, subagent) outrank the entry and keep their elections.
- **Paste conversion** — pasting rich text from the web or Word converts the clipboard `text/html` to clean Markdown: in the takeover editor at the caret, and on the native composer through the host's version-guarded insertion API; `Ctrl/Cmd+Shift+V` still pastes plain, and plain-text, file, and image pastes keep their native behavior.
- **Graceful degradation** — every surface probes its host face before activating and degrades independently: built-in panels keep the composer when they need it, missing host surfaces shed their feature (never the text face), and a card-level error boundary reverts to the native composer silently with the draft intact.

> **Status: alpha, under active development.** dsh itself is a developer preview with compatibility-breaking changes; this plugin tracks the `0.2.0-rc.x` line of `@deepseek-ai/dsh` and is re-tested against upstream master.

### Install

```sh
dsh plugin --profile web add dsh-markdown-input   # npm
dsh plugin --profile web add github:long6177/dsh-markdown-input
```

### Testing

> Dev dependencies link into a local checkout of [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) at `../deepseek-harness` (pinned to the `dsh-v0.2.0-rc.2` tag); clone it beside this repo before `pnpm install`.

```sh
pnpm test                     # unit + component + bundle contract (vitest, jsdom)
bash scripts/retest-wizard.sh # guided on-device re-test; writes outputs/retest-*.md
```

### License

[MIT](./LICENSE)

---

<a id="中文"></a>

## 中文

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）Web UI 插件，在输入区与聊天记录之上分层叠加 Markdown 体验：

- **用户消息 Markdown 化** —— 已发送的用户消息与排队中的 steering 消息在聊天记录中按 Markdown 渲染（复用宿主自带渲染管线），并保留 @提及 与技能引用 chip。
- **实时渲染接管卡** —— 经 `conversation.composer` 选举链低优先级条目（[ADR-0005](docs/adr/0005-composer-revival.md)）以自带 CodeMirror 6 编辑器接管输入区，Obsidian 式实时渲染：粗体/斜体/行内代码/删除线以真样式呈现，语法标记折叠：光标行保留原文标记，光标离开后标记折叠隐去（渲染模式；源码模式标记始终可见）；Enter 发送（中文 IME 安全）、`Shift+Enter` 换行，输入内容实时镜像进宿主草稿、页面刷新不丢，附件栏覆盖上传/移除/上传中状态。内置接管面板（审批、提问、子代理）优先级更高、照常抢占。
- **粘贴转换** —— 从网页/Word 粘贴富文本时，剪贴板 `text/html` 自动转为干净 Markdown：接管卡内在光标处直转；原生输入区经宿主带版本守卫的插入 API 一步写入、一步撤销；`Ctrl/Cmd+Shift+V` 仍直插纯文本，纯文本、文件与图片粘贴行为不变。
- **逐面降级** —— 各面激活前先探测宿主能力，失败即独立降级：内置面板需要输入区时照常接管，宿主面缺失时只失去对应功能（文本面永不因此下线），卡级 error boundary 在渲染异常时静默回落原生输入区、草稿不丢。

> **状态：alpha，积极开发中。** dsh 本身处于 developer preview、存在破坏性变更；本插件跟随 `@deepseek-ai/dsh` 的 `0.2.0-rc.x` 版本线，并对上游 master 持续重测。

### 安装

```sh
dsh plugin --profile web add dsh-markdown-input   # npm
dsh plugin --profile web add github:long6177/dsh-markdown-input
```

### 测试

> 开发依赖以 `link:` 指向本仓库旁的 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 本地检出（固定在 `dsh-v0.2.0-rc.2` 标签）；执行 `pnpm install` 前请先克隆到相邻目录。

```sh
pnpm test                     # 单元 + 组件 + bundle 契约（vitest，jsdom）
bash scripts/retest-wizard.sh # 真机重测引导脚本；结果写入 outputs/retest-*.md
```

### 协议

[MIT](./LICENSE)
