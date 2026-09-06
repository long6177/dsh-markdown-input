# 调研：ChatGPT 桌面应用消息输入框（Composer）对 Markdown 的处理行为

- 调研日期：2026-09-06
- 用途：为开源聊天 UI 插件（dsh-markdown-input）的输入框 Markdown 设计做参考
- 来源原则：只采信一手来源（OpenAI 帮助中心 help.openai.com、OpenAI 官方发布说明、openai/codex 官方 GitHub 仓库、OpenAI 官方开发者社区 community.openai.com），二手来源（Reddit、快捷键速查表等）仅用于佐证并单独标注。所有引用均为 2026-09-06 访问到的原文，关键句保留英文原文以避免翻译失真。

## 0. 时间线与来源等级速览

| 时间 | 事件 | 来源等级 |
|---|---|---|
| 2023-02 ~ 2024-11 | 输入框完全不渲染 Markdown（官方社区版主确认"从未有过"）；仅 ``` 代码围栏有部分解析 | 官方社区帖（含版主发言） |
| 2024-11-14 | macOS 桌面应用发布说明："Fixed pasting text from Microsoft Office Suite apps." | 官方帮助中心 |
| 2025-06-16 | 社区仍在请求输入框支持粗体/斜体（说明当时仍无该功能） | 官方社区帖 |
| 2026-03-25 / 06-22 / 08-04 | 官方：粘贴超过 5k（后升至 10k）字符自动转为附件，不再插入文本框 | 官方帮助中心（发布说明） |
| 2026-07-09 | 新版 ChatGPT 桌面应用（Chat + Work + Codex 合一）全球上线，旧应用更名 ChatGPT Classic | 官方帮助中心 |
| 2026-07-16 | openai/codex 仓库 issue：桌面（Codex/ChatGPT）应用 composer 把粘贴的富文本样式转成 Markdown 源码，且**模型收到的就是 Markdown** | 官方 GitHub 仓库 |
| 2026-08-07 前后 | 网页版输入框上线"输入时实时渲染 Markdown"（社区称 rich text input）；同日官方发布说明记载"粘贴保留格式" | 官方发布说明 + 官方社区帖 + Reddit |
| 2026-08-11 ~ 09-04 | 大量社区反馈：输入框实时 Markdown 无法关闭、转义符无效、请求 plain-text composer | 官方社区帖 |

重要总体结论：**官方（OpenAI）从未在发布说明或帮助中心系统性地记载"输入框实时渲染 Markdown"这一功能本身**；它主要靠官方社区帖、官方 GitHub issue（针对桌面/Codex 应用）和官方发布说明的相邻条目（粘贴保留格式）间接确证。桌面 ChatGPT Classic 应用是否也获得了与网页版一致的实时渲染，**来源冲突，标注为不确定**（见 §7）。

---

## 1. 输入框内打字时哪些 Markdown 语法会被实时渲染？是"标记保留"还是"标记折叠"？

### 1.1 总体机制：ProseMirror 富文本编辑器 + Markdown input rules（标记被消费，而非保留）

- 网页版 chatgpt.com 的输入框是 ProseMirror contenteditable 编辑器：`div.ProseMirror#prompt-textarea[contenteditable="true"]`（也有 `contenteditable="plaintext-only"` 的形态）。出处：OpenAI 社区帖 1390024 中用户 alexrose（2026-08-24）为绕过该行为编写的用户脚本，脚本注释明确提到 ProseMirror 的 "typed Markdown" input-rule 路径。https://community.openai.com/t/markdown-in-the-chat-window-is-completely-breaking-outgoing-prompts-and-making-gpt-completely-unusable-for-basic-tasks/1390024
- 这意味着 ChatGPT 输入框属于 **"标记折叠消失"（类 WYSIWYG）** 路线：敲入 Markdown 标记后会变成富文本节点（粗体/斜体/代码块元素等），原始星号/反引号等字符被编辑器消费掉，而不是像 IDE 那样"原始标记保留 + 语法高亮"。
- 官方社区对这一新行为的称呼与描述："**live Markdown rendering in the prompt composer**" 与 "rich-text paste handling"。出处：社区帖 1390698（R4nT，2026-08-16）。https://community.openai.com/t/add-a-plain-text-composer-option-for-chatgpt-and-codex/1390698
- 反面证据（重要）：无法用反斜杠转义。"even if you do `\` it doesn't escape… so it doesn't even follow proper markdown"（alexrose，2026-08-24，出处同 1390024 帖）——即它不是严格完整的 Markdown 解析器。

### 1.2 逐项语法表

证据分级：[官方] = OpenAI 一手文档/仓库；[社区] = OpenAI 官方论坛帖子（用户发言，非员工）；[二手] = 论坛/博客。

| 语法 | 打字时行为 | 结论 | 证据 |
|---|---|---|---|
| 粗体 `**x**` | 敲入成对星号后该片段立即变粗体，星号被消费；数学式 `5*4*3` 的星号会被"吃掉"并变成粗体/斜体，造成严重误伤 | 标记折叠；已确证 | [社区] 1390024："markdown will mangle the formatting and replace the asterisks with bold"（2026-08-11） |
| 斜体 `*x*` / `_x_` | 成对单星号或双下划线间内容变斜体："underscores (which are used to denote subscripts when typing math) turn the stuff in the middle into italics when you have two of them"（emilio18，2026-08-25） | 标记折叠；已确证 | [社区] 1390024 |
| 行内代码 `` `x` `` | 无直接一手描述。2024 年代输入框已会对反引号做部分解析（见围栏行），单反引号行为未见记载 | 未证实 | — |
| 围栏代码块 ```` ``` ```` | 2024 年起就有"部分解析"：``` 标记被隐藏、内容变等宽字体，且"病态地"连句子中间的 ``` 也会被隐藏；2026-08 升级后：敲 ``` 会在**当前行**立即创建代码块元素（连同已输入文字一起被卷入），粘贴含围栏的文本也会直接生成代码块元素 | 标记折叠为代码块元素；已确证 | [社区] 70242 帖 _j（2024-11-22）："ChatGPT does go as far as hiding code fence block markers, and putting the code in monospace… it is also dumb, hiding ``` in the middle of sentences."；[社区] 1390024："The first one opens a block on THIS line including what I already typed"（2026-08-11）；[社区] 1390698："Pasting content from a rendered code block can also create a code-block element directly in the composer." |
| 标题 `#`/`##`/`###` | 打字触发行为无一手记载；粘贴来源含标题时可保留/成为标题元素 | 未证实（打字时） | 见 §3 |
| 有序/无序列表 | 打字触发行为无一手记载；粘贴时可变成 list 富文本元素 | 部分证实（粘贴时） | [社区] 1390698：粘贴内容 "may become a structured code block, bold text, list, or other rich-text element instead of remaining literal text" |
| 引用块 `>` | composer 打字时无证据；但**发送后用户气泡**会渲染 Markdown 引用块（官方配图 + 社区确认，见 §5） | 未证实（打字时） | 见 §5 |
| 链接 `[t](u)` | 打字时无证据；粘贴时链接被保留 | 部分证实（粘贴时） | [官方] 2026-08-07 发布说明："keeps its headings, bold text, links, and lists" |
| 表格 | composer 内无任何一手证据 | 未证实 | — |
| LaTeX | composer 内无任何一手证据（响应区的公式渲染是另一回事，见 macOS 发布说明 2024-08-06 "Polished the rendering of text, tables, and mathematical formulas"，针对的是响应显示） | 未证实 | [官方] macOS 发布说明 |

> 设计参考要点：ChatGPT 选择了"input-rule 即时折叠"而非"标记保留 + 高亮"，并且（截至 2026-09）**没有提供关闭开关**，这正是 2026 年 8 月社区强烈反弹的原因（§6）。

---

## 2. 渲染时机

- **键入闭合标记的瞬间立即转换**（input rule 触发），不是失焦时才转换，也不是持续高亮：
  - [社区] 1390698 明确称之为 "live Markdown rendering in the prompt composer"（实时渲染）。
  - [社区] 1390024：敲 ``` 时"在当前行"立即打开代码块、"including what I already typed"（连已打出的文字一起被转换）——说明是击键级即时转换。
  - [二手] Reddit r/ChatGPT 帖 1vjjkit（2026-08-09 前后）：网友描述在 PC 网页版上"MD would format inside the composer and in user messages too"，即边打边渲染。https://www.reddit.com/r/ChatGPT/comments/1vjjkit/ （经 reddit.sentinel-team.org 快照访问）
- 未发现任何"失焦才渲染"的证据。
- 2024 年代的代码围栏解析同样是输入时发生的（_j 帖附截图，见 §1.2）。

---

## 3. 粘贴富文本 / HTML 的行为

- **总规则：剪贴板里的 `text/html` 富文本会被 composer "materialize" 成 Markdown/富文本元素，而不是按字面保留纯文本。**
  - [官方仓库] openai/codex issue #33586（2026-07-16，open，label: bug, windows-os, app；App 版本 26.707.91948）："When copied content includes a styled `text/html` clipboard item, the Codex composer converts that styling into plain-text Markdown. This changes the pasted code itself. This affects the latest versions of both the VS Code extension and the Codex (aka ChatGPT) app." 具体例子：从 VS Code（Night Owl / Dracula 等斜体主题）复制 `int readPointer();`，粘贴后**模型收到的是** `int *readPointer*();`。https://github.com/openai/codex/issues/33586
  - [社区] 1390698（网页版 ChatGPT/Codex composer）：复制已渲染的 Markdown（如 `**SysParamValueInput**`）再粘贴，"may appear as formatted bold text rather than editable Markdown source"；粘贴渲染过的代码块会直接在 composer 里生成代码块元素；粘贴内容可变成 "a structured code block, bold text, list, or other rich-text element instead of remaining literal text"。
  - [社区] 1389665 "Severe pasting issues, code gets mangled into markdown"（2026-08-09）：从 IDE 粘贴复杂代码被 Markdown 化、变形。https://community.openai.com/t/severe-pasting-issues-code-gets-mangled-into-markdown/1389665
- **来自 Word/网页/Google Docs 等富文本源**：
  - [官方] ChatGPT 发布说明（2026-08-07，"ChatGPT app experience updates / Writing, files, and search"）："**Keep your formatting when you paste.** On the web, text copied from Google Docs or another ChatGPT conversation keeps its headings, bold text, links, and lists, **both while you're writing and after you send your message**." ——官方明确：网页版粘贴保留标题/粗体/链接/列表，且发送后仍保留。https://help.openai.com/en/articles/6825453-chatgpt-release-notes
  - [官方] macOS 桌面应用发布说明（2024-11-14）："Fixed pasting text from Microsoft Office Suite apps." ——说明 macOS 桌面端曾专门修过 Office 粘贴，但条目未说明修复后的目标行为（转 Markdown 还是保留富文本）→ **不确定**。https://help.openai.com/en/articles/9703738-chatgpt-macos-app-release-notes
  - 从微信等中文应用粘贴：未找到任何来源记载 → 不适用/无证据。
- **粘贴 IDE 代码**：见上方 #33586 与 1389665 帖 —— 默认粘贴会把语法高亮的富文本样式转成 Markdown 星号（污染代码）；社区给出的官方外规避手段：
  - `Ctrl+Shift+V`（macOS `Cmd+Shift+V`）粘贴为纯文本 —— [社区] 1389665 中作为 workaround 被推荐；**但** [官方仓库] #33586 指出在 Codex（桌面）应用 composer 中 "`Ctrl+Shift+V` → `Paste as plain text` is not supported" → 两端行为不一致，标注不确定。
  - 用代码围栏包裹后再粘贴/输入。
- **大段文本粘贴**（官方一手，行为非常明确）：
  - 2026-03-25（Plus/Pro/Business）："If you paste more than 5k characters into the composer, ChatGPT will automatically convert the content into an attachment instead of inserting it directly into the text field."；2026-06-22 扩展到 Free/Go；2026-08-04 扩展到 Enterprise/Edu 并 "The threshold has now also been raised to 10k characters."。可用 "Show in text field" 把附件转回直接粘贴。https://help.openai.com/en/articles/6825453-chatgpt-release-notes
- **粘贴图片**：桌面端官方记载的路径是截图/拍照插入：Windows 应用 2024-11-14 "Attach screenshots"（调用 Snipping Tool，可截窗口/全屏/自选区域）、2024-11-07 "Take Photos"（摄像头）。https://help.openai.com/en/articles/10003026-windows-app-release-notes （Ctrl+V 直接粘贴图片文件的行为未见官方条目。）

---

## 4. 发送时实际发给模型的是什么？

- **结论：发送的是 composer 内容序列化后的 Markdown 源码（即渲染所对应的 Markdown 文本），不是"渲染后的纯文本"，也不是内部富文本节点。** 最直接的一手证据：
  - [官方仓库] openai/codex #33586：用户把 VS Code 里斜体显示的代码粘贴进（桌面）composer，检查会话记录后确认模型收到的字面输入是 `int *readPointer*();` 与 `*await* page*.goto*(targetUrl)` —— 富文本样式被序列化成了 Markdown 星号并**原样进入模型输入**。issue 原话："the Codex composer converts that styling into plain-text Markdown… the model received not the code you actually pasted."
  - [社区] 1390698 把期望的正确模型表述为 `clipboard text → literal editable text → submitted prompt`（即当前实现是剪贴板 → 编辑器节点 → 序列化后的 Markdown 发送）。
- 张力证据（标注不确定）：同一 1390024 帖中 alexrose 说 "the LLM appears to receive it in plaintext so it's just obfuscating what the LLM is actually seeing"。两种说法可以调和——序列化后的 Markdown 本身就是纯文本（星号即文本），但"被吃掉的星号到底如何重建"没有官方规范；**序列化格式细节无官方文档**。
- 历史对照：在输入框完全不渲染的年代，用户输入的原始 Markdown 就原样作为文本发给模型：[社区] 70242 帖 wfhbrian（2023-02-21）："the markdown user inputs aren't rendered the same as the chat output, the markdown should still be communicated to ChatGPT as if it did"；[二手] Reddit 1vjjkit："The models have always been able to read markdown, it just wasn't displayed in the UI."
- 例外路径：超过 5k/10k 字符的粘贴不进入消息正文，而是作为**附件**发给模型（官方，§3）。

---

## 5. 发送后，用户消息在聊天记录里如何呈现？

- **用户气泡会渲染 Markdown**（与助手回复同一套渲染管线）：
  - [官方] ChatGPT 发布说明中 2025-02/03 iOS 相关条目的官方配图 alt 文本即为 "ChatGPT mobile chat with examples of **Markdown blockquotes**"（配图展示的是聊天中的 Markdown 引用块渲染）。https://help.openai.com/en/articles/6825453-chatgpt-release-notes
  - [官方] 2026-08-07 发布说明：粘贴的格式 "keeps… both while you're writing and **after you send your message**"（网页版，官方确认发送后格式仍在）。
  - [官方仓库] #33586 截图部分直接有 "In message bubble:" 一节：粘贴的代码在发送后的用户气泡里以渲染后的样式（斜体生效）显示。
  - [二手] Reddit 1vjjkit：网页版 "MD would format inside the composer **and in user messages too**"；Android 更早之前就是"composer 不渲染、但用户消息渲染"（"it wouldn't format in the composer… The rendered formatting would display in the user's messages."）。
- 历史对照：功能上线前（iOS，2026-08 Reddit 帖中用户回忆）"In the sent messages it always showed with the asterisks instead of formatting it in italic" ——即旧版用户气泡显示原始星号。
- 编辑消息：iOS 官方条目（2026-06-08）"Edit messages with attachments: You can now edit messages that include attachments, so you can revise your prompt without starting over."；编辑时回到 composer（即回到富文本编辑器）。https://help.openai.com/en/articles/6825453-chatgpt-release-notes

---

## 6. 键盘行为

- **Enter = 发送；Shift+Enter = 换行**（多平台一致）：
  - 官方一手（macOS Chat Bar 场景）："To submit your prompt, click the arrow or **press the Return** button." https://help.openai.com/en/articles/9295241-how-to-launch-the-chat-bar
  - 官方一手（间接）：macOS 发布说明引导 "Try ⌘ (Ctrl) + / to see the complete list"（应用内快捷键面板是权威清单入口）。
  - [二手] Coursera（2026-04）、ai-toolbox（2026-01）等速查表一致记载：Enter 发送、Shift+Enter 换行、`Ctrl/Cmd + /` 打开快捷键面板、`Ctrl/Cmd + Shift + O` 新聊天、`Ctrl/Cmd + Shift + ;` 复制最后代码块。
  - [社区] 1390024 用户脚本注释（对现状的逆向）："Enter = Send / Shift+Enter = New line"。
- **格式插入快捷键**：未找到任何官方"Ctrl+B/Ctrl+I 插入粗体/斜体"的证据（注意：网上一份带 Aa 按钮格式工具箱的描述来自 gc.ai，**不是** ChatGPT，已排除）。已证实的格式操作入口是：
  - [社区] 1389665（2026-08-09）："you can also **select text already in the prompt text area and you'll see a minimal formatting toolbox for markdown**" ——选中 composer 内文字会弹出一个小型 Markdown 格式工具箱。
- **没有关闭实时 Markdown 的开关**：[社区] 1390698（2026-08-16 发起，2026-09-04 仍有人附议）请求 "Plain-text composer / Disable rich-text interpretation on paste / Source mode"，并援引 Slack 的 "Format messages with markup" 设置作为先例 —— 截至 2026-09-06 该设置不存在。
- 其他官方相关条目：macOS 2024-08-06 提供 "an option to disable macOS autocorrect"（关掉系统自动纠正）；iOS 2026-06-08 "Autocorrection applies before sending"（自动纠正在发送前生效）。

---

## 7. 多行自动增高与代码块在输入框里的表现

- **多行增高**：无一手来源直接记载增高策略。可确认的相关事实：
  - 输入框是单框多行编辑器（ProseMirror contenteditable，非 iframe），消息草稿会被保存：[官方] 2025-03-18 发布说明（Web 与 Windows 桌面应用）："Conversation Drafts: Unsubmitted messages in your message prompt will now be saved."；macOS 2024-10-30 "Added support for restoring draft messages."
  - 未找到关于 max-height/滚动行为的官方说明 → **不确定**。
- **代码块在输入框里的表现**：
  - 2024 年代：输入 ``` 后围栏标记被隐藏、内容以等宽字体显示（部分解析，且句子中间的 ``` 也会被误隐藏）[社区] 70242 帖 _j。
  - 2026-08 起：敲 ``` 立即在当前行创建代码块元素（把已输入文字卷入），对先写文字后补围栏的用法极不友好 [社区] 1390024；粘贴渲染过的代码会直接生成代码块元素，且这些元素"Editing around these elements, splitting them, removing formatting, or inspecting the original Markdown characters becomes significantly harder" [社区] 1390698。
  - 从 IDE 粘贴的代码会因富文本样式被 Markdown 化而**变形**（斜体主题 → 星号插入代码）[官方仓库] #33586。
- **桌面应用覆盖情况（来源冲突，明确标注）**：
  - [二手] Reddit 1vjjkit（2026-08）：macOS 桌面应用用户 "I don't have the effects on my end of UI, macOS app"；且评论指出各端灰度不同（"So much A/B-testing, regional roll out…"）。
  - [官方仓库] #33586（2026-07）：**Codex（aka ChatGPT）桌面应用**的 composer 已确认会把粘贴富文本转成 Markdown（Windows，v26.707.91948）——即新桌面应用（2026-07-09 上线的 Chat+Work+Codex 合一版）至少在 Codex 会话里有富文本 composer 行为。
  - [官方] macOS / Windows 应用发布说明截至 2026-09 均无"输入框 Markdown 渲染"条目（已全文核对 https://help.openai.com/en/articles/9703738 、https://help.openai.com/en/articles/10003026 ）。
  - [社区] 1389665（DysTopia，2026-08-09）："the markdown auto formatting is now across all versions of ChatGPT in the input area."（与 Reddit 的 macOS 观察相矛盾，可能反映灰度节奏不同）→ **结论：桌面端是否/何时与网页版对齐，无官方定论。**

---

## 8. 对插件设计的直接启示（从上述事实推导）

1. ChatGPT 的路线是"input-rule 即时折叠 + 富文本节点 + 发送时序列化回 Markdown"，代价是数学/代码场景大量误伤（`*`、`_`、```），且目前不可关闭——社区已出现强烈的 plain-text composer 诉求（1390698、1390024、1389665 三帖叠加）。**提供"可关闭 / source mode / paste as plain text（Ctrl+Shift+V）"是一个已被 ChatGPT 用户群体验证过的刚需**。
2. 转义是 ChatGPT 没做好的点（`\*` 无效）；插件若做实时渲染必须支持转义，否则重蹈 1390024 的覆辙。
3. 粘贴是重灾区：富文本（text/html）默认转换样式、大粘贴转附件、IDE 代码被污染。ChatGPT 的"超过阈值转附件 + Show in text field 回退"是值得借鉴的官方方案。
4. 发送内容为 Markdown 源码、用户气泡按 Markdown 渲染、Enter/Shift+Enter 语义、草稿保存——这四点是 ChatGPT 已固化的用户预期，插件保持一致成本最低。

---

## 引用来源清单

官方一手：
- ChatGPT — Release Notes（OpenAI Help Center）: https://help.openai.com/en/articles/6825453-chatgpt-release-notes
- ChatGPT macOS app release notes（OpenAI Help Center）: https://help.openai.com/en/articles/9703738-chatgpt-macos-app-release-notes
- Windows App - Release Notes（OpenAI Help Center）: https://help.openai.com/en/articles/10003026-windows-app-release-notes
- How to launch the Chat Bar（OpenAI Help Center）: https://help.openai.com/en/articles/9295241-how-to-launch-the-chat-bar
- openai/codex issue #33586（OpenAI 官方 GitHub 仓库）: https://github.com/openai/codex/issues/33586

官方社区（OpenAI Developer Community，用户发言、非员工，按任务约定作为官方论坛来源）：
- Add markdown support to input bar（2023-02~2024-11，含 Community-Moderators 版主 VeitB 发言）: https://community.openai.com/t/add-markdown-support-to-input-bar/70242
- Feature Request: Basic text formatting (bold and italic) in chat（2025-06）: https://community.openai.com/t/feature-request-basic-text-formatting-bold-and-italic-in-chat/1289717
- Markdown in the chat window is completely breaking outgoing prompts…（2026-08）: https://community.openai.com/t/markdown-in-the-chat-window-is-completely-breaking-outgoing-prompts-and-making-gpt-completely-unusable-for-basic-tasks/1390024
- Add a plain-text composer option for ChatGPT and Codex（2026-08~09）: https://community.openai.com/t/add-a-plain-text-composer-option-for-chatgpt-and-codex/1390698
- Severe pasting issues, code gets mangled into markdown（2026-08）: https://community.openai.com/t/severe-pasting-issues-code-gets-mangled-into-markdown/1389665

二手（仅佐证，均已在上文标注）：
- Reddit r/ChatGPT "ChatGPT finally allows markdown formatting in users' prompts"（2026-08）: https://www.reddit.com/r/ChatGPT/comments/1vjjkit/ （经 https://reddit.sentinel-team.org 快照访问）
- Coursera: ChatGPT Keyboard Shortcuts（2026-04）: https://www.coursera.org/articles/chatgpt-keyboard-shortcuts
- AI-Toolbox: ChatGPT Keyboard Shortcuts（2026-01）: https://www.ai-toolbox.co/chatgpt-management-and-productivity/chatgpt-keyboard-shortcuts-guide
