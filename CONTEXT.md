# dsh-markdown-input

一个 DeepSeek Harness（dsh）Web UI 插件：让用户在输入区获得 Markdown 的实时视觉呈现、把粘贴的富文本转为干净 Markdown，并让已发送的用户消息按 Markdown 渲染。

## Language

### 集成与扩展

**输入区（Composer）**:
dsh Web UI 中用户撰写消息的整块区域：文本面、工具行、附件栏与提交动作的总和。
_Avoid_: 输入框（笼统指文本面时可用「文本面」）、textarea

**接管（Takeover）**:
插件在条件满足时整体替换内置输入区的机制；条件不满足时让回内置输入区，且草稿在切换中幸存。
_Avoid_: 替换（泛称，不表达条件性与可逆性）

**附加槽（Peripheral slot）**:
不替换内置输入区、只在其周边（卡片上方、下方、工具行两侧、卡内浮动）贡献小部件的扩展点。
_Avoid_: dock（是实现名，不是概念名）

**阴影替换（Shadow）**:
以更高优先级永久占据内置输入区本体位置、且不继承其子部件授权的替换方式。
_Avoid_: 覆盖（overload 了 CSS 语境）

**双半结构（Dual-half）**:
UI 插件由宿主半（Node 进程侧）与浏览器半（页面 bundle 侧）组成、经网关通信的工程形态。
_Avoid_: 前后端（误导为 Web 服务架构）

**草稿（Draft）**:
输入区中尚未发送的文本与附件引用状态；在接管切换期间必须幸存。

### Markdown 体验

**实时渲染（Live render）**:
输入区内对 Markdown 语法的即时视觉呈现，用户无需切换预览即可看到格式效果。

**渲染模式（Render mode）**:
默认编辑模式：光标所在行的语法标记保持可见可编辑，光标移开后标记折叠、内容以样式呈现（Obsidian Live Preview 式）。

**源码模式（Source mode）**:
渲染模式的对照组：语法标记始终以原文显示、不做折叠，面向需要精确控制源码的时刻。

**标记保留（Marker-preserving）**:
实时渲染路线之一：原始语法字符（如 `**`、`##`）保持可见、可编辑，仅叠加样式。
_Avoid_: 高亮（暗喻纯着色）

**标记折叠（Marker-folding）**:
实时渲染路线之二：语法字符被编辑器消费为富文本元素，不再以原文出现（ChatGPT 输入框的做法）。

**干净 Markdown（Clean Markdown）**:
粘贴转换的目标产物：语义忠实、无富文本噪音、可直接作为模型输入的 Markdown 源码。
_Avoid_: 转换后的文本

**发送文本（Submitted text）**:
实际提交给模型的 Markdown 源码；输入区的视觉呈现只是它的投影，二者同源。
_Avoid_: 渲染后文本（暗示发送的是渲染产物）

**用户消息投影（User message projection）**:
已发送用户消息的文本到聊天气泡显示的映射；本插件把它从纯文本升级为 Markdown 渲染。

**引用 chip（Reference chip）**:
用户消息中 @提及、/技能、会话引用的内联标识控件；Markdown 化投影必须保留它。
