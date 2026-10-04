# dsh-markdown-input

一个 DeepSeek Harness（dsh）Web UI 插件：让用户在输入区获得 Markdown 的实时视觉呈现、把粘贴的富文本转为干净 Markdown，并让已发送的用户消息按 Markdown 渲染。

## Language

### 集成与扩展

**输入区（Composer）**:
dsh Web UI 中用户撰写消息的整块区域：文本面、工具行、附件栏与提交动作的总和。
_Avoid_: 输入框（笼统指文本面时可用「文本面」）、textarea

**绘制层（Paint layer）**:
叠加于宿主输入区之上、仅改绘制而不改 DOM 与布局的渲染层；alpha.3 曾作为输入区渲染方案，因 CSS Custom Highlight API 的 paint 级上限（无字重字形）自 ADR-0005 起退役。
_Avoid_: 覆盖层（暗示 DOM 叠放）

**接管卡（Takeover card）**:
经 `conversation.composer` 选举链低优先级接管输入区的插件卡片：内嵌 CodeMirror 6 编辑器承担文本面，工具行控件与弹层按原生形态重建；输入区实时渲染的实现位置（ADR-0005 起）。
_Avoid_: 皮肤（暗示纯外观）、覆盖层

**附加槽（Peripheral slot）**:
不替换内置输入区、只在其周边（卡片上方、下方、工具行两侧、卡内浮动）贡献小部件的扩展点。
_Avoid_: dock（是实现名，不是概念名）

**淡显（Dimming）**:
语法标记保持可见可编辑、以弱化颜色呈现的处理；输入区渲染的默认标记策略。
_Avoid_: 隐藏（不追求且越界）、透明化（隐形字符仍占宽，体验差）

**双半结构（Dual-half）**:
UI 插件由宿主半（Node 进程侧）与浏览器半（页面 bundle 侧）组成、经网关通信的工程形态。
_Avoid_: 前后端（误导为 Web 服务架构）

**草稿（Draft）**:
输入区中尚未发送的文本与附件引用状态；归宿主原生编辑器持有，插件经官方草稿 API 程序化读写。

**幽灵提示（Ghost hint）**:
命令 claim 相位的尾随弱化文案：claim token 的参数仍为空白时，在草稿尾部显示该命令的下一步指引（goal/plan 对齐原生文案键），输入法组合期间隐藏。
_Avoid_: placeholder（是通用占位机制，不是 claim 相位文案）

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

**排队 steering 消息（Steering message）**:
回合运行中用户追加、由会话收入当前回合的用户消息（ChatNode `steering` 键）；与开场用户消息（`user` 键）共用同一渲染座位，Markdown 化同步生效。
_Avoid_: pending steering（指尚未入场的瞬态输入回显，宿主直渲、无 slot 扩展点）

**排队消息栏（Queue strip）**:
接管卡内重建的排队消息视图（原生 composer 的 queue dock 随回退栏被接管隐藏）：行数据读输入货币 `queue` 与会话快照回显，撤回/编辑/插话走会话域 `updateQueue`；动作面缺席时只降按钮不降可见性。

**停止臂（Stop arms）**:
接管卡的发送/停止语义（#32，对齐原生 InputBar 的 `primaryStops`/`interruptible`）：普通会话运行中且草稿为空（或 owner 抬起 composer block）时主按钮切换为停止、点击经会话域 `cancel` 取消在飞回合并保留队列；可续子会话保留发送主钮、另设专属方形停止钮。cancel 动词缺席时按钮降为不可点，座位不消失。
_Avoid_: 中断（宿主文案为「停止生成」）

**计划 chip（Plan chip）**:
接管卡工具行内重建的原生 PlanChip（#34，原生座位 `conversation.input.plan` 随 InputBar 被接管结构性消失）：读 `plan` 投影的折叠目标值显示（`pending ? !active : active`），点击经命令面执行原生 detached 行 `/plan off` 退出计划模式；投影或命令面缺席时整面隐藏，不降级为死按钮。
_Avoid_: 计划按钮（原生是 chip 形态的座位，非普通按钮）

**目标栏（Goal strip）**:
接管卡内重建的原生 GoalDock（#34，原生 `conversation.input.dock` 的 goal 条目随回退栏被接管隐藏，位于排队消息栏之前）：持久态读 `goal` 投影，进程本地 activation 经宿主转发事件与活性读补足，编辑/暂停/继续/清除走宿主 `remote.goals` CAS 动词；动词面缺席时只降按钮不降可见性。
_Avoid_: dock（是实现名，不是概念名）

**工作区行（Workspace row）**:
接管卡卡顶重建的原生 hero 工作区座位（#42，原生 `heroWorkspaceRow` 的 chip 与选择菜单随回退栏被接管隐藏）：标签走原生五级解析链（刚选定 → 占位 → 会话归属工作区 → cwd 桥 → 占位），选定 = 在该工作区复用或创建空白会话并切换；菜单无「添加工作区」行（directory-flow 洞在卡内必然未占）。
_Avoid_: hero（指原生居中形态，接管卡不复刻）

**工作区触发姿态（Workspace trigger posture）**:
空白会话且解析不出工作区标签时接管卡的整卡形态（#42，原生 `cardWorkspaceTrigger` 的重建）：虚线内描边、不可输入、整卡为工作区选择的触发器；选定后恢复常态。
_Avoid_: 禁用态（宿主语义是「前置 prerequisite」而非损坏）

**Agent 预设（Agent preset）**:
接管卡工作区行内重建的会话预设控件（#42，原生 hero 预设座位随回退栏被接管隐藏）：当前值读 `agentPreset` 会话投影、roster 读 `remote.agentPresets.list`、切换走同命名空间的 `select(sessionId, presetId)`（宿主对已开始会话的拒绝就地成横幅），切换成功后投影回读即新值；宿主 UI 包不在依赖树，形态按数据语义自建，数据面缺席整面隐藏。
_Avoid_: Agent 模式（宿主概念是按预设组合成 Agent，不是开关）

**上下文量表（Context meter）**:
挂 `conversation.composer.dock` 重建的原生 ContextMeter（#43，随回退栏被接管隐藏，位于接管卡正下方、原生同位）：圆环 + 百分比，点开构成面板（系统/工具/对话启发式分段）；数据读 `contextPressure` 与 `contextBreakdown` 投影，缺任一或无容量不渲染。
_Avoid_: 上下文进度条（形态是环，且面板是主体）
