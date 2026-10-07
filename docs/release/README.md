# 发布验收清单索引

每次 npm 发布附带一份 ≤8 条的验收清单（依据 [ADR-0004](../adr/0004-npm-release-remote-feedback-loop.md)），作为用户真机口头反馈的对照基准；发布操作序见 [docs/agents/release.md](../agents/release.md)。

- 清单是**验收基准**：发布时随版本提交，逐条在官方桌面端真机对照。
- 真机重测的逐条结果记录（`outputs/retest-*.md`）按发布政策保留在本地、不入库；确认的缺口就地转为 issue，修复后再发下一版——因此下表"结论一行"收录的是各清单标注的**版本性质与本轮主项**，完整历史可沿各版本链接与其中的 issue 号追溯。

| 版本 | 日期 | 清单 | 结论一行 |
|---|---|---|---|
| 0.2.0-alpha.0 | 2026-10-02 | [清单](0.2.0-alpha.0-checklist.md) | 占名版：打通「npm 发布 → 桌面端插件管理 UI 安装」入口；8 条基线清单（安装 / 实时渲染 / 模式切换 / 发送保真 / 用户消息投影 / 粘贴转换 / 抢占兼容 / 卸载回落） |
| 0.2.0-alpha.1 | 2026-10-02 | [清单](0.2.0-alpha.1-checklist.md) | rc.2 兼容修复版：对齐上游 primitives 图标改名导致的接管组件渲染崩溃；清单与 alpha.0 相同、需全部重验 |
| 0.2.0-alpha.2 | 2026-10-02 | [清单](0.2.0-alpha.2-checklist.md) | 原生输入区转型版（[ADR-0003](../adr/0003-native-composer-paint-layer.md)）：退役接管链、转「原生输入区 + 分层增强」；交付用户消息 / steering 消息 Markdown 投影与粘贴转 Markdown |
| 0.2.0-alpha.3 | 2026-10-02 | [清单](0.2.0-alpha.3-checklist.md) | 绘制层首航版（#15）：输入区行内四件套实时着色、语法标记淡显；纯绘制零 DOM 修改、发送文本保持原始 Markdown |
| 0.2.0-alpha.4 | 2026-10-03 | [清单](0.2.0-alpha.4-checklist.md) | 接管卡复活版（[ADR-0005](../adr/0005-composer-revival.md)）：选举链低优先级接管 + 自带 CodeMirror 6 实时渲染，带 error boundary 回落与逐面能力探测两条硬化约束 |
| 0.2.0-alpha.5 | 2026-10-04 | [清单](0.2.0-alpha.5-checklist.md) | chip 全量回归版：`@` 文件 / `/` 指令+技能 / 会话引用 chips、补全弹层与排队条随本版回归；修复工具行①入口（#27 #28 #29 #30） |
| 0.2.0-alpha.6 | 2026-10-04 | [清单](0.2.0-alpha.6-checklist.md) | 热修复版：`remote` 命名空间改点号服务取法、补齐 `commands.execute` attachments 参数；alpha.5 真机上 chip / 弹层静默降级的问题就此修复 |
| 0.2.0-alpha.7 | 2026-10-04 | [清单](0.2.0-alpha.7-checklist.md) | 停止臂补齐（#32）：普通会话主钮变停 + 可续子会话专属停止钮，取消走会话域、队列保留 |
| 0.2.0-alpha.8 | 2026-10-04 | [清单](0.2.0-alpha.8-checklist.md) | 弹层点击修复（#28）：claim 行前导重检改读活探针 token 位置；键盘 / 鼠标共用 pickRow 同享修复 |
| 0.2.0-alpha.9 | 2026-10-04 | [清单](0.2.0-alpha.9-checklist.md) | model 弹卡链路修复（#28）：外部关闭监听 mousedown → pointerdown，真实浏览器四链路复验通过 |
| 0.2.0-alpha.10 | 2026-10-04 | [清单](0.2.0-alpha.10-checklist.md) | 用户气泡复制操作行（#33）：按原生形态重建复制 / 时钟行，复制原始 Markdown 源码、探测不通过回落原生 seat |
| 0.2.0-alpha.11 | 2026-10-04 | [清单](0.2.0-alpha.11-checklist.md) | 计划 chip 与目标栏（#34）：被接管结构性隐藏的原生座位在卡内重建，CAS 动词走 `remote.goals` |
| 0.2.0-alpha.12 | 2026-10-05 | [清单](0.2.0-alpha.12-checklist.md) | alpha.11 体验轮反馈汇总：七票复测主项——弹层语义（#35 #36）、工具行与圆角 / 命中区（#39 #40 #41）、三处结构性隐藏座位重建（#38 #42 #43） |
| 0.2.0-alpha.13 | 2026-10-06 | [清单](0.2.0-alpha.13-checklist.md) | alpha.12 真机回灌修复轮：四票——模型 pill 行预算（#39）、上下文量表自渲染（#43）、hero 同行 + 预设词典（#42）、卡面不透明化（#44） |
| 0.2.0-alpha.14 | 2026-10-06 | [清单](0.2.0-alpha.14-checklist.md) | alpha.13 真机回灌修复轮：四票——pill 行结构镜像原生（#39）、StatsPills 自渲染（#43）、添加工作区行（#42）、IME 组合提交（#45） |
| 0.2.0-alpha.15 | 2026-10-06 | [清单](0.2.0-alpha.15-checklist.md) | #43 收口轮：detailed 模式两 pill 点击展开「会话统计 / Token 用量」对话框 |
| 0.2.0-alpha.16 | 2026-10-06 | [清单](0.2.0-alpha.16-checklist.md) | 渲染增强批次（#46–#49）：列表全件、代码块围栏折叠 + 语言浮标、渲染小件；**Enter 严格恒发送为有意行为变更**（回归 [ADR-0001](../adr/0001-cm6-obsidian-style-editor.md)） |
| 0.2.0-alpha.17 | 2026-10-07 | [清单](0.2.0-alpha.17-checklist.md) | alpha.16 真机反馈三缺陷修复：列表标记不可见（#50）、Enter 非恒发送（#51）、代码块折叠卡死编辑器（#52） |
| 0.2.0-alpha.18 | 2026-10-07 | [清单](0.2.0-alpha.18-checklist.md) | 列表缩进观感重做（标记与内容整项内缩）+ Tab 每按一次降一级、移除 Shift+Tab（#53）；用户消息换行保真（#54） |
| 0.2.0-alpha.19 | 2026-10-07 | [清单](0.2.0-alpha.19-checklist.md) | 第三轮真机反馈：列表收为一档（取消 Tab 与多级、一级内缩收敛）+ 气泡列表续行贴左（#55） |
| 0.2.0-alpha.20 | 2026-10-07 | [清单](0.2.0-alpha.20-checklist.md) | 第四轮真机反馈：续行对齐内容列（编辑器 + 气泡）、Shift+Enter 空标记行退出 / Backspace 原地清行、标记需分隔空格（#56） |

## 架构沿革速览

清单的演进轨迹同时是插件的架构史：alpha.0–1 接管卡初代 → alpha.2–3 转原生输入区 + 绘制层（[ADR-0003](../adr/0003-native-composer-paint-layer.md)）→ alpha.4 起接管卡复活为长期路线（[ADR-0005](../adr/0005-composer-revival.md)），此后每一版都是「真机反馈 → 修复 / 重建 → 下一版」的闭环。技术背景见 [docs/design/](../design/) 三篇：[extension-points](../design/extension-points.md)、[native-surfaces-rebuild](../design/native-surfaces-rebuild.md)、[prior-art](../design/prior-art.md)。
