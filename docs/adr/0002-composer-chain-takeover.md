# 通过 conversation.composer 选举链整体接管输入区，自建周边部件对齐内置形态

分屏预览方案被用户否决（不接受「下方原始、上方预览」的割裂体验），周边附加槽又无法改变文本面本身。我们通过 `conversation.composer` 选举链以低优先级注册（`select` 恒真），让审批/提问等内置面板按其优先级正常抢占，其余时间由本插件输入卡片接管。被隐藏的内置子部件（工具行、附件栏、@与/补全等）按「尽量对齐原样」原则重建；草稿读写与提交走公开 `InputState`/`inputActions` API，不触碰宿主私有编辑器实例。chain 的 `overlay` 机制保证被接管的内置输入区保活、草稿在接管切换间幸存。

## Considered Options

- **分屏预览（周边附加槽）**：用户否决；且无法实现就地渲染与输入内粘贴转换。
- **阴影替换 `conversation.composer.bar`**：无仓库先例，且不继承被替换 entry 的子槽授权，重建成本相同而稳定性更差。
- **DOM 增强**：CSS Modules 哈希类无稳定性承诺，官方与社区一致视为最后手段。

## Consequences

- 内置输入区功能差异（模型/Plan 选择器、@与/自动补全等）必须在每个 dsh preview 版本上重测对齐——developer preview 期上游明示会有破坏性变更。
- 接管期间附件、提交等操作经由公开 API 驱动同一 `InputState`，与内置输入区共享底层状态。
