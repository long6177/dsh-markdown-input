/** Copy for the markdown-input composer, zh/en. */

export const NS = 'markdown-input'

const zh = {
  'composer.placeholder.render': '以 Markdown 撰写…（Enter 发送，Shift+Enter 换行）',
  'composer.placeholder.source': 'Markdown 源码…（Enter 发送，Shift+Enter 换行）',
  'composer.action.submit': '发送',
  // Send-mode labels (issue #79) — the host `conversation` namespace's own
  // keys copied verbatim (`input.send.queue` / `input.send.steer`): the
  // primary seat names the delivery mode the gesture resolves to, exactly
  // the native bar's primaryLabel arms.
  'composer.send.queue': '排队发送',
  'composer.send.steer': '插话发送',
  // Stop action (issue #32) — the host `conversation` namespace's `input.stop`
  // copied verbatim: the takeover card names stop exactly as the native bar.
  'composer.action.stop': '停止生成',
  'composer.mode.render': '渲染',
  'composer.mode.source': '源码',
  'composer.mode.toggle': '切换到{mode}模式',
  'composer.attach': '添加附件',
  'composer.dropHere': '松开以添加附件',
  'composer.attachment.remove': '移除附件',
  'composer.file.stillUploading': '仍有文件在上传，请稍候',
  'composer.file.uploading': '上传中…',
  'composer.file.uploadFailed': '上传失败',
  'composer.file.retry': '重试上传',
  'composer.file.rejected': '附件被拒绝',
  // Draft-image preview (#77). The host `conversation` namespace's own keys
  // copied verbatim (`image.openOriginal` / `image.preview` /
  // `image.closePreview`) — the lightbox chrome reads them through the card's
  // plugin namespace so the fallback ships with the plugin.
  'image.openOriginal': '查看原图',
  'image.preview': '原图预览',
  'image.closePreview': '关闭原图预览',
  // Pick-time image-limit rejections (issue #80) — the host `conversation`
  // namespace's own lines copied verbatim, the fallback for a build whose
  // dictionary misses them.
  'image.unsupportedType': '仅支持 PNG、JPG、WebP、GIF 格式的图片',
  'image.tooMany': '一条消息最多添加 {count} 张图片',
  'image.fileTooLarge': '单张图片不能超过 {size}',
  'image.totalTooLarge': '图片总大小超过 {size}，请移除部分图片',
  'composer.notice.dismiss': '关闭提示',
  'composer.fallback.notice': 'Markdown 输入区出现异常，已换回原生输入区；本次会话内不再重试，重启后恢复。',
  'permission.mode': '访问模式，当前：{name}',
  'permission.close': '关闭',
  'permission.preset.readOnly': '仅可查看',
  'permission.preset.workspaceWrite': '工作区内修改',
  'permission.preset.fullAccess': '完全权限',
  'permission.confirm.title': '确认启用完全权限？',
  'permission.confirm.description': '启用完全权限后，智能体将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。',
  'permission.confirm.acknowledge': '我已了解风险，并愿意继续',
  'permission.confirm.cancel': '取消',
  'permission.confirm.enable': '启用完全权限',
  'permission.auto.label': 'Auto review',
  'permission.auto.badge': 'EXP',
  'permission.auto.description': '无沙箱运行；每次原生工具调用和 PTC 内层调用前由同一模型进行实验性审查。',
  'permission.auto.confirm.title': '确认启用 Auto review（实验）？',
  'permission.auto.confirm.description': 'Auto review 不使用沙箱。每次原生工具调用和 PTC 内层调用前，都会由与当前 agent 相同的模型进行审查；审查拒绝的调用由你批准或拒绝。此功能仍属实验性，可能误放行或误拒绝，并会消耗额外 token。',
  'permission.auto.confirm.acknowledge': '我已了解这些风险，并愿意继续',
  'permission.auto.confirm.enable': '启用 Auto review',
  'permission.switchFailed': '权限切换失败：{message}',
  'permission.unmatched': '宿主不提供 /permission 命令',
  'permission.retry': '重试',
  // `+` command menu (tool row ①). Row faces mirror the host `command`
  // namespace copy verbatim; the trigger title mirrors `conversation.
  // input.commands`.
  'command.menu.open': '添加文件或调用指令',
  'command.menu.section.add': '添加',
  'command.menu.section.commands': '指令',
  'command.menu.listbox': '触发候选建议',
  'command.menu.file': '文件',
  'command.menu.model': '模型',
  'command.menu.model.description': '选择本会话使用的模型',
  'command.label.goal': '目标',
  'command.label.plan': '计划',
  'command.label.feedback': '反馈',
  'command.label.compact': '压缩',
  'command.label.permission': '权限',
  'command.label.export': '下载日志',
  'command.description.goal': '设置或查看长期任务目标',
  'command.description.plan': '进入或退出计划模式',
  'command.description.feedback': '发送关于当前会话的反馈',
  'command.description.compact': '压缩以上对话内容',
  'command.description.permission': '切换权限预设（沙箱模式与审批策略）',
  'command.description.export': '将当前会话内容导出为 ZIP',
  'command.token.goal': '目标',
  'command.token.plan': '计划',
  'command.token.feedback': '反馈',
  'command.token.permission': '权限',
  // Claim ghost hints (T9) — the native `conversation` namespace's keys,
  // copied verbatim (`hint.goal` / `hint.goal.active` / `hint.plan`).
  'composer.hint.goal': '输入目标，智能体将持续执行',
  'composer.hint.goal.active': '当前目标进行中。可输入 edit 修改 / pause 暂停 / resume 继续 / clear 清除',
  'composer.hint.plan': '描述你的任务以生成计划',
  // Runtime placeholders (issue #34) — the native `conversation` namespace's
  // keys copied verbatim (`placeholder.plan` / `placeholder.steerQueue`).
  'composer.placeholder.plan': '描述你的任务以生成计划',
  'composer.placeholder.steerQueue': 'Cmd/Ctrl+Enter 插话发送全部排队消息',
  // Plan chip (issue #34) — the native `plan` namespace's chip keys copied
  // verbatim (`chip.label` / `chip.on.aria` / `chip.on.title` /
  // `chip.exitFailed`).
  'plan.chip.label': '计划',
  'plan.chip.on.aria': '计划模式已开启，按下关闭',
  'plan.chip.on.title': '计划模式已开启 — 点击关闭（/plan off）',
  'plan.chip.exitFailed': '退出计划模式失败',
  // Goal strip (issue #34) — the native `goal` namespace's strip keys
  // copied verbatim (`phase.*` / `objective.aria` / `action.*`).
  'goal.phase.active': '进行中的目标',
  'goal.phase.active.disarmed': '未运行的目标',
  'goal.phase.paused': '已暂停的目标',
  'goal.phase.blocked': '受阻的目标',
  'goal.objective.aria': '目标内容',
  'goal.action.save': '保存目标',
  'goal.action.cancel': '取消编辑',
  'goal.action.pause': '暂停目标',
  'goal.action.resume': '恢复目标',
  'goal.action.edit': '编辑目标',
  'goal.action.clear': '清除目标',
  'command.executeFailed': '命令执行失败：{message}',
  'command.executeError': '{text}',
  'command.executeUnmatched': '未知或格式错误的命令',
  // Typed-trigger completion popups (T10). Group titles mirror the host
  // `slash.menu` namespace copy verbatim (`command`/`skill`/`loading`/
  // `drill.*`/`suggestions.aria`); the file section title mirrors the host
  // `ui-reference` `section.files`; the skill marker mirrors `menu.userOnly`.
  'completion.suggestions.aria': '触发候选建议',
  'completion.loading': '正在加载…',
  'completion.group.command': '指令',
  'completion.group.skill': '技能',
  'completion.section.files': '文件与文件夹',
  'completion.drill.hint': '进入目录',
  'completion.drill.key': 'Tab',
  'completion.drill.aria': '进入目录',
  // The drilled-source breadcrumb (issue #80) — the host `ui-input-trigger`
  // `crumbs.aria` / `ui-reference` `crumb.root` lines under this plugin's own
  // namespace (that namespace is outside this build's dictionary table).
  'completion.crumbs.aria': '目录导航',
  'completion.crumb.root': '工作区',
  'completion.skill.userOnly': '仅用户',
  // `@` session-mention rows (#75). The section titles, the no-cwd marker,
  // and the relative-time words are the host `ui-reference` namespace's own
  // copy verbatim (`reference` NS), shipped here as the popup's own fallback
  // keys — the same posture as `completion.section.files` above.
  'completion.section.subagents': '子智能体',
  'completion.section.sessions': '对话',
  'completion.candidate.noCwd': '（无工作目录）',
  'completion.time.now': '刚刚',
  'completion.time.minutes': '{n}分钟',
  'completion.time.hours': '{n}小时',
  'completion.time.days': '{n}天',
  'completion.time.months': '{n}个月',
  'completion.time.years': '{n}年',
  // Queue strip (issue #30). The native composer's queue dock renders inside
  // the fallback bar, which the takeover hides (overlay election), so the
  // card rebuilds it; keys mirror the host `conversation` namespace copy
  // verbatim (`queue.*`).
  'queue.count': '{n} 条排队消息',
  'queue.sending': '发送中…',
  'queue.edit': '编辑排队消息',
  'queue.edit.unsupported': '包含非文本内容，暂不支持编辑',
  'queue.save': '保存排队消息',
  'queue.cancelEdit': '取消编辑',
  'queue.remove': '删除排队消息',
  'queue.steer': '插话发送',
  'queue.steer.unavailable': '仅运行中可插话发送',
  'queue.editFailed': '编辑失败：这条消息可能已经开始发送。',
  'queue.removeFailed': '删除失败：这条消息可能已经开始发送。',
  'queue.steerFailed': '插话发送失败，请重试。',
  // Queue strip attachments (#77) — the native `conversation` namespace's
  // own keys copied verbatim (`queue.image` / `queue.file`).
  'queue.image': '排队消息图片',
  'queue.file': '排队文件 {name}',
  // Todo panel (issue #38). The native TodoDock renders inside the composer
  // chain's fallback bar, which the takeover hides whole, so the card
  // rebuilds it; keys mirror the host `conversation` namespace copy verbatim
  // (`todo.title` / `todo.progress.*` / `todo.status.*`).
  'todo.title': '任务',
  'todo.progress.done': '{done} 已完成',
  'todo.progress.active': '{active} 进行中',
  'todo.progress.pending': '{pending} 待处理',
  'todo.status.completed': '已完成',
  'todo.status.inProgress': '进行中',
  'todo.status.pending': '待处理',
  // Agent-preset seat (issue #42, ADR-0006 option B). The host's
  // `settings.agentPreset` dictionary belongs to the ui-agent-preset plugin,
  // which is NOT in this build's dependency tree, so its keys are not ours to
  // bind — the seat ships its own three strings instead of guessing host copy
  // (the one user-visible cost is that a shipped preset publishes no `name`,
  // so the roster's own id is what the chip and the rows show).
  'agentPreset.hint': '选择新任务使用的 Agent 预设',
  'agentPreset.noDescription': '暂无描述。',
  'agentPreset.switchRefused': '无法切换 Agent 预设：{reason}',
  // Stats pills (issue #43, alpha.13). The pill copy is the host `chat`
  // namespace's own (`ui-chat/src/client/locale.ts`, bound read-only in
  // apply); these are the same lines copied verbatim as the fallback keys a
  // build without those dictionary entries resolves through. The dialog keys
  // (issue #43's third round) ride the same fold: the two dialog headings and
  // row labels, the duration templates, the exact-count wrapper's bucket
  // labels, and the grouping separator.
  'stats.counts': '{turns} 轮 {steps} 步',
  'stats.cacheHit': '缓存命中 {percent}%',
  'stats.dialog.title': '会话统计',
  'stats.dialog.usageTitle': 'Token 用量',
  'stats.dialog.llmTime': '模型用时',
  'stats.dialog.toolTime': '工具调用用时',
  'stats.dialog.ttft': '首 token 平均（TTFT）',
  'stats.dialog.speed': '输出速度（TPS）',
  'message.tokensPerSecond': '{tps} tok/s',
  'message.turnUsage.count': '{count} tok',
  'message.turnUsage.cacheHit': '缓存命中',
  'message.turnUsage.input': '未缓存输入',
  'message.turnUsage.cacheRead': '缓存读取',
  'message.turnUsage.cacheWrite': '缓存写入',
  'message.turnUsage.output': '输出',
  'duration.compactSeconds': '{seconds}秒',
  'duration.compactMinutes': '{minutes}分{seconds}秒',
  'number.thousand': '{value}K',
  'number.million': '{value}M',
  'number.groupSeparator': ',',
  // Workspace menu add row (issue #42, alpha.13 retest). The copy is the host
  // `workspace` namespace's own (`ui-workspace/src/client/locales.ts`,
  // `menu.addWorkspace` / `folderError.*`, bound read-only in apply); these
  // are the same lines copied verbatim as the fallback keys a build without
  // those dictionary entries resolves through.
  'workspace.menu.addWorkspace': '添加工作区…',
  'workspace.folderError.title': '无法打开文件夹',
  'workspace.folderError.retry': '重新选择',
  // Reference surfaces (#75) — the host words copied verbatim as the
  // fallback keys the reference-locale folds resolve through. The file-open
  // dialog's lines are the host `reference` namespace's own (ui-reference);
  // the summary line's are the host `chat` namespace's own (ui-chat,
  // rendered by the host UserContent fold too).
  'fileOpen.title': '无法打开文件',
  'fileOpen.failed': '无法打开“{path}”，请重试或关闭此提示',
  'fileOpen.close': '关闭',
  'fileOpen.retry': '重试',
  'secret.reveal': '显示密钥',
  'secret.hide': '隐藏密钥',
  'message.referenceSummary': '引用会话 · {labels}',
  'message.referenceSeparator': '、',
} as const

export type ComposerKey = keyof typeof zh

const en: Record<ComposerKey, string> = {
  'composer.placeholder.render': 'Write in Markdown… (Enter to send, Shift+Enter for newline)',
  'composer.placeholder.source': 'Markdown source… (Enter to send, Shift+Enter for newline)',
  'composer.action.submit': 'Send',
  // Send-mode labels (issue #79) — the host `conversation` namespace's own
  // lines copied verbatim (see the zh block above for the fold).
  'composer.send.queue': 'Queue message',
  'composer.send.steer': 'Steer message',
  'composer.action.stop': 'Stop generating',
  'composer.mode.render': 'Render',
  'composer.mode.source': 'Source',
  'composer.mode.toggle': 'Switch to {mode} mode',
  'composer.attach': 'Attach files',
  'composer.dropHere': 'Release to attach',
  'composer.attachment.remove': 'Remove attachment',
  'composer.file.stillUploading': 'A file is still uploading; try again shortly',
  'composer.file.uploading': 'Uploading…',
  'composer.file.uploadFailed': 'Upload failed',
  'composer.file.retry': 'Retry upload',
  'composer.file.rejected': 'Attachment rejected',
  // Draft-image preview (#77) — the host `conversation` namespace's lines
  // copied verbatim (see the zh block above for the fold).
  'image.openOriginal': 'View original',
  'image.preview': 'Original image preview',
  'image.closePreview': 'Close original image preview',
  // Pick-time image-limit rejections (issue #80) — the host lines verbatim.
  'image.unsupportedType': 'Only PNG, JPG, WebP, and GIF images are supported',
  'image.tooMany': 'A message can include up to {count} images',
  'image.fileTooLarge': 'Each image must be smaller than {size}',
  'image.totalTooLarge': 'Images exceed {size} in total; remove some and try again',
  'composer.notice.dismiss': 'Dismiss notice',
  'composer.fallback.notice': 'The Markdown composer hit an error and fell back to the native input area; it will not retry this session, and resumes after a restart.',
  'permission.mode': 'Access mode, current: {name}',
  'permission.close': 'Close',
  'permission.preset.readOnly': 'Read Only',
  'permission.preset.workspaceWrite': 'Workspace Write',
  'permission.preset.fullAccess': 'Full access',
  'permission.confirm.title': 'Enable Full access?',
  'permission.confirm.description': 'Full access reduces confirmation steps and lets the agent perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust the current task.',
  'permission.confirm.acknowledge': 'I understand the risks and want to continue',
  'permission.confirm.cancel': 'Cancel',
  'permission.confirm.enable': 'Enable Full access',
  'permission.auto.label': 'Auto review',
  'permission.auto.badge': 'EXP',
  'permission.auto.description': 'Run without a sandbox after an experimental same-model review of every native tool call and PTC inner call.',
  'permission.auto.confirm.title': 'Enable Auto review (experimental)?',
  'permission.auto.confirm.description': 'Auto review runs without a sandbox. Before every native tool call and PTC inner call, the same model as the current agent reviews whether to allow it; you approve or reject each call it denies. This feature is experimental, can falsely allow or deny actions, and uses additional tokens.',
  'permission.auto.confirm.acknowledge': 'I understand these risks and want to continue',
  'permission.auto.confirm.enable': 'Enable Auto review',
  'permission.switchFailed': 'Permission switch failed: {message}',
  'permission.unmatched': 'The host offers no /permission command',
  'permission.retry': 'Retry',
  'command.menu.open': 'Add files or run commands',
  'command.menu.section.add': 'Add',
  'command.menu.section.commands': 'Commands',
  'command.menu.listbox': 'Trigger suggestions',
  'command.menu.file': 'File',
  'command.menu.model': 'Model',
  'command.menu.model.description': 'Select the model for this conversation',
  'command.label.goal': 'Goal',
  'command.label.plan': 'Plan',
  'command.label.feedback': 'Feedback',
  'command.label.compact': 'Compact',
  'command.label.permission': 'Permission',
  'command.label.export': 'Export',
  'command.description.goal': 'Set or view the goal for a long-running task',
  'command.description.plan': 'Enter or leave plan mode',
  'command.description.feedback': 'Record feedback about this session',
  'command.description.compact': 'Compact older conversation history',
  'command.description.permission': 'Switch the permission preset (sandbox mode + approval policy)',
  'command.description.export': 'Download this Session log as a ZIP archive',
  'command.token.goal': 'goal',
  'command.token.plan': 'plan',
  'command.token.feedback': 'feedback',
  'command.token.permission': 'permission',
  'composer.hint.goal': 'describe the objective for a long-running task',
  'composer.hint.goal.active': 'goal active — edit / pause / resume / clear',
  'composer.hint.plan': 'describe your task to generate plan',
  'composer.placeholder.plan': 'describe your task to generate plan',
  'composer.placeholder.steerQueue': 'Cmd/Ctrl+Enter steers all queued messages',
  'plan.chip.label': 'Plan',
  'plan.chip.on.aria': 'Plan mode on, press to turn off',
  'plan.chip.on.title': 'Plan mode on — click to turn off (/plan off)',
  'plan.chip.exitFailed': 'Failed to exit plan mode',
  'goal.phase.active': 'Ongoing Goal',
  'goal.phase.active.disarmed': 'Inactive Goal',
  'goal.phase.paused': 'Paused Goal',
  'goal.phase.blocked': 'Blocked Goal',
  'goal.objective.aria': 'Goal objective',
  'goal.action.save': 'Save goal',
  'goal.action.cancel': 'Cancel edit',
  'goal.action.pause': 'Pause goal',
  'goal.action.resume': 'Resume goal',
  'goal.action.edit': 'Edit goal',
  'goal.action.clear': 'Clear goal',
  'command.executeFailed': 'Command failed: {message}',
  'command.executeError': '{text}',
  'command.executeUnmatched': 'Unknown or malformed command',
  'completion.suggestions.aria': 'Trigger suggestions',
  'completion.loading': 'Loading…',
  'completion.group.command': 'Commands',
  'completion.group.skill': 'Skills',
  'completion.section.files': 'Files & folders',
  'completion.drill.hint': 'Browse folder',
  'completion.drill.key': 'Tab',
  'completion.drill.aria': 'Browse folder',
  // The drilled-source breadcrumb (issue #80) — the host lines verbatim.
  'completion.crumbs.aria': 'Folder navigation',
  'completion.crumb.root': 'Workspace',
  'completion.skill.userOnly': 'user-only',
  // `@` session-mention rows (#75) — the host `ui-reference` lines verbatim
  // (see the zh block above for the fold).
  'completion.section.subagents': 'Subagents',
  'completion.section.sessions': 'Sessions',
  'completion.candidate.noCwd': '(no cwd)',
  'completion.time.now': 'now',
  'completion.time.minutes': '{n}min',
  'completion.time.hours': '{n}h',
  'completion.time.days': '{n}d',
  'completion.time.months': '{n}mo',
  'completion.time.years': '{n}y',
  'queue.count': '{n} queued messages',
  'queue.sending': 'Sending…',
  'queue.edit': 'Edit queued message',
  'queue.edit.unsupported': 'Contains non-text content; editing is not supported yet',
  'queue.save': 'Save queued message',
  'queue.cancelEdit': 'Cancel editing',
  'queue.remove': 'Remove queued message',
  'queue.steer': 'Steer queued message',
  'queue.steer.unavailable': 'Steering is available only while the agent is running',
  'queue.editFailed': 'Edit failed: this message may have already started sending.',
  'queue.removeFailed': 'Removal failed: this message may have already started sending.',
  'queue.steerFailed': 'Steering failed. Try again.',
  // Queue strip attachments (#77) — the host `conversation` namespace's
  // lines copied verbatim (see the zh block above for the fold).
  'queue.image': 'Queued message image',
  'queue.file': 'Queued file {name}',
  'todo.title': 'To-dos',
  'todo.progress.done': '{done} completed',
  'todo.progress.active': '{active} in progress',
  'todo.progress.pending': '{pending} pending',
  'todo.status.completed': 'Completed',
  'todo.status.inProgress': 'In progress',
  'todo.status.pending': 'Pending',
  'agentPreset.hint': 'Choose the agent preset for your new task',
  'agentPreset.noDescription': 'No description.',
  'agentPreset.switchRefused': 'Could not switch the agent preset: {reason}',
  // Stats pills (issue #43, alpha.13) — the host `chat` namespace's own lines
  // copied verbatim (see the zh block above for the fold); the dialog keys
  // (issue #43's third round) ride the same fold.
  'stats.counts': '{turns} turns {steps} steps',
  'stats.cacheHit': 'Cache hit {percent}%',
  'stats.dialog.title': 'Session statistics',
  'stats.dialog.usageTitle': 'Token usage',
  'stats.dialog.llmTime': 'LLM time',
  'stats.dialog.toolTime': 'Tool time',
  'stats.dialog.ttft': 'Avg time to first token (TTFT)',
  'stats.dialog.speed': 'Tokens per second (TPS)',
  'message.tokensPerSecond': '{tps} tok/s',
  'message.turnUsage.count': '{count} tok',
  'message.turnUsage.cacheHit': 'Cache hit',
  'message.turnUsage.input': 'Uncached input',
  'message.turnUsage.cacheRead': 'Cached input',
  'message.turnUsage.cacheWrite': 'Cache write',
  'message.turnUsage.output': 'Output',
  'duration.compactSeconds': '{seconds}s',
  'duration.compactMinutes': '{minutes}m{seconds}s',
  'number.thousand': '{value}K',
  'number.million': '{value}M',
  'number.groupSeparator': ',',
  // Workspace menu add row (issue #42, alpha.13 retest) — the host
  // `workspace` namespace's own lines copied verbatim (see the zh block
  // above for the fold).
  'workspace.menu.addWorkspace': 'Add workspace…',
  'workspace.folderError.title': 'Couldn’t open folder',
  'workspace.folderError.retry': 'Choose again',
  // Reference surfaces (#75) — the host lines verbatim (see the zh block
  // above for the fold).
  'fileOpen.title': 'Couldn’t open file',
  'fileOpen.failed': 'Couldn’t open “{path}”. Try again or close this message.',
  'fileOpen.close': 'Close',
  'fileOpen.retry': 'Retry',
  'secret.reveal': 'Show secret',
  'secret.hide': 'Hide secret',
  'message.referenceSummary': 'Referenced session · {labels}',
  'message.referenceSeparator': ', ',
}

export { zh, en }
