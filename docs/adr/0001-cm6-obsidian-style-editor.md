# 输入区编辑器采用 CodeMirror 6 的 Obsidian 式实时渲染，而非复用宿主的 Lexical

用户最初以 ChatGPT 桌面端输入框为参照，但调查证实（`outputs/research-chatgpt-desktop-input.md`）：ChatGPT 的标记折叠路线在其自身用户群引发强烈反弹——数学/代码场景大量误伤（openai/codex#33586：斜体主题粘贴的代码被污染为 `int *readPointer*();`）、转义无效、无关闭开关。dsh 的受众以开发者为主，该风险不可接受。我们决定：输入区接管组件内嵌自带打包的 CodeMirror 6（`@codemirror/lang-markdown` + 自定义折叠装饰），光标所在行保留语法标记、移开后折叠（Obsidian Live Preview 式），并提供「渲染模式 / 源码模式」开关——源码模式恰是 ChatGPT 用户反复请求而不可得的能力。

## Considered Options

- **Lexical + MarkdownShortcutPlugin**（ChatGPT 同款折叠）：复制已被 OpenAI 用户验证的误伤问题；且宿主 Lexical editor 实例属包内部件（`contract/input.ts` 注释「never across a plugin boundary」），只能自带副本，无复用红利。
- **ProseMirror / Milkdown 全所见即所得**：工程量最大，序列化保真风险高。
- **A1 永久标记保留**：作为「源码模式」的形态保留，不作为默认。

## Consequences

- CM6 及其语言包私有打包进浏览器半 bundle（宿主规则「Silence means a private copy」允许）。
- 文本面的键位语义（Enter/Shift+Enter 等）由本插件全权定义，须自行对齐聊天输入生态预期。
