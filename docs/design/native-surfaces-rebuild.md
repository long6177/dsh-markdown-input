# 原生输入区工具行弹层规格 —— `+` 命令菜单 / 权限预设 / 模型选择

> 用途：dsh-markdown-input 接管卡（[ADR-0005](../adr/0005-composer-revival.md)）重建工具行弹层的实现依据——接管使原生 `InputBar` 及其子面结构性消失后，这三个弹层需要按原生形态自建。扩展点全景与「为什么必须自绘」见 [extension-points](extension-points.md)。
> 证据基准：上游 [`deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) 源码 @ tag `dsh-v0.2.0-rc.2`（commit `639ed01`），文件路径与行号均以该 tag 为准；2026-10-02 成文，2026-10-07 入库复核。
> 结论速记：**三个弹层的视图组件宿主一律不导出（须自绘 / 内嵌 vendor），但数据层全部可达宿主公开服务面。**

---

## 0. 总览与数据流

```
工具行
├─ ① + 按钮 ──────────► MenuView（slash 菜单，overlay 槽位）
│     「添加」 file/goal/plan/feedback
│     「指令」 compact/permission/model/export
│        ├─ permission ──► popupSelect 弹卡（第二层，PermissionSelect 同源）
│        └─ model ───────► popupSelect 弹卡（第二层，扁平模型列表）
├─ ② 权限 pill ────────► ui-primitives <Menu side="top" portal>（PermissionSelect 座位）
└─ ③ 模型 pill ────────► ModelSelect 自管卡片（root/model/effort 三 pane 切换）
```

- ① 手敲 `/` 与点 `+` 汇入**同一条触发器管线、同一个 MenuView**；点 `+` 只是注入一个 synthetic hit（`query:''`，只种 `command` 一个 source），手敲 `/` 会同时种 `command` + `skill` 两组。
- ② 是独立座位 `conversation.input.permission`（`kind:'single'`，`contract/slots.ts:217`），③ 是 `conversation.input.model`（`slots.ts:223`）；两者挂在 `InputBar.tsx`（左侧 `.modes` 排 permission，右侧 `standardControls` 排 model）。
- **接管含义**：本插件接管 `conversation.composer`（chain，`slots.ts:187`）后，原生 `InputBar` 不再渲染（`conversation.composer.bar` 是它的 children，`slots.ts:207`）——①②③ 的座位、overlay 槽位全部消失，必须全部自建；但它们读的数据服务不消失。

---

## 1. `+` 命令菜单（添加 / 指令）

### 1.1 组件与开合

- 弹层组件：`MenuView`，`packages/client/ui-input-trigger/src/client/MenuView.tsx`（函数 :47，渲染 :94-222）。经 `conversation.input.overlay` 槽位注入（`ui-input-trigger/src/client/index.ts:65-85`），渲染点 `InputBar.tsx:383`。
- 定位：`overlayAnchor` 是贴 composer 卡顶边的零高度条（`InputBar.module.css:117-123`）；菜单 `position:absolute; bottom:calc(100% + 4px); left:0; right:0`（`MenuView.module.css:1-8`）——**菜单底边贴卡上缘 +4px，宽度 = 卡片宽**，`z-index:100`，设计 max-height 400px，运行时 `useAnchoredMaxHeight(listRef, 400, state, 84)` 夹视口（顶部留 84px）。
- 打开：`+` 按钮 `InputBar.tsx:424-433`（`IconPlusOutlineMedium size={14}`，tooltip 键 `input.commands`=「添加文件或调用指令」，`aria-haspopup="listbox"`）→ `onToggleCommandMenu`（:274-282）**先 `focusDraftEditor` 再** `toggleCommandMenu?.(keyboard.caretSpan())`。
- `toggleCommandMenu` 实现（`apply.ts:506-518`）：`inputTriggers.toggleSource('command', { trigger:'/', query:'', quoted:false, position: 光标前文本为空?'leading':'inline', span:{...selection, draftRev} })`。
- `toggleSource`（`controller.ts:187-205`）：同 source 已开则 dismiss（toggle 语义）；否则 `launcher.set(source)` + `seedGroups` 单 source 种子 + 派发 hit 拉候选。
- 关闭：外部 pointerdown 捕获阶段（目标不在菜单内且不在 `[data-composer-card]` 内才关，`MenuView.tsx:81-92`）；Escape/Shift+Tab → `arbitrate` → `rememberDismissed()` + close（同 token+query 不再自动弹回）；选中后 settle 固定关闭；所有组 ready 且为空自动关；文本变化 track 不到触发 token 关（launcher 打开后的**第一次空 track 例外**，controller.ts:128-137）。
- `commandMenuOpen` = `useMenuLauncher(source => source === 'command')` 订阅 `controller.launcher`。

### 1.2 条目装配

- `command` source 注册：`ui-commands/src/client/service.ts:115-123`（`trigger:'/'`，`candidates`/`onPick`/`matchSpace`/`matchEnter`/`warm`）。
- 候选合成 `service.ts:223-249`：
  1. `directory.ensureReady(sessionId)` → Host RPC **`ctx.remote.commands.list(sessionId)`**（service.ts:108；每会话缓存，失效源 `commands/change`、`agent-preset/selected`、`connection/reset`）；
  2. 客户端 contributions（`live.contributions`）追加，撞名 fail loud；
  3. 位置过滤：`position==='inline'` 时丢掉带 `hint` 的行；
  4. `query===''` → `sectionRows` 分节；有 query → `rankByName`（前缀命中优先，name+label 双键、大小写不敏感有序子序列，`ui-primitives/src/rank-by-name.ts:70-93`）。
- 分节表（`ui-commands/src/client/presentation.ts:19-22`）：
  ```ts
  const SECTION_ROWS = {
    add: ['file', 'goal', 'plan', 'feedback'],
    commands: ['compact', 'permission', 'model', 'export'],
  }
  ```
  `sectionRows`（:74-86）按表序挑行（缺失跳过），未列名的行追加在「指令」节尾部；每行打 `section: t('section.add')` / `t('section.commands')`。渲染时相邻 section 变化才插节标题行；行带 `section` 时不再渲染 source 组标题（MenuView.tsx:144-160）。
- 内建行外观表（`presentation.ts:41-48` `HOST_FACES`，按 definitionId 识别）：

| 命令 | definitionId | label 键 | description 键 | 图标 |
|---|---|---|---|---|
| goal | `@deepseek-ai/dsh-command-goal` | `label.goal` 目标 | `description.goal` 设置或查看长期任务目标 | `IconGoalOutlineRegular`（icons:1176） |
| plan | `@deepseek-ai/dsh-plan-mode` | `label.plan` 计划 | `description.plan` 进入或退出计划模式 | `IconPlanOutlineRegular`（:1399） |
| feedback | `@deepseek-ai/dsh-command-feedback` | `label.feedback` 反馈 | `description.feedback` 发送关于当前会话的反馈 | `IconPaperPlaneOutlineRegular`（:686） |
| compact | `@deepseek-ai/dsh-command-compact` | `label.compact` 压缩 | `description.compact` 压缩以上对话内容 | `IconCompactOutlineRegular`（:1416） |
| permission | `@deepseek-ai/dsh-permission-presets` | `label.permission` 权限 | `description.permission` 切换权限预设（沙箱模式与审批策略） | `PermissionIconFullAccessRegular`（PermissionIcon.tsx:81） |
| export | `@deepseek-ai/dsh-session-log-export` | `label.export` 下载日志 | `description.export` 将当前会话内容导出为 ZIP | `IconDownloadOutlineRegular`（:752） |

- `file` 与 `model` **不在 Host 目录**，是客户端 contribution：
  - file：`apply.ts:271-280` —— `{ name:'file', label: t('input.file') 文件, icon: IconPaperclipOutlineRegular(:718), available: inputHub.canPickFiles, ui:{ kind:'action', run: s => inputHub.pickFiles(s.sessionId) } }`，无 description（与桌面端界面一致）。
  - model：`ui-model-selection/src/client/index.ts:129-165` —— `{ name:'model', label: 模型, description: 选择本会话使用的模型, icon: IconDataOutlineRegular(:1032), available: 非子代理会话, ui:{ kind:'popupSelect', searchMode:'fuzzy-label' } }`。
- 行数据形状：`ui-input-trigger/src/types.ts:49-73` `InputTriggerCandidate { name, label?, description?, icon? ('file'|'folder'|'session' token 或 React 组件), hint?, section?, value?, drill? }`；`label` 与 `name` 非同字母时 name 作右侧别名渲染（桌面端菜单的「文件 file」行正是 label + 别名形态）。

### 1.3 八条目点击行为（dispatch 决策表 service.ts:252-275）

统一入口：`pick` → `settle`（controller.ts:214-224, 562-593）→ `CommandUiRuntime.dispatch`：
1. contribution 命中 → `invoke(name, ui)`；2. decoration 命中 → `invoke`；3. Host descriptor 有 `input` → 返回 `{ claim }`（往草稿插 claim token）；4. Host 裸命令 → `consumeVia`（删 token，span CAS）+ `runDetached('/name')` → `remote.commands.execute(sessionId, line, attachments)`（service.ts:401-416）。

| 条目 | 类型 | 点击后行为 |
|---|---|---|
| 文件 file | contribution·action | `inputHub.pickFiles`（hub.ts:200-203）→ shell.`pickFiles()`（facade.ts:570-574）→ 隐藏 `<input type="file" multiple>` 点击（view-binding.ts:88-97；InputBar.tsx:434-441）→ `intakeFiles`（图片限额预检，InputBar.tsx:211-243）。可用性 `canAcceptDrop = 子代理===null && !locked && !machineBusy && addFiles!==undefined`（:235） |
| 目标 goal | Host 有参命令（`input:{hint:'[<objective>|clear|edit <objective>|pause|resume]', attachments:true}`，command-goal/src/index.ts:194-195） | **插入 claim token `/目标 `**（中文 locale token，resolution.ts:34-37）；`beginCommand` 以 span CAS 把 `[0,span.end)` 替换为 token（facade.ts:414-425）；编辑器尾部本地化幽灵提示 `hint.goal`=「输入目标，智能体将持续执行」（有目标时 `hint.goal.active`，InputBar.tsx:333-341）。**不开面板**；回车提交时 claim.submit → `command.execute('/goal …')` |
| 计划 plan | Host 有参命令（`input:{hint:'[off|message]'}`，plan-mode/src/index.ts:231-235） | 同上：插入 **`/计划 `** claim；幽灵提示 `hint.plan`=「描述你的任务以生成计划」。计划模式状态由 `plan` 投影驱动；工具条 plan 芯片是另一座位 `conversation.input.plan`（ui-plan/src/client/index.ts:116-117），与菜单项无直接链路 |
| 反馈 feedback | Host 命令 + decoration·action（ui-message-feedback/src/client/index.ts:135-141） | **立即打开会话级 `FeedbackDialog`**（overlay 槽位 `id:'feedback-dialog', order:2`，index.ts:115-131 → `feedbackUi.openSession(sessionId)` :86），不插文本 |
| 压缩 compact | Host 裸命令（command-compact/src/index.ts:103-104，无 input） | **立即执行**：`consumeVia` 清 token + `runDetached('/compact')`；结果以持久 flow 节点渲染，composer 不回显 |
| 权限 permission | Host 有参命令（`input:{hint:'<preset>'}`，permission-presets/src/index.ts:259-260）+ decoration·popupSelect（ui-permission-presets/src/client/index.ts:176-191） | **链式打开 popupSelect 弹卡**（`popupFor(actx).open(...)`）：选项来自 `PermissionCatalogDirectory`，full-access 行带 `confirmation` 风险确认（:94-103）；`onSelect` → `live.command('/permission ${preset}')`（:123-132）；成功后 `deps.consume(segment)` 清 token + 焦点回 composer（service.ts:201-209；facade.ts:450-458） |
| 模型 model | contribution·popupSelect | **链式打开 popupSelect 弹卡**：`fuzzy-label` 搜索、按 provider 分组（`optionsOf` index.ts:52-76）、当前值 `active:true`；`onSelect` → `directory.select(selection)`（session.selectModel RPC） |
| 下载日志 export | Host 裸命令（session-log-export/src/index.ts:81-82） | **立即执行**：`consumeVia` + `runDetached('/export')` → Host 侧打 ZIP 导出 |

claim 语义（接管卡复刻的核心交互）：`/目标 `/`/计划 ` 插入后草稿进入 claimed 相位，`matchSpace` 同步 claim（service.ts:278-284），整行回车 `matchEnter`（:302-349，含附件拒绝策略、`TOKEN_ALIASES` 中文拼写归一化 resolution.ts:39-59）；`position==='inline'` 时候选过滤掉带 hint 的行（草稿中间的 `/goal` 不弹 claim 行）。

### 1.4 键盘与 a11y

- 键位注册在 Lexical CRITICAL 优先级（`input/editor/keymap.ts:105-158`）：`↑/↓ → arbitrate('up'/'down')`；`Tab → 'tab'`（`drill===true` 下钻不关菜单，否则等同 Enter）；`Shift+Tab`/`Escape → arbitrate('escape')` 关闭并记忆；`Space → space()`（matchSpace claim 判定 controller.ts:321-334）；`Enter` 组 ready 才 `'pick-highlighted'`，refinement pending 时返回 `'consumed'` 防误选旧行（:287-296）；Ctrl/Cmd+Enter 加速投递。IME 防护：`isComposing`/keyCode 229/合成结束 +10ms（keymap.ts:48-52）。
- 高亮在**所有 ready 组扁平化后的位置序列上循环**（menu.ts:130-142）；键盘与指针共享同一高亮、最后输入者获胜（hover 用 `onMouseMove` 非 mouseenter，MenuView.tsx:174-177）。
- 行 DOM：滚动视口 `role="listbox"`，行 `role="option"` 的 `<button>`，`aria-activedescendant` 指向 `dsh-slash-option-{source}-{index}`（MenuView.tsx:129-134）；高亮行 `scrollIntoView({block:'nearest'})`（:74-78）；**选择用 mousedown**（preventDefault 保住编辑器焦点，combobox 模式，:167-173）。
- popupSelect 第二层弹卡是**另一套键盘**：弹卡持有焦点（搜索框 `searchRef.focus()`），`↑/↓` 移动、`Enter/Tab` 确认、`Shift+Tab/Escape` 关闭并 `focusComposer`、`←→` 留给搜索框光标（PopupSelectView.tsx:97-132）；任意外部 pointerdown 关闭（:75-83）。
- stale-while-revalidate：新 query 触发 refinement 时旧行保持可见（menu.ts:96-110），新结果落地整组替换。

### 1.5 视觉规格（复刻基准）

- 容器：`MenuSurface`（`ui-primitives/src/MenuSurface.tsx:20-46`）半透明材质 `var(--dsw-menu-surface-fill)` + backdrop-filter，macOS 加不透明 backing portal；内边距 4px。
- 行：高 34px、图标 14px、名称 13px、描述右对齐 12px tertiary、别名右侧 tertiary；节标题 11px/500/tertiary；`.item.active` 背景 `var(--dsw-alias-interactive-bg-hover)`。
- popupSelect 卡：`bottom:calc(100% + 4px)`、`min-width:min(220px,100%)`、`max-height:320px`（PopupSelectView.module.css:1-38，`useAnchoredMaxHeight` 上限 320）；分组粘性标题 `MenuGroup` + `observeStickyMenuGroups`；带搜索框（permission 为 substring 过滤 `filterOptions` ui-commands/popup.ts:102-115，model 为 fuzzy-label）。

### 1.6 locale 键（精确）

- `command` 命名空间（`ui-commands/src/client/locales.ts:9-38`）：节标题 `section.add`=添加、`section.commands`=指令；标题 `label.goal/plan/feedback/compact/permission/export`；描述 `description.*`（见 1.2 表）；claim token `token.goal`=目标、`token.plan`=计划、`token.feedback`=反馈、`token.compact`=压缩、`token.permission`=权限、`token.export`=导出；另有 `search.*`/`status.*`/`overlay.aria`/`listbox.aria`/`notice.attachmentsUnsupported`。
- `conversation` 命名空间：`input.commands`=添加文件或调用指令、`input.file`=文件、`hint.goal`/`hint.goal.active`/`hint.plan`、`shortcut.slash`=打开命令菜单。
- `slash.menu` 命名空间（ui-input-trigger/locales.ts:8-18）：组标题按 source 名查键 `command`=指令、`skill`=技能（有查询时显示）；`loading`、`drill.*`、`suggestions.aria`。

### 1.7 复用判定

- `ui-input-trigger/client` 导出 `InputTriggerService`、`InputTriggerController` 及类型，**不导出 `MenuView` 组件本体**；`ui-commands/client` 导出 `CommandUiRuntime`、`CommandDirectory`、`filterOptions`、`PopupSelectController` 及契约类型，**不导出 `PopupSelectView`**。→ **视图必须自绘**。
- 官方预留的正规注入路径是 `ctx.commandUi.register({ name, label, description, icon, available, ui })`（把命令贡献进宿主菜单）与 `inputTriggers.registerSource(...)`——但接管后宿主 MenuView 不渲染，这条路只对「不接管时」有意义。
- **数据可达**：`remote.commands.list(sessionId)`（service.ts:108）+ `remote.commands.execute(sessionId, line, attachments)`（:406）——自绘菜单可以直接吃 Host 命令目录，不必静态写死八条目；`remote.commands` 面经 `remote` 注入即可拿到（ui-commands 的 inject 就是 `['inputTriggers','sessions','remote','remote.commands']`）。

---

## 2. 权限预设弹层（仅可查看 / 工作区内修改 / 完全权限）

### 2.1 组件结构

- 座位：`conversation.input.permission`（slots.ts:217，`kind:'single'`，owner `InputControlOwnerProps={locked}`）。渲染点 `InputBar.tsx:443`（左侧 `.modes` 容器 `gap:12px`，+ 按钮之后、plan 之前）。
- 组件：`PermissionSelect`（`ui-permission-presets/src/client/PermissionSelect.tsx:165-214`）= **ui-primitives `<Menu>`**（`open/items/selectedId/onSelect/onClose side="top" portal anchor={权限 pill}`）+ 可选 `RiskConfirmation` 模态（:197-212）。
- 行渲染（`Menu.tsx` renderEntry :439-500）：`<button role="menuitem">` = 图标 14px + 文本 13px + 尾随勾 `IconCheckOutlineRegular`（`selection='check'` 默认，Menu.tsx:168）；**选中行不保持背景填充，唯一标记是尾随 ✓**（`.selected{background:transparent}` Menu.module.css:216-218）；hover/focus 同色 `--dsw-alias-interactive-bg-hover`。
- 定位：`side="top"` portal 到 body，`y = r.top - lh - 4`（列表顶到锚上方 4px），12px 视口边距钳制，打开期间 rAF 逐帧跟踪锚 + scroll 捕获 + resize（Menu.tsx:244-297）；首次渲染隐藏测量防跳动。
- 权限 pill（anchor，PermissionSelect.tsx:176-194）：28px 高透明按钮 = `permissionGlyph(当前值)` 图标 + **当前预设名文本**（非静态「权限」二字）+ 可选 badge 上标 + `IconChevronDownOutlineRegular`（开合旋转 180°）；`aria-label="访问模式，当前：{name}"`；`disabled={locked || busy}`；窄容器（≤460px）隐藏文字只剩图标。

### 2.2 预设全集与 auto 预设的条件挂载

- 生产三预设来自**部署配置**（`packages/bundle/base/cordis.patch.yml:253-260`）：
  ```yaml
  presets:
    read-only:         { sandbox: read-only,         approval: ask }
    workspace-write:   { sandbox: workspace-write,   approval: ask }
    danger-full-access:{ sandbox: danger-full-access, approval: never }
  ```
  顺序即声明顺序，与桌面端展示一致。
- 代码内置默认只有 workspace-write + danger-full-access（`permission-presets/src/index.ts:182-199`）；`custom`/`auto` 为保留名（:213-218 显式拒绝）。沙箱全集 `SANDBOX_MODES = ['read-only','workspace-write','danger-full-access']`（sandbox-policy/session-mode.ts:42）。
- **auto 预设存在但条件挂载**：`AUTO_PRESET='auto'`，spec `{ sandbox:'danger-full-access', approval:'ask' }`（:82-92）；仅当实验性 auto-review 插件 `registerAuto()` 才追加进 `names`（:284-286, 307-317；唯一调用方 auto-review/src/index.ts:723）。生产 bundle 未组合 auto-review → 桌面端默认只见三项。若存在：label `t('auto.label')`=Auto review + `EXP` 上标 badge、无图标。
- `custom` 是派生值（旋钮组合匹配不到预设时的 current 显示），永不出现在可切换项。
- 图标：`PermissionIconReadOnlyRegular` / `PermissionIconWorkspaceWriteRegular` / `PermissionIconFullAccessRegular`（ui-primitives PermissionIcon.tsx；host 自配的其它值无图标）。

### 2.3 当前值读取（permissions 投影）

- 投影类型：`PermissionSelection { currentValue: string }`（permission-presets/src/types.ts:35-39），由三个旋钮事件折叠：`permission/preset`、`sandbox/mode`、`approval/policy`（+ `session/end-seed`）；key 缺失 = 宿主未组合权限服务 → 客户端隐藏控件。
- 宿主注册（:237-244）：`ctx.sessionProjections.register({ key:'permissions', stateVersion:2, wire:{ view: state => ({ currentValue: this.derive(state) }) } })`；`derive`（:348-361）先看上次选的 preset 是否仍匹配 spec（auto 特例：`approval==='never'` 也算匹配），否则按声明序找第一个匹配配置预设，都不匹配 → `custom`。
- 客户端订阅：组件 `useProjection('permissions')`（PermissionSelect.tsx:79）；非组件路径 `session.projections.faceOf('permissions').getSnapshot()`（client/index.ts:72-75）。

### 2.4 切换流程

- `choose`（PermissionSelect.tsx:129-138）：先 `setOpen(false)`；`id === selection.currentValue` 直接返回；`FULL_ACCESS('danger-full-access') || AUTO_REVIEW('auto')` → 打开 RiskConfirmation；否则 `submit(id)`。
- `submit`（client/index.ts:123-132）：`live.command('/permission ${preset}')` —— **wire token 就是预设 id 本身**（`read-only` / `workspace-write` / `danger-full-access` / `auto`）；`result.ok===false` 或 `result.value.matched===false` 抛错。
- **无乐观更新**：推送回来的投影帧就是唯一确认（包头注释 index.ts:8-13）；busy 期间触发器置灰（`setPick`）。
- `/permission` 空参返回当前值 + 可用列表；未知名报错（index.ts:269-271）。
- Settings 行（新会话默认值）走另一条写路径 `remote.settings.mutate('permission', ...)`，与接管卡无关。

### 2.5 RiskConfirmation

- 定义：`ui-primitives/src/RiskConfirmation.tsx:29-83`（受控组件 = `Modal` + 警告图标 + 描述 + 勾选框「我已了解风险，并愿意继续」+ footer 两按钮）；确认按钮 `disabled={disabled || !acknowledged}`。
- **danger-full-access 和 auto 都要确认**（不只完全权限，PermissionSelect.tsx:132-136）；文案键组 `confirm.*` vs `auto.confirm.*`；模态打开期间 `acknowledged` 每次重置 false；**无「记住选择」持久化**；`onConfirm` = 先关模态再 submit；会话/目录失效时 useEffect 强制关弹窗+清确认（:86-92）。

### 2.6 键盘 / locale / 复用

- 键盘（Menu.tsx）：Escape（非 Shift）→ onClose + `refocusAnchor`；Shift+Tab = Escape；焦点在 menuitem 上时 Tab = 点击选中；ArrowUp/Down/Home/End 环形走查（从触发器进入：↓ 从头、↑ 从尾）；外部 pointerdown 关；无 `closeOnPointerLeave`（菜单停留到选中/Escape/外点）。
- locale（命名空间 `permission.access`，locales.ts:42-60）：`mode`=访问模式，当前：{name}、`close`=关闭、`preset.readOnly`=仅可查看、`preset.workspaceWrite`=工作区内修改、`preset.fullAccess`=完全权限、`confirm.title/description/acknowledge/cancel/enable`（确认启用完全权限?…/取消/启用完全权限）、`auto.label/badge/description/confirm.*`。弹窗**无标题行**。
- 复用判定：`ui-permission-presets/client` 运行时只导出 `apply`/`inject` + 纯类型（`PermissionSelectInjected` 等），组件与 `PermissionCatalogDirectory` **不导出** → 视图自绘（`<Menu>` 原语在种子包 ui-primitives 里，可直接用）；数据层 = `useProjection('permissions')` + `remote.permissionPresets.catalog()` + 事件 `permission-presets/catalog-changed`（catalog.ts:134, 46-49）。
- 重建需要的注入面（仿 `PermissionSelectInjected`）：`hooks.permissionCatalog: HostObservable<PermissionCatalogState>`、`select: (preset) => Promise<boolean>`、`locked`、locale 席位（namespace `permission.access`）。

---

## 3. 模型 / 推理等级弹层（模型 DeepSeek-V41-Flash › / 推理等级 High ›）

### 3.1 结构：一张卡三 pane，不是子菜单滑出

- 组件：`ModelSelect`（`ui-model-selection/src/client/ModelSelect.tsx`）；`type Pane = 'root' | 'model' | 'effort'`（:46）。
- root pane 两行（:488-503）：每行 `<button role="menuitem" className={css.cell}>` = `menu.model` 模型 + 当前模型名 + `IconChevronRightOutlineRegular`；推理等级行**仅当 `reasoning !== undefined`**（:495，即当前模型的 catalog 条目带 reasoning 元数据）。
- 点击 → `drill(next)`（:269-274）仅 `setPane(next)` + 重置 query/highlight——**同一张 `MenuSurface` 卡片内容整体切换**，无动画；`back(from)`（:277-280）返回 root 并把焦点交还打开它的 cell。
- 定位自算（:213-237）：`x = rect.right - lw`（**右缘与触发器对齐**，刻意镜像 `useAnchoredPosition` 的左缘放置）、`y = rect.top - 8 - lh`（触发器上方 8px）、MARGIN 12 钳制、隐藏测量再落位、scroll(capture)/resize 重算。卡片 CSS（module.css:91-117）：`position:fixed; z-index:1100; width:max-content; min-width:min(240px, 100vw-32px); max-width:min(420px,…); max-height:min(360px, 100vh-96px)`。
- sticky 分组标题：`observeStickyMenuGroups`（MenuGroup.tsx:30-103）。

### 3.2 数据：ModelDirectoryState

- `directory.ts:18-35`：
  ```ts
  { current: ModelSelection|null, retainedEffort?: string, routable: boolean|null,
    groups: readonly ModelProviderGroup[], failures: readonly ModelCatalogFailure[],
    status: 'idle'|'loading'|'ready'|'selecting'|'error', pending: ModelSelection|null, error: string|null }
  ```
- catalog 类型（session-controller/src/types.ts）：`ModelCatalogModel { id, name, description?, reasoning? }`（:136-141）、`ModelProviderGroup { id, name, models }`（:144-148）、`ModelReasoning { efforts, defaultEffort? }`（:130-133）、`ModelReasoningEffort { id, name, description? }`（:123-127）、`ModelSelection { provider, model, reasoningEffort? }`（:100-104）、`ModelCatalog { default, routableProviders, groups, failures }`（:158-164）。
- catalog 来自 Host RPC `session.modelCatalog()`（model.name 来自 `ctx.llm.resolveModelInfo`）；分组排序 `deepseek-account` 第一、`deepseek-official` 第二（provider-order.ts:8-12）；分组标题 `group.id==='deepseek-account' ? t('provider.account')「DeepSeek 账号」 : group.name`。
- 推理等级列表**不是客户端写死**：`reasoning.efforts` 由 Host adapter 下发；无 `defaultEffort` 时多一行 `t('effort.providerDefault')`=Default（选它 = 清除自定义 effort，`chooseEffort(undefined)`，:127-138）。当前值 `effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort`（:121）。
- `retainedEffort`（:164-165）：当前模型不可用（reasoning 元数据拿不到）时，触发器与菜单仍显示保存的 effort 名。

### 3.3 选择流程与状态呈现

- 模型行选中标记：`selected = current.provider===group.id && current.model===model.id` → `role="menuitemradio"` + `aria-checked` + 尾随 `IconCheckOutlineRegular`（:564-594）；**选中行不保持填充**；在途（pending）时勾位置换 `StateDot state="ongoing"` 转圈（:591-593）。
- `choose`（:392-398）：同路由仅关闭；否则 `select(selection)` → `ModelDirectory.select`（directory.ts:91-128）= `sessions.selectModel({ sessionId, provider, model, reasoningEffort? })`，generation 防乱序，失败写 store.error，成功 `syncInputs()`；埋点 `model_switch` / `thinking_level_switch`（换 effort 走后者）。无确认对话框。
- **effort 与模型是同一动作**：`chooseEffort` 构造完整 `ModelSelection { provider, model, reasoningEffort }` → `select`。
- 失败呈现：选模型失败 → **瞬态 Toast**（anchor `[data-composer-card]`；`session/writer-held` 专门映射 `error.sessionInUse`=「当前会话已被占用…」，:368-382）；目录加载失败 → 菜单内错误条 + Retry（:539-549）。
- 禁用：行 `disabled={busy}`（仅选择在途）；trigger `disabled={locked}`；**运行中（adjudicating/submitting）不锁模型座位**（`modelSeatLocked = removed || inert || !live`，InputBar.tsx:141-145 注释「模型座位是 block 唯一不锁的控件」）；子代理会话 available=false → 组件 return null。

### 3.4 触发器 chip 与显示名

- 锚点：`conversation.input.model` 座位（slots.ts:223），渲染点 `InputBar.tsx:455`（右侧 `standardControls`）。
- chip（ModelSelect.tsx:446-473）：`IconDataOutlineRegular`(16px) + 模型名 + effort span（格式 **`{modelLabel} · {effortLabel}`**）+ 尾部（busy → StateDot，否则 chevron 开合旋转 180°）；`aria-haspopup="menu"`、`aria-expanded`、`title={triggerLabel}`。
- 显示名链（:414-426）：加载中 `t('trigger.loading')`=正在加载模型… → 目录显示名（`model.name`，即「DeepSeek-V41-Flash」）→ 兜底 `provider/model` ID 拼接 → 未选 `t('trigger.fallback')`=请选择模型。
- 截断：chip 28px 高 `max-width:min(360px, 45cqw)`，模型名 ellipsis，effort span `flex-shrink:1000` 先被压缩；放不下时 `--dsh-composer-model-text-display:none` 切纯图标。

### 3.5 键盘 / locale / 复用

- 键盘（onRootKeyDown :295-358）：Escape 先退 pane（`pane!=='root'` → back）再 close 回焦 trigger（IME 组合期忽略）；↑/↓ 行间循环移焦（搜索模式下不离开搜索框、只移高亮，焦点回 search）；搜索模式 Enter/Tab 接受高亮；Tab 在 trigger 上 = 进入菜单落焦当前值行（`[aria-checked="true"]`）或搜索框；Shift+Tab = 退 pane/关闭。外部 mousedown 或 blur 出界关闭。>4 个模型才显示搜索框（:106）。
- locale（命名空间 `model`，locales.ts:13-35 zh）：`menu.model`=模型、`menu.effort`=推理等级、`menu.aria`=模型与推理等级、`effort.providerDefault`=Default、`provider.account`=DeepSeek 账号、`trigger.fallback/loading/aria/ariaEffort`、`command.label/description`、`status.loading`/`action.reload`/`error.action`/`error.sessionInUse`/`warning.groupLoad`/`option.loadError`/`search.placeholder`=搜索模型…/`search.clear`/`search.empty`/`empty.models`/`empty.efforts`。
- **复用判定（两条路）**：
  1. **数据直连**：宿主挂载 ui-model-selection 的 apply 后注册了 `ctx.modelDirectories`（ModelDirectoryResolver，service.ts:47）——插件 inject 数组加 `'modelDirectories'` 即可 `ctx.modelDirectories.directoryFor(sessionId)` 拿 `{ store, load, select }`，配 `available = sessions.subagentAddress(sessionId)===undefined`、`t = ctx.locale.bind('model')` 正好凑齐 `ModelSelectInjected { available, directory: SnapshotStore, load, select }`（slots.ts:13-26）。**不要**再挂一个 ModelDirectoryResolver（同名服务）。
  2. **视图 vendor**：`ModelSelect.tsx` 运行时外部依赖只有 ui-primitives（种子）、react/react-dom（种子）、clsx（自动内联）、css modules（tsdown 内联），其余全是 type-only —— 把 `ModelSelect.tsx + module.css + locales.ts + provider-order.ts` **拷贝进插件源码**、数据从 `ctx.modelDirectories` 注入，可零新增模块表行复刻弹窗。纯度门禁止跨包 `import '@deepseek-ai/*/src/*'` 值导入（tsdown.client.ts:529-546），所以必须拷贝不能深导入。
  - `ModelSelect` 组件与 `ModelCatalogDirectory` 都不在 `./client` 导出里；`ModelDirectory`/`ModelDirectoryResolver` 是值导出（client/index.ts:33,35）。
  - 若走外挂路径：package.json `dsh.client.external: ["@deepseek-ai/dsh-client-ui-model-selection/client"]` → tsdown `neverBundle` 保留 require，boot graph 先物化该包。

---

## 4. 落地映射（dsh-markdown-input 接管卡）

| 面件 | 视图 | 数据/动作 | 备注 |
|---|---|---|---|
| ① + 命令菜单 | 自绘 MenuView 复刻（34px 行、节标题、右对齐描述、mousedown 选中、aria-activedescendant） | `remote.commands.list` 拉 Host 目录 + 本插件自贡献条目拼装；`SECTION_ROWS` 分节硬编码对齐当前宿主 | `goal`/`plan` 的 claim token 幽灵提示在 CM6 里用 decoration 仿（ADR-0001）；`feedback`/`compact`/`export` 动作直达；permission/model 行链式打开接管卡自己的第二层弹卡 |
| 文件 file | 菜单行 | 隐藏 `<input type="file" multiple>` + 宿主附件 API（早期版本已真机验证） | 可用性沿 `canAcceptDrop` 条件 |
| ② 权限 | `<Menu side="top" portal selection="check">`（ui-primitives 直用）+ RiskConfirmation | `useProjection('permissions')` 读当前值；`live.command('/permission <token>')` 写 | token=id 本身；danger-full-access 确认门；投影帧即确认，无乐观更新 |
| ③ 模型 | vendor ModelSelect（拷 4 文件）或自绘仿制 | `ctx.modelDirectories.directoryFor()` 的 `{store, load, select}` | effort 列表宿主下发；`模型 · effort` chip 格式；失败 Toast |
| ④ 发送/停止 | 早期版本已真机验证（#11） | `inputActions.submit()`（queue）+ 内部 cancel 面 | 对齐 rc.2 submission-policy；停止臂语义见 [CONTEXT.md](../../CONTEXT.md)「停止臂」 |

**实现前须验证的点**：
1. 插件 inject 数组能否直接收 `'modelDirectories'`（cordis 服务名注入到第三方插件）——不行则走 `dsh.client.external` 导入 `ModelDirectory` 值自建实例（构造依赖 sessions/remote 均已可注入）。
2. `remote.permissionPresets` 面（catalog RPC + 事件订阅）对第三方插件是否可达——不行则退化用 `permissions` 投影 + `/permission` 空参返回值拼目录（`/permission` 空参返回当前值+可用列表，够用但缺 description/icon 映射，需按 id 硬编码三件套图标文案）。
3. MenuView 复刻的 outside-dismiss 与接管卡焦点环（combobox 模式：菜单开着焦点必须在编辑器）。

**视觉基准速记**：菜单底边贴卡上缘+4px 宽=卡宽 max-height 400（顶留 84）；popupSelect 卡 max-height 320 min-width 220；模型卡 fixed 右对齐触发器上方 8px z-1100 min-240 max-420/max-height 360；行高 34 图标 14 名称 13 描述 12 右对齐；节标题 11/500 tertiary；选中=尾随勾无填充；hover/focus/active 同色 `--dsw-alias-interactive-bg-hover`。

---

## 相关文档

- 决策记录：[ADR-0002 选举链接管](../adr/0002-composer-chain-takeover.md) · [ADR-0005 接管卡复活](../adr/0005-composer-revival.md)（弹层自绘的由来与硬化约束）
- 同级深文：[extension-points](extension-points.md)（slot 面、InputActions 公开 API 与双半结构全景） · [prior-art](prior-art.md)（ChatGPT 输入区行为对照）
- 术语：[CONTEXT.md 词汇表](../../CONTEXT.md)（接管卡、幽灵提示、排队消息栏、计划 chip 等）
