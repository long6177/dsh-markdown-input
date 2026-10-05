# hero 座位随接管卡重建：工作区行与 Agent 预设进卡，而非让原生 hero 顶回

> **状态：现行。** 补充 [ADR-0005](0005-composer-revival.md) 的接管决策：接管范围覆盖空白会话（新会话 hero 态），原生 hero 座位由接管卡卡内重建。

## 背景

新开对话在 dsh 里是空白会话（`sessionId` 已定义、`session.blank === true`、hero 态）。`conversation.composer` 链的 `fallbackOnly` 仅在无会话时成立，接管卡 selector 无条件 elect，链的 `overlay: true` 语义把 fallback 整体隐藏——原生 hero 的 `heroWorkspaceRow`（WorkspaceChip + 工作区选择菜单 + `conversation.hero.agentPreset`）随之不可见。真机反馈（#42）：新会话完全看不到工作区与 Agent 模式选择入口。

## 决策

接管卡在空白会话保持 elect，在卡内重建缺失的 hero 功能座位：卡顶一行 = 工作区 chip + 选择菜单（标签走原生五级解析链，选定 = reuse-or-create 空白会话并切换）+ Agent 预设控件（roster 读 `agentPresets` 远端服务、当前值读 `agentPreset` 会话投影、切换走服务动词）；无可解析工作区时整卡跟随原生切「工作区触发姿态」（虚线描边、不可输入、整卡为选择触发器）。各数据面缺席时整面隐藏，不降死控件。HeroShell（鱼 logo 动画 + 标题 + preview 徽章）为纯装饰，不复刻。

## Considered Options

- **方案 A：selector 在空白会话 decline，原生 hero 顶回**：否决。每个会话的第一条消息将永远落在原生纯文本编辑器，实时 Markdown 渲染——接管的核心价值——在「第一印象」时刻缺位；且提交瞬间出现一次可见的输入卡切换。用户明确不能接受。
- **方案 B：卡内重建 hero 座位**：选中。数据面经验证运行时可达（工作区列表经全局 `useWorkspaces` 标准钩子、动词经 `ctx.get('workspaces')`/`ctx.get('sessions')`；Agent 预设经 `agentPresets` 远端服务 + `agentPreset` 会话投影），face 降级范式（缺席整面隐藏）成熟，接管语义「同一个输入卡贯穿会话全程」得以保持。
- **完整复刻居中 hero 形态**：否决。HeroShell 无任何功能内容，复刻只增加形态切换成本，与接管卡的消息流定位冲突。

## Consequences

- 接管卡第一次出现「整卡形态分支」（常态 ↔ 工作区触发姿态），键盘可达性与 placeholder 梯级需随分支联动。
- 工作区/Agent 预设的类型不在本构建依赖树（`dsh-client-ui-workspace`、agent-preset UI 包），一律结构化读取 + 运行时探测，宿主升级时随重建面重测（同 ADR-0005 的既有后果）。
- Agent 预设 UI 形态按数据语义自建（宿主 UI 包不可 vendor）；宿主原生预设控件形态如有出入，以功能对齐为准、不做像素级对齐承诺。**（alpha.13 修订）**文案原计划自带 `markdown-input` 键，alpha.12 真机回灌显示内置预设只能落到 roster 原始 id（「standard」+「暂无描述」），维护者要求贴近原生形态并接受对宿主 `settings.agentPreset` 命名空间的只读绑定——现经 `presetDisplayText` 同构复刻解析内置四预设的本地化名/描述，插件自带键仅在宿主词典缺席时兜底；菜单行几何随修复对齐原生 `AgentPresetSeat`（名 + 描述两行 + 右侧勾选）。
