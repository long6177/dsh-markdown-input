# 复活 v1 接管卡（CodeMirror 6）并以硬化约束重启，退役绘制层路线

> **状态：现行。** 取代 [ADR-0003](0003-native-composer-paint-layer.md)；[ADR-0001](0001-cm6-obsidian-style-editor.md) 与 [ADR-0002](0002-composer-chain-takeover.md) 的编辑器与接管决策随本文恢复为现行。

alpha.3 真机验收后用户否决绘制层路线：CSS Custom Highlight API 只提供 paint 级属性（颜色、背景、文本装饰、阴影、描边），无字重与字形，真加粗/斜体在该路线上是浏览器硬上限而非实现缺口；仅存的白底淡显被判「效果太差」，开发暂停。用户决定回到 v1 形态（alpha.1：`conversation.composer` 选举链接管卡 + 自带 CodeMirror 6 编辑器）作为长期路线继续开发：第一优先是把宿主引用 chip 搬入接管编辑器层，并把原生工具行控件（`+` 命令菜单、权限预设、模型选择、发送/停止）尽量按原生形态还原。

v1 的真机缺陷（alpha.0 整端崩溃、重建面缺陷密集）以两条硬化约束回应，作为复活的先决条件：

1. **React error boundary 包裹接管卡**：alpha.0 因宿主 primitives 图标组件改名导致整端崩溃。边界捕获渲染异常后整卡卸载、回落原生输入区，草稿经宿主草稿 API 保全。
2. **逐面能力探测**：编辑器面、工具行各控件面、弹层面独立探测自己的宿主依赖（注入服务、RPC 面、投影键的存在性），任一面失效只降级该面（隐藏或回落原生对应控件），不牵连整体。

## Considered Options

- **继续打磨绘制层（白色 + 标记淡显）**：拒绝。无字重字形的效果上限已被用户真机否决，且 #15 的实现已证明这是 API 硬约束。
- **保持原生输入区 + 附加槽增强**：拒绝。文本面归宿主私有编辑器，ADR-0001 的实时渲染核心价值无法达成。
- **复活 v1 接管 + 硬化**：选中。编辑器与接管形态经 alpha.0/alpha.1 真机验证（折叠渲染、IME、草稿镜像均通过），失败点在重建周边而非编辑器本体。

## Consequences

- 恢复 [ADR-0001](0001-cm6-obsidian-style-editor.md) 与 [ADR-0002](0002-composer-chain-takeover.md) 的全部后果：CM6 私有打包、键位语义自担、每个 dsh preview 版本重测重建面对齐。
- 工具行与弹层视图全部自绘（宿主视图组件不导出），数据层走宿主公开服务面：命令目录 `remote.commands.list/execute`、权限 `permissions` 投影 + `live.command('/permission <preset>')`、模型 `ctx.modelDirectories` 目录服务；规格见 [native-surfaces-rebuild](../design/native-surfaces-rebuild.md)。
- 绘制层引擎（#15）与 composer 侧 PasteDock 随接管失去宿主编辑器锚点而退役：粘贴转 Markdown 必须在 CM6 编辑器面内重实现（CM6 paste handler）。聊天消息投影（用户消息/steering Markdown 化）与输入区无关，保持不变。
- chip 复用宿主文本协议（纯文本即线格式）：以 CM6 补全 + 装饰重建引用 chip，宿主 `setDraft`/`restoreDraft` 兼容面继续可用。
- 词汇表：「接管」恢复为现行概念；「绘制层」退役。
- 发布与反馈闭环依 [ADR-0004](0004-npm-release-remote-feedback-loop.md) 不变：npm 发版（OTP 由维护者输入）、官方桌面端插件管理 UI 安装升级、≤8 条验收清单对照真机口头反馈。
