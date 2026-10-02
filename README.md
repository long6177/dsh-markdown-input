# dsh-markdown-input

[English](#english) | [中文](#中文)

<a id="english"></a>

## English

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) web-UI plugin that layers Markdown onto the native composer and chat history:

- **Markdown-rendered user messages** — sent user messages and queued steering messages render as Markdown in the chat history (reusing the host's own renderer), with `@`-mention and skill chips preserved.
- **Paste conversion** — pasting rich text from the web or Word converts the clipboard `text/html` to clean Markdown at the caret in one undo step, through the host's version-guarded insertion API; `Ctrl/Cmd+Shift+V` still pastes plain, and plain-text, file, and image pastes keep their native behavior.
- **Native composer, layered enhancements** — per [ADR-0003](docs/adr/0003-native-composer-paint-layer.md) the input box stays the host's own: no takeover, no rebuilt tool row. Enhancement layers (the paint-layer live rendering, L1; the paste layer, L3) probe their host surface before activating and auto-disable on failure, each degrading to the native behavior independently.

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

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）Web UI 插件，在原生输入区与聊天记录之上分层叠加 Markdown 体验：

- **用户消息 Markdown 化** —— 已发送的用户消息与排队中的 steering 消息在聊天记录中按 Markdown 渲染（复用宿主自带渲染管线），并保留 @提及 与技能引用 chip。
- **粘贴转换** —— 从网页/Word 粘贴富文本时，剪贴板 `text/html` 自动转为干净 Markdown，经宿主带版本守卫的插入 API 一步写入光标处、一步撤销；`Ctrl/Cmd+Shift+V` 仍直插纯文本，纯文本、文件与图片粘贴行为不变。
- **原生输入区，分层增强** —— 依据 [ADR-0003](docs/adr/0003-native-composer-paint-layer.md)，输入区保持宿主原生形态：不接管、不重建工具行。各增强层（绘制层实时渲染 L1、粘贴层 L3）激活前先探测宿主能力，失败即自动禁用，各自独立降级、互不牵连。

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
